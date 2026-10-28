"""
Gera a anatomia real (ossos, músculos e órgãos) dos corpos 3D a partir do
BodyParts3D, encaixada no corpo feminino e no masculino.

    python tools/anatomy/build_anatomy.py C:\\bp3d            # baixa (1ª vez) e gera os dois
    python tools/anatomy/build_anatomy.py C:\\bp3d female     # só um corpo

Requer Python 3 com numpy, scipy e fast-simplification
(pip install numpy scipy fast-simplification). Saída em public/models/:

    anatomy-<corpo>-bones.bin     ossos, dentes, cartilagens e discos
    anatomy-<corpo>-muscles.bin   músculos, tendões e fáscias
    anatomy-<corpo>-organs.bin    órgãos e grandes vasos

Formato (.bin = gzip): u32 tamanho do cabeçalho, cabeçalho JSON (UTF-8,
completado com espaços até múltiplo de 4) e o bloco binário. Cada peça do
cabeçalho aponta para: posições u16×3 (quantizadas na caixa da peça), oclusão
ambiente u8 por vértice e índices u16/u32. As normais são calculadas no
navegador. Leitura em public/js/anatomy-real.js.

Como o encaixe funciona
    O BodyParts3D é um único corpo masculino, de pé, braços ao longo do corpo
    e palmas para a frente. Cada corpo de destino (MakeHuman) está em "A", com
    proporções próprias. Então:
    - cada osso dos membros recebe uma transformação rígida + escala que leva
      as suas juntas (cabeça do fêmur, joelho, tornozelo, ombro, cotovelo,
      punho, cabeças dos metacarpos/metatarsos, falanges) às juntas do corpo
      de destino; o rádio gira em volta da ulna (pronação) para a palma ficar
      como a do corpo;
    - o tronco, o pescoço e a cabeça são levados fatia a fatia: a altura por
      marcos (quadril, ombro, olhos, topo da cabeça) e a largura/profundidade
      pela razão entre as peles dos dois corpos em cada altura;
    - cada vértice de músculo segue os ossos mais próximos (pesos suaves), e
      nos membros a espessura é corrigida pela razão entre as peles naquele
      ponto (em volta do eixo do membro);
    - por fim, nada pode ficar fora da pele do corpo de destino.

Licença dos modelos: BodyParts3D, © The Database Center for Life Science,
CC Attribution-Share Alike 2.1 Japan. Os arquivos gerados herdam a licença
(atribuição + compartilhamento pela mesma licença); o crédito aparece no
visualizador.
"""
import gzip
import json
import os
import struct
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(__file__))
from catalog import classify  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MODELS = os.path.join(ROOT, 'public', 'models')
RAW = 'https://raw.githubusercontent.com/Kevin-Mattheus-Moerman/BodyParts3D/main/assets/BodyParts3D_data/'
SKIN_ID = 'FMA7163'
EYE_ID = 'FMA12513'      # globos oculares: só como marco de altura
BODIES = ['female', 'male']

# Triângulos por camada (o total é dividido entre as peças pela área^0,8)
BUDGET = {'bones': 150_000, 'muscles': 260_000, 'organs': 60_000}
MIN_TRIS = {'bones': 80, 'muscles': 120, 'organs': 120}
MARGIN = {'bones': 0.004, 'muscles': 0.0015, 'organs': 0.008}   # folga mínima até a pele (m)


# ─── Entrada ─────────────────────────────────────────────────────────────────

def fetch(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return
    try:
        with urllib.request.urlopen(url) as r:
            data = r.read()
    except Exception as e:   # peça listada que não existe no repositório
        print(f'  sem {os.path.basename(path)}: {e}')
        return
    with open(path, 'wb') as f:
        f.write(data)


def download(src):
    """Baixa a lista de peças e os STL usados (só os que faltam)."""
    os.makedirs(os.path.join(src, 'stl'), exist_ok=True)
    fetch(RAW + 'parts_list_e.txt', os.path.join(src, 'parts_list_e.txt'))
    parts = read_parts(src)
    need = [fid for fid, (name, info) in parts.items() if info] + [SKIN_ID, EYE_ID]
    miss_p = os.path.join(src, 'missing.json')     # listadas, mas sem arquivo no repositório
    missing = set(json.load(open(miss_p))) if os.path.exists(miss_p) else set()
    stl = lambda f: os.path.join(src, 'stl', f + '.stl')
    todo = [f for f in need if not os.path.exists(stl(f)) and f not in missing]
    if todo:
        print(f'baixando {len(todo)} peças…')
        with ThreadPoolExecutor(8) as ex:
            list(ex.map(lambda f: fetch(RAW + f'stl/{f}.stl', stl(f)), todo))
        missing |= {f for f in todo if not os.path.exists(stl(f))}
        json.dump(sorted(missing), open(miss_p, 'w'))


def read_parts(src):
    out = {}
    with open(os.path.join(src, 'parts_list_e.txt'), encoding='utf-8', errors='replace') as f:
        next(f)
        for line in f:
            row = line.rstrip('\n').split('\t')
            if len(row) >= 2:
                out[row[0]] = (row[1], classify(row[1]))
    return out


def read_stl(path):
    b = open(path, 'rb').read()
    n = struct.unpack('<I', b[80:84])[0]
    a = np.frombuffer(b[84:84 + n * 50], dtype=np.dtype([('n', '<3f4'), ('v', '<9f4'), ('a', '<u2')]))
    flat = a['v'].reshape(-1, 3).astype(np.float64)
    q = np.round(flat * 100).astype(np.int64)          # junta vértices a 0,01 mm
    _, first, inv = np.unique(q, axis=0, return_index=True, return_inverse=True)
    V = flat[first]
    F = inv.reshape(-1, 3)
    F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]
    # mm, Z para cima, −Y = frente  →  m, Y para cima, +Z = frente
    V = np.stack([V[:, 0], V[:, 2], -V[:, 1]], 1) / 1000.0
    return V, F


def area(V, F):
    return 0.5 * np.linalg.norm(np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]), axis=1).sum()


def simplify(V, F, target):
    import fast_simplification
    if len(F) <= target:
        return V, F
    V2, F2 = fast_simplification.simplify(V.astype(np.float32), F.astype(np.int32), 1 - target / len(F))
    return V2.astype(np.float64), F2.astype(np.int64)


