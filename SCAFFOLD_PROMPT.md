# Pineapple OS — Scaffold Prompt

> Paste the block below into a fresh Claude Code session opened inside the `projects/Pineapple OS/` folder.
> It will generate the complete codebase. No research needed — all decisions are embedded.

---

```
You are building "Pineapple OS" — a personal browser-based master dashboard for VPS-hosted Claude Code development. Build the COMPLETE working codebase. Do not ask questions — all architecture decisions are specified below. Create every file listed in full. Do not summarize, skip, or stub any file.

## WHAT IT DOES
1. Browser terminal (xterm.js + WebSocket PTY) that opens a plain `/bin/bash` shell
2. Live feed of /data/obsidian/logs/sessions.md (SSE-based real-time tail)
3. Inline CLAUDE.md viewer/editor (read + write via API)
4. Status bar: live clock, VPS uptime, Syncthing status
5. Auth: Supabase email + password login with password reset to siddu97pop@gmail.com

## DESIGN SYSTEM (must match exactly)
- Background:  #0a0f1e (deep navy, OLED)
- Surface:     #0d1629 (cards)
- Border:      #1e3a5f
- Accent:      #0ea5e9 (electric blue)
- Text:        #e2e8f0
- Muted:       #64748b
- Success:     #22c55e
- Warning:     #f59e0b
- Error:       #ef4444
- Font UI:     DM Sans (400/500/700) via Google Fonts
- Font Code:   JetBrains Mono (400/500) via Google Fonts
- Dot-grid bg: background-image: radial-gradient(circle, #1e3a5f 1px, transparent 1px); background-size: 24px 24px; background-color: #0a0f1e
- Card glow:   box-shadow: inset 0 0 20px rgba(14,165,233,0.05), 0 0 0 1px #1e3a5f
- Hover glow:  box-shadow: 0 0 20px rgba(14,165,233,0.15)

## FOLDER STRUCTURE TO CREATE
```
frontend/             (React 18 + Vite 5 + Tailwind CSS + TypeScript)
backend/              (Node.js 20 + Express + ws + node-pty + TypeScript)
deploy/               (systemd, Traefik config, deploy scripts)
```

---

## BACKEND (backend/)

### backend/package.json
```json
{
  "name": "pineapple-api",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "nodemon --exec ts-node src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "ws": "^8.16.0",
    "node-pty": "^1.0.0",
    "chokidar": "^3.6.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "uuid": "^9.0.1",
    "jsonwebtoken": "^9.0.2"
  },
  "devDependencies": {
    "typescript": "^5.4.5",
    "@types/express": "^4.17.21",
    "@types/ws": "^8.5.10",
    "@types/node": "^20.12.7",
    "@types/uuid": "^9.0.8",
    "@types/jsonwebtoken": "^9.0.6",
    "@types/cors": "^2.8.17",
    "ts-node": "^10.9.2",
    "nodemon": "^3.1.0"
  }
}
```

### backend/tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

### backend/.env.example
```
PORT=3456
SESSIONS_MD_PATH=/data/obsidian/logs/sessions.md
CLAUDE_MD_PATH=/data/obsidian/CLAUDE.md
SYNCTHING_API_KEY=your_syncthing_api_key_here
SYNCTHING_URL=http://localhost:8384
ALLOWED_ORIGINS=https://pineapple.lexitools.tech
MAX_PTY_SESSIONS=5
SUPABASE_JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
```
Note: Supabase access tokens are ES256-signed. Fetch the public key from:
`https://<your-project-ref>.supabase.co/auth/v1/.well-known/jwks.json`
and set it as a PEM string in `SUPABASE_JWT_PUBLIC_KEY`.

### backend/src/auth.ts
Implement JWT verification middleware for Supabase.

Import: express (Request, Response, NextFunction), jsonwebtoken (verify, JwtPayload), dotenv

Export function `requireAuth(req: Request, res: Response, next: NextFunction): void`:
- Extract token from Authorization header: `Bearer <token>` → split on ' '[1]
- If no token: res.status(401).json({error: 'Unauthorized'}) and return
- Verify token using:
  `jwt.verify(token, process.env.SUPABASE_JWT_PUBLIC_KEY!.replace(/\\n/g, '\n'), { algorithms: ['ES256'] })`
- On success: attach decoded payload to req as `(req as any).user = decoded`, call next()
- On error: res.status(401).json({error: 'Invalid token'}) and return

Export function `extractAuthToken(req: Request): string | null`:
- Returns bearer token from Authorization header or null
- Used by WebSocket upgrade handler

### backend/src/terminal.ts
Implement PTY session manager.

Import: node-pty (IPty, spawn), ws (WebSocket), uuid (v4), path

Constants from env: MAX_PTY_SESSIONS = parseInt(process.env.MAX_PTY_SESSIONS || '5')
OBSIDIAN_PATH = process.env.CLAUDE_MD_PATH ? path.dirname(process.env.CLAUDE_MD_PATH) : '/data/obsidian'

