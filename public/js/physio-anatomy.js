import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// ─── Anatomia interna procedural (Anatomia 3D / fisioterapia) ────────────────
// Cada modelo (joelho, ombro, coluna…) é montado em código a partir de formas
// simples — tornos, cápsulas, tubos e superfícies — e encaixado no corpo 3D
// usando as juntas do esqueleto (joints.json) e raios lançados de dentro para a
// pele (espessura real do membro naquele ponto).
//
// Estilo: "holograma médico" — cores anatômicas (osso marfim, cartilagem azul,
// ligamento dourado, nervo amarelo, músculo vermelho translúcido) com brilho de
// borda. Lesões pulsam em vermelho; fissuras, desgaste e inchaço são feitos no
// shader (tear / wear) ou por escala, sem trocar a geometria.
//
// Unidades: metros. Os modelos de articulação são desenhados num referencial
// local (x = lateral, y = para cima / ao longo do osso, z = frente) com escala
// k = tamanho do membro deste corpo ÷ tamanho de referência.

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const Y = V(0, 1, 0)
const lerpV = (a, b, t) => a.clone().lerp(b, t)

// ─── Tecidos ─────────────────────────────────────────────────────────────────
export const KINDS = {
  bone:      { color: 0xe6dcc3, opacity: 1,    rim: 0x8fdcff, rimK: 0.45, order: 1, depthWrite: true },
  cartilage: { color: 0x74bfff, opacity: 0.6,  rim: 0xc4ecff, rimK: 0.7,  order: 2 },
  meniscus:  { color: 0xcfe6ff, opacity: 0.93, rim: 0xa8e4ff, rimK: 0.6,  order: 2, depthWrite: true },
  disc:      { color: 0x5b98ff, opacity: 0.88, rim: 0xb8d8ff, rimK: 0.6,  order: 2, depthWrite: true },
  ligament:  { color: 0xeec45a, opacity: 0.95, rim: 0xffe6a0, rimK: 0.55, order: 3, depthWrite: true },
  tendon:    { color: 0xe2ebf5, opacity: 0.95, rim: 0xffffff, rimK: 0.5,  order: 3, depthWrite: true },
  nerve:     { color: 0xffd23a, opacity: 1,    rim: 0xfff0a0, rimK: 0.6,  order: 3, depthWrite: true, emissive: 0x5a4200 },
  fascia:    { color: 0xd5e6f2, opacity: 0.85, rim: 0xffffff, rimK: 0.5,  order: 3, depthWrite: true },
  deposit:   { color: 0xffffff, opacity: 1,    rim: 0xffffff, rimK: 0.9,  order: 2, depthWrite: true, emissive: 0x505050 },
  muscle:    { color: 0xc23c50, opacity: 0.32, rim: 0xff8fa0, rimK: 0.55, order: 4, lesionA: 0.5 },
  bursa:     { color: 0x6fe0ff, opacity: 0.42, rim: 0xd0f8ff, rimK: 0.8,  order: 4, lesionA: 0.7 },
  capsule:   { color: 0x72e0c4, opacity: 0.15, rim: 0xb0fff0, rimK: 0.7,  order: 5, lesionA: 0.4 }
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

export function tissueMaterial(kind, shared, { side = THREE.FrontSide } = {}) {
  const K = KINDS[kind]
  const m = new THREE.MeshStandardMaterial({
    color: K.color, roughness: 0.42, metalness: 0.05, transparent: true, opacity: K.opacity,
    depthWrite: !!K.depthWrite, emissive: K.emissive ?? 0x000000, side, envMapIntensity: 0.75
  })
  const u = {
    uTime: shared.uTime, uFocus: shared.uFocus, uRevealO: shared.uRevealO, uRevealN: shared.uRevealN, uReveal: shared.uReveal,
    uRimColor: { value: new THREE.Color(K.rim) }, uRimK: { value: K.rimK },
    uLesion: { value: 0 }, uLesionColor: { value: new THREE.Color(0xff2a1a) },
    uTearOn: { value: 0 }, uTearP: { value: new THREE.Vector4(0, 0, 0, 0.001) }, uTearN: { value: V(0, 1, 0) }, uTearR: { value: 1 },
    uWear: { value: 0 }, uDim: { value: 0 }, uHover: { value: 0 }, uLesionA: { value: K.lesionA ?? 0.85 }
  }
  m.userData.u = u
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vLPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvLPos = transformed;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime, uLesion, uTearOn, uTearR, uWear, uDim, uHover, uRimK, uReveal, uLesionA;
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
outgoingLight *= 1.0 - uDim * 0.6;
diffuseColor.a *= 1.0 - uDim * 0.6;
diffuseColor.a = max(diffuseColor.a, max(uLesion * uLesionA, max(phyTear, phyWear)));
diffuseColor.a = max(diffuseColor.a, phyReveal) * phyFk;
#include <opaque_fragment>`)
  }
  return m
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
  part(id, label, kind, geos, o = {}) {
    const list = (Array.isArray(geos) ? geos : [geos]).filter(Boolean)
    if (!list.length) return null
    const geo = list.length > 1 ? mergeGeometries(list) : list[0]
    const mesh = new THREE.Mesh(geo, tissueMaterial(kind, this.ctx.shared, { side: o.side }))
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
function knee(ctx) {
  const K = ctx.J(ctx.pre + 'knee'), Hp = ctx.J(ctx.pre + 'upper-leg'), A = ctx.J(ctx.pre + 'ankle')
  const f = ctx.fit(K, Hp.clone().sub(K))
  const k = THREE.MathUtils.clamp((f.halfW + f.halfD) / 2 / 0.056, 0.8, 1.2)
  const b = new Build(ctx, frameM(f.center, f.x, f.y, f.z, k))
  const qT = new THREE.Quaternion().setFromUnitVectors(V(0, -1, 0), b.Ld(A.clone().sub(K)))
  const low = v => v.clone().applyQuaternion(qT)
  const lowG = g => { g.applyQuaternion(qT); return g }
  const zP = THREE.MathUtils.clamp(f.halfD / k - 0.019, 0.032, 0.046)   // patela ~2 cm sob a pele

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

  b.part('radioUlna', 'Rádio e ulna', 'bone', [
    tube([at(W, -0.13, 0.008), at(W, -0.05, 0.009), at(W, -0.013, 0.01)], 0.006 * s, 0.0105 * s),
    ellipsoid(at(W, -0.007, 0.017), 0.0042 * s),
    tube([at(W, -0.13, -0.009), at(W, -0.016, -0.012, -0.001)], 0.0065 * s, 0.006 * s),
    ellipsoid(at(W, -0.016, -0.012, -0.001), 0.0068 * s)
  ], { anchor: at(W, -0.03, 0.01), minor: true })

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

  // Túnel do carpo: tendões flexores + nervo mediano sob o retináculo
  const flex = D.map((d, i) => tube([at(W, -0.08, off[i] * 0.5, 0.005), at(W, 0.0, off[i] * 0.6, 0.009), at(W, 0.016, off[i] * 0.7, 0.0095),
    d[0].clone().addScaledVector(N, 0.0068 * s), d[1].clone().addScaledVector(N, 0.0058 * s), d[2].clone().addScaledVector(N, 0.005 * s)], 0.0017 * s))
  flex.push(tube([at(W, -0.08, 0.004, 0.005), at(W, 0.004, 0.008, 0.009), T[1].clone().addScaledVector(N, 0.005 * s), T[2].clone().addScaledVector(N, 0.004 * s)], 0.0017 * s))
  b.part('tendoesFlexores', 'Tendões flexores', 'tendon', flex, { anchor: at(W, 0.035, 0, 0.009) })

  const mSplit = at(W, 0.03, 0.004, 0.011)
  b.part('nervoMediano', 'Nervo mediano', 'nerve', [
    tube([at(W, -0.1, 0, 0.006), at(W, -0.03, 0.001, 0.009), at(W, 0.012, 0.002, 0.0128), mSplit], 0.0024 * s),
    tube([mSplit, lerpV(mSplit, T[1], 0.5).addScaledVector(N, 0.006 * s), T[1].clone().addScaledVector(N, 0.007 * s)], 0.0015 * s),
    tube([mSplit, mcp[0].clone().addScaledVector(N, 0.009 * s)], 0.0015 * s),
    tube([mSplit, mcp[1].clone().addScaledVector(N, 0.009 * s)], 0.0015 * s)
  ], { anchor: at(W, 0.0, 0.001, 0.009) })

  const ret = new THREE.TorusGeometry(0.016 * s, 0.0022 * s, 8, 28, Math.PI)
  ret.scale(1, 1, 3.4)
  bake(ret, new THREE.Matrix4().makeBasis(R, N, F).setPosition(at(W, 0.014, 0, 0.003)))
  b.part('retinaculo', 'Retináculo dos flexores (teto do túnel do carpo)', 'ligament', ret, { side: THREE.DoubleSide, anchor: at(W, 0.014, 0, 0.019) })

  b.part('tendoesPolegar', 'Tendões do polegar (1º compartimento)', 'tendon', [-1, 1].map(sg =>
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
function spine(ctx, cfg) {
  const k = ctx.H / 1.78
  const b = new Build(ctx)
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
    b.part(name, `Vértebra ${name}`, 'bone', geos, {
      minor: true, level: i, anchor: at(0, 0, Dd * 0.2), shift: V(0, 0, 0.45 * Dd)
    })
    facets.push({ i, geo: [-1, 1].flatMap(s => [
      ellipsoid(at(s * 0.44 * Wd, 0.52 * hb, -Dd - 0.6 * Wd), 0.14 * Wd),
      ellipsoid(at(s * 0.4 * Wd, -0.46 * hb, -Dd - 0.72 * Wd), 0.13 * Wd)
    ]) })
    osteo.push({ i, geo: [-1, 1].flatMap(s => [
      spike(at(s * w * 0.92, hb * 0.46, d * 0.3), V(s, 0.5, 0.35), 0.006 * k, 0.0024 * k),
      spike(at(s * w * 0.92, -hb * 0.46, d * 0.3), V(s, -0.5, 0.35), 0.006 * k, 0.0024 * k)
    ]) })
  })
  facets.forEach(f => b.part('facetas', 'Articulações facetárias', 'cartilage', f.geo, { minor: true, level: f.i, anchor: V(0, lv[Math.floor(n / 2)].y, lv[Math.floor(n / 2)].zc - lv[0].d - lv[0].w * 0.7) }))
  osteo.forEach(o => b.part('osteofitos', 'Osteófitos ("bicos de papagaio")', 'bone', o.geo, { extra: true, level: o.i, anchor: V(lv[0].w, lv[Math.floor(n / 2)].y, lv[Math.floor(n / 2)].zc) }))

  // Discos: abaixo de cada vértebra (cfg.discs[i] = id do disco sob a vértebra i)
  const discY = i => lv[i].y - hb / 2 - g / 2
  lv.forEach((l, i) => {
    const id = cfg.discs[i]
    if (!id) return
    const y = discY(i), zc = i > 0 ? (l.zc + lv[i - 1].zc) / 2 : l.zc, w = l.w
    b.part('disco' + id.key, `Disco ${id.label}`, 'disc',
      lathe(V(0, y - g / 2, zc), Y, [[0, 0], [w * 0.95, 0], [w * 1.03, g / 2], [w * 0.95, g], [0, g]], { sz: cfg.dRatio }), {
        minor: true, level: i, anchor: V(0, y, zc + l.d * 0.4)
      })
  })

  // Hérnia (lado direito do paciente = X negativo)
  const hi = cfg.hernia.level, hl = lv[hi], hy = discY(hi)
  b.part('hernia', `Hérnia de disco (${cfg.discs[hi].label})`, 'disc',
    ellipsoid(V(-0.42 * hl.w, hy, hl.zc - hl.d - 0.12 * hl.w), 0.32 * hl.w, Math.max(g * 0.75, 0.3 * hl.w * 0.5), 0.34 * hl.w), { extra: true, level: hi })

  // Raízes nervosas por nível; a comprimida pela hérnia fica separada
  const roots = [], affected = []
  lv.forEach((l, i) => {
    if (!cfg.discs[i]) return
    const y = discY(i), W = l.w, zc = l.zc, dd = l.d
    ;[-1, 1].forEach(s => {
      const r = tube([V(s * 0.22 * W, y + 0.35 * hb, zc - dd - 0.45 * W), V(s * 0.74 * W, y + 0.02 * hb, zc - dd - 0.28 * W),
        V(s * 1.18 * W, y - cfg.rootDrop * hb, zc - dd * 0.25), V(s * 1.6 * W, y - cfg.rootDrop * 2.2 * hb, zc + 0.1 * W)], 0.075 * W, 0.06 * W)
      ;(i === hi && s === -1 ? affected : roots).push({ r, i })
    })
  })
  roots.forEach(({ r, i }) => b.part('nervos', 'Raízes nervosas', 'nerve', r, { minor: true, level: i }))
  affected.forEach(({ r, i }) => b.part('raiz', cfg.hernia.root, 'nerve', r, { minor: true, level: i, anchor: V(-0.9 * hl.w, hy - 0.2 * hb, hl.zc - hl.d - 0.2 * hl.w) }))

  const canal = lv.map(l => V(0, l.y, l.zc - l.d - 0.55 * l.w))
  canal.unshift(canal[0].clone().add(V(0, -hb, 0)))
  canal.push(canal[canal.length - 1].clone().add(V(0, hb, 0)))
  b.part('medula', cfg.cordLabel, 'nerve', tube(canal, cfg.cord * lv[0].w), { minor: true })

  // Músculos paravertebrais
  const mus = s => tube([
    V(s * 1.05 * lv[0].w, cfg.yBot - 0.02 * k, lv[0].zc - lv[0].d - 1.25 * lv[0].w),
    ...lv.filter((_, i) => i % 2 === 0).map(l => V(s * 1.05 * l.w, l.y, l.zc - l.d - 1.3 * l.w)),
    V(s * 1.05 * lv[n - 1].w, cfg.yTop + 0.02 * k, lv[n - 1].zc - lv[n - 1].d - 1.2 * lv[n - 1].w)
  ], cfg.muscle * lv[0].w, cfg.muscle * lv[n - 1].w, { belly: 0.2, ends: 0.1 })
  const mid = lv[Math.floor(n / 2)]
  b.part('musculoD', 'Músculos paravertebrais (lado direito)', 'muscle', mus(-1), { anchor: V(-1.1 * mid.w, mid.y, mid.zc - mid.d - 1.3 * mid.w) })
  b.part('musculoE', 'Músculos paravertebrais (lado esquerdo)', 'muscle', mus(1), { anchor: V(1.1 * mid.w, mid.y, mid.zc - mid.d - 1.3 * mid.w) })

  // Escoliose: desloca cada nível lateralmente numa curva em "C"
  b.custom.escoliose = amt => {
    b.group.children.forEach(m => {
      const i = m.userData.level
      if (i == null) return
      m.userData.off = V(Math.sin(Math.PI * (i + 0.5) / n) * 0.022 * k * amt, 0, 0)
    })
  }

  cfg.extras?.(b, lv, { k, hb, g, n })
  const cy = (cfg.yBot + cfg.yTop) / 2
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
    rootDrop: 1.1, cord: 0.26, cordLabel: 'Cauda equina (nervos)', muscle: 0.62,
    hernia: { level: 1, root: 'Raiz nervosa L5' },
    extras(b, lv) {
      const l = lv[0], w = l.w
      b.part('sacro', 'Sacro', 'bone', tube([
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
    rootDrop: 0.5, cord: 0.42, cordLabel: 'Medula espinhal', muscle: 0.5,
    hernia: { level: 2, root: 'Raiz nervosa C6' },
    extras(b, lv) {
      const top = lv[lv.length - 1], bot = lv[0]
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
    rootDrop: 0.4, cord: 0.36, cordLabel: 'Medula espinhal', muscle: 0.5,
    hernia: { level: 5, root: 'Raiz nervosa T8' },
    extras(b, lv, { n }) {
      // Costelas (parte de trás), escápulas, romboides e trapézio
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
// o = [lateral, frente] em frações da meia-largura/meia-profundidade do membro;
// r = fração do raio; t = trecho ao longo do segmento (0 = junta de cima)
const SEGMENTS = {
  arm: { a: 'shoulder', b: 'elbow',
    bones: [{ id: 'umero', label: 'Úmero', o: [0.05, -0.05], r: 0.013 }],
    muscles: [
      { id: 'biceps', label: 'Bíceps', o: [0, 0.5], r: 0.3, t: [0.22, 0.9], belly: 0.5, tendon: 1.02 },
      { id: 'braquial', label: 'Braquial', o: [0.12, 0.2], r: 0.22, t: [0.45, 1.0], minor: true },
      { id: 'triceps', label: 'Tríceps', o: [0, -0.52], r: 0.34, t: [0.08, 0.92], belly: 0.4 },
      { id: 'deltoide', label: 'Deltoide', o: [0.5, 0.05], r: 0.36, t: [-0.08, 0.36], minor: true }
    ] },
  forearm: { a: 'elbow', b: 'hand', palm: true,
    bones: [{ id: 'radio', label: 'Rádio', o: [0.42, 0], r: 0.0065 }, { id: 'ulna', label: 'Ulna', o: [-0.42, -0.12], r: 0.006, minor: true }],
    muscles: [
      { id: 'flexores', label: 'Músculos flexores', o: [-0.15, 0.5], r: 0.36, t: [0.02, 0.62], belly: 0.5, tendon: 1.0 },
      { id: 'extensores', label: 'Músculos extensores', o: [0.2, -0.5], r: 0.33, t: [0.02, 0.6], belly: 0.5, tendon: 1.0 },
      { id: 'braquiorradial', label: 'Braquiorradial', o: [0.62, 0.3], r: 0.26, t: [-0.06, 0.55], minor: true }
    ] },
  thigh: { a: 'upper-leg', b: 'knee',
    bones: [{ id: 'femur', label: 'Fêmur', o: [0.08, 0.05], r: 0.0145 }],
    muscles: [
      { id: 'retoFemoral', label: 'Reto femoral (quadríceps)', o: [0, 0.6], r: 0.3, t: [0.04, 0.84], belly: 0.4, tendon: 0.98 },
      { id: 'vastoLateral', label: 'Vasto lateral', o: [0.56, 0.22], r: 0.32, t: [0.14, 0.92], belly: 0.35 },
      { id: 'vastoMedial', label: 'Vasto medial', o: [-0.48, 0.3], r: 0.3, t: [0.45, 0.96], belly: 0.4, minor: true },
      { id: 'bicepsFemoral', label: 'Bíceps femoral (isquiotibial)', o: [0.34, -0.55], r: 0.28, t: [0.1, 0.9], belly: 0.4, tendon: 1.04 },
      { id: 'semitendineo', label: 'Semitendíneo', o: [-0.3, -0.58], r: 0.26, t: [0.08, 0.88], belly: 0.4, minor: true },
      { id: 'adutores', label: 'Adutores', o: [-0.6, -0.05], r: 0.32, t: [-0.02, 0.6], belly: 0.3 }
    ] },
  leg: { a: 'knee', b: 'ankle',
    bones: [{ id: 'tibia', label: 'Tíbia', o: [-0.22, 0.48], r: 0.0135 }, { id: 'fibula', label: 'Fíbula', o: [0.5, -0.05], r: 0.0065, minor: true }],
    muscles: [
      { id: 'gastroMedial', label: 'Gastrocnêmio medial', o: [-0.32, -0.52], r: 0.3, t: [-0.02, 0.55], belly: 0.5 },
      { id: 'gastroLateral', label: 'Gastrocnêmio lateral', o: [0.3, -0.52], r: 0.26, t: [-0.02, 0.5], belly: 0.5, minor: true },
      { id: 'soleo', label: 'Sóleo', o: [0, -0.3], r: 0.34, t: [0.18, 0.84], belly: 0.3 },
      { id: 'tibialAnterior', label: 'Tibial anterior', o: [0.3, 0.52], r: 0.2, t: [0.05, 0.75], minor: true },
      { id: 'aquiles', label: 'Tendão de Aquiles', o: [0, -0.62], r: 0.1, t: [0.72, 1.04], kind: 'tendon', minor: true }
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
  S.bones.forEach(bn => b.part(bn.id, bn.label, 'bone', [
    tube([0.02, 0.3, 0.7, 0.98].map(t => P(t, bn.o)), bn.r * ks, bn.r * ks, { ends: 0.03 }),
    ellipsoid(P(0.02, bn.o), bn.r * ks * 1.35), ellipsoid(P(0.98, bn.o), bn.r * ks * 1.35)
  ], { minor: bn.minor, anchor: P(0.5, bn.o) }))
  S.muscles.forEach(m => {
    const [t0, t1] = m.t, r = m.r * rr * (m.kind ? 1 : 1.3)
    const pts = [0, 0.25, 0.5, 0.75, 1].map(u => P(t0 + (t1 - t0) * u, m.o))
    const mid = P((t0 + t1) / 2, m.o)
    b.part(m.id, m.label, m.kind || 'muscle', tube(pts, r, r, { belly: m.kind ? 0 : (m.belly || 0.3), ends: m.kind ? 0 : 0.14 }), {
      minor: m.minor, anchor: mid,
      tear: { p: mid, n: axis.clone().normalize(), w: 0.0022, r: r * 1.05 }
    })
    if (m.tendon) b.part(m.id, null, 'tendon', tube([P(t1 - 0.04, m.o), P(m.tendon, [m.o[0] * 0.6, m.o[1] * 0.8])], r * 0.22, r * 0.18))
  })
  const mid = lerpV(A, B, 0.5)
  const L = axis.length()
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
