// Automações do WhatsApp: aviso quando a consulta é agendada/remarcada e
// lembrete de confirmação no dia anterior (segunda → na sexta). Também monta a
// lista "Automações e IA" do ⚙.
import {
  getAppointmentsByRange, updateAppointment, getPatientsWithPhone, getPatient, logAction, addBotMessage,
  getActions, getSetting, todayBR, brasiliaDateTime, v7Check
} from './database.js'
import { getInfo, getBotConfig, getAutomations, addDays, weekday, WEEKDAYS, fmtDate, toMin } from './clinic.js'
import * as wa from './whatsapp.js'
import * as llm from './llm.js'

const firstName = n => String(n || '').trim().split(/\s+/)[0] || ''
const hhmm = t => String(t || '').slice(0, 5)
const shortAddress = info => String(info.endereco || '').trim()

// Dia em que sai o lembrete de uma consulta: véspera; se a véspera cair no fim
// de semana, na sexta (consulta de segunda, sábado ou domingo → sexta).
function reminderDay(dateStr) {
  let d = addDays(dateStr, -1)
  while ([0, 6].includes(weekday(d))) d = addDays(d, -1)
  return d
}

// "amanhã (terça-feira, 04/11)" ou "na segunda-feira, 03/11"
function whenText(dateStr) {
  const today = todayBR()
  const wd = WEEKDAYS[weekday(dateStr)]
  if (dateStr === today) return `hoje, ${fmtDate(dateStr)}`
  if (dateStr === addDays(today, 1)) return `amanhã (${wd}, ${fmtDate(dateStr)})`
  return `${wd === 'sábado' || wd === 'domingo' ? 'no' : 'na'} ${wd}, ${fmtDate(dateStr)}`
}

// Telefone do paciente de um agendamento (cadastro → só dígitos com 55)
async function phoneOf(appt, patientsCache) {
  if (!appt.patient_id) return null
  const p = patientsCache?.get(appt.patient_id) || await getPatient(appt.patient_id).catch(() => null)
  return p ? wa.normalizePhone(p.phone) : null
}

// Envia, guarda na conversa (o robô vê o que foi mandado) e registra a ação
async function sendLogged(phone, text, action) {
  const r = await wa.sendText(phone, text)
  if (!r.ok) {
    await logAction({ kind: 'erro', phone, patient_id: action.patient_id, appointment_id: action.appointment_id, detail: `${action.kind}: ${r.error}` })
    return false
  }
  // A conversa fica no número como o WhatsApp o conhece (com ou sem o nono
  // dígito) — é o mesmo que chega no webhook quando o paciente responde
  const key = r.to || phone
  await addBotMessage({ phone: key, role: 'auto', content: text, wa_id: r.id })
  await logAction({ ...action, phone: key })
  return true
}

// Migração v7 rodada? (sem a coluna reminder_sent_at o lembrete sairia toda hora).
// Resultado negativo é reconferido a cada 5 min — rodou o SQL, passa a funcionar.
let v7 = { ok: false, at: 0 }
async function v7Ready() {
  if (v7.ok || Date.now() - v7.at < 5 * 60e3) return v7.ok
  v7 = { ok: await v7Check().catch(() => false), at: Date.now() }
  return v7.ok
}

// ── Aviso de agendamento / remarcação ───────────────────────────────────────
async function onBooked(appts) {
  try {
    const auto = await getAutomations()
    if (!auto.notices || !wa.configured()) return
    const today = todayBR(), { minutesOfDay } = brasiliaDateTime()
    const future = (appts || []).filter(a => a?.id && a.status !== 'cancelado' &&
      (a.appointment_date > today || (a.appointment_date === today && toMin(a.appointment_time) > minutesOfDay)))
    if (!future.length) return
    // Agrupa por paciente (retornos recorrentes viram uma mensagem só)
    const byPatient = new Map()
    for (const a of future) {
      if (!a.patient_id) continue
      if (!byPatient.has(a.patient_id)) byPatient.set(a.patient_id, [])
      byPatient.get(a.patient_id).push(a)
    }
    const info = await getInfo()
    for (const [, list] of byPatient) {
      list.sort((a, b) => (a.appointment_date + a.appointment_time).localeCompare(b.appointment_date + b.appointment_time))
      const phone = await phoneOf(list[0])
      if (!phone) continue
      const nome = firstName(list[0].patient_name)
      const soon = list[0].appointment_date <= addDays(today, 1) || reminderDay(list[0].appointment_date) <= today
      let text
      if (list.length === 1) {
        const a = list[0]
        text = `Olá, ${nome}! Sua sessão de *${a.type}* com a Dra. Juliane Brasil Lopes está agendada para *${whenText(a.appointment_date)}, às ${hhmm(a.appointment_time)}*.`
      } else {
        const lines = list.slice(0, 10).map(a => `• ${WEEKDAYS[weekday(a.appointment_date)]}, ${fmtDate(a.appointment_date)} às ${hhmm(a.appointment_time)}`)
        text = `Olá, ${nome}! Suas próximas sessões com a Dra. Juliane Brasil Lopes estão agendadas:\n${lines.join('\n')}` +
          (list.length > 10 ? `\n…e mais ${list.length - 10}.` : '')
      }
      if (shortAddress(info)) text += `\n\n📍 ${shortAddress(info)}`
      text += soon
        ? '\n\nVocê confirma presença? É só responder *SIM*. Se precisar de outro horário, me avise por aqui.'
        : '\n\nUm dia antes eu envio uma mensagem para confirmar. Qualquer dúvida, é só chamar por aqui.'
      const ok = await sendLogged(phone, text, {
        kind: 'aviso', patient_id: list[0].patient_id, appointment_id: list[0].id,
        detail: list.length === 1 ? `Agendada: ${fmtDate(list[0].appointment_date)} ${hhmm(list[0].appointment_time)}` : `${list.length} sessões agendadas`
      })
      if (ok && await v7Ready()) {
        const now = new Date().toISOString()
        for (const a of list) {
          // Se já é a véspera, o aviso faz as vezes do lembrete (não manda dois)
          const upd = { notice_sent_at: now }
          if (reminderDay(a.appointment_date) <= today) upd.reminder_sent_at = now
          await updateAppointment(a.id, upd).catch(() => {})
        }
      }
    }
  } catch (e) {
    console.error('Erro no aviso de agendamento:', e.message)
  }
}

