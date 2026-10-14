import { useRouteContext } from '@tanstack/react-router'
import { puede, type Funcion, type PlanId } from './plan'

/** Plan de esta visita (lo calcula el servidor en la ruta raíz). */
export function usePlan() {
  const context = useRouteContext({ strict: false }) as { planInfo?: { plan: PlanId; demo: boolean } }
  const plan: PlanId = context.planInfo?.plan ?? 'completo'
  const demo = Boolean(context.planInfo?.demo)
  return { plan, demo, can: (funcion: Funcion) => puede(plan, funcion) }
}