Maintain: `const activeSessions = new Map<string, IPty>()`

Export function `handleTerminalConnection(ws: WebSocket): void`:
1. If activeSessions.size >= MAX_PTY_SESSIONS:
   - ws.send(JSON.stringify({type:'error', message:'Session limit reached (max 5)'}))
   - ws.close()
   - return
2. const sessionId = v4()
3. Spawn PTY:
   ```
   const pty = spawn('/bin/bash', [], {
     name: 'xterm-256color',
     cols: 80,
     rows: 24,
     cwd: OBSIDIAN_PATH,
     env: process.env as Record<string, string>
   })
   ```
4. pty.onData((data) => {
     if (ws.readyState === WebSocket.OPEN) {
       ws.send(Buffer.from(data, 'binary'), { binary: true })
     }
   })
5. pty.onExit(({exitCode}) => { ws.send(JSON.stringify({type:'exit', code: exitCode})); ws.close(); activeSessions.delete(sessionId) })
6. ws.on('message', (raw: Buffer) => {
     try {
       const msg = JSON.parse(raw.toString())
       if (msg.type === 'input') pty.write(msg.data)
       else if (msg.type === 'resize') pty.resize(msg.cols, msg.rows)
     } catch {}
   })
7. ws.on('close', () => { try { pty.kill('SIGHUP') } catch {} activeSessions.delete(sessionId) })
8. ws.on('error', () => { try { pty.kill('SIGHUP') } catch {} activeSessions.delete(sessionId) })
9. activeSessions.set(sessionId, pty)

### backend/src/fileWatch.ts
Implement chokidar file watcher with SSE broadcaster.

Import: chokidar, fs (promises), path, express (Response)

const sseClients = new Set<Response>()
let sessionsPath: string

function readLastNLines(content: string, n: number): string[] — splits by '\n', filters empty, returns last n

Export function `initFileWatcher(sessionsPath_: string): void`:
- sessionsPath = sessionsPath_
- const watcher = chokidar.watch(sessionsPath, { persistent: true, usePolling: false, awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 } })
- watcher.on('change', () => broadcastUpdate())
- watcher.on('error', (err) => console.error('File watcher error:', err))

async function broadcastUpdate(): void:
- Read file: `await fs.readFile(sessionsPath, 'utf8')`
- lines = readLastNLines(content, 20)
- const payload = `data: ${JSON.stringify({lines, ts: Date.now()})}\n\n`
- For each client in sseClients: try { client.write(payload) } catch { sseClients.delete(client) }

Export function `addSSEClient(res: Response): void`:
- sseClients.add(res)
- res.on('close', () => sseClients.delete(res))

Export async function `getLastLines(n = 20): Promise<string[]>`:
- Read sessionsPath, return readLastNLines(content, n)

### backend/src/status.ts
Implement status endpoint handlers.

Import: fs (promises), os, http (IncomingMessage), https (same)

Export async function `getStatusHandler(req, res)`:
- Read /proc/uptime: `await fs.readFile('/proc/uptime', 'utf8')` → parseFloat(split(' ')[0]) = uptimeSecs
- Read /proc/loadavg: `await fs.readFile('/proc/loadavg', 'utf8')` → split on ' ', take indices 0,1,2 as numbers
- res.json({ uptime_seconds: uptimeSecs, load_1: loads[0], load_5: loads[1], load_15: loads[2], hostname: os.hostname() })
- On error: res.status(500).json({error: 'Failed to read system status'})

Export async function `getSyncthingHandler(req, res)`:
- const url = `${process.env.SYNCTHING_URL || 'http://localhost:8384'}/rest/system/status`
- const apiKey = process.env.SYNCTHING_API_KEY || ''
- Use AbortController with 3000ms timeout
- fetch(url, { headers: {'X-API-Key': apiKey}, signal: controller.signal })
- On success: const data = await resp.json() → res.json({state: 'idle', uptime: data.uptime, version: data.version, myID: data.myID})
- On error/timeout: res.json({state: 'unavailable'})

### backend/src/claudeMd.ts
Import: fs (promises), dotenv

const claudeMdPath = () => process.env.CLAUDE_MD_PATH || '/data/obsidian/CLAUDE.md'

Export async function `getClaudeMdHandler(req, res)`:
- content = await fs.readFile(claudeMdPath(), 'utf8')
- res.json({content})
- On error: res.status(500).json({error: 'Failed to read CLAUDE.md'})

Export async function `saveClaudeMdHandler(req, res)`:
- const { content } = req.body
- if (typeof content !== 'string'): res.status(400).json({error: 'content must be a string'}); return
- await fs.writeFile(claudeMdPath(), content, 'utf8')
- res.json({ok: true, saved_at: new Date().toISOString()})
- On error: res.status(500).json({error: 'Failed to write CLAUDE.md'})

