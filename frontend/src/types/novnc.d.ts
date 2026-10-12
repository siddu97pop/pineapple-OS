// Minimal types for the parts of noVNC's RFB client that MacScreen uses.
declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, urlOrChannel: string | WebSocket, options?: { wsProtocols?: string[] })
    viewOnly: boolean
    scaleViewport: boolean
    resizeSession: boolean
    focusOnClick: boolean
    background: string
    sendCredentials(creds: { username?: string; password?: string }): void
    clipboardPasteFrom(text: string): void
    disconnect(): void
    focus(): void
  }
}

declare module 'novnc-logging' {
  export function initLogging(level?: 'debug' | 'info' | 'warn' | 'error' | 'none'): void
}
