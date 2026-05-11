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
