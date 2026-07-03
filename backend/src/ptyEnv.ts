// Strips secrets from process.env before handing it to a spawned PTY shell,
// so a terminal session can't `env | grep` its way to JWT secrets or API keys.
const DENYLIST = new Set([
  'SUPABASE_JWT_SECRET',
  'SUPABASE_JWT_PUBLIC_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SYNCTHING_API_KEY',
])

const DENY_PATTERN = /(_SECRET|_JWT|SERVICE_ROLE|_API_KEY)/i

export function buildPtyEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (DENYLIST.has(key) || DENY_PATTERN.test(key)) continue
    env[key] = value
  }
  return env
}
