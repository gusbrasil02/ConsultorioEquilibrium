// Configurações do consultório (⚙): informações para o robô, horário de
// atendimento, regras do robô e liga/desliga das automações. Tudo em app_settings.
import { getSetting, setSetting, getAppointmentsByRange, brasiliaDateTime } from './database.js'

// Pré-preenchido com o site (equilibriumsaudeintegrada.com.br) — a Dra. completa no ⚙
const DEFAULT_INFO = {
  nome: 'Consultório Equilibrium — Equilibrium Saúde Integrada (Fisioterapia & Saúde Integrada)',
  profissional: 'Dra. Juliane Brasil Lopes — fisioterapeuta, responsável técnica, CREFITO-8 328931-F. Atendimento individual, com hora marcada.',
  endereco: 'Rua Augusto Severo, 640 — BIOOS Health, Sala 1705 — Alto da Glória, Curitiba - PR',
  estacionamento: 'Estacionamento Estapar no próprio prédio. Também há vagas do EstaR nas ruas ao redor.',
  contato: 'WhatsApp (41) 98867-6271 · e-mail jubrasilfisio@gmail.com · Instagram @fisio.julianebrasil · site equilibriumsaudeintegrada.com.br',
  proposta: 'Combina fisioterapia, terapias integrativas e movimento em um plano individual, focado na causa da dor e não apenas no sintoma. "Equilíbrio para o corpo. Leveza para a vida."',
  servicos: [
    'Acupuntura — estímulo de pontos específicos com agulhas finas para dor, tensão e equilíbrio do organismo',
    'Dry Needling — agulhamento a seco de pontos-gatilho musculares para aliviar contraturas e ganhar mobilidade',
    'Ventosa — sucção terapêutica para circulação local e alívio de tensão muscular e fascial',
    'Barras de Access — toque suave em pontos da cabeça, voltado a relaxamento e sensação de leveza',
    'Redução de dor — protocolos combinados para dores agudas e crônicas',
    'Reabilitação — recuperação de lesões, cirurgias e traumas, com acompanhamento a cada sessão',
    'Terapia manual — técnicas com as mãos para mobilizar articulações e liberar tecidos',
    'Prevenção de lesões — avaliação e exercícios para identificar riscos, para a rotina e o esporte',
    'Aplicação de bandagem — bandagem elástica funcional para suporte e estabilidade na recuperação',
    'Pilates solo — no colchonete, sem aparelhos: força do centro do corpo, flexibilidade e controle do movimento',
    'Funcional — treino de movimentos do dia a dia para força, equilíbrio e autonomia',
    'Reeducação postural — correção de desequilíbrios para reduzir sobrecargas e dores recorrentes',
    'Atendimento para todas as idades — cuidado adaptado da infância à maturidade'
  ].join('\n'),
  indicacoes: 'Dor nas costas, pescoço ou lombar; lesões do esporte ou por esforço repetitivo; recuperação após cirurgia ou trauma; postura prejudicada pelo trabalho sentado; tensão muscular, estresse e cansaço; perda de mobilidade ou de equilíbrio; acompanhamento do desenvolvimento infantil; quem quer se movimentar melhor, sem dor.',
  como_funciona: '1) Contato pelo WhatsApp, descrevendo os sintomas e escolhendo o horário. 2) Avaliação: conversa completa e testes físicos para identificar a origem do problema. 3) Plano personalizado, com as técnicas escolhidas para o corpo, a rotina e os objetivos da pessoa. 4) Evolução: acompanhamento em cada sessão, com ajustes até o resultado.',
  valores: '',
  pagamento: '',
  convenios: '',
  extra: '',
  faq: []   // [{ q, a }]
}

// Dia da semana (0 = domingo) → atendimento
const DEFAULT_HOURS = {
  session_minutes: 60,
  step_minutes: 60,
  days: {
    0: { on: false, start: '08:00', end: '12:00' },
    1: { on: true, start: '08:00', end: '19:00' },
    2: { on: true, start: '08:00', end: '19:00' },
    3: { on: true, start: '08:00', end: '19:00' },
    4: { on: true, start: '08:00', end: '19:00' },
    5: { on: true, start: '08:00', end: '19:00' },
    6: { on: false, start: '08:00', end: '12:00' }
  },
  lunch: { on: false, start: '12:00', end: '13:00' }
}

const DEFAULT_BOT = {
  reminder_time: '08:00',     // hora do lembrete do dia anterior
  min_hours_change: 12,       // remarcar/desmarcar sozinho até X h antes
  min_hours_book: 2,          // não marca em cima da hora
  days_ahead: 30,             // até quantos dias à frente o robô marca
  pause_hours: 12,            // Dra. respondeu à mão → robô para nessa conversa por X h
  ignore: []                  // números que o robô nunca responde (família, amigos)
}

