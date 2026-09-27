"""
Gera os corpos 3D realistas (masculino e feminino) a partir dos ativos do
MakeHuman — todos licenciados CC0 (uso livre, inclusive comercial).

    python tools/bodies/build_bodies.py <pasta-makehuman>

<pasta-makehuman> deve conter:
    data/base.obj                      (makehuman/data/3dobjs/base.obj do repositório oficial)
    data/targets/*.target              (makehuman/data/targets/macrodetails/...)
    assets/...                         (makehuman_system_assets_cc0.zip descompactado)

Veja tools/bodies/README.md para os links de download.

Saída: public/models/body-male.glb e public/models/body-female.glb
  • malha "body" (pele com textura), olhos, sobrancelhas, cílios e cabelo
  • já normalizados: pés em Y=0, centralizado em X/Z, metros, +Z = frente,
    X negativo = lado DIREITO do paciente (mesma convenção do modelo clássico)
  • arquivo JSON ao lado com as juntas do esqueleto (usado pelo gerador de pontos)
"""
import io
import json
import os
import struct
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'models')

MODELS = {
    'male': {
        'height': 1.78,
        'targets': [('caucasian-male-young', 1.0),
                    ('universal-male-young-averagemuscle-averageweight', 1.0),
                    ('universal-male-young-maxmuscle-averageweight', 0.25)],
        'skin': 'young_caucasian_male/young_lightskinned_male_diffuse.png',
        'hair': 'short02',
        'eyebrows': 'eyebrow001',
        'eyelashes': 'eyelashes01',
        'eyes': 'brown',
        'garments': ['briefs'],
    },
    'female': {
        'height': 1.66,
        'targets': [('caucasian-female-young', 1.0),
                    ('universal-female-young-averagemuscle-averageweight', 1.0),
                    ('universal-female-young-averagemuscle-minweight', 0.15)],
        'skin': 'young_caucasian_female/young_lightskinned_female_diffuse.png',
        'hair': 'ponytail01',
        'eyebrows': 'eyebrow010',
        'eyelashes': 'eyelashes02',
        'eyes': 'brownlight',
        'garments': ['top', 'briefs'],
    },
}


# ── Leitura de OBJ (MakeHuman) ───────────────────────────────────────────────
def read_obj(path):
    V, VT, faces, groups = [], [], [], []
    cur = None
    with open(path, encoding='utf-8', errors='ignore') as fh:
        for line in fh:
            if line.startswith('v '):
                V.append([float(x) for x in line.split()[1:4]])
            elif line.startswith('vt '):
                VT.append([float(x) for x in line.split()[1:3]])
            elif line.startswith('g '):
                cur = line.split()[1]
            elif line.startswith('f '):
                vs, ts = [], []
                for p in line.split()[1:]:
                    parts = p.split('/')
                    vs.append(int(parts[0]) - 1)
                    ts.append(int(parts[1]) - 1 if len(parts) > 1 and parts[1] else None)
                faces.append((vs, ts))
                groups.append(cur)
    return np.array(V, dtype=np.float64), np.array(VT, dtype=np.float64), faces, groups


def read_target(path):
    idx, d = [], []
    with open(path) as fh:
        for line in fh:
            if not line.strip() or line.startswith('#'):
                continue
            p = line.split()
            idx.append(int(p[0]))
            d.append([float(p[1]), float(p[2]), float(p[3])])
    return np.array(idx, dtype=np.int64), np.array(d, dtype=np.float64).reshape(-1, 3)


