# AGENTS.md

## Descripción

Aura Beauty es una tienda de cuidado personal con catálogo público,
carrito, registro de pedidos y un panel administrativo protegido. El panel
gestiona inventario, clientes, facturas, saldos y abonos.

## Tecnologías

- TanStack Start, React 19 y TypeScript estricto.
- Tailwind CSS 4 más estilos propios en `src/styles.css`.
- Rutas de servidor de TanStack Start (`src/routes/api/`) para la API HTTP,
  desplegadas como Cloudflare Worker vía `@cloudflare/vite-plugin`.
- PostgreSQL en Neon con Drizzle ORM (`drizzle-orm/neon-http`).
- Autenticación administrativa propia: `ADMIN_PASSWORD` (secreto de
  Cloudflare) + cookie de sesión firmada con HMAC-SHA256 (`SESSION_SECRET`).

## Arquitectura

- `src/routes/index.tsx`: entrada de la tienda pública.
- `src/routes/admin.tsx`: entrada del panel administrativo.
- `src/components/Storefront.tsx`: catálogo, filtros, carrito y checkout.
- `src/components/AdminPanel.tsx`: autenticación y módulos de gestión.
- `src/routes/api/$.ts`: API de productos, pedidos, clientes, facturas y
  pagos (catch-all bajo `/api/*`).
- `src/routes/api/auth/login.ts`, `logout.ts`, `me.ts`: sesión del panel.
- `src/lib/auth.ts`: firma y verificación de la cookie de sesión.
- `db/schema.ts`: definición de tablas Postgres.
- `db/index.ts`: cliente Drizzle sobre Neon (`neon-http`), lee `DATABASE_URL`
  desde el binding de entorno de Cloudflare Workers (`cloudflare:workers`).
- `db/migrations/`: migraciones SQL, aplicadas manualmente o con
  `drizzle-kit`.
- `src/types.ts`: contratos compartidos por la interfaz.
- `wrangler.jsonc`: configuración del Worker de Cloudflare.

## Convenciones

- Componentes React en PascalCase; funciones y variables en camelCase.
- Valores monetarios almacenados como enteros en centavos (`priceCents`, `totalCents`).
- Columnas Postgres en snake_case y propiedades TypeScript en camelCase.
- Las operaciones administrativas siempre requieren una cookie de sesión
  válida, emitida solo tras autenticarse con `ADMIN_PASSWORD`.
- Los pedidos públicos solo pueden crear facturas; nunca acceden a datos
  administrativos.
- No guardar datos persistentes en JSON, `localStorage` o memoria.
  `localStorage` se usa solo para el carrito temporal del navegador y, en el
  plan Completo, para que el teléfono del cliente recuerde sus pedidos
  (número + clave, `aura-mis-pedidos`) y sus datos de contacto
  (`aura-cliente`).

## Decisiones Importantes

- Eliminar un producto lo oculta (`active = false`) para conservar el
  historial de facturas.
- Cada producto requiere un código único.
- El estado de una factura se deriva del monto pagado y de su fecha límite.
- Las primeras muestras del catálogo se insertan en la base de datos al abrir
  una instalación vacía.
- Migración desde Netlify (agosto 2026): se reemplazaron Netlify Functions
  por rutas de servidor de TanStack Start, Netlify Database por Neon
  (`drizzle-orm/neon-http`) y Netlify Identity por un login de contraseña
  única + cookie firmada. El diseño, la interfaz y el modelo de datos no
  cambiaron.

## Desarrollo

Usar `pnpm dev` (usa el plugin de Vite de Cloudflare, así que el servidor de
desarrollo ya corre dentro del runtime de Workers). Copia
`.dev.vars.example` a `.dev.vars` con `DATABASE_URL`, `ADMIN_PASSWORD` y
`SESSION_SECRET` antes de arrancar. No editar migraciones ya aplicadas;
actualizar `db/schema.ts` y generar una migración nueva con
`pnpm db:generate`.

## Planes

La tienda se vende en 3 planes con el MISMO código. El plan se escoge con la variable `PLAN` en `wrangler.jsonc` (`vars`):

- `"demo"`: web de muestra. El plan se escoge con la dirección (`?plan=basico`, `?plan=profesional` o `?plan=completo`) y se guarda en la cookie `gadr_plan` (30 días). Sin nada = completo. Arriba sale la barra de la demo de GADR (`src/components/GadrDemo.tsx` + `src/gadr-demo.css`, el mismo archivo en todas las webs de GADR): los 3 planes con su precio (tocar uno abre la web en ese plan) y "Planes", que abre los precios, lo que trae cada plan y una tabla para comparar, con "Probar" y "Lo quiero" (lleva a gadrnet.com con el plan escogido). Lee los precios de `public/gadr-planes.json`. Los elementos fijos de arriba usan `top: var(--gd-h, 0px)` para quedar debajo de la barra.
- `"basico"`, `"profesional"` o `"completo"`: web ya vendida. El plan queda fijo y no se puede cambiar desde la dirección.
- Sin `PLAN`: se comporta como `completo`.

Para subir de plan a un cliente: cambiar `PLAN` y volver a publicar. No se borra nada; al bajar de plan lo que sobra se esconde y al subir vuelve a salir.

Dónde está todo:

