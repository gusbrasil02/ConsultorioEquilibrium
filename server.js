import 'dotenv/config'
import express from 'express'
import { v4 as uuidv4 } from 'uuid'
import QRCode from 'qrcode'
import path from 'path'
import { fileURLToPath } from 'url'

import {
  testConnection,
  createSession,
  getSession,
  saveAnswers,
  completeSession,
  getPendingNotification,
  acknowledgeSession,
  getLatestAcknowledged,
  getPatientHistory,
  countPatientSessions,
  saveAnatomyEvent,
  getLatestAnatomyEvent,
  getPatients,
  getPatient,
  createPatient,
  updatePatient,
  searchPatients,
  getAppointmentsByDate,
  getAppointmentsByRange,
  createAppointment,
  updateAppointment,
  getPatientSessions,
  getPatientAnatomyEvents,
  getActiveSession,
  setSessionWait,
  setSessionCanEnter,
  startSession,
  finishSession,
  getTotemState,
  // auth
  countUsers,
  getUserByEmail,
  createUser,
  // settings / calibração
  getSetting,
  setSetting,
  // financeiro
  createPayment,
  getPatientPayments,
  getPatientPackages,
  createPackage,
  updatePackage,
  consumePackageSession,
  getMonthlyReport
} from './database.js'
import { generateAnatomyExplanation } from './ai.js'
import {
  hashPassword,
  verifyPassword,
  issueSessionCookie,
  clearSessionCookie,
  getUserFromRequest,
  requireAuth,
  requireAuthPage
} from './auth.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())

// ─── Autenticação (item 4) ────────────────────────────────────────────────────

// Estado do login — se ainda não há usuário, o front oferece criar a 1ª conta
app.get('/api/auth/status', async (req, res) => {
  try {
    const user = getUserFromRequest(req)
    let needsSetup = false
    try { needsSetup = (await countUsers()) === 0 } catch (_) {}
    res.json({ authenticated: !!user, needsSetup, user: user ? { name: user.name, email: user.email } : null })
  } catch (error) {
    res.status(500).json({ error: 'Erro interno' })
  }
})

// Cria a primeira conta (só permitido quando não há nenhum usuário)
app.post('/api/auth/setup', async (req, res) => {
  try {
    if ((await countUsers()) > 0) return res.status(403).json({ error: 'Já existe uma conta. Faça login.' })
    const { name, email, password } = req.body
    if (!name?.trim() || !email?.trim() || !password) return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios' })
    if (password.length < 6) return res.status(400).json({ error: 'A senha precisa ter ao menos 6 caracteres' })
    const user = await createUser({ name: name.trim(), email, password_hash: hashPassword(password) })
    issueSessionCookie(res, user)
    res.status(201).json({ success: true, user: { name: user.name, email: user.email } })
  } catch (error) {
    console.error('Erro no setup:', error.message)
    res.status(500).json({ error: 'Erro ao criar conta. Rode a migração SQL v2 no Supabase antes.' })
  }
})

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email?.trim() || !password) return res.status(400).json({ error: 'Informe e-mail e senha' })
    const user = await getUserByEmail(email)
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'E-mail ou senha inválidos' })
    }
    issueSessionCookie(res, user)
    res.json({ success: true, user: { name: user.name, email: user.email } })
  } catch (error) {
    console.error('Erro no login:', error.message)
    res.status(500).json({ error: 'Erro interno no login' })
  }
})

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res)
  res.json({ success: true })
})

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ name: req.user.name, email: req.user.email })
})

// ─── Página do painel protegida (antes do static) ────────────────────────────
app.get(['/doctor', '/doctor/', '/doctor/index.html'], requireAuthPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'doctor', 'index.html'))
})

app.use(express.static(path.join(__dirname, 'public')))

// ─── Sessões ────────────────────────────────────────────────────────────────

// Inicia nova sessão e gera QR Code (público — acionado pelo totem)
app.post('/api/sessions/start', async (req, res) => {
  try {
    const { patient_name, appointment_id, patient_id } = req.body
    if (!patient_name?.trim()) {
      return res.status(400).json({ error: 'Nome do paciente obrigatório' })
    }

    const id = uuidv4()
    const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const form_url = `${process.env.BASE_URL}/form?session=${id}`

    await createSession({
      id,
      patient_name: patient_name.trim(),
      expires_at,
      appointment_id: appointment_id || null,
      patient_id: patient_id || null
    })

    const qr_code_base64 = await QRCode.toDataURL(form_url, {
      width: 400,
      margin: 2,
      color: { dark: '#1a0533', light: '#ffffff' }
    })

    res.json({ session_id: id, form_url, qr_code_base64 })
  } catch (error) {
    console.error('Erro ao iniciar sessão:', error.message)
    res.status(500).json({ error: 'Erro interno ao criar sessão' })
  }
})

