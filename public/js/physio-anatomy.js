import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { tissueShader, LOOK } from '/js/anatomy-real.js'

// ─── Anatomia interna (Anatomia 3D / fisioterapia) ───────────────────────────
// Ossos e músculos são os reais (BodyParts3D, ctx.real — ver anatomy-real.js),
// já encaixados no corpo. O que o atlas não tem — ligamentos, meniscos,
// cartilagens, tendões, bursas, cápsulas, nervos e as lesões — é montado em
// código com formas simples (tornos, cápsulas, tubos e superfícies) e preso à
// superfície dos ossos reais (snap / shell). Sem a anatomia real (falha no
// carregamento), cada osso e músculo volta à forma procedural de antes.
//
// O referencial de cada modelo vem das juntas do esqueleto (joints.json) e de
// raios lançados de dentro para a pele (espessura real do membro no ponto).
//
// Estilo: atlas realista — osso marfim, cartilagem branco-azulada, ligamento e
// tendão perolados, nervo amarelo, músculo vermelho (translúcido nas
// articulações). Lesões pulsam em vermelho; fissuras, desgaste e inchaço são
// feitos no shader (tear / wear) ou por escala, sem trocar a geometria.
//
// Unidades: metros. Os modelos de articulação são desenhados num referencial
// local (x = lateral, y = para cima / ao longo do osso, z = frente) com escala
// k = tamanho do membro deste corpo ÷ tamanho de referência.

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const Y = V(0, 1, 0)
const lerpV = (a, b, t) => a.clone().lerp(b, t)

// ─── Tecidos ─────────────────────────────────────────────────────────────────
// look: aparência do tecido em anatomy-real.js (translucidez, fibras, brilho úmido)
export const KINDS = {
  bone:      { color: 0xe3d5b8, opacity: 1,    rim: 0xfff0d8, rimK: 0.08, order: 1, depthWrite: true, look: 'bone' },
  cartilage: { color: 0xc4dae6, opacity: 0.9,  rim: 0xe8f6ff, rimK: 0.16, order: 2, depthWrite: true, look: 'cartilage' },
  meniscus:  { color: 0xe6eaec, opacity: 0.97, rim: 0xffffff, rimK: 0.14, order: 2, depthWrite: true, look: 'cartilage' },
  disc:      { color: 0xcbd9e6, opacity: 0.97, rim: 0xe8f4ff, rimK: 0.14, order: 2, depthWrite: true, look: 'disc' },
  ligament:  { color: 0xdcd5c2, opacity: 0.98, rim: 0xffffff, rimK: 0.14, order: 3, depthWrite: true, look: 'ligament' },
  tendon:    { color: 0xe8e2d6, opacity: 0.98, rim: 0xffffff, rimK: 0.14, order: 3, depthWrite: true, look: 'tendon' },
  nerve:     { color: 0xf0cc58, opacity: 1,    rim: 0xfff0a0, rimK: 0.22, order: 3, depthWrite: true, emissive: 0x2a1c00, look: 'nerve' },
  fascia:    { color: 0xe3e0d8, opacity: 0.92, rim: 0xffffff, rimK: 0.14, order: 3, depthWrite: true, look: 'tendon' },
  deposit:   { color: 0xfafaf2, opacity: 1,    rim: 0xffffff, rimK: 0.5,  order: 2, depthWrite: true, emissive: 0x404040, look: 'tooth' },
  muscle:    { color: 0xa8322f, opacity: 0.36, rim: 0xff7a68, rimK: 0.2,  order: 4, lesionA: 0.55, look: 'muscle' },
  bursa:     { color: 0x9cc8dc, opacity: 0.5,  rim: 0xd8f4ff, rimK: 0.4,  order: 4, lesionA: 0.7, look: 'bursa' },
  capsule:   { color: 0xdfe8ea, opacity: 0.14, rim: 0xf0ffff, rimK: 0.35, order: 5, lesionA: 0.4, look: 'capsule' }
}

// Ruído de valor 3D (fissuras irregulares e desgaste)
const NOISE = `
float phyH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float phyN(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(phyH(i), phyH(i + vec3(1,0,0)), f.x), mix(phyH(i + vec3(0,1,0)), phyH(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(phyH(i + vec3(0,0,1)), phyH(i + vec3(1,0,1)), f.x), mix(phyH(i + vec3(0,1,1)), phyH(i + vec3(1,1,1)), f.x), f.y), f.z);
}`

// Uniforms compartilhados por todos os tecidos de um modelo
export function sharedUniforms() {
  return {
    uTime: { value: 0 },
    uFocus: { value: new THREE.Vector4(0, 0, 0, 1e3) },      // centro + raio: esmaece fora da região
    uRevealO: { value: V() }, uRevealN: { value: V(0, 1, 0) }, uReveal: { value: 1e3 }  // "materialização" por varredura
  }
}

export function tissueMaterial(kind, shared, { side = THREE.FrontSide, opacity = null, axis = null } = {}) {
  const K = KINDS[kind]
  const look = LOOK[K.look] || {}
  const op = opacity ?? K.opacity
  const m = new THREE.MeshPhysicalMaterial({
    color: K.color, roughness: look.rough ?? 0.42, metalness: 0, transparent: true, opacity: op,
    depthWrite: !!K.depthWrite || op > 0.8, emissive: K.emissive ?? 0x000000, side, envMapIntensity: 0.8,
    clearcoat: look.wet || 0, clearcoatRoughness: 0.35
  })
  m.userData.opacity = op
  const u = {
    uTime: shared.uTime, uFocus: shared.uFocus, uRevealO: shared.uRevealO, uRevealN: shared.uRevealN, uReveal: shared.uReveal,
    uRimColor: { value: new THREE.Color(K.rim) }, uRimK: { value: K.rimK },
    uLesion: { value: 0 }, uLesionColor: { value: new THREE.Color(0xff2a1a) },
    uTearOn: { value: 0 }, uTearP: { value: new THREE.Vector4(0, 0, 0, 0.001) }, uTearN: { value: V(0, 1, 0) }, uTearR: { value: 1 },
    uWear: { value: 0 }, uDim: { value: 0 }, uHover: { value: 0 }, uLesionA: { value: K.lesionA ?? 0.85 },
    uDimA: { value: op > 0.8 ? 0 : 0.6 }   // esmaecer: os opacos só escurecem (a lesão brilha através deles)
  }
  m.userData.u = u
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vLPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvLPos = transformed;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime, uLesion, uTearOn, uTearR, uWear, uDim, uDimA, uHover, uRimK, uReveal, uLesionA;
uniform vec3 uRimColor, uLesionColor, uTearN, uRevealO, uRevealN;
uniform vec4 uTearP, uFocus;
varying vec3 vWPos;
varying vec3 vLPos;
${NOISE}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
float phyFk = 1.0 - smoothstep(uFocus.w * 0.6, uFocus.w, length(vWPos - uFocus.xyz));
if (phyFk < 0.01) discard;
float phyRv = dot(vWPos - uRevealO, uRevealN) - uReveal;
if (phyRv > 0.0) discard;
float phyReveal = 1.0 - smoothstep(0.0, 0.006, -phyRv);
float phyTear = 0.0;
if (uTearOn > 0.01) {
  vec3 dp = vLPos - uTearP.xyz;
  float td = dot(dp, uTearN);
  float lat = length(dp - td * uTearN);
  float jag = uTearP.w * 1.4 * (phyN(vLPos * 900.0) - 0.5);
  float inside = 1.0 - smoothstep(uTearR * 0.75, uTearR, lat);
  float gap = abs(td + jag) - uTearP.w * uTearOn * inside;
  if (gap < 0.0) discard;
  phyTear = inside * (1.0 - smoothstep(0.0, uTearP.w * 1.8, gap)) * uTearOn;
}
float phyWear = 0.0;
if (uWear > 0.01) {
  float n = phyN(vLPos * 420.0) * 0.65 + phyN(vLPos * 1100.0) * 0.35;
  float th = uWear * 0.55;
  if (n < th) discard;
  phyWear = (1.0 - smoothstep(0.0, 0.08, n - th)) * uWear;
}`)
      .replace('#include <opaque_fragment>', `
vec3 phyV = normalize(vViewPosition);
float phyFres = pow(1.0 - abs(dot(normalize(normal), phyV)), 2.0);
outgoingLight += uRimColor * phyFres * uRimK;
float phyPulse = 0.5 + 0.5 * sin(uTime * 4.0);
outgoingLight = mix(outgoingLight, uLesionColor * (0.55 + 0.6 * phyFres + 0.35 * phyPulse), uLesion * 0.72);
outgoingLight += uLesionColor * uLesion * (0.25 + 0.45 * phyPulse);
outgoingLight += uLesionColor * (phyTear + phyWear) * 2.2;
outgoingLight += vec3(0.55, 0.95, 1.0) * phyReveal * 2.5;
outgoingLight += vec3(0.4, 0.85, 1.0) * uHover * (0.3 + 0.6 * phyFres);
outgoingLight *= 1.0 - uDim * 0.55;
diffuseColor.a *= 1.0 - uDim * uDimA;
diffuseColor.a = max(diffuseColor.a, max(uLesion * uLesionA, max(phyTear, phyWear)));
diffuseColor.a = max(diffuseColor.a, phyReveal) * phyFk;
#include <opaque_fragment>`)
  }
  // aparência do tecido real (oclusão, translucidez, fibras) por baixo dos efeitos
  return tissueShader(m, K.look, { axis, extra: { key: 'phy' } })
}

// Atributos que o material de tecido lê (as peças procedurais não têm oclusão assada)
function ensureAttrs(g) {
  const n = g.attributes.position.count
  if (!g.attributes.ao) g.setAttribute('ao', new THREE.BufferAttribute(new Uint8Array(n).fill(235), 1, true))
  if (!g.attributes.tn) g.setAttribute('tn', new THREE.BufferAttribute(new Uint8Array(n), 1, true))
  if (!g.index) g.setIndex([...Array(n).keys()])
  return g
}

// Direção principal (fibras) de uma geometria
function mainAxis(g) {
  const P = g.attributes.position, n = P.count, step = Math.max(1, Math.floor(n / 1500))
  const c = V(), p = V()
  let k = 0
  for (let i = 0; i < n; i += step) { c.add(p.fromBufferAttribute(P, i)); k++ }
  c.multiplyScalar(1 / k)
  const C = [0, 0, 0, 0, 0, 0]
  for (let i = 0; i < n; i += step) {
    p.fromBufferAttribute(P, i).sub(c)
    C[0] += p.x * p.x; C[1] += p.x * p.y; C[2] += p.x * p.z; C[3] += p.y * p.y; C[4] += p.y * p.z; C[5] += p.z * p.z
  }
  const v = V(1, 1, 1)
  for (let it = 0; it < 24; it++) {
    v.set(C[0] * v.x + C[1] * v.y + C[2] * v.z, C[1] * v.x + C[3] * v.y + C[4] * v.z, C[2] * v.x + C[4] * v.y + C[5] * v.z).normalize()
  }
  return v
}

// ─── Geometria ───────────────────────────────────────────────────────────────

const quatTo = (dir, from = Y) => new THREE.Quaternion().setFromUnitVectors(from, dir.clone().normalize())
const quatE = e => new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0], e[1], e[2]))

function flipWinding(g) {
  const ix = g.index
  for (let i = 0; i < ix.count; i += 3) { const a = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, a) }
  ix.needsUpdate = true
}
// Aplica uma matriz (inclusive espelhada) mantendo as faces para fora
function bake(g, m) {
  g.applyMatrix4(m)
  if (m.determinant() < 0) flipWinding(g)
  return g
}

function ellipsoid(c, rx, ry = rx, rz = rx, rot = null, seg = 26) {
  const g = new THREE.SphereGeometry(1, seg, Math.round(seg * 0.7))
  g.scale(rx, ry, rz)
  if (rot) g.applyQuaternion(rot.isQuaternion ? rot : quatE(rot))
  g.translate(c.x, c.y, c.z)
  return g
}

function capsule(a, b, r, seg = 14) {
  const L = Math.max(a.distanceTo(b), 1e-4)
  const g = new THREE.CapsuleGeometry(r, L, 6, seg)
  g.applyQuaternion(quatTo(b.clone().sub(a)))
  const m = lerpV(a, b, 0.5)
  g.translate(m.x, m.y, m.z)
  return g
}

// Osso longo girado a partir de um perfil [[raio, distância ao longo do eixo], ...]
function lathe(a, dir, profile, { sx = 1, sz = 1, seg = 28 } = {}) {
  const pts = new THREE.SplineCurve(profile.map(([r, y]) => new THREE.Vector2(r, y))).getPoints(Math.max(36, profile.length * 10))
  pts.forEach(p => { p.x = Math.max(0, p.x) })
  const g = new THREE.LatheGeometry(pts, seg)
  g.scale(sx, 1, sz)
  g.applyQuaternion(quatTo(dir))
  g.translate(a.x, a.y, a.z)
  return g
}

// Tubo por pontos, com raio variando (r0 → r1), "barriga" (músculo fusiforme)
// e pontas afinadas
// wide: direção em que o tubo fica largo; ratio: espessura ÷ largura (tendões em faixa)
function tube(points, r0, r1 = r0, { belly = 0, ends = 0, seg = 40, radial = 12, wide = null, ratio = 1 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal')
  const g = new THREE.TubeGeometry(curve, seg, 1, radial, false)
  const pos = g.attributes.position, c = V(), v = V()
  const Wd = wide ? wide.clone().normalize() : null
  for (let i = 0; i <= seg; i++) {
    const t = i / seg
    curve.getPointAt(t, c)
    let r = r0 + (r1 - r0) * t
    if (belly) r *= 1 + belly * Math.sin(Math.PI * t)
    if (ends) r *= 0.18 + 0.82 * Math.sqrt(Math.max(0, Math.min(1, t / ends, (1 - t) / ends)))
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j
      v.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r)
      if (Wd) { const d = v.dot(Wd); v.addScaledVector(Wd, -d).multiplyScalar(ratio).addScaledVector(Wd, d) }
      v.add(c)
      pos.setXYZ(k, v.x, v.y, v.z)
    }
  }
  pos.needsUpdate = true
  if (Wd) g.computeVertexNormals()
  return g
}

// Arco de toro no plano XZ (meniscos, lábio, anéis), achatado em Y
function torusArc(c, R, r, arc, rotZ = 0, flatY = 1) {
  const g = new THREE.TorusGeometry(R, r, 10, 56, arc)
  g.rotateZ(rotZ)
  g.rotateX(-Math.PI / 2)
  g.scale(1, flatY, 1)
  g.translate(c.x, c.y, c.z)
  return g
}

// Osteófito: pequeno "bico" ósseo com a base em p apontando para dir
function spike(p, dir, len, r) {
  const g = new THREE.ConeGeometry(r, len, 10)
  g.translate(0, len / 2, 0)
  g.applyQuaternion(quatTo(dir))
  g.translate(p.x, p.y, p.z)
  return g
}

// Superfície paramétrica fn(u, v) → Vector3 (lâminas ósseas: escápula, ílio)
function surface(fn, nu = 16, nv = 16) {
  const g = new THREE.PlaneGeometry(1, 1, nu, nv)
  const pos = g.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const p = fn(pos.getX(i) + 0.5, pos.getY(i) + 0.5)
    pos.setXYZ(i, p.x, p.y, p.z)
  }
  g.computeVertexNormals()
  return g
}

const frameM = (o, x, y, z, k) =>
  new THREE.Matrix4().makeBasis(x.clone().multiplyScalar(k), y.clone().multiplyScalar(k), z.clone().multiplyScalar(k)).setPosition(o)

// ─── Montagem de um modelo ───────────────────────────────────────────────────

class Build {
  constructor(ctx, matrix = null) {
    this.ctx = ctx
    this.group = new THREE.Group()
    this.group.matrixAutoUpdate = false
    if (matrix) this.group.matrix.copy(matrix)
    this.group.matrixWorldNeedsUpdate = true
    this.inv = this.group.matrix.clone().invert()
    this.parts = []
    this.custom = {}
  }
  L(w) { return w.clone().applyMatrix4(this.inv) }            // ponto do mundo → local
  Ld(d) { return d.clone().transformDirection(this.inv) }     // direção do mundo → local

  // Estrutura: id, nome exibido, tecido e geometrias (fundidas numa malha).
  // Chamar de novo com o mesmo id acrescenta outra camada (ex.: músculo + tendão).
  // o.minor → rótulo só aparece quando a estrutura está afetada ou sob o mouse
  // o.extra → só aparece quando uma condição a mostra (hérnia, cisto, esporão…)
  // o.opacity → opacidade própria (ex.: músculos de contexto mais apagados)
  part(id, label, kind, geos, o = {}) {
    const list = (Array.isArray(geos) ? geos : [geos]).filter(Boolean).map(g => { g.deleteAttribute('uv'); return ensureAttrs(g) })
    if (!list.length) return null
    const geo = list.length > 1 ? mergeGeometries(list) : list[0]
    const mesh = new THREE.Mesh(geo, tissueMaterial(kind, this.ctx.shared, { side: o.side, opacity: o.opacity, axis: mainAxis(geo) }))
    mesh.renderOrder = KINDS[kind].order
    let p = this.parts.find(x => x.id === id)
    if (!p) {
      p = { id, label, kind, meshes: [], extra: !!o.extra, minor: !!o.minor,
            anchor: o.anchor || null, tear: o.tear || null, thin: o.thin || 'y', shift: o.shift || null }
      this.parts.push(p)
    } else if (o.tear && !p.tear) p.tear = o.tear
    if (o.level != null) mesh.userData.level = o.level
    mesh.userData.part = p
    p.meshes.push(mesh)
    this.group.add(mesh)
    if (!p.anchor) { geo.computeBoundingSphere(); p.anchor = geo.boundingSphere.center.clone() }
    return p
  }

