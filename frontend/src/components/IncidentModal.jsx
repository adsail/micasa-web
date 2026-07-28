import React from 'react'
import { api } from '../api'
import { Modal } from './ui'

const inputClass =
  'w-full rounded-lg border border-shale bg-white px-3 py-2 text-sm text-chocolate-900 shadow-sm outline-none transition focus:border-sienna focus:ring-2 focus:ring-sienna/30 dark:focus:border-cursor-accent dark:focus:ring-cursor-accent/30 dark:border-cursor-border dark:bg-cursor-elevated dark:text-cursor-text disabled:cursor-not-allowed disabled:opacity-60'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-shale-600 dark:text-cursor-secondary'

const STATUS_OPTIONS = ['open', 'in_progress']       // micasa has NO 'resolved' status
const SEVERITY_OPTIONS = ['urgent', 'soon', 'whenever']

// Add / edit an incident. Mirrors micasa's Incident model exactly:
//  - Title REQUIRED; Date noticed REQUIRED
//  - Status ENUM open|in_progress (no 'resolved'); Severity ENUM urgent|soon|whenever
//  - Appliance / Vendor optional (live rows); Cost / Location / Description / Notes optional
//  - RESOLVE = set date_resolved + soft-delete (hidden from active list, kept as history)
export default function IncidentModal({ open, incident, onClose, onSaved, onDeleted, onResolved }) {
  const isEdit = !!(incident && incident.id != null)
  // A resolved (soft-deleted) incident is read-only history; only editable when active.
  const isResolved = !!(incident && incident.resolved)
  const [form, setForm] = React.useState(null)
  const [appliances, setAppliances] = React.useState([])
  const [vendors, setVendors] = React.useState([])
  const [submitting, setSubmitting] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [resolving, setResolving] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [error, setError] = React.useState(null)

  React.useEffect(() => {
    if (!open) return
    const today = new Date().toISOString().slice(0, 10)
    setForm({
      title: incident?.title || '',
      description: incident?.description || '',
      status: (incident?.status || 'open').toLowerCase(),
      severity: (incident?.severity || 'soon').toLowerCase(),
      date_noticed: incident?.date_noticed || (isEdit ? '' : today),
      date_resolved: incident?.date_resolved || '',
      location: incident?.location || '',
      cost_dollars: incident?.cost_cents?.dollars != null ? String(incident.cost_cents.dollars) : '',
      appliance_id: incident?.appliance_id != null ? String(incident.appliance_id) : '',
      vendor_id: incident?.vendor_id != null ? String(incident.vendor_id) : '',
      notes: incident?.notes || '',
    })
    setError(null)
    setSubmitting(false)
    setDeleting(false)
    setResolving(false)
    setConfirmDelete(false)
    api.appliances().then(setAppliances).catch(() => setAppliances([]))
    api.vendors().then(setVendors).catch(() => setVendors([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, incident])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const busy = submitting || deleting || resolving
  const canSave = form && form.title.trim() && form.date_noticed && !busy

  const submit = async (e) => {
    e.preventDefault()
    if (!canSave) return
    setSubmitting(true)
    setError(null)
    const body = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      status: form.status,
      severity: form.severity,
      date_noticed: form.date_noticed,
      date_resolved: form.date_resolved || null,
      location: form.location.trim() || null,
      cost_dollars: form.cost_dollars !== '' && form.cost_dollars != null ? parseFloat(form.cost_dollars) : null,
      appliance_id: form.appliance_id ? parseInt(form.appliance_id, 10) : null,
      vendor_id: form.vendor_id ? parseInt(form.vendor_id, 10) : null,
      notes: form.notes.trim() || null,
    }
    try {
      const saved = isEdit ? await api.updateIncident(incident.id, body) : await api.createIncident(body)
      await onSaved?.(saved)
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  const doResolve = async () => {
    if (busy) return
    setResolving(true)
    setError(null)
    try {
      await api.resolveIncident(incident.id)
      await onResolved?.(incident)
    } catch (err) {
      setError(err.message)
      setResolving(false)
    }
  }

  const doDelete = async () => {
    if (busy) return
    setDeleting(true)
    setError(null)
    try {
      await api.deleteIncident(incident.id)
      await onDeleted?.(incident)
    } catch (err) {
      setError(err.message)
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  if (!open || !form) return null

  // Resolved incidents are historical: show read-only details, no editing.
  if (isResolved) {
    return (
      <Modal open={open} onClose={onClose} title={`Resolved: ${incident.title}`}>
        <div className="space-y-3 text-sm">
          <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
            This incident is resolved (kept as history). Resolved incidents can't be edited here.
          </p>
          {incident.description && <p className="text-chocolate dark:text-cursor-text">{incident.description}</p>}
          <div className="text-shale-600 dark:text-cursor-muted">
            {incident.date_noticed && <div>Noticed: {incident.date_noticed}</div>}
            {incident.date_resolved && <div>Resolved: {incident.date_resolved}</div>}
            {incident.severity && <div>Severity: {incident.severity}</div>}
          </div>
          <div className="flex justify-end pt-1">
            <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-semibold text-chocolate transition hover:bg-calm dark:text-cursor-text dark:hover:bg-cursor-elevated">Close</button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? `Edit: ${incident.title}` : 'Add Incident'}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={labelClass}>Title *</label>
          <input className={inputClass} value={form.title} onChange={set('title')} placeholder="e.g. Kitchen sink leak" autoFocus />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Severity</label>
            <select className={inputClass} value={form.severity} onChange={set('severity')}>
              {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {isEdit && (
            <div>
              <label className={labelClass}>Status</label>
              <select className={inputClass} value={form.status} onChange={set('status')}>
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Date noticed *</label>
            <input className={inputClass} type="date" value={form.date_noticed} onChange={set('date_noticed')} />
          </div>
          <div>
            <label className={labelClass}>Location</label>
            <input className={inputClass} value={form.location} onChange={set('location')} placeholder="Kitchen" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Appliance</label>
            <select className={inputClass} value={form.appliance_id} onChange={set('appliance_id')}>
              <option value="">— none —</option>
              {appliances.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Vendor</label>
            <select className={inputClass} value={form.vendor_id} onChange={set('vendor_id')}>
              <option value="">— none —</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className={labelClass}>Cost $</label>
          <input className={inputClass} type="number" step="0.01" min="0" value={form.cost_dollars} onChange={set('cost_dollars')} placeholder="250.00" />
        </div>

        <div>
          <label className={labelClass}>Description</label>
          <textarea className={inputClass} rows={2} value={form.description} onChange={set('description')} placeholder="What happened…" />
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
            <span className="font-semibold text-red-700 dark:text-red-300">Delete this incident? It will be hidden (soft-deleted).</span>
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
              {isEdit && (
                <button type="button" onClick={doResolve} disabled={busy} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">{resolving ? 'Resolving…' : 'Resolve'}</button>
              )}
              <button type="submit" disabled={!canSave} className="rounded-xl bg-sienna px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sienna-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-cursor-accent dark:text-cursor dark:hover:bg-cursor-accent-hover">{submitting ? 'Saving…' : isEdit ? 'Save' : 'Add Incident'}</button>
            </div>
          </div>
        )}
      </form>
    </Modal>
  )
}
