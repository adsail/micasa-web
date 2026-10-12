import React from 'react'

export function Card({ children, className = '' }) {
  return (
    <div className={`rounded-2xl border border-shale/70 bg-white shadow-sm dark:border-cursor-border dark:bg-cursor-surface ${className}`}>
      {children}
    </div>
  )
}

export function Badge({ children, color = 'slate' }) {
  const map = {
    slate: 'bg-calm text-chocolate dark:bg-cursor-elevated dark:text-cursor-text',
    red: 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300 ring-1 ring-red-500/20',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 ring-1 ring-amber-500/20',
    green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 ring-1 ring-emerald-500/20',
    blue: 'bg-sienna-100 text-sienna-800 dark:bg-cursor-accent/15 dark:text-cursor-accent ring-1 ring-sienna-500/20',
    sienna: 'bg-sienna-100 text-sienna-800 dark:bg-cursor-accent/15 dark:text-cursor-accent ring-1 ring-sienna-500/20',
    violet: 'bg-tawny-200 text-chocolate-700 dark:bg-tawny-700/30 dark:text-tawny-200 ring-1 ring-tawny-500/20',
    tawny: 'bg-tawny-200 text-chocolate-700 dark:bg-tawny-700/30 dark:text-tawny-200 ring-1 ring-tawny-500/20',
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${map[color] || map.slate}`}>
      {children}
    </span>
  )
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-shale border-t-sienna" />
    </div>
  )
}

export function ErrorBox({ error }) {
  return (
    <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      Failed to load: {String(error?.message || error)}
    </div>
  )
}

export function Empty({ children = 'Nothing here yet.' }) {
  return <div className="py-16 text-center text-sm text-shale-500 dark:text-cursor-muted">{children}</div>
}

export function SectionTitle({ children, count }) {
  return (
    <div className="mb-4 flex items-baseline gap-2">
      <h2 className="text-xl font-bold tracking-tight">{children}</h2>
      {count != null && <span className="text-sm font-medium text-shale-500">{count}</span>}
    </div>
  )
}

export function Stat({ label, value, sub, title }) {
  return (
    <div className="flex flex-col" title={title}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-shale-500 dark:text-cursor-muted">{label}</span>
      <span className="text-sm font-semibold text-chocolate dark:text-cursor-text">{value ?? '—'}</span>
      {sub && <span className="text-xs text-shale-500">{sub}</span>}
    </div>
  )
}

export function useAsync(fn, deps = []) {
  const [state, setState] = React.useState({ loading: true, data: null, error: null })
  React.useEffect(() => {
    let alive = true
    setState({ loading: true, data: null, error: null })
    fn()
      .then((data) => alive && setState({ loading: false, data, error: null }))
      .catch((error) => alive && setState({ loading: false, data: null, error }))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state
}


export function Modal({ open, onClose, title, children }) {
  React.useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    // Prevent background scroll while the modal is open.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        // Close only when the backdrop itself is clicked (not inner content).
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div className="absolute inset-0 bg-chocolate-950/50 backdrop-blur-sm dark:bg-black/60" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-shale/70 bg-white shadow-xl dark:border-cursor-border dark:bg-cursor-surface">
        <div className="flex items-center justify-between border-b border-calm px-5 py-4 dark:border-cursor-border">
          <h3 className="text-base font-bold tracking-tight">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-lg text-shale-500 transition hover:bg-calm hover:text-chocolate dark:hover:bg-cursor-elevated dark:hover:text-cursor-text"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  )
}
