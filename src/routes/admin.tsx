import { createFileRoute } from '@tanstack/react-router'
import { AdminPanel } from '@/components/AdminPanel'

// El panel se puede instalar como app ("Aura Admin") con su propio ícono y
// recibe los avisos de pedidos nuevos (ver public/admin-sw.js).
export const Route = createFileRoute('/admin')({
  head: () => ({
    meta: [
      { title: 'Aura Admin — Aura Beauty' },
      { name: 'robots', content: 'noindex, nofollow' },
      { name: 'theme-color', content: '#3e4938' },
      { name: 'apple-mobile-web-app-title', content: 'Aura Admin' },
    ],
    // El manifest de la app NO va aquí: lo agrega el panel solo después de
    // entrar con la contraseña, así nadie más ve la oferta de instalarlo.
    links: [{ rel: 'apple-touch-icon', href: '/admin-192.png' }],
  }),
  component: AdminPanel,
})