  // ── Anatomia real ──
  // Peça real (nome em inglês do BodyParts3D, sem lado) no referencial local.
  // side: 'D' | 'E' | null (linha média); padrão = lado da região
  realGeo(base, side = this.ctx.side) {
    const key = base + '|' + (side || '')
    this._rg ||= new Map()
    if (!this._rg.has(key)) {
      const p = this.ctx.real?.get(key) || (side && this.ctx.real?.get(base + '|'))
      this._rg.set(key, p ? bake(p.geometry.clone(), this.inv) : null)
    }
    const g = this._rg.get(key)
    return g ? g.clone() : null
  }
  hasReal(base, side) { return !!this.realGeo(base, side) }
  // names: ['femur', ['sacrum', null], …]; sem todas as peças reais usa o procedural
  realOr(id, label, kind, names, fallback, o = {}) {
    const geos = names.map(n => (Array.isArray(n) ? this.realGeo(n[0], n[1]) : this.realGeo(n)))
    const ok = geos.every(Boolean)
    if (ok) names.forEach(n => this.used.add(Array.isArray(n) ? n[0] + '|' + (n[1] || '') : n + '|' + (this.ctx.side || '')))
    return this.part(id, label, kind, ok ? geos : (fallback ? fallback() : []), { ...o, real: ok })
  }
  get used() { return (this._used ||= new Set()) }
  // Ponto mais próximo na superfície de um osso real (+ afastado pela normal)
  snap(base, p, push = 0, side) {
    const g = this.realGeo(base, side)
    if (!g) return p.clone()
    const P = g.attributes.position, N = g.attributes.normal, q = V()
    let best = -1, bd = Infinity
    for (let i = 0; i < P.count; i++) {
      const d = q.fromBufferAttribute(P, i).distanceToSquared(p)
      if (d < bd) { bd = d; best = i }
    }
    return V().fromBufferAttribute(P, best).addScaledVector(V().fromBufferAttribute(N, best).normalize(), push)
  }
  // Trajeto que acompanha a superfície: n pontos entre a e b, cada um levado
  // ao osso mais próximo (entre `bases`) e afastado `push` da superfície
  wrap(a, b, bases, push = 0.002, n = 6) {
    const out = [a]
    for (let i = 1; i < n; i++) {
      const p = lerpV(a, b, i / n)
      let best = null, bd = Infinity
      bases.forEach(bs => { const q = this.snap(bs, p, push); const d = q.distanceToSquared(p); if (d < bd) { bd = d; best = q } })
      out.push(best)
    }
    out.push(b)
    return out
  }
  // Casca sobre parte da superfície de um osso real (cartilagem articular):
  // filtro(p, n, box) escolhe os vértices; a casca fica `th` acima do osso
  shell(base, filter, th = 0.0018, side) {
    const g = this.realGeo(base, side)
    if (!g) return null
    g.computeBoundingBox()
    const box = g.boundingBox, P = g.attributes.position, N = g.attributes.normal, I = g.index
    const p = V(), n = V()
    const pass = new Uint8Array(P.count)
    for (let i = 0; i < P.count; i++) pass[i] = filter(p.fromBufferAttribute(P, i), n.fromBufferAttribute(N, i).normalize(), box) ? 1 : 0
    const map = new Int32Array(P.count).fill(-1), pos = [], idx = []
    for (let t = 0; t < I.count; t += 3) {
      const a = I.getX(t), b = I.getX(t + 1), c = I.getX(t + 2)
      if (!pass[a] || !pass[b] || !pass[c]) continue
      for (const i of [a, b, c]) {
        if (map[i] < 0) {
          map[i] = pos.length / 3
          p.fromBufferAttribute(P, i).addScaledVector(n.fromBufferAttribute(N, i).normalize(), th)
          pos.push(p.x, p.y, p.z)
        }
        idx.push(map[i])
      }
    }
    if (idx.length < 9) return null
    const out = new THREE.BufferGeometry()
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    out.setIndex(idx)
    out.computeVertexNormals()
    return out
  }
  // Pontos da superfície de um osso real que passam no filtro
  points(base, filter, side) {
    const g = this.realGeo(base, side)
    if (!g) return []
    g.computeBoundingBox()
    const P = g.attributes.position, N = g.attributes.normal, out = [], p = V(), n = V()
    for (let i = 0; i < P.count; i++) {
      p.fromBufferAttribute(P, i); n.fromBufferAttribute(N, i).normalize()
      if (filter(p, n, g.boundingBox)) out.push(p.clone())
    }
    return out
  }
  // Músculos reais em volta da região (contexto, mais apagados, rótulo no mouse)
  context(center, radius, { opacity = 0.18, skip = [] } = {}) {
    const side = this.ctx.side, c = center.clone().applyMatrix4(this.group.matrix)
    const k = new THREE.Vector3().setFromMatrixScale(this.group.matrix).x
    ;(this.ctx.realList || []).forEach(p => {
      if (p.layer !== 'muscles' || (p.side && side && p.side !== side)) return
      const key = p.base + '|' + (p.side || '')
      if (this.used.has(key) || skip.includes(p.base)) return
      if (p.c.distanceTo(c) > radius * k + p.r * 0.2) return
      this.used.add(key)
      this.part('ctx:' + key, p.label, p.kind === 'tendon' ? 'tendon' : 'muscle', bake(p.geometry.clone(), this.inv),
        { minor: true, opacity: p.kind === 'tendon' ? Math.min(0.9, opacity * 2.2) : opacity, real: true })
    })
  }

  done(center, radius, focusR, extra = {}) {
    const m = this.group.matrix
    const k = new THREE.Vector3().setFromMatrixScale(m).x
    return {
      group: this.group, parts: this.parts, custom: this.custom,
      center: center.clone().applyMatrix4(m), radius: radius * k, focusR: focusR * k, ...extra
    }
  }
}

// ─── Joelho ──────────────────────────────────────────────────────────────────
// Com os ossos reais: cartilagens são cascas sobre as faces articulares,
// meniscos sobre o platô tibial e ligamentos presos aos pontos de inserção.
function kneeReal(b, f, k) {
  const box = n => { const g = b.realGeo(n); g.computeBoundingBox(); return g.boundingBox }
  const fB = box('femur'), tB = box('tibia'), pB = box('patella')
  const fb = fB.min.y, tt = tB.max.y
  const pc = pB.getCenter(V())
  b.realOr('femur', 'Fêmur', 'bone', ['femur'], null, { anchor: V(0, fb + 0.06, 0) })
  b.realOr('tibia', 'Tíbia', 'bone', ['tibia'], null, { anchor: V(0, tt - 0.06, 0.012) })
  b.realOr('fibula', 'Fíbula', 'bone', ['fibula'], null, { minor: true, anchor: b.snap('fibula', V(0.04, tt - 0.035, -0.02)) })
  b.realOr('patela', 'Patela (rótula)', 'bone', ['patella'], null, { anchor: V(pc.x, pc.y, pB.max.z) })

  // Cartilagens: côndilos (embaixo e atrás) + tróclea (frente), platô, face de trás da patela
  b.part('cartFemoral', 'Cartilagem do fêmur', 'cartilage', b.shell('femur', (p, n) =>
    (p.y < fb + 0.032 && n.y < -0.2 && Math.abs(n.x) < 0.8) ||
    (p.y < fb + 0.05 && n.z > 0.4 && Math.abs(p.x - pc.x) < 0.026 && p.z > pc.z - 0.03) ||
    (p.y < fb + 0.042 && n.z < -0.45 && Math.abs(n.x) < 0.7), 0.0016), { minor: true, side: THREE.DoubleSide, anchor: V(pc.x, fb + 0.012, 0.014) })
  b.part('cartTibial', 'Cartilagem da tíbia', 'cartilage', b.shell('tibia', (p, n) => p.y > tt - 0.012 && n.y > 0.55, 0.0014),
    { minor: true, side: THREE.DoubleSide, anchor: V(tB.getCenter(V()).x, tt, tB.max.z - 0.012) })
  b.part('cartPatelar', 'Cartilagem da patela', 'cartilage', b.shell('patella', (p, n) => n.z < -0.35, 0.0014), { minor: true, side: THREE.DoubleSide })

  // Meniscos: um "C" sobre cada compartimento do platô (abertura para o centro)
  const plat = b.points('tibia', (p, n) => p.y > tt - 0.012 && n.y > 0.6)
  const cx = plat.reduce((s, p) => s + p.x, 0) / Math.max(1, plat.length)
  const comp = side => {
    const P = plat.filter(p => (side < 0 ? p.x < cx - 0.004 : p.x > cx + 0.004))
    const c = P.reduce((s, p) => s.add(p), V()).multiplyScalar(1 / Math.max(1, P.length))
    const R = Math.sqrt(P.reduce((s, p) => s + (p.x - c.x) ** 2 + (p.z - c.z) ** 2, 0) / Math.max(1, P.length)) * 1.25
    c.y = P.reduce((m, p) => Math.max(m, p.y), -1) + 0.0022
    return { c, R: THREE.MathUtils.clamp(R, 0.011, 0.02) }
  }
  const M = comp(-1), Lc = comp(1), aT = 2.15
  b.part('meniscoMedial', 'Menisco medial', 'meniscus', torusArc(M.c, M.R * 0.94, M.R * 0.32, Math.PI * 2 - 1.1, 0.55, 0.58), {
    anchor: V(M.c.x - M.R * 0.55, M.c.y, M.c.z + M.R * 0.5),
    tear: { p: V(M.c.x + M.R * Math.cos(aT), M.c.y, M.c.z - M.R * Math.sin(aT)), n: V(-Math.sin(aT), 0, -Math.cos(aT)), w: 0.0011, r: 0.007 }
  })
  b.part('meniscoLateral', 'Menisco lateral', 'meniscus', torusArc(Lc.c, Lc.R * 0.84, Lc.R * 0.3, Math.PI * 2 - 0.7, Math.PI + 0.35, 0.58),
    { anchor: V(Lc.c.x + Lc.R * 0.55, Lc.c.y, Lc.c.z + Lc.R * 0.5) })

  // Tendões do aparelho extensor: quadríceps → patela → tuberosidade da tíbia
  const pTop = b.snap('patella', V(pc.x, pB.max.y + 0.01, pc.z), 0.001), pBot = b.snap('patella', V(pc.x, pB.min.y - 0.01, pc.z + 0.003), 0.001)
  const tub = b.snap('tibia', V(cx, tt - 0.05, tB.max.z + 0.02), 0.0015)
  b.part('tendaoQuadriceps', 'Tendão do quadríceps', 'tendon',
    tube([pTop.clone().add(V(0, -0.004, -0.002)), pTop.clone().add(V(0, 0.035, -0.006)), pTop.clone().add(V(0, 0.1, -0.014))], 0.012, 0.018, { wide: V(1, 0, 0), ratio: 0.32 }),
    { minor: true, anchor: pTop.clone().add(V(0, 0.03, -0.004)) })
  const ptMid = lerpV(pBot, tub, 0.5).add(V(0, 0, 0.003))
  b.part('tendaoPatelar', 'Tendão patelar', 'tendon',
    tube([pBot.clone().add(V(0, 0.006, -0.002)), ptMid, tub], 0.0105, 0.009, { wide: V(1, 0, 0), ratio: 0.38 }), { anchor: ptMid.clone().add(V(0, 0, 0.004)) })

  // Ligamentos cruzados (no intercôndilo) e colaterais
  const lca0 = b.snap('femur', V(cx + 0.008, fb + 0.02, -0.014), 0.0015), lca1 = b.snap('tibia', V(cx - 0.002, tt + 0.004, M.c.z + 0.008), 0.0015)
  b.part('lca', 'Ligamento cruzado anterior (LCA)', 'ligament', tube([lca0, lerpV(lca0, lca1, 0.5).add(V(0, 0, 0.001)), lca1], 0.0034, 0.004), {
    tear: { p: lerpV(lca0, lca1, 0.45), n: lca1.clone().sub(lca0).normalize(), w: 0.0014, r: 0.01 }
  })
  const lcp0 = b.snap('femur', V(cx - 0.008, fb + 0.02, 0.002), 0.0015), lcp1 = b.snap('tibia', V(cx, tt - 0.008, tB.min.z + 0.004), 0.0015)
  b.part('lcp', 'Ligamento cruzado posterior (LCP)', 'ligament', tube([lcp0, lerpV(lcp0, lcp1, 0.5).add(V(0, 0, -0.002)), lcp1], 0.0038, 0.0042), { minor: true })
  // colateral medial: faixa larga e achatada, colada no fêmur e na tíbia, por cima do menisco
  const m0 = b.snap('femur', V(fB.min.x, fb + 0.035, -0.004), 0.002), m1 = b.snap('tibia', V(tB.min.x + 0.004, tt - 0.055, 0.006), 0.002)
  const mPath = b.wrap(m0, m1, ['femur', 'tibia'], 0.0032, 7)
  const mJ = mPath[Math.floor(mPath.length / 2)]
  mJ.x = Math.min(mJ.x, M.c.x - M.R - 0.003)
  b.part('lcm', 'Ligamento colateral medial', 'ligament',
    tube(mPath, 0.0062, 0.0055, { wide: V(0, 0, 1), ratio: 0.3, seg: 48 }), {
      anchor: mJ.clone().add(V(-0.004, 0, 0)), tear: { p: mJ.clone(), n: V(0, 1, 0), w: 0.0013, r: 0.011 }
    })
  // colateral lateral: cordão do epicôndilo lateral até a cabeça da fíbula
  const l0 = b.snap('femur', V(fB.max.x, fb + 0.03, -0.01), 0.002), l1 = b.snap('fibula', V(fB.max.x, tt - 0.02, -0.02), 0.002)
  const lPath = b.wrap(l0, l1, ['femur', 'tibia', 'fibula'], 0.0034, 5)
  b.part('lcl', 'Ligamento colateral lateral', 'ligament', tube(lPath, 0.003, 0.0028), { minor: true })

  // Osteófitos nas bordas das superfícies articulares (apontando para fora)
  const on = (base, p, up, len, r) => {
    const s = b.snap(base, p)
    return spike(s, V(Math.sign(p.x - cx), up, 0.2).normalize(), len, r)
  }
  b.part('osteofitos', 'Osteófitos ("bicos de papagaio")', 'bone', [
    on('femur', V(fB.min.x, fb + 0.01, -0.004), -0.3, 0.008, 0.0028), on('femur', V(fB.max.x, fb + 0.01, -0.006), -0.3, 0.008, 0.0028),
    on('tibia', V(tB.min.x, tt - 0.006, 0.002), 0.4, 0.007, 0.0026), on('tibia', V(tB.max.x, tt - 0.006, 0), 0.4, 0.007, 0.0026),
    spike(b.snap('patella', V(pc.x, pB.max.y, pc.z)), V(0, 1, 0.3), 0.006, 0.0024),
    spike(b.snap('patella', V(pc.x, pB.min.y, pc.z)), V(0, -1, 0.3), 0.006, 0.0024)
  ], { extra: true, anchor: V(fB.min.x, fb, 0) })
  b.part('cistoBaker', 'Cisto de Baker', 'bursa', ellipsoid(V(cx - 0.016, (fb + tt) / 2, -(f.halfD / k) + 0.02), 0.014, 0.021, 0.011), { extra: true })
  b.context(V(0, 0, 0), 0.16)
}

