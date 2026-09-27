// Contenido editable de la página pública (tienda). Cada clave corresponde
// a un texto que antes estaba escrito directamente en `Storefront.tsx` y que
// ahora se guarda en la tabla `site_content`, editable desde
// `/admin` → Contenido.
//
// `DEFAULT_SITE_CONTENT` son los valores originales de la tienda: se usan
// como semilla de la migración inicial y como respaldo si la API de
// contenido no responde, para que la página nunca se rompa.
//
// `CONTENT_FIELD_GROUPS` describe cómo se agrupan y presentan esos campos
// en el panel de administración (solo se usa en el cliente admin).

export type SiteContent = Record<string, string>

export const DEFAULT_SITE_CONTENT: SiteContent = {
  // Notificaciones
  notification_email: '',

  // Identidad del sitio
  site_name: 'Aura',
  site_tagline: 'Beauty',

  // Encabezado / navegación
  nav_catalog: 'Colección',
  nav_essence: 'Nuestra esencia',
  nav_contact: 'Contacto',
  nav_cart_button: 'Mi cesta',

  // Hero / inicio
  hero_eyebrow: 'Belleza cotidiana, elegida con intención',
  hero_title: 'Tu ritual.',
  hero_title_emphasis: 'Tu esencia.',
  hero_description: 'Fórmulas para cabello, rostro y cuerpo que convierten lo cotidiano en un momento especial.',
  hero_button: 'Explorar productos',
  hero_note_1: 'Selección cuidada',
  hero_note_2: 'Atención personal',
  hero_favorite_label: 'Favorito de la semana',
  hero_favorite_product: 'Champú Botánico',
  hero_favorite_description: 'Romero + sábila',
  hero_orbit_text: 'Cuidado que se siente',
  hero_image_url: 'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?auto=format&fit=crop&w=1200&q=90',

  // Beneficios (franja de tres bloques)
  benefit_1_title: 'Productos seleccionados',
  benefit_1_description: 'Calidad que puedes sentir',
  benefit_2_title: 'Compra fácil',
  benefit_2_description: 'Tu pedido en pocos pasos',
  benefit_3_title: 'Cerca de ti',
  benefit_3_description: 'Atención humana y directa',

  // Catálogo
  catalog_eyebrow: 'La colección',
  catalog_title: 'Elige lo que te hace bien.',
  catalog_description: 'Descubre esenciales para cada parte de tu rutina, organizados para encontrar justo lo que necesitas.',
  catalog_search_placeholder: 'Buscar nombre o código',
  catalog_empty_error_title: 'El catálogo está descansando',
  catalog_empty_search_title: 'No encontramos coincidencias',
  catalog_empty_search_description: 'Prueba con otro nombre, código o categoría.',
  product_favorite_badge: 'Favorito',
  product_add_button: 'Agregar',
  product_sold_out_button: 'Agotado',
  product_stock_suffix: 'disponibles',

  // Nuestra esencia (sección "Menos ruido. Mejores elecciones.")
  essence_number: 'A',
  essence_eyebrow: 'Nuestra forma de cuidarte',
  essence_title: 'Menos ruido.',
  essence_title_emphasis: 'Mejores elecciones.',
  essence_description: 'Creamos una tienda fácil de explorar, con información clara y acompañamiento cercano para que tu compra se sienta tan bien como los productos que eliges.',

  // Footer
  footer_tagline: 'Tu tienda de cuidado personal, todos los días.',
  footer_contact_label: 'Pedidos y consultas',
  footer_phone: '+1 (809) 555-0147',
  footer_hours: 'Lun–Sáb · 9:00–18:00',

  // Carrito
  cart_subtitle: 'Tu selección',
  cart_title: 'Mi cesta',
  cart_empty_title: 'Tu cesta está vacía',
  cart_empty_description: 'Agrega algo especial del catálogo.',
  cart_empty_button: 'Seguir explorando',
  cart_subtotal_label: 'Subtotal',
  cart_pending_note: 'El pedido se registra como pendiente hasta confirmar el pago.',
  cart_checkout_button: 'Completar pedido',

  // Checkout
  checkout_eyebrow: 'Último paso',
  checkout_title: '¿A dónde llevamos tu pedido?',
  checkout_intro: 'Completa tus datos. No necesitas crear una cuenta.',
  checkout_name_label: 'Nombre completo',
  checkout_phone_label: 'Teléfono',
  checkout_email_label: 'Correo electrónico',
  checkout_address_label: 'Dirección de entrega',
  checkout_total_label: 'Total del pedido',
  checkout_submit_button: 'Confirmar pedido',
  checkout_submitting_button: 'Registrando pedido…',
  checkout_success_label: 'Pedido recibido',
  checkout_success_title: '¡Gracias por elegir a Aura Beauty!',
  checkout_success_message: 'Tu factura {number} quedó registrada. Nos comunicaremos contigo para coordinar entrega y pago.',
  checkout_success_button: 'Volver a la tienda',

  // Mensajes generales
  catalog_load_error: 'No pudimos cargar el catálogo.',
  order_generic_error: 'No pudimos registrar el pedido.',
}

