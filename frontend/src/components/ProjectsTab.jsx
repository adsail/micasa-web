import React from 'react'
import { api } from '../api'
import { Card, Spinner, ErrorBox, Empty, SectionTitle, Badge, Modal } from './ui'
import { money, fmtDate } from '../format'
import QuoteModal from './QuoteModal'

// --- status → column mapping --------------------------------------------
const COLUMNS = [
  { key: 'todo', title: 'To Do', statuses: ['ideating', 'planned', 'quoted'], dropStatus: 'ideating' },
  { key: 'in_progress', title: 'In Progress', statuses: ['underway', 'delayed'], dropStatus: 'underway' },
  { key: 'done', title: 'Done', statuses: ['completed', 'abandoned'], dropStatus: 'completed' },
]

const STATUS_OPTIONS = ['ideating', 'planned', 'quoted', 'underway', 'delayed', 'completed', 'abandoned']

const columnForStatus = (status) => {
  const v = (status || '').toLowerCase()
  const col = COLUMNS.find((c) => c.statuses.includes(v))
  return col ? col.key : 'todo'
}

const statusColor = (s) => {
  const v = (s || '').toLowerCase()
  if (v === 'completed') return 'green'
  if (v === 'abandoned') return 'slate'
  if (v === 'underway') return 'sienna'
  if (v === 'delayed') return 'red'
  if (v === 'quoted' || v === 'planned') return 'amber'
  return 'slate'
}

// Tolerant year parsing: strips " +0000 UTC"/" UTC", takes first 10 chars.
const yearOf = (raw) => {
  if (!raw) return null
  const cleaned = String(raw).replace(/\s+(?:\+0000\s+)?UTC$/i, '').trim()
  const first10 = cleaned.slice(0, 10) // YYYY-MM-DD
  const m = first10.match(/^(\d{4})-\d{2}-\d{2}/)
  return m ? parseInt(m[1], 10) : null
}

// Which date decides the year for grouping, per column.
const groupYearForProject = (p, columnKey) => {
  if (columnKey === 'done') {
    return yearOf(p.end_date) ?? yearOf(p.start_date)
  }
  // to do / in progress
  return yearOf(p.start_date)
}

const NO_DATE = 'nodate'

export default function ProjectsTab() {
  const [s, setS] = React.useState({ loading: true })
  const [modalOpen, setModalOpen] = React.useState(false)
  const [editProject, setEditProject] = React.useState(null)
  const [toast, setToast] = React.useState(null)
  const [dragId, setDragId] = React.useState(null)
  const [dragOverCol, setDragOverCol] = React.useState(null)

  const load = React.useCallback(() => {
    return api
      .projects()
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

  // Move a card to a new column's default status via PATCH.
  const handleDrop = React.useCallback(
    async (colKey) => {
      const id = dragId
      setDragOverCol(null)
      setDragId(null)
      if (id == null) return
      const project = s.data?.find((p) => p.id === id)
      if (!project) return
      const currentCol = columnForStatus(project.status)
      if (currentCol === colKey) return // no-op within same column
      const col = COLUMNS.find((c) => c.key === colKey)
      if (!col) return

      // Optimistic update.
      const prev = s.data
      setS((old) => ({
        ...old,
        data: old.data.map((p) => (p.id === id ? { ...p, status: col.dropStatus } : p)),
      }))
      try {
        const updated = await api.updateProjectStatus(id, col.dropStatus)
        setS((old) => ({
          ...old,
          data: old.data.map((p) => (p.id === id ? updated : p)),
        }))
        showToast(`Moved "${project.title}" → ${col.title}`)
      } catch (err) {
        setS((old) => ({ ...old, data: prev })) // revert
        showToast(`Move failed: ${err.message}`, 'error')
      }
    },
    [dragId, s.data, showToast]
  )

  if (s.loading) return <Spinner />
  if (s.error) return <ErrorBox error={s.error} />

  // Bucket projects into columns.
  const buckets = { todo: [], in_progress: [], done: [] }
  for (const p of s.data || []) {
    buckets[columnForStatus(p.status)].push(p)
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <SectionTitle count={(s.data || []).length}>Projects</SectionTitle>
        <button
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-sienna px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sienna-500 dark:bg-cursor-accent dark:hover:bg-cursor-accent-hover dark:text-cursor"
        >
          <span className="text-base leading-none">+</span> Add Project
        </button>
      </div>

      {!s.data?.length ? (
        <Empty>No projects yet.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:items-start">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.key}
              col={col}
              projects={buckets[col.key]}
              dragId={dragId}
              onEdit={setEditProject}
              onQuotesChanged={load}
              isDragOver={dragOverCol === col.key}
              onCardDragStart={setDragId}
              onCardDragEnd={() => {
                setDragId(null)
                setDragOverCol(null)
              }}
              onColDragOver={() => setDragOverCol(col.key)}
              onColDragLeave={() => setDragOverCol((c) => (c === col.key ? null : c))}
              onColDrop={() => handleDrop(col.key)}
            />
          ))}
        </div>
      )}

      <AddProjectModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={async () => {
          setModalOpen(false)
          await load()
          showToast('Project added')
        }}
      />

      <EditProjectModal
        project={editProject}
        onClose={() => setEditProject(null)}
        onSaved={async (updated) => {
          setEditProject(null)
          await load()
          showToast(`Saved "${updated?.title || 'project'}"`)
        }}
        onDeleted={async (title) => {
          setEditProject(null)
          await load()
          showToast(`Deleted "${title || 'project'}"`)
        }}
      />

      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-lg ${
            toast.kind === 'error'
              ? 'bg-red-600 text-white'
              : 'bg-chocolate-900 text-white dark:bg-cursor-elevated dark:text-cursor-text dark:border dark:border-cursor-border'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  )
}

