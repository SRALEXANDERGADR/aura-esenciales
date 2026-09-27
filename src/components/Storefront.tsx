import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  Check,
  ChevronRight,
  MessageCircle,
  Minus,
  PackageOpen,
  Plus,
  Search,
  ShoppingBag,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { currency } from '@/lib/format'
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

export function Storefront() {
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

  const text = (key: keyof SiteContent) => content[key] ?? DEFAULT_SITE_CONTENT[key]

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
  const anyOpen = cartOpen || checkoutOpen || Boolean(detail)
  useEffect(() => {
    if (!anyOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (detail) setDetail(null)
      else if (checkoutOpen && !submitting) setCheckoutOpen(false)
      else setCartOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', onKey) }
  }, [anyOpen, detail, checkoutOpen, submitting])

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
  const contactLink = whatsappLink(text('footer_phone'), `Hola, quiero información sobre los productos de ${text('site_name')} ${text('site_tagline')}.`)

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
      const result = await response.json().catch(() => ({})) as { error?: string; invoice?: { number: string } }
      if (!response.ok) throw new Error(result.error || text('order_generic_error'))
      setOrderNumber(result.invoice?.number || '')
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
          <button className="cart-button" aria-label={`Abrir cesta (${cartCount})`} onClick={() => setCartOpen(true)}><ShoppingBag size={19} /><span>{text('nav_cart_button')}</span>{cartCount > 0 && <b>{cartCount}</b>}</button>
        </div>
      </header>

      <section className="hero" id="inicio">
        <div className="hero-copy reveal">
          <span className="eyebrow">{text('hero_eyebrow')}</span>
          <h1>{text('hero_title')}<br /><em>{text('hero_title_emphasis')}</em></h1>
          <p>{text('hero_description')}</p>
          <a href="#catalogo" className="primary-button">{text('hero_button')} <ArrowRight size={18} /></a>
          <div className="hero-notes"><span><Check size={15} /> {text('hero_note_1')}</span><span><Check size={15} /> {text('hero_note_2')}</span></div>
        </div>
      </section>

      <section className="catalog-section" id="catalogo">
        <div className="section-heading">
          <div><span className="eyebrow">{text('catalog_eyebrow')}</span><h2>{text('catalog_title')}</h2></div>
          <p>{text('catalog_description')}</p>
        </div>
        <div className="catalog-tools">
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
            <article className={`product-card reveal ${product.stock ? '' : 'sold-out'}`} style={{ animationDelay: `${Math.min(index, 8) * 70}ms` }} key={product.id}>
              <div className="product-image-wrap">
                {product.featured && <span className="product-badge">{text('product_favorite_badge')}</span>}
                {!product.stock && <span className="product-badge sold">{text('product_sold_out_button')}</span>}
                <button className="product-open" aria-label={`Ver ${product.name}`} onClick={() => setDetail(product)}>
                  {product.imageUrl ? <img src={product.imageUrl} alt={product.name} loading={index > 3 ? 'lazy' : 'eager'} /> : <div className="image-placeholder"><Sparkles /></div>}
                </button>
                <button className="quick-add" disabled={!product.stock} onClick={() => addToCart(product)}><Plus size={18} /> {product.stock ? text('product_add_button') : text('product_sold_out_button')}</button>
              </div>
              <div className="product-info"><span>{product.category}</span><h3><button className="product-title-button" onClick={() => setDetail(product)}>{product.name}</button></h3><p>{product.description}</p><div><strong>{currency(product.priceCents)}</strong><small className={product.stock && product.stock <= 5 ? 'few-left' : ''}>{stockLabel(product)}</small></div></div>
            </article>
          ))}
        </div>
      </section>

      <section className="story-section" id="esencia">
        <div className="story-number">{text('essence_number')}</div>
        <div><span className="eyebrow">{text('essence_eyebrow')}</span><h2>{text('essence_title')}<br />{text('essence_title_emphasis')}</h2></div>
        <p>{text('essence_description')}</p>
      </section>

      <footer id="contacto">
        <div className="brand footer-brand"><span className="brand-mark"><Sparkles size={19} /></span><span><strong>{text('site_name')}</strong><small>{text('site_tagline')}</small></span></div>
        <p>{text('footer_tagline')}</p>
        <div className="footer-contact"><span>{text('footer_contact_label')}</span><strong>{text('footer_phone')}</strong><small>{text('footer_hours')}</small>{contactLink && <a className="footer-whatsapp" href={contactLink} target="_blank" rel="noopener noreferrer"><MessageCircle size={16} /> Escríbenos por WhatsApp</a>}</div>
        <div className="footer-legal">
          <span>© {new Date().getFullYear()} {text('site_name')} {text('site_tagline')}. Todos los derechos reservados.</span>
          <Link to="/politicas">Políticas</Link>
        </div>
        <a className="gadr-credit" href="https://gadrnet.com" target="_blank" rel="noopener noreferrer"><span className="gadr-credit-text">Diseño y desarrollo de la tienda: GADR Net | gadrnet.com</span><span className="gadr-mark" aria-hidden="true"><span className="gadr-mark-icon">&lt;/&gt;<i></i></span><span className="gadr-mark-word">GADR<small>Net</small></span></span></a>
      </footer>

      {cartOpen && <div className="drawer-layer" role="dialog" aria-modal="true">
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
          {cartLines.length > 0 && <div className="cart-summary"><div><span>{text('cart_subtotal_label')}</span><strong>{currency(cartTotal)}</strong></div><small>{text('cart_pending_note')}</small><button className="primary-button full" onClick={() => { setOrderError(''); setCheckoutOpen(true) }}>{text('cart_checkout_button')} <ArrowRight size={18} /></button></div>}
        </aside>
      </div>}

      {checkoutOpen && <div className="modal-layer" role="dialog" aria-modal="true">
        <button className="modal-backdrop" aria-label="Cerrar" onClick={() => !submitting && setCheckoutOpen(false)} />
        <div className="checkout-modal">
          <button className="modal-close icon-button" aria-label="Cerrar" disabled={submitting} onClick={() => setCheckoutOpen(false)}><X /></button>
          {orderNumber ? <div className="success-message"><span><Check /></span><small>{text('checkout_success_label')}</small><h2>{text('checkout_success_title')}</h2><p>{text('checkout_success_message').replace('{number}', orderNumber)}</p>{whatsappLink(text('footer_phone'), '') && <a className="secondary-link" href={whatsappLink(text('footer_phone'), `Hola, acabo de hacer el pedido ${orderNumber} en la tienda.`)} target="_blank" rel="noopener noreferrer"><MessageCircle size={17} /> Avisar por WhatsApp</a>}<button className="primary-button" onClick={() => { setOrderNumber(''); setCheckoutOpen(false); setCartOpen(false) }}>{text('checkout_success_button')}</button></div> : <form onSubmit={submitOrder}>
            <span className="eyebrow">{text('checkout_eyebrow')}</span><h2>{text('checkout_title')}</h2><p className="form-intro">{text('checkout_intro')}</p>
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
          <div className="product-detail-image">{detail.imageUrl ? <img src={detail.imageUrl} alt={detail.name} /> : <div className="image-placeholder"><Sparkles /></div>}</div>
          <div className="product-detail-info">
            <span className="eyebrow">{detail.category}</span>
            <h2>{detail.name}</h2>
            <strong className="product-detail-price">{currency(detail.priceCents)}</strong>
            {detail.description && <p>{detail.description}</p>}
            <small className={detail.stock && detail.stock <= 5 ? 'few-left' : ''}>{stockLabel(detail)} · Código {detail.code}</small>
            <button className="primary-button full" disabled={!detail.stock} onClick={() => { addToCart(detail); setDetail(null) }}><Plus size={18} /> {detail.stock ? `${text('product_add_button')} a la cesta` : text('product_sold_out_button')}</button>
          </div>
        </div>
      </div>}

      {toast && <div className="cart-toast" role="status"><Check size={17} /><span>{toast}</span><button onClick={() => { setToast(''); setCartOpen(true) }}>Ver cesta</button></div>}
    </main>
  )
}
