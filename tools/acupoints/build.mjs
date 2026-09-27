// Gera os dados dos pontos de acupuntura para cada corpo 3D.
//
//   npm run build:acupoints
//
// • Base     (tools/acupoints/human-body.glb) → public/js/acu-data.js (pontos + textos + protocolos)
// • Masculino (body-male.glb)   → public/js/acu-geo-male.js   (só geometria)
// • Feminino  (body-female.glb) → public/js/acu-geo-female.js (só geometria)
//
// As especificações (specs.mjs) são escritas para o modelo-base — o antigo corpo
// "clássico", que saiu do sistema e ficou só aqui como referência. Para o
// masculino, cada posicionamento é redirecionado segmento a segmento
// (retarget.mjs). O feminino tem a MESMA topologia do masculino (MakeHuman):
// cada ponto é "amarrado" ao triângulo da malha masculina e reaplicado na
// feminina — correspondência anatômica exata entre os dois.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadBody, surface, applyBind, lineHits } from './mesh.mjs'
import { MERIDIANS, PROTOCOLS } from './specs.mjs'
import { classicLandmarks, mhLandmarks, makeRetarget } from './retarget.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const models = path.join(root, 'public', 'models')
const r4 = x => Math.round(x * 10000) / 10000
const t0 = Date.now()

// ── Espelhamento ──────────────────────────────────────────────────────────────
// Clássico: não é perfeitamente simétrico — o lado esquerdo está deslocado ~8 mm
// na mão e nas pernas (medido pelos centróides de cada região).
function classicOffset([x, y]) {
  if (Math.abs(x) > 0.58 && y > 0.9) return [0, 0.008, 0.008]   // mão
  if (y < 0.82) return [-0.008, 0, 0]                            // pernas e pés
  return [0, 0, 0]
}
const mirrorWith = offsetFn => pl => {
  const o = offsetFn(pl.target)
  return {
    ...pl,
    target: [-pl.target[0] + o[0], pl.target[1] + o[1], pl.target[2] + o[2]],
    dir: [-pl.dir[0], pl.dir[1], pl.dir[2]]
  }
}
const isMid = pl => Math.abs(pl.target[0]) < 1e-9 && Math.abs(pl.dir[0]) < 1e-9

// ── Geração para um corpo ────────────────────────────────────────────────────
// retarget: leva o posicionamento do lado direito do clássico para este corpo
// mirror:   gera o lado esquerdo a partir do direito (já neste corpo)
function generate(body, retarget, mirror) {
  const place = (pl, lift = 0.004) => {
    // Sem interseção na direção pedida (acontece em estruturas finas, como a
    // mão, após o redirecionamento): usa o ponto da pele mais próximo do alvo
    return surface(body, pl.target, pl.dir, { mode: pl.mode, lift }) ||
           surface(body, pl.target, pl.dir, { mode: 'snap', lift })
  }

  // Trajeto entre âncoras: interpola a corda e projeta cada amostra na pele
  // ao longo da normal interpolada
  const surfacePath = anchors => {
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
        if (s === 0) { out.push(A); continue }
        if (s === steps) { out.push(B); continue }
        const hit = surface(body, p, n, { mode: 'near', lift: 0.0025 })
        const ok = hit && Math.hypot(hit.p[0] - p[0], hit.p[1] - p[1], hit.p[2] - p[2]) < 0.06
        out.push(ok ? hit : surface(body, p, n, { mode: 'snap', lift: 0.0025 }))
      }
    }
    return out
  }

  return MERIDIANS.map(m => {
    const bilateral = m.bilateral !== false
    const placed = {}
    const points = m.points.map(pt => {
      const mid = !bilateral || isMid(pt.at)
      const right = retarget(pt.at)
      if (mid) { right.target = [0, right.target[1], right.target[2]]; right.dir = [0, right.dir[1], right.dir[2]] }
      const R = place(right)
      const L = mid ? null : place(mirror(right))
      placed[pt.id] = { R, L, mid }
      return { pt, R, L }
    })
    const paths = []
    for (const spec of m.paths || []) {
      const onlyMid = spec.every(a => typeof a === 'string' ? placed[a].mid : isMid(a.w))
      const sideOf = left => spec.map(a => {
        if (typeof a === 'string') {
          const pp = placed[a]
          if (!pp) throw new Error(`Ponto ${a} não existe em ${m.id}`)
          return left && pp.L ? pp.L : pp.R
        }
        let w = retarget(a.w)
        if (isMid(a.w)) { w = { ...w, target: [0, w.target[1], w.target[2]], dir: [0, w.dir[1], w.dir[2]] } }
        return place(left ? mirror(w) : w, 0.0025)
      })
      const path = { r: surfacePath(sideOf(false)) }
      if (bilateral && !onlyMid) path.l = surfacePath(sideOf(true))
      paths.push(path)
    }
    return { m, bilateral, points, paths }
  })
}

const vec6 = s => [...s.p.map(r4), ...s.n.map(r4)]
const flat = arr => arr.flatMap(s => s.p.map(r4))

