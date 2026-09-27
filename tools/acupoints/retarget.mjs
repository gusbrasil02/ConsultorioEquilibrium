// Redirecionamento anatômico: leva as especificações dos pontos (escritas para o
// modelo clássico) para outro corpo 3D.
//
// Cada posicionamento é expresso em relação ao seu segmento anatômico no modelo
// clássico — braço, antebraço, mão, coxa, perna, pé, tronco/cabeça — e
// reconstruído no mesmo segmento do corpo de destino, usando as juntas do
// esqueleto e medidas da própria malha. A direção do raio acompanha a rotação do
// segmento, e o ponto final continua sendo obtido na pele do corpo de destino.
import { lineHits } from './mesh.mjs'
import { RIG, HAND } from './rig.mjs'

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const len = a => Math.hypot(a[0], a[1], a[2])
const norm = a => mul(a, 1 / (len(a) || 1))
const lerp = (a, b, t) => add(a, mul(sub(b, a), t))
const perp = (v, d) => norm(sub(v, mul(d, dot(v, d))))

// ── Medidas na malha ──────────────────────────────────────────────────────────

// Perfil do tronco/cabeça numa altura: meia-largura, centro e profundidade
export function profile(body, y, head = false) {
  const hz = lineHits(body, [1e-5, y, 0], [0, 0, 1]).map(h => h.t)
  if (hz.length < 2) return null
  const zf = Math.max(...hz), zb = Math.min(...hz)
  const zc = (zf + zb) / 2
  // Meia-largura: primeira saída lateral a partir do centro (não pega os braços)
  const side = dir => {
    const t = lineHits(body, [1e-5, y, zc], [dir, 0, 0]).map(h => h.t).filter(t => t > 0)
    if (!t.length) return null
    // Na cabeça não há braços: o contorno externo é a última saída (o raio pode
    // cruzar cavidades internas do nariz/boca). No tronco, a primeira (antes dos braços).
    return head ? Math.max(...t.filter(x => x < 0.13)) : Math.min(...t.filter(x => x > 0.015))
  }
  const l = side(-1), r = side(1)
  const hw = l && r ? (l + r) / 2 : (l || r)
  return { hw, zc, depth: zf - zb }
}

// Raio médio de um membro no meio do segmento A→B
function limbRadius(body, A, B) {
  const d = norm(sub(B, A)), L = len(sub(B, A))
  const ds = []
  for (const v of body.verts) {
    const w = sub(v, A)
    const t = dot(w, d) / L
    if (t < 0.4 || t > 0.6) continue
    const r = len(sub(w, mul(d, dot(w, d))))
    if (r < 0.14) ds.push(r)
  }
  ds.sort((a, b) => a - b)
  return ds[Math.floor(ds.length / 2)] || 0.05
}

// Pé direito: calcanhar, ponta, largura (vértices perto do chão)
function footShape(body, ankle) {
  const V = body.verts.filter(v => v[1] < 0.06 && Math.abs(v[0] - ankle[0]) < 0.09 && v[0] < 0)
  const toe = V.reduce((a, b) => (b[2] > a[2] ? b : a))
  const heel = V.reduce((a, b) => (b[2] < a[2] ? b : a))
  const xs = V.filter(v => v[1] < 0.03).map(v => v[0])
  return {
    fwd: norm([toe[0] - heel[0], 0, toe[2] - heel[2]]),
    length: toe[2] - heel[2],
    width: Math.max(...xs) - Math.min(...xs),
    height: ankle[1]
  }
}

// ── Pontos de referência de cada corpo ────────────────────────────────────────

