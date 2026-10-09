// "Onde você sente dor?" — o paciente toca no corpo 3D realista (os mesmos
// corpos e regiões da Anatomia 3D do painel) e marca uma ou várias regiões.
//
// Usado pelo formulário do celular (/form) e pelo totem. Leve de propósito:
// não carrega a anatomia interna nem os músculos — só a pele, com as regiões
// marcadas acendendo em vermelho direto no shader.
//
// As respostas continuam sendo os nomes das regiões ("Joelho Direito, Lombar"),
// iguais aos da Anatomia 3D — o painel abre a região certa direto.
//
// Uso (script de página):
//   const ui = PainPicker.mount(area, { selected, sex, big, onChange, onFail })
//   ui.update({ selected, sex })     // reaproveita o corpo já carregado
// O corpo é carregado uma vez por página (PainPicker.preload) e o mesmo canvas
// é reaproveitado ao voltar/avançar as perguntas.
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { PHYSIO_REGIONS, findRegion, regionByLabel } from '/js/physio-data.js'

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)

const BODIES = {
  female: { glb: '/models/body-female.glb', joints: '/models/body-female.joints.json', height: 1.66 },
  male:   { glb: '/models/body-male.glb',   joints: '/models/body-male.joints.json',   height: 1.78 }
}
const MAX = 16   // regiões marcadas ao mesmo tempo (há 30 no corpo)

const STYLE_ID = 'pain-picker-style'
function injectStyle() {
  if (document.getElementById(STYLE_ID)) return
  const s = document.createElement('style')
  s.id = STYLE_ID
  s.textContent = `
  .pp-wrap { margin-bottom: 0.8rem; }
  .pp-bar { display: flex; gap: 0.45rem; margin-bottom: 0.7rem; }
  .pp-btn { flex: 1; padding: 0.6rem 0.4rem; border-radius: 60px; cursor: pointer;
    background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.25);
    color: rgba(255,255,255,0.8); font-family: 'DM Sans', sans-serif; font-size: 0.9rem; }
  .pp-btn.sx { flex: 0 0 auto; padding: 0.6rem 0.95rem; }
  .pp-btn.on { background: rgba(255,255,255,0.92); color: #3d1515; font-weight: 500; border-color: transparent; }
  .pp-stage { position: relative; height: min(56vh, 460px); border-radius: 18px; overflow: hidden;
    background: radial-gradient(ellipse at 50% 45%, rgba(255,255,255,0.09) 0%, rgba(0,0,0,0.18) 75%);
    border: 1px solid rgba(255,255,255,0.1); }
  .pp-stage canvas { display: block; touch-action: none; outline: none; }
  .pp-msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    color: rgba(255,255,255,0.6); font-family: 'DM Sans', sans-serif; font-size: 0.85rem; letter-spacing: .08em;
    pointer-events: none; text-align: center; padding: 1rem; }
  .pp-hint { position: absolute; left: 0; right: 0; bottom: 0.55rem; text-align: center; pointer-events: none;
    font-family: 'DM Sans', sans-serif; font-size: 0.75rem; color: rgba(255,255,255,0.45); }
  .pp-tip { position: absolute; left: 50%; top: 0.7rem; transform: translateX(-50%); pointer-events: none;
    padding: 0.35rem 0.85rem; border-radius: 60px; background: rgba(20,4,6,0.78); border: 1px solid rgba(255,110,100,0.7);
    color: #fff; font-family: 'DM Sans', sans-serif; font-size: 0.85rem; white-space: nowrap;
    opacity: 0; transition: opacity .25s; }
  .pp-tip.on { opacity: 1; }
  .pp-chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.4rem; margin: 0.75rem 0 0.4rem; min-height: 1.6rem; }
  .pp-chip { padding: 0.3rem 0.75rem; border-radius: 60px; cursor: pointer; font-family: 'DM Sans', sans-serif; font-size: 0.82rem;
    background: rgba(255,90,80,0.28); border: 1px solid rgba(255,140,130,0.7); color: #fff; }
  .pp-none { font-family: 'DM Sans', sans-serif; font-size: 0.85rem; color: rgba(255,255,255,0.6); }
  .pp-big .pp-stage { height: min(46vh, 520px); }
  .pp-big .pp-btn { font-size: 1rem; padding: 0.7rem 0.5rem; }
  .pp-big .pp-chip { font-size: 0.95rem; }
  .pp-big .pp-tip { font-size: 1rem; }`
  document.head.appendChild(s)
}

