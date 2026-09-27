import { createFileRoute } from '@tanstack/react-router'
import { Storefront } from '@/components/Storefront'

export const Route = createFileRoute('/')({
  // El manifest de la tienda va solo aquí, para no chocar con el de la app del panel.
  head: () => ({ links: [{ rel: 'manifest', href: '/manifest.json' }] }),
  component: Storefront,
})
