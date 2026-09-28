"""
Gera a visão de músculos ("écorché") dos corpos realistas da Anatomia 3D.

    python tools/muscles/build_muscles.py            # os dois corpos
    python tools/muscles/build_muscles.py female     # só um

Requer Python 3 com numpy e pillow. Saída em public/models/:
    muscles-<corpo>.jpg        cor: músculos com fibras, sulcos, tendões e fáscias
    muscles-<corpo>-bump.jpg   relevo (barriga dos músculos, sulcos e fibras)
    muscles-<corpo>-id.png     id de cada músculo por texel (ver public/js/muscle-data.js)
    muscles-<corpo>.json       centro, normal média e tamanho de cada id (câmera)

Como funciona
    Cada músculo é descrito por "traços" (linhas de origem → inserção) em
    coordenadas do corpo: segmento (tronco, braço, coxa…), posição ao longo dele
    (t) e ângulo em volta dele (θ: 0 = frente, 90 = lateral, 180 = trás; no
    antebraço e na mão 0 = palma e 90 = lado do polegar). Os traços são levados
    para logo abaixo da pele deste corpo; cada ponto da pele pertence ao traço
    mais próximo (descontada a largura dele). A fronteira entre músculos vira
    sulco; o fim dos traços vira tendão; onde não há músculo fica a cor de
    tendão/fáscia (mãos, pés, joelhos, crânio).
"""
import json
import os
import re
import struct
import sys

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MODELS = os.path.join(ROOT, 'public', 'models')
N = 2048          # resolução da cor e do mapa de ids
DEPTH = 0.012     # profundidade dos traços sob a pele (m)
T_BG = 0.022      # além disso (d - r) o ponto não pertence a músculo nenhum

# ─── Catálogo (ordem = ids) ──────────────────────────────────────────────────
with open(os.path.join(ROOT, 'public', 'js', 'muscle-data.js'), encoding='utf-8') as f:
    KEYS = re.findall(r"\{ key: '([A-Za-z]+)'", f.read())
WHITE = {'fasciaToracolombar', 'tratoIliotibial', 'aquiles'}


def mid(key, side):
    return 1 + 2 * KEYS.index(key) + (1 if side > 0 else 0)


# ─── Traços dos músculos (lado esquerdo; o direito é espelhado pelo referencial)
# (chave, [(segmento, t, θ), ...], largura/2 em m, (início, fim) da barriga ao longo do traço)
S = []


# reach: quanto o músculo avança além da largura até encostar no vizinho
# (menor na cabeça e nas mãos, onde o resto é crânio/tendão)
def st(key, pts, r, belly=(0.0, 1.0), reach=T_BG):
    S.append((key, pts, r, belly, reach))


