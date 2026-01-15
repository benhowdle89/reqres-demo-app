import { DemoConfig } from './config'

export class ApiError extends Error {
  status?: number
  details?: unknown

  constructor(message: string, status?: number, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & {
  token?: string
  usePublicProjectKey?: boolean
  useManageProjectKey?: boolean
  body?: unknown
  require?: 'public' | 'manage' | 'session'
}

async function jsonRequest<T>(
  config: DemoConfig,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  // Keep API calls consistent: base URL normalization, headers, and error shape.
  const base = (config.baseUrl || 'https://reqres.in').replace(/\/$/, '')
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`
  const {
    token,
    usePublicProjectKey,
    useManageProjectKey,
    body,
    require,
    ...init
  } = options

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers as Record<string, string> | undefined),
  }

  if (require === 'session') {
    if (!token) throw new ApiError('Access is required for this action.')
    headers.Authorization = `Bearer ${token}`
  }

  if (require === 'public') {
    if (!config.publicProjectKey) {
      throw new ApiError('Public access key is missing.')
    }
    headers['x-api-key'] = config.publicProjectKey
  } else if (usePublicProjectKey && config.publicProjectKey) {
    headers['x-api-key'] = config.publicProjectKey
  }

  if (require === 'manage') {
    if (!config.manageProjectKey) {
      throw new ApiError('Management access key is missing.')
    }
    headers['x-api-key'] = config.manageProjectKey
  } else if (useManageProjectKey && config.manageProjectKey) {
    headers['x-api-key'] = config.manageProjectKey
  }

  const requestInit: RequestInit = { ...init, headers }
  if (body !== undefined && body !== null) {
    requestInit.body = typeof body === 'string' ? body : JSON.stringify(body)
  }

  const response = await fetch(url, requestInit)
  const text = await response.text()

  let data: any = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!response.ok) {
    const message =
      (typeof data === 'object' && data?.error) ||
      (typeof data === 'object' && data?.message) ||
      response.statusText ||
      'Request failed'
    throw new ApiError(message, response.status, data)
  }

  return (data ?? {}) as T
}

export type MagicLinkResult = {
  sent: boolean
  token?: string
  magicLink?: string
  expiresInMinutes?: number
  note?: string
  message?: string
}

export type Session = {
  token: string
  expiresAt: string
  projectId: number
  email: string
}

export type AppUserProfile = {
  id: string
  email: string
  project_id: number
  status: string
  metadata?: Record<string, unknown>
}

export type TodoPayload = {
  title: string
  notes: string
  completed: boolean
}

export type TodoItem = {
  id: string
  data: TodoPayload & Record<string, unknown>
  created_at: string
  updated_at: string
  app_user_id?: string | null
}

export type PaginationMeta = {
  page: number
  limit: number
  total: number
  pages: number
}

export type PaginatedTodos = {
  data: TodoItem[]
  meta: PaginationMeta
}

export async function fetchAppUserTotal(
  config: DemoConfig,
): Promise<number> {
  if (!config.projectId) {
    throw new ApiError('Project identifier is missing. Update configuration.')
  }
  const canUsePublic = Boolean(config.publicProjectKey)
  const canUseManage = Boolean(config.manageProjectKey)
  if (!canUsePublic && !canUseManage) {
    throw new ApiError('Access key is missing. Add a public or management key.')
  }
  // Use a project-level key so totals load before a user session exists.
  const res = await jsonRequest<{ total?: number }>(
    config,
    `/api/projects/${config.projectId}/app-users/total`,
    {
      method: 'GET',
      require: canUsePublic ? 'public' : 'manage',
    },
  )
  return typeof res.total === 'number' ? res.total : Number(res.total) || 0
}

export async function requestMagicLink(
  config: DemoConfig,
  email: string,
): Promise<MagicLinkResult> {
  if (!config.projectId) {
    throw new ApiError('Project identifier is missing. Update configuration.')
  }
  if (!config.publicProjectKey) {
    throw new ApiError('Public access key is missing. Access requests are disabled.')
  }

  const res = await jsonRequest<{ data?: any }>(
    config,
    '/api/app-users/login',
    {
      method: 'POST',
      body: { email, project_id: config.projectId },
      require: 'public',
    },
  )

  const payload = res?.data ?? res
  return {
    sent: Boolean(payload?.sent ?? true),
    token: payload?.token,
    magicLink: payload?.magicLink,
    expiresInMinutes: payload?.expires_in_minutes,
    note: payload?.note,
    message: payload?.message,
  }
}

export async function verifyMagicToken(
  config: DemoConfig,
  token: string,
): Promise<Session> {
  if (!config.projectId) {
    throw new ApiError('Project identifier is missing. Update configuration.')
  }
  const res = await jsonRequest<{ data: any }>(
    config,
    '/api/app-users/verify',
    {
      method: 'POST',
      body: { token, project_id: config.projectId },
      require: 'manage',
    },
  )

  const data = res.data
  return {
    token: data.session_token,
    expiresAt: data.expires_at,
    projectId: data.project_id,
    email: data.email,
  }
}

export async function fetchProfile(
  config: DemoConfig,
  sessionToken: string,
): Promise<AppUserProfile> {
  const res = await jsonRequest<{ data: AppUserProfile }>(
    config,
    '/api/app-users/me',
    {
      method: 'GET',
      token: sessionToken,
      require: 'session',
    },
  )
  return res.data
}

export async function fetchTodos(
  config: DemoConfig,
  sessionToken: string,
  opts: { page?: number; limit?: number; order?: 'asc' | 'desc' } = {},
): Promise<PaginatedTodos> {
  if (!config.collectionSlug) {
    throw new ApiError('Task register is not configured.')
  }

  const page = Math.max(1, Number(opts.page) || 1)
  const rawLimit = Number(opts.limit) || 10
  const limit = Math.min(Math.max(rawLimit, 1), 100)
  const order = opts.order === 'asc' ? 'asc' : 'desc'

  const res = await jsonRequest<{ data: TodoItem[]; meta?: PaginationMeta }>(
    config,
    `/app/collections/${encodeURIComponent(config.collectionSlug)}/records?order=${order}&limit=${limit}&page=${page}`,
    {
      method: 'GET',
      token: sessionToken,
      require: 'session',
    },
  )

  const fallbackMeta: PaginationMeta = {
    page,
    limit,
    total: (res.data || []).length,
    pages: Math.max(1, Math.ceil(((res.data || []).length || 1) / limit)),
  }

  return {
    data: res.data || [],
    meta: res.meta
      ? {
          page: res.meta.page ?? page,
          limit: res.meta.limit ?? limit,
          total: res.meta.total ?? fallbackMeta.total,
          pages: res.meta.pages ?? fallbackMeta.pages,
        }
      : fallbackMeta,
  }
}

export async function createTodo(
  config: DemoConfig,
  sessionToken: string,
  todo: TodoPayload,
): Promise<TodoItem> {
  if (!config.collectionSlug) {
    throw new ApiError('Task register is not configured.')
  }

  const res = await jsonRequest<{ data: TodoItem }>(
    config,
    `/app/collections/${encodeURIComponent(config.collectionSlug)}/records`,
    {
      method: 'POST',
      token: sessionToken,
      require: 'session',
      body: { data: todo },
    },
  )

  return res.data
}

export async function updateTodo(
  config: DemoConfig,
  sessionToken: string,
  todoId: string,
  todo: TodoPayload,
): Promise<TodoItem> {
  if (!config.collectionSlug) {
    throw new ApiError('Task register is not configured.')
  }

  const res = await jsonRequest<{ data: TodoItem }>(
    config,
    `/app/collections/${encodeURIComponent(config.collectionSlug)}/records/${encodeURIComponent(todoId)}`,
    {
      method: 'PUT',
      token: sessionToken,
      require: 'session',
      body: { data: todo },
    },
  )

  return res.data
}

export async function deleteTodo(
  config: DemoConfig,
  sessionToken: string,
  todoId: string,
): Promise<void> {
  if (!config.collectionSlug) {
    throw new ApiError('Task register is not configured.')
  }

  await jsonRequest<void>(
    config,
    `/app/collections/${encodeURIComponent(config.collectionSlug)}/records/${encodeURIComponent(todoId)}`,
    {
      method: 'DELETE',
      token: sessionToken,
      require: 'session',
    },
  )
}
