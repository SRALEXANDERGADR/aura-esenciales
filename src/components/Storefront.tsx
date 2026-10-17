import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  BadgeCheck,
  Check,
  ChevronRight,
  Copy,
  MessageCircle,
  Minus,
  PackageOpen,
  Plus,
  RotateCw,
  Search,
  Send,
  ShoppingBag,
  Sparkles,
  Trash2,
  Wallet,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { currency, shortDate } from '@/lib/format'
import { usePlan } from '@/lib/plan-client'
import { DEFAULT_SITE_CONTENT } from '@/lib/site-content'
import type { Product, SiteContent } from '@/types'

type CartLine = { product: Product; quantity: number }
type CheckoutData = { name: string; phone: string; email: string; address: string; website: string }
type SortMode = 'destacados' | 'menor' | 'mayor' | 'nombre'

const emptyCheckout: CheckoutData = { name: '', phone: '', email: '', address: '', website: '' }
const MAX_QTY = 99

/** Lee la cesta guardada sin romper la página si está dañada. */
function readSavedCart(): Record<number, number> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem('aura-cart') || '{}') as Record<string, unknown>
    const cart: Record<number, number> = {}
    for (const [id, quantity] of Object.entries(parsed || {})) {
      const qty = Math.trunc(Number(quantity))
      if (Number(id) > 0 && qty > 0) cart[Number(id)] = Math.min(MAX_QTY, qty)
    }
    return cart
  } catch {
    return {}
  }
}

const whatsappLink = (phone: string, message: string) => {
  let digits = phone.replace(/\D/g, '')
  if (digits.length === 10) digits = `1${digits}`
  return digits.length >= 11 ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : ''
}

// ─── Mis pedidos y pagos (plan Completo) ───
// El teléfono guarda el número y la clave secreta de cada pedido para verlo
// después sin contraseña, y los datos del cliente para no escribirlos otra vez.
const ORDERS_KEY = 'aura-mis-pedidos'
const CLIENT_KEY = 'aura-cliente'
type OrderKey = { number: string; token: string }
type MyOrder = {
  number: string
  createdAt: string
  totalCents: number
  discountCents: number
  paidCents: number
  balanceCents: number
  dueDate: string | null
  status: 'pending' | 'partial' | 'paid' | 'overdue' | 'cancelled'
  cancelRequested: boolean
  canRequestCancel: boolean
  items: Array<{ name: string; code: string; quantity: number; unitPriceCents: number; totalCents: number; satisfactionDays: number; imageUrl: string }>
  payments: Array<{ amountCents: number; method: string; createdAt: string }>
}
const STATUS_TEXT: Record<MyOrder['status'], string> = { pending: 'Por pagar', partial: 'Abonado', paid: 'Pagado', overdue: 'Vencido', cancelled: 'Cancelado' }

function readOrderKeys(): OrderKey[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ORDERS_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.number === 'string' && typeof item.token === 'string' && item.token.length >= 32).slice(0, 30) : []
  } catch {
    return []
  }
}
function saveOrderKey(key: OrderKey) {
  try { window.localStorage.setItem(ORDERS_KEY, JSON.stringify([key, ...readOrderKeys().filter((item) => item.number !== key.number)].slice(0, 30))) } catch { /* sin espacio */ }
}
function readClient(): CheckoutData | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CLIENT_KEY) || 'null')
    return parsed && typeof parsed.name === 'string' ? { name: parsed.name, phone: String(parsed.phone || ''), email: String(parsed.email || ''), address: String(parsed.address || ''), website: '' } : null
  } catch {
    return null
  }
}
function saveClient(client: CheckoutData) {
  try { window.localStorage.setItem(CLIENT_KEY, JSON.stringify({ name: client.name, phone: client.phone, email: client.email, address: client.address })) } catch { /* sin espacio */ }
}
const daysText = (days: number) => `${days} ${days === 1 ? 'día' : 'días'}`

/** Círculo con lo que ya se pagó de un pedido. */
function PaidRing({ paid, total }: { paid: number; total: number }) {
  const share = total > 0 ? Math.min(1, paid / total) : 0
  const radius = 26
  const length = 2 * Math.PI * radius
  return <svg className="paid-ring" viewBox="0 0 64 64" role="img" aria-label={`Pagado el ${Math.round(share * 100)} por ciento`}>
    <circle cx="32" cy="32" r={radius} className="paid-ring-track" />
    {share > 0 && <circle cx="32" cy="32" r={radius} className="paid-ring-value" strokeDasharray={`${length * share} ${length}`} transform="rotate(-90 32 32)" />}
    <text x="32" y="36.5" textAnchor="middle">{Math.round(share * 100)}%</text>
  </svg>
}