// Salva respostas e marca sessão como completada (público — formulário do paciente)
app.post('/api/sessions/:id/answers', async (req, res) => {
  try {
    const { id } = req.params
    const { answers } = req.body

    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ error: 'Respostas inválidas' })
    }

    const session = await getSession(id)
    if (!session) {
      return res.status(404).json({ error: 'Sessão não encontrada ou expirada' })
    }

    await saveAnswers(id, answers)
    await completeSession(id)

    res.json({ success: true })
  } catch (error) {
    console.error('Erro ao salvar respostas:', error.message)
    res.status(500).json({ error: 'Erro interno ao salvar respostas' })
  }
})

// Sessão pendente de notificação (painel da Dra.) — protegido
app.get('/api/sessions/latest/pending-notification', requireAuth, async (req, res) => {
  try {
    const session = await getPendingNotification()
    if (!session) return res.status(404).json({ error: 'Nenhuma notificação pendente' })
    res.json(session)
  } catch (error) {
    console.error('Erro ao buscar notificação:', error.message)
    res.status(500).json({ error: 'Erro interno' })
  }
})

// Última sessão já confirmada (tela do paciente) — público
app.get('/api/sessions/latest/acknowledged', async (req, res) => {
  try {
    const session = await getLatestAcknowledged()
    if (!session) return res.status(404).json({ error: 'Nenhuma sessão confirmada' })
    res.json(session)
  } catch (error) {
    console.error('Erro ao buscar sessão confirmada:', error.message)
    res.status(500).json({ error: 'Erro interno' })
  }
})

// Sessão ativa (in_session) — usada pelo dashboard (recuperação de sessão, item 12)
app.get('/api/sessions/active', requireAuth, async (req, res) => {
  try {
    const session = await getActiveSession()
    if (!session) return res.status(404).json({ error: 'Sem sessão ativa' })
    res.json(session)
  } catch (error) {
    console.error('Erro ao buscar sessão ativa:', error.message)
    res.status(500).json({ error: 'Erro interno' })
  }
})

// Busca dados de uma sessão por ID (público — formulário lê a própria sessão)
app.get('/api/sessions/:id', async (req, res) => {
  try {
    const session = await getSession(req.params.id)
    if (!session) return res.status(404).json({ error: 'Sessão não encontrada ou expirada' })
    res.json(session)
  } catch (error) {
    console.error('Erro ao buscar sessão:', error.message)
    res.status(500).json({ error: 'Erro interno' })
  }
})

// Histórico de sessões anteriores do paciente — protegido
app.get('/api/sessions/:id/history', requireAuth, async (req, res) => {
  try {
    const session = await getSession(req.params.id)
    if (!session) return res.status(404).json({ error: 'Sessão não encontrada' })

    const [history, total] = await Promise.all([
      getPatientHistory(session.patient_name, req.params.id, session.patient_id),
      countPatientSessions(session.patient_name, session.patient_id)
    ])

    res.json({ history, total_sessions: total })
  } catch (error) {
    console.error('Erro ao buscar histórico:', error.message)
    res.status(500).json({ error: 'Erro interno' })
  }
})

// ─── Controle de fluxo de sessão (protegido) ─────────────────────────────────

app.get('/api/totem/state', async (req, res) => {
  try {
    res.json(await getTotemState())
  } catch (error) {
    console.error('Erro ao buscar estado do totem:', error.message)
    res.status(500).json({ state: 'idle' })
  }
})

app.post('/api/sessions/:id/acknowledge', requireAuth, async (req, res) => {
  try {
    await acknowledgeSession(req.params.id)
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: 'Erro interno' })
  }
})

app.post('/api/sessions/:id/wait', requireAuth, async (req, res) => {
  try {
    await setSessionWait(req.params.id)
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: 'Erro interno' })
  }
})

app.post('/api/sessions/:id/can-enter', requireAuth, async (req, res) => {
  try {
    await setSessionCanEnter(req.params.id)
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: 'Erro interno' })
  }
})

app.post('/api/sessions/:id/begin', requireAuth, async (req, res) => {
  try {
    await startSession(req.params.id)
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: 'Erro interno' })
  }
})

