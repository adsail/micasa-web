import React from 'react'

// Full-screen mobile nav that fans its items out with a staggered slide/fade,
// mirroring the cursor.com-style menu. Desktop uses the inline tab row instead.
export default function MobileMenu({ open, onClose, tabs, active, onSelect }) {
  const [mounted, setMounted] = React.useState(false)
  const [show, setShow] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setMounted(true)
      // next frame -> trigger the enter transition
      const r = requestAnimationFrame(() => setShow(true))
      return () => cancelAnimationFrame(r)
    } else if (mounted) {
      setShow(false)
      const t = setTimeout(() => setMounted(false), 260)
      return () => clearTimeout(t)
    }
  }, [open, mounted])

  React.useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!mounted) return null

  return (
    <div className="fixed inset-0 z-50 sm:hidden" role="dialog" aria-modal="true" aria-label="Menu">
      <div
        className={`absolute inset-0 bg-chocolate-950/40 backdrop-blur-sm transition-opacity duration-200 dark:bg-black/60 ${show ? 'opacity-100' : 'opacity-0'}`}
        aria-hidden="true"
        onMouseDown={onClose}
      />
      <div
        className={`absolute inset-x-0 top-0 origin-top overflow-hidden rounded-b-2xl bg-calm shadow-2xl transition-all duration-250 ease-out dark:bg-cursor-surface ${show ? 'translate-y-0 opacity-100' : '-translate-y-3 opacity-0'}`}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-2">
          <span className="text-xs font-bold uppercase tracking-widest text-shale-500 dark:text-cursor-muted">Menu</span>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="grid h-9 w-9 place-items-center rounded-lg text-shale-500 transition hover:bg-shale/20 hover:text-chocolate dark:text-cursor-muted dark:hover:bg-cursor-elevated dark:hover:text-cursor-text"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <nav className="flex flex-col px-3 pb-4">
          {tabs.map((t, i) => (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              style={{ transitionDelay: `${show ? 40 + i * 35 : 0}ms` }}
              className={`transform rounded-xl px-4 py-3 text-left text-lg font-semibold transition-all duration-200 ease-out ${
                show ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'
              } ${
                active === t.id
                  ? 'bg-sienna text-white dark:bg-cursor-accent dark:text-cursor'
                  : 'text-chocolate hover:bg-shale/20 dark:text-cursor-text dark:hover:bg-cursor-elevated'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  )
}
