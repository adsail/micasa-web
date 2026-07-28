import React from 'react'
import { api } from '../api'
import { Modal } from './ui'

const inputClass =
  'w-full rounded-lg border border-shale bg-white px-3 py-2 text-sm text-chocolate-900 shadow-sm outline-none transition focus:border-sienna focus:ring-2 focus:ring-sienna/30 dark:focus:border-cursor-accent dark:focus:ring-cursor-accent/30 dark:border-cursor-border dark:bg-cursor-elevated dark:text-cursor-text disabled:cursor-not-allowed disabled:opacity-60'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-shale-600 dark:text-cursor-secondary'

// Add / edit a maintenance item. Mirrors micasa's MaintenanceItem model and
// form exactly:
//  - Item name REQUIRED; Category REQUIRED (live maintenance_categories)
//  - Appliance optional (live appliances)
//  - Schedule MUTUALLY EXCLUSIVE: None | Recurring interval | Fixed due date
//  - Last serviced optional date; Manual URL / manual notes / Cost / Notes optional
export default function MaintenanceModal({ open, item, onClose, onSaved, onDeleted }) {
  const isEdit = !!(item && item.id != null)
  const [form, setForm] = React.useState(null)
  const [categories, setCategories] = React.useState([])
  const [appliances, setAppliances] = React.useState([])
  const [submitting, setSubmitting] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [error, setError] = React.useState(null)

  React.useEffect(() => {
    if (!open) return
    let schedule = 'none'
    if (item?.interval_months) schedule = 'interval'
    else if (item?.due_date) schedule = 'due_date'
    setForm({
      name: item?.name || '',
      category_id: item?.category_id != null ? String(item.category_id) : '',
      appliance_id: item?.appliance_id != null ? String(item.appliance_id) : '',
      last_serviced_at: item?.last_serviced_at || '',
      schedule,
      interval_months: item?.interval_months ? String(item.interval_months) : '',
      due_date: item?.due_date || '',
      manual_url: item?.manual_url || '',
      manual_text: item?.manual_text || '',
      cost_dollars: item?.cost_cents?.dollars != null ? String(item.cost_cents.dollars) : '',
      notes: item?.notes || '',
    })
    setError(null)
    setSubmitting(false)
    setDeleting(false)
    setConfirmDelete(false)
    api.maintenanceCategories().then((c) => {
      setCategories(c)
      // default category to first (matches micasa's create form) when creating
      if (!isEdit) setForm((f) => (f && !f.category_id && c.length ? { ...f, category_id: String(c[0].id) } : f))
    }).catch(() => setCategories([]))
    api.appliances().then(setAppliances).catch(() => setAppliances([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const canSave = form && form.name.trim() && form.category_id !== '' && !submitting && !deleting

  const submit = async (e) => {
    e.preventDefault()
    if (!canSave) return
    setSubmitting(true)
    setError(null)
    const body = {
      name: form.name.trim(),
      category_id: parseInt(form.category_id, 10),
      appliance_id: form.appliance_id ? parseInt(form.appliance_id, 10) : null,
      last_serviced_at: form.last_serviced_at || null,
      // Send only the chosen schedule side; the backend enforces exclusivity.
      interval_months: form.schedule === 'interval' && form.interval_months !== '' ? parseInt(form.interval_months, 10) : null,
      due_date: form.schedule === 'due_date' ? (form.due_date || null) : null,
      manual_url: form.manual_url.trim() || null,
      manual_text: form.manual_text.trim() || null,
      cost_dollars: form.cost_dollars !== '' && form.cost_dollars != null ? parseFloat(form.cost_dollars) : null,
      notes: form.notes.trim() || null,
    }
    try {
      const saved = isEdit ? await api.updateMaintenance(item.id, body) : await api.createMaintenance(body)
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
      await api.deleteMaintenance(item.id)
      await onDeleted?.(item)
    } catch (err) {
      setError(err.message)
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  if (!open || !form) return null
  const busy = submitting || deleting

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? `Edit: ${item.name}` : 'Add Maintenance Item'}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={labelClass}>Item *</label>
          <input className={inputClass} value={form.name} onChange={set('name')} placeholder="e.g. Furnace filter" autoFocus />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Category *</label>
            <select className={inputClass} value={form.category_id} onChange={set('category_id')}>
              <option value="">— select —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Appliance</label>
            <select className={inputClass} value={form.appliance_id} onChange={set('appliance_id')}>
              <option value="">— none —</option>
              {appliances.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Last serviced</label>
            <input className={inputClass} type="date" value={form.last_serviced_at} onChange={set('last_serviced_at')} />
          </div>
          <div>
            <label className={labelClass}>Schedule</label>
            <select className={inputClass} value={form.schedule} onChange={set('schedule')}>
              <option value="none">None</option>
              <option value="interval">Recurring interval</option>
              <option value="due_date">Fixed due date</option>
            </select>
          </div>
        </div>

        {form.schedule === 'interval' && (
          <div>
            <label className={labelClass}>Interval (months)</label>
            <input className={inputClass} type="number" min="0" step="1" value={form.interval_months} onChange={set('interval_months')} placeholder="6" />
          </div>
        )}
        {form.schedule === 'due_date' && (
          <div>
            <label className={labelClass}>Due date</label>
            <input className={inputClass} type="date" value={form.due_date} onChange={set('due_date')} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Manual URL</label>
            <input className={inputClass} value={form.manual_url} onChange={set('manual_url')} placeholder="https://…" />
          </div>
          <div>
            <label className={labelClass}>Cost $</label>
            <input className={inputClass} type="number" step="0.01" min="0" value={form.cost_dollars} onChange={set('cost_dollars')} placeholder="125.00" />
          </div>
        </div>

        <div>
          <label className={labelClass}>Manual notes</label>
          <textarea className={inputClass} rows={2} value={form.manual_text} onChange={set('manual_text')} placeholder="Optional manual instructions…" />
        </div>

        <div>
          <label className={labelClass}>Notes</label>
          <textarea className={inputClass} rows={2} value={form.notes} onChange={set('notes')} placeholder="Optional notes…" />
        </div>

        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        {isEdit && confirmDelete ? (
          <div className="flex flex-col gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-3 text-sm dark:border-red-900 dark:bg-red-950/40">
            <span className="font-semibold text-red-700 dark:text-red-300">Delete this maintenance item? It will be hidden (soft-deleted).</span>
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
              <button type="submit" disabled={!canSave} className="rounded-xl bg-sienna px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sienna-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-cursor-accent dark:text-cursor dark:hover:bg-cursor-accent-hover">{submitting ? 'Saving…' : isEdit ? 'Save' : 'Add Item'}</button>
            </div>
          </div>
        )}
      </form>
    </Modal>
  )
}
