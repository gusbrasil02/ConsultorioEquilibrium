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
  getMonthlyReport,
  getOverviewReport,
  getClinicalReport,
  getPaymentsInPeriod,
  getPaymentByAppointment,
  getPaymentBySession,
  getPaymentByProviderId,
  updatePayment,
  deletePayment,
  getActivePackage,
  getAppointment,
  deleteAppointment,
  deleteAppointmentSeries,
  syncAppointmentPayment,
  syncAppointmentPackage,
  hasConflict,
  getOpenSessionForAppointment,
  getLastAcupuncture,
  getQueue,
  getTvSession,
  todayBR
} from './database.js'
import { generateAnatomyExplanation } from './ai.js'
import * as mp from './mercadopago.js'
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

// Atrás do Traefik (Coolify): o IP real do cliente vem em X-Forwarded-For
app.set('trust proxy', 1)
app.use(express.json())

// ─── Utilidades ──────────────────────────────────────────────────────────────

// Nome exibido em telas públicas (totem): "Maria Souza Lima" → "Maria L."
// O nome completo não precisa circular num canal aberto para a pessoa se reconhecer.
function displayName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return parts[0] || ''
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`
}
const firstName = full => String(full || '').trim().split(/\s+/)[0] || ''

// Limite simples de tentativas de login (anti força-bruta), em memória
const loginAttempts = new Map()   // chave → { n, until }
const LOGIN_MAX = 8, LOGIN_WINDOW = 15 * 60 * 1000
function loginBlocked(key) {
  const a = loginAttempts.get(key)
  if (!a) return false
  if (Date.now() > a.until) { loginAttempts.delete(key); return false }
  return a.n >= LOGIN_MAX
}
function loginFailed(key) {
  const a = loginAttempts.get(key)
  if (!a || Date.now() > a.until) loginAttempts.set(key, { n: 1, until: Date.now() + LOGIN_WINDOW })
  else a.n++
}

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
    const key = `${req.ip}|${String(email).toLowerCase().trim()}`
    if (loginBlocked(key)) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos e tente de novo.' })
    }
    const user = await getUserByEmail(email)
    if (!user || !verifyPassword(password, user.password_hash)) {
      loginFailed(key)
      return res.status(401).json({ error: 'E-mail ou senha inválidos' })
    }
    loginAttempts.delete(key)
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
    const { appointment_id } = req.body
    let patient_name = String(req.body.patient_name || '').trim().slice(0, 120)
    let patient_id = req.body.patient_id || null

    // Com agendamento, o nome e o vínculo vêm do banco — o totem só conhece o
    // nome abreviado, e não confiamos em dados de uma tela pública.
    let appointment = null
    if (appointment_id) {
      appointment = await getAppointment(appointment_id)
      if (!appointment) return res.status(404).json({ error: 'Agendamento não encontrado' })
      patient_name = appointment.patient_name
      patient_id = appointment.patient_id || null
    }
    if (!patient_name) {
      return res.status(400).json({ error: 'Nome do paciente obrigatório' })
    }

    // Já existe sessão aberta deste agendamento (QR gerado e não respondido)?
    // Reaproveita — evita sessões órfãs a cada toque no totem.
    const open = appointment ? await getOpenSessionForAppointment(appointment.id) : null
    const id = open?.id || uuidv4()
    const form_url = `${process.env.BASE_URL}/form?session=${id}`

    if (!open) {
      await createSession({
        id,
        patient_name,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        appointment_id: appointment?.id || null,
        patient_id
      })
    }

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

// Perguntas aceitas do formulário (o endpoint é público: nada além disso entra no banco)
const ANSWER_KEYS = ['sleep', 'pain', 'pain_regions', 'stress', 'reason', 'payment_method', 'pix_declared']

// Salva respostas e marca sessão como completada (público — formulário do paciente)
app.post('/api/sessions/:id/answers', async (req, res) => {
  try {
    const { id } = req.params
    const { answers } = req.body

    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      return res.status(400).json({ error: 'Respostas inválidas' })
    }
    const clean = {}
    for (const k of ANSWER_KEYS) {
      if (answers[k] != null && answers[k] !== '') clean[k] = String(answers[k]).slice(0, 300)
    }

    const session = await getSession(id)
    if (!session) {
      return res.status(404).json({ error: 'Sessão não encontrada ou expirada' })
    }
    // Atendimento já em andamento/encerrado: não reabre a chegada do paciente
    if (['in_session', 'finished'].includes(session.status)) {
      return res.status(409).json({ error: 'Este atendimento já foi iniciado.' })
    }

    await saveAnswers(id, clean)
    await completeSession(id)
    pollSoon()

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
    session.payment = await sessionPayment(session)
    res.json(session)
  } catch (error) {
    console.error('Erro ao buscar notificação:', error.message)
    res.status(500).json({ error: 'Erro interno' })
  }
})

// Última sessão já confirmada — protegido (devolve respostas de saúde do paciente;
// a TV usa /api/tv/state, que não expõe nada disso)
app.get('/api/sessions/latest/acknowledged', requireAuth, async (req, res) => {
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
    session.payment = await sessionPayment(session)
    res.json(session)
  } catch (error) {
    console.error('Erro ao buscar sessão ativa:', error.message)
    res.status(500).json({ error: 'Erro interno' })
  }
})

// Estado da TV da sala de atendimento — público, sem dados do paciente
app.get('/api/tv/state', async (req, res) => {
  try {
    res.json(await tvState())
  } catch (error) {
    res.json({ session_id: null, anatomy: null })
  }
})

// Busca uma sessão por ID. Logada: dados completos (painel). Sem login (celular do
// paciente): só o necessário para o formulário — sem respostas nem dados de saúde.
app.get('/api/sessions/:id', async (req, res) => {
  try {
    const session = await getSession(req.params.id)
    if (!session) return res.status(404).json({ error: 'Sessão não encontrada ou expirada' })
    if (getUserFromRequest(req)) return res.json(session)
    res.json({
      id: session.id,
      patient_name: firstName(session.patient_name),
      status: session.status,
      completed: !!session.completed_at
    })
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

// Estado do totem (tela pública da recepção) — nome abreviado
async function publicTotemState() {
  const st = await getTotemState()
  if (st?.patient_name) st.patient_name = displayName(st.patient_name)
  return st
}

app.get('/api/totem/state', async (req, res) => {
  try {
    res.json(await publicTotemState())
  } catch (error) {
    console.error('Erro ao buscar estado do totem:', error.message)
    res.status(500).json({ state: 'idle' })
  }
})

// Transições de status feitas pela profissional
const TRANSITIONS = {
  acknowledge: acknowledgeSession,
  wait: setSessionWait,
  'can-enter': setSessionCanEnter,
  begin: startSession
}
for (const [action, fn] of Object.entries(TRANSITIONS)) {
  app.post(`/api/sessions/:id/${action}`, requireAuth, async (req, res) => {
    try {
      await fn(req.params.id)
      pollSoon()   // totem, TV e outras abas do painel veem na hora
      res.json({ success: true })
    } catch (error) {
      console.error(`Erro em ${action}:`, error.message)
      res.status(500).json({ error: 'Erro interno' })
    }
  })
}

// Pontos de acupuntura da última sessão do paciente ("repetir pontos")
app.get('/api/sessions/:id/last-acupuncture', requireAuth, async (req, res) => {
  try {
    const session = await getSession(req.params.id)
    if (!session) return res.status(404).json({ error: 'Sessão não encontrada' })
    const last = await getLastAcupuncture(session.patient_name, session.patient_id, session.id)
    if (!last) return res.status(404).json({ error: 'Nenhum registro anterior' })
    res.json(last)
  } catch (error) {
    res.status(500).json({ error: 'Erro interno' })
  }
})

// Contexto para o modal "Fechar a consulta": pacote ativo, preço sugerido, etc.
app.get('/api/sessions/:id/closeout', requireAuth, async (req, res) => {
  try {
    const session = await getSession(req.params.id)
    if (!session) return res.status(404).json({ error: 'Sessão não encontrada' })

    const appointment = session.appointment_id ? await getAppointment(session.appointment_id) : null
    const activePackage = session.patient_id ? await getActivePackage(session.patient_id) : null
    const prices = (await getSetting('default_prices')) || {}

    const type = appointment?.type || null
    const suggested = appointment?.price ?? (type && prices[type] != null ? prices[type] : null)

    // Já foi pago (ex.: Pix confirmado pelo Mercado Pago)? A cobrança está fechada.
    const pay = appointment
      ? await getPaymentByAppointment(appointment.id)
      : await getPaymentBySession(session.id)

    res.json({
      patient_id: session.patient_id || null,
      patient_name: session.patient_name,
      appointment,
      type,
      suggested_amount: suggested,
      active_package: activePackage,
      default_prices: prices,
      payment: pay ? {
        status: pay.status,
        provider: pay.provider,
        amount: pay.amount,
        method: pay.method,
        confirmed: pay.status === 'pago' && !!pay.provider_payment_id
      } : null
    })
  } catch (error) {
    console.error('Erro no closeout:', error.message)
    res.status(500).json({ error: 'Erro interno' })
  }
})

// Soma dias respeitando a frequência escolhida
function nextDate(dateStr, frequency, index) {
  const d = new Date(dateStr + 'T12:00:00Z')
  if (frequency === 'quinzenal')      d.setUTCDate(d.getUTCDate() + 14 * index)
  else if (frequency === '2x')        d.setUTCDate(d.getUTCDate() + Math.round(3.5 * index))
  else /* semanal */                  d.setUTCDate(d.getUTCDate() + 7 * index)
  return d.toISOString().slice(0, 10)
}

// Finaliza sessão: prontuário + cobrança + retorno recorrente
app.post('/api/sessions/:id/end', requireAuth, async (req, res) => {
  try {
    const {
      session_notes, session_observations,
      session_complaint, session_conduct, session_evolution, session_plan,
      billing, recurrence
    } = req.body

    const session = await getSession(req.params.id)
    if (!session) return res.status(404).json({ error: 'Sessão não encontrada' })

    // Fechamento repetido (duplo clique, rede reenviando): não cobra nem agenda de novo
    if (session.status === 'finished') {
      return res.json({ success: true, already: true, created: [], skipped: [] })
    }

    // 1. Prontuário
    await finishSession(req.params.id, {
      session_notes, session_observations,
      session_complaint, session_conduct, session_evolution, session_plan
    })
    pollSoon()

    const result = { success: true, created: [], skipped: [] }

    // 2. Cobrança — sempre desemboca no livro-caixa (`payments`)
    if (billing && billing.mode) {
      const amount = billing.amount == null || billing.amount === '' ? null : Number(billing.amount)
      try {
        if (session.appointment_id) {
          // Grava no agendamento e deixa o sync refletir no caixa/pacote
          await updateAppointment(session.appointment_id, {
            status: 'concluido',
            price: amount,
            payment_status: billing.mode,
            payment_method: billing.method || null
          })
          const appt = await getAppointment(session.appointment_id)
          await syncAppointmentPackage(appt)
          const fresh = await getAppointment(session.appointment_id)
          await syncAppointmentPayment(fresh)
        } else {
          // Sessão avulsa (sem agendamento): o lançamento é ligado à sessão.
          // Atualiza o que já existir em vez de criar outro (evita receita em dobro).
          const existing = await getPaymentBySession(session.id)
          const confirmedByProvider = existing?.status === 'pago' && existing.provider_payment_id
          const money = (billing.mode === 'pago' || billing.mode === 'pendente') && amount > 0

          if (billing.mode === 'pacote' && session.patient_id) {
            await consumePackageSession(session.patient_id)
          }
          if (confirmedByProvider) {
            // dinheiro já entrou de verdade — não mexe
          } else if (money) {
            const row = { amount, method: billing.method || null, status: billing.mode, paid_at: todayBR() }
            if (existing) await updatePayment(existing.id, row)
            else await createPayment({ ...row, patient_id: session.patient_id, session_id: session.id })
          } else if (existing) {
            await deletePayment(existing.id)
          }
        }
      } catch (e) {
        console.error('Erro na cobrança do fechamento:', e.message)
      }
    } else if (session.appointment_id) {
      await updateAppointment(session.appointment_id, { status: 'concluido' }).catch(() => {})
    }

    // 3. Retorno recorrente
    if (recurrence?.enabled && recurrence.start_date && recurrence.time) {
      const count     = Math.min(Math.max(parseInt(recurrence.count) || 1, 1), 52)
      const frequency = recurrence.frequency || 'semanal'
      const duration  = parseInt(recurrence.duration_minutes) || 60
      const type      = recurrence.type || 'Retorno'
      const seriesId  = uuidv4()

      let created = 0
      // Tenta até 3x o número de sessões para pular conflitos sem loop infinito
      for (let i = 0; created < count && i < count * 3; i++) {
        const date = nextDate(recurrence.start_date, frequency, i)
        try {
          if (await hasConflict(date, recurrence.time, duration)) {
            result.skipped.push(date)
            continue
          }
          const appt = await createAppointment({
            patient_id: session.patient_id || null,
            patient_name: session.patient_name,
            appointment_date: date,
            appointment_time: recurrence.time,
            type,
            duration_minutes: duration,
            notes: recurrence.notes || null,
            price: recurrence.price == null || recurrence.price === '' ? null : Number(recurrence.price),
            series_id: count > 1 ? seriesId : null
          })
          await syncAppointmentPayment(appt).catch(() => {})
          result.created.push(date)
          created++
        } catch (e) {
          console.error('Erro ao criar retorno:', e.message)
        }
      }
    }

    res.json(result)
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

    // Para a IA basta o primeiro nome — não há por que enviar o nome completo
    const explanation = await generateAnatomyExplanation(
      String(region).slice(0, 80), String(problem).slice(0, 1000), firstName(session.patient_name))
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
    if (!(await getSession(session_id))) return res.status(404).json({ error: 'Sessão não encontrada' })
    await saveAnatomyEvent({
      session_id,
      region: String(region).slice(0, 80),
      problem: String(problem || '').slice(0, 1000),
      ai_explanation: String(explanation || '').slice(0, 5000)
    })
    pollSoon()
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
    const { session_id } = req.body
    if (!session_id) return res.status(400).json({ error: 'session_id obrigatório' })
    // Lista de ids de pontos ("LU7", "LU7-E", "Yintang"...) — nada além disso
    const points = (Array.isArray(req.body.points) ? req.body.points : [])
      .filter(p => typeof p === 'string' && /^[A-Za-z0-9-]{1,20}$/.test(p))
      .slice(0, 120)
    if (!(await getSession(session_id))) return res.status(404).json({ error: 'Sessão não encontrada' })
    await saveAnatomyEvent({
      session_id,
      region: '__acupuncture__',
      problem: JSON.stringify(points),
      ai_explanation: ''
    })
    pollSoon()
    res.json({ ok: true })
  } catch (error) {
    console.error('Erro ao publicar acupuntura:', error.message)
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

// Só campos editáveis — o corpo da requisição nunca vai direto para o banco
function pick(body, keys) {
  const out = {}
  for (const k of keys) if (body?.[k] !== undefined) out[k] = body[k]
  return out
}

app.put('/api/patients/:id', requireAuth, async (req, res) => {
  try {
    const updates = pick(req.body, ['name', 'phone', 'email', 'birth_date', 'condition', 'notes'])
    if (updates.name !== undefined && !String(updates.name).trim()) {
      return res.status(400).json({ error: 'Nome do paciente obrigatório' })
    }
    if (updates.birth_date === '') updates.birth_date = null
    res.json(await updatePatient(req.params.id, updates))
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(appointment_date)) return res.status(400).json({ error: 'Data inválida' })
    const appointment = await createAppointment({
      patient_id, patient_name: patient_name.trim(),
      appointment_date, appointment_time, type, duration_minutes, notes, price
    })
    // Valor do agendamento vira lançamento no caixa (a receber)
    await syncAppointmentPayment(appointment).catch(() => {})
    res.status(201).json(appointment)
  } catch (error) {
    console.error('Erro ao criar agendamento:', error.message)
    res.status(500).json({ error: 'Erro interno ao criar agendamento' })
  }
})

const APPT_FIELDS = ['patient_id', 'patient_name', 'appointment_date', 'appointment_time', 'type',
  'duration_minutes', 'notes', 'status', 'price', 'payment_status', 'payment_method']
const APPT_STATUS = ['agendado', 'confirmado', 'atendimento', 'concluido', 'cancelado', 'falta']
const PAY_STATUS = ['pendente', 'pago', 'isento', 'pacote']

app.put('/api/appointments/:id', requireAuth, async (req, res) => {
  try {
    const updates = pick(req.body, APPT_FIELDS)
    if (updates.status && !APPT_STATUS.includes(updates.status)) return res.status(400).json({ error: 'Status inválido' })
    if (updates.payment_status && !PAY_STATUS.includes(updates.payment_status)) return res.status(400).json({ error: 'Situação de pagamento inválida' })
    if (updates.price === '' || (updates.price != null && isNaN(Number(updates.price)))) updates.price = null
    if (updates.patient_name !== undefined && !String(updates.patient_name).trim()) {
      return res.status(400).json({ error: 'Nome do paciente obrigatório' })
    }
    const appointment = await updateAppointment(req.params.id, updates)
    // Mantém caixa e pacote em dia com o que foi salvo no agendamento
    await syncAppointmentPackage(appointment).catch(() => {})
    const fresh = await getAppointment(req.params.id)
    await syncAppointmentPayment(fresh || appointment).catch(() => {})
    res.json(fresh || appointment)
  } catch (error) {
    console.error('Erro ao atualizar agendamento:', error.message)
    res.status(500).json({ error: 'Erro interno ao atualizar agendamento' })
  }
})

// Exclui agendamento (?scope=series apaga a série recorrente inteira).
// Estorna pacote e remove o lançamento do caixa junto.
app.delete('/api/appointments/:id', requireAuth, async (req, res) => {
  try {
    const appt = await getAppointment(req.params.id)
    if (!appt) return res.status(404).json({ error: 'Agendamento não encontrado' })

    if (req.query.scope === 'series' && appt.series_id) {
      const deleted = await deleteAppointmentSeries(appt.series_id)
      return res.json({ success: true, deleted })
    }

    await deleteAppointment(req.params.id)
    res.json({ success: true, deleted: 1 })
  } catch (error) {
    console.error('Erro ao excluir agendamento:', error.message)
    res.status(500).json({ error: 'Erro interno ao excluir agendamento' })
  }
})

// ─── Financeiro (item 6) ──────────────────────────────────────────────────────

app.post('/api/payments', requireAuth, async (req, res) => {
  try {
    const { amount } = req.body
    if (amount === undefined || amount === null || amount === '' || isNaN(Number(amount)) || Number(amount) < 0) {
      return res.status(400).json({ error: 'Valor do pagamento obrigatório' })
    }
    const status = req.body.status === 'pendente' ? 'pendente' : 'pago'
    res.status(201).json(await createPayment({
      ...pick(req.body, ['patient_id', 'method', 'paid_at', 'notes']),
      amount: Number(amount),
      status
    }))
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
    res.json(await updatePackage(req.params.id, pick(req.body, ['total_sessions', 'used_sessions', 'amount_paid', 'notes', 'active'])))
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

// ─── Pix estático ─────────────────────────────────────────────────────────────

app.get('/api/settings/pix', requireAuth, async (req, res) => {
  try {
    const cfg = (await getSetting('pix_config')) || {}
    res.json({
      ...cfg,
      provider: pixProvider(cfg),
      // Estado do Mercado Pago vem do ambiente (o token nunca sai daqui)
      mp_ready: mp.isConfigured(),
      mp_webhook_secret_set: !!(process.env.MERCADOPAGO_WEBHOOK_SECRET || '').trim(),
      webhook_url: `${process.env.BASE_URL || ''}/api/webhooks/mercadopago`
    })
  } catch (error) {
    res.json({ provider: 'none', mp_ready: mp.isConfigured() })
  }
})

// Testa a conexão com o Mercado Pago tentando gerar um QR Pix real — que é
// exatamente o que o totem/formulário fazem. (Não usamos /users/me: ele exige
// permissões que o token de pagamento não tem e falha mesmo com token válido.)
app.get('/api/settings/pix/test', requireAuth, async (req, res) => {
  try {
    const diag = mp.tokenDiag()
    if (!mp.isConfigured()) {
      return res.json({ ok: false, error: 'MERCADOPAGO_ACCESS_TOKEN não configurado no servidor (Coolify).', diag })
    }
    const live = mp.tokenMode() === 'live'
    try {
      const host = (process.env.BASE_URL || 'https://consultorio.local').replace(/^https?:\/\//, '').split('/')[0]
      const cobranca = await mp.createPixPayment({
        amount: 1,
        description: 'Teste de conexao',
        payerEmail: `teste@${host}`,
        externalReference: 'teste-conexao',
        expiresInMinutes: 5
      })
      if (cobranca.qr_code) return res.json({ ok: true, qr_ok: true, live })
      return res.json({ ok: true, qr_ok: false, live, qr_error: 'O Mercado Pago aceitou o token mas não devolveu o QR.', diag })
    } catch (e) {
      return res.json({ ok: false, error: e.message, diag })
    }
  } catch (error) {
    res.json({ ok: false, error: error.message })
  }
})

app.put('/api/settings/pix', requireAuth, async (req, res) => {
  try {
    const { provider } = req.body || {}
    const prov = provider === 'mercadopago' ? 'mercadopago' : 'none'

    if (prov === 'mercadopago' && !mp.isConfigured()) {
      return res.status(400).json({
        error: 'Falta a variável MERCADOPAGO_ACCESS_TOKEN no servidor (Coolify). Configure e faça o deploy antes de ativar.'
      })
    }

    const cfg = { provider: prov, enabled: prov !== 'none' }
    await setSetting('pix_config', cfg)
    res.json(cfg)
  } catch (error) {
    console.error('Erro ao salvar Pix:', error.message)
    res.status(500).json({ error: 'Erro interno ao salvar configuração do Pix' })
  }
})

// Só oferecemos Pix via Mercado Pago. Configs antigas (Pix estático) viram "none".
function pixProvider(cfg) {
  return cfg?.provider === 'mercadopago' ? 'mercadopago' : 'none'
}

// Descobre quanto cobrar por uma sessão
// Status de pagamento de uma sessão — anexado onde a sessão aparece para a Dra.
async function sessionPayment(session) {
  if (!session) return { status: 'none' }
  try {
    const pay = session.appointment_id
      ? await getPaymentByAppointment(session.appointment_id)
      : await getPaymentBySession(session.id)
    if (!pay) return { status: 'none' }
    return {
      status: pay.status,                                          // 'pago' | 'pendente'
      method: pay.method || null,
      amount: pay.amount,
      provider: pay.provider || null,
      confirmed: pay.status === 'pago' && !!pay.provider_payment_id // confirmado pelo provedor
    }
  } catch (_) {
    return { status: 'none' }
  }
}

async function sessionCharge(session) {
  const appointment = session.appointment_id ? await getAppointment(session.appointment_id) : null
  const prices = (await getSetting('default_prices')) || {}

  const covered = appointment?.payment_status === 'pacote' ? 'pacote'
                : appointment?.payment_status === 'isento' ? 'isento'
                : appointment?.payment_status === 'pago'   ? 'pago'
                : null

  const amount = appointment?.price != null
    ? Number(appointment.price)
    : (appointment?.type && prices[appointment.type] != null ? Number(prices[appointment.type]) : null)

  return {
    appointment,
    charge: { required: !covered && amount > 0, amount: amount ?? null, covered }
  }
}

// Cria (ou reaproveita) a cobrança Pix no Mercado Pago para esta sessão
async function ensureMercadoPagoCharge(session, appointment, amount) {
  const existing = appointment
    ? await getPaymentByAppointment(appointment.id)
    : await getPaymentBySession(session.id)

  // Já pago → nada a fazer
  if (existing?.status === 'pago') return existing

  // Cobrança ainda válida → reaproveita (não cria outra no MP)
  const aindaVale = existing?.provider === 'mercadopago'
    && existing.provider_payment_id
    && existing.qr_code
    && (!existing.expires_at || new Date(existing.expires_at) > new Date())
  if (aindaVale) return existing

  // Precisa de um e-mail do pagador — usa o do paciente, senão um genérico
  let payerEmail = null
  let payerName = String(session.patient_name || '').split(' ')[0] || undefined
  if (session.patient_id) {
    try {
      const p = await getPatient(session.patient_id)
      if (p?.email) payerEmail = p.email
    } catch (_) {}
  }
  if (!payerEmail) {
    const host = (process.env.BASE_URL || 'https://consultorio.local').replace(/^https?:\/\//, '').split('/')[0]
    payerEmail = `paciente@${host}`
  }

  const cobranca = await mp.createPixPayment({
    amount,
    description: `${appointment?.type || 'Consulta'} — ${session.patient_name}`,
    payerEmail,
    payerFirstName: payerName,
    externalReference: session.id,
    notificationUrl: `${process.env.BASE_URL}/api/webhooks/mercadopago`
  })

  const dados = {
    provider: 'mercadopago',
    provider_payment_id: cobranca.id,
    qr_code: cobranca.qr_code,
    qr_code_base64: cobranca.qr_code_base64,
    expires_at: cobranca.expires_at,
    amount,
    method: 'pix',
    status: 'pendente'
  }

  if (existing) return await updatePayment(existing.id, dados)

  return await createPayment({
    ...dados,
    patient_id: session.patient_id || null,
    appointment_id: appointment?.id || null,
    session_id: session.id,
    paid_at: appointment?.appointment_date || todayBR()
  })
}

// Cobrança + Pix de uma sessão (público — o celular/totem consulta pelo id da
// sessão, que é um UUID não adivinhável)
app.get('/api/sessions/:id/pix', async (req, res) => {
  try {
    const session = await getSession(req.params.id)
    if (!session) return res.status(404).json({ error: 'Sessão não encontrada' })

    const { appointment, charge } = await sessionCharge(session)
    const cfg = (await getSetting('pix_config')) || {}
    const provider = pixProvider(cfg)

    const out = { charge, pix: { enabled: false } }

    if (!charge.required) return res.json(out)

    // ── Mercado Pago (Pix dinâmico, confirmação automática) ──
    if (provider === 'mercadopago' && mp.isConfigured()) {
      try {
        const pay = await ensureMercadoPagoCharge(session, appointment, charge.amount)
        if (pay?.status === 'pago') {
          out.pix = { enabled: true, provider: 'mercadopago', already_paid: true }
        } else if (pay?.qr_code) {
          out.pix = {
            enabled: true,
            provider: 'mercadopago',
            auto_confirm: true,
            brcode: pay.qr_code,
            qr_code_base64: pay.qr_code_base64,
            expires_at: pay.expires_at
          }
        }
      } catch (e) {
        console.error('Erro no Mercado Pago:', e.message)
        // Sem fallback: se o MP falhar, o formulário simplesmente não mostra o Pix
      }
    }

    res.json(out)
  } catch (error) {
    console.error('Erro ao gerar Pix da sessão:', error.message)
    res.status(500).json({ error: 'Erro interno ao gerar Pix' })
  }
})

// Status do pagamento da sessão — o celular/totem consulta para mostrar o "✓"
app.get('/api/sessions/:id/payment-status', async (req, res) => {
  try {
    const session = await getSession(req.params.id)
    if (!session) return res.status(404).json({ error: 'Sessão não encontrada' })

    const pay = session.appointment_id
      ? await getPaymentByAppointment(session.appointment_id)
      : await getPaymentBySession(session.id)

    res.json({ status: pay?.status || 'none', provider: pay?.provider || null })
  } catch (error) {
    res.status(500).json({ status: 'none' })
  }
})

// ─── Webhook do Mercado Pago ─────────────────────────────────────────────────
// Confirma o pagamento sozinho: sem isso, o financeiro voltaria a ser manual.
app.post('/api/webhooks/mercadopago', async (req, res) => {
  // O MP espera uma resposta rápida; processamos depois de responder.
  res.status(200).send('ok')

  try {
    const dataId = req.query['data.id'] || req.body?.data?.id || req.query.id
    const tipo   = req.body?.type || req.query.type || req.query.topic
    if (!dataId) return
    if (tipo && tipo !== 'payment') return   // ignora merchant_order etc.

    const valido = mp.verifyWebhookSignature({
      xSignature: req.headers['x-signature'],
      xRequestId: req.headers['x-request-id'],
      dataId
    })
    if (!valido) {
      console.warn('Webhook Mercado Pago: assinatura inválida — ignorado.')
      return
    }

    const pagamento = await mp.getPayment(dataId)
    const nosso = await getPaymentByProviderId(String(pagamento.id))
    if (!nosso) {
      console.warn(`Webhook MP: pagamento ${pagamento.id} não encontrado no caixa.`)
      return
    }

    if (pagamento.status === 'approved') {
      const dataPag = pagamento.date_approved
        ? String(pagamento.date_approved).slice(0, 10)
        : todayBR()

      await updatePayment(nosso.id, { status: 'pago', method: 'pix', paid_at: dataPag })

      if (nosso.appointment_id) {
        await updateAppointment(nosso.appointment_id, {
          payment_status: 'pago',
          payment_method: 'pix'
        }).catch(() => {})
      }
      pollSoon()   // painel, totem e celular veem o pagamento na hora
      console.log(`✅ Pix confirmado pelo Mercado Pago (pagamento ${pagamento.id}).`)
    }
  } catch (error) {
    console.error('Erro ao processar webhook do Mercado Pago:', error.message)
  }
})

// Tabela de preços padrão por tipo de atendimento
app.get('/api/settings/prices', requireAuth, async (req, res) => {
  try {
    res.json((await getSetting('default_prices')) || {})
  } catch (error) {
    res.json({})
  }
})

app.put('/api/settings/prices', requireAuth, async (req, res) => {
  try {
    const prices = {}
    for (const [k, v] of Object.entries(req.body || {})) {
      const n = Number(v)
      if (k && !isNaN(n) && n >= 0) prices[k] = n
    }
    await setSetting('default_prices', prices)
    res.json(prices)
  } catch (error) {
    console.error('Erro ao salvar preços:', error.message)
    res.status(500).json({ error: 'Erro interno ao salvar preços' })
  }
})

app.get('/api/reports/monthly', requireAuth, async (req, res) => {
  try {
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : todayBR().slice(0, 7)
    res.json(await getMonthlyReport(month))
  } catch (error) {
    console.error('Erro no relatório mensal:', error.message)
    res.status(500).json({ error: 'Erro interno no relatório' })
  }
})

// Períodos longos agrupam por mês; curtos, por dia
function pickGranularity(start, end, requested) {
  if (requested) return requested
  const days = (new Date(end) - new Date(start)) / 86400000
  return days > 62 ? 'month' : 'day'
}

// Financeiro: receita, a receber, formas de pagamento
app.get('/api/reports/overview', requireAuth, async (req, res) => {
  try {
    const { start, end } = req.query
    if (!start || !end) return res.status(400).json({ error: 'Informe start e end (YYYY-MM-DD)' })
    res.json(await getOverviewReport(start, end, pickGranularity(start, end, req.query.granularity)))
  } catch (error) {
    console.error('Erro no relatório geral:', error.message)
    res.status(500).json({ error: 'Erro interno no relatório' })
  }
})

// Dashboard clínico/operacional: sessões, presença, tipos, horários, dor, regiões
app.get('/api/reports/clinical', requireAuth, async (req, res) => {
  try {
    const { start, end } = req.query
    if (!start || !end) return res.status(400).json({ error: 'Informe start e end (YYYY-MM-DD)' })
    res.json(await getClinicalReport(start, end, pickGranularity(start, end, req.query.granularity)))
  } catch (error) {
    console.error('Erro no relatório clínico:', error.message)
    res.status(500).json({ error: 'Erro interno no relatório' })
  }
})

// Lista de lançamentos do período (pagos e em aberto)
app.get('/api/reports/payments', requireAuth, async (req, res) => {
  try {
    const { start, end } = req.query
    if (!start || !end) return res.status(400).json({ error: 'Informe start e end (YYYY-MM-DD)' })
    res.json(await getPaymentsInPeriod(start, end))
  } catch (error) {
    console.error('Erro ao listar lançamentos:', error.message)
    res.status(500).json({ error: 'Erro interno ao listar lançamentos' })
  }
})

// Alterar um lançamento (ex.: marcar em aberto como pago)
app.put('/api/payments/:id', requireAuth, async (req, res) => {
  try {
    const updates = {}
    for (const k of ['amount', 'method', 'status', 'paid_at', 'notes']) {
      if (req.body[k] !== undefined) updates[k] = req.body[k]
    }
    const payment = await updatePayment(req.params.id, updates)

    // Mantém o agendamento coerente com o lançamento
    if (payment.appointment_id && updates.status) {
      await updateAppointment(payment.appointment_id, {
        payment_status: updates.status,
        ...(updates.method ? { payment_method: updates.method } : {})
      }).catch(() => {})
    }
    res.json(payment)
  } catch (error) {
    console.error('Erro ao atualizar lançamento:', error.message)
    res.status(500).json({ error: 'Erro interno ao atualizar lançamento' })
  }
})

app.delete('/api/payments/:id', requireAuth, async (req, res) => {
  try {
    await deletePayment(req.params.id)
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: 'Erro interno ao excluir lançamento' })
  }
})

// ─── Calibração de acupuntura no banco (item 3) ───────────────────────────────
// Chave v2: as posições automáticas agora são geradas a partir do modelo 3D
// (tools/acupoints). A calibração antiga ('acu_calibration') foi feita sobre as
// referências erradas do modelo anterior (ex.: LI11 e LI15 trocados) — fica
// preservada no banco, mas não é mais aplicada.
const CALIBRATION_KEY = 'acu_calibration_v2'

app.get('/api/calibrate', async (req, res) => {
  try {
    res.json((await getSetting(CALIBRATION_KEY)) || {})
  } catch (error) {
    res.json({})
  }
})

app.post('/api/calibrate/save', requireAuth, async (req, res) => {
  try {
    // Formato: { "LU7": {x, y, z}, "LU7-E": {x, y, z}, ... } — só números
    const clean = {}
    for (const [id, c] of Object.entries(req.body || {})) {
      if (!/^[A-Za-z0-9-]{1,20}$/.test(id) || !c) continue
      const x = Number(c.x), y = Number(c.y), z = Number(c.z)
      if ([x, y, z].every(Number.isFinite) && Math.abs(x) < 2 && y > -0.5 && y < 2.5 && Math.abs(z) < 2) {
        clean[id] = { x, y, z }
      }
    }
    await setSetting(CALIBRATION_KEY, clean)
    res.json({ ok: true, count: Object.keys(clean).length })
  } catch (error) {
    console.error('Erro ao salvar calibração:', error.message)
    res.status(500).json({ error: 'Erro ao salvar calibração' })
  }
})

// ─── SSE — poller único no servidor + fan-out (item 13) ──────────────────────

const sseClients = { public: new Set(), doctor: new Set() }
let lastJson = { public: '', doctor: '' }
let lastSnapshot = { public: null, doctor: null }
let pollTimer = null
let polling = false, pollAgain = false, soonTimer = null

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
// Chamado após qualquer ação que muda o estado: todas as telas atualizam em
// ~150 ms em vez de esperar o próximo ciclo do poller.
function pollSoon() {
  if (soonTimer || (!sseClients.public.size && !sseClients.doctor.size)) return
  soonTimer = setTimeout(() => { soonTimer = null; pollOnce() }, 150)
}

// O que a TV da sala de atendimento mostra: a sessão em andamento e o último
// conteúdo publicado nela. Sem nome nem dados do paciente (canal público).
async function tvState() {
  const tv = await getTvSession()
  if (!tv) return { session_id: null, anatomy: null }
  const ev = await getLatestAnatomyEvent(tv.id)
  const anatomy = ev
    ? { id: ev.id, region: ev.region, problem: ev.problem, ai_explanation: ev.ai_explanation, created_at: ev.created_at }
    : null
  return { session_id: tv.id, anatomy }
}

async function pollOnce() {
  // Evita consultas sobrepostas quando o banco demora
  if (polling) { pollAgain = true; return }
  polling = true
  try {
    if (sseClients.public.size > 0) {
      const payload = { type: 'public', totem: await publicTotemState(), shared: await tvState() }
      const json = JSON.stringify(payload)
      if (json !== lastJson.public) { lastJson.public = json; broadcast('public', payload) }
    }
    if (sseClients.doctor.size > 0) {
      const [pending, active, queue] = await Promise.all([getPendingNotification(), getActiveSession(), getQueue()])
      // Anexa o status de pagamento — quando o webhook do Pix confirma, o JSON
      // muda e o painel atualiza sozinho (notificação, barra de sessão, etc.)
      if (pending) pending.payment = await sessionPayment(pending)
      if (active)  active.payment  = await sessionPayment(active)
      const payload = { type: 'doctor', pending: pending || null, active: active || null, queue }
      const json = JSON.stringify(payload)
      if (json !== lastJson.doctor) { lastJson.doctor = json; broadcast('doctor', payload) }
    }
  } catch (error) {
    console.error('Erro no poller SSE:', error.message)
  } finally {
    polling = false
    if (pollAgain) { pollAgain = false; pollSoon() }
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

// Público — totem e tela do paciente (sem dados de saúde)
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
