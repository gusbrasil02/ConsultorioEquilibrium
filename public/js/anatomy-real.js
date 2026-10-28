import * as THREE from 'three'

// ─── Anatomia real (BodyParts3D) ─────────────────────────────────────────────
// Ossos, músculos e órgãos de verdade, já encaixados em cada corpo por
// tools/anatomy/build_anatomy.py. Três camadas por corpo, carregadas sob
// demanda e guardadas em cache:
//   /models/anatomy-<corpo>-bones.bin    ossos, dentes, cartilagens, discos
//   /models/anatomy-<corpo>-muscles.bin  músculos, tendões, fáscias
//   /models/anatomy-<corpo>-organs.bin   órgãos e grandes vasos
//
// Cada peça: { id, base (nome em inglês, sem lado), label (português, com lado),
// name (português, sem lado), kind (tecido), side ('D' | 'E' | null),
// key (músculo de muscle-data.js), mer (meridiano do órgão), geometry, c, r }.
// A geometria traz a oclusão ambiente "assada" no atributo `ao` e, nos
// músculos, o quanto cada ponto é tendão (parte fina) no atributo `tn`.

export const CREDIT = 'Anatomia: BodyParts3D © DBCLS (CC BY-SA 2.1 JP)'

const _cache = new Map()

export function loadLayer(body, layer) {
  const k = body + ':' + layer
  if (!_cache.has(k)) {
    const p = fetchLayer(`/models/anatomy-${body}-${layer}.bin`)
    p.catch(() => _cache.delete(k))
    _cache.set(k, p)
  }
  return _cache.get(k)
}

async function fetchLayer(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  let buf = await res.arrayBuffer()
  const u8 = new Uint8Array(buf, 0, 2)
  if (u8[0] === 0x1f && u8[1] === 0x8b) {
    buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
  }
  const dv = new DataView(buf)
  const hl = dv.getUint32(0, true)
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl)))
  const base = 4 + hl
  const parts = head.parts.map(p => {
    let o = base + p.off
    const q = new Uint16Array(buf.slice(o, o + p.nv * 6)); o += p.nv * 6
    const ao = new Uint8Array(buf.slice(o, o + p.nv)); o += p.nv
    const tn = p.tn ? new Uint8Array(buf.slice(o, o + p.nv)) : new Uint8Array(p.nv); if (p.tn) o += p.nv
    o += (-(p.nv * (p.tn ? 8 : 7))) & 3
    const idx = p.i32 ? new Uint32Array(buf.slice(o, o + p.nt * 12)) : new Uint16Array(buf.slice(o, o + p.nt * 6))
    const pos = new Float32Array(p.nv * 3)
    for (let a = 0; a < 3; a++) {
      const lo = p.lo[a], s = (p.hi[a] - p.lo[a]) / 65535
      for (let i = 0; i < p.nv; i++) pos[i * 3 + a] = lo + q[i * 3 + a] * s
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('ao', new THREE.BufferAttribute(ao, 1, true))
    g.setAttribute('tn', new THREE.BufferAttribute(tn, 1, true))
    g.setIndex(new THREE.BufferAttribute(idx, 1))
    g.computeVertexNormals()
    g.computeBoundingSphere()
    return {
      id: p.id, en: p.en, base: p.base, label: p.label, name: p.name, kind: p.kind, side: p.side, layer: head.layer,
      key: p.key || null, mer: p.mer || null, axis: p.ax ? new THREE.Vector3(...p.ax) : null,
      c: new THREE.Vector3(...p.c), r: p.r, geometry: g
    }
  })
  return { credit: head.credit, parts }
}