function knee(ctx) {
  const K = ctx.J(ctx.pre + 'knee'), Hp = ctx.J(ctx.pre + 'upper-leg'), A = ctx.J(ctx.pre + 'ankle')
  const f = ctx.fit(K, Hp.clone().sub(K))
  const k = THREE.MathUtils.clamp((f.halfW + f.halfD) / 2 / 0.056, 0.8, 1.2)
  const b = new Build(ctx, frameM(f.center, f.x, f.y, f.z, k))
  const qT = new THREE.Quaternion().setFromUnitVectors(V(0, -1, 0), b.Ld(A.clone().sub(K)))
  const low = v => v.clone().applyQuaternion(qT)
  const lowG = g => { g.applyQuaternion(qT); return g }
  const zP = THREE.MathUtils.clamp(f.halfD / k - 0.019, 0.032, 0.046)   // patela ~2 cm sob a pele

  if (b.hasReal('femur') && b.hasReal('tibia') && b.hasReal('fibula') && b.hasReal('patella')) {
    kneeReal(b, f, k)
    return b.done(V(0, 0.002, 0.004), 0.075, 0.125)
  }
  b.part('femur', 'Fêmur', 'bone', [
    lathe(V(0, 0.004, -0.004), Y, [[0, 0], [0.03, 0.008], [0.037, 0.025], [0.03, 0.05], [0.019, 0.085], [0.0145, 0.12], [0.0135, 0.2], [0.0135, 0.27], [0, 0.275]], { sx: 1.18, sz: 0.82 }),
    ellipsoid(V(-0.021, 0.015, -0.006), 0.019, 0.022, 0.027),
    ellipsoid(V(0.021, 0.016, -0.007), 0.018, 0.021, 0.026),
    ellipsoid(V(-0.041, 0.03, -0.006), 0.008, 0.01, 0.01),
    ellipsoid(V(0.04, 0.03, -0.008), 0.007, 0.009, 0.009)
  ], { anchor: V(0, 0.07, 0) })

  b.part('tibia', 'Tíbia', 'bone', [
    lathe(V(), Y, [[0, -0.28], [0.013, -0.275], [0.0125, -0.2], [0.014, -0.12], [0.019, -0.075], [0.031, -0.04], [0.038, -0.024], [0.039, -0.015], [0.02, -0.0125], [0, -0.0122]], { sx: 1.18, sz: 0.85 }),
    ellipsoid(V(0, -0.045, 0.022), 0.009, 0.015, 0.006),
    ellipsoid(V(0, -0.011, -0.001), 0.005, 0.004, 0.009)
  ].map(lowG), { anchor: low(V(0, -0.06, 0.01)) })

  b.part('fibula', 'Fíbula', 'bone', [
    ellipsoid(V(0.034, -0.034, -0.019), 0.009, 0.01, 0.009),
    tube([V(0.034, -0.036, -0.019), V(0.033, -0.15, -0.02), V(0.03, -0.28, -0.02)], 0.006, 0.0048)
  ].map(lowG), { minor: true, anchor: low(V(0.034, -0.05, -0.019)) })

  b.part('cartFemoral', 'Cartilagem do fêmur', 'cartilage', [
    ellipsoid(V(-0.021, 0.015, -0.006), 0.0205, 0.0235, 0.0285),
    ellipsoid(V(0.021, 0.016, -0.007), 0.0195, 0.0225, 0.0275)
  ], { minor: true, anchor: V(0, -0.004, 0.014) })
  b.part('cartTibial', 'Cartilagem da tíbia', 'cartilage', [
    ellipsoid(V(-0.02, -0.0118, -0.002), 0.017, 0.0022, 0.021),
    ellipsoid(V(0.02, -0.0118, -0.002), 0.016, 0.0022, 0.02)
  ].map(lowG), { minor: true, anchor: low(V(0, -0.012, 0.012)) })

  // Meniscos: "C" sobre o platô tibial, com a abertura voltada para o centro
  const mY = -0.0088, RM = 0.0155, RL = 0.0135, aT = 2.15
  const cM = V(-0.02, mY, -0.002)
  b.part('meniscoMedial', 'Menisco medial', 'meniscus', torusArc(cM, RM, 0.0052, Math.PI * 2 - 1.1, 0.55, 0.58), {
    anchor: V(-0.028, mY, 0.006),
    tear: { p: V(cM.x + RM * Math.cos(aT), mY, cM.z - RM * Math.sin(aT)), n: V(-Math.sin(aT), 0, -Math.cos(aT)), w: 0.0011, r: 0.007 }
  })
  b.part('meniscoLateral', 'Menisco lateral', 'meniscus', torusArc(V(0.02, mY, -0.002), RL, 0.005, Math.PI * 2 - 0.7, Math.PI + 0.35, 0.58), { anchor: V(0.028, mY, 0.006) })

  b.part('patela', 'Patela (rótula)', 'bone', ellipsoid(V(0, 0.03, zP), 0.021, 0.024, 0.0095, [0.12, 0, 0]), { anchor: V(0, 0.03, zP + 0.006) })
  b.part('cartPatelar', 'Cartilagem da patela', 'cartilage', ellipsoid(V(0, 0.03, zP - 0.0075), 0.0175, 0.02, 0.0042, [0.12, 0, 0]), { minor: true })
  b.part('tendaoQuadriceps', 'Tendão do quadríceps', 'tendon',
    tube([V(0, 0.05, zP - 0.003), V(0, 0.09, zP - 0.01), V(0, 0.16, zP - 0.02)], 0.013, 0.02, { wide: V(1, 0, 0), ratio: 0.3 }), { minor: true, anchor: V(0, 0.075, zP - 0.006) })
  const tt = low(V(0, -0.047, 0.027))
  b.part('tendaoPatelar', 'Tendão patelar', 'tendon',
    tube([V(0, 0.01, zP - 0.002), V(0, -0.02, (zP + tt.z) / 2 + 0.001), tt], 0.0115, 0.0095, { wide: V(1, 0, 0), ratio: 0.36 }), { anchor: V(0, -0.02, (zP + tt.z) / 2 + 0.004) })

  const lca0 = V(0.009, 0.012, -0.014), lca1 = low(V(-0.004, -0.012, 0.009))
  b.part('lca', 'Ligamento cruzado anterior (LCA)', 'ligament', tube([lca0, lerpV(lca0, lca1, 0.5).add(V(0, 0, 0.001)), lca1], 0.0034, 0.0038), {
    tear: { p: lerpV(lca0, lca1, 0.45), n: lca1.clone().sub(lca0).normalize(), w: 0.0014, r: 0.01 }
  })
  b.part('lcp', 'Ligamento cruzado posterior (LCP)', 'ligament', tube([V(-0.009, 0.016, 0.003), low(V(0, -0.014, -0.023))], 0.0038), { minor: true })
  b.part('lcm', 'Ligamento colateral medial', 'ligament',
    tube([V(-0.043, 0.034, -0.004), V(-0.046, 0.0, -0.001), low(V(-0.042, -0.035, 0.002)), low(V(-0.036, -0.064, 0.005))], 0.0042, 0.0038), {
      anchor: V(-0.047, 0, 0), tear: { p: V(-0.046, -0.002, -0.001), n: V(0, 1, 0), w: 0.0013, r: 0.008 }
    })
  b.part('lcl', 'Ligamento colateral lateral', 'ligament',
    tube([V(0.042, 0.03, -0.009), V(0.044, 0.0, -0.013), low(V(0.036, -0.03, -0.019))], 0.003), { minor: true })

  b.part('osteofitos', 'Osteófitos ("bicos de papagaio")', 'bone', [
    spike(V(-0.039, -0.002, -0.004), V(-1, -0.3, 0.2), 0.008, 0.0028),
    spike(V(0.038, -0.002, -0.006), V(1, -0.3, 0.2), 0.008, 0.0028),
    spike(low(V(-0.043, -0.017, 0.002)), V(-1, 0.4, 0), 0.007, 0.0026),
    spike(low(V(0.043, -0.017, 0.0)), V(1, 0.4, 0), 0.007, 0.0026),
    spike(V(0, 0.054, zP - 0.002), V(0, 1, 0.3), 0.006, 0.0024),
    spike(V(0, 0.006, zP - 0.002), V(0, -1, 0.3), 0.006, 0.0024)
  ], { extra: true, anchor: V(-0.043, -0.008, 0) })
  b.part('cistoBaker', 'Cisto de Baker', 'bursa', ellipsoid(V(-0.016, -0.004, -(f.halfD / k) + 0.02), 0.014, 0.021, 0.011), { extra: true })

  return b.done(V(0, 0.002, 0.004), 0.075, 0.125)
}

// Esfera que melhor passa pelos pontos (cabeça do úmero / do fêmur)
function sphereFit(P) {
  const M = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], r = [0, 0, 0, 0]
  P.forEach(p => {
    const a = [2 * p.x, 2 * p.y, 2 * p.z, 1], bb = p.x * p.x + p.y * p.y + p.z * p.z
    for (let i = 0; i < 4; i++) { r[i] += a[i] * bb; for (let j = 0; j < 4; j++) M[i][j] += a[i] * a[j] }
  })
  for (let i = 0; i < 4; i++) {          // eliminação de Gauss
    let mx = i
    for (let j = i + 1; j < 4; j++) if (Math.abs(M[j][i]) > Math.abs(M[mx][i])) mx = j
    ;[M[i], M[mx]] = [M[mx], M[i]]; [r[i], r[mx]] = [r[mx], r[i]]
    for (let j = i + 1; j < 4; j++) {
      const f = M[j][i] / (M[i][i] || 1e-12)
      for (let c = i; c < 4; c++) M[j][c] -= f * M[i][c]
      r[j] -= f * r[i]
    }
  }
  const x = [0, 0, 0, 0]
  for (let i = 3; i >= 0; i--) {
    let acc = r[i]
    for (let c = i + 1; c < 4; c++) acc -= M[i][c] * x[c]
    x[i] = acc / (M[i][i] || 1e-12)
  }
  const c = V(x[0], x[1], x[2])
  return { c, r: Math.sqrt(Math.max(1e-8, x[3] + c.lengthSq())) }
}
const centroid = P => P.reduce((s, p) => s.add(p), V()).multiplyScalar(1 / Math.max(1, P.length))
const boxOf = (b, base, side) => { const g = b.realGeo(base, side); if (!g) return null; g.computeBoundingBox(); return g.boundingBox }

// ─── Ombro (ossos e músculos reais) ──────────────────────────────────────────
function shoulderReal(b, arm, k) {
  const hB = boxOf(b, 'humerus')
  const top = b.points('humerus', p => p.y > hB.max.y - 0.05)
  const head = sphereFit(top.filter(p => p.distanceTo(V()) < 0.04))
  const hc = head.c, R = THREE.MathUtils.clamp(head.r, 0.018, 0.03)
  const T = v => v.clone().add(hc)
  b.realOr('umero', 'Úmero', 'bone', ['humerus'], null, { anchor: T(V(0.012, -0.03, 0.006)).addScaledVector(arm, 0.03) })
  b.realOr('escapula', 'Escápula', 'bone', ['scapula'], null, { anchor: b.snap('scapula', T(V(-0.07, -0.03, -0.066))) })
  b.realOr('clavicula', 'Clavícula', 'bone', ['clavicle'], null, { minor: true, anchor: b.snap('clavicle', T(V(-0.04, 0.042, 0.032))) })
  b.part('cartUmeral', 'Cartilagem da cabeça do úmero', 'cartilage', b.shell('humerus', (p, n) =>
    p.distanceTo(hc) < R * 1.08 && n.dot(p.clone().sub(hc).normalize()) > 0.6 && p.x - hc.x < R * 0.35, 0.0014), { minor: true, side: THREE.DoubleSide })

  // Manguito rotador: músculos reais; o tendão do supraespinal (onde rompe) é desenhado por cima
  const gt = b.snap('humerus', T(V(R * 0.75, R * 0.85, 0.004)), 0.0015)        // tubérculo maior
  const sp0 = T(V(-0.032, R + 0.016, -0.016))
  const supP = [sp0, T(V(-0.006, R + 0.012, -0.004)), lerpV(T(V(0, R + 0.01, 0)), gt, 0.6).add(V(0, 0.002, 0)), gt]
  b.part('supraespinal', 'Tendão do supraespinal', 'tendon', tube(supP, 0.006, 0.0048, { wide: V(0, 0, 1), ratio: 0.55 }), {
    anchor: supP[2].clone(), tear: { p: lerpV(supP[2], gt, 0.35), n: gt.clone().sub(supP[2]).normalize(), w: 0.0014, r: 0.02 }
  })
  b.realOr('supraespinal', null, 'muscle', ['supraspinatus'], null, { opacity: 0.55 })
  b.realOr('infraespinal', 'Infraespinal', 'muscle', ['infraspinatus muscle'], null, { minor: true, opacity: 0.5, anchor: b.snap('humerus', T(V(0.004, 0, -0.03)), 0.006) })
  b.realOr('subescapular', 'Subescapular', 'muscle', ['subscapularis'], null, { minor: true, opacity: 0.5, anchor: T(V(0, 0, 0.026)) })
  b.realOr('redondoMenor', 'Redondo menor', 'muscle', ['teres minor'], null, { minor: true, opacity: 0.5 })
  b.realOr('biceps', 'Bíceps (cabeça longa)', 'muscle', ['long head of biceps brachii'], null, { opacity: 0.75, anchor: b.snap('humerus', T(V(0.008, 0.006, 0.027)), 0.004) })

  // Bursa sob o acrômio, sobre o tendão; cápsula em volta da articulação
  const bt = top.filter(p => Math.abs(p.x - hc.x) < 0.012 && Math.abs(p.z - hc.z) < 0.012).reduce((m, p) => Math.max(m, p.y), hc.y + R)
  b.part('bursa', 'Bursa subacromial', 'bursa', ellipsoid(V(hc.x + 0.006, bt + 0.0065, hc.z - 0.002), 0.017, 0.0036, 0.0145))
  b.part('capsula', 'Cápsula articular', 'capsule', ellipsoid(T(V(-0.008, 0, 0)), R * 1.45, R * 1.42, R * 1.38), { minor: true, anchor: T(V(-0.01, -0.03, 0.02)) })
  b.part('calcificacao', 'Depósitos de cálcio', 'deposit', [
    ellipsoid(lerpV(supP[2], gt, 0.5).add(V(0, 0.002, 0)), 0.0034, 0.0028, 0.003),
    ellipsoid(supP[2].clone().add(V(-0.004, 0.002, -0.002)), 0.0024),
    ellipsoid(gt.clone().add(V(-0.001, 0.0025, 0.002)), 0.002)
  ], { extra: true })
  b.context(hc, 0.13, { opacity: 0.2 })
  return hc
}

// ─── Cotovelo (ossos e músculos reais) ───────────────────────────────────────
function elbowReal(b, fd) {
  const hB = boxOf(b, 'humerus'), rB = boxOf(b, 'radius'), uB = boxOf(b, 'ulna')
  const dist = b.points('humerus', p => p.y < hB.min.y + 0.045)
  const le = dist.reduce((m, p) => (p.x > m.x ? p : m), dist[0])        // epicôndilo lateral
  const me = dist.reduce((m, p) => (p.x < m.x ? p : m), dist[0])        // epicôndilo medial
  b.realOr('umero', 'Úmero', 'bone', ['humerus'], null, { anchor: V(0, hB.min.y + 0.05, 0) })
  b.realOr('radio', 'Rádio', 'bone', ['radius'], null, { anchor: b.snap('radius', V(rB.max.x, rB.max.y - 0.03, 0.005)) })
  b.realOr('ulna', 'Ulna', 'bone', ['ulna'], null, { anchor: b.snap('ulna', V(0, uB.max.y, uB.min.z)) })
  b.part('cartUmeral', 'Cartilagem do cotovelo', 'cartilage', b.shell('humerus', (p, n) =>
    p.y < hB.min.y + 0.018 && n.y < -0.25 && p.x < le.x - 0.006 && p.x > me.x + 0.008, 0.0014), { minor: true, side: THREE.DoubleSide })
  // ligamento anular em volta da cabeça do rádio
  const rh = b.points('radius', p => p.y > rB.max.y - 0.009)
  const rc = centroid(rh), rr = rh.reduce((m, p) => Math.max(m, Math.hypot(p.x - rc.x, p.z - rc.z)), 0)
  const ring = new THREE.TorusGeometry(rr + 0.0015, 0.0018, 8, 32)
  ring.applyQuaternion(quatTo(fd, V(0, 0, 1)))
  ring.translate(rc.x, rc.y - 0.004, rc.z)
  b.part('anular', 'Ligamento anular', 'ligament', ring, { minor: true })
  // tendões comuns: extensores (lateral) e flexores (medial)
  const ex1 = b.snap('radius', le.clone().addScaledVector(fd, 0.03).add(V(-0.004, 0, -0.004)), 0.006)
  b.part('tendaoExtensor', 'Tendão dos extensores (epicôndilo lateral)', 'tendon', tube([le.clone().add(V(0.001, 0, 0)), lerpV(le, ex1, 0.5).add(V(0.002, 0, 0)), ex1], 0.0045, 0.0052), {
    anchor: lerpV(le, ex1, 0.4), tear: { p: lerpV(le, ex1, 0.45), n: ex1.clone().sub(le).normalize(), w: 0.0012, r: 0.0034 }
  })
  b.realOr('extensores', 'Músculos extensores', 'muscle', EXT, null, { minor: true, opacity: 0.6 })
  const fx1 = me.clone().addScaledVector(fd, 0.028).add(V(0.005, 0, 0.006))
  b.part('tendaoFlexor', 'Tendão dos flexores (epicôndilo medial)', 'tendon', tube([me.clone().add(V(-0.001, 0, 0)), lerpV(me, fx1, 0.5).add(V(-0.002, 0, 0)), fx1], 0.0045, 0.0052), { anchor: lerpV(me, fx1, 0.4) })
  b.realOr('flexores', 'Músculos flexores', 'muscle', FLEX, null, { minor: true, opacity: 0.6 })
  // nervo ulnar: passa atrás do epicôndilo medial
  const un0 = me.clone().add(V(0.004, 0.13, -0.016)), un1 = me.clone().add(V(0.0, 0.02, -0.012))
  const un2 = me.clone().add(V(0.001, 0, -0.009)), un3 = me.clone().addScaledVector(fd, 0.03).add(V(0.004, 0, -0.012))
  b.part('nervoUlnar', 'Nervo ulnar', 'nerve', tube([un0, un1, un2, un3, un3.clone().addScaledVector(fd, 0.09).add(V(0.004, 0, 0.004))], 0.0026), { anchor: un2.clone() })
  const ol = b.snap('ulna', V((uB.min.x + uB.max.x) / 2, uB.max.y - 0.004, uB.min.z), 0.004)
  b.part('bursa', 'Bursa do olécrano', 'bursa', ellipsoid(ol, 0.011, 0.013, 0.0042))
  b.context(V(0, hB.min.y, 0), 0.13, { opacity: 0.22 })
}