// Modelo clássico: valores do rig (os mesmos usados nas especificações)
export function classicLandmarks(body) {
  const L = {
    body,
    S: RIG.S, E: RIG.E, W: RIG.W,
    hand: { C: HAND.C, F: HAND.F, R: HAND.R, N: HAND.N, len: 0.123 },   // punho → articulações MCF
    tips: {
      thumb: [-0.627, 0.995, -0.003], index: [-0.698, 0.978, -0.031], middle: [-0.712, 0.973, -0.056],
      ring: [-0.709, 0.980, -0.088], little: [-0.687, 0.999, -0.110]
    },
    HIP: RIG.HIP, KNEE: RIG.KNEE, ANKLE: RIG.ANKLE,
    ladder: { crotch: 0.88, navel: RIG.navel, nipple: RIG.ics[4], notch: 1.462, chin: 1.537, mouth: 1.573, nose: 1.595, eye: 1.640, top: 1.76 }
  }
  return finishLandmarks(L)
}

// Corpo realista (MakeHuman): juntas do esqueleto + medidas da malha
export function mhLandmarks(body, J) {
  const V = body.verts
  const midFront = y => { const p = profile(body, y); return p ? p.zc + p.depth / 2 : null }

  // Fenda entre as pernas (primeiro contato subindo pela linha média)
  const up = lineHits(body, [1e-5, 0.3, J['pelvis'][2]], [0, 1, 0]).map(h => h.t).filter(t => t > 0)
  const crotch = 0.3 + Math.min(...up)
  const top = Math.max(...V.map(v => v[1]))
  const eye = J['r-eye'][1]
  // Mamilo: ponto mais à frente do peito do lado direito
  const chest = V.filter(v => v[0] < -0.05 && v[0] > -0.14 && v[1] > eye - 0.55 && v[1] < eye - 0.25)
  const nipple = chest.reduce((a, b) => (b[2] > a[2] ? b : a))[1]
  // Perfil frontal da linha média: umbigo (covinha) e fúrcula (menor z entre mamilo e queixo)
  const scan = (y0, y1, step = 0.004) => {
    const out = []
    for (let y = y0; y <= y1; y += step) { const z = midFront(y); if (z != null) out.push([y, z]) }
    return out
  }
  const belly = scan(crotch + 0.12, nipple - 0.12)
  const navel = belly.reduce((a, b) => (b[1] < a[1] ? b : a))[0]
  const neck = scan(nipple + 0.05, eye - 0.08)
  const notch = neck.slice(0, Math.floor(neck.length * 0.6)).reduce((a, b) => (b[1] < a[1] ? b : a))[0]
  // Queixo: onde o perfil frontal "salta" para a frente saindo do pescoço
  let chin = eye - 0.13
  for (let i = 1; i < neck.length; i++) if (neck[i][1] - neck[i - 1][1] > 0.006) { chin = neck[i][0]; break }
  // Boca: entre os dentes superiores e inferiores (referências internas do MakeHuman)
  const mouth = (J['helper-upper-teeth'][1] + J['helper-lower-teeth'][1]) / 2 - 0.004
  // Base do nariz: onde o perfil começa a subir para a ponta do nariz
  let nose = mouth + 0.018
  for (let y = mouth + 0.008; y < eye - 0.03; y += 0.0025) {
    const z0 = midFront(y), z1 = midFront(y + 0.005)
    if (z0 != null && z1 != null && z1 - z0 > 0.004) { nose = y; break }
  }

  // Mão: centro da palma na mesma proporção punho→MCF do modelo clássico
  const wrist = J['r-hand'], mcp = J['r-finger-3-1']
  const F = norm(sub(mcp, wrist))
  const R = perp(sub(J['r-finger-2-1'], J['r-finger-5-1']), F)
  const N = cross(F, R)
  const hlen = len(sub(mcp, wrist))
  const C = add(wrist, mul(F, hlen * (0.083 / 0.123)))

  // Coxa: começa na altura equivalente ao "HIP" clássico (4 cm abaixo da fenda)
  const hipJ = J['r-upper-leg'], knee = J['r-knee']
  const tHip = (crotch - 0.04 - hipJ[1]) / (knee[1] - hipJ[1])
  const L = {
    body,
    S: J['r-shoulder'], E: J['r-elbow'], W: wrist,
    hand: { C, F, R, N, len: hlen },
    tips: {
      thumb: J['r-finger-1-4'], index: J['r-finger-2-4'], middle: J['r-finger-3-4'],
      ring: J['r-finger-4-4'], little: J['r-finger-5-4']
    },
    HIP: lerp(hipJ, knee, Math.max(0, tHip)), KNEE: knee, ANKLE: J['r-ankle'],
    ladder: { crotch, navel, nipple, notch, chin, mouth, nose, eye, top }
  }
  return finishLandmarks(L)
}

