// "Esqueleto" anatômico do modelo human-body.glb (coordenadas normalizadas).
//
// Medido a partir da própria malha (seções transversais + renders de conferência).
// Convenção: +Y para cima, +Z para a FRENTE do paciente, X negativo = lado
// DIREITO do paciente. Todas as funções abaixo descrevem o lado direito; o lado
// esquerdo é obtido espelhando X.
//
// Pose do modelo: braços abertos em "A" (~35° abaixo da horizontal), antebraço em
// posição neutra — polegar para a FRENTE, dorso da mão para CIMA, palma para BAIXO.

const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const rad = d => d * Math.PI / 180

export const RIG = {
  // Braço direito: articulação do ombro → prega do cotovelo → prega do punho
  S: [-0.205, 1.372, -0.088],
  E: [-0.350, 1.252, -0.097],
  W: [-0.566, 1.112, -0.080],
  axillaT: 0.18,              // prega axilar anterior ao longo de S→E

  // Perna direita: topo da coxa → prega poplítea → maléolos
  HIP:   [-0.115, 0.840, -0.012],
  KNEE:  [-0.132, 0.495, -0.025],
  ANKLE: [-0.165, 0.078, -0.037],
  patellaTop: 0.535,
  cunThigh: (0.86 - 0.495) / 19,  // trocânter maior → prega poplítea = 19 cun
  cunLeg:   (0.495 - 0.078) / 16, // prega poplítea → maléolo lateral = 16 cun

  // Tronco
  navel: 1.07,
  cunV: 0.0306,               // umbigo → sínfise púbica = 5 cun; → xifoide = 8 cun
  cunH: 0.025,                // entre os mamilos = 8 cun
  ics: { 1: 1.425, 2: 1.40, 3: 1.372, 4: 1.345, 5: 1.318, 6: 1.292, 7: 1.268 },
  // Altura do processo espinhoso de cada vértebra
  vert: {
    C7: 1.495, T1: 1.466, T2: 1.437, T3: 1.408, T4: 1.379, T5: 1.350, T6: 1.321,
    T7: 1.292, T8: 1.263, T9: 1.234, T10: 1.205, T11: 1.176, T12: 1.147,
    L1: 1.115, L2: 1.083, L3: 1.051, L4: 1.019, L5: 0.987,
    S1: 0.958, S2: 0.932, S3: 0.908, S4: 0.886
  },

  // Cabeça (rosto liso — referências por proporção)
  HEAD: [0, 1.655, -0.010]
}

// Z aproximado do centro do tronco em cada altura (sempre por dentro do corpo)
function torsoZ(y) {
  if (y > 1.52) return -0.01
  if (y > 1.40) return -0.04
  return -0.015
}

// ── Construtores de posicionamento ────────────────────────────────────────────
// Cada um devolve { target, dir, mode } consumido por mesh.surface().

// Genérico
export const at = (target, dir, mode = 'near') => ({ target, dir: norm(dir), mode })

// Tronco, projeção frontal: x em cun (negativo = direita), y absoluto
export const front = (xc, y, dy = 0) => ({ target: [xc * RIG.cunH, y, torsoZ(y)], dir: norm([0, dy, 1]), mode: 'out' })
// Tronco, projeção dorsal
export const back = (xc, y, dy = 0) => ({ target: [xc * RIG.cunH, y, torsoZ(y)], dir: norm([0, dy, -1]), mode: 'out' })
// Tronco, raio ao redor do eixo: ang 0 = frente, 90 = lateral direita, 180 = costas
export const side = (y, ang) => ({ target: [0, y, torsoZ(y)], dir: [-Math.sin(rad(ang)), 0, Math.cos(rad(ang))], mode: 'out' })

// Referencial de um segmento de membro: eixo d, anterior a, "superior" u
function limbFrame(A, B, upRef) {
  const d = norm(sub(B, A))
  const a = norm(sub([0, 0, 1], scale(d, dot([0, 0, 1], d))))
  let u = sub(upRef, scale(d, dot(upRef, d)))
  u = norm(sub(u, scale(a, dot(u, a))))
  return { d, a, u }
}

// Braço — ang: 0 = anterior (+Z), 90 = superior/dorso, 180 = posterior, -90 = inferior/palma.
// No braço (úmero) o lado superior é o LATERAL e o inferior é o MEDIAL (axila).
export function armUt(t, ang) {
  const { a, u } = limbFrame(RIG.S, RIG.E, [0, 1, 0])
  const c = lerp(RIG.S, RIG.E, t)
  return { target: c, dir: norm(add(scale(a, Math.cos(rad(ang))), scale(u, Math.sin(rad(ang))))), mode: 'out' }
}
// cun acima da prega do cotovelo (9 cun até a prega axilar)
export const armU = (cunAboveElbow, ang) => armUt(1 - (cunAboveElbow / 9) * (1 - RIG.axillaT), ang)