async function onRescheduled(appt) {
  try {
    const auto = await getAutomations()
    if (!auto.notices || !wa.configured() || !appt?.patient_id || appt.status === 'cancelado') return
    if (appt.appointment_date < todayBR()) return
    const phone = await phoneOf(appt)
    if (!phone) return
    const text = `Olá, ${firstName(appt.patient_name)}! Sua sessão de *${appt.type}* foi remarcada para *${whenText(appt.appointment_date)}, às ${hhmm(appt.appointment_time)}*. Qualquer dúvida, é só chamar por aqui.`
    const ok = await sendLogged(phone, text, {
      kind: 'aviso', patient_id: appt.patient_id, appointment_id: appt.id,
      detail: `Remarcada: ${fmtDate(appt.appointment_date)} ${hhmm(appt.appointment_time)}`
    })
    if (ok && await v7Ready()) {
      const upd = { notice_sent_at: new Date().toISOString(), reminder_sent_at: null }
      if (reminderDay(appt.appointment_date) <= todayBR()) upd.reminder_sent_at = upd.notice_sent_at
      await updateAppointment(appt.id, upd).catch(() => {})
    }
  } catch (e) {
    console.error('Erro no aviso de remarcação:', e.message)
  }
}

// ── Lembrete de confirmação ─────────────────────────────────────────────────
const remindedNow = new Set()   // proteção extra contra envio repetido
let remindersRunning = false
let lastReminderRun = null

async function runReminders() {
  if (remindersRunning) return
  remindersRunning = true
  try {
    const [auto, bot] = [await getAutomations(), await getBotConfig()]
    if (!auto.reminders || !wa.configured()) return
    const { dateStr: today, minutesOfDay } = brasiliaDateTime()
    // Janela: da hora do lembrete até as 20h (não manda de madrugada)
    if (minutesOfDay < toMin(bot.reminder_time) || minutesOfDay >= 20 * 60) return
    if (!(await v7Ready())) return   // sem a coluna reminder_sent_at, mandaria toda hora

    const appts = (await getAppointmentsByRange(addDays(today, 1), addDays(today, 4)))
      .filter(a => a.status === 'agendado' && !a.reminder_sent_at && a.patient_id &&
        reminderDay(a.appointment_date) <= today && !remindedNow.has(a.id))
    if (!appts.length) return
    lastReminderRun = new Date().toISOString()

    const patients = new Map((await getPatientsWithPhone()).map(p => [p.id, p]))
    for (const a of appts) {
      remindedNow.add(a.id)
      const phone = await phoneOf(a, patients)
      if (!phone) { await updateAppointment(a.id, { reminder_sent_at: new Date().toISOString() }).catch(() => {}); continue }
      const text = `Olá, ${firstName(a.patient_name)}! Tudo bem? Aqui é do Consultório Equilibrium, da Dra. Juliane Brasil Lopes.\n\n` +
        `Passando para confirmar sua sessão de *${a.type}* ${whenText(a.appointment_date)}, às *${hhmm(a.appointment_time)}*.\n\n` +
        'Você confirma presença? É só responder *SIM*. Se precisar remarcar, me avise por aqui.'
      const ok = await sendLogged(phone, text, {
        kind: 'lembrete', patient_id: a.patient_id, appointment_id: a.id,
        detail: `${a.patient_name} · ${fmtDate(a.appointment_date)} ${hhmm(a.appointment_time)}`
      })
      if (ok) await updateAppointment(a.id, { reminder_sent_at: new Date().toISOString() }).catch(() => {})
      await new Promise(r => setTimeout(r, 4000))   // espaçado, como uma pessoa enviando
    }
  } catch (e) {
    console.error('Erro nos lembretes:', e.message)
  } finally {
    remindersRunning = false
  }
}