def bisect(V, F, cut):
    """Divide as arestas em `cut` (pares de índices) ao meio; os triângulos dos
    dois lados de cada aresta são divididos juntos (sem fendas)."""
    V = list(map(tuple, V))
    mid = {}
    for a, b in cut:
        k = (min(a, b), max(a, b))
        if k not in mid:
            mid[k] = len(V)
            V.append(tuple((np.asarray(V[a]) + np.asarray(V[b])) / 2))
    out = []
    for tri in map(tuple, F):
        ms = [mid.get((min(tri[i], tri[(i + 1) % 3]), max(tri[i], tri[(i + 1) % 3]))) for i in range(3)]
        n = sum(m is not None for m in ms)
        if n == 0:
            out.append(tri)
            continue
        i = next(i for i in range(3) if ms[i] is not None)      # começa numa aresta cortada
        p0, p1, p2 = tri[i], tri[(i + 1) % 3], tri[(i + 2) % 3]
        m01, m12, m20 = ms[i], ms[(i + 1) % 3], ms[(i + 2) % 3]
        if n == 1:
            out += [(p0, m01, p2), (m01, p1, p2)]
        elif n == 3:
            out += [(p0, m01, m20), (m01, p1, m12), (m20, m12, p2), (m01, m12, m20)]
        elif m12 is not None:
            out += [(p0, m01, p2), (m01, p1, m12), (m01, m12, p2)]
        else:
            out += [(p0, m01, m20), (m01, p1, p2), (m01, p2, m20)]
    return np.asarray(V), np.asarray(out, dtype=np.int64)


def refine(V, F, fmap, tol=0.0009, min_len=0.003, rounds=7):
    """Subdivisão adaptativa: divide as arestas em que o encaixe "dobra" — o
    meio da aresta, levado ao corpo de destino, cai longe do meio do segmento
    já levado (dedos, articulações). Os ventres musculares ficam como estão."""
    for _ in range(rounds):
        E = np.unique(np.sort(np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]), axis=1), axis=0)
        L = np.linalg.norm(V[E[:, 0]] - V[E[:, 1]], axis=1)
        E = E[L > min_len]
        if not len(E):
            break
        X = fmap(V)
        Xm = fmap((V[E[:, 0]] + V[E[:, 1]]) / 2)
        err = np.linalg.norm(Xm - (X[E[:, 0]] + X[E[:, 1]]) / 2, axis=1)
        cut = E[err > tol]
        if not len(cut):
            break
        V, F = bisect(V, F, cut)
    return V, F


def load_source(src):
    """Peças do BodyParts3D já simplificadas (cache em <src>/cache)."""
    cache = os.path.join(src, 'cache')
    os.makedirs(cache, exist_ok=True)
    parts = read_parts(src)
    raw = {}
    for fid, (name, info) in parts.items():
        if not info or not os.path.exists(os.path.join(src, 'stl', fid + '.stl')):
            continue
        raw[fid] = (name, info)
    # orçamento: área de cada peça (lida uma vez e guardada)
    meta_p = os.path.join(cache, 'areas.json')
    areas = json.load(open(meta_p)) if os.path.exists(meta_p) else {}
    for fid in raw:
        if fid not in areas:
            V, F = read_stl(os.path.join(src, 'stl', fid + '.stl'))
            areas[fid] = [area(V, F), len(F)]
    json.dump(areas, open(meta_p, 'w'))
    out = []
    for layer, budget in BUDGET.items():
        ids = [f for f in raw if raw[f][1]['layer'] == layer]
        wsum = sum(areas[f][0] ** 0.8 for f in ids)
        for fid in ids:
            name, info = raw[fid]
            tgt = int(max(MIN_TRIS[layer], budget * areas[fid][0] ** 0.8 / wsum))
            cp = os.path.join(cache, f'{fid}_{tgt}.npz')
            if os.path.exists(cp):
                d = np.load(cp)
                V, F = d['V'], d['F']
            else:
                V, F = read_stl(os.path.join(src, 'stl', fid + '.stl'))
                V, F = simplify(V, F, tgt)
                np.savez(cp, V=V, F=F)
            out.append({'fid': fid, 'en': name, **info, 'V': V, 'F': F})
    skin_p = os.path.join(cache, 'skin.npz')
    if os.path.exists(skin_p):
        d = np.load(skin_p)
        skin = d['V']
    else:
        V, F = read_stl(os.path.join(src, 'stl', SKIN_ID + '.stl'))
        V, F = simplify(V, F, 250_000)
        skin = V
        np.savez(skin_p, V=V, F=F)
    return out, skin


def read_body(name):
    """Malha da pele (posições e triângulos) do corpo de destino (.glb)."""
    b = open(os.path.join(MODELS, f'body-{name}.glb'), 'rb').read()
    jl = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + jl])
    bin0 = 20 + jl + 8
    mesh = next(m for m in j['meshes'] if m['name'] == 'body')['primitives'][0]

    def acc(i):
        a = j['accessors'][i]
        bv = j['bufferViews'][a['bufferView']]
        n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']]
        dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16}[a['componentType']]
        off = bin0 + bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        return np.frombuffer(b[off:off + a['count'] * n * np.dtype(dt).itemsize], dtype=dt).reshape(-1, n)
    V = acc(mesh['attributes']['POSITION']).astype(np.float64)
    F = acc(mesh['indices']).reshape(-1, 3).astype(np.int64)
    joints = json.load(open(os.path.join(MODELS, f'body-{name}.joints.json')))
    return V, F, {k: np.array(v, dtype=np.float64) for k, v in joints.items()}


# ─── Geometria ───────────────────────────────────────────────────────────────

def unit(v):
    return v / (np.linalg.norm(v) or 1.0)


def rot_between(a, b):
    a, b = unit(a), unit(b)
    v = np.cross(a, b)
    c = float(a @ b)
    if c < -0.9999:
        p = unit(np.cross(a, [1, 0, 0] if abs(a[0]) < 0.9 else [0, 1, 0]))
        return 2 * np.outer(p, p) - np.eye(3)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx / (1 + c)


def rot_axis(axis, ang):
    a = unit(axis)
    K = np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]])
    return np.eye(3) + np.sin(ang) * K + (1 - np.cos(ang)) * K @ K


def sphere_fit(P):
    A = np.c_[2 * P, np.ones(len(P))]
    return np.linalg.lstsq(A, (P ** 2).sum(1), rcond=None)[0][:3]


def vnormals(V, F):
    n = np.zeros_like(V)
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    for k in range(3):
        np.add.at(n, F[:, k], fn)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


def pca_axis(V):
    c = V - V.mean(0)
    return np.linalg.svd(c, full_matrices=False)[2][0]


def ends(V, toward):
    """Extremidades de um osso longo ao longo do eixo principal: (perto de `toward`, longe)."""
    ax = pca_axis(V)
    t = (V - V.mean(0)) @ ax
    lo, hi = V[t < np.percentile(t, 6)].mean(0), V[t > np.percentile(t, 94)].mean(0)
    # prolonga até a ponta real
    span = t.max() - t.min()
    lo, hi = V.mean(0) + ax * (t.min() + 0.04 * span), V.mean(0) + ax * (t.max() - 0.04 * span)
    if np.linalg.norm(lo - toward) > np.linalg.norm(hi - toward):
        lo, hi = hi, lo
    return lo, hi