export function armFt(t, ang) {
  const { a, u } = limbFrame(RIG.E, RIG.W, [0, 1, 0])
  const c = lerp(RIG.E, RIG.W, t)
  return { target: c, dir: norm(add(scale(a, Math.cos(rad(ang))), scale(u, Math.sin(rad(ang))))), mode: 'out' }
}
// cun acima da prega do punho (12 cun até o cotovelo)
export const armF = (cunAboveWrist, ang) => armFt(1 - cunAboveWrist / 12, ang)

// Perna — por altura y. ang: 0 = anterior, 90 = lateral, 180 = posterior, -90 = medial
export function legY(y, ang) {
  const upper = y >= RIG.KNEE[1]
  const A = upper ? RIG.HIP : RIG.KNEE
  const B = upper ? RIG.KNEE : RIG.ANKLE
  const t = (y - A[1]) / (B[1] - A[1])
  const c = lerp(A, B, t)
  const d = norm(sub(B, A))
  const a = norm(sub([0, 0, 1], scale(d, dot([0, 0, 1], d))))
  let l = sub([-1, 0, 0], scale(d, dot([-1, 0, 0], d)))
  l = norm(sub(l, scale(a, dot(l, a))))
  return { target: c, dir: norm(add(scale(a, Math.cos(rad(ang))), scale(l, Math.sin(rad(ang))))), mode: 'out' }
}
// cun abaixo da prega poplítea / acima do maléolo / acima do topo da patela
export const belowKnee   = (cun, ang) => legY(RIG.KNEE[1] - cun * RIG.cunLeg, ang)
export const aboveAnkle  = (cun, ang) => legY(RIG.ANKLE[1] + cun * RIG.cunLeg, ang)
export const abovePatella = (cun, ang) => legY(RIG.patellaTop + cun * RIG.cunThigh, ang)

// Cabeça: azimute (0 = frente, 90 = lateral direita, 180 = nuca) e elevação
export function head(az, el = 0) {
  const c = RIG.HEAD
  return {
    target: c,
    dir: [-Math.sin(rad(az)) * Math.cos(rad(el)), Math.sin(rad(el)), Math.cos(rad(az)) * Math.cos(rad(el))],
    mode: 'out'
  }
}
// Cabeça em altura específica (raio horizontal a partir do eixo da cabeça)
export const headAt = (y, az, dy = 0) => ({
  target: [0, y, RIG.HEAD[2]],
  dir: norm([-Math.sin(rad(az)), dy, Math.cos(rad(az))]),
  mode: 'out'
})
// Rosto: x em metros (negativo = direita), projeção frontal
export const face = (x, y, lat = 0) => ({ target: [x, y, -0.01], dir: norm([lat, 0, 1]), mode: 'out' })

// Pé: (x, z) no plano do chão; dirY 1 = dorso, -1 = planta. O alvo fica dentro
// do pé (y baixo) e o raio sai pela pele do lado pedido.
export const foot = (x, z, dirY = 1, y = 0.012) => ({ target: [x, y, z], dir: [0, dirY, 0], mode: 'out' })
// Borda medial (+1) ou lateral (-1) do pé direito
export const footEdge = (y, z, medial = 1, x = -0.165) => ({ target: [x, y, z], dir: [medial, 0, 0], mode: 'out' })

// Mão direita — referencial obtido por PCA da palma:
//   F = direção dos dedos, R = lado radial (polegar), N = dorso
export const HAND = {
  C: [-0.636, 1.065, -0.071],
  F: norm([-0.699, -0.679, 0.20]),
  R: norm([0.283, 0.144, 0.948]),
  N: norm([-0.705, 0.702, 0.104])
}
// f = ao longo da mão (punho ≈ -0.083, articulações MCF ≈ +0.035, ponta do médio ≈ +0.115)
// r = radial (+) / ulnar (-): indicador ≈ +0.035, médio ≈ +0.01, anelar ≈ -0.02, mínimo ≈ -0.042
// side: 'dorso' | 'palma' | 'radial' | 'ulnar' | 'ponta'
export function hand(f, r, sideName, mode = 'out') {
  const t = add(add(HAND.C, scale(HAND.F, f)), scale(HAND.R, r))
  const dir = {
    dorso: HAND.N, palma: scale(HAND.N, -1),
    radial: HAND.R, ulnar: scale(HAND.R, -1), ponta: HAND.F
  }[sideName]
  return { target: t, dir, mode }
}

// Linha sagital na cabeça: plano x = xOff; el 0 = testa, 90 = topo, 180 = nuca
export const headLine = (xOff, el) => ({
  target: [xOff, RIG.HEAD[1], RIG.HEAD[2]],
  dir: [0, Math.sin(rad(el)), Math.cos(rad(el))],
  mode: 'out'
})

export const V = RIG.vert
// Meio caminho entre o processo espinhoso de uma vértebra e a de baixo
export function below(v) {
  const order = Object.keys(RIG.vert)
  const i = order.indexOf(v)
  return (RIG.vert[order[i]] + RIG.vert[order[i + 1]]) / 2
}
export const abd = cunFromNavel => RIG.navel + cunFromNavel * RIG.cunV   // + acima, − abaixo
