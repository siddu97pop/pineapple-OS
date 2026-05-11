import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import 'dotenv/config'

const JWT_PUBLIC_KEY = process.env.SUPABASE_JWT_PUBLIC_KEY!.replace(/\\n/g, '\n')

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractAuthToken(req)
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  try {
    const decoded = jwt.verify(token, JWT_PUBLIC_KEY, { algorithms: ['ES256'] })
    ;(req as any).user = decoded
    next()
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
}

export function extractAuthToken(req: Request): string | null {
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.split(' ')[1]
  }
  // Fallback: query param for SSE and WebSocket (can't set custom headers)
  const queryToken = (req.query as any)?.token
  if (typeof queryToken === 'string' && queryToken) {
    return queryToken
  }
  return null
}