class Sim:
    """v → (v − p)·Rᵀ·s + q"""
    def __init__(self, R, s, p, q):
        self.R, self.s, self.p, self.q = R, s, np.asarray(p, float), np.asarray(q, float)

    def __call__(self, V):
        return (V - self.p) @ self.R.T * self.s + self.q


def seg_sim(p0, p1, q0, q1, R0=None):
    """Leva p0→p1 em q0→q1 (âncora em p0/q0); R0: rotação anterior (mantém o giro)."""
    d = R0 @ (p1 - p0) if R0 is not None else (p1 - p0)
    R = rot_between(d, q1 - q0)
    if R0 is not None:
        R = R @ R0
    s = np.linalg.norm(q1 - q0) / max(np.linalg.norm(p1 - p0), 1e-9)
    return Sim(R, s, p0, q0)


def frame_sim(o_p, F_p, R_p, o_q, F_q, R_q, s):
    """Referencial (F, R, N=F×R) → referencial; âncora o."""
    def basis(Fv, Rv):
        Fv = unit(Fv)
        Rv = unit(Rv - Fv * (Rv @ Fv))
        return np.stack([Fv, Rv, np.cross(Fv, Rv)], 1)
    return Sim(basis(F_q, R_q) @ basis(F_p, R_p).T, s, o_p, o_q)


# ─── Encaixe ─────────────────────────────────────────────────────────────────

SIDES = (('D', 'r-', -1), ('E', 'l-', 1))
FINGER = {1: 'thumb', 2: 'index finger', 3: 'middle finger', 4: 'ring finger', 5: 'little finger'}
TOE = {1: 'big toe', 2: 'second toe', 3: 'third toe', 4: 'fourth toe', 5: 'little toe'}
ORDW = ['first', 'second', 'third', 'fourth', 'fifth']


