import crypto from 'crypto'

// ─── Mercado Pago — Pix dinâmico ──────────────────────────────────────────────
//
// Diferente do Pix estático, aqui a cobrança é criada na API do Mercado Pago e
// tem um identificador próprio. Quando o paciente paga, o MP chama nosso webhook
// e o pagamento é confirmado sozinho no livro-caixa.

const MP_API = 'https://api.mercadopago.com'

function accessToken() {
  return (process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim()
}

function isConfigured() {
  return !!accessToken()
}

// O MP exige data no formato ISO com offset explícito (usamos Brasília, -03:00)
function toMpDate(d) {
  const pad = n => String(n).padStart(2, '0')
  const brt = new Date(d.getTime() - 3 * 60 * 60 * 1000)
  return `${brt.getUTCFullYear()}-${pad(brt.getUTCMonth() + 1)}-${pad(brt.getUTCDate())}` +
         `T${pad(brt.getUTCHours())}:${pad(brt.getUTCMinutes())}:${pad(brt.getUTCSeconds())}.000-03:00`
}

/**
 * Cria uma cobrança Pix no Mercado Pago.
 * Retorna o QR (imagem) e o copia-e-cola já prontos para exibir ao paciente.
 */
async function createPixPayment({
  amount, description, payerEmail, payerFirstName,
  externalReference, notificationUrl, expiresInMinutes = 60
}) {
  if (!isConfigured()) throw new Error('MERCADOPAGO_ACCESS_TOKEN não configurado')

  const expiration = new Date(Date.now() + expiresInMinutes * 60 * 1000)

  const body = {
    transaction_amount: Number(Number(amount).toFixed(2)),
    description: description || 'Consulta',
    payment_method_id: 'pix',
    payer: {
      email: payerEmail,
      ...(payerFirstName ? { first_name: payerFirstName } : {})
    },
    external_reference: externalReference || undefined,
    date_of_expiration: toMpDate(expiration)
  }
  if (notificationUrl) body.notification_url = notificationUrl

  const res = await fetch(`${MP_API}/v1/payments`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken()}`,
      'Content-Type': 'application/json',
      // Evita cobrança duplicada se a requisição for reenviada
      'X-Idempotency-Key': crypto.randomUUID()
    },
    body: JSON.stringify(body)
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.message || data?.error || `Erro ${res.status} no Mercado Pago`
    throw new Error(msg)
  }

  const td = data.point_of_interaction?.transaction_data || {}
  return {
    id: String(data.id),
    status: data.status,                       // normalmente 'pending'
    qr_code: td.qr_code || null,               // copia e cola
    qr_code_base64: td.qr_code_base64 ? `data:image/png;base64,${td.qr_code_base64}` : null,
    ticket_url: td.ticket_url || null,
    expires_at: data.date_of_expiration || expiration.toISOString()
  }
}

// Consulta o pagamento no MP (usado pelo webhook, que só manda o id)
async function getPayment(id) {
  if (!isConfigured()) throw new Error('MERCADOPAGO_ACCESS_TOKEN não configurado')
  const res = await fetch(`${MP_API}/v1/payments/${id}`, {
    headers: { 'Authorization': `Bearer ${accessToken()}` }
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.message || `Erro ${res.status} ao consultar pagamento`)
  return data
}

/**
 * Valida a assinatura do webhook (header x-signature).
 *
 * O MP monta um "manifest" no formato:
 *   id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 * e assina com HMAC-SHA256 usando a Assinatura Secreta do painel.
 *
 * Sem o segredo configurado, aceitamos (mas avisamos no log) — assim o sistema
 * não quebra antes de a chave ser preenchida.
 */
function verifyWebhookSignature({ xSignature, xRequestId, dataId }) {
  const secret = (process.env.MERCADOPAGO_WEBHOOK_SECRET || '').trim()
  if (!secret) {
    console.warn('⚠️  MERCADOPAGO_WEBHOOK_SECRET não configurado — webhook aceito sem validar assinatura.')
    return true
  }
  if (!xSignature) return false

  const parts = {}
  String(xSignature).split(',').forEach(p => {
    const [k, v] = p.split('=')
    if (k && v) parts[k.trim()] = v.trim()
  })

  const { ts, v1 } = parts
  if (!ts || !v1) return false

  const id = String(dataId || '').toLowerCase()
  const manifest = `id:${id};request-id:${xRequestId || ''};ts:${ts};`
  const hmac = crypto.createHmac('sha256', secret).update(manifest).digest('hex')

  try {
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(v1))
  } catch {
    return false
  }
}

export { isConfigured, createPixPayment, getPayment, verifyWebhookSignature }
