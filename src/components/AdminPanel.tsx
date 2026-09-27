import { jsPDF } from 'jspdf'
import { Link } from '@tanstack/react-router'
import {
  ArrowLeft,
  Banknote,
  Bell,
  BellOff,
  Boxes,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileEdit,
  FilePlus2,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  PackagePlus,
  Pencil,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  Share2,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Trash2,
  TrendingUp,
  UserPlus,
  Users,
  WalletCards,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { currency, shortDate } from '@/lib/format'
import { CONTENT_FIELD_GROUPS, DEFAULT_SITE_CONTENT } from '@/lib/site-content'
import { fromBase64Url } from '@/lib/push'
import type { Customer, DashboardData, Invoice, Product, SiteContent } from '@/types'

type Tab = 'resumen' | 'productos' | 'clientes' | 'facturas' | 'contenido' | 'papelera' | 'app'
type ProductFilter = 'todos' | 'visibles' | 'ocultos' | 'bajo'
type InvoiceFilter = 'todas' | 'pendientes' | 'vencidas' | 'saldadas'
type ProductDraft = Omit<Product, 'id'>
type CustomerDraft = Pick<Customer, 'name' | 'phone' | 'email' | 'address' | 'notes'>
type InvoiceLine = { productId: number; quantity: number }

const emptyProduct: ProductDraft = { code: '', name: '', category: 'Cabello', description: '', priceCents: 0, stock: 0, imageUrl: '', images: [], featured: false, active: true }
const emptyCustomer: CustomerDraft = { name: '', phone: '', email: '', address: '', notes: '' }

const MAX_PHOTOS = 10

const TAB_TITLES: Record<Tab, string> = { resumen: '', productos: 'Productos', clientes: 'Clientes', facturas: 'Facturas', contenido: 'Textos de la tienda', papelera: 'Papelera', app: 'App del panel' }

class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

// Si la sesión se vence, el panel vuelve solo a la pantalla de entrada.
let onSessionExpired: () => void = () => {}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } })
  } catch {
    throw new ApiError('No hay conexión. Revisa el internet e intenta de nuevo.', 0)
  }
  const result = await response.json().catch(() => ({})) as T & { error?: string }
  if (response.status === 401 && !path.startsWith('/api/auth/')) onSessionExpired()
  if (!response.ok) throw new ApiError(result.error || 'No pudimos completar la operación.', response.status)
  return result
}

/** Evita que un nombre escrito por un cliente se convierta en código dentro de la factura. */
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

const daysLeft = (deletedAt: string | null | undefined, days: number) => {
  if (!deletedAt) return days
  return Math.max(0, days - Math.floor((Date.now() - new Date(deletedAt).getTime()) / 86400000))
}

const greeting = () => {
  const hour = new Date().getHours()
  return hour < 12 ? 'Buenos días.' : hour < 19 ? 'Buenas tardes.' : 'Buenas noches.'
}

/** Enlace de WhatsApp al número del cliente. Números de 10 cifras (809, 829, 849…)
 * llevan el 1 delante. Si el número no sirve, devuelve '' y el botón no se muestra. */