class Fit:
    def __init__(self, parts, skin_bp, body, verbose=True):
        self.parts = parts
        self.by = {}
        for p in parts:
            self.by[(p['base'], p['side'])] = p
        self.skin_bp = skin_bp
        self.Vb, self.Fb, self.J = body
        self.verbose = verbose
        self.bone_tf = {}       # (base, side) → id da transformação
        self.tf = {}            # id → função V → V'
        self.soft_tf = {}       # id de osso → id da transformação dos tecidos moles
        self.seg = {}           # id → (A, B) no corpo de destino (membros)

    def P(self, base, side=None):
        return self.by[(base, side)]['V']

    def log(self, *a):
        if self.verbose:
            print(' ', *a)

    # ── marcos do BodyParts3D ─────────────────────────────────────────────────
    def landmarks(self, side):
        fe, ti, fi = self.P('femur', side), self.P('tibia', side), self.P('fibula', side)
        top = fe[fe[:, 1] > fe[:, 1].max() - 0.05]
        hip = sphere_fit(top[np.abs(top[:, 0]) < np.abs(top[:, 0]).mean()])
        kb = fe[fe[:, 1] < fe[:, 1].min() + 0.025]
        knee = np.r_[kb[:, 0].mean(), (fe[:, 1].min() + ti[:, 1].max()) / 2, kb[:, 2].mean()]
        tb = np.r_[ti[ti[:, 1] < ti[:, 1].min() + 0.02], fi[fi[:, 1] < fi[:, 1].min() + 0.02]]
        ankle = np.r_[tb[:, 0].mean(), ti[:, 1].min() + 0.012, tb[:, 2].mean()]
        hu = self.P('humerus', side)
        ht = hu[hu[:, 1] > hu[:, 1].max() - 0.045]
        shoulder = sphere_fit(ht[np.abs(ht[:, 0]) < np.abs(ht[:, 0]).mean()])
        hb = hu[hu[:, 1] < hu[:, 1].min() + 0.02]
        elbow = np.r_[hb[:, 0].mean(), hu[:, 1].min() + 0.01, hb[:, 2].mean()]
        ra, ul = self.P('radius', side), self.P('ulna', side)
        wb = np.r_[ra[ra[:, 1] < ra[:, 1].min() + 0.015], ul[ul[:, 1] < ul[:, 1].min() + 0.012]]
        wrist = np.r_[wb[:, 0].mean(), ra[:, 1].min() + 0.006, wb[:, 2].mean()]
        L = dict(hip=hip, knee=knee, ankle=ankle, shoulder=shoulder, elbow=elbow, wrist=wrist)
        # cabeças proximais do rádio e distal da ulna (eixo da pronação)
        L['radial_head'] = ra[ra[:, 1] > ra[:, 1].max() - 0.012].mean(0)
        L['ulnar_head'] = ul[ul[:, 1] < ul[:, 1].min() + 0.012].mean(0)
        # mão: bases e cabeças dos metacarpos; falanges
        mc = {}
        for i in range(5):
            mc[i + 1] = ends(self.P(f'{ORDW[i]} metacarpal bone', side), wrist)
        L['mc'] = mc
        ph = {}
        for f, fn in FINGER.items():
            seq = ['proximal', 'distal'] if f == 1 else ['proximal', 'middle', 'distal']
            prev = mc[f][1]
            for s in seq:
                key = f'{s} phalanx of {fn}'
                if (key, side) in self.by:
                    a, b = ends(self.P(key, side), prev)
                    ph[key] = (a, b)
                    prev = b
        L['ph'] = ph
        mt = {}
        for i in range(5):
            mt[i + 1] = ends(self.P(f'{ORDW[i]} metatarsal bone', side), ankle)
        L['mt'] = mt
        tp = {}
        for t, tn in TOE.items():
            prev = mt[t][1]
            for s in ['proximal', 'middle', 'distal']:
                key = f'{s} phalanx of {tn}'
                if (key, side) in self.by:
                    a, b = ends(self.P(key, side), prev)
                    tp[key] = (a, b)
                    prev = b
        L['tp'] = tp
        return L

    # ── tronco: fatias ────────────────────────────────────────────────────────
    def torso_profiles(self, P, torso_mask, y0, y1, step=0.01):
        ys = np.arange(y0, y1 + step, step)
        prof = np.full((len(ys), 4), np.nan)   # zf, zb, hw, zm
        for i, y in enumerate(ys):
            m = torso_mask & (np.abs(P[:, 1] - y) < step * 0.8)
            Q = P[m]
            if len(Q) < 12:
                continue
            # frente: só a linha média (esterno — não pega as mamas); costas: faixa mais larga.
            # Percentis em vez de mínimo/máximo: um vértice solto não faz o contorno "saltar"
            fr = Q[np.abs(Q[:, 0]) < 0.03]
            bk = Q[np.abs(Q[:, 0]) < 0.06]
            if len(fr) < 4 or len(bk) < 4:
                continue
            zf, zb = np.percentile(fr[:, 2], 92), np.percentile(bk[:, 2], 8)
            zm = (zf + zb) / 2
            side = Q[np.abs(Q[:, 2] - zm) < max(0.25 * (zf - zb), 0.02)]
            hw = np.percentile(np.abs(side[:, 0]), 97) if len(side) > 4 else np.percentile(np.abs(Q[:, 0]), 97)
            prof[i] = (zf, zb, hw, zm)
        # preenche e suaviza bem (σ = 3 cm): o tronco não tem degraus
        for k in range(4):
            col = prof[:, k]
            ok = ~np.isnan(col)
            col[~ok] = np.interp(ys[~ok], ys[ok], col[ok])
            ker = np.exp(-0.5 * (np.arange(-9, 10) / 3.0) ** 2)
            ker /= ker.sum()
            prof[:, k] = np.convolve(np.pad(col, 9, mode='edge'), ker, mode='valid')
        return ys, prof

    def build(self):
        J, Vb = self.J, self.Vb
        self.L = {s: self.landmarks(s) for s, _, _ in SIDES}
        # ── membros ──
        for side, pre, sx in SIDES:
            L = self.L[side]
            Jn = lambda n: J[pre + n]
            th = seg_sim(L['hip'], L['knee'], Jn('upper-leg'), Jn('knee'))
            lg = seg_sim(L['knee'], L['ankle'], Jn('knee'), Jn('ankle'), th.R)
            lg.p, lg.q = L['knee'], Jn('knee')
            ua = seg_sim(L['shoulder'], L['elbow'], Jn('shoulder'), Jn('elbow'))
            fa = seg_sim(L['elbow'], L['wrist'], Jn('elbow'), Jn('hand'), ua.R)
            # mão: referencial (dedos, lado do polegar)
            mcp_bp = np.mean([L['mc'][i][1] for i in (2, 3, 4, 5)], 0)
            mcp_mh = np.mean([Jn(f'finger-{i}-1') for i in (2, 3, 4, 5)], 0)
            hand = frame_sim(L['wrist'], mcp_bp - L['wrist'], L['mc'][2][1] - L['mc'][5][1],
                             Jn('hand'), mcp_mh - Jn('hand'), Jn('finger-2-1') - Jn('finger-5-1'),
                             np.linalg.norm(mcp_mh - Jn('hand')) / np.linalg.norm(mcp_bp - L['wrist']))
            # pronação: gira o rádio em volta do eixo cabeça do rádio → cabeça da ulna
            # até o lado do polegar do antebraço coincidir com o da mão
            ax0, ax1 = fa(L['radial_head'][None])[0], fa(L['ulnar_head'][None])[0]
            axis = unit(ax1 - ax0)
            thumb_fa = fa(L['mc'][2][1][None])[0] - fa(L['mc'][5][1][None])[0]
            thumb_mh = Jn('finger-2-1') - Jn('finger-5-1')
            a = thumb_fa - axis * (thumb_fa @ axis)
            b = thumb_mh - axis * (thumb_mh @ axis)
            ang = np.arctan2(np.cross(unit(a), unit(b)) @ axis, unit(a) @ unit(b))
            self.log(f'{side}: pronação {np.degrees(ang):.0f}°')
            Rp = rot_axis(axis, ang)
            radius = lambda V, fa=fa, Rp=Rp, ax0=ax0: (fa(V) - ax0) @ Rp.T + ax0
            # antebraço (tecidos moles): torção progressiva do cotovelo ao punho
            E, W = Jn('elbow'), Jn('hand')

            def fa_soft(V, fa=fa, axis=axis, ax0=ax0, ang=ang, E=E, W=W):
                X = fa(V)
                t = np.clip(((X - E) @ unit(W - E)) / np.linalg.norm(W - E), 0, 1)
                t = t * t * (3 - 2 * t)
                # rotação de Rodrigues com ângulo por vértice
                th = ang * t
                v = X - ax0
                kx = np.cross(axis, v)
                kd = (v @ axis)[:, None] * axis
                return ax0 + v * np.cos(th)[:, None] + kx * np.sin(th)[:, None] + kd * (1 - np.cos(th))[:, None]

            ft_mt = np.mean([L['mt'][i][1] for i in range(1, 6)], 0)
            ft_mh = np.mean([Jn(f'toe-{i}-1') for i in range(1, 6)], 0)
            foot = frame_sim(L['ankle'], ft_mt - L['ankle'], (L['mt'][1][1] - L['mt'][5][1]) * -sx,
                             Jn('ankle'), ft_mh - Jn('ankle'), (Jn('toe-1-1') - Jn('toe-5-1')) * -sx,
                             np.linalg.norm(ft_mh - Jn('ankle')) / np.linalg.norm(ft_mt - L['ankle']))
            T = self.tf
            T['th' + side], T['lg' + side], T['ua' + side], T['fa' + side] = th, lg, ua, fa
            T['rad' + side], T['fas' + side], T['hand' + side], T['ft' + side] = radius, fa_soft, hand, foot
            self.seg['th' + side] = (Jn('upper-leg'), Jn('knee'))
            self.seg['lg' + side] = (Jn('knee'), Jn('ankle'))
            self.seg['ua' + side] = (Jn('shoulder'), Jn('elbow'))
            self.seg['fas' + side] = (Jn('elbow'), Jn('hand'))
            bt = self.bone_tf
            bt[('femur', side)] = bt[('patella', side)] = 'th' + side
            bt[('tibia', side)] = bt[('fibula', side)] = 'lg' + side
            bt[('humerus', side)] = 'ua' + side
            bt[('ulna', side)] = 'fa' + side
            bt[('radius', side)] = 'rad' + side
            self.soft_tf['fa' + side] = self.soft_tf['rad' + side] = 'fas' + side
            for nm in ['scaphoid', 'lunate', 'triquetral', 'pisiform', 'trapezium', 'trapezoid', 'capitate', 'hamate']:
                bt[(nm, side)] = 'hand' + side
            for nm in ['talus', 'calcaneus', 'navicular bone of foot', 'cuboid bone', 'medial cuneiform bone',
                       'intermediate cuneiform bone', 'lateral cuneiform bone', 'sesamoid bone of foot']:
                bt[(nm, side)] = 'ft' + side
            # metacarpos / metatarsos: base presa ao carpo/tarso, cabeça na junta
            for i in range(1, 6):
                b0, b1 = L['mc'][i]
                q0 = hand(b0[None])[0]
                q1 = Jn('finger-1-2') if i == 1 else Jn(f'finger-{i}-1')
                if i == 1:
                    q0 = Jn('finger-1-1')
                T[f'mc{i}{side}'] = seg_sim(b0, b1, q0, q1, hand.R)
                bt[(f'{ORDW[i - 1]} metacarpal bone', side)] = f'mc{i}{side}'
                m0, m1 = L['mt'][i]
                T[f'mt{i}{side}'] = seg_sim(m0, m1, foot(m0[None])[0], Jn(f'toe-{i}-1'), foot.R)
                bt[(f'{ORDW[i - 1]} metatarsal bone', side)] = f'mt{i}{side}'
            # falanges dos dedos: cada uma vai de uma junta à próxima
            for f, fn in FINGER.items():
                seq = ['proximal', 'distal'] if f == 1 else ['proximal', 'middle', 'distal']
                js = [Jn(f'finger-{f}-{k}') for k in ((2, 3, 4) if f == 1 else (1, 2, 3, 4))]
                Rprev, sprev = T[f'mc{f}{side}'].R, T[f'mc{f}{side}'].s
                for k, s in enumerate(seq):
                    key = f'{s} phalanx of {fn}'
                    if key not in L['ph']:
                        continue
                    a, b = L['ph'][key]
                    q0, q1 = js[k], js[k + 1]
                    last = k == len(seq) - 1
                    if last:   # a ponta do dedo fica além do osso: usa a escala anterior
                        R = rot_between(Rprev @ (b - a), q1 - q0) @ Rprev
                        t = Sim(R, sprev, a, q0)
                    else:
                        t = seg_sim(a, b, q0, q1, Rprev)
                    T[f'ph{f}{k}{side}'] = t
                    bt[(key, side)] = f'ph{f}{k}{side}'
                    Rprev, sprev = t.R, t.s
            for f, tn in TOE.items():
                js = [Jn(f'toe-{f}-{k}') for k in range(1, (3 if f == 1 else 4) + 1)]
                seq = [s for s in ('proximal', 'middle', 'distal') if f'{s} phalanx of {tn}' in L['tp']]
                Rprev, sprev = T[f'mt{f}{side}'].R, T[f'mt{f}{side}'].s
                for k, s in enumerate(seq):
                    key = f'{s} phalanx of {tn}'
                    a, b = L['tp'][key]
                    k0 = min(k, len(js) - 2)
                    if k < len(seq) - 1:
                        t = seg_sim(a, b, js[k0], js[k0 + 1], Rprev)
                    else:   # última falange: direção até a ponta, escala anterior
                        R = rot_between(Rprev @ (b - a), js[-1] - js[k0]) @ Rprev
                        t = Sim(R, sprev, a, js[k0])
                    T[f'tp{f}{k}{side}'] = t
                    bt[(key, side)] = f'tp{f}{k}{side}'
                    Rprev, sprev = t.R, t.s

        # ── tronco ──
        Ls, Le = self.L['D'], self.L['E']
        eye_bp = self.eye_y
        skull_top = max(self.P('parietal bone', 'D')[:, 1].max(), self.P('parietal bone', 'E')[:, 1].max())
        top_bp = self.skin_bp[:, 1].max()
        mh_top = Vb[:, 1].max()
        y_bp = [(Ls['hip'][1] + Le['hip'][1]) / 2, (Ls['shoulder'][1] + Le['shoulder'][1]) / 2]
        y_mh = [(J['r-upper-leg'][1] + J['l-upper-leg'][1]) / 2, (J['r-shoulder'][1] + J['l-shoulder'][1]) / 2]
        if eye_bp is not None:
            y_bp.append(eye_bp)
            y_mh.append((J['r-eye'][1] + J['l-eye'][1]) / 2)
        y_bp.append(top_bp)
        y_mh.append(mh_top)
        y_bp, y_mh = np.array(y_bp), np.array(y_mh)
        k_lo = (y_mh[1] - y_mh[0]) / (y_bp[1] - y_bp[0])

        def ymap(y):
            out = np.interp(y, y_bp, y_mh)
            lo = y < y_bp[0]
            out[lo] = y_mh[0] + (y[lo] - y_bp[0]) * k_lo
            return out
        self.ymap = ymap

        # quem é tronco na pele de cada corpo
        bone_pts, bone_lab = self.bone_samples()
        torso_ids = {i for i, n in enumerate(self.tf_names) if n == 'torso'}
        d, ii = cKDTree(bone_pts).query(self.skin_bp, k=1)
        torso_bp = np.isin(bone_lab[ii], list(torso_ids))
        torso_mh = self.mh_torso_mask()
        y0 = min(self.skin_bp[:, 1].min(), 0) + 0.6 * (y_bp[0])
        ys_bp, pb = self.torso_profiles(self.skin_bp, torso_bp, y_bp[0] - 0.18, top_bp)
        ys_mh, pm = self.torso_profiles(Vb, torso_mh, y_mh[0] - 0.18 * k_lo, mh_top)
        self.log(f'tronco: altura {y_bp.round(3)} → {y_mh.round(3)}')

        # Ancorado nas costas: z' = costas' + (z − costas)·(profundidade'/profundidade).
        # Uma escala só por altura (frente e costas juntas) mantém a coluna e os órgãos
        # sem cisalhamento; as razões variam devagar com a altura (sem curvas em "S").
        I = lambda ys, p, k: (lambda y: np.interp(y, ys, p[:, k]))
        zbB, zbM = I(ys_bp, pb, 1), I(ys_mh, pm, 1)
        yy = np.arange(y_bp[0] - 0.18, top_bp, 0.01)
        rd_t = np.clip((I(ys_mh, pm, 0)(ymap(yy)) - zbM(ymap(yy))) / np.maximum(I(ys_bp, pb, 0)(yy) - zbB(yy), 1e-3), 0.75, 1.3)
        rx_t = np.clip(I(ys_mh, pm, 2)(ymap(yy)) / np.maximum(I(ys_bp, pb, 2)(yy), 1e-3), 0.75, 1.3)
        ker = np.exp(-0.5 * (np.arange(-12, 13) / 4.0) ** 2)
        ker /= ker.sum()
        rd_t = np.convolve(np.pad(rd_t, 12, mode='edge'), ker, mode='valid')
        rx_t = np.convolve(np.pad(rx_t, 12, mode='edge'), ker, mode='valid')

        def torso(V):
            y2 = ymap(V[:, 1])
            rd, rx = np.interp(V[:, 1], yy, rd_t), np.interp(V[:, 1], yy, rx_t)
            z2 = zbM(y2) + (V[:, 2] - zbB(V[:, 1])) * rd
            return np.stack([V[:, 0] * rx, y2, z2], 1)
        self.tf['torso'] = torso

        # espessura dos membros: razão entre as peles em volta do eixo
        self.radial = {}
        for side, pre, sx in SIDES:
            for sid in ('th', 'lg', 'ua', 'fas'):
                self.radial[sid + side] = self.radial_ratio(sid + side, bone_pts, bone_lab, torso_mh)

    # amostras dos ossos (para pesos e classificação da pele)
    def bone_samples(self):
        if hasattr(self, '_bs'):
            return self._bs
        names = ['torso'] + sorted(set(self.bone_tf.values()))
        idx = {n: i for i, n in enumerate(names)}
        pts, lab = [], []
        for p in self.parts:
            if p['layer'] != 'bones' or p['kind'] in ('tooth', 'gum'):
                continue
            tid = self.bone_tf.get((p['base'], p['side']), 'torso')
            pts.append(p['V'])
            lab.append(np.full(len(p['V']), idx[tid]))
        self.tf_names = names
        self._bs = (np.concatenate(pts), np.concatenate(lab))
        return self._bs

    def mh_torso_mask(self):
        """Pele do corpo de destino que pertence ao tronco/cabeça (não aos membros)."""
        J, V = self.J, self.Vb
        k = (J['head-2'][1]) / 1.78

        def segd(A, B):
            ab = B - A
            t = np.clip(((V - A) @ ab) / (ab @ ab), 0, 1)
            return np.linalg.norm(V - (A + t[:, None] * ab), axis=1)
        dl = np.full(len(V), np.inf)
        for _, pre, _ in SIDES:
            for a, b, r in (('shoulder', 'elbow', 0.05), ('elbow', 'hand', 0.04), ('hand', 'finger-3-4', 0.04),
                            ('upper-leg', 'knee', 0.085), ('knee', 'ankle', 0.055), ('ankle', 'toe-3-4', 0.05)):
                dl = np.minimum(dl, segd(J[pre + a], J[pre + b]) / (r * k))
        chain = ['pelvis', 'spine-4', 'spine-3', 'spine-2', 'spine-1', 'neck', 'head', 'head-2']
        dt = np.full(len(V), np.inf)
        for a, b in zip(chain[:-1], chain[1:]):
            A, B = J[a].copy(), J[b].copy()
            A[2] += 0.06 * k
            B[2] += 0.06 * k
            dt = np.minimum(dt, segd(A, B) / (0.14 * k))
        # abaixo do quadril é perna
        legs = V[:, 1] < (J['r-upper-leg'][1] - 0.03 * k)
        return (dt < dl) & ~legs

    def radial_ratio(self, sid, bone_pts, bone_lab, torso_mh):
        A, B = self.seg[sid]
        f = self.tf[sid]
        # pele do BodyParts3D que pertence a esse segmento (osso mais próximo)
        base_sid = {'fas': 'fa'}.get(sid[:-1], sid[:-1]) + sid[-1]
        lab = self.tf_names.index(base_sid) if base_sid in self.tf_names else None
        d, ii = cKDTree(bone_pts).query(self.skin_bp, k=1)
        own = bone_lab[ii] == lab
        if sid.startswith('fas'):
            own |= bone_lab[ii] == self.tf_names.index('rad' + sid[-1])
        Sb = f(self.skin_bp[own])
        ax = unit(B - A)
        L = np.linalg.norm(B - A)
        ref = np.array([0, 0, 1.0])
        ref = unit(ref - ax * (ref @ ax))
        ref2 = np.cross(ax, ref)

        def polar(P):
            w = P - A
            t = (w @ ax) / L
            r = w - np.outer(w @ ax, ax)
            return t, np.arctan2(r @ ref2, r @ ref), np.linalg.norm(r, axis=1)
        nt, na = 10, 12
        def grid(P):
            t, a, r = polar(P)
            g = np.full((nt, na), np.nan)
            m = (t > 0) & (t < 1)
            ti = np.minimum((t[m] * nt).astype(int), nt - 1)
            ai = ((a[m] + np.pi) / (2 * np.pi) * na).astype(int) % na
            for i in range(nt):
                for j in range(na):
                    s = r[m][(ti == i) & (ai == j)]
                    if len(s) >= 3:
                        g[i, j] = np.percentile(s, 90)
            return g
        # pele do destino do segmento: perto da linha A→B e fora do tronco
        Vm = self.Vb[~torso_mh]
        t, _, r = polar(Vm)
        Vm = Vm[(t > -0.05) & (t < 1.05) & (r < 0.16)]
        gb, gm = grid(Sb), grid(Vm)
        ratio = np.clip(gm / gb, 0.7, 1.3)
        ratio[np.isnan(ratio)] = 1.0
        # suaviza (circular em ângulo)
        for _ in range(2):
            ratio = (np.roll(ratio, 1, 1) + 2 * ratio + np.roll(ratio, -1, 1)) / 4
            ratio[1:-1] = (ratio[:-2] + 2 * ratio[1:-1] + ratio[2:]) / 4
        self.log(f'{sid}: espessura ×{np.nanmean(ratio):.2f} (min {ratio.min():.2f}, máx {ratio.max():.2f})')
        return dict(A=A, ax=ax, L=L, ref=ref, ref2=ref2, g=ratio)

    def apply_radial(self, sid, X, w):
        R = self.radial[sid]
        wv = X - R['A']
        tt = (wv @ R['ax']) / R['L']
        rv = wv - np.outer(wv @ R['ax'], R['ax'])
        ang = np.arctan2(rv @ R['ref2'], rv @ R['ref'])
        g = R['g']
        nt, na = g.shape
        ti = np.clip(tt * nt - 0.5, 0, nt - 1)
        ai = ((ang + np.pi) / (2 * np.pi) * na - 0.5) % na
        t0 = np.floor(ti).astype(int)
        t1 = np.minimum(t0 + 1, nt - 1)
        a0 = np.floor(ai).astype(int) % na
        a1 = (a0 + 1) % na
        ft, fa = ti - t0, ai - np.floor(ai)
        v = (g[t0, a0] * (1 - ft) * (1 - fa) + g[t1, a0] * ft * (1 - fa) + g[t0, a1] * (1 - ft) * fa + g[t1, a1] * ft * fa)
        # fora do trecho (perto das juntas) a correção some aos poucos
        fade = np.clip(np.minimum(tt + 0.1, 1.1 - tt) / 0.15, 0, 1)
        k = 1 + (v - 1) * fade * w
        return X + rv * (k - 1)[:, None]

    def arm_split(self, V, W, dmin):
        """Perto do ombro os pesos pelo osso mais próximo falham: no BodyParts3D o
        braço está caído junto ao tórax e no corpo de destino está aberto. Quem
        está dentro do "cilindro" do braço (ombro → cotovelo → punho) segue só os
        ossos do braço; o resto segue só o tronco; a passagem é suave na altura
        da cabeça do úmero."""
        names = self.tf_names
        leg = np.array([n[:2] in ('th', 'lg', 'ft', 'mt', 'tp') for n in names])
        best = np.argmin(dmin, 1)
        for side, _, _ in SIDES:
            L = self.L[side]
            arm = np.array([n.endswith(side) and n[:2] in ('ua', 'fa', 'ra', 'ha', 'mc', 'ph') for n in names])
            S, E, Wr = L['shoulder'], L['elbow'], L['wrist']
            ax = E - S
            Lu = np.linalg.norm(ax)
            t = ((V - S) @ ax) / (Lu * Lu)

            def segd(A, B):
                ab = B - A
                tt = np.clip(((V - A) @ ab) / (ab @ ab), 0, 1)
                return np.linalg.norm(V - (A + tt[:, None] * ab), axis=1)
            d = np.minimum(segd(S - ax * 0.15, E), segd(E, Wr))
            d = np.minimum(d, segd(Wr, np.mean([L['mc'][i][1] for i in (2, 3, 4, 5)], 0)))
            r_in, r_out = 0.048, 0.066
            wa = np.clip((t + 0.04) / 0.16, 0, 1) * np.clip((r_out - d) / (r_out - r_in), 0, 1)
            wa = wa * wa * (3 - 2 * wa)
            wa[leg[best]] = 0
            m = wa > 0
            if not m.any():
                continue
            Wa = W[m] * arm
            sa = Wa.sum(1, keepdims=True)
            ua = names.index('ua' + side)
            Wa = np.where(sa > 1e-6, Wa / np.maximum(sa, 1e-9), np.eye(len(names))[ua])
            Wt = W[m] * ~arm
            st = Wt.sum(1, keepdims=True)
            Wt = np.where(st > 1e-6, Wt / np.maximum(st, 1e-9), np.eye(len(names))[0])
            W[m] = wa[m, None] * Wa + (1 - wa[m, None]) * Wt
            # fora do cilindro, nada segue o braço
            far = ~m & (W[:, arm].sum(1) > 0) & (t < 0.6)
            if far.any():
                Wt = W[far] * ~arm
                st = Wt.sum(1, keepdims=True)
                W[far] = np.where(st > 1e-6, Wt / np.maximum(st, 1e-9), W[far])
            # do antebraço para baixo, quem está mais perto de um osso do braço segue só o
            # braço (no BodyParts3D a mão fica ao lado da coxa: a coxa não pode puxar os dedos)
            own = arm[best] & (t > 0.5)
            if own.any():
                Wa = W[own] * arm
                W[own] = Wa / np.maximum(Wa.sum(1, keepdims=True), 1e-9)
            # e quem está mais perto da perna nunca segue o braço
            lg = leg[best] & (W[:, arm].sum(1) > 0)
            if lg.any():
                Wl = W[lg] * ~arm
                W[lg] = Wl / np.maximum(Wl.sum(1, keepdims=True), 1e-9)
        return W

    # ── aplica ────────────────────────────────────────────────────────────────
    def map_part(self, p):
        V = p['V']
        key = (p['base'], p['side'])
        if p['layer'] == 'organs':
            return self.tf['torso'](V)
        if p['layer'] == 'bones' and p['kind'] not in ('disc',):
            return self.tf[self.bone_tf.get(key, 'torso')](V)
        # tecidos moles: pesos pelos ossos mais próximos
        bone_pts, bone_lab = self.bone_samples()
        if not hasattr(self, '_kd'):
            self._kd = cKDTree(bone_pts)
        K = 24
        d, ii = self._kd.query(V, k=K, distance_upper_bound=0.08)
        names = self.tf_names
        ntf = len(names)
        dmin = np.full((len(V), ntf), np.inf)
        valid = np.isfinite(d)
        rows = np.repeat(np.arange(len(V))[:, None], K, 1)[valid]
        labs = bone_lab[np.minimum(ii, len(bone_lab) - 1)][valid]
        np.minimum.at(dmin, (rows, labs), d[valid])
        tau = 0.012
        best = dmin.min(1, keepdims=True)
        W = np.where(np.isfinite(dmin), np.exp(-(dmin - best) / tau), 0)
        W[~np.isfinite(best[:, 0])] = 0
        W[~np.isfinite(best[:, 0]), 0] = 1     # longe de tudo → tronco
        W /= W.sum(1, keepdims=True)
        W = self.arm_split(V, W, dmin)
        # mãos e pés (dedos finos, lado a lado): marcados para só correções pequenas na pele
        ext = np.array([n[:2] in ('ha', 'mc', 'ph', 'ft', 'mt', 'tp') for n in names])
        self.last_ext = W[:, ext].sum(1) > 0.5
        out = np.zeros_like(V)
        used = np.where(W.max(0) > 1e-4)[0]
        for j in used:
            tid = names[j]
            tid = self.soft_tf.get(tid, tid)
            out += W[:, j:j + 1] * self.tf[tid](V)
        for j in used:
            sid = self.soft_tf.get(names[j], names[j])
            if sid in self.radial:
                out = self.apply_radial(sid, out, W[:, j])
        return out

    def keep_inside(self, X, margin, max_jump=0.04):
        if not hasattr(self, '_skin_kd'):
            # pele densa: amostras dos triângulos + normais
            V, F = self.Vb, self.Fb
            n = vnormals(V, F)
            rng = np.random.default_rng(1)
            a = rng.random((len(F) * 12, 2))
            m = a.sum(1) > 1
            a[m] = 1 - a[m]
            fi = np.repeat(np.arange(len(F)), 12)
            P = V[F[fi, 0]] * (1 - a.sum(1))[:, None] + V[F[fi, 1]] * a[:, :1] + V[F[fi, 2]] * a[:, 1:]
            N = n[F[fi, 0]] * (1 - a.sum(1))[:, None] + n[F[fi, 1]] * a[:, :1] + n[F[fi, 2]] * a[:, 1:]
            self._skin_pts = np.r_[V, P]
            self._skin_n = np.r_[n, N / np.linalg.norm(N, axis=1, keepdims=True)]
            self._skin_kd = cKDTree(self._skin_pts)
        d, i = self._skin_kd.query(X, k=1)
        p, n = self._skin_pts[i], self._skin_n[i]
        s = ((X - p) * n).sum(1)
        bad = (s > -margin) & (s < max_jump) & (d < np.maximum(max_jump, 0.015))
        X = X.copy()
        X[bad] -= n[bad] * (s[bad] + margin)[:, None]
        return X, bad.sum()