function MyOrderCard({ order, busy, payMethods, phone, onCancel }: { order: MyOrder; busy: boolean; payMethods: string[]; phone: string; onCancel: (order: MyOrder) => void }) {
  const [asking, setAsking] = useState(false)
  const cancelled = order.status === 'cancelled'
  const units = order.items.reduce((sum, item) => sum + item.quantity, 0)
  const changeLink = whatsappLink(phone, `Hola, quiero cambiar algo de mi pedido ${order.number}.`)
  const paidLink = whatsappLink(phone, `Hola, ya pagué mi pedido ${order.number}. Aquí está el comprobante.`)
  return <article className={`my-order ${cancelled ? 'is-cancelled' : ''}`}>
    <header className="my-order-head">
      <div><code>{order.number}</code><small>{shortDate(order.createdAt)} · {units} {units === 1 ? 'producto' : 'productos'}</small></div>
      <span className={`my-order-status status-${order.status}`}>{STATUS_TEXT[order.status]}</span>
    </header>
    {!cancelled && <div className="my-order-money">
      <PaidRing paid={order.paidCents} total={order.totalCents} />
      <div>
        <p>Pagado <b>{currency(order.paidCents)}</b> de {currency(order.totalCents)}</p>
        {order.balanceCents > 0 ? <strong>Te falta {currency(order.balanceCents)}</strong> : <strong className="all-paid">¡Todo pagado!</strong>}
        {order.dueDate && order.balanceCents > 0 && <small>Fecha límite: {shortDate(order.dueDate)}</small>}
      </div>
    </div>}
    {cancelled && <p className="my-order-note">Este pedido se canceló.</p>}
    {!cancelled && order.cancelRequested && <p className="my-order-note">Pediste cancelarlo. La tienda te va a confirmar por WhatsApp.</p>}
    <ul className="my-order-items">{order.items.map((item, index) => <li key={`${item.code}-${index}`}>
      {item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" /> : <span className="my-order-thumb"><Sparkles size={16} /></span>}
      <div><span>{item.quantity} × {item.name}</span>{item.satisfactionDays > 0 && <small><BadgeCheck size={12} /> Satisfacción garantizada · {daysText(item.satisfactionDays)}</small>}</div>
      <b>{currency(item.totalCents)}</b>
    </li>)}</ul>
    {order.payments.length > 0 && <div className="my-order-payments"><span>Tus abonos</span>{order.payments.map((payment, index) => <p key={index}><small>{shortDate(payment.createdAt)} · {payment.method}</small><b>{currency(payment.amountCents)}</b></p>)}</div>}
    {!cancelled && order.balanceCents > 0 && (payMethods.length > 0 || paidLink) && <div className="my-order-howto"><span>Cómo pagar</span>{payMethods.length > 0 && <p>{payMethods.join(' · ')}</p>}{paidLink && <a href={paidLink} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} /> Ya pagué: enviar comprobante</a>}</div>}
    {asking && order.canRequestCancel && <div className="my-order-confirm"><p>Le avisamos a la tienda que quieres cancelar el pedido {order.number}. Si ya salió para entrega, te escribirán para ponerse de acuerdo.</p><div><button type="button" className="primary-button" disabled={busy} onClick={() => onCancel(order)}>{busy ? 'Avisando…' : 'Sí, pedir que lo cancelen'}</button><button type="button" className="text-button" disabled={busy} onClick={() => setAsking(false)}>No</button></div></div>}
    {!asking && !cancelled && (order.canRequestCancel || changeLink) && <div className="my-order-actions">
      {changeLink && <a className="my-order-action" href={changeLink} target="_blank" rel="noopener noreferrer"><MessageCircle size={15} /> Cambiar algo</a>}
      {order.canRequestCancel && <button type="button" className="my-order-link" onClick={() => setAsking(true)}>Pedir que lo cancelen</button>}
    </div>}
  </article>
}

