// Planes de la tienda (Básico, Profesional, Completo).
//
// Es el MISMO código para los 3 planes. El plan se escoge con la variable
// PLAN de wrangler.jsonc:
//   "demo"                              → web de muestra; el plan se escoge con ?plan=
//   "basico" | "profesional" | "completo" → web vendida; el plan queda fijo
//   (sin PLAN)                          → se comporta como "completo"
//
// Todo el código pregunta aquí con puede(plan, 'funcion'). No poner
// "if (plan === ...)" en otros archivos.

export const PLANES = ['basico', 'profesional', 'completo'] as const
export type PlanId = (typeof PLANES)[number]

export const NOMBRES_PLAN: Record<PlanId, string> = { basico: 'Básico', profesional: 'Profesional', completo: 'Completo' }

/** Función → plan mínimo que la incluye. */
export const FUNCIONES = {
  // Básico
  catalogo: 'basico', // catálogo con fotos, precios, categorías y buscador (y "Pedir por WhatsApp")
  panel_productos: 'basico', // panel: productos, fotos, precios, inventario
  panel_textos: 'basico', // panel: textos de la tienda
  // Profesional
  carrito: 'profesional', // cesta y pedidos desde la tienda
  pedidos: 'profesional', // facturas/pedidos con estado, abonos, métodos de pago, PDF
  metodos_pago: 'profesional', // métodos de pago visibles en la tienda
  // Completo
  clientes: 'completo', // lista de clientes con saldos
  reportes: 'completo', // Inicio con números (ventas, por cobrar, stock bajo)
  inventario: 'completo', // reponer o descontar unidades rápido
  papelera: 'completo', // Papelera con 60 días para restaurar
  avisos: 'completo', // app del panel + avisos al teléfono
  aviso_correo: 'completo', // correo con cada pedido nuevo
} as const satisfies Record<string, PlanId>

export type Funcion = keyof typeof FUNCIONES

export const puede = (plan: PlanId, funcion: Funcion): boolean => PLANES.indexOf(plan) >= PLANES.indexOf(FUNCIONES[funcion])

/** Plan mínimo que necesita una función, con su nombre para mostrar. */
export const planMinimo = (funcion: Funcion): string => NOMBRES_PLAN[FUNCIONES[funcion]]

export const textoBloqueado = (funcion: Funcion) => `Disponible en el plan ${planMinimo(funcion)}`
export const MENSAJE_SIN_PLAN = 'Esta función no está incluida en tu plan'

export const PLAN_COOKIE = 'gadr_plan'
const COOKIE_DIAS = 30

export const esPlan = (value: unknown): value is PlanId => typeof value === 'string' && (PLANES as readonly string[]).includes(value)

export type PlanInfo = { plan: PlanId; demo: boolean }

export function cookieDelPlan(plan: PlanId, secure = true) {
  return `${PLAN_COOKIE}=${plan}; Path=/; Max-Age=${COOKIE_DIAS * 86400}; SameSite=Lax${secure ? '; Secure' : ''}`
}

function leerCookie(header: string | null | undefined, name: string) {
  for (const part of String(header || '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return ''
}

/**
 * Decide el plan.
 * - PLAN fijo ("basico", "profesional", "completo"): ese, sin importar la dirección.
 * - PLAN = "demo": ?plan= manda, luego la cookie; sin nada = completo.
 * - Sin PLAN (o raro): completo, para que nada de lo que ya funciona se rompa.
 */
export function resolverPlan(envPlan: unknown, cookieHeader: string | null | undefined, queryPlan?: string | null): PlanInfo & { desdeDireccion: boolean } {
  const configured = String(envPlan ?? '').trim().toLowerCase()
  if (esPlan(configured)) return { plan: configured, demo: false, desdeDireccion: false }
  if (configured === 'demo') {
    const fromQuery = String(queryPlan ?? '').trim().toLowerCase()
    if (esPlan(fromQuery)) return { plan: fromQuery, demo: true, desdeDireccion: true }
    const fromCookie = leerCookie(cookieHeader, PLAN_COOKIE)
    return { plan: esPlan(fromCookie) ? fromCookie : 'completo', demo: true, desdeDireccion: false }
  }
  return { plan: 'completo', demo: false, desdeDireccion: false }
}
