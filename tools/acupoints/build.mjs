// Gera public/js/acu-data.js a partir de specs.mjs + do modelo 3D.
//
//   npm run build:acupoints
//
// Para cada ponto calcula a posição exata na pele (e a normal) dos dois lados do
// corpo; para cada meridiano gera o trajeto colado à superfície entre os pontos.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadBody, surface } from './mesh.mjs'
import { MERIDIANS, PROTOCOLS } from './specs.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const body = loadBody(path.join(root, 'public', 'models', 'human-body.glb'))

const r4 = x => Math.round(x * 10000) / 10000
// O modelo não é perfeitamente simétrico: medindo os centróides de cada região,
// o lado esquerdo está deslocado ~8 mm na mão e nas pernas. Compensamos ao espelhar.
function mirrorOffset([x, y]) {
  if (Math.abs(x) > 0.58 && y > 0.9) return [0, 0.008, 0.008]   // mão
  if (y < 0.82) return [-0.008, 0, 0]                            // pernas e pés
  return [0, 0, 0]
}
const mirror = pl => {
  const o = mirrorOffset(pl.target)
  return {
    ...pl,
    target: [-pl.target[0] + o[0], pl.target[1] + o[1], pl.target[2] + o[2]],
    dir: [-pl.dir[0], pl.dir[1], pl.dir[2]]
  }
}
const isMid = pl => Math.abs(pl.target[0]) < 1e-9 && Math.abs(pl.dir[0]) < 1e-9

function place(pl, lift = 0.004) {
  const s = surface(body, pl.target, pl.dir, { mode: pl.mode, lift })
  if (!s) throw new Error('Sem interseção para ' + JSON.stringify(pl))
  return s
}

// Trajeto entre âncoras: interpola a corda e projeta cada amostra na pele
// ao longo da normal interpolada.
function surfacePath(anchors) {
  const out = []
  for (let i = 0; i < anchors.length - 1; i++) {
    const A = anchors[i], B = anchors[i + 1]
    const dist = Math.hypot(B.p[0] - A.p[0], B.p[1] - A.p[1], B.p[2] - A.p[2])
    const steps = Math.max(2, Math.ceil(dist / 0.01))
    for (let s = i === 0 ? 0 : 1; s <= steps; s++) {
      const t = s / steps
      const p = [0, 1, 2].map(k => A.p[k] + (B.p[k] - A.p[k]) * t)
      let n = [0, 1, 2].map(k => A.n[k] + (B.n[k] - A.n[k]) * t)
      const nl = Math.hypot(...n) || 1
      n = n.map(x => x / nl)
      if (s === 0 || s === steps) { out.push(p); continue }
      const hit = surface(body, p, n, { mode: 'near', lift: 0.0025 })
      const ok = hit && Math.hypot(hit.p[0] - p[0], hit.p[1] - p[1], hit.p[2] - p[2]) < 0.06
      out.push(ok ? hit.p : p)
    }
  }
  return out.map(p => p.map(r4))
}

const t0 = Date.now()
const meridians = MERIDIANS.map(m => {
  const bilateral = m.bilateral !== false
  const placed = {}   // id -> { R: {p,n}, L: {p,n} | null, mid }

  const points = m.points.map(pt => {
    const mid = !bilateral || isMid(pt.at)
    const R = place(pt.at)
    const L = mid ? null : place(mirror(pt.at))
    placed[pt.id] = { R, L, mid }
    const out = {
      id: pt.id, name: pt.name, pt: pt.pt,
      ...(pt.code ? { code: pt.code } : {}),
      ...(pt.cat ? { cat: pt.cat } : {}),
      loc: pt.loc, ind: pt.ind,
      p: [...R.p.map(r4), ...R.n.map(r4)]
    }
    if (L) out.pl = [...L.p.map(r4), ...L.n.map(r4)]
    return out
  })

  const paths = []
  for (const spec of m.paths || []) {
    const sideOf = left => spec.map(a => {
      if (typeof a === 'string') {
        const pp = placed[a]
        if (!pp) throw new Error(`Ponto ${a} não existe em ${m.id}`)
        return left && pp.L ? pp.L : pp.R
      }
      return place(left ? mirror(a.w) : a.w, 0.0025)
    })
    const onlyMid = spec.every(a => typeof a === 'string' ? placed[a].mid : isMid(a.w))
    paths.push({ r: surfacePath(sideOf(false)).flat() })
    if (bilateral && !onlyMid) paths[paths.length - 1].l = surfacePath(sideOf(true)).flat()
  }

  return {
    id: m.id, name: m.name, color: m.color, element: m.element, hours: m.hours, desc: m.desc,
    bilateral, points, paths
  }
})

// Protocolos: confere se todos os pontos existem
const allIds = new Set(meridians.flatMap(m => m.points.map(p => p.id)))
for (const pr of PROTOCOLS) for (const id of pr.points) {
  if (!allIds.has(id)) throw new Error(`Protocolo ${pr.id}: ponto ${id} não existe`)
}

const header = `// ARQUIVO GERADO por tools/acupoints/build.mjs — não edite à mão.
// Edite tools/acupoints/specs.mjs e rode: npm run build:acupoints
//
// Pontos: p = [x, y, z, nx, ny, nz] do lado DIREITO do paciente (X negativo);
//         pl = o mesmo do lado esquerdo (id + '-E'). Ausente nos pontos da linha média.
// Trajetos: arrays planos [x, y, z, x, y, z, ...] — r = direito, l = esquerdo.
`
const js = header +
  `export const ACU_MERIDIANS = ${JSON.stringify(meridians)}\n\n` +
  `export const ACU_PROTOCOLS = ${JSON.stringify(PROTOCOLS, null, 2)}\n`

const outFile = path.join(root, 'public', 'js', 'acu-data.js')
fs.writeFileSync(outFile, js)
const nPts = meridians.reduce((s, m) => s + m.points.length, 0)
console.log(`✓ ${nPts} pontos em ${meridians.length} grupos → ${path.relative(root, outFile)} ` +
            `(${(js.length / 1024).toFixed(0)} KB, ${((Date.now() - t0) / 1000).toFixed(1)} s)`)
