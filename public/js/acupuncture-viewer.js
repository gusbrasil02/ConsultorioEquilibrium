import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { ACU_MERIDIANS, ACU_PROTOCOLS } from '/js/acu-data.js'
import { ACU_DEPTH, depthInfo } from '/js/acu-depth.js'
import { loadLayer, tissueMaterial as realMaterial, CREDIT } from '/js/anatomy-real.js'
import { skinMaterial, studioLights } from '/js/skin-shader.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// ─── Dados ────────────────────────────────────────────────────────────────────
// As posições vêm de /js/acu-data.js, gerado por tools/acupoints/build.mjs a
// partir do próprio modelo 3D: cada ponto já está exatamente na pele, e os
// meridianos são trajetos colados à superfície. Aqui só desenhamos.
//
// Ids: "ST36" = lado DIREITO do paciente, "ST36-E" = lado esquerdo.

const baseId = id => String(id).replace(/-E$/, '')
const isLeftId = id => /-E$/.test(String(id))

const POINT_INDEX = new Map()
ACU_MERIDIANS.forEach(m => m.points.forEach(p => POINT_INDEX.set(p.id, { ...p, meridian: m })))

// Informações de um ponto (aceita id com ou sem "-E"); depth = profundidade de referência
function findPoint(id) {
  const p = POINT_INDEX.get(baseId(id))
  if (!p) return null
  return { ...p, fullId: id, side: p.pl ? (isLeftId(id) ? 'E' : 'D') : null, depth: depthInfo(p.id) }
}

// ─── Camadas internas ─────────────────────────────────────────────────────────
// 'skin'    pele (a agulha abre uma "janela" na pele em volta do ponto)
// 'muscles' sem pele: músculos e ossos reais, com os pontos e meridianos por cima
// 'bones'   pele em holograma, esqueleto
// 'organs'  pele em holograma, esqueleto apagado e os órgãos Zang-Fu — o órgão
//           do meridiano ativo acende na cor dele
const LAYERS = ['skin', 'muscles', 'bones', 'organs']
const MAX_HOLES = 4

// Destaques das peças reais: brilho do órgão (cor do meridiano) e "fantasma"
const REAL_FX = {
  key: 'acu',
  fragmentHead: `uniform float uGlow, uGhost, uTime; uniform vec3 uGlowColor;
uniform vec4 uClip[${MAX_HOLES}]; uniform int uClipN;`,
  fragmentEnd: `
// com a pele por cima, só aparece o que está dentro das janelas das agulhas
if (uClipN > 0) {
  float keep = 0.0;
  for (int i = 0; i < ${MAX_HOLES}; i++) { if (i >= uClipN) break; keep = max(keep, step(length(vWPosT - uClip[i].xyz), uClip[i].w)); }
  if (keep < 0.5) discard;
}
{
  float fr = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.0);
  float beat = 0.75 + 0.25 * sin(uTime * 2.6);
  outgoingLight = mix(outgoingLight, outgoingLight * 0.55 + uGlowColor * 0.55, uGlow * 0.6);
  outgoingLight += uGlowColor * uGlow * (0.18 + 0.9 * fr) * beat;
  if (uGhost > 0.001) {
    vec3 gh = mix(vec3(0.05, 0.06, 0.12), vec3(0.75, 0.8, 1.0), fr);
    outgoingLight = mix(outgoingLight, gh, uGhost);
    diffuseColor.a = mix(diffuseColor.a, 0.05 + 0.45 * fr, uGhost);
  }
}`
}

// Pele: holograma (camadas internas), desfazer (músculos) e janelas (agulha)
function setupAcuSkin(mat, U) {
  const prev = mat.onBeforeCompile
  mat.onBeforeCompile = (sh, r) => {
    Object.assign(sh.uniforms, U)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAcuW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvAcuW = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uXray, uHide, uTime;
uniform vec4 uHoles[${MAX_HOLES}];
uniform int uHoleN;
varying vec3 vAcuW;`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
float acuRim = 0.0;
for (int i = 0; i < ${MAX_HOLES}; i++) {
  if (i >= uHoleN) break;
  float d = length(vAcuW - uHoles[i].xyz), r = uHoles[i].w;
  if (d < r * 0.82) discard;
  acuRim = max(acuRim, 1.0 - smoothstep(r * 0.82, r, d));
}
gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0, 0.78, 0.62), acuRim * 0.55);
if (uHide > 0.001) {
  float e = vAcuW.y - (uHide * 2.3 - 0.15);
  float cut = 1.0 - smoothstep(-0.06, 0.0, e);
  gl_FragColor.rgb += vec3(0.75, 0.6, 1.0) * (1.0 - smoothstep(0.0, 0.06, abs(e + 0.03))) * (1.0 - uHide);
  gl_FragColor.a *= 1.0 - cut;
  if (gl_FragColor.a < 0.01) discard;
}
if (uXray > 0.001) {
  float fr = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 1.8);
  float scan = 0.85 + 0.15 * sin(vAcuW.y * 300.0 - uTime * 2.0);
  vec3 holo = mix(vec3(0.03, 0.03, 0.09), vec3(0.62, 0.58, 1.0), fr) * scan;
  gl_FragColor = vec4(mix(gl_FragColor.rgb, holo, uXray), mix(gl_FragColor.a, clamp((0.025 + 0.42 * fr) * scan, 0.0, 1.0), uXray));
}`)
    prev?.(sh, r)
  }
  mat.customProgramCacheKey = () => 'acu-skin'
  mat.needsUpdate = true
}
// Ids dos dois lados de um ponto (ou só um, se for da linha média)
function sideIds(base) {
  const p = POINT_INDEX.get(baseId(base))
  if (!p) return []
  return p.pl ? [p.id, p.id + '-E'] : [p.id]
}

