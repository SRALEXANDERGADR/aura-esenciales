import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '../../../db/index.js'
import { appSettings, customers, invoiceItems, invoices, payments, products, pushSubscriptions, siteContent } from '../../../db/schema.js'
import { isAuthenticated, sameOrigin } from '@/lib/auth'
import { sendOrderNotificationEmail } from '@/lib/email'
import { uploadProductImage } from '@/lib/github'
import { DEFAULT_SITE_CONTENT, mergeSiteContent } from '@/lib/site-content'
import { currency } from '@/lib/format'
import { generateVapidKeys, sendPush, type PushMessage, type VapidKeys } from '@/lib/push'

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
const error = (message: string, status = 400) => json({ error: message }, status)

/** Días que algo se queda en la Papelera antes de borrarse solo. */
const TRASH_DAYS = 60
const PAYMENT_METHODS = ['Efectivo', 'Transferencia', 'Tarjeta', 'Otro']
const MAX_LINES = 30
const MAX_QTY = 99

class UserError extends Error {}

const text = (value: unknown, max = 300) => String(value ?? '').trim().slice(0, max)
const cents = (value: unknown) => Math.max(0, Math.min(1_000_000_000, Math.round(Number(value) || 0)))
const onlyDigits = (value: string) => value.replace(/\D/g, '')
/** "2026-10-05" → fin de ese día en República Dominicana, para que no salga un día antes. */
const parseDueDate = (value: unknown) => {
  const raw = String(value || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T23:59:00-04:00`)
  return raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw) : null
}

const seedProducts = [
  { code: 'CH-001', name: 'Champú Botánico', category: 'Cabello', description: 'Limpieza suave con romero y sábila para uso diario.', priceCents: 48500, stock: 24, featured: true, imageUrl: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=900&q=85' },
  { code: 'AC-002', name: 'Acondicionador Nutritivo', category: 'Cabello', description: 'Fórmula cremosa que desenreda y devuelve el brillo natural.', priceCents: 52500, stock: 18, featured: true, imageUrl: 'https://images.unsplash.com/photo-1608248597279-f99d160bfcbc?auto=format&fit=crop&w=900&q=85' },
  { code: 'CR-003', name: 'Crema Corporal Seda', category: 'Cuerpo', description: 'Hidratación profunda con una textura ligera y aroma limpio.', priceCents: 65000, stock: 15, featured: false, imageUrl: 'https://images.unsplash.com/photo-1601049541289-9b1b7bbbfe19?auto=format&fit=crop&w=900&q=85' },
  { code: 'SE-004', name: 'Sérum Luminosidad', category: 'Rostro', description: 'Concentrado facial para una apariencia uniforme y radiante.', priceCents: 89000, stock: 9, featured: true, imageUrl: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=900&q=85' },
]

// Columnas nuevas: se crean solas la primera vez que el Worker arranca.
// Si agregas otra, súmala aquí y sube el número.
const SCHEMA_VERSION = 3
let schemaReady: Promise<void> | null = null
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at timestamptz`)
      await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS deleted_at timestamptz`)
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deleted_at timestamptz`)
      await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS images text NOT NULL DEFAULT '[]'`)
      await db.execute(sql`CREATE TABLE IF NOT EXISTS push_subscriptions (id serial PRIMARY KEY, endpoint text NOT NULL UNIQUE, p256dh text NOT NULL, auth text NOT NULL, label text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now())`)
      await db.execute(sql`CREATE TABLE IF NOT EXISTS app_settings (key text PRIMARY KEY, value text NOT NULL DEFAULT '')`)
      void SCHEMA_VERSION
    })().catch((caught) => {
      schemaReady = null
      throw caught
    })
  }
  return schemaReady
}

const PHOTO_PREFIX = '/fotos/'
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

/** Guarda una foto en R2 (o en GitHub si el Worker no tiene R2) y devuelve su dirección. */
async function uploadPhoto(filename: string, dataUrl: string) {
  if (!env.FOTOS) return uploadProductImage(env, { filename, dataUrl })
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl)
  if (!match) throw new UserError('El archivo debe ser una imagen.')
  const [, contentType, base64] = match
  if (base64.length * 0.75 > MAX_IMAGE_BYTES) throw new UserError('La imagen no puede superar 8 MB.')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return savePhoto(filename, bytes, contentType)
}

async function savePhoto(filename: string, bytes: Uint8Array | ArrayBuffer, contentType: string) {
  const extension = contentType.split('/')[1]?.split('+')[0]?.toLowerCase().replace('jpeg', 'jpg') || 'jpg'
  const safeBase = filename.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60)
  const key = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${safeBase || 'foto'}.${extension}`
  await env.FOTOS!.put(key, bytes, { httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' } })
  return PHOTO_PREFIX + key
}

/** Borra de R2 una foto que ya nadie usa (ni otro producto ni los textos). */
async function deletePhotoIfUnused(url: string) {
  if (!env.FOTOS || !url.startsWith(PHOTO_PREFIX)) return
  const [product] = await db.select({ id: products.id }).from(products).where(or(eq(products.imageUrl, url), sql`${products.images} like ${`%${JSON.stringify(url)}%`}`)).limit(1)
  const [content] = await db.select({ key: siteContent.key }).from(siteContent).where(eq(siteContent.value, url)).limit(1)
  if (!product && !content) await env.FOTOS.delete(url.slice(PHOTO_PREFIX.length))
}

// ── Avisos al teléfono (app "Aura Admin") — ver src/lib/push.ts ──
const PUSH_SUBJECT = 'https://aurabeauty.gadrnet.workers.dev'

/** Claves de los avisos: se crean solas la primera vez y nunca salen del servidor. */
async function getVapidKeys(): Promise<VapidKeys> {
  const read = async () => {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, 'vapidKeys')).limit(1)
    try { return row?.value ? (JSON.parse(row.value) as VapidKeys) : null } catch { return null }
  }
  const existing = await read()
  if (existing?.publicKey && existing.privateJwk) return existing
  await db.insert(appSettings).values({ key: 'vapidKeys', value: JSON.stringify(await generateVapidKeys()) }).onConflictDoNothing()
  return (await read())!
}

