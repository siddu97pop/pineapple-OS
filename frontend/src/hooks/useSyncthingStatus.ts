import { useState, useEffect } from 'react'
import { getSyncthing, type SyncthingData } from '../lib/api'

export function useSyncthingStatus() {
  const [status, setStatus] = useState<SyncthingData | null>(null)

  useEffect(() => {
    const fetchStatus = () => getSyncthing().then(setStatus).catch(() => {})
    fetchStatus()
    const id = setInterval(fetchStatus, 60000)
    return () => clearInterval(id)
  }, [])

  return status
}