# ─── Oclusão ambiente ────────────────────────────────────────────────────────

def bake_ao(parts, occluders, R=0.014):
    """Oclusão por vizinhança: pontos de outras superfícies no hemisfério da normal."""
    occ = np.concatenate([o['X'] for o in occluders])
    kd = cKDTree(occ)
    for p in parts:
        X = p['X']
        n = vnormals(X, p['F'])
        d, ii = kd.query(X + n * 0.0015, k=40, distance_upper_bound=R)
        ok = np.isfinite(d) & (d > 0.002)
        ii = np.minimum(ii, len(occ) - 1)
        dirs = occ[ii] - X[:, None, :]
        dl = np.linalg.norm(dirs, axis=2)
        cosv = (dirs * n[:, None, :]).sum(2) / np.maximum(dl, 1e-9)
        w = np.where(ok, np.clip(cosv, 0, 1) * (1 - np.clip(dl / R, 0, 1)), 0)
        o = np.clip(w.sum(1) / 9.0, 0, 1)
        # suaviza na malha
        F = p['F']
        for _ in range(2):
            acc = np.zeros(len(X))
            cnt = np.zeros(len(X))
            for k in range(3):
                np.add.at(acc, F[:, k], o[F[:, (k + 1) % 3]] + o[F[:, (k + 2) % 3]])
                np.add.at(cnt, F[:, k], 2)
            o = 0.5 * o + 0.5 * acc / np.maximum(cnt, 1)
        p['ao'] = np.round((1 - 0.85 * o) * 255).astype(np.uint8)