// Somente geometria (os textos ficam no acu-data.js do clássico)
function geometryJs(gen, label) {
  const geo = gen.map(({ m, points, paths }) => ({
    id: m.id,
    points: points.map(({ pt, R, L }) => (L ? { id: pt.id, p: vec6(R), pl: vec6(L) } : { id: pt.id, p: vec6(R) })),
    paths: paths.map(p => (p.l ? { r: flat(p.r), l: flat(p.l) } : { r: flat(p.r) }))
  }))
  return `// ARQUIVO GERADO por tools/acupoints/build.mjs — não edite à mão.\n` +
    `// Geometria dos pontos e meridianos no corpo ${label} (mesmo formato de acu-data.js).\n` +
    `export const ACU_GEOMETRY = ${JSON.stringify(geo)}\n`
}

function write(name, js) {
  fs.writeFileSync(path.join(root, 'public', 'js', name), js)
  console.log(`✓ public/js/${name} (${(js.length / 1024).toFixed(0)} KB)`)
}

// ── 1. Clássico ──────────────────────────────────────────────────────────────
const classicBody = loadBody(path.join(path.dirname(fileURLToPath(import.meta.url)), 'human-body.glb'))
const classic = generate(classicBody, pl => pl, mirrorWith(classicOffset))
const meridians = classic.map(({ m, bilateral, points, paths }) => ({
  id: m.id, name: m.name, color: m.color, element: m.element, hours: m.hours, desc: m.desc,
  bilateral,
  points: points.map(({ pt, R, L }) => {
    const out = {
      id: pt.id, name: pt.name, pt: pt.pt,
      ...(pt.code ? { code: pt.code } : {}),
      ...(pt.cat ? { cat: pt.cat } : {}),
      loc: pt.loc, ind: pt.ind,
      p: vec6(R)
    }
    if (L) out.pl = vec6(L)
    return out
  }),
  paths: paths.map(p => (p.l ? { r: flat(p.r), l: flat(p.l) } : { r: flat(p.r) }))
}))

const allIds = new Set(meridians.flatMap(m => m.points.map(p => p.id)))
for (const pr of PROTOCOLS) for (const id of pr.points) {
  if (!allIds.has(id)) throw new Error(`Protocolo ${pr.id}: ponto ${id} não existe`)
}

write('acu-data.js', `// ARQUIVO GERADO por tools/acupoints/build.mjs — não edite à mão.
// Edite tools/acupoints/specs.mjs e rode: npm run build:acupoints
//
// Pontos: p = [x, y, z, nx, ny, nz] do lado DIREITO do paciente (X negativo);
//         pl = o mesmo do lado esquerdo (id + '-E'). Ausente nos pontos da linha média.
// Trajetos: arrays planos [x, y, z, x, y, z, ...] — r = direito, l = esquerdo.
` + `export const ACU_MERIDIANS = ${JSON.stringify(meridians)}\n\n` +
  `export const ACU_PROTOCOLS = ${JSON.stringify(PROTOCOLS, null, 2)}\n`)

// ── 2. Masculino realista (redirecionado do clássico) ───────────────────────
const maleGlb = path.join(models, 'body-male.glb')
if (fs.existsSync(maleGlb)) {
  const maleBody = loadBody(maleGlb, { meshName: 'body', normalize: false })
  const J = JSON.parse(fs.readFileSync(path.join(models, 'body-male.joints.json'), 'utf8'))
  const retarget = makeRetarget(classicLandmarks(classicBody), mhLandmarks(maleBody, J))
  const male = generate(maleBody, retarget, mirrorWith(() => [0, 0, 0]))
  write('acu-geo-male.js', geometryJs(male, 'masculino realista'))

  // ── 3. Feminino: mesmas amarrações, outra malha ──────────────────────────
  const femaleGlb = path.join(models, 'body-female.glb')
  if (fs.existsSync(femaleGlb)) {
    const femaleBody = loadBody(femaleGlb, { meshName: 'body', normalize: false })
    // Confere se o ponto amarrado ficou na pele (triângulos que colapsam na
    // fenda glútea, p. ex., geram normal ruim) — se não, usa a pele mais próxima
    const rebind = s => {
      const r = applyBind(femaleBody, s.bind)
      const h = lineHits(femaleBody, r.p, r.n)
      const d = h.length ? Math.min(...h.map(x => Math.abs(x.t))) : 1
      return d < 0.008 ? r : surface(femaleBody, r.p, s.n, { mode: 'snap', lift: s.bind.lift })
    }
    const female = male.map(g => ({
      ...g,
      points: g.points.map(({ pt, R, L }) => ({ pt, R: rebind(R), L: L && rebind(L) })),
      paths: g.paths.map(p => (p.l ? { r: p.r.map(rebind), l: p.l.map(rebind) } : { r: p.r.map(rebind) }))
    }))
    write('acu-geo-female.js', geometryJs(female, 'feminino realista'))
  }
}

console.log(`${allIds.size} pontos · ${((Date.now() - t0) / 1000).toFixed(1)} s`)
