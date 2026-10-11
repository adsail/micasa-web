export function money(m) {
  if (m == null) return '—'
  const dollars = typeof m === 'object' ? m.dollars : m / 100
  if (dollars == null) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: dollars % 1 === 0 ? 0 : 2,
  }).format(dollars)
}

export function moneySigned(m) {
  if (m == null) return 'n/a'
  const dollars = typeof m === 'object' ? m.dollars : m / 100
  if (dollars == null) return 'n/a'
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: dollars % 1 === 0 ? 0 : 2,
  }).format(Math.abs(dollars))
  if (dollars > 0) return `+${formatted}`
  if (dollars < 0) return `-${formatted}`
  return formatted
}

export function pctSigned(n) {
  if (n == null || Number.isNaN(n)) return 'n/a'
  const rounded = Math.round(Number(n) * 10) / 10
  const body = `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`
  if (rounded > 0) return `+${body}`
  return body
}

export function fmtDate(s) {
  if (!s) return '—'
  const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s)
  if (isNaN(d)) return s
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function fmtNum(n) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US').format(n)
}

export function titleCase(s) {
  if (!s) return ''
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
