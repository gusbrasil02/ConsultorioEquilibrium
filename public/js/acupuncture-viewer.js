import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader }    from 'three/addons/loaders/GLTFLoader.js'

// ── Dados dos 14 meridianos principais ──────────────────────────────────────
// Coordenadas são pontos de REFERÊNCIA usados como origem para o snap de
// superfície via raycasting — não precisam ser exatos, apenas do lado certo.
//
// Sistema normalizado: Y=0 pés | Y≈1.76 cabeça
//                      X neg = direita do paciente | Z pos = frente do corpo
// bilateral:true → espelha automaticamente (id + '-E')

const ACU_MERIDIANS = [
  {
    id:'LU', name:'Pulmão', color:'#5BA4E5', bilateral:true,
    // Braço ~45° do vertical: ombro (-0.22,1.38) → cada 0.10m ao longo do braço = Δx≈-0.071, Δy≈-0.071
    points:[
      {id:'LU1',  name:'Zhongfu',     pt:'Mansão Central',              x:-0.18, y:1.33, z:0.14},  // 1º espaço intercostal, tórax anterior
      {id:'LU2',  name:'Yunmen',      pt:'Portão da Nuvem',             x:-0.22, y:1.40, z:0.09},  // fossa infraclavicular
      {id:'LU3',  name:'Tianfu',      pt:'Palácio Celestial',           x:-0.31, y:1.29, z:0.06},  // face anterior do braço, 3 cun abaixo axila
      {id:'LU5',  name:'Chize',       pt:'Lago do Salgueiro',           x:-0.43, y:1.17, z:0.07},  // prega cubital, lateral
      {id:'LU7',  name:'Lieque',      pt:'Brecha da Sequência',         x:-0.57, y:1.03, z:0.07},  // 1,5 cun acima prega do punho, radial
      {id:'LU9',  name:'Taiyuan',     pt:'Grande Abismo',               x:-0.62, y:0.98, z:0.08},  // prega do punho, artéria radial
      {id:'LU11', name:'Shaoshang',   pt:'Menor Mercador',              x:-0.71, y:0.89, z:0.07},  // ponta do polegar, canto ungueal radial
    ]
  },
  {
    id:'LI', name:'Intestino Grosso', color:'#D4C4A0', bilateral:true,
    points:[
      {id:'LI1',  name:'Shangyang',   pt:'Yang Mercantil',              x:-0.47, y:0.63, z:0.04},
      {id:'LI4',  name:'Hegu',        pt:'Vale Unido',                  x:-0.45, y:0.69, z:0.02},
      {id:'LI10', name:'Shousanli',   pt:'Três Milhas do Braço',        x:-0.39, y:1.03, z:0.01},
      {id:'LI11', name:'Quchi',       pt:'Lagoa Tortuosa',              x:-0.37, y:1.09, z:0.01},
      {id:'LI15', name:'Jianyu',      pt:'Osso do Ombro',               x:-0.27, y:1.39, z:0.01},
      {id:'LI18', name:'Futu',        pt:'Apoio de Réptil',             x:-0.09, y:1.48, z:0.09},
      {id:'LI20', name:'Yingxiang',   pt:'Acolher Fragrância',          x:-0.02, y:1.57, z:0.13},
    ]
  },
  {
    id:'ST', name:'Estômago', color:'#F0C040', bilateral:true,
    points:[
      {id:'ST1',  name:'Chengqi',     pt:'Receber Lágrimas',            x:-0.04, y:1.63, z:0.13},
      {id:'ST4',  name:'Dicang',      pt:'Celeiro Terrestre',           x:-0.06, y:1.54, z:0.13},
      {id:'ST7',  name:'Xiaguan',     pt:'Articulação Inferior',        x:-0.12, y:1.61, z:0.07},
      {id:'ST8',  name:'Touwei',      pt:'Cabeça Amarrada',             x:-0.14, y:1.70, z:0.06},
      {id:'ST12', name:'Quepen',      pt:'Barragem Vazia',              x:-0.10, y:1.40, z:0.11},
      {id:'ST18', name:'Rugen',       pt:'Raiz do Mamilo',              x:-0.14, y:1.22, z:0.14},
      {id:'ST25', name:'Tianshu',     pt:'Pivô Celestial',              x:-0.12, y:1.02, z:0.14},
      {id:'ST30', name:'Qichong',     pt:'Impulso do Qi',               x:-0.08, y:0.88, z:0.11},
      {id:'ST35', name:'Dubi',        pt:'Focinho do Boi',              x:-0.14, y:0.40, z:0.10},
      {id:'ST36', name:'Zusanli',     pt:'Três Milhas do Pé',           x:-0.13, y:0.34, z:0.09},
      {id:'ST40', name:'Fenglong',    pt:'Luxuriante',                  x:-0.14, y:0.22, z:0.09},
      {id:'ST41', name:'Jiexi',       pt:'Ribeira da Junta',            x:-0.11, y:0.10, z:0.10},
      {id:'ST44', name:'Neiting',     pt:'Portal Interior',             x:-0.10, y:0.02, z:0.12},
    ]
  },
  {
    id:'SP', name:'Baço-Pâncreas', color:'#E8B040', bilateral:true,
    points:[
      {id:'SP1',  name:'Yinbai',      pt:'Branco Oculto',               x:-0.09, y:0.02, z:0.10},
      {id:'SP4',  name:'Gongsun',     pt:'Neto do Duque',               x:-0.09, y:0.05, z:0.09},
      {id:'SP6',  name:'Sanyinjiao',  pt:'Reunião dos Três Yin',        x:-0.10, y:0.14, z:0.04},
      {id:'SP9',  name:'Yinlingquan', pt:'Fonte do Monte Yin',          x:-0.10, y:0.38, z:0.04},
      {id:'SP10', name:'Xuehai',      pt:'Mar do Sangue',               x:-0.11, y:0.48, z:0.05},
      {id:'SP15', name:'Daheng',      pt:'Grande Horizontal',           x:-0.14, y:1.02, z:0.12},
      {id:'SP21', name:'Dabao',       pt:'Grande Envoltório',           x:-0.18, y:1.18, z:0.09},
    ]
  },
  {
    id:'HT', name:'Coração', color:'#E04040', bilateral:true,
    points:[
      {id:'HT1',  name:'Jiquan',      pt:'Fonte do Cume',               x:-0.22, y:1.36, z:0.04},
      {id:'HT3',  name:'Shaohai',     pt:'Pequeno Mar',                 x:-0.37, y:1.09, z:0.04},
      {id:'HT5',  name:'Tongli',      pt:'Comunicação Interior',        x:-0.42, y:0.87, z:0.02},
      {id:'HT7',  name:'Shenmen',     pt:'Portão do Espírito',          x:-0.44, y:0.79, z:0.02},
      {id:'HT9',  name:'Shaochong',   pt:'Menor Impulso',               x:-0.47, y:0.63, z:0.01},
    ]
  },
  {
    id:'SI', name:'Intestino Delgado', color:'#D08080', bilateral:true,
    points:[
      {id:'SI1',  name:'Shaoze',      pt:'Pequeno Pântano',             x:-0.47, y:0.63, z:-0.01},
      {id:'SI3',  name:'Houxi',       pt:'Posterior do Riacho',         x:-0.46, y:0.66, z:-0.02},
      {id:'SI8',  name:'Xiaohai',     pt:'Pequeno Mar',                 x:-0.37, y:1.09, z:-0.01},
      {id:'SI9',  name:'Jianzhen',    pt:'Verdade do Ombro',            x:-0.24, y:1.26, z:-0.05},
      {id:'SI11', name:'Tianzong',    pt:'Ancestral Celestial',         x:-0.16, y:1.22, z:-0.12},
      {id:'SI19', name:'Tinggong',    pt:'Palácio da Audição',          x:-0.12, y:1.60, z:0.08},
    ]
  },
  {
    id:'BL', name:'Bexiga', color:'#4080D0', bilateral:true,
    points:[
      {id:'BL1',  name:'Jingming',    pt:'Brilho dos Olhos',            x:-0.03, y:1.64, z:0.12},
      {id:'BL10', name:'Tianzhu',     pt:'Pilar Celestial',             x:-0.04, y:1.55, z:-0.08},
      {id:'BL13', name:'Feishu',      pt:'Shu do Pulmão',               x:-0.05, y:1.29, z:-0.12},
      {id:'BL15', name:'Xinshu',      pt:'Shu do Coração',              x:-0.05, y:1.23, z:-0.12},
      {id:'BL17', name:'Geshu',       pt:'Shu do Diafragma',            x:-0.05, y:1.17, z:-0.12},
      {id:'BL18', name:'Ganshu',      pt:'Shu do Fígado',               x:-0.05, y:1.14, z:-0.12},
      {id:'BL20', name:'Pishu',       pt:'Shu do Baço',                 x:-0.05, y:1.08, z:-0.12},
      {id:'BL21', name:'Weishu',      pt:'Shu do Estômago',             x:-0.05, y:1.05, z:-0.12},
      {id:'BL23', name:'Shenshu',     pt:'Shu do Rim',                  x:-0.05, y:0.97, z:-0.12},
      {id:'BL25', name:'Dachangshu',  pt:'Shu do I. Grosso',            x:-0.05, y:0.91, z:-0.12},
      {id:'BL40', name:'Weizhong',    pt:'Centro do Apoio',             x:-0.12, y:0.41, z:-0.05},
      {id:'BL57', name:'Chengshan',   pt:'Apoio da Montanha',           x:-0.12, y:0.21, z:-0.05},
      {id:'BL60', name:'Kunlun',      pt:'Montanha Kunlun',             x:-0.13, y:0.10, z:-0.04},
      {id:'BL67', name:'Zhiyin',      pt:'Extremo do Yin',              x:-0.15, y:0.02, z:0.02},
    ]
  },
  {
    id:'KI', name:'Rim', color:'#3060A0', bilateral:true,
    points:[
      {id:'KI1',  name:'Yongquan',    pt:'Fonte Borbulhante',           x:-0.09, y:0.02, z:0.06},
      {id:'KI3',  name:'Taixi',       pt:'Grande Riacho',               x:-0.10, y:0.09, z:-0.03},
      {id:'KI6',  name:'Zhaohai',     pt:'Mar Brilhante',               x:-0.09, y:0.06, z:0.03},
      {id:'KI7',  name:'Fuliu',       pt:'Retorno do Fluxo',            x:-0.09, y:0.15, z:-0.03},
      {id:'KI10', name:'Yingu',       pt:'Vale do Yin',                 x:-0.11, y:0.41, z:0.02},
      {id:'KI27', name:'Shufu',       pt:'Mansão do Contorno',          x:-0.06, y:1.39, z:0.12},
    ]
  },
  {
    id:'PC', name:'Pericárdio', color:'#C04030', bilateral:true,
    points:[
      {id:'PC1',  name:'Tianchi',     pt:'Lago Celestial',              x:-0.16, y:1.30, z:0.14},
      {id:'PC3',  name:'Quze',        pt:'Curva do Pântano',            x:-0.37, y:1.09, z:0.06},
      {id:'PC6',  name:'Neiguan',     pt:'Barreira Interior',           x:-0.43, y:0.83, z:0.05},
      {id:'PC7',  name:'Daling',      pt:'Grande Monte',                x:-0.44, y:0.79, z:0.04},
      {id:'PC9',  name:'Zhongchong',  pt:'Impulso Central',             x:-0.47, y:0.63, z:0.04},
    ]
  },
  {
    id:'TE', name:'Triplo Aquecedor', color:'#F09040', bilateral:true,
    points:[
      {id:'TE1',  name:'Guanchong',   pt:'Impulso do Portão',           x:-0.47, y:0.63, z:0.00},
      {id:'TE5',  name:'Waiguan',     pt:'Barreira Exterior',           x:-0.43, y:0.83, z:-0.01},
      {id:'TE10', name:'Tianjing',    pt:'Poço Celestial',              x:-0.37, y:1.09, z:-0.02},
      {id:'TE14', name:'Jianliao',    pt:'Fenda do Ombro',              x:-0.26, y:1.39, z:-0.02},
      {id:'TE17', name:'Yifeng',      pt:'Proteção do Vento',           x:-0.13, y:1.58, z:0.04},
      {id:'TE23', name:'Sizhukong',   pt:'Bambu Seco',                  x:-0.12, y:1.66, z:0.10},
    ]
  },
  {
    id:'GB', name:'Vesícula Biliar', color:'#70B040', bilateral:true,
    points:[
      {id:'GB1',  name:'Tongziliao',  pt:'Sulco da Pupila',             x:-0.11, y:1.63, z:0.11},
      {id:'GB8',  name:'Shuaigu',     pt:'Vale da Liderança',           x:-0.16, y:1.71, z:0.04},
      {id:'GB14', name:'Yangbai',     pt:'Brancura do Yang',            x:-0.06, y:1.68, z:0.11},
      {id:'GB20', name:'Fengchi',     pt:'Lagoa do Vento',              x:-0.08, y:1.55, z:-0.07},
      {id:'GB21', name:'Jianjing',    pt:'Poço do Ombro',               x:-0.18, y:1.40, z:0.01},
      {id:'GB25', name:'Jingmen',     pt:'Portão das Capitais',         x:-0.18, y:0.94, z:0.07},
      {id:'GB30', name:'Huantiao',    pt:'Círculo que Salta',           x:-0.20, y:0.84, z:-0.04},
      {id:'GB34', name:'Yanglingquan',pt:'Fonte do Monte Yang',         x:-0.16, y:0.38, z:0.07},
      {id:'GB39', name:'Xuanzhong',   pt:'Sino Suspenso',               x:-0.14, y:0.17, z:0.02},
      {id:'GB40', name:'Qiuxu',       pt:'Lugar das Ruínas',            x:-0.14, y:0.10, z:0.05},
      {id:'GB44', name:'Zuqiaoyin',   pt:'Abertura do Yin do Pé',       x:-0.15, y:0.02, z:0.04},
    ]
  },
  {
    id:'LR', name:'Fígado', color:'#408040', bilateral:true,
    points:[
      {id:'LR1',  name:'Dadun',       pt:'Grande Sinceridade',          x:-0.09, y:0.02, z:0.12},
      {id:'LR2',  name:'Xingjian',    pt:'Intervalo de Caminhada',      x:-0.09, y:0.03, z:0.11},
      {id:'LR3',  name:'Taichong',    pt:'Grande Impulso',              x:-0.09, y:0.05, z:0.10},
      {id:'LR5',  name:'Ligou',       pt:'Ranhura do Mirtilo',          x:-0.09, y:0.18, z:0.04},
      {id:'LR8',  name:'Ququan',      pt:'Fonte do Joelho',             x:-0.11, y:0.40, z:0.03},
      {id:'LR13', name:'Zhangmen',    pt:'Portão do Capítulo',          x:-0.18, y:1.05, z:0.10},
      {id:'LR14', name:'Qimen',       pt:'Portão da Esperança',         x:-0.14, y:1.28, z:0.14},
    ]
  },
  {
    id:'CV', name:'Vaso Concepção', color:'#E0C050', bilateral:false,
    points:[
      {id:'CV1',  name:'Huiyin',      pt:'Reunião do Yin',              x:0, y:0.87, z:0.06},
      {id:'CV4',  name:'Guanyuan',    pt:'Portão Vital',                x:0, y:0.97, z:0.14},
      {id:'CV6',  name:'Qihai',       pt:'Mar do Qi',                   x:0, y:1.01, z:0.14},
      {id:'CV8',  name:'Shenque',     pt:'Palácio do Espírito (umbigo)',x:0, y:1.03, z:0.14},
      {id:'CV12', name:'Zhongwan',    pt:'Parte Central do Estômago',   x:0, y:1.13, z:0.14},
      {id:'CV17', name:'Danzhong',    pt:'Centro do Peito',             x:0, y:1.30, z:0.15},
      {id:'CV22', name:'Tiantu',      pt:'Eminência Celestial',         x:0, y:1.44, z:0.12},
      {id:'CV24', name:'Chengjiang',  pt:'Receber Fluido',              x:0, y:1.52, z:0.13},
    ]
  },
  {
    id:'GV', name:'Vaso Governador', color:'#C09020', bilateral:false,
    points:[
      {id:'GV1',  name:'Changqiang',  pt:'Força Longa',                 x:0, y:0.84, z:-0.06},
      {id:'GV4',  name:'Mingmen',     pt:'Portão da Vida',              x:0, y:0.97, z:-0.12},
      {id:'GV9',  name:'Zhiyang',     pt:'Atingir Yang',                x:0, y:1.19, z:-0.13},
      {id:'GV14', name:'Dazhui',      pt:'Grande Vértebra',             x:0, y:1.38, z:-0.10},
      {id:'GV16', name:'Fengfu',      pt:'Palácio do Vento',            x:0, y:1.51, z:-0.07},
      {id:'GV20', name:'Baihui',      pt:'Cem Reuniões',                x:0, y:1.74, z:0.00},
      {id:'GV24', name:'Shenting',    pt:'Pátio do Espírito',           x:0, y:1.69, z:0.09},
      {id:'GV26', name:'Renzhong',    pt:'Philtrum',                    x:0, y:1.55, z:0.13},
    ]
  },
]

