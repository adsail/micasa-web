import React from 'react'
import { api } from '../api'

const inputClass =
  'w-full rounded-lg border border-shale bg-white px-3 py-2 text-sm text-chocolate-900 shadow-sm outline-none transition focus:border-sienna focus:ring-2 focus:ring-sienna/30 dark:focus:border-cursor-accent dark:focus:ring-cursor-accent/30 dark:border-cursor-border dark:bg-cursor-elevated dark:text-cursor-text disabled:cursor-not-allowed disabled:opacity-60'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-shale-600 dark:text-cursor-secondary'

// Login wall shown only when AUTH_ENABLED is on and there is no valid session.
// No app chrome (tabs, bell, data) renders behind it.
export default function LoginPage({ theme, onToggleTheme, onSuccess }) {
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [error, setError] = React.useState(null)
  const [submitting, setSubmitting] = React.useState(false)

  const canSubmit = username.trim() && password && !submitting

  const submit = async (e) => {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const me = await api.login(username.trim(), password)
      setPassword('')
      onSuccess?.(me)
    } catch (err) {
      setError(err.message || 'Login failed')
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-12">
      <button
        onClick={onToggleTheme}
        aria-label="Toggle theme"
        className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-xl border border-shale/70 bg-white text-chocolate transition hover:bg-calm dark:border-cursor-border dark:bg-cursor-surface dark:text-cursor-text dark:hover:bg-cursor-elevated"
      >
        {theme === 'dark' ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
        )}
      </button>

      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="h-20 w-20 overflow-hidden rounded-2xl shadow-lg">
            <img src="/house.png?v=4" alt="" className="h-full w-full object-cover object-top" />
          </div>
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-chocolate dark:text-cursor-text">micasa</h1>
          <p className="mt-1 text-sm text-shale-600 dark:text-cursor-secondary">Sign in to continue</p>
        </div>

        <form
          onSubmit={submit}
          className="space-y-4 rounded-2xl border border-shale/70 bg-white p-6 shadow-sm dark:border-cursor-border dark:bg-cursor-surface"
        >
          <div>
            <label className={labelClass} htmlFor="login-username">Username</label>
            <input
              id="login-username"
              className={inputClass}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              disabled={submitting}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={submitting}
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full rounded-xl bg-sienna px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sienna-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-cursor-accent dark:text-cursor dark:hover:bg-cursor-accent-hover"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