// Finaliza sessão (aceita prontuário estruturado — item 7)
app.post('/api/sessions/:id/end', requireAuth, async (req, res) => {
  try {
    const {
      session_notes, session_observations,
      session_complaint, session_conduct, session_evolution, session_plan
    } = req.body
    const session = await getSession(req.params.id)
    await finishSession(req.params.id, {
      session_notes, session_observations,
      session_complaint, session_conduct, session_evolution, session_plan
    })
    if (session?.appointment_id) {
      await updateAppointment(session.appointment_id, { status: 'concluido' }).catch(() => {})
    }
    res.json({ success: true })
  } catch (error) {
    console.error('Erro ao finalizar sessão:', error.message)
    res.status(500).json({ error: 'Erro interno' })
  }
})

// ─── Anatomia / IA ───────────────────────────────────────────────────────────

// Gera explicação SEM publicar na TV (item 1 — rascunho privado)
app.post('/api/anatomy/explain', requireAuth, async (req, res) => {
  try {
    const { session_id, region, problem } = req.body
    if (!session_id || !region || !problem) {
      return res.status(400).json({ error: 'session_id, region e problem são obrigatórios' })
    }
    const session = await getSession(session_id)
    if (!session) return res.status(404).json({ error: 'Sessão não encontrada' })

    const explanation = await generateAnatomyExplanation(region, problem, session.patient_name)
    res.json({ explanation })
  } catch (error) {
    console.error('Erro ao gerar explicação anatômica:', error.message)
    res.status(500).json({ error: 'Erro interno ao gerar explicação' })
  }
})

// Publica na TV do paciente (item 1 — só agora salva o evento exibido)
app.post('/api/anatomy/publish', requireAuth, async (req, res) => {
  try {
    const { session_id, region, problem, explanation } = req.body
    if (!session_id || !region) {
      return res.status(400).json({ error: 'session_id e region são obrigatórios' })
    }
    await saveAnatomyEvent({ session_id, region, problem: problem || '', ai_explanation: explanation || '' })
    res.json({ ok: true })
  } catch (error) {
    console.error('Erro ao publicar explicação:', error.message)
    res.status(500).json({ error: 'Erro interno ao publicar' })
  }
})

// Evento anatômico mais recente (tela do paciente) — público
app.get('/api/anatomy/latest/:session_id', async (req, res) => {
  try {
    const event = await getLatestAnatomyEvent(req.params.session_id)
    if (!event) return res.status(404).json({ error: 'Nenhum evento encontrado' })
    res.json(event)
  } catch (error) {
    res.status(500).json({ error: 'Erro interno' })
  }
})

// Pontos de acupuntura para exibir na TV — protegido
app.post('/api/acupuncture/event', requireAuth, async (req, res) => {
  try {
    const { session_id, points } = req.body
    if (!session_id) return res.status(400).json({ error: 'session_id obrigatório' })
    await saveAnatomyEvent({
      session_id,
      region: '__acupuncture__',
      problem: JSON.stringify(points || []),
      ai_explanation: ''
    })
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({ error: 'Erro interno' })
  }
})

// ─── Pacientes (protegido) ────────────────────────────────────────────────────

app.get('/api/patients/search', requireAuth, async (req, res) => {
  try {
    const { q } = req.query
    if (!q?.trim()) return res.json([])
    res.json(await searchPatients(q.trim()))
  } catch (error) {
    res.status(500).json({ error: 'Erro interno ao buscar pacientes' })
  }
})

app.get('/api/patients', requireAuth, async (req, res) => {
  try {
    res.json(await getPatients())
  } catch (error) {
    res.status(500).json({ error: 'Erro interno ao listar pacientes' })
  }
})

app.post('/api/patients', requireAuth, async (req, res) => {
  try {
    const { name, phone, email, birth_date, condition, notes } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'Nome do paciente obrigatório' })
    const patient = await createPatient({ name: name.trim(), phone, email, birth_date, condition, notes })
    res.status(201).json(patient)
  } catch (error) {
    res.status(500).json({ error: 'Erro interno ao criar paciente' })
  }
})

