import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { buildSessionCookie, comparePassword, createSessionToken, sameOrigin } from '@/lib/auth'

export const Route = createFileRoute('/api/auth/login')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!sameOrigin(request)) return Response.json({ error: 'Acceso no permitido.' }, { status: 403 })
        const body = (await request.json().catch(() => ({}))) as { password?: string }
        const password = String(body.password || '')

        if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
          return Response.json({ error: 'El servidor no tiene configuradas las variables de administración.' }, { status: 500 })
        }
        if (!password || password.length > 200 || !(await comparePassword(password, env.ADMIN_PASSWORD))) {
          // Espera un poco para que no se puedan probar muchas contraseñas seguidas.
          await new Promise((resolve) => setTimeout(resolve, 1200))
          return Response.json({ error: 'Contraseña incorrecta.' }, { status: 401 })
        }

        const token = await createSessionToken(env.SESSION_SECRET)
        return Response.json(
          { authenticated: true },
          { status: 200, headers: { 'Set-Cookie': buildSessionCookie(token) } },
        )
      },
    },
  },
})