// ── Classe principal do visualizador ─────────────────────────────────────────

class AcupunctureViewer {
  constructor(container, options = {}) {
    this.container         = container
    this.isDoctor          = options.isDoctor  ?? false
    this.autoRotate        = options.autoRotate ?? false
    this.onSelectionChange = options.onSelectionChange ?? null
    this.selectedPoints    = new Set()
    this.pointMeshes       = []
    this._meridianGroups   = {}
    this._bodyMeshes       = []
    this._disposed         = false
    this._animId           = null
    this._init()
  }

  _init() {
    const W = this.container.clientWidth  || 600
    const H = this.container.clientHeight || 500

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x080810)
    this.scene.fog = new THREE.FogExp2(0x080810, 0.16)

    this.camera = new THREE.PerspectiveCamera(40, W / H, 0.01, 50)
    this.camera.position.set(0, 0.92, 3.4)
    this.camera.lookAt(0, 0.88, 0)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setSize(W, H)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.toneMapping         = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure  = 1.15
    this.renderer.useLegacyLights      = false
    this.container.appendChild(this.renderer.domElement)

    this._setupLighting()
    this._createSkinMaterial()
    this._loadBody()
    this._setupMeridians()

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.set(0, 0.88, 0)
    this.controls.minDistance      = 0.8
    this.controls.maxDistance      = 9.0
    this.controls.autoRotate       = this.autoRotate
    this.controls.autoRotateSpeed  = 0.55
    this.controls.enableDamping    = true
    this.controls.dampingFactor    = 0.08
    this.controls.update()

