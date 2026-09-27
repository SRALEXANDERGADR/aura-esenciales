import { jsPDF } from 'jspdf'
import { Link } from '@tanstack/react-router'
import {
  ArrowLeft,
  Banknote,
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
import type { Customer, DashboardData, Invoice, Product, SiteContent } from '@/types'

type Tab = 'resumen' | 'productos' | 'clientes' | 'facturas' | 'contenido' | 'papelera'
type ProductFilter = 'todos' | 'visibles' | 'ocultos' | 'bajo'
type InvoiceFilter = 'todas' | 'pendientes' | 'vencidas' | 'saldadas'
type ProductDraft = Omit<Product, 'id'>
type CustomerDraft = Pick<Customer, 'name' | 'phone' | 'email' | 'address' | 'notes'>
type InvoiceLine = { productId: number; quantity: number }

const emptyProduct: ProductDraft = { code: '', name: '', category: 'Cabello', description: '', priceCents: 0, stock: 0, imageUrl: '', featured: false, active: true }
const emptyCustomer: CustomerDraft = { name: '', phone: '', email: '', address: '', notes: '' }

const TAB_TITLES: Record<Tab, string> = { resumen: '', productos: 'Productos', clientes: 'Clientes', facturas: 'Facturas', contenido: 'Textos de la tienda', papelera: 'Papelera' }

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

const whatsappLink = (phone: string, message = '') => {
  let digits = phone.replace(/\D/g, '')
  if (digits.length === 10) digits = `1${digits}`
  return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ''}`
}

function GadrCredit() {
  return <a className="gadr-credit" href="https://gadrnet.com" target="_blank" rel="noopener noreferrer"><span className="gadr-credit-text">Diseño y desarrollo: GADR Net | gadrnet.com</span><span className="gadr-mark" aria-hidden="true"><span className="gadr-mark-icon">&lt;/&gt;<i></i></span><span className="gadr-mark-word">GADR<small>Net</small></span></span></a>
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
  const [editInvoiceNotes, setEditInvoiceNotes] = useState('')
  const [editInvoiceDue, setEditInvoiceDue] = useState('')
  const [invoiceDiscount, setInvoiceDiscount] = useState(0)
  const [invoiceNotes, setInvoiceNotes] = useState('')
  const [invoiceMethod, setInvoiceMethod] = useState('Efectivo')
  const [notice, setNotice] = useState('')
  const [productModal, setProductModal] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [productDraft, setProductDraft] = useState<ProductDraft>(emptyProduct)
  const [imageMode, setImageMode] = useState<'url' | 'file'>('url')
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

  onSessionExpired = () => { setAuthenticated(false); setData(null); setAuthError('Tu sesión terminó. Vuelve a entrar.') }

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    try {
      setData(await api<DashboardData>('/api/dashboard'))
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'No pudimos cargar el panel.')
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
      setNotice(caught instanceof Error ? caught.message : 'No pudimos cargar el contenido del sitio.')
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
    if (authenticated) {
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
      setNotice(caught instanceof Error ? caught.message : 'No pudimos guardar el contenido.')
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

  const goTo = (next: Tab) => {
    if (tab === 'contenido' && next !== 'contenido' && contentChanged && !window.confirm('Tienes cambios sin guardar en los textos. ¿Salir sin guardar?')) return
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
      setNotice(caught instanceof Error ? caught.message : 'No pudimos completar la operación.')
      return false
    } finally {
      setSaving(false)
    }
  }

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault()
    setAuthLoading(true)
    setAuthError('')
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) })
      setPassword('')
      setAuthenticated(true)
    } catch (caught) {
      setAuthError(caught instanceof ApiError && caught.status === 401 ? 'Contraseña incorrecta. Verifica tus datos.' : caught instanceof Error ? caught.message : 'No pudimos entrar.')
    } finally {
      setAuthLoading(false)
    }
  }

  const signOut = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {})
    setAuthenticated(false)
    setData(null)
  }

  const openProduct = (product?: Product, duplicate = false) => {
    setEditingProduct(product && !duplicate ? product : null)
    setProductDraft(product ? { code: product.code, name: product.name, category: product.category, description: product.description, priceCents: product.priceCents, stock: product.stock, imageUrl: product.imageUrl, featured: product.featured, active: product.active } : emptyProduct)
    if (product && duplicate) setProductDraft({ code: '', name: `${product.name} (copia)`, category: product.category, description: product.description, priceCents: product.priceCents, stock: 0, imageUrl: product.imageUrl, featured: false, active: product.active })
    setImageMode('file')
    setProductModal(true)
  }

  const handleImageFile = async (file: File) => {
    if (!file.type.startsWith('image/')) { setNotice('El archivo debe ser una imagen.'); return }
    if (file.size > 8 * 1024 * 1024) { setNotice('La imagen no puede superar 8 MB.'); return }
    setUploadingImage(true)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
      })
      const result = await api<{ url: string }>('/api/upload', { method: 'POST', body: JSON.stringify({ filename: file.name, dataUrl }) })
      setProductDraft((draft) => ({ ...draft, imageUrl: result.url }))
      setNotice('Imagen subida correctamente.')
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'No pudimos subir la imagen.')
    } finally {
      setUploadingImage(false)
    }
  }

  const saveProduct = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await api(editingProduct ? `/api/products/${editingProduct.id}` : '/api/products', { method: editingProduct ? 'PATCH' : 'POST', body: JSON.stringify(productDraft) })
      setProductModal(false)
      setNotice(editingProduct ? 'Producto actualizado.' : 'Producto agregado al catálogo.')
      await loadDashboard()
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'No pudimos guardar el producto.')
    } finally {
      setSaving(false)
    }
  }

  const removeProduct = async (product: Product) => {
    if (!window.confirm(`¿Mandar «${product.name}» a la Papelera? Sale de la tienda. Puedes restaurarlo durante 60 días.`)) return
    await run(() => api(`/api/products/${product.id}`, { method: 'DELETE' }), 'Producto enviado a la Papelera.')
  }

  const toggleProduct = (product: Product) => run(() => api(`/api/products/${product.id}/visible`, { method: 'POST', body: JSON.stringify({ active: !product.active }) }), product.active ? `«${product.name}» ya no sale en la tienda.` : `«${product.name}» ya sale en la tienda.`)

  const restockProduct = async (product: Product) => {
    const answer = window.prompt(`¿Cuántas unidades de «${product.name}» llegaron?\n(Ahora hay ${product.stock}. Para restar, escribe un número con menos, por ejemplo -2)`)
    if (answer === null) return
    const delta = Math.trunc(Number(answer.replace(',', '.')))
    if (!delta) { setNotice('Escribe un número de unidades.'); return }
    await run(() => api(`/api/products/${product.id}/stock`, { method: 'POST', body: JSON.stringify({ delta }) }), `Inventario actualizado: ${Math.max(0, product.stock + delta)} unidades de «${product.name}».`)
  }

  const removeCustomer = async (customer: Customer) => {
    if (!window.confirm(`¿Mandar a ${customer.name} a la Papelera? Sus facturas no se borran. Puedes restaurarlo durante 60 días.`)) return
    await run(() => api(`/api/customers/${customer.id}`, { method: 'DELETE' }), 'Cliente enviado a la Papelera.')
  }

  const restoreItem = (kind: 'products' | 'customers' | 'invoices', id: number) => run(() => api(`/api/${kind}/${id}/restore`, { method: 'POST' }), 'Restaurado.')

  const deleteForever = async (kind: 'products' | 'customers' | 'invoices', id: number, label: string) => {
    if (!window.confirm(`¿Borrar «${label}» para siempre? Esto no se puede deshacer.`)) return
    await run(() => api(`/api/${kind}/${id}/forever`, { method: 'DELETE' }), 'Borrado para siempre.')
  }

  const openInvoiceFor = (customerId = 0) => {
    setInvoiceCustomerId(customerId)
    setInvoiceLines([{ productId: 0, quantity: 1 }])
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
    setEditInvoiceDue(invoice.dueDate ? invoice.dueDate.slice(0, 10) : '')
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
      setNotice(caught instanceof Error ? caught.message : 'No pudimos guardar el cliente.')
    } finally {
      setSaving(false)
    }
  }

  const createInvoice = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await api('/api/invoices', { method: 'POST', body: JSON.stringify({ customerId: invoiceCustomerId, items: invoiceLines.filter((line) => line.productId), paidCents: invoicePaid, discountCents: invoiceDiscount, notes: invoiceNotes, method: invoiceMethod, dueDate: invoiceDueDate || null }) })
      setInvoiceModal(false)
      setNotice('Factura creada y existencias actualizadas.')
      await loadDashboard()
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'No pudimos crear la factura.')
    } finally {
      setSaving(false)
    }
  }

  const deleteInvoice = async (invoice: Invoice) => {
    if (!window.confirm(`¿Mandar la factura ${invoice.number} de ${invoice.customerName} a la Papelera? Los productos vuelven al inventario. Puedes restaurarla durante 60 días.`)) return
    setSaving(true)
    try {
      await api(`/api/invoices/${invoice.id}`, { method: 'DELETE' })
      setSelectedInvoice(null)
      setNotice('Factura enviada a la Papelera. Los productos volvieron al inventario.')
      await loadDashboard()
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'No pudimos eliminar la factura.')
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
    try {
      const doc = await buildInvoicePdf(invoice)
      doc.save(`${invoice.number}.pdf`)
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'No pudimos generar el PDF.')
    }
  }

  const shareInvoice = async (invoice: Invoice) => {
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
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
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
      setNotice(message)
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
    <section className="login-form-wrap"><form className="login-form" onSubmit={handleLogin}><span className="login-icon"><ClipboardList /></span><small>Acceso privado</small><h2>Bienvenida de nuevo</h2><p>Ingresa con la contraseña autorizada para administrar la tienda.</p><label>Contraseña<input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" /></label>{authError && <p className="form-error">{authError}</p>}<button className="primary-button full" disabled={authLoading}>{authLoading ? 'Entrando…' : 'Entrar al panel'} <ArrowLeft className="rotate-180" size={18} /></button><div className="security-note"><Check size={15} /> Acceso protegido por sesión firmada</div><div className="admin-credit"><GadrCredit /></div></form></section>
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
      </nav>
      <div className="sidebar-footer"><Link to="/"><ShoppingBag /> Ver tienda</Link><button onClick={signOut}><LogOut /> Cerrar sesión</button><div><span>A</span><p><strong>Administración</strong><small>Aura Beauty</small></p></div><div className="admin-credit"><GadrCredit /></div></div>
    </aside>
    <section className="admin-main">
      <header className="admin-header"><div><span className="eyebrow">Panel de control</span><h1>{tab === 'resumen' ? greeting() : TAB_TITLES[tab]}</h1></div><div className="mobile-top-actions"><Link to="/"><ShoppingBag size={16} /> Ver tienda</Link><button onClick={signOut}><LogOut size={16} /> Salir</button></div><div className="admin-date"><span>{new Intl.DateTimeFormat('es-DO', { weekday: 'long' }).format(new Date())}</span><strong>{new Intl.DateTimeFormat('es-DO', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date())}</strong></div></header>
      {notice && <button className="notice" onClick={() => setNotice('')}><Check /> {notice}<X /></button>}
      {loading && !data ? <div className="dashboard-skeleton"><div /><div /><div /><div /></div> : null}

      {data && tab === 'resumen' && <>
        <section className="metric-grid">
          <article className="metric-card accent"><span><TrendingUp /></span><small>Ventas registradas</small><strong>{currency(data.metrics.salesCents)}</strong><p>Histórico de facturación</p></article>
          <article className="metric-card"><span><WalletCards /></span><small>Por cobrar</small><strong>{currency(data.metrics.receivableCents)}</strong><p>{data.invoices.filter((invoice) => invoice.balanceCents > 0).length} facturas pendientes</p></article>
          <article className="metric-card"><span><CircleDollarSign /></span><small>Facturas saldadas</small><strong>{data.metrics.paidInvoices}</strong><p>Pagadas por completo</p></article>
          <button className="metric-card" onClick={() => { goTo('productos'); setProductFilter('bajo') }}><span><Boxes /></span><small>Stock bajo</small><strong>{data.metrics.lowStock}</strong><p>Productos con 5 o menos · ver</p></button>
        </section>
        <section className="quick-actions"><button onClick={() => openProduct()}><span><PackagePlus /></span><div><strong>Nuevo producto</strong><small>Agregar con código único</small></div><ChevronRight /></button><button onClick={() => openCustomer()}><span><UserPlus /></span><div><strong>Nuevo cliente</strong><small>Crear su perfil</small></div><ChevronRight /></button><button onClick={() => openInvoiceFor()}><span><FilePlus2 /></span><div><strong>Nueva factura</strong><small>Registrar una venta</small></div><ChevronRight /></button></section>
        <section className="dashboard-columns">
          <div className="panel-card"><div className="panel-title"><div><small>Actividad reciente</small><h2>Últimas facturas</h2></div><button onClick={() => goTo('facturas')}>Ver todas <ChevronRight /></button></div><div className="invoice-list">{data.invoices.slice(0, 5).map((invoice) => <button key={invoice.id} onClick={() => setSelectedInvoice(invoice)}><span className="invoice-icon"><ReceiptText /></span><span><strong>{invoice.customerName}</strong><small>{invoice.number} · {shortDate(invoice.createdAt)}</small></span><b>{currency(invoice.totalCents)}</b><StatusBadge invoice={invoice} /></button>)}{!data.invoices.length && <Empty message="Todavía no hay facturas." />}</div></div>
          <div className="panel-card"><div className="panel-title"><div><small>Seguimiento</small><h2>Saldos pendientes</h2></div></div><div className="debt-list">{data.customers.filter((customer) => customer.balanceCents > 0).sort((a, b) => b.balanceCents - a.balanceCents).slice(0, 5).map((customer) => <div key={customer.id}><span>{customer.name.charAt(0)}</span><p><strong>{customer.name}</strong><small>{customer.invoiceCount} factura(s)</small></p><b>{currency(customer.balanceCents)}</b></div>)}{!data.customers.some((customer) => customer.balanceCents > 0) && <Empty message="No hay saldos pendientes." />}</div></div>
        </section>
      </>}

      {data && (tab === 'productos' || tab === 'clientes' || tab === 'facturas') && <section className="management-page">
        <div className="management-toolbar"><label className="search-field"><Search /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === 'productos' ? 'Buscar por nombre, código o categoría…' : tab === 'clientes' ? 'Buscar por nombre, teléfono o correo…' : 'Buscar por número, cliente o producto…'} />{query && <button type="button" className="clear-search" aria-label="Borrar búsqueda" onClick={() => setQuery('')}><X size={15} /></button>}</label>{tab === 'productos' && <button className="primary-button" onClick={() => openProduct()}><Plus /> Nuevo producto</button>}{tab === 'clientes' && <button className="primary-button" onClick={() => openCustomer()}><Plus /> Nuevo cliente</button>}{tab === 'facturas' && <button className="primary-button" onClick={() => openInvoiceFor()}><Plus /> Nueva factura</button>}</div>
        {tab === 'productos' && <div className="filter-chips">{([['todos', 'Todos', data.products.length], ['visibles', 'En la tienda', data.products.filter((product) => product.active).length], ['ocultos', 'Ocultos', data.products.filter((product) => !product.active).length], ['bajo', 'Quedan pocos', data.products.filter((product) => product.stock <= 5).length]] as Array<[ProductFilter, string, number]>).map(([value, label, count]) => <button key={value} className={productFilter === value ? 'active' : ''} onClick={() => setProductFilter(value)}>{label} <b>{count}</b></button>)}</div>}
        {tab === 'facturas' && <div className="filter-chips">{([['todas', 'Todas', data.invoices.length], ['pendientes', 'Por cobrar', data.invoices.filter((invoice) => invoice.balanceCents > 0).length], ['vencidas', 'Vencidas', data.invoices.filter((invoice) => invoice.status === 'overdue').length], ['saldadas', 'Saldadas', data.invoices.filter((invoice) => invoice.balanceCents <= 0).length]] as Array<[InvoiceFilter, string, number]>).map(([value, label, count]) => <button key={value} className={invoiceFilter === value ? 'active' : ''} onClick={() => setInvoiceFilter(value)}>{label} <b>{count}</b></button>)}</div>}
        {tab === 'productos' && <div className="data-card"><table><thead><tr><th>Producto</th><th>Código</th><th>Categoría</th><th>Precio</th><th>Inventario</th><th>Estado</th><th /></tr></thead><tbody>{filteredProducts.map((product) => <tr key={product.id}><td><button className="table-product" onClick={() => openProduct(product)}><img src={product.imageUrl || '/product-placeholder.svg'} alt="" /><strong>{product.name}</strong></button></td><td><code>{product.code}</code></td><td>{product.category}</td><td><strong>{currency(product.priceCents)}</strong></td><td><span className={product.stock <= 5 ? 'stock-low' : ''}>{product.stock} unidades</span></td><td><span className={`simple-status ${product.active ? 'ok' : 'off'}`}>{product.active ? 'En la tienda' : 'Oculto'}</span></td><td><div className="row-actions"><button title="Editar" aria-label="Editar" onClick={() => openProduct(product)}><Pencil /></button><button title="Sumar o restar unidades" aria-label="Sumar o restar unidades" className="pay-action" onClick={() => void restockProduct(product)}><PackagePlus /></button><button title={product.active ? 'Ocultar de la tienda' : 'Mostrar en la tienda'} aria-label={product.active ? 'Ocultar de la tienda' : 'Mostrar en la tienda'} onClick={() => void toggleProduct(product)}>{product.active ? <EyeOff /> : <Eye />}</button><button title="Duplicar" aria-label="Duplicar" onClick={() => openProduct(product, true)}><Copy /></button><button title="Mandar a la Papelera" aria-label="Mandar a la Papelera" className="danger-action" onClick={() => void removeProduct(product)}><Trash2 /></button></div></td></tr>)}</tbody></table>{!filteredProducts.length && <Empty message="No hay productos que mostrar." />}</div>}
        {tab === 'clientes' && <div className="customer-grid">{filteredCustomers.map((customer) => <article key={customer.id}><div className="customer-card-top"><span>{customer.name.charAt(0)}</span><div className="row-actions"><a title="Escribir por WhatsApp" aria-label="Escribir por WhatsApp" className="pay-action" href={whatsappLink(customer.phone)} target="_blank" rel="noopener noreferrer"><MessageCircle /></a><button title="Editar" aria-label="Editar" onClick={() => openCustomer(customer)}><Pencil /></button><button title="Mandar a la Papelera" aria-label="Mandar a la Papelera" className="danger-action" onClick={() => void removeCustomer(customer)}><Trash2 /></button></div></div><h3>{customer.name}</h3><p>{customer.phone}</p><small>{customer.email || 'Sin correo registrado'}</small><div><span>Saldo actual</span><strong className={customer.balanceCents ? 'has-debt' : ''}>{currency(customer.balanceCents)}</strong></div><footer><span>{customer.invoiceCount} factura(s)</span><b className={customer.balanceCents ? 'pending-dot' : 'paid-dot'}>{customer.balanceCents ? 'Pendiente' : 'Saldado'}</b></footer><div className="customer-card-actions"><button className="secondary-button" onClick={() => openInvoiceFor(customer.id)}><FilePlus2 /> Nueva factura</button>{customer.invoiceCount > 0 && <button className="secondary-button" onClick={() => { goTo('facturas'); setQuery(customer.name) }}><ReceiptText /> Ver facturas</button>}</div></article>)}{!filteredCustomers.length && <Empty message="No hay clientes que mostrar." />}</div>}
        {tab === 'facturas' && <div className="data-card"><table><thead><tr><th>Factura</th><th>Cliente</th><th>Fecha</th><th>Total</th><th>Abonado</th><th>Saldo</th><th>Estado</th><th /></tr></thead><tbody>{filteredInvoices.map((invoice) => <tr key={invoice.id}><td><button className="link-button" onClick={() => setSelectedInvoice(invoice)}><code>{invoice.number}</code></button></td><td><strong>{invoice.customerName}</strong><small className="table-subtext">{invoice.customerPhone}</small></td><td>{shortDate(invoice.createdAt)}</td><td><strong>{currency(invoice.totalCents)}</strong></td><td>{currency(invoice.paidCents)}</td><td><strong className={invoice.balanceCents ? 'has-debt' : ''}>{currency(invoice.balanceCents)}</strong></td><td><StatusBadge invoice={invoice} /></td><td><div className="row-actions"><button title="Ver" aria-label="Ver" onClick={() => setSelectedInvoice(invoice)}><Eye /></button><button title="Editar notas y fecha" aria-label="Editar notas y fecha" onClick={() => openEditInvoice(invoice)}><Pencil /></button><button title="Descargar PDF" aria-label="Descargar PDF" onClick={() => downloadInvoice(invoice)}><Download /></button><button title="Compartir" aria-label="Compartir" onClick={() => shareInvoice(invoice)}><Share2 /></button>{invoice.balanceCents > 0 && <button title="Registrar abono" aria-label="Registrar abono" className="pay-action" onClick={() => { setPaymentInvoice(invoice); setPaymentAmount(invoice.balanceCents); setPaymentError('') }}><Banknote /></button>}<button title="Mandar a la Papelera" aria-label="Mandar a la Papelera" className="danger-action" onClick={() => deleteInvoice(invoice)}><Trash2 /></button></div></td></tr>)}</tbody></table>{!filteredInvoices.length && <Empty message="No hay facturas que mostrar." />}</div>}
      </section>}

      {data && tab === 'papelera' && <section className="management-page">
        <p className="trash-intro">Lo que borras se queda aquí {data.trash.days} días. Después se borra solo. Puedes restaurarlo antes.</p>
        {!trashCount && <div className="data-card"><Empty message="La Papelera está vacía." /></div>}
        {data.trash.products.length > 0 && <div className="panel-card trash-group"><div className="panel-title"><div><small>Papelera</small><h2>Productos</h2></div></div>{data.trash.products.map((product) => <TrashRow key={product.id} image={product.imageUrl || '/product-placeholder.svg'} title={product.name} detail={`${product.code} · ${currency(product.priceCents)} · ${product.stock} unidades`} days={daysLeft(product.deletedAt, data.trash.days)} busy={saving} onRestore={() => void restoreItem('products', product.id)} onDelete={() => void deleteForever('products', product.id, product.name)} />)}</div>}
        {data.trash.invoices.length > 0 && <div className="panel-card trash-group"><div className="panel-title"><div><small>Papelera</small><h2>Facturas</h2></div></div><p className="trash-note">Al restaurar una factura, sus productos se vuelven a sacar del inventario.</p>{data.trash.invoices.map((invoice) => <TrashRow key={invoice.id} title={`${invoice.number} · ${invoice.customerName}`} detail={`${shortDate(invoice.createdAt)} · ${currency(invoice.totalCents)} · ${invoice.items.map((item) => `${item.quantity}× ${item.productName}`).join(', ')}`} days={daysLeft(invoice.deletedAt, data.trash.days)} busy={saving} onRestore={() => void restoreItem('invoices', invoice.id)} onDelete={() => void deleteForever('invoices', invoice.id, invoice.number)} />)}</div>}
        {data.trash.customers.length > 0 && <div className="panel-card trash-group"><div className="panel-title"><div><small>Papelera</small><h2>Clientes</h2></div></div>{data.trash.customers.map((customer) => <TrashRow key={customer.id} title={customer.name} detail={`${customer.phone}${customer.email ? ` · ${customer.email}` : ''}`} days={daysLeft(customer.deletedAt, data.trash.days)} busy={saving} onRestore={() => void restoreItem('customers', customer.id)} onDelete={() => void deleteForever('customers', customer.id, customer.name)} />)}</div>}
      </section>}

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
      <div className="admin-credit mobile-credit"><GadrCredit /></div>
    </section>

    {productModal && <AdminModal title={editingProduct ? 'Editar producto' : productDraft.name.endsWith('(copia)') ? 'Duplicar producto' : 'Agregar producto'} subtitle="El código identifica cada artículo en inventario." onClose={() => setProductModal(false)}><form onSubmit={saveProduct} className="admin-form"><div className="form-grid"><label>Código del producto<input required value={productDraft.code} onChange={(event) => setProductDraft({ ...productDraft, code: event.target.value.toUpperCase() })} placeholder="CH-005" /></label><label>Nombre<input required value={productDraft.name} onChange={(event) => setProductDraft({ ...productDraft, name: event.target.value })} /></label><label>Categoría<input required list="aura-categories" value={productDraft.category} onChange={(event) => setProductDraft({ ...productDraft, category: event.target.value })} /><datalist id="aura-categories">{categoryOptions.map((option) => <option key={option} value={option} />)}</datalist></label><label>Precio (RD$)<input required type="number" min="0" step="any" inputMode="decimal" value={productDraft.priceCents / 100 || ''} onChange={(event) => setProductDraft({ ...productDraft, priceCents: Math.round(Number(event.target.value) * 100) })} /></label><label>Existencias (unidades)<input required type="number" min="0" inputMode="numeric" value={productDraft.stock} onChange={(event) => setProductDraft({ ...productDraft, stock: Math.max(0, Math.trunc(Number(event.target.value))) })} /></label><ImageField value={productDraft.imageUrl} mode={imageMode} uploading={uploadingImage} onModeChange={setImageMode} onUrlChange={(value) => setProductDraft({ ...productDraft, imageUrl: value })} onFileSelect={(file) => void handleImageFile(file)} /><label className="full-field">Descripción<textarea value={productDraft.description} onChange={(event) => setProductDraft({ ...productDraft, description: event.target.value })} /></label></div><div className="check-row"><label><input type="checkbox" checked={productDraft.featured} onChange={(event) => setProductDraft({ ...productDraft, featured: event.target.checked })} /> Destacar en la tienda</label><label><input type="checkbox" checked={productDraft.active} onChange={(event) => setProductDraft({ ...productDraft, active: event.target.checked })} /> Mostrar en la tienda</label></div><button className="primary-button full" disabled={saving}>{saving ? 'Guardando…' : 'Guardar producto'}</button></form></AdminModal>}
    {customerModal && <AdminModal title={editingCustomer ? 'Editar cliente' : 'Registrar cliente'} subtitle="Guarda sus datos para facturar y consultar saldos." onClose={() => setCustomerModal(false)}><form onSubmit={saveCustomer} className="admin-form"><div className="form-grid"><label>Nombre completo<input required value={customerDraft.name} onChange={(event) => setCustomerDraft({ ...customerDraft, name: event.target.value })} /></label><label>Teléfono<input required value={customerDraft.phone} onChange={(event) => setCustomerDraft({ ...customerDraft, phone: event.target.value })} /></label><label>Correo<input type="email" value={customerDraft.email} onChange={(event) => setCustomerDraft({ ...customerDraft, email: event.target.value })} /></label><label>Dirección<input value={customerDraft.address} onChange={(event) => setCustomerDraft({ ...customerDraft, address: event.target.value })} /></label><label className="full-field">Notas<textarea value={customerDraft.notes} onChange={(event) => setCustomerDraft({ ...customerDraft, notes: event.target.value })} /></label></div><button className="primary-button full" disabled={saving}>{saving ? 'Guardando…' : 'Guardar cliente'}</button></form></AdminModal>}
    {invoiceModal && data && <AdminModal title="Nueva factura" subtitle="Selecciona el cliente, agrega productos y registra el pago inicial." onClose={() => setInvoiceModal(false)} wide><form onSubmit={createInvoice} className="admin-form"><label>Cliente<select required value={invoiceCustomerId || ''} onChange={(event) => setInvoiceCustomerId(Number(event.target.value))}><option value="">Selecciona un cliente</option>{data.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.phone}</option>)}</select></label><div className="invoice-builder"><div className="builder-title"><strong>Productos</strong><button type="button" onClick={() => setInvoiceLines([...invoiceLines, { productId: 0, quantity: 1 }])}><Plus /> Agregar línea</button></div>{invoiceLines.map((line, index) => <div className="invoice-line" key={index}><select required value={line.productId || ''} onChange={(event) => setInvoiceLines(invoiceLines.map((item, itemIndex) => itemIndex === index ? { ...item, productId: Number(event.target.value) } : item))}><option value="">Selecciona un producto</option>{data.products.filter((product) => product.active && product.stock > 0).map((product) => <option value={product.id} key={product.id}>{product.code} · {product.name} ({product.stock})</option>)}</select><input type="number" min="1" max={data.products.find((product) => product.id === line.productId)?.stock || undefined} inputMode="numeric" aria-label="Cantidad" value={line.quantity || ''} onChange={(event) => setInvoiceLines(invoiceLines.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: Math.max(0, Math.trunc(Number(event.target.value))) } : item))} /><strong>{currency((data.products.find((product) => product.id === line.productId)?.priceCents || 0) * line.quantity)}</strong><button type="button" onClick={() => setInvoiceLines(invoiceLines.filter((_, itemIndex) => itemIndex !== index))}><Trash2 /></button></div>)}</div><div className="form-grid"><label>Descuento (RD$)<input type="number" min="0" step="any" inputMode="decimal" max={invoiceSubtotal / 100} value={invoiceDiscount / 100 || ''} onChange={(event) => setInvoiceDiscount(Math.min(invoiceSubtotal, Math.max(0, Math.round(Number(event.target.value) * 100))))} /></label><label>Pago inicial (RD$)<span className="label-row"><input type="number" min="0" step="any" inputMode="decimal" max={invoiceDraftTotal / 100} value={invoicePaid / 100 || ''} onChange={(event) => setInvoicePaid(Math.min(invoiceDraftTotal, Math.max(0, Math.round(Number(event.target.value) * 100))))} /><button type="button" className="mini-button" onClick={() => setInvoicePaid(invoiceDraftTotal)}>Pagó todo</button></span></label>{invoicePaid > 0 && <label>¿Cómo pagó?<select value={invoiceMethod} onChange={(event) => setInvoiceMethod(event.target.value)}><option>Efectivo</option><option>Transferencia</option><option>Tarjeta</option><option>Otro</option></select></label>}<label>Fecha límite de pago<input type="date" value={invoiceDueDate} onChange={(event) => setInvoiceDueDate(event.target.value)} /></label><label className="full-field">Notas (opcional)<textarea value={invoiceNotes} onChange={(event) => setInvoiceNotes(event.target.value)} placeholder="Ej.: entregar el sábado" /></label></div><div className="invoice-draft-total">{invoiceDiscount > 0 && <small>Subtotal {currency(invoiceSubtotal)} − descuento {currency(invoiceDiscount)}</small>}<span>Total de factura</span><strong>{currency(invoiceDraftTotal)}</strong></div><button className="primary-button full" disabled={saving || !invoiceSubtotal}>{saving ? 'Creando factura…' : 'Crear factura'}</button></form></AdminModal>}
    {paymentInvoice && <AdminModal title="Registrar abono" subtitle={`${paymentInvoice.number} · ${paymentInvoice.customerName}`} onClose={() => setPaymentInvoice(null)}><form onSubmit={registerPayment} className="admin-form"><div className="balance-highlight"><span>Saldo pendiente</span><strong>{currency(paymentInvoice.balanceCents)}</strong></div><label>Monto recibido (RD$)<input required type="number" min="1" max={paymentInvoice.balanceCents / 100} value={paymentAmount / 100 || ''} onChange={(event) => setPaymentAmount(Math.round(Number(event.target.value) * 100))} /></label><label>Método de pago<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option>Efectivo</option><option>Transferencia</option><option>Tarjeta</option><option>Otro</option></select></label>{paymentError && <p className="form-error">{paymentError}</p>}<button className="primary-button full" disabled={saving}>{saving ? 'Registrando…' : 'Confirmar abono'}</button></form></AdminModal>}
    {selectedInvoice && <AdminModal title={selectedInvoice.number} subtitle={`${selectedInvoice.customerName} · ${shortDate(selectedInvoice.createdAt)}`} onClose={() => setSelectedInvoice(null)} wide><div className="invoice-detail"><div className="invoice-detail-summary"><div><span>Total</span><strong>{currency(selectedInvoice.totalCents)}</strong></div><div><span>Abonado</span><strong>{currency(selectedInvoice.paidCents)}</strong></div><div><span>Saldo</span><strong className={selectedInvoice.balanceCents ? 'has-debt' : ''}>{currency(selectedInvoice.balanceCents)}</strong></div><StatusBadge invoice={selectedInvoice} /></div><div className="detail-lines">{selectedInvoice.items.map((item) => <div key={item.id}><span><strong>{item.productName}</strong><small>{item.productCode} · {item.quantity} × {currency(item.unitPriceCents)}</small></span><b>{currency(item.totalCents)}</b></div>)}</div>{selectedInvoice.payments.length > 0 && <div className="payment-history"><h3>Historial de pagos</h3>{selectedInvoice.payments.map((payment) => <div key={payment.id}><span><strong>{payment.method}</strong><small>{shortDate(payment.createdAt)}</small></span><b>{currency(payment.amountCents)}</b></div>)}</div>}{selectedInvoice.balanceCents > 0 && <button className="primary-button full" onClick={() => { setPaymentInvoice(selectedInvoice); setPaymentAmount(selectedInvoice.balanceCents); setPaymentError(''); setSelectedInvoice(null) }}>Registrar abono</button>}{selectedInvoice.notes && <p className="invoice-notes">{selectedInvoice.notes}</p>}<div className="detail-actions"><button className="secondary-button full" onClick={() => openEditInvoice(selectedInvoice)}><Pencil /> Editar notas y fecha</button><a className="secondary-button full" href={whatsappLink(selectedInvoice.customerPhone, buildInvoiceText(selectedInvoice))} target="_blank" rel="noopener noreferrer"><MessageCircle /> Enviar por WhatsApp</a><button className="secondary-button full" onClick={() => downloadInvoice(selectedInvoice)}><Download /> Descargar PDF</button><button className="secondary-button full" onClick={() => shareInvoice(selectedInvoice)}><Share2 /> Compartir</button><button className="danger-button full" onClick={() => deleteInvoice(selectedInvoice)}><Trash2 /> Mandar a la Papelera</button></div></div></AdminModal>}
    {editInvoice && <AdminModal title={`Editar ${editInvoice.number}`} subtitle={editInvoice.customerName} onClose={() => setEditInvoice(null)}><form onSubmit={saveEditInvoice} className="admin-form"><label>Fecha límite de pago<input type="date" value={editInvoiceDue} onChange={(event) => setEditInvoiceDue(event.target.value)} /></label><label>Notas<textarea rows={6} value={editInvoiceNotes} onChange={(event) => setEditInvoiceNotes(event.target.value)} /></label><p className="trash-note">Para cambiar productos o precios, manda esta factura a la Papelera (los productos vuelven al inventario) y crea una nueva.</p><button className="primary-button full" disabled={saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</button></form></AdminModal>}
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

function ImageField({ value, mode, uploading, onModeChange, onUrlChange, onFileSelect }: { value: string; mode: 'url' | 'file'; uploading: boolean; onModeChange: (mode: 'url' | 'file') => void; onUrlChange: (value: string) => void; onFileSelect: (file: File) => void }) {
  return <label className="full-field image-field">
    Imagen del producto
    <div className="image-mode-toggle">
      <button type="button" className={mode === 'url' ? 'active' : ''} onClick={() => onModeChange('url')}>Usar URL</button>
      <button type="button" className={mode === 'file' ? 'active' : ''} onClick={() => onModeChange('file')}>Subir desde el dispositivo</button>
    </div>
    {mode === 'url'
      ? <input value={value} onChange={(event) => onUrlChange(event.target.value)} placeholder="https://…" />
      : <div className="image-upload-row">
          <input type="file" accept="image/*" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) onFileSelect(file); event.target.value = '' }} />
          {uploading && <span className="image-upload-status">Subiendo…</span>}
        </div>}
    {value && <img className="image-field-preview" src={value} alt="Vista previa del producto" />}
  </label>
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

function AdminModal({ title, subtitle, onClose, wide = false, children }: { title: string; subtitle: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  return <div className="modal-layer"><button className="modal-backdrop" aria-label="Cerrar" onClick={onClose} /><section className={`admin-modal ${wide ? 'wide' : ''}`}><header><div><small>Aura Beauty</small><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button" aria-label="Cerrar" onClick={onClose}><X /></button></header>{children}</section></div>
}
