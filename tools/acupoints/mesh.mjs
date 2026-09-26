// Leitura do GLB do corpo e interseção raio × malha (sem dependências).
//
// A malha é normalizada EXATAMENTE como o AcupunctureViewer faz no navegador:
// pés em Y=0, topo da cabeça em Y=1.76, centralizada em X e Z. Assim as
// coordenadas geradas aqui caem no mesmo lugar do modelo renderizado.
import fs from 'fs'

function mul4(a, b) {
  const r = new Array(16).fill(0)
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0
    for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]
    r[i * 4 + j] = s
  }
  return r
}
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

export function loadBody(glbPath) {
  const b = fs.readFileSync(glbPath)
  const jsonLen = b.readUInt32LE(12)
  const json = JSON.parse(b.slice(20, 20 + jsonLen).toString())
  const bin = b.slice(20 + jsonLen + 8)

  // O modelo é uma cadeia simples de nós até a única malha
  let world = IDENT
  let node = json.nodes[json.scenes[0].nodes[0]]
  while (node) {
    world = mul4(world, node.matrix || IDENT)
    if (node.mesh != null) break
    node = node.children ? json.nodes[node.children[0]] : null
  }

  const prim = json.meshes[node.mesh].primitives[0]
  const acc = json.accessors[prim.attributes.POSITION]
  const bv = json.bufferViews[acc.bufferView]
  const off = (bv.byteOffset || 0) + (acc.byteOffset || 0)
  const stride = bv.byteStride || 12
  const raw = []
  for (let i = 0; i < acc.count; i++) {
    const o = off + i * stride
    const x = bin.readFloatLE(o), y = bin.readFloatLE(o + 4), z = bin.readFloatLE(o + 8)
    raw.push([
      world[0] * x + world[4] * y + world[8] * z + world[12],
      world[1] * x + world[5] * y + world[9] * z + world[13],
      world[2] * x + world[6] * y + world[10] * z + world[14]
    ])
  }

  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]
  raw.forEach(v => { for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]) } })
  const s = 1.76 / (mx[1] - mn[1])
  const cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2
  const verts = raw.map(([x, y, z]) => [(x - cx) * s, (y - mn[1]) * s, (z - cz) * s])

  const ia = json.accessors[prim.indices]
  const ibv = json.bufferViews[ia.bufferView]
  const ioff = (ibv.byteOffset || 0) + (ia.byteOffset || 0)
  const idx = []
  for (let i = 0; i < ia.count; i++) {
    idx.push(ia.componentType === 5125 ? bin.readUInt32LE(ioff + i * 4) : bin.readUInt16LE(ioff + i * 2))
  }

  // Triângulos achatados para o teste de interseção
  const nt = idx.length / 3
  const T = new Float64Array(nt * 9)
  for (let t = 0; t < nt; t++) {
    for (let c = 0; c < 3; c++) {
      const v = verts[idx[t * 3 + c]]
      T[t * 9 + c * 3] = v[0]; T[t * 9 + c * 3 + 1] = v[1]; T[t * 9 + c * 3 + 2] = v[2]
    }
  }
  // Triângulos que tocam cada vértice (para a normal no modo 'snap')
  const vtris = verts.map(() => [])
  for (let t = 0; t < nt; t++) for (let c = 0; c < 3; c++) vtris[idx[t * 3 + c]].push(t)

  return { verts, idx, tris: T, count: nt, vtris }
}

function triNormal(body, t) {
  const T = body.tris, i = t * 9
  const e1 = [T[i + 3] - T[i], T[i + 4] - T[i + 1], T[i + 5] - T[i + 2]]
  const e2 = [T[i + 6] - T[i], T[i + 7] - T[i + 1], T[i + 8] - T[i + 2]]
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
  const l = Math.hypot(...n) || 1
  return [n[0] / l, n[1] / l, n[2] / l]
}

// Vértice da malha mais próximo do alvo, com normal média orientada por `dir`
function snap(body, target, dir, lift) {
  let best = -1, bd = Infinity
  body.verts.forEach((v, i) => {
    const d = (v[0] - target[0]) ** 2 + (v[1] - target[1]) ** 2 + (v[2] - target[2]) ** 2
    if (d < bd) { bd = d; best = i }
  })
  const n = [0, 0, 0]
  for (const t of body.vtris[best]) {
    let tn = triNormal(body, t)
    if (tn[0] * dir[0] + tn[1] * dir[1] + tn[2] * dir[2] < 0) tn = tn.map(x => -x)
    n[0] += tn[0]; n[1] += tn[1]; n[2] += tn[2]
  }
  const nn = norm(n)
  const v = body.verts[best]
  return { p: [v[0] + nn[0] * lift, v[1] + nn[1] * lift, v[2] + nn[2] * lift], n: nn }
}

// Todas as interseções da RETA (o + t·d, t ∈ ℝ) com a malha — Möller–Trumbore
export function lineHits(body, o, d) {
  const T = body.tris, out = []
  for (let t = 0; t < body.count; t++) {
    const i = t * 9
    const ax = T[i], ay = T[i + 1], az = T[i + 2]
    const e1x = T[i + 3] - ax, e1y = T[i + 4] - ay, e1z = T[i + 5] - az
    const e2x = T[i + 6] - ax, e2y = T[i + 7] - ay, e2z = T[i + 8] - az
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x
    const det = e1x * px + e1y * py + e1z * pz
    if (Math.abs(det) < 1e-12) continue
    const inv = 1 / det
    const sx = o[0] - ax, sy = o[1] - ay, sz = o[2] - az
    const u = (sx * px + sy * py + sz * pz) * inv
    if (u < 0 || u > 1) continue
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x
    const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv
    if (v < 0 || u + v > 1) continue
    const tt = (e2x * qx + e2y * qy + e2z * qz) * inv
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x
    const nl = Math.hypot(nx, ny, nz) || 1
    out.push({ t: tt, n: [nx / nl, ny / nl, nz / nl] })
  }
  return out
}

const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }

/**
 * Ponto na pele a partir de um alvo e de uma direção "para fora".
 *   mode 'out'  → o alvo está DENTRO do segmento; pega a 1ª saída na direção
 *                 (até maxT). Se não achar, cai para 'near'.
 *   mode 'near' → pega a interseção mais próxima do alvo (antes ou depois).
 * Retorna { p, n } com n apontando para fora (mesmo lado de dir).
 */
export function surface(body, target, dir, { mode = 'out', maxT = 0.3, lift = 0.004 } = {}) {
  const d = norm(dir)
  if (mode === 'snap') return snap(body, target, d, lift)
  // Raio exatamente sobre a costura da linha média pode "passar entre" os
  // triângulos por arredondamento — um deslocamento de 10 µm resolve.
  if (Math.abs(target[0]) < 1e-6) target = [1e-5, target[1], target[2]]
  const hits = lineHits(body, target, d)
  let best = null
  if (mode === 'out') {
    for (const h of hits) if (h.t >= 0 && h.t <= maxT && (!best || h.t < best.t)) best = h
  }
  if (!best) {
    for (const h of hits) if (!best || Math.abs(h.t) < Math.abs(best.t)) best = h
  }
  if (!best) return null
  let n = best.n
  if (n[0] * d[0] + n[1] * d[1] + n[2] * d[2] < 0) n = [-n[0], -n[1], -n[2]]
  const p = [0, 1, 2].map(k => target[k] + d[k] * best.t + n[k] * lift)
  return { p, n }
}