# Cabeça (t: 0 = altura da boca, 1 = topo) e pescoço (0 = base, 1 = cabeça)
st('frontal', [('head', 0.46, 18), ('head', 0.84, 14)], 0.026, (0, 0.85), reach=0.012)
st('temporal', [('head', 0.3, 80), ('head', 0.62, 95)], 0.022, (0.1, 0.95), reach=0.01)
st('temporal', [('head', 0.35, 105), ('head', 0.55, 120)], 0.016, reach=0.01)
st('masseter', [('head', -0.34, 60), ('head', 0.02, 66)], 0.016, reach=0.012)
st('musculosFace', [('head', -0.2, 8), ('head', -0.05, 22)], 0.01, reach=0.012)
st('musculosFace', [('head', 0.05, 42), ('head', -0.12, 24)], 0.012, reach=0.012)
st('musculosFace', [('head', 0.18, 22), ('head', 0.32, 40)], 0.011, reach=0.012)
st('musculosFace', [('head', -0.42, 8), ('head', -0.28, 14)], 0.01, reach=0.012)
st('esternocleidomastoideo', [('head', -0.08, 108), ('neck', 0.4, 62), ('neck', -0.55, 14)], 0.011, (0.08, 0.92))
st('pescocoAnterior', [('neck', -0.45, 5), ('neck', 0.6, 6)], 0.01)
# Trapézio: descendente (nuca → ombro), transverso e ascendente
st('trapezio', [('head', -0.12, 165), ('neck', 0.3, 150), ('neck', -0.4, 120), ('arm', -0.12, 110)], 0.022, (0.08, 1))
st('trapezio', [('torso', 0.93, 176), ('torso', 0.86, 150), ('arm', -0.1, 150)], 0.03)
st('trapezio', [('neck', 0.2, 100), ('neck', -0.45, 90), ('arm', -0.14, 60)], 0.018)
st('trapezio', [('torso', 0.76, 176), ('torso', 0.79, 142)], 0.03)
st('trapezio', [('torso', 0.42, 176), ('torso', 0.6, 160), ('torso', 0.76, 142)], 0.028)
# Tronco — frente
I_PEC = ('arm', 0.15, -15)
st('peitoralMaior', [('torso', 0.88, 10), ('torso', 0.86, 35), I_PEC], 0.022, (0, 0.94))
st('peitoralMaior', [('torso', 0.78, 7), ('torso', 0.75, 35), I_PEC], 0.026, (0, 0.94))
st('peitoralMaior', [('torso', 0.66, 8), ('torso', 0.66, 35), I_PEC], 0.026, (0, 0.94))
st('peitoralMaior', [('torso', 0.56, 12), ('torso', 0.6, 40), I_PEC], 0.022, (0, 0.94))
st('serratilAnterior', [('torso', 0.55, 62), ('torso', 0.6, 84)], 0.012)
st('serratilAnterior', [('torso', 0.47, 60), ('torso', 0.54, 86)], 0.012)
st('serratilAnterior', [('torso', 0.62, 66), ('torso', 0.67, 86)], 0.011)
st('retoAbdominal', [('torso', -0.06, 9), ('torso', 0.3, 11), ('torso', 0.55, 13)], 0.024)
st('obliquoExterno', [('torso', 0.58, 58), ('torso', 0.35, 42), ('torso', 0.12, 33)], 0.028, (0, 0.8))
st('obliquoExterno', [('torso', 0.52, 88), ('torso', 0.3, 76), ('torso', 0.1, 70)], 0.028, (0, 0.9))
st('obliquoExterno', [('torso', 0.2, 48), ('torso', 0.0, 28)], 0.022, (0, 0.8))
# Tronco — costas
I_LAT = ('arm', 0.1, -140)
st('grandeDorsal', [('torso', 0.1, 150), ('torso', 0.35, 125), ('torso', 0.6, 108), I_LAT], 0.03, (0.12, 0.9))
st('grandeDorsal', [('torso', 0.4, 165), ('torso', 0.55, 140), ('torso', 0.66, 118), I_LAT], 0.03, (0.1, 0.9))
st('eretores', [('torso', 0.1, 166), ('torso', 0.45, 168), ('torso', 0.62, 170)], 0.016)
st('fasciaToracolombar', [('torso', -0.05, 172), ('torso', 0.3, 172)], 0.03)
st('fasciaToracolombar', [('torso', 0.05, 150), ('torso', 0.2, 145)], 0.02)
st('infraespinal', [('torso', 0.72, 140), ('arm', -0.02, 175)], 0.024, (0, 0.95))
st('redondoMaior', [('torso', 0.56, 128), ('arm', 0.12, -165)], 0.016, (0, 0.95))
# Ombro e braço
I_DEL = ('arm', 0.46, 85)
st('deltoide', [('arm', -0.05, 15), ('arm', 0.2, 45), I_DEL], 0.025, (0, 0.97))
st('deltoide', [('arm', -0.1, 90), ('arm', 0.2, 90), I_DEL], 0.026, (0, 0.97))
st('deltoide', [('arm', -0.05, 165), ('arm', 0.2, 130), I_DEL], 0.025, (0, 0.97))
st('biceps', [('arm', 0.18, 5), ('arm', 0.55, 0), ('arm', 0.9, 8)], 0.02, (0.06, 0.84))
st('braquial', [('arm', 0.55, 70), ('arm', 0.9, 45)], 0.011)
st('triceps', [('arm', 0.08, 175), ('arm', 0.5, 178), ('arm', 0.95, 175)], 0.026, (0, 0.8))
st('triceps', [('arm', 0.05, -150), ('arm', 0.5, -165)], 0.018)
st('triceps', [('arm', 0.2, 130), ('arm', 0.55, 140)], 0.016)
# Antebraço (0 = palma, 90 = lado do polegar) e mão
st('braquiorradial', [('arm', 0.72, 75), ('forearm', 0.12, 85), ('forearm', 0.5, 92), ('forearm', 0.92, 95)], 0.015, (0, 0.62))
st('flexoresAntebraco', [('forearm', 0.05, -65), ('forearm', 0.45, -30), ('forearm', 0.92, -5)], 0.015, (0, 0.72))
st('flexoresAntebraco', [('forearm', 0.05, -85), ('forearm', 0.45, -70), ('forearm', 0.92, -55)], 0.014, (0, 0.72))
st('flexoresAntebraco', [('forearm', 0.1, -40), ('forearm', 0.45, 20), ('forearm', 0.92, 40)], 0.013, (0, 0.72))
st('extensoresAntebraco', [('forearm', 0.05, 125), ('forearm', 0.45, 140), ('forearm', 0.92, 150)], 0.014, (0, 0.72))
st('extensoresAntebraco', [('forearm', 0.05, 150), ('forearm', 0.45, 168), ('forearm', 0.92, 180)], 0.014, (0, 0.72))
st('extensoresAntebraco', [('forearm', 0.1, -170), ('forearm', 0.5, -150), ('forearm', 0.92, -130)], 0.013, (0, 0.72))
st('extensoresAntebraco', [('forearm', 0.5, 150), ('forearm', 0.85, 110)], 0.008, (0, 0.7))
st('tenar', [('hand', 0.1, 55), ('hand', 0.45, 75)], 0.011, reach=0.007)
st('hipotenar', [('hand', 0.12, -60), ('hand', 0.6, -80)], 0.009, reach=0.007)
# Quadril e coxa
st('gluteoMedio', [('torso', 0.12, 118), ('thigh', -0.1, 100)], 0.03)
st('gluteoMaximo', [('torso', 0.02, 168), ('thigh', -0.02, 170), ('thigh', 0.16, 140)], 0.04, (0, 0.88))
st('gluteoMaximo', [('torso', 0.1, 140), ('thigh', -0.1, 140), ('thigh', 0.18, 115)], 0.035, (0, 0.85))
st('tensorFascia', [('thigh', -0.12, 55), ('thigh', 0.12, 75)], 0.018, (0, 0.8))
st('tratoIliotibial', [('thigh', 0.1, 92), ('thigh', 0.55, 92), ('thigh', 0.98, 98)], 0.012)
st('sartorio', [('thigh', -0.12, 40), ('thigh', 0.15, 10), ('thigh', 0.45, -45), ('thigh', 0.75, -95), ('thigh', 1.0, -115)], 0.009)
st('retoFemoral', [('thigh', 0.05, 15), ('thigh', 0.45, 5), ('thigh', 0.88, 0)], 0.022, (0.04, 0.8))
st('vastoLateral', [('thigh', 0.18, 62), ('thigh', 0.55, 55), ('thigh', 0.9, 35)], 0.026, (0, 0.9))
st('vastoMedial', [('thigh', 0.5, -38), ('thigh', 0.86, -35)], 0.022)
st('adutores', [('thigh', 0.0, -75), ('thigh', 0.3, -78), ('thigh', 0.55, -90)], 0.028)
st('adutores', [('thigh', 0.05, -110), ('thigh', 0.5, -118), ('thigh', 0.9, -125)], 0.011)
st('bicepsFemoral', [('thigh', 0.18, 150), ('thigh', 0.55, 140), ('thigh', 0.92, 125)], 0.022, (0, 0.85))
st('semitendineo', [('thigh', 0.18, -162), ('thigh', 0.55, -158), ('thigh', 0.92, -142)], 0.022, (0, 0.85))
# Perna
st('gastroMedial', [('leg', 0.03, -150), ('leg', 0.28, -158), ('leg', 0.52, -172)], 0.028)
st('gastroLateral', [('leg', 0.03, 150), ('leg', 0.26, 158), ('leg', 0.47, 170)], 0.024)
st('soleo', [('leg', 0.4, -118), ('leg', 0.72, -135)], 0.016)
st('soleo', [('leg', 0.4, 118), ('leg', 0.72, 135)], 0.016)
st('aquiles', [('leg', 0.52, 180), ('leg', 0.98, 180)], 0.011)
st('tibialAnterior', [('leg', 0.08, 35), ('leg', 0.5, 28), ('leg', 0.95, 5)], 0.015, (0, 0.62))
st('extensoresPe', [('leg', 0.15, 62), ('leg', 0.55, 55), ('leg', 0.97, 25)], 0.009, (0, 0.6))
st('fibulares', [('leg', 0.08, 100), ('leg', 0.5, 108), ('leg', 0.9, 140)], 0.012, (0, 0.6))

