import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader }    from 'three/addons/loaders/GLTFLoader.js'
import { ACU_MERIDIANS } from '/js/acupuncture-viewer.js'

export { ACU_MERIDIANS }

// Lista plana de todos os pontos (um lado apenas — bilateral é espelhado automaticamente)
export const ALL_POINTS = ACU_MERIDIANS.flatMap(m =>
  m.points.map(p => ({
    ...p,
    meridianId:   m.id,
    meridianName: m.name,
    color:        m.color,
    bilateral:    m.bilateral,
  }))
)

export class CalibrateViewer {
  constructor(container, { onCalibrate, onReady } = {}) {
    this.container   = container
    this.onCalibrate = onCalibrate  // (point, coords, totalDone) => void
    this.onReady     = onReady      // () => void

    this.bodyMeshes   = []
    this.pointMeshes  = []   // THREE.Mesh[], userData.index
    this.calibrated   = {}   // pointId -> {x, y, z}
    this.currentIndex = 0
    this._filter      = null // meridianId ativo ou null = todos
    this._meridianLines = {} // meridianId -> THREE.Line[]

    this._disposed  = false
    this._animId    = null
    this._pulseTime = 0

    this._init()
  }

  // ── Setup ────────────────────────────────────────────────────────────────────

  _init() {
    const W = this.container.clientWidth  || 800
    const H = this.container.clientHeight || 600

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x0a0a14)
    this.scene.fog = new THREE.FogExp2(0x0a0a14, 0.10)

    this.camera = new THREE.PerspectiveCamera(40, W / H, 0.01, 50)
    this.camera.position.set(0, 0.92, 3.4)
    this.camera.lookAt(0, 0.88, 0)

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setSize(W, H)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.toneMapping        = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.15
    this.container.appendChild(this.renderer.domElement)

    this._setupLighting()
    this._loadBody()

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.set(0, 0.88, 0)
    this.controls.minDistance   = 0.4
    this.controls.maxDistance   = 9.0
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08

    this._raycaster = new THREE.Raycaster()
    this._mouse     = new THREE.Vector2()
    this.renderer.domElement.addEventListener('click', this._onClick.bind(this))
    window.addEventListener('resize', () => this._onResize())

