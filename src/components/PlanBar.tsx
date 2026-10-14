import { useLocation } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { NOMBRES_PLAN, PLANES, PLAN_COOKIE, cookieDelPlan } from '@/lib/plan'
import { usePlan } from '@/lib/plan-client'

/** Barrita de la demo: "Demo · Plan Básico · Cambiar plan" y "Ver precios". Solo en modo demo. */
export function PlanBar() {
  const { plan, demo } = usePlan()
  const location = useLocation()
  const [open, setOpen] = useState(false)

  // Respaldo: si el servidor no pudo guardar la cookie, se guarda aquí.
  useEffect(() => {
    if (!demo) return
    try { if (!document.cookie.includes(`${PLAN_COOKIE}=${plan}`)) document.cookie = cookieDelPlan(plan, window.location.protocol === 'https:') } catch { /* sin cookies */ }
  }, [demo, plan])

  if (!demo) return null

  const choose = (next: string) => {
    const url = new URL(window.location.href)
    url.searchParams.set('plan', next)
    window.location.href = url.toString()
  }

  return <div className={`plan-bar ${location.pathname.startsWith('/admin') ? 'on-admin' : ''}`}>
    <span>Demo · Plan {NOMBRES_PLAN[plan]}</span>
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>Cambiar plan</button>
    <a href="https://gadrnet.com" target="_blank" rel="noopener noreferrer">Ver precios</a>
    {open && <div className="plan-bar-menu" role="menu">{PLANES.map((item) => <button type="button" role="menuitem" key={item} className={item === plan ? 'active' : ''} onClick={() => choose(item)}>{NOMBRES_PLAN[item]}</button>)}</div>}
  </div>
}
