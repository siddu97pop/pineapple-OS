import fs from 'fs'
import { IPty, IPtyForkOptions, spawn } from 'node-pty'

const SYSTEMD_RUN = '/usr/bin/systemd-run'
const PTY_SCOPE_ENABLED = process.env.PTY_SCOPE_ENABLED !== 'false'
  && process.platform === 'linux'
  && fs.existsSync(SYSTEMD_RUN)
const PTY_MEMORY_MAX = process.env.PTY_MEMORY_MAX || '1G'
const PTY_TASKS_MAX = process.env.PTY_TASKS_MAX || '256'
// macOS ships bash 3.2 (with a "default shell is now zsh" banner), so use a
// zsh login shell there; Linux keeps bash.
const SHELL_CMD = process.platform === 'darwin' ? ['/bin/zsh', '-l'] : ['/bin/bash']

export function spawnPty(sessionId: string, options: IPtyForkOptions): IPty {
  if (!PTY_SCOPE_ENABLED) {
    return spawn(SHELL_CMD[0], SHELL_CMD.slice(1), { ...options, env: { ...options.env, SHELL: SHELL_CMD[0] } })
  }

  const unit = `pineapple-pty-${sessionId}`
  return spawn(SYSTEMD_RUN, [
    '--scope',
    '--quiet',
    `--unit=${unit}`,
    `--property=MemoryMax=${PTY_MEMORY_MAX}`,
    `--property=TasksMax=${PTY_TASKS_MAX}`,
    ...SHELL_CMD,
  ], options)
}

export function ptyScopeConfig(): { enabled: boolean; memoryMax: string; tasksMax: string } {
  return {
    enabled: PTY_SCOPE_ENABLED,
    memoryMax: PTY_MEMORY_MAX,
    tasksMax: PTY_TASKS_MAX,
  }
}