export function Storefront({ initialCode }: { initialCode?: string } = {}) {
  // Plan Básico: sin cesta; cada producto se pide por WhatsApp. Profesional y Completo: cesta y pedidos.
  const { can } = usePlan()
  const cartEnabled = can('carrito')
  // Plan Completo: «Mis pedidos y pagos», «Mandar por WhatsApp» y satisfacción garantizada.
  const canTrack = cartEnabled && can('seguimiento')
  const canShare = can('compartir')
  const canSatisfaction = can('satisfaccion')
  const [products, setProducts] = useState<Product[]>([])
  const [content, setContent] = useState<SiteContent>(DEFAULT_SITE_CONTENT)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('Todos')
  const [sort, setSort] = useState<SortMode>('destacados')
  const [detail, setDetail] = useState<Product | null>(null)
  const [toast, setToast] = useState('')
  const [orderError, setOrderError] = useState('')
  const [cartReady, setCartReady] = useState(false)
  const [cart, setCart] = useState<Record<number, number>>({})
  const [cartOpen, setCartOpen] = useState(false)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [checkout, setCheckout] = useState<CheckoutData>(emptyCheckout)
  const [submitting, setSubmitting] = useState(false)
  const [orderNumber, setOrderNumber] = useState('')
  const [ordersOpen, setOrdersOpen] = useState(false)
  const [orderKeysCount, setOrderKeysCount] = useState(0)
  const [myOrders, setMyOrders] = useState<MyOrder[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [ordersError, setOrdersError] = useState('')
  const [ordersBusy, setOrdersBusy] = useState('')
  const [savedClient, setSavedClient] = useState(false)
  const openedFromLink = useRef(false)

  const text = (key: keyof SiteContent) => content[key] ?? DEFAULT_SITE_CONTENT[key]

  useEffect(() => {
    if (canTrack) setOrderKeysCount(readOrderKeys().length)
  }, [canTrack])

  // Enlace de un producto (/ver/<código>): su ficha se abre sola cuando llegan
  // los productos. Al cerrarla, la dirección vuelve a la de la tienda.
  useEffect(() => {
    if (!initialCode || openedFromLink.current || !products.length) return
    const product = products.find((item) => item.code.toUpperCase() === initialCode.toUpperCase())
    if (product) { openedFromLink.current = true; setDetail(product) }
  }, [initialCode, products])
  useEffect(() => {
    if (detail || !openedFromLink.current || typeof window === 'undefined' || !window.location.pathname.startsWith('/ver/')) return
    window.history.replaceState(window.history.state, '', `/${window.location.search}`)
  }, [detail])

  useEffect(() => {
    setCart(readSavedCart())
    setCartReady(true)
    fetch('/api/products')
      .then(async (response) => {
        if (!response.ok) throw new Error(text('catalog_load_error'))
        return response.json() as Promise<Product[]>
      })
      .then(setProducts)
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false))
    fetch('/api/content')
      .then(async (response) => {
        if (!response.ok) throw new Error('No pudimos cargar el contenido.')
        return response.json() as Promise<SiteContent>
      })
      .then((loaded) => setContent((current) => ({ ...current, ...loaded })))
      .catch(() => {
        // Si el contenido no puede cargarse, la página sigue mostrando los
        // valores por defecto en vez de romperse.
      })
  }, [])

  useEffect(() => {
    if (!cartReady) return
    try { window.localStorage.setItem('aura-cart', JSON.stringify(cart)) } catch { /* sin espacio: la cesta sigue en memoria */ }
  }, [cart, cartReady])

  // Si un producto se agotó o ya no está, se ajusta la cesta.
  useEffect(() => {
    if (loading || error) return
    setCart((current) => {
      let changed = false
      const next: Record<number, number> = {}
      for (const [id, quantity] of Object.entries(current)) {
        const product = products.find((item) => item.id === Number(id))
        const allowed = product ? Math.min(quantity, product.stock, MAX_QTY) : 0
        if (allowed !== quantity) changed = true
        if (allowed > 0) next[Number(id)] = allowed
      }
      return changed ? next : current
    })
  }, [products, loading, error])

  // Con una ventana abierta, la página de atrás no se mueve y "Esc" la cierra.
  const anyOpen = cartOpen || checkoutOpen || ordersOpen || Boolean(detail)
  useEffect(() => {
    if (!anyOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (detail) setDetail(null)
      else if (checkoutOpen && !submitting) closeCheckout()
      else { setCartOpen(false); setOrdersOpen(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', onKey) }
  }, [anyOpen, detail, checkoutOpen, submitting, orderNumber])

  // Animación de aparición y desvanecimiento al bajar y subir por la página.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    document.documentElement.classList.add('sr-ready')
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) entry.target.classList.toggle('sr-in', entry.isIntersecting)
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' })
    document.querySelectorAll('.sr, .sr-group > *').forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [products, search, category, sort, loading])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const activeProducts = useMemo(() => products.filter((product) => product.active), [products])
  const categories = useMemo(() => ['Todos', ...new Set(activeProducts.map((product) => product.category))], [activeProducts])
  const categoryCount = (item: string) => item === 'Todos' ? activeProducts.length : activeProducts.filter((product) => product.category === item).length
  const visibleProducts = useMemo(() => {
    const term = normalize(search.trim())
    const list = activeProducts.filter((product) => (category === 'Todos' || product.category === category) && (!term || normalize(`${product.name} ${product.code} ${product.category} ${product.description}`).includes(term)))
    const inStock = (product: Product) => (product.stock > 0 ? 0 : 1)
    return [...list].sort((a, b) => {
      if (sort === 'menor') return inStock(a) - inStock(b) || a.priceCents - b.priceCents
      if (sort === 'mayor') return inStock(a) - inStock(b) || b.priceCents - a.priceCents
      if (sort === 'nombre') return a.name.localeCompare(b.name, 'es')
      return inStock(a) - inStock(b) || Number(b.featured) - Number(a.featured) || a.name.localeCompare(b.name, 'es')
    })
  }, [activeProducts, search, category, sort])
  const cartLines = useMemo<CartLine[]>(() => products.flatMap((product) => {
    const quantity = cart[product.id] || 0
    return quantity ? [{ product, quantity }] : []
  }), [products, cart])
  const cartCount = cartLines.reduce((sum, line) => sum + line.quantity, 0)
  const cartTotal = cartLines.reduce((sum, line) => sum + line.product.priceCents * line.quantity, 0)

  const setQuantity = (product: Product, quantity: number) => {
    setCart((current) => {
      const next = Math.max(0, Math.min(product.stock, MAX_QTY, Math.trunc(quantity) || 0))
      const updated = { ...current }
      if (next) updated[product.id] = next
      else delete updated[product.id]
      return updated
    })
  }
  const changeQuantity = (product: Product, delta: number) => setQuantity(product, (cart[product.id] || 0) + delta)

  const addToCart = (product: Product) => {
    const inCart = cart[product.id] || 0
    if (inCart >= Math.min(product.stock, MAX_QTY)) { setToast(`Ya tienes todas las unidades disponibles de ${product.name}.`); return }
    changeQuantity(product, 1)
    setToast(`${product.name} se agregó a tu cesta.`)
  }

  const stockLabel = (product: Product) => !product.stock ? text('product_sold_out_button') : product.stock <= 5 ? `Quedan ${product.stock}` : text('product_stock_suffix') === 'disponibles' ? 'Disponible' : `${product.stock} ${text('product_stock_suffix')}`
  // Métodos de pago del pie: se editan en el panel (Textos → Pie de página).
  const paymentMethods = [...new Set(text('payment_methods').split(/[,\n]+/).map((item) => item.trim()).filter(Boolean))].slice(0, 12)
  const contactLink = whatsappLink(text('footer_phone'), `Hola, quiero información sobre los productos de ${text('site_name')} ${text('site_tagline')}.`)
  const orderLink = (product: Product) => whatsappLink(text('footer_phone'), `Hola, quiero pedir: ${product.name} (código ${product.code}), ${currency(product.priceCents)}. ¿Lo tienen disponible?`)

  async function loadMyOrders() {
    const keys = readOrderKeys()
    setOrderKeysCount(keys.length)
    if (!keys.length) { setMyOrders([]); return }
    setOrdersLoading(true)
    setOrdersError('')
    try {
      const response = await fetch('/api/mis-pedidos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orders: keys }) })
      const result = await response.json().catch(() => null)
      if (!response.ok || !Array.isArray(result)) throw new Error()
      setMyOrders(result as MyOrder[])
    } catch {
      setOrdersError('No pudimos cargar tus pedidos. Revisa el internet e intenta de nuevo.')
    } finally {
      setOrdersLoading(false)
    }
  }
  function openMyOrders() {
    setCheckoutOpen(false)
    setOrderNumber('')
    setCartOpen(false)
    setOrdersOpen(true)
    void loadMyOrders()
  }
  async function askCancel(order: MyOrder) {
    const key = readOrderKeys().find((item) => item.number === order.number)
    if (!key) return
    setOrdersBusy(order.number)
    setOrdersError('')
    try {
      const response = await fetch('/api/mis-pedidos/cancelar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(key) })
      const result = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(result.error || 'No pudimos avisar a la tienda.')
      await loadMyOrders()
    } catch (caught) {
      setOrdersError(caught instanceof Error && caught.message !== 'Failed to fetch' ? caught.message : 'No hay conexión. Revisa el internet e intenta de nuevo.')
    } finally {
      setOrdersBusy('')
    }
  }

  /** «Mandar por WhatsApp»: abre WhatsApp con el enlace del producto para que
   * el cliente elija a quién mandarlo. */
  const productUrl = (product: Product) => `${window.location.origin}/ver/${encodeURIComponent(product.code)}`
  const shareOnWhatsApp = (product: Product) => window.open(`https://wa.me/?text=${encodeURIComponent(`Mira esto de ${`${text('site_name')} ${text('site_tagline')}`.replace(/\s+/g, ' ').trim()}: ${product.name} · ${currency(product.priceCents)}\n${productUrl(product)}`)}`, '_blank', 'noopener')
  async function copyProductLink(product: Product) {
    try { await navigator.clipboard.writeText(productUrl(product)); setToast('Enlace copiado. Pégalo donde quieras.') } catch { window.prompt('Copia este enlace:', productUrl(product)) }
  }

  // Al cerrar después de un pedido, todo vuelve a empezar (si no, la próxima vez saldría el mensaje viejo).
  const closeCheckout = () => {
    setCheckoutOpen(false)
    if (orderNumber) { setOrderNumber(''); setCartOpen(false) }
  }

  const submitOrder = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setOrderError('')
    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer: checkout, items: cartLines.map((line) => ({ productId: line.product.id, quantity: line.quantity })) }),
      })
      const result = await response.json().catch(() => ({})) as { error?: string; invoice?: { number: string; token?: string } }
      if (!response.ok) throw new Error(result.error || text('order_generic_error'))
      setOrderNumber(result.invoice?.number || '')
      if (canTrack && result.invoice?.token) {
        saveOrderKey({ number: result.invoice.number, token: result.invoice.token })
        saveClient(checkout)
        setOrderKeysCount(readOrderKeys().length)
      }
      setCart({})
      setCheckout(emptyCheckout)
    } catch (caught) {
      setOrderError(caught instanceof Error && caught.message !== 'Failed to fetch' ? caught.message : 'No hay conexión. Revisa el internet e intenta de nuevo.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="storefront">
      <header className="site-header">
        <a className="brand" href="#inicio" aria-label={`${text('site_name')} inicio`}>
          <span className="brand-mark"><Sparkles size={19} /></span>
          <span><strong>{text('site_name')}</strong><small>{text('site_tagline')}</small></span>
        </a>
        <nav className="desktop-nav" aria-label="Navegación principal">
          <a href="#catalogo">{text('nav_catalog')}</a>
          <a href="#esencia">{text('nav_essence')}</a>
          <a href="#contacto">{text('nav_contact')}</a>
        </nav>
        <div className="header-actions">
          {canTrack && orderKeysCount > 0 && <button className="orders-button" aria-label="Mis pedidos y pagos" onClick={openMyOrders}><Wallet size={18} /><span>Mis pagos</span></button>}
          {cartEnabled && <button className="cart-button" aria-label={`Abrir cesta (${cartCount})`} onClick={() => setCartOpen(true)}><ShoppingBag size={19} /><span>{text('nav_cart_button')}</span>{cartCount > 0 && <b>{cartCount}</b>}</button>}
        </div>
      </header>

      <section className="hero" id="inicio">
        <div className="hero-copy sr">
          <span className="eyebrow">{text('hero_eyebrow')}</span>
          <h1>{text('hero_title')}<br /><em>{text('hero_title_emphasis')}</em></h1>
          <p>{text('hero_description')}</p>
          <a href="#catalogo" className="primary-button">{text('hero_button')} <ArrowRight size={18} /></a>
          <div className="hero-notes"><span><Check size={15} /> {text('hero_note_1')}</span><span><Check size={15} /> {text('hero_note_2')}</span></div>
        </div>
      </section>

      <section className="catalog-section" id="catalogo">
        <div className="section-heading sr">
          <div><span className="eyebrow">{text('catalog_eyebrow')}</span><h2>{text('catalog_title')}</h2></div>
          <p>{text('catalog_description')}</p>
        </div>
        <div className="catalog-tools sr">
          <div className="category-pills">{categories.map((item) => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item} <small>{categoryCount(item)}</small></button>)}</div>
          <div className="catalog-search-row">
            <label className="search-field"><Search size={18} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={text('catalog_search_placeholder')} aria-label="Buscar productos" />{search && <button type="button" className="clear-search" aria-label="Borrar búsqueda" onClick={() => setSearch('')}><X size={15} /></button>}</label>
            <select className="sort-select" value={sort} onChange={(event) => setSort(event.target.value as SortMode)} aria-label="Ordenar productos"><option value="destacados">Destacados</option><option value="menor">Precio: menor a mayor</option><option value="mayor">Precio: mayor a menor</option><option value="nombre">Nombre (A-Z)</option></select>
          </div>
        </div>
        {!loading && activeProducts.length > 0 && <p className="catalog-count">{visibleProducts.length === activeProducts.length ? `${activeProducts.length} productos` : `${visibleProducts.length} de ${activeProducts.length} productos`}</p>}

        {loading ? <div className="product-grid">{[1, 2, 3, 4].map((item) => <div className="product-skeleton" key={item} />)}</div> : null}
        {!loading && error && !products.length ? <div className="empty-state"><PackageOpen size={40} /><h3>{text('catalog_empty_error_title')}</h3><p>{error}</p></div> : null}
        {!loading && !visibleProducts.length && activeProducts.length ? <div className="empty-state"><Search size={40} /><h3>{text('catalog_empty_search_title')}</h3><p>{text('catalog_empty_search_description')}</p><button className="text-button" onClick={() => { setSearch(''); setCategory('Todos') }}>Ver todos los productos <ChevronRight size={16} /></button></div> : null}
        {!loading && !error && !activeProducts.length ? <div className="empty-state"><PackageOpen size={40} /><h3>Muy pronto</h3><p>Estamos preparando los productos. Vuelve en unos días.</p></div> : null}
        <div className="product-grid">
          {visibleProducts.map((product, index) => (
            <article className={`product-card sr ${product.stock ? '' : 'sold-out'}`} style={{ transitionDelay: `${(index % 2) * 90}ms` }} key={product.id}>
              <div className="product-image-wrap">
                {product.featured && <span className="product-badge">{text('product_favorite_badge')}</span>}
                {!product.stock && <span className="product-badge sold">{text('product_sold_out_button')}</span>}
                {(product.images?.length || 0) > 1 && <span className="photo-count">{product.images.length} fotos</span>}
                <button className="product-open" aria-label={`Ver ${product.name}`} onClick={() => setDetail(product)}>
                  {product.imageUrl ? <img src={product.imageUrl} alt={product.name} loading={index > 3 ? 'lazy' : 'eager'} /> : <div className="image-placeholder"><Sparkles /></div>}
                </button>
                {cartEnabled
                  ? <button className="quick-add" disabled={!product.stock} onClick={() => addToCart(product)}><Plus size={18} /> <span className="quick-add-label">{product.stock ? text('product_add_button') : text('product_sold_out_button')}</span></button>
                  : product.stock > 0 && orderLink(product) ? <a className="quick-add" href={orderLink(product)} target="_blank" rel="noopener noreferrer"><MessageCircle size={18} /> <span className="quick-add-label">Pedir por WhatsApp</span></a> : null}
              </div>
              <div className="product-info"><span>{product.category}</span><h3><button className="product-title-button" onClick={() => setDetail(product)}>{product.name}</button></h3><p>{product.description}</p><div><strong>{currency(product.priceCents)}</strong><small className={product.stock && product.stock <= 5 ? 'few-left' : ''}>{stockLabel(product)}</small></div>{canShare && <button type="button" className="share-wa-link" onClick={() => shareOnWhatsApp(product)}><Send size={13} /> Mandar por WhatsApp</button>}</div>
            </article>
          ))}
        </div>
      </section>

      <section className="story-section sr" id="esencia">
        <div className="story-number">{text('essence_number')}</div>
        <div><span className="eyebrow">{text('essence_eyebrow')}</span><h2>{text('essence_title')}<br />{text('essence_title_emphasis')}</h2></div>
        <p>{text('essence_description')}</p>
      </section>

      <footer id="contacto" className="sr-group">
        <div className="brand footer-brand"><span className="brand-mark"><Sparkles size={19} /></span><span><strong>{text('site_name')}</strong><small>{text('site_tagline')}</small></span></div>
        <p>{text('footer_tagline')}</p>
        <div className="footer-contact"><span>{text('footer_contact_label')}</span><strong>{text('footer_phone')}</strong><small>{text('footer_hours')}</small>{contactLink && <a className="footer-whatsapp" href={contactLink} target="_blank" rel="noopener noreferrer"><MessageCircle size={16} /> Escríbenos por WhatsApp</a>}</div>
        {can('metodos_pago') && paymentMethods.length > 0 && <div className="footer-payments"><span>Métodos de pago</span><div className="payment-tags">{paymentMethods.map((method) => <b key={method}>{method}</b>)}</div></div>}
        <div className="footer-legal">
          <span>© {new Date().getFullYear()} {text('site_name')} {text('site_tagline')}. Todos los derechos reservados.</span>
          <Link to="/politicas">Políticas</Link>
        </div>
        <a className="gadr-credit" href="https://gadrnet.com" target="_blank" rel="noopener noreferrer"><span className="gadr-credit-text">Diseño y desarrollo de la tienda: GADR Net | gadrnet.com</span><span className="gadr-mark" aria-hidden="true"><span className="gadr-mark-icon">&lt;/&gt;<i></i></span><span className="gadr-mark-word">GADR<small>Net</small></span></span></a>
      </footer>

      {cartEnabled && cartOpen && <div className="drawer-layer" role="dialog" aria-modal="true">
        <button className="drawer-backdrop" aria-label="Cerrar cesta" onClick={() => setCartOpen(false)} />
        <aside className="cart-drawer">
          <div className="drawer-header"><div><span>{text('cart_subtitle')}</span><h2>{text('cart_title')} <small>{cartCount}</small></h2></div><button className="icon-button" aria-label="Cerrar cesta" onClick={() => setCartOpen(false)}><X /></button></div>
          <div className="cart-lines">
            {!cartLines.length && <div className="empty-state"><ShoppingBag size={40} /><h3>{text('cart_empty_title')}</h3><p>{text('cart_empty_description')}</p><button className="text-button" onClick={() => setCartOpen(false)}>{text('cart_empty_button')} <ChevronRight size={16} /></button></div>}
            {cartLines.map(({ product, quantity }) => <div className="cart-line" key={product.id}>
              <img src={product.imageUrl || '/product-placeholder.svg'} alt="" />
              <div><small>{product.code}</small><h3>{product.name}</h3><strong>{currency(product.priceCents)}</strong><div className="quantity-control"><button aria-label="Quitar una" disabled={quantity <= 1} onClick={() => changeQuantity(product, -1)}><Minus size={14} /></button><input type="number" inputMode="numeric" min={1} max={Math.min(product.stock, MAX_QTY)} aria-label="Cantidad" value={quantity} onChange={(event) => setQuantity(product, Math.max(1, Number(event.target.value) || 1))} /><button aria-label="Agregar una" disabled={quantity >= Math.min(product.stock, MAX_QTY)} onClick={() => changeQuantity(product, 1)}><Plus size={14} /></button></div>{quantity >= product.stock && <small className="few-left">Son todas las que hay</small>}</div>
              <button className="remove-button" aria-label={`Quitar ${product.name}`} onClick={() => setCart((current) => { const next = { ...current }; delete next[product.id]; return next })}><Trash2 size={17} /></button>
            </div>)}
          </div>
          {cartLines.length > 0 && <div className="cart-summary"><div><span>{text('cart_subtotal_label')}</span><strong>{currency(cartTotal)}</strong></div><small>{text('cart_pending_note')}</small><button className="primary-button full" onClick={() => { setOrderError(''); const client = canTrack && !checkout.name ? readClient() : null; if (client) { setCheckout(client); setSavedClient(true) } setCheckoutOpen(true) }}>{text('cart_checkout_button')} <ArrowRight size={18} /></button></div>}
        </aside>
      </div>}

      {cartEnabled && checkoutOpen && <div className="modal-layer" role="dialog" aria-modal="true">
        <button className="modal-backdrop" aria-label="Cerrar" onClick={() => !submitting && closeCheckout()} />
        <div className="checkout-modal">
          <button className="modal-close icon-button" aria-label="Cerrar" disabled={submitting} onClick={closeCheckout}><X /></button>
          {orderNumber ? <div className="success-message"><span><Check /></span><small>{text('checkout_success_label')}</small><h2>{text('checkout_success_title')}</h2><p>{text('checkout_success_message').replace('{number}', orderNumber)}</p>{whatsappLink(text('footer_phone'), '') && <a className="secondary-link" href={whatsappLink(text('footer_phone'), `Hola, acabo de hacer el pedido ${orderNumber} en la tienda.`)} target="_blank" rel="noopener noreferrer"><MessageCircle size={17} /> Avisar por WhatsApp</a>}{canTrack && <button type="button" className="secondary-link orders-link" onClick={openMyOrders}><Wallet size={17} /> Ver mis pedidos y pagos</button>}<button className="primary-button" onClick={closeCheckout}>{text('checkout_success_button')}</button></div> : <form onSubmit={submitOrder}>
            <span className="eyebrow">{text('checkout_eyebrow')}</span><h2>{text('checkout_title')}</h2><p className="form-intro">{text('checkout_intro')}</p>{savedClient && checkout.name && <p className="saved-client">Pusimos los datos de tu pedido anterior. Cámbialos si hace falta.</p>}
            <div className="form-grid"><label>{text('checkout_name_label')}<input required maxLength={80} autoComplete="name" value={checkout.name} onChange={(event) => setCheckout({ ...checkout, name: event.target.value })} /></label><label>{text('checkout_phone_label')}<input required type="tel" inputMode="tel" autoComplete="tel" maxLength={25} minLength={7} placeholder="809 555 0147" value={checkout.phone} onChange={(event) => setCheckout({ ...checkout, phone: event.target.value })} /></label><label>{text('checkout_email_label')} <small>(opcional)</small><input type="email" autoComplete="email" maxLength={120} value={checkout.email} onChange={(event) => setCheckout({ ...checkout, email: event.target.value })} /></label><label>{text('checkout_address_label')}<input required maxLength={250} autoComplete="street-address" value={checkout.address} onChange={(event) => setCheckout({ ...checkout, address: event.target.value })} /></label></div>
            <label className="hp-field" aria-hidden="true">No llenar<input tabIndex={-1} autoComplete="off" value={checkout.website} onChange={(event) => setCheckout({ ...checkout, website: event.target.value })} /></label>
            <div className="checkout-lines">{cartLines.map(({ product, quantity }) => <div key={product.id}><span>{quantity} × {product.name}</span><b>{currency(product.priceCents * quantity)}</b></div>)}</div>
            {orderError && <p className="form-error">{orderError}</p>}
            <div className="checkout-total"><span>{text('checkout_total_label')}</span><strong>{currency(cartTotal)}</strong></div>
            <button className="primary-button full" disabled={submitting || !cartLines.length}>{submitting ? text('checkout_submitting_button') : text('checkout_submit_button')} <ArrowRight size={18} /></button>
          </form>}
        </div>
      </div>}

      {detail && <div className="modal-layer" role="dialog" aria-modal="true" aria-label={detail.name}>
        <button className="modal-backdrop" aria-label="Cerrar" onClick={() => setDetail(null)} />
        <div className="checkout-modal product-detail">
          <button className="modal-close icon-button" aria-label="Cerrar" onClick={() => setDetail(null)}><X /></button>
          <ProductGallery product={detail} />
          <div className="product-detail-info">
            <span className="eyebrow">{detail.category}</span>
            <h2>{detail.name}</h2>
            <strong className="product-detail-price">{currency(detail.priceCents)}</strong>
            {detail.description && <p>{detail.description}</p>}
            <small className={detail.stock && detail.stock <= 5 ? 'few-left' : ''}>{stockLabel(detail)} · Código {detail.code}</small>
            {canSatisfaction && (detail.satisfactionDays ?? 0) > 0 && <div className="satisfaction-badge"><BadgeCheck size={20} /><div><strong>Satisfacción garantizada · {daysText(detail.satisfactionDays ?? 0)}</strong><span>{text('satisfaction_terms')}</span></div></div>}
            {cartEnabled
              ? <button className="primary-button full" disabled={!detail.stock} onClick={() => { addToCart(detail); setDetail(null) }}><Plus size={18} /> {detail.stock ? `${text('product_add_button')} a la cesta` : text('product_sold_out_button')}</button>
              : detail.stock > 0 && orderLink(detail) ? <a className="primary-button full whatsapp-order" href={orderLink(detail)} target="_blank" rel="noopener noreferrer"><MessageCircle size={18} /> Pedir por WhatsApp</a> : <button className="primary-button full" disabled>{text('product_sold_out_button')}</button>}
            {canShare && <div className="detail-share"><button type="button" className="share-wa-button" onClick={() => shareOnWhatsApp(detail)}><Send size={16} /> Mandar por WhatsApp</button><button type="button" className="text-button" onClick={() => void copyProductLink(detail)}><Copy size={14} /> Copiar enlace</button></div>}
          </div>
        </div>
      </div>}

      {toast && <div className="cart-toast" role="status"><Check size={17} /><span>{toast}</span>{cartEnabled && <button onClick={() => { setToast(''); setCartOpen(true) }}>Ver cesta</button>}</div>}

      {canTrack && ordersOpen && <div className="drawer-layer" role="dialog" aria-modal="true" aria-label="Mis pedidos y pagos">
        <button className="drawer-backdrop" aria-label="Cerrar" onClick={() => setOrdersOpen(false)} />
        <aside className="cart-drawer orders-drawer">
          <div className="drawer-header"><div><span>Tu cuenta en {text('site_name')}</span><h2>Mis pedidos y pagos</h2></div><div className="orders-head-actions"><button className="icon-button" aria-label="Actualizar" disabled={ordersLoading} onClick={() => void loadMyOrders()}><RotateCw size={17} /></button><button className="icon-button" aria-label="Cerrar" onClick={() => setOrdersOpen(false)}><X /></button></div></div>
          <p className="orders-intro">Aquí ves lo que pediste, lo que has pagado y lo que te falta. Se guarda solo en este teléfono.</p>
          {ordersError && <p className="form-error orders-error">{ordersError}</p>}
          <div className="orders-list">
            {ordersLoading && !myOrders.length && <p className="orders-empty">Buscando tus pedidos…</p>}
            {!ordersLoading && !myOrders.length && !ordersError && <div className="empty-state"><Wallet size={40} /><h3>Todavía no hay pedidos</h3><p>Cuando hagas un pedido en este teléfono, sale aquí.</p></div>}
            {myOrders.map((order) => <MyOrderCard key={order.number} order={order} busy={ordersBusy === order.number} phone={text('footer_phone')} payMethods={can('metodos_pago') ? paymentMethods : []} onCancel={(target) => void askCancel(target)} />)}
          </div>
        </aside>
      </div>}
    </main>
  )
}