// ─── Aparência dos tecidos ───────────────────────────────────────────────────
// color: cor base; sss: cor que "atravessa" o tecido (translucidez no
// terminador); rough: rugosidade; fiber: estrias ao longo do músculo;
// pores: porosidade do osso; wet: brilho úmido (clearcoat)
export const LOOK = {
  bone:       { color: 0xe3d5b8, sss: 0xc98f6a, rough: 0.62, pores: 1, wet: 0.05 },
  tooth:      { color: 0xf1ecdf, sss: 0xd8c8a8, rough: 0.25, wet: 0.5 },
  gum:        { color: 0xc86a72, sss: 0xff8f8f, rough: 0.4, wet: 0.6 },
  cartilage:  { color: 0xc9dbe0, sss: 0x9ec6d8, rough: 0.3, wet: 0.55 },
  disc:       { color: 0xd6dfe6, sss: 0xa8c4dc, rough: 0.35, wet: 0.45 },
  muscle:     { color: 0xa8322f, sss: 0xff4a3a, rough: 0.42, fiber: 1, wet: 0.45 },
  tendon:     { color: 0xe6e0d4, sss: 0xd8c8b0, rough: 0.3, fiber: 0.6, wet: 0.55 },
  lung:       { color: 0xd98c8f, sss: 0xff9a9a, rough: 0.55, wet: 0.35 },
  airway:     { color: 0xe7c9b8, sss: 0xffd0c0, rough: 0.4, wet: 0.4 },
  heart:      { color: 0x9e2f2c, sss: 0xff5040, rough: 0.38, fiber: 0.35, wet: 0.6 },
  liver:      { color: 0x7a2a22, sss: 0xc04a3a, rough: 0.32, wet: 0.65 },
  gallbladder:{ color: 0x5f8a4a, sss: 0x9ad070, rough: 0.3, wet: 0.7 },
  stomach:    { color: 0xd78a7c, sss: 0xffa898, rough: 0.38, wet: 0.6 },
  spleen:     { color: 0x6e2438, sss: 0xb04060, rough: 0.35, wet: 0.6 },
  pancreas:   { color: 0xe0b48a, sss: 0xffd0a0, rough: 0.5, wet: 0.45 },
  smallint:   { color: 0xdc9a88, sss: 0xffb6a0, rough: 0.38, wet: 0.65 },
  colon:      { color: 0xcf9a80, sss: 0xffb898, rough: 0.42, wet: 0.6 },
  kidney:     { color: 0x8c3a30, sss: 0xd06050, rough: 0.35, wet: 0.6 },
  adrenal:    { color: 0xd8a848, sss: 0xffd070, rough: 0.45, wet: 0.4 },
  urinary:    { color: 0xe0c090, sss: 0xffe0b0, rough: 0.4, wet: 0.5 },
  bladder:    { color: 0xd9a796, sss: 0xffc8b8, rough: 0.4, wet: 0.6 },
  thymus:     { color: 0xd8b0a0, sss: 0xffd0c0, rough: 0.5, wet: 0.4 },
  diaphragm:  { color: 0xa63c36, sss: 0xff5a48, rough: 0.42, fiber: 0.8, wet: 0.45 },
  artery:     { color: 0xb5231f, sss: 0xff3a2a, rough: 0.3, wet: 0.65 },
  vein:       { color: 0x3c4f9a, sss: 0x6a80e0, rough: 0.3, wet: 0.65 },
  // estruturas desenhadas à mão (visão interna)
  ligament:   { color: 0xd9d3c2, sss: 0xc8b89a, rough: 0.28, fiber: 0.7, wet: 0.6 },
  nerve:      { color: 0xf0cc58, sss: 0xffe080, rough: 0.35, fiber: 0.4, wet: 0.5 },
  bursa:      { color: 0x9cc8dc, sss: 0xd0f0ff, rough: 0.15, wet: 0.9 },
  capsule:    { color: 0xdfe8ea, sss: 0xf0ffff, rough: 0.2, wet: 0.8 }
}

// Ruído 3D compartilhado pelos tecidos
const NOISE = `
float arH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float arN(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(arH(i), arH(i + vec3(1,0,0)), f.x), mix(arH(i + vec3(0,1,0)), arH(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(arH(i + vec3(0,0,1)), arH(i + vec3(1,0,1)), f.x), mix(arH(i + vec3(0,1,1)), arH(i + vec3(1,1,1)), f.x), f.y), f.z);
}`