# Linhas brancas por cima (linha alba, esterno, interseções do reto abdominal)
OVERLAY = [
    ([('torso', -0.08, 0.3), ('torso', 0.56, 0.3)], 0.0045),
    ([('torso', 0.5, 0.3), ('torso', 0.92, 0.3)], 0.009),
    ([('torso', 0.24, 1), ('torso', 0.25, 20)], 0.0022),
    ([('torso', 0.35, 1), ('torso', 0.36, 20)], 0.0022),
    ([('torso', 0.46, 1), ('torso', 0.47, 19)], 0.0022),
]


# ─── Malha ───────────────────────────────────────────────────────────────────
def load_body(sex):
    b = open(os.path.join(MODELS, f'body-{sex}.glb'), 'rb').read()
    L = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + L])
    binb = b[20 + L + 8:]

    def acc(i):
        a = j['accessors'][i]
        bv = j['bufferViews'][a['bufferView']]
        n = {'VEC3': 3, 'VEC2': 2, 'SCALAR': 1}[a['type']]
        dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16}[a['componentType']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        arr = np.frombuffer(binb, dtype=dt, count=a['count'] * n, offset=off)
        return arr.reshape(-1, n) if n > 1 else arr

    mesh = next(m for m in j['meshes'] if m['name'] == 'body')
    pr = mesh['primitives'][0]
    P = acc(pr['attributes']['POSITION']).astype(np.float64)
    Nn = acc(pr['attributes']['NORMAL']).astype(np.float64)
    U = acc(pr['attributes']['TEXCOORD_0']).astype(np.float64)
    I = acc(pr['indices']).astype(np.int64).reshape(-1, 3)
    return P, Nn, U, I


def ray_first(P, I, o, d):
    """Primeira interseção do raio o + t·d (t > 0) com a malha (Möller–Trumbore)."""
    a, b, c = P[I[:, 0]], P[I[:, 1]], P[I[:, 2]]
    e1, e2 = b - a, c - a
    pv = np.cross(d, e2)
    det = (e1 * pv).sum(1)
    ok = np.abs(det) > 1e-12
    inv = np.where(ok, 1 / np.where(ok, det, 1), 0)
    s = o - a
    u = (s * pv).sum(1) * inv
    q = np.cross(s, e1)
    v = (q * d).sum(1) * inv
    t = (e2 * q).sum(1) * inv
    hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 1e-5)
    return t[hit].min() if hit.any() else None


