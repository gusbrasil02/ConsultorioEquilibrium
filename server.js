import 'dotenv/config'
import express from 'express'
import { v4 as uuidv4 } from 'uuid'
import QRCode from 'qrcode'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

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
  getIncomingSession,
  setSessionWait,
  setSessionCanEnter,
  startSession,
  finishSession,
  getTotemState
} from './database.js'
import { generateAnatomyExplanation } from './ai.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// ─── Sessões ────────────────────────────────────────────────────────────────

// Inicia nova sessão e gera QR Code
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

// Salva respostas e marca sessão como completada
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

// Rotas /latest/* devem vir antes de /:id para evitar conflito de matching no Express

// Sessão pendente de notificação (polling da tela da Dra.)
app.get('/api/sessions/latest/pending-notification', async (req, res) => {
  try {
    const session = await getPendingNotification()
    if (!session) return res.status(404).json({ error: 'Nenhuma notificação pendente' })
    res.json(session)
  } catch (error) {
    console.error('Erro ao buscar notificação:', error.message)
    res.status(500).json({ error: 'Erro interno' })
  }
})

// Busca dados de uma sessão por ID
app.get('/api/sessions/:id', async (req, res) => {
  try {
    const { id } = req.params
    const session = await getSession(id)
    if (!session) {
      return res.status(404).json({ error: 'Sessão não encontrada ou expirada' })
    }
    res.json(session)
  } catch (error) {
    console.error('Erro ao buscar sessão:', error.message)
    res.status(500).json({ error: 'Erro interno' })
  }
})

// Dra. confirma chegada do paciente
app.post('/api/sessions/:id/acknowledge', async (req, res) => {
  try {
    await acknowledgeSession(req.params.id)
    res.json({ success: true })
  } catch (error) {
    console.error('Erro ao confirmar sessão:', error.message)
    res.status(500).json({ error: 'Erro interno' })
  }
})

// Última sessão confirmada (polling da tela compartilhada)
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

// Histórico de sessões anteriores do paciente
app.get('/api/sessions/:id/history', async (req, res) => {
  try {
    const session = await getSession(req.params.id)
    if (!session) return res.status(404).json({ error: 'Sessão não encontrada' })

    const [history, total] = await Promise.all([
      getPatientHistory(session.patient_name, req.params.id),
      countPatientSessions(session.patient_name)
    ])

    res.json({ history, total_sessions: total })
  } catch (error) {
    console.error('Erro ao buscar histórico:', error.message)
    res.status(500).json({ error: 'Erro interno' })
  }
})

// ─── Controle de fluxo de sessão ─────────────────────────────────────────────

// Estado atual do totem (polling a cada 3s)
app.get('/api/totem/state', async (req, res) => {
  try {
    const state = await getTotemState()
    res.json(state)
  } catch (error) {
    console.error('Erro ao buscar estado do totem:', error.message)
    res.status(500).json({ state: 'idle' })
  }
})

// Sessão ativa (in_session) — usada pelo dashboard
app.get('/api/sessions/active', async (req, res) => {
  try {
    const session = await getActiveSession()
    if (!session) return res.status(404).json({ error: 'Sem sessão ativa' })
    res.json(session)
  } catch (error) {
    console.error('Erro ao buscar sessão ativa:', error.message)
    res.status(500).json({ error: 'Erro interno' })
  }
})

// Dra. diz "aguardar"
app.post('/api/sessions/:id/wait', async (req, res) => {
  try {
    await setSessionWait(req.params.id)
    res.json({ success: true })
  } catch (error) {
    console.error('Erro ao setar wait:', error.message)
    res.status(500).json({ error: 'Erro interno' })
  }
})

// Dra. diz "pode entrar"
app.post('/api/sessions/:id/can-enter', async (req, res) => {
  try {
    await setSessionCanEnter(req.params.id)
    res.json({ success: true })
  } catch (error) {
    console.error('Erro ao setar can-enter:', error.message)
    res.status(500).json({ error: 'Erro interno' })
  }
})