### backend/src/sessions.ts
Import: fs (promises)

const sessionsPath = () => process.env.SESSIONS_MD_PATH || '/data/obsidian/logs/sessions.md'

Export async function `getSessionsHandler(req, res)`:
- content = await fs.readFile(sessionsPath(), 'utf8')
- const allLines = content.split('\n').filter(l => l.trim() !== '')
- const lines = allLines.slice(-20)
- res.json({lines, total: allLines.length})
- On error: res.status(500).json({error: 'Failed to read sessions.md'})

### backend/src/index.ts
This is the main entry point. Write it completely.

Import: dotenv (config at top, before all else), express, http (createServer), WebSocketServer from 'ws', cors, path
Import handlers from: ./auth, ./terminal, ./fileWatch, ./status, ./claudeMd, ./sessions

dotenv.config()

const app = express()
const server = http.createServer(app)

Middleware:
- app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*', methods: ['GET','POST','OPTIONS'] }))
- app.use(express.json({ limit: '2mb' }))

Routes (all protected with requireAuth except /health):
- GET /health → res.json({ok:true, ts: Date.now(), service: 'pineapple-api'})
- GET /api/status → requireAuth middleware, then getStatusHandler
- GET /api/syncthing → requireAuth, getSyncthingHandler
- GET /api/sessions → requireAuth, getSessionsHandler
- GET /api/sessions/stream → requireAuth inline handler:
  ```
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
  res.write('data: {"connected":true}\n\n')
  addSSEClient(res)
  ```
- GET /api/claude-md → requireAuth, getClaudeMdHandler
- POST /api/claude-md → requireAuth, saveClaudeMdHandler

WebSocket server:
```
const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false })

server.on('upgrade', (request, socket, head) => {
  if (request.url?.startsWith('/terminal')) {
    let token: string | null = null
    try {
      const params = new URL(request.url, 'http://x').searchParams
      token = params.get('token')
    } catch {}
    if (!token) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return }
    try {
      jwt.verify(token, process.env.SUPABASE_JWT_PUBLIC_KEY!.replace(/\\n/g, '\n'), { algorithms: ['ES256'] })
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    } catch { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy() }
  } else {
    socket.destroy()
  }
})

wss.on('connection', (ws) => handleTerminalConnection(ws))
```

Note: import jwt from 'jsonwebtoken' in index.ts as well for the WS upgrade handler.

Startup:
```
const PORT = parseInt(process.env.PORT || '3456')
const SESSIONS_PATH = process.env.SESSIONS_MD_PATH || '/data/obsidian/logs/sessions.md'

initFileWatcher(SESSIONS_PATH)

server.listen(PORT, () => {
  console.log(`
  ____  _                              __  ____  ____
 |  _ \\(_)_ __   ___  __ _ _ __  _ __|  \\/  |\\ \\/ /
 | |_) | | '_ \\ / _ \\/ _\` | '_ \\| '_ \\ |\\/| | \\  /
 |  __/| | | | |  __/ (_| | |_) | |_) | |  | | /  \\
 |_|   |_|_| |_|\\___|\\__,_| .__/| .__/|_|  |_|/_/\\_\\
                            |_|  |_|
  Pineapple OS API — port ${PORT}
  `)
})
```

---

## FRONTEND (frontend/)

### frontend/package.json
```json
{
  "name": "pineapple-os-frontend",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.23.1",
    "@supabase/supabase-js": "^2.43.4",
    "@xterm/xterm": "^5.5.0",
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/addon-web-links": "^0.11.0"
  },
  "devDependencies": {
    "typescript": "^5.4.5",
    "@types/react": "^18.3.1",
    "@types/react-dom": "^18.3.0",
    "vite": "^5.2.11",
    "@vitejs/plugin-react": "^4.2.1",
    "tailwindcss": "^3.4.3",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38"
  }
}
```

### frontend/tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

### frontend/tsconfig.node.json
```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

### frontend/vite.config.ts
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3456',
      '/health': 'http://localhost:3456',
    }
  }
})
```

### frontend/tailwind.config.ts
```typescript
import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          950: '#0a0f1e',
          900: '#0d1629',
          800: '#111827',
          700: '#1a2035',
          600: '#1e3a5f',
        },
        electric: {
          DEFAULT: '#0ea5e9',
          dim: '#0284c7',
          glow: '#38bdf8',
          faint: 'rgba(14,165,233,0.15)',
        }
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'spin-slow': 'spin 2s linear infinite',
      }
    },
  },
  plugins: [],
} satisfies Config
```

### frontend/postcss.config.js
```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

### frontend/index.html
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🍍</text></svg>" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Pineapple OS</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### frontend/.env.example
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here
VITE_API_BASE_URL=https://pineapple-api.lexitools.tech
VITE_API_WS_URL=wss://pineapple-api.lexitools.tech
```

### frontend/vercel.json
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

