import React from 'react'
import { api } from '../api'
import { Modal } from './ui'

const inputClass =
  'w-full rounded-lg border border-shale bg-white px-3 py-2 text-sm text-chocolate-900 shadow-sm outline-none transition focus:border-sienna focus:ring-2 focus:ring-sienna/30 dark:focus:border-cursor-accent dark:focus:ring-cursor-accent/30 dark:border-cursor-border dark:bg-cursor-elevated dark:text-cursor-text disabled:cursor-not-allowed disabled:opacity-60'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-shale-600 dark:text-cursor-secondary'

// Add / edit an appliance. Mirrors micasa's Appliance model exactly:
//  - Name REQUIRED; Brand / Model / Serial / Location / Notes optional strings
//  - Purchase date / Warranty expiry optional dates; Cost optional money
export default function ApplianceModal({ open, appliance, onClose, onSaved, onDeleted }) {
  const isEdit = !!(appliance && appliance.id != null)
  const [form, setForm] = React.useState(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [error, setError] = React.useState(null)

  React.useEffect(() => {
    if (!open) return
    setForm({
      name: appliance?.name || '',
      brand: appliance?.brand || '',
      model_number: appliance?.model_number || '',
      serial_number: appliance?.serial_number || '',
      location: appliance?.location || '',
      purchase_date: appliance?.purchase_date || '',
      warranty_expiry: appliance?.warranty_expiry || '',
      cost_dollars: appliance?.cost_cents?.dollars != null ? String(appliance.cost_cents.dollars) : '',
      notes: appliance?.notes || '',
    })
    setError(null)
    setSubmitting(false)
    setDeleting(false)
    setConfirmDelete(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, appliance])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const canSave = form && form.name.trim() && !submitting && !deleting

  const submit = async (e) => {
    e.preventDefault()
    if (!canSave) return
    setSubmitting(true)
    setError(null)
    const body = {
      name: form.name.trim(),
      brand: form.brand.trim() || null,
      model_number: form.model_number.trim() || null,
      serial_number: form.serial_number.trim() || null,
      location: form.location.trim() || null,
      purchase_date: form.purchase_date || null,
      warranty_expiry: form.warranty_expiry || null,
      cost_dollars: form.cost_dollars !== '' && form.cost_dollars != null ? parseFloat(form.cost_dollars) : null,
      notes: form.notes.trim() || null,
    }
    try {
      const saved = isEdit ? await api.updateAppliance(appliance.id, body) : await api.createAppliance(body)
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
      await api.deleteAppliance(appliance.id)
      await onDeleted?.(appliance)
    } catch (err) {
      setError(err.message)
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  if (!open || !form) return null
  const busy = submitting || deleting

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? `Edit: ${appliance.name}` : 'Add Appliance'}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={labelClass}>Name *</label>
          <input className={inputClass} value={form.name} onChange={set('name')} placeholder="Kitchen Refrigerator" autoFocus />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Brand</label>
            <input className={inputClass} value={form.brand} onChange={set('brand')} />
          </div>
          <div>
            <label className={labelClass}>Location</label>
            <input className={inputClass} value={form.location} onChange={set('location')} placeholder="Kitchen" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Model number</label>
            <input className={inputClass} value={form.model_number} onChange={set('model_number')} />
          </div>
          <div>
            <label className={labelClass}>Serial number</label>
            <input className={inputClass} value={form.serial_number} onChange={set('serial_number')} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelClass}>Purchased</label>
            <input className={inputClass} type="date" value={form.purchase_date} onChange={set('purchase_date')} />
          </div>
          <div>
            <label className={labelClass}>Warranty exp.</label>
            <input className={inputClass} type="date" value={form.warranty_expiry} onChange={set('warranty_expiry')} />
          </div>
          <div>
            <label className={labelClass}>Cost $</label>
            <input className={inputClass} type="number" step="0.01" min="0" value={form.cost_dollars} onChange={set('cost_dollars')} placeholder="899.00" />
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
            <span className="font-semibold text-red-700 dark:text-red-300">Delete this appliance? It will be hidden (soft-deleted).</span>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmDelete(false)} disabled={busy} className="rounded-xl px-4 py-2 text-sm font-semibold text-chocolate transition hover:bg-calm disabled:opacity-50 dark:text-cursor-text dark:hover:bg-cursor-elevated">Cancel</button>
              <button type="button" onClick={doDelete} disabled={busy} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50">{deleting ? 'Deleting…' : 'Delete'}</button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 pt-1">
            {isEdit ? (
              <button type="button" onClick={() => setConfirmDelete(true)} disabled={busy} className="rounded-xl px-3 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40">Delete</button>
            ) : (<span />)}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} disabled={busy} className="rounded-xl px-4 py-2 text-sm font-semibold text-chocolate transition hover:bg-calm disabled:opacity-50 dark:text-cursor-text dark:hover:bg-cursor-elevated">Cancel</button>
              <button type="submit" disabled={!canSave} className="rounded-xl bg-sienna px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sienna-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-cursor-accent dark:text-cursor dark:hover:bg-cursor-accent-hover">{submitting ? 'Saving…' : isEdit ? 'Save' : 'Add Appliance'}</button>
            </div>
          </div>
        )}
      </form>
    </Modal>
  )
}
