import React from 'react'
import { api } from '../api'
import { Modal } from './ui'

const inputClass =
  'w-full rounded-lg border border-shale bg-white px-3 py-2 text-sm text-chocolate-900 shadow-sm outline-none transition focus:border-sienna focus:ring-2 focus:ring-sienna/30 dark:focus:border-cursor-accent dark:focus:ring-cursor-accent/30 dark:border-cursor-border dark:bg-cursor-elevated dark:text-cursor-text disabled:cursor-not-allowed disabled:opacity-60'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-shale-600 dark:text-cursor-secondary'

// Add / edit a vendor. Mirrors micasa's Vendor model exactly:
//  - Name REQUIRED and UNIQUE (index spans all rows incl. soft-deleted)
//  - Contact name / Email / Phone / Website / Notes all optional
export default function VendorModal({
  open,
  vendor,   // existing vendor => edit mode; null/undefined => create
  onClose,
  onSaved,
  onDeleted,
}) {
  const isEdit = !!(vendor && vendor.id != null)
  const [form, setForm] = React.useState(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [error, setError] = React.useState(null)

  React.useEffect(() => {
    if (!open) return
    setForm({
      name: vendor?.name || '',
      contact_name: vendor?.contact_name || '',
      email: vendor?.email || '',
      phone: vendor?.phone || '',
      website: vendor?.website || '',
      notes: vendor?.notes || '',
    })
    setError(null)
    setSubmitting(false)
    setDeleting(false)
    setConfirmDelete(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, vendor])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const canSave = form && form.name.trim() && !submitting && !deleting

  const submit = async (e) => {
    e.preventDefault()
    if (!canSave) return
    setSubmitting(true)
    setError(null)
    const body = {
      name: form.name.trim(),
      contact_name: form.contact_name.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      website: form.website.trim() || null,
      notes: form.notes.trim() || null,
    }
    try {
      const saved = isEdit ? await api.updateVendor(vendor.id, body) : await api.createVendor(body)
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
      await api.deleteVendor(vendor.id)
      await onDeleted?.(vendor)
    } catch (err) {
      setError(err.message)
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  if (!open || !form) return null
  const busy = submitting || deleting

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? `Edit: ${vendor.name}` : 'Add Vendor'}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={labelClass}>Name *</label>
          <input
            className={inputClass}
            value={form.name}
            onChange={set('name')}
            placeholder="Acme Plumbing"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Contact name</label>
            <input className={inputClass} value={form.contact_name} onChange={set('contact_name')} />
          </div>
          <div>
            <label className={labelClass}>Phone</label>
            <input className={inputClass} value={form.phone} onChange={set('phone')} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Email</label>
            <input className={inputClass} value={form.email} onChange={set('email')} />
          </div>
          <div>
            <label className={labelClass}>Website</label>
            <input className={inputClass} value={form.website} onChange={set('website')} placeholder="https://…" />
          </div>
        </div>

        <div>
          <label className={labelClass}>Notes</label>
          <textarea className={inputClass} rows={3} value={form.notes} onChange={set('notes')} placeholder="Optional notes…" />
        </div>

        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        {isEdit && confirmDelete ? (
          <div className="flex flex-col gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-3 text-sm dark:border-red-900 dark:bg-red-950/40">
            <span className="font-semibold text-red-700 dark:text-red-300">Delete this vendor? It will be hidden (soft-deleted).</span>
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
                {submitting ? 'Saving…' : isEdit ? 'Save' : 'Add Vendor'}
              </button>
            </div>
          </div>
        )}
      </form>
    </Modal>
  )
}