function finishLandmarks(L) {
  L.rUA = limbRadius(L.body, L.S, L.E)
  L.rFA = limbRadius(L.body, L.E, L.W)
  L.rTH = limbRadius(L.body, L.HIP, L.KNEE)
  L.rSH = limbRadius(L.body, L.KNEE, L.ANKLE)
  L.foot = footShape(L.body, L.ANKLE)
  L.ladderKeys = Object.keys(L.ladder).sort((a, b) => L.ladder[a] - L.ladder[b])
  L._prof = new Map()
  L.prof = y => {
    const k = Math.round(y * 500) / 500
    if (!L._prof.has(k)) {
      // Abaixo da fenda a linha média é vazia: mede logo acima dela
      const p = profile(L.body, Math.max(k, L.ladder.crotch + 0.01), k > L.ladder.chin + 0.005)
      L._prof.set(k, p)
    }
    return L._prof.get(k)
  }
  return L
}

// ── Mapeamentos por região ────────────────────────────────────────────────────

// Altura do tronco/cabeça: interpolação linear por trechos entre marcos
function mapLadder(y, A, B) {
  const ks = A.ladderKeys
  let i = 0
  while (i < ks.length - 2 && y > A.ladder[ks[i + 1]]) i++
  const a0 = A.ladder[ks[i]], a1 = A.ladder[ks[i + 1]]
  const b0 = B.ladder[ks[i]], b1 = B.ladder[ks[i + 1]]
  return b0 + (y - a0) * (b1 - b0) / (a1 - a0)
}

function mapTorso(pl, A, B) {
  const [x, y, z] = pl.target
  const y2 = mapLadder(y, A, B)
  const pa = A.prof(y), pb = B.prof(y2)
  if (!pa || !pb) return { ...pl, target: [x, y2, z] }
  return {
    ...pl,
    target: [x * pb.hw / pa.hw, y2, pb.zc + (z - pa.zc) * pb.depth / pa.depth]
  }
}

// Referencial de segmento: d = eixo, a = "anterior", u = cross(d, a)
function frame(P0, P1, aHint) {
  const d = norm(sub(P1, P0))
  const a = perp(aHint, d)
  return { d, a, u: cross(d, a), L: len(sub(P1, P0)) }
}

function mapLimb(pl, A0, A1, B0, B1, rA, rB, aB = null) {
  const fa = frame(A0, A1, [0, 0, 1])
  const fb = typeof aB === 'function' ? null : frame(B0, B1, aB || [0, 0, 1])
  const w = sub(pl.target, A0)
  const t = dot(w, fa.d) / fa.L
  const off = sub(w, mul(fa.d, t * fa.L))
  const ca = dot(off, fa.a), cu = dot(off, fa.u)
  const dd = dot(pl.dir, fa.d), da = dot(pl.dir, fa.a), du = dot(pl.dir, fa.u)
  const F = fb || frame(B0, B1, aB(t))
  const k = rB / rA
  const axis = add(B0, mul(F.d, t * F.L))
  return {
    ...pl,
    target: add(axis, add(mul(F.a, ca * k), mul(F.u, cu * k))),
    dir: norm(add(mul(F.d, dd), add(mul(F.a, da), mul(F.u, du))))
  }
}

function toHand(p, H, scale) {
  const w = sub(p, H.C)
  return [dot(w, H.F) / scale, dot(w, H.R) / scale, dot(w, H.N) / scale]
}
function fromHand(c, H, scale) {
  return add(H.C, add(mul(H.F, c[0] * scale), add(mul(H.R, c[1] * scale), mul(H.N, c[2] * scale))))
}