    this._animate()
  }

  _setupLighting() {
    this.scene.add(new THREE.HemisphereLight(0xffe4c8, 0x7a4010, 0.55))

    const key = new THREE.DirectionalLight(0xfff5e8, 1.10)
    key.position.set(1.8, 3.2, 3.8)
    this.scene.add(key)

    const fill = new THREE.DirectionalLight(0xb8d0ff, 0.38)
    fill.position.set(-2.6, 1.4, 2.4)
    this.scene.add(fill)

    const rim1 = new THREE.DirectionalLight(0xffd0a0, 0.65)
    rim1.position.set(0, 2.0, -4.0)
    this.scene.add(rim1)

    const rim2 = new THREE.DirectionalLight(0xff8050, 0.28)
    rim2.position.set(-1.5, 1.0, -3.5)
    this.scene.add(rim2)
  }

  // ── Carrega modelo ───────────────────────────────────────────────────────────

  async _loadBody() {
    try {
      const loader = new GLTFLoader()
      const gltf   = await new Promise((res, rej) =>
        loader.load('/models/human-body.glb', res, undefined, rej)
      )

      const model  = gltf.scene
      const box    = new THREE.Box3().setFromObject(model)
      const size   = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      const scale  = 1.76 / size.y

      model.scale.setScalar(scale)
      model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale)

      const skinMat = new THREE.MeshPhysicalMaterial({
        color:          0xf0c090,
        roughness:      0.75,
        metalness:      0,
        sheen:          0.25,
        sheenRoughness: 0.80,
        sheenColor:     new THREE.Color(0xff8866),
      })

      model.traverse(child => {
        if (child.isMesh) {
          child.material = skinMat
          child.geometry.computeVertexNormals()
          this.bodyMeshes.push(child)
        }
      })

      this.scene.add(model)
      model.updateMatrixWorld(true)

      this._createPointSpheres()
      this._createAllMeridianLines()
      this.onReady?.()
    } catch (e) {
      console.error('[CalibrateViewer] Erro ao carregar GLB:', e)
    }
  }

  // ── Esferas dos pontos ───────────────────────────────────────────────────────

  _createPointSpheres() {
    const geo = new THREE.SphereGeometry(0.013, 10, 8)

    ALL_POINTS.forEach((pt, i) => {
      const mat  = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.1 })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(pt.x, pt.y, pt.z)
      mesh.userData = { pointId: pt.id, index: i }
      this.scene.add(mesh)
      this.pointMeshes.push(mesh)
    })

    this._refreshColors()
  }

  _refreshColors() {
    this.pointMeshes.forEach((mesh, i) => {
      const pt        = ALL_POINTS[i]
      const isCurrent = i === this.currentIndex
      const isDone    = !!this.calibrated[pt.id]
      const inFilter  = !this._filter || pt.meridianId === this._filter

      mesh.visible = inFilter

      if (!inFilter) return

      if (isCurrent) {
        mesh.material.color.set(0xffdd00)
        mesh.material.emissive           = new THREE.Color(0xffaa00)
        mesh.material.emissiveIntensity   = 1.0
      } else if (isDone) {
        mesh.material.color.set(0x44ff88)
        mesh.material.emissive           = new THREE.Color(0x00cc55)
        mesh.material.emissiveIntensity   = 0.5
        mesh.scale.setScalar(1.0)
      } else {
        mesh.material.color.set(0x3366aa)
        mesh.material.emissive           = new THREE.Color(0x112244)
        mesh.material.emissiveIntensity   = 0.2
        mesh.scale.setScalar(0.75)
      }
    })

    // Visibilidade e opacidade das linhas
    ACU_MERIDIANS.forEach(m => {
      const lines   = this._meridianLines[m.id] || []
      const visible = !this._filter || m.id === this._filter
      lines.forEach(l => {
        l.visible = visible
        if (l.material) l.material.opacity = this._filter ? 0.80 : 0.40
      })
    })
  }

  // ── Linhas dos meridianos ────────────────────────────────────────────────────

  _createAllMeridianLines() {
    ACU_MERIDIANS.forEach(m => this._rebuildMeridianLine(m))
  }

  _rebuildMeridianLine(meridian) {
    // Remove linhas antigas deste meridiano
    const old = this._meridianLines[meridian.id] || []
    old.forEach(l => { this.scene.remove(l); l.geometry.dispose(); l.material.dispose() })
    this._meridianLines[meridian.id] = []

    const color   = new THREE.Color(meridian.color)
    const visible = !this._filter || this._filter === meridian.id
    const opacity = this._filter ? 0.80 : 0.40

    const buildLine = (positions) => {
      if (positions.length < 2) return
      const geo  = new THREE.BufferGeometry().setFromPoints(positions)
      const mat  = new THREE.LineBasicMaterial({ color, transparent: true, opacity })
      const line = new THREE.Line(geo, mat)
      line.visible = visible
      this.scene.add(line)
      this._meridianLines[meridian.id].push(line)
    }

    // Pega posições atuais dos pontos (calibradas ou estimadas)
    const positions = meridian.points
      .map(p => {
        const idx = ALL_POINTS.findIndex(ap => ap.id === p.id)
        return idx >= 0 ? this.pointMeshes[idx].position.clone() : null
      })
      .filter(Boolean)

    buildLine(positions)

    // Lado espelhado (bilateral)
    if (meridian.bilateral) {
      const mirrored = positions.map(v => new THREE.Vector3(-v.x, v.y, v.z))
      buildLine(mirrored)
    }
  }

  // Reconstrói linha do meridiano que contém o ponto com este id
  _rebuildLineForPoint(pointId) {
    const pt = ALL_POINTS.find(p => p.id === pointId)
    if (!pt) return
    const meridian = ACU_MERIDIANS.find(m => m.id === pt.meridianId)
    if (meridian) this._rebuildMeridianLine(meridian)
  }

  // ── Filtro por meridiano ─────────────────────────────────────────────────────

  setMeridianFilter(meridianId) {
    this._filter = meridianId || null

    // Navega para o primeiro ponto não calibrado no filtro
    const indices = this._filteredIndices()
    const first   = indices.find(i => !this.calibrated[ALL_POINTS[i].id])
    this.currentIndex = first !== undefined ? first
      : indices.length > 0 ? indices[0]
      : this.currentIndex

    this._refreshColors()
    return { filteredCount: indices.length, filteredDone: indices.filter(i => !!this.calibrated[ALL_POINTS[i].id]).length }
  }

  _filteredIndices() {
    if (!this._filter) return ALL_POINTS.map((_, i) => i)
    return ALL_POINTS.flatMap((pt, i) => pt.meridianId === this._filter ? [i] : [])
  }

  getFilter() { return this._filter }

  // ── Click — captura ponto na superfície ──────────────────────────────────────

  _onClick(event) {
    if (!this.bodyMeshes.length) return

    const rect    = this.renderer.domElement.getBoundingClientRect()
    this._mouse.x =  ((event.clientX - rect.left) / rect.width)  * 2 - 1
    this._mouse.y = -((event.clientY - rect.top)  / rect.height) * 2 + 1

    this._raycaster.setFromCamera(this._mouse, this.camera)
    const hits = this._raycaster.intersectObjects(this.bodyMeshes, false)
    if (!hits.length) return

    const hit    = hits[0]
    const normal = hit.face.normal.clone()
      .transformDirection(hit.object.matrixWorld)
      .normalize()
    const pos = hit.point.clone().addScaledVector(normal, 0.012)

    const pt     = ALL_POINTS[this.currentIndex]
    const coords = { x: +pos.x.toFixed(4), y: +pos.y.toFixed(4), z: +pos.z.toFixed(4) }
    this.calibrated[pt.id] = coords

    // Move esfera para posição real e reconstrói linha do meridiano
    this.pointMeshes[this.currentIndex].position.copy(pos)
    this._rebuildLineForPoint(pt.id)

    const done = Object.keys(this.calibrated).length
    this.onCalibrate?.(pt, coords, done)

    this._advanceToNext()
  }

  // ── Navegação ────────────────────────────────────────────────────────────────

  _advanceToNext() {
    const indices = this._filteredIndices()
    const pos     = indices.indexOf(this.currentIndex)
    // Procura próximo não calibrado após o atual
    for (let i = pos + 1; i < indices.length; i++) {
      if (!this.calibrated[ALL_POINTS[indices[i]].id]) {
        this.currentIndex = indices[i]
        this._refreshColors()
        return
      }
    }
    // Se não encontrou, avança linearmente
    if (pos < indices.length - 1) this.currentIndex = indices[pos + 1]
    this._refreshColors()
  }

  goTo(index) {
    if (index >= 0 && index < ALL_POINTS.length) {
      this.currentIndex = index
      this._refreshColors()
    }
  }

  skip() {
    const indices = this._filteredIndices()
    const pos     = indices.indexOf(this.currentIndex)
    if (pos < indices.length - 1) {
      this.currentIndex = indices[pos + 1]
      this._refreshColors()
    }
  }

  back() {
    const indices = this._filteredIndices()
    const pos     = indices.indexOf(this.currentIndex)
    if (pos > 0) {
      this.currentIndex = indices[pos - 1]
      this._refreshColors()
    }
  }

  // ── Carrega progresso salvo ───────────────────────────────────────────────────

  loadSaved(data) {
    this.calibrated = { ...data }

    // Reposiciona esferas já calibradas e reconstrói todas as linhas
    this.pointMeshes.forEach((mesh, i) => {
      const c = this.calibrated[ALL_POINTS[i].id]
      if (c) mesh.position.set(c.x, c.y, c.z)
    })

    ACU_MERIDIANS.forEach(m => this._rebuildMeridianLine(m))

    // Salta para o primeiro ponto ainda não calibrado (no filtro ativo)
    const indices = this._filteredIndices()
    const first   = indices.find(i => !this.calibrated[ALL_POINTS[i].id])
    this.currentIndex = first !== undefined ? first
      : indices.length > 0 ? indices[0] : 0

    this._refreshColors()
  }

  // ── Exportação ───────────────────────────────────────────────────────────────

  getCalibrated()      { return { ...this.calibrated } }
  getCalibratedCount() { return Object.keys(this.calibrated).length }

  exportJSON() {
    return JSON.stringify(this.calibrated, null, 2)
  }

  // Progresso do filtro atual (ou global)
  getFilterProgress() {
    const indices = this._filteredIndices()
    const done    = indices.filter(i => !!this.calibrated[ALL_POINTS[i].id]).length
    return { done, total: indices.length }
  }

  // ── Render loop ──────────────────────────────────────────────────────────────

  _animate() {
    if (this._disposed) return
    this._animId = requestAnimationFrame(this._animate.bind(this))
    this._pulseTime += 0.05

    const mesh = this.pointMeshes[this.currentIndex]
    if (mesh && mesh.visible) {
      const s = 1.6 + Math.sin(this._pulseTime * 2.5) * 0.6
      mesh.scale.setScalar(s)
      mesh.material.emissiveIntensity = 0.8 + Math.sin(this._pulseTime * 2.5) * 0.45
    }

    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  _onResize() {
    const W = this.container.clientWidth
    const H = this.container.clientHeight
    if (!W || !H) return
    this.camera.aspect = W / H
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(W, H)
  }

  destroy() {
    this._disposed = true
    cancelAnimationFrame(this._animId)
    this.renderer.dispose()
  }
}
