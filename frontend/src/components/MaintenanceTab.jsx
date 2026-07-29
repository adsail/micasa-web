import React from 'react'
import { api } from '../api'
import { Card, Spinner, ErrorBox, Empty, SectionTitle, Badge } from './ui'
import { money, fmtDate } from '../format'
import MaintenanceModal from './MaintenanceModal'
import ServiceLogModal from './ServiceLogModal'

const dueBadge = (status) => {
  if (status === 'overdue') return <Badge color="red">Overdue</Badge>
  if (status === 'upcoming') return <Badge color="amber">Due soon</Badge>
  if (status === 'ok') return <Badge color="green">On track</Badge>
  return <Badge color="slate">No schedule</Badge>
}

const rowAccent = (status) => {
  if (status === 'overdue') return 'border-l-4 border-red-500'
  if (status === 'upcoming') return 'border-l-4 border-amber-500'
  return 'border-l-4 border-transparent'
}

export default function MaintenanceTab() {
  const [s, setS] = React.useState({ loading: true })
  const [open, setOpen] = React.useState(null)
  const [addOpen, setAddOpen] = React.useState(false)
  const [editItem, setEditItem] = React.useState(null)
  const [logModal, setLogModal] = React.useState(null) // { itemId, entry? }
  const [toast, setToast] = React.useState(null)
  const [histKey, setHistKey] = React.useState(0)

  const load = React.useCallback(() => {
    return api
      .maintenance()
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

  const afterLogChange = React.useCallback(async (msg) => {
    setLogModal(null)
    setHistKey((k) => k + 1)
    await load()
    showToast(msg)
  }, [load, showToast])

  if (s.loading) return <Spinner />
  if (s.error) return <ErrorBox error={s.error} />

  const overdue = (s.data || []).filter((m) => m.due_status === 'overdue').length
  const upcoming = (s.data || []).filter((m) => m.due_status === 'upcoming').length

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <SectionTitle count={(s.data || []).length}>Maintenance</SectionTitle>
        <button
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-sienna px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sienna-500 dark:bg-cursor-accent dark:hover:bg-cursor-accent-hover dark:text-cursor"
        >
          <span className="text-base leading-none">+</span> Add Maintenance
        </button>
      </div>

      {!s.data?.length ? (
        <Empty>No maintenance items.</Empty>
      ) : (
        <>
          <div className="mb-4 flex gap-2">
            {overdue > 0 && <Badge color="red">{overdue} overdue</Badge>}
            {upcoming > 0 && <Badge color="amber">{upcoming} due soon</Badge>}
          </div>
          <div className="grid gap-3">
            {s.data.map((m) => (
              <Card key={m.id} className={`p-5 ${rowAccent(m.due_status)}`}>
                <div
                  onClick={(e) => {
                    if (e.target.closest('button, a')) return
                    setEditItem(m)
                  }}
                  title="Click to edit"
                  className="cursor-pointer"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-lg font-bold">{m.name}</h3>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {m.category_name && <Badge color="violet">{m.category_name}</Badge>}
                        {dueBadge(m.due_status)}
                        {m.appliance_name && <Badge color="blue">{m.appliance_name}</Badge>}
                      </div>
                    </div>
                    <div className="text-right text-sm">
                      <div className="font-semibold text-chocolate dark:text-cursor-text">
                        {m.computed_due_date ? `Due ${fmtDate(m.computed_due_date)}` : 'No due date'}
                      </div>
                      {m.interval_months && <div className="text-xs text-shale-500">every {m.interval_months} mo</div>}
                      {m.last_serviced_at && <div className="text-xs text-shale-500">last {fmtDate(m.last_serviced_at)}</div>}
                    </div>
                  </div>
                  {m.notes && <p className="mt-3 text-sm text-chocolate dark:text-cursor-text">{m.notes}</p>}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                  {m.cost_cents?.cents != null && <span className="text-shale-500">Cost: {money(m.cost_cents)}</span>}
                  {m.manual_url && <a href={m.manual_url} target="_blank" rel="noreferrer" className="text-sienna hover:underline dark:text-cursor-accent">Manual</a>}
                  <button
                    onClick={() => setLogModal({ itemId: m.id, entry: null })}
                    className="font-semibold text-sienna hover:underline dark:text-cursor-accent"
                  >
                    Log service
                  </button>
                  <button onClick={() => setOpen(open === m.id ? null : m.id)} className="font-semibold text-sienna hover:underline dark:text-cursor-accent">
                    {open === m.id ? 'Hide history' : 'Service history'}
                  </button>
                </div>
                {open === m.id && (
                  <History
                    key={`${m.id}-${histKey}`}
                    id={m.id}
                    onAdd={() => setLogModal({ itemId: m.id, entry: null })}
                    onEdit={(entry) => setLogModal({ itemId: m.id, entry })}
                    onDeleted={async () => {
                      setHistKey((k) => k + 1)
                      await load()
                      showToast('Service log deleted')
                    }}
                  />
                )}
              </Card>
            ))}
          </div>
        </>
      )}

      <MaintenanceModal
        open={addOpen}
        item={null}
        onClose={() => setAddOpen(false)}
        onSaved={async () => {
          setAddOpen(false)
          await load()
          showToast('Maintenance item added')
        }}
      />

      <MaintenanceModal
        open={!!editItem}
        item={editItem}
        onClose={() => setEditItem(null)}
        onSaved={async () => {
          setEditItem(null)
          await load()
          showToast('Maintenance item saved')
        }}
        onDeleted={async () => {
          setEditItem(null)
          await load()
          showToast('Maintenance item deleted')
        }}
      />

      <ServiceLogModal
        open={!!logModal}
        entry={logModal?.entry || null}
        maintenanceItemId={logModal?.itemId}
        onClose={() => setLogModal(null)}
        onSaved={async () => {
          await afterLogChange(logModal?.entry ? 'Service log saved' : 'Service logged')
        }}
        onDeleted={async () => {
          await afterLogChange('Service log deleted')
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

function History({ id, onAdd, onEdit, onDeleted }) {
  const [s, setS] = React.useState({ loading: true })
  const [confirmId, setConfirmId] = React.useState(null)
  const [deleting, setDeleting] = React.useState(false)

  React.useEffect(() => {
    api.maintenanceItem(id).then((data) => setS({ loading: false, data })).catch((error) => setS({ loading: false, error }))
  }, [id])

  const doDelete = async (entryId) => {
    if (deleting) return
    setDeleting(true)
    try {
      await api.deleteServiceLog(entryId)
      setConfirmId(null)
      await onDeleted?.(entryId)
    } catch (err) {
      setS((prev) => ({ ...prev, error: err }))
      setDeleting(false)
      setConfirmId(null)
    }
  }

  if (s.loading) return <div className="py-3"><Spinner /></div>
  if (s.error) return <ErrorBox error={s.error} />
  const log = s.data?.service_log || []

  return (
    <div className="mt-3 border-t border-calm pt-3 dark:border-cursor-border">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-xs font-bold uppercase tracking-wide text-shale-500">Service History</h4>
        <button
          onClick={onAdd}
          className="text-xs font-semibold text-sienna hover:underline dark:text-cursor-accent"
        >
          + Log service
        </button>
      </div>
      {!log.length ? (
        <p className="text-sm text-shale-500">No service history recorded.</p>
      ) : (
        <ul className="space-y-2">
          {log.map((e) => (
            <li key={e.id} className="rounded-lg border border-transparent px-2 py-1.5 hover:border-calm hover:bg-calm-50 dark:hover:border-cursor-border dark:hover:bg-cursor-elevated/40">
              {confirmId === e.id ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-semibold text-red-700 dark:text-red-300">Delete this service log?</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmId(null)}
                      disabled={deleting}
                      className="rounded-lg px-2 py-1 text-xs font-semibold text-chocolate hover:bg-calm disabled:opacity-50 dark:text-cursor-text"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => doDelete(e.id)}
                      disabled={deleting}
                      className="rounded-lg bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                    >
                      {deleting ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => onEdit?.(e)}
                    title="Click to edit"
                    className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-left"
                  >
                    <span className="font-medium">{fmtDate(e.serviced_at)}</span>
                    <span className="text-shale-600">{e.vendor_name || '—'}</span>
                    <span className="font-semibold">{money(e.cost_cents)}</span>
                    {e.notes && <span className="w-full text-xs text-shale-500">{e.notes}</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmId(e.id)}
                    className="shrink-0 text-xs font-semibold text-red-600 hover:underline dark:text-red-400"
                  >
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