// Pele com as regiões marcadas acendendo (cápsulas no espaço do mundo)
function setupSkin(mat, U) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
uniform int uN;
uniform vec3 uA[${MAX}], uB[${MAX}], uF[${MAX}];
uniform vec4 uR[${MAX}];
uniform vec3 uHA, uHB, uHF;
uniform vec4 uHR;
varying vec3 vWPos;
varying vec3 vWNrm;
float ppCap(vec3 p, vec3 a, vec3 b) { vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0); return length(pa - ba * h); }
float ppHot(vec3 a, vec3 b, vec4 R, vec3 F) {
  float d = ppCap(vWPos, a, b);
  float k = 1.0 - smoothstep(R.x * 0.35, R.x, d);
  if (R.z > 0.5) k *= smoothstep(-0.1, 0.45, dot(normalize(vWNrm), F));
  return k * R.y;
}`)
      .replace('#include <opaque_fragment>', `
float ppK = 0.0;
for (int i = 0; i < ${MAX}; i++) { if (i < uN) ppK = max(ppK, ppHot(uA[i], uB[i], uR[i], uF[i])); }
float ppH = ppHot(uHA, uHB, uHR, uHF);
vec3 ppRed = vec3(1.0, 0.12, 0.07);
float ppPulse = 0.75 + 0.25 * sin(uTime * 3.2);
outgoingLight = mix(outgoingLight, outgoingLight * vec3(1.0, 0.42, 0.38) + ppRed * 0.25, ppK * 0.8);
outgoingLight += ppRed * ppK * 0.42 * ppPulse;
outgoingLight += vec3(1.0, 0.75, 0.7) * ppH * 0.22;
#include <opaque_fragment>`)
  }
  mat.needsUpdate = true
}

class PainPicker {
  constructor() {
    injectStyle()
    this.host = document.createElement('div')
    this.host.className = 'pp-stage'
    this.msg = document.createElement('div')
    this.msg.className = 'pp-msg'
    this.hint = document.createElement('div')
    this.hint.className = 'pp-hint'
    this.hint.textContent = 'Toque para marcar · arraste para girar'
    this.tip = document.createElement('div')
    this.tip.className = 'pp-tip'
    this.host.append(this.msg, this.hint, this.tip)

    this.selected = []          // ids de região, na ordem em que foram marcadas
    this.modelKey = null
    this.ready = false
    this.failed = false
    this.onChange = null
    this.onFail = null
    this._clock = new THREE.Clock()
    this._loads = {}

    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch (err) {
      this._fail(err)
      return
    }
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.0
    this.host.prepend(this.renderer.domElement)

    this.scene = new THREE.Scene()
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
    this.scene.add(new THREE.HemisphereLight(0xfff4ee, 0x2a1a20, 0.75))
    const key = new THREE.DirectionalLight(0xfff4ea, 1.8); key.position.set(1.6, 3, 3.2); this.scene.add(key)
    const back = new THREE.DirectionalLight(0xffe2dc, 1.1); back.position.set(-1.8, 2.4, -3); this.scene.add(back)
    const rim = new THREE.DirectionalLight(0xffd0c8, 0.7); rim.position.set(2.6, 1.2, -2.6); this.scene.add(rim)

    this.camera = new THREE.PerspectiveCamera(30, 0.7, 0.05, 30)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enablePan = false
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.09
    this.controls.rotateSpeed = 0.8
    this.controls.minPolarAngle = 0.35
    this.controls.maxPolarAngle = 2.3
    this.controls.addEventListener('start', () => { this._tween = null })

    this._bindPointer()
    this._ro = new ResizeObserver(() => this._resize())
    this._ro.observe(this.host)
    this._animate()
  }

