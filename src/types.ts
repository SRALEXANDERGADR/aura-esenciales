export type { SiteContent } from '@/lib/site-content'

export type Product = {
  id: number
  code: string
  name: string
  category: string
  description: string
  priceCents: number
  stock: number
  imageUrl: string
  images: string[]
  featured: boolean
  active: boolean
  deletedAt?: string | null
}

export type Customer = {
  id: number
  name: string
  phone: string
  email: string
  address: string
  notes: string
  balanceCents: number
  invoiceCount: number
  deletedAt?: string | null
}

export type InvoiceItem = {
  id: number
  productId: number | null
  productCode: string
  productName: string
  quantity: number
  unitPriceCents: number
  totalCents: number
}

export type Payment = {
  id: number
  amountCents: number
  method: string
  note: string
  createdAt: string
}

export type Invoice = {
  id: number
  number: string
  customerId: number
  customerName: string
  customerPhone: string
  subtotalCents: number
  discountCents: number
  totalCents: number
  paidCents: number
  balanceCents: number
  status: 'pending' | 'partial' | 'paid' | 'overdue'
  notes: string
  dueDate: string | null
  createdAt: string
  items: InvoiceItem[]
  payments: Payment[]
  deletedAt?: string | null
}

export type DashboardData = {
  products: Product[]
  customers: Customer[]
  invoices: Invoice[]
  trash: { days: number; products: Product[]; customers: Customer[]; invoices: Invoice[] }
  metrics: {
    salesCents: number
    receivableCents: number
    paidInvoices: number
    lowStock: number
  }
}
