// Sugestão de sessão por IA: quando o paciente conclui o totem, o Claude lê as
// últimas sessões (prontuário, dor, regiões tratadas, ficha de avaliação) e o
// que ele respondeu hoje, e sugere o que a Dra. pode fazer no atendimento.
import {
  getSession, getPatient, getPatientSessions, getPatientAnatomyEvents, getPatientEvaluations,
  setSessionSuggestion, logAction
} from './database.js'
import * as llm from './llm.js'

const SYSTEM = `Você é um assistente clínico de apoio para a Dra. Juliane Brasil Lopes, fisioterapeuta. No consultório ela usa fisioterapia e reabilitação, terapia manual, acupuntura, dry needling, ventosa, bandagem, pilates solo, treino funcional, reeducação postural e barras de Access.

A partir do histórico do paciente e de como ele chegou hoje, escreva um resumo curto e sugestões práticas para a sessão de hoje.
- São sugestões para uma profissional experiente; a decisão clínica é sempre dela. Seja direto e específico ao caso.
- Baseie-se só nos dados recebidos. Não invente diagnósticos, exames nem histórico; quando faltar informação, diga o que vale perguntar ou avaliar.
- Compare a dor e as queixas de hoje com as sessões anteriores (melhorou, piorou, estável) e leve em conta sono e estresse.
- Sugira condutas coerentes com o que foi feito antes e com o plano registrado (manter, progredir, ajustar), com técnicas e regiões concretas.
- Aponte sinais de alerta que pedem cautela, reavaliação ou encaminhamento médico, se houver.
- Português do Brasil, frases curtas, sem rodeios.`

const SCHEMA = {
  type: 'object',
  properties: {
    resumo: { type: 'string', description: 'Quem é o paciente e o histórico em 2 a 3 frases' },
    evolucao: { type: 'string', description: 'Como evoluiu nas últimas sessões (dor, queixas, resposta ao tratamento)' },
    hoje: { type: 'string', description: 'Como chegou hoje, comparado com as sessões anteriores' },
    sugestoes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { titulo: { type: 'string' }, detalhe: { type: 'string' } },
        required: ['titulo', 'detalhe'], additionalProperties: false
      }
    },
    atencao: { type: 'array', items: { type: 'string' }, description: 'Sinais de alerta e cuidados (pode ser vazio)' },
    perguntar: { type: 'array', items: { type: 'string' }, description: 'O que vale perguntar ou avaliar hoje (pode ser vazio)' }
  },
  required: ['resumo', 'evolucao', 'hoje', 'sugestoes', 'atencao', 'perguntar'],
  additionalProperties: false
}

const answersOf = s => Object.fromEntries((s.answers || []).map(a => [a.question_key, a.answer_value]))
const dateBR = iso => iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '?'
const clip = (v, n = 600) => String(v ?? '').trim().slice(0, n)
const age = b => {
  if (!b) return null
  const d = new Date(b), n = new Date()
  let a = n.getFullYear() - d.getFullYear()
  if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--
  return a >= 0 && a < 120 ? a : null
}

function sessionLine(s, regions) {
  const a = answersOf(s)
  const parts = [`Sessão de ${dateBR(s.completed_at)}`]
  const today = [a.pain ? `dor ${a.pain}/10` : null, a.pain_regions ? `onde: ${a.pain_regions}` : null,
    a.sleep ? `sono: ${a.sleep}` : null, a.stress ? `estresse: ${a.stress}` : null, a.reason ? `motivo: ${a.reason}` : null]
    .filter(Boolean).join('; ')
  if (today) parts.push(`  Chegada: ${today}`)
  for (const [k, l] of [['session_complaint', 'Queixa'], ['session_conduct', 'Conduta'], ['session_evolution', 'Evolução'],
    ['session_plan', 'Plano'], ['session_notes', 'Notas'], ['session_observations', 'Observações']]) {
    if (clip(s[k])) parts.push(`  ${l}: ${clip(s[k])}`)
  }
  if (regions?.length) parts.push(`  Mostrado na Anatomia 3D/acupuntura: ${regions.join(', ')}`)
  return parts.join('\n')
}

async function buildPrompt(session) {
  const patient = session.patient_id ? await getPatient(session.patient_id).catch(() => null) : null
  const all = await getPatientSessions(session.patient_name, session.patient_id).catch(() => [])
  const previous = all.filter(s => s.id !== session.id).slice(-6)
  const events = await getPatientAnatomyEvents(session.patient_name, session.patient_id).catch(() => [])
  const regionsBy = {}
  for (const e of events) {
    if (String(e.region).startsWith('__clear')) continue
    const label = e.region === '__acupuncture__' ? 'pontos de acupuntura' : e.region
    ;(regionsBy[e.session_id] ||= new Set()).add(label)
  }
  const evals = patient ? await getPatientEvaluations(patient.id).catch(() => []) : []
  const today = answersOf(session)

  const lines = ['# Paciente']
  if (patient) {
    const a = age(patient.birth_date)
    lines.push([`Nome: ${patient.name}`, a != null ? `${a} anos` : null, patient.sex === 'F' ? 'feminino' : patient.sex === 'M' ? 'masculino' : null]
      .filter(Boolean).join(' · '))
    if (clip(patient.condition)) lines.push(`Condição no cadastro: ${clip(patient.condition)}`)
    if (clip(patient.notes)) lines.push(`Observações do cadastro: ${clip(patient.notes)}`)
  } else {
    lines.push(`Nome: ${session.patient_name} (sem cadastro completo)`)
  }
  if (evals[0]) lines.push(`Ficha de avaliação mais recente (${evals[0].eval_date}, ${evals[0].kind}): ${clip(JSON.stringify(evals[0].data), 3000)}`)

  lines.push('', `# Sessões anteriores (${previous.length} mais recentes de ${Math.max(0, all.length - 1)} no total)`)
  lines.push(previous.length ? previous.map(s => sessionLine(s, [...(regionsBy[s.id] || [])])).join('\n') : 'Nenhuma: é a primeira sessão registrada no sistema.')

  lines.push('', '# Hoje (respostas do check-in no totem)')
  lines.push([`Dor: ${today.pain ?? '?'}/10`, `Onde dói: ${today.pain_regions || 'não marcou'}`, `Sono: ${today.sleep || '?'}`,
    `Estresse: ${today.stress || '?'}`, `Motivo da visita: ${today.reason || '?'}`].join('\n'))
  return { prompt: lines.join('\n'), patient, previous }
}

const running = new Set()

async function generateSuggestion(sessionId) {
  if (running.has(sessionId) || !llm.configured()) return null
  running.add(sessionId)
  try {
    const session = await getSession(sessionId)
    if (!session) return null
    await setSessionSuggestion(sessionId, { status: 'pending', at: new Date().toISOString() })
    const { prompt, patient } = await buildPrompt(session)
    const data = await llm.json({ system: SYSTEM, prompt, schema: SCHEMA, effort: 'medium' })
    const value = { status: 'ok', at: new Date().toISOString(), model: llm.MODEL, data }
    await setSessionSuggestion(sessionId, value)
    await logAction({ kind: 'sugestao', patient_id: patient?.id || session.patient_id || null, detail: `Sugestão para ${session.patient_name}` })
    return value
  } catch (e) {
    const why = llm.describeError(e)
    console.error('Erro na sugestão da IA:', why)
    await setSessionSuggestion(sessionId, { status: 'error', at: new Date().toISOString(), error: why }).catch(() => {})
    await logAction({ kind: 'erro', detail: `Sugestão: ${why}` })
    return null
  } finally {
    running.delete(sessionId)
  }
}

export { generateSuggestion }
