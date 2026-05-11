import { supabase } from './supabase'

const BASE_URL = import.meta.env.VITE_API_BASE_URL as string
export { BASE_URL }
export const WS_URL = import.meta.env.VITE_API_WS_URL as string

async function authFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token || ''
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {}),
    },
  })
}

export interface StatusData {
  uptime_seconds: number
  load_1: number
  load_5: number
  load_15: number
  hostname: string
}

export interface SyncthingData {
  state: 'idle' | 'syncing' | 'unavailable'
  uptime?: number
  version?: string
}

export interface SessionsData {
  lines: string[]
  total: number
}

export async function getStatus(): Promise<StatusData> {
  const r = await authFetch('/api/status')
  return r.json()
}

export async function getSyncthing(): Promise<SyncthingData> {
  const r = await authFetch('/api/syncthing')
  return r.json()
}

export async function getSessions(): Promise<SessionsData> {
  const r = await authFetch('/api/sessions')
  return r.json()
}

export async function getClaudeMd(): Promise<{ content: string }> {
  const r = await authFetch('/api/claude-md')
  return r.json()
}

export async function saveClaudeMd(content: string): Promise<{ ok: boolean }> {
  const r = await authFetch('/api/claude-md', {
    method: 'POST',
    body: JSON.stringify({ content }),
  })
  return r.json()
}

export function getSSEUrl(token: string): string {
  return `${BASE_URL}/api/sessions/stream?token=${encodeURIComponent(token)}`
}
