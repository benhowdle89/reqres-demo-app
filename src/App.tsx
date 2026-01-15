import { useEffect, useMemo, useState } from 'react'
import {
  ApiError,
  AppUserProfile,
  MagicLinkResult,
  PaginationMeta,
  Session,
  TodoItem,
  TodoPayload,
  createTodo,
  deleteTodo,
  fetchProfile,
  fetchTodos,
  requestMagicLink,
  updateTodo,
  verifyMagicToken,
} from './api'
import { DemoConfig, envConfig, loadConfig } from './config'

const SESSION_STORAGE_KEY = 'reqres-todo-session-v1'

const loadStoredSession = (): Session | null => {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

const emptyTodo: TodoPayload = {
  title: '',
  notes: '',
  completed: false,
}

const DEFAULT_PAGE_SIZE = 10

const toDate = (value?: string) => {
  if (!value) return ''
  const date = new Date(value)
  return isNaN(date.getTime()) ? '' : date.toLocaleString()
}

const normalizeTodo = (data?: Record<string, unknown> | null): TodoPayload => {
  const source = data ?? {}
  const completedValue = source.completed
  return {
    title: typeof source.title === 'string' ? source.title : '',
    notes: typeof source.notes === 'string' ? source.notes : '',
    completed:
      typeof completedValue === 'boolean'
        ? completedValue
        : typeof completedValue === 'string'
          ? completedValue.toLowerCase() === 'true'
          : Boolean(completedValue),
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  )
}

export default function App() {
  const [config] = useState<DemoConfig>(() => loadConfig())
  const [email, setEmail] = useState('')
  const [tokenInput, setTokenInput] = useState('')
  const [magicResult, setMagicResult] = useState<MagicLinkResult | null>(null)
  const [session, setSession] = useState<Session | null>(() =>
    loadStoredSession(),
  )
  const [profile, setProfile] = useState<AppUserProfile | null>(null)
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [draftTodo, setDraftTodo] = useState<TodoPayload>(emptyTodo)
  const [todoDrafts, setTodoDrafts] = useState<Record<string, TodoPayload>>({})
  const [activeEditId, setActiveEditId] = useState<string | null>(null)
  const [todoBusyId, setTodoBusyId] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [loadingTodos, setLoadingTodos] = useState(false)
  const [creatingTodo, setCreatingTodo] = useState(false)
  const [todoMeta, setTodoMeta] = useState<PaginationMeta | null>(null)
  const [todoPage, setTodoPage] = useState(1)
  const [todoPageSize, setTodoPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all')

  const configWarnings = useMemo(() => {
    const issues: string[] = []
    if (!config.projectId) issues.push('Add a project ID')
    if (!config.publicProjectKey) issues.push('Add the public project key')
    if (!config.manageProjectKey) issues.push('Add the manage project key')
    if (!config.collectionSlug) issues.push('Set a collection slug')
    return issues
  }, [config])

  const configReady = configWarnings.length === 0

  const visibleTodos = useMemo(() => {
    if (filter === 'all') return todos
    const needsCompleted = filter === 'completed'
    return todos.filter((todo) =>
      normalizeTodo(todo.data).completed === needsCompleted,
    )
  }, [filter, todos])

  const completedCount = useMemo(
    () => todos.filter((todo) => normalizeTodo(todo.data).completed).length,
    [todos],
  )

  const remainingCount = todos.length - completedCount

  useEffect(() => {
    if (!session || !configReady) return
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
  }, [session])

  useEffect(() => {
    if (!session) return
    const load = async () => {
      try {
        const me = await fetchProfile(config, session.token)
        setProfile(me)
      } catch (err) {
        console.error(err)
        setProfile(null)
        setError('Session expired? Re-run verify to refresh your token.')
      }
      setTodoPage(1)
      setTodoMeta(null)
      await refreshTodos({ page: 1, activeSession: session })
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  const handleRequestLink = async () => {
    if (!configReady) {
      setError('Missing project configuration')
      return
    }
    setRequesting(true)
    setStatus(null)
    setError(null)
    try {
      const res = await requestMagicLink(config, email.trim())
      setMagicResult(res)
      if (res.token) setTokenInput(res.token)
      setStatus(res.sent ? 'Magic link issued' : 'Magic link created')
    } catch (err) {
      console.error(err)
      if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError('Failed to request magic link')
      }
    } finally {
      setRequesting(false)
    }
  }

  const handleVerifyToken = async () => {
    if (!configReady) {
      setError('Missing project configuration')
      return
    }
    if (!tokenInput.trim()) {
      setError('Paste the magic link token first')
      return
    }
    setVerifying(true)
    setError(null)
    setStatus(null)
    try {
      const newSession = await verifyMagicToken(config, tokenInput.trim())
      setSession(newSession)
      setMagicResult(null)
      setTokenInput('')
      setStatus('Session created. Pulling profile and todos...')
      const me = await fetchProfile(config, newSession.token)
      setProfile(me)
      setTodoPage(1)
      setTodoMeta(null)
      await refreshTodos({ page: 1, activeSession: newSession })
    } catch (err) {
      console.error(err)
      if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError('Could not verify token')
      }
    } finally {
      setVerifying(false)
    }
  }

  const refreshTodos = async ({
    page = todoPage,
    limit = todoPageSize,
    activeSession = session,
    activeConfig = config,
  }: {
    page?: number
    limit?: number
    activeSession?: Session | null
    activeConfig?: DemoConfig
  } = {}) => {
    if (!activeSession) return
    setLoadingTodos(true)
    setError(null)
    try {
      const { data, meta } = await fetchTodos(
        activeConfig,
        activeSession.token,
        { page, limit, order: 'desc' },
      )
      setTodos(data)
      setTodoMeta(meta)
      setTodoPage(meta.page)
      setTodoPageSize(meta.limit)
    } catch (err) {
      console.error(err)
      if (err instanceof ApiError) setError(err.message)
      else setError('Could not load todos')
    } finally {
      setLoadingTodos(false)
    }
  }

  const handlePageChange = (direction: 'prev' | 'next') => {
    const current = todoMeta?.page || todoPage
    const totalPages = todoMeta?.pages || 1
    const nextPage =
      direction === 'prev'
        ? Math.max(1, current - 1)
        : Math.min(totalPages, current + 1)
    setTodoPage(nextPage)
    refreshTodos({ page: nextPage })
  }

  const handlePageSizeChange = (nextLimit: number) => {
    const clamped = Math.min(Math.max(nextLimit, 1), 100)
    setTodoPage(1)
    setTodoPageSize(clamped)
    refreshTodos({ page: 1, limit: clamped })
  }

  const handleCreateTodo = async () => {
    if (!session) {
      setError('Sign in first')
      return
    }
    if (!draftTodo.title.trim()) {
      setError('Add a title before saving')
      return
    }

    setCreatingTodo(true)
    setError(null)
    try {
      const payload: TodoPayload = {
        ...draftTodo,
        title: draftTodo.title.trim(),
        notes: draftTodo.notes.trim(),
      }
      await createTodo(config, session.token, payload)
      setTodoPage(1)
      await refreshTodos({ page: 1 })
      setDraftTodo(emptyTodo)
      setStatus('Todo added')
    } catch (err) {
      console.error(err)
      if (err instanceof ApiError) setError(err.message)
      else setError('Could not create todo')
    } finally {
      setCreatingTodo(false)
    }
  }

  const beginEditTodo = (todo: TodoItem) => {
    const draft = normalizeTodo(todo.data)
    setActiveEditId(todo.id)
    setTodoDrafts((prev) => ({ ...prev, [todo.id]: draft }))
    setStatus(null)
    setError(null)
  }

  const cancelEditTodo = () => {
    setActiveEditId(null)
    setTodoBusyId(null)
  }

  const handleUpdateTodo = async (todoId: string) => {
    if (!session) {
      setError('Sign in first')
      return
    }
    const draft = todoDrafts[todoId]
    if (!draft || !draft.title.trim()) {
      setError('Add a title before saving')
      return
    }

    setTodoBusyId(todoId)
    setError(null)
    setStatus(null)
    try {
      const payload: TodoPayload = {
        ...draft,
        title: draft.title.trim(),
        notes: draft.notes.trim(),
      }
      const updated = await updateTodo(config, session.token, todoId, payload)
      setTodos((prev) =>
        prev.map((todo) => (todo.id === todoId ? updated : todo)),
      )
      setStatus('Todo updated')
      setActiveEditId(null)
    } catch (err) {
      console.error(err)
      if (err instanceof ApiError) setError(err.message)
      else setError('Could not update todo')
    } finally {
      setTodoBusyId(null)
    }
  }

  const handleToggleTodo = async (todo: TodoItem) => {
    if (!session) {
      setError('Sign in first')
      return
    }

    setTodoBusyId(todo.id)
    setError(null)
    setStatus(null)
    const current = normalizeTodo(todo.data)
    try {
      const payload: TodoPayload = {
        ...current,
        completed: !current.completed,
      }
      const updated = await updateTodo(
        config,
        session.token,
        todo.id,
        payload,
      )
      setTodos((prev) =>
        prev.map((item) => (item.id === todo.id ? updated : item)),
      )
      setStatus(payload.completed ? 'Todo completed' : 'Todo reopened')
    } catch (err) {
      console.error(err)
      if (err instanceof ApiError) setError(err.message)
      else setError('Could not update todo')
    } finally {
      setTodoBusyId(null)
    }
  }

  const handleDeleteTodo = async (todoId: string) => {
    if (!session) {
      setError('Sign in first')
      return
    }
    const confirmDelete = window.confirm(
      'Delete this todo? This is a soft delete.',
    )
    if (!confirmDelete) return

    setTodoBusyId(todoId)
    setError(null)
    setStatus(null)
    try {
      await deleteTodo(config, session.token, todoId)
      const nextPage =
        todoMeta && todos.length <= 1 && todoMeta.page > 1
          ? todoMeta.page - 1
          : todoMeta?.page || 1
      if (activeEditId === todoId) setActiveEditId(null)
      await refreshTodos({ page: nextPage })
      setStatus('Todo deleted')
    } catch (err) {
      console.error(err)
      if (err instanceof ApiError) setError(err.message)
      else setError('Could not delete todo')
    } finally {
      setTodoBusyId(null)
    }
  }

  const clearSession = () => {
    setSession(null)
    setProfile(null)
    setTodos([])
    setActiveEditId(null)
    setTodoDrafts({})
    setTodoMeta(null)
    setTodoPage(1)
    setTodoPageSize(DEFAULT_PAGE_SIZE)
    setTokenInput('')
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(SESSION_STORAGE_KEY)
    }
    setStatus('Session cleared')
  }

  const currentPage = todoMeta?.page || todoPage
  const totalPages = todoMeta?.pages || 1
  const totalTodos = todoMeta?.total ?? todos.length

  return (
    <div className="app-shell">
      <div className="hero">
        <div className="pill">Magic-link auth | Per-user todos</div>
        <h1>ReqRes Todo App</h1>
        <p className="lede">
          A full CRUD todo app on top of ReqRes app users. Send a magic link,
          verify the token, and manage your own tasks from the browser.
        </p>
        <div className="hero-grid">
          <Stat label="API base" value={config.baseUrl || envConfig.baseUrl} />
          <Stat
            label="Project"
            value={config.projectId ? `#${config.projectId}` : 'Missing'}
          />
          <Stat
            label="Collection"
            value={config.collectionSlug || 'Missing'}
          />
          <Stat label="Session" value={session ? 'Active' : 'Signed out'} />
          <Stat
            label="Todos"
            value={
              session
                ? loadingTodos
                  ? 'Loading...'
                  : `${totalTodos} total`
                : 'Sign in'
            }
          />
        </div>
        {configWarnings.length > 0 && (
          <div className="warning">{configWarnings.join(' | ')}</div>
        )}
      </div>

      <main className="content-grid">
        <section className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Step 1</p>
              <h2>Send a magic link</h2>
              <p className="muted">
                Uses your public project key to create or look up an app user.
              </p>
            </div>
          </div>

          <div className="field">
            <span>User email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="taylor@example.com"
            />
          </div>
          <button
            className="btn primary"
            type="button"
            onClick={handleRequestLink}
            disabled={requesting || !configReady}
          >
            {requesting ? 'Sending...' : 'Send magic link'}
          </button>
          {magicResult && (
            <div className="callout">
              <div className="callout-title">Link ready</div>
              {magicResult.token ? (
                <p className="muted">
                  Email delivery is not configured locally, so we return the
                  token for testing. Paste it below or use the magic link.
                </p>
              ) : (
                <p className="muted">Check your inbox for the link.</p>
              )}
              <div className="token-box">
                <code>
                  {magicResult.token ||
                    magicResult.magicLink ||
                    'token pending...'}
                </code>
              </div>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Step 2</p>
              <h2>Verify token -> session</h2>
              <p className="muted">
                Exchange the token for an app-session Bearer token.
              </p>
            </div>
          </div>

          <div className="field">
            <span>Magic link token</span>
            <input
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="paste token from email"
            />
          </div>

          <div className="actions">
            <button
              className="btn primary"
              type="button"
              onClick={handleVerifyToken}
              disabled={verifying || !configReady}
            >
              {verifying ? 'Verifying...' : 'Create session'}
            </button>
            {session && (
              <button
                className="btn ghost"
                type="button"
                onClick={clearSession}
              >
                Clear session
              </button>
            )}
          </div>

          {session && (
            <div className="session">
              <div>
                <p className="muted">Session token</p>
                <code className="session-token">{session.token}</code>
              </div>
              <div className="session-meta">
                <span>Project #{session.projectId}</span>
                <span>Expires {toDate(session.expiresAt)}</span>
              </div>
              {profile && (
                <div className="session-meta profile-row">
                  <span>{profile.email}</span>
                  <span>Status: {profile.status}</span>
                  <span>App user: {profile.id.slice(0, 8)}...</span>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="card span-2">
          <div className="card-header">
            <div>
              <p className="eyebrow">Step 3</p>
              <h2>Your todos</h2>
              <p className="muted">
                CRUD on{' '}
                <code>/app/collections/{config.collectionSlug}/records</code>{' '}
                scoped to the signed-in app user.
              </p>
            </div>
            <div className="actions-inline">
              <button
                className="btn ghost"
                type="button"
                onClick={() => refreshTodos()}
                disabled={!session || loadingTodos}
              >
                {loadingTodos ? 'Refreshing...' : 'Refresh todos'}
              </button>
            </div>
          </div>

          {!session && (
            <p className="muted">Sign in to create and manage your todos.</p>
          )}

          {session && (
            <>
              <div className="todo-toolbar">
                <div className="filter-group">
                  {(['all', 'active', 'completed'] as const).map((mode) => (
                    <button
                      key={mode}
                      className={`filter-button ${
                        filter === mode ? 'active' : ''
                      }`}
                      type="button"
                      onClick={() => setFilter(mode)}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
                <div className="todo-stats">
                  <span>{remainingCount} open</span>
                  <span>{completedCount} completed</span>
                </div>
              </div>

              <div className="todo-grid">
                <div className="composer">
                  <div className="field">
                    <span>Title</span>
                    <input
                      value={draftTodo.title}
                      onChange={(e) =>
                        setDraftTodo({ ...draftTodo, title: e.target.value })
                      }
                      placeholder="Pick up groceries"
                    />
                  </div>
                  <div className="field">
                    <span>Notes</span>
                    <textarea
                      value={draftTodo.notes}
                      onChange={(e) =>
                        setDraftTodo({ ...draftTodo, notes: e.target.value })
                      }
                      placeholder="Optional details for this todo"
                    />
                  </div>
                  <label className="field">
                    <span>Status</span>
                    <select
                      value={draftTodo.completed ? 'done' : 'open'}
                      onChange={(e) =>
                        setDraftTodo({
                          ...draftTodo,
                          completed: e.target.value === 'done',
                        })
                      }
                    >
                      <option value="open">Open</option>
                      <option value="done">Completed</option>
                    </select>
                  </label>
                  <button
                    className="btn primary"
                    type="button"
                    disabled={creatingTodo || !session}
                    onClick={handleCreateTodo}
                  >
                    {creatingTodo ? 'Saving...' : 'Add todo'}
                  </button>
                </div>

                <div className="todo-list">
                  <div className="pagination-bar">
                    <div>
                      <p className="muted tiny">
                        Page {currentPage} of {totalPages}
                      </p>
                      <p className="muted tiny">
                        Showing {visibleTodos.length} of {totalTodos} todos |{' '}
                        {todoPageSize} per page
                      </p>
                    </div>
                    <div className="pagination-actions">
                      <label className="field inline">
                        <span>Page size</span>
                        <select
                          value={todoPageSize}
                          onChange={(e) =>
                            handlePageSizeChange(Number(e.target.value))
                          }
                        >
                          {[10, 20, 50].map((size) => (
                            <option key={size} value={size}>
                              {size} / page
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="page-buttons">
                        <button
                          className="btn ghost"
                          type="button"
                          onClick={() => handlePageChange('prev')}
                          disabled={loadingTodos || currentPage <= 1}
                        >
                          Prev
                        </button>
                        <button
                          className="btn secondary"
                          type="button"
                          onClick={() => handlePageChange('next')}
                          disabled={loadingTodos || currentPage >= totalPages}
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  </div>
                  {loadingTodos && <p className="muted">Loading todos...</p>}
                  {!loadingTodos && visibleTodos.length === 0 && (
                    <p className="muted">
                      No todos yet. Add one to see the round-trip.
                    </p>
                  )}
                  {!loadingTodos &&
                    visibleTodos.map((todo) => {
                      const data = normalizeTodo(todo.data)
                      const editing = activeEditId === todo.id
                      const draft = todoDrafts[todo.id] || data
                      return (
                        <article
                          key={todo.id}
                          className="todo-card"
                          data-completed={data.completed}
                        >
                          <div className="todo-meta">
                            <label className="todo-check">
                              <input
                                type="checkbox"
                                checked={data.completed}
                                onChange={() => handleToggleTodo(todo)}
                                disabled={todoBusyId === todo.id}
                              />
                              <span>
                                {data.completed ? 'Completed' : 'Open'}
                              </span>
                            </label>
                            <span className="tiny">
                              Updated {toDate(todo.updated_at)}
                            </span>
                          </div>
                          {editing ? (
                            <>
                              <div className="field">
                                <span>Title</span>
                                <input
                                  value={draft.title}
                                  onChange={(e) =>
                                    setTodoDrafts((prev) => ({
                                      ...prev,
                                      [todo.id]: {
                                        ...(prev[todo.id] || draft),
                                        title: e.target.value,
                                      },
                                    }))
                                  }
                                />
                              </div>
                              <div className="field">
                                <span>Notes</span>
                                <textarea
                                  value={draft.notes}
                                  onChange={(e) =>
                                    setTodoDrafts((prev) => ({
                                      ...prev,
                                      [todo.id]: {
                                        ...(prev[todo.id] || draft),
                                        notes: e.target.value,
                                      },
                                    }))
                                  }
                                />
                              </div>
                              <label className="field">
                                <span>Status</span>
                                <select
                                  value={draft.completed ? 'done' : 'open'}
                                  onChange={(e) =>
                                    setTodoDrafts((prev) => ({
                                      ...prev,
                                      [todo.id]: {
                                        ...(prev[todo.id] || draft),
                                        completed: e.target.value === 'done',
                                      },
                                    }))
                                  }
                                >
                                  <option value="open">Open</option>
                                  <option value="done">Completed</option>
                                </select>
                              </label>
                              <div className="todo-actions">
                                <button
                                  className="btn primary"
                                  type="button"
                                  disabled={todoBusyId === todo.id}
                                  onClick={() => handleUpdateTodo(todo.id)}
                                >
                                  {todoBusyId === todo.id
                                    ? 'Saving...'
                                    : 'Save changes'}
                                </button>
                                <button
                                  className="btn ghost"
                                  type="button"
                                  onClick={cancelEditTodo}
                                  disabled={todoBusyId === todo.id}
                                >
                                  Cancel
                                </button>
                                <button
                                  className="btn danger"
                                  type="button"
                                  onClick={() => handleDeleteTodo(todo.id)}
                                  disabled={todoBusyId === todo.id}
                                >
                                  {todoBusyId === todo.id
                                    ? 'Deleting...'
                                    : 'Delete'}
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <h3 className="todo-title">
                                {data.title || 'Untitled todo'}
                              </h3>
                              <p className="muted">
                                {data.notes || 'No notes yet.'}
                              </p>
                              <div className="todo-footer">
                                <span>Created {toDate(todo.created_at)}</span>
                                <span className="tiny">
                                  Updated {toDate(todo.updated_at)}
                                </span>
                              </div>
                              <div className="todo-footer">
                                <span className="tiny">
                                  app_user_id:{' '}
                                  {todo.app_user_id || 'scoped to you'}
                                </span>
                                <span className="tiny">
                                  todo_id: {todo.id.slice(0, 8)}...
                                </span>
                              </div>
                              <div className="todo-actions">
                                <button
                                  className="btn secondary"
                                  type="button"
                                  onClick={() => beginEditTodo(todo)}
                                  disabled={todoBusyId === todo.id}
                                >
                                  Edit
                                </button>
                                <button
                                  className="btn ghost"
                                  type="button"
                                  onClick={() => handleDeleteTodo(todo.id)}
                                  disabled={todoBusyId === todo.id}
                                >
                                  {todoBusyId === todo.id
                                    ? 'Deleting...'
                                    : 'Delete'}
                                </button>
                              </div>
                            </>
                          )}
                        </article>
                      )
                    })}
                </div>
              </div>
            </>
          )}
        </section>
      </main>

      {(status || error) && (
        <div className="toast" data-tone={error ? 'error' : 'info'}>
          {error || status}
        </div>
      )}

      <footer className="footer">
        <div>
          <p className="muted">Endpoints in play</p>
          <code>
            POST /api/app-users/login -> POST /api/app-users/verify -> GET
            /api/app-users/me -> CRUD /app/collections/
            {config.collectionSlug}/records
          </code>
        </div>
        <div className="muted">
          Each app user only sees their own todos (scoped by session token).
        </div>
      </footer>
    </div>
  )
}
