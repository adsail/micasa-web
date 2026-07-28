import React from 'react'
import { api } from '../api'
import { Card, Spinner, ErrorBox, Empty, SectionTitle } from './ui'
import { money, fmtDate } from '../format'
import QuoteModal from './QuoteModal'

export default function QuotesTab() {
  const [s, setS] = React.useState({ loading: true })
  const [addOpen, setAddOpen] = React.useState(false)
  const [editQuote, setEditQuote] = React.useState(null)
  const [toast, setToast] = React.useState(null)

  const load = React.useCallback(() => {
    return api
      .quotes()
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
        <SectionTitle count={(s.data || []).length}>Quotes</SectionTitle>
        <button
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-sienna px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sienna-500 dark:bg-cursor-accent dark:hover:bg-cursor-accent-hover dark:text-cursor"
        >
          <span className="text-base leading-none">+</span> Add Quote
        </button>
      </div>

      {!s.data?.length ? (
        <Empty>No quotes recorded.</Empty>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-calm-50 text-left text-xs uppercase text-shale-500 dark:bg-cursor-elevated/50">
                <tr>
                  <th className="px-4 py-3">Project</th>
                  <th className="px-4 py-3">Vendor</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Labor</th>
                  <th className="px-4 py-3 text-right">Materials</th>
                  <th className="px-4 py-3 text-right">Other</th>
                  <th className="px-4 py-3">Received</th>
                </tr>
              </thead>
              <tbody>
                {s.data.map((q) => (
                  <tr
                    key={q.id}
                    onClick={() => setEditQuote(q)}
                    title="Click to edit"
                    className="cursor-pointer border-t border-calm hover:bg-calm-50 dark:border-cursor-border dark:hover:bg-cursor-elevated/40"
                  >
                    <td className="px-4 py-3 font-medium">{q.project_title || '—'}</td>
                    <td className="px-4 py-3">{q.vendor_name || '—'}</td>
                    <td className="px-4 py-3 text-right font-bold">{money(q.total_cents)}</td>
                    <td className="px-4 py-3 text-right text-shale-600">{money(q.labor_cents)}</td>
                    <td className="px-4 py-3 text-right text-shale-600">{money(q.materials_cents)}</td>
                    <td className="px-4 py-3 text-right text-shale-600">{money(q.other_cents)}</td>
                    <td className="px-4 py-3 text-shale-600">{fmtDate(q.received_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <QuoteModal
        open={addOpen}
        quote={null}
        onClose={() => setAddOpen(false)}
        onSaved={async () => {
          setAddOpen(false)
          await load()
          showToast('Quote added')
        }}
      />

      <QuoteModal
        open={!!editQuote}
        quote={editQuote}
        onClose={() => setEditQuote(null)}
        onSaved={async () => {
          setEditQuote(null)
          await load()
          showToast('Quote saved')
        }}
        onDeleted={async () => {
          setEditQuote(null)
          await load()
          showToast('Quote deleted')
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
