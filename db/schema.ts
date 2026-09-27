import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

export const products = pgTable(
  'products',
  {
    id: serial().primaryKey(),
    code: text().notNull(),
    name: text().notNull(),
    category: text().notNull().default('Cuidado personal'),
    description: text().notNull().default(''),
    priceCents: integer('price_cents').notNull(),
    stock: integer().notNull().default(0),
    imageUrl: text('image_url').notNull().default(''),
    featured: boolean().notNull().default(false),
    active: boolean().notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    // Fecha en que se mandó a la Papelera (null = no está en la Papelera).
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('products_code_idx').on(table.code), index('products_category_idx').on(table.category)],
)

export const customers = pgTable(
  'customers',
  {
    id: serial().primaryKey(),
    name: text().notNull(),
    phone: text().notNull(),
    email: text().notNull().default(''),
    address: text().notNull().default(''),
    notes: text().notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    // Fecha en que se mandó a la Papelera (null = no está en la Papelera).
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('customers_name_idx').on(table.name), index('customers_phone_idx').on(table.phone)],
)

export const invoices = pgTable(
  'invoices',
  {
    id: serial().primaryKey(),
    number: text().notNull(),
    customerId: integer('customer_id').notNull().references(() => customers.id),
    subtotalCents: integer('subtotal_cents').notNull(),
    discountCents: integer('discount_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull(),
    paidCents: integer('paid_cents').notNull().default(0),
    status: text().notNull().default('pending'),
    notes: text().notNull().default(''),
    dueDate: timestamp('due_date', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    // Fecha en que se mandó a la Papelera (null = no está en la Papelera).
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('invoices_number_idx').on(table.number), index('invoices_customer_idx').on(table.customerId)],
)

export const invoiceItems = pgTable(
  'invoice_items',
  {
    id: serial().primaryKey(),
    invoiceId: integer('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
    productId: integer('product_id').references(() => products.id),
    productCode: text('product_code').notNull(),
    productName: text('product_name').notNull(),
    quantity: integer().notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    totalCents: integer('total_cents').notNull(),
  },
  (table) => [index('invoice_items_invoice_idx').on(table.invoiceId)],
)

export const siteContent = pgTable('site_content', {
  key: text().primaryKey(),
  value: text().notNull().default(''),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const payments = pgTable(
  'payments',
  {
    id: serial().primaryKey(),
    invoiceId: integer('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
    amountCents: integer('amount_cents').notNull(),
    method: text().notNull().default('Efectivo'),
    note: text().notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('payments_invoice_idx').on(table.invoiceId)],
)

// Teléfonos/computadoras que reciben el aviso de cada pedido nuevo (app "Aura Admin").
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: serial().primaryKey(),
  endpoint: text().notNull().unique(),
  p256dh: text().notNull(),
  auth: text().notNull(),
  label: text().notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// Ajustes privados del servidor (ej. las claves de los avisos). Nunca se mandan al navegador.
export const appSettings = pgTable('app_settings', {
  key: text().primaryKey(),
  value: text().notNull().default(''),
})
