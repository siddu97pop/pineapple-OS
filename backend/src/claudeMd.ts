import { Request, Response } from 'express'
import fs from 'fs/promises'
import 'dotenv/config'

const claudeMdPath = () => process.env.CLAUDE_MD_PATH || '/data/obsidian/CLAUDE.md'

export async function getClaudeMdHandler(req: Request, res: Response): Promise<void> {
  try {
    const content = await fs.readFile(claudeMdPath(), 'utf8')
    res.json({ content })
  } catch {
    res.status(500).json({ error: 'Failed to read CLAUDE.md' })
  }
}

export async function saveClaudeMdHandler(req: Request, res: Response): Promise<void> {
  const { content } = req.body
  if (typeof content !== 'string') {
    res.status(400).json({ error: 'content must be a string' })
    return
  }
  try {
    await fs.writeFile(claudeMdPath(), content, 'utf8')
    res.json({ ok: true, saved_at: new Date().toISOString() })
  } catch {
    res.status(500).json({ error: 'Failed to write CLAUDE.md' })
  }
}