// Dra. inicia a sessão (cronômetro começa)
app.post('/api/sessions/:id/begin', async (req, res) => {
  try {
    await startSession(req.params.id)
    res.json({ success: true })
  } catch (error) {
    console.error('Erro ao iniciar sessão:', error.message)
    res.status(500).json({ error: 'Erro interno' })
  }
})

// Dra. finaliza a sessão (aceita anotações e atualiza agendamento)
app.post('/api/sessions/:id/end', async (req, res) => {
  try {
    const { session_notes, session_observations } = req.body
    const session = await getSession(req.params.id)
    await finishSession(req.params.id, { session_notes, session_observations })
    // Atualiza agendamento independente do resultado das notas
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

// Gera explicação da IA e salva no Supabase
app.post('/api/anatomy/explain', async (req, res) => {
  try {
    const { session_id, region, problem } = req.body

    if (!session_id || !region || !problem) {
      return res.status(400).json({ error: 'session_id, region e problem são obrigatórios' })
    }

    const session = await getSession(session_id)
    if (!session) return res.status(404).json({ error: 'Sessão não encontrada' })

    const explanation = await generateAnatomyExplanation(region, problem, session.patient_name)

    await saveAnatomyEvent({ session_id, region, problem, ai_explanation: explanation })

    res.json({ explanation })
  } catch (error) {
    console.error('Erro ao gerar explicação anatômica:', error.message)
    res.status(500).json({ error: 'Erro interno ao gerar explicação' })
  }
})

// Evento anatômico mais recente de uma sessão (polling da tela compartilhada)
app.get('/api/anatomy/latest/:session_id', async (req, res) => {
  try {
    const event = await getLatestAnatomyEvent(req.params.session_id)
    if (!event) return res.status(404).json({ error: 'Nenhum evento encontrado' })
    res.json(event)
  } catch (error) {
    console.error('Erro ao buscar evento anatômico:', error.message)
    res.status(500).json({ error: 'Erro interno' })
  }
})

// Salva seleção de pontos de acupuntura para exibição na tela compartilhada
app.post('/api/acupuncture/event', async (req, res) => {
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
    console.error('Erro ao salvar evento de acupuntura:', error.message)
    res.status(500).json({ error: 'Erro interno' })
  }
})

// ─── Pacientes ───────────────────────────────────────────────────────────────

// Rota de busca deve vir antes de /:id para evitar conflito de matching no Express
app.get('/api/patients/search', async (req, res) => {
  try {
    const { q } = req.query
    if (!q?.trim()) return res.json([])
    const patients = await searchPatients(q.trim())
    res.json(patients)
  } catch (error) {
    console.error('Erro ao buscar pacientes:', error.message)
    res.status(500).json({ error: 'Erro interno ao buscar pacientes' })
  }
})

// Lista todos os pacientes
app.get('/api/patients', async (req, res) => {
  try {
    const patients = await getPatients()
    res.json(patients)
  } catch (error) {
    console.error('Erro ao listar pacientes:', error.message)
    res.status(500).json({ error: 'Erro interno ao listar pacientes' })
  }
})

// Cria novo paciente
app.post('/api/patients', async (req, res) => {
  try {
    const { name, phone, email, birth_date, condition, notes } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'Nome do paciente obrigatório' })
    const patient = await createPatient({ name: name.trim(), phone, email, birth_date, condition, notes })
    res.status(201).json(patient)
  } catch (error) {
    console.error('Erro ao criar paciente:', error.message)
    res.status(500).json({ error: 'Erro interno ao criar paciente' })
  }
})

// Analytics do paciente — sessões + eventos anatômicos para gráficos
app.get('/api/patients/:id/analytics', async (req, res) => {
  try {
    const patient = await getPatient(req.params.id)
    if (!patient) return res.status(404).json({ error: 'Paciente não encontrado' })

    const [sessions, anatomyEvents] = await Promise.all([
      getPatientSessions(patient.name),
      getPatientAnatomyEvents(patient.name)
    ])

    res.json({ patient, sessions, anatomy_events: anatomyEvents })
  } catch (error) {
    console.error('Erro ao buscar analytics do paciente:', error.message)
    res.status(500).json({ error: 'Erro interno ao buscar analytics' })
  }
})