function mapHand(pl, A, B) {
  const sa = A.hand.len, sb = B.hand.len
  const dirC = [dot(pl.dir, A.hand.F), dot(pl.dir, A.hand.R), dot(pl.dir, A.hand.N)]
  const dir = norm(add(mul(B.hand.F, dirC[0]), add(mul(B.hand.R, dirC[1]), mul(B.hand.N, dirC[2]))))
  if (pl.mode === 'snap') {
    // Pontas dos dedos: relativo à ponta mais próxima (os dedos têm curvaturas diferentes)
    let best = null
    for (const k of Object.keys(A.tips)) {
      const d = len(sub(pl.target, A.tips[k]))
      if (!best || d < best.d) best = { k, d }
    }
    const off = sub(pl.target, A.tips[best.k])
    const offB = fromHand(toHand(add(A.hand.C, off), A.hand, sa), B.hand, sb)
    return { ...pl, target: add(B.tips[best.k], sub(offB, B.hand.C)), dir }
  }
  return { ...pl, target: fromHand(toHand(pl.target, A.hand, sa), B.hand, sb), dir }
}

function mapFoot(pl, A, B) {
  const basis = (L) => {
    const f = L.foot.fwd
    const lat = norm(cross([0, 1, 0], f))       // para a direita do pé (lateral do pé direito = -X)
    return { f, lat }
  }
  const ba = basis(A), bb = basis(B)
  const w = sub(pl.target, A.ANKLE)
  const cf = dot(w, ba.f) / A.foot.length, cl = dot(w, ba.lat) / A.foot.width, cy = w[1] / A.foot.height
  const df = dot(pl.dir, ba.f), dl = dot(pl.dir, ba.lat), dy = pl.dir[1]
  return {
    ...pl,
    target: add(B.ANKLE, add(mul(bb.f, cf * B.foot.length), add(mul(bb.lat, cl * B.foot.width), [0, cy * B.foot.height, 0]))),
    dir: norm(add(mul(bb.f, df), add(mul(bb.lat, dl), [0, dy, 0])))
  }
}

// Região de um posicionamento: vem do construtor (rig.mjs) ou é deduzida
function regionOf(pl, A) {
  if (pl.reg) {
    if (pl.reg === 'leg') return pl.target[1] >= A.KNEE[1] ? 'thigh' : 'shank'
    return pl.reg
  }
  const [x, y] = pl.target
  if (y < 0.1) return 'foot'
  if (Math.abs(x) > 0.55 && y > 0.9) return 'hand'
  // Perto do eixo do braço (ex.: axila)
  const d = norm(sub(A.E, A.S)), w = sub(pl.target, A.S)
  const t = dot(w, d) / len(sub(A.E, A.S))
  if (t > 0 && t < 1 && len(sub(w, mul(d, dot(w, d)))) < 0.07 && Math.abs(x) > 0.19) return 'ua'
  return 'torso'
}

// Cria a função de redirecionamento A (clássico) → B (destino)
export function makeRetarget(A, B) {
  // Antebraço do destino: "anterior" gira do sulco do cotovelo (t=0) para o lado
  // do polegar no punho (t=1) — respeita a pronação do modelo de destino.
  const dB = norm(sub(B.W, B.E))
  const aElbow = perp(frame(B.S, B.E, [0, 0, 1]).a, dB)
  const aWrist = perp(B.hand.R, dB)
  const twist = t => norm(add(mul(aElbow, 1 - t), mul(aWrist, t)))

  return pl => {
    switch (regionOf(pl, A)) {
      case 'ua': return mapLimb(pl, A.S, A.E, B.S, B.E, A.rUA, B.rUA)
      case 'fa': return mapLimb(pl, A.E, A.W, B.E, B.W, A.rFA, B.rFA, twist)
      case 'hand': return mapHand(pl, A, B)
      case 'thigh': return mapLimb(pl, A.HIP, A.KNEE, B.HIP, B.KNEE, A.rTH, B.rTH)
      case 'shank': return mapLimb(pl, A.KNEE, A.ANKLE, B.KNEE, B.ANKLE, A.rSH, B.rSH)
      case 'foot': return mapFoot(pl, A, B)
      default: return mapTorso(pl, A, B)
    }
  }
}