/** Fotos del producto: se pasan deslizando con el dedo o tocando las miniaturas. */
function ProductGallery({ product }: { product: Product }) {
  const images = product.images?.length ? product.images : product.imageUrl ? [product.imageUrl] : []
  const [index, setIndex] = useState(0)
  const track = useRef<HTMLDivElement>(null)
  const go = (next: number) => {
    const target = Math.max(0, Math.min(images.length - 1, next))
    setIndex(target)
    track.current?.scrollTo({ left: target * track.current.clientWidth, behavior: 'smooth' })
  }
  if (!images.length) return <div className="product-detail-image"><div className="image-placeholder"><Sparkles /></div></div>
  return <div className="product-detail-image">
    <div className="gallery-track" ref={track} onScroll={(event) => { const el = event.currentTarget; setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))) }}>
      {images.map((url, itemIndex) => <img key={url} src={url} alt={`${product.name} — foto ${itemIndex + 1}`} loading={itemIndex ? 'lazy' : 'eager'} />)}
    </div>
    {images.length > 1 && <>
      <button type="button" className="gallery-arrow left" aria-label="Foto anterior" disabled={index === 0} onClick={() => go(index - 1)}><ChevronRight size={20} /></button>
      <button type="button" className="gallery-arrow right" aria-label="Foto siguiente" disabled={index === images.length - 1} onClick={() => go(index + 1)}><ChevronRight size={20} /></button>
      <div className="gallery-thumbs">{images.map((url, itemIndex) => <button type="button" key={url} className={itemIndex === index ? 'active' : ''} aria-label={`Ver foto ${itemIndex + 1}`} onClick={() => go(itemIndex)}><img src={url} alt="" /></button>)}</div>
    </>}
  </div>
}
