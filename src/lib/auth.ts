// Autenticación administrativa sin Netlify Identity.
//
// Modelo: existe un único usuario administrador cuya contraseña vive en el
// secreto de Cloudflare `ADMIN_PASSWORD`. Al iniciar sesión correctamente se
// entrega una cookie httpOnly con un token firmado (HMAC-SHA256 con el
// secreto `SESSION_SECRET`). Cada request administrativo valida esa firma;
// no se guarda ningún estado de sesión en la base de datos.

const COOKIE_NAME = 'aura_beauty'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 días

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await hmacKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return toBase64Url(new Uint8Array(signature))
}

/** Genera el valor de la cookie de sesión: `<payload base64url>.<firma base64url>` */
export async function createSessionToken(secret: string): Promise<string> {
  const payload = JSON.stringify({ exp: Date.now() + SESSION_TTL_SECONDS * 1000 })
  const encodedPayload = toBase64Url(new TextEncoder().encode(payload))
  const signature = await sign(encodedPayload, secret)
  return `${encodedPayload}.${signature}`
}

export async function verifySessionToken(token: string | null | undefined, secret: string): Promise<boolean> {
  if (!token) return false
  const [encodedPayload, signature] = token.split('.')
  if (!encodedPayload || !signature) return false
  const expectedSignature = await sign(encodedPayload, secret)
  if (!timingSafeEqual(signature, expectedSignature)) return false
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload))) as { exp: number }
    return typeof payload.exp === 'number' && payload.exp > Date.now()
  } catch {
    return false
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

export function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

export function buildSessionCookie(token: string): string {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`
}

export function buildClearedSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

export async function isAuthenticated(request: Request, sessionSecret: string): Promise<boolean> {
  const token = getCookie(request, COOKIE_NAME)
  return verifySessionToken(token, sessionSecret)
}

/** Compara la contraseña sin revelar su largo ni cuántas letras coinciden:
 * se comparan las firmas HMAC de ambas, que siempre miden lo mismo. */
export async function comparePassword(input: string, expected: string): Promise<boolean> {
  const key = crypto.getRandomValues(new Uint8Array(32))
  const secret = toBase64Url(key)
  const [a, b] = await Promise.all([sign(input, secret), sign(expected, secret)])
  return timingSafeEqual(a, b)
}

/** Solo acepta pedidos de cambio que vengan de esta misma página. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return true
  try {
    return new URL(origin).host === new URL(request.url).host
  } catch {
    return false
  }
}
