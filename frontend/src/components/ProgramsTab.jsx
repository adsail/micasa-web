import React from 'react'
import { api } from '../api'
import { Card, Spinner, ErrorBox, Empty, SectionTitle, Badge, Modal, Stat } from './ui'
import { money } from '../format'

const STATUS_COLOR = {
  completed: 'green',
  abandoned: 'slate',
  underway: 'sienna',
  delayed: 'red',
  quoted: 'amber',
  planned: 'amber',
}

const inputClass =
  'w-full rounded-lg border border-shale bg-white px-3 py-2 text-sm text-chocolate-900 shadow-sm outline-none transition focus:border-sienna focus:ring-2 focus:ring-sienna/30 dark:focus:border-cursor-accent dark:focus:ring-cursor-accent/30 dark:border-cursor-border dark:bg-cursor-elevated dark:text-cursor-text'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-shale-600 dark:text-cursor-secondary'

function centsOf(m) {
  if (m == null) return null
  if (typeof m === 'object') return m.cents ?? null
  return m
}

function remainingClass(m) {
  const n = centsOf(m)
  if (n == null) return 'text-chocolate dark:text-cursor-text'
  if (n < 0) return 'text-red-600 dark:text-red-300'
  if (n > 0) return 'text-emerald-700 dark:text-emerald-300'
  return 'text-chocolate dark:text-cursor-text'
}

function ProgressBar({ budget, spend }) {
  const b = centsOf(budget)
  const s = spend == null ? 0 : spend
  if (b == null || b <= 0) return null
  const pct = Math.min(100, Math.round((s / b) * 100))
  const over = s > b
  return (
    <div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-calm dark:bg-cursor-elevated">
        <div
          className={`h-full ${over ? 'bg-red-500' : 'bg-sienna dark:bg-cursor-accent'}`}
          style={{ width: `${over ? 100 : pct}%` }}
        />
      </div>
      <div className="mt-1 text-[11px] text-shale-500 dark:text-cursor-muted">
        {over ? `${Math.round((s / b) * 100)}% of budget` : `${pct}% of budget`}
      </div>
    </div>
  )
}

function MoneyRow({ label, value, emphasize, title }) {
  return (
    <div className="flex flex-col" title={title}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-shale-500 dark:text-cursor-muted">
        {label}
      </span>
      <span className={`text-sm font-semibold ${emphasize ? remainingClass(value) : 'text-chocolate dark:text-cursor-text'}`}>
        {money(value)}
      </span>
    </div>
  )
}