  // ── Corpo ────────────────────────────────────────────────────────────────
  setModel(key) {
    key = BODIES[key] ? key : 'female'
    if (this.failed || key === this.modelKey) return
    this.modelKey = key
    this.body = BODIES[key]
    this.ready = false
    if (this._root) { this.scene.remove(this._root); this._root = null }
    this.msg.textContent = 'Carregando corpo 3D…'
    this.msg.style.display = ''
    const load = this._loads[key] || (this._loads[key] = Promise.all([
      new Promise((res, rej) => new GLTFLoader().load(BODIES[key].glb, res, undefined, rej)),
      fetch(BODIES[key].joints).then(r => { if (!r.ok) throw new Error('joints'); return r.json() })
    ]))
    load.then(([gltf, joints]) => {
      if (this.modelKey !== key) return
      this._setup(gltf, joints)
    }).catch(err => this._fail(err))
  }

  _setup(gltf, joints) {
    this._joints = joints
    this._bodyMesh = null
    gltf.scene.traverse(o => {
      if (!o.isMesh) return
      if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals()
      const m = o.material
      if (o.name === 'body') {
        if (!o.userData.ppU) {
          m.roughness = 0.6
          m.envMapIntensity = 0.45
          o.userData.ppU = {
            uTime: { value: 0 }, uN: { value: 0 },
            uA: { value: Array.from({ length: MAX }, () => V()) },
            uB: { value: Array.from({ length: MAX }, () => V()) },
            uF: { value: Array.from({ length: MAX }, () => V()) },
            uR: { value: Array.from({ length: MAX }, () => new THREE.Vector4()) },
            uHA: { value: V() }, uHB: { value: V() }, uHF: { value: V() }, uHR: { value: new THREE.Vector4() }
          }
          setupSkin(m, o.userData.ppU)
        }
        this._U = o.userData.ppU
        this._bodyMesh = o
      } else {
        if (o.name === 'hair') m.side = THREE.DoubleSide
        if (['eyebrows', 'eyelashes', 'hair'].includes(o.name)) o.renderOrder = 2
      }
    })
    if (!this._bodyMesh) { this._fail(new Error('malha do corpo não encontrada')); return }
    this._root = gltf.scene
    this.scene.add(gltf.scene)
    gltf.scene.updateMatrixWorld(true)

    const h = this.body.height
    this.center = V(0, h * 0.5, 0)
    this.controls.target.copy(this.center)
    this.controls.minDistance = 1.1
    this.controls.maxDistance = 4.2
    this._frame(this._side || 'front', false)
    this.msg.style.display = 'none'
    this.ready = true
    this._applySelection()
  }

  _fail(err) {
    console.error('[PainPicker]', err)
    this.failed = true
    this.msg.textContent = 'Não foi possível carregar o corpo 3D.'
    this.onFail?.()
  }

  // ── Câmera ───────────────────────────────────────────────────────────────
  // Distância para o corpo inteiro caber na tela (altura ou largura)
  _fitDist() {
    const h = this.body.height * 1.1
    const vf = THREE.MathUtils.degToRad(this.camera.fov) / 2
    const byH = (h / 2) / Math.tan(vf)
    const byW = (0.95 / 2) / (Math.tan(vf) * Math.max(this.camera.aspect, 0.1))
    return Math.max(byH, byW)
  }
  _frame(side, animate = true) {
    this._side = side
    if (!this.center) return
    const dir = side === 'back' ? V(0, 0.06, -1) : V(0, 0.06, 1)
    const to = this.center.clone().addScaledVector(dir.normalize(), this._fitDist())
    if (!animate) { this.camera.position.copy(to); this.controls.target.copy(this.center); this.controls.update(); return }
    this._tween = { from: this.camera.position.clone(), to, t: 0 }
  }
  setView(side) { this._frame(side) }

  _resize() {
    const W = this.host.clientWidth, H = this.host.clientHeight
    if (!W || !H || !this.renderer) return
    this.renderer.setSize(W, H)
    this.camera.aspect = W / H
    this.camera.updateProjectionMatrix()
    if (this.ready && !this._tween) this._frame(this._side || 'front', false)
  }