const DEFAULT_AUTOMATIONS = { bot: true, reminders: true, notices: true, suggestion: true }

const cache = new Map()
async function load(key, def) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 30_000) return hit.value
  let stored = null
  try { stored = await getSetting(key) } catch (_) {}
  const value = mergeDefaults(def, stored)
  cache.set(key, { at: Date.now(), value })
  return value
}
async function save(key, def, value) {
  const merged = mergeDefaults(def, value)
  await setSetting(key, merged)
  cache.set(key, { at: Date.now(), value: merged })
  return merged
}
function mergeDefaults(def, v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return structuredClone(def)
  const out = structuredClone(def)
  for (const k of Object.keys(def)) {
    if (v[k] === undefined) continue
    const d = def[k]
    out[k] = d && typeof d === 'object' && !Array.isArray(d) ? mergeDefaults(d, v[k]) : v[k]
  }
  return out
}

const getInfo = () => load('clinic_info', DEFAULT_INFO)
const getHours = () => load('clinic_hours', DEFAULT_HOURS)
const getBotConfig = () => load('bot_config', DEFAULT_BOT)
const getAutomations = () => load('automations', DEFAULT_AUTOMATIONS)

// ── Validação do que vem do painel ────────────────────────────────────────────
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const str = (v, max = 4000) => String(v ?? '').slice(0, max)

function cleanInfo(b = {}) {
  const out = {}
  for (const k of Object.keys(DEFAULT_INFO)) if (k !== 'faq' && b[k] !== undefined) out[k] = str(b[k])
  if (Array.isArray(b.faq)) {
    out.faq = b.faq.slice(0, 60).map(f => ({ q: str(f?.q, 300).trim(), a: str(f?.a, 1500).trim() })).filter(f => f.q && f.a)
  }
  return out
}
function cleanHours(b = {}) {
  const out = { days: {} }
  const mins = n => [30, 40, 45, 50, 60, 90].includes(Number(n)) ? Number(n) : 60
  if (b.session_minutes !== undefined) out.session_minutes = mins(b.session_minutes)
  if (b.step_minutes !== undefined) out.step_minutes = [15, 30, 60].includes(Number(b.step_minutes)) ? Number(b.step_minutes) : 60
  for (let d = 0; d < 7; d++) {
    const x = b.days?.[d]
    if (!x) continue
    out.days[d] = { on: !!x.on, start: TIME.test(x.start) ? x.start : '08:00', end: TIME.test(x.end) ? x.end : '19:00' }
  }
  if (b.lunch) out.lunch = { on: !!b.lunch.on, start: TIME.test(b.lunch.start) ? b.lunch.start : '12:00', end: TIME.test(b.lunch.end) ? b.lunch.end : '13:00' }
  return out
}
function cleanBot(b = {}) {
  const out = {}
  const int = (v, lo, hi, def) => { const n = parseInt(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def }
  if (b.reminder_time !== undefined) out.reminder_time = TIME.test(b.reminder_time) ? b.reminder_time : '08:00'
  if (b.min_hours_change !== undefined) out.min_hours_change = int(b.min_hours_change, 0, 168, 12)
  if (b.min_hours_book !== undefined) out.min_hours_book = int(b.min_hours_book, 0, 72, 2)
  if (b.days_ahead !== undefined) out.days_ahead = int(b.days_ahead, 1, 120, 30)
  if (b.pause_hours !== undefined) out.pause_hours = int(b.pause_hours, 1, 168, 12)
  if (Array.isArray(b.ignore)) {
    out.ignore = b.ignore.map(x => String(x).replace(/\D/g, '')).filter(x => x.length >= 10).slice(0, 200)
  }
  return out
}
function cleanAutomations(b = {}) {
  const out = {}
  for (const k of Object.keys(DEFAULT_AUTOMATIONS)) if (b[k] !== undefined) out[k] = !!b[k]
  return out
}

const saveInfo = async b => save('clinic_info', DEFAULT_INFO, { ...(await getInfo()), ...cleanInfo(b) })
const saveHours = async b => {
  const cur = await getHours(), c = cleanHours(b)
  return save('clinic_hours', DEFAULT_HOURS, { ...cur, ...c, days: { ...cur.days, ...c.days } })
}
const saveBotConfig = async b => save('bot_config', DEFAULT_BOT, { ...(await getBotConfig()), ...cleanBot(b) })
const saveAutomations = async b => save('automations', DEFAULT_AUTOMATIONS, { ...(await getAutomations()), ...cleanAutomations(b) })

// ── Datas em Brasília ─────────────────────────────────────────────────────────
const toMin = t => { const [h, m] = String(t).slice(0, 5).split(':').map(Number); return h * 60 + m }
const fromMin = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const weekday = dateStr => new Date(dateStr + 'T12:00:00Z').getUTCDay()
const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
const fmtDate = d => `${d.slice(8, 10)}/${d.slice(5, 7)}`
// "segunda-feira, 03/11"
const longDate = d => `${WEEKDAYS[weekday(d)]}, ${fmtDate(d)}`
// Minutos entre agora (Brasília) e uma data/hora de agendamento
function minutesUntil(dateStr, timeStr) {
  const { dateStr: today, minutesOfDay } = brasiliaDateTime()
  const days = Math.round((new Date(dateStr + 'T12:00:00Z') - new Date(today + 'T12:00:00Z')) / 86400000)
  return days * 1440 + toMin(timeStr) - minutesOfDay
}

// ── Horários livres ───────────────────────────────────────────────────────────
// Por dia: horários de início dentro do expediente, fora do almoço, sem
// sobrepor agendamentos (cancelados não ocupam) e com a antecedência mínima.
async function freeSlots(start, end, { duration, ignoreId } = {}) {
  const [hours, bot] = [await getHours(), await getBotConfig()]
  const dur = duration || hours.session_minutes
  const step = hours.step_minutes || dur
  const appts = (await getAppointmentsByRange(start, end))
    .filter(a => a.status !== 'cancelado' && String(a.id) !== String(ignoreId))
  const out = []
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const day = hours.days[weekday(d)]
    if (!day?.on) continue
    const busy = appts.filter(a => a.appointment_date === d)
      .map(a => [toMin(a.appointment_time), toMin(a.appointment_time) + (Number(a.duration_minutes) || 60)])
    if (hours.lunch?.on) busy.push([toMin(hours.lunch.start), toMin(hours.lunch.end)])
    const times = []
    for (let m = toMin(day.start); m + dur <= toMin(day.end); m += step) {
      if (busy.some(([s, e]) => m < e && s < m + dur)) continue
      if (minutesUntil(d, fromMin(m)) < bot.min_hours_book * 60) continue
      times.push(fromMin(m))
    }
    if (times.length) out.push({ date: d, weekday: WEEKDAYS[weekday(d)], times })
  }
  return out
}