let timer = null
function startScheduler() {
  if (timer) return
  timer = setInterval(runReminders, 60_000)
  setTimeout(runReminders, 15_000)
}

// ── Lista "Automações e IA" (⚙) ──────────────────────────────────────────────
async function automationsStatus({ webhookOk } = {}) {
  const [auto, bot, waState, pix, keep] = await Promise.all([
    getAutomations(), getBotConfig(), wa.connectionState(),
    getSetting('pix_config').catch(() => null), getSetting('keepalive').catch(() => null)
  ])
  const since = new Date(Date.now() - 30 * 86400e3).toISOString()
  const actions = await getActions({ since, limit: 1000 })
  const last = kinds => actions.find(a => kinds.includes(a.kind))?.created_at || null
  const waOk = waState === 'open'
  const waMsg = !wa.configured() ? 'WhatsApp não configurado' : waOk ? null : `WhatsApp desconectado (${waState})`
  const aiMsg = llm.configured() ? null : 'Falta a chave da IA (ANTHROPIC_API_KEY)'
  const v7 = await v7Ready()
  const dbMsg = v7 ? null : 'Falta rodar o supabase-v7-migration.sql'
  const status = (on, ...problems) => {
    const p = problems.filter(Boolean)
    return { state: !on ? 'pausada' : p.length ? 'atencao' : 'ativa', problem: p.join(' · ') || null }
  }
  return [
    {
      key: 'bot', kind: 'IA', toggle: true, on: auto.bot,
      name: 'Robô de atendimento no WhatsApp',
      desc: `Responde pacientes, marca, remarca (até ${bot.min_hours_change} h antes), desmarca e confirma sessões, tira dúvidas com as informações do ⚙ e encaminha à Dra. o que não souber. Modelo: Claude Sonnet 5.5.`,
      ...status(auto.bot, waMsg, aiMsg, dbMsg, webhookOk === false ? 'Webhook da Evolution não configurado' : null),
      last: last(['resposta', 'agendou', 'remarcou', 'desmarcou', 'encaminhou'])
    },
    {
      key: 'reminders', kind: 'Automação', toggle: true, on: auto.reminders,
      name: 'Lembrete de confirmação',
      desc: `Às ${bot.reminder_time} do dia anterior envia a confirmação pelo WhatsApp (sessões de segunda são confirmadas na sexta). "SIM" confirma a sessão na agenda.`,
      ...status(auto.reminders, waMsg, dbMsg), last: last(['lembrete']) || lastReminderRun
    },
    {
      key: 'notices', kind: 'Automação', toggle: true, on: auto.notices,
      name: 'Aviso de agendamento e remarcação',
      desc: 'Quando uma sessão é marcada (ou remarcada) pelo painel, o paciente recebe o dia, a hora e o endereço no WhatsApp.',
      ...status(auto.notices, waMsg), last: last(['aviso'])
    },
    {
      key: 'suggestion', kind: 'IA', toggle: true, on: auto.suggestion,
      name: 'Sugestão de sessão (após o totem)',
      desc: 'Quando o paciente conclui o check-in, a IA analisa as últimas sessões, a evolução e como ele está hoje e sugere o que pode ser feito no atendimento.',
      ...status(auto.suggestion, aiMsg, dbMsg), last: last(['sugestao'])
    },
    {
      key: 'pix', kind: 'Automação', toggle: false, on: pix?.provider === 'mercadopago',
      name: 'Pix confirmado automaticamente',
      desc: 'O Mercado Pago avisa o sistema quando o Pix cai e o pagamento entra sozinho no financeiro. Configura em Financeiro → Chave Pix.',
      state: pix?.provider === 'mercadopago' ? 'ativa' : 'pausada', problem: pix?.provider === 'mercadopago' ? null : 'Não configurado', last: null
    },
    {
      key: 'keepalive', kind: 'Sistema', toggle: false, on: true,
      name: 'Banco de dados sempre ativo',
      desc: 'O servidor acessa o Supabase ao iniciar e a cada 5 dias, para o plano gratuito não pausar o banco.',
      state: 'ativa', problem: null, last: keep?.at || null
    },
    {
      key: 'realtime', kind: 'Sistema', toggle: false, on: true,
      name: 'Telas em tempo real',
      desc: 'Totem, painel e TV do paciente se atualizam sozinhos (chegada, chamada, pagamento, espelho da Anatomia 3D).',
      state: 'ativa', problem: null, last: null
    }
  ]
}

export { onBooked, onRescheduled, runReminders, startScheduler, automationsStatus, reminderDay, whenText, v7Ready }
