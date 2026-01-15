import { useEffect, useMemo, useState } from "react";
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
  fetchAppUserTotal,
  fetchProfile,
  fetchTodos,
  requestMagicLink,
  updateTodo,
  verifyMagicToken,
} from "./api";
import { DemoConfig, envConfig, loadConfig } from "./config";

const SESSION_STORAGE_KEY = "reqres-todo-session-v1";

type StoredSession = {
  session: Session;
  baseUrl: string;
  projectId: number | null;
};

const normalizeBaseUrl = (value?: string) => {
  const base = value || envConfig.baseUrl || "";
  return base.replace(/\/$/, "");
};

const loadStoredSession = (config: DemoConfig): Session | null => {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Accept legacy token-only storage and clean up mismatched config.
    const stored: StoredSession | null = parsed?.session
      ? parsed
      : parsed?.token
      ? {
          session: parsed as Session,
          baseUrl: "",
          projectId: parsed?.projectId ?? null,
        }
      : null;
    if (!stored?.session?.token) return null;
    const expectedBaseUrl = normalizeBaseUrl(config.baseUrl);
    if (!stored.baseUrl || stored.baseUrl !== expectedBaseUrl) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    if (
      config.projectId &&
      stored.projectId &&
      config.projectId !== stored.projectId
    ) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return stored.session;
  } catch {
    return null;
  }
};

const emptyTodo: TodoPayload = {
  title: "",
  notes: "",
  completed: false,
};

const DEFAULT_PAGE_SIZE = 10;

const toDate = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  return isNaN(date.getTime()) ? "" : date.toLocaleString();
};

const shortId = (value?: string | null) => {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.length <= 8 ? trimmed : `${trimmed.slice(0, 8)}…`;
};

const normalizeTodo = (data?: Record<string, unknown> | null): TodoPayload => {
  const source = data ?? {};
  const completedValue = source.completed;
  return {
    title: typeof source.title === "string" ? source.title : "",
    notes: typeof source.notes === "string" ? source.notes : "",
    completed:
      typeof completedValue === "boolean"
        ? completedValue
        : typeof completedValue === "string"
        ? completedValue.toLowerCase() === "true"
        : Boolean(completedValue),
  };
};

const isSessionExpired = (session: Session | null) => {
  if (!session?.expiresAt) return true;
  const expiresAt = new Date(session.expiresAt).getTime();
  if (Number.isNaN(expiresAt)) return true;
  return expiresAt <= Date.now();
};

const hasStoredSessionToken = (config: DemoConfig) =>
  Boolean(loadStoredSession(config)?.token);

const persistSession = (session: Session, config: DemoConfig) => {
  if (typeof localStorage === "undefined") return;
  const stored: StoredSession = {
    session,
    baseUrl: normalizeBaseUrl(config.baseUrl),
    projectId: session.projectId ?? null,
  };
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(stored));
};

type RequestLogStatus = "pending" | "success" | "error";

type ApiRequestLog = {
  id: string;
  time: string;
  method: string;
  path: string;
  description: string;
  status: RequestLogStatus;
  errorMessage?: string;
};

const MAX_LOGS = 50;

const createLogId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