// ─── Mão e punho: ossos, tendões e retináculo reais ──────────────────────────
const CARPALS = ['scaphoid', 'lunate', 'triquetral', 'pisiform', 'trapezium', 'trapezoid', 'capitate', 'hamate']
const METACARPALS = ['first', 'second', 'third', 'fourth', 'fifth'].map(o => o + ' metacarpal bone')
const FINGERS = ['index finger', 'middle finger', 'ring finger', 'little finger']
const PHALANGES = [...FINGERS.flatMap(f => ['proximal', 'middle', 'distal'].map(s => `${s} phalanx of ${f}`)), 'proximal phalanx of thumb', 'distal phalanx of thumb']

// ─── Quadril (ossos e músculos reais) ────────────────────────────────────────
function hipReal(b, fem) {
  const fB = boxOf(b, 'femur')
  const head = sphereFit(b.points('femur', p => p.distanceTo(V()) < 0.03 && p.y > fB.max.y - 0.07))
  const hc = head.c, R = THREE.MathUtils.clamp(head.r, 0.018, 0.028)
  const T = v => v.clone().add(hc)
  b.realOr('femur', 'Fêmur', 'bone', ['femur'], null, { anchor: T(V(0.03, -0.03, 0.01)) })
  b.realOr('pelve', 'Pelve (acetábulo e ílio)', 'bone', ['hip bone'], null, { anchor: b.snap('hip bone', T(V(0.0, 0.1, 0.0))) })
  b.realOr('sacro', 'Sacro', 'bone', [['sacrum', null]], null, { minor: true })
  b.part('cartilagem', 'Cartilagem da articulação', 'cartilage', b.shell('femur', (p, n) =>
    p.distanceTo(hc) < R * 1.1 && n.dot(p.clone().sub(hc).normalize()) > 0.55, 0.0016), { anchor: T(V(0.012, 0.012, 0.014)).sub(hc).setLength(R).add(hc), side: THREE.DoubleSide })
  // lábio do acetábulo: anel na borda, voltado para fora/baixo/frente
  const open = V(1, -0.7, 0.35).normalize()
  const rimC = hc.clone().addScaledVector(open, -R * 1.08 * Math.cos(1.25))
  const lab = new THREE.TorusGeometry(R * 1.08 * Math.sin(1.25), 0.0024, 8, 56)
  lab.applyQuaternion(quatTo(open, V(0, 0, 1)))
  lab.translate(rimC.x, rimC.y, rimC.z)
  const up = V(0, 1, 0.6); up.addScaledVector(open, -up.dot(open)).normalize()
  const tearP = rimC.clone().addScaledVector(up, R * 1.08 * Math.sin(1.25))
  b.part('labio', 'Lábio acetabular', 'meniscus', lab, { anchor: tearP.clone(), tear: { p: tearP, n: open.clone().cross(up).normalize(), w: 0.0012, r: 0.006 } })
  // trocânter maior: bursa e inserção do glúteo médio
  const tr = b.points('femur', p => p.y > hc.y - 0.06 && p.x > hc.x + 0.03).reduce((m, p) => (p.x > m.x ? p : m), T(V(0.05, -0.02, -0.008)))
  b.part('bursa', 'Bursa trocantérica', 'bursa', ellipsoid(tr.clone().add(V(0.006, -0.008, -0.002)), 0.0045, 0.02, 0.016))
  b.realOr('gluteoMedio', 'Glúteo médio', 'muscle', ['gluteus medius'], null, { opacity: 0.45, anchor: tr.clone().add(V(-0.01, 0.03, -0.01)) })
  b.realOr('piriforme', 'Piriforme', 'muscle', ['piriformis'], null, { opacity: 0.6 })
  b.part('ciatico', 'Nervo ciático', 'nerve',
    tube([V(-0.088, 0.05, -0.07), V(-0.056, 0.0, -0.068), V(-0.026, -0.04, -0.06), V(-0.006, -0.12, -0.05), V(0.004, -0.25, -0.04)].map(T), 0.0045, 0.004), { anchor: T(V(-0.03, -0.03, -0.062)) })
  b.part('osteofitos', 'Osteófitos', 'bone', [
    spike(rimC.clone().addScaledVector(up, R * 1.15), up, 0.007, 0.0026),
    spike(b.snap('femur', T(V(0.018, 0.012, 0.004))), V(0.6, 1, 0.3), 0.006, 0.0024),
    spike(b.snap('femur', T(V(0.02, -0.018, 0.006))), V(0.5, -1, 0.3), 0.006, 0.0024)
  ], { extra: true })
  b.context(hc, 0.16, { opacity: 0.18, skip: ['gluteus maximus'] })
  b.realOr('gluteoMaximo', 'Glúteo máximo', 'muscle', ['gluteus maximus'], null, { minor: true, opacity: 0.14 })
  return hc
}

// ─── Tornozelo e pé (ossos e tendões reais) ──────────────────────────────────
const FOOT_BONES = ['navicular bone of foot', 'cuboid bone', 'medial cuneiform bone', 'intermediate cuneiform bone', 'lateral cuneiform bone',
  ...['first', 'second', 'third', 'fourth', 'fifth'].map(o => o + ' metatarsal bone'),
  ...['big toe', 'second toe', 'third toe', 'fourth toe', 'little toe'].flatMap(t => ['proximal', 'middle', 'distal'].map(s => `${s} phalanx of ${t}`))]
function ankleReal(b) {
  const tB = boxOf(b, 'tibia'), fB = boxOf(b, 'fibula'), taB = boxOf(b, 'talus'), cB = boxOf(b, 'calcaneus')
  const feet = FOOT_BONES.filter(n => b.hasReal(n))
  b.realOr('tibia', 'Tíbia', 'bone', ['tibia'], null, { anchor: b.snap('tibia', V(tB.min.x, tB.min.y + 0.01, 0.003)) })
  b.realOr('fibula', 'Fíbula', 'bone', ['fibula'], null, { anchor: b.snap('fibula', V(fB.max.x, fB.min.y + 0.008, 0)) })
  b.realOr('talus', 'Tálus', 'bone', ['talus'], null, { minor: true })
  b.part('cartTalar', 'Cartilagem do tornozelo', 'cartilage', b.shell('talus', (p, n) => p.y > taB.max.y - 0.012 && n.y > 0.5, 0.0014),
    { minor: true, side: THREE.DoubleSide, anchor: V(0, taB.max.y, taB.getCenter(V()).z + 0.01) })
  b.realOr('calcaneo', 'Calcâneo', 'bone', ['calcaneus'], null, { anchor: V(cB.getCenter(V()).x, cB.min.y + 0.012, cB.min.z + 0.008) })
  b.realOr('ossosPe', 'Ossos do pé (tarso, metatarsos e falanges)', 'bone', feet, null, { minor: true, anchor: V(0, -0.02, 0.07) })
  // tendão de Aquiles (real) — a ruptura fica ~4 cm acima da inserção
  const ach = b.points('calcaneal tendon', () => true)
  const yR = cB.max.y + 0.04
  const tearP = centroid(ach.filter(p => Math.abs(p.y - yR) < 0.006))
  b.realOr('aquiles', 'Tendão de Aquiles', 'tendon', ['calcaneal tendon'], null, {
    anchor: tearP.clone().add(V(0, 0, -0.004)), tear: { p: tearP, n: V(0, 1, 0), w: 0.0022, r: 0.02 }
  })
  b.realOr('soleo', 'Músculos da panturrilha', 'muscle', ['soleus', 'medial head of gastrocnemius', 'lateral head of gastrocnemius'], null, { minor: true, opacity: 0.3 })
  // ligamentos laterais: talofibular anterior e calcaneofibular; medial: deltoide
  const lm = b.snap('fibula', V(fB.max.x, fB.min.y + 0.004, (fB.min.z + fB.max.z) / 2 + 0.004), 0.0015)
  const ltT = b.snap('talus', V(taB.max.x - 0.004, taB.max.y - 0.012, taB.max.z - 0.012), 0.0015)
  b.part('ltfa', 'Ligamento talofibular anterior', 'ligament', tube([lm, lerpV(lm, ltT, 0.5).add(V(0.002, -0.001, 0)), ltT], 0.0028), {
    tear: { p: lerpV(lm, ltT, 0.5), n: ltT.clone().sub(lm).normalize(), w: 0.0013, r: 0.01 }
  })
  const cf = b.snap('calcaneus', V(cB.max.x, cB.getCenter(V()).y, cB.getCenter(V()).z - 0.008), 0.0015)
  b.part('lcf', 'Ligamento calcaneofibular', 'ligament', tube(b.wrap(lm.clone().add(V(0, -0.004, -0.006)), cf, ['fibula', 'calcaneus', 'talus'], 0.002, 3), 0.0026), { minor: true })
  const mm = b.snap('tibia', V(tB.min.x, tB.min.y + 0.004, (tB.min.z + tB.max.z) / 2), 0.0015)
  b.part('deltoide', 'Ligamento deltoide', 'ligament', [
    b.snap('navicular bone of foot', mm.clone().add(V(0.004, -0.02, 0.03)), 0.0015),
    b.snap('talus', mm.clone().add(V(0.004, -0.016, 0.0)), 0.0015),
    b.snap('calcaneus', mm.clone().add(V(0.004, -0.028, -0.012)), 0.0015)
  ].map(q => tube([mm, lerpV(mm, q, 0.5).add(V(-0.0015, 0, 0)), q], 0.0026)), { minor: true })
  // fáscia plantar: do calcâneo às cabeças dos metatarsos
  const heel = b.snap('calcaneus', V(cB.getCenter(V()).x, cB.min.y, cB.min.z + 0.018), 0.0025)
  const heads = ['first', 'second', 'third', 'fourth', 'fifth'].map(o => {
    const P = b.points(o + ' metatarsal bone', () => true)
    if (!P.length) return null
    const zM = P.reduce((m, p) => Math.max(m, p.z), -1)
    const hd = centroid(P.filter(p => p.z > zM - 0.008))
    return b.snap(o + ' metatarsal bone', hd.clone().add(V(0, -0.01, 0)), 0.003)
  })
  b.part('fasciaPlantar', 'Fáscia plantar', 'fascia',
    heads.filter(Boolean).map(m => tube([heel, lerpV(heel, m, 0.5).add(V(0, -0.004, 0)), m], 0.0024, 0.0016)), { anchor: lerpV(heel, V(0, heel.y, 0.06), 0.25) })
  b.part('esporao', 'Esporão do calcâneo', 'bone', spike(heel.clone().add(V(0, 0.001, 0.004)), V(0, -0.25, 1), 0.009, 0.0032), { extra: true })
  b.part('osteofitos', 'Osteófitos', 'bone', [
    spike(b.snap('tibia', V(0, tB.min.y + 0.004, tB.max.z)), V(0, -0.3, 1), 0.006, 0.0025),
    spike(b.snap('talus', V(0, taB.max.y - 0.006, taB.max.z - 0.004)), V(0, 1, 0.4), 0.005, 0.0022),
    spike(b.snap('tibia', V(0, tB.min.y + 0.004, tB.min.z)), V(0, -0.3, -1), 0.005, 0.0022)
  ], { extra: true })
  if (heads[0]) {
    const h1 = heads[0].clone().add(V(0, 0.01, 0))
    b.part('mtp1', 'Articulação do dedão', 'capsule', ellipsoid(h1, 0.0085), { minor: true })
    const med = b.snap('first metatarsal bone', h1.clone().add(V(-0.012, 0, 0)), 0.002)
    b.part('joanete', 'Joanete (saliência óssea)', 'bone', ellipsoid(med, 0.005, 0.007, 0.008), { extra: true })
  }
  b.part('cabecasMetatarso', 'Cabeças dos metatarsos', 'capsule', heads.slice(1, 4).filter(Boolean).map(m => ellipsoid(m.clone().add(V(0, 0.008, 0)), 0.0058)), { minor: true })
  b.context(V(0, -0.01, 0.03), 0.16, { opacity: 0.22 })
}

// ─── Ombro ───────────────────────────────────────────────────────────────────
function shoulder(ctx) {
  const S = ctx.J(ctx.pre + 'shoulder'), E = ctx.J(ctx.pre + 'elbow')
  const k = ctx.H / 1.78
  const x = V(ctx.sx, 0, 0), z = V(0, 0, 1)
  const ant = ctx.ray(S, z) ?? 0.06, post = ctx.ray(S, z.clone().negate()) ?? 0.06
  const o = S.clone().addScaledVector(x, 0.012 * k).add(V(0, -0.004 * k, (ant - post) / 2))
  const b = new Build(ctx, frameM(o, x, Y, z, k))
  const arm = b.Ld(E.clone().sub(S))
  const hs = V(0.006, -0.012, 0.001)
  const along = (t, off) => hs.clone().addScaledVector(arm, t).add(off)
  if (['humerus', 'scapula', 'clavicle', 'supraspinatus', 'long head of biceps brachii'].every(n => b.hasReal(n))) {
    const hc = shoulderReal(b, arm, k)
    return b.done(hc.clone().add(V(-0.008, 0.004, 0)), 0.07, 0.15)
  }

  b.part('umero', 'Úmero', 'bone', [
    ellipsoid(V(), 0.0245),
    ellipsoid(V(0.019, 0.009, 0.004), 0.011, 0.014, 0.013),
    ellipsoid(V(0.006, 0.0, 0.021), 0.0075, 0.008, 0.0075),
    lathe(hs, arm, [[0, 0], [0.019, 0.006], [0.016, 0.03], [0.0125, 0.08], [0.0115, 0.26], [0, 0.265]])
  ], { anchor: along(0.05, V(0.012, 0, 0.004)) })

  // Escápula: glenoide (concha voltada para a cabeça do úmero), lâmina, espinha, acrômio e coracoide
  const gl = new THREE.SphereGeometry(0.0268, 24, 10, 0, Math.PI * 2, 0, 0.62)
  gl.applyQuaternion(quatTo(V(-1, 0, 0)))
  const Gt = V(-0.033, 0.016, -0.012), Gb = V(-0.036, -0.03, -0.02), Sa = V(-0.105, 0.036, -0.064), Ia = V(-0.088, -0.128, -0.072)
  const blade = surface((u, v) => {
    const p = lerpV(lerpV(Gt, Gb, v), lerpV(Sa, Ia, v), u)
    p.z -= 0.007 * Math.sin(Math.PI * u)
    return p
  }, 14, 14)
  b.part('escapula', 'Escápula', 'bone', [
    gl, blade,
    tube([V(-0.104, 0.021, -0.069), V(-0.065, 0.031, -0.058), V(-0.028, 0.037, -0.036), V(-0.004, 0.039, -0.018)], 0.0035, 0.0055),
    ellipsoid(V(0.006, 0.04, -0.008), 0.024, 0.0055, 0.018, [0, 0.3, 0.1]),
    tube([V(-0.032, 0.018, 0.0), V(-0.024, 0.026, 0.018), V(-0.013, 0.02, 0.03)], 0.0045, 0.0035)
  ], { side: THREE.DoubleSide, anchor: V(-0.07, -0.03, -0.066) })
  b.part('clavicula', 'Clavícula', 'bone',
    tube([V(0.004, 0.044, 0.012), V(-0.045, 0.041, 0.033), V(-0.095, 0.033, 0.043), V(-0.15, 0.025, 0.05)], 0.0058, 0.0062), { minor: true, anchor: V(-0.04, 0.042, 0.032) })

  // Manguito rotador (músculo + tendão)
  b.part('supraespinal', 'Tendão do supraespinal', 'tendon',
    tube([V(-0.03, 0.04, -0.018), V(-0.004, 0.033, -0.004), V(0.017, 0.021, 0.004)], 0.0058, 0.0046), {
      anchor: V(0.006, 0.031, -0.001),
      tear: { p: V(0.0107, 0.0246, 0.0016), n: V(0.021, -0.012, 0.008).normalize(), w: 0.0014, r: 0.02 }
    })
  b.part('supraespinal', null, 'muscle', tube([V(-0.105, 0.034, -0.052), V(-0.068, 0.043, -0.037), V(-0.028, 0.04, -0.018)], 0.008, 0.007, { belly: 0.35, ends: 0.12 }))
  b.part('infraespinal', 'Infraespinal', 'tendon',
    tube([V(-0.02, -0.008, -0.04), V(0.004, -0.002, -0.029), V(0.02, 0.004, -0.013)], 0.0052, 0.0045), { minor: true, anchor: V(0.004, -0.002, -0.03) })
  b.part('infraespinal', null, 'muscle', tube([V(-0.09, -0.045, -0.07), V(-0.055, -0.025, -0.06), V(-0.02, -0.008, -0.04)], 0.012, 0.009, { belly: 0.3, ends: 0.12 }))
  b.part('subescapular', 'Subescapular', 'tendon',
    tube([V(-0.02, -0.005, 0.01), V(0.0, 0.0, 0.024), V(0.01, -0.002, 0.024)], 0.005), { minor: true, anchor: V(0, 0, 0.026) })
  b.part('subescapular', null, 'muscle', tube([V(-0.085, -0.035, -0.047), V(-0.05, -0.015, -0.022), V(-0.02, -0.005, 0.01)], 0.011, 0.008, { belly: 0.3, ends: 0.12 }))

  // Bíceps (cabeça longa): tendão sobre a cabeça do úmero, descendo pelo sulco
  b.part('biceps', 'Tendão do bíceps (cabeça longa)', 'tendon',
    tube([V(-0.026, 0.021, 0.004), V(-0.008, 0.027, 0.014), V(0.008, 0.008, 0.025), along(0.05, V(0.004, 0, 0.021)), along(0.1, V(0.004, 0, 0.023))], 0.0026, 0.003),
    { anchor: V(0.008, 0.006, 0.027) })
  b.part('biceps', null, 'muscle', tube([along(0.09, V(0.004, 0, 0.023)), along(0.16, V(0.004, 0, 0.031)), along(0.26, V(0.004, 0, 0.029))], 0.008, 0.009, { belly: 0.6, ends: 0.15 }))

  b.part('bursa', 'Bursa subacromial', 'bursa', ellipsoid(V(0.008, 0.0315, -0.002), 0.017, 0.0038, 0.0145))
  b.part('capsula', 'Cápsula articular', 'capsule', ellipsoid(V(-0.008, 0, 0), 0.036, 0.035, 0.034), { minor: true, anchor: V(-0.01, -0.03, 0.02) })
  b.part('calcificacao', 'Depósitos de cálcio', 'deposit', [
    ellipsoid(V(0.009, 0.0285, 0.001), 0.0034, 0.0028, 0.003),
    ellipsoid(V(0.004, 0.031, -0.002), 0.0024),
    ellipsoid(V(0.013, 0.025, 0.003), 0.002)
  ], { extra: true })

  return b.done(V(-0.008, 0.004, 0.0), 0.07, 0.15)
}