### frontend/src/styles/globals.css
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  body {
    @apply bg-navy-950 text-slate-200 font-sans;
    background-image: radial-gradient(circle, #1e3a5f 1px, transparent 1px);
    background-size: 24px 24px;
    background-color: #0a0f1e;
    min-height: 100vh;
    overflow-x: hidden;
  }
  * { box-sizing: border-box; }
}

@layer components {
  .card {
    @apply bg-navy-900 rounded-xl;
    border: 1px solid #1e3a5f;
    box-shadow: inset 0 0 20px rgba(14,165,233,0.05), 0 0 0 1px #1e3a5f;
  }
  .card:hover {
    box-shadow: inset 0 0 20px rgba(14,165,233,0.08), 0 0 20px rgba(14,165,233,0.08), 0 0 0 1px #1e3a5f;
  }
  .btn-primary {
    @apply bg-electric text-white px-4 py-2 rounded-lg text-sm font-medium transition-all;
  }
  .btn-primary:hover { background: #0284c7; box-shadow: 0 0 20px rgba(14,165,233,0.3); }
  .btn-primary:disabled { @apply opacity-50 cursor-not-allowed; }
  .btn-ghost {
    @apply text-slate-400 px-3 py-1.5 rounded-lg text-sm transition-colors;
  }
  .btn-ghost:hover { @apply text-white bg-navy-700; }
  .input-field {
    @apply w-full bg-navy-950 border border-navy-600 rounded-lg px-4 py-2.5 text-slate-200 text-sm outline-none transition-all;
  }
  .input-field:focus { border-color: #0ea5e9; box-shadow: 0 0 0 3px rgba(14,165,233,0.15); }
  .section-label {
    @apply text-xs font-mono uppercase tracking-widest text-slate-500;
  }
}

/* xterm.js overrides */
.xterm-viewport { background: transparent !important; }
.xterm-screen { background: transparent !important; }
.xterm { height: 100% !important; }
.xterm-helper-textarea { opacity: 0; }
```

### frontend/src/lib/supabase.ts
```typescript
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
```

### frontend/src/lib/api.ts
Typed API helpers. All requests include Authorization: Bearer <supabase session token>.

```typescript
const BASE_URL = import.meta.env.VITE_API_BASE_URL as string
export const WS_URL = import.meta.env.VITE_API_WS_URL as string

async function authFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const { supabase } = await import('./supabase')
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token || ''
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {}),
    }
  })
}

export interface StatusData { uptime_seconds: number; load_1: number; load_5: number; load_15: number; hostname: string }
export interface SyncthingData { state: 'idle' | 'syncing' | 'unavailable'; uptime?: number; version?: string }
export interface SessionsData { lines: string[]; total: number }

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
  const r = await authFetch('/api/claude-md', { method: 'POST', body: JSON.stringify({ content }) })
  return r.json()
}
export function getSSEUrl(token: string): string {
  return `${BASE_URL}/api/sessions/stream?token=${encodeURIComponent(token)}`
}
```

Note: The SSE endpoint needs to accept auth via query param since EventSource doesn't support custom headers. Update backend/src/auth.ts to also accept token from `req.query.token` as a fallback, and update the sessions/stream route to extract it that way.

### frontend/src/hooks/useAuth.ts
```typescript
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Session } from '@supabase/supabase-js'

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  return { session, loading }
}
```

### frontend/src/hooks/useSSE.ts
```typescript
import { useState, useEffect, useRef } from 'react'

export function useSSE<T>(url: string | null): { data: T | null; connected: boolean } {
  const [data, setData] = useState<T | null>(null)
  const [connected, setConnected] = useState(false)
  const retryTimeout = useRef<number>()
  const retryDelay = useRef(2000)

  useEffect(() => {
    if (!url) return
    let es: EventSource
    let cancelled = false

    function connect() {
      es = new EventSource(url!)
      es.onopen = () => { setConnected(true); retryDelay.current = 2000 }
      es.onmessage = (e) => {
        try { setData(JSON.parse(e.data)) } catch {}
      }
      es.onerror = () => {
        setConnected(false)
        es.close()
        if (!cancelled) {
          retryTimeout.current = window.setTimeout(() => {
            retryDelay.current = Math.min(retryDelay.current * 1.5, 30000)
            connect()
          }, retryDelay.current)
        }
      }
    }

    connect()
    return () => {
      cancelled = true
      clearTimeout(retryTimeout.current)
      es?.close()
    }
  }, [url])

  return { data, connected }
}
```

### frontend/src/hooks/useUptime.ts
```typescript
import { useState, useEffect } from 'react'
import { getStatus, type StatusData } from '../lib/api'

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function useUptime() {
  const [status, setStatus] = useState<StatusData | null>(null)

  useEffect(() => {
    const fetch = () => getStatus().then(setStatus).catch(() => {})
    fetch()
    const id = setInterval(fetch, 30000)
    return () => clearInterval(id)
  }, [])

  return status
}
```

### frontend/src/hooks/useSyncthingStatus.ts
```typescript
import { useState, useEffect } from 'react'
import { getSyncthing, type SyncthingData } from '../lib/api'

