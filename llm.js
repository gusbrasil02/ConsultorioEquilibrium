// Claude (API da Anthropic) — usado pelo robô do WhatsApp e pela sugestão de sessão.
// Env: ANTHROPIC_API_KEY.
import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-sonnet-5-5'
let client = null

const configured = () => !!process.env.ANTHROPIC_API_KEY
function getClient() {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 })
  return client
}

// Texto final de uma resposta (blocos de texto juntos)
const textOf = msg => (msg?.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim()

// Uma chamada à API. Lança erro com mensagem legível.
async function create(params) {
  return getClient().messages.create({ model: MODEL, max_tokens: 8000, ...params })
}

// Resposta em JSON validada pelo schema (structured outputs)
async function json({ system, prompt, schema, effort = 'medium' }) {
  const res = await create({
    system,
    messages: [{ role: 'user', content: prompt }],
    output_config: { effort, format: { type: 'json_schema', schema } }
  })
  if (res.stop_reason === 'refusal') throw new Error('A IA recusou o pedido.')
  if (res.stop_reason === 'max_tokens') throw new Error('Resposta da IA cortada (limite de tamanho).')
  return JSON.parse(textOf(res))
}

function describeError(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'Chave da API da Anthropic inválida (ANTHROPIC_API_KEY).'
  if (e instanceof Anthropic.PermissionDeniedError) return 'A chave da Anthropic não tem permissão para este modelo.'
  if (e instanceof Anthropic.RateLimitError) return 'Limite de uso da API da Anthropic atingido — tente de novo em instantes.'
  if (e instanceof Anthropic.APIConnectionError) return 'Sem conexão com a API da Anthropic.'
  if (e instanceof Anthropic.APIError) return `API da Anthropic respondeu ${e.status}: ${e.message}`
  return e?.message || String(e)
}

export { MODEL, configured, create, json, textOf, describeError }
