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
    const fetchStatus = () => getStatus().then(setStatus).catch(() => {})
    fetchStatus()
    const id = setInterval(fetchStatus, 30000)
    return () => clearInterval(id)
  }, [])

  return status
}