def read_mhclo(path):
    """Devolve (obj_file, material, refs[(ids, pesos, offsets)], escalas)."""
    info = {'refs': [], 'scale': {}}
    in_verts = False
    with open(path) as fh:
        for line in fh:
            s = line.strip()
            if not s or s.startswith('#'):
                continue
            p = s.split()
            numeric = all(x.lstrip('-').replace('.', '', 1).replace('e-', '', 1).isdigit() for x in p)
            if in_verts and numeric:
                if len(p) == 1:
                    info['refs'].append(([int(p[0])] * 3, [1.0, 0.0, 0.0], [0.0, 0.0, 0.0]))
                elif len(p) == 9:
                    info['refs'].append(([int(x) for x in p[:3]], [float(x) for x in p[3:6]],
                                         [float(x) for x in p[6:9]]))
                continue
            if numeric:
                in_verts = False     # outra seção numérica (ex.: delete_verts)
                continue
            if p[0] == 'verts':
                in_verts = True
            elif p[0] in ('x_scale', 'y_scale', 'z_scale'):
                info['scale'][p[0][0]] = (int(p[1]), int(p[2]), float(p[3]))
            elif p[0] == 'obj_file':
                info['obj'] = p[1]
            elif p[0] == 'material':
                info['material'] = p[1]
    return info


def fit_proxy(info, V):
    """Posiciona os vértices do acessório sobre o corpo deformado (algoritmo do MakeHuman)."""
    sc = []
    for k, axis in (('x', 0), ('y', 1), ('z', 2)):
        if k in info['scale']:
            a, b, den = info['scale'][k]
            sc.append(abs(V[a][axis] - V[b][axis]) / den)
        else:
            sc.append(1.0)
    sc = np.array(sc)
    out = []
    for ids, w, off in info['refs']:
        pos = w[0] * V[ids[0]] + w[1] * V[ids[1]] + w[2] * V[ids[2]] + np.array(off) * sc
        out.append(pos)
    return np.array(out)


def mhmat_texture(path):
    folder = os.path.dirname(path)
    with open(path) as fh:
        for line in fh:
            if line.startswith('diffuseTexture'):
                return os.path.join(folder, line.split(None, 1)[1].strip())
    return None


# ── Geometria ─────────────────────────────────────────────────────────────────
def build_primitive(V, VT, faces, keep):
    """Triangula as faces escolhidas e duplica vértices por par (posição, UV)."""
    remap, pos, uv, idx = {}, [], [], []
    for (vs, ts), ok in zip(faces, keep):
        if not ok:
            continue
        corners = []
        for v, t in zip(vs, ts):
            key = (v, t)
            if key not in remap:
                remap[key] = len(pos)
                pos.append(V[v])
                uv.append(VT[t] if t is not None else (0.0, 0.0))
            corners.append(remap[key])
        for i in range(1, len(corners) - 1):
            idx += [corners[0], corners[i], corners[i + 1]]
    pos = np.array(pos, dtype=np.float32)
    uv = np.array(uv, dtype=np.float32)
    uv[:, 1] = 1.0 - uv[:, 1]            # OBJ → glTF (origem da UV no topo)
    idx = np.array(idx, dtype=np.uint32)
    # Normais suaves por posição (vértices duplicados na costura ficam iguais)
    n = np.zeros_like(pos)
    tri = idx.reshape(-1, 3)
    fn = np.cross(pos[tri[:, 1]] - pos[tri[:, 0]], pos[tri[:, 2]] - pos[tri[:, 0]])
    keys = {}
    for i, p in enumerate(map(tuple, np.round(pos, 5))):
        keys.setdefault(p, []).append(i)
    for k in range(3):
        np.add.at(n, tri[:, k], fn)
    for group in keys.values():
        if len(group) > 1:
            s = n[group].sum(0)
            n[group] = s
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    return pos, uv, idx, n.astype(np.float32)