async function sendToSubscriptions(rows: Array<typeof pushSubscriptions.$inferSelect>, message: PushMessage) {
  if (!rows.length) return { sent: 0, problem: 'no hay aparatos' }
  const keys = await getVapidKeys()
  const results = await Promise.all(rows.map((row) => sendPush(row, message, keys, PUSH_SUBJECT)))
  // Si el servicio de avisos falló un momento (sin conexión, "muy ocupado" o
  // error de su lado), se intenta una vez más antes de rendirse.
  const retry = rows.map((_, index) => index).filter((index) => results[index].result === 'error' && (results[index].status === 0 || results[index].status === 429 || results[index].status >= 500))
  if (retry.length) {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await Promise.all(retry.map(async (index) => { results[index] = await sendPush(rows[index], message, keys, PUSH_SUBJECT) }))
  }
  // Aparatos que ya no existen (app desinstalada o permiso quitado): fuera.
  const gone = rows.filter((_, index) => results[index].result === 'gone').map((row) => row.id)
  if (gone.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone))
  const problem = results.find((item) => item.result !== 'ok')
  return { sent: results.filter((item) => item.result === 'ok').length, problem: problem ? `código ${problem.status || 'sin respuesta'}${problem.detail ? `: ${problem.detail}` : ''}` : '' }
}

async function ensureProducts() {
  const existing = await db.select({ id: products.id }).from(products).limit(1)
  if (!existing.length) await db.insert(products).values(seedProducts).onConflictDoNothing()
}

async function getSiteContent() {
  const rows = await db.select().from(siteContent)
  const overrides = Object.fromEntries(rows.map((row) => [row.key, row.value]))
  return mergeSiteContent(overrides)
}

async function saveSiteContent(body: Record<string, unknown>) {
  const entries = Object.entries(body).filter(([key, value]) => key in DEFAULT_SITE_CONTENT && typeof value === 'string')
  if (!entries.length) return error('No se recibió contenido válido para guardar.')
  const now = new Date()
  // Una sola consulta para todos los textos, en vez de una por cada uno.
  await db
    .insert(siteContent)
    .values(entries.map(([key, value]) => ({ key, value: (value as string).slice(0, 4000), updatedAt: now })))
    .onConflictDoUpdate({ target: siteContent.key, set: { value: sql`excluded.value`, updatedAt: now } })
  return json(await getSiteContent())
}

async function requireAdmin(request: Request): Promise<boolean> {
  if (!env.SESSION_SECRET) return false
  return isAuthenticated(request, env.SESSION_SECRET)
}

