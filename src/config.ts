export type DemoConfig = {
  baseUrl: string
  projectId: number | null
  publicProjectKey: string
  manageProjectKey: string
  collectionSlug: string
}

const sanitizeBaseUrl = (value?: string) => {
  if (!value) return ''
  return value.replace(/\/$/, '').trim()
}

const numberFromEnv = (value: string | undefined): number | null => {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export const envConfig: DemoConfig = {
  baseUrl:
    sanitizeBaseUrl(import.meta.env.VITE_REQRES_BASE_URL) ||
    (import.meta.env.DEV ? 'http://localhost:8000' : 'https://reqres.in'),
  projectId: numberFromEnv(import.meta.env.VITE_REQRES_PROJECT_ID),
  publicProjectKey: (import.meta.env.VITE_REQRES_PUBLIC_KEY || '').trim(),
  manageProjectKey: (import.meta.env.VITE_REQRES_MANAGE_KEY || '').trim(),
  collectionSlug:
    (import.meta.env.VITE_REQRES_COLLECTION_SLUG || 'todos').trim(),
}

export function loadConfig(): DemoConfig {
  return envConfig
}
