import React from 'react'

function centsOf(m) {
  if (m == null) return null
  if (typeof m === 'object') return m.cents ?? null
  return m
}

function clampPct(n) {
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n))
}

export function projectedCents(row) {
  if (!row) return 0
  if (row.projected_cents != null && typeof row.projected_cents === 'object' && row.projected_cents.cents != null) {
    return row.projected_cents.cents
  }
  if (typeof row.projected_cents === 'number') return row.projected_cents
  const paid = centsOf(row.actual_cents) ?? 0
  const quoted = centsOf(row.quoted_cents) ?? 0
  return Math.max(paid, quoted)
}

export const STATUS_META = {
  on_track: { label: 'On track', color: 'green' },
  at_risk: { label: 'At risk', color: 'amber' },
  over_budget: { label: 'Over budget', color: 'red' },
  no_budget: { label: 'No budget', color: 'slate' },
}

export function BudgetLegend({ className = '' }) {
  return (
    <ul className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-shale-600 dark:text-cursor-muted ${className}`}>
      <li className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-sm bg-sienna dark:bg-cursor-accent" aria-hidden="true" />
        Paid
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span className="bar-quoted h-2.5 w-4 rounded-sm" aria-hidden="true" />
        Quoted
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span className="h-3 w-0.5 rounded-sm bg-chocolate-800 dark:bg-white" aria-hidden="true" />
        Budget
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-sm bg-red-500" aria-hidden="true" />
        Over budget
      </li>
    </ul>
  )
}

export function BudgetBar({ budget, quoted, paid, compact = false, className = '' }) {
  const b = centsOf(budget)
  const q = centsOf(quoted) ?? 0
  const p = centsOf(paid) ?? 0
  const projected = Math.max(q, p)
  const hasBudget = b != null
  const scale = Math.max(hasBudget ? b : 0, q, p, projected, 1)
  const quotedPct = clampPct((q / scale) * 100)
  const paidPct = clampPct((p / scale) * 100)
  const projectedPct = clampPct((projected / scale) * 100)
  const budgetPct = hasBudget ? clampPct((b / scale) * 100) : null
  const over = hasBudget && projected > b
  const overflowLeft = budgetPct
  const overflowWidth = over ? Math.max(0, projectedPct - budgetPct) : 0
  const trackH = compact ? 'h-2' : 'h-3'

  return (
    <div className={className}>
      <div className={`relative w-full ${trackH} rounded-full bg-calm dark:bg-cursor-elevated`}>
        {q > 0 && (
          <div
            className="bar-quoted absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${quotedPct}%` }}
            title={`Quoted ${q}`}
          />
        )}
        {p > 0 && (
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-sienna dark:bg-cursor-accent"
            style={{ width: `${paidPct}%` }}
            title="Amount paid so far"
          />
        )}
        {over && overflowWidth > 0 && (
          <div
            className="absolute inset-y-0 bg-red-500/80"
            style={{ left: `${overflowLeft}%`, width: `${overflowWidth}%` }}
            title="Over budget"
          />
        )}
        {budgetPct != null && (
          <div
            className="absolute -top-1 -bottom-1 w-0.5 rounded-sm bg-chocolate-800 dark:bg-white"
            style={{ left: `${budgetPct}%` }}
            title="Budget"
          />
        )}
      </div>
    </div>
  )
}
