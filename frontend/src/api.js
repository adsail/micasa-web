const base = ''

// Set by App so an expired session mid-use bounces back to the login screen.
// The /auth/* routes opt out: a 401 there is the login form's own business.
let unauthorizedHandler = null

export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn
}

function onUnauthorized(path) {
  if (path.startsWith('/auth/')) return
  unauthorizedHandler?.()
}

// Double-submit CSRF: the backend sets a readable csrf_token cookie at login
// and requires the same value back in a header on every mutation. There is no
// cookie when AUTH_ENABLED is off, and the backend skips the check then too.
function csrfToken() {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)
  return m ? decodeURIComponent(m[1]) : ''
}

async function get(path) {
  const res = await fetch(`${base}/api${path}`)
  if (!res.ok) {
    if (res.status === 401) onUnauthorized(path)
    throw new Error(`${res.status} ${res.statusText}`)
  }
  return res.json()
}

async function mutate(method, path, body) {
  const headers = { 'Content-Type': 'application/json' }
  const token = csrfToken()
  if (token) headers['X-CSRF-Token'] = token
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    if (res.status === 401) onUnauthorized(path)
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
  authMe: () => get('/auth/me'),
  login: (username, password) => mutate('POST', '/auth/login', { username, password }),
  logout: () => mutate('POST', '/auth/logout'),
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
}