// Analytics do paciente — por patient_id (item 2)
app.get('/api/patients/:id/analytics', requireAuth, async (req, res) => {
  try {
    const patient = await getPatient(req.params.id)
    if (!patient) return res.status(404).json({ error: 'Paciente não encontrado' })
    const [sessions, anatomyEvents] = await Promise.all([
      getPatientSessions(patient.name, patient.id),
      getPatientAnatomyEvents(patient.name, patient.id)
    ])
    res.json({ patient, sessions, anatomy_events: anatomyEvents })
  } catch (error) {
    res.status(500).json({ error: 'Erro interno ao buscar analytics' })
  }
})

// Financeiro do paciente (item 6)
app.get('/api/patients/:id/finance', requireAuth, async (req, res) => {
  try {
    const [payments, packages] = await Promise.all([
      getPatientPayments(req.params.id),
      getPatientPackages(req.params.id)
    ])
    res.json({ payments, packages })
  } catch (error) {
    console.error('Erro ao buscar financeiro:', error.message)
    res.status(500).json({ error: 'Erro interno ao buscar financeiro' })
  }
})

app.get('/api/patients/:id', requireAuth, async (req, res) => {
  try {
    const patient = await getPatient(req.params.id)
    if (!patient) return res.status(404).json({ error: 'Paciente não encontrado' })
    res.json(patient)
  } catch (error) {
    res.status(500).json({ error: 'Erro interno' })
  }
})

app.put('/api/patients/:id', requireAuth, async (req, res) => {
  try {
    res.json(await updatePatient(req.params.id, req.body))
  } catch (error) {
    res.status(500).json({ error: 'Erro interno ao atualizar paciente' })
  }
})

// ─── Agendamentos (protegido) ─────────────────────────────────────────────────

app.get('/api/appointments', requireAuth, async (req, res) => {
  try {
    const { date, start, end } = req.query
    if (date) return res.json(await getAppointmentsByDate(date))
    if (start && end) return res.json(await getAppointmentsByRange(start, end))
    res.status(400).json({ error: 'Forneça date ou start+end' })
  } catch (error) {
    res.status(500).json({ error: 'Erro interno ao buscar agendamentos' })
  }
})

app.post('/api/appointments', requireAuth, async (req, res) => {
  try {
    const { patient_id, patient_name, appointment_date, appointment_time, type, duration_minutes, notes, price } = req.body
    if (!patient_name?.trim()) return res.status(400).json({ error: 'Nome do paciente obrigatório' })
    if (!appointment_date) return res.status(400).json({ error: 'Data obrigatória' })
    if (!appointment_time) return res.status(400).json({ error: 'Horário obrigatório' })
    if (!type) return res.status(400).json({ error: 'Tipo obrigatório' })
    const appointment = await createAppointment({
      patient_id, patient_name: patient_name.trim(),
      appointment_date, appointment_time, type, duration_minutes, notes, price
    })
    res.status(201).json(appointment)
  } catch (error) {
    res.status(500).json({ error: 'Erro interno ao criar agendamento' })
  }
})

app.put('/api/appointments/:id', requireAuth, async (req, res) => {
  try {
    res.json(await updateAppointment(req.params.id, req.body))
  } catch (error) {
    res.status(500).json({ error: 'Erro interno ao atualizar agendamento' })
  }
})

// ─── Financeiro (item 6) ──────────────────────────────────────────────────────

app.post('/api/payments', requireAuth, async (req, res) => {
  try {
    const { amount } = req.body
    if (amount === undefined || amount === null || isNaN(Number(amount))) {
      return res.status(400).json({ error: 'Valor do pagamento obrigatório' })
    }
    res.status(201).json(await createPayment(req.body))
  } catch (error) {
    console.error('Erro ao registrar pagamento:', error.message)
    res.status(500).json({ error: 'Erro interno ao registrar pagamento' })
  }
})

app.post('/api/packages', requireAuth, async (req, res) => {
  try {
    const { patient_id, total_sessions } = req.body
    if (!patient_id || !total_sessions) return res.status(400).json({ error: 'patient_id e total_sessions obrigatórios' })
    res.status(201).json(await createPackage(req.body))
  } catch (error) {
    console.error('Erro ao criar pacote:', error.message)
    res.status(500).json({ error: 'Erro interno ao criar pacote' })
  }
})

app.put('/api/packages/:id', requireAuth, async (req, res) => {
  try {
    res.json(await updatePackage(req.params.id, req.body))
  } catch (error) {
    res.status(500).json({ error: 'Erro interno ao atualizar pacote' })
  }
})