const whatsappLink = (phone: string, message = '') => {
  let digits = String(phone || '').replace(/\D/g, '')
  if (digits.length === 10) digits = `1${digits}`
  if (digits.length < 11 || digits.length > 15) return ''
  return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ''}`
}

/** WhatsApp sin número (el usuario elige a quién mandarlo). */
const whatsappShareLink = (message: string) => `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`

// ── App "Aura Admin" y avisos de pedidos ──
type PushState = 'cargando' | 'no-soportado' | 'bloqueado' | 'apagado' | 'activo'
type PushDevice = { id: number; endpoint: string; label: string; createdAt: string }
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

// Chrome avisa "se puede instalar" con el evento beforeinstallprompt. Se guarda
// para que la única forma de instalar sea el botón del panel, con la sesión abierta.
let deferredInstall: InstallPromptEvent | null = null
const installListeners = new Set<(event: InstallPromptEvent | null) => void>()
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    if (!window.location.pathname.startsWith('/admin')) return
    event.preventDefault()
    deferredInstall = event as InstallPromptEvent
    installListeners.forEach((listener) => listener(deferredInstall))
  })
  window.addEventListener('appinstalled', () => {
    deferredInstall = null
    installListeners.forEach((listener) => listener(null))
  })
}

/** Pone (o quita) el manifest de la app. Solo se pone con la sesión abierta. */
function setAdminManifest(enabled: boolean) {
  const existing = document.getElementById('admin-manifest')
  if (enabled && !existing) {
    const link = document.createElement('link')
    link.id = 'admin-manifest'
    link.rel = 'manifest'
    link.href = '/admin.webmanifest'
    document.head.appendChild(link)
  } else if (!enabled && existing) {
    existing.remove()
  }
}

const isInstalledApp = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)

function deviceLabel() {
  const ua = navigator.userAgent
  const system = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : 'Computadora'
  const browser = /SamsungBrowser/i.test(ua) ? 'Samsung Internet' : /Edg\//i.test(ua) ? 'Edge' : /Firefox/i.test(ua) ? 'Firefox' : /Chrome/i.test(ua) ? 'Chrome' : 'Navegador'
  return `${system} · ${browser}`
}

function AppAndNotifications() {
  const [state, setState] = useState<PushState>('cargando')
  const [devices, setDevices] = useState<PushDevice[]>([])
  const [endpoint, setEndpoint] = useState('')
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(() => deferredInstall)
  const [installed, setInstalled] = useState(false)
  const iphone = typeof navigator !== 'undefined' && /iPhone|iPad/i.test(navigator.userAgent)

  async function load() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { setState('no-soportado'); return }
    const registration = await navigator.serviceWorker.register('/admin-sw.js', { scope: '/admin' })
    const setup = await api<{ publicKey: string; devices: PushDevice[] }>('/api/push')
    setDevices(setup.devices)
    const subscription = await registration.pushManager.getSubscription()
    setEndpoint(subscription?.endpoint ?? '')
    if (Notification.permission === 'denied') setState('bloqueado')
    else if (subscription && setup.devices.some((device) => device.endpoint === subscription.endpoint)) setState('activo')
    else setState('apagado')
  }

  useEffect(() => {
    setInstalled(isInstalledApp())
    load().catch(() => setState('no-soportado'))
    setInstallEvent(deferredInstall)
    const listener = (event: InstallPromptEvent | null) => {
      setInstallEvent(event)
      if (!event) setInstalled(true)
    }
    installListeners.add(listener)
    return () => { installListeners.delete(listener) }
  }, [])

  async function run(action: () => Promise<void>) {
    setWorking(true)
    setMessage('')
    try { await action() } catch (caught) { setMessage(caught instanceof Error ? caught.message : 'Algo salió mal. Intenta de nuevo.') } finally { setWorking(false) }
  }

  const enable = () => run(async () => {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      setState(permission === 'denied' ? 'bloqueado' : 'apagado')
      throw new Error('Para recibir los pedidos tienes que tocar «Permitir» cuando el teléfono pregunte.')
    }
    const registration = await navigator.serviceWorker.register('/admin-sw.js', { scope: '/admin' })
    await navigator.serviceWorker.ready
    const setup = await api<{ publicKey: string }>('/api/push')
    const old = await registration.pushManager.getSubscription()
    if (old) await old.unsubscribe().catch(() => false)
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(setup.publicKey) })
    const keys = subscription.toJSON().keys
    await api('/api/push', { method: 'POST', body: JSON.stringify({ endpoint: subscription.endpoint, p256dh: keys?.p256dh ?? '', auth: keys?.auth ?? '', label: deviceLabel() }) })
    try {
      await api('/api/push/test', { method: 'POST', body: JSON.stringify({ endpoint: subscription.endpoint }) })
    } finally {
      await load()
    }
    setMessage('Listo. Te acaba de llegar un aviso de prueba: así te van a llegar los pedidos.')
  })

  const disable = () => run(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/admin')
    const subscription = await registration?.pushManager.getSubscription()
    if (subscription) {
      await api('/api/push/remove', { method: 'POST', body: JSON.stringify({ endpoint: subscription.endpoint }) })
      await subscription.unsubscribe().catch(() => false)
    }
    await load()
    setMessage('Avisos apagados en este aparato.')
  })

  const test = () => run(async () => {
    try { await api('/api/push/test', { method: 'POST', body: JSON.stringify({ endpoint }) }) } finally { await load() }
    setMessage('Prueba enviada. Debe llegarte en unos segundos.')
  })

  const removeDevice = (device: PushDevice) => run(async () => {
    if (!window.confirm(`¿Dejar de mandar avisos a «${device.label || 'ese aparato'}»?`)) return
    await api('/api/push/remove', { method: 'POST', body: JSON.stringify({ endpoint: device.endpoint }) })
    await load()
  })

  const install = () => run(async () => {
    if (!installEvent) return
    await installEvent.prompt()
    const choice = await installEvent.userChoice
    if (choice.outcome === 'accepted') setInstalled(true)
    deferredInstall = null
    setInstallEvent(null)
  })

  return <div className="panel-card app-card">
    <div className="app-card-head">
      <img src="/admin-192.png" alt="" />
      <div><strong>App «Aura Admin»</strong><span>Instala el panel como una app en tu teléfono. Cada vez que un cliente haga un pedido te llega un aviso, aunque la app esté cerrada.</span></div>
    </div>
    <div className="app-step">
      <b>1</b>
      <div>
        <strong>Descargar la app</strong>
        {installed
          ? <span className="app-ok"><Check size={14} /> Ya la estás usando como app.</span>
          : installEvent
            ? <button type="button" className="primary-button" disabled={working} onClick={install}><Smartphone size={16} /> Descargar app</button>
            : iphone
              ? <span>En iPhone: abre esta página en Safari, toca el botón de <b>Compartir</b> y luego <b>«Agregar a inicio»</b>.</span>
              : <span>Preparando el botón… Si en unos segundos no aparece, en Chrome toca el menú <b>⋮</b> → <b>«Instalar app»</b> o <b>«Agregar a la pantalla principal»</b>.</span>}
      </div>
    </div>
    <div className="app-step">
      <b>2</b>
      <div>
        <strong>Avisos de pedidos en este aparato</strong>
        {state === 'cargando' && <span>Revisando…</span>}
        {state === 'no-soportado' && <span>Este navegador no puede recibir avisos. Abre el panel en Chrome (Android o computadora). En iPhone, primero agrega la app a inicio y ábrela desde ahí.</span>}
        {state === 'bloqueado' && <span className="app-warn">Los avisos están bloqueados para esta página. Toca el candado junto a la dirección (o Ajustes del teléfono → Apps → Aura Admin → Notificaciones), ponlos en «Permitir» y vuelve aquí.</span>}
        {state === 'apagado' && <button type="button" className="primary-button" disabled={working} onClick={enable}><Bell size={16} /> {working ? 'Activando…' : 'Activar avisos'}</button>}
        {state === 'activo' && <div className="app-actions">
          <span className="app-ok"><Check size={14} /> Activados en este aparato.</span>
          <button type="button" className="secondary-button" disabled={working} onClick={test}><Bell size={15} /> Probar</button>
          <button type="button" className="secondary-button" disabled={working} onClick={disable}><BellOff size={15} /> Apagar</button>
        </div>}
      </div>
    </div>
    {message && <p className="app-message">{message}</p>}
    {devices.length > 0 && <div className="app-devices">
      <span>Los pedidos avisan a {devices.length === 1 ? '1 aparato' : `${devices.length} aparatos`}:</span>
      {devices.map((device) => <div key={device.id} className="app-device">
        <Smartphone size={15} />
        <span>{device.label || 'Aparato'}{device.endpoint === endpoint ? ' (este)' : ''} · desde {shortDate(device.createdAt)}</span>
        <button type="button" aria-label="Quitar" disabled={working} onClick={() => void removeDevice(device)}><X size={14} /></button>
      </div>)}
    </div>}
  </div>
}


export function AdminPanel() {
  const [authenticated, setAuthenticated] = useState(false)
  const [authLoading, setAuthLoading] = useState(true)
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<Tab>('resumen')
  const [query, setQuery] = useState('')
  const [productFilter, setProductFilter] = useState<ProductFilter>('todos')
  const [invoiceFilter, setInvoiceFilter] = useState<InvoiceFilter>('todas')
  const [editInvoice, setEditInvoice] = useState<Invoice | null>(null)
  const [customerInvoices, setCustomerInvoices] = useState<Customer | null>(null)
  const [restock, setRestock] = useState<{ productId: number; quantity: number; mode: 'sumar' | 'restar'; note: string } | null>(null)
  const [editInvoiceNotes, setEditInvoiceNotes] = useState('')
  const [editInvoiceDue, setEditInvoiceDue] = useState('')
  const [invoiceDiscount, setInvoiceDiscount] = useState(0)
  const [invoiceNotes, setInvoiceNotes] = useState('')
  const [invoiceMethod, setInvoiceMethod] = useState('Efectivo')
  const [noticeState, setNoticeState] = useState<{ text: string; error: boolean } | null>(null)
  const setNotice = (text: string, error = false) => setNoticeState(text ? { text, error } : null)
  const [modalError, setModalError] = useState('')
  const [confirmState, setConfirmState] = useState<{ message: string; okLabel: string; danger: boolean; resolve: (ok: boolean) => void } | null>(null)
  const [loginBusy, setLoginBusy] = useState(false)
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '' })
  const askConfirm = (message: string, okLabel = 'Sí, continuar', danger = true) => new Promise<boolean>((resolve) => setConfirmState({ message, okLabel, danger, resolve }))
  const closeConfirm = (ok: boolean) => { confirmState?.resolve(ok); setConfirmState(null) }
  const [productModal, setProductModal] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [productDraft, setProductDraft] = useState<ProductDraft>(emptyProduct)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [customerModal, setCustomerModal] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [customerDraft, setCustomerDraft] = useState<CustomerDraft>(emptyCustomer)
  const [invoiceModal, setInvoiceModal] = useState(false)
  const [invoiceCustomerId, setInvoiceCustomerId] = useState(0)
  const [invoiceLines, setInvoiceLines] = useState<InvoiceLine[]>([{ productId: 0, quantity: 1 }])
  const [invoicePaid, setInvoicePaid] = useState(0)
  const [invoiceDueDate, setInvoiceDueDate] = useState('')
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)
  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null)
  const [paymentAmount, setPaymentAmount] = useState(0)
  const [paymentMethod, setPaymentMethod] = useState('Efectivo')
  const [paymentError, setPaymentError] = useState('')
  const [saving, setSaving] = useState(false)
  const [content, setContent] = useState<SiteContent>(DEFAULT_SITE_CONTENT)
  const [contentDraft, setContentDraft] = useState<SiteContent>(DEFAULT_SITE_CONTENT)
  const [contentLoading, setContentLoading] = useState(false)
  const [contentSaving, setContentSaving] = useState(false)

  useEffect(() => {
    if (!noticeState) return
    const timer = window.setTimeout(() => setNoticeState(null), noticeState.error ? 7000 : 4000)
    return () => window.clearTimeout(timer)
  }, [noticeState])

  const anyModalOpen = productModal || customerModal || invoiceModal || Boolean(paymentInvoice || selectedInvoice || customerInvoices || editInvoice || restock)
  useEffect(() => { setModalError('') }, [productModal, customerModal, invoiceModal, paymentInvoice, selectedInvoice, customerInvoices, editInvoice, restock?.productId])
  useEffect(() => {
    if (!anyModalOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [anyModalOpen])

  onSessionExpired = () => { setAuthenticated(false); setData(null); setAuthError('Tu sesión terminó. Vuelve a entrar.') }

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    try {
      setData(await api<DashboardData>('/api/dashboard'))
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'No pudimos cargar el panel.', true)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadContent = useCallback(async () => {
    setContentLoading(true)
    try {
      const loaded = await api<SiteContent>('/api/content')
      setContent(loaded)
      setContentDraft(loaded)
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'No pudimos cargar el contenido del sitio.', true)
    } finally {
      setContentLoading(false)
    }
  }, [])

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const result = await api<{ authenticated: boolean }>('/api/auth/me')
        setAuthenticated(result.authenticated)
      } catch {
        setAuthenticated(false)
      } finally {
        setAuthLoading(false)
      }
    }
    void initializeAuth()
  }, [])

  useEffect(() => {
    setAdminManifest(authenticated)
    if (authenticated) {
      // Al tocar un aviso de pedido, la app abre directo en Facturas.
      const wanted = new URLSearchParams(window.location.search).get('tab')
      if (wanted && wanted in TAB_TITLES) setTab(wanted as Tab)
      void loadDashboard()
      void loadContent()
    }
  }, [authenticated, loadDashboard, loadContent])

  const saveContent = async (event: FormEvent) => {
    event.preventDefault()
    setContentSaving(true)
    try {
      const updated = await api<SiteContent>('/api/content', { method: 'PATCH', body: JSON.stringify(contentDraft) })
      setContent(updated)
      setContentDraft(updated)
      setNotice('Contenido del sitio actualizado.')
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'No pudimos guardar el contenido.', true)
    } finally {
      setContentSaving(false)
    }
  }

  const contentChanged = useMemo(
    () => CONTENT_FIELD_GROUPS.some((group) => group.fields.some((field) => (contentDraft[field.key] ?? '') !== (content[field.key] ?? ''))),
    [content, contentDraft],
  )

  useEffect(() => {
    if (!contentChanged) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [contentChanged])

  const goTo = async (next: Tab) => {
    if (tab === 'contenido' && next !== 'contenido' && contentChanged && !(await askConfirm('Tienes cambios sin guardar en los textos. ¿Salir sin guardar?', 'Salir sin guardar'))) return
    if (tab === 'contenido' && next !== 'contenido') setContentDraft(content)
    setTab(next)
    setQuery('')
    window.scrollTo({ top: 0 })
  }

  const run = async (action: () => Promise<unknown>, success: string) => {
    setSaving(true)
    try {
      await action()
      setNotice(success)
      await loadDashboard()
      return true
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'No pudimos completar la operación.'
      setNotice(message, true)
      setModalError(message)
      return false
    } finally {
      setSaving(false)
    }
  }

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault()
    setLoginBusy(true)
    setAuthError('')
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) })
      setPassword('')
      setAuthenticated(true)
    } catch (caught) {
      setAuthError(caught instanceof ApiError && caught.status === 401 ? 'Contraseña incorrecta. Verifica tus datos.' : caught instanceof Error ? caught.message : 'No pudimos entrar.')
    } finally {
      setLoginBusy(false)
    }
  }

  const signOut = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {})
    setAuthenticated(false)
    setData(null)
  }

  const openProduct = (product?: Product, duplicate = false) => {
    setEditingProduct(product && !duplicate ? product : null)
    const images = product ? (product.images?.length ? product.images : product.imageUrl ? [product.imageUrl] : []) : []
    setProductDraft(product ? { code: product.code, name: product.name, category: product.category, description: product.description, priceCents: product.priceCents, stock: product.stock, imageUrl: images[0] || '', images, featured: product.featured, active: product.active } : emptyProduct)
    if (product && duplicate) setProductDraft({ code: '', name: `${product.name} (copia)`, category: product.category, description: product.description, priceCents: product.priceCents, stock: 0, imageUrl: images[0] || '', images, featured: false, active: product.active })
    setProductModal(true)
  }

  const setImages = (images: string[]) => setProductDraft((draft) => ({ ...draft, images, imageUrl: images[0] || '' }))

  const handleImageFiles = async (files: File[]) => {
    const room = MAX_PHOTOS - productDraft.images.length
    if (room <= 0) { setNotice(`Cada producto puede tener hasta ${MAX_PHOTOS} fotos.`); return }
    setUploadingImage(true)
    let uploaded = 0
    try {
      for (const file of files.slice(0, room)) {
        if (!file.type.startsWith('image/')) continue
        const dataUrl = await imageToDataUrl(file)
        const result = await api<{ url: string }>('/api/upload', { method: 'POST', body: JSON.stringify({ filename: file.name, dataUrl }) })
        setProductDraft((draft) => { const images = [...draft.images, result.url]; return { ...draft, images, imageUrl: images[0] } })
        uploaded++
      }
      setNotice(uploaded === 1 ? 'Foto agregada. Recuerda tocar «Guardar producto».' : `${uploaded} fotos agregadas. Recuerda tocar «Guardar producto».`)
      if (files.length > room) setNotice(`Solo se agregaron ${uploaded}: cada producto puede tener hasta ${MAX_PHOTOS} fotos.`)
    } catch (caught) {
      { const message = caught instanceof Error ? caught.message : 'No pudimos subir la foto.'; setNotice(message, true); setModalError(message) }
    } finally {
      setUploadingImage(false)
    }
  }

  const saveProduct = async (event: FormEvent) => {
    event.preventDefault()
    setModalError('')
    if (productDraft.priceCents <= 0) { setModalError('Escribe el precio del producto (mayor que 0).'); return }
    // Si no se escribe código, se crea uno solo con las primeras letras del nombre.
    const code = productDraft.code.trim() || `${productDraft.name.normalize('NFD').replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean).map((word) => word[0]).join('').slice(0, 3).toUpperCase() || 'PR'}-${String(Date.now()).slice(-4)}`
    setSaving(true)
    try {
      await api(editingProduct ? `/api/products/${editingProduct.id}` : '/api/products', { method: editingProduct ? 'PATCH' : 'POST', body: JSON.stringify({ ...productDraft, code }) })
      setProductModal(false)
      setNotice(editingProduct ? 'Producto actualizado.' : 'Producto agregado al catálogo.')
      await loadDashboard()
    } catch (caught) {
      { const message = caught instanceof Error ? caught.message : 'No pudimos guardar el producto.'; setNotice(message, true); setModalError(message) }
    } finally {
      setSaving(false)
    }
  }

  const removeProduct = async (product: Product) => {
    if (!(await askConfirm(`¿Mandar «${product.name}» a la Papelera? Sale de la tienda. Puedes restaurarlo durante 60 días.`, 'Sí, mandar a la Papelera'))) return
    await run(() => api(`/api/products/${product.id}`, { method: 'DELETE' }), 'Producto enviado a la Papelera.')
  }

  const toggleProduct = (product: Product) => run(() => api(`/api/products/${product.id}/visible`, { method: 'POST', body: JSON.stringify({ active: !product.active }) }), product.active ? `«${product.name}» ya no sale en la tienda.` : `«${product.name}» ya sale en la tienda.`)

  const restockProduct = (product: Product) => {
    setRestock({ productId: product.id, quantity: 1, mode: 'sumar', note: '' })
  }

  const saveRestock = async (event: FormEvent) => {
    event.preventDefault()
    if (!restock || !data) return
    const product = data.products.find((item) => item.id === restock.productId)
    if (!product || restock.quantity < 1) return
    const delta = restock.mode === 'sumar' ? restock.quantity : -Math.min(restock.quantity, product.stock)
    if (await run(() => api(`/api/products/${product.id}/stock`, { method: 'POST', body: JSON.stringify({ delta }) }), `Listo: ahora hay ${Math.max(0, product.stock + delta)} unidades de «${product.name}».`)) setRestock(null)
  }

  const removeCustomer = async (customer: Customer) => {
    if (!(await askConfirm(`¿Mandar a ${customer.name} a la Papelera? Sus facturas no se borran. Puedes restaurarlo durante 60 días.`, 'Sí, mandar a la Papelera'))) return
    await run(() => api(`/api/customers/${customer.id}`, { method: 'DELETE' }), 'Cliente enviado a la Papelera.')
  }

  const restoreItem = (kind: 'products' | 'customers' | 'invoices', id: number) => run(() => api(`/api/${kind}/${id}/restore`, { method: 'POST' }), 'Restaurado.')

  const deleteForever = async (kind: 'products' | 'customers' | 'invoices', id: number, label: string) => {
    if (!(await askConfirm(`¿Borrar «${label}» para siempre? Esto no se puede deshacer.`, 'Sí, borrar para siempre'))) return
    await run(() => api(`/api/${kind}/${id}/forever`, { method: 'DELETE' }), 'Borrado para siempre.')
  }

  const openInvoiceFor = (customerId = 0, productId = 0) => {
    setInvoiceCustomerId(customerId || (data?.customers.length ? 0 : -1))
    setNewCustomer({ name: '', phone: '' })
    setInvoiceLines([{ productId, quantity: 1 }])
    setInvoicePaid(0)
    setInvoiceDiscount(0)
    setInvoiceNotes('')
    setInvoiceDueDate('')
    setInvoiceMethod('Efectivo')
    setInvoiceModal(true)
  }

  const openEditInvoice = (invoice: Invoice) => {
    setEditInvoice(invoice)
    setEditInvoiceNotes(invoice.notes || '')
    setEditInvoiceDue(invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString('en-CA', { timeZone: 'America/Santo_Domingo' }) : '')
    setSelectedInvoice(null)
  }

  const saveEditInvoice = async (event: FormEvent) => {
    event.preventDefault()
    if (!editInvoice) return
    if (await run(() => api(`/api/invoices/${editInvoice.id}`, { method: 'PATCH', body: JSON.stringify({ notes: editInvoiceNotes, dueDate: editInvoiceDue || null }) }), 'Factura actualizada.')) setEditInvoice(null)
  }

  const openCustomer = (customer?: Customer) => {
    setEditingCustomer(customer || null)
    setCustomerDraft(customer ? { name: customer.name, phone: customer.phone, email: customer.email, address: customer.address, notes: customer.notes } : emptyCustomer)
    setCustomerModal(true)
  }

  const saveCustomer = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await api(editingCustomer ? `/api/customers/${editingCustomer.id}` : '/api/customers', { method: editingCustomer ? 'PATCH' : 'POST', body: JSON.stringify(customerDraft) })
      setCustomerModal(false)
      setNotice(editingCustomer ? 'Cliente actualizado.' : 'Cliente registrado.')
      await loadDashboard()
    } catch (caught) {
      { const message = caught instanceof Error ? caught.message : 'No pudimos guardar el cliente.'; setNotice(message, true); setModalError(message) }
    } finally {
      setSaving(false)
    }
  }

  const createInvoice = async (event: FormEvent) => {
    event.preventDefault()
    setModalError('')
    const lines = invoiceLines.filter((line) => line.productId)
    if (!lines.length) { setModalError('Elige al menos un producto.'); return }
    const tooMany = lines.find((line) => line.quantity > (data?.products.find((product) => product.id === line.productId)?.stock ?? 0))
    if (tooMany) { setModalError(`No hay suficientes unidades de ${data?.products.find((product) => product.id === tooMany.productId)?.name}.`); return }
    if (lines.some((line) => line.quantity < 1)) { setModalError('La cantidad de cada producto debe ser al menos 1.'); return }
    setSaving(true)
    try {
      let customerId = invoiceCustomerId
      if (customerId === -1) {
        if (!newCustomer.name.trim() || !newCustomer.phone.trim()) throw new Error('Escribe el nombre y el teléfono del cliente nuevo.')
        const created = await api<{ id: number }>('/api/customers', { method: 'POST', body: JSON.stringify({ ...newCustomer, reuse: true }) })
        customerId = created.id
        setInvoiceCustomerId(created.id)
      }
      await api('/api/invoices', { method: 'POST', body: JSON.stringify({ customerId, items: lines, paidCents: invoicePaid, discountCents: invoiceDiscount, notes: invoiceNotes, method: invoiceMethod, dueDate: invoiceDueDate || null }) })
      setInvoiceModal(false)
      setNotice('Factura creada y existencias actualizadas.')
      await loadDashboard()
    } catch (caught) {
      { const message = caught instanceof Error ? caught.message : 'No pudimos crear la factura.'; setNotice(message, true); setModalError(message) }
    } finally {
      setSaving(false)
    }
  }

  const deleteInvoice = async (invoice: Invoice) => {
    if (!(await askConfirm(`¿Mandar la factura ${invoice.number} de ${invoice.customerName} a la Papelera? Los productos vuelven al inventario. Puedes restaurarla durante 60 días.`, 'Sí, mandar a la Papelera'))) return
    setSaving(true)
    try {
      await api(`/api/invoices/${invoice.id}`, { method: 'DELETE' })
      setSelectedInvoice(null)
      setNotice('Factura enviada a la Papelera. Los productos volvieron al inventario.')
      await loadDashboard()
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'No pudimos eliminar la factura.', true)
    } finally {
      setSaving(false)
    }
  }

  const buildInvoiceText = (invoice: Invoice) => {
    const lines = invoice.items.map((item) => `• ${item.quantity}x ${item.productName} — ${currency(item.totalCents)}`).join('\n')
    return [
      `*Factura ${invoice.number}*`,
      `Cliente: ${invoice.customerName}`,
      `Fecha: ${shortDate(invoice.createdAt)}`,
      '',
      lines,
      '',
      `Subtotal: ${currency(invoice.subtotalCents)}`,
      invoice.discountCents ? `Descuento: -${currency(invoice.discountCents)}` : '',
      `*Total: ${currency(invoice.totalCents)}*`,
      `Abonado: ${currency(invoice.paidCents)}`,
      `*Saldo pendiente: ${currency(invoice.balanceCents)}*`,
      '',
      'Aura Beauty',
    ].filter(Boolean).join('\n')
  }

  const buildInvoiceHtml = (invoice: Invoice) => {
    const cell = 'padding:9px 6px;border-bottom:1px solid #e4e0d3;font-size:13px'
    const rows = invoice.items.map((item) => `<tr>
        <td style="${cell}">${esc(item.productCode)}</td>
        <td style="${cell}">${esc(item.productName)}</td>
        <td style="${cell};text-align:center">${item.quantity}</td>
        <td style="${cell};text-align:right">${currency(item.unitPriceCents)}</td>
        <td style="${cell};text-align:right">${currency(item.totalCents)}</td>
      </tr>`).join('')
    const paymentRows = invoice.payments.map((payment) => `<tr>
        <td style="${cell}">${shortDate(payment.createdAt)}</td>
        <td style="${cell}">${esc(payment.method)}</td>
        <td style="${cell};text-align:right">${currency(payment.amountCents)}</td>
      </tr>`).join('')
    const totalsRows: Array<[string, string, boolean]> = [
      ['Subtotal', currency(invoice.subtotalCents), false],
      ...(invoice.discountCents ? [['Descuento', `-${currency(invoice.discountCents)}`, false] as [string, string, boolean]] : []),
      ['Total', currency(invoice.totalCents), true],
      ['Abonado', currency(invoice.paidCents), false],
      ['Saldo', currency(invoice.balanceCents), false],
    ]
    const totalsHtml = totalsRows.map(([label, value, bold]) => `<tr>
        <td style="padding:${bold ? '12px 6px 4px' : '4px 6px'};border-top:${bold ? '2px solid #2c2c22' : 'none'};font-weight:${bold ? 'bold' : 'normal'};font-size:${bold ? '17px' : '13px'}">${label}</td>
        <td style="padding:${bold ? '12px 6px 4px' : '4px 6px'};border-top:${bold ? '2px solid #2c2c22' : 'none'};font-weight:${bold ? 'bold' : 'normal'};font-size:${bold ? '17px' : '13px'};text-align:right">${value}</td>
      </tr>`).join('')
    const th = 'text-align:left;text-transform:uppercase;font-size:11px;letter-spacing:.05em;color:#78786a;padding:8px 6px;border-bottom:1px solid #e4e0d3'

    return `<div style="font-family:Georgia,'Times New Roman',serif;color:#2c2c22;width:720px;padding:44px;background:#faf7ef;box-sizing:border-box">
      <div style="letter-spacing:.12em;text-transform:uppercase;font-size:12px;color:#5b6b4e;font-weight:bold">Aura Beauty</div>
      <div style="font-size:30px;font-weight:bold;margin:18px 0 8px">Factura ${esc(invoice.number)}</div>
      <div style="color:#78786a;font-size:13px;margin:0 0 18px">Fecha: ${shortDate(invoice.createdAt)}${invoice.dueDate ? ' · Vence: ' + shortDate(invoice.dueDate) : ''}</div>
      <div style="font-size:14px;margin:0 0 4px"><b>Cliente:</b> ${esc(invoice.customerName)}</div>
      <div style="color:#78786a;font-size:13px;margin:0 0 24px">${esc(invoice.customerPhone)}</div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr>
          <th style="${th}">Código</th>
          <th style="${th}">Producto</th>
          <th style="${th};text-align:center">Cant.</th>
          <th style="${th};text-align:right">Precio</th>
          <th style="${th};text-align:right">Total</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <table style="width:100%;border-collapse:collapse;margin-top:6px">${totalsHtml}</table>
      ${invoice.payments.length ? `<div style="margin-top:30px;font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:#78786a;font-weight:bold">Historial de pagos</div>
      <table style="width:100%;border-collapse:collapse;margin-top:10px">
        <thead><tr>
          <th style="${th}">Fecha</th>
          <th style="${th}">Método</th>
          <th style="${th};text-align:right">Monto</th>
        </tr></thead>
        <tbody>${paymentRows}</tbody>
      </table>` : ''}
      ${invoice.notes ? `<div style="margin-top:22px;color:#78786a;font-size:12px">Notas: ${esc(invoice.notes).replace(/\n/g, '<br>')}</div>` : ''}
    </div>`
  }

  const buildInvoicePdf = (invoice: Invoice): Promise<jsPDF> => {
    return new Promise((resolve, reject) => {
      const container = document.createElement('div')
      container.style.position = 'fixed'
      container.style.top = '0'
      container.style.left = '0'
      container.style.zIndex = '-9999'
      container.style.opacity = '0.01'
      container.style.pointerEvents = 'none'
      container.innerHTML = buildInvoiceHtml(invoice)
      document.body.appendChild(container)
      const doc = new jsPDF('p', 'pt', 'letter')
      doc.html(container, {
        x: 0,
        y: 0,
        width: 612,
        windowWidth: 720,
        autoPaging: 'text',
        callback: (pdf) => {
          document.body.removeChild(container)
          resolve(pdf)
        },
      }).catch((caught: unknown) => {
        document.body.removeChild(container)
        reject(caught instanceof Error ? caught : new Error('No pudimos generar el PDF.'))
      })
    })
  }

  const downloadInvoice = async (invoice: Invoice) => {
    setNotice('Preparando el PDF de la factura…')
    try {
      const doc = await buildInvoicePdf(invoice)
      doc.save(`${invoice.number}.pdf`)
      setNotice(`Factura ${invoice.number} descargada.`)
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'No pudimos generar el PDF.', true)
    }
  }

  const shareInvoice = async (invoice: Invoice) => {
    setNotice('Preparando la factura para compartir…')
    try {
      const doc = await buildInvoicePdf(invoice)
      const blob = doc.output('blob')
      const file = new File([blob], `${invoice.number}.pdf`, { type: 'application/pdf' })
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: `Factura ${invoice.number}` })
        return
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return
    }
    const text = buildInvoiceText(invoice)
    if (navigator.share) {
      try {
        await navigator.share({ title: `Factura ${invoice.number}`, text })
        return
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return
      }
    }
    // Si no se pudo compartir, se abre WhatsApp con el texto (sin ventana emergente, que el teléfono bloquearía).
    window.location.href = whatsappShareLink(text)
  }

  const registerPayment = async (event: FormEvent) => {
    event.preventDefault()
    if (!paymentInvoice) return
    setSaving(true)
    setPaymentError('')
    try {
      await api(`/api/invoices/${paymentInvoice.id}/payments`, { method: 'POST', body: JSON.stringify({ amountCents: paymentAmount, method: paymentMethod }) })
      setPaymentInvoice(null)
      setNotice('Abono registrado. El saldo se actualizó.')
      await loadDashboard()
    } catch (caught) {
      const message = caught instanceof Error && caught.message ? caught.message : 'No pudimos registrar el abono.'
      setPaymentError(message)
      setNotice(message, true)
    } finally {
      setSaving(false)
    }
  }

  // La búsqueda no distingue mayúsculas ni tildes.
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const matches = (value: string) => normalize(value).includes(normalize(query.trim()))
  const filteredProducts = useMemo(() => data?.products.filter((product) => matches(`${product.name} ${product.code} ${product.category}`) && (productFilter === 'todos' || (productFilter === 'visibles' && product.active) || (productFilter === 'ocultos' && !product.active) || (productFilter === 'bajo' && product.stock <= 5))) || [], [data, query, productFilter])
  const filteredCustomers = useMemo(() => data?.customers.filter((customer) => matches(`${customer.name} ${customer.phone} ${customer.email} ${customer.address}`)) || [], [data, query])
  const filteredInvoices = useMemo(() => data?.invoices.filter((invoice) => matches(`${invoice.number} ${invoice.customerName} ${invoice.customerPhone} ${invoice.items.map((item) => item.productName).join(' ')}`) && (invoiceFilter === 'todas' || (invoiceFilter === 'saldadas' && invoice.balanceCents <= 0) || (invoiceFilter === 'pendientes' && invoice.balanceCents > 0) || (invoiceFilter === 'vencidas' && invoice.status === 'overdue'))) || [], [data, query, invoiceFilter])
  const trashCount = data ? data.trash.products.length + data.trash.customers.length + data.trash.invoices.length : 0
  const categoryOptions = useMemo(() => [...new Set(['Cabello', 'Rostro', 'Cuerpo', ...(data?.products.map((product) => product.category) || [])])], [data])
  const invoiceSubtotal = invoiceLines.reduce((sum, line) => sum + (data?.products.find((product) => product.id === line.productId)?.priceCents || 0) * line.quantity, 0)
  const invoiceDraftTotal = Math.max(0, invoiceSubtotal - invoiceDiscount)

  if (authLoading) return <div className="admin-loading"><span className="brand-mark"><Sparkles /></span><p>Preparando tu espacio…</p></div>

  if (!authenticated) return <main className="login-page">
    <Link to="/" className="back-store"><ArrowLeft size={17} /> Volver a la tienda</Link>
    <section className="login-art"><div className="login-brand"><span className="brand-mark"><Sparkles /></span><span><strong>Aura</strong><small>gestión comercial</small></span></div><div><span className="eyebrow">Todo bajo control</span><h1>Tu negocio,<br /><em>más claro.</em></h1><p>Productos, clientes, ventas y cobros reunidos en un solo lugar.</p></div><div className="login-quote">“Saber qué se vendió y qué falta por cobrar cambia la forma de trabajar.”</div></section>
    <section className="login-form-wrap"><form className="login-form" onSubmit={handleLogin}><span className="login-icon"><ClipboardList /></span><small>Acceso privado</small><h2>Bienvenida de nuevo</h2><p>Ingresa con la contraseña autorizada para administrar la tienda.</p><label>Contraseña<input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" /></label>{authError && <p className="form-error">{authError}</p>}<button className="primary-button full" disabled={loginBusy}>{loginBusy ? 'Entrando…' : 'Entrar al panel'} <ArrowLeft className="rotate-180" size={18} /></button><div className="security-note"><Check size={15} /> Acceso protegido por sesión firmada</div></form></section>
  </main>

  return <main className="admin-shell">
    <aside className="admin-sidebar">
      <div className="login-brand sidebar-brand"><span className="brand-mark"><Sparkles /></span><span><strong>Aura</strong><small>administración</small></span></div>
      <nav>
        <button className={tab === 'resumen' ? 'active' : ''} onClick={() => goTo('resumen')}><LayoutDashboard /> Inicio</button>
        <button className={tab === 'productos' ? 'active' : ''} onClick={() => goTo('productos')}><Boxes /> Productos</button>
        <button className={tab === 'clientes' ? 'active' : ''} onClick={() => goTo('clientes')}><Users /> Clientes</button>
        <button className={tab === 'facturas' ? 'active' : ''} onClick={() => goTo('facturas')}><ReceiptText /> Facturas</button>
        <button className={tab === 'contenido' ? 'active' : ''} onClick={() => goTo('contenido')}><FileEdit /> Textos</button>
        <button className={tab === 'papelera' ? 'active' : ''} onClick={() => goTo('papelera')}><Trash2 /> Papelera{trashCount > 0 && <b className="nav-badge">{trashCount}</b>}</button>
        <button className={tab === 'app' ? 'active' : ''} onClick={() => goTo('app')}><Smartphone /> App</button>
      </nav>
      <div className="sidebar-footer"><Link to="/"><ShoppingBag /> Ver tienda</Link><button onClick={signOut}><LogOut /> Cerrar sesión</button><div><span>A</span><p><strong>Administración</strong><small>Aura Beauty</small></p></div></div>
    </aside>
    <section className="admin-main">
      <header className="admin-header"><div><span className="eyebrow">Panel de control</span><h1>{tab === 'resumen' ? greeting() : TAB_TITLES[tab]}</h1></div><div className="mobile-top-actions"><Link to="/"><ShoppingBag size={16} /> Ver tienda</Link><button onClick={signOut}><LogOut size={16} /> Salir</button></div><div className="admin-date"><span>{new Intl.DateTimeFormat('es-DO', { weekday: 'long' }).format(new Date())}</span><strong>{new Intl.DateTimeFormat('es-DO', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date())}</strong></div></header>
      {noticeState && <button className={`notice toast ${noticeState.error ? 'error' : ''}`} role="status" onClick={() => setNotice('')}>{noticeState.error ? <X /> : <Check />} <span>{noticeState.text}</span></button>}
      {loading && !data ? <div className="dashboard-skeleton"><div /><div /><div /><div /></div> : null}

      {data && tab === 'resumen' && <>
        <section className="metric-grid">
          <article className="metric-card accent"><span><TrendingUp /></span><small>Ventas registradas</small><strong>{currency(data.metrics.salesCents)}</strong><p>Histórico de facturación</p></article>
          <article className="metric-card"><span><WalletCards /></span><small>Por cobrar</small><strong>{currency(data.metrics.receivableCents)}</strong><p>{data.invoices.filter((invoice) => invoice.balanceCents > 0).length} facturas pendientes</p></article>
          <article className="metric-card"><span><CircleDollarSign /></span><small>Facturas saldadas</small><strong>{data.metrics.paidInvoices}</strong><p>Pagadas por completo</p></article>
          <button className="metric-card" onClick={() => { void goTo('productos').then(() => setProductFilter('bajo')) }}><span><Boxes /></span><small>Stock bajo</small><strong>{data.metrics.lowStock}</strong><p>Productos con 5 o menos · ver</p></button>
        </section>
        <section className="quick-actions"><button onClick={() => openProduct()}><span><PackagePlus /></span><div><strong>Nuevo producto</strong><small>Agregar con código único</small></div><ChevronRight /></button><button onClick={() => openCustomer()}><span><UserPlus /></span><div><strong>Nuevo cliente</strong><small>Crear su perfil</small></div><ChevronRight /></button><button onClick={() => openInvoiceFor()}><span><FilePlus2 /></span><div><strong>Nueva factura</strong><small>Registrar una venta</small></div><ChevronRight /></button></section>
        <section className="dashboard-columns">
          <div className="panel-card"><div className="panel-title"><div><small>Actividad reciente</small><h2>Últimas facturas</h2></div><button onClick={() => goTo('facturas')}>Ver todas <ChevronRight /></button></div><div className="invoice-list">{data.invoices.slice(0, 5).map((invoice) => <button key={invoice.id} onClick={() => setSelectedInvoice(invoice)}><span className="invoice-icon"><ReceiptText /></span><span><strong>{invoice.customerName}</strong><small>{invoice.number} · {shortDate(invoice.createdAt)}</small></span><b>{currency(invoice.totalCents)}</b><StatusBadge invoice={invoice} /></button>)}{!data.invoices.length && <Empty message="Todavía no hay facturas." />}</div></div>
          <div className="panel-card"><div className="panel-title"><div><small>Seguimiento</small><h2>Saldos pendientes</h2></div></div><div className="debt-list">{data.customers.filter((customer) => customer.balanceCents > 0).sort((a, b) => b.balanceCents - a.balanceCents).slice(0, 5).map((customer) => <button key={customer.id} onClick={() => setCustomerInvoices(customer)}><span>{customer.name.charAt(0)}</span><p><strong>{customer.name}</strong><small>{customer.invoiceCount} factura(s) · tocar para ver</small></p><b>{currency(customer.balanceCents)}</b></button>)}{!data.customers.some((customer) => customer.balanceCents > 0) && <Empty message="No hay saldos pendientes." />}</div></div>
        </section>
      </>}

      {data && (tab === 'productos' || tab === 'clientes' || tab === 'facturas') && <section className="management-page">
        <div className="management-toolbar"><label className="search-field"><Search /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === 'productos' ? 'Buscar por nombre, código o categoría…' : tab === 'clientes' ? 'Buscar por nombre, teléfono o correo…' : 'Buscar por número, cliente o producto…'} />{query && <button type="button" className="clear-search" aria-label="Borrar búsqueda" onClick={() => setQuery('')}><X size={15} /></button>}</label>{tab === 'productos' && <button className="primary-button" onClick={() => openProduct()}><Plus /> Nuevo producto</button>}{tab === 'clientes' && <button className="primary-button" onClick={() => openCustomer()}><Plus /> Nuevo cliente</button>}{tab === 'facturas' && <button className="primary-button" onClick={() => openInvoiceFor()}><Plus /> Nueva factura</button>}</div>
        {tab === 'productos' && <div className="filter-chips">{([['todos', 'Todos', data.products.length], ['visibles', 'En la tienda', data.products.filter((product) => product.active).length], ['ocultos', 'Ocultos', data.products.filter((product) => !product.active).length], ['bajo', 'Quedan pocos', data.products.filter((product) => product.stock <= 5).length]] as Array<[ProductFilter, string, number]>).map(([value, label, count]) => <button key={value} className={productFilter === value ? 'active' : ''} onClick={() => setProductFilter(value)}>{label} <b>{count}</b></button>)}</div>}
        {tab === 'facturas' && <div className="filter-chips">{([['todas', 'Todas', data.invoices.length], ['pendientes', 'Por cobrar', data.invoices.filter((invoice) => invoice.balanceCents > 0).length], ['vencidas', 'Vencidas', data.invoices.filter((invoice) => invoice.status === 'overdue').length], ['saldadas', 'Saldadas', data.invoices.filter((invoice) => invoice.balanceCents <= 0).length]] as Array<[InvoiceFilter, string, number]>).map(([value, label, count]) => <button key={value} className={invoiceFilter === value ? 'active' : ''} onClick={() => setInvoiceFilter(value)}>{label} <b>{count}</b></button>)}</div>}
        {tab === 'productos' && <div className="data-card"><table><thead><tr><th>Producto</th><th>Código</th><th>Categoría</th><th>Precio</th><th>Inventario</th><th>Estado</th><th /></tr></thead><tbody>{filteredProducts.map((product) => <tr key={product.id}><td><button className="table-product" onClick={() => openProduct(product)}><img src={product.imageUrl || '/product-placeholder.svg'} alt="" /><strong>{product.name}</strong></button></td><td><code>{product.code}</code></td><td>{product.category}</td><td><strong>{currency(product.priceCents)}</strong></td><td><span className={product.stock <= 5 ? 'stock-low' : ''}>{product.stock} unidades</span></td><td><span className={`simple-status ${product.active ? 'ok' : 'off'}`}>{product.active ? 'En la tienda' : 'Oculto'}</span></td><td><div className="row-actions labeled"><button title="Editar" aria-label="Editar" onClick={() => openProduct(product)}><Pencil /><span>Editar</span></button><button title="Reponer" aria-label="Reponer" className="pay-action" onClick={() => restockProduct(product)}><ShoppingBag /><span>Reponer</span></button><button title="Vender" aria-label="Vender" disabled={!product.stock} onClick={() => openInvoiceFor(0, product.id)}><ShoppingCart /><span>Vender</span></button><button title={product.active ? 'Ocultar de la tienda' : 'Mostrar en la tienda'} aria-label={product.active ? 'Ocultar de la tienda' : 'Mostrar en la tienda'} onClick={() => void toggleProduct(product)}>{product.active ? <><EyeOff /><span>Ocultar</span></> : <><Eye /><span>Mostrar</span></>}</button><button title="Mandar a la Papelera" aria-label="Mandar a la Papelera" className="danger-action" onClick={() => void removeProduct(product)}><Trash2 /><span>Borrar</span></button></div></td></tr>)}</tbody></table>{!filteredProducts.length && <Empty message="No hay productos que mostrar." />}</div>}
        {tab === 'clientes' && <div className="customer-grid">{filteredCustomers.map((customer) => <article key={customer.id}><div className="customer-card-top"><span>{customer.name.charAt(0)}</span><div className="row-actions labeled">{whatsappLink(customer.phone) && <a title="Escribir por WhatsApp" aria-label="Escribir por WhatsApp" className="pay-action" href={whatsappLink(customer.phone)} target="_blank" rel="noopener noreferrer"><MessageCircle /><span>WhatsApp</span></a>}<button title="Editar" aria-label="Editar" onClick={() => openCustomer(customer)}><Pencil /><span>Editar</span></button><button title="Mandar a la Papelera" aria-label="Mandar a la Papelera" className="danger-action" onClick={() => void removeCustomer(customer)}><Trash2 /><span>Borrar</span></button></div></div><h3>{customer.name}</h3><p>{customer.phone}</p><small>{customer.email || 'Sin correo registrado'}</small><div><span>Saldo actual</span><strong className={customer.balanceCents ? 'has-debt' : ''}>{currency(customer.balanceCents)}</strong></div><footer><span>{customer.invoiceCount} factura(s)</span><b className={customer.balanceCents ? 'pending-dot' : 'paid-dot'}>{customer.balanceCents ? 'Pendiente' : 'Saldado'}</b></footer><div className="customer-card-actions"><button className="secondary-button" onClick={() => openInvoiceFor(customer.id)}><FilePlus2 /> Nueva factura</button>{customer.invoiceCount > 0 && <button className="secondary-button" onClick={() => setCustomerInvoices(customer)}><ReceiptText /> Sus facturas ({customer.invoiceCount})</button>}</div></article>)}{!filteredCustomers.length && <Empty message="No hay clientes que mostrar." />}</div>}
        {tab === 'facturas' && <div className="data-card"><table><thead><tr><th>Factura</th><th>Cliente</th><th>Fecha</th><th>Total</th><th>Abonado</th><th>Saldo</th><th>Estado</th><th /></tr></thead><tbody>{filteredInvoices.map((invoice) => <tr key={invoice.id}><td><button className="link-button" onClick={() => setSelectedInvoice(invoice)}><code>{invoice.number}</code></button></td><td><strong>{invoice.customerName}</strong><small className="table-subtext">{invoice.customerPhone}</small></td><td>{shortDate(invoice.createdAt)}</td><td><strong>{currency(invoice.totalCents)}</strong></td><td>{currency(invoice.paidCents)}</td><td><strong className={invoice.balanceCents ? 'has-debt' : ''}>{currency(invoice.balanceCents)}</strong></td><td><StatusBadge invoice={invoice} /></td><td><div className="row-actions labeled"><button title="Ver" aria-label="Ver" onClick={() => setSelectedInvoice(invoice)}><Eye /><span>Ver</span></button><button title="Editar notas y fecha" aria-label="Editar notas y fecha" onClick={() => openEditInvoice(invoice)}><Pencil /><span>Editar</span></button><button title="Descargar PDF" aria-label="Descargar PDF" onClick={() => downloadInvoice(invoice)}><Download /><span>PDF</span></button><button title="Compartir" aria-label="Compartir" onClick={() => shareInvoice(invoice)}><Share2 /><span>Compartir</span></button>{invoice.balanceCents > 0 && <button title="Registrar abono" aria-label="Registrar abono" className="pay-action" onClick={() => { setPaymentInvoice(invoice); setPaymentAmount(invoice.balanceCents); setPaymentError('') }}><Banknote /><span>Abonar</span></button>}<button title="Mandar a la Papelera" aria-label="Mandar a la Papelera" className="danger-action" onClick={() => deleteInvoice(invoice)}><Trash2 /><span>Borrar</span></button></div></td></tr>)}</tbody></table>{!filteredInvoices.length && <Empty message="No hay facturas que mostrar." />}</div>}
      </section>}

      {data && tab === 'papelera' && <section className="management-page">
        <p className="trash-intro">Lo que borras se queda aquí {data.trash.days} días. Después se borra solo. Puedes restaurarlo antes.</p>
        {!trashCount && <div className="data-card"><Empty message="La Papelera está vacía." /></div>}
        {data.trash.products.length > 0 && <div className="panel-card trash-group"><div className="panel-title"><div><small>Papelera</small><h2>Productos</h2></div></div>{data.trash.products.map((product) => <TrashRow key={product.id} image={product.imageUrl || '/product-placeholder.svg'} title={product.name} detail={`${product.code} · ${currency(product.priceCents)} · ${product.stock} unidades`} days={daysLeft(product.deletedAt, data.trash.days)} busy={saving} onRestore={() => void restoreItem('products', product.id)} onDelete={() => void deleteForever('products', product.id, product.name)} />)}</div>}
        {data.trash.invoices.length > 0 && <div className="panel-card trash-group"><div className="panel-title"><div><small>Papelera</small><h2>Facturas</h2></div></div><p className="trash-note">Al restaurar una factura, sus productos se vuelven a sacar del inventario.</p>{data.trash.invoices.map((invoice) => <TrashRow key={invoice.id} title={`${invoice.number} · ${invoice.customerName}`} detail={`${shortDate(invoice.createdAt)} · ${currency(invoice.totalCents)} · ${invoice.items.map((item) => `${item.quantity}× ${item.productName}`).join(', ')}`} days={daysLeft(invoice.deletedAt, data.trash.days)} busy={saving} onRestore={() => void restoreItem('invoices', invoice.id)} onDelete={() => void deleteForever('invoices', invoice.id, invoice.number)} />)}</div>}
        {data.trash.customers.length > 0 && <div className="panel-card trash-group"><div className="panel-title"><div><small>Papelera</small><h2>Clientes</h2></div></div>{data.trash.customers.map((customer) => <TrashRow key={customer.id} title={customer.name} detail={`${customer.phone}${customer.email ? ` · ${customer.email}` : ''}`} days={daysLeft(customer.deletedAt, data.trash.days)} busy={saving} onRestore={() => void restoreItem('customers', customer.id)} onDelete={() => void deleteForever('customers', customer.id, customer.name)} />)}</div>}
      </section>}

      {tab === 'app' && <section className="management-page"><AppAndNotifications /></section>}

      {tab === 'contenido' && <section className="management-page content-page">
        <form className="content-form" onSubmit={saveContent}>
          <div className="content-sections">
            {CONTENT_FIELD_GROUPS.map((group) => (
              <div className="panel-card" key={group.id}>
                <div className="panel-title"><div><small>Contenido del sitio</small><h2>{group.title}</h2></div></div>
                <div className="form-grid">
                  {group.fields.map((field) => (
                    field.type === 'image'
                      ? <ContentImageField key={field.key} label={field.label} value={contentDraft[field.key] ?? ''} onChange={(value) => setContentDraft((draft) => ({ ...draft, [field.key]: value }))} onError={setNotice} />
                      : <label className={field.type === 'textarea' ? 'full-field' : ''} key={field.key}>
                          {field.label}
                          {field.type === 'textarea'
                            ? <textarea disabled={contentLoading} value={contentDraft[field.key] ?? ''} onChange={(event) => setContentDraft({ ...contentDraft, [field.key]: event.target.value })} />
                            : <input disabled={contentLoading} value={contentDraft[field.key] ?? ''} onChange={(event) => setContentDraft({ ...contentDraft, [field.key]: event.target.value })} />}
                        </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="content-save-bar">
            <span>{contentChanged ? 'Tienes cambios sin guardar.' : 'No hay cambios pendientes.'}</span>
            <button className="primary-button" disabled={contentSaving || contentLoading || !contentChanged}>{contentSaving ? 'Guardando…' : 'Guardar cambios'}</button>
          </div>
        </form>
      </section>}
    </section>

    {productModal && <AdminModal error={modalError} title={editingProduct ? 'Editar producto' : productDraft.name.endsWith('(copia)') ? 'Duplicar producto' : 'Agregar producto'} subtitle="El código identifica cada artículo en inventario." onClose={() => setProductModal(false)}><form onSubmit={saveProduct} className="admin-form"><div className="form-grid"><label>Código del producto <small>(si lo dejas vacío, se crea solo)</small><input value={productDraft.code} onChange={(event) => setProductDraft({ ...productDraft, code: event.target.value.toUpperCase() })} placeholder="CH-005" /></label><label>Nombre<input required value={productDraft.name} onChange={(event) => setProductDraft({ ...productDraft, name: event.target.value })} /></label><label>Categoría<input required list="aura-categories" value={productDraft.category} onChange={(event) => setProductDraft({ ...productDraft, category: event.target.value })} /><datalist id="aura-categories">{categoryOptions.map((option) => <option key={option} value={option} />)}</datalist></label><label>Precio (RD$)<input required type="number" min="1" step="any" inputMode="decimal" value={productDraft.priceCents / 100 || ''} onChange={(event) => setProductDraft({ ...productDraft, priceCents: Math.round(Number(event.target.value) * 100) })} /></label><label>Existencias (unidades)<input required type="number" min="0" inputMode="numeric" value={productDraft.stock} onChange={(event) => setProductDraft({ ...productDraft, stock: Math.max(0, Math.trunc(Number(event.target.value))) })} /></label><GalleryField images={productDraft.images} uploading={uploadingImage} onChange={setImages} onFiles={(files) => void handleImageFiles(files)} /><label className="full-field">Descripción<textarea value={productDraft.description} onChange={(event) => setProductDraft({ ...productDraft, description: event.target.value })} /></label></div><div className="check-row"><label><input type="checkbox" checked={productDraft.featured} onChange={(event) => setProductDraft({ ...productDraft, featured: event.target.checked })} /> Destacar en la tienda</label><label><input type="checkbox" checked={productDraft.active} onChange={(event) => setProductDraft({ ...productDraft, active: event.target.checked })} /> Mostrar en la tienda</label></div><button className="primary-button full" disabled={saving}>{saving ? 'Guardando…' : 'Guardar producto'}</button>{editingProduct && <button type="button" className="text-button copy-button" onClick={() => openProduct(editingProduct, true)}><Copy size={15} /> Hacer una copia de este producto (para otro tamaño o color)</button>}</form></AdminModal>}
    {customerModal && <AdminModal error={modalError} title={editingCustomer ? 'Editar cliente' : 'Registrar cliente'} subtitle="Guarda sus datos para facturar y consultar saldos." onClose={() => setCustomerModal(false)}><form onSubmit={saveCustomer} className="admin-form"><div className="form-grid"><label>Nombre completo<input required value={customerDraft.name} onChange={(event) => setCustomerDraft({ ...customerDraft, name: event.target.value })} /></label><label>Teléfono<input required value={customerDraft.phone} onChange={(event) => setCustomerDraft({ ...customerDraft, phone: event.target.value })} /></label><label>Correo<input type="email" value={customerDraft.email} onChange={(event) => setCustomerDraft({ ...customerDraft, email: event.target.value })} /></label><label>Dirección<input value={customerDraft.address} onChange={(event) => setCustomerDraft({ ...customerDraft, address: event.target.value })} /></label><label className="full-field">Notas<textarea value={customerDraft.notes} onChange={(event) => setCustomerDraft({ ...customerDraft, notes: event.target.value })} /></label></div><button className="primary-button full" disabled={saving}>{saving ? 'Guardando…' : 'Guardar cliente'}</button></form></AdminModal>}
    {invoiceModal && data && <AdminModal error={modalError} title="Nueva factura" subtitle="Selecciona el cliente, agrega productos y registra el pago inicial." onClose={() => setInvoiceModal(false)} wide><form onSubmit={createInvoice} className="admin-form"><label>Cliente<select required value={invoiceCustomerId || ''} onChange={(event) => setInvoiceCustomerId(Number(event.target.value))}><option value="">Selecciona un cliente</option><option value="-1">+ Cliente nuevo</option>{data.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.phone}</option>)}</select></label>{invoiceCustomerId === -1 && <div className="form-grid new-customer-box"><label>Nombre del cliente<input required value={newCustomer.name} onChange={(event) => setNewCustomer({ ...newCustomer, name: event.target.value })} placeholder="Ej.: María Pérez" /></label><label>Teléfono<input required type="tel" inputMode="tel" value={newCustomer.phone} onChange={(event) => setNewCustomer({ ...newCustomer, phone: event.target.value })} placeholder="809 555 1234" /></label></div>}<div className="invoice-builder"><div className="builder-title"><strong>Productos</strong><button type="button" onClick={() => setInvoiceLines([...invoiceLines, { productId: 0, quantity: 1 }])}><Plus /> Agregar otro producto</button></div>{invoiceLines.map((line, index) => <div className="invoice-line" key={index}><select required value={line.productId || ''} onChange={(event) => setInvoiceLines(invoiceLines.map((item, itemIndex) => itemIndex === index ? { ...item, productId: Number(event.target.value) } : item))}><option value="">Selecciona un producto</option>{data.products.filter((product) => product.stock > 0 || product.id === line.productId).map((product) => <option value={product.id} key={product.id}>{product.name} · {currency(product.priceCents)} · hay {product.stock}{product.active ? '' : ' (oculto)'}</option>)}</select><input type="number" min="1" inputMode="numeric" aria-label="Cantidad" value={line.quantity || ''} onChange={(event) => setInvoiceLines(invoiceLines.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: Math.max(0, Math.trunc(Number(event.target.value))) } : item))} onBlur={() => { if (line.quantity < 1) setInvoiceLines(invoiceLines.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: 1 } : item)) }} /><strong>{currency((data.products.find((product) => product.id === line.productId)?.priceCents || 0) * line.quantity)}</strong><button type="button" aria-label="Quitar este producto" title="Quitar este producto" disabled={invoiceLines.length === 1} onClick={() => setInvoiceLines(invoiceLines.filter((_, itemIndex) => itemIndex !== index))}><Trash2 /></button>{line.productId > 0 && line.quantity > (data.products.find((product) => product.id === line.productId)?.stock ?? 0) && <small className="line-warning">Solo hay {data.products.find((product) => product.id === line.productId)?.stock} unidades.</small>}</div>)}</div><div className="form-grid"><label>Descuento (RD$)<input type="number" min="0" step="any" inputMode="decimal" max={invoiceSubtotal / 100} value={invoiceDiscount / 100 || ''} onChange={(event) => setInvoiceDiscount(Math.min(invoiceSubtotal, Math.max(0, Math.round(Number(event.target.value) * 100))))} /></label><label>Pago inicial (RD$)<span className="label-row"><input type="number" min="0" step="any" inputMode="decimal" max={invoiceDraftTotal / 100} value={invoicePaid / 100 || ''} onChange={(event) => setInvoicePaid(Math.min(invoiceDraftTotal, Math.max(0, Math.round(Number(event.target.value) * 100))))} /><button type="button" className="mini-button" onClick={() => setInvoicePaid(invoiceDraftTotal)}>Pagó todo</button></span></label>{invoicePaid > 0 && <label>¿Cómo pagó?<select value={invoiceMethod} onChange={(event) => setInvoiceMethod(event.target.value)}><option>Efectivo</option><option>Transferencia</option><option>Tarjeta</option><option>Otro</option></select></label>}<label>Fecha límite de pago<input type="date" value={invoiceDueDate} onChange={(event) => setInvoiceDueDate(event.target.value)} /></label><label className="full-field">Notas (opcional)<textarea value={invoiceNotes} onChange={(event) => setInvoiceNotes(event.target.value)} placeholder="Ej.: entregar el sábado" /></label></div><div className="invoice-draft-total">{invoiceDiscount > 0 && <small>Subtotal {currency(invoiceSubtotal)} − descuento {currency(invoiceDiscount)}</small>}<span>Total de factura</span><strong>{currency(invoiceDraftTotal)}</strong></div><button className="primary-button full" disabled={saving || !invoiceSubtotal}>{saving ? 'Creando factura…' : 'Crear factura'}</button></form></AdminModal>}
    {paymentInvoice && <AdminModal error={modalError} title="Registrar abono" subtitle={`${paymentInvoice.number} · ${paymentInvoice.customerName}`} onClose={() => setPaymentInvoice(null)}><form onSubmit={registerPayment} className="admin-form"><div className="balance-highlight"><span>Saldo pendiente</span><strong>{currency(paymentInvoice.balanceCents)}</strong></div><label>Monto recibido (RD$)<span className="label-row"><input required type="number" min="1" step="any" inputMode="decimal" max={paymentInvoice.balanceCents / 100} value={paymentAmount / 100 || ''} onChange={(event) => setPaymentAmount(Math.min(paymentInvoice.balanceCents, Math.max(0, Math.round(Number(event.target.value) * 100))))} /><button type="button" className="mini-button" onClick={() => setPaymentAmount(paymentInvoice.balanceCents)}>Pagó todo</button></span></label><label>Método de pago<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option>Efectivo</option><option>Transferencia</option><option>Tarjeta</option><option>Otro</option></select></label>{paymentError && <p className="form-error">{paymentError}</p>}<button className="primary-button full" disabled={saving}>{saving ? 'Registrando…' : 'Confirmar abono'}</button></form></AdminModal>}
    {selectedInvoice && <AdminModal error={modalError} title={selectedInvoice.number} subtitle={`${selectedInvoice.customerName} · ${shortDate(selectedInvoice.createdAt)}`} onClose={() => setSelectedInvoice(null)} wide><div className="invoice-detail"><div className="invoice-detail-summary"><div><span>Total</span><strong>{currency(selectedInvoice.totalCents)}</strong></div><div><span>Abonado</span><strong>{currency(selectedInvoice.paidCents)}</strong></div><div><span>Saldo</span><strong className={selectedInvoice.balanceCents ? 'has-debt' : ''}>{currency(selectedInvoice.balanceCents)}</strong></div><StatusBadge invoice={selectedInvoice} /></div><div className="detail-lines">{selectedInvoice.items.map((item) => <div key={item.id}><span><strong>{item.productName}</strong><small>{item.productCode} · {item.quantity} × {currency(item.unitPriceCents)}</small></span><b>{currency(item.totalCents)}</b></div>)}</div>{selectedInvoice.payments.length > 0 && <div className="payment-history"><h3>Historial de pagos</h3>{selectedInvoice.payments.map((payment) => <div key={payment.id}><span><strong>{payment.method}</strong><small>{shortDate(payment.createdAt)}</small></span><b>{currency(payment.amountCents)}</b></div>)}</div>}{selectedInvoice.balanceCents > 0 && <button className="primary-button full" onClick={() => { setPaymentInvoice(selectedInvoice); setPaymentAmount(selectedInvoice.balanceCents); setPaymentError(''); setSelectedInvoice(null) }}>Registrar abono</button>}{selectedInvoice.notes && <p className="invoice-notes">{selectedInvoice.notes}</p>}<div className="detail-actions"><button className="secondary-button full" onClick={() => openEditInvoice(selectedInvoice)}><Pencil /> Editar notas y fecha</button><a className="secondary-button full" href={whatsappLink(selectedInvoice.customerPhone, buildInvoiceText(selectedInvoice)) || whatsappShareLink(buildInvoiceText(selectedInvoice))} target="_blank" rel="noopener noreferrer"><MessageCircle /> Enviar por WhatsApp{whatsappLink(selectedInvoice.customerPhone) ? ` a ${selectedInvoice.customerName}` : ''}</a><button className="secondary-button full" onClick={() => downloadInvoice(selectedInvoice)}><Download /> Descargar PDF</button><button className="secondary-button full" onClick={() => shareInvoice(selectedInvoice)}><Share2 /> Compartir</button><button className="danger-button full" onClick={() => deleteInvoice(selectedInvoice)}><Trash2 /> Mandar a la Papelera</button></div></div></AdminModal>}
    {customerInvoices && data && <AdminModal error={modalError} title={`Facturas de ${customerInvoices.name}`} subtitle={`${customerInvoices.phone} · saldo ${currency(data.invoices.filter((invoice) => invoice.customerId === customerInvoices.id).reduce((sum, invoice) => sum + invoice.balanceCents, 0))}`} onClose={() => setCustomerInvoices(null)} wide><div className="customer-invoices">
      {data.invoices.filter((invoice) => invoice.customerId === customerInvoices.id).map((invoice) => {
        const wa = whatsappLink(customerInvoices.phone, buildInvoiceText(invoice)) || whatsappShareLink(buildInvoiceText(invoice))
        return <div className="customer-invoice" key={invoice.id}>
          <div className="customer-invoice-top"><span><strong>{invoice.number}</strong><small>{shortDate(invoice.createdAt)} · {invoice.items.map((item) => `${item.quantity}× ${item.productName}`).join(', ')}</small></span><span className="customer-invoice-total"><b>{currency(invoice.totalCents)}</b>{invoice.balanceCents > 0 ? <small className="has-debt">Debe {currency(invoice.balanceCents)}</small> : <small>Pagada</small>}</span></div>
          <div className="row-actions labeled">
            <button onClick={() => { setCustomerInvoices(null); setSelectedInvoice(invoice) }}><Eye /><span>Ver</span></button>
            <button onClick={() => void downloadInvoice(invoice)}><Download /><span>Descargar</span></button>
            <button onClick={() => void shareInvoice(invoice)}><Share2 /><span>Compartir</span></button>
            <a className="pay-action" href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle /><span>WhatsApp</span></a>
            {invoice.balanceCents > 0 && <button className="pay-action" onClick={() => { setCustomerInvoices(null); setPaymentInvoice(invoice); setPaymentAmount(invoice.balanceCents); setPaymentError('') }}><Banknote /><span>Abonar</span></button>}
          </div>
        </div>
      })}
      <button className="secondary-button full" onClick={() => { const id = customerInvoices.id; setCustomerInvoices(null); openInvoiceFor(id) }}><FilePlus2 /> Nueva factura para {customerInvoices.name}</button>
    </div></AdminModal>}
    {restock && data && (() => {
      const product = data.products.find((item) => item.id === restock.productId)
      const after = product ? Math.max(0, product.stock + (restock.mode === 'sumar' ? restock.quantity : -restock.quantity)) : 0
      return <AdminModal error={modalError} title="Reponer" subtitle="Suma las unidades que llegaron, o resta las que se dañaron o se perdieron." onClose={() => setRestock(null)}><form onSubmit={saveRestock} className="admin-form restock-form">
        <label>Producto<select value={restock.productId} onChange={(event) => setRestock({ ...restock, productId: Number(event.target.value) })}>{data.products.map((item) => <option key={item.id} value={item.id}>{item.name} (hay {item.stock})</option>)}</select></label>
        <div className="restock-mode">
          <button type="button" className={restock.mode === 'sumar' ? 'active' : ''} onClick={() => setRestock({ ...restock, mode: 'sumar' })}><Plus size={16} /> Llegaron</button>
          <button type="button" className={restock.mode === 'restar' ? 'active danger' : ''} onClick={() => setRestock({ ...restock, mode: 'restar' })}><Trash2 size={16} /> Se dañaron o perdieron</button>
        </div>
        <label>{restock.mode === 'sumar' ? '¿Cuántas llegaron?' : '¿Cuántas se dañaron o perdieron?'}
          <div className="restock-qty">
            <button type="button" aria-label="Una menos" onClick={() => setRestock({ ...restock, quantity: Math.max(1, restock.quantity - 1) })}>−</button>
            <input type="number" inputMode="numeric" min={1} max={restock.mode === 'restar' ? product?.stock : 10000} value={restock.quantity || ''} onChange={(event) => setRestock({ ...restock, quantity: Math.max(0, Math.trunc(Number(event.target.value))) })} />
            <button type="button" aria-label="Una más" onClick={() => setRestock({ ...restock, quantity: restock.quantity + 1 })}>+</button>
          </div>
        </label>
        {restock.mode === 'sumar' && <div className="restock-quick">{[5, 10, 12, 24].map((amount) => <button type="button" key={amount} onClick={() => setRestock({ ...restock, quantity: amount })}>{amount}</button>)}</div>}
        {product && <div className="restock-summary"><span>Ahora hay <b>{product.stock}</b></span><span>→</span><span>Quedarán <b>{after}</b></span></div>}
        <button className="primary-button full" disabled={saving || !restock.quantity || (restock.mode === 'restar' && !product?.stock)}>{saving ? 'Guardando…' : restock.mode === 'sumar' ? `Sumar ${restock.quantity || 0} unidades` : `Restar ${restock.quantity || 0} unidades`}</button>
      </form></AdminModal>
    })()}
    {editInvoice && <AdminModal error={modalError} title={`Editar ${editInvoice.number}`} subtitle={editInvoice.customerName} onClose={() => setEditInvoice(null)}><form onSubmit={saveEditInvoice} className="admin-form"><label>Fecha límite de pago<input type="date" value={editInvoiceDue} onChange={(event) => setEditInvoiceDue(event.target.value)} /></label><label>Notas<textarea rows={6} value={editInvoiceNotes} onChange={(event) => setEditInvoiceNotes(event.target.value)} /></label><p className="trash-note">Para cambiar productos o precios, manda esta factura a la Papelera (los productos vuelven al inventario) y crea una nueva.</p><button className="primary-button full" disabled={saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</button></form></AdminModal>}
    {confirmState && <div className="modal-layer confirm-layer" role="alertdialog" aria-modal="true"><button className="modal-backdrop" aria-label="Cancelar" onClick={() => closeConfirm(false)} /><section className="admin-modal confirm-modal"><p>{confirmState.message}</p><div className="confirm-actions"><button className="secondary-button" onClick={() => closeConfirm(false)}>Cancelar</button><button className={confirmState.danger ? 'danger-button' : 'primary-button'} onClick={() => closeConfirm(true)}>{confirmState.okLabel}</button></div></section></div>}
  </main>
}

function TrashRow({ image, title, detail, days, busy, onRestore, onDelete }: { image?: string; title: string; detail: string; days: number; busy: boolean; onRestore: () => void; onDelete: () => void }) {
  return <div className="trash-row">
    {image && <img src={image} alt="" />}
    <div><strong>{title}</strong><small>{detail}</small><em className={days <= 7 ? 'soon' : ''}>{days === 1 ? 'Se borra mañana' : days === 0 ? 'Se borra hoy' : `Se borra en ${days} días`}</em></div>
    <div className="trash-actions"><button className="secondary-button" disabled={busy} onClick={onRestore}><RotateCcw /> Restaurar</button><button className="danger-button" disabled={busy} onClick={onDelete}><Trash2 /> Borrar</button></div>
  </div>
}

function StatusBadge({ invoice }: { invoice: Invoice }) {
  const status = invoice.balanceCents <= 0 ? 'paid' : invoice.status === 'overdue' ? 'overdue' : invoice.paidCents > 0 ? 'partial' : 'pending'
  return <span className={`status-badge ${status}`}>{status === 'paid' ? 'Saldada' : status === 'partial' ? 'Abonada' : status === 'overdue' ? 'Vencida' : 'Pendiente'}</span>
}

function GalleryField({ images, uploading, onChange, onFiles }: { images: string[]; uploading: boolean; onChange: (images: string[]) => void; onFiles: (files: File[]) => void }) {
  const [link, setLink] = useState('')
  const move = (index: number, delta: number) => {
    const next = [...images]
    const [item] = next.splice(index, 1)
    next.splice(Math.max(0, Math.min(next.length, index + delta)), 0, item)
    onChange(next)
  }
  const addLink = () => {
    const url = link.trim()
    if (!/^https?:\/\//i.test(url) || images.includes(url) || images.length >= MAX_PHOTOS) return
    onChange([...images, url])
    setLink('')
  }
  return <div className="full-field gallery-field">
    <span className="gallery-title">Fotos del producto <small>({images.length} de {MAX_PHOTOS}) · la primera es la principal</small></span>
    {images.length > 0 && <div className="gallery-grid">
      {images.map((url, index) => <div className={`gallery-item ${index === 0 ? 'main' : ''}`} key={url}>
        <img src={url} alt={`Foto ${index + 1}`} />
        {index === 0 && <span className="gallery-main">Principal</span>}
        <div className="gallery-actions">
          {index > 0 && <button type="button" className="make-main" onClick={() => move(index, -index)}>★ Hacer principal</button>}
          {index > 0 && <button type="button" onClick={() => move(index, -1)} aria-label="Mover a la izquierda">←</button>}
          {index < images.length - 1 && <button type="button" onClick={() => move(index, 1)} aria-label="Mover a la derecha">→</button>}
          <button type="button" className="danger" onClick={() => onChange(images.filter((_, itemIndex) => itemIndex !== index))}>Quitar</button>
        </div>
      </div>)}
    </div>}
    <label className={`gallery-add ${uploading || images.length >= MAX_PHOTOS ? 'disabled' : ''}`}>
      <Plus size={16} /> {uploading ? 'Subiendo fotos…' : images.length ? 'Agregar más fotos' : 'Agregar fotos'}
      <input type="file" accept="image/*" multiple disabled={uploading || images.length >= MAX_PHOTOS} onChange={(event) => { const files = [...(event.target.files || [])]; if (files.length) onFiles(files); event.target.value = '' }} />
    </label>
    <div className="gallery-link"><input value={link} onChange={(event) => setLink(event.target.value)} placeholder="O pega el enlace de una foto (https://…)" /><button type="button" className="mini-button" onClick={addLink} disabled={!link.trim()}>Agregar</button></div>
  </div>
}

/** Achica las fotos grandes del teléfono antes de subirlas (máximo 1600 px). */
async function imageToDataUrl(file: File): Promise<string> {
  const original = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('No se pudo leer la foto.'))
    reader.readAsDataURL(file)
  })
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return original
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = original })
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height))
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) return original
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(image.width * scale)
    canvas.height = Math.round(image.height * scale)
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.85)
  } catch {
    return original
  }
}

function ContentImageField({ label, value, onChange, onError }: { label: string; value: string; onChange: (value: string) => void; onError: (message: string) => void }) {
  const [mode, setMode] = useState<'url' | 'file'>('file')
  const [uploading, setUploading] = useState(false)

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) { onError('El archivo debe ser una imagen.'); return }
    if (file.size > 8 * 1024 * 1024) { onError('La imagen no puede superar 8 MB.'); return }
    setUploading(true)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('No se pudo leer el archivo.'))
        reader.readAsDataURL(file)
      })
      const result = await api<{ url: string }>('/api/upload', { method: 'POST', body: JSON.stringify({ filename: file.name, dataUrl }) })
      onChange(result.url)
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'No pudimos subir la imagen.')
    } finally {
      setUploading(false)
    }
  }

  return <label className="full-field image-field">
    {label}
    <div className="image-mode-toggle">
      <button type="button" className={mode === 'url' ? 'active' : ''} onClick={() => setMode('url')}>Usar URL</button>
      <button type="button" className={mode === 'file' ? 'active' : ''} onClick={() => setMode('file')}>Subir desde el dispositivo</button>
    </div>
    {mode === 'url'
      ? <input value={value} onChange={(event) => onChange(event.target.value)} placeholder="https://…" />
      : <div className="image-upload-row">
          <input type="file" accept="image/*" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleFile(file); event.target.value = '' }} />
          {uploading && <span className="image-upload-status">Subiendo…</span>}
        </div>}
    {value && <img className="image-field-preview" src={value} alt="Vista previa" />}
  </label>
}

function Empty({ message }: { message: string }) {
  return <div className="table-empty"><ReceiptText /><p>{message}</p></div>
}

function AdminModal({ title, subtitle, onClose, wide = false, error = '', children }: { title: string; subtitle: string; onClose: () => void; wide?: boolean; error?: string; children: ReactNode }) {
  return <div className="modal-layer"><button className="modal-backdrop" aria-label="Cerrar" onClick={onClose} /><section className={`admin-modal ${wide ? 'wide' : ''}`}><header><div><small>Aura Beauty</small><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button" aria-label="Cerrar" onClick={onClose}><X /></button></header>{error && <p className="form-error modal-error" role="alert">{error}</p>}{children}</section></div>
}
