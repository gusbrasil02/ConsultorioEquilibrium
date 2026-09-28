import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { PHYSIO_REGIONS, REGION_GROUPS, findRegion, regionByLabel, findCondition } from '/js/physio-data.js'
import { buildAnatomy, hasAnatomy, sharedUniforms, KINDS } from '/js/physio-anatomy.js'
import { MUSCLES, MUSCLE_GROUPS, muscleId, muscleFromId, findMuscle } from '/js/muscle-data.js'

// ─── Anatomia 3D (fisioterapia) ──────────────────────────────────────────────
// Corpo realista com a região da dor acesa em vermelho (ondas saindo do ponto)
// e, ao "entrar", a pele vira um holograma translúcido e as estruturas internas
// se materializam — com a lesão pulsando, rompida ou desgastada.
//
// Usado no painel (Modo Consulta) e na TV do paciente (sequência automática:
// corpo inteiro → aproxima na região → visão interna).
//
// Visão de músculos: a pele dá lugar à textura "écorché" gerada por
// tools/muscles (cor, relevo e um mapa com o id de cada músculo por lado). O
// mapa de ids permite clicar, destacar e isolar músculos direto no shader.

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)

const BODIES = {
  female: { glb: '/models/body-female.glb', joints: '/models/body-female.joints.json', mus: '/models/muscles-female', height: 1.66 },
  male:   { glb: '/models/body-male.glb',   joints: '/models/body-male.joints.json',   mus: '/models/muscles-male',   height: 1.78 }
}
const MAX_SEL = 16
const BUMP = 0.0035

// 'biceps' (os dois lados), 'biceps:D' ou 'biceps:E' → ids do mapa de músculos
function selIds(list) {
  const out = []
  ;(list || []).forEach(s => {
    const [key, side] = String(s).split(':')
    if (side) out.push(muscleId(key, side))
    else out.push(muscleId(key, 'D'), muscleId(key, 'E'))
  })
  return out.filter(Boolean).slice(0, MAX_SEL)
}
function fillSel(u, ids) {
  u.value.fill(0)
  ids.forEach((id, i) => { u.value[i] = id })
}

const KIND_LABEL = {
  bone: 'Osso', cartilage: 'Cartilagem', meniscus: 'Menisco / lábio', disc: 'Disco', ligament: 'Ligamento',
  tendon: 'Tendão', nerve: 'Nervo', fascia: 'Fáscia', muscle: 'Músculo', bursa: 'Bursa', capsule: 'Cápsula / articulação', deposit: 'Cálcio'
}

const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const approach = (cur, tg, rate, dt) => cur + (tg - cur) * Math.min(1, rate * dt)
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// ─── Estilos do overlay ──────────────────────────────────────────────────────
const STYLE_ID = 'phy-viewer-style'
function injectStyle() {
  if (document.getElementById(STYLE_ID)) return
  const s = document.createElement('style')
  s.id = STYLE_ID
  s.textContent = `
  .phy-host { position: relative; overflow: hidden;
    background:
      linear-gradient(rgba(90,200,255,0.035) 1px, transparent 1px) 0 0 / 44px 44px,
      linear-gradient(90deg, rgba(90,200,255,0.035) 1px, transparent 1px) 0 0 / 44px 44px,
      radial-gradient(ellipse at 50% 42%, #0e2233 0%, #07121d 48%, #03060b 100%); }
  .phy-host canvas { display: block; outline: none; touch-action: none; }
  .phy-ov { position: absolute; inset: 0; pointer-events: none; font-family: 'DM Sans', system-ui, sans-serif; color: #fff; }
  .phy-loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    color: rgba(160,230,255,0.55); font-size: 13px; letter-spacing: .14em; text-transform: uppercase; }
  .phy-ret { position: absolute; left: 0; top: 0; opacity: 0; transition: opacity .5s; will-change: transform; }
  .phy-ret.on { opacity: 1; }
  .phy-ret svg { width: 100%; height: 100%; overflow: visible; }
  .phy-ret .r1 { fill: none; stroke: rgba(255,80,70,0.9); stroke-width: 1.4; stroke-dasharray: 16 9 3 9;
    transform-origin: 50% 50%; animation: phySpin 9s linear infinite; }
  .phy-ret .r2 { fill: none; stroke: rgba(255,120,110,0.35); stroke-width: 0.8; }
  .phy-ret .r3 { fill: none; stroke: rgba(120,220,255,0.55); stroke-width: 1; stroke-dasharray: 2 6;
    transform-origin: 50% 50%; animation: phySpin 14s linear infinite reverse; }
  .phy-ret .tk { stroke: rgba(255,90,80,0.95); stroke-width: 1.6; }
  @keyframes phySpin { to { transform: rotate(360deg); } }
  .phy-ret-lbl { position: absolute; left: 100%; top: 50%; transform: translate(10px, -50%); white-space: nowrap;
    padding: 5px 11px 5px 9px; border-left: 2px solid #ff5a4e; background: linear-gradient(90deg, rgba(40,6,8,0.85), rgba(40,6,8,0));
    font-size: 11px; letter-spacing: .16em; text-transform: uppercase; }
  .phy-ret-lbl b { display: block; font-size: 13px; letter-spacing: .12em; color: #ffd6d2; font-weight: 600; }
  .phy-ret-lbl span { color: rgba(255,170,160,0.75); font-size: 10px; }
  .phy-host.tv .phy-ret-lbl b { font-size: 16px; }
  .phy-host.tv .phy-ret-lbl span { font-size: 12px; }
  .phy-lbl { position: absolute; left: 0; top: 0; white-space: nowrap; padding: 3px 9px 3px 7px; border-radius: 6px;
    background: rgba(4,14,24,0.78); border: 1px solid rgba(120,220,255,0.35); color: rgba(220,245,255,0.92);
    font-size: 11px; line-height: 1.3; opacity: 0; transition: opacity .35s; will-change: transform;
    box-shadow: 0 2px 12px rgba(0,0,0,0.4); }
  .phy-lbl i { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; vertical-align: 0; }
  .phy-lbl.hot { border-color: rgba(255,90,80,0.95); background: rgba(40,6,8,0.88); color: #fff; font-weight: 600;
    box-shadow: 0 0 16px rgba(255,60,50,0.45); }
  .phy-lbl.hot i { background: #ff4a3d !important; box-shadow: 0 0 8px #ff4a3d; animation: phyBlink 1.1s ease-in-out infinite; }
  @keyframes phyBlink { 50% { opacity: .35; } }
  .phy-host.tv .phy-lbl { font-size: 14px; padding: 4px 11px 4px 9px; }
  .phy-tip { position: absolute; left: 0; top: 0; padding: 6px 10px; border-radius: 8px; font-size: 12px;
    background: rgba(4,14,24,0.92); border: 1px solid rgba(120,220,255,0.3); opacity: 0; transition: opacity .12s; }
  .phy-tip.on { opacity: 1; }
  .phy-hud { position: absolute; left: 16px; top: 14px; font-size: 10px; letter-spacing: .22em; text-transform: uppercase;
    color: rgba(140,225,255,0.7); opacity: 0; transition: opacity .5s; }
  .phy-hud.on { opacity: 1; }
  .phy-hud b { display: block; margin-top: 3px; font-size: 13px; letter-spacing: .14em; color: #e8f8ff; font-weight: 600; }
  .phy-hud .st { display: inline-flex; align-items: center; gap: 6px; margin-top: 6px; color: rgba(255,140,130,0.9); }
  .phy-hud .st::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: #ff4a3d; box-shadow: 0 0 8px #ff4a3d;
    animation: phyBlink 1.1s ease-in-out infinite; }
  .phy-host.tv .phy-hud { left: 28px; top: 24px; font-size: 12px; }
  .phy-host.tv .phy-hud b { font-size: 18px; }
  .phy-legend { position: absolute; left: 16px; bottom: 14px; display: flex; flex-wrap: wrap; gap: 5px 12px; max-width: 60%;
    font-size: 10.5px; color: rgba(210,235,250,0.75); opacity: 0; transition: opacity .6s; }
  .phy-legend.on { opacity: 1; }
  .phy-legend span { display: inline-flex; align-items: center; gap: 5px; }
  .phy-legend i { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
  .phy-host.tv .phy-legend { left: 28px; bottom: 60px; font-size: 13px; gap: 6px 16px; }
  .phy-corner { position: absolute; width: 26px; height: 26px; border-color: rgba(120,220,255,0.4); border-style: solid; border-width: 0; }
  .phy-corner.tl { left: 10px; top: 10px; border-left-width: 1.5px; border-top-width: 1.5px; }
  .phy-corner.tr { right: 10px; top: 10px; border-right-width: 1.5px; border-top-width: 1.5px; }
  .phy-corner.bl { left: 10px; bottom: 10px; border-left-width: 1.5px; border-bottom-width: 1.5px; }
  .phy-corner.br { right: 10px; bottom: 10px; border-right-width: 1.5px; border-bottom-width: 1.5px; }
  `
  document.head.appendChild(s)
}

function glowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.25, 'rgba(255,255,255,0.7)')
  grd.addColorStop(0.6, 'rgba(255,255,255,0.15)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// Anéis concêntricos no chão (plataforma "holográfica")
function floorTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 512
  const g = c.getContext('2d')
  const grd = g.createRadialGradient(256, 256, 0, 256, 256, 256)
  grd.addColorStop(0, 'rgba(80,200,255,0.28)')
  grd.addColorStop(0.55, 'rgba(40,120,200,0.08)')
  grd.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 512, 512)
  g.strokeStyle = 'rgba(120,220,255,0.35)'
  ;[70, 130, 190, 240].forEach((r, i) => {
    g.lineWidth = i === 3 ? 2 : 1
    g.setLineDash(i % 2 ? [6, 10] : [])
    g.beginPath(); g.arc(256, 256, r, 0, Math.PI * 2); g.stroke()
  })
  g.setLineDash([])
  for (let a = 0; a < 72; a++) {
    const ang = a / 72 * Math.PI * 2, r0 = a % 6 ? 244 : 234
    g.beginPath(); g.moveTo(256 + Math.cos(ang) * r0, 256 + Math.sin(ang) * r0)
    g.lineTo(256 + Math.cos(ang) * 250, 256 + Math.sin(ang) * 250); g.stroke()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// ─── Shader da pele: região acesa + modo holograma ───────────────────────────
function setupSkin(mat, U) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime, uXray, uMus, uIso, uHoverM;
uniform vec3 uH0A, uH0B, uH0F, uH1A, uH1B, uH1F;
uniform vec4 uH0, uH1;
uniform sampler2D uMusMap, uIdMap;
uniform float uSel[${MAX_SEL}], uHotM[${MAX_SEL}];
uniform int uSelN, uHotN;
varying vec3 vWPos;
varying vec3 vWNrm;
float phyCap(vec3 p, vec3 a, vec3 b) { vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0); return length(pa - ba * h); }
float phyHot(vec3 a, vec3 b, vec4 H, vec3 F, out float d) {
  d = phyCap(vWPos, a, b);
  float k = 1.0 - smoothstep(H.x * 0.3, H.x, d);
  if (H.z > 0.5) k *= smoothstep(-0.1, 0.45, dot(normalize(vWNrm), F));
  return k * H.y;
}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
#ifdef USE_MAP
float phyMid = 0.0;
if (uMus > 0.001) {
  diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uMusMap, vMapUv).rgb * diffuse, uMus);
  phyMid = floor(texture2D(uIdMap, vMapUv).r * 255.0 + 0.5);
}
#else
float phyMid = 0.0;
#endif`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.42, uMus);`)
      .replace('#include <opaque_fragment>', `
float phyD0; float phyK0 = phyHot(uH0A, uH0B, uH0, uH0F, phyD0);
phyK0 *= 1.0 - 0.55 * uMus;   // na visão de músculos a região acende mais de leve
float phyD1; float phyK1 = phyHot(uH1A, uH1B, uH1, uH1F, phyD1);
vec3 phyRed = vec3(1.0, 0.12, 0.07);
float phyRing = pow(0.5 + 0.5 * sin(phyD0 * 150.0 - uTime * 4.5), 8.0);
float phyPulse = 0.8 + 0.2 * sin(uTime * 3.0);
outgoingLight = mix(outgoingLight, outgoingLight * vec3(1.0, 0.42, 0.38) + phyRed * 0.22, phyK0 * 0.8);
outgoingLight += phyRed * phyK0 * (0.3 * phyPulse + 0.6 * phyRing * (1.0 - uXray));
outgoingLight += vec3(0.25, 0.75, 1.0) * phyK1 * 0.4;
// Músculos: selecionados (azul), da condição (vermelho), sob o mouse
float phySel = 0.0, phyHotM = 0.0;
for (int i = 0; i < ${MAX_SEL}; i++) {
  if (i < uSelN && abs(uSel[i] - phyMid) < 0.5) phySel = 1.0;
  if (i < uHotN && abs(uHotM[i] - phyMid) < 0.5) phyHotM = 1.0;
}
phySel *= uMus; phyHotM *= uMus;
float phyHovM = (phyMid > 0.5 && abs(uHoverM - phyMid) < 0.5) ? uMus : 0.0;
float phyFrM = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.0);
float phyBeat = 0.5 + 0.5 * sin(uTime * 3.5);
outgoingLight = mix(outgoingLight, outgoingLight * vec3(1.15, 0.5, 0.45) + phyRed * 0.3, phyHotM * 0.75);
outgoingLight += phyRed * phyHotM * (0.2 + 0.35 * phyBeat + 0.5 * phyFrM);
outgoingLight = mix(outgoingLight, outgoingLight * 1.12, phySel);
outgoingLight += vec3(0.25, 0.75, 1.0) * phySel * (0.03 + 0.06 * phyBeat + 0.4 * phyFrM);
outgoingLight += vec3(0.3, 0.8, 1.0) * phyHovM * 0.16;
#include <opaque_fragment>
// Isolar: os outros músculos viram um holograma apagado
float phyIso = uIso * uMus * (1.0 - max(phySel, phyHotM));
if (phyIso > 0.001) {
  vec3 phyGh = mix(vec3(0.03, 0.08, 0.13), vec3(0.4, 0.8, 1.0), phyFrM);
  gl_FragColor = vec4(mix(gl_FragColor.rgb, phyGh, phyIso), mix(gl_FragColor.a, 0.04 + 0.4 * phyFrM, phyIso));
}
if (uXray > 0.001) {
  vec3 phyV = normalize(vViewPosition);
  float phyFr = pow(1.0 - abs(dot(normalize(normal), phyV)), 1.8);
  float phyScan = 0.8 + 0.2 * sin(vWPos.y * 320.0 - uTime * 2.5);
  vec3 phyHolo = mix(vec3(0.02, 0.07, 0.14), vec3(0.4, 0.85, 1.0), phyFr) * phyScan + phyRed * phyK0 * 0.7;
  float phyA = clamp((0.03 + 0.5 * phyFr) * phyScan + phyK0 * 0.12, 0.0, 1.0);
  gl_FragColor = vec4(mix(gl_FragColor.rgb, phyHolo, uXray), mix(gl_FragColor.a, phyA, uXray));
}`)
  }
  mat.needsUpdate = true
}

