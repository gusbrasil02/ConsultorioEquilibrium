import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// Testar conexão ao iniciar
async function testConnection() {
  const { error } = await supabase.from('sessions').select('id').limit(1)
  if (error) {
    console.error('Erro ao conectar ao Supabase:', error.message)
    return false
  }
  console.log('Supabase conectado com sucesso')
  return true
}

async function createSession({ id, patient_name, expires_at, patient_id, appointment_id }) {
  const { data, error } = await supabase
    .from('sessions')
    .insert({
      id,
      patient_name,
      expires_at,
      status: 'waiting',
      ...(patient_id    ? { patient_id }    : {}),
      ...(appointment_id ? { appointment_id } : {})
    })
    .select()
    .single()

  if (error) throw error
  return data
}

// Busca sessão por ID — ignora sessões expiradas
async function getSession(id) {
  const { data, error } = await supabase
    .from('sessions')
    .select('*, answers(*)')
    .eq('id', id)
    .gt('expires_at', new Date().toISOString())
    .single()

  if (error) return null
  return data
}

// Salva respostas do formulário — uma linha por pergunta
async function saveAnswers(session_id, answers) {
  const rows = Object.entries(answers).map(([question_key, answer_value]) => ({
    session_id,
    question_key,
    answer_value: String(answer_value)
  }))

  const { error } = await supabase.from('answers').insert(rows)
  if (error) throw error
}