// Detalhes de um paciente
app.get('/api/patients/:id', async (req, res) => {
  try {
    const patient = await getPatient(req.params.id)
    if (!patient) return res.status(404).json({ error: 'Paciente não encontrado' })
    res.json(patient)
  } catch (error) {
    console.error('Erro ao buscar paciente:', error.message)
    res.status(500).json({ error: 'Erro interno ao buscar paciente' })
  }
})

// Atualiza paciente
app.put('/api/patients/:id', async (req, res) => {
  try {
    const patient = await updatePatient(req.params.id, req.body)
    res.json(patient)
  } catch (error) {
    console.error('Erro ao atualizar paciente:', error.message)
    res.status(500).json({ error: 'Erro interno ao atualizar paciente' })
  }
})

// ─── Agendamentos ─────────────────────────────────────────────────────────────

// Lista agendamentos — por data ou por range de datas
app.get('/api/appointments', async (req, res) => {
  try {
    const { date, start, end } = req.query
    if (date) {
      const appointments = await getAppointmentsByDate(date)
      return res.json(appointments)
    }
    if (start && end) {
      const appointments = await getAppointmentsByRange(start, end)
      return res.json(appointments)
    }
    res.status(400).json({ error: 'Forneça date ou start+end como parâmetros' })
  } catch (error) {
    console.error('Erro ao buscar agendamentos:', error.message)
    res.status(500).json({ error: 'Erro interno ao buscar agendamentos' })
  }
})

// Cria novo agendamento
app.post('/api/appointments', async (req, res) => {
  try {
    const { patient_id, patient_name, appointment_date, appointment_time, type, duration_minutes, notes } = req.body
    if (!patient_name?.trim()) return res.status(400).json({ error: 'Nome do paciente obrigatório' })
    if (!appointment_date) return res.status(400).json({ error: 'Data do agendamento obrigatória' })
    if (!appointment_time) return res.status(400).json({ error: 'Horário do agendamento obrigatório' })
    if (!type) return res.status(400).json({ error: 'Tipo de atendimento obrigatório' })

    const appointment = await createAppointment({
      patient_id, patient_name: patient_name.trim(),
      appointment_date, appointment_time, type, duration_minutes, notes
    })
    res.status(201).json(appointment)
  } catch (error) {
    console.error('Erro ao criar agendamento:', error.message)
    res.status(500).json({ error: 'Erro interno ao criar agendamento' })
  }
})

// Atualiza agendamento (status, observações, etc.)
app.put('/api/appointments/:id', async (req, res) => {
  try {
    const appointment = await updateAppointment(req.params.id, req.body)
    res.json(appointment)
  } catch (error) {
    console.error('Erro ao atualizar agendamento:', error.message)
    res.status(500).json({ error: 'Erro interno ao atualizar agendamento' })
  }
})

// ─── Calibração de pontos de acupuntura ─────────────────────────────────────

// Salva JSON calibrado em public/js/acu-points-calibrated.json
app.post('/api/calibrate/save', (req, res) => {
  try {
    const json = JSON.stringify(req.body, null, 2)
    const dest = path.join(__dirname, 'public', 'js', 'acu-points-calibrated.json')
    fs.writeFileSync(dest, json, 'utf8')
    res.json({ ok: true })
  } catch (e) {
    console.error('Erro ao salvar calibração:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ─── Inicialização ───────────────────────────────────────────────────────────

app.listen(PORT, async () => {
  console.log(`\nServidor rodando em http://localhost:${PORT}`)
  console.log(`BASE_URL: ${process.env.BASE_URL || 'não configurada'}`)
  await testConnection()
  console.log('\nURLs do sistema:')
  console.log(`  Totem (sala de espera): http://localhost:${PORT}/totem`)
  console.log(`  Painel da Dra.:         http://localhost:${PORT}/doctor`)
  console.log(`  Tela do paciente:       http://localhost:${PORT}/shared\n`)
})