- `src/lib/plan.ts`: lista de funciones y su plan mínimo (`FUNCIONES`) y `puede(plan, funcion)`. Todo el código pregunta aquí; no poner `if (plan === ...)` en otros archivos.
- `src/lib/plan-fn.ts`: el servidor lee el plan (cookie o `?plan=`) en la ruta raíz, para que la página salga bien desde el principio. `src/lib/plan-client.ts` (`usePlan`) lo entrega a los componentes.
- `src/routes/api/$.ts`: cada ruta rechaza lo que el plan no incluye con "Esta función no está incluida en tu plan" (403), y `/api/dashboard` solo entrega los datos del plan.
- `public/gadr-planes.json`: planes, precios y frases para gadrnet.com y la barra de la demo (se entrega como archivo fijo; `public/_headers` permite leerlo desde otro sitio). Las listas `incluye` van completas (cada plan repite lo del anterior con la misma frase), así se calcula solo "Todo lo del plan X, y además" y la tabla para comparar.

Qué lleva cada plan:

- **Básico (RD$500/mes, entrada RD$1,000)**: catálogo con fotos, precios, categorías y buscador; botón "Pedir por WhatsApp" en cada producto (sin cesta); panel con Productos (fotos, precios, cantidades) y Textos. Sin cesta, pedidos, facturas, clientes, números, papelera ni avisos.
- **Profesional (RD$750/mes, entrada RD$1,500, "Más elegido")**: todo lo del Básico + cesta y pedidos desde la tienda, pestaña Facturas (estado, abonos con método de pago, PDF, crear facturas a mano) y métodos de pago visibles en la tienda.
- **Completo (RD$1,000/mes, entrada RD$2,000)**: todo lo anterior + «Mis pedidos y pagos» para el cliente (`seguimiento`), recordatorio de pago en imagen (`recordatorio`), «Mandar por WhatsApp» con enlace de cada producto (`compartir`), satisfacción garantizada por producto (`satisfaccion`), pestaña Inicio con números, pestaña Clientes con saldos, reponer inventario con un toque, Papelera (60 días), App del panel con avisos al teléfono y correo con cada pedido nuevo.

En modo demo, lo que el plan no incluye sale en el panel con candado y el texto "Disponible en el plan X". En una web de cliente no sale.

Para agregar una función nueva: ponerla en `FUNCIONES`, esconderla en la pantalla con `can('funcion')` (de `usePlan`) y rechazarla en el servidor con `need(plan, 'funcion')`. Actualizar `public/gadr-planes.json`.


## Plan Completo: funciones que vienen de JB Tech Store (con otro nombre y otro diseño)

- **«Mis pedidos y pagos»** (`seguimiento`): cada factura guarda una clave secreta (`invoices.access_token`; se crea siempre). Al hacer un pedido, el teléfono guarda número + clave (`aura-mis-pedidos`) y los datos del cliente (`aura-cliente`, para llenar el formulario la próxima vez). El botón «Mis pagos» sale arriba cuando ya hay pedidos. Cada pedido muestra un círculo con lo que ya pagó, «Te falta RD$…», la fecha límite, los productos, sus abonos y cómo pagar (con «Ya pagué: enviar comprobante» por WhatsApp). Si no ha pagado nada puede **pedir que lo cancelen**: no se cancela solo (la tienda pudo haberlo entregado a crédito); queda `invoices.cancel_requested_at`, una nota en la factura y un aviso a la app, y en Facturas sale «Pidió cancelar». Para cancelarlo de verdad, la tienda lo manda a la Papelera (las unidades vuelven). Un pedido en la Papelera le sale al cliente como «Cancelado». API pública: `POST /api/mis-pedidos` (lista, con las claves) y `POST /api/mis-pedidos/cancelar`. Al cliente nunca se le mandan las notas internas.
- **Recordatorio de pago** (`recordatorio`): en el detalle de una factura con saldo, botón «Recordatorio de pago (imagen)». Dibuja un PNG (`src/lib/reminderImage.ts`, canvas) con «Te falta pagar», el círculo de lo pagado, los productos, los abonos y cómo pagar; lo comparte o lo descarga.
- **«Mandar por WhatsApp»** (`compartir`): en cada producto y en su ficha. Abre WhatsApp con el nombre, el precio y el enlace `/ver/<código>` (`src/routes/ver.$code.tsx`), que abre la tienda con esa ficha y trae las etiquetas `og:` (foto, nombre y precio; las lee `src/lib/product-fn.ts`). En la ficha también está «Copiar enlace». El tamaño de la portada (`og:image:width/height`) está en `index.tsx`, no en `__root.tsx`.
- **Satisfacción garantizada** (`satisfaccion`): `products.satisfaction_days` (0 = no tiene; botones rápidos: Sin garantía, 7, 15, 30 días). Se copia a la línea de la factura (`invoice_items.satisfaction_days`). Sale en la ficha, en «Mis pedidos y pagos», en la factura PDF y en el recordatorio, con las condiciones de Contenido → «Satisfacción garantizada» (`satisfaction_terms`).
- `ensureSchema()` ahora hace una sola consulta si ya están todas las columnas (`SCHEMA_PARTS`), en vez de correr todos los `ALTER` en cada arranque.
