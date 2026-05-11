import { Request, Response } from 'express'
import fs from 'fs/promises'

const sessionsPath = () => process.env.SESSIONS_MD_PATH || '/data/obsidian/logs/sessions.md'

export async function getSessionsHandler(req: Request, res: Response): Promise<void> {
  try {
    const content = await fs.readFile(sessionsPath(), 'utf8')
    const allLines = content.split('\n').filter(l => l.trim() !== '')
    const lines = allLines.slice(-20)
    res.json({ lines, total: allLines.length })
  } catch {
    res.status(500).json({ error: 'Failed to read sessions.md' })
  }
}
