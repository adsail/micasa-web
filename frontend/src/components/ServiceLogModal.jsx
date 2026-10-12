import React from 'react'
import { api } from '../api'
import { Modal } from './ui'

const inputClass =
  'w-full rounded-lg border border-shale bg-white px-3 py-2 text-sm text-chocolate-900 shadow-sm outline-none transition focus:border-sienna focus:ring-2 focus:ring-sienna/30 dark:focus:border-cursor-accent dark:focus:ring-cursor-accent/30 dark:border-cursor-border dark:bg-cursor-elevated dark:text-cursor-text disabled:cursor-not-allowed disabled:opacity-60'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-shale-600 dark:text-cursor-secondary'

// Add / edit a service log entry. Mirrors micasa forms.go openServiceLogForm:
//  - Date serviced REQUIRED (YYYY-MM-DD)
//  - Performed by optional (live vendor select, or none)
//  - Cost optional money; Notes optional text
// Backend moves maintenance_items.last_serviced_at forward when a saved log is newer.
// If the log that set it moves earlier or is deleted, it falls back to the newest
// remaining log; it is never cleared.
export default function ServiceLogModal({
  open,
  entry,                 // existing log => edit; null => create
  maintenanceItemId,     // required on create (and shown locked conceptually)
  onClose,
  onSaved,
  onDeleted,
}) {
  const isEdit = !!(entry && entry.id != null)
  const [form, setForm] = React.useState(null)
  const [vendors, setVendors] = React.useState([])
  const [submitting, setSubmitting] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [error, setError] = React.useState(null)

  React.useEffect(() => {
    if (!open) return
    setForm({
      serviced_at: entry?.serviced_at || '',
      vendor_id: entry?.vendor_id != null ? String(entry.vendor_id) : '',
      cost_dollars: entry?.cost_cents?.dollars != null ? String(entry.cost_cents.dollars) : '',
      notes: entry?.notes || '',
    })
    setError(null)
    setSubmitting(false)
    setDeleting(false)
    setConfirmDelete(false)
    api.vendors().then(setVendors).catch(() => setVendors([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const canSave = form && form.serviced_at !== '' && !submitting && !deleting

  const submit = async (e) => {
    e.preventDefault()
    if (!canSave) return
    setSubmitting(true)
    setError(null)
    const body = {
      serviced_at: form.serviced_at,
      vendor_id: form.vendor_id !== '' ? parseInt(form.vendor_id, 10) : null,
      cost_dollars: form.cost_dollars !== '' && form.cost_dollars != null ? parseFloat(form.cost_dollars) : null,
      notes: form.notes.trim() ? form.notes.trim() : null,
    }
    try {
      let saved
      if (isEdit) {
        saved = await api.updateServiceLog(entry.id, body)
      } else {
        saved = await api.createServiceLog({
          ...body,
          maintenance_item_id: maintenanceItemId,
        })
      }
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
      await api.deleteServiceLog(entry.id)
      await onDeleted?.(entry)
    } catch (err) {
      setError(err.message)
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  if (!open || !form) return null
  const busy = submitting || deleting

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit service' : 'Log service'}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={labelClass}>Date serviced *</label>
          <input
            className={inputClass}
            type="date"
            value={form.serviced_at}
            onChange={set('serviced_at')}
            autoFocus
          />
        </div>

        <div>
          <label className={labelClass}>Performed by</label>
          <select className={inputClass} value={form.vendor_id} onChange={set('vendor_id')}>
            <option value="">— none —</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>Cost $</label>
          <input
            className={inputClass}
            type="number"
            step="0.01"
            min="0"
            value={form.cost_dollars}
            onChange={set('cost_dollars')}
            placeholder="150.00"
          />
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
            <span className="font-semibold text-red-700 dark:text-red-300">
              Delete this service log? It will be hidden (soft-deleted).
            </span>
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
                {submitting ? 'Saving…' : isEdit ? 'Save' : 'Log service'}
              </button>
            </div>
          </div>
        )}
      </form>
    </Modal>
  )
}