export function useSyncthingStatus() {
  const [status, setStatus] = useState<SyncthingData | null>(null)

  useEffect(() => {
    const fetch = () => getSyncthing().then(setStatus).catch(() => {})
    fetch()
    const id = setInterval(fetch, 60000)
    return () => clearInterval(id)
  }, [])

  return status
}
```

### frontend/src/components/DotGrid.tsx
```tsx
export function DotGrid() {
  return (
    <div
      className="fixed inset-0 -z-10 pointer-events-none"
      style={{
        backgroundColor: '#0a0f1e',
        backgroundImage: 'radial-gradient(circle, #1e3a5f 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
    />
  )
}
```

### frontend/src/components/NavBar.tsx
```tsx
export function NavBar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 h-12 border-b border-navy-600" style={{background: 'rgba(13,22,41,0.85)', backdropFilter: 'blur(12px)'}}>
      <div className="flex items-center gap-2">
        <span className="text-xl">🍍</span>
        <span className="font-bold text-white tracking-tight">Pineapple OS</span>
      </div>
      <a
        href="https://dash.lexitools.tech"
        target="_blank"
        rel="noopener noreferrer"
        className="text-electric text-sm border border-electric/40 hover:bg-electric/10 px-4 py-1 rounded-full transition-all"
      >
        Mission Control ↗
      </a>
    </nav>
  )
}
```

### frontend/src/components/StatusBar.tsx
```tsx
import { useState, useEffect } from 'react'
import { useUptime, formatUptime } from '../hooks/useUptime'
import { useSyncthingStatus } from '../hooks/useSyncthingStatus'

function LiveClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id) }, [])
  return <span className="font-mono text-xs text-slate-400">{now.toLocaleString('en-GB', {weekday:'short', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit'})}</span>
}

function SyncDot({ state }: { state: string | null }) {
  const color = state === 'idle' ? '#22c55e' : state === 'syncing' ? '#f59e0b' : '#4b5563'
  const label = state === 'idle' ? 'Synced' : state === 'syncing' ? 'Syncing' : 'Sync N/A'
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-500">
      <span className="w-2 h-2 rounded-full" style={{backgroundColor: color, boxShadow: state === 'idle' ? `0 0 6px ${color}` : undefined}} />
      {label}
    </span>
  )
}

export function StatusBar() {
  const uptimeStatus = useUptime()
  const syncStatus = useSyncthingStatus()

  return (
    <div className="fixed top-12 left-0 right-0 z-40 flex items-center gap-4 px-6 h-9 border-b border-navy-600/50" style={{background: 'rgba(10,15,30,0.7)'}}>
      <LiveClock />
      <span className="text-navy-600">·</span>
      <span className="text-xs text-slate-500">
        {uptimeStatus ? `Up ${formatUptime(uptimeStatus.uptime_seconds)}` : 'Loading...'}
        {uptimeStatus && <span className="ml-1 text-slate-600">({uptimeStatus.hostname})</span>}
      </span>
      <span className="text-navy-600">·</span>
      <SyncDot state={syncStatus?.state ?? null} />
    </div>
  )
}
```

### frontend/src/components/Terminal.tsx
Write the complete component. It must:

1. Use useRef<HTMLDivElement>(null) for container, useRef for Terminal and FitAddon instances
2. Track wsStatus: 'connecting' | 'connected' | 'disconnected' in useState
3. Track reconnectIn: number in useState (countdown seconds)
4. Get auth token async from supabase.auth.getSession() before opening WS
5. WS URL: `${WS_URL}/terminal` with header injection not possible for WS — instead append token as query param: `${WS_URL}/terminal?token=${token}`
   (Update backend WS upgrade handler to also check `new URL(request.url, 'http://x').searchParams.get('token')` as fallback)
6. xterm theme: { background:'#0a0f1e', foreground:'#e2e8f0', cursor:'#0ea5e9', cursorAccent:'#0a0f1e', selectionBackground:'rgba(14,165,233,0.2)', black:'#0a0f1e', brightBlack:'#1e3a5f', red:'#f87171', brightRed:'#ef4444', green:'#4ade80', brightGreen:'#22c55e', yellow:'#fbbf24', brightYellow:'#f59e0b', blue:'#0ea5e9', brightBlue:'#38bdf8', magenta:'#a78bfa', brightMagenta:'#8b5cf6', cyan:'#22d3ee', brightCyan:'#06b6d4', white:'#e2e8f0', brightWhite:'#f8fafc' }
7. fontFamily: 'JetBrains Mono, Fira Code, monospace', fontSize: 14, lineHeight: 1.5, cursorBlink: true, scrollback: 5000
8. FitAddon: call fit() on mount and on window resize (debounce 100ms)
9. On resize: send {type:'resize', cols, rows} via WS
10. On terminal data: send {type:'input', data} via WS
11. On WS message: parse {type:'output', data} → terminal.write(data)
12. On WS close/error: setWsStatus('disconnected'), start 3s countdown, reconnect
13. Cleanup on unmount: terminal.dispose(), ws.close()
14. Render: relative div, full height, card class, overflow hidden
   - Inner container ref div: absolute inset-0, p-2
   - Connecting overlay: semi-transparent navy bg, centered, electric spinner + "Connecting to VPS..." text
   - Disconnected overlay: amber warning icon + "Connection lost — reconnecting in Xs" + manual retry button

```tsx
import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { WS_URL } from '../lib/api'

// Write the full component implementing all specs above
// Component name: Terminal
// Props: className?: string
```

### frontend/src/components/SessionsFeed.tsx
```tsx
import { useEffect, useRef, useState } from 'react'
import { getSessions, getSSEUrl } from '../lib/api'
import { useSSE } from '../hooks/useSSE'
import { supabase } from '../lib/supabase'

interface SSEData { lines: string[]; ts: number }

function classifyLine(line: string): 'heading' | 'timestamp' | 'file' | 'normal' {
  if (line.startsWith('##') || line.startsWith('###')) return 'heading'
  if (/^\d{4}-\d{2}-\d{2}/.test(line) || /\*\*\d{4}-\d{2}-\d{2}/.test(line)) return 'timestamp'
  if (line.startsWith('- ') && line.includes('/')) return 'file'
  return 'normal'
}

export function SessionsFeed() {
  const [lines, setLines] = useState<string[]>([])
  const [sseUrl, setSseUrl] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const { data, connected } = useSSE<SSEData>(sseUrl)

  useEffect(() => {
    getSessions().then(d => setLines(d.lines))
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) setSseUrl(getSSEUrl(session.access_token))
    })
  }, [])

  useEffect(() => {
    if (data?.lines) setLines(data.lines)
  }, [data])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  return (
    <div className="card flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-navy-600/50 flex-shrink-0">
        <span className="section-label">sessions.md</span>
        <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-slate-600'}`} style={connected ? {boxShadow:'0 0 6px #22c55e'} : {}} />
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1 font-mono text-xs">
        {lines.map((line, i) => {
          const type = classifyLine(line)
          if (type === 'heading') return <div key={i} className="text-electric font-medium text-sm mt-2 first:mt-0">{line}</div>
          if (type === 'timestamp') return <div key={i} className="text-slate-500">{line}</div>
          if (type === 'file') return <div key={i} className="text-slate-400 pl-2">{line}</div>
          return <div key={i} className="text-slate-300">{line}</div>
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
```

### frontend/src/components/ClaudeMdEditor.tsx
```tsx
import { useState, useEffect, useRef } from 'react'
import { getClaudeMd, saveClaudeMd } from '../lib/api'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export function ClaudeMdEditor() {
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const timerRef = useRef<number>()

  useEffect(() => {
    getClaudeMd().then(d => { setContent(d.content); setSavedContent(d.content) })
    return () => clearTimeout(timerRef.current)
  }, [])

  const isDirty = content !== savedContent

  const handleSave = async () => {
    setSaveStatus('saving')
    try {
      await saveClaudeMd(content)
      setSavedContent(content)
      setSaveStatus('saved')
      timerRef.current = window.setTimeout(() => setSaveStatus('idle'), 2000)
    } catch {
      setSaveStatus('error')
      timerRef.current = window.setTimeout(() => setSaveStatus('idle'), 3000)
    }
  }

  const saveLabel = saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved ✓' : saveStatus === 'error' ? 'Error ✗' : 'Save'
  const saveBg = saveStatus === 'saved' ? '#22c55e' : saveStatus === 'error' ? '#ef4444' : '#0ea5e9'

  return (
    <div className="card flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-navy-600/50 flex-shrink-0 gap-3">
        <div className="flex items-center gap-2">
          <span className="section-label">CLAUDE.md</span>
          {isDirty && <span className="w-2 h-2 rounded-full bg-electric" style={{boxShadow:'0 0 6px #0ea5e9'}} />}
        </div>
        <button
          onClick={handleSave}
          disabled={!isDirty || saveStatus === 'saving'}
          className="px-3 py-1 rounded-lg text-xs text-white font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{background: isDirty ? saveBg : '#1e3a5f'}}
        >
          {saveLabel}
        </button>
      </div>
      <textarea
        className="flex-1 bg-transparent text-slate-300 font-mono text-xs p-4 resize-none outline-none border-none overflow-y-auto"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        spellCheck={false}
      />
    </div>
  )
}
```

### frontend/src/pages/Login.tsx
```tsx
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { DotGrid } from '../components/DotGrid'

type Mode = 'login' | 'reset'

export function Login() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setMessage({ type: 'error', text: error.message })
    setLoading(false)
  }

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`
    })
    if (error) setMessage({ type: 'error', text: error.message })
    else setMessage({ type: 'success', text: 'Reset link sent! Check siddu97pop@gmail.com' })
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <DotGrid />
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">🍍</div>
          <h1 className="text-2xl font-bold text-white">Pineapple OS</h1>
          <p className="text-slate-500 text-sm mt-1">Personal command center</p>
        </div>
        <div className="card p-6">
          <h2 className="text-sm font-medium text-slate-400 mb-6 uppercase tracking-wider">
            {mode === 'login' ? 'Sign In' : 'Reset Password'}
          </h2>
          <form onSubmit={mode === 'login' ? handleLogin : handleReset} className="space-y-4">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="input-field"
              required
            />
            {mode === 'login' && (
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="input-field"
                required
              />
            )}
            {message && (
              <div className={`text-xs px-3 py-2 rounded-lg ${message.type === 'error' ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>
                {message.text}
              </div>
            )}
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Send Reset Link'}
            </button>
          </form>
          <div className="mt-4 text-center">
            {mode === 'login' ? (
              <button onClick={() => { setMode('reset'); setMessage(null) }} className="text-xs text-slate-500 hover:text-electric transition-colors">
                Forgot password?
              </button>
            ) : (
              <button onClick={() => { setMode('login'); setMessage(null) }} className="text-xs text-slate-500 hover:text-electric transition-colors">
                ← Back to sign in
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
```

### frontend/src/pages/Dashboard.tsx
```tsx
import { NavBar } from '../components/NavBar'
import { StatusBar } from '../components/StatusBar'
import { Terminal } from '../components/Terminal'
import { SessionsFeed } from '../components/SessionsFeed'
import { ClaudeMdEditor } from '../components/ClaudeMdEditor'
import { DotGrid } from '../components/DotGrid'

export function Dashboard() {
  return (
    <div className="h-screen overflow-hidden">
      <DotGrid />
      <NavBar />
      <StatusBar />
      <main className="pt-[84px] h-screen flex flex-col overflow-hidden px-3 pb-3 gap-3">
        <div className="flex flex-1 gap-3 min-h-0">
          {/* Left: Terminal (fills remaining space) */}
          <div className="flex-1 min-w-0 min-h-0">
            <Terminal className="h-full" />
          </div>
          {/* Right: Sessions + CLAUDE.md editor */}
          <div className="w-[360px] flex-shrink-0 flex flex-col gap-3 min-h-0">
            <div className="flex-1 min-h-0">
              <SessionsFeed />
            </div>
            <div className="h-64 flex-shrink-0">
              <ClaudeMdEditor />
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
```

### frontend/src/App.tsx
```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import './styles/globals.css'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{background:'#0a0f1e'}}>
      <div className="w-8 h-8 rounded-full border-4 border-electric border-t-transparent animate-spin" />
    </div>
  )
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
```

### frontend/src/main.tsx
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

---

## DEPLOY FILES (deploy/)

### deploy/pineapple-api.service
```ini
[Unit]
Description=Pineapple OS API Backend
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/pineapple-api
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
EnvironmentFile=/opt/pineapple-api/.env
StandardOutput=journal
StandardError=journal
SyslogIdentifier=pineapple-api

[Install]
WantedBy=multi-user.target
```

### deploy/traefik-pineapple.yml
```yaml
http:
  routers:
    pineapple-api:
      rule: "Host(`pineapple-api.lexitools.tech`)"
      entryPoints:
        - websecure
      service: pineapple-api-svc
      tls:
        certResolver: letsencrypt

  services:
    pineapple-api-svc:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:3456"
```
Note: Traefik 2.x/3.x auto-proxies WebSocket upgrades — no special config needed for the /terminal WS endpoint.

### deploy/deploy-backend.sh
```bash
#!/bin/bash
set -e
REMOTE=ubuntu@76.13.223.10
REMOTE_DIR=/opt/pineapple-api

echo "==> Building TypeScript..."
cd backend
npm ci
npx tsc -p tsconfig.json
cd ..

echo "==> Syncing to VPS..."
rsync -avz --exclude node_modules --exclude .env --exclude src backend/dist/ $REMOTE:$REMOTE_DIR/dist/
rsync -avz backend/package.json backend/package-lock.json $REMOTE:$REMOTE_DIR/

echo "==> Installing production deps on VPS..."
ssh $REMOTE "cd $REMOTE_DIR && npm ci --omit=dev"

echo "==> Restarting service..."
ssh $REMOTE "sudo systemctl restart pineapple-api && sleep 2 && sudo systemctl status pineapple-api --no-pager -l"

echo "==> Testing health endpoint..."
ssh $REMOTE "curl -sf http://localhost:3456/health && echo ' OK'"

echo "Done!"
```

### deploy/deploy-frontend.sh
```bash
#!/bin/bash
set -e
echo "==> Deploying frontend to Vercel..."
cd frontend
vercel --prod
echo "Done! Check https://pineapple.lexitools.tech"
```

---

## IMPORTANT IMPLEMENTATION NOTES

1. **Backend: auth.ts token extraction** — update `requireAuth` and `extractAuthToken` to also check `req.query.token` as a fallback. This enables SSE (EventSource can't set headers) and WS (WebSocket URL must carry token as query param `?token=...`). Update the WS upgrade handler in index.ts to parse the token from the URL query string using `new URL(request.url, 'http://x').searchParams.get('token')`.

2. **Backend: WS upgrade URL** — The /terminal WebSocket URL will be `wss://pineapple-api.lexitools.tech/terminal?token=<supabase_jwt>`. The server.on('upgrade') handler must parse this URL to extract the token.

3. **Terminal component: token flow** — Call `supabase.auth.getSession()` before opening the WebSocket. Append `?token=${session.access_token}` to the WS URL. On Supabase token refresh (tokens expire after 1 hour), reconnect with the new token. Listen to `supabase.auth.onAuthStateChange` to detect token refresh events, and close + reopen the WS with the new token.

4. **node-pty on VPS** — Requires native build tools. Install on VPS before first deploy:
   `sudo apt-get install -y python3 make g++`
   Then `npm ci` will compile the native addon.

5. **Supabase setup** — Before deploying:
   - Go to Supabase Dashboard → Authentication → Providers → Email → Enable "Email + Password"
   - Disable "Confirm email" (so you can sign in immediately after creating your account via Supabase dashboard)
   - Create your account via Supabase Dashboard → Authentication → Users → Add User (email: siddu97pop@gmail.com)
   - Get JWT Secret from: Project Settings → API → JWT Secret → copy to backend .env as SUPABASE_JWT_SECRET
   - Get URL + anon key from: Project Settings → API → paste into frontend .env

6. **Environment variables for Vercel** — After `vercel --prod`, go to Vercel dashboard → Project → Settings → Environment Variables and add: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_BASE_URL, VITE_API_WS_URL

7. **DNS records to add in Hostinger:**
   - `A  pineapple-api  →  76.13.223.10`
   - `CNAME  pineapple  →  cname.vercel-dns.com` (Vercel will give exact value)

Now generate every file completely. Start with backend/, then frontend/, then deploy/. Write each file in full. No stubs, no placeholders, no "implement this yourself" — write all code.
```

---

## Post-Scaffold Checklist

After Claude generates all files, do these steps in order:

### 1. VPS First-Time Setup
```bash
ssh ubuntu@76.13.223.10
sudo apt-get install -y python3 make g++
sudo mkdir -p /opt/pineapple-api && sudo chown ubuntu:ubuntu /opt/pineapple-api
# Node 20 — check if installed: node -v. If not:
# curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
# sudo apt-get install -y nodejs
```

### 2. Configure Supabase
- Supabase Dashboard → Authentication → Email provider → enable email+password, disable email confirm
- Create user: Authentication → Users → Add User → siddu97pop@gmail.com
- Copy JWT Secret from: Project Settings → API → JWT Secret
- Copy URL + anon key from: Project Settings → API

### 3. Create .env files
```bash
# Backend (on VPS)
nano /opt/pineapple-api/.env    # fill in SUPABASE_JWT_SECRET + SYNCTHING_API_KEY

# Frontend (local)
cp frontend/.env.example frontend/.env.local
# fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_BASE_URL, VITE_API_WS_URL
```

### 4. Deploy Backend
```bash
chmod +x deploy/deploy-backend.sh && ./deploy/deploy-backend.sh
scp deploy/pineapple-api.service ubuntu@76.13.223.10:/tmp/
ssh ubuntu@76.13.223.10 "sudo cp /tmp/pineapple-api.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now pineapple-api"
```

### 5. Configure Traefik
```bash
scp deploy/traefik-pineapple.yml ubuntu@76.13.223.10:/tmp/
ssh ubuntu@76.13.223.10 "sudo cp /tmp/traefik-pineapple.yml /etc/traefik/dynamic/pineapple.yml"
```

### 6. Add DNS Records (Hostinger)
- A record: `pineapple-api` → `76.13.223.10`
- CNAME: `pineapple` → Vercel target (shown during first `vercel --prod` run)

### 7. Deploy Frontend
```bash
cd frontend && vercel --prod
# Add custom domain pineapple.lexitools.tech in Vercel dashboard
# Add env vars in Vercel dashboard (same as .env.local)
```

### 8. Smoke Test
```bash
curl https://pineapple-api.lexitools.tech/health
curl -H "Authorization: Bearer <your-jwt>" https://pineapple-api.lexitools.tech/api/status
open https://pineapple.lexitools.tech
```
