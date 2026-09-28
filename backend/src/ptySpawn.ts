import fs from 'fs'
import { IPty, IPtyForkOptions, spawn } from 'node-pty'

const SYSTEMD_RUN = '/usr/bin/systemd-run'
const PTY_SCOPE_ENABLED = process.env.PTY_SCOPE_ENABLED !== 'false'
  && process.platform === 'linux'
  && fs.existsSync(SYSTEMD_RUN)
const PTY_MEMORY_MAX = process.env.PTY_MEMORY_MAX || '1G'
const PTY_TASKS_MAX = process.env.PTY_TASKS_MAX || '256'

export function spawnPty(sessionId: string, options: IPtyForkOptions): IPty {
  if (!PTY_SCOPE_ENABLED) {
    return spawn('/bin/bash', [], options)
  }

  const unit = `pineapple-pty-${sessionId}`
  return spawn(SYSTEMD_RUN, [
    '--scope',
    '--quiet',
    `--unit=${unit}`,
    `--property=MemoryMax=${PTY_MEMORY_MAX}`,
    `--property=TasksMax=${PTY_TASKS_MAX}`,
    '/bin/bash',
  ], options)
}

export function ptyScopeConfig(): { enabled: boolean; memoryMax: string; tasksMax: string } {
  return {
    enabled: PTY_SCOPE_ENABLED,
    memoryMax: PTY_MEMORY_MAX,
    tasksMax: PTY_TASKS_MAX,
  }
}