def norm(v):
    return v / (np.linalg.norm(v) + 1e-12)


# ─── Referenciais dos segmentos ──────────────────────────────────────────────
class Body:
    def __init__(self, sex):
        self.P, self.N, self.U, self.I = load_body(sex)
        self.J = {k: np.array(v, float) for k, v in json.load(open(os.path.join(MODELS, f'body-{sex}.joints.json'))).items()}
        self.k = (self.J['head-2'][1] + 0.03) / 1.78
        self.frames = {}

    def ray(self, o, d):
        return ray_first(self.P, self.I, o, d)

    # Centro da seção do corpo em p (raios nos quatro sentidos do plano)
    def centered(self, p, F, L, cap=None):
        f, b = self.ray(p, F) or 0.05, self.ray(p, -F) or 0.05
        l, m = self.ray(p, L) or 0.05, self.ray(p, -L) or 0.05
        if cap:
            l, m = min(l, cap), min(m, cap)
        return p + F * (f - b) / 2 + L * (l - m) / 2

    def frame(self, seg, side):
        key = (seg, side)
        if key in self.frames:
            return self.frames[key]
        J, pre = self.J, ('l-' if side > 0 else 'r-')
        X, Y, Z = np.array([1., 0, 0]), np.array([0., 1, 0]), np.array([0., 0, 1])
        if seg in ('torso', 'neck', 'head'):
            chain = {'torso': ['pelvis', 'spine-4', 'spine-3', 'spine-2', 'spine-1', 'neck'],
                     'neck': ['neck', 'head'], 'head': ['head', 'head-2']}[seg]
            pts = []
            for n in chain:
                p = J[n].copy()
                p[0] = 0
                f, b = self.ray(p + [1e-5, 0, 0], Z) or 0.05, self.ray(p + [1e-5, 0, 0], -Z) or 0.05
                p[2] += (f - b) / 2
                pts.append(p)
            pts = np.array(pts)
            if seg == 'head':      # topo da cabeça: o raio de dentro não serve
                pts[1] = np.array([0, J['head-2'][1], pts[0][2]])
            F, L = Z, X * side
            fr = ('chain', pts, F, L)
        else:
            A, B = {
                'arm': (pre + 'shoulder', pre + 'elbow'), 'forearm': (pre + 'elbow', pre + 'hand'),
                'hand': (pre + 'hand', pre + 'finger-3-1'), 'thigh': (pre + 'upper-leg', pre + 'knee'),
                'leg': (pre + 'knee', pre + 'ankle'), 'foot': (pre + 'ankle', pre + 'foot-2')}[seg]
            A, B = J[A], J[B]
            ax = norm(B - A)
            if seg in ('forearm', 'hand'):
                W = J[pre + 'hand']
                mcp = [J[f'{pre}finger-{i}-1'] for i in (2, 3, 4, 5)]
                Fd = norm(np.mean(mcp, 0) - W)
                R = mcp[0] - mcp[3]
                R = norm(R - Fd * R.dot(Fd))
                Np = norm(np.cross(R, Fd) if side < 0 else np.cross(Fd, R))
                F0, L0 = Np, R
            elif seg == 'foot':
                F0, L0 = Y, X * side
            else:
                F0, L0 = Z, X * side
            F = norm(F0 - ax * F0.dot(ax))
            L = L0 - ax * L0.dot(ax) - F * L0.dot(F)
            L = norm(L)
            if seg in ('arm', 'forearm', 'thigh', 'leg'):
                c1 = self.centered(A + (B - A) * 0.3, F, L, cap=0.09)
                c2 = self.centered(A + (B - A) * 0.7, F, L, cap=0.09)
                d = (c2 - c1) / 0.4
                A2 = c1 - d * 0.3
                fr = ('line', np.array([A2, A2 + d]), F, L)
            else:
                fr = ('line', np.array([A, B]), F, L)
        self.frames[key] = fr
        return fr

    def axis_point(self, fr, t):
        kind, pts = fr[0], fr[1]
        if kind == 'line':
            return pts[0] + (pts[1] - pts[0]) * t
        seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
        cum = np.concatenate([[0], np.cumsum(seg)]) / seg.sum()
        if t <= 0:
            return pts[0] + (pts[1] - pts[0]) * (t / cum[1])
        if t >= 1:
            return pts[-1] + (pts[-1] - pts[-2]) * ((t - 1) / (1 - cum[-2]))
        i = np.searchsorted(cum, t) - 1
        return pts[i] + (pts[i + 1] - pts[i]) * ((t - cum[i]) / (cum[i + 1] - cum[i]))

    # Ponto da pele em (segmento, t, θ) e a normal "para fora"
    def skin(self, seg, t, th, side):
        fr = self.frame(seg, side)
        F, L = fr[2], fr[3]
        C = self.axis_point(fr, t)
        a = np.radians(th)
        d = norm(np.cos(a) * F + np.sin(a) * L)
        if fr[0] == 'line':
            ax = norm(fr[1][1] - fr[1][0])
            d = norm(d - ax * d.dot(ax))
        h = self.ray(C, d)
        return C + d * (h if h is not None else 0.05 * self.k), d


