import React from 'react'
import { api } from '../api'
import { Card, Spinner, ErrorBox, Empty, SectionTitle, Badge } from './ui'
import { money, fmtDate } from '../format'
import ApplianceModal from './ApplianceModal'

export default function AppliancesTab() {
  const [s, setS] = React.useState({ loading: true })
  const [addOpen, setAddOpen] = React.useState(false)
  const [editAppliance, setEditAppliance] = React.useState(null)
  const [toast, setToast] = React.useState(null)

  const load = React.useCallback(() => {
    return api
      .appliances()
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

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <SectionTitle count={(s.data || []).length}>Appliances</SectionTitle>
        <button
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-sienna px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sienna-500 dark:bg-cursor-accent dark:hover:bg-cursor-accent-hover dark:text-cursor"
        >
          <span className="text-base leading-none">+</span> Add Appliance
        </button>
      </div>

      {!s.data?.length ? (
        <Empty>No appliances recorded.</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {s.data.map((a) => {
            const warrantyExpired = a.warranty_expiry && new Date(a.warranty_expiry) < new Date()
            return (
              <div key={a.id} onClick={() => setEditAppliance(a)} title="Click to edit" className="cursor-pointer">
                <Card className="p-5 transition hover:shadow-md hover:ring-1 hover:ring-sienna-300 dark:hover:ring-cursor-accent">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-lg font-bold">{a.name}</h3>
                    {a.warranty_expiry && (
                      <Badge color={warrantyExpired ? 'slate' : 'green'}>
                        {warrantyExpired ? 'Warranty ended' : 'Under warranty'}
                      </Badge>
                    )}
                  </div>
                  {a.brand && <p className="text-sm font-medium text-shale-600 dark:text-cursor-muted">{a.brand}</p>}
                  <dl className="mt-3 space-y-1 text-sm">
                    {a.model_number && <Row k="Model" v={a.model_number} />}
                    {a.serial_number && <Row k="Serial" v={a.serial_number} />}
                    {a.location && <Row k="Location" v={a.location} />}
                    {a.purchase_date && <Row k="Purchased" v={fmtDate(a.purchase_date)} />}
                    {a.warranty_expiry && <Row k="Warranty" v={fmtDate(a.warranty_expiry)} />}
                    {a.cost_cents?.cents != null && <Row k="Cost" v={money(a.cost_cents)} />}
                  </dl>
                  {a.notes && <p className="mt-3 text-sm text-shale-600 dark:text-cursor-muted">{a.notes}</p>}
                </Card>
              </div>
            )
          })}
        </div>
      )}

      <ApplianceModal
        open={addOpen}
        appliance={null}
        onClose={() => setAddOpen(false)}
        onSaved={async () => {
          setAddOpen(false)
          await load()
          showToast('Appliance added')
        }}
      />

      <ApplianceModal
        open={!!editAppliance}
        appliance={editAppliance}
        onClose={() => setEditAppliance(null)}
        onSaved={async () => {
          setEditAppliance(null)
          await load()
          showToast('Appliance saved')
        }}
        onDeleted={async () => {
          setEditAppliance(null)
          await load()
          showToast('Appliance deleted')
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

function Row({ k, v }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-shale-500">{k}</dt>
      <dd className="text-right font-medium text-chocolate dark:text-cursor-text break-all">{v}</dd>
    </div>
  )
}