// ─── Cotovelo ────────────────────────────────────────────────────────────────

// Referencial da mão: F = dedos, R = lado do polegar (radial), N = palma
function handAxes(ctx) {
  const P = n => ctx.J(ctx.pre + n)
  const W = P('hand')
  const mcp = [2, 3, 4, 5].map(i => P(`finger-${i}-1`))
  const avg = mcp.reduce((s, v) => s.add(v), V()).multiplyScalar(0.25)
  const F = avg.clone().sub(W).normalize()
  const R = mcp[0].clone().sub(mcp[3])
  R.addScaledVector(F, -R.dot(F)).normalize()
  const N = (ctx.sx < 0 ? R.clone().cross(F) : F.clone().cross(R)).normalize()
  return { W, F, R, N, mcp, avg, P }
}

function elbow(ctx) {
  const E = ctx.J(ctx.pre + 'elbow'), S = ctx.J(ctx.pre + 'shoulder')
  const f = ctx.fit(E, S.clone().sub(E))
  const k = ctx.H / 1.78
  const o = E.clone().addScaledVector(f.x, (f.lat - f.med) / 4).addScaledVector(f.z, (f.ant - f.post) / 4)
  const b = new Build(ctx, frameM(o, f.x, f.y, f.z, k))
  const h = handAxes(ctx)
  const fd = b.Ld(h.W.clone().sub(E)), wl = b.L(h.W), R = b.Ld(h.R), N = b.Ld(h.N)
  const fa = (p, t, r = 0, n = 0) => p.clone().addScaledVector(fd, t).addScaledVector(R, r).addScaledVector(N, n)
  if (['humerus', 'radius', 'ulna'].every(n => b.hasReal(n)) && [...EXT, ...FLEX].every(n => b.hasReal(n))) {
    elbowReal(b, fd)
    return b.done(V(0, -0.004, -0.002), 0.065, 0.12)
  }

  b.part('umero', 'Úmero', 'bone', [
    lathe(V(0, -0.002, -0.004), Y, [[0, 0], [0.026, 0.005], [0.03, 0.012], [0.02, 0.03], [0.014, 0.06], [0.012, 0.25], [0, 0.255]], { sx: 1.3, sz: 0.7 }),
    ellipsoid(V(0.03, 0.008, -0.004), 0.008, 0.01, 0.009),
    ellipsoid(V(-0.037, 0.01, -0.008), 0.011, 0.011, 0.01),
    capsule(V(-0.022, -0.003, 0.004), V(0.022, -0.003, 0.004), 0.011)
  ], { anchor: V(0, 0.05, 0) })
  const rh = V(0.017, -0.017, 0.003)
  b.part('radio', 'Rádio', 'bone', [
    ellipsoid(rh, 0.0105, 0.005, 0.0105),
    tube([rh.clone().add(V(0, -0.003, 0)), fa(rh, 0.06, 0, 0), wl.clone().addScaledVector(R, 0.01).addScaledVector(fd, -0.012)], 0.0055, 0.0092)
  ], { anchor: fa(rh, 0.03) })
  const uo = V(-0.008, -0.012, -0.012)
  b.part('ulna', 'Ulna', 'bone', [
    ellipsoid(V(-0.006, 0.004, -0.021), 0.011, 0.016, 0.009),
    tube([uo, fa(uo, 0.06), wl.clone().addScaledVector(R, -0.011).addScaledVector(fd, -0.014)], 0.008, 0.0048)
  ], { anchor: V(-0.006, 0.004, -0.03) })
  const ring = new THREE.TorusGeometry(0.0118, 0.0017, 8, 32)
  ring.applyQuaternion(quatTo(fd, V(0, 0, 1)))
  ring.translate(rh.x, rh.y, rh.z)
  b.part('anular', 'Ligamento anular', 'ligament', ring, { minor: true })

  // Tendões comuns: extensores (epicôndilo lateral) e flexores (epicôndilo medial)
  const le = V(0.034, 0.004, -0.003), ex1 = V(0.031, -0.024, -0.004)
  b.part('tendaoExtensor', 'Tendão dos extensores (epicôndilo lateral)', 'tendon', tube([le, lerpV(le, ex1, 0.5), ex1], 0.0045, 0.005), {
    anchor: lerpV(le, ex1, 0.4),
    tear: { p: lerpV(le, ex1, 0.45), n: ex1.clone().sub(le).normalize(), w: 0.0012, r: 0.0032 }
  })
  b.part('extensores', 'Músculos extensores', 'muscle',
    tube([ex1, fa(ex1, 0.05, 0.004, -0.01), fa(ex1, 0.14, 0.002, -0.013)], 0.008, 0.007, { belly: 0.5, ends: 0.15 }), { minor: true })
  const me = V(-0.042, 0.005, -0.006), fx1 = V(-0.035, -0.022, 0.0)
  b.part('tendaoFlexor', 'Tendão dos flexores (epicôndilo medial)', 'tendon', tube([me, lerpV(me, fx1, 0.5), fx1], 0.0045, 0.005), { anchor: lerpV(me, fx1, 0.4) })
  b.part('flexores', 'Músculos flexores', 'muscle',
    tube([fx1, fa(fx1, 0.05, -0.004, 0.011), fa(fx1, 0.14, -0.002, 0.013)], 0.0085, 0.007, { belly: 0.5, ends: 0.15 }), { minor: true })

  const un = V(-0.035, -0.03, -0.01)
  b.part('nervoUlnar', 'Nervo ulnar', 'nerve',
    tube([V(-0.028, 0.13, -0.022), V(-0.037, 0.05, -0.024), V(-0.044, 0.006, -0.02), un, fa(un, 0.12, -0.008)], 0.0026), { anchor: V(-0.045, 0.006, -0.02) })
  b.part('bursa', 'Bursa do olécrano', 'bursa', ellipsoid(V(-0.006, 0.004, -0.034), 0.011, 0.013, 0.0042))

  return b.done(V(0, -0.004, -0.002), 0.065, 0.12)
}

// ─── Punho e mão (coordenadas do mundo, direto pelas juntas dos dedos) ───────
function hand(ctx) {
  const { W, F, R, N, mcp, avg, P } = handAxes(ctx)
  const s = THREE.MathUtils.clamp(avg.distanceTo(W) / 0.1, 0.8, 1.3)
  const at = (base, f, r = 0, n = 0) => base.clone().addScaledVector(F, f * s).addScaledVector(R, r * s).addScaledVector(N, n * s)
  const T = [1, 2, 3, 4].map(i => P(`finger-1-${i}`))
  const D = [2, 3, 4, 5].map(f => [1, 2, 3, 4].map(i => P(`finger-${f}-${i}`)))
  const off = [0.012, 0.004, -0.004, -0.012]
  const seg = (a, c, r) => capsule(lerpV(a, c, 0.07), lerpV(a, c, 0.93), r)
  const b = new Build(ctx)

  const realHand = ['radius', 'ulna', ...CARPALS, ...METACARPALS, ...PHALANGES].every(n => b.hasReal(n))
  if (realHand) {
    b.realOr('radioUlna', 'Rádio e ulna', 'bone', ['radius', 'ulna'], null, { anchor: at(W, -0.03, 0.01), minor: true })
    b.realOr('carpos', 'Ossos do carpo', 'bone', CARPALS, null, { anchor: at(W, 0.013, 0, -0.004) })
    b.realOr('metacarpos', 'Metacarpos', 'bone', METACARPALS, null, { minor: true, anchor: lerpV(at(W, 0.03), avg, 0.5) })
    b.realOr('falanges', 'Falanges', 'bone', PHALANGES, null, { minor: true, anchor: D[1][1] })
  } else b.part('radioUlna', 'Rádio e ulna', 'bone', [
    tube([at(W, -0.13, 0.008), at(W, -0.05, 0.009), at(W, -0.013, 0.01)], 0.006 * s, 0.0105 * s),
    ellipsoid(at(W, -0.007, 0.017), 0.0042 * s),
    tube([at(W, -0.13, -0.009), at(W, -0.016, -0.012, -0.001)], 0.0065 * s, 0.006 * s),
    ellipsoid(at(W, -0.016, -0.012, -0.001), 0.0068 * s)
  ], { anchor: at(W, -0.03, 0.01), minor: true })

  if (!realHand) {
  const carp = []
  ;[-0.012, -0.004, 0.004, 0.012].forEach(r => carp.push(ellipsoid(at(W, 0.006, r, 0), 0.0055 * s, 0.0055 * s, 0.0048 * s)))
  ;[-0.011, -0.0035, 0.0035, 0.012].forEach(r => carp.push(ellipsoid(at(W, 0.02, r, 0), 0.0052 * s, 0.0058 * s, 0.0048 * s)))
  carp.push(ellipsoid(at(W, 0.008, -0.013, 0.006), 0.0035 * s))
  b.part('carpos', 'Ossos do carpo', 'bone', carp, { anchor: at(W, 0.013, 0, -0.004) })

  const meta = mcp.map((m, i) => seg(at(W, 0.029, off[i]), m, 0.0042 * s))
  meta.push(seg(T[0], T[1], 0.0048 * s))
  b.part('metacarpos', 'Metacarpos', 'bone', meta, { minor: true, anchor: lerpV(at(W, 0.03), avg, 0.5) })
  const fal = []
  D.forEach(d => {
    fal.push(seg(d[0], d[1], 0.004 * s), seg(d[1], d[2], 0.0035 * s), seg(d[2], lerpV(d[2], d[3], 0.82), 0.0029 * s))
  })
  fal.push(seg(T[1], T[2], 0.0045 * s), seg(T[2], lerpV(T[2], T[3], 0.82), 0.0037 * s))
  b.part('falanges', 'Falanges', 'bone', fal, { minor: true, anchor: D[1][1] })
  }

  // Túnel do carpo: tendões flexores + nervo mediano sob o retináculo
  const FLEXH = ['humeroulnar head of flexor digitorum superficialis', 'radial head of flexor digitorum superficialis', 'flexor digitorum profundus', 'flexor pollicis longus']
  if (realHand && FLEXH.every(n => b.hasReal(n))) {
    b.realOr('tendoesFlexores', 'Tendões flexores', 'muscle', FLEXH, null, { anchor: at(W, 0.035, 0, 0.009), opacity: 0.92 })
  } else {
  const flex = D.map((d, i) => tube([at(W, -0.08, off[i] * 0.5, 0.005), at(W, 0.0, off[i] * 0.6, 0.009), at(W, 0.016, off[i] * 0.7, 0.0095),
    d[0].clone().addScaledVector(N, 0.0068 * s), d[1].clone().addScaledVector(N, 0.0058 * s), d[2].clone().addScaledVector(N, 0.005 * s)], 0.0017 * s))
  flex.push(tube([at(W, -0.08, 0.004, 0.005), at(W, 0.004, 0.008, 0.009), T[1].clone().addScaledVector(N, 0.005 * s), T[2].clone().addScaledVector(N, 0.004 * s)], 0.0017 * s))
  b.part('tendoesFlexores', 'Tendões flexores', 'tendon', flex, { anchor: at(W, 0.035, 0, 0.009) })
  }

  const mSplit = at(W, 0.03, 0.004, 0.011)
  b.part('nervoMediano', 'Nervo mediano', 'nerve', [
    tube([at(W, -0.1, 0, 0.006), at(W, -0.03, 0.001, 0.009), at(W, 0.012, 0.002, 0.0128), mSplit], 0.0024 * s),
    tube([mSplit, lerpV(mSplit, T[1], 0.5).addScaledVector(N, 0.006 * s), T[1].clone().addScaledVector(N, 0.007 * s)], 0.0015 * s),
    tube([mSplit, mcp[0].clone().addScaledVector(N, 0.009 * s)], 0.0015 * s),
    tube([mSplit, mcp[1].clone().addScaledVector(N, 0.009 * s)], 0.0015 * s)
  ], { anchor: at(W, 0.0, 0.001, 0.009) })

  if (realHand && b.hasReal('flexor retinaculum of wrist')) {
    b.realOr('retinaculo', 'Retináculo dos flexores (teto do túnel do carpo)', 'ligament', ['flexor retinaculum of wrist'], null, { side: THREE.DoubleSide, anchor: at(W, 0.014, 0, 0.019) })
  } else {
    const ret = new THREE.TorusGeometry(0.016 * s, 0.0022 * s, 8, 28, Math.PI)
    ret.scale(1, 1, 3.4)
    bake(ret, new THREE.Matrix4().makeBasis(R, N, F).setPosition(at(W, 0.014, 0, 0.003)))
    b.part('retinaculo', 'Retináculo dos flexores (teto do túnel do carpo)', 'ligament', ret, { side: THREE.DoubleSide, anchor: at(W, 0.014, 0, 0.019) })
  }

  if (realHand && b.hasReal('abductor pollicis longus') && b.hasReal('extensor pollicis brevis')) {
    b.realOr('tendoesPolegar', 'Tendões do polegar (1º compartimento)', 'muscle', ['abductor pollicis longus', 'extensor pollicis brevis'], null, { anchor: at(W, -0.01, 0.02), opacity: 0.92 })
  } else b.part('tendoesPolegar', 'Tendões do polegar (1º compartimento)', 'tendon', [-1, 1].map(sg =>
    tube([at(W, -0.07, 0.014, -0.001 + sg * 0.0025), at(W, -0.02, 0.018, sg * 0.0025), at(W, 0.004, 0.019, 0.001 + sg * 0.0025),
      T[0].clone().addScaledVector(R, 0.004 * s).addScaledVector(N, sg * 0.0025 * s), T[1].clone().addScaledVector(R, 0.003 * s)], 0.0017 * s)), {
    anchor: at(W, -0.01, 0.02)
  })
  b.part('articulacaoPolegar', 'Articulação da base do polegar', 'capsule', ellipsoid(T[0], 0.0068 * s), { minor: true })
  b.part('articulacoesIFD', 'Articulações das pontas dos dedos', 'capsule', D.map(d => ellipsoid(d[2], 0.0042 * s)), { minor: true, anchor: D[1][2] })
  b.part('osteofitos', 'Osteófitos', 'bone', [
    spike(T[0].clone().addScaledVector(R, 0.005 * s), R, 0.005 * s, 0.002 * s),
    spike(T[0].clone().addScaledVector(N, 0.005 * s), N, 0.0045 * s, 0.0018 * s),
    spike(T[0].clone().addScaledVector(N, -0.005 * s), N.clone().negate(), 0.0045 * s, 0.0018 * s)
  ], { extra: true })

  // Dedo em gatilho: nódulo no tendão do anelar + polia A1
  const nod = D[2][0].clone().addScaledVector(N, 0.0072 * s)
  const pul = new THREE.TorusGeometry(0.0032 * s, 0.0009 * s, 8, 24)
  pul.applyQuaternion(quatTo(D[2][1].clone().sub(D[2][0]), V(0, 0, 1)))
  pul.translate(nod.x, nod.y, nod.z)
  b.part('noduloGatilho', 'Nódulo no tendão (polia A1)', 'tendon', [ellipsoid(nod, 0.0029 * s), pul], { extra: true })
  b.part('cistoSinovial', 'Cisto sinovial', 'bursa', ellipsoid(at(W, 0.01, 0, -0.012), 0.0065 * s), { extra: true })

  const mao = ctx.region?.group === 'mao'
  const center = mao ? lerpV(W, avg, 0.75) : at(W, 0.012, 0, 0.002)
  if (realHand) b.context(center, (mao ? 0.12 : 0.1) * s, { opacity: 0.32 })
  return b.done(center, (mao ? 0.07 : 0.05) * s, (mao ? 0.13 : 0.1) * s)
}

