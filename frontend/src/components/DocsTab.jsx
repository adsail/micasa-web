import React from 'react'
import { api } from '../api'
import { Card, Spinner, ErrorBox, Empty, SectionTitle, Badge } from './ui'
import { fmtDate } from '../format'

function fmtBytes(b) {
  if (b == null) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

export default function DocsTab() {
  const [s, setS] = React.useState({ loading: true })
  const [lightbox, setLightbox] = React.useState(null)
  React.useEffect(() => {
    api.documents().then((data) => setS({ loading: false, data })).catch((error) => setS({ loading: false, error }))
  }, [])
  if (s.loading) return <Spinner />
  if (s.error) return <ErrorBox error={s.error} />
  if (!s.data?.length) return <Empty>No documents.</Empty>
  return (
    <div>
      <SectionTitle count={s.data.length}>Documents</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {s.data.map((d) => (
          <Card key={d.id} className="overflow-hidden">
            {d.is_image ? (
              <button onClick={() => setLightbox(d)} className="block w-full">
                <img
                  src={api.docRaw(d.id)}
                  alt={d.title}
                  loading="lazy"
                  className="h-44 w-full cursor-zoom-in object-cover transition hover:opacity-90"
                />
              </button>
            ) : (
              <a href={api.docRaw(d.id)} target="_blank" rel="noreferrer" className="flex h-44 w-full items-center justify-center bg-calm-50 dark:bg-cursor-elevated/50">
                <div className="text-center">
                  <div className="text-4xl">📄</div>
                  <div className="mt-2 text-xs font-semibold uppercase text-shale-500">{(d.mime_type || '').split('/').pop()}</div>
                </div>
              </a>
            )}
            <div className="p-4">
              <h3 className="font-bold leading-snug">{d.title || d.file_name}</h3>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {d.entity_kind && <Badge color="violet">{d.entity_kind}</Badge>}
                <Badge color="slate">{fmtBytes(d.size_bytes)}</Badge>
              </div>
              {d.notes && <p className="mt-2 text-xs text-shale-600 dark:text-cursor-muted">{d.notes}</p>}
              <div className="mt-2 flex items-center justify-between text-xs text-shale-500">
                <span>{fmtDate(d.created_at)}</span>
                <a href={api.docRaw(d.id)} target="_blank" rel="noreferrer" className="font-semibold text-sienna hover:underline dark:text-cursor-accent">
                  Open
                </a>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setLightbox(null)}
        >
          <div className="max-h-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <img src={api.docRaw(lightbox.id)} alt={lightbox.title} className="max-h-[80vh] w-auto rounded-lg" />
            <div className="mt-3 flex items-center justify-between text-white">
              <div>
                <div className="font-bold">{lightbox.title}</div>
                {lightbox.notes && <div className="mt-1 max-w-2xl text-sm text-white/70">{lightbox.notes}</div>}
              </div>
              <button onClick={() => setLightbox(null)} className="rounded-lg bg-white/20 px-3 py-1.5 text-sm font-semibold hover:bg-white/30">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
