import React from 'react'
import { api } from './api'
import { useAsync, Spinner, ErrorBox, Stat } from './components/ui'
import { fmtNum } from './format'
import HouseTab from './components/HouseTab'
import ProjectsTab from './components/ProjectsTab'
import QuotesTab from './components/QuotesTab'
import MaintenanceTab from './components/MaintenanceTab'
import IncidentsTab from './components/IncidentsTab'
import AppliancesTab from './components/AppliancesTab'
import VendorsTab from './components/VendorsTab'
import DocsTab from './components/DocsTab'
import OpExTab from './components/OpExTab'
import MobileMenu from './components/MobileMenu'

const TABS = [
  { id: 'house', label: 'House', C: HouseTab },
  { id: 'projects', label: 'Projects', C: ProjectsTab },
  { id: 'quotes', label: 'Quotes', C: QuotesTab },
  { id: 'maintenance', label: 'Maintenance', C: MaintenanceTab },
  { id: 'incidents', label: 'Incidents', C: IncidentsTab },
  { id: 'appliances', label: 'Appliances', C: AppliancesTab },
  { id: 'vendors', label: 'Vendors', C: VendorsTab },
  { id: 'docs', label: 'Docs', C: DocsTab },
  { id: 'opex', label: 'Home OpEx', C: OpExTab },
]

function useTheme() {
  const [theme, setTheme] = React.useState(() => {
    try {
      return (
        localStorage.getItem('micasa-theme') ||
        (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      )
    } catch {
      return 'light'
    }
  })
  React.useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') root.classList.add('dark')
    else root.classList.remove('dark')
    try {
      localStorage.setItem('micasa-theme', theme)
    } catch {}
  }, [theme])
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))]
}

function ThemeToggle({ theme, toggle }) {
  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      className="grid h-10 w-10 place-items-center rounded-xl border border-white/20 bg-white/10 text-white transition hover:bg-white/20"
    >
      {theme === 'dark' ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
      )}
    </button>
  )
}

function NotificationBell({ count, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-label={count > 0 ? `${count} overdue maintenance items` : 'Maintenance notifications'}
      className="relative grid h-10 w-10 place-items-center rounded-xl border border-white/20 bg-white/10 text-white transition hover:bg-white/20"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
      {count > 0 && (
        <span className="absolute -right-1 -top-1 grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-red-500 px-1 text-[11px] font-bold leading-none text-white shadow ring-2 ring-sienna dark:ring-cursor">
          {count}
        </span>
      )}
    </button>
  )
}

function overdueLabel(days) {
  if (days == null) return ''
  if (days <= 0) return 'due today'
  return `${days} ${days === 1 ? 'day' : 'days'} overdue`
}