// ─── Quadril ─────────────────────────────────────────────────────────────────
function hip(ctx) {
  const Hj = ctx.J(ctx.pre + 'upper-leg'), Kn = ctx.J(ctx.pre + 'knee')
  const k = ctx.H / 1.78
  const x = V(ctx.sx, 0, 0), z = V(0, 0, 1)
  const lat = ctx.ray(Hj, x) ?? 0.06
  const ant = ctx.ray(Hj, z) ?? 0.1, post = ctx.ray(Hj, z.clone().negate()) ?? 0.08
  const o = Hj.clone().addScaledVector(x, lat - 0.078 * k).addScaledVector(z, (ant - post) * 0.3)
  const b = new Build(ctx, frameM(o, x, Y, z, k))
  const fem = b.Ld(Kn.clone().sub(Hj))
  if (['femur', 'hip bone', 'gluteus medius', 'piriformis'].every(n => b.hasReal(n))) {
    const hc = hipReal(b, fem)
    return b.done(hc.clone().add(V(0.022, -0.01, 0)), 0.095, 0.17)
  }

  b.part('femur', 'Fêmur', 'bone', [
    ellipsoid(V(), 0.022),
    capsule(V(0.004, -0.004, 0), V(0.04, -0.03, 0.004), 0.0135),
    ellipsoid(V(0.049, -0.02, -0.008), 0.013, 0.02, 0.016),
    ellipsoid(V(0.022, -0.068, -0.012), 0.007),
    lathe(V(0.044, -0.045, 0), fem, [[0, 0], [0.02, 0.01], [0.016, 0.04], [0.0135, 0.1], [0.013, 0.3], [0, 0.305]])
  ], { anchor: V(0.03, -0.03, 0.01) })

  const open = V(1, -0.7, 0.35).normalize()
  const cup = new THREE.SphereGeometry(0.0255, 26, 12, 0, Math.PI * 2, 0, 1.25)
  cup.applyQuaternion(quatTo(open.clone().negate()))
  const A0 = V(-0.012, 0.028, 0.022), P0 = V(-0.03, 0.026, -0.03)
  const ASIS = V(0.012, 0.13, 0.06), MID = V(0.024, 0.158, 0.0), PSIS = V(-0.035, 0.137, -0.075)
  const ilium = surface((u, v) => {
    const bot = lerpV(A0, P0, u)
    const top = ASIS.clone().multiplyScalar((1 - u) ** 2).addScaledVector(MID, 2 * u * (1 - u)).addScaledVector(PSIS, u * u)
    const p = lerpV(bot, top, v)
    p.x += 0.012 * Math.sin(Math.PI * v) * Math.sin(Math.PI * u)
    return p
  }, 16, 12)
  b.part('pelve', 'Pelve (acetábulo e ílio)', 'bone', [
    cup, ilium,
    // anel do forame obturado: púbis → ísquio → de volta ao acetábulo
    tube([V(-0.01, -0.016, 0.02), V(-0.04, -0.026, 0.03), V(-0.056, -0.052, 0.02), V(-0.04, -0.074, -0.01),
      V(-0.02, -0.066, -0.034), V(-0.012, -0.03, -0.03)], 0.0075, 0.0085)
  ], { side: THREE.DoubleSide, anchor: V(0.0, 0.1, 0.0) })

  const rimC = open.clone().multiplyScalar(-0.0255 * Math.cos(1.25))
  const lab = new THREE.TorusGeometry(0.0255 * Math.sin(1.25), 0.0024, 8, 56)
  lab.applyQuaternion(quatTo(open, V(0, 0, 1)))
  lab.translate(rimC.x, rimC.y, rimC.z)
  const up = V(0, 1, 0.6); up.addScaledVector(open, -up.dot(open)).normalize()
  const tearP = rimC.clone().addScaledVector(up, 0.0255 * Math.sin(1.25))
  b.part('labio', 'Lábio acetabular', 'meniscus', lab, {
    anchor: tearP.clone(), tear: { p: tearP, n: open.clone().cross(up).normalize(), w: 0.0012, r: 0.006 }
  })
  b.part('cartilagem', 'Cartilagem da articulação', 'cartilage', ellipsoid(V(), 0.0234), { anchor: V(0.012, 0.012, 0.014) })
  b.part('bursa', 'Bursa trocantérica', 'bursa', ellipsoid(V(0.066, -0.02, -0.008), 0.0045, 0.02, 0.016))
  b.part('gluteoMedio', 'Glúteo médio', 'tendon', tube([V(0.052, 0.012, -0.012), V(0.06, -0.006, -0.01)], 0.006), { anchor: V(0.058, 0.0, -0.011) })
  b.part('gluteoMedio', null, 'muscle', tube([V(0.0, 0.125, -0.02), V(0.032, 0.07, -0.018), V(0.055, 0.012, -0.012)], 0.02, 0.011, { belly: 0.4, ends: 0.14 }))
  b.part('piriforme', 'Piriforme', 'muscle', tube([V(-0.088, 0.03, -0.075), V(-0.04, 0.016, -0.05), V(0.042, 0.002, -0.02)], 0.009, 0.005, { belly: 0.4, ends: 0.1 }), { anchor: V(-0.03, 0.014, -0.047) })
  b.part('ciatico', 'Nervo ciático', 'nerve',
    tube([V(-0.088, 0.05, -0.07), V(-0.056, 0.0, -0.068), V(-0.026, -0.04, -0.06), V(-0.006, -0.12, -0.05), V(0.004, -0.25, -0.04)], 0.0045, 0.004), { anchor: V(-0.03, -0.03, -0.062) })
  b.part('osteofitos', 'Osteófitos', 'bone', [
    spike(rimC.clone().addScaledVector(up, 0.026), up, 0.007, 0.0026),
    spike(V(0.018, 0.012, 0.004), V(0.6, 1, 0.3), 0.006, 0.0024),
    spike(V(0.02, -0.018, 0.006), V(0.5, -1, 0.3), 0.006, 0.0024)
  ], { extra: true })

  return b.done(V(0.022, -0.01, 0), 0.095, 0.17)
}

// ─── Tornozelo e pé ──────────────────────────────────────────────────────────
function ankle(ctx) {
  const A = ctx.J(ctx.pre + 'ankle'), T2 = ctx.J(ctx.pre + 'foot-2')
  const zf = T2.clone().sub(A); zf.y = 0; zf.normalize()
  const f = ctx.fit(A, Y, zf)
  const k = THREE.MathUtils.clamp(0.5 * (f.halfW / 0.032) + 0.5 * (ctx.H / 1.78), 0.8, 1.2)
  const b = new Build(ctx, frameM(f.center, f.x, Y, f.z, k))
  const toe = i => [1, 2, 3, 4].map(j => ctx.Jopt(`${ctx.pre}toe-${i}-${j}`)).filter(Boolean).map(p => b.L(p))
  const toes = [1, 2, 3, 4, 5].map(toe)
  const mtp = toes.map(t => t[0])
  const za = Math.max(-0.058, -(f.halfD / k) + 0.014)
  if (['tibia', 'fibula', 'talus', 'calcaneus', 'calcaneal tendon', 'soleus', 'navicular bone of foot'].every(n => b.hasReal(n))) {
    ankleReal(b)
    const pe = ctx.region?.group === 'pe'
    return pe ? b.done(V(0, -0.028, 0.045), 0.11, 0.18) : b.done(V(0, -0.012, 0.002), 0.075, 0.13)
  }

  b.part('tibia', 'Tíbia', 'bone', [
    lathe(V(0, 0.012, 0), Y, [[0, 0], [0.021, 0.001], [0.02, 0.018], [0.015, 0.05], [0.0125, 0.11], [0.012, 0.27], [0, 0.275]], { sx: 1.1, sz: 0.95 }),
    ellipsoid(V(-0.019, 0.0, 0.003), 0.0065, 0.013, 0.009)
  ], { anchor: V(-0.02, 0.0, 0.003) })
  b.part('fibula', 'Fíbula', 'bone', [
    tube([V(0.018, 0.28, -0.012), V(0.019, 0.1, -0.01), V(0.021, 0.01, -0.007)], 0.0055, 0.0065),
    ellipsoid(V(0.022, -0.006, -0.006), 0.006, 0.014, 0.0085)
  ], { anchor: V(0.024, -0.006, -0.006) })
  b.part('talus', 'Tálus', 'bone', [ellipsoid(V(0, -0.004, 0.004), 0.015, 0.0115, 0.021), ellipsoid(V(-0.004, -0.012, 0.03), 0.0095)], { minor: true })
  b.part('cartTalar', 'Cartilagem do tornozelo', 'cartilage', ellipsoid(V(0, 0.006, 0.003), 0.0152, 0.0045, 0.0185), { minor: true, anchor: V(0, 0.008, 0.02) })
  b.part('calcaneo', 'Calcâneo', 'bone', [
    ellipsoid(V(0.004, -0.036, -0.018), 0.0155, 0.017, 0.031, [0.2, 0, 0]),
    ellipsoid(V(0.004, -0.042, -0.044), 0.013, 0.016, 0.012)
  ], { anchor: V(0.004, -0.04, -0.035) })

  const mid = [
    ellipsoid(V(-0.011, -0.02, 0.043), 0.009, 0.009, 0.006),
    ellipsoid(V(0.012, -0.034, 0.038), 0.009, 0.009, 0.011),
    ...[-0.014, -0.004, 0.006].map(xx => ellipsoid(V(xx, -0.026, 0.058), 0.005, 0.008, 0.008))
  ]
  const bases = [V(-0.014, -0.03, 0.066), V(-0.006, -0.028, 0.068), V(0.002, -0.03, 0.068), V(0.009, -0.032, 0.066), V(0.016, -0.036, 0.056)]
  const meta = mtp.map((m, i) => m ? capsule(bases[i], m, i === 0 ? 0.0058 : 0.0042) : null)
  const ph = []
  toes.forEach((t, i) => { for (let j = 0; j + 1 < t.length; j++) ph.push(capsule(lerpV(t[j], t[j + 1], 0.08), lerpV(t[j], t[j + 1], 0.92), i === 0 ? 0.005 : 0.0033)) })
  b.part('ossosPe', 'Ossos do pé (tarso, metatarsos e falanges)', 'bone', [...mid, ...meta, ...ph], { minor: true, anchor: V(0, -0.02, 0.07) })

  b.part('aquiles', 'Tendão de Aquiles', 'tendon',
    tube([V(0, 0.25, za + 0.003), V(0, 0.14, za), V(0.001, 0.05, za - 0.002), V(0.002, -0.012, za - 0.004), V(0.004, -0.03, -0.054)], 0.0085, 0.006), {
      anchor: V(0.001, 0.03, za - 0.003), tear: { p: V(0.001, 0.045, za - 0.002), n: V(0, 1, 0), w: 0.0022, r: 0.02 }
    })
  b.part('soleo', 'Músculos da panturrilha', 'muscle', tube([V(0, 0.11, za + 0.006), V(0, 0.2, za + 0.004), V(0, 0.32, za)], 0.012, 0.022, { belly: 0.25 }), { minor: true, anchor: V(0, 0.15, za + 0.004) })

  const lt0 = V(0.023, -0.004, 0.004), lt1 = V(0.011, -0.011, 0.026)
  b.part('ltfa', 'Ligamento talofibular anterior', 'ligament', tube([lt0, lerpV(lt0, lt1, 0.5).add(V(0.002, -0.001, 0)), lt1], 0.0028), {
    tear: { p: lerpV(lt0, lt1, 0.5), n: lt1.clone().sub(lt0).normalize(), w: 0.0013, r: 0.01 }
  })
  b.part('lcf', 'Ligamento calcaneofibular', 'ligament', tube([V(0.024, -0.018, -0.007), V(0.023, -0.03, -0.014), V(0.02, -0.04, -0.02)], 0.0026), { minor: true })
  b.part('deltoide', 'Ligamento deltoide', 'ligament', [V(-0.014, -0.014, 0.024), V(-0.016, -0.024, 0.0), V(-0.013, -0.03, -0.012)]
    .map(p => tube([V(-0.02, -0.009, 0.003), p], 0.0026)), { minor: true })

  const heel = V(0.003, -0.056, -0.028)
  b.part('fasciaPlantar', 'Fáscia plantar', 'fascia',
    mtp.filter(Boolean).map(m => tube([heel, lerpV(heel, m, 0.5).add(V(0, -0.006, 0)), m.clone().add(V(0, -0.011, 0))], 0.0024, 0.0016)), {
      anchor: lerpV(heel, V(0, -0.05, 0.06), 0.25)
    })
  b.part('esporao', 'Esporão do calcâneo', 'bone', spike(V(0.003, -0.054, -0.016), V(0, -0.25, 1), 0.009, 0.0032), { extra: true })
  b.part('osteofitos', 'Osteófitos', 'bone', [
    spike(V(0, 0.012, 0.02), V(0, -0.3, 1), 0.006, 0.0025),
    spike(V(-0.004, -0.004, 0.026), V(0, 1, 0.4), 0.005, 0.0022),
    spike(V(0.0, 0.012, -0.016), V(0, -0.3, -1), 0.005, 0.0022)
  ], { extra: true })
  if (mtp[0]) {
    b.part('mtp1', 'Articulação do dedão', 'capsule', ellipsoid(mtp[0], 0.0085), { minor: true })
    b.part('joanete', 'Joanete (saliência óssea)', 'bone', ellipsoid(mtp[0].clone().add(V(-0.008, 0, 0)), 0.005, 0.007, 0.008), { extra: true })
  }
  b.part('cabecasMetatarso', 'Cabeças dos metatarsos', 'capsule', mtp.slice(1, 4).filter(Boolean).map(m => ellipsoid(m.clone().add(V(0, -0.002, 0)), 0.0058)), { minor: true })

  const pe = ctx.region?.group === 'pe'
  return pe ? b.done(V(0, -0.028, 0.045), 0.11, 0.18) : b.done(V(0, -0.012, 0.002), 0.075, 0.13)
}

// ─── Coluna (lombar, cervical e torácica) ────────────────────────────────────
// Cada vértebra: corpo, pedículos, lâmina, processo espinhoso e transversos;
// discos entre elas; raízes nervosas saindo pelos forames; medula no canal.
// A profundidade de cada nível vem da pele das costas (raio a partir do centro
// do tronco), então a curvatura natural da coluna acompanha o corpo.
const ORDN = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth']
// 'L4' → 'fourth lumbar vertebra' (nome no BodyParts3D); disco = o que fica logo abaixo dela
const bpVert = nm => nm === 'C1' ? 'atlas' : nm === 'C2' ? 'axis'
  : `${ORDN[+nm.slice(1) - 1]} ${{ L: 'lumbar', T: 'thoracic', C: 'cervical' }[nm[0]]} vertebra`
const bpDisc = nm => 'intervertebral disk of ' + bpVert(nm)
const both = names => names.flatMap(n => [[n, 'D'], [n, 'E']])