export default function App() {
  const [config] = useState<DemoConfig>(() => loadConfig());
  const [email, setEmail] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [magicResult, setMagicResult] = useState<MagicLinkResult | null>(null);
  const [session, setSession] = useState<Session | null>(() =>
    loadStoredSession(loadConfig())
  );
  const [profile, setProfile] = useState<AppUserProfile | null>(null);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [draftTodo, setDraftTodo] = useState<TodoPayload>(emptyTodo);
  const [todoDrafts, setTodoDrafts] = useState<Record<string, TodoPayload>>({});
  const [activeEditId, setActiveEditId] = useState<string | null>(null);
  const [todoBusyId, setTodoBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [loadingTodos, setLoadingTodos] = useState(false);
  const [loadingEmployeeTotal, setLoadingEmployeeTotal] = useState(false);
  const [employeeTotalError, setEmployeeTotalError] = useState(false);
  const [creatingTodo, setCreatingTodo] = useState(false);
  const [employeeTotal, setEmployeeTotal] = useState<number | null>(null);
  const [todoMeta, setTodoMeta] = useState<PaginationMeta | null>(null);
  const [todoPage, setTodoPage] = useState(1);
  const [todoPageSize, setTodoPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");
  const [requestLogs, setRequestLogs] = useState<ApiRequestLog[]>([]);
  const [requestToast, setRequestToast] = useState<ApiRequestLog | null>(null);
  const [toolbarOpen, setToolbarOpen] = useState(false);

  const configWarnings = useMemo(() => {
    const issues: string[] = [];
    if (!config.projectId) issues.push("Add a project ID");
    if (!config.publicProjectKey) issues.push("Add the public project key");
    if (!config.manageProjectKey) issues.push("Add the manage project key");
    if (!config.collectionSlug) issues.push("Set a collection slug");
    return issues;
  }, [config]);

  const configReady = configWarnings.length === 0;

  const visibleTodos = useMemo(() => {
    if (filter === "all") return todos;
    const needsCompleted = filter === "completed";
    return todos.filter(
      (todo) => normalizeTodo(todo.data).completed === needsCompleted
    );
  }, [filter, todos]);

  const completedCount = useMemo(
    () => todos.filter((todo) => normalizeTodo(todo.data).completed).length,
    [todos]
  );

  const remainingCount = todos.length - completedCount;
  const filterLabels: Record<typeof filter, string> = {
    all: "All",
    active: "In progress",
    completed: "Completed",
  };
  const toolbarOffset = toolbarOpen ? "50vh" : "56px";
  const shellStyle = {
    "--toolbar-offset": toolbarOffset,
  } as React.CSSProperties;

  const pushRequestLog = (entry: ApiRequestLog) => {
    setRequestLogs((prev) => [entry, ...prev].slice(0, MAX_LOGS));
    setRequestToast(entry);
  };

  const updateRequestLog = (id: string, patch: Partial<ApiRequestLog>) => {
    setRequestLogs((prev) =>
      prev.map((log) => (log.id === id ? { ...log, ...patch } : log))
    );
  };

  // Clear all session-scoped UI and storage in one place.
  const clearSession = () => {
    setSession(null);
    setProfile(null);
    setTodos([]);
    setActiveEditId(null);
    setTodoDrafts({});
    setTodoMeta(null);
    setTodoPage(1);
    setTodoPageSize(DEFAULT_PAGE_SIZE);
    setTokenInput("");
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
    setStatus("Signed out.");
  };

  // Fail fast on missing env config, before making any network calls.
  const ensureConfigReady = () => {
    if (!configReady) {
      setError("System configuration is incomplete.");
      return false;
    }
    return true;
  };

  // Validate the session once per action and keep the UI in sync.
  const ensureActiveSession = (
    activeSession: Session | null,
    missingMessage: string
  ) => {
    if (!activeSession) {
      setError(missingMessage);
      return null;
    }
    if (!hasStoredSessionToken(config)) {
      setError("Access not active. Request access.");
      clearSession();
      return null;
    }
    if (isSessionExpired(activeSession)) {
      setError("Access expired. Request access again.");
      clearSession();
      return null;
    }
    return activeSession;
  };

  const trackRequest = async <T,>(
    entry: Omit<ApiRequestLog, "id" | "time" | "status" | "errorMessage">,
    action: () => Promise<T>
  ): Promise<T> => {
    // Centralized request logging for the developer console.
    const id = createLogId();
    const logEntry: ApiRequestLog = {
      ...entry,
      id,
      time: new Date().toLocaleTimeString(),
      status: "pending",
    };
    pushRequestLog(logEntry);
    try {
      const result = await action();
      updateRequestLog(id, { status: "success" });
      return result;
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
          ? err.message
          : "Request failed";
      updateRequestLog(id, { status: "error", errorMessage: message });
      throw err;
    }
  };

  useEffect(() => {
    if (!session || !configReady) return;
    persistSession(session, config);
  }, [session, configReady, config]);

  useEffect(() => {
    if (!config.projectId) {
      setEmployeeTotal(null);
      setEmployeeTotalError(false);
      setLoadingEmployeeTotal(false);
      return;
    }
    if (!config.publicProjectKey && !config.manageProjectKey) {
      setEmployeeTotal(null);
      setEmployeeTotalError(false);
      setLoadingEmployeeTotal(false);
      return;
    }
    let active = true;
    const loadTotal = async () => {
      setLoadingEmployeeTotal(true);
      setEmployeeTotalError(false);
      try {
        const total = await trackRequest(
          {
            method: "GET",
            path: `/api/projects/${config.projectId}/app-users/total`,
            description: "Count employees with access to this register.",
          },
          () => fetchAppUserTotal(config)
        );
        if (!active) return;
        setEmployeeTotal(total);
      } catch (err) {
        console.error(err);
        if (!active) return;
        setEmployeeTotal(null);
        setEmployeeTotalError(true);
      } finally {
        if (active) setLoadingEmployeeTotal(false);
      }
    };
    loadTotal();
    return () => {
      active = false;
    };
  }, [config.projectId, config.publicProjectKey, config.manageProjectKey]);

  useEffect(() => {
    if (!requestToast) return;
    const timer = window.setTimeout(() => {
      setRequestToast(null);
    }, 2400);
    return () => window.clearTimeout(timer);
  }, [requestToast]);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => {
      setStatus(null);
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    if (!session || !configReady) return;
    const activeSession = ensureActiveSession(
      session,
      "Access required. Request access."
    );
    if (!activeSession) return;
    const load = async () => {
      try {
        const me = await trackRequest(
          {
            method: "GET",
            path: "/api/app-users/me",
            description: "Retrieve the active operator profile.",
          },
          () => fetchProfile(config, activeSession.token)
        );
        setProfile(me);
      } catch (err) {
        console.error(err);
        setProfile(null);
        setError("Access expired. Request access again.");
        clearSession();
        return;
      }
      setTodoPage(1);
      setTodoMeta(null);
      await refreshTodos({ page: 1, activeSession: activeSession });
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, configReady]);

  const handleRequestLink = async () => {
    if (!ensureConfigReady()) return;
    setRequesting(true);
    setStatus(null);
    setError(null);
    try {
      const res = await trackRequest(
        {
          method: "POST",
          path: "/api/app-users/login",
          description: "Request access for the current operator.",
        },
        () => requestMagicLink(config, email.trim())
      );
      setMagicResult(res);
      if (res.token) setTokenInput(res.token);
      setStatus("Access request submitted.");
    } catch (err) {
      console.error(err);
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Access request could not be submitted.");
      }
    } finally {
      setRequesting(false);
    }
  };

  const handleVerifyToken = async () => {
    if (!ensureConfigReady()) return;
    if (!tokenInput.trim()) {
      setError("Enter the access code to continue.");
      return;
    }
    setVerifying(true);
    setError(null);
    setStatus(null);
    try {
      const newSession = await trackRequest(
        {
          method: "POST",
          path: "/api/app-users/verify",
          description: "Confirm access and establish operator context.",
        },
        () => verifyMagicToken(config, tokenInput.trim())
      );
      persistSession(newSession, config);
      setSession(newSession);
      setMagicResult(null);
      setTokenInput("");
      setStatus("Access confirmed. Loading records...");
      const me = await trackRequest(
        {
          method: "GET",
          path: "/api/app-users/me",
          description: "Retrieve the active operator profile.",
        },
        () => fetchProfile(config, newSession.token)
      );
      setProfile(me);
      setTodoPage(1);
      setTodoMeta(null);
      await refreshTodos({ page: 1, activeSession: newSession });
    } catch (err) {
      console.error(err);
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Access code could not be confirmed.");
      }
    } finally {
      setVerifying(false);
    }
  };

  const refreshTodos = async ({
    page = todoPage,
    limit = todoPageSize,
    activeSession = session,
    activeConfig = config,
  }: {
    page?: number;
    limit?: number;
    activeSession?: Session | null;
    activeConfig?: DemoConfig;
  } = {}) => {
    if (!activeSession) return;
    const readySession = ensureActiveSession(
      activeSession,
      "Access required. Request access."
    );
    if (!readySession) return;
    setLoadingTodos(true);
    setError(null);
    try {
      const slug = encodeURIComponent(activeConfig.collectionSlug || "");
      const path = `/app/collections/${slug}/records?order=desc&limit=${limit}&page=${page}`;
      const { data, meta } = await trackRequest(
        {
          method: "GET",
          path,
          description: "List records for the current operator with pagination.",
        },
        // Session token scopes records to the signed-in operator automatically.
        () =>
          fetchTodos(activeConfig, readySession.token, {
            page,
            limit,
            order: "desc",
          })
      );
      setTodos(data);
      setTodoMeta(meta);
      setTodoPage(meta.page);
      setTodoPageSize(meta.limit);
    } catch (err) {
      console.error(err);
      if (err instanceof ApiError) setError(err.message);
      else setError("Could not load records.");
    } finally {
      setLoadingTodos(false);
    }
  };

  const handlePageChange = (direction: "prev" | "next") => {
    const current = todoMeta?.page || todoPage;
    const totalPages = todoMeta?.pages || 1;
    const nextPage =
      direction === "prev"
        ? Math.max(1, current - 1)
        : Math.min(totalPages, current + 1);
    setTodoPage(nextPage);
    refreshTodos({ page: nextPage });
  };

  const handlePageSizeChange = (nextLimit: number) => {
    const clamped = Math.min(Math.max(nextLimit, 1), 100);
    setTodoPage(1);
    setTodoPageSize(clamped);
    refreshTodos({ page: 1, limit: clamped });
  };

  const handleCreateTodo = async () => {
    const activeSession = ensureActiveSession(
      session,
      "Access required. Request access."
    );
    if (!activeSession) return;
    if (!draftTodo.title.trim()) {
      setError("Enter a record title before saving.");
      return;
    }

    setCreatingTodo(true);
    setError(null);
    try {
      const payload: TodoPayload = {
        ...draftTodo,
        title: draftTodo.title.trim(),
        notes: draftTodo.notes.trim(),
      };
      const slug = encodeURIComponent(config.collectionSlug || "");
      await trackRequest(
        {
          method: "POST",
          path: `/app/collections/${slug}/records`,
          description: "Create a record for the current operator.",
        },
        () => createTodo(config, activeSession.token, payload)
      );
      setTodoPage(1);
      await refreshTodos({ page: 1 });
      setDraftTodo(emptyTodo);
      setStatus("Record created.");
    } catch (err) {
      console.error(err);
      if (err instanceof ApiError) setError(err.message);
      else setError("Could not add record.");
    } finally {
      setCreatingTodo(false);
    }
  };

  const beginEditTodo = (todo: TodoItem) => {
    const draft = normalizeTodo(todo.data);
    setActiveEditId(todo.id);
    setTodoDrafts((prev) => ({ ...prev, [todo.id]: draft }));
    setStatus(null);
    setError(null);
  };

  const cancelEditTodo = () => {
    setActiveEditId(null);
    setTodoBusyId(null);
  };

  const handleUpdateTodo = async (todoId: string) => {
    const activeSession = ensureActiveSession(
      session,
      "Access required. Request access."
    );
    if (!activeSession) return;
    const draft = todoDrafts[todoId];
    if (!draft || !draft.title.trim()) {
      setError("Enter a record title before saving.");
      return;
    }

    setTodoBusyId(todoId);
    setError(null);
    setStatus(null);
    try {
      const payload: TodoPayload = {
        ...draft,
        title: draft.title.trim(),
        notes: draft.notes.trim(),
      };
      const slug = encodeURIComponent(config.collectionSlug || "");
      const updated = await trackRequest(
        {
          method: "PUT",
          path: `/app/collections/${slug}/records/${encodeURIComponent(
            todoId
          )}`,
          description: "Update record details or status.",
        },
        () => updateTodo(config, activeSession.token, todoId, payload)
      );
      setTodos((prev) =>
        prev.map((todo) => (todo.id === todoId ? updated : todo))
      );
      setStatus("Record updated.");
      setActiveEditId(null);
    } catch (err) {
      console.error(err);
      if (err instanceof ApiError) setError(err.message);
      else setError("Could not update record.");
    } finally {
      setTodoBusyId(null);
    }
  };

  const handleToggleTodo = async (todo: TodoItem) => {
    const activeSession = ensureActiveSession(
      session,
      "Access required. Request access."
    );
    if (!activeSession) return;

    setTodoBusyId(todo.id);
    setError(null);
    setStatus(null);
    const current = normalizeTodo(todo.data);
    try {
      const payload: TodoPayload = {
        ...current,
        completed: !current.completed,
      };
      const slug = encodeURIComponent(config.collectionSlug || "");
      const updated = await trackRequest(
        {
          method: "PUT",
          path: `/app/collections/${slug}/records/${encodeURIComponent(
            todo.id
          )}`,
          description: payload.completed
            ? "Mark a record as completed."
            : "Return a record to in progress.",
        },
        () => updateTodo(config, activeSession.token, todo.id, payload)
      );
      setTodos((prev) =>
        prev.map((item) => (item.id === todo.id ? updated : item))
      );
      setStatus(
        payload.completed ? "Record marked complete." : "Record in progress."
      );
    } catch (err) {
      console.error(err);
      if (err instanceof ApiError) setError(err.message);
      else setError("Could not update record.");
    } finally {
      setTodoBusyId(null);
    }
  };

  const handleDeleteTodo = async (todoId: string) => {
    const activeSession = ensureActiveSession(
      session,
      "Access required. Request access."
    );
    if (!activeSession) return;
    const confirmDelete = window.confirm(
      "Remove this record? It will be archived."
    );
    if (!confirmDelete) return;

    setTodoBusyId(todoId);
    setError(null);
    setStatus(null);
    try {
      const slug = encodeURIComponent(config.collectionSlug || "");
      await trackRequest(
        {
          method: "DELETE",
          path: `/app/collections/${slug}/records/${encodeURIComponent(
            todoId
          )}`,
          description: "Archive a record.",
        },
        () => deleteTodo(config, activeSession.token, todoId)
      );
      const nextPage =
        todoMeta && todos.length <= 1 && todoMeta.page > 1
          ? todoMeta.page - 1
          : todoMeta?.page || 1;
      if (activeEditId === todoId) setActiveEditId(null);
      await refreshTodos({ page: nextPage });
      setStatus("Record archived.");
    } catch (err) {
      console.error(err);
      if (err instanceof ApiError) setError(err.message);
      else setError("Could not archive record.");
    } finally {
      setTodoBusyId(null);
    }
  };

  const currentPage = todoMeta?.page || todoPage;
  const totalPages = todoMeta?.pages || 1;
  const totalTodos = todoMeta?.total ?? todos.length;

  return (
    <div className="app-shell" style={shellStyle}>
      <div className="banner">
        <div className="banner-text">
          This application is powered by ReqRes.
        </div>
        <div className="banner-links">
          <a
            className="banner-cta"
            href="https://app.reqres.in"
            target="_blank"
            rel="noreferrer"
          >
            Create ReqRes account
          </a>
          <a
            className="banner-cta"
            href="https://github.com/benhowdle89/reqres-demo-app"
            target="_blank"
            rel="noreferrer"
          >
            View source
          </a>
        </div>
      </div>
      <div className="hero">
        <div className="hero-top">
          <div className="hero-copy">
            <div className="pill">Internal task register</div>
            <h1>Operations Task Register</h1>
            <p className="lede">
              Operational task tracking for internal teams. Current work, status
              changes, and completion history are recorded here.
            </p>
          </div>
          <figure className="boss-card">
            <div className="boss-frame">
              <img
                src="/images/Gordon_Gekko.webp"
                alt="Portrait of Gordon Gekko"
              />
            </div>
            <figcaption>
              <span className="boss-title">Managing Director</span>
              <span className="boss-name">Gordon Gekko</span>
            </figcaption>
          </figure>
        </div>
        <div className="hero-grid">
          <Stat
            label="Division"
            value={config.projectId ? `#${config.projectId}` : "Missing"}
          />
          <Stat label="Access status" value={session ? "Active" : "Inactive"} />
          <Stat
            label="Tasks"
            value={
              session
                ? loadingTodos
                  ? "Loading..."
                  : `${totalTodos} total`
                : "Pending"
            }
          />
        </div>
        <div className="hero-meta">
          <span className="hero-meta-label">Employees using register</span>
          <span className="hero-meta-value">
            {loadingEmployeeTotal
              ? "Loading..."
              : employeeTotalError
              ? "Unavailable"
              : employeeTotal !== null
              ? `${employeeTotal} total`
              : "Pending"}
          </span>
        </div>
        {configWarnings.length > 0 && (
          <div className="warning">
            System configuration is incomplete. Contact an administrator.
          </div>
        )}
      </div>

      <main className="content-grid">
        <section className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Access</p>
              <h2>Request access</h2>
              <p className="muted">
                Enter your corporate email to request access to the register.
              </p>
            </div>
          </div>

          <div className="field">
            <span>Corporate email</span>
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
            disabled={requesting || !configReady || Boolean(session)}
          >
            {requesting ? "Submitting..." : "Request access"}
          </button>
          {session && (
            <div className="callout">
              <div className="callout-title">Access already active</div>
              <p className="muted">
                This operator session can create and manage records. Sign out to
                request a new access code.
              </p>
            </div>
          )}
          {magicResult && (
            <div className="callout">
              <div className="callout-title">Access request issued</div>
              {magicResult.token ? (
                <p className="muted">
                  An access code was generated for this environment. Enter it
                  below to continue.
                </p>
              ) : (
                <p className="muted">Access request sent. Check your email.</p>
              )}
              <div className="token-box">
                <code>
                  {magicResult.token ||
                    magicResult.magicLink ||
                    "access code pending..."}
                </code>
              </div>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Identity</p>
              <h2>Confirm identity</h2>
              <p className="muted">Enter the access code to begin work.</p>
            </div>
          </div>

          <div className="field">
            <span>Access code</span>
            <input
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="enter access code"
            />
          </div>

          <div className="actions">
            <button
              className="btn primary"
              type="button"
              onClick={handleVerifyToken}
              disabled={verifying || !configReady}
            >
              {verifying ? "Confirming..." : "Confirm access"}
            </button>
            {session && (
              <button
                className="btn ghost"
                type="button"
                onClick={clearSession}
              >
                Sign out
              </button>
            )}
          </div>

          {session && (
            <div className="session">
              <div>
                <p className="muted">Access ID</p>
                <code className="session-token">{session.token}</code>
              </div>
              <div className="session-meta">
                <span>Division #{session.projectId}</span>
                <span>Valid until {toDate(session.expiresAt)}</span>
              </div>
              {profile && (
                <div className="session-meta profile-row">
                  <span>{profile.email}</span>
                  <span>Status: {profile.status}</span>
                  <span>Operator ID: {profile.id.slice(0, 8)}...</span>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="card span-2">
          <div className="card-header">
            <div>
              <p className="eyebrow">Records</p>
              <h2>Work queue</h2>
              <p className="muted">
                Manage records assigned to your operator account. Updates are
                recorded in the system log.
              </p>
            </div>
            <div className="actions-inline">
              <button
                className="btn ghost"
                type="button"
                onClick={() => refreshTodos()}
                disabled={!session || loadingTodos}
              >
                {loadingTodos ? "Refreshing..." : "Refresh list"}
              </button>
            </div>
            {session && (
              <div className="todo-header-controls">
                <div className="filter-group">
                  {(["all", "active", "completed"] as const).map((mode) => (
                    <button
                      key={mode}
                      className={`filter-button ${filter === mode ? "active" : ""}`}
                      type="button"
                      onClick={() => setFilter(mode)}
                    >
                      {filterLabels[mode]}
                    </button>
                  ))}
                </div>
                <div className="todo-stats">
                  <span>{remainingCount} in progress</span>
                  <span>{completedCount} completed</span>
                </div>
              </div>
            )}
          </div>

          {!session && (
            <p className="muted">Request access to create and manage records.</p>
          )}

          {session && (
            <>
              <div className="todo-grid">
                <div className="todo-list">
                  <div className="pagination-bar">
                    <div>
                      <p className="muted tiny">
                        Page {currentPage} of {totalPages}
                      </p>
                      <p className="muted tiny">
                        Showing {visibleTodos.length} of {totalTodos} records |{" "}
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
                          onClick={() => handlePageChange("prev")}
                          disabled={loadingTodos || currentPage <= 1}
                        >
                          Prev
                        </button>
                        <button
                          className="btn secondary"
                          type="button"
                          onClick={() => handlePageChange("next")}
                          disabled={loadingTodos || currentPage >= totalPages}
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  </div>
                  {loadingTodos && <p className="muted">Loading records...</p>}
                  {!loadingTodos && visibleTodos.length === 0 && (
                    <div className="callout">
                      <div className="callout-title">No records on file</div>
                      <p className="muted">
                        Add the first record from the entry panel.
                      </p>
                    </div>
                  )}
                  {!loadingTodos &&
                    visibleTodos.map((todo) => {
                      const data = normalizeTodo(todo.data);
                      const editing = activeEditId === todo.id;
                      const draft = todoDrafts[todo.id] || data;
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
                                {data.completed ? "Completed" : "In progress"}
                              </span>
                            </label>
                            <span>Last update {toDate(todo.updated_at)}</span>
                          </div>
                          {editing ? (
                            <>
                              <div className="field">
                                <span>Record title</span>
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
                                  value={draft.completed ? "done" : "open"}
                                  onChange={(e) =>
                                    setTodoDrafts((prev) => ({
                                      ...prev,
                                      [todo.id]: {
                                        ...(prev[todo.id] || draft),
                                        completed: e.target.value === "done",
                                      },
                                    }))
                                  }
                                >
                                  <option value="open">In progress</option>
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
                                    ? "Saving..."
                                    : "Save update"}
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
                                    ? "Removing..."
                                    : "Remove"}
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <h3 className="todo-title">
                                {data.title || "Untitled record"}
                              </h3>
                              {Boolean(data.notes?.trim()) && (
                                <p className="todo-notes">{data.notes}</p>
                              )}
                              <div className="todo-footer">
                                <span>Created {toDate(todo.created_at)}</span>
                                <span>
                                  Owner:{" "}
                                  {todo.app_user_id ? (
                                    <span className="mono">
                                      {shortId(todo.app_user_id)}
                                    </span>
                                  ) : (
                                    "unassigned"
                                  )}
                                </span>
                                <span>
                                  Task:{" "}
                                  <span className="mono">
                                    {shortId(todo.id)}
                                  </span>
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
                                    ? "Removing..."
                                    : "Remove"}
                                </button>
                              </div>
                            </>
                          )}
                        </article>
                      );
                    })}
                </div>
                <div className="composer">
                  <div className="field">
                    <span>Record title</span>
                    <input
                      value={draftTodo.title}
                      onChange={(e) =>
                        setDraftTodo({ ...draftTodo, title: e.target.value })
                      }
                      placeholder="Prepare Q3 earnings summary"
                    />
                  </div>
                  <div className="field">
                    <span>Notes</span>
                    <textarea
                      value={draftTodo.notes}
                      onChange={(e) =>
                        setDraftTodo({ ...draftTodo, notes: e.target.value })
                      }
                      placeholder="Follow up with legal on compliance review"
                    />
                  </div>
                  <label className="field">
                    <span>Status</span>
                    <select
                      value={draftTodo.completed ? "done" : "open"}
                      onChange={(e) =>
                        setDraftTodo({
                          ...draftTodo,
                          completed: e.target.value === "done",
                        })
                      }
                    >
                      <option value="open">In progress</option>
                      <option value="done">Completed</option>
                    </select>
                  </label>
                  <button
                    className="btn primary"
                    type="button"
                    disabled={creatingTodo || !session}
                    onClick={handleCreateTodo}
                  >
                    {creatingTodo ? "Saving..." : "Add record"}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </main>

      <div className="dev-toolbar" data-collapsed={!toolbarOpen}>
        <div className="dev-toolbar-header">
          <div className="dev-toolbar-title">
            <span className="dev-indicator" />
            <span>System activity console</span>
            <span className="dev-toolbar-count">
              {requestLogs.length} request{requestLogs.length === 1 ? "" : "s"}
            </span>
          </div>
          <button
            className="btn ghost"
            type="button"
            onClick={() => setToolbarOpen((prev) => !prev)}
            aria-expanded={toolbarOpen}
          >
            {toolbarOpen ? "Collapse" : "Expand"}
          </button>
        </div>
        {toolbarOpen && (
          <div className="dev-toolbar-body">
            {requestLogs.length === 0 ? (
              <p className="muted">
                No activity recorded. Actions will appear here.
              </p>
            ) : (
              <div className="dev-log-list">
                {requestLogs.map((log) => (
                  <div className="dev-log-row" key={log.id}>
                    <span
                      className={`dev-method method-${log.method.toLowerCase()}`}
                    >
                      {log.method}
                    </span>
                    <code className="dev-path">{log.path}</code>
                    <div className="dev-desc">
                      <span>{log.description}</span>
                      {log.status === "error" && log.errorMessage && (
                        <span className="dev-error">{log.errorMessage}</span>
                      )}
                    </div>
                    <span className={`dev-status status-${log.status}`}>
                      {log.status}
                    </span>
                    <span className="dev-time">{log.time}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {(status || error) && (
        <div className="toast" data-tone={error ? "error" : "info"}>
          {error || status}
        </div>
      )}
      {requestToast && (
        <div className="toast request-toast" data-tone="request">
          <div className="toast-title">System request</div>
          <div className="toast-body">
            <span className="toast-method">{requestToast.method}</span>
            <code>{requestToast.path}</code>
          </div>
        </div>
      )}

      <footer className="footer">
        <div>
          <p className="muted">Operational log</p>
          <code>Activity is recorded in the system console.</code>
        </div>
        <div className="muted">
          Record visibility is limited to the current operator.
        </div>
      </footer>
    </div>
  );
}
