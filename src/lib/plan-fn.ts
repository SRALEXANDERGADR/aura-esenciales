import { createServerFn } from '@tanstack/react-start'
import { cookieDelPlan, resolverPlan, type PlanInfo } from './plan'

/**
 * Lee el plan en el servidor (cookie o ?plan=) para que la página salga bien
 * desde el principio, sin parpadeo. En modo demo, ?plan= guarda la cookie.
 */
export const loadPlan = createServerFn({ method: 'GET' }).handler(async (): Promise<PlanInfo> => {
  try {
    const { env } = await import('cloudflare:workers')
    const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server')
    const request = getRequest()
    const url = new URL(request.url)
    const info = resolverPlan(env.PLAN, request.headers.get('cookie'), url.searchParams.get('plan'))
    if (info.demo && info.desdeDireccion) setResponseHeader('Set-Cookie', cookieDelPlan(info.plan, url.protocol === 'https:'))
    return { plan: info.plan, demo: info.demo }
  } catch (caught) {
    console.error('No se pudo leer el plan:', caught)
    return { plan: 'completo', demo: false }
  }
})