  _animate() {
    requestAnimationFrame(() => this._animate())
    const dt = Math.min(this._clock.getDelta(), 0.05)
    if (!this.host.isConnected || !this.renderer) return   // pergunta fora da tela: não desenha
    if (this._tween) {
      const tw = this._tween
      tw.t = Math.min(1, tw.t + dt * 1.6)
      const e = 1 - Math.pow(1 - tw.t, 3)
      // passa pelo lado (gira em volta do corpo, não atravessa)
      const a = Math.atan2(tw.from.x - this.center.x, tw.from.z - this.center.z)
      let b = Math.atan2(tw.to.x - this.center.x, tw.to.z - this.center.z)
      if (b - a > Math.PI) b -= 2 * Math.PI
      if (a - b > Math.PI) b += 2 * Math.PI
      const ang = a + (b - a) * e
      const r0 = Math.hypot(tw.from.x - this.center.x, tw.from.z - this.center.z)
      const r1 = Math.hypot(tw.to.x - this.center.x, tw.to.z - this.center.z)
      const r = r0 + (r1 - r0) * e
      const y = tw.from.y + (tw.to.y - tw.from.y) * e
      this.camera.position.set(this.center.x + Math.sin(ang) * r, y, this.center.z + Math.cos(ang) * r)
      this.controls.target.copy(this.center)
      if (tw.t >= 1) this._tween = null
    }
    this.controls.update()
    if (this._U) this._U.uTime.value += dt
    this.renderer.render(this.scene, this.camera)
  }

  // ── Regiões ──────────────────────────────────────────────────────────────
  _J(name) {
    const j = this._joints?.[name]
    if (!j) throw new Error('junta ausente: ' + name)
    return V(j[0], j[1], j[2])
  }
  _ref(ref) {
    if (typeof ref === 'string') return this._J(ref)
    return this._J(ref[0]).lerp(this._J(ref[1]), ref[2])
  }
  _cap(r) {
    return { a: this._ref(r.cap.a), b: this._ref(r.cap.b), r: r.cap.r * (this.body.height / 1.78) }
  }

  _pick(cx, cy) {
    if (!this._bodyMesh) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    const nd = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1)
    const rc = new THREE.Raycaster()
    rc.setFromCamera(nd, this.camera)
    const hit = rc.intersectObject(this._bodyMesh, false)[0]
    if (!hit) return null
    const n = hit.face.normal.clone().transformDirection(this._bodyMesh.matrixWorld)
    let best = null, bs = Infinity
    PHYSIO_REGIONS.forEach(r => {
      let c
      try { c = this._cap(r) } catch (_) { return }
      if (r.facing && n.dot(V(...r.facing)) < -0.05) return
      const ab = c.b.clone().sub(c.a)
      const t = THREE.MathUtils.clamp(hit.point.clone().sub(c.a).dot(ab) / Math.max(ab.lengthSq(), 1e-8), 0, 1)
      const d = hit.point.distanceTo(c.a.clone().addScaledVector(ab, t)) / c.r
      if (d < bs) { bs = d; best = r.id }
    })
    return bs < 1.5 ? best : null
  }

  _bindPointer() {
    const el = this.renderer.domElement
    let down = null
    el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() } })
    el.addEventListener('pointerup', e => {
      if (!down) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      const quick = performance.now() - down.t < 600
      down = null
      if (moved > 8 || !quick || !this.ready) return
      const id = this._pick(e.clientX, e.clientY)
      if (!id) return
      const on = !this.selected.includes(id)
      this.selected = on ? [...this.selected, id].slice(-MAX) : this.selected.filter(x => x !== id)
      this._flash(id, on)
      this._applySelection()
      this.onChange?.(this.getLabels())
    })
  }

  // Confirmação rápida do que foi tocado (e acende de leve a região)
  _flash(id, on) {
    const r = findRegion(id)
    this.tip.textContent = on ? `✓ ${r.label}` : `✕ ${r.label}`
    this.tip.classList.add('on')
    clearTimeout(this._tipT)
    this._tipT = setTimeout(() => this.tip.classList.remove('on'), 1300)
    if (this._U) {
      const c = this._cap(r)
      this._U.uHA.value.copy(c.a); this._U.uHB.value.copy(c.b)
      this._U.uHR.value.set(c.r, on ? 0 : 1, r.facing ? 1 : 0, 0)
      if (r.facing) this._U.uHF.value.set(...r.facing)
      clearTimeout(this._hovT)
      this._hovT = setTimeout(() => { if (this._U) this._U.uHR.value.y = 0 }, 500)
    }
  }

  _applySelection() {
    if (!this._U || !this.ready) return
    const U = this._U
    let n = 0
    this.selected.forEach(id => {
      const r = findRegion(id)
      if (!r || n >= MAX) return
      let c
      try { c = this._cap(r) } catch (_) { return }
      U.uA.value[n].copy(c.a)
      U.uB.value[n].copy(c.b)
      U.uR.value[n].set(c.r, 1, r.facing ? 1 : 0, 0)
      if (r.facing) U.uF.value[n].set(...r.facing)
      n++
    })
    U.uN.value = n
  }

  // Rótulos ↔ ids (as respostas guardam o nome da região)
  setLabels(labels) {
    this.selected = [...new Set((labels || []).map(l => regionByLabel(l)?.id).filter(Boolean))]
    this._applySelection()
  }
  getLabels() {
    return this.selected.map(id => findRegion(id)?.label).filter(Boolean)
  }
}

