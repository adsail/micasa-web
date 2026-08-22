const base = ''

async function get(path) {
  const res = await fetch(`${base}/api${path}`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

async function mutate(method, path, body) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const j = await res.json()
      if (j && j.detail) detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)
    } catch {}
    throw new Error(detail)
  }
  return res.json()
}

export const api = {
  health: () => get('/health'),
  house: () => get('/house'),
  projects: () => get('/projects'),
  project: (id) => get(`/projects/${id}`),
  projectTypes: () => get('/project-types'),
  createProject: (body) => mutate('POST', '/projects', body),
  updateProjectStatus: (id, status) => mutate('PATCH', `/projects/${id}/status`, { status }),
  updateProject: (id, body) => mutate('PUT', `/projects/${id}`, body),
  deleteProject: (id) => mutate('DELETE', `/projects/${id}`),
  quotes: () => get('/quotes'),
  createQuote: (body) => mutate('POST', '/quotes', body),
  updateQuote: (id, body) => mutate('PUT', `/quotes/${id}`, body),
  deleteQuote: (id) => mutate('DELETE', `/quotes/${id}`),
  maintenance: () => get('/maintenance'),
  maintenanceItem: (id) => get(`/maintenance/${id}`),
  maintenanceOverdue: () => get('/maintenance/overdue'),
  maintenanceCategories: () => get('/maintenance-categories'),
  createMaintenance: (body) => mutate('POST', '/maintenance', body),
  updateMaintenance: (id, body) => mutate('PUT', `/maintenance/${id}`, body),
  deleteMaintenance: (id) => mutate('DELETE', `/maintenance/${id}`),
  createServiceLog: (body) => mutate('POST', '/service-logs', body),
  updateServiceLog: (id, body) => mutate('PUT', `/service-logs/${id}`, body),
  deleteServiceLog: (id) => mutate('DELETE', `/service-logs/${id}`),
  incidents: (status = 'open') => get(`/incidents?status=${status}`),
  createIncident: (body) => mutate('POST', '/incidents', body),
  updateIncident: (id, body) => mutate('PUT', `/incidents/${id}`, body),
  deleteIncident: (id) => mutate('DELETE', `/incidents/${id}`),
  resolveIncident: (id) => mutate('DELETE', `/incidents/${id}?resolve=true`),
  appliances: () => get('/appliances'),
  createAppliance: (body) => mutate('POST', '/appliances', body),
  updateAppliance: (id, body) => mutate('PUT', `/appliances/${id}`, body),
  deleteAppliance: (id) => mutate('DELETE', `/appliances/${id}`),
  vendors: () => get('/vendors'),
  createVendor: (body) => mutate('POST', '/vendors', body),
  updateVendor: (id, body) => mutate('PUT', `/vendors/${id}`, body),
  deleteVendor: (id) => mutate('DELETE', `/vendors/${id}`),
  documents: () => get('/documents'),
  docRaw: (id) => `${base}/api/documents/${id}/raw`,
  opexSummary: (period) => get(`/opex/summary?period=${encodeURIComponent(period)}`),
  opexSeries: () => get("/opex/series"),
  programs: () => get('/programs'),
  program: (id) => get(`/programs/${id}`),
  createProgram: (body) => mutate('POST', '/programs', body),
  updateProgram: (id, body) => mutate('PUT', `/programs/${id}`, body),
  deleteProgram: (id) => mutate('DELETE', `/programs/${id}`),
  addProgramProject: (id, body) => mutate('POST', `/programs/${id}/projects`, body),
  removeProgramProject: (id, projectId) => mutate('DELETE', `/programs/${id}/projects/${projectId}`),
}