function spine(ctx, cfg) {
  const k = ctx.H / 1.78
  const b = new Build(ctx)
  const real = cfg.names.every(nm => b.hasReal(bpVert(nm), null))
  const n = cfg.names.length
  const T = cfg.yTop - cfg.yBot
  const hb = T / (n * (1 + cfg.disc))
  const g = hb * cfg.disc
  const lv = []
  for (let i = 0; i < n; i++) {
    const y = cfg.yBot + g + hb / 2 + i * (hb + g)
    const Pin = V(0.00001, y, cfg.zRef(y))
    const back = ctx.ray(Pin, V(0, 0, -1)) ?? 0.06
    const front = ctx.ray(Pin, V(0, 0, 1)) ?? 0.1
    const side = ctx.ray(Pin, V(1, 0, 0)) ?? 0.12
    const D = back + front
    const backZ = Pin.z - back
    const zc = backZ + THREE.MathUtils.clamp(cfg.depthK * D, cfg.minBack * k, cfg.maxBack * k)
    const w = (cfg.w0 + (cfg.w1 - cfg.w0) * (i / Math.max(1, n - 1))) * k
    lv.push({ y, zc, w, d: w * cfg.dRatio, backZ, halfT: Math.min(side, 0.2 * k), zt: backZ + D / 2, bd: D / 2 })
  }
  // suaviza a profundidade entre níveis vizinhos
  const zs = lv.map((l, i) => (lv[Math.max(0, i - 1)].zc + l.zc * 2 + lv[Math.min(n - 1, i + 1)].zc) / 4)
  lv.forEach((l, i) => { l.zc = zs[i] })
  // Vértebras reais: altura, profundidade e tamanho do corpo vertebral e o
  // canal medindo a própria peça (o resto — raízes, medula, hérnia — segue)
  const discC = []
  if (real) {
    lv.forEach((l, i) => {
      const P = b.points(bpVert(cfg.names[i]), () => true, null)
      const zmax = P.reduce((m, p) => Math.max(m, p.z), -9), zmin = P.reduce((m, p) => Math.min(m, p.z), 9)
      const body = P.filter(p => p.z > zmax - cfg.bodyFrac * (zmax - zmin))
      const c = centroid(body)
      const ax = body.map(p => Math.abs(p.x - c.x)).sort((a, b2) => a - b2)
      const bz0 = body.reduce((m, p) => Math.min(m, p.z), 9)
      l.y = c.y; l.zc = c.z
      l.w = ax[Math.floor(ax.length * 0.95)] || l.w
      l.d = (zmax - bz0) / 2
      l.hb = body.reduce((m, p) => Math.max(m, p.y), -9) - body.reduce((m, p) => Math.min(m, p.y), 9)
      // canal: entre a face de trás do corpo e a lâmina (pontos da linha média atrás do corpo)
      const arch = P.filter(p => Math.abs(p.x - c.x) < 0.004 && p.z < bz0 - 0.004)
      const lam = arch.reduce((m, p) => Math.max(m, p.z), bz0 - 0.03)
      l.cz = (bz0 + lam) / 2
      l.cr = Math.max(0.004, (bz0 - lam) / 2)
      const dn = cfg.discs[i] && bpDisc(cfg.names[i])
      if (dn && b.hasReal(dn, null)) discC[i] = { c: centroid(b.points(dn, () => true, null)), box: boxOf(b, dn, null) }
    })
  }

  const facets = [], osteo = []
  lv.forEach((l, i) => {
    const { y, zc, w, d } = l
    const c = V(0, y, zc)
    const at = (xx, yy, zz) => V(xx, y + yy, zc + zz)
    const Wd = w, Dd = d
    const spLen = Math.max(0.5 * Wd, (zc - l.backZ) - Dd - Wd - 0.012 * k)
    const geos = [
      lathe(V(0, y - hb / 2, zc), Y, [[0, 0], [w * 0.94, 0], [w, hb * 0.1], [w * 0.9, hb / 2], [w, hb * 0.9], [w * 0.94, hb], [0, hb]], { sz: cfg.dRatio }),
      ...[-1, 1].map(s => capsule(at(s * 0.5 * Wd, 0.1 * hb, -0.75 * Dd), at(s * 0.55 * Wd, 0.1 * hb, -Dd - 0.3 * Wd), 0.17 * Wd)),
      tube([at(-0.55 * Wd, 0.05 * hb, -Dd - 0.3 * Wd), at(-0.36 * Wd, 0, -Dd - 0.85 * Wd), at(0, -0.05 * hb, -Dd - 1.02 * Wd),
        at(0.36 * Wd, 0, -Dd - 0.85 * Wd), at(0.55 * Wd, 0.05 * hb, -Dd - 0.3 * Wd)], 0.38 * hb, 0.38 * hb, { wide: Y, ratio: Math.min(1, 0.15 * Wd / (0.38 * hb)) }),
      tube([at(0, -0.05 * hb, -Dd - 1.0 * Wd), at(0, -0.05 * hb - cfg.spDrop * spLen, -Dd - Wd - spLen)], 0.3 * hb, 0.22 * hb, { wide: Y, ratio: Math.min(1, 0.13 * Wd / (0.3 * hb)) }),
      ...[-1, 1].map(s => capsule(at(s * 0.55 * Wd, 0.1 * hb, -Dd - 0.35 * Wd), at(s * (0.55 * Wd + cfg.tp * Wd), 0.1 * hb + cfg.tpUp * Wd, -Dd - 0.45 * Wd + cfg.tpFwd * Wd), 0.11 * Wd))
    ]
    const name = cfg.names[i]
    b.realOr(name, `Vértebra ${name}`, 'bone', real ? [[bpVert(name), null]] : [], () => geos, {
      minor: true, level: i, anchor: at(0, 0, Dd * 0.2), shift: V(0, 0, 0.45 * Dd)
    })
    // facetas e osteófitos presos à superfície da vértebra real
    const vb = bpVert(name), hh = real ? l.hb : hb
    const on = q => (real ? b.snap(vb, q, 0.0008, null) : q)
    facets.push({ i, geo: [-1, 1].flatMap(s => [
      ellipsoid(on(at(s * 0.44 * Wd, 0.52 * hh, -Dd - 0.6 * Wd)), (real ? 0.1 : 0.14) * Wd),
      ellipsoid(on(at(s * 0.4 * Wd, -0.46 * hh, -Dd - 0.72 * Wd)), (real ? 0.09 : 0.13) * Wd)
    ]) })
    osteo.push({ i, geo: [-1, 1].flatMap(s => [
      spike(on(at(s * w * 0.92, hh * 0.46, d * 0.3)), V(s, 0.5, 0.35), 0.006 * k, 0.0024 * k),
      spike(on(at(s * w * 0.92, -hh * 0.46, d * 0.3)), V(s, -0.5, 0.35), 0.006 * k, 0.0024 * k)
    ]) })
  })
  facets.forEach(f => b.part('facetas', 'Articulações facetárias', 'cartilage', f.geo, { minor: true, level: f.i, anchor: V(0, lv[Math.floor(n / 2)].y, lv[Math.floor(n / 2)].zc - lv[0].d - lv[0].w * 0.7) }))
  osteo.forEach(o => b.part('osteofitos', 'Osteófitos ("bicos de papagaio")', 'bone', o.geo, { extra: true, level: o.i, anchor: V(lv[0].w, lv[Math.floor(n / 2)].y, lv[Math.floor(n / 2)].zc) }))

  // Discos: abaixo de cada vértebra (cfg.discs[i] = id do disco sob a vértebra i)
  const discY = i => (discC[i] ? discC[i].c.y : lv[i].y - hb / 2 - g / 2)
  lv.forEach((l, i) => {
    const id = cfg.discs[i]
    if (!id) return
    const y = discY(i), zc = discC[i] ? discC[i].c.z : i > 0 ? (l.zc + lv[i - 1].zc) / 2 : l.zc, w = l.w
    b.realOr('disco' + id.key, `Disco ${id.label}`, 'disc', discC[i] ? [[bpDisc(cfg.names[i]), null]] : [], () =>
      lathe(V(0, y - g / 2, zc), Y, [[0, 0], [w * 0.95, 0], [w * 1.03, g / 2], [w * 0.95, g], [0, g]], { sz: cfg.dRatio }), {
        minor: true, level: i, anchor: V(0, y, zc + l.d * 0.4)
      })
  })

  // Hérnia (lado direito do paciente = X negativo): sai pela borda de trás do disco
  const hi = cfg.hernia.level, hl = lv[hi], hy = discY(hi)
  const hz = discC[hi] ? discC[hi].box.min.z + 0.12 * hl.w : hl.zc - hl.d - 0.12 * hl.w
  const hh = discC[hi] ? (discC[hi].box.max.y - discC[hi].box.min.y) : g
  b.part('hernia', `Hérnia de disco (${cfg.discs[hi].label})`, 'disc',
    ellipsoid(V(-0.42 * hl.w, hy, hz), 0.32 * hl.w, Math.max(hh * 0.45, 0.3 * hl.w * 0.5), 0.34 * hl.w), { extra: true, level: hi })

  // Raízes nervosas por nível; a comprimida pela hérnia fica separada
  const roots = [], affected = []
  lv.forEach((l, i) => {
    if (!cfg.discs[i]) return
    const y = discY(i), W = l.w, zc = l.zc, dd = l.d
    const cz = l.cz ?? zc - dd - 0.45 * W        // no canal, logo atrás do corpo vertebral
    ;[-1, 1].forEach(s => {
      const r = tube([V(s * 0.22 * W, y + 0.35 * hb, cz), V(s * 0.74 * W, y + 0.02 * hb, (cz + zc - dd) / 2 - 0.06 * W),
        V(s * 1.18 * W, y - cfg.rootDrop * hb, zc - dd * 0.25), V(s * 1.6 * W, y - cfg.rootDrop * 2.2 * hb, zc + 0.1 * W)], 0.075 * W, 0.06 * W)
      ;(i === hi && s === -1 ? affected : roots).push({ r, i })
    })
  })
  roots.forEach(({ r, i }) => b.part('nervos', 'Raízes nervosas', 'nerve', r, { minor: true, level: i }))
  affected.forEach(({ r, i }) => b.part('raiz', cfg.hernia.root, 'nerve', r, { minor: true, level: i, anchor: V(-0.9 * hl.w, hy - 0.2 * hb, hl.zc - hl.d - 0.2 * hl.w) }))

  const canal = lv.map(l => V(0, l.y, l.cz ?? l.zc - l.d - 0.55 * l.w))
  canal.unshift(canal[0].clone().add(V(0, -hb, 0)))
  canal.push(canal[canal.length - 1].clone().add(V(0, hb, 0)))
  const cordR = real ? Math.min(cfg.cord * lv[0].w, 0.75 * Math.min(...lv.map(l => l.cr))) : cfg.cord * lv[0].w
  b.part('medula', cfg.cordLabel, 'nerve', tube(canal, cordR), { minor: true })

  // Músculos paravertebrais (reais: os da lista de cada trecho, por lado)
  const mid = lv[Math.floor(n / 2)]
  if (real && cfg.realMus.every(m => b.hasReal(m, 'D') && b.hasReal(m, 'E'))) {
    b.realOr('musculoD', 'Músculos paravertebrais (lado direito)', 'muscle', cfg.realMus.map(m => [m, 'D']), null,
      { opacity: 0.3, anchor: V(-1.1 * mid.w, mid.y, mid.zc - mid.d - 1.3 * mid.w) })
    b.realOr('musculoE', 'Músculos paravertebrais (lado esquerdo)', 'muscle', cfg.realMus.map(m => [m, 'E']), null,
      { opacity: 0.3, anchor: V(1.1 * mid.w, mid.y, mid.zc - mid.d - 1.3 * mid.w) })
  } else {
  const mus = s => tube([
    V(s * 1.05 * lv[0].w, cfg.yBot - 0.02 * k, lv[0].zc - lv[0].d - 1.25 * lv[0].w),
    ...lv.filter((_, i) => i % 2 === 0).map(l => V(s * 1.05 * l.w, l.y, l.zc - l.d - 1.3 * l.w)),
    V(s * 1.05 * lv[n - 1].w, cfg.yTop + 0.02 * k, lv[n - 1].zc - lv[n - 1].d - 1.2 * lv[n - 1].w)
  ], cfg.muscle * lv[0].w, cfg.muscle * lv[n - 1].w, { belly: 0.2, ends: 0.1 })
  b.part('musculoD', 'Músculos paravertebrais (lado direito)', 'muscle', mus(-1), { anchor: V(-1.1 * mid.w, mid.y, mid.zc - mid.d - 1.3 * mid.w) })
  b.part('musculoE', 'Músculos paravertebrais (lado esquerdo)', 'muscle', mus(1), { anchor: V(1.1 * mid.w, mid.y, mid.zc - mid.d - 1.3 * mid.w) })
  }

  // Escoliose: desloca cada nível lateralmente numa curva em "C"
  b.custom.escoliose = amt => {
    b.group.children.forEach(m => {
      const i = m.userData.level
      if (i == null) return
      m.userData.off = V(Math.sin(Math.PI * (i + 0.5) / n) * 0.022 * k * amt, 0, 0)
    })
  }

  cfg.extras?.(b, lv, { k, hb, g, n, real })
  const cy = real ? (lv[0].y + lv[n - 1].y) / 2 : (cfg.yBot + cfg.yTop) / 2
  if (real) b.context(V(0, cy, mid.zc - mid.d), T * 0.75)
  return b.done(V(0, cy, mid.zc - mid.d - mid.w * 0.6), T * 0.62, T * 0.95 + 0.04 * k)
}

function lumbar(ctx) {
  const k = ctx.H / 1.78
  const pel = ctx.J('pelvis'), s2 = ctx.J('spine-2')
  const yBot = pel.y + 0.03 * k, yTop = s2.y + 0.008 * k
  return spine(ctx, {
    names: ['L5', 'L4', 'L3', 'L2', 'L1'],
    discs: [{ key: '5S', label: 'L5-S1' }, { key: '45', label: 'L4-L5' }, { key: '34', label: 'L3-L4' }, { key: '23', label: 'L2-L3' }, { key: '12', label: 'L1-L2' }],
    yBot, yTop, zRef: y => lerpV(pel, s2, (y - pel.y) / (s2.y - pel.y)).z + 0.06 * k,
    disc: 0.3, depthK: 0.44, minBack: 0.06, maxBack: 0.09,
    w0: 0.027, w1: 0.024, dRatio: 0.7, spDrop: 0.15, tp: 1.1, tpUp: 0.1, tpFwd: 0.15,
    rootDrop: 1.1, cord: 0.26, cordLabel: 'Cauda equina (nervos)', muscle: 0.62, bodyFrac: 0.42,
    realMus: ['iliocostalis lumborum', 'longissimus thoracis', 'multifidus'],
    hernia: { level: 1, root: 'Raiz nervosa L5' },
    extras(b, lv) {
      const l = lv[0], w = l.w
      if (b.hasReal('sacrum', null)) b.realOr('sacro', 'Sacro', 'bone', [['sacrum', null]], null, { minor: true, anchor: V(0, yBot - 0.045 * k, l.zc - 0.02 * k) })
      else b.part('sacro', 'Sacro', 'bone', tube([
        V(0, yBot - 0.004 * k, l.zc - 0.004 * k), V(0, yBot - 0.035 * k, l.zc - 0.014 * k),
        V(0, yBot - 0.07 * k, l.zc - 0.03 * k), V(0, yBot - 0.1 * k, l.zc - 0.05 * k)
      ], 1.55 * w, 0.35 * w, { wide: V(1, 0, 0), ratio: 0.42, ends: 0.08 }), { minor: true, anchor: V(0, yBot - 0.045 * k, l.zc - 0.02 * k) })
      const r0 = V(-1.4 * w, yBot - 0.01 * k, l.zc - l.d * 0.1)
      b.part('ciatico', 'Nervo ciático', 'nerve',
        tube([V(-0.8 * w, yBot + 0.02 * k, l.zc - l.d), r0, V(-0.07 * k, yBot - 0.08 * k, l.zc - 0.03 * k), V(-0.09 * k, yBot - 0.2 * k, l.zc - 0.05 * k)], 0.0045 * k, 0.005 * k),
        { anchor: r0 })
    }
  })
}

function cervical(ctx) {
  const k = ctx.H / 1.78
  const nk = ctx.J('neck'), hd = ctx.J('head')
  return spine(ctx, {
    names: ['C7', 'C6', 'C5', 'C4', 'C3', 'C2'],
    discs: [{ key: '7T', label: 'C7-T1' }, { key: '67', label: 'C6-C7' }, { key: '56', label: 'C5-C6' }, { key: '45', label: 'C4-C5' }, { key: '34', label: 'C3-C4' }, { key: '23', label: 'C2-C3' }],
    yBot: nk.y - 0.042 * k, yTop: nk.y + (hd.y - nk.y) * 0.72,
    zRef: () => nk.z + 0.035 * k,
    disc: 0.32, depthK: 0.45, minBack: 0.038, maxBack: 0.058,
    w0: 0.0135, w1: 0.012, dRatio: 0.72, spDrop: 0.35, tp: 0.9, tpUp: 0.0, tpFwd: 0.35,
    rootDrop: 0.5, cord: 0.42, cordLabel: 'Medula espinhal', muscle: 0.5, bodyFrac: 0.34,
    realMus: ['semispinalis capitis', 'semispinalis cervicis', 'splenius capitis', 'splenius cervicis', 'longissimus capitis', 'longissimus cervicis'],
    hernia: { level: 2, root: 'Raiz nervosa C6' },
    extras(b, lv) {
      const top = lv[lv.length - 1], bot = lv[0]
      if (b.hasReal('descending part of trapezius', 'D')) {
        b.realOr('trapezio', 'Trapézio superior', 'muscle', both(['descending part of trapezius']), null,
          { opacity: 0.4, anchor: V(-0.035 * k, bot.y - 0.005 * k, bot.backZ + 0.014 * k) })
        return
      }
      b.part('trapezio', 'Trapézio superior', 'muscle', [-1, 1].map(s => tube([
        V(s * 0.012 * k, top.y + 0.02 * k, top.backZ + 0.012 * k),
        V(s * 0.03 * k, bot.y, bot.backZ + 0.012 * k),
        V(s * 0.1 * k, bot.y - 0.045 * k, bot.backZ + 0.03 * k)
      ], 0.006 * k, 0.009 * k, { belly: 0.35, ends: 0.1 })), { anchor: V(-0.035 * k, bot.y - 0.005 * k, bot.backZ + 0.014 * k) })
    }
  })
}