// ── Montagem na pergunta ─────────────────────────────────────────────────────
let picker = null

function getPicker() {
  if (!picker) picker = new PainPicker()
  return picker
}

// Começa a baixar o corpo antes de o paciente chegar na pergunta
function preload(sex) {
  const p = getPicker()
  if (!p.failed && !p.modelKey) p.setModel(sex === 'M' ? 'male' : 'female')
  return p
}

// Rótulos antigos (mapa desenhado) que existem com outro nome no corpo 3D
const OLD = { 'perna direita': 'Panturrilha Direita', 'perna esquerda': 'Panturrilha Esquerda' }
const normLabel = l => OLD[String(l).toLowerCase()] || l

/**
 * area      elemento onde a pergunta é montada
 * selected  rótulos já marcados (ex.: ao voltar para a pergunta)
 * sex       'F' | 'M' | null — corpo inicial (dá para trocar na hora)
 * big       true no totem (botões e textos maiores)
 * onChange  (labels[]) => void
 * onFail    () => void — sem WebGL / erro ao carregar: a página usa o mapa antigo
 */
function mount(area, { selected = [], sex = null, big = false, onChange, onFail } = {}) {
  const p = getPicker()
  if (p.failed) { onFail?.(); return null }

  const wrap = document.createElement('div')
  wrap.className = 'pp-wrap' + (big ? ' pp-big' : '')
  wrap.innerHTML = `
    <div class="pp-bar">
      <button type="button" class="pp-btn" data-v="front">Frente</button>
      <button type="button" class="pp-btn" data-v="back">Costas</button>
      <button type="button" class="pp-btn sx" data-m="female" title="Corpo feminino">♀</button>
      <button type="button" class="pp-btn sx" data-m="male" title="Corpo masculino">♂</button>
    </div>
    <div class="pp-slot"></div>
    <div class="pp-chips"></div>`
  wrap.querySelector('.pp-slot').replaceWith(p.host)
  area.appendChild(wrap)

  const chips = wrap.querySelector('.pp-chips')
  const sync = () => {
    const labels = p.getLabels()
    chips.innerHTML = labels.length
      ? labels.map(l => `<button type="button" class="pp-chip" data-l="${l}">${l} ✕</button>`).join('')
      : '<span class="pp-none">Toque nas regiões onde sente dor (opcional)</span>'
    wrap.querySelectorAll('[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === (p._side || 'front')))
    wrap.querySelectorAll('[data-m]').forEach(b => b.classList.toggle('on', b.dataset.m === p.modelKey))
  }

  wrap.querySelectorAll('[data-v]').forEach(b => { b.onclick = () => { p.setView(b.dataset.v); sync() } })
  wrap.querySelectorAll('[data-m]').forEach(b => { b.onclick = () => { p.setModel(b.dataset.m); sync() } })
  chips.onclick = e => {
    const l = e.target.closest('.pp-chip')?.dataset.l
    if (!l) return
    p.setLabels(p.getLabels().filter(x => x !== l))
    sync()
    onChange?.(p.getLabels())
  }

  p.onChange = labels => { sync(); onChange?.(labels) }
  p.onFail = onFail
  if (!p.modelKey) p.setModel(sex === 'M' ? 'male' : 'female')
  p.setLabels(selected.map(normLabel))
  sync()

  return {
    clear() { p.setLabels([]); sync(); onChange?.([]) },
    labels: () => p.getLabels()
  }
}

// Novo paciente no totem: volta à frente e ao corpo do cadastro
function reset(sex) {
  const p = getPicker()
  if (p.failed) return
  p.setLabels([])
  if (sex) p.setModel(sex === 'M' ? 'male' : 'female')
  p._frame('front', false)
}

export { mount, preload, reset }