async function listInvoices() {
  const invoiceRows = await db
    .select({ invoice: invoices, customerName: customers.name, customerPhone: customers.phone })
    .from(invoices)
    .innerJoin(customers, eq(invoices.customerId, customers.id))
    .orderBy(desc(invoices.createdAt))
  const ids = invoiceRows.map(({ invoice }) => invoice.id)
  const itemRows = ids.length ? await db.select().from(invoiceItems).where(inArray(invoiceItems.invoiceId, ids)).orderBy(asc(invoiceItems.id)) : []
  const paymentRows = ids.length ? await db.select().from(payments).where(inArray(payments.invoiceId, ids)).orderBy(desc(payments.createdAt)) : []
  return invoiceRows.map(({ invoice, customerName, customerPhone }) => ({
    ...invoice,
    customerName,
    customerPhone,
    balanceCents: Math.max(0, invoice.totalCents - invoice.paidCents),
    status: invoice.paidCents >= invoice.totalCents ? 'paid' : invoice.dueDate && invoice.dueDate < new Date() ? 'overdue' : invoice.paidCents > 0 ? 'partial' : 'pending',
    items: itemRows.filter((item) => item.invoiceId === invoice.id),
    payments: paymentRows.filter((payment) => payment.invoiceId === invoice.id),
  }))
}

/** Saca unidades del inventario sin pasarse de lo que hay. Si una línea no
 * alcanza, devuelve las que ya sacó y avisa. (Neon HTTP no tiene
 * transacciones, por eso se hace así.) */
async function takeStock(lines: Array<{ productId: number; quantity: number; name: string }>) {
  const taken: typeof lines = []
  for (const line of lines) {
    const [row] = await db
      .update(products)
      .set({ stock: sql`${products.stock} - ${line.quantity}`, updatedAt: new Date() })
      .where(and(eq(products.id, line.productId), gte(products.stock, line.quantity)))
      .returning({ id: products.id })
    if (!row) {
      await returnStock(taken)
      throw new UserError(`No hay suficiente de ${line.name}.`)
    }
    taken.push(line)
  }
}

async function returnStock(lines: Array<{ productId: number | null; quantity: number }>) {
  for (const line of lines) {
    if (!line.productId) continue
    await db.update(products).set({ stock: sql`${products.stock} + ${line.quantity}`, updatedAt: new Date() }).where(eq(products.id, line.productId))
  }
}

function normalizeItems(rawItems: unknown[]) {
  const merged = new Map<number, number>()
  for (const raw of rawItems.slice(0, MAX_LINES)) {
    const item = raw as Record<string, unknown>
    const productId = Math.trunc(Number(item?.productId))
    const quantity = Math.trunc(Number(item?.quantity))
    if (!productId || productId < 0) continue
    if (!quantity || quantity < 1) throw new UserError('La cantidad de cada producto debe ser al menos 1.')
    merged.set(productId, (merged.get(productId) || 0) + quantity)
  }
  for (const quantity of merged.values()) if (quantity > MAX_QTY) throw new UserError(`Puedes pedir hasta ${MAX_QTY} unidades de cada producto.`)
  return [...merged].map(([productId, quantity]) => ({ productId, quantity }))
}

async function findOrCreatePublicCustomer(data: Record<string, unknown> | undefined) {
  const name = text(data?.name, 80)
  const phone = text(data?.phone, 25)
  const email = text(data?.email, 120)
  const address = text(data?.address, 250)
  const digits = onlyDigits(phone)
  if (!name || !phone) throw new UserError('Nombre y teléfono son obligatorios.')
  if (digits.length < 7 || digits.length > 15) throw new UserError('Escribe un teléfono válido.')
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError('Escribe un correo válido o déjalo vacío.')

  const [existing] = await db
    .select()
    .from(customers)
    .where(sql`regexp_replace(${customers.phone}, '\\D', '', 'g') = ${digits}`)
    .orderBy(asc(customers.id))
    .limit(1)
  if (existing) {
    // No se cambian los datos que ya tenía el cliente (alguien más podría
    // escribir su teléfono). Solo se llenan los que estaban vacíos.
    await db
      .update(customers)
      .set({ email: existing.email || email, address: existing.address || address, deletedAt: null, updatedAt: new Date() })
      .where(eq(customers.id, existing.id))
    return { id: existing.id, name, phone, email, address }
  }
  const [created] = await db.insert(customers).values({ name, phone, email, address }).returning()
  return { id: created.id, name, phone, email, address }
}