    if (this.isDoctor) {
      this._raycaster = new THREE.Raycaster()
      this._mouse = new THREE.Vector2()
      this.renderer.domElement.addEventListener('click', this._onClick.bind(this))
    }

    this._onResizeBound = this._onResize.bind(this)
    window.addEventListener('resize', this._onResizeBound)
    this._animate()
  }

  // ── Iluminação ───────────────────────────────────────────────────────────

  _setupLighting() {
    this.scene.add(new THREE.HemisphereLight(0xffe4c8, 0x7a4010, 0.55))

    const key = new THREE.DirectionalLight(0xfff5e8, 1.10)
    key.position.set(1.8, 3.2, 3.8)
    this.scene.add(key)

    const fill = new THREE.DirectionalLight(0xb8d0ff, 0.38)
    fill.position.set(-2.6, 1.4, 2.4)
    this.scene.add(fill)

    // Dois rim lights traseiros para costas bem iluminadas
    const rim1 = new THREE.DirectionalLight(0xffd0a0, 0.65)
    rim1.position.set(0, 2.0, -4.0)
    this.scene.add(rim1)

    const rim2 = new THREE.DirectionalLight(0xff8050, 0.30)
    rim2.position.set(-1.5, 1.0, -3.5)
    this.scene.add(rim2)

    const bot = new THREE.DirectionalLight(0x6a3010, 0.20)
    bot.position.set(0, -3.0, 1.0)
    this.scene.add(bot)
  }

  // ── Material de pele ─────────────────────────────────────────────────────

  _createSkinTexture() {
    const size = 512
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')

    ctx.fillStyle = '#c47a50'
    ctx.fillRect(0, 0, size, size)

    const grd = ctx.createRadialGradient(size*0.45, size*0.35, 0, size*0.5, size*0.5, size*0.78)
    grd.addColorStop(0,    'rgba(255,210,168,0.50)')
    grd.addColorStop(0.55, 'rgba(200,138, 95,0.18)')
    grd.addColorStop(1,    'rgba(130, 60, 22,0.35)')
    ctx.fillStyle = grd
    ctx.fillRect(0, 0, size, size)

    for (let i = 0; i < 9000; i++) {
      const x = Math.random() * size, y = Math.random() * size
      const r = Math.random() * 1.3 + 0.12
      const a = (Math.random() * 0.07 + 0.02).toFixed(3)
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = Math.random() > 0.5
        ? `rgba(255,${(160+Math.random()*65)|0},${(105+Math.random()*55)|0},${a})`
        : `rgba(${(85+Math.random()*55)|0},${(38+Math.random()*28)|0},${(12+Math.random()*18)|0},${a})`
      ctx.fill()
    }

    const tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(2, 3)
    return tex
  }

  _createSkinMaterial() {
    this.skinMat = new THREE.MeshPhysicalMaterial({
      map:                this._createSkinTexture(),
      color:              0xf8caa8,
      roughness:          0.72,
      metalness:          0.00,
      sheen:              0.30,
      sheenRoughness:     0.80,
      sheenColor:         new THREE.Color(0xff8866),
      clearcoat:          0.06,
      clearcoatRoughness: 0.70,
    })
  }

  // ── Carrega modelo GLB ────────────────────────────────────────────────────

  async _loadBody() {
    try {
      const loader = new GLTFLoader()
      const gltf   = await new Promise((resolve, reject) =>
        loader.load('/models/human-body.glb', resolve, undefined, reject)
      )

      const model = gltf.scene

      // Normaliza: pés Y=0, cabeça Y=1.76, centrado em X e Z
      const box    = new THREE.Box3().setFromObject(model)
      const size   = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      const scale  = 1.76 / size.y

      model.scale.setScalar(scale)
      model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale)

      model.traverse(child => {
        if (child.isMesh) {
          child.material = this.skinMat
          child.geometry.computeVertexNormals()
        }
      })

      this.bodyGroup = model
      this.scene.add(model)
      model.updateMatrixWorld(true)

      // Coleta malhas para raycasting
      model.traverse(c => { if (c.isMesh) this._bodyMeshes.push(c) })

      // Snap de pontos e reconstrução de linhas na superfície
      this._snapPointsToSurface()

      // Sobrepõe coordenadas calibradas manualmente (se existirem)
      await this._applyCalibrated()

      this._rebuildMeridianLines()

    } catch (err) {
      console.error('[AcupunctureViewer] Erro ao carregar GLB:', err)
    }
  }

  // Tenta carregar /js/acu-points-calibrated.json e aplica posições exatas
  async _applyCalibrated() {
    try {
      const res = await fetch('/js/acu-points-calibrated.json', { cache: 'no-cache' })
      if (!res.ok) return
      const data = await res.json()

      this.pointMeshes.forEach(mesh => {
        const id     = mesh.userData.id
        const baseId = id.endsWith('-E') ? id.slice(0, -2) : id
        const cal    = data[baseId]
        if (!cal) return

        if (id.endsWith('-E')) {
          mesh.position.set(-cal.x, cal.y, cal.z)
        } else {
          mesh.position.set(cal.x, cal.y, cal.z)
        }
      })
    } catch {
      // Arquivo não existe ainda — usa posições do snap
    }
  }

  // ── Snap de um único ponto à superfície (disparo de fora para dentro) ────────
  //
  // Estratégia: dispara raios de 2 m FORA do corpo em direção ao interior.
  // Isso garante que o primeiro hit seja sempre a superfície correta independente
  // da pose do modelo (A-pose, T-pose, etc.) — sem precisar de maxDelta.
  //
  // Direções tentadas em ordem de prioridade:
  //   1) Eixo central → referência        (cobre tronco, cabeça, pernas)
  //   2) ±Z face                          (só para pontos próximos ao eixo, len≤0.18)
  //   3) ±X lateral puro                  (braços — qualquer pose)
  //   4) Diagonal lateral±Z               (face ant./post. do braço)

  _snapSinglePoint(ref, meshes) {
    if (!meshes.length) return null

    const rc  = new THREE.Raycaster()
    rc.far    = 6.0

    const toRef = ref.clone().sub(new THREE.Vector3(0, ref.y, 0))
    const len   = toRef.length()
    const sx    = ref.x >= 0 ? 1 : -1  // sinal lateral

    const outDirs = []

    // 1. Direção do eixo central → referência (principal)
    if (len > 0.025) outDirs.push(toRef.clone().normalize())

    // 2. ±Z apenas para pontos próximos ao eixo (tronco/cabeça/pernas)
    if (len <= 0.18)
      outDirs.push(new THREE.Vector3(0, 0, ref.z >= 0 ? 1 : -1))

    // 3. Lateral puro — essencial para braços em qualquer pose
    if (Math.abs(ref.x) > 0.15)
      outDirs.push(new THREE.Vector3(sx, 0, 0))

    // 4. Diagonais lateral+Z para face anterior/posterior do braço
    if (len > 0.20 && Math.abs(ref.x) > 0.20) {
      outDirs.push(new THREE.Vector3(sx * 0.707, 0,  0.707))
      outDirs.push(new THREE.Vector3(sx * 0.707, 0, -0.707))
    }

    for (const outDir of outDirs) {
      // Dispara sempre de 2 m fora, centrado na altura Y do ponto de referência
      const origin = new THREE.Vector3(0, ref.y, 0).addScaledVector(outDir, 2.0)
      rc.set(origin, outDir.clone().negate())
      const hits = rc.intersectObjects(meshes, false)
      if (hits.length > 0) {
        const h = hits[0]
        const n = h.face.normal.clone()
          .transformDirection(h.object.matrixWorld)
          .normalize()
        return h.point.clone().addScaledVector(n, 0.011)
      }
    }

    return null
  }

  // ── Snap de todos os pontos ───────────────────────────────────────────────

  _snapPointsToSurface() {
    this.pointMeshes.forEach(mesh => {
      const snapped = this._snapSinglePoint(mesh.position, this._bodyMeshes)
      if (snapped) mesh.position.copy(snapped)
    })
  }

  // ── Linha que segue a superfície entre dois pontos snappados ─────────────
  //
  // Divide o segmento em `steps` partes e snappa cada ponto intermediário
  // à superfície usando uma dica de direção baseada nos endpoints (zHint).
  // Isso faz a linha "colar" na superfície mesmo em curvas.

  _surfacePath(p1, p2, steps = 12) {
    const pts = [p1.clone()]

    for (let i = 1; i < steps; i++) {
      const t      = i / steps
      const lerped = p1.clone().lerp(p2, t)
      const zHint  = p1.z * (1 - t) + p2.z * t

      const toRef = lerped.clone().sub(new THREE.Vector3(0, lerped.y, 0))
      const len   = toRef.length()
      const sx    = lerped.x >= 0 ? 1 : -1

      const outDirs = []
      if (len > 0.025) outDirs.push(toRef.clone().normalize())
      if (len <= 0.18) outDirs.push(new THREE.Vector3(0, 0, zHint >= 0 ? 1 : -1))
      if (Math.abs(lerped.x) > 0.15) outDirs.push(new THREE.Vector3(sx, 0, 0))
      if (len > 0.20 && Math.abs(lerped.x) > 0.20) {
        outDirs.push(new THREE.Vector3(sx * 0.707, 0,  0.707))
        outDirs.push(new THREE.Vector3(sx * 0.707, 0, -0.707))
      }

      const rc = new THREE.Raycaster()
      rc.far = 6.0
      let snapped = null

      for (const outDir of outDirs) {
        const origin = new THREE.Vector3(0, lerped.y, 0).addScaledVector(outDir, 2.0)
        rc.set(origin, outDir.clone().negate())
        const hits = rc.intersectObjects(this._bodyMeshes, false)
        if (hits.length > 0) {
          const h = hits[0]
          const n = h.face.normal.clone()
            .transformDirection(h.object.matrixWorld)
            .normalize()
          snapped = h.point.clone().addScaledVector(n, 0.012)
          break
        }
      }

      pts.push(snapped ?? lerped)
    }

    pts.push(p2.clone())
    return pts
  }

  // ── Reconstrói linhas dos meridianos seguindo a superfície ────────────────

  _rebuildMeridianLines() {
    ACU_MERIDIANS.forEach(meridian => {
      const grp = this._meridianGroups[meridian.id]
      if (!grp) return

      // Remove linhas provisórias
      const old = grp.children.filter(c => c.isLine)
      old.forEach(c => { grp.remove(c); c.geometry.dispose() })

      const color = new THREE.Color(meridian.color)
      const mat   = new THREE.LineBasicMaterial({
        color, transparent: true, opacity: 0.70, linewidth: 1
      })

      const buildLine = (ids) => {
        const ptMeshes = ids
          .map(id => this.pointMeshes.find(m => m.userData.id === id))
          .filter(Boolean)

        if (ptMeshes.length < 2) return

        const allPts = []
        for (let i = 0; i < ptMeshes.length - 1; i++) {
          const seg = this._surfacePath(
            ptMeshes[i].position,
            ptMeshes[i + 1].position
          )
          if (i === 0) allPts.push(...seg)
          else         allPts.push(...seg.slice(1))  // evita duplicar ponto de junção
        }

        const geo = new THREE.BufferGeometry().setFromPoints(allPts)
        grp.add(new THREE.Line(geo, mat.clone()))
      }

      // Lado direito do paciente (ids originais)
      buildLine(meridian.points.map(p => p.id))

      // Lado esquerdo (ids espelhados)
      if (meridian.bilateral)
        buildLine(meridian.points.map(p => p.id + '-E'))
    })
  }

  // ── Meridianos e pontos ───────────────────────────────────────────────────

  _setupMeridians() {
    ACU_MERIDIANS.forEach(meridian => {
      const grp = new THREE.Group()
      this._meridianGroups[meridian.id] = grp
      this.scene.add(grp)

      const color = new THREE.Color(meridian.color)

      // Linhas provisórias (substituídas pelo _rebuildMeridianLines após snap)
      const addProvisionalLine = (pts) => {
        if (pts.length < 2) return
        const curve = new THREE.CatmullRomCurve3(pts)
        const geo   = new THREE.BufferGeometry().setFromPoints(curve.getPoints(pts.length * 8))
        const mat   = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 })
        grp.add(new THREE.Line(geo, mat))
      }

      const pts = meridian.points.map(p => new THREE.Vector3(p.x, p.y, p.z))
      addProvisionalLine(pts)
      if (meridian.bilateral)
        addProvisionalLine(pts.map(p => new THREE.Vector3(-p.x, p.y, p.z)))

      // Esferas dos pontos
      const ptMat = new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 0.30,
        roughness: 0.28, metalness: 0.12,
      })
      const ptGeo = new THREE.SphereGeometry(0.007, 10, 8)

      const addPoint = (x, y, z, id, name, pt, mirrored) => {
        const mesh = new THREE.Mesh(ptGeo, ptMat.clone())
        mesh.position.set(x, y, z)
        mesh.userData = { id, name, namePT: pt, meridian: meridian.id,
          meridianName: meridian.name, color: meridian.color, mirrored }
        grp.add(mesh)
        this.pointMeshes.push(mesh)
      }

      meridian.points.forEach(pt => {
        addPoint(pt.x, pt.y, pt.z, pt.id, pt.name, pt.pt, false)
        if (meridian.bilateral && Math.abs(pt.x) > 0.002)
          addPoint(-pt.x, pt.y, pt.z, pt.id + '-E', pt.name, pt.pt, true)
      })
    })
  }

  // ── Interação (clique na tela da doutora) ─────────────────────────────────

  _onClick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this._mouse.x =  ((event.clientX - rect.left) / rect.width)  * 2 - 1
    this._mouse.y = -((event.clientY - rect.top)  / rect.height) * 2 + 1
    this._raycaster.setFromCamera(this._mouse, this.camera)

    const hits = this._raycaster.intersectObjects(this.pointMeshes)
    if (!hits.length) return

    const mesh = hits[0].object
    const id   = mesh.userData.id
    if (this.selectedPoints.has(id)) {
      this.selectedPoints.delete(id)
      this._applySelection(mesh, false)
    } else {
      this.selectedPoints.add(id)
      this._applySelection(mesh, true)
    }
    this.onSelectionChange?.([ ...this.selectedPoints ], mesh.userData)
  }

  _applySelection(mesh, sel) {
    mesh.material.emissiveIntensity = sel ? 1.4 : 0.30
    mesh.scale.setScalar(sel ? 2.4 : 1.0)
  }

  // ── API pública ───────────────────────────────────────────────────────────

  setSelectedPoints(ids) {
    this.pointMeshes.forEach(m => this._applySelection(m, false))
    this.selectedPoints.clear()
    ids.forEach(id => {
      this.selectedPoints.add(id)
      const m = this.pointMeshes.find(m => m.userData.id === id)
      if (m) this._applySelection(m, true)
    })
  }

  getSelectedPoints() { return [ ...this.selectedPoints ] }

  setMeridianVisible(id, visible) {
    const grp = this._meridianGroups[id]
    if (grp) grp.visible = visible
  }

  // ── Render loop ───────────────────────────────────────────────────────────

  _animate() {
    if (this._disposed) return
    this._animId = requestAnimationFrame(this._animate.bind(this))
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
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
    if (this._animId) cancelAnimationFrame(this._animId)
    window.removeEventListener('resize', this._onResizeBound)
    this.renderer.domElement.parentNode?.removeChild(this.renderer.domElement)
    this.renderer.dispose()
  }
}

export { AcupunctureViewer, ACU_MERIDIANS }
