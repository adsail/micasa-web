import React from 'react'

// Header account control: who is signed in, plus Log out. Only rendered when
// AUTH_ENABLED is on; with auth off the header looks exactly as it always has.
export default function AccountMenu({ username, onLogout }) {
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const ref = React.useRef(null)

  React.useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const logout = async () => {
    if (busy) return
    setBusy(true)
    try {
      await onLogout?.()
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-10 items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-2.5 text-white transition hover:bg-white/20"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
        <span className="hidden max-w-[9rem] truncate text-sm font-semibold sm:inline">{username}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-xl border border-shale/70 bg-white shadow-xl dark:border-cursor-border dark:bg-cursor-elevated"
        >
          <div className="border-b border-calm px-4 py-3 dark:border-cursor-border">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-shale-500 dark:text-cursor-muted">Signed in as</div>
            <div className="truncate text-sm font-semibold text-chocolate dark:text-cursor-text">{username}</div>
          </div>
          <button
            role="menuitem"
            onClick={logout}
            disabled={busy}
            className="w-full px-4 py-3 text-left text-sm font-semibold text-chocolate transition hover:bg-calm disabled:opacity-50 dark:text-cursor-text dark:hover:bg-cursor-border"
          >
            {busy ? 'Logging out…' : 'Log out'}
          </button>
        </div>
      )}
    </div>
  )
}