// ─── Estilos do overlay (rótulos, tooltip, carregamento) ─────────────────────
const STYLE_ID = 'acu-viewer-style'
function injectStyle() {
  if (document.getElementById(STYLE_ID)) return
  const s = document.createElement('style')
  s.id = STYLE_ID
  s.textContent = `
  .acu-host { position: relative; overflow: hidden;
    background: radial-gradient(ellipse at 50% 38%, #1d1838 0%, #0b0b17 55%, #05050a 100%); }
  .acu-host canvas { display: block; outline: none; touch-action: none; }
  .acu-overlay { position: absolute; inset: 0; pointer-events: none; font-family: 'Outfit', system-ui, sans-serif; }
  .acu-lbl { position: absolute; left: 0; top: 0; white-space: nowrap; padding: 2px 7px;
    border-radius: 7px; background: rgba(8,8,18,0.78); border: 1px solid var(--c, #fff);
    color: #fff; font-size: 11px; line-height: 1.35; will-change: transform;
    box-shadow: 0 2px 10px rgba(0,0,0,0.35); transition: opacity .2s; }
  .acu-lbl b { font-weight: 600; }
  .acu-lbl span { opacity: .7; margin-left: 4px; }
  .acu-host.tv .acu-lbl { font-size: 13px; padding: 3px 9px; }
  .acu-tip { position: absolute; left: 0; top: 0; min-width: 170px; max-width: 260px; padding: 8px 11px;
    border-radius: 10px; background: rgba(10,10,22,0.92); border: 1px solid rgba(255,255,255,0.14);
    color: #fff; font-size: 12px; line-height: 1.45; box-shadow: 0 8px 26px rgba(0,0,0,0.45);
    opacity: 0; transition: opacity .12s; }
  .acu-tip.show { opacity: 1; }
  .acu-tip .t1 { font-weight: 600; font-size: 13px; }
  .acu-tip .t2 { opacity: .65; font-style: italic; }
  .acu-tip .t3 { margin-top: 3px; font-size: 11px; opacity: .8; }
  .acu-tip .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
  .acu-credit { position: absolute; right: 12px; bottom: 8px; font-size: 9.5px; color: rgba(220,210,240,0.42);
    opacity: 0; transition: opacity .6s; }
  .acu-credit.on { opacity: 1; }
  .acu-host.tv .acu-credit { right: 28px; bottom: 22px; font-size: 11px; }
  .acu-lbl .dp { display: block; margin-top: 1px; font-size: 10px; opacity: .85; }
  .acu-lbl .dp.warn { color: #ffb4a8; }
  .acu-host.tv .acu-lbl .dp { font-size: 12px; }
  .acu-org { position: absolute; left: 0; top: 0; white-space: nowrap; padding: 3px 10px; border-radius: 20px;
    background: rgba(8,8,18,0.72); border: 1px solid var(--c, #fff); color: #fff; font-size: 11px; letter-spacing: .04em;
    box-shadow: 0 0 14px color-mix(in srgb, var(--c) 45%, transparent); transition: opacity .3s; will-change: transform; }
  .acu-host.tv .acu-org { font-size: 14px; padding: 4px 12px; }
  .acu-tip .t4 { margin-top: 4px; font-size: 11px; color: #cfe6ff; }
  .acu-tip .t5 { font-size: 10.5px; color: #ffb4a8; }
  .acu-loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    color: rgba(255,255,255,0.45); font-size: 13px; letter-spacing: .06em; }
  `
  document.head.appendChild(s)
}

