import { createFileRoute } from '@tanstack/react-router'
import { Storefront } from '@/components/Storefront'
import { currency } from '@/lib/format'
import { loadProductMeta } from '@/lib/product-fn'

// Enlace de «Mandar por WhatsApp»: /ver/<código del producto>. Abre la tienda
// con la ficha de ese producto ya abierta y, al pegarlo en WhatsApp o Facebook,
// sale con su foto, su nombre y su precio. (El botón es del plan Completo; el
// enlace funciona en cualquier plan.)
const SITE_URL = 'https://aurabeauty.gadrnet.workers.dev'

export const Route = createFileRoute('/ver/$code')({
  loader: ({ params }) => loadProductMeta({ data: params.code }),
  head: ({ loaderData, params }) => {
    const links = [{ rel: 'manifest', href: '/manifest.json' }]
    const product = loaderData?.product
    if (!product) return { links }
    const title = `${product.name} · ${loaderData.site}`
    const image = new URL(product.imageUrl || '/og-portada.png', SITE_URL).toString()
    const description = `${currency(product.priceCents)} · ${(product.description || `Pídelo en ${loaderData.site}.`).replace(/\s+/g, ' ').trim()}`.slice(0, 200)
    return {
      links,
      meta: [
        { title },
        { name: 'description', content: description },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        { property: 'og:type', content: 'product' },
        { property: 'og:url', content: `${SITE_URL}/ver/${encodeURIComponent(params.code)}` },
        { property: 'og:image', content: image },
        { property: 'og:image:alt', content: product.name },
        { name: 'twitter:title', content: title },
        { name: 'twitter:description', content: description },
        { name: 'twitter:image', content: image },
      ],
    }
  },
  component: ProductLink,
})

function ProductLink() {
  const { code } = Route.useParams()
  return <Storefront initialCode={code} />
}