async function createInvoice(body: Record<string, unknown>, publicOrder = false) {
  const rawItems = Array.isArray(body.items) ? body.items : []
  if (!rawItems.length) return error('Agrega al menos un producto.')
  const items = normalizeItems(rawItems)
  if (!items.length) return error('Agrega al menos un producto.')

  const productRows = await db.select().from(products).where(and(inArray(products.id, items.map((item) => item.productId)), isNull(products.deletedAt)))
  const detailedItems = items.map((item) => {
    const product = productRows.find((row) => row.id === item.productId)
    if (!product || (publicOrder && !product.active)) throw new UserError('Uno de los productos ya no está disponible. Actualiza la página.')
    if (product.stock < item.quantity) throw new UserError(`Solo quedan ${product.stock} de ${product.name}.`)
    return { product, quantity: item.quantity, totalCents: product.priceCents * item.quantity }
  })

  let customerId = Math.trunc(Number(body.customerId || 0))
  let publicCustomer: Awaited<ReturnType<typeof findOrCreatePublicCustomer>> | null = null
  let notes = text(body.notes, 500)
  if (publicOrder) {
    publicCustomer = await findOrCreatePublicCustomer(body.customer as Record<string, unknown> | undefined)
    customerId = publicCustomer.id
    notes = [`Pedido desde la tienda.`, `Nombre: ${publicCustomer.name}`, `Teléfono: ${publicCustomer.phone}`, publicCustomer.address && `Dirección: ${publicCustomer.address}`, publicCustomer.email && `Correo: ${publicCustomer.email}`].filter(Boolean).join('\n')
  } else {
    const [customer] = customerId ? await db.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId)).limit(1) : []
    if (!customer) return error('Selecciona un cliente.')
  }

  const subtotalCents = detailedItems.reduce((sum, item) => sum + item.totalCents, 0)
  const discountCents = publicOrder ? 0 : Math.min(subtotalCents, cents(body.discountCents))
  const totalCents = subtotalCents - discountCents
  const paidCents = publicOrder ? 0 : Math.min(totalCents, cents(body.paidCents))
  const method = PAYMENT_METHODS.includes(String(body.method)) ? String(body.method) : 'Efectivo'
  const status = paidCents >= totalCents ? 'paid' : paidCents > 0 ? 'partial' : 'pending'
  const number = `FAC-${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`
  const dueDate = publicOrder ? null : parseDueDate(body.dueDate)

  // Primero se aparta el inventario; si algo falla después, se devuelve.
  await takeStock(detailedItems.map(({ product, quantity }) => ({ productId: product.id, quantity, name: product.name })))
  let invoice: typeof invoices.$inferSelect
  try {
    ;[invoice] = await db.insert(invoices).values({ number, customerId, subtotalCents, discountCents, totalCents, paidCents, status, notes, dueDate }).returning()
    await db.insert(invoiceItems).values(detailedItems.map(({ product, quantity, totalCents: lineTotal }) => ({ invoiceId: invoice.id, productId: product.id, productCode: product.code, productName: product.name, quantity, unitPriceCents: product.priceCents, totalCents: lineTotal })))
    if (paidCents > 0) await db.insert(payments).values({ invoiceId: invoice.id, amountCents: paidCents, method, note: 'Pago inicial' })
  } catch (caught) {
    await returnStock(detailedItems.map(({ product, quantity }) => ({ productId: product.id, quantity })))
    throw caught
  }

  if (publicCustomer) {
    try {
      const content = await getSiteContent()
      if (content.notification_email) {
        await sendOrderNotificationEmail(env, {
          to: content.notification_email,
          customer: { name: publicCustomer.name, phone: publicCustomer.phone, email: publicCustomer.email, address: publicCustomer.address },
          invoice: { number: invoice.number, createdAt: invoice.createdAt, subtotalCents: invoice.subtotalCents, discountCents: invoice.discountCents, totalCents: invoice.totalCents, paidCents: invoice.paidCents, notes: '' },
          items: detailedItems.map(({ product, quantity, totalCents: lineTotal }) => ({ productCode: product.code, productName: product.name, quantity, unitPriceCents: product.priceCents, totalCents: lineTotal })),
        })
      }
    } catch (caught) {
      console.error('No se pudo enviar el aviso del pedido:', caught)
    }
    // Aviso al teléfono. Si falla, el pedido ya quedó guardado igual.
    try {
      const units = detailedItems.reduce((sum, item) => sum + item.quantity, 0)
      const names = detailedItems.map(({ product, quantity }) => `${quantity}× ${product.name}`).join(', ')
      await sendToSubscriptions(await db.select().from(pushSubscriptions), {
        title: `🛍️ Nuevo pedido · ${currency(totalCents)}`,
        body: `${publicCustomer.name} pidió ${units} ${units === 1 ? 'producto' : 'productos'}: ${names}`.slice(0, 220),
        url: '/admin?tab=facturas',
        tag: invoice.number,
      })
    } catch (caught) {
      console.error('No se pudo mandar el aviso al teléfono:', caught)
    }
    return json({ invoice: { number: invoice.number }, message: 'Pedido registrado correctamente.' }, 201)
  }

  return json({ invoice, message: 'Factura creada correctamente.' }, 201)
}

const MAX_PHOTOS = 10
const isPhotoUrl = (url: string) => /^(https?:\/\/|\/)/i.test(url)

