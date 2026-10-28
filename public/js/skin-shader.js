import * as THREE from 'three'

// ─── Pele realista e luz de estúdio (Anatomia 3D e atlas de acupuntura) ──────
// A pele do MakeHuman só tem a cor. Aqui ela ganha:
//   - translucidez (subsurface): na passagem da luz para a sombra a luz
//     "vaza" avermelhada por baixo da pele, como na pele de verdade, e
//     atravessa as bordas finas contra a luz (orelhas, dedos, nariz);
//   - microvariação de brilho (oleosidade/poros) sem textura extra;
//   - sombras suaves do próprio corpo (braço sobre o tronco, queixo no pescoço).

export function skinMaterial(mat, { sss = 0xc8583a, strength = 0.5, wrap = 0.5 } = {}) {
  const u = { uSssColor: { value: new THREE.Color(sss) }, uSssK: { value: strength }, uSssWrap: { value: wrap } }
  mat.roughness = 0.56
  mat.userData.skinU = u
  const prev = mat.onBeforeCompile
  mat.onBeforeCompile = (sh, r) => {
    Object.assign(sh.uniforms, u)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSkinP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSkinP = position;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uSssColor;
uniform float uSssK, uSssWrap;
varying vec3 vSkinP;
float skH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float skN(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(skH(i), skH(i + vec3(1,0,0)), f.x), mix(skH(i + vec3(0,1,0)), skH(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(skH(i + vec3(0,0,1)), skH(i + vec3(1,0,1)), f.x), mix(skH(i + vec3(0,1,1)), skH(i + vec3(1,1,1)), f.x), f.y), f.z);
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor *= 0.9 + 0.22 * skN(vSkinP * 260.0) + 0.08 * skN(vSkinP * 1400.0);`)
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>
void RE_Direct_Skin( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal,
    const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  float ndl = dot( geometryNormal, directLight.direction );
  // faixa de transição: luz difusa "embrulhada", tingida de vermelho
  float wrapped = clamp( ( ndl + uSssWrap ) / ( 1.0 + uSssWrap ), 0.0, 1.0 );
  float band = wrapped - clamp( ndl, 0.0, 1.0 );
  // contra a luz: bordas finas acendem (orelhas, dedos)
  float back = pow( clamp( dot( geometryViewDir, -directLight.direction ), 0.0, 1.0 ), 5.0 ) * ( 1.0 - abs( ndl ) );
  reflectedLight.directDiffuse += directLight.color * material.diffuseColor * uSssColor * ( band * 1.2 + back * 0.5 ) * uSssK;
}
#undef RE_Direct
#define RE_Direct RE_Direct_Skin`)
    prev?.(sh, r)
  }
  mat.needsUpdate = true
  return mat
}

// Luz de estúdio: principal quente com sombra suave, preenchimento frio,
// recortes por trás. Retorna { key, update() } — a sombra do corpo parado só
// precisa ser refeita quando algo muda de visibilidade.
export function studioLights(scene, renderer, { height = 1.7, rimColor = 0xb8d4ff, rim2Color = 0xffd2b0 } = {}) {
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.shadowMap.autoUpdate = false
  scene.add(new THREE.HemisphereLight(0xfff4ea, 0x2a2034, 0.55))
  const key = new THREE.DirectionalLight(0xfff0e2, 2.1)
  key.position.set(1.5, height * 1.85, 3.0)
  key.target.position.set(0, height * 0.52, 0)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  const sc = key.shadow.camera
  sc.left = -0.75; sc.right = 0.75; sc.top = height * 0.62; sc.bottom = -height * 0.62; sc.near = 1; sc.far = 8
  key.shadow.bias = -0.0004
  key.shadow.normalBias = 0.012
  key.shadow.radius = 4
  scene.add(key, key.target)
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.55); fill.position.set(-2.6, height * 0.9, 2.2); scene.add(fill)
  const rim = new THREE.DirectionalLight(rimColor, 1.25); rim.position.set(-2.4, height * 1.3, -3); scene.add(rim)
  const rim2 = new THREE.DirectionalLight(rim2Color, 0.7); rim2.position.set(2.6, height * 0.7, -2.6); scene.add(rim2)
  const back = new THREE.DirectionalLight(0xf4eee8, 0.45); back.position.set(0.4, height * 1.2, -3.4); scene.add(back)
  return { key, update: () => { renderer.shadowMap.needsUpdate = true } }
}