// Consome uma sessão de pacote ativo do paciente
app.post('/api/patients/:id/consume-package', requireAuth, async (req, res) => {
  try {
    const pkg = await consumePackageSession(req.params.id)
    if (!pkg) return res.status(404).json({ error: 'Nenhum pacote com saldo' })
    res.json(pkg)
  } catch (error) {
    res.status(500).json({ error: 'Erro interno ao consumir pacote' })
  }
})

app.get('/api/reports/monthly', requireAuth, async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7)
    res.json(await getMonthlyReport(month))
  } catch (error) {
    console.error('Erro no relatório mensal:', error.message)
    res.status(500).json({ error: 'Erro interno no relatório' })
  }
})

// ─── Calibração de acupuntura no banco (item 3) ───────────────────────────────

app.get('/api/calibrate', async (req, res) => {
  try {
    res.json((await getSetting('acu_calibration')) || {})
  } catch (error) {
    res.json({})
  }
})

app.post('/api/calibrate/save', requireAuth, async (req, res) => {
  try {
    await setSetting('acu_calibration', req.body || {})
    res.json({ ok: true })
  } catch (error) {
    console.error('Erro ao salvar calibração:', error.message)
    res.status(500).json({ error: error.message })
  }
})

// ─── SSE — poller único no servidor + fan-out (item 13) ──────────────────────

const sseClients = { public: new Set(), doctor: new Set() }
let lastJson = { public: '', doctor: '' }
let lastSnapshot = { public: null, doctor: null }
let pollTimer = null

function sseWrite(res, data) {
  try { res.write(`data: ${JSON.stringify(data)}\n\n`) } catch (_) {}
}
function broadcast(channel, data) {
  lastSnapshot[channel] = data
  for (const res of sseClients[channel]) sseWrite(res, data)
}
function ensurePolling() {
  if (!pollTimer) pollTimer = setInterval(pollOnce, 2500)
  pollOnce()
}
function stopPollingIfIdle() {
  if (sseClients.public.size === 0 && sseClients.doctor.size === 0 && pollTimer) {
    clearInterval(pollTimer); pollTimer = null
  }
}

async function pollOnce() {
  try {
    if (sseClients.public.size > 0) {
      const totem = await getTotemState()
      const ack = await getLatestAcknowledged()
      let anatomy = null
      if (ack) anatomy = await getLatestAnatomyEvent(ack.id)
      const payload = {
        type: 'public',
        totem,
        shared: ack ? { session_id: ack.id, patient_name: ack.patient_name, anatomy } : { session_id: null, anatomy: null }
      }
      const json = JSON.stringify(payload)
      if (json !== lastJson.public) { lastJson.public = json; broadcast('public', payload) }
    }
    if (sseClients.doctor.size > 0) {
      const pending = await getPendingNotification()
      const active = await getActiveSession()
      const payload = { type: 'doctor', pending: pending || null, active: active || null }
      const json = JSON.stringify(payload)
      if (json !== lastJson.doctor) { lastJson.doctor = json; broadcast('doctor', payload) }
    }
  } catch (error) {
    console.error('Erro no poller SSE:', error.message)
  }
}

function openSSE(channel, req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  })
  res.write(': ok\n\n')
  sseClients[channel].add(res)
  if (lastSnapshot[channel]) sseWrite(res, lastSnapshot[channel])
  lastJson[channel] = '' // força re-broadcast no próximo tick
  ensurePolling()

  const heartbeat = setInterval(() => sseWrite(res, { type: 'ping' }), 25000)
  req.on('close', () => {
    clearInterval(heartbeat)
    sseClients[channel].delete(res)
    stopPollingIfIdle()
  })
}

// Público — totem e tela do paciente
app.get('/api/stream/public', (req, res) => openSSE('public', req, res))
// Painel da Dra. — inclui dados sensíveis (respostas), então exige login
app.get('/api/stream/doctor', requireAuth, (req, res) => openSSE('doctor', req, res))

// ─── Inicialização ───────────────────────────────────────────────────────────

app.listen(PORT, async () => {
  console.log(`\nServidor rodando em http://localhost:${PORT}`)
  console.log(`BASE_URL: ${process.env.BASE_URL || 'não configurada'}`)
  await testConnection()
  console.log('\nURLs do sistema:')
  console.log(`  Totem (sala de espera): http://localhost:${PORT}/totem`)
  console.log(`  Painel da Dra.:         http://localhost:${PORT}/doctor`)
  console.log(`  Tela do paciente:       http://localhost:${PORT}/shared`)
  console.log(`  Login:                  http://localhost:${PORT}/login\n`)
})
