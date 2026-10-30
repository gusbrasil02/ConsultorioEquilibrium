// Cliente da Evolution API (WhatsApp do consultório).
// Env: EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE e, opcional,
// EVOLUTION_WEBHOOK_TOKEN (senão deriva do JWT_SECRET).
import crypto from 'crypto'

function cfg() {
  const url = process.env.EVOLUTION_API_URL
  const key = process.env.EVOLUTION_API_KEY
  const instance = process.env.EVOLUTION_INSTANCE
  if (!url || !key || !instance) return null
  return { base: url.replace(/\/$/, ''), instance, headers: { 'content-type': 'application/json', apikey: key } }
}

const configured = () => !!cfg()

// Token que a Evolution manda na URL do webhook (só quem tem o token aciona o robô)
function webhookToken() {
  if (process.env.EVOLUTION_WEBHOOK_TOKEN) return process.env.EVOLUTION_WEBHOOK_TOKEN
  const seed = process.env.JWT_SECRET || process.env.EVOLUTION_API_KEY || ''
  return seed ? crypto.createHash('sha256').update('evolution-webhook:' + seed).digest('hex').slice(0, 32) : ''
}
function webhookTokenOk(t) {
  const a = Buffer.from(String(t || '')), b = Buffer.from(webhookToken())
  return b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b)
}

// Só dígitos, com DDI 55 (aceita "(41) 98437-0364", "41984370364", "+55 41 …")
function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '')
  if (!d) return null
  if (d.startsWith('0')) d = d.replace(/^0+/, '')
  if (!d.startsWith('55') && (d.length === 10 || d.length === 11)) d = '55' + d
  return d.length >= 12 && d.length <= 13 ? d : null
}

// O mesmo número com e sem o nono dígito (contas antigas do WhatsApp não têm o 9)
function phoneVariants(raw) {
  const d = normalizePhone(raw)
  if (!d) return []
  const out = new Set([d])
  if (d.length === 13 && d[4] === '9') out.add(d.slice(0, 4) + d.slice(5))
  if (d.length === 12) out.add(`${d.slice(0, 4)}9${d.slice(4)}`)
  return [...out]
}

// Mesmo telefone? (compara os 8 últimos dígitos + DDD, ignorando o nono dígito)
function samePhone(a, b) {
  const va = phoneVariants(a), vb = new Set(phoneVariants(b))
  return va.some(v => vb.has(v))
}

// Estado da conexão (guardado por 30 s quando está aberta — cada envio consulta)
let stateCache = { at: 0, state: null }
async function connectionState({ fresh = false } = {}) {
  const c = cfg()
  if (!c) return 'not_configured'
  if (!fresh && stateCache.state === 'open' && Date.now() - stateCache.at < 30_000) return 'open'
  try {
    const r = await fetch(`${c.base}/instance/connectionState/${c.instance}`, { headers: c.headers, signal: AbortSignal.timeout(8000) })
    const j = await r.json().catch(() => ({}))
    stateCache = { at: Date.now(), state: j?.instance?.state || 'unknown' }
    return stateCache.state
  } catch (_) { return 'unreachable' }
}

// Número → jid do WhatsApp (resolve o nono dígito), guardado por 12 h
const jidCache = new Map()

// Ids das mensagens que o próprio sistema mandou — o webhook devolve todas as
// mensagens "fromMe"; as que não estão aqui foram digitadas pela Dra. no celular.
const sentIds = new Map()
function rememberSent(id) {
  if (!id) return
  sentIds.set(id, Date.now())
  if (sentIds.size > 500) for (const [k, t] of sentIds) if (Date.now() - t > 6 * 3600e3) sentIds.delete(k)
}
const wasSentBySystem = id => !!id && sentIds.has(id)