// ─── Visualizador ────────────────────────────────────────────────────────────
class PhysioViewer {
  /**
   * options:
   *   model          'female' | 'male'
   *   isDoctor       clique no corpo escolhe a região; na visão interna marca estruturas
   *   tv             modo TV: rótulos maiores, câmera "respira", sequência automática
   *   labels         rótulos das estruturas (padrão: true)
   *   onRegion       (regionId) => void           — região escolhida clicando no corpo
   *   onMarks        (ids) => void                — estruturas marcadas à mão
   *   onParts        (parts) => void              — estruturas do modelo interno montado
   *   onMuscles      (sel) => void                — músculos escolhidos clicando no corpo
   *   onReady        () => void
   */
  constructor(container, options = {}) {
    this.container = container
    this.isDoctor = options.isDoctor ?? false
    this.tv = options.tv ?? false
    this.labelsOn = options.labels ?? true
    this.onRegion = options.onRegion ?? null
    this.onMarks = options.onMarks ?? null
    this.onParts = options.onParts ?? null
    this.onMuscles = options.onMuscles ?? null
    this.onReady = options.onReady ?? null
    this.modelKey = BODIES[options.model] ? options.model : 'female'
    this.body = BODIES[this.modelKey]

    this.region = null
    this.regionId = null
    this.condition = null
    this.marks = new Set()
    this.anatomy = null
    this.ready = false
    this._pending = []
    this._seq = []
    this._internal = false
    this._xray = 0
    this._hot = 0
    this._hover = 0
    this._reveal = 0
    this._tween = null
    this._fx = []
    this._labels = new Map()
    this.skinMode = 'skin'
    this.muscles = []          // seleção: 'biceps', 'biceps:D', …
    this.isolate = false
    this._mus = 0
    this._iso = 0
    this._disposed = false
    this._clock = new THREE.Clock()
    this._shared = sharedUniforms()

    injectStyle()
    this._init()
  }