function KanbanColumn({
  col,
  projects,
  dragId,
  onEdit,
  onQuotesChanged,
  isDragOver,
  onCardDragStart,
  onCardDragEnd,
  onColDragOver,
  onColDragLeave,
  onColDrop,
}) {
  // Group by year (or "no date"). Newest year first; no-date group placed first.
  const groups = new Map()
  for (const p of projects) {
    const y = groupYearForProject(p, col.key)
    const key = y == null ? NO_DATE : y
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(p)
  }

  const yearKeys = [...groups.keys()].filter((k) => k !== NO_DATE).sort((a, b) => b - a)
  const ordered = []
  if (groups.has(NO_DATE)) ordered.push([NO_DATE, groups.get(NO_DATE)])
  for (const y of yearKeys) ordered.push([y, groups.get(y)])

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        onColDragOver()
      }}
      onDragLeave={onColDragLeave}
      onDrop={(e) => {
        e.preventDefault()
        onColDrop()
      }}
      className={`rounded-2xl p-3 transition ${
        isDragOver
          ? 'bg-sienna-100/70 ring-2 ring-sienna-400 dark:bg-cursor-accent/10 dark:ring-cursor-accent'
          : 'bg-calm/60 dark:bg-cursor/40'
      }`}
    >
      <div className="mb-3 flex items-center justify-between px-1">
        <h3 className="text-sm font-bold uppercase tracking-wide text-chocolate dark:text-cursor-text">{col.title}</h3>
        <span className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-shale/60 px-2 py-0.5 text-xs font-semibold text-chocolate dark:bg-cursor-elevated dark:text-cursor-text">
          {projects.length}
        </span>
      </div>
      {projects.length === 0 ? (
        <div
          className={`rounded-xl border border-dashed py-10 text-center text-xs transition ${
            isDragOver
              ? 'border-sienna-400 text-sienna-500 dark:border-cursor-accent dark:text-cursor-accent'
              : 'border-shale text-shale-500 dark:border-cursor-border dark:text-cursor-muted'
          }`}
        >
          {isDragOver ? 'Drop here' : 'Nothing here'}
        </div>
      ) : (
        <div className="space-y-4">
          {ordered.map(([key, items]) => (
            <div key={String(key)}>
              <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-shale-500 dark:text-cursor-muted">
                {key === NO_DATE ? 'Someday / No date' : key}
              </div>
              <div className="space-y-3">
                {items.map((p) => (
                  <ProjectCard
                    key={p.id}
                    p={p}
                    isDragging={dragId === p.id}
                    onEdit={onEdit}
                    onDragStart={onCardDragStart}
                    onDragEnd={onCardDragEnd}
                    onQuotesChanged={onQuotesChanged}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ProjectCard({ p, isDragging, onEdit, onDragStart, onDragEnd, onQuotesChanged }) {
  const [open, setOpen] = React.useState(false)
  const isAbandoned = (p.status || '').toLowerCase() === 'abandoned'
  // Distinguish a real click (open edit modal) from a drag (change status).
  // We record where the pointer went down and whether a drag started; a
  // pointer-up close to the down point that wasn't a drag counts as a click.
  const down = React.useRef(null)
  const dragged = React.useRef(false)
  return (
    <div
      draggable
      onDragStart={(e) => {
        dragged.current = true
        e.dataTransfer.effectAllowed = 'move'
        try {
          e.dataTransfer.setData('text/plain', String(p.id))
        } catch {}
        onDragStart?.(p.id)
      }}
      onDragEnd={() => onDragEnd?.()}
      onPointerDown={(e) => {
        dragged.current = false
        down.current = { x: e.clientX, y: e.clientY }
      }}
      onClick={(e) => {
        // Ignore clicks originating from interactive children (buttons/links).
        if (e.target.closest('button, a')) return
        const start = down.current
        down.current = null
        if (dragged.current) return // it was a drag, not a click
        if (start) {
          const dx = Math.abs(e.clientX - start.x)
          const dy = Math.abs(e.clientY - start.y)
          if (dx > 5 || dy > 5) return // moved too far -> treat as drag
        }
        onEdit?.(p)
      }}
      title="Click to edit"
      className={`cursor-pointer ${isDragging ? 'opacity-40' : ''}`}
    >
      <Card className={`p-4 transition hover:shadow-md hover:ring-1 hover:ring-sienna-300 dark:hover:ring-cursor-accent ${isAbandoned ? 'opacity-60' : ''}`}>
        <div className="flex items-start justify-between gap-2">
          <h4 className={`text-sm font-bold leading-snug ${isAbandoned ? 'line-through text-shale-600 dark:text-cursor-muted' : ''}`}>
            {p.title}
          </h4>
          <span className="shrink-0 text-shale transition group-hover:text-shale-500 dark:text-cursor-muted" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge color={statusColor(p.status)}>{(p.status || 'unknown').replace(/_/g, ' ')}</Badge>
          {p.project_type_name && <Badge color="violet">{p.project_type_name}</Badge>}
          {p.quote_count > 0 && <Badge color="blue">{p.quote_count} quote{p.quote_count === 1 ? '' : 's'}</Badge>}
        </div>

        <div className="mt-3 flex items-end justify-between gap-2 text-xs">
          <div className="text-shale-500">
            <div>budget {money(p.budget_cents)}</div>
            <div>actual {money(p.actual_cents)}</div>
          </div>
          {(p.start_date || p.end_date) && (
            <div className="text-right text-shale-500">
              {p.start_date && <div>{fmtDate(p.start_date)}</div>}
              {p.end_date && p.end_date !== p.start_date && <div>→ {fmtDate(p.end_date)}</div>}
            </div>
          )}
        </div>

        {p.description && (
          <p className="mt-2 line-clamp-3 text-xs text-chocolate dark:text-cursor-text">{p.description}</p>
        )}

        <button
          onClick={() => setOpen(!open)}
          className="mt-3 text-xs font-semibold text-sienna hover:underline dark:text-cursor-accent"
        >
          {open ? 'Hide quotes & docs' : 'View quotes & docs'}
        </button>
        {open && <ProjectDetail id={p.id} onQuotesChanged={onQuotesChanged} />}
      </Card>
    </div>
  )
}

const inputClass =
  'w-full rounded-lg border border-shale bg-white px-3 py-2 text-sm text-chocolate-900 shadow-sm outline-none transition focus:border-sienna focus:ring-2 focus:ring-sienna/30 dark:focus:border-cursor-accent dark:focus:ring-cursor-accent/30 dark:border-cursor-border dark:bg-cursor-elevated dark:text-cursor-text'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-shale-600 dark:text-cursor-secondary'

function AddProjectModal({ open, onClose, onCreated }) {
  const empty = {
    title: '',
    project_type_id: '',
    status: 'ideating',
    description: '',
    budget_dollars: '',
    start_date: '',
    end_date: '',
  }
  const [form, setForm] = React.useState(empty)
  const [types, setTypes] = React.useState([])
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState(null)

  React.useEffect(() => {
    if (!open) return
    setForm(empty)
    setError(null)
    setSubmitting(false)
    api
      .projectTypes()
      .then(setTypes)
      .catch(() => setTypes([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.title.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    const body = {
      title: form.title.trim(),
      status: form.status,
    }
    if (form.project_type_id) body.project_type_id = parseInt(form.project_type_id, 10)
    if (form.description.trim()) body.description = form.description.trim()
    if (form.budget_dollars !== '' && form.budget_dollars != null)
      body.budget_dollars = parseFloat(form.budget_dollars)
    if (form.start_date) body.start_date = form.start_date
    if (form.end_date) body.end_date = form.end_date
    try {
      await api.createProject(body)
      await onCreated?.()
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Project">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={labelClass}>Title *</label>
          <input
            className={inputClass}
            value={form.title}
            onChange={set('title')}
            placeholder="e.g. Kitchen backsplash"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Type</label>
            <select className={inputClass} value={form.project_type_id} onChange={set('project_type_id')}>
              <option value="">— none —</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Status</label>
            <select className={inputClass} value={form.status} onChange={set('status')}>
              {STATUS_OPTIONS.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className={labelClass}>Description</label>
          <textarea
            className={inputClass}
            rows={3}
            value={form.description}
            onChange={set('description')}
            placeholder="Optional notes…"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelClass}>Budget $</label>
            <input
              className={inputClass}
              type="number"
              step="0.01"
              min="0"
              value={form.budget_dollars}
              onChange={set('budget_dollars')}
              placeholder="0.00"
            />
          </div>
          <div>
            <label className={labelClass}>Start date</label>
            <input className={inputClass} type="date" value={form.start_date} onChange={set('start_date')} />
          </div>
          <div>
            <label className={labelClass}>End date</label>
            <input className={inputClass} type="date" value={form.end_date} onChange={set('end_date')} />
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
            disabled={submitting || !form.title.trim()}
            className="rounded-xl bg-sienna px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sienna-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-cursor-accent dark:text-cursor dark:hover:bg-cursor-accent-hover"
          >
            {submitting ? 'Adding…' : 'Add Project'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function EditProjectModal({ project, onClose, onSaved, onDeleted }) {
  const open = !!project
  const [form, setForm] = React.useState(null)
  const [types, setTypes] = React.useState([])
  const [submitting, setSubmitting] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [error, setError] = React.useState(null)

  React.useEffect(() => {
    if (!project) return
    setForm({
      title: project.title || '',
      project_type_id: project.project_type_id != null ? String(project.project_type_id) : '',
      status: (project.status || 'ideating').toLowerCase(),
      description: project.description || '',
      budget_dollars: project.budget_cents?.dollars != null ? String(project.budget_cents.dollars) : '',
      actual_dollars: project.actual_cents?.dollars != null ? String(project.actual_cents.dollars) : '',
      start_date: project.start_date || '',
      end_date: project.end_date || '',
    })
    setError(null)
    setSubmitting(false)
    setDeleting(false)
    setConfirmDelete(false)
    api
      .projectTypes()
      .then(setTypes)
      .catch(() => setTypes([]))
  }, [project])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form || !form.title.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    // Send every editable field; empty numeric/date fields become null to
    // clear them, matching the backend's null-clears semantics.
    const body = {
      title: form.title.trim(),
      status: form.status,
      project_type_id: form.project_type_id ? parseInt(form.project_type_id, 10) : null,
      description: form.description.trim() ? form.description.trim() : null,
      budget_dollars: form.budget_dollars !== '' && form.budget_dollars != null ? parseFloat(form.budget_dollars) : null,
      actual_dollars: form.actual_dollars !== '' && form.actual_dollars != null ? parseFloat(form.actual_dollars) : null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
    }
    try {
      const updated = await api.updateProject(project.id, body)
      await onSaved?.(updated)
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  const doDelete = async () => {
    if (deleting) return
    setDeleting(true)
    setError(null)
    try {
      await api.deleteProject(project.id)
      await onDeleted?.(project.title)
    } catch (err) {
      setError(err.message)
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  if (!open || !form) return null
  const busy = submitting || deleting

  return (
    <Modal open={open} onClose={onClose} title={project.title ? `Edit: ${project.title}` : 'Edit Project'}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={labelClass}>Title *</label>
          <input
            className={inputClass}
            value={form.title}
            onChange={set('title')}
            placeholder="e.g. Kitchen backsplash"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Type</label>
            <select className={inputClass} value={form.project_type_id} onChange={set('project_type_id')}>
              <option value="">— none —</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Status</label>
            <select className={inputClass} value={form.status} onChange={set('status')}>
              {STATUS_OPTIONS.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className={labelClass}>Description</label>
          <textarea
            className={inputClass}
            rows={3}
            value={form.description}
            onChange={set('description')}
            placeholder="Optional notes…"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Budget $</label>
            <input
              className={inputClass}
              type="number"
              step="0.01"
              min="0"
              value={form.budget_dollars}
              onChange={set('budget_dollars')}
              placeholder="0.00"
            />
          </div>
          <div>
            <label className={labelClass}>Actual $</label>
            <input
              className={inputClass}
              type="number"
              step="0.01"
              min="0"
              value={form.actual_dollars}
              onChange={set('actual_dollars')}
              placeholder="0.00"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Start date</label>
            <input className={inputClass} type="date" value={form.start_date} onChange={set('start_date')} />
          </div>
          <div>
            <label className={labelClass}>End date</label>
            <input className={inputClass} type="date" value={form.end_date} onChange={set('end_date')} />
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        {confirmDelete ? (
          <div className="flex flex-col gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-3 text-sm dark:border-red-900 dark:bg-red-950/40">
            <span className="font-semibold text-red-700 dark:text-red-300">Delete this project? It will be hidden (soft-deleted).</span>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={busy}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-chocolate transition hover:bg-calm disabled:opacity-50 dark:text-cursor-text dark:hover:bg-cursor-elevated"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={doDelete}
                disabled={busy}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
              className="rounded-xl px-3 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40"
            >
              Delete
            </button>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-chocolate transition hover:bg-calm disabled:opacity-50 dark:text-cursor-text dark:hover:bg-cursor-elevated"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !form.title.trim()}
                className="rounded-xl bg-sienna px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sienna-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-cursor-accent dark:text-cursor dark:hover:bg-cursor-accent-hover"
              >
                {submitting ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </form>
    </Modal>
  )
}

function ProjectDetail({ id, onQuotesChanged }) {
  const [s, setS] = React.useState({ loading: true })
  const [addQuoteOpen, setAddQuoteOpen] = React.useState(false)
  const [editQuote, setEditQuote] = React.useState(null)

  const load = React.useCallback(() => {
    return api
      .project(id)
      .then((data) => setS({ loading: false, data }))
      .catch((error) => setS({ loading: false, error }))
  }, [id])

  React.useEffect(() => {
    load()
  }, [load])

  // Refresh both this detail view AND the parent list (quote_count +
  // delete-guard behavior depend on the project's active-quote count).
  const refresh = async () => {
    await load()
    await onQuotesChanged?.()
  }

  if (s.loading) return <div className="py-4"><Spinner /></div>
  if (s.error) return <ErrorBox error={s.error} />
  const d = s.data
  return (
    <div className="mt-4 space-y-4 border-t border-calm pt-4 dark:border-cursor-border">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-wide text-shale-500">Quotes</h4>
          <button
            onClick={() => setAddQuoteOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-sienna px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-sienna-500 dark:bg-cursor-accent dark:text-cursor dark:hover:bg-cursor-accent-hover"
          >
            <span className="text-sm leading-none">+</span> Add Quote
          </button>
        </div>
        {d.quotes?.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-shale-500">
                  <th className="py-1 pr-3">Vendor</th>
                  <th className="py-1 pr-3 text-right">Total</th>
                  <th className="py-1 pr-3 text-right">Labor</th>
                  <th className="py-1 pr-3 text-right">Materials</th>
                  <th className="py-1 text-right">Other</th>
                </tr>
              </thead>
              <tbody>
                {d.quotes.map((q) => (
                  <tr
                    key={q.id}
                    onClick={() => setEditQuote(q)}
                    title="Click to edit"
                    className="cursor-pointer border-t border-calm hover:bg-calm-50 dark:border-cursor-border dark:hover:bg-cursor-elevated/40"
                  >
                    <td className="py-1.5 pr-3 font-medium">{q.vendor_name || '\u2014'}</td>
                    <td className="py-1.5 pr-3 text-right font-semibold">{money(q.total_cents)}</td>
                    <td className="py-1.5 pr-3 text-right text-shale-600">{money(q.labor_cents)}</td>
                    <td className="py-1.5 pr-3 text-right text-shale-600">{money(q.materials_cents)}</td>
                    <td className="py-1.5 text-right text-shale-600">{money(q.other_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-xs text-shale-500">No quotes yet.</div>
        )}
      </div>

      {d.documents?.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-shale-500">Documents</h4>
          <ul className="space-y-1 text-sm">
            {d.documents.map((doc) => (
              <li key={doc.id}>
                <a href={api.docRaw(doc.id)} target="_blank" rel="noreferrer" className="text-sienna hover:underline dark:text-cursor-accent">
                  {doc.title || doc.file_name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <QuoteModal
        open={addQuoteOpen}
        quote={null}
        lockProjectId={id}
        onClose={() => setAddQuoteOpen(false)}
        onSaved={async () => {
          setAddQuoteOpen(false)
          await refresh()
        }}
      />

      <QuoteModal
        open={!!editQuote}
        quote={editQuote}
        lockProjectId={id}
        onClose={() => setEditQuote(null)}
        onSaved={async () => {
          setEditQuote(null)
          await refresh()
        }}
        onDeleted={async () => {
          setEditQuote(null)
          await refresh()
        }}
      />
    </div>
  )
}