// Envia texto. Confere a conexão e o número antes (socket caído aceitaria a
// mensagem como PENDING sem entregar). Devolve { ok, id, to, error }.
async function sendText(phone, text, { typingMs = 0 } = {}) {
  const c = cfg()
  if (!c) return { ok: false, error: 'WhatsApp não configurado (EVOLUTION_API_URL/KEY/INSTANCE).' }
  const to = normalizePhone(phone)
  if (!to) return { ok: false, error: 'Telefone inválido.' }
  try {
    const state = await connectionState()
    if (state !== 'open') return { ok: false, error: `WhatsApp desconectado (estado: ${state}).` }
    let dest = to
    const hit = jidCache.get(to)
    if (hit && Date.now() - hit.at < 12 * 3600e3) dest = hit.dest
    else {
      try {
        const chk = await fetch(`${c.base}/chat/whatsappNumbers/${c.instance}`, {
          method: 'POST', headers: c.headers, body: JSON.stringify({ numbers: [to] }), signal: AbortSignal.timeout(8000)
        }).then(r => r.json())
        const info = Array.isArray(chk) ? chk[0] : null
        if (info && info.exists === false) return { ok: false, error: 'O número não tem WhatsApp.' }
        if (info?.jid) dest = String(info.jid).replace(/@.*/, '')
        jidCache.set(to, { at: Date.now(), dest })
      } catch (_) { /* segue com o número original */ }
    }
    const body = { number: dest, text: String(text).slice(0, 4000) }
    if (typingMs) body.delay = Math.min(typingMs, 2500)
    const r = await fetch(`${c.base}/message/sendText/${c.instance}`, {
      method: 'POST', headers: c.headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20000)
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return { ok: false, error: `Evolution respondeu ${r.status}: ${JSON.stringify(j).slice(0, 200)}` }
    rememberSent(j?.key?.id)
    return { ok: true, id: j?.key?.id || null, to: dest }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

// Aponta o webhook da instância para o servidor (só a mensagem recebida interessa)
async function configureWebhook(url) {
  const c = cfg()
  if (!c) return { ok: false, error: 'WhatsApp não configurado' }
  try {
    const cur = await fetch(`${c.base}/webhook/find/${c.instance}`, { headers: c.headers }).then(r => r.json()).catch(() => null)
    if (cur?.enabled && cur?.url === url) return { ok: true, unchanged: true }
    const r = await fetch(`${c.base}/webhook/set/${c.instance}`, {
      method: 'POST', headers: c.headers,
      body: JSON.stringify({ webhook: { enabled: true, url, byEvents: false, base64: false, events: ['MESSAGES_UPSERT'] } })
    })
    const j = await r.json().catch(() => ({}))
    return r.ok ? { ok: true } : { ok: false, error: `Evolution respondeu ${r.status}: ${JSON.stringify(j).slice(0, 200)}` }
  } catch (e) { return { ok: false, error: e.message } }
}

// Texto de uma mensagem recebida (ou um marcador para áudio/imagem/etc.)
function messageText(m) {
  const msg = m?.message || {}
  const get = (k, f) => msg[k]?.[f] ?? null
  return msg.conversation ?? get('extendedTextMessage', 'text') ?? get('imageMessage', 'caption') ??
    get('videoMessage', 'caption') ?? get('buttonsResponseMessage', 'selectedDisplayText') ??
    get('listResponseMessage', 'title') ?? get('ephemeralMessage', 'message')?.conversation ??
    (msg.audioMessage ? '[áudio]' : msg.imageMessage ? '[imagem]' : msg.stickerMessage ? '[figurinha]'
      : msg.documentMessage ? '[documento]' : msg.locationMessage ? '[localização]' : msg.contactMessage ? '[contato]' : null)
}

// Telefone da conversa. Contas com LID (@lid) trazem o número em remoteJidAlt/senderPn.
function messagePhone(m) {
  const jid = m?.key?.remoteJid || ''
  if (!jid || /@g\.us|@broadcast|@newsletter|status@/.test(jid)) return null
  const real = jid.endsWith('@lid') ? (m.key?.remoteJidAlt || m.key?.senderPn || m.senderPn || '') : jid
  return normalizePhone(real.replace(/@.*/, ''))
}

export {
  configured, connectionState, sendText, configureWebhook, webhookToken, webhookTokenOk,
  normalizePhone, phoneVariants, samePhone, messageText, messagePhone, wasSentBySystem, rememberSent
}