function thoracic(ctx) {
  const k = ctx.H / 1.78
  const nk = ctx.J('neck'), s2 = ctx.J('spine-2'), s1 = ctx.J('spine-1')
  const names = ['T12', 'T11', 'T10', 'T9', 'T8', 'T7', 'T6', 'T5', 'T4', 'T3', 'T2', 'T1']
  const discs = names.map((nm, i) => ({ key: i === 0 ? 'T12L1' : `${names[i]}${names[i - 1]}`, label: i === 0 ? 'T12-L1' : `${names[i]}-${names[i - 1]}` }))
  return spine(ctx, {
    names, discs,
    yBot: s2.y + 0.01 * k, yTop: nk.y - 0.042 * k,
    zRef: () => s1.z + 0.08 * k,
    disc: 0.26, depthK: 0.3, minBack: 0.05, maxBack: 0.075,
    w0: 0.021, w1: 0.015, dRatio: 0.85, spDrop: 0.9, tp: 1.2, tpUp: 0.2, tpFwd: -0.1,
    rootDrop: 0.4, cord: 0.36, cordLabel: 'Medula espinhal', muscle: 0.5, bodyFrac: 0.36,
    realMus: ['iliocostalis thoracis', 'longissimus thoracis', 'spinalis thoracis', 'semispinalis thoracis'],
    hernia: { level: 5, root: 'Raiz nervosa T8' },
    extras(b, lv, { n }) {
      // Costelas (parte de trás), escápulas, romboides e trapézio
      const RIBS = ORDN.map(o => o + ' rib')
      if (RIBS.every(r => b.hasReal(r, 'D') && b.hasReal(r, 'E')) && b.hasReal('scapula', 'D') && b.hasReal('rhomboid major', 'D')) {
        const L5 = lv[5]
        b.realOr('costelas', 'Costelas', 'bone', both(RIBS), null, { minor: true, anchor: V(0.09 * k, L5.y, L5.zt - L5.bd * 0.7) })
        if (b.hasReal('costal cartilage', 'D')) b.realOr('cartCostal', 'Cartilagens costais', 'cartilage', both(['costal cartilage']), null, { minor: true })
        b.realOr('escapulas', 'Escápulas', 'bone', both(['scapula']), null, { minor: true })
        b.realOr('romboides', 'Romboides', 'muscle', both(['rhomboid major', 'rhomboid minor']), null, { opacity: 0.45 })
        b.realOr('trapezio', 'Trapézio', 'muscle', both(['descending part of trapezius', 'transverse part of trapezius', 'ascending part of trapezius']), null, { opacity: 0.3 })
        return
      }
      const ribs = []
      lv.forEach((l, i) => {
        if (i < 2) return
        const a = l.halfT * 0.86, bd = l.bd * 0.86
        ;[-1, 1].forEach(s => {
          const pts = [V(s * (l.w + 0.008 * k), l.y, l.zc - l.d - 0.25 * l.w)]
          for (let p = 0.45; p <= 2.1; p += 0.33) pts.push(V(s * a * Math.sin(p), l.y - 0.018 * k * p, l.zt - bd * Math.cos(p)))
          ribs.push(tube(pts, 0.0038 * k))
        })
      })
      b.part('costelas', 'Costelas', 'bone', ribs, { minor: true, anchor: V(0.09 * k, lv[5].y, lv[5].zt - lv[5].bd * 0.7) })
      const ly = i => lv[Math.min(n - 1, Math.max(0, i))]
      const backAt = (x, l) => l.zt - l.bd * Math.sqrt(Math.max(0, 1 - (x / (l.halfT * 1.02)) ** 2))
      const scap = s => surface((u, v) => {
        const lvTop = ly(n - 2), lvBot = ly(n - 7)
        const yT = lvTop.y, yB = lvBot.y
        const med = V(s * 0.068 * k, yT + (yB - yT) * v, 0)
        const latTop = V(s * 0.145 * k, yT - 0.01 * k, 0)
        const Ia = V(s * 0.085 * k, yB, 0)
        const lat = lerpV(latTop, Ia, v)
        const p = lerpV(lerpV(med, Ia, v * v * 0.2), lat, u)
        const l = lv.reduce((best, x) => Math.abs(x.y - p.y) < Math.abs(best.y - p.y) ? x : best, lv[0])
        p.z = backAt(p.x, l) + 0.02 * k
        return p
      }, 12, 12)
      b.part('escapulas', 'Escápulas', 'bone', [scap(-1), scap(1)], { side: THREE.DoubleSide, minor: true, anchor: V(0.1 * k, ly(n - 4).y, backAt(0.1 * k, ly(n - 4)) + 0.02 * k) })
      const spTip = l => V(0, l.y - 0.01 * k, l.backZ + 0.014 * k)
      const rh = []
      ;[-1, 1].forEach(s => {
        for (let j = 0; j < 4; j++) {
          const src = spTip(ly(n - 2 - j)), dl = ly(n - 3 - j * 1.3 | 0)
          const dst = V(s * 0.07 * k, dl.y - 0.012 * k, backAt(0.07 * k, dl) + 0.016 * k)
          rh.push(tube([src, lerpV(src, dst, 0.5).add(V(0, 0, 0.004 * k)), dst], 0.006 * k, 0.005 * k, { belly: 0.25, ends: 0.12 }))
        }
      })
      b.part('romboides', 'Romboides', 'muscle', rh, { anchor: V(-0.04 * k, ly(n - 4).y, backAt(0.04 * k, ly(n - 4)) + 0.012 * k) })
      const tr = []
      ;[-1, 1].forEach(s => {
        ;[n - 1, n - 3, n - 5, n - 8, n - 10].forEach((li, j) => {
          const src = spTip(ly(li)), dl = ly(n - 2)
          const dst = V(s * (0.13 - j * 0.008) * k, dl.y + 0.005 * k, backAt(0.12 * k, dl) + 0.008 * k)
          tr.push(tube([src, lerpV(src, dst, 0.5).add(V(0, 0, 0.003 * k)), dst], 0.005 * k, 0.004 * k, { belly: 0.2, ends: 0.1 }))
        })
      })
      b.part('trapezio', 'Trapézio', 'muscle', tr, { anchor: V(0.06 * k, ly(n - 3).y, backAt(0.06 * k, ly(n - 3)) + 0.006 * k) })
    }
  })
}

// ─── Segmentos (braço, antebraço, coxa, perna): ossos + músculos ─────────────
// real: peças do BodyParts3D que substituem a forma procedural
const FLEX = ['flexor carpi radialis', 'palmaris longus', 'humeral head of flexor carpi ulnaris', 'ulnar head of flexor carpi ulnaris',
  'humeroulnar head of flexor digitorum superficialis', 'radial head of flexor digitorum superficialis', 'humeral head of pronator teres']
const EXT = ['extensor carpi radialis longus', 'extensor carpi radialis brevis', 'extensor digitorum', 'extensor digiti minimi',
  'humeral head of extensor carpi ulnaris', 'ulnar head of extensor carpi ulnaris']
// o = [lateral, frente] em frações da meia-largura/meia-profundidade do membro;
// r = fração do raio; t = trecho ao longo do segmento (0 = junta de cima)
const SEGMENTS = {
  arm: { a: 'shoulder', b: 'elbow',
    bones: [{ id: 'umero', label: 'Úmero', o: [0.05, -0.05], r: 0.013, real: ['humerus'] }],
    muscles: [
      { id: 'biceps', label: 'Bíceps', o: [0, 0.5], r: 0.3, t: [0.22, 0.9], belly: 0.5, tendon: 1.02, real: ['long head of biceps brachii', 'short head of biceps brachii'] },
      { id: 'braquial', label: 'Braquial', o: [0.12, 0.2], r: 0.22, t: [0.45, 1.0], minor: true, real: ['brachialis'] },
      { id: 'triceps', label: 'Tríceps', o: [0, -0.52], r: 0.34, t: [0.08, 0.92], belly: 0.4, real: ['long head of triceps brachii', 'lateral head of triceps brachii', 'medial head of triceps brachii'] },
      { id: 'deltoide', label: 'Deltoide', o: [0.5, 0.05], r: 0.36, t: [-0.08, 0.36], minor: true, real: ['clavicular part of deltoid', 'acromial part of deltoid', 'spinal part of deltoid'] }
    ] },
  forearm: { a: 'elbow', b: 'hand', palm: true,
    bones: [{ id: 'radio', label: 'Rádio', o: [0.42, 0], r: 0.0065, real: ['radius'] }, { id: 'ulna', label: 'Ulna', o: [-0.42, -0.12], r: 0.006, minor: true, real: ['ulna'] }],
    muscles: [
      { id: 'flexores', label: 'Músculos flexores', o: [-0.15, 0.5], r: 0.36, t: [0.02, 0.62], belly: 0.5, tendon: 1.0, real: FLEX },
      { id: 'extensores', label: 'Músculos extensores', o: [0.2, -0.5], r: 0.33, t: [0.02, 0.6], belly: 0.5, tendon: 1.0, real: EXT },
      { id: 'braquiorradial', label: 'Braquiorradial', o: [0.62, 0.3], r: 0.26, t: [-0.06, 0.55], minor: true, real: ['brachioradialis'] }
    ] },
  thigh: { a: 'upper-leg', b: 'knee',
    bones: [{ id: 'femur', label: 'Fêmur', o: [0.08, 0.05], r: 0.0145, real: ['femur'] }],
    muscles: [
      { id: 'retoFemoral', label: 'Reto femoral (quadríceps)', o: [0, 0.6], r: 0.3, t: [0.04, 0.84], belly: 0.4, tendon: 0.98, real: ['rectus femoris'] },
      { id: 'vastoLateral', label: 'Vasto lateral', o: [0.56, 0.22], r: 0.32, t: [0.14, 0.92], belly: 0.35, real: ['vastus lateralis'] },
      { id: 'vastoMedial', label: 'Vasto medial', o: [-0.48, 0.3], r: 0.3, t: [0.45, 0.96], belly: 0.4, minor: true, real: ['vastus medialis'] },
      { id: 'bicepsFemoral', label: 'Bíceps femoral (isquiotibial)', o: [0.34, -0.55], r: 0.28, t: [0.1, 0.9], belly: 0.4, tendon: 1.04, real: ['long head of biceps femoris', 'short head of biceps femoris'] },
      { id: 'semitendineo', label: 'Semitendíneo', o: [-0.3, -0.58], r: 0.26, t: [0.08, 0.88], belly: 0.4, minor: true, real: ['semitendinosus'] },
      { id: 'adutores', label: 'Adutores', o: [-0.6, -0.05], r: 0.32, t: [-0.02, 0.6], belly: 0.3, real: ['adductor longus', 'adductor brevis', 'adductor magnus'] }
    ] },
  leg: { a: 'knee', b: 'ankle',
    bones: [{ id: 'tibia', label: 'Tíbia', o: [-0.22, 0.48], r: 0.0135, real: ['tibia'] }, { id: 'fibula', label: 'Fíbula', o: [0.5, -0.05], r: 0.0065, minor: true, real: ['fibula'] }],
    muscles: [
      { id: 'gastroMedial', label: 'Gastrocnêmio medial', o: [-0.32, -0.52], r: 0.3, t: [-0.02, 0.55], belly: 0.5, real: ['medial head of gastrocnemius'] },
      { id: 'gastroLateral', label: 'Gastrocnêmio lateral', o: [0.3, -0.52], r: 0.26, t: [-0.02, 0.5], belly: 0.5, minor: true, real: ['lateral head of gastrocnemius'] },
      { id: 'soleo', label: 'Sóleo', o: [0, -0.3], r: 0.34, t: [0.18, 0.84], belly: 0.3, real: ['soleus'] },
      { id: 'tibialAnterior', label: 'Tibial anterior', o: [0.3, 0.52], r: 0.2, t: [0.05, 0.75], minor: true, real: ['tibialis anterior'] },
      { id: 'aquiles', label: 'Tendão de Aquiles', o: [0, -0.62], r: 0.1, t: [0.72, 1.04], kind: 'tendon', minor: true, real: ['calcaneal tendon'] }
    ] }
}

function segment(ctx, S) {
  const A = ctx.J(ctx.pre + S.a), B = ctx.J(ctx.pre + S.b)
  const axis = B.clone().sub(A)
  const zHint = S.palm ? handAxes(ctx).N : V(0, 0, 1)
  const TS = [0.25, 0.5, 0.75]
  const fits = TS.map(t => ctx.fit(lerpV(A, B, t), axis.clone().negate(), zHint))
  // desvio do centro real do membro em relação à linha entre as juntas
  const offs = fits.map((f, i) => f.center.clone().sub(lerpV(A, B, TS[i])))
  const at = t => {
    const tt = THREE.MathUtils.clamp(t, 0.25, 0.75)
    const i = tt < 0.5 ? 0 : 1, u = (tt - TS[i]) / 0.25
    const f0 = fits[i], f1 = fits[i + 1]
    return {
      c: lerpV(A, B, t).add(lerpV(offs[i], offs[i + 1], u)),
      hw: f0.halfW + (f1.halfW - f0.halfW) * u, hd: f0.halfD + (f1.halfD - f0.halfD) * u
    }
  }
  // no antebraço, "lateral" = lado do polegar (radial)
  const X = S.palm ? handAxes(ctx).R : fits[1].x, Z = fits[1].z
  const P = (t, o) => { const s = at(t); return s.c.clone().addScaledVector(X, o[0] * s.hw).addScaledVector(Z, o[1] * s.hd) }
  const b = new Build(ctx)
  const rr = Math.min(fits[1].halfW, fits[1].halfD)

  const ks = ctx.H / 1.78
  S.bones.forEach(bn => b.realOr(bn.id, bn.label, 'bone', bn.real || [], () => [
    tube([0.02, 0.3, 0.7, 0.98].map(t => P(t, bn.o)), bn.r * ks, bn.r * ks, { ends: 0.03 }),
    ellipsoid(P(0.02, bn.o), bn.r * ks * 1.35), ellipsoid(P(0.98, bn.o), bn.r * ks * 1.35)
  ], { minor: bn.minor, anchor: P(0.5, bn.o) }))
  S.muscles.forEach(m => {
    const [t0, t1] = m.t, r = m.r * rr * (m.kind ? 1 : 1.3)
    const pts = [0, 0.25, 0.5, 0.75, 1].map(u => P(t0 + (t1 - t0) * u, m.o))
    let mid = P((t0 + t1) / 2, m.o)
    const real = m.real && m.real.every(n => b.hasReal(n))
    if (real) {
      // músculo real: ruptura no meio do ventre, rótulo na superfície voltada para fora
      const pts2 = m.real.flatMap(n => b.points(n, () => true)).filter((_, i) => i % 3 === 0)
      const c = pts2.reduce((s, p) => s.add(p), V()).multiplyScalar(1 / pts2.length)
      const out = mid.clone().sub(lerpV(A, B, (t0 + t1) / 2)).normalize()
      mid = pts2.reduce((best, p) => (p.clone().sub(c).dot(out) > best.clone().sub(c).dot(out) ? p : best), c)
      const along = pts2.map(p => p.clone().sub(c).dot(axis.clone().normalize()))
      const half = (Math.max(...along) - Math.min(...along)) / 2
      b.realOr(m.id, m.label, m.kind || 'muscle', m.real, null, {
        minor: m.minor, anchor: mid, opacity: m.kind ? 0.97 : 0.86,
        tear: { p: c.clone().addScaledVector(axis.clone().normalize(), half * 0.1), n: axis.clone().normalize(), w: 0.0022, r: r * 1.4 }
      })
      return
    }
    b.part(m.id, m.label, m.kind || 'muscle', tube(pts, r, r, { belly: m.kind ? 0 : (m.belly || 0.3), ends: m.kind ? 0 : 0.14 }), {
      minor: m.minor, anchor: mid,
      tear: { p: mid, n: axis.clone().normalize(), w: 0.0022, r: r * 1.05 }
    })
    if (m.tendon) b.part(m.id, null, 'tendon', tube([P(t1 - 0.04, m.o), P(m.tendon, [m.o[0] * 0.6, m.o[1] * 0.8])], r * 0.22, r * 0.18))
  })
  const mid = lerpV(A, B, 0.5)
  const L = axis.length()
  b.context(mid, L * 0.62, { opacity: 0.3 })
  return b.done(mid.clone().applyMatrix4(b.inv), L * 0.34, L * 0.62)
}

// ─── Registro ────────────────────────────────────────────────────────────────
const BUILDERS = {
  knee, shoulder, elbow, hand, hip, ankle, foot: ankle,
  lumbar, cervical, thoracic,
  arm: ctx => segment(ctx, SEGMENTS.arm),
  forearm: ctx => segment(ctx, SEGMENTS.forearm),
  thigh: ctx => segment(ctx, SEGMENTS.thigh),
  leg: ctx => segment(ctx, SEGMENTS.leg)
}

export function hasAnatomy(model) { return !!BUILDERS[model] }

// ctx: { J, Jopt, ray, fit, pre, sx, H, region, shared }
export function buildAnatomy(model, ctx) {
  const fn = BUILDERS[model]
  return fn ? fn(ctx) : null
}
