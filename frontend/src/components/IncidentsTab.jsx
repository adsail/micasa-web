import React from 'react'
import { api } from '../api'
import { Card, Spinner, ErrorBox, Empty, SectionTitle, Badge } from './ui'
import { money, fmtDate } from '../format'
import IncidentModal from './IncidentModal'

const sevColor = (s) => ({ urgent: 'red', soon: 'amber', whenever: 'sienna' }[s] || 'slate')
const sevAccent = (s) => ({ urgent: 'border-red-500', soon: 'border-amber-500', whenever: 'border-sienna-500' }[s] || 'border-shale')

export default function IncidentsTab() {
  const [scope, setScope] = React.useState('open')
  const [s, setS] = React.useState({ loading: true })
  const [addOpen, setAddOpen] = React.useState(false)
  const [editIncident, setEditIncident] = React.useState(null)
  const [toast, setToast] = React.useState(null)

  const load = React.useCallback(() => {
    setS({ loading: true })
    return api
      .incidents(scope)
      .then((data) => setS({ loading: false, data }))
      .catch((error) => setS({ loading: false, error }))
  }, [scope])

  React.useEffect(() => {
    load()
  }, [load])

  const showToast = React.useCallback((msg, kind = 'success') => {
    setToast({ msg, kind })
    window.clearTimeout(showToast._t)
    showToast._t = window.setTimeout(() => setToast(null), 3000)
  }, [])

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <SectionTitle count={s.data?.length}>Incidents</SectionTitle>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-xl border border-shale text-sm dark:border-cursor-border">
            {['open', 'all'].map((v) => (
              <button
                key={v}
                onClick={() => setScope(v)}
                className={`px-4 py-1.5 font-semibold capitalize transition ${
                  scope === v ? 'bg-sienna text-white dark:bg-cursor-accent dark:text-cursor' : 'bg-white text-chocolate dark:bg-cursor-surface dark:text-cursor-text'
                }`}
              >
                {v === 'open' ? 'Open' : 'All'}
              </button>
            ))}
          </div>
          <button
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-sienna px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sienna-500 dark:bg-cursor-accent dark:hover:bg-cursor-accent-hover dark:text-cursor"
          >
            <span className="text-base leading-none">+</span> Add Incident
          </button>
        </div>
      </div>
      {s.loading ? (
        <Spinner />
      ) : s.error ? (
        <ErrorBox error={s.error} />
      ) : !s.data?.length ? (
        <Empty>No {scope === 'open' ? 'open ' : ''}incidents. 🎉</Empty>
      ) : (
        <div className="grid gap-3">
          {s.data.map((i) => (
            <div
              key={i.id}
              onClick={(e) => {
                if (e.target.closest('button, a')) return
                setEditIncident(i)
              }}
              title="Click to edit"
              className="cursor-pointer"
            >
              <Card className={`border-l-4 p-5 transition hover:shadow-md hover:ring-1 hover:ring-sienna-300 dark:hover:ring-cursor-accent ${sevAccent(i.severity)} ${i.resolved ? 'opacity-70' : ''}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-lg font-bold">{i.title}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {i.severity && <Badge color={sevColor(i.severity)}>{i.severity}</Badge>}
                      <Badge color={i.resolved ? 'green' : 'slate'}>{i.resolved ? 'Resolved' : (i.status || 'open').replace(/_/g, ' ')}</Badge>
                      {i.location && <Badge color="slate">{i.location}</Badge>}
                    </div>
                  </div>
                  <div className="text-right text-xs text-shale-500">
                    {i.date_noticed && <div>Noticed {fmtDate(i.date_noticed)}</div>}
                    {i.date_resolved && <div>Resolved {fmtDate(i.date_resolved)}</div>}
                  </div>
                </div>
                {i.description && <p className="mt-3 text-sm text-chocolate dark:text-cursor-text">{i.description}</p>}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-shale-500">
                  {i.appliance_name && <span>Appliance: {i.appliance_name}</span>}
                  {i.vendor_name && <span>Vendor: {i.vendor_name}</span>}
                  {i.cost_cents?.cents != null && <span>Cost: {money(i.cost_cents)}</span>}
                </div>
                {i.notes && <p className="mt-2 text-xs text-shale-500">{i.notes}</p>}
              </Card>
            </div>
          ))}
        </div>
      )}

      <IncidentModal
        open={addOpen}
        incident={null}
        onClose={() => setAddOpen(false)}
        onSaved={async () => {
          setAddOpen(false)
          await load()
          showToast('Incident added')
        }}
      />

      <IncidentModal
        open={!!editIncident}
        incident={editIncident}
        onClose={() => setEditIncident(null)}
        onSaved={async () => {
          setEditIncident(null)
          await load()
          showToast('Incident saved')
        }}
        onResolved={async () => {
          setEditIncident(null)
          await load()
          showToast('Incident resolved')
        }}
        onDeleted={async () => {
          setEditIncident(null)
          await load()
          showToast('Incident deleted')
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