// Injeta, num MeshStandard/PhysicalMaterial, a aparência de tecido:
// oclusão assada, translucidez (luz "vermelha" no terminador), estrias das
// fibras (músculo/tendão), porosidade (osso) e variação de cor.
// `extra` (opcional) recebe { vertex, fragmentHead, fragmentEnd } para os
// efeitos do visualizador que usa o material.
export function tissueShader(mat, kind, { axis = null, uniforms = {}, extra = {} } = {}) {
  const L = LOOK[kind] || LOOK.bone
  const u = {
    uSss: { value: new THREE.Color(L.sss) },
    uFiber: { value: L.fiber || 0 },
    uPores: { value: L.pores || 0 },
    uAxis: { value: (axis || new THREE.Vector3(0, 1, 0)).clone().normalize() },
    ...uniforms
  }
  mat.userData.tu = u
  const prev = mat.onBeforeCompile
  mat.onBeforeCompile = (sh, r) => {
    Object.assign(sh.uniforms, u)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float ao;
attribute float tn;
varying float vAo;
varying float vTn;
varying vec3 vOPos;
varying vec3 vWPosT;
${extra.vertexHead || ''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
vAo = ao;
vTn = tn;
vOPos = position;
vWPosT = (modelMatrix * vec4(transformed, 1.0)).xyz;
${extra.vertex || ''}`)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uSss, uAxis;
uniform float uFiber, uPores;
varying float vAo;
varying float vTn;
varying vec3 vOPos;
varying vec3 vWPosT;
${NOISE}
${extra.fragmentHead || ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  // variação lenta de cor + estrias ao longo das fibras
  float tv = arN(vOPos * 60.0) * 0.6 + arN(vOPos * 180.0) * 0.4;
  diffuseColor.rgb *= 0.9 + 0.2 * tv;
  if (uFiber > 0.0) {
    vec3 a = normalize(uAxis);
    vec3 pp = vOPos - a * dot(vOPos, a);
    float f = arN(pp * 900.0 + a * dot(vOPos, a) * 25.0) * 0.6 + arN(pp * 2600.0) * 0.4;
    diffuseColor.rgb *= 1.0 - uFiber * (0.28 - 0.18 * vTn) * smoothstep(0.35, 0.8, f);
  }
  // tendão: branco-perolado onde o músculo afina
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.83, 0.76) * (0.92 + 0.12 * tv), smoothstep(0.15, 0.85, vTn));
  if (uPores > 0.0) {
    float pn = arN(vOPos * 1400.0);
    diffuseColor.rgb *= 1.0 - uPores * 0.12 * smoothstep(0.55, 0.85, pn);
  }
}`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
{
  reflectedLight.directSpecular *= 1.0 + 0.8 * vTn;
  float aoT = clamp(vAo, 0.0, 1.0);
  reflectedLight.indirectDiffuse *= aoT;
  reflectedLight.directDiffuse *= mix(1.0, aoT, 0.55);
  reflectedLight.indirectSpecular *= aoT * aoT;
}`)
      .replace('#include <opaque_fragment>', `
{
  // translucidez: luz que atravessa a borda (terminador) puxada para a cor do tecido
  vec3 nV = normalize(normal);
  vec3 vV = normalize(vViewPosition);
  float rim = pow(1.0 - clamp(abs(dot(nV, vV)), 0.0, 1.0), 2.5);
  outgoingLight += uSss * diffuseColor.rgb * rim * 0.35 * clamp(vAo, 0.3, 1.0);
}
${extra.fragmentEnd || ''}
#include <opaque_fragment>`)
    prev?.(sh, r)
  }
  mat.customProgramCacheKey = () => 'tissue:' + (extra.key || '')
  return mat
}

export function tissueMaterial(kind, opts = {}) {
  const L = LOOK[kind] || LOOK.bone
  const m = new THREE.MeshPhysicalMaterial({
    color: L.color, roughness: L.rough, metalness: 0, clearcoat: L.wet || 0, clearcoatRoughness: 0.35,
    envMapIntensity: 0.8, ...opts.params
  })
  return tissueShader(m, kind, opts)
}