# ── Texturas ─────────────────────────────────────────────────────────────────
def encode_image(path, size, fmt, process=None):
    im = Image.open(path)
    im = im.convert('RGBA' if fmt == 'PNG' else 'RGB')
    if process:
        im = process(im)
    if size and im.size[0] > size:
        im = im.resize((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    if fmt == 'PNG':
        im.save(buf, 'PNG', optimize=True)
        return buf.getvalue(), 'image/png'
    im.save(buf, 'JPEG', quality=88, optimize=True)
    return buf.getvalue(), 'image/jpeg'


def paint_garments(im, P, VT, faces, groups, kinds, joints):
    """Pinta roupa íntima na textura da pele. Cada triângulo do corpo é
    rasterizado no espaço UV e, pixel a pixel, a posição 3D interpolada decide
    se é tecido — assim o contorno é uma curva suave, não os quadrados da malha."""
    W, H = im.size
    body = [(vs, ts) for (vs, ts), g in zip(faces, groups) if g == 'body']
    ids = sorted({v for vs, _ in body for v in vs})
    crotch = min(P[i][1] for i in ids if abs(P[i][0]) < 0.012 and 0.5 < P[i][1] < 1.0)
    pelvis_y = joints['pelvis'][1]
    spine_z = joints['spine-1'][2]
    tips = []
    for side in (-1, 1):
        cand = [i for i in ids if side * P[i][0] > 0.04 and 1.0 < P[i][1] < 1.35 and abs(P[i][0]) < 0.14]
        tips.append(P[max(cand, key=lambda i: P[i][2])])
    bust_y = (tips[0][1] + tips[1][1]) / 2

    def inside(X, Y, Z, kind):
        ax = np.abs(X)
        front = Z > spine_z + 0.03
        if kind == 'briefs':
            top = pelvis_y + (0.05 if 'top' in kinds else 0.035)
            leg = crotch - 0.010 + 0.58 * np.maximum(0.0, ax - 0.012)
            return (Y > leg) & (Y < top) & (ax < 0.24)
        if kind == 'top':
            under = bust_y - 0.082
            neck = np.where(front,
                            bust_y + 0.035 + 1.1 * np.maximum(0.0, ax - 0.025),  # decote em U
                            bust_y + 0.055)
            arm = bust_y + 0.095 - 1.5 * np.maximum(0.0, ax - 0.082)          # cava até a axila
            neck = np.minimum(np.minimum(neck, bust_y + 0.095), arm)
            band = (Y > under) & (Y < neck) & (ax < 0.16)
            strap = (Y >= under) & (ax > 0.058) & (ax < 0.082) & (Y < bust_y + 0.25)
            return band | strap
        return np.zeros_like(X, dtype=bool)

    S = 2                                   # supersampling do contorno
    mask = np.zeros((H * S, W * S), dtype=np.float32)
    lo_y = crotch - 0.05
    hi_y = bust_y + 0.26 if 'top' in kinds else pelvis_y + 0.08
    for vs, ts in body:
        for tri in ((0, 1, 2), (0, 2, 3)) if len(vs) == 4 else ((0, 1, 2),):
            p3 = P[[vs[i] for i in tri]]
            if p3[:, 1].max() < lo_y or p3[:, 1].min() > hi_y:
                continue
            uv = np.array([(VT[ts[i]][0] * W * S, (1.0 - VT[ts[i]][1]) * H * S) for i in tri])
            x0, y0 = np.floor(uv.min(0)).astype(int)
            x1, y1 = np.ceil(uv.max(0)).astype(int)
            x0, y0 = max(x0, 0), max(y0, 0)
            x1, y1 = min(x1, W * S - 1), min(y1, H * S - 1)
            if x1 < x0 or y1 < y0:
                continue
            gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            (ax_, ay), (bx, by), (cx, cy) = uv
            den = (by - cy) * (ax_ - cx) + (cx - bx) * (ay - cy)
            if abs(den) < 1e-9:
                continue
            w0 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / den
            w1 = ((cy - ay) * (gx - cx) + (ax_ - cx) * (gy - cy)) / den
            w2 = 1 - w0 - w1
            inn = (w0 >= -0.01) & (w1 >= -0.01) & (w2 >= -0.01)
            if not inn.any():
                continue
            X = w0 * p3[0, 0] + w1 * p3[1, 0] + w2 * p3[2, 0]
            Y = w0 * p3[0, 1] + w1 * p3[1, 1] + w2 * p3[2, 1]
            Z = w0 * p3[0, 2] + w1 * p3[1, 2] + w2 * p3[2, 2]
            hit = np.zeros_like(inn)
            for k in kinds:
                hit |= inside(X, Y, Z, k)
            sub = mask[y0:y1 + 1, x0:x1 + 1]
            sub[inn & hit] = 1.0
    m = Image.fromarray((mask * 255).astype(np.uint8)).resize((W, H), Image.LANCZOS)
    m = m.filter(ImageFilter.GaussianBlur(0.7))

    # Tecido grafite que preserva a luz/sombra da textura original (dobras)
    arr = np.asarray(im.convert('RGB')).astype(np.float32)
    lum = arr.mean(axis=2, keepdims=True)
    shade = 0.8 + 0.4 * (lum - lum.mean()) / 255.0
    fabric = np.array([50, 54, 68], dtype=np.float32) * shade
    fabric += np.random.default_rng(7).normal(0, 2.0, fabric.shape)   # trama sutil
    fab = Image.fromarray(np.clip(fabric, 0, 255).astype(np.uint8))
    return Image.composite(fab, im.convert('RGB'), m)


# ── GLB ───────────────────────────────────────────────────────────────────────
class GLB:
    def __init__(self):
        self.bin = bytearray()
        self.json = {'asset': {'version': '2.0', 'generator': 'SistemaFisio build_bodies (MakeHuman CC0)'},
                     'scene': 0, 'scenes': [{'nodes': []}], 'nodes': [], 'meshes': [],
                     'buffers': [], 'bufferViews': [], 'accessors': [],
                     'materials': [], 'textures': [], 'images': [], 'samplers': [{}]}

    def _view(self, data, target=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        off = len(self.bin)
        self.bin += data
        bv = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target:
            bv['target'] = target
        self.json['bufferViews'].append(bv)
        return len(self.json['bufferViews']) - 1

    def _accessor(self, arr, ctype, typ, target, minmax=False):
        bv = self._view(arr.tobytes(), target)
        acc = {'bufferView': bv, 'componentType': ctype, 'count': int(arr.shape[0]), 'type': typ}
        if minmax:
            acc['min'] = arr.min(0).tolist()
            acc['max'] = arr.max(0).tolist()
        self.json['accessors'].append(acc)
        return len(self.json['accessors']) - 1

    def image(self, data, mime):
        bv = self._view(data)
        self.json['images'].append({'bufferView': bv, 'mimeType': mime})
        self.json['textures'].append({'sampler': 0, 'source': len(self.json['images']) - 1})
        return len(self.json['textures']) - 1

    def material(self, name, tex, alpha=None, rough=0.6, double=False):
        m = {'name': name, 'pbrMetallicRoughness': {'baseColorTexture': {'index': tex},
                                                     'metallicFactor': 0.0, 'roughnessFactor': rough}}
        if alpha == 'MASK':
            m['alphaMode'] = 'MASK'
            m['alphaCutoff'] = 0.35
        elif alpha == 'BLEND':
            m['alphaMode'] = 'BLEND'
        if double:
            m['doubleSided'] = True
        self.json['materials'].append(m)
        return len(self.json['materials']) - 1

    def mesh(self, name, pos, uv, idx, nrm, mat):
        prim = {'attributes': {
            'POSITION': self._accessor(pos, 5126, 'VEC3', 34962, True),
            'NORMAL': self._accessor(nrm, 5126, 'VEC3', 34962),
            'TEXCOORD_0': self._accessor(uv, 5126, 'VEC2', 34962)},
            'indices': self._accessor(idx, 5125, 'SCALAR', 34963),
            'material': mat}
        self.json['meshes'].append({'name': name, 'primitives': [prim]})
        self.json['nodes'].append({'name': name, 'mesh': len(self.json['meshes']) - 1})
        self.json['scenes'][0]['nodes'].append(len(self.json['nodes']) - 1)

    def save(self, path):
        while len(self.bin) % 4:
            self.bin.append(0)
        self.json['buffers'] = [{'byteLength': len(self.bin)}]
        js = json.dumps(self.json, separators=(',', ':')).encode()
        js += b' ' * ((4 - len(js) % 4) % 4)
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        with open(path, 'wb') as fh:
            fh.write(struct.pack('<III', 0x46546C67, 2, total))
            fh.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
            fh.write(struct.pack('<II', len(self.bin), 0x004E4942) + bytes(self.bin))


# ── Montagem de um modelo ─────────────────────────────────────────────────────
def build(name, cfg, mh):
    data, assets = os.path.join(mh, 'data'), os.path.join(mh, 'assets')
    V, VT, faces, groups = read_obj(os.path.join(data, 'base.obj'))
    for tname, w in cfg['targets']:
        ids, d = read_target(os.path.join(data, 'targets', tname + '.target'))
        V[ids] += w * d

    # Juntas do esqueleto (centro dos cubinhos auxiliares "joint-*")
    joints = {}
    for (vs, _), g in zip(faces, groups):
        if g and g.startswith('joint-'):
            joints.setdefault(g[6:], set()).update(vs)
        elif g in ('helper-upper-teeth', 'helper-lower-teeth', 'helper-l-eye', 'helper-r-eye'):
            joints.setdefault(g, set()).update(vs)     # referências da boca e dos olhos
    joints = {k: V[list(s)].mean(0) for k, s in joints.items()}

    # Normalização: pés em Y=0, altura final, centro em X/Z. MakeHuman: +X = lado
    # esquerdo do modelo, +Z = frente → igual à convenção do sistema.
    body_ids = sorted({v for (vs, _), g in zip(faces, groups) if g == 'body' for v in vs})
    B = V[body_ids]
    lo, hi = B.min(0), B.max(0)
    s = cfg['height'] / (hi[1] - lo[1])
    ctr = np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2])
    tf = lambda P: (P - ctr) * s
    joints_n = {k: tf(v) for k, v in joints.items()}

    glb = GLB()

    # Pele
    skin_path = os.path.join(assets, 'skins', cfg['skin'])
    pos, uv, idx, nrm = build_primitive(V, VT, faces, [g == 'body' for g in groups])
    process = None
    if cfg.get('garments'):
        process = lambda im: paint_garments(im, tf(V), VT, faces, groups, cfg['garments'], joints_n)
    skin = glb.image(*encode_image(skin_path, 2048, 'JPEG', process))
    glb.mesh('body', tf(pos).astype(np.float32), uv, idx, nrm, glb.material('skin', skin, rough=0.62))

    # Acessórios encaixados pelo mhclo
    def proxy(kind, folder, alpha, double, mat_override=None, tex_size=1024):
        base = os.path.join(assets, kind, folder)
        info = read_mhclo(os.path.join(base, folder + '.mhclo'))
        pV, pVT, pF, _ = read_obj(os.path.join(base, info['obj']))
        fitted = fit_proxy(info, V)
        mat_path = mat_override or os.path.join(base, info.get('material', folder + '.mhmat'))
        tex_path = mhmat_texture(mat_path)
        fmt = 'PNG' if alpha else 'JPEG'
        tex = glb.image(*encode_image(tex_path, tex_size, fmt))
        ppos, puv, pidx, pnrm = build_primitive(fitted, pVT, pF, [True] * len(pF))
        glb.mesh(kind, tf(ppos).astype(np.float32), puv, pidx, pnrm,
                 glb.material(kind, tex, alpha=alpha, rough=0.35 if kind == 'eyes' else 0.7, double=double))

    proxy('eyes', 'high-poly', 'BLEND', False,
          mat_override=os.path.join(assets, 'eyes', 'materials', cfg['eyes'] + '.mhmat'), tex_size=512)
    proxy('eyebrows', cfg['eyebrows'], 'MASK', True, tex_size=512)
    proxy('eyelashes', cfg['eyelashes'], 'MASK', True, tex_size=512)
    proxy('hair', os.environ.get('BODY_HAIR', cfg['hair']), 'MASK', True, tex_size=1024)

    out = os.path.join(OUT, f'body-{name}{os.environ.get("BODY_SUFFIX", "")}.glb')
    glb.save(out)
    with open(os.path.join(OUT, f'body-{name}.joints.json'), 'w') as fh:
        json.dump({k: [round(float(x), 5) for x in tf(v)] for k, v in sorted(joints.items())}, fh, indent=0)
    print(f'OK {os.path.relpath(out, ROOT)}  ({os.path.getsize(out) / 1e6:.1f} MB)')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    for name in (sys.argv[2:] or MODELS):
        build(name, MODELS[name], sys.argv[1])
