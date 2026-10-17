import { createFileRoute } from '@tanstack/react-router'
import { Storefront } from '@/components/Storefront'

export const Route = createFileRoute('/')({
  // El manifest de la tienda va solo aquí, para no chocar con el de la app del panel.
  // El tamaño de la portada va aquí (no en __root) para no aplicárselo a las
  // fotos de los productos en los enlaces de «Mandar por WhatsApp».
  head: () => ({
    meta: [{ property: 'og:image:width', content: '1200' }, { property: 'og:image:height', content: '630' }],
    links: [{ rel: 'manifest', href: '/manifest.json' }],
  }),
  component: Storefront,
})