// Textura circular suave (halos e partículas de fluxo)
function glowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.25, 'rgba(255,255,255,0.75)')
  grd.addColorStop(0.6, 'rgba(255,255,255,0.18)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
// ─── Corpos disponíveis ───────────────────────────────────────────────────────
// Corpos realistas gerados por tools/bodies (MakeHuman, CC0), já normalizados,
// cada um com a geometria dos pontos própria (acu-geo-*.js). As posições de
// acu-data.js são as do modelo-base usado só pelo gerador (tools/acupoints).
const MODELS = {
  male:    { label: 'Masculino', glb: '/models/body-male.glb',   height: 1.78, geo: '/js/acu-geo-male.js' },
  female:  { label: 'Feminino',  glb: '/models/body-female.glb', height: 1.66, geo: '/js/acu-geo-female.js' }
}

// Geometria (posições + trajetos) por meridiano: Map id → { points: Map, paths }
const _geoCache = {}
async function loadGeometry(key) {
  if (_geoCache[key]) return _geoCache[key]
  const src = (await import(MODELS[key].geo)).ACU_GEOMETRY
  const map = new Map(src.map(m => [m.id, {
    points: new Map(m.points.map(p => [p.id, { p: p.p, pl: p.pl }])),
    paths: m.paths
  }]))
  _geoCache[key] = map
  return map
}

// ─── Visualizador ─────────────────────────────────────────────────────────────

class AcupunctureViewer {
  /**
   * options:
   *   isDoctor           → permite selecionar pontos (painel)
   *   tv                 → modo TV: rótulos maiores, câmera "respira" sobre os pontos
   *   autoRotate         → gira sozinho quando não há pontos selecionados
   *   labels             → rótulos dos pontos selecionados (padrão: true)
   *   onSelectionChange  → (ids, infoDoPontoClicado) => void
   *   onHover            → (info | null) => void
   *   onReady            → () => void
   */
  constructor(container, options = {}) {
    this.container = container
    this.isDoctor = options.isDoctor ?? false
    this.tv = options.tv ?? false
    this.autoRotate = options.autoRotate ?? false
    this.labelsOn = options.labels ?? true
    this.onSelectionChange = options.onSelectionChange ?? null
    this.onHover = options.onHover ?? null
    this.onReady = options.onReady ?? null
    this.modelKey = MODELS[options.model] ? options.model : 'female'
    this.model = MODELS[this.modelKey]
    this.center = new THREE.Vector3(0, this.model.height * 0.523, 0)   // meio do corpo
    this.hairVisible = true

    this.selected = new Set()
    this.hidden = new Set()           // meridianos ocultos pelo usuário
    this.onlyActive = false           // mostrar só os meridianos dos pontos selecionados
    this.highlighted = null           // meridiano em destaque (hover na lista)
    this.hovered = null
    this.ready = false
    this._disposed = false
    this._tween = null
    this._clock = new THREE.Clock()
    this._flows = []
    this._halos = new Map()
    this._labels = new Map()
    this.layer = LAYERS.includes(options.layer) ? options.layer : 'skin'
    this.needle = !!options.needle
    this._real = {}            // camada → { group, meshes }
    this._realLoading = {}
    this._xr = 0; this._hide = 0
    this._needles = new Map()
    this._organLabels = new Map()
    this.cun = this.model.height / 75      // 1 cun ≈ 1/75 da altura (proporção óssea clássica)
    this._clipU = { uClip: { value: Array.from({ length: MAX_HOLES }, () => new THREE.Vector4()) }, uClipN: { value: 0 } }

    injectStyle()
    this._init()
  }

  // ── Montagem ───────────────────────────────────────────────────────────────
  _init() {
    const host = this.container
    host.classList.add('acu-host')
    if (this.tv) host.classList.add('tv')
    const W = host.clientWidth || 600, H = host.clientHeight || 500

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(34, W / H, 0.01, 60)
    this.camera.position.set(0, this.model.height * 0.57, 3.4)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(W, H)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.92
    host.appendChild(this.renderer.domElement)

    // Iluminação de estúdio (reflexos suaves na pele) + luzes de recorte
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
    this._lights = studioLights(this.scene, this.renderer, { height: this.model.height, rimColor: 0x9fb8ff, rim2Color: 0xffc49a })

    this._addFloor()

    // Overlay DOM
    this.overlay = document.createElement('div')
    this.overlay.className = 'acu-overlay'
    host.appendChild(this.overlay)
    this.loadingEl = document.createElement('div')
    this.loadingEl.className = 'acu-loading'
    this.loadingEl.textContent = 'Carregando modelo 3D…'
    this.overlay.appendChild(this.loadingEl)
    this.creditEl = document.createElement('div')
    this.creditEl.className = 'acu-credit'
    this.creditEl.textContent = CREDIT
    this.overlay.appendChild(this.creditEl)
    if (this.isDoctor) {
      this.tipEl = document.createElement('div')
      this.tipEl.className = 'acu-tip'
      this.overlay.appendChild(this.tipEl)
    }

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.copy(this.center)
    this.controls.minDistance = 0.3
    this.controls.maxDistance = 6
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.autoRotateSpeed = 0.6
    this.controls.enablePan = this.isDoctor
    this.controls.update()
    // Usuário mexeu na câmera → cancela animações/rotação automáticas
    this.controls.addEventListener('start', () => { this._tween = null; this._userMoved = true })

    this._glow = glowTexture()
    this._loadAll()

    if (this.isDoctor) this._bindPointer()

    this._ro = new ResizeObserver(() => this._onResize())
    this._ro.observe(host)
    this._animate()
  }

  _addFloor() {
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const g = c.getContext('2d')
    const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128)
    grd.addColorStop(0, 'rgba(140,120,255,0.35)')
    grd.addColorStop(0.5, 'rgba(90,70,200,0.10)')
    grd.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grd
    g.fillRect(0, 0, 256, 256)
    const tex = new THREE.CanvasTexture(c)
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(0.9, 48),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = 0.001
    this.scene.add(floor)
    const sf = new THREE.Mesh(new THREE.CircleGeometry(0.9, 48), new THREE.ShadowMaterial({ opacity: 0.3 }))
    sf.rotation.x = -Math.PI / 2
    sf.position.y = 0.002
    sf.receiveShadow = true
    this.scene.add(sf)
  }

  // Geometria dos pontos → corpo
  async _loadAll() {
    try {
      this.geo = await loadGeometry(this.modelKey)
    } catch (err) {
      console.error('[AcupunctureViewer] Erro ao carregar os pontos:', err)
      this.loadingEl.textContent = 'Não foi possível carregar os pontos.'
      return
    }
    if (this._disposed) return
    this._buildPoints()
    this._buildMeridians()
    if (this._pendingSel) {
      const { ids, focus } = this._pendingSel
      this._pendingSel = null
      this.setSelectedPoints(ids, { focus })
    } else this._refreshAll()
    await this._loadBody()
  }

  // ── Corpo ──────────────────────────────────────────────────────────────────
  async _loadBody() {
    try {
      const gltf = await new Promise((resolve, reject) =>
        new GLTFLoader().load(this.model.glb, resolve, undefined, reject))
      if (this._disposed) return
      const model = gltf.scene

      this._bodyMeshes = []
      this._hairMeshes = []
      model.traverse(o => {
        if (!o.isMesh) return
        if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals()
        // Mantêm a textura; só ajustamos o acabamento
        const m = o.material
        if (o.name === 'body') {
          m.envMapIntensity = 0.45
          this._skinU = { uXray: { value: 0 }, uHide: { value: 0 }, uTime: { value: 0 },
            uHoles: { value: Array.from({ length: MAX_HOLES }, () => new THREE.Vector4()) }, uHoleN: { value: 0 } }
          skinMaterial(m)
          setupAcuSkin(m, this._skinU)
          o.castShadow = o.receiveShadow = true
          this._skin = m
          this._bodyMeshes.push(o)
        } else if (o.name === 'hair') {
          m.side = THREE.DoubleSide
          m.envMapIntensity = 0.3
          o.visible = this.hairVisible
          o.castShadow = true
          this._hairMeshes.push(o)
        } else if (o.name === 'eyes') {
          m.roughness = 0.15
          m.envMapIntensity = 0.9
        }
        if (o.name === 'eyebrows' || o.name === 'eyelashes' || o.name === 'hair') o.renderOrder = 2
        if (o.name !== 'body' && o.name !== 'hair') (this._faceMeshes ||= []).push(o)
      })
      this.scene.add(model)
      model.updateMatrixWorld(true)
      this.body = model
      this._lights.update()
      this._ensureLayers()
    } catch (err) {
      console.error('[AcupunctureViewer] Erro ao carregar o modelo:', err)
      this.loadingEl.textContent = 'Não foi possível carregar o modelo 3D.'
      return
    }
    this.loadingEl.remove()
    this.ready = true
    this.onReady?.()
  }

  // ── Pontos (uma InstancedMesh para todos) ────────────────────────────────
  _buildPoints() {
    this.points = []   // { id, base, meridian, pos, nrm }
    ACU_MERIDIANS.forEach(m => m.points.forEach(p => {
      const g = this.geo.get(m.id)?.points.get(p.id)
      if (!g) return
      const add = (id, a) => this.points.push({
        id, base: p.id, meridian: m, info: p,
        pos: new THREE.Vector3(a[0], a[1], a[2]),
        nrm: new THREE.Vector3(a[3], a[4], a[5]).normalize()
      })
      add(p.id, g.p)
      if (g.pl) add(p.id + '-E', g.pl)
    }))
    this.pointById = new Map(this.points.map((pt, i) => [pt.id, i]))

    const geo = new THREE.SphereGeometry(0.0046, 14, 10)
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false })
    this.pointMesh = new THREE.InstancedMesh(geo, mat, this.points.length)
    this.pointMesh.frustumCulled = false
    this.points.forEach((pt, i) => this.pointMesh.setColorAt(i, new THREE.Color(pt.meridian.color)))
    this.scene.add(this.pointMesh)

    // Disco escuro achatado sobre a pele, sob cada ponto: contorno que dá
    // contraste na pele clara sem virar uma "bolha" preta quando visto de lado
    const ringGeo = new THREE.CircleGeometry(0.0061, 24)
    this.ringMesh = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({
      color: 0x120a1a, transparent: true, opacity: 0.7, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
    }), this.points.length)
    this.ringMesh.frustumCulled = false
    this.scene.add(this.ringMesh)

    this._refreshPoints()
  }

  _pointVisible(pt) {
    if (this.hidden.has(pt.meridian.id)) return false
    if (this.onlyActive && this.selected.size && !this._activeMeridians().has(pt.meridian.id)) return false
    return true
  }

  _refreshPoints() {
    if (!this.points) return
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3()
    const white = new THREE.Color(1, 1, 1), back = new THREE.Vector3(), rq = new THREE.Quaternion()
    const Z = new THREE.Vector3(0, 0, 1)
    this.points.forEach((pt, i) => {
      const vis = this._pointVisible(pt)
      const sel = this.selected.has(pt.id)
      const hov = this.hovered === pt.id
      const dim = this.highlighted && this.highlighted !== pt.meridian.id && !sel
      const k = !vis ? 0 : sel ? 1.85 : hov ? 1.6 : dim ? 0.75 : 1
      s.setScalar(k)
      m4.compose(pt.pos, q, s)
      this.pointMesh.setMatrixAt(i, m4)
      // O disco fica deitado sobre a pele (orientado pela normal do ponto)
      back.copy(pt.pos).addScaledVector(pt.nrm, -0.0028)
      rq.setFromUnitVectors(Z, pt.nrm)
      m4.compose(back, rq, s)
      this.ringMesh.setMatrixAt(i, m4)
      const c = new THREE.Color(pt.meridian.color)
      if (sel || hov) c.lerp(white, 0.35)
      else if (dim) c.multiplyScalar(0.45)
      this.pointMesh.setColorAt(i, c)
    })
    this.pointMesh.instanceMatrix.needsUpdate = true
    this.ringMesh.instanceMatrix.needsUpdate = true
    if (this.pointMesh.instanceColor) this.pointMesh.instanceColor.needsUpdate = true
  }

  // ── Meridianos (tubos sobre a pele) ───────────────────────────────────────
  _buildMeridians() {
    this.meridians = {}
    ACU_MERIDIANS.forEach(m => {
      const group = new THREE.Group()
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(m.color), transparent: true, opacity: 0.5,
        toneMapped: false, depthWrite: false
      })
      mat.opacity = 0.62
      this.meridians[m.id] = { group, mat, curves: [], raw: [] }
      ;(this.geo.get(m.id)?.paths || []).forEach(path => {
        for (const side of ['r', 'l']) if (path[side]) this.meridians[m.id].raw.push({ side, arr: path[side] })
      })
      this.scene.add(group)
      this._rebuildMeridian(m.id)
    })
  }

  // Constrói os tubos de um meridiano a partir dos trajetos gerados
  _rebuildMeridian(mid) {
    const M = this.meridians[mid]
    M.group.children.forEach(c => c.geometry.dispose())
    M.group.clear()
    M.curves = []

    for (const { side, arr } of M.raw) {
      const pts = []
      for (let i = 0; i < arr.length; i += 3) pts.push(new THREE.Vector3(arr[i], arr[i + 1], arr[i + 2]))
      if (pts.length < 2) continue
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal')
      const seg = Math.min(600, Math.max(8, pts.length * 3))
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, seg, 0.0019, 6, false), M.mat)
      tube.renderOrder = 1
      M.group.add(tube)
      M.curves.push({ curve, length: curve.getLength(), side })
    }
  }

  _activeMeridians() {
    const set = new Set()
    this.selected.forEach(id => { const i = this.pointById.get(id); if (i != null) set.add(this.points[i].meridian.id) })
    return set
  }

  _refreshMeridians() {
    if (!this.meridians) return
    const active = this._activeMeridians()
    Object.entries(this.meridians).forEach(([id, M]) => {
      let visible = !this.hidden.has(id)
      if (this.onlyActive && this.selected.size && !active.has(id)) visible = false
      M.group.visible = visible
      let op = 0.62
      if (this.highlighted) op = this.highlighted === id ? 1 : 0.12
      else if (this.selected.size) op = active.has(id) ? 0.95 : 0.2
      M.mat.opacity = op
    })
    this._rebuildFlows()
  }

  // Partículas de "energia" percorrendo os meridianos ativos
  _rebuildFlows() {
    this._flows.forEach(f => { this.scene.remove(f.obj); f.obj.geometry.dispose(); f.obj.material.dispose() })
    this._flows = []
    const ids = this.highlighted ? new Set([this.highlighted]) : this._activeMeridians()
    ids.forEach(id => {
      const M = this.meridians[id]
      if (!M || !M.group.visible) return
      M.curves.forEach(({ curve, length }) => {
        const n = Math.max(3, Math.min(14, Math.round(length / 0.09)))
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
        const mat = new THREE.PointsMaterial({
          map: this._glow, color: new THREE.Color(M.mat.color).lerp(new THREE.Color(1, 1, 1), 0.3),
          size: this.tv ? 0.03 : 0.022, sizeAttenuation: true, transparent: true,
          depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false
        })
        const obj = new THREE.Points(geo, mat)
        obj.frustumCulled = false
        this.scene.add(obj)
        this._flows.push({ obj, curve, n, speed: 0.12 / Math.max(length, 0.2), phase: Math.random() })
      })
    })
  }

  // Halos pulsantes + rótulos dos pontos selecionados
  _refreshSelectionFx() {
    for (const [id, h] of this._halos) if (!this.selected.has(id)) { this.scene.remove(h); h.material.dispose(); this._halos.delete(id) }
    for (const [id, el] of this._labels) if (!this.selected.has(id)) { el.remove(); this._labels.delete(id) }
    this.selected.forEach(id => {
      const i = this.pointById.get(id)
      if (i == null) return
      const pt = this.points[i]
      if (!this._halos.has(id)) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this._glow, color: new THREE.Color(pt.meridian.color), transparent: true,
          depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false
        }))
        sp.position.copy(pt.pos).addScaledVector(pt.nrm, 0.003)
        sp.scale.setScalar(0.045)
        this.scene.add(sp)
        this._halos.set(id, sp)
      }
      if (this.labelsOn && !this._labels.has(id)) {
        const el = document.createElement('div')
        el.className = 'acu-lbl'
        el.style.setProperty('--c', pt.meridian.color)
        const side = pt.info.pl ? (isLeftId(id) ? ' E' : ' D') : ''
        const nome = pt.info.name === pt.base ? pt.info.pt : pt.info.name   // extras: id já é o nome
        el.innerHTML = `<b>${pt.base}</b><span>${nome}${side}</span><i class="dp"></i>`
        this.overlay.appendChild(el)
        this._labels.set(id, el)
      }
      const el = this._labels.get(id)
      if (el) {
        const di = this.needle ? depthInfo(pt.base, this.cun) : null
        const dp = el.querySelector('.dp')
        dp.textContent = di ? `${di.text} · ${di.angleLabel}` : ''
        dp.classList.toggle('warn', !!di?.warn)
        dp.title = di?.note || ''
        dp.style.display = di ? '' : 'none'
        el._w = 0
      }
    })
    if (!this.labelsOn) { this._labels.forEach(el => el.remove()); this._labels.clear() }
    this._refreshNeedles()
    this._refreshOrgans()
  }

  // ── Agulhas (profundidade de referência) ─────────────────────────────────
  // Uma agulha por ponto selecionado (até 12); a pele abre uma janela em volta
  // dos 4 primeiros para ver a agulha atravessando os músculos.
  _needleDir(pt, d) {
    const n = pt.nrm.clone().negate()
    if (d.angle === 'p' || d.angle === 'x') return n
    const note = d.note || ''
    let t
    if (/coluna/.test(note)) t = new THREE.Vector3(-Math.sign(pt.pos.x) || 0, 0, 0)
    else if (/para cima/.test(note)) t = new THREE.Vector3(0, 1, 0)
    else if (/para baixo/.test(note)) t = new THREE.Vector3(0, -1, 0)
    else if (/para fora/.test(note)) t = new THREE.Vector3(Math.sign(pt.pos.x) || 1, 0, 0)
    else if (/nariz|queixo/.test(note)) t = new THREE.Vector3(0, -0.2, 1)
    else {
      // no sentido do meridiano (para o ponto seguinte do mesmo lado)
      const list = pt.meridian.points
      const k = list.findIndex(q => q.id === pt.base)
      const nb = list[k + 1] || list[k - 1]
      const j = nb ? this.pointById.get(nb.id + (isLeftId(pt.id) && nb.pl ? '-E' : '')) : null
      t = j != null ? this.points[j].pos.clone().sub(pt.pos) : new THREE.Vector3(0, 1, 0)
    }
    t.addScaledVector(pt.nrm, -t.dot(pt.nrm))
    if (t.lengthSq() < 1e-8) return n
    t.normalize()
    const ang = d.angle === 't' ? 75 : 45            // a partir da perpendicular
    return n.multiplyScalar(Math.cos(ang * Math.PI / 180)).addScaledVector(t, Math.sin(ang * Math.PI / 180)).normalize()
  }
  _refreshNeedles() {
    const want = new Set(this.needle ? [...this.selected].slice(0, 12) : [])
    for (const [id, g] of this._needles) if (!want.has(id)) { this.scene.remove(g); g.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.() }); this._needles.delete(id) }
    want.forEach(id => {
      if (this._needles.has(id)) return
      const i = this.pointById.get(id)
      if (i == null) return
      const pt = this.points[i], d = depthInfo(pt.base, this.cun)
      if (!d || d.angle === 'm') return
      const dir = this._needleDir(pt, d)
      const L = Math.max(0.1, d.max) * this.cun, L0 = d.min * this.cun
      const g = new THREE.Group()
      const R = this.tv ? 0.0009 : 0.0007      // um pouco mais grossa que a real, para ser vista
      const steel = new THREE.MeshStandardMaterial({ color: 0xe6eaef, metalness: 1, roughness: 0.2, envMapIntensity: 1.6 })
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L + 0.004, 12), steel)
      shaft.position.y = -(L + 0.004) / 2 + 0.004
      const tip = new THREE.Mesh(new THREE.ConeGeometry(R, 0.003, 12), steel)
      tip.rotation.x = Math.PI
      tip.position.y = -L - 0.0015 + 0.004
      // o trecho dentro do corpo também aparece através do tecido (raio-X)
      const ghostM = new THREE.MeshBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false, toneMapped: false })
      const ghost = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.9, R * 0.9, L, 10), ghostM)
      ghost.position.y = -L / 2
      ghost.renderOrder = 30
      // cabo espiralado acima da pele
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(R * 2.2, R * 2.2, 0.024, 14), new THREE.MeshStandardMaterial({ color: 0xc9a46a, metalness: 0.9, roughness: 0.35 }))
      handle.position.y = 0.004 + 0.012
      const coil = new THREE.Mesh(new THREE.TorusGeometry(R * 2.5, R * 0.45, 6, 18), handle.material)
      // faixa da profundidade indicada (mín → máx) em verde
      const band = new THREE.Mesh(new THREE.CylinderGeometry(R * 2, R * 2, Math.max(0.0015, L - L0), 12),
        new THREE.MeshBasicMaterial({ color: 0x5cffb0, transparent: true, opacity: 0.65, depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }))
      band.position.y = -(L0 + L) / 2
      band.renderOrder = 31
      g.add(shaft, tip, ghost, handle, band)
      for (let k = 0; k < 5; k++) { const c = coil.clone(); c.rotation.x = Math.PI / 2; c.position.y = 0.006 + k * 0.0042; g.add(c) }
      g.position.copy(pt.pos)
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir)
      g.userData = { band, t0: Math.random() * 6 }
      this.scene.add(g)
      this._needles.set(id, g)
    })
    // janelas na pele (só na camada da pele)
    const U = this._skinU
    if (U) {
      const ids = this.layer === 'skin' ? [...this._needles.keys()].slice(0, MAX_HOLES) : []
      ids.forEach((id, k) => {
        const pt = this.points[this.pointById.get(id)]
        U.uHoles.value[k].set(pt.pos.x, pt.pos.y, pt.pos.z, 0.028)
        this._clipU.uClip.value[k].set(pt.pos.x, pt.pos.y, pt.pos.z, 0.032)
      })
      U.uHoleN.value = ids.length
      this._clipU.uClipN.value = ids.length
    }
    if (this._needles.size) this._ensureLayers()
  }

  // ── Camadas internas (anatomia real) ─────────────────────────────────────
  _need() {
    const L = new Set()
    if (this.layer === 'muscles' || (this.needle && this.selected.size)) { L.add('muscles'); L.add('bones') }
    if (this.layer === 'bones') L.add('bones')
    if (this.layer === 'organs') { L.add('organs'); L.add('bones') }
    return L
  }
  _ensureLayers() {
    if (!this.ready && !this._skinU) return
    this._need().forEach(l => {
      if (this._real[l] || this._realLoading[l]) return
      this._realLoading[l] = loadLayer(this.modelKey, l).then(d => {
        if (this._disposed) return
        this._buildLayer(l, d)
      }).catch(err => { console.error('[AcupunctureViewer] Camada indisponível:', l, err); delete this._realLoading[l] })
    })
  }
  _buildLayer(layer, d) {
    const g = new THREE.Group()
    g.visible = false
    const T = this._skinU.uTime
    const fx = () => ({ uGlow: { value: 0 }, uGhost: { value: 0 }, uTime: T, uGlowColor: { value: new THREE.Color(1, 1, 1) },
      uClip: this._clipU.uClip, uClipN: this._clipU.uClipN })
    const meshes = []
    if (layer === 'bones') {
      // ossos fundidos por tecido (dentes e gengiva à parte: somem na camada de músculos)
      const by = {}
      d.parts.forEach(p => (by[p.kind] ||= []).push(p.geometry))
      Object.entries(by).forEach(([k, geos]) => {
        const u = fx()
        const m = new THREE.Mesh(mergeGeometries(geos), realMaterial(k, { uniforms: u, extra: REAL_FX }))
        m.castShadow = m.receiveShadow = true
        m.userData = { u, kind: k, ghost: false, st: { glow: 0, ghost: 0 } }
        g.add(m); meshes.push(m)
      })
    } else {
      d.parts.forEach(p => {
        const u = fx()
        const m = new THREE.Mesh(p.geometry, realMaterial(p.kind, { axis: p.axis, uniforms: u, extra: REAL_FX }))
        m.castShadow = m.receiveShadow = layer === 'muscles'
        m.userData = { u, part: p, ghost: false, st: { glow: 0, ghost: 0 } }
        g.add(m); meshes.push(m)
      })
    }
    this.scene.add(g)
    this._real[layer] = { group: g, meshes }
    this._refreshOrgans()
  }

  // Órgãos dos meridianos ativos (pontos selecionados ou meridiano em destaque)
  _organTargets() {
    const act = this.highlighted ? new Set([this.highlighted]) : this._activeMeridians()
    const out = new Map()      // mesh → { glow, color }
    const O = this._real.organs
    if (!O || this.layer !== 'organs') return out
    O.meshes.forEach(m => {
      const p = m.userData.part
      let best = null
      act.forEach(id => {
        const M = ACU_MERIDIANS.find(x => x.id === id)
        if (!M) return
        let g = 0
        if (p.mer === id) g = 1
        else if (id === 'PC' && p.mer === 'HT' && p.kind === 'heart') g = 1      // pericárdio: o envoltório do coração
        else if (id === 'TE' && !['artery', 'vein'].includes(p.kind)) g = 0.55    // triplo aquecedor: as três cavidades
        if (g && (!best || g > best.glow)) best = { glow: g, color: M.color, mer: M }
      })
      if (best) out.set(m, best)
    })
    return out
  }
  _refreshOrgans() {
    this._orgT = this._organTargets()
    // um rótulo por órgão aceso (nome em português, sem repetir lobos/partes)
    const MAIN = ['lung', 'heart', 'liver', 'stomach', 'spleen', 'kidney', 'bladder', 'gallbladder', 'smallint', 'colon']
    const want = new Map()
    this._orgT.forEach((t, m) => {
      if (t.glow < 0.9) return
      const p = m.userData.part
      if (!MAIN.includes(p.kind) || p.base === 'esophagus') return   // o esôfago acende com o Estômago, mas o rótulo é do estômago
      const name = t.mer.id === 'PC' ? 'Pericárdio' : p.name.replace(/ \(.*\)$/, '')
      const key = t.mer.id                  // um rótulo por meridiano (o maior órgão dele)
      const cur = want.get(key)
      if (!cur || p.r > cur.r) want.set(key, { name, r: p.r, c: p.c, color: t.color })
    })
    for (const [k, el] of this._organLabels) if (!want.has(k)) { el.remove(); this._organLabels.delete(k) }
    want.forEach((w, k) => {
      let el = this._organLabels.get(k)
      if (!el) {
        el = document.createElement('div')
        el.className = 'acu-org'
        this.overlay.appendChild(el)
        this._organLabels.set(k, el)
      }
      el.style.setProperty('--c', w.color)
      if (el.textContent !== w.name) { el.textContent = w.name; el._w = 0 }
      el._pos = w.c.clone()
    })
  }

  // Passo das camadas: pele (holograma / desfazer), visibilidade e destaques
  _stepLayers(dt, t) {
    const U = this._skinU
    if (!U) return
    U.uTime.value = t
    const L = this.layer
    const has = l => !!this._real[l]
    const xr = (L === 'bones' && has('bones')) || (L === 'organs' && has('organs')) ? 1 : 0
    const hide = L === 'muscles' && has('muscles') ? 1 : 0
    const ap = (c, g, r) => c + (g - c) * Math.min(1, r * dt)
    this._xr = ap(this._xr, xr, 3); if (Math.abs(this._xr - xr) < 0.003) this._xr = xr
    this._hide = ap(this._hide, hide, hide ? 1.1 : 3); if (Math.abs(this._hide - hide) < 0.003) this._hide = hide
    U.uXray.value = this._xr
    U.uHide.value = this._hide
    const trans = this._xr > 0 || this._hide > 0
    if (this._skin.transparent !== trans) { this._skin.transparent = trans; this._skin.depthWrite = !trans; this._skin.needsUpdate = true }
    this._bodyMeshes.forEach(b => { b.visible = this._hide < 0.999; b.castShadow = this._xr < 0.05 && this._hide < 0.5 })
    const inner = this._xr > 0.3 || this._hide > 0.3
    ;(this._hairMeshes || []).forEach(h => { h.visible = this.hairVisible && !inner })
    ;(this._faceMeshes || []).forEach(f => { f.visible = this._xr < 0.3 })
    const holes = U.uHoleN.value > 0
    const vis = {
      muscles: has('muscles') && ((L === 'muscles' && this._hide > 0.001) || (L === 'skin' && holes)),
      bones: has('bones') && (L !== 'skin' || holes) && (L !== 'bones' || this._xr > 0.001) && (L !== 'organs' || this._xr > 0.001),
      organs: has('organs') && L === 'organs' && this._xr > 0.001
    }
    Object.entries(this._real).forEach(([l, R]) => { R.group.visible = !!vis[l] })
    // órgãos acendem; ossos viram "fantasma" na camada dos órgãos
    const step = (m, glow, ghost, color) => {
      const st = m.userData.st, u = m.userData.u
      st.glow = ap(st.glow, glow, 4); st.ghost = ap(st.ghost, ghost, 4)
      u.uGlow.value = st.glow; u.uGhost.value = st.ghost
      if (color) u.uGlowColor.value.set(color)
      const gh = st.ghost > 0.01
      if (gh !== m.userData.ghost) { m.userData.ghost = gh; m.material.transparent = gh; m.material.depthWrite = !gh; m.material.needsUpdate = true; m.renderOrder = gh ? 3 : 0 }
    }
    if (this._real.bones) this._real.bones.meshes.forEach(m => {
      m.visible = !(L === 'muscles' && (m.userData.kind === 'tooth' || m.userData.kind === 'gum'))
      step(m, 0, L === 'organs' ? 0.82 : 0)
    })
    // o diafragma (músculo em cúpula) fica quase transparente: não esconde fígado e estômago
    if (this._real.organs) this._real.organs.meshes.forEach(m => { const o = this._orgT?.get(m); step(m, o ? o.glow : 0, m.userData.part.kind === 'diaphragm' ? 0.88 : 0, o?.color) })
    this.creditEl.classList.toggle('on', Object.values(this._real).some(R => R.group.visible))
    // sombra refeita quando algo muda de visibilidade
    const key = `${L}|${this._bodyMeshes.map(b => +b.castShadow).join('')}|${Object.values(this._real).map(R => +R.group.visible).join('')}|${this.hairVisible}`
    if (key !== this._shKey || (this._hide > 0 && this._hide < 1)) { this._shKey = key; this._lights.update() }
    // agulhas: a faixa da profundidade "respira"
    this._needles.forEach(g => { g.userData.band.material.opacity = 0.45 + 0.25 * Math.sin(t * 3 + g.userData.t0) })
  }

  _refreshAll() {
    if (!this.points) return
    this._refreshPoints()
    this._refreshMeridians()
    this._refreshSelectionFx()
  }

  // ── Seleção pelo mouse/toque (painel) ─────────────────────────────────────
  _bindPointer() {
    const el = this.renderer.domElement
    let down = null
    el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() } })
    el.addEventListener('pointerup', e => {
      if (!down) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      const quick = performance.now() - down.t < 700
      down = null
      if (moved > 6 || !quick) return   // foi arrasto para girar, não clique
      const id = this._pick(e.clientX, e.clientY, e.pointerType === 'touch' ? 26 : 16)
      if (id) this._toggleByUser(id)
    })
    el.addEventListener('pointermove', e => {
      if (e.buttons) return
      this._hoverXY = { x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch' }
      if (!this._hoverRaf) this._hoverRaf = requestAnimationFrame(() => { this._hoverRaf = null; this._doHover() })
    })
    el.addEventListener('pointerleave', () => { this._hoverXY = null; this._setHover(null) })
  }

  _doHover() {
    if (!this._hoverXY || this._hoverXY.touch) return
    const id = this._pick(this._hoverXY.x, this._hoverXY.y, 14)
    this._setHover(id)
    if (id && this.tipEl) {
      const rect = this.renderer.domElement.getBoundingClientRect()
      let x = this._hoverXY.x - rect.left + 16, y = this._hoverXY.y - rect.top + 14
      if (x > rect.width - 270) x -= 300
      if (y > rect.height - 120) y -= 130
      this.tipEl.style.transform = `translate(${x}px, ${y}px)`
    }
  }

  _setHover(id) {
    if (this.hovered === id) return
    this.hovered = id
    this.renderer.domElement.style.cursor = id ? 'pointer' : ''
    this._refreshPoints()
    const info = id ? findPoint(id) : null
    if (this.tipEl) {
      if (info) {
        const side = info.side ? ` · lado ${info.side === 'E' ? 'esquerdo' : 'direito'}` : ''
        this.tipEl.innerHTML =
          `<div class="t1"><span class="dot" style="background:${info.meridian.color}"></span>${info.id} · ${info.name}</div>` +
          `<div class="t2">${info.pt}</div>` +
          `<div class="t3">${info.meridian.name}${side}</div>` +
          (info.depth ? `<div class="t4">Agulha: ${info.depth.text} · ${info.depth.angleLabel}</div>` +
            (info.depth.note ? `<div class="${info.depth.warn ? 't5' : 't3'}">${info.depth.warn ? '⚠ ' : ''}${info.depth.note}</div>` : '') : '')
        this.tipEl.classList.add('show')
      } else this.tipEl.classList.remove('show')
    }
    this.onHover?.(info)
  }

  // Ponto visível mais próximo do cursor, em pixels (os pontos são pequenos
  // demais para acertar só pelo raio 3D). Descarta pontos de costas para a
  // câmera e os escondidos atrás de outra parte do corpo.
  _pick(clientX, clientY, radiusPx) {
    if (!this.points) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    const mx = clientX - rect.left, my = clientY - rect.top
    const cam = this.camera.position
    const v = new THREE.Vector3(), toCam = new THREE.Vector3()
    const cands = []
    this.points.forEach(pt => {
      if (!this._pointVisible(pt)) return
      toCam.subVectors(cam, pt.pos)
      if (pt.nrm.dot(toCam) < -0.02 * toCam.length()) return
      v.copy(pt.pos).project(this.camera)
      if (v.z > 1) return
      const sx = (v.x + 1) / 2 * rect.width, sy = (1 - v.y) / 2 * rect.height
      const d = Math.hypot(sx - mx, sy - my)
      if (d <= radiusPx) cands.push({ id: pt.id, d, pt })
    })
    cands.sort((a, b) => a.d - b.d)
    if (!this._bodyMeshes) return cands[0]?.id || null
    const rc = new THREE.Raycaster()
    for (const c of cands.slice(0, 4)) {
      const dir = new THREE.Vector3().subVectors(c.pt.pos, cam)
      const dist = dir.length()
      rc.set(cam, dir.normalize())
      rc.far = dist
      const occ = this.hairVisible ? this._bodyMeshes.concat(this._hairMeshes || []) : this._bodyMeshes
      const hit = rc.intersectObjects(occ, false)[0]
      if (!hit || hit.distance > dist - 0.012) return c.id
    }
    return null
  }

  _toggleByUser(id) {
    if (this.selected.has(id)) this.selected.delete(id)
    else this.selected.add(id)
    this._refreshAll()
    this.onSelectionChange?.([...this.selected], findPoint(id))
  }

  // ── Câmera ─────────────────────────────────────────────────────────────────
  _animateTo(pos, target, ms = 950) {
    this._tween = {
      p0: this.camera.position.clone(), p1: pos.clone(),
      t0: this.controls.target.clone(), t1: target.clone(),
      start: performance.now(), ms
    }
    this._userMoved = false
  }

  setView(name) {
    const T = this.center.clone()
    const d = 3.4, y = this.model.height * 0.57
    const pos = {
      front: new THREE.Vector3(0, y, d),
      back: new THREE.Vector3(0, y, -d),
      left: new THREE.Vector3(d, y, 0),      // lado esquerdo do paciente
      right: new THREE.Vector3(-d, y, 0),    // lado direito do paciente
      reset: new THREE.Vector3(0, y, d)
    }[name] || new THREE.Vector3(0, y, d)
    this._swayBase = null
    this._animateTo(pos, T)
  }

  // Enquadra os pontos: centraliza, aproxima e gira para o lado em que estão
  focusPoints(ids) {
    if (!this.points) return
    const pts = (ids || [...this.selected]).map(id => this.points[this.pointById.get(id)]).filter(Boolean)
    if (!pts.length) { this._swayBase = null; this.setView('reset'); return }
    const c = new THREE.Vector3(), n = new THREE.Vector3()
    pts.forEach(p => { c.add(p.pos); n.add(p.nrm) })
    c.divideScalar(pts.length)
    let r = 0
    pts.forEach(p => { r = Math.max(r, p.pos.distanceTo(c)) })
    // Coerência: os pontos "olham" para o mesmo lado? (1 = todos iguais, 0 = opostos)
    const coherence = n.length() / pts.length
    let dir = coherence > 0.2 ? n.clone().normalize() : null
    if (!dir) {
      // Pontos em lados opostos (ex.: frente e costas): mantém a direção atual
      dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).normalize()
    }
    // com a agulha, olha de lado (de frente ela some): gira ~55° em volta da vertical
    if (this.needle && pts.length <= 4) dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), (pts[0].pos.x < 0 ? -1 : 1) * 0.95)
    dir.y = Math.max(-0.2, Math.min(0.45, dir.y + 0.12))
    dir.normalize()
    const vfov = this.camera.fov * Math.PI / 180
    const fit = (r + 0.12) / Math.sin(vfov / 2) * (this.camera.aspect < 1 ? 1.35 : 1)
    const dist = Math.min(4.4, Math.max(0.6, fit))
    const pos = c.clone().addScaledVector(dir, dist)
    this._animateTo(pos, c, 1100)
    this._swayT0 = null
    this._swayBase = { target: c.clone(), dir: dir.clone(), dist, full: coherence < 0.55 }
  }

  // ── API pública ────────────────────────────────────────────────────────────
  setSelectedPoints(ids, { focus = false } = {}) {
    // Ainda carregando os pontos: aplica assim que estiverem prontos
    if (!this.points) { this._pendingSel = { ids: [...(ids || [])], focus }; return }
    this.selected = new Set((ids || []).filter(id => this.pointById.has(id)))
    this._refreshAll()
    if (focus) this.focusPoints()
  }
  getSelectedPoints() { return this.points ? [...this.selected] : [...(this._pendingSel?.ids || [])] }

  setMeridianVisible(id, visible) {
    if (visible) this.hidden.delete(id); else this.hidden.add(id)
    this._refreshAll()
  }
  setAllMeridiansVisible(visible) {
    this.hidden = visible ? new Set() : new Set(ACU_MERIDIANS.map(m => m.id))
    this._refreshAll()
  }
  setOnlyActive(on) { this.onlyActive = !!on; this._refreshAll() }
  highlightMeridian(id) {
    if (this.highlighted === (id || null)) return
    this.highlighted = id || null
    this._refreshPoints()
    this._refreshMeridians()
    this._refreshOrgans()
  }
  setLabels(on) { this.labelsOn = !!on; if (this.points) this._refreshSelectionFx() }
  // Oculta o cabelo (corpos realistas) para ver os pontos da cabeça e da nuca
  setHairVisible(on) {
    this.hairVisible = !!on
    ;(this._hairMeshes || []).forEach(h => { h.visible = this.hairVisible && this._xr < 0.3 && this._hide < 0.3 })
  }
  hasHair() { return true }
  // Camada: 'skin' | 'muscles' | 'bones' | 'organs'
  setLayer(name) {
    this.layer = LAYERS.includes(name) ? name : 'skin'
    this._ensureLayers()
    if (this.points) { this._refreshNeedles(); this._refreshOrgans() }
  }
  getLayer() { return this.layer }
  // Agulhas com a profundidade de referência nos pontos selecionados
  setNeedle(on) { this.needle = !!on; if (this.points) this._refreshSelectionFx() }
  getNeedle() { return this.needle }
  getModel() { return this.modelKey }
  setAutoRotate(on) { this.autoRotate = !!on }

  // ── Loop ───────────────────────────────────────────────────────────────────
  _animate() {
    if (this._disposed) return
    this._animId = requestAnimationFrame(() => this._animate())
    const dt = Math.min(0.05, this._clock.getDelta())
    const t = this._clock.elapsedTime

    if (this._tween) {
      const k = Math.min(1, (performance.now() - this._tween.start) / this._tween.ms)
      const e = ease(k)
      this.camera.position.lerpVectors(this._tween.p0, this._tween.p1, e)
      this.controls.target.lerpVectors(this._tween.t0, this._tween.t1, e)
      if (k >= 1) this._tween = null
    } else if (this.tv && this._swayBase && !this._userMoved) {
      // TV: câmera "respira" suavemente em torno dos pontos exibidos
      // Pontos espalhados em lados opostos: gira devagar em volta deles
      const { target, dir, dist, full } = this._swayBase
      if (this._swayT0 == null) this._swayT0 = t
      const a = full ? (t - this._swayT0) * 0.28 : Math.sin((t - this._swayT0) * 0.35) * 0.32
      const d = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a)
      this.camera.position.copy(target).addScaledVector(d, dist)
      this.controls.target.copy(target)
    }
    this.controls.autoRotate = this.autoRotate && !this._tween && !this._swayBase && !this._userMoved

    this.controls.update()

    // Fluxo de energia
    for (const f of this._flows) {
      const arr = f.obj.geometry.attributes.position.array
      for (let i = 0; i < f.n; i++) {
        const u = (f.phase + t * f.speed + i / f.n) % 1
        const p = f.curve.getPointAt(u)
        arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z
      }
      f.obj.geometry.attributes.position.needsUpdate = true
    }
    // Halos pulsando
    const pulse = 1 + Math.sin(t * 3.2) * 0.22
    this._halos.forEach(sp => sp.scale.setScalar((this.tv ? 0.05 : 0.04) * pulse))

    if (this._skinU) this._stepLayers(dt, t)
    this.renderer.render(this.scene, this.camera)
    this._updateLabels()
    this._updateOrganLabels()
  }

  _updateOrganLabels() {
    if (!this._organLabels.size) return
    const W = this.renderer.domElement.clientWidth, H = this.renderer.domElement.clientHeight, v = new THREE.Vector3()
    const on = this.layer === 'organs' && this._xr > 0.6
    const items = []
    this._organLabels.forEach(el => {
      v.copy(el._pos).project(this.camera)
      const ok = on && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05
      el.style.opacity = ok ? '1' : '0'
      if (!ok) return
      if (!el._w) { el._w = el.offsetWidth || 70; el._h = el.offsetHeight || 22 }
      items.push({ el, x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H })
    })
    // sem sobrepor: cada rótulo desce ou sobe em degraus até achar espaço
    items.sort((a, b) => a.y - b.y)
    const placed = []
    items.forEach(it => {
      const w = it.el._w, h = it.el._h
      let box = null
      for (const k of [0, 1, -1, 2, -2, 3, -3, 4]) {
        const t = it.y - h / 2 + k * (h + 4)
        const bx = { l: it.x - w / 2, r: it.x + w / 2, t, b: t + h }
        if (!placed.some(q => bx.l < q.r && bx.r > q.l && bx.t < q.b && bx.b > q.t)) { box = bx; break }
      }
      box ||= { l: it.x - w / 2, r: it.x + w / 2, t: it.y - h / 2, b: it.y + h / 2 }
      placed.push(box)
      it.el.style.transform = `translate(${box.l}px, ${box.t}px)`
    })
  }

  _updateLabels() {
    if (!this._labels.size) return
    const W = this.renderer.domElement.clientWidth, H = this.renderer.domElement.clientHeight
    const cam = this.camera.position, v = new THREE.Vector3(), toCam = new THREE.Vector3()
    const items = []
    this._labels.forEach((el, id) => {
      const pt = this.points[this.pointById.get(id)]
      toCam.subVectors(cam, pt.pos)
      const facing = pt.nrm.dot(toCam) > -0.05 * toCam.length()
      v.copy(pt.pos).project(this.camera)
      const inView = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1
      if (!facing || !inView || !this._pointVisible(pt)) { el.style.opacity = '0'; return }
      if (!el._w) { el._w = el.offsetWidth || 90; el._h = el.offsetHeight || 20 }
      items.push({ el, x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H })
    })
    // Evita rótulos sobrepostos: cada um tenta acima do ponto e, se colidir,
    // desce/sobe em degraus até achar espaço livre.
    items.sort((a, b) => a.y - b.y)
    const placed = []
    for (const it of items) {
      const w = it.el._w, h = it.el._h
      let best = null
      for (const off of [-1, 1, -2, 2, -3, 3, -4, 4]) {
        const top = it.y + (off < 0 ? off * (h + 3) - 4 : off * (h + 3) - h + 12)
        const box = { l: it.x - w / 2, r: it.x + w / 2, t: top, b: top + h }
        if (!placed.some(p => box.l < p.r && box.r > p.l && box.t < p.b && box.b > p.t)) { best = box; break }
      }
      if (!best) best = { l: it.x - w / 2, r: it.x + w / 2, t: it.y - h - 8, b: it.y - 8 }
      placed.push(best)
      it.el.style.opacity = '1'
      it.el.style.transform = `translate(${best.l}px, ${best.t}px)`
    }
  }

  _onResize() {
    const W = this.container.clientWidth, H = this.container.clientHeight
    if (!W || !H) return
    this.camera.aspect = W / H
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(W, H)
  }

  destroy() {
    this._disposed = true
    cancelAnimationFrame(this._animId)
    Object.values(this._real).forEach(R => { this.scene.remove(R.group); R.meshes.forEach(m => { m.material.dispose(); if (!m.userData.part) m.geometry.dispose() }) })
    this._needles.forEach(g => g.traverse(o => { o.geometry?.dispose() }))
    this._ro?.disconnect()
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.overlay.remove()
  }
}

export { AcupunctureViewer, ACU_MERIDIANS, ACU_PROTOCOLS, ACU_DEPTH, MODELS, LAYERS, findPoint, sideIds, baseId, depthInfo }
