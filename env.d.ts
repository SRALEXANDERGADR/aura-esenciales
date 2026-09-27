// Tipado mínimo de las variables/secretos de Cloudflare Workers usados por la app.
// Cuando ejecutes `pnpm cf-typegen` (o `npm run cf-typegen`), Wrangler generará
// `worker-configuration.d.ts` con el tipado completo a partir de `wrangler.jsonc`
// y este archivo puede eliminarse si prefieres depender solo del generado.
interface Env {
  DATABASE_URL: string
  ADMIN_PASSWORD: string
  SESSION_SECRET: string
  // Almacén de fotos en Cloudflare R2 (ver wrangler.jsonc). Si no está, las fotos van a GitHub.
  FOTOS?: R2Bucket
  // Subida de imágenes de producto a GitHub (opcional). Ver README.md.
  GITHUB_TOKEN?: string
  // Formato "usuario/repositorio"
  GITHUB_REPO?: string
  // Rama donde se guardan las imágenes (por defecto "main")
  GITHUB_BRANCH?: string
  // Carpeta del repo donde se guardan las imágenes (por defecto "public/products")
  GITHUB_UPLOAD_PATH?: string
  // Envío de correo de aviso de pedidos con Resend (https://resend.com). Ver README.md.
  RESEND_API_KEY?: string
  // Remitente del correo, ej. "Aura Beauty <pedidos@tudominio.com>" (opcional)
  RESEND_FROM_EMAIL?: string
}

declare module 'cloudflare:workers' {
  export const env: Env
}
