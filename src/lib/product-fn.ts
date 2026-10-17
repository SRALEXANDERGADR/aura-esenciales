import { createServerFn } from '@tanstack/react-start'

/**
 * Datos de UN producto para el enlace de «Mandar por WhatsApp» (/ver/<código>):
 * el servidor los pone en las etiquetas de la página, así el enlace sale en
 * WhatsApp o Facebook con su foto, su nombre y su precio.
 */
export const loadProductMeta = createServerFn({ method: 'GET' })
  .inputValidator((code: string) => String(code || '').trim().toUpperCase().slice(0, 40))
  .handler(async ({ data }) => {
    try {
      const { db } = await import('../../db/index.js')
      const { products, siteContent } = await import('../../db/schema.js')
      const { and, eq, inArray, isNull } = await import('drizzle-orm')
      const [product] = await db
        .select({ code: products.code, name: products.name, description: products.description, priceCents: products.priceCents, imageUrl: products.imageUrl })
        .from(products)
        .where(and(eq(products.code, data), eq(products.active, true), isNull(products.deletedAt)))
        .limit(1)
      const names = await db.select({ key: siteContent.key, value: siteContent.value }).from(siteContent).where(inArray(siteContent.key, ['site_name', 'site_tagline']))
      const site = `${names.find((row) => row.key === 'site_name')?.value || 'Aura'} ${names.find((row) => row.key === 'site_tagline')?.value || 'Beauty'}`.replace(/\s+/g, ' ').trim()
      return { product: product ?? null, site }
    } catch (caught) {
      console.error('No se pudo leer el producto del enlace:', caught)
      return { product: null, site: 'Aura Beauty' }
    }
  })
