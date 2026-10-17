// Recordatorio de pago en IMAGEN (PNG) para mandarlo por WhatsApp (plan
// Completo): le dice al cliente cuánto le falta pagar, con un círculo de lo
// que ya pagó, sus abonos y cómo pagar. Se dibuja en el navegador con
// <canvas>, sin librerías. La factura en PDF sigue aparte.
import { currency, shortDate } from './format'

export type ReminderData = {
  siteName: string
  number: string
  createdAt: string
  dueDate: string | null
  customerName: string
  items: Array<{ productName: string; quantity: number; totalCents: number; satisfactionDays?: number }>
  totalCents: number
  paidCents: number
  balanceCents: number
  payments: Array<{ amountCents: number; method: string; createdAt: string }>
  paymentMethods: string[]
  phone: string
}

const C = {
  page: '#f5f1e9',
  card: '#fffefa',
  band: '#3e4938',
  sage: '#66735b',
  track: '#e4e0d3',
  ink: '#1e211c',
  muted: '#6e7169',
  line: '#e7e2d7',
  terracotta: '#b76448',
  cream: '#f5f1e9',
}
const SERIF = "Georgia, 'Times New Roman', serif"
const SANS = "'Avenir Next', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
const W = 1080
const PAD = 54 // borde de la página
const IN = 56 // margen dentro de la tarjeta

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, maxLines = 99): string[] {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (ctx.measureText(next).width <= width || !current) current = next
    else { lines.push(current); current = word }
  }
  if (current) lines.push(current)
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  let last = kept[maxLines - 1]
  while (last.length > 1 && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1)
  kept[maxLines - 1] = `${last}…`
  return kept
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Dibuja (o, con draw = false, solo mide) el recordatorio. Devuelve la altura. */
function paint(ctx: CanvasRenderingContext2D, data: ReminderData, height: number, draw: boolean): number {
  const X0 = PAD
  const X1 = W - PAD
  const L = X0 + IN
  const R = X1 - IN
  const CW = R - L
  const text = (value: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = 'left') => {
    ctx.font = font
    if (!draw) return
    ctx.fillStyle = color
    ctx.textAlign = align
    ctx.fillText(value, x, y)
    ctx.textAlign = 'left'
  }
  const rule = (y: number) => { if (draw) { ctx.fillStyle = C.line; ctx.fillRect(L, y, CW, 2) } }

  const bandH = 150
  if (draw) {
    ctx.fillStyle = C.page
    ctx.fillRect(0, 0, W, height)
    roundRect(ctx, X0, PAD, X1 - X0, height - PAD * 2, 30)
    ctx.fillStyle = C.card
    ctx.fill()
    ctx.save()
    roundRect(ctx, X0, PAD, X1 - X0, height - PAD * 2, 30)
    ctx.clip()
    ctx.fillStyle = C.band
    ctx.fillRect(X0, PAD, X1 - X0, bandH)
    ctx.restore()
  }
  // Encabezado: tienda y número de factura.
  text(data.siteName, L, PAD + 78, `400 44px ${SERIF}`, '#ffffff')
  text('RECORDATORIO DE PAGO', L, PAD + 114, `700 18px ${SANS}`, '#c9d1bf')
  text(data.number, R, PAD + 78, `600 24px ${SANS}`, '#ffffff', 'right')
  text(shortDate(data.createdAt), R, PAD + 114, `500 20px ${SANS}`, '#c9d1bf', 'right')

  // Saludo.
  let y = PAD + bandH + 92
  const first = data.customerName.trim().split(/\s+/)[0] || 'cliente'
  text(`Hola, ${first}.`, L, y, `400 50px ${SERIF}`, C.ink)
  y += 46
  text('Este es el resumen de tu pedido y lo que te falta pagar.', L, y, `500 24px ${SANS}`, C.muted)

  // Círculo de lo pagado + lo que falta.
  y += 52
  const ringR = 92
  const cx = L + ringR + 4
  const cy = y + ringR + 6
  const share = data.totalCents > 0 ? Math.min(1, data.paidCents / data.totalCents) : 0
  if (draw) {
    ctx.lineCap = 'round'
    ctx.lineWidth = 24
    ctx.strokeStyle = C.track
    ctx.beginPath(); ctx.arc(cx, cy, ringR, 0, Math.PI * 2); ctx.stroke()
    if (share > 0) {
      ctx.strokeStyle = C.sage
      ctx.beginPath(); ctx.arc(cx, cy, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * share); ctx.stroke()
    }
    ctx.lineCap = 'butt'
  }
  text(`${Math.round(share * 100)}%`, cx, cy + 6, `700 40px ${SANS}`, C.ink, 'center')
  text('pagado', cx, cy + 38, `500 19px ${SANS}`, C.muted, 'center')
  const tx = cx + ringR + 56
  text('TE FALTA PAGAR', tx, y + 52, `700 19px ${SANS}`, C.terracotta)
  text(currency(data.balanceCents), tx, y + 134, `400 82px ${SERIF}`, C.terracotta)
  text(`Pagado ${currency(data.paidCents)} de ${currency(data.totalCents)}`, tx, y + 178, `500 23px ${SANS}`, C.muted)
  y = cy + ringR + 30
  if (data.dueDate) {
    y += 34
    const due = `Fecha límite para pagar: ${shortDate(data.dueDate)}`
    ctx.font = `700 22px ${SANS}`
    const dueW = ctx.measureText(due).width + 44
    if (draw) { roundRect(ctx, L, y - 32, dueW, 48, 24); ctx.fillStyle = '#f6e7e1'; ctx.fill() }
    text(due, L + 22, y, `700 22px ${SANS}`, C.terracotta)
    y += 26
  }

  // Productos.
  y += 46
  rule(y)
  y += 52
  text('LO QUE PEDISTE', L, y, `700 18px ${SANS}`, C.sage)
  for (const item of data.items) {
    ctx.font = `600 25px ${SANS}`
    const lines = wrap(ctx, `${item.quantity} × ${item.productName}`, CW - 200, 2)
    y += 44
    text(currency(item.totalCents), R, y, `600 25px ${SANS}`, C.ink, 'right')
    lines.forEach((line, index) => text(line, L, y + index * 32, `600 25px ${SANS}`, C.ink))
    y += (lines.length - 1) * 32
    if ((item.satisfactionDays ?? 0) > 0) {
      const days = item.satisfactionDays ?? 0
      y += 32
      text(`✓ Satisfacción garantizada · ${days} ${days === 1 ? 'día' : 'días'}`, L, y, `600 20px ${SANS}`, C.sage)
    }
  }

  // Abonos.
  if (data.payments.length) {
    y += 40
    rule(y)
    y += 52
    text('TUS ABONOS', L, y, `700 18px ${SANS}`, C.sage)
    for (const payment of data.payments) {
      y += 40
      text(`${shortDate(payment.createdAt)} · ${payment.method}`, L, y, `500 23px ${SANS}`, C.muted)
      text(currency(payment.amountCents), R, y, `600 23px ${SANS}`, C.ink, 'right')
    }
  }

  // Cómo pagar.
  y += 44
  const howLines = data.paymentMethods.length ? (() => { ctx.font = `500 23px ${SANS}`; return wrap(ctx, data.paymentMethods.join(' · '), CW - 56, 3) })() : []
  const boxH = 74 + howLines.length * 32 + (data.phone ? 40 : 0)
  if (draw) { roundRect(ctx, L, y, CW, boxH, 20); ctx.fillStyle = C.cream; ctx.fill() }
  text('CÓMO PAGAR', L + 28, y + 44, `700 18px ${SANS}`, C.sage)
  let hy = y + 44
  for (const line of howLines) { hy += 32; text(line, L + 28, hy, `500 23px ${SANS}`, C.ink) }
  if (data.phone) { hy += 40; text(`¿Ya pagaste? Mándanos el comprobante al WhatsApp ${data.phone}`, L + 28, hy, `600 21px ${SANS}`, C.terracotta) }
  y += boxH

  y += 66
  text(`Gracias por comprar en ${data.siteName}`, W / 2, y, `400 30px ${SERIF}`, C.ink, 'center')
  y += 44
  return y + PAD
}

/** Dibuja el recordatorio y lo devuelve como PNG. */
export async function reminderImage(data: ReminderData): Promise<Blob> {
  const probe = document.createElement('canvas').getContext('2d')!
  const height = Math.ceil(paint(probe, data, 0, false))
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  paint(ctx, data, height, true)
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No se pudo crear la imagen.'))), 'image/png'))
}