// O horário cabe no expediente e está livre?
async function slotProblem(dateStr, timeStr, { duration, ignoreId } = {}) {
  const hours = await getHours()
  const dur = duration || hours.session_minutes
  const day = hours.days[weekday(dateStr)]
  if (!day?.on) return `Não há atendimento neste dia (${WEEKDAYS[weekday(dateStr)]}).`
  const m = toMin(timeStr)
  if (m < toMin(day.start) || m + dur > toMin(day.end)) return `Fora do horário de atendimento (${day.start} às ${day.end}).`
  if (hours.lunch?.on && m < toMin(hours.lunch.end) && toMin(hours.lunch.start) < m + dur) return 'Horário de almoço.'
  const free = await freeSlots(dateStr, dateStr, { duration: dur, ignoreId })
  if (!free[0]?.times.includes(timeStr)) {
    // pode estar livre mas fora da grade de passos: confere sobreposição direto
    const appts = (await getAppointmentsByRange(dateStr, dateStr)).filter(a => a.status !== 'cancelado' && String(a.id) !== String(ignoreId))
    if (appts.some(a => m < toMin(a.appointment_time) + (Number(a.duration_minutes) || 60) && toMin(a.appointment_time) < m + dur)) return 'Horário já ocupado.'
    const bot = await getBotConfig()
    if (minutesUntil(dateStr, timeStr) < bot.min_hours_book * 60) return `É preciso marcar com pelo menos ${bot.min_hours_book} h de antecedência.`
  }
  return null
}

// Texto do horário de atendimento (para o robô e o painel)
function hoursText(hours) {
  const parts = []
  for (const d of [1, 2, 3, 4, 5, 6, 0]) {
    const x = hours.days[d]
    parts.push(`${WEEKDAYS[d]}: ${x?.on ? `${x.start} às ${x.end}` : 'fechado'}`)
  }
  if (hours.lunch?.on) parts.push(`intervalo de almoço ${hours.lunch.start}–${hours.lunch.end}`)
  return parts.join('; ')
}

export {
  DEFAULT_INFO, getInfo, getHours, getBotConfig, getAutomations,
  saveInfo, saveHours, saveBotConfig, saveAutomations,
  freeSlots, slotProblem, hoursText, addDays, weekday, WEEKDAYS, fmtDate, longDate, minutesUntil, toMin
}