function OverdueDrawer({ open, onClose, state, onSelect }) {
  React.useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  const items = state.data?.items || []

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Overdue maintenance">
      <div
        className="absolute inset-0 bg-chocolate-950/50 backdrop-blur-sm dark:bg-black/60"
        aria-hidden="true"
        onMouseDown={onClose}
      />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col border-l border-shale/70 bg-white shadow-xl dark:border-cursor-border dark:bg-cursor-surface">
        <div className="flex items-center justify-between border-b border-calm px-5 py-4 dark:border-cursor-border">
          <h3 className="text-base font-bold tracking-tight text-chocolate dark:text-cursor-text">
            Overdue maintenance
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-lg text-shale-500 transition hover:bg-calm hover:text-chocolate dark:hover:bg-cursor-elevated dark:hover:text-cursor-text"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {state.loading ? (
            <Spinner />
          ) : state.error ? (
            <ErrorBox error={state.error} />
          ) : !items.length ? (
            <div className="py-16 text-center text-sm text-shale-500 dark:text-cursor-muted">All caught up ✅</div>
          ) : (
            <ul className="space-y-2">
              {items.map((m) => (
                <li key={m.id}>
                  <button
                    onClick={onSelect}
                    className="flex w-full items-start justify-between gap-3 rounded-xl border border-shale/70 border-l-4 border-l-red-500 bg-white p-4 text-left transition hover:bg-calm dark:border-cursor-border dark:border-l-red-500 dark:bg-cursor-elevated dark:hover:bg-cursor-border"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-chocolate dark:text-cursor-text">{m.name}</div>
                      {m.category_name && (
                        <div className="mt-0.5 truncate text-xs text-shale-500 dark:text-cursor-muted">{m.category_name}</div>
                      )}
                    </div>
                    <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-red-600 dark:text-red-300">
                      {overdueLabel(m.days_overdue)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t border-calm px-5 py-3 dark:border-cursor-border">
          <button
            onClick={onSelect}
            className="w-full rounded-xl px-4 py-2 text-center text-sm font-semibold text-sienna transition hover:bg-calm dark:text-cursor-accent dark:hover:bg-cursor-elevated"
          >
            View all in Maintenance
          </button>
        </div>
      </div>
    </div>
  )
}

function HeaderCard({ house }) {
  if (!house) return null
  const bits = [
    house.city && house.state ? `${house.city}, ${house.state}` : null,
    house.bedrooms != null ? `${house.bedrooms} bd` : null,
    house.bathrooms != null ? `${house.bathrooms} ba` : null,
    house.square_feet ? `${fmtNum(house.square_feet)} sqft` : null,
    house.year_built ? `built ${house.year_built}` : null,
  ].filter(Boolean)
  return (
    <div className="flex items-start gap-4 text-white">
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl shadow-lg sm:h-20 sm:w-20">
        <img
          src="/house.png?v=4"
          alt="Chalet House"
          className="h-full w-full object-cover object-top"
        />
      </div>
      <div className="min-w-0 pt-0.5">
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{house.nickname || 'micasa'}</h1>
        <p className="mt-1 text-sm font-medium text-white/80">{bits.join('  ·  ')}</p>
      </div>
    </div>
  )
}

export default function App() {
  const [theme, toggle] = useTheme()
  const [active, setActive] = React.useState(() => {
    const h = window.location.hash.replace('#', '')
    return TABS.some((t) => t.id === h) ? h : 'house'
  })
  const houseState = useAsync(() => api.house(), [])
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const overdueState = useAsync(() => api.maintenanceOverdue(), [])
  const overdueCount = overdueState.data?.count ?? 0

  React.useEffect(() => {
    window.location.hash = active
  }, [active])

  const gotoMaintenance = () => {
    setDrawerOpen(false)
    setActive('maintenance')
  }

  const ActiveC = TABS.find((t) => t.id === active)?.C || HouseTab

  return (
    <div className="min-h-full">
      <header className="bg-gradient-to-br from-sienna via-sienna-700 to-chocolate shadow-lg dark:bg-cursor dark:bg-none dark:border-b dark:border-cursor-border dark:shadow-none">
        <div className="mx-auto max-w-6xl px-4 pt-6 pb-0 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <HeaderCard house={houseState.data} />
            <div className="flex shrink-0 items-center gap-2">
              <NotificationBell count={overdueCount} onClick={() => setDrawerOpen(true)} />
              <ThemeToggle theme={theme} toggle={toggle} />
              <button
                onClick={() => setMenuOpen(true)}
                aria-label="Open menu"
                className="grid h-9 w-9 place-items-center rounded-lg text-white/90 transition hover:bg-white/10 sm:hidden"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
              </button>
            </div>
          </div>
          <nav className="mt-5 hidden flex-wrap gap-1 overflow-x-auto sm:flex">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setActive(t.id)}
                className={`whitespace-nowrap rounded-t-lg px-4 py-2.5 text-sm font-semibold transition ${
                  active === t.id
                    ? 'bg-calm text-chocolate dark:bg-cursor-surface dark:text-cursor-text'
                    : 'text-white/80 hover:bg-white/10 hover:text-white'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {houseState.loading && active === 'house' ? (
          <Spinner />
        ) : houseState.error && active === 'house' ? (
          <ErrorBox error={houseState.error} />
        ) : (
          <ActiveC house={houseState.data} />
        )}
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-10 pt-4 text-center text-xs text-shale-500 dark:text-cursor-muted sm:px-6">
        micasa · {houseState.data?.nickname}
      </footer>

      <MobileMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        tabs={TABS}
        active={active}
        onSelect={(id) => { setActive(id); setMenuOpen(false) }}
      />

      <OverdueDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        state={overdueState}
        onSelect={gotoMaintenance}
      />
    </div>
  )
}