  _init() {
    const host = this.container
    host.classList.add('phy-host')
    if (this.tv) host.classList.add('tv')
    const W = host.clientWidth || 600, H = host.clientHeight || 500

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(32, W / H, 0.01, 60)
    this.center = V(0, this.body.height * 0.52, 0)
    this.camera.position.set(0, this.body.height * 0.56, 3.4)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(W, H)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.95
    host.appendChild(this.renderer.domElement)

    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
    this.scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x10202c, 0.6))
    const key = new THREE.DirectionalLight(0xfff4ea, 1.9); key.position.set(1.6, 3, 3.2); this.scene.add(key)
    const rim = new THREE.DirectionalLight(0x6fd0ff, 1.6); rim.position.set(-2.4, 2.2, -3); this.scene.add(rim)
    const rim2 = new THREE.DirectionalLight(0x9fe8ff, 0.8); rim2.position.set(2.6, 1.2, -2.6); this.scene.add(rim2)

    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.95, 64),
      new THREE.MeshBasicMaterial({ map: floorTexture(), transparent: true, depthWrite: false, toneMapped: false }))
    floor.rotation.x = -Math.PI / 2
    floor.position.y = 0.002
    this.scene.add(floor)
    this._floor = floor

    this._glow = glowTexture()
    // Anel de varredura que percorre a região (visão externa)
    this._scan = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 8, 96),
      new THREE.MeshBasicMaterial({ color: 0x7fe0ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }))
    this._scan.visible = false
    this.scene.add(this._scan)

    // Overlay
    this.overlay = document.createElement('div')
    this.overlay.className = 'phy-ov'
    host.appendChild(this.overlay)
    this.loadingEl = this._el('phy-loading', 'Carregando corpo 3D…')
    this.retEl = this._el('phy-ret', `
      <svg viewBox="-50 -50 100 100">
        <circle class="r3" r="49"/><circle class="r1" r="44"/><circle class="r2" r="34"/>
        <line class="tk" x1="0" y1="-50" x2="0" y2="-40"/><line class="tk" x1="0" y1="40" x2="0" y2="50"/>
        <line class="tk" x1="-50" y1="0" x2="-40" y2="0"/><line class="tk" x1="40" y1="0" x2="50" y2="0"/>
      </svg><div class="phy-ret-lbl"><b></b><span></span></div>`)
    this.hudEl = this._el('phy-hud', '')
    this.legendEl = this._el('phy-legend', '')
    if (this.tv) ['tl', 'tr', 'bl', 'br'].forEach(c => this._el('phy-corner ' + c, ''))
    if (this.isDoctor) this.tipEl = this._el('phy-tip', '')

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.copy(this.center)
    this.controls.minDistance = 0.12
    this.controls.maxDistance = 6
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.enablePan = this.isDoctor
    this.controls.update()
    this.controls.addEventListener('start', () => { this._tween = null; this._userMoved = true; this._sway = null })

    if (this.isDoctor) this._bindPointer()
    this._ro = new ResizeObserver(() => this._onResize())
    this._ro.observe(host)
    this._load()
    this._animate()
  }

  _el(cls, html) {
    const e = document.createElement('div')
    e.className = cls
    e.innerHTML = html
    this.overlay.appendChild(e)
    return e
  }

  // ── Carregamento ───────────────────────────────────────────────────────────
  async _load() {
    try {
      const [gltf, joints] = await Promise.all([
        new Promise((res, rej) => new GLTFLoader().load(this.body.glb, res, undefined, rej)),
        fetch(this.body.joints).then(r => { if (!r.ok) throw new Error('joints'); return r.json() })
      ])
      if (this._disposed) return
      this._joints = joints
      this._others = []
      gltf.scene.traverse(o => {
        if (!o.isMesh) return
        if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals()
        const m = o.material
        if (o.name === 'body') {
          m.roughness = 0.6
          m.envMapIntensity = 0.45
          this._skinU = {
            uTime: { value: 0 }, uXray: { value: 0 }, uMus: { value: 0 }, uIso: { value: 0 }, uHoverM: { value: 0 },
            uMusMap: { value: null }, uIdMap: { value: null },
            uSel: { value: new Float32Array(MAX_SEL) }, uSelN: { value: 0 },
            uHotM: { value: new Float32Array(MAX_SEL) }, uHotN: { value: 0 },
            uH0A: { value: V() }, uH0B: { value: V() }, uH0F: { value: V() }, uH0: { value: new THREE.Vector4(0.1, 0, 0, 0) },
            uH1A: { value: V() }, uH1B: { value: V() }, uH1F: { value: V() }, uH1: { value: new THREE.Vector4(0.1, 0, 0, 0) }
          }
          setupSkin(m, this._skinU)
          o.renderOrder = 10
          this._bodyMesh = o
          this._skin = m
        } else {
          if (o.name === 'hair') { m.side = THREE.DoubleSide; m.envMapIntensity = 0.3 }
          if (o.name === 'eyes') { m.roughness = 0.15; m.envMapIntensity = 0.9 }
          if (['eyebrows', 'eyelashes', 'hair'].includes(o.name)) o.renderOrder = 2
          this._others.push(o)
        }
      })
      if (!this._bodyMesh) throw new Error('malha do corpo não encontrada')
      this.scene.add(gltf.scene)
      gltf.scene.updateMatrixWorld(true)
    } catch (err) {
      console.error('[PhysioViewer] Erro ao carregar o corpo:', err)
      this.loadingEl.textContent = 'Não foi possível carregar o corpo 3D.'
      return
    }
    this.loadingEl.remove()
    this.ready = true
    const q = this._pending
    this._pending = []
    q.forEach(fn => fn())
    this.onReady?.()
  }

  _whenReady(fn) { if (this.ready) fn(); else this._pending.push(fn) }

  // ── Geometria de apoio ─────────────────────────────────────────────────────
  J(name) {
    const j = this._joints?.[name]
    if (!j) throw new Error('junta ausente: ' + name)
    return V(j[0], j[1], j[2])
  }
  _ref(ref) {
    if (typeof ref === 'string') return this.J(ref)
    return this.J(ref[0]).lerp(this.J(ref[1]), ref[2])
  }
  // Distância de um ponto (dentro do corpo) até a pele numa direção
  _ray(o, d) {
    const rc = this._rc || (this._rc = new THREE.Raycaster())
    rc.set(o, d.clone().normalize())
    rc.near = 0
    rc.far = 0.8
    const m = this._skin, side = m.side
    m.side = THREE.DoubleSide
    const hit = rc.intersectObject(this._bodyMesh, false)[0]
    m.side = side
    return hit ? hit.distance : null
  }
  // Seção do membro em P: eixos (x = lateral, y, z = frente) e distâncias à pele
  _fit(P, yAxis, zHint, sx) {
    const y = yAxis.clone().normalize()
    const z = (zHint || V(0, 0, 1)).clone()
    z.addScaledVector(y, -z.dot(y)).normalize()
    const x = y.clone().cross(z).multiplyScalar(sx || 1).normalize()
    const lat = this._ray(P, x) ?? 0.05
    const med = Math.min(this._ray(P, x.clone().negate()) ?? lat, lat * 1.6)
    const ant = this._ray(P, z) ?? 0.05
    const post = this._ray(P, z.clone().negate()) ?? ant
    const center = P.clone().addScaledVector(x, (lat - med) / 2).addScaledVector(z, (ant - post) / 2)
    return { center, x, y, z, lat, med, ant, post, halfW: (lat + med) / 2, halfD: (ant + post) / 2 }
  }
  _regionGeo(r) {
    const a = this._ref(r.cap.a), b = this._ref(r.cap.b)
    const k = this.body.height / 1.78
    let axis = r.axis ? this._ref(r.axis[1]).sub(this._ref(r.axis[0])) : b.clone().sub(a)
    if (axis.lengthSq() < 1e-8) axis = V(0, 1, 0)
    return { a, b, r: r.cap.r * k, center: a.clone().lerp(b, 0.5), axis: axis.normalize(), half: a.distanceTo(b) / 2 }
  }
  _viewDir(r) {
    const v = r?.view || [0, 0.1, 1]
    return V(r?.sx ? v[0] * r.sx : v[0], v[1], v[2]).normalize()
  }

  // ── Região ─────────────────────────────────────────────────────────────────
  setRegion(id, { focus = true } = {}) {
    if (!this.ready) { this._whenReady(() => this.setRegion(id, { focus })); return }
    const r = id ? findRegion(id) : null
    if ((r?.id || null) === this.regionId) { if (focus && r) this.focusRegion(); return }
    this._disposeAnatomy()
    this.region = r
    this.regionId = r?.id || null
    this.condition = null
    this.marks = new Set()
    this._internal = false
    if (r) {
      this._geo = this._regionGeo(r)
      const U = this._skinU
      U.uH0A.value.copy(this._geo.a)
      U.uH0B.value.copy(this._geo.b)
      U.uH0.value.set(this._geo.r, 0, r.facing ? 1 : 0, 0)
      if (r.facing) U.uH0F.value.set(...r.facing)
      this._hot = 0
      const rl = this.retEl.querySelector('.phy-ret-lbl')
      rl.querySelector('b').textContent = r.label
      rl.querySelector('span').textContent = 'Área de dor'
    } else this._geo = null
    this._updateHud()
    if (focus) { if (r) this.focusRegion(); else this.setView('front') }
  }
  getRegion() { return this.regionId }
  hasInternal() { return !!(this.region?.model && hasAnatomy(this.region.model)) }

  setCondition(id) {
    if (!this.ready) { this._whenReady(() => this.setCondition(id)); return }
    const prev = this.condition
    this.condition = this.region && id ? findCondition(this.region, id) : null
    this._applyFx()
    this._updateMuscleUniforms()
    this._updateHud()
    if (this._internal && prev !== this.condition) this.focusInternal()
  }
  setMarks(ids) {
    if (!this.ready) { this._whenReady(() => this.setMarks(ids)); return }
    this.marks = new Set(ids || [])
    this._applyFx()
  }
  getMarks() { return [...this.marks] }

  setInternal(on) {
    if (!this.ready) { this._whenReady(() => this.setInternal(on)); return }
    on = !!on && this.hasInternal()
    if (on && !this._ensureAnatomy()) on = false
    if (on === this._internal) { if (on) this.focusInternal(); return }
    this._internal = on
    if (on) {
      this._reveal = 0
      this.anatomy.group.visible = true
      this.focusInternal()
    } else if (this.region) this.focusRegion()
    this._updateHud()
  }
  isInternal() { return this._internal }

  setLabels(on) { this.labelsOn = !!on }

  // Estruturas do modelo interno (para a lista do painel)
  getParts() {
    if (!this.anatomy) return []
    return this.anatomy.parts.filter(p => !p.extra).map(p => ({ id: p.id, label: p.label, kind: p.kind, minor: p.minor }))
  }

  // ── Visão de músculos ──────────────────────────────────────────────────────
  setSkin(mode) {
    this.skinMode = mode === 'muscle' ? 'muscle' : 'skin'
    if (this.skinMode === 'muscle') this._loadMuscles()
    this._updateHud()
  }
  getSkin() { return this.skinMode }

  // Texturas geradas por tools/muscles (carregadas na primeira vez)
  _loadMuscles() {
    if (this._musLoading) return this._musLoading
    const base = this.body.mus
    const tl = new THREE.TextureLoader()
    const tex = (url, srgb, nearest) => new Promise((res, rej) => tl.load(url, t => {
      t.flipY = false
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
      if (nearest) { t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false }
      else t.anisotropy = 4
      res(t)
    }, undefined, rej))
    this._musLoading = Promise.all([
      tex(base + '.jpg', true), tex(base + '-bump.jpg', false), tex(base + '-id.png', false, true),
      fetch(base + '.json').then(r => r.json())
    ]).then(([col, bump, id, info]) => {
      if (this._disposed) return
      this._musInfo = info
      this._whenReady(() => {
        const U = this._skinU
        U.uMusMap.value = col
        U.uIdMap.value = id
        this._skin.bumpMap = bump
        this._skin.bumpScale = 0
        this._skin.needsUpdate = true
        // cópia do mapa de ids na CPU para saber qual músculo está sob o mouse
        const img = id.image, c = document.createElement('canvas')
        c.width = img.width; c.height = img.height
        const g = c.getContext('2d', { willReadFrequently: true })
        g.drawImage(img, 0, 0)
        this._idData = { w: c.width, h: c.height, px: g.getImageData(0, 0, c.width, c.height).data }
        this._musReady = true
        this._updateMuscleUniforms()
      })
    }).catch(err => {
      console.error('[PhysioViewer] Erro ao carregar os músculos:', err)
      this._musLoading = null
    })
    return this._musLoading
  }

  setMuscles(list, { focus = false } = {}) {
    if (!this.ready) { this._whenReady(() => this.setMuscles(list, { focus })); return }
    this.muscles = [...new Set(list || [])]
    this._updateMuscleUniforms()
    this._updateHud()
    if (focus && this.muscles.length) this.focusMuscles()
  }
  getMuscles() { return [...this.muscles] }
  setIsolate(on) { this.isolate = !!on }

  // Músculos ligados à condição acendem em vermelho (só do lado da região)
  _condMuscles() {
    const keys = this.condition?.muscles || []
    const side = this.region?.side
    return keys.map(k => (side ? `${k}:${side}` : k))
  }
  _updateMuscleUniforms() {
    const U = this._skinU
    if (!U) return
    const sel = selIds(this.muscles), hot = selIds(this._condMuscles())
    fillSel(U.uSel, sel); U.uSelN.value = sel.length
    fillSel(U.uHotM, hot); U.uHotN.value = hot.length
  }

  // Músculo (id) no ponto do corpo sob o cursor
  _muscleAtUV(uv) {
    const D = this._idData
    if (!D || !uv) return 0
    const x = Math.min(D.w - 1, Math.max(0, Math.floor(uv.x * D.w)))
    const y = Math.min(D.h - 1, Math.max(0, Math.floor(uv.y * D.h)))
    return D.px[(y * D.w + x) * 4]
  }
  _pickMuscle(cx, cy) {
    if (!this._bodyMesh || !this._musReady) return 0
    const hit = this._raycaster(cx, cy).intersectObject(this._bodyMesh, false)[0]
    return hit ? this._muscleAtUV(hit.uv) : 0
  }

  // Enquadra os músculos selecionados (centro e normal médios do mapa)
  focusMuscles(list = this.muscles) {
    if (!this._musInfo) { this._loadMuscles()?.then(() => this.focusMuscles(list)); return }
    const ids = selIds(list).filter(id => this._musInfo[id])
    if (!ids.length) return
    const c = V(), n = V()
    let r = 0
    ids.forEach(id => { const d = this._musInfo[id]; c.add(V(d[0], d[1], d[2])); n.add(V(d[3], d[4], d[5])) })
    c.multiplyScalar(1 / ids.length)
    ids.forEach(id => { const d = this._musInfo[id]; r = Math.max(r, d[6] + c.distanceTo(V(d[0], d[1], d[2]))) })
    // Direção: a normal média no plano horizontal (os dois lados juntos se
    // anulam em X → olha de frente ou de costas); altura moderada
    const h = V(n.x, 0, n.z)
    if (h.length() < 0.25 * ids.length) h.set(0, 0, n.z < -0.05 * ids.length ? -1 : 1)
    const dir = h.normalize().add(V(0, THREE.MathUtils.clamp(n.y / ids.length, -0.3, 0.35), 0)).normalize()
    this._goto(c, dir, THREE.MathUtils.clamp(this._fitDist(Math.max(r * 1.25, 0.07)), 0.3, 3.2))
  }

  // ── Visão interna ──────────────────────────────────────────────────────────
  _ensureAnatomy() {
    if (this.anatomy) return this.anatomy
    const r = this.region
    if (!r?.model) return null
    const ctx = {
      J: n => this.J(n),
      Jopt: n => (this._joints[n] ? this.J(n) : null),
      ray: (o, d) => this._ray(o, d),
      fit: (p, y, z) => this._fit(p, y, z, r.sx),
      pre: r.pre, sx: r.sx, H: this.body.height, region: r, shared: this._shared
    }
    let A
    try { A = buildAnatomy(r.model, ctx) } catch (err) {
      console.error('[PhysioViewer] Erro ao montar a anatomia:', err)
      return null
    }
    if (!A) return null
    this.anatomy = A
    A.group.visible = false
    this.scene.add(A.group)
    A.group.updateMatrixWorld(true)
    const k = new THREE.Vector3().setFromMatrixScale(A.group.matrix).x
    A.parts.forEach(p => {
      p.st = { lesion: 0, tear: 0, wear: 0, sx: 1, sy: 1, sz: 1, shift: 0, vis: p.extra ? 0 : 1, dim: 0, hover: 0 }
      p.tg = { ...p.st }
      p.anchorW = p.anchor.clone().applyMatrix4(A.group.matrix)
      const bs = p.meshes[0].geometry.boundingSphere || (p.meshes[0].geometry.computeBoundingSphere(), p.meshes[0].geometry.boundingSphere)
      p.rho = THREE.MathUtils.clamp(bs.radius * k * 0.6, 0.005, 0.022)
      p.meshes.forEach(m => {
        const u = m.material.userData.u
        if (p.tear) {
          u.uTearP.value.set(p.tear.p.x, p.tear.p.y, p.tear.p.z, p.tear.w)
          u.uTearN.value.copy(p.tear.n)
          u.uTearR.value = p.tear.r
        }
      })
      if (p.label) {
        const el = document.createElement('div')
        el.className = 'phy-lbl'
        el.innerHTML = `<i style="background:#${new THREE.Color(KINDS[p.kind].color).getHexString()}"></i>${esc(p.label)}`
        this.overlay.appendChild(el)
        this._labels.set(p.id, el)
      }
    })
    const c = A.center
    this._shared.uFocus.value.set(c.x, c.y, c.z, A.focusR)
    this._shared.uRevealO.value.copy(c).addScaledVector(V(0, 1, 0), -A.radius * 1.3)
    this._shared.uRevealN.value.set(0, 1, 0)
    this._revealSpan = A.radius * 2.6
    this._shared.uReveal.value = 0
    // Legenda com os tecidos presentes
    const kinds = [...new Set(A.parts.filter(p => !p.extra).map(p => p.kind))]
    this.legendEl.innerHTML = kinds.map(kd =>
      `<span><i style="background:#${new THREE.Color(KINDS[kd].color).getHexString()}"></i>${KIND_LABEL[kd]}</span>`).join('')
    this._applyFx()
    this.onParts?.(this.getParts())
    return A
  }

  _disposeAnatomy() {
    const A = this.anatomy
    this._fx.forEach(f => { this.scene.remove(f.pts, f.halo); f.pts.geometry.dispose(); f.pts.material.dispose(); f.halo.material.dispose() })
    this._fx = []
    this._labels.forEach(el => el.remove())
    this._labels.clear()
    this.legendEl.innerHTML = ''
    this._revealed = false
    this._reveal = 0
    if (!A) return
    this.scene.remove(A.group)
    A.group.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose() } })
    this.anatomy = null
    this.onParts?.([])
  }

  // Condição + marcações → alvos dos efeitos de cada estrutura
  _applyFx() {
    const A = this.anatomy
    if (!A) return
    const eff = new Map()
    const get = id => { if (!eff.has(id)) eff.set(id, { lesion: 0, tear: 0, wear: 0, s: [1, 1, 1], shift: 0, show: false }); return eff.get(id) }
    const customs = {}
    const add = (id, type, amt = 1) => {
      if (type === 'custom') { customs[id] = amt; return }
      const e = get(id)
      const p = A.parts.find(x => x.id === id)
      switch (type) {
        case 'inflame': e.lesion = Math.max(e.lesion, amt); break
        case 'tear': e.tear = Math.max(e.tear, amt); e.lesion = Math.max(e.lesion, 0.5); break
        case 'wear': e.wear = Math.max(e.wear, amt); e.lesion = Math.max(e.lesion, 0.55); break
        case 'swell': e.s = e.s.map(v => v * (1 + 0.5 * amt)); e.lesion = Math.max(e.lesion, 0.85); break
        case 'shrink': e.s = e.s.map(v => v * (1 - 0.1 * amt)); e.lesion = Math.max(e.lesion, 0.85); break
        case 'thin': { const ax = 'xyz'.indexOf(p?.thin || 'y'); e.s[ax] *= 1 - 0.55 * amt; e.lesion = Math.max(e.lesion, 0.5); break }
        case 'shift': e.shift = amt; e.lesion = Math.max(e.lesion, 0.7); break
        case 'show': e.show = true; e.lesion = Math.max(e.lesion, amt); break
      }
    }
    ;(this.condition?.fx || []).forEach(([id, type, amt]) => add(id, type, amt ?? 1))
    this.marks.forEach(id => add(id, 'inflame', 1))
    const any = eff.size > 0
    A.parts.forEach(p => {
      const e = eff.get(p.id)
      const tg = p.tg
      tg.lesion = e?.lesion || 0
      tg.tear = e?.tear || 0
      tg.wear = e?.wear || 0
      ;[tg.sx, tg.sy, tg.sz] = e?.s || [1, 1, 1]
      tg.shift = e?.shift || 0
      tg.vis = p.extra ? (e?.show ? 1 : 0) : 1
      tg.dim = any && !e ? 0.6 : 0
      // A estrutura afetada é desenhada por último: aparece mesmo atrás de ossos
      p.meshes.forEach(m => { m.renderOrder = e ? 8 : KINDS[p.kind].order })
    })
    Object.keys(A.custom).forEach(name => { A.custom[name]._tg = customs[name] || 0 })
    this._rebuildFx()
  }

  // Partículas de "inflamação" + halo nas estruturas afetadas
  _rebuildFx() {
    const A = this.anatomy
    this._fx.forEach(f => { this.scene.remove(f.pts, f.halo); f.pts.geometry.dispose(); f.pts.material.dispose(); f.halo.material.dispose() })
    this._fx = []
    if (!A) return
    A.parts.forEach(p => {
      if (p.tg.lesion < 0.5 || !p.tg.vis) return
      const n = 18
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({
        map: this._glow, color: 0xff4a36, size: this.tv ? 0.0075 : 0.006, sizeAttenuation: true,
        transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false
      }))
      pts.frustumCulled = false
      pts.renderOrder = 20
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this._glow, color: 0xff3a2a, transparent: true, opacity: 0, depthWrite: false, depthTest: false,
        blending: THREE.AdditiveBlending, toneMapped: false
      }))
      halo.renderOrder = 21
      halo.position.copy(p.anchorW)
      const seeds = Array.from({ length: n }, () => ({
        d: V(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
        ph: Math.random(), sp: 0.25 + Math.random() * 0.35, r: 0.35 + Math.random() * 0.65
      }))
      this.scene.add(pts, halo)
      this._fx.push({ p, pts, halo, seeds })
    })
  }

  // ── Câmera ─────────────────────────────────────────────────────────────────
  _animateTo(pos, target, ms = 1100) {
    this._tween = { p0: this.camera.position.clone(), p1: pos.clone(), t0: this.controls.target.clone(), t1: target.clone(), start: performance.now(), ms }
    this._userMoved = false
    this._sway = null
  }
  _fitDist(R) {
    const vfov = this.camera.fov * Math.PI / 180
    return R / Math.sin(vfov / 2) * (this.camera.aspect < 1 ? 1.45 : 1.05)
  }
  focusRegion() {
    if (!this.region || !this._geo) return
    const g = this._geo
    const dir = this._viewDir(this.region)
    const dist = THREE.MathUtils.clamp(this._fitDist(g.r * 1.35 + g.half), 0.45, 3.4)
    this._goto(g.center, dir, dist)
  }
  // Olha para o lado onde está a lesão (ex.: isquiotibiais → por trás)
  focusInternal() {
    const A = this.anatomy
    if (!A) return
    const dir = this._viewDir(this.region)
    const hot = A.parts.filter(p => p.tg.lesion > 0.3)
    if (hot.length) {
      const off = hot.reduce((s, p) => s.add(p.anchorW), V()).multiplyScalar(1 / hot.length).sub(A.center)
      off.y = 0
      if (off.length() > Math.max(0.006, A.radius * 0.08) && off.clone().normalize().dot(dir) < 0.2) {
        dir.multiplyScalar(0.55).add(off.normalize()).normalize()
      }
    }
    this._goto(A.center, dir, THREE.MathUtils.clamp(this._fitDist(A.radius * 1.55), 0.22, 2.5))
  }
  _goto(target, dir, dist) {
    const pos = target.clone().addScaledVector(dir, dist)
    this._animateTo(pos, target, 1300)
    this._pendingSway = { target: target.clone(), dir: dir.clone(), dist }
  }
  _wide() {
    const dir = this._viewDir(this.region)
    dir.y = 0.06
    dir.normalize()
    this._animateTo(this.center.clone().addScaledVector(dir, 3.3).setY(this.body.height * 0.56), this.center, 900)
    this._pendingSway = null
  }
  setView(name) {
    const T = this.region && this._geo ? (this._internal && this.anatomy ? this.anatomy.center : this._geo.center) : this.center
    const d = this.region ? this.camera.position.distanceTo(this.controls.target) : 3.4
    const dir = { front: V(0, 0.08, 1), back: V(0, 0.08, -1), left: V(1, 0.08, 0), right: V(-1, 0.08, 0) }[name] || V(0, 0.08, 1)
    if (name === 'reset' || !this.region) {
      this._animateTo(V(0, this.body.height * 0.56, 3.4), this.center)
      return
    }
    this._animateTo(T.clone().addScaledVector(dir.normalize(), d), T)
  }

  // ── Sequência automática da TV ─────────────────────────────────────────────
  // spec: { region, condition, marks, internal }
  play(spec) {
    if (!this.ready) { this._whenReady(() => this.play(spec)); return }
    this._seq.forEach(clearTimeout)
    this._seq = []
    const same = spec.region && spec.region === this.regionId && this._played
    this.setSkin(spec.skin)
    this.setIsolate(spec.isolate)
    this.setRegion(spec.region || null, { focus: false })
    this.setCondition(spec.condition || null)
    this.setMarks(spec.marks || [])
    this.setMuscles(spec.muscles || [])
    const wantInt = !!spec.internal && this.hasInternal()
    this._played = true
    // Só músculos, sem região: corpo inteiro → aproxima nos músculos
    if (!this.region && this.muscles.length) {
      this._wide()
      this._seq.push(setTimeout(() => this.focusMuscles(), 1400))
      return
    }
    if (!this.region) { this.setView('reset'); return }
    if (same) {
      if (wantInt !== this._internal) this.setInternal(wantInt)
      return
    }
    this._wide()
    this._seq.push(setTimeout(() => this.focusRegion(), 1400))
    if (wantInt) this._seq.push(setTimeout(() => this.setInternal(true), 5200))
  }

  // ── Mouse (painel) ─────────────────────────────────────────────────────────
  _bindPointer() {
    const el = this.renderer.domElement
    let down = null
    el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() } })
    el.addEventListener('pointerup', e => {
      if (!down) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      const quick = performance.now() - down.t < 700
      down = null
      if (moved > 6 || !quick || !this.ready) return
      if (this._internal) {
        const p = this._pickPart(e.clientX, e.clientY)
        if (p) {
          if (this.marks.has(p.id)) this.marks.delete(p.id); else this.marks.add(p.id)
          this._applyFx()
          this.onMarks?.([...this.marks])
        }
        return
      }
      // Visão de músculos: o clique escolhe o músculo (Ctrl/Shift soma à seleção)
      if (this.skinMode === 'muscle' && this._musReady) {
        const info = muscleFromId(this._pickMuscle(e.clientX, e.clientY))
        const k = info ? `${info.muscle.key}:${info.side}` : null
        let sel = this.muscles
        if (!k) sel = e.ctrlKey || e.shiftKey ? sel : []
        else if (e.ctrlKey || e.shiftKey) sel = sel.includes(k) ? sel.filter(x => x !== k) : [...sel, k]
        else sel = sel.length === 1 && sel[0] === k ? [] : [k]
        this.setMuscles(sel)
        this.onMuscles?.(this.getMuscles())
        return
      }
      const id = this._pickRegion(e.clientX, e.clientY)
      if (id) { this.setRegion(id); this.onRegion?.(id) }
    })
    el.addEventListener('pointermove', e => {
      if (e.buttons) return
      this._hoverXY = { x: e.clientX, y: e.clientY }
      if (!this._hoverRaf) this._hoverRaf = requestAnimationFrame(() => { this._hoverRaf = null; this._doHover() })
    })
    el.addEventListener('pointerleave', () => {
      this._hoverXY = null; this._setHoverRegion(null); this._setHoverPart(null)
      if (this._skinU) this._skinU.uHoverM.value = 0
    })
  }

  _raycaster(cx, cy) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const nd = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1)
    const rc = new THREE.Raycaster()
    rc.setFromCamera(nd, this.camera)
    return rc
  }
  _pickRegion(cx, cy) {
    if (!this._bodyMesh) return null
    const hit = this._raycaster(cx, cy).intersectObject(this._bodyMesh, false)[0]
    if (!hit) return null
    const n = hit.face.normal.clone().transformDirection(this._bodyMesh.matrixWorld)
    let best = null, bs = Infinity
    const k = this.body.height / 1.78
    PHYSIO_REGIONS.forEach(r => {
      let a, b
      try { a = this._ref(r.cap.a); b = this._ref(r.cap.b) } catch (_) { return }
      if (r.facing && n.dot(V(...r.facing)) < -0.05) return
      const ab = b.clone().sub(a), t = THREE.MathUtils.clamp(hit.point.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-8), 0, 1)
      const d = hit.point.distanceTo(a.clone().addScaledVector(ab, t)) / (r.cap.r * k)
      if (d < bs) { bs = d; best = r.id }
    })
    return bs < 1.4 ? best : null
  }
  _pickPart(cx, cy) {
    const A = this.anatomy
    if (!A) return null
    const meshes = []
    A.parts.forEach(p => { if (p.st.vis > 0.5) p.meshes.forEach(m => meshes.push(m)) })
    const hits = this._raycaster(cx, cy).intersectObjects(meshes, false)
    const h = hits.find(x => x.object.userData.part.kind !== 'capsule') || hits[0]
    return h ? h.object.userData.part : null
  }
  _doHover() {
    if (!this._hoverXY || !this.ready) return
    const { x, y } = this._hoverXY
    let text = null
    if (this._internal) {
      this._setHoverRegion(null)
      const p = this._pickPart(x, y)
      this._setHoverPart(p)
      if (p) text = `${p.label}${this.isDoctor ? ' · clique para marcar' : ''}`
    } else if (this.skinMode === 'muscle' && this._musReady) {
      this._setHoverPart(null)
      this._setHoverRegion(null)
      const mid = this._pickMuscle(x, y)
      this._skinU.uHoverM.value = mid
      const info = muscleFromId(mid)
      if (info) text = `${info.muscle.name} · ${info.side === 'E' ? 'esquerdo' : 'direito'}`
    } else {
      this._setHoverPart(null)
      const id = this._pickRegion(x, y)
      this._setHoverRegion(id)
      if (id) text = findRegion(id).label
    }
    this.renderer.domElement.style.cursor = text ? 'pointer' : ''
    if (!this.tipEl) return
    if (text) {
      const rect = this.renderer.domElement.getBoundingClientRect()
      this.tipEl.textContent = text
      this.tipEl.style.transform = `translate(${x - rect.left + 14}px, ${y - rect.top + 12}px)`
      this.tipEl.classList.add('on')
    } else this.tipEl.classList.remove('on')
  }
  _setHoverRegion(id) {
    if (this._hoverId === id) return
    this._hoverId = id
    const U = this._skinU
    if (!U) return
    const r = id && id !== this.regionId ? findRegion(id) : null
    if (!r) { U.uH1.value.y = 0; return }
    const g = this._regionGeo(r)
    U.uH1A.value.copy(g.a)
    U.uH1B.value.copy(g.b)
    U.uH1.value.set(g.r, 1, r.facing ? 1 : 0, 0)
    if (r.facing) U.uH1F.value.set(...r.facing)
  }
  _setHoverPart(p) {
    if (this._hoverPart === p) return
    if (this._hoverPart) this._hoverPart.tg.hover = 0
    this._hoverPart = p
    if (p) p.tg.hover = 1
  }

  // ── HUD ────────────────────────────────────────────────────────────────────
  _updateHud() {
    const mus = this.skinMode === 'muscle' ? this.muscles.map(s => {
      const [k, sd] = s.split(':'), m = findMuscle(k)
      return m ? m.name + (sd ? (sd === 'E' ? ' (E)' : ' (D)') : '') : null
    }).filter(Boolean) : []
    if (!this.region && !mus.length) { this.hudEl.classList.remove('on'); return }
    const mode = this._internal ? 'Visão interna' : this.skinMode === 'muscle' ? 'Músculos' : 'Visão externa'
    const title = this.region ? this.region.label : mus.length === 1 ? mus[0] : `${mus.length} músculos`
    this.hudEl.innerHTML = `Análise anatômica 3D · ${mode}<b>${esc(title)}</b>` +
      (this.condition ? `<span class="st">${esc(this.condition.name)}</span>` : '') +
      (this.region && mus.length ? `<span class="st">${esc(mus.slice(0, 3).join(' · '))}${mus.length > 3 ? '…' : ''}</span>` : '')
    this.hudEl.classList.add('on')
  }

  // ── Loop ───────────────────────────────────────────────────────────────────
  _animate() {
    if (this._disposed) return
    this._animId = requestAnimationFrame(() => this._animate())
    const dt = Math.min(0.05, this._clock.getDelta())
    const t = this._clock.elapsedTime
    this._shared.uTime.value = t

    // Câmera
    if (this._tween) {
      const k = Math.min(1, (performance.now() - this._tween.start) / this._tween.ms)
      const e = ease(k)
      this.camera.position.lerpVectors(this._tween.p0, this._tween.p1, e)
      this.controls.target.lerpVectors(this._tween.t0, this._tween.t1, e)
      if (k >= 1) {
        this._tween = null
        if (this._pendingSway) { this._sway = { ...this._pendingSway, t0: t }; this._pendingSway = null }
      }
    } else if (this.tv && this._sway && !this._userMoved) {
      const { target, dir, dist, t0 } = this._sway
      const a = Math.sin((t - t0) * 0.42) * (this._internal ? 0.55 : 0.3)
      const d = dir.clone().applyAxisAngle(V(0, 1, 0), a)
      this.camera.position.copy(target).addScaledVector(d, dist)
      this.controls.target.copy(target)
    }
    this.controls.update()

    if (this.ready) this._step(dt, t)
    this.renderer.render(this.scene, this.camera)
    if (this.ready) this._overlay(t)
  }

  _step(dt, t) {
    const U = this._skinU
    U.uTime.value = t
    // Região acesa
    this._hot = approach(this._hot, this.region ? 1 : 0, 2.2, dt)
    U.uH0.value.y = this._hot
    // Raio-X da pele
    this._xray = approach(this._xray, this._internal ? 1 : 0, 3, dt)
    if (this._xray < 0.002) this._xray = 0
    U.uXray.value = this._xray
    // Músculos ↔ pele
    this._mus = approach(this._mus, this.skinMode === 'muscle' && this._musReady ? 1 : 0, 2.6, dt)
    if (this._mus < 0.002) this._mus = 0
    U.uMus.value = this._mus
    this._iso = approach(this._iso, this.isolate && this.muscles.length + (this.condition?.muscles?.length || 0) > 0 ? 1 : 0, 3, dt)
    if (this._iso < 0.002) this._iso = 0
    U.uIso.value = this._iso
    if (this._skin.bumpMap) this._skin.bumpScale = BUMP * this._mus
    const trans = this._xray > 0 || this._iso > 0
    if (this._skin.transparent !== trans) {
      this._skin.transparent = trans
      this._skin.depthWrite = !trans
      this._skin.needsUpdate = true
    }
    // cabelo, sobrancelhas e cílios saem na visão de músculos (os olhos ficam)
    this._others.forEach(o => { o.visible = this._xray < 0.3 && this._iso < 0.3 && (o.name === 'eyes' || this._mus < 0.35) })
    this._floor.material.opacity = 1 - this._xray * 0.5

    // Materialização da anatomia
    const A = this.anatomy
    if (A) {
      const span = this._revealSpan
      this._reveal = this._internal
        ? Math.min(span, this._reveal + dt * span / (this._xray > 0.4 ? 1.6 : 99))
        : Math.max(0, this._reveal - dt * span / 0.5)
      this._shared.uReveal.value = this._reveal >= span ? 1e3 : this._reveal
      A.group.visible = this._reveal > 0
      this._revealed = this._internal && this._reveal >= span

      A.parts.forEach(p => {
        const s = p.st, g = p.tg
        for (const key of ['lesion', 'tear', 'wear', 'sx', 'sy', 'sz', 'shift', 'vis', 'dim', 'hover']) s[key] = approach(s[key], g[key], 3.2, dt)
        const grow = p.extra ? 0.25 + 0.75 * s.vis : 1
        p.meshes.forEach(m => {
          const u = m.material.userData.u
          u.uLesion.value = s.lesion * (p.extra ? s.vis : 1)
          u.uTearOn.value = s.tear
          u.uWear.value = s.wear
          u.uDim.value = s.dim
          u.uHover.value = s.hover
          // Estrutura esmaecida não esconde a lesão que está atrás dela
          m.material.depthWrite = !!KINDS[p.kind].depthWrite && s.dim < 0.25
          m.visible = !p.extra || s.vis > 0.02
          m.scale.set(s.sx * grow, s.sy * grow, s.sz * grow)
          m.position.set(p.anchor.x * (1 - m.scale.x), p.anchor.y * (1 - m.scale.y), p.anchor.z * (1 - m.scale.z))
          if (p.shift) m.position.addScaledVector(p.shift, s.shift)
          if (m.userData.off) m.position.add(m.userData.off)
        })
      })
      Object.values(A.custom).forEach(fn => {
        fn._cur = approach(fn._cur || 0, fn._tg || 0, 2.5, dt)
        if (fn._cur > 0.001 || fn._tg) fn(fn._cur)
      })
      // Partículas
      const vis = this._revealed ? 1 : 0
      this._fx.forEach(f => {
        const arr = f.pts.geometry.attributes.position.array, c = f.p.anchorW, rho = f.p.rho
        f.seeds.forEach((sd, i) => {
          const u = (t * sd.sp + sd.ph) % 1
          arr[i * 3] = c.x + sd.d.x * rho * sd.r
          arr[i * 3 + 1] = c.y + sd.d.y * rho * sd.r + u * rho * 1.4
          arr[i * 3 + 2] = c.z + sd.d.z * rho * sd.r
        })
        f.pts.geometry.attributes.position.needsUpdate = true
        f.pts.material.opacity = approach(f.pts.material.opacity, vis * 0.85 * f.p.st.lesion, 3, dt)
        f.halo.material.opacity = approach(f.halo.material.opacity, vis * 0.55 * f.p.st.lesion, 3, dt)
        f.halo.scale.setScalar(rho * (3.2 + Math.sin(t * 4) * 0.6))
      })
    }

    // Anel de varredura (visão externa)
    const g = this._geo
    const scanOn = g && !this._internal && this._hot > 0.3
    this._scan.visible = !!g
    if (g) {
      const m = this._scan.material
      m.opacity = approach(m.opacity, scanOn ? 0.55 : 0, 3, dt)
      const reach = g.half + g.r * 0.55
      const s = Math.sin(t * 1.3)
      this._scan.position.copy(g.center).addScaledVector(g.axis, s * reach)
      this._scan.quaternion.setFromUnitVectors(V(0, 0, 1), g.axis)
      this._scan.scale.setScalar(g.r * 1.02 * (1 - 0.25 * s * s))
      if (m.opacity < 0.01) this._scan.visible = false
    }
  }

  // Retículo de mira, rótulos e legenda (DOM)
  _overlay(t) {
    const W = this.renderer.domElement.clientWidth, H = this.renderer.domElement.clientHeight
    const proj = p => { const v = p.clone().project(this.camera); return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H, ok: v.z < 1 } }

    const g = this._geo
    if (g && !this._internal && this._hot > 0.5) {
      const c = proj(g.center)
      const right = V().setFromMatrixColumn(this.camera.matrixWorld, 0)
      const e = proj(g.center.clone().addScaledVector(right, g.r))
      const size = THREE.MathUtils.clamp(Math.hypot(e.x - c.x, e.y - c.y) * 2.3, 70, Math.min(W, H) * 0.7)
      this.retEl.style.width = this.retEl.style.height = size + 'px'
      this.retEl.style.transform = `translate(${c.x - size / 2}px, ${c.y - size / 2}px)`
      this.retEl.classList.toggle('on', c.ok)
    } else this.retEl.classList.remove('on')

    this.legendEl.classList.toggle('on', !!this._revealed)
    if (!this._labels.size) return
    const A = this.anatomy
    const items = []
    A.parts.forEach(p => {
      const el = this._labels.get(p.id)
      if (!el) return
      const affected = p.tg.lesion > 0.3 || this.marks.has(p.id)
      const show = this.labelsOn && this._revealed && (!p.extra || p.tg.vis > 0.5) &&
        (!p.minor || affected || p.tg.hover > 0.5) && (!this.tv || affected || !p.minor)
      el.classList.toggle('hot', affected)
      if (!show) { el.style.opacity = '0'; return }
      const c = proj(p.anchorW)
      if (!c.ok || c.x < -40 || c.x > W + 40 || c.y < -20 || c.y > H + 20) { el.style.opacity = '0'; return }
      if (!el._w || el._aff !== affected) { el._w = el.offsetWidth || 110; el._h = el.offsetHeight || 20; el._aff = affected }
      items.push({ el, x: c.x, y: c.y, affected })
    })
    // Afetados primeiro (ganham o melhor lugar); depois evita sobreposição
    items.sort((a, b) => (b.affected - a.affected) || (a.y - b.y))
    const placed = []
    for (const it of items) {
      const w = it.el._w, h = it.el._h
      let best = null
      for (const [dx, dy] of [[14, -h / 2], [-w - 14, -h / 2], [14, -h - 10], [-w - 14, -h - 10], [14, 10], [-w - 14, 10], [-w / 2, -h - 22], [-w / 2, 16], [14, -2 * h - 16], [-w - 14, 2 * h - 8]]) {
        const box = { l: it.x + dx, r: it.x + dx + w, t: it.y + dy, b: it.y + dy + h }
        if (!placed.some(p => box.l < p.r + 4 && box.r > p.l - 4 && box.t < p.b + 3 && box.b > p.t - 3)) { best = box; break }
      }
      if (!best) { if (!it.affected) { it.el.style.opacity = '0'; continue } best = { l: it.x + 14, r: it.x + 14 + w, t: it.y - h / 2, b: it.y + h / 2 } }
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

  getModel() { return this.modelKey }

  destroy() {
    this._disposed = true
    this._seq.forEach(clearTimeout)
    cancelAnimationFrame(this._animId)
    this._ro?.disconnect()
    this._disposeAnatomy()
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.overlay.remove()
    this.container.classList.remove('phy-host', 'tv')
  }
}

export {
  PhysioViewer, PHYSIO_REGIONS, REGION_GROUPS, KINDS, findRegion, regionByLabel, findCondition, hasAnatomy,
  MUSCLES, MUSCLE_GROUPS, findMuscle, muscleFromId
}
