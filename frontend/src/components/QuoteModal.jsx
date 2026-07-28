import React from 'react'
import { api } from '../api'
import { Modal } from './ui'

const inputClass =
  'w-full rounded-lg border border-shale bg-white px-3 py-2 text-sm text-chocolate-900 shadow-sm outline-none transition focus:border-sienna focus:ring-2 focus:ring-sienna/30 dark:focus:border-cursor-accent dark:focus:ring-cursor-accent/30 dark:border-cursor-border dark:bg-cursor-elevated dark:text-cursor-text disabled:cursor-not-allowed disabled:opacity-60'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-shale-600 dark:text-cursor-secondary'

// Add / edit a quote. Mirrors micasa's Quote model exactly:
//  - Project REQUIRED (live projects), Vendor REQUIRED (live vendors)
//  - Total REQUIRED and INDEPENDENT of the components (micasa does not derive it)
//  - Labor / Materials / Other optional; Received date optional; Notes optional
// `lockProject` pre-selects & locks the project (used from a project's detail).
export default function QuoteModal({
  open,
  quote,          // existing quote object => edit mode; null/undefined => create
  lockProjectId,  // when set, project is pre-selected and locked
  onClose,
  onSaved,
  onDeleted,
}) {
  const isEdit = !!(quote && quote.id != null)
  const [form, setForm] = React.useState(null)
  const [projects, setProjects] = React.useState([])
  const [vendors, setVendors] = React.useState([])
  const [submitting, setSubmitting] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [error, setError] = React.useState(null)

  React.useEffect(() => {
    if (!open) return
    const initialProject =
      lockProjectId != null
        ? String(lockProjectId)
        : quote?.project_id != null
        ? String(quote.project_id)
        : ''
    setForm({
      project_id: initialProject,
      vendor_id: quote?.vendor_id != null ? String(quote.vendor_id) : '',
      total_dollars: quote?.total_cents?.dollars != null ? String(quote.total_cents.dollars) : '',
      labor_dollars: quote?.labor_cents?.dollars != null ? String(quote.labor_cents.dollars) : '',
      materials_dollars: quote?.materials_cents?.dollars != null ? String(quote.materials_cents.dollars) : '',
      other_dollars: quote?.other_cents?.dollars != null ? String(quote.other_cents.dollars) : '',
      received_date: quote?.received_date || '',
      notes: quote?.notes || '',
    })
    setError(null)
    setSubmitting(false)
    setDeleting(false)
    setConfirmDelete(false)
    api.projects().then(setProjects).catch(() => setProjects([]))
    api.vendors().then(setVendors).catch(() => setVendors([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, quote, lockProjectId])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const canSave =
    form && form.project_id !== '' && form.vendor_id !== '' && form.total_dollars !== '' && !submitting && !deleting

  const submit = async (e) => {
    e.preventDefault()
    if (!canSave) return
    setSubmitting(true)
    setError(null)
    const numOrNull = (v) => (v !== '' && v != null ? parseFloat(v) : null)
    const body = {
      project_id: parseInt(form.project_id, 10),
      vendor_id: parseInt(form.vendor_id, 10),
      total_dollars: parseFloat(form.total_dollars),
      labor_dollars: numOrNull(form.labor_dollars),
      materials_dollars: numOrNull(form.materials_dollars),
      other_dollars: numOrNull(form.other_dollars),
      received_date: form.received_date || null,
      notes: form.notes.trim() ? form.notes.trim() : null,
    }
    try {
      const saved = isEdit ? await api.updateQuote(quote.id, body) : await api.createQuote(body)
      await onSaved?.(saved)
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
      await api.deleteQuote(quote.id)
      await onDeleted?.(quote)
    } catch (err) {
      setError(err.message)
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  if (!open || !form) return null
  const busy = submitting || deleting

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Quote' : 'Add Quote'}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={labelClass}>Project *</label>
          <select
            className={inputClass}
            value={form.project_id}
            onChange={set('project_id')}
            disabled={lockProjectId != null}
          >
            <option value="">— select a project —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>Vendor *</label>
          <select className={inputClass} value={form.vendor_id} onChange={set('vendor_id')}>
            <option value="">— select a vendor —</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Total $ *</label>
            <input
              className={inputClass}
              type="number"
              step="0.01"
              min="0"
              value={form.total_dollars}
              onChange={set('total_dollars')}
              placeholder="3250.00"
              autoFocus
            />
          </div>
          <div>
            <label className={labelClass}>Labor $</label>
            <input
              className={inputClass}
              type="number"
              step="0.01"
              min="0"
              value={form.labor_dollars}
              onChange={set('labor_dollars')}
              placeholder="2000.00"
            />
          </div>
          <div>
            <label className={labelClass}>Materials $</label>
            <input
              className={inputClass}
              type="number"
              step="0.01"
              min="0"
              value={form.materials_dollars}
              onChange={set('materials_dollars')}
              placeholder="1000.00"
            />
          </div>
          <div>
            <label className={labelClass}>Other $</label>
            <input
              className={inputClass}
              type="number"
              step="0.01"
              min="0"
              value={form.other_dollars}
              onChange={set('other_dollars')}
              placeholder="250.00"
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>Received date</label>
          <input className={inputClass} type="date" value={form.received_date} onChange={set('received_date')} />
        </div>

        <div>
          <label className={labelClass}>Notes</label>
          <textarea
            className={inputClass}
            rows={3}
            value={form.notes}
            onChange={set('notes')}
            placeholder="Optional notes…"
          />
        </div>

        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        {isEdit && confirmDelete ? (
          <div className="flex flex-col gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-3 text-sm dark:border-red-900 dark:bg-red-950/40">
            <span className="font-semibold text-red-700 dark:text-red-300">Delete this quote? It will be hidden (soft-deleted).</span>
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
            {isEdit ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
                className="rounded-xl px-3 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                Delete
              </button>
            ) : (
              <span />
            )}
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
                disabled={!canSave}
                className="rounded-xl bg-sienna px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sienna-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-cursor-accent dark:text-cursor dark:hover:bg-cursor-accent-hover"
              >
                {submitting ? 'Saving…' : isEdit ? 'Save' : 'Add Quote'}
              </button>
            </div>
          </div>
        )}
      </form>
    </Modal>
  )
}