export default function ProgramsTab() {
  const [s, setS] = React.useState({ loading: true })
  const [selectedId, setSelectedId] = React.useState(null)
  const [detailNonce, setDetailNonce] = React.useState(0)
  const [modalOpen, setModalOpen] = React.useState(false)
  const [editProgram, setEditProgram] = React.useState(null)
  const [toast, setToast] = React.useState(null)

  const load = React.useCallback(() => {
    return api
      .programs()
      .then((data) => setS({ loading: false, data }))
      .catch((error) => setS({ loading: false, error }))
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const showToast = React.useCallback((msg, kind = 'success') => {
    setToast({ msg, kind })
    window.clearTimeout(showToast._t)
    showToast._t = window.setTimeout(() => setToast(null), 3000)
  }, [])

  if (s.loading) return <Spinner />
  if (s.error) return <ErrorBox error={s.error} />

  if (selectedId != null) {
    return (
      <>
        <ProgramDetail
          key={`${selectedId}-${detailNonce}`}
          id={selectedId}
          onBack={() => {
            setSelectedId(null)
            load()
          }}
          onEdit={setEditProgram}
          onDeleted={(title) => {
            setSelectedId(null)
            load()
            showToast(`Deleted "${title || 'program'}"`)
          }}
          onToast={showToast}
        />
        <ProgramModal
          open={!!editProgram}
          program={editProgram}
          onClose={() => setEditProgram(null)}
          onSaved={async () => {
            setEditProgram(null)
            setDetailNonce((n) => n + 1)
            showToast('Program saved')
          }}
        />
        {toast && <Toast toast={toast} />}
      </>
    )
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <SectionTitle count={(s.data || []).length}>Programs</SectionTitle>
        <button
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-sienna px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sienna-500 dark:bg-cursor-accent dark:hover:bg-cursor-accent-hover dark:text-cursor"
        >
          <span className="text-base leading-none">+</span> Add Program
        </button>
      </div>

      <p className="mb-5 text-sm text-shale-500 dark:text-cursor-muted">
        Group existing projects into a larger effort and track budget vs quotes vs paid.
        Remaining = budget minus paid (or quoted when a project has no paid amount yet).
      </p>

      {!s.data?.length ? (
        <Empty>No programs yet. Add one to roll up project budgets.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {(s.data || []).map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className="text-left"
            >
              <Card className="p-5 transition hover:shadow-md hover:ring-1 hover:ring-sienna-300 dark:hover:ring-cursor-accent">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-bold text-chocolate dark:text-cursor-text">{p.name}</h3>
                    {p.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-shale-600 dark:text-cursor-muted">{p.description}</p>
                    )}
                  </div>
                  <Badge color="violet">
                    {p.project_count} project{p.project_count === 1 ? '' : 's'}
                  </Badge>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <MoneyRow label="Budget" value={p.budget_cents} />
                  <MoneyRow label="Quoted" value={p.quoted_cents} />
                  <MoneyRow label="Paid" value={p.actual_cents} title="Amount paid so far" />
                  <MoneyRow
                    label="Remaining"
                    value={p.remaining_vs_budget_cents}
                    emphasize
                    title="Budget minus paid, or quoted when nothing has been paid yet"
                  />
                </div>
                <div className="mt-4">
                  <ProgressBar budget={p.budget_cents} spend={centsOf(p.spend_cents)} />
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}

      <ProgramModal
        open={modalOpen}
        program={null}
        onClose={() => setModalOpen(false)}
        onSaved={async () => {
          setModalOpen(false)
          await load()
          showToast('Program added')
        }}
      />

      {toast && <Toast toast={toast} />}
    </div>
  )
}

function Toast({ toast }) {
  return (
    <div
      className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-lg ${
        toast.kind === 'error'
          ? 'bg-red-600 text-white'
          : 'bg-chocolate-900 text-white dark:bg-cursor-elevated dark:text-cursor-text dark:border dark:border-cursor-border'
      }`}
    >
      {toast.msg}
    </div>
  )
}

function ProgramDetail({ id, onBack, onEdit, onDeleted, onToast }) {
  const [s, setS] = React.useState({ loading: true })
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [addOpen, setAddOpen] = React.useState(false)

  const load = React.useCallback(() => {
    return api
      .program(id)
      .then((data) => setS({ loading: false, data }))
      .catch((error) => setS({ loading: false, error }))
  }, [id])

  React.useEffect(() => {
    load()
  }, [load])

  const unlink = async (projectId, title) => {
    try {
      const updated = await api.removeProgramProject(id, projectId)
      setS({ loading: false, data: updated })
      onToast?.(`Removed "${title || 'project'}"`)
    } catch (err) {
      onToast?.(err.message, 'error')
    }
  }

  const doDelete = async () => {
    if (deleting) return
    setDeleting(true)
    try {
      await api.deleteProgram(id)
      await onDeleted?.(s.data?.name)
    } catch (err) {
      onToast?.(err.message, 'error')
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  if (s.loading) return <Spinner />
  if (s.error) return <ErrorBox error={s.error} />
  const d = s.data
  const projects = d.projects || []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            onClick={onBack}
            className="mb-2 text-sm font-semibold text-sienna hover:underline dark:text-cursor-accent"
          >
            ← All programs
          </button>
          <SectionTitle count={d.project_count}>{d.name}</SectionTitle>
          {d.description && (
            <p className="-mt-2 text-sm text-shale-600 dark:text-cursor-muted">{d.description}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onEdit?.(d)}
            className="rounded-xl px-3.5 py-2 text-sm font-semibold text-chocolate transition hover:bg-calm dark:text-cursor-text dark:hover:bg-cursor-elevated"
          >
            Edit
          </button>
          <button
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-sienna px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sienna-500 dark:bg-cursor-accent dark:text-cursor dark:hover:bg-cursor-accent-hover"
          >
            <span className="text-base leading-none">+</span> Add project
          </button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-calm-50 to-white p-6 dark:from-cursor-surface dark:to-cursor-surface">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-shale-500 dark:text-cursor-muted">
            Budget tracker
          </div>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Budget" value={money(d.budget_cents)} />
            <Stat label="Quoted" value={money(d.quoted_cents)} />
            <Stat label="Paid" value={money(d.actual_cents)} title="Amount paid so far" />
            <div
              className="flex flex-col"
              title="Budget minus paid, or quoted when nothing has been paid yet"
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide text-shale-500 dark:text-cursor-muted">
                Remaining
              </span>
              <span className={`text-sm font-semibold ${remainingClass(d.remaining_vs_budget_cents)}`}>
                {money(d.remaining_vs_budget_cents)}
              </span>
              <span className="text-xs text-shale-500">budget minus paid or quoted</span>
            </div>
          </div>
          <div className="mt-5">
            <ProgressBar budget={d.budget_cents} spend={centsOf(d.spend_cents)} />
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-shale-500">Projects</h3>
        {!projects.length ? (
          <Empty>No live projects in this program.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-shale-500">
                  <th className="py-1 pr-3">Project</th>
                  <th className="py-1 pr-3">Status</th>
                  <th className="py-1 pr-3 text-right">Budget</th>
                  <th className="py-1 pr-3 text-right">Quoted</th>
                  <th className="py-1 pr-3 text-right" title="Amount paid so far">Paid</th>
                  <th className="py-1 pr-3 text-right">Variance</th>
                  <th className="py-1 text-right"> </th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const abandoned = (p.status || '').toLowerCase() === 'abandoned'
                  return (
                    <tr
                      key={p.project_id}
                      className={`border-t border-calm dark:border-cursor-border ${abandoned ? 'opacity-60' : ''}`}
                    >
                      <td className={`py-2 pr-3 font-medium ${abandoned ? 'line-through' : ''}`}>
                        {p.title || `Project #${p.project_id}`}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge color={STATUS_COLOR[(p.status || '').toLowerCase()] || 'slate'}>
                          {(p.status || 'unknown').replace(/_/g, ' ')}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 text-right">{money(p.budget_cents)}</td>
                      <td className="py-2 pr-3 text-right">{money(p.quoted_cents)}</td>
                      <td className="py-2 pr-3 text-right">{money(p.actual_cents)}</td>
                      <td className={`py-2 pr-3 text-right font-semibold ${remainingClass(p.remaining_vs_budget_cents)}`}>
                        {money(p.remaining_vs_budget_cents)}
                      </td>
                      <td className="py-2 text-right">
                        <button
                          onClick={() => unlink(p.project_id, p.title)}
                          className="text-xs font-semibold text-red-600 hover:underline dark:text-red-400"
                        >
                          Unlink
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {confirmDelete ? (
        <div className="flex flex-col gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-3 text-sm dark:border-red-900 dark:bg-red-950/40">
          <span className="font-semibold text-red-700 dark:text-red-300">
            Delete this program? Projects themselves are not deleted — only the grouping.
          </span>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-chocolate transition hover:bg-calm disabled:opacity-50 dark:text-cursor-text dark:hover:bg-cursor-elevated"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={doDelete}
              disabled={deleting}
              className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Delete program'}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="text-sm font-semibold text-red-600 transition hover:underline dark:text-red-400"
        >
          Delete program
        </button>
      )}

      <AddProjectPicker
        open={addOpen}
        program={d}
        onClose={() => setAddOpen(false)}
        onAdded={async (updated) => {
          setAddOpen(false)
          setS({ loading: false, data: updated })
          onToast?.('Project added')
        }}
      />
    </div>
  )
}

function AddProjectPicker({ open, program, onClose, onAdded }) {
  const [projects, setProjects] = React.useState([])
  const [projectId, setProjectId] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState(null)

  React.useEffect(() => {
    if (!open) return
    setProjectId('')
    setError(null)
    setSubmitting(false)
    api
      .projects()
      .then(setProjects)
      .catch(() => setProjects([]))
  }, [open])

  const memberIds = new Set((program?.projects || []).map((p) => p.project_id))
  const available = projects.filter((p) => !memberIds.has(p.id))

  const submit = async (e) => {
    e.preventDefault()
    if (!projectId || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const updated = await api.addProgramProject(program.id, { project_id: parseInt(projectId, 10) })
      await onAdded?.(updated)
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add project to program">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={labelClass}>Project</label>
          <select className={inputClass} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">— select —</option>
            {available.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          {!available.length && (
            <p className="mt-2 text-xs text-shale-500">All existing projects are already in this program.</p>
          )}
        </div>
        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-chocolate transition hover:bg-calm dark:text-cursor-text dark:hover:bg-cursor-elevated"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !projectId}
            className="rounded-xl bg-sienna px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sienna-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-cursor-accent dark:text-cursor dark:hover:bg-cursor-accent-hover"
          >
            {submitting ? 'Adding…' : 'Add'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function ProgramModal({ open, program, onClose, onSaved }) {
  const isEdit = !!program
  const [form, setForm] = React.useState({ name: '', description: '', project_ids: [] })
  const [initialIds, setInitialIds] = React.useState([])
  const [projects, setProjects] = React.useState([])
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState(null)

  React.useEffect(() => {
    if (!open) return
    setError(null)
    setSubmitting(false)
    const seedIds = (program?.projects || []).map((p) => p.project_id)
    setForm({
      name: program?.name || '',
      description: program?.description || '',
      project_ids: seedIds,
    })
    setInitialIds(seedIds)
    api
      .projects()
      .then(setProjects)
      .catch(() => setProjects([]))
    if (isEdit && program?.id && !program.projects) {
      api
        .program(program.id)
        .then((full) => {
          const ids = (full.projects || []).map((p) => p.project_id)
          setInitialIds(ids)
          setForm((f) => ({
            ...f,
            name: full.name || f.name,
            description: full.description || '',
            project_ids: ids,
          }))
        })
        .catch(() => {})
    }
  }, [open, program, isEdit])

  const toggle = (id) => {
    setForm((f) => ({
      ...f,
      project_ids: f.project_ids.includes(id)
        ? f.project_ids.filter((x) => x !== id)
        : [...f.project_ids, id],
    }))
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      if (isEdit) {
        await api.updateProgram(program.id, {
          name: form.name.trim(),
          description: form.description.trim() || null,
        })
        const current = new Set(initialIds)
        const next = new Set(form.project_ids)
        for (const pid of next) {
          if (!current.has(pid)) await api.addProgramProject(program.id, { project_id: pid })
        }
        for (const pid of current) {
          if (!next.has(pid)) await api.removeProgramProject(program.id, pid)
        }
      } else {
        await api.createProgram({
          name: form.name.trim(),
          description: form.description.trim() || null,
          project_ids: form.project_ids,
        })
      }
      await onSaved?.()
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? `Edit: ${program.name}` : 'Add Program'}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={labelClass}>Name *</label>
          <input
            className={inputClass}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Office renovation"
            autoFocus
          />
        </div>
        <div>
          <label className={labelClass}>Description</label>
          <textarea
            className={inputClass}
            rows={2}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Optional notes…"
          />
        </div>
        <div>
          <label className={labelClass}>Projects</label>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-shale/70 p-2 dark:border-cursor-border">
            {!projects.length ? (
              <div className="px-2 py-3 text-xs text-shale-500">No projects yet.</div>
            ) : (
              projects.map((p) => (
                <label
                  key={p.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-calm dark:hover:bg-cursor-elevated"
                >
                  <input
                    type="checkbox"
                    checked={form.project_ids.includes(p.id)}
                    onChange={() => toggle(p.id)}
                    className="h-4 w-4 rounded border-shale text-sienna focus:ring-sienna dark:border-cursor-border"
                  />
                  <span className="min-w-0 truncate text-chocolate dark:text-cursor-text">{p.title}</span>
                </label>
              ))
            )}
          </div>
        </div>
        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-chocolate transition hover:bg-calm dark:text-cursor-text dark:hover:bg-cursor-elevated"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !form.name.trim()}
            className="rounded-xl bg-sienna px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sienna-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-cursor-accent dark:text-cursor dark:hover:bg-cursor-accent-hover"
          >
            {submitting ? 'Saving…' : isEdit ? 'Save' : 'Add Program'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