# Músculos finos de verdade (lâminas): não viram tendão por serem finos
SHEETS = {'platysma', 'external intercostal muscle', 'transversus abdominis', 'transversus thoracis',
          'internal oblique', 'diaphragm', 'buccinator', 'orbicularis oris', 'orbital part of orbicularis oculi',
          'palpebral part of orbicularis oculi', 'temporoparietalis', 'occipitalis', 'frontalis', 'risorius',
          'rectus abdominis', 'pyramidalis', 'serratus posterior inferior', 'serratus posterior superior',
          'rhomboid minor', 'rhomboid major', 'set of levatores costarum breves', 'set of levatores costarum longi'}
TENDON_ALWAYS = {'calcaneal tendon', 'intermediate tendon', 'iliotibial tract', 'aponeurosis of epicranius', 'linea alba',
                 'flexor retinaculum of wrist', 'inguinal ligament', 'long plantar ligament',
                 'interosseous membrane of forearm', 'interosseous membrane of leg', 'tendinous arch of levator ani'}


def bake_tendon(p, thin=0.0016, thick=0.0034):
    """0 = ventre muscular … 1 = tendão: espessura local (distância até a face oposta),
    medida na malha original (o encaixe pode achatar o músculo junto à pele)."""
    X, F = p['V'], p['F']
    if p['base'] in TENDON_ALWAYS:
        return np.full(len(X), 255, np.uint8)
    if p['base'] in SHEETS:
        return np.zeros(len(X), np.uint8)
    n = vnormals(X, F)
    kd = cKDTree(X)
    d, ii = kd.query(X, k=min(48, len(X)), distance_upper_bound=0.02)
    ok = np.isfinite(d)
    ii = np.minimum(ii, len(X) - 1)
    opp = (n[ii] * n[:, None, :]).sum(2) < -0.3
    dd = np.where(ok & opp, d, np.inf).min(1)
    dd[~np.isfinite(dd)] = thick * 2
    t = np.clip((thick - dd) / (thick - thin), 0, 1)
    # suaviza na malha
    for _ in range(3):
        acc = np.zeros(len(X))
        cnt = np.zeros(len(X))
        for k in range(3):
            np.add.at(acc, F[:, k], t[F[:, (k + 1) % 3]] + t[F[:, (k + 2) % 3]])
            np.add.at(cnt, F[:, k], 2)
        t = 0.5 * t + 0.5 * acc / np.maximum(cnt, 1)
    return np.round(t * 255).astype(np.uint8)