/** Lista de fotos guardada como JSON; si está vacía, usa la foto principal vieja. */
function parseImages(raw: string | null | undefined, imageUrl = ''): string[] {
  let list: unknown = []
  try { list = JSON.parse(raw || '[]') } catch { list = [] }
  const images = Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string' && isPhotoUrl(item)) : []
  return images.length ? images : imageUrl ? [imageUrl] : []
}

function withImages<T extends { images: string; imageUrl: string }>(row: T) {
  return { ...row, images: parseImages(row.images, row.imageUrl) }
}

function productValues(body: Record<string, unknown>) {
  const code = text(body.code, 40).toUpperCase()
  const name = text(body.name, 120)
  if (!code) throw new UserError('Escribe el código del producto.')
  if (!name) throw new UserError('Escribe el nombre del producto.')
  const raw = Array.isArray(body.images) ? body.images : body.imageUrl ? [body.imageUrl] : []
  const images = [...new Set(raw.map((item) => text(item, 1000)).filter(Boolean))].slice(0, MAX_PHOTOS)
  if (images.some((url) => !isPhotoUrl(url))) throw new UserError('Cada foto debe ser un enlace que empiece con https://')
  const imageUrl = images[0] || ''
  return {
    code,
    name,
    category: text(body.category, 60) || 'Cuidado personal',
    description: text(body.description, 2000),
    priceCents: cents(body.priceCents),
    stock: Math.max(0, Math.min(100000, Math.trunc(Number(body.stock) || 0))),
    imageUrl,
    images: JSON.stringify(images),
    featured: Boolean(body.featured),
    active: body.active !== false,
  }
}

function customerValues(body: Record<string, unknown>) {
  const name = text(body.name, 80)
  const phone = text(body.phone, 25)
  if (!name) throw new UserError('Escribe el nombre del cliente.')
  if (!phone) throw new UserError('Escribe el teléfono del cliente.')
  return { name, phone, email: text(body.email, 120), address: text(body.address, 250), notes: text(body.notes, 1000) }
}

/** Borra para siempre lo que lleva más de 60 días en la Papelera. */
async function purgeTrash() {
  const limit = new Date(Date.now() - TRASH_DAYS * 86400000)
  await db.delete(invoices).where(and(isNotNull(invoices.deletedAt), lt(invoices.deletedAt, limit)))
  const oldProducts = await db.select({ id: products.id }).from(products).where(and(isNotNull(products.deletedAt), lt(products.deletedAt, limit)))
  for (const { id } of oldProducts) await deleteProductForever(id)
  const oldCustomers = await db.select({ id: customers.id }).from(customers).where(and(isNotNull(customers.deletedAt), lt(customers.deletedAt, limit)))
  for (const { id } of oldCustomers) {
    const [used] = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.customerId, id)).limit(1)
    if (!used) await db.delete(customers).where(eq(customers.id, id))
  }
}

async function deleteProductForever(id: number) {
  // Las facturas guardan el nombre y el código, así que no se pierden.
  await db.update(invoiceItems).set({ productId: null }).where(eq(invoiceItems.productId, id))
  const [row] = await db.delete(products).where(eq(products.id, id)).returning({ imageUrl: products.imageUrl, images: products.images })
  if (row) for (const url of parseImages(row.images, row.imageUrl)) await deletePhotoIfUnused(url).catch((caught) => console.error('No se pudo borrar la foto:', caught))
}

async function readJson(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') throw new UserError('Datos no válidos.')
  return body as Record<string, unknown>
}

