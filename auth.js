import crypto from 'crypto'

// ─── Autenticação de profissionais ───────────────────────────────────────────
// Contas individuais (e-mail + senha). Sem dependências externas: usa scrypt
// para hash de senha e um token assinado por HMAC guardado em cookie httpOnly.

// Segredo de assinatura do cookie de sessão. Idealmente vem do ambiente
// (JWT_SECRET no Coolify). Se não estiver definido, gera um efêmero por boot —
// o sistema funciona, mas os logins caem quando o container reinicia.
let SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || ''
if (!SECRET) {
  SECRET = crypto.randomBytes(48).toString('hex')
  console.warn('⚠️  JWT_SECRET não definido — usando segredo efêmero. Defina JWT_SECRET no Coolify para manter os logins após reiniciar.')
}

const SESSION_DAYS = 30
const COOKIE_NAME  = 'fisio_session'

// ── Hash de senha (scrypt) ────────────────────────────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored).split(':')
    if (!salt || !hash) return false
    const test = crypto.scryptSync(password, salt, 64)
    const known = Buffer.from(hash, 'hex')
    return test.length === known.length && crypto.timingSafeEqual(test, known)
  } catch {
    return false
  }
}

// ── Token de sessão assinado ──────────────────────────────────────────────────
function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function fromBase64url(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function signToken(payload) {
  const body = base64url(JSON.stringify(payload))
  const sig  = base64url(crypto.createHmac('sha256', SECRET).update(body).digest())
  return `${body}.${sig}`
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = base64url(crypto.createHmac('sha256', SECRET).update(body).digest())
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(fromBase64url(body).toString('utf8'))
    if (payload.exp && Date.now() > payload.exp) return null
    return payload
  } catch {
    return null
  }
}

// ── Cookies ───────────────────────────────────────────────────────────────────
function parseCookies(req) {
  const header = req.headers.cookie
  const out = {}
  if (!header) return out
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=')
    if (idx === -1) return
    const k = pair.slice(0, idx).trim()
    const v = pair.slice(idx + 1).trim()
    out[k] = decodeURIComponent(v)
  })
  return out
}

function issueSessionCookie(res, user) {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000
  const token = signToken({ uid: user.id, name: user.name, email: user.email, exp })
  const maxAge = SESSION_DAYS * 24 * 60 * 60
  // Secure só faz sentido em HTTPS (produção via Coolify/Traefik).
  const secure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true'
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`)
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
}

function getUserFromRequest(req) {
  const cookies = parseCookies(req)
  return verifyToken(cookies[COOKIE_NAME])
}

// ── Middlewares ───────────────────────────────────────────────────────────────

// Protege rotas de API — responde 401 (cliente redireciona para /login)
function requireAuth(req, res, next) {
  const user = getUserFromRequest(req)
  if (!user) return res.status(401).json({ error: 'Não autenticado' })
  req.user = user
  next()
}

// Protege a página /doctor — redireciona para /login se não autenticado
function requireAuthPage(req, res, next) {
  const user = getUserFromRequest(req)
  if (!user) return res.redirect('/login')
  req.user = user
  next()
}

export {
  hashPassword,
  verifyPassword,
  issueSessionCookie,
  clearSessionCookie,
  getUserFromRequest,
  requireAuth,
  requireAuthPage,
  COOKIE_NAME
}
