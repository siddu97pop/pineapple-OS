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
  load_history?: number[]
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

export interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  mtime: number
  children?: TreeNode[]
}

export interface VaultTreeData {
  path: string
  children: TreeNode[]
}

export async function getVaultTree(relPath = '', depth = 2): Promise<VaultTreeData> {
  const params = new URLSearchParams({ path: relPath, depth: String(depth) })
  const r = await authFetch(`/api/vault/tree?${params}`)
  return r.json()
}

export async function getVaultFile(relPath: string): Promise<{ path: string; content: string }> {
  const params = new URLSearchParams({ path: relPath })
  const r = await authFetch(`/api/vault/file?${params}`)
  return r.json()
}

export async function saveVaultFile(relPath: string, content: string): Promise<{ ok: boolean }> {
  const r = await authFetch('/api/vault/file', {
    method: 'POST',
    body: JSON.stringify({ path: relPath, content }),
  })
  return r.json()
}

export interface AgentProcess {
  pid: number
  name: string
  cmdline: string
  cwd: string
  project: string
  status: 'running' | 'sleeping'
  memMb: number
  cpuPercent: number
  runtimeSecs: number
}

export interface Checkpoint {
  id: string
  ts: string
  agent: string
  action: string
  context: string
  risk: 'high' | 'medium' | 'low'
  status: 'pending' | 'approved' | 'denied'
}

export async function getAgents(): Promise<AgentProcess[]> {
  const r = await authFetch('/api/agents')
  return r.json()
}

export async function killAgent(pid: number): Promise<{ ok: boolean }> {
  const r = await authFetch(`/api/agents/${pid}/kill`, { method: 'POST' })
  return r.json()
}

export async function getCheckpoints(): Promise<Checkpoint[]> {
  const r = await authFetch('/api/checkpoints')
  return r.json()
}

export async function updateCheckpoint(
  id: string,
  status: 'approved' | 'denied',
): Promise<{ ok: boolean }> {
  const r = await authFetch(`/api/checkpoints/${id}`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  })
  return r.json()
}

export async function getCheckpointsSSEUrl(): Promise<string> {
  const { data: { session } } = await (await import('./supabase')).supabase.auth.getSession()
  const token = session?.access_token || ''
  return `${BASE_URL}/api/checkpoints/stream?token=${encodeURIComponent(token)}`
}