async function handleApi(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 })
  const resource = new URL(request.url).pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean)
  const name = resource[0] || ''
  const id = Math.trunc(Number(resource[1] || 0))
  const action = resource[2] || ''
  const method = request.method

  try {
    if (method !== 'GET' && !sameOrigin(request)) return error('Acceso no permitido.', 403)
    await ensureSchema()

    if (name === 'products' && method === 'GET') {
      await ensureProducts()
      // La tienda solo recibe lo que puede mostrar.
      const rows = await db
        .select({ id: products.id, code: products.code, name: products.name, category: products.category, description: products.description, priceCents: products.priceCents, stock: products.stock, imageUrl: products.imageUrl, images: products.images, featured: products.featured, active: products.active })
        .from(products)
        .where(and(eq(products.active, true), isNull(products.deletedAt)))
        .orderBy(desc(products.featured), asc(products.name))
      return json(rows.map(withImages))
    }
    if (name === 'orders' && method === 'POST') {
      const body = await readJson(request)
      // Campo escondido: una persona nunca lo llena, un robot sí.
      if (text(body.website)) return json({ invoice: { number: 'FAC-000000000' } }, 201)
      return await createInvoice(body, true)
    }
    if (name === 'content' && method === 'GET') {
      const content = await getSiteContent()
      if (!(await requireAdmin(request))) delete content.notification_email
      return json(content)
    }

    // El service worker de la app usa esto cuando el navegador cambia la
    // dirección de los avisos (pushsubscriptionchange). GET: clave pública.
    // POST: cambiar la vieja por la nueva, solo si la vieja estaba guardada
    // (nadie más la conoce), así un extraño no puede recibir los pedidos.
    if (name === 'push' && resource[1] === 'renew' && method === 'GET') return json({ publicKey: (await getVapidKeys()).publicKey })
    if (name === 'push' && resource[1] === 'renew' && method === 'POST') {
      const body = await readJson(request)
      const oldEndpoint = String(body.oldEndpoint || '')
      const endpoint = String(body.endpoint || '')
      if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !body.p256dh || !body.auth) return json({ ok: false }, 400)
      const [old] = oldEndpoint ? await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, oldEndpoint)).limit(1) : []
      if (!old) return json({ ok: false }, 404)
      const values = { endpoint, p256dh: text(body.p256dh, 200), auth: text(body.auth, 100), label: old.label }
      await db.insert(pushSubscriptions).values(values).onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { p256dh: values.p256dh, auth: values.auth } })
      if (oldEndpoint !== endpoint) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, old.id))
      return json({ ok: true })
    }

    if (!(await requireAdmin(request))) return error('Tu sesión terminó. Vuelve a entrar.', 401)

    if (name === 'content' && method === 'PATCH') return await saveSiteContent(await readJson(request))

    if (name === 'upload' && method === 'POST') {
      const body = await readJson(request)
      const url = await uploadPhoto(text(body.filename, 120) || 'imagen.jpg', String(body.dataUrl || ''))
      return json({ url })
    }

    if (name === 'dashboard' && method === 'GET') {
      await ensureProducts()
      await purgeTrash()
      const productRows = (await db.select().from(products).orderBy(asc(products.name))).map(withImages)
      const customerRows = await db.select().from(customers).orderBy(asc(customers.name))
      const allInvoices = await listInvoices()
      const invoiceRows = allInvoices.filter((invoice) => !invoice.deletedAt)
      const enrichedCustomers = customerRows.map((customer) => {
        const related = invoiceRows.filter((invoice) => invoice.customerId === customer.id)
        return { ...customer, balanceCents: related.reduce((sum, invoice) => sum + invoice.balanceCents, 0), invoiceCount: related.length }
      })
      const liveProducts = productRows.filter((product) => !product.deletedAt)
      return json({
        products: liveProducts,
        customers: enrichedCustomers.filter((customer) => !customer.deletedAt),
        invoices: invoiceRows,
        trash: {
          days: TRASH_DAYS,
          products: productRows.filter((product) => product.deletedAt),
          customers: enrichedCustomers.filter((customer) => customer.deletedAt),
          invoices: allInvoices.filter((invoice) => invoice.deletedAt),
        },
        metrics: {
          salesCents: invoiceRows.reduce((sum, invoice) => sum + invoice.totalCents, 0),
          receivableCents: invoiceRows.reduce((sum, invoice) => sum + invoice.balanceCents, 0),
          paidInvoices: invoiceRows.filter((invoice) => invoice.status === 'paid').length,
          lowStock: liveProducts.filter((product) => product.active && product.stock <= 5).length,
        },
      })
    }

    // ── App y avisos ──
    if (name === 'push' && !resource[1] && method === 'GET') {
      const keys = await getVapidKeys()
      const devices = await db.select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint, label: pushSubscriptions.label, createdAt: pushSubscriptions.createdAt }).from(pushSubscriptions).orderBy(desc(pushSubscriptions.createdAt))
      return json({ publicKey: keys.publicKey, devices })
    }
    if (name === 'push' && !resource[1] && method === 'POST') {
      const body = await readJson(request)
      const endpoint = String(body.endpoint || '')
      if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000) return error('La suscripción del navegador no es válida.')
      if (!body.p256dh || !body.auth) return error('Faltan las claves de la suscripción.')
      const values = { endpoint, p256dh: text(body.p256dh, 200), auth: text(body.auth, 100), label: text(body.label, 80) }
      await db.insert(pushSubscriptions).values(values).onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { p256dh: values.p256dh, auth: values.auth, label: values.label } })
      return json({ ok: true })
    }
    if (name === 'push' && resource[1] === 'remove' && method === 'POST') {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, String((await readJson(request)).endpoint || '')))
      return json({ ok: true })
    }
    if (name === 'push' && resource[1] === 'test' && method === 'POST') {
      const endpoint = String((await readJson(request)).endpoint || '')
      const rows = endpoint ? await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)) : await db.select().from(pushSubscriptions)
      if (!rows.length) return error('Este aparato todavía no tiene los avisos activados.')
      const result = await sendToSubscriptions(rows, { title: '🔔 Avisos activados', body: 'Así te va a llegar cada pedido nuevo de la tienda.', url: '/admin?tab=facturas', tag: 'prueba' })
      if (!result.sent) return error(`No se pudo entregar la prueba (${result.problem}). Toca «Activar avisos» otra vez.`)
      return json({ ok: true })
    }

    // ── Productos ──
    if (name === 'products' && !id && method === 'POST') {
      const [created] = await db.insert(products).values(productValues(await readJson(request))).returning()
      return json(created, 201)
    }
    if (name === 'products' && id && !action && method === 'PATCH') {
      const [before] = await db.select({ imageUrl: products.imageUrl, images: products.images }).from(products).where(eq(products.id, id)).limit(1)
      const [updated] = await db.update(products).set({ ...productValues(await readJson(request)), updatedAt: new Date() }).where(eq(products.id, id)).returning()
      if (!updated) return error('Producto no encontrado.', 404)
      // Si se cambió la foto, la vieja se borra de R2 (si nadie más la usa).
      if (before) {
        const kept = new Set(parseImages(updated.images, updated.imageUrl))
        for (const url of parseImages(before.images, before.imageUrl)) if (!kept.has(url)) await deletePhotoIfUnused(url).catch((caught) => console.error('No se pudo borrar la foto:', caught))
      }
      return json(withImages(updated))
    }
    if (name === 'products' && id && action === 'stock' && method === 'POST') {
      // Sumar o restar unidades rápido desde la lista.
      const delta = Math.trunc(Number((await readJson(request)).delta) || 0)
      if (!delta) return error('Escribe cuántas unidades.')
      const [updated] = await db.update(products).set({ stock: sql`greatest(0, ${products.stock} + ${delta})`, updatedAt: new Date() }).where(eq(products.id, id)).returning()
      if (!updated) return error('Producto no encontrado.', 404)
      return json(updated)
    }
    if (name === 'products' && id && action === 'visible' && method === 'POST') {
      const active = Boolean((await readJson(request)).active)
      const [updated] = await db.update(products).set({ active, updatedAt: new Date() }).where(eq(products.id, id)).returning()
      if (!updated) return error('Producto no encontrado.', 404)
      return json(updated)
    }
    if (name === 'products' && id && !action && method === 'DELETE') {
      await db.update(products).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(products.id, id))
      return json({ ok: true })
    }
    if (name === 'products' && id && action === 'restore' && method === 'POST') {
      await db.update(products).set({ deletedAt: null, updatedAt: new Date() }).where(eq(products.id, id))
      return json({ ok: true })
    }
    if (name === 'products' && id && action === 'forever' && method === 'DELETE') {
      const [row] = await db.select({ id: products.id }).from(products).where(and(eq(products.id, id), isNotNull(products.deletedAt))).limit(1)
      if (!row) return error('Primero manda el producto a la Papelera.')
      await deleteProductForever(id)
      return json({ ok: true })
    }

    // ── Clientes ──
    if (name === 'customers' && !id && method === 'POST') {
      const body = await readJson(request)
      const values = customerValues(body)
      // No se repiten clientes con el mismo teléfono.
      const digits = onlyDigits(values.phone)
      const [existing] = digits.length >= 7 ? await db.select().from(customers).where(sql`regexp_replace(${customers.phone}, '\D', '', 'g') = ${digits}`).limit(1) : []
      if (existing) {
        if (body.reuse) {
          if (existing.deletedAt) await db.update(customers).set({ deletedAt: null, updatedAt: new Date() }).where(eq(customers.id, existing.id))
          return json(existing)
        }
        return error(`Ya existe un cliente con ese teléfono: ${existing.name}${existing.deletedAt ? ' (está en la Papelera)' : ''}.`, 409)
      }
      const [created] = await db.insert(customers).values(values).returning()
      return json(created, 201)
    }
    if (name === 'customers' && id && !action && method === 'PATCH') {
      const [updated] = await db.update(customers).set({ ...customerValues(await readJson(request)), updatedAt: new Date() }).where(eq(customers.id, id)).returning()
      if (!updated) return error('Cliente no encontrado.', 404)
      return json(updated)
    }
    if (name === 'customers' && id && !action && method === 'DELETE') {
      await db.update(customers).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(customers.id, id))
      return json({ ok: true })
    }
    if (name === 'customers' && id && action === 'restore' && method === 'POST') {
      await db.update(customers).set({ deletedAt: null, updatedAt: new Date() }).where(eq(customers.id, id))
      return json({ ok: true })
    }
    if (name === 'customers' && id && action === 'forever' && method === 'DELETE') {
      const [used] = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.customerId, id)).limit(1)
      if (used) return error('Este cliente tiene facturas. Borra primero sus facturas para siempre, o déjalo en la Papelera.')
      await db.delete(customers).where(and(eq(customers.id, id), isNotNull(customers.deletedAt)))
      return json({ ok: true })
    }

    // ── Facturas ──
    if (name === 'invoices' && !id && method === 'POST') return await createInvoice(await readJson(request))
    if (name === 'invoices' && id && action === 'payments' && method === 'POST') {
      const body = await readJson(request)
      const amountCents = cents(body.amountCents)
      if (!amountCents) return error('Escribe cuánto pagó.')
      const [invoice] = await db.select().from(invoices).where(and(eq(invoices.id, id), isNull(invoices.deletedAt))).limit(1)
      if (!invoice) return error('Factura no encontrada.', 404)
      const remaining = Math.max(0, invoice.totalCents - invoice.paidCents)
      const applied = Math.min(remaining, amountCents)
      if (!applied) return error('Esta factura ya está saldada.')
      await db.insert(payments).values({ invoiceId: id, amountCents: applied, method: PAYMENT_METHODS.includes(String(body.method)) ? String(body.method) : 'Efectivo', note: text(body.note, 200) })
      const [updated] = await db
        .update(invoices)
        .set({ paidCents: sql`${invoices.paidCents} + ${applied}`, status: sql`case when ${invoices.paidCents} + ${applied} >= ${invoices.totalCents} then 'paid' else 'partial' end`, updatedAt: new Date() })
        .where(eq(invoices.id, id))
        .returning({ paidCents: invoices.paidCents })
      return json({ ok: true, paidCents: updated?.paidCents })
    }
    if (name === 'invoices' && id && !action && method === 'PATCH') {
      // Se pueden cambiar las notas y la fecha límite.
      const body = await readJson(request)
      const dueDate = parseDueDate(body.dueDate)
      const [updated] = await db.update(invoices).set({ notes: text(body.notes, 1000), dueDate, updatedAt: new Date() }).where(eq(invoices.id, id)).returning()
      if (!updated) return error('Factura no encontrada.', 404)
      return json({ ok: true })
    }
    if (name === 'invoices' && id && !action && method === 'DELETE') {
      // Va a la Papelera y las unidades vuelven al inventario.
      const [invoice] = await db.update(invoices).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(eq(invoices.id, id), isNull(invoices.deletedAt))).returning({ id: invoices.id })
      if (!invoice) return error('Factura no encontrada.', 404)
      const items = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id))
      await returnStock(items)
      return json({ ok: true })
    }
    if (name === 'invoices' && id && action === 'restore' && method === 'POST') {
      const [invoice] = await db.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.id, id), isNotNull(invoices.deletedAt))).limit(1)
      if (!invoice) return error('Factura no encontrada en la Papelera.', 404)
      const items = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id))
      await takeStock(items.filter((item) => item.productId).map((item) => ({ productId: item.productId!, quantity: item.quantity, name: item.productName })))
      await db.update(invoices).set({ deletedAt: null, updatedAt: new Date() }).where(eq(invoices.id, id))
      return json({ ok: true })
    }
    if (name === 'invoices' && id && action === 'forever' && method === 'DELETE') {
      await db.delete(invoices).where(and(eq(invoices.id, id), isNotNull(invoices.deletedAt)))
      return json({ ok: true })
    }

    return error('Ruta no encontrada.', 404)
  } catch (caught) {
    if (caught instanceof UserError) return error(caught.message)
    const cause = (caught as { cause?: { message?: string; code?: string } })?.cause
    const message = `${caught instanceof Error ? caught.message : String(caught)} ${cause?.message || ''} ${cause?.code === '23505' ? 'unique' : ''}`
    if (/unique|duplicate/i.test(message)) return error('Ese código de producto ya existe (puede estar en la Papelera). Usa otro.', 409)
    if (name === 'upload' && caught instanceof Error && !/Failed query/i.test(caught.message)) return error(caught.message)
    console.error('Error en la API:', caught)
    return error('Ocurrió un error. Intenta de nuevo.', 500)
  }
}

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      GET: ({ request }) => handleApi(request),
      POST: ({ request }) => handleApi(request),
      PATCH: ({ request }) => handleApi(request),
      DELETE: ({ request }) => handleApi(request),
      OPTIONS: ({ request }) => handleApi(request),
    },
  },
})