# ─── Saída ───────────────────────────────────────────────────────────────────

def write_layer(path, parts, layer, body):
    head = {'v': 1, 'body': body, 'layer': layer,
            'credit': 'BodyParts3D, © The Database Center for Life Science, CC BY-SA 2.1 JP', 'parts': []}
    blobs = []
    off = 0
    for p in parts:
        X, F = p['X'].astype(np.float64), p['F']
        lo, hi = X.min(0), X.max(0)
        q = np.round((X - lo) / np.maximum(hi - lo, 1e-9) * 65535).astype('<u2')
        big = len(X) > 65535
        idx = F.astype('<u4' if big else '<u2').ravel()
        chunk = [q.tobytes(), p['ao'].tobytes()]
        if 'tn' in p:
            chunk.append(p['tn'].tobytes())
        pad = (-sum(len(c) for c in chunk)) % 4
        chunk.append(b'\0' * pad)
        chunk.append(idx.tobytes())
        c = X.mean(0)
        entry = {
            'id': p['fid'], 'en': p['en'], 'base': p['base'], 'label': p['label'], 'name': p['name'],
            'kind': p['kind'], 'side': p['side'], 'nv': len(X), 'nt': len(F), 'i32': big, 'tn': 'tn' in p,
            'lo': np.round(lo, 5).tolist(), 'hi': np.round(hi, 5).tolist(), 'off': off,
            'c': np.round(c, 4).tolist(), 'r': round(float(np.linalg.norm(X - c, axis=1).max()), 4)}
        if p.get('key'):
            entry['key'] = p['key']
        if p.get('meridian'):
            entry['mer'] = p['meridian']
        if p['layer'] == 'muscles':
            entry['ax'] = np.round(pca_axis(X), 3).tolist()
        head['parts'].append(entry)
        blobs.append(b''.join(chunk))
        off += len(blobs[-1])
    hj = json.dumps(head, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    hj += b' ' * ((-len(hj)) % 4)
    data = struct.pack('<I', len(hj)) + hj + b''.join(blobs)
    with gzip.open(path, 'wb', compresslevel=9) as f:
        f.write(data)
    return os.path.getsize(path)


def build(src, body):
    print(f'== {body}')
    parts, skin = load_source(src)
    fit = Fit(parts, skin, read_body(body))
    eye = os.path.join(src, 'stl', EYE_ID + '.stl')
    fit.eye_y = read_stl(eye)[0][:, 1].mean() if os.path.exists(eye) else None
    fit.build()
    by_layer = {}
    for p in parts:
        fit.last_ext = None
        X = fit.map_part(p)
        p = dict(p, X=X, ext=fit.last_ext)
        by_layer.setdefault(p['layer'], []).append(p)
    for layer, ps in by_layer.items():
        moved = 0
        for p in ps:
            # nas mãos e nos pés só correções pequenas (um salto grande levaria o tendão
            # de um dedo para o dedo vizinho); no resto, até 5 cm — o que a pose do
            # BodyParts3D deixou para fora (axila, cintura) volta para dentro da pele
            jump = np.full(len(p['X']), 0.05)
            if p.get('ext') is not None:
                jump[p['ext']] = 0.012
            p['X'], n = fit.keep_inside(p['X'], MARGIN[layer], jump)
            moved += n
        fit.log(f'{layer}: {moved} vértices puxados para dentro da pele')
    bake_ao(by_layer['bones'], by_layer['bones'])
    bake_ao(by_layer['muscles'], by_layer['muscles'] + by_layer['bones'])
    bake_ao(by_layer['organs'], by_layer['organs'])
    for p in by_layer['muscles']:
        p['tn'] = bake_tendon(p)
    for layer, ps in by_layer.items():
        ps.sort(key=lambda p: (p['base'], p['side'] or ''))
        size = write_layer(os.path.join(MODELS, f'anatomy-{body}-{layer}.bin'), ps, layer, body)
        print(f'  {layer}: {len(ps)} peças, {sum(len(p["F"]) for p in ps):,} triângulos, {size / 1e6:.2f} MB')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    src = sys.argv[1]
    download(src)
    for b in (sys.argv[2:] or BODIES):
        build(src, b)