# ─── Texels → posição 3D ─────────────────────────────────────────────────────
def rasterize(P, Nn, U, I, n):
    pos = np.zeros((n, n, 3), np.float32)
    nrm = np.zeros((n, n, 3), np.float32)
    filled = np.zeros((n, n), bool)
    uvp = U * n
    for tri in I:
        a, b, c = uvp[tri]
        x0, x1 = int(np.floor(min(a[0], b[0], c[0]))), int(np.ceil(max(a[0], b[0], c[0])))
        y0, y1 = int(np.floor(min(a[1], b[1], c[1]))), int(np.ceil(max(a[1], b[1], c[1])))
        x0, y0 = max(x0, 0), max(y0, 0)
        x1, y1 = min(x1, n - 1), min(y1, n - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        v0, v1 = b - a, c - a
        den = v0[0] * v1[1] - v1[0] * v0[1]
        if abs(den) < 1e-12:
            continue
        px, py = xs - a[0], ys - a[1]
        w1 = (px * v1[1] - v1[0] * py) / den
        w2 = (v0[0] * py - px * v0[1]) / den
        w0 = 1 - w1 - w2
        m = (w0 >= -1e-3) & (w1 >= -1e-3) & (w2 >= -1e-3)
        if not m.any():
            continue
        W = np.stack([w0[m], w1[m], w2[m]], 1)
        yy, xx = (ys[m] - 0.5).astype(int), (xs[m] - 0.5).astype(int)
        pos[yy, xx] = W @ P[tri]
        nrm[yy, xx] = W @ Nn[tri]
        filled[yy, xx] = True
    nrm /= np.linalg.norm(nrm, axis=2, keepdims=True) + 1e-9
    return pos, nrm, filled


# ─── Ruído (fibras) ──────────────────────────────────────────────────────────
def vnoise2(x, y):
    xi, yi = np.floor(x), np.floor(y)
    xf, yf = x - xi, y - yi
    xf, yf = xf * xf * (3 - 2 * xf), yf * yf * (3 - 2 * yf)

    def h(i, j):
        v = np.sin(i * 127.1 + j * 311.7) * 43758.5453
        return v - np.floor(v)
    a, b = h(xi, yi), h(xi + 1, yi)
    c, d = h(xi, yi + 1), h(xi + 1, yi + 1)
    return (a + (b - a) * xf) + ((c + (d - c) * xf) - (a + (b - a) * xf)) * yf


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# ─── Geração ─────────────────────────────────────────────────────────────────
def build(sex):
    print(f'== {sex}')
    B = Body(sex)
    k = B.k
    P, Nv = B.P, B.N

    # Superfície amostrada para "grudar" os traços logo abaixo da pele
    def snap(q):
        d2 = ((P - q) ** 2).sum(1)
        idx = np.argpartition(d2, 6)[:6]
        w = 1 / (np.sqrt(d2[idx]) + 1e-4)
        sp = (P[idx] * w[:, None]).sum(0) / w.sum()
        sn = norm((Nv[idx] * w[:, None]).sum(0))
        return sp, sn

    caps = []   # a, b, r, id, u0, u1, belly0, belly1
    for key, pts, r, belly, reach in S:
        for side in (-1, 1):
            anchors = [B.skin(sg, t, th, side)[0] for sg, t, th in pts]
            dense = []
            for i in range(len(anchors) - 1):
                for s in np.linspace(0, 1, 6, endpoint=False):
                    dense.append(anchors[i] + (anchors[i + 1] - anchors[i]) * s)
            dense.append(anchors[-1])
            line = []
            for q in dense:
                sp, sn = snap(q)
                line.append(sp - sn * DEPTH * k)
            line = np.array(line)
            L = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(line, axis=0), axis=1))])
            L /= L[-1] + 1e-9
            for i in range(len(line) - 1):
                caps.append((line[i], line[i + 1], r * k, mid(key, side), L[i], L[i + 1], belly[0], belly[1], reach * k))
    print('  cápsulas:', len(caps))

    ov = []
    for pts, w in OVERLAY:
        for side in (-1, 1):
            a = [B.skin(sg, t, th, side)[0] for sg, t, th in pts]
            for i in range(len(a) - 1):
                ov.append((a[i], a[i + 1], w * k))

    pos, nrm, filled = rasterize(B.P, B.N, B.U, B.I, N)
    Q = pos[filled].astype(np.float64)
    Qn = nrm[filled].astype(np.float64)
    M = len(Q)
    print('  texels:', M)

    # Grade espacial para só comparar cada cápsula com os pontos próximos
    cell = 0.04
    ci = np.floor(Q / cell).astype(np.int64)
    keyc = (ci[:, 0] + 512) * 1_000_000 + (ci[:, 1] + 512) * 1000 + (ci[:, 2] + 512)
    order = np.argsort(keyc, kind='stable')
    ks = keyc[order]
    uk, start = np.unique(ks, return_index=True)
    end = np.append(start[1:], len(ks))
    cells = {int(u): order[s:e] for u, s, e in zip(uk, start, end)}

    b1 = np.full(M, np.inf)
    b2 = np.full(M, np.inf)
    id1 = np.zeros(M, np.int32)
    dir1 = np.zeros((M, 3))
    u1 = np.zeros(M)
    bel = np.zeros((M, 2))
    rch = np.full(M, T_BG * k)
    for a, b, r, idn, ua, ub, be0, be1, reach in caps:
        lo = np.floor((np.minimum(a, b) - r - reach - 0.012) / cell).astype(int)
        hi = np.floor((np.maximum(a, b) + r + reach + 0.012) / cell).astype(int)
        idx = [cells[kk] for x in range(lo[0], hi[0] + 1) for y in range(lo[1], hi[1] + 1) for z in range(lo[2], hi[2] + 1)
               if (kk := (x + 512) * 1_000_000 + (y + 512) * 1000 + (z + 512)) in cells]
        if not idx:
            continue
        idx = np.concatenate(idx)
        p = Q[idx]
        ab = b - a
        tt = np.clip(((p - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
        d = np.linalg.norm(p - (a + tt[:, None] * ab), axis=1) - r
        cur1, cur2, cid = b1[idx], b2[idx], id1[idx]
        better = d < cur1
        same = cid == idn
        # novo melhor: o antigo melhor vira segundo se for de outro músculo
        nb2 = np.where(better & ~same, cur1, cur2)
        nb2 = np.where(~better & ~same & (d < cur2), d, nb2)
        b2[idx] = nb2
        sel = idx[better]
        b1[sel] = d[better]
        id1[sel] = idn
        dir1[sel] = ab / (np.linalg.norm(ab) + 1e-12)
        u1[sel] = ua + (ub - ua) * tt[better]
        bel[sel] = (be0, be1)
        rch[sel] = reach

    Tk = rch
    muscle = b1 < Tk
    ids = np.where(muscle, id1, 0)
    margin = np.minimum(b2, Tk) - b1                    # distância até a fronteira (m)
    groove = 1 - smooth(0.0004, 0.0024 * k, margin)     # sulco entre músculos
    belly = smooth(0.0, 0.02 * k, margin)                # barriga do músculo
    tend = np.maximum(1 - smooth(bel[:, 0] - 0.06, bel[:, 0] + 0.02, u1), smooth(bel[:, 1] - 0.02, bel[:, 1] + 0.06, u1))
    tend = np.where(muscle, tend, 1.0)
    white_ids = {mid(k2, s) for k2 in WHITE for s in (-1, 1)}
    tend = np.where(np.isin(ids, list(white_ids)), 1.0, tend)
    # para o fundo (sem músculo) a transição é suave, sem sulco escuro
    bgmix = smooth(-0.0025 * k, 0.0015 * k, b1 - Tk)
    tend = np.maximum(tend, bgmix)
    groove = np.where(b2 >= Tk, groove * 0.25, groove)

    # Linhas brancas por cima (linha alba, esterno, interseções)
    wline = np.zeros(M)
    for a, b, w in ov:
        ab = b - a
        tt = np.clip(((Q - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
        d = np.linalg.norm(Q - (a + tt[:, None] * ab), axis=1)
        wline = np.maximum(wline, 1 - smooth(w * 0.6, w, d))
    tend = np.maximum(tend, wline)
    ids = np.where(wline > 0.5, 0, ids)
    groove *= 1 - wline

    # Fibras: ruído esticado ao longo da direção do músculo
    dirv = np.where(np.linalg.norm(dir1, axis=1, keepdims=True) > 0, dir1, np.array([0, 1, 0]))
    e1 = np.cross(dirv, Qn)
    e1 /= np.linalg.norm(e1, axis=1, keepdims=True) + 1e-9
    fx = (Q * e1).sum(1) / k
    fy = (Q * dirv).sum(1) / k
    # período ≥ ~3 texels (senão vira moiré); fibras finas cruzando, longas ao longo
    fib = 0.65 * vnoise2(fx * 240, fy * 2.5) + 0.35 * vnoise2(fx * 520 + 7.3, fy * 5)
    grain = vnoise2(Q[:, 0] * 300 + Q[:, 2] * 170, Q[:, 1] * 300)

    rng = np.random.default_rng(7)
    hue = rng.uniform(-0.05, 0.05, 256)
    musc = np.array([196, 84, 70], float)[None] * (1 + hue[ids][:, None])
    musc = musc * (0.7 + 0.3 * belly[:, None]) * (0.84 + 0.28 * fib[:, None])
    musc = musc + np.array([46, 34, 30]) * (belly * fib)[:, None] * 0.4
    tcol = np.array([236, 226, 208], float)[None] * (0.93 + 0.08 * fib[:, None]) * (0.96 + 0.05 * grain[:, None])
    col = musc * (1 - tend[:, None]) + tcol * tend[:, None]
    col *= (1 - 0.55 * groove)[:, None]
    col = np.clip(col, 0, 255)

    h = np.clip(0.4 + 0.42 * belly * (1 - tend) + 0.1 * tend - 0.45 * groove + 0.1 * (fib - 0.5), 0, 1)

    # ── Imagens (com sangria nas bordas das ilhas da textura)
    img = np.zeros((N, N, 3), np.float32)
    img[filled] = col
    hmap = np.zeros((N, N), np.float32)
    hmap[filled] = h
    idm = np.zeros((N, N), np.uint8)
    idm[filled] = ids
    fill = filled.copy()
    for _ in range(12):
        acc = np.zeros_like(img)
        hacc = np.zeros_like(hmap)
        cnt = np.zeros((N, N), np.float32)
        idn = idm.copy()
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            sf = np.roll(np.roll(fill, dy, 0), dx, 1)
            acc += np.roll(np.roll(img, dy, 0), dx, 1) * sf[..., None]
            hacc += np.roll(np.roll(hmap, dy, 0), dx, 1) * sf
            cnt += sf
            sid = np.roll(np.roll(idm, dy, 0), dx, 1)
            idn = np.where(~fill & sf & (idn == 0), sid, idn)
        grow = ~fill & (cnt > 0)
        img[grow] = acc[grow] / cnt[grow][:, None]
        hmap[grow] = hacc[grow] / cnt[grow]
        idm = np.where(grow, idn, idm)
        fill |= grow
    img[~fill] = (230, 220, 204)
    hmap[~fill] = 0.4

    base = os.path.join(MODELS, f'muscles-{sex}')
    Image.fromarray(img.astype(np.uint8)).save(base + '.jpg', quality=86, optimize=True)
    Image.fromarray((hmap * 255).astype(np.uint8)).resize((1024, 1024), Image.LANCZOS).save(base + '-bump.jpg', quality=88)
    Image.fromarray(idm).save(base + '-id.png', optimize=True)

    # Centro, normal média e tamanho de cada id (a câmera enquadra o músculo)
    info = {}
    for i in np.unique(ids):
        if i == 0:
            continue
        m = ids == i
        c = Q[m].mean(0)
        nr = norm(Qn[m].mean(0))
        rad = float(np.percentile(np.linalg.norm(Q[m] - c, axis=1), 90))
        info[int(i)] = [round(float(x), 4) for x in (*c, *nr, rad)]
    json.dump(info, open(base + '.json', 'w'), separators=(',', ':'))
    for suf in ('.jpg', '-bump.jpg', '-id.png', '.json'):
        print(f'  {os.path.relpath(base + suf, ROOT)}  {os.path.getsize(base + suf) / 1024:.0f} KB')
    missing = [KEYS[(i - 1) // 2] for i in range(1, 2 * len(KEYS) + 1) if str(i) not in {str(x) for x in info}]
    if missing:
        print('  sem área visível:', sorted(set(missing)))


if __name__ == '__main__':
    for sx in (sys.argv[1:] or ['female', 'male']):
        build(sx)