type ContentFieldType = 'input' | 'textarea' | 'image'

export type ContentFieldDefinition = {
  key: keyof typeof DEFAULT_SITE_CONTENT
  label: string
  type: ContentFieldType
}

export type ContentFieldGroup = {
  id: string
  title: string
  description?: string
  fields: ContentFieldDefinition[]
}

export const CONTENT_FIELD_GROUPS: ContentFieldGroup[] = [
  {
    id: 'notifications',
    title: 'Notificaciones',
    description: 'Correo donde recibirás el aviso y la factura cada vez que un cliente registre un pedido.',
    fields: [{ key: 'notification_email', label: 'Correo para recibir pedidos', type: 'input' }],
  },
  {
    id: 'identity',
    title: 'Identidad del sitio',
    fields: [
      { key: 'site_name', label: 'Nombre de la tienda', type: 'input' },
      { key: 'site_tagline', label: 'Subtítulo / tagline', type: 'input' },
    ],
  },
  {
    id: 'header',
    title: 'Encabezado',
    fields: [
      { key: 'nav_catalog', label: 'Enlace: Colección', type: 'input' },
      { key: 'nav_essence', label: 'Enlace: Nuestra esencia', type: 'input' },
      { key: 'nav_contact', label: 'Enlace: Contacto', type: 'input' },
      { key: 'nav_cart_button', label: 'Botón: Mi cesta', type: 'input' },
    ],
  },
  {
    id: 'hero',
    title: 'Hero / Inicio',
    fields: [
      { key: 'hero_eyebrow', label: 'Texto pequeño superior', type: 'input' },
      { key: 'hero_title', label: 'Título principal', type: 'input' },
      { key: 'hero_title_emphasis', label: 'Parte destacada del título', type: 'input' },
      { key: 'hero_description', label: 'Descripción', type: 'textarea' },
      { key: 'hero_button', label: 'Texto del botón', type: 'input' },
      { key: 'hero_note_1', label: 'Nota 1', type: 'input' },
      { key: 'hero_note_2', label: 'Nota 2', type: 'input' },
      { key: 'hero_favorite_label', label: 'Etiqueta de producto favorito', type: 'input' },
      { key: 'hero_favorite_product', label: 'Nombre de producto favorito', type: 'input' },
      { key: 'hero_favorite_description', label: 'Descripción del producto favorito', type: 'input' },
      { key: 'hero_orbit_text', label: 'Texto flotante', type: 'input' },
      { key: 'hero_image_url', label: 'Imagen principal', type: 'image' },
    ],
  },
  {
    id: 'benefits',
    title: 'Beneficios',
    fields: [
      { key: 'benefit_1_title', label: '01 · Título', type: 'input' },
      { key: 'benefit_1_description', label: '01 · Descripción', type: 'input' },
      { key: 'benefit_2_title', label: '02 · Título', type: 'input' },
      { key: 'benefit_2_description', label: '02 · Descripción', type: 'input' },
      { key: 'benefit_3_title', label: '03 · Título', type: 'input' },
      { key: 'benefit_3_description', label: '03 · Descripción', type: 'input' },
    ],
  },
  {
    id: 'catalog',
    title: 'Catálogo',
    fields: [
      { key: 'catalog_eyebrow', label: 'Título pequeño', type: 'input' },
      { key: 'catalog_title', label: 'Título principal', type: 'input' },
      { key: 'catalog_description', label: 'Descripción', type: 'textarea' },
      { key: 'catalog_search_placeholder', label: 'Placeholder del buscador', type: 'input' },
      { key: 'catalog_empty_error_title', label: 'Título si falla la carga', type: 'input' },
      { key: 'catalog_empty_search_title', label: 'Título sin resultados de búsqueda', type: 'input' },
      { key: 'catalog_empty_search_description', label: 'Texto sin resultados de búsqueda', type: 'input' },
      { key: 'product_favorite_badge', label: 'Insignia "Favorito"', type: 'input' },
      { key: 'product_add_button', label: 'Botón "Agregar"', type: 'input' },
      { key: 'product_sold_out_button', label: 'Botón "Agotado"', type: 'input' },
      { key: 'product_stock_suffix', label: 'Sufijo de existencias (ej. "disponibles")', type: 'input' },
    ],
  },
  {
    id: 'essence',
    title: 'Nuestra esencia',
    fields: [
      { key: 'essence_number', label: 'Letra/número decorativo', type: 'input' },
      { key: 'essence_eyebrow', label: 'Texto pequeño', type: 'input' },
      { key: 'essence_title', label: 'Título', type: 'input' },
      { key: 'essence_title_emphasis', label: 'Título (segunda línea)', type: 'input' },
      { key: 'essence_description', label: 'Descripción', type: 'textarea' },
    ],
  },
  {
    id: 'footer',
    title: 'Footer',
    fields: [
      { key: 'footer_tagline', label: 'Descripción de la tienda', type: 'input' },
      { key: 'footer_contact_label', label: 'Etiqueta de contacto', type: 'input' },
      { key: 'footer_phone', label: 'Teléfono', type: 'input' },
      { key: 'footer_hours', label: 'Horario', type: 'input' },
    ],
  },
  {
    id: 'cart',
    title: 'Carrito',
    fields: [
      { key: 'cart_subtitle', label: 'Texto pequeño superior', type: 'input' },
      { key: 'cart_title', label: 'Título', type: 'input' },
      { key: 'cart_empty_title', label: 'Título de cesta vacía', type: 'input' },
      { key: 'cart_empty_description', label: 'Texto de cesta vacía', type: 'input' },
      { key: 'cart_empty_button', label: 'Botón de cesta vacía', type: 'input' },
      { key: 'cart_subtotal_label', label: 'Etiqueta del subtotal', type: 'input' },
      { key: 'cart_pending_note', label: 'Nota de pedido pendiente', type: 'textarea' },
      { key: 'cart_checkout_button', label: 'Botón para completar pedido', type: 'input' },
    ],
  },
  {
    id: 'checkout',
    title: 'Checkout',
    fields: [
      { key: 'checkout_eyebrow', label: 'Texto pequeño superior', type: 'input' },
      { key: 'checkout_title', label: 'Título', type: 'input' },
      { key: 'checkout_intro', label: 'Texto introductorio', type: 'input' },
      { key: 'checkout_name_label', label: 'Etiqueta: nombre', type: 'input' },
      { key: 'checkout_phone_label', label: 'Etiqueta: teléfono', type: 'input' },
      { key: 'checkout_email_label', label: 'Etiqueta: correo', type: 'input' },
      { key: 'checkout_address_label', label: 'Etiqueta: dirección', type: 'input' },
      { key: 'checkout_total_label', label: 'Etiqueta del total', type: 'input' },
      { key: 'checkout_submit_button', label: 'Botón: confirmar pedido', type: 'input' },
      { key: 'checkout_submitting_button', label: 'Botón mientras se registra', type: 'input' },
      { key: 'checkout_success_label', label: 'Etiqueta de éxito', type: 'input' },
      { key: 'checkout_success_title', label: 'Título de éxito', type: 'input' },
      { key: 'checkout_success_message', label: 'Mensaje de éxito (usa {number} para el número de factura)', type: 'textarea' },
      { key: 'checkout_success_button', label: 'Botón para volver a la tienda', type: 'input' },
    ],
  },
]

/** Combina el contenido guardado con los valores por defecto, para que
 * ninguna clave falte nunca en la página pública ni en el admin. */
export function mergeSiteContent(overrides: Partial<SiteContent> | null | undefined): SiteContent {
  return { ...DEFAULT_SITE_CONTENT, ...(overrides || {}) } as SiteContent
}