async function completeSession(id) {
  const { error } = await supabase
    .from('sessions')
    .update({ completed_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw error
}

// Busca sessão completada e ainda não notificada (mais recente)
async function getPendingNotification() {
  const { data, error } = await supabase
    .from('sessions')
    .select('*, answers(*)')
    .eq('notified', false)
    .not('completed_at', 'is', null)
    .gt('expires_at', new Date().toISOString())
    .order('completed_at', { ascending: false })
    .limit(1)
    .single()

  if (error) return null
  return data
}

// Marca sessão como notificada (Dra. clicou OK)
async function acknowledgeSession(id) {
  const { error } = await supabase
    .from('sessions')
    .update({ notified: true })
    .eq('id', id)

  if (error) throw error
}

// Busca última sessão já confirmada pela Dra. (para tela compartilhada)
async function getLatestAcknowledged() {
  const { data, error } = await supabase
    .from('sessions')
    .select('*, answers(*)')
    .eq('notified', true)
    .not('completed_at', 'is', null)
    .gt('expires_at', new Date().toISOString())
    .order('completed_at', { ascending: false })
    .limit(1)
    .single()

  if (error) return null
  return data
}

// Aplica o filtro de paciente preferindo patient_id (evita confundir homônimos
// e não quebra o histórico por erro de digitação no nome). Cai para o nome
// apenas quando não há patient_id (sessões avulsas antigas do totem).
function byPatient(query, patient_name, patient_id) {
  return patient_id ? query.eq('patient_id', patient_id) : query.eq('patient_name', patient_name)
}

// Busca últimas 3 sessões anteriores do mesmo paciente
async function getPatientHistory(patient_name, current_session_id, patient_id) {
  const { data, error } = await byPatient(
    supabase.from('sessions').select('*, answers(*)'),
    patient_name, patient_id
  )
    .neq('id', current_session_id)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(3)

  if (error) return []
  return data || []
}

// Conta total de sessões completadas do paciente (incluindo a atual)
async function countPatientSessions(patient_name, patient_id) {
  const { count, error } = await byPatient(
    supabase.from('sessions').select('id', { count: 'exact', head: true }),
    patient_name, patient_id
  ).not('completed_at', 'is', null)

  if (error) return 1
  return count || 1
}

async function saveAnatomyEvent({ session_id, region, problem, ai_explanation }) {
  const { data, error } = await supabase
    .from('anatomy_events')
    .insert({ session_id, region, problem, ai_explanation })
    .select()
    .single()

  if (error) throw error
  return data
}

// Busca evento anatômico mais recente de uma sessão
async function getLatestAnatomyEvent(session_id) {
  const { data, error } = await supabase
    .from('anatomy_events')
    .select('*')
    .eq('session_id', session_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error) return null
  return data
}

// ─── Controle de fluxo de sessão ─────────────────────────────────────────────

// Retorna a sessão atualmente em andamento (status = in_session)
async function getActiveSession() {
  const { data, error } = await supabase
    .from('sessions')
    .select('*, answers(*)')
    .eq('status', 'in_session')
    .gt('expires_at', new Date().toISOString())
    .order('started_at', { ascending: false })
    .limit(1)
    .single()

  if (error) return null
  return data
}

// Retorna sessão aguardando resposta da Dra. ou aguardando entrar (waiting / wait / can_enter)
async function getIncomingSession() {
  const { data, error } = await supabase
    .from('sessions')
    .select('*, answers(*)')
    .in('status', ['waiting', 'wait', 'can_enter'])
    .not('completed_at', 'is', null)
    .gt('expires_at', new Date().toISOString())
    .order('completed_at', { ascending: false })
    .limit(1)
    .single()

  if (error) return null
  return data
}

// Dra. diz "aguardar" — status wait, notified true
async function setSessionWait(id) {
  const { error } = await supabase
    .from('sessions')
    .update({ status: 'wait', notified: true })
    .eq('id', id)
  if (error) throw error
}

// Dra. diz "pode entrar" — status can_enter, notified true
async function setSessionCanEnter(id) {
  const { error } = await supabase
    .from('sessions')
    .update({ status: 'can_enter', notified: true })
    .eq('id', id)
  if (error) throw error
}

// Dra. inicia sessão — status in_session, started_at agora
async function startSession(id) {
  const { error } = await supabase
    .from('sessions')
    .update({ status: 'in_session', started_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// Dra. finaliza sessão — status finished, finished_at agora, salva prontuário
async function finishSession(id, notes = {}) {
  // Sempre marca como finalizada (status + tempo)
  const { error } = await supabase
    .from('sessions')
    .update({ status: 'finished', finished_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error

  // Salva prontuário separadamente — falha silenciosa caso colunas não existam
  const cols = ['session_notes', 'session_observations', 'session_complaint',
                'session_conduct', 'session_evolution', 'session_plan']
  const noteUpdates = {}
  for (const c of cols) if (notes[c] !== undefined) noteUpdates[c] = notes[c]
  if (Object.keys(noteUpdates).length > 0) {
    try { await supabase.from('sessions').update(noteUpdates).eq('id', id) } catch (_) {}
  }
}

// Retorna data e hora no fuso de Brasília (UTC-3), independente do servidor
function brasiliaDateTime() {
  const brt = new Date(Date.now() - 3 * 60 * 60 * 1000)
  const iso = brt.toISOString()
  return {
    dateStr: iso.slice(0, 10),         // 'YYYY-MM-DD'
    timeStr: iso.slice(11, 16),        // 'HH:MM'
    minutesOfDay: parseInt(iso.slice(11, 13)) * 60 + parseInt(iso.slice(14, 16))
  }
}

// Próximo agendamento do dia que ainda não tem sessão vinculada.
// Inclui agendamentos a partir de 60 min atrás para tolerar atrasos.
async function getNextAppointmentForTotem(dateStr, fromTimeStr) {
  const { data, error } = await supabase
    .from('appointments')
    .select('*')
    .eq('appointment_date', dateStr)
    .in('status', ['agendado', 'confirmado'])
    .gte('appointment_time', fromTimeStr)
    .order('appointment_time')
    .limit(5)

  if (error || !data || data.length === 0) return null

  // Filtra agendamentos que já têm sessão não-terminada vinculada
  for (const appt of data) {
    const { data: linked } = await supabase
      .from('sessions')
      .select('id, status')
      .eq('appointment_id', appt.id)
      .in('status', ['waiting', 'wait', 'can_enter', 'in_session', 'finished'])
      .limit(1)
      .single()

    if (!linked) return appt  // sem sessão ativa → este é o próximo
  }

  return null
}

// Composição: retorna o estado atual do totem
async function getTotemState() {
  // 1. Há sessão chegando? (waiting/wait/can_enter)
  const incoming = await getIncomingSession()
  if (incoming) {
    return {
      state: incoming.status,  // 'waiting' | 'wait' | 'can_enter'
      patient_name: incoming.patient_name,
      session_id: incoming.id
    }
  }

  // 2. Há sessão ativa? (in_session)
  const active = await getActiveSession()

  // 3. Próximo agendamento — sempre em horário de Brasília (UTC-3)
  const { dateStr, timeStr, minutesOfDay } = brasiliaDateTime()

  // Janela de busca: 60 min atrás (tolera atrasos) até o fim do dia
  const windowStart = minutesOfDay - 60
  const fromHH  = String(Math.floor(Math.max(windowStart, 0) / 60)).padStart(2, '0')
  const fromMM  = String(Math.max(windowStart, 0) % 60).padStart(2, '0')
  const fromTimeStr = `${fromHH}:${fromMM}`

  const next = await getNextAppointmentForTotem(dateStr, fromTimeStr)

  if (next) {
    const apptTime = next.appointment_time.slice(0, 5)
    const [aH, aM] = apptTime.split(':').map(Number)
    const apptMinutes = aH * 60 + aM

    // Mostra se: há sessão ativa (próximo pode se preparar)
    //         OU o agendamento está a ≤ 30 min de distância (chegando) ou já passou
    const sessionActive = active !== null
    const comingSoon    = apptMinutes <= minutesOfDay + 30

    if (sessionActive || comingSoon) {
      return {
        state: 'show_patient',
        patient_name: next.patient_name,
        appointment_time: apptTime,
        appointment_id: next.id,
        patient_id: next.patient_id || null
      }
    }
  }

  return { state: 'idle' }
}

// ─── Pacientes ───────────────────────────────────────────────────────────────

// Lista todos os pacientes em ordem alfabética
async function getPatients() {
  try {
    const { data, error } = await supabase
      .from('patients')
      .select('*')
      .order('name')
    if (error) throw error
    return data || []
  } catch (error) {
    console.error('Erro ao listar pacientes:', error.message)
    throw error
  }
}

// Busca paciente por ID com contagem de sessões
async function getPatient(id) {
  try {
    const { data, error } = await supabase
      .from('patients')
      .select('*')
      .eq('id', id)
      .single()
    if (error) throw error

    // Conta sessões completadas do paciente (por vínculo de id, com fallback nome)
    const { count } = await byPatient(
      supabase.from('sessions').select('id', { count: 'exact', head: true }),
      data.name, data.id
    ).not('completed_at', 'is', null)

    return { ...data, session_count: count || 0 }
  } catch (error) {
    console.error('Erro ao buscar paciente:', error.message)
    throw error
  }
}

// Cria novo paciente
async function createPatient({ name, phone, email, birth_date, condition, notes }) {
  try {
    const { data, error } = await supabase
      .from('patients')
      .insert({ name, phone, email, birth_date: birth_date || null, condition, notes })
      .select()
      .single()
    if (error) throw error
    return data
  } catch (error) {
    console.error('Erro ao criar paciente:', error.message)
    throw error
  }
}

// Atualiza dados de um paciente
async function updatePatient(id, updates) {
  try {
    const { data, error } = await supabase
      .from('patients')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data
  } catch (error) {
    console.error('Erro ao atualizar paciente:', error.message)
    throw error
  }
}

// Busca pacientes por nome (busca parcial, case-insensitive)
async function searchPatients(query) {
  try {
    const { data, error } = await supabase
      .from('patients')
      .select('*')
      .ilike('name', `%${query}%`)
      .order('name')
      .limit(20)
    if (error) throw error
    return data || []
  } catch (error) {
    console.error('Erro ao buscar pacientes:', error.message)
    throw error
  }
}

// ─── Agendamentos ─────────────────────────────────────────────────────────────

// Busca agendamentos de uma data específica (string 'YYYY-MM-DD')
async function getAppointmentsByDate(date) {
  try {
    const { data, error } = await supabase
      .from('appointments')
      .select('*')
      .eq('appointment_date', date)
      .order('appointment_time')
    if (error) throw error
    return data || []
  } catch (error) {
    console.error('Erro ao buscar agendamentos por data:', error.message)
    throw error
  }
}

// Busca agendamentos de um intervalo de datas (para visão semanal/mensal)
async function getAppointmentsByRange(start, end) {
  try {
    const { data, error } = await supabase
      .from('appointments')
      .select('*')
      .gte('appointment_date', start)
      .lte('appointment_date', end)
      .order('appointment_date')
      .order('appointment_time')
    if (error) throw error
    return data || []
  } catch (error) {
    console.error('Erro ao buscar agendamentos por período:', error.message)
    throw error
  }
}

// Cria novo agendamento
async function createAppointment({ patient_id, patient_name, appointment_date, appointment_time, type, duration_minutes, notes, price, payment_status }) {
  try {
    const row = {
      patient_id: patient_id || null,
      patient_name,
      appointment_date,
      appointment_time,
      type,
      duration_minutes: duration_minutes || 60,
      notes
    }
    // Valor precisa ser gravado — sem ele o caixa nunca gera o "a receber"
    if (price !== undefined && price !== null && price !== '' && !isNaN(Number(price))) {
      row.price = Number(price)
    }
    if (payment_status) row.payment_status = payment_status

    const { data, error } = await supabase
      .from('appointments')
      .insert(row)
      .select()
      .single()
    if (error) throw error
    return data
  } catch (error) {
    console.error('Erro ao criar agendamento:', error.message)
    throw error
  }
}

// Atualiza um agendamento (status, observações, etc.)
async function updateAppointment(id, updates) {
  try {
    const { data, error } = await supabase
      .from('appointments')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data
  } catch (error) {
    console.error('Erro ao atualizar agendamento:', error.message)
    throw error
  }
}

// Busca todas as sessões completadas de um paciente (para gráficos de histórico)
async function getPatientSessions(patient_name, patient_id) {
  try {
    const { data, error } = await byPatient(
      supabase.from('sessions').select('*, answers(*)'),
      patient_name, patient_id
    )
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: true })
    if (error) throw error
    return data || []
  } catch (error) {
    console.error('Erro ao buscar sessões do paciente:', error.message)
    throw error
  }
}

// Busca todos os eventos anatômicos das sessões de um paciente (para gráfico de regiões)
async function getPatientAnatomyEvents(patient_name, patient_id) {
  try {
    // Primeiro busca os IDs das sessões do paciente
    const { data: sessions, error: sessErr } = await byPatient(
      supabase.from('sessions').select('id'),
      patient_name, patient_id
    ).not('completed_at', 'is', null)
    if (sessErr) throw sessErr
    if (!sessions || sessions.length === 0) return []

    const sessionIds = sessions.map(s => s.id)

    const { data, error } = await supabase
      .from('anatomy_events')
      .select('*')
      .in('session_id', sessionIds)
      .order('created_at', { ascending: true })
    if (error) throw error
    return data || []
  } catch (error) {
    console.error('Erro ao buscar eventos anatômicos do paciente:', error.message)
    throw error
  }
}

// ─── Usuários / autenticação (item 4) ────────────────────────────────────────

async function countUsers() {
  const { count, error } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
  if (error) throw error
  return count || 0
}

async function getUserByEmail(email) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', String(email).toLowerCase().trim())
    .single()
  if (error) return null
  return data
}

async function createUser({ email, password_hash, name }) {
  const { data, error } = await supabase
    .from('users')
    .insert({ email: String(email).toLowerCase().trim(), password_hash, name })
    .select('id, email, name, role, created_at')
    .single()
  if (error) throw error
  return data
}

// ─── Configurações da aplicação (item 3 — calibração no banco) ────────────────

async function getSetting(key) {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .single()
  if (error) return null
  return data?.value ?? null
}

async function setSetting(key, value) {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw error
}

// ─── Financeiro (item 6) ──────────────────────────────────────────────────────

async function createPayment({ patient_id, appointment_id, session_id, package_id, amount, method, status, paid_at, notes }) {
  const { data, error } = await supabase
    .from('payments')
    .insert({
      patient_id: patient_id || null,
      appointment_id: appointment_id || null,
      session_id: session_id || null,
      package_id: package_id || null,
      amount,
      method: method || null,
      status: status || 'pago',
      paid_at: paid_at || null,
      notes: notes || null
    })
    .select()
    .single()
  if (error) throw error
  return data
}

async function getPatientPayments(patient_id) {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .eq('patient_id', patient_id)
    .order('paid_at', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

async function getPatientPackages(patient_id) {
  const { data, error } = await supabase
    .from('patient_packages')
    .select('*')
    .eq('patient_id', patient_id)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

async function createPackage({ patient_id, total_sessions, amount_paid, notes }) {
  const { data, error } = await supabase
    .from('patient_packages')
    .insert({ patient_id, total_sessions, amount_paid: amount_paid || null, notes: notes || null })
    .select()
    .single()
  if (error) throw error
  return data
}

async function updatePackage(id, updates) {
  const { data, error } = await supabase
    .from('patient_packages')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

// Consome uma sessão de um pacote ativo (usa o mais antigo com saldo)
async function consumePackageSession(patient_id) {
  const { data: pkgs } = await supabase
    .from('patient_packages')
    .select('*')
    .eq('patient_id', patient_id)
    .eq('active', true)
    .order('created_at', { ascending: true })
  const pkg = (pkgs || []).find(p => (p.used_sessions || 0) < p.total_sessions)
  if (!pkg) return null
  const used = (pkg.used_sessions || 0) + 1
  const active = used < pkg.total_sessions
  return updatePackage(pkg.id, { used_sessions: used, active })
}

// Pacote ativo do paciente que ainda tem saldo
async function getActivePackage(patient_id) {
  if (!patient_id) return null
  const { data } = await supabase
    .from('patient_packages')
    .select('*')
    .eq('patient_id', patient_id)
    .eq('active', true)
    .order('created_at', { ascending: true })
  return (data || []).find(p => (p.used_sessions || 0) < p.total_sessions) || null
}

// Devolve uma sessão ao pacote (quando um agendamento deixa de ser "no pacote")
async function restorePackageSession(package_id) {
  const { data: pkg } = await supabase
    .from('patient_packages').select('*').eq('id', package_id).single()
  if (!pkg) return null
  const used = Math.max(0, (pkg.used_sessions || 0) - 1)
  return updatePackage(package_id, { used_sessions: used, active: used < pkg.total_sessions })
}

async function getAppointment(id) {
  const { data, error } = await supabase.from('appointments').select('*').eq('id', id).single()
  if (error) return null
  return data
}

// ─── Livro-caixa: o agendamento vira lançamento em `payments` ────────────────
// `payments` é a ÚNICA fonte de verdade do financeiro. Toda vez que um
// agendamento ganha/muda valor ou status de pagamento, refletimos aqui.
async function syncAppointmentPayment(appt) {
  if (!appt?.id) return
  const status = appt.payment_status || 'pendente'
  const price  = appt.price == null || appt.price === '' ? null : Number(appt.price)

  // select('*') de propósito: se a migração v4 ainda não rodou, pedir colunas
  // que não existem faria o select falhar e quebrar o lançamento no caixa.
  const { data: existing } = await supabase
    .from('payments')
    .select('*')
    .eq('appointment_id', appt.id)
    .maybeSingle()

  // Dinheiro que já entrou de verdade (confirmado pelo provedor) é intocável:
  // não sobrescrevemos nem apagamos o lançamento.
  const jaRecebido = existing && existing.status === 'pago' && existing.provider_payment_id
  if (jaRecebido) return

  // Só gera lançamento quando há dinheiro envolvido (isento/pacote não geram)
  const chargeable = (status === 'pago' || status === 'pendente') && price > 0

  if (chargeable) {
    const row = {
      patient_id:     appt.patient_id || null,
      appointment_id: appt.id,
      amount:         price,
      method:         appt.payment_method || null,
      status,
      // paid_at = data de referência (competência) do lançamento
      paid_at:        appt.appointment_date || null
    }
    if (existing) await supabase.from('payments').update(row).eq('id', existing.id)
    else          await supabase.from('payments').insert(row)
  } else if (existing) {
    await supabase.from('payments').delete().eq('id', existing.id)
  }
}

// Consome/estorna pacote conforme o agendamento é marcado como "no pacote"
async function syncAppointmentPackage(appt) {
  if (!appt?.id) return null
  const status = appt.payment_status

  if (status === 'pacote' && !appt.package_id) {
    const pkg = await consumePackageSession(appt.patient_id)
    if (pkg) await supabase.from('appointments').update({ package_id: pkg.id }).eq('id', appt.id)
    return pkg
  }
  if (status !== 'pacote' && appt.package_id) {
    await restorePackageSession(appt.package_id)
    await supabase.from('appointments').update({ package_id: null }).eq('id', appt.id)
  }
  return null
}

// Exclui um agendamento com limpeza: estorna pacote e remove o lançamento.
// Sem isso o pagamento viraria "cobrança fantasma" no caixa (FK é SET NULL).
async function deleteAppointment(id) {
  const appt = await getAppointment(id)
  if (!appt) return null

  // Devolve a sessão ao pacote, se este agendamento tinha consumido uma
  if (appt.package_id) {
    try { await restorePackageSession(appt.package_id) } catch (_) {}
  }
  // Remove o lançamento vinculado antes de apagar o agendamento
  try { await supabase.from('payments').delete().eq('appointment_id', id) } catch (_) {}

  const { error } = await supabase.from('appointments').delete().eq('id', id)
  if (error) throw error
  return appt
}

// Exclui toda uma série recorrente
async function deleteAppointmentSeries(series_id) {
  const { data } = await supabase
    .from('appointments').select('id').eq('series_id', series_id)
  const ids = (data || []).map(a => a.id)
  for (const id of ids) {
    try { await deleteAppointment(id) } catch (_) {}
  }
  return ids.length
}

// Verifica se um horário já está ocupado (usado pela agenda recorrente)
async function hasConflict(dateStr, timeStr, durationMin) {
  const appts = await getAppointmentsByDate(dateStr)
  const toMin = t => {
    const [h, m] = String(t).slice(0, 5).split(':').map(Number)
    return h * 60 + m
  }
  const s = toMin(timeStr)
  const e = s + (Number(durationMin) || 60)
  return (appts || []).some(a => {
    if (a.status === 'cancelado') return false
    const as = toMin(a.appointment_time)
    const ae = as + (Number(a.duration_minutes) || 60)
    return s < ae && as < e   // sobreposição
  })
}

// Relatório mensal — receita e contagem de pagamentos no mês (YYYY-MM)
async function getMonthlyReport(month) {
  const start = `${month}-01`
  const [y, m] = month.split('-').map(Number)
  const endDate = new Date(Date.UTC(y, m, 1)) // primeiro dia do mês seguinte
  const end = endDate.toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('payments')
    .select('amount, method, status, paid_at')
    .gte('paid_at', start)
    .lt('paid_at', end)
  if (error) throw error

  const rows = data || []
  const paid = rows.filter(r => r.status === 'pago')
  const total = paid.reduce((s, r) => s + Number(r.amount || 0), 0)
  const pending = rows.filter(r => r.status === 'pendente')
    .reduce((s, r) => s + Number(r.amount || 0), 0)
  const byMethod = {}
  paid.forEach(r => { const k = r.method || 'outro'; byMethod[k] = (byMethod[k] || 0) + Number(r.amount || 0) })

  return { month, total, pending, count: paid.length, by_method: byMethod }
}

// Relatório completo de um período livre (dashboard financeiro/operacional).
// granularity: 'day' | 'month' — define o agrupamento da série temporal.
async function getOverviewReport(start, end, granularity = 'day') {
  const [{ data: pays }, { data: appts }] = await Promise.all([
    supabase.from('payments')
      .select('amount, method, status, paid_at')
      .gte('paid_at', start).lte('paid_at', end),
    supabase.from('appointments')
      .select('id, patient_id, patient_name, status, appointment_date, type')
      .gte('appointment_date', start).lte('appointment_date', end)
  ])

  let newPatients = 0
  try {
    const { count } = await supabase.from('patients')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', start).lte('created_at', end + 'T23:59:59')
    newPatients = count || 0
  } catch (_) {}

  const rows     = pays || []
  const paidRows = rows.filter(r => r.status === 'pago')
  const pendRows = rows.filter(r => r.status === 'pendente')
  const sum      = list => list.reduce((s, r) => s + Number(r.amount || 0), 0)
  const paid     = sum(paidRows)
  const pending  = sum(pendRows)

  const byMethod = {}
  paidRows.forEach(r => {
    const k = r.method || 'outro'
    byMethod[k] = (byMethod[k] || 0) + Number(r.amount || 0)
  })

  // Série temporal (recebido x a receber)
  const bucket = d => granularity === 'month' ? String(d).slice(0, 7) : String(d).slice(0, 10)
  const map = {}
  rows.forEach(r => {
    if (!r.paid_at) return
    const k = bucket(r.paid_at)
    if (!map[k]) map[k] = { period: k, paid: 0, pending: 0 }
    if (r.status === 'pago') map[k].paid += Number(r.amount || 0)
    else if (r.status === 'pendente') map[k].pending += Number(r.amount || 0)
  })
  const series = Object.values(map).sort((a, b) => a.period.localeCompare(b.period))

  // Operacional
  const A = appts || []
  const byStatus = {}
  A.forEach(a => {
    const s = a.status || 'agendado'
    byStatus[s] = (byStatus[s] || 0) + 1
  })
  const attended  = byStatus['concluido'] || 0
  const noShow    = byStatus['falta'] || 0
  const cancelled = byStatus['cancelado'] || 0

  // Taxa de presença: dos que deveriam acontecer (compareceu vs faltou)
  const base = attended + noShow
  const attendanceRate = base > 0 ? Math.round((attended / base) * 100) : null

  const uniq = new Set()
  A.filter(a => a.status === 'concluido').forEach(a => uniq.add(a.patient_id || a.patient_name))

  return {
    start, end, granularity,
    revenue: {
      paid, pending, total: paid + pending,
      count: paidRows.length,
      ticket_medio: paidRows.length ? paid / paidRows.length : 0
    },
    by_method: byMethod,
    series,
    appointments: { total: A.length, attended, no_show: noShow, cancelled, by_status: byStatus },
    attendance_rate: attendanceRate,
    patients: { attended_unique: uniq.size, new: newPatients }
  }
}

// Lista de lançamentos do período (pagos e em aberto), com nome do paciente
async function getPaymentsInPeriod(start, end) {
  const { data, error } = await supabase
    .from('payments')
    .select('*, patients(name), appointments(type, appointment_date)')
    .gte('paid_at', start)
    .lte('paid_at', end)
    .order('paid_at', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

async function getPaymentByAppointment(appointment_id) {
  const { data } = await supabase
    .from('payments').select('*').eq('appointment_id', appointment_id).maybeSingle()
  return data || null
}

async function getPaymentBySession(session_id) {
  const { data } = await supabase
    .from('payments').select('*').eq('session_id', session_id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  return data || null
}

// O webhook do provedor só manda o id dele — é por aqui que achamos o lançamento
async function getPaymentByProviderId(provider_payment_id) {
  const { data } = await supabase
    .from('payments').select('*').eq('provider_payment_id', String(provider_payment_id)).maybeSingle()
  return data || null
}

async function updatePayment(id, updates) {
  const { data, error } = await supabase
    .from('payments').update(updates).eq('id', id).select().single()
  if (error) throw error
  return data
}

async function deletePayment(id) {
  const { error } = await supabase.from('payments').delete().eq('id', id)
  if (error) throw error
}

// ─── Dashboard clínico/operacional ───────────────────────────────────────────
async function getClinicalReport(start, end, granularity = 'day') {
  const endTs = end + 'T23:59:59'

  const [{ data: appts }, { data: sess }] = await Promise.all([
    supabase.from('appointments')
      .select('id, patient_id, patient_name, status, type, appointment_date, appointment_time')
      .gte('appointment_date', start).lte('appointment_date', end),
    supabase.from('sessions')
      .select('id, patient_id, patient_name, completed_at, started_at, finished_at, answers(*)')
      .not('completed_at', 'is', null)
      .gte('completed_at', start).lte('completed_at', endTs)
  ])

  const A = appts || []
  const S = sess  || []

  // Pacientes
  let totalPatients = 0, newPatients = 0
  try {
    const { count } = await supabase.from('patients').select('id', { count: 'exact', head: true })
    totalPatients = count || 0
  } catch (_) {}
  try {
    const { count } = await supabase.from('patients')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', start).lte('created_at', endTs)
    newPatients = count || 0
  } catch (_) {}

  // Regiões mais tratadas (eventos anatômicos das sessões do período)
  const regions = {}
  if (S.length) {
    try {
      const { data: ev } = await supabase
        .from('anatomy_events').select('region').in('session_id', S.map(s => s.id))
      ;(ev || []).filter(e => e.region !== '__acupuncture__').forEach(e => {
        regions[e.region] = (regions[e.region] || 0) + 1
      })
    } catch (_) {}
  }

  // Situação e tipo dos agendamentos
  const byStatus = {}, byType = {}
  A.forEach(a => {
    const s = a.status || 'agendado'
    byStatus[s] = (byStatus[s] || 0) + 1
    const t = a.type || 'Outro'
    byType[t] = (byType[t] || 0) + 1
  })
  const attended  = byStatus['concluido'] || 0
  const noShow    = byStatus['falta'] || 0
  const cancelled = byStatus['cancelado'] || 0
  const base = attended + noShow
  const attendanceRate = base > 0 ? Math.round((attended / base) * 100) : null

  // Movimento por dia da semana e por horário (ignora cancelados)
  const byWeekday = [0, 0, 0, 0, 0, 0, 0]
  const byHour = {}
  A.filter(a => a.status !== 'cancelado').forEach(a => {
    const d = new Date(a.appointment_date + 'T12:00:00')
    byWeekday[d.getDay()]++
    const h = String(a.appointment_time).slice(0, 2)
    byHour[h] = (byHour[h] || 0) + 1
  })

  // Respostas do formulário: dor, sono, estresse
  const bucket = d => granularity === 'month' ? String(d).slice(0, 7) : String(d).slice(0, 10)
  const pains = [], sleepDist = {}, stressDist = {}, painMap = {}
  S.forEach(s => {
    const ans = {}
    ;(s.answers || []).forEach(a => { ans[a.question_key] = a.answer_value })
    const p = parseInt(ans.pain)
    if (!isNaN(p)) {
      pains.push(p)
      const k = bucket(s.completed_at)
      if (!painMap[k]) painMap[k] = { period: k, sum: 0, n: 0 }
      painMap[k].sum += p
      painMap[k].n++
    }
    if (ans.sleep)  sleepDist[ans.sleep]   = (sleepDist[ans.sleep] || 0) + 1
    if (ans.stress) stressDist[ans.stress] = (stressDist[ans.stress] || 0) + 1
  })
  const painSeries = Object.values(painMap)
    .sort((a, b) => a.period.localeCompare(b.period))
    .map(x => ({ period: x.period, avg: +(x.sum / x.n).toFixed(1) }))
  const avgPain = pains.length
    ? +(pains.reduce((a, b) => a + b, 0) / pains.length).toFixed(1) : null

  // Duração média real da sessão (início → fim)
  const durs = S
    .filter(s => s.started_at && s.finished_at)
    .map(s => (new Date(s.finished_at) - new Date(s.started_at)) / 60000)
    .filter(d => d > 0 && d < 600)
  const avgDuration = durs.length
    ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : null

  const uniq = new Set()
  A.filter(a => a.status === 'concluido').forEach(a => uniq.add(a.patient_id || a.patient_name))

  return {
    start, end, granularity,
    sessions: { completed: S.length, avg_duration_min: avgDuration },
    appointments: { total: A.length, attended, no_show: noShow, cancelled, by_status: byStatus, by_type: byType },
    attendance_rate: attendanceRate,
    by_weekday: byWeekday,
    by_hour: byHour,
    patients: { total: totalPatients, new: newPatients, attended_unique: uniq.size },
    pain: { avg: avgPain, series: painSeries },
    sleep_distribution: sleepDist,
    stress_distribution: stressDist,
    top_regions: Object.entries(regions).sort((a, b) => b[1] - a[1]).slice(0, 10)
  }
}

export {
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
  // Controle de fluxo de sessão
  getActiveSession,
  getIncomingSession,
  setSessionWait,
  setSessionCanEnter,
  startSession,
  finishSession,
  getNextAppointmentForTotem,
  getTotemState,
  // Pacientes
  getPatients,
  getPatient,
  createPatient,
  updatePatient,
  searchPatients,
  // Agendamentos
  getAppointmentsByDate,
  getAppointmentsByRange,
  createAppointment,
  updateAppointment,
  getPatientSessions,
  getPatientAnatomyEvents,
  // Usuários / auth
  countUsers,
  getUserByEmail,
  createUser,
  // Configurações
  getSetting,
  setSetting,
  // Financeiro
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
  // Livro-caixa / pacotes / agenda recorrente
  getActivePackage,
  restorePackageSession,
  getAppointment,
  deleteAppointment,
  deleteAppointmentSeries,
  syncAppointmentPayment,
  syncAppointmentPackage,
  hasConflict
}
