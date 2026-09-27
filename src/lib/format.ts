// "RD$1,250" en todos los teléfonos (algunos mostraban "DOP 1,250").
export const currency = (cents: number) =>
  `${cents < 0 ? '-' : ''}RD$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(Math.abs(cents) / 100))}`

export const shortDate = (value: string | Date | null) => {
  if (!value) return 'Sin fecha'
  return new Intl.DateTimeFormat('es-DO', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
}
