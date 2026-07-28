import React from 'react'
import { api } from '../api'
import { Card, Spinner, ErrorBox, Empty, SectionTitle, Badge } from './ui'
import VendorModal from './VendorModal'

export default function VendorsTab() {
  const [s, setS] = React.useState({ loading: true })
  const [addOpen, setAddOpen] = React.useState(false)
  const [editVendor, setEditVendor] = React.useState(null)
  const [toast, setToast] = React.useState(null)

  const load = React.useCallback(() => {
    return api
      .vendors()
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
        <SectionTitle count={(s.data || []).length}>Vendors</SectionTitle>
        <button
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-sienna px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sienna-500 dark:bg-cursor-accent dark:hover:bg-cursor-accent-hover dark:text-cursor"
        >
          <span className="text-base leading-none">+</span> Add Vendor
        </button>
      </div>

      {!s.data?.length ? (
        <Empty>No vendors recorded.</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {s.data.map((v) => (
            <div
              key={v.id}
              onClick={(e) => {
                if (e.target.closest('a')) return
                setEditVendor(v)
              }}
              title="Click to edit"
              className="cursor-pointer"
            >
              <Card className="p-5 transition hover:shadow-md hover:ring-1 hover:ring-sienna-300 dark:hover:ring-cursor-accent">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-lg font-bold">{v.name}</h3>
                  {v.job_count > 0 && <Badge color="blue">{v.job_count} job{v.job_count === 1 ? '' : 's'}</Badge>}
                </div>
                {v.contact_name && <p className="text-sm text-shale-600 dark:text-cursor-muted">{v.contact_name}</p>}
                <div className="mt-3 space-y-1 text-sm">
                  {v.phone && <a href={`tel:${v.phone}`} onClick={(e) => e.stopPropagation()} className="block text-sienna hover:underline dark:text-cursor-accent">{v.phone}</a>}
                  {v.email && <a href={`mailto:${v.email}`} onClick={(e) => e.stopPropagation()} className="block text-sienna hover:underline dark:text-cursor-accent break-all">{v.email}</a>}
                  {v.website && <a href={v.website.startsWith('http') ? v.website : `https://${v.website}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="block text-sienna hover:underline dark:text-cursor-accent break-all">{v.website}</a>}
                </div>
                {v.notes && <p className="mt-3 text-sm text-shale-600 dark:text-cursor-muted">{v.notes}</p>}
                {(v.quote_count > 0 || v.service_count > 0 || v.incident_count > 0) && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {v.quote_count > 0 && <Badge>{v.quote_count} quotes</Badge>}
                    {v.service_count > 0 && <Badge>{v.service_count} services</Badge>}
                    {v.incident_count > 0 && <Badge>{v.incident_count} incidents</Badge>}
                  </div>
                )}
              </Card>
            </div>
          ))}
        </div>
      )}

      <VendorModal
        open={addOpen}
        vendor={null}
        onClose={() => setAddOpen(false)}
        onSaved={async () => {
          setAddOpen(false)
          await load()
          showToast('Vendor added')
        }}
      />

      <VendorModal
        open={!!editVendor}
        vendor={editVendor}
        onClose={() => setEditVendor(null)}
        onSaved={async () => {
          setEditVendor(null)
          await load()
          showToast('Vendor saved')
        }}
        onDeleted={async () => {
          setEditVendor(null)
          await load()
          showToast('Vendor deleted')
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
