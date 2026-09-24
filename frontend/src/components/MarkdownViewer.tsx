import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getVaultGraph, getVaultNotes } from '../lib/api'

// ---------------------------------------------------------------- wikilink index

// Lowercased basename / path / path-without-.md → vault path, from every note
// in the vault. Falls back to the (narrower) graph if the notes endpoint fails.
let linkIndexPromise: Promise<Map<string, string>> | null = null

function loadLinkIndex(): Promise<Map<string, string>> {
  if (!linkIndexPromise) {
    linkIndexPromise = getVaultNotes()
      .then(d => d.paths)
      .catch(() => getVaultGraph().then(g => (g.nodes ?? []).map(n => n.id)))
      .then(paths => {
        const map = new Map<string, string>()
        for (const p of paths) {
          const id = p.toLowerCase()
          const base = id.split('/').pop()!.replace(/\.md$/, '')
          const prev = map.get(base)
          if (!prev || p.length < prev.length) map.set(base, p)
          map.set(id, p)
          map.set(id.replace(/\.md$/, ''), p)
        }
        return map
      })
      .catch(() => {
        linkIndexPromise = null
        return new Map<string, string>()
      })
  }
  return linkIndexPromise
}

function resolveWikilink(index: Map<string, string>, raw: string): string | null {
  const cleaned = raw.split('#')[0].trim().toLowerCase()
  if (!cleaned) return null
  return index.get(cleaned) ?? index.get(cleaned.split('/').pop() ?? cleaned) ?? null
}

// ---------------------------------------------------------------- frontmatter

interface Frontmatter {
  entries: [string, string[]][]
  body: string
}

function splitFrontmatter(content: string): Frontmatter {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return { entries: [], body: content }

  const entries: [string, string[]][] = []
  for (const line of m[1].split(/\r?\n/)) {
    const item = line.match(/^\s+-\s+(.*)$/)
    if (item && entries.length > 0) {
      entries[entries.length - 1][1].push(unquote(item[1]))
      continue
    }
    const kv = line.match(/^([\w-]+):\s*(.*)$/)
    if (!kv) continue
    const value = kv[2].trim()
    const values = value.startsWith('[') && value.endsWith(']')
      ? value.slice(1, -1).split(',').map(unquote).filter(Boolean)
      : value ? [unquote(value)] : []
    entries.push([kv[1], values])
  }
  return { entries, body: content.slice(m[0].length) }
}

function unquote(s: string): string {
  return s.trim().replace(/^["']|["']$/g, '')
}

// ---------------------------------------------------------------- wikilink → markdown link

// Rewrites [[target|alias]] and ![[embed]] into markdown links with a
// `wikilink:` URL, skipping fenced and inline code.
function rewriteWikilinks(body: string): string {
  return body
    .split(/(^```[\s\S]*?^```|`[^`\n]*`)/m)
    .map((part, i) => {
      if (i % 2 === 1) return part
      return part.replace(/(!?)\[\[([^\]\n]+?)\]\]/g, (_, bang: string, inner: string) => {
        const [target, alias] = inner.split('|')
        const text = (alias ?? target).trim().replace(/[[\]]/g, '')
        const label = bang ? `↪ ${text}` : text
        return `[${label}](wikilink:${encodeURIComponent(target.trim())})`
      })
    })
    .join('')
}

function urlTransform(url: string): string {
  return url.startsWith('wikilink:') ? url : defaultUrlTransform(url)
}

// ---------------------------------------------------------------- callouts

// Rehype plugin: a blockquote whose first line is `[!type] Title` becomes a
// callout. Marks the element and strips the marker so the title renders clean.
type HastNode = { type: string; tagName?: string; value?: string; children?: HastNode[]; properties?: Record<string, unknown> }

function rehypeCallouts() {
  const walk = (node: HastNode) => {
    if (node.type === 'element' && node.tagName === 'blockquote') {
      const p = node.children?.find(c => c.type === 'element')
      const first = p?.tagName === 'p' ? p.children?.[0] : undefined
      const m = first?.type === 'text' ? first.value?.match(/^\[!(\w+)\][+-]?[ \t]*([^\n]*)\n?/) : null
      if (m && first) {
        first.value = first.value!.slice(m[0].length)
        const type = m[1].toLowerCase()
        node.properties = { ...node.properties, dataCallout: type, dataCalloutTitle: m[2] || type[0].toUpperCase() + type.slice(1) }
      }
    }
    node.children?.forEach(walk)
  }
  return (tree: HastNode) => walk(tree)
}

const CALLOUT_TONE: Record<string, string> = {
  warning: 'warning', caution: 'warning', attention: 'warning',
  danger: 'error', error: 'error', bug: 'error', failure: 'error',
  success: 'success', check: 'success', done: 'success', tip: 'success',
}

// ---------------------------------------------------------------- component

interface MarkdownViewerProps {
  path: string
  content: string
  onOpenNote: (path: string) => void
  className?: string
}

export function MarkdownViewer({ path, content, onOpenNote, className = '' }: MarkdownViewerProps) {
  const isMarkdown = /\.md$/i.test(path)
  const [mode, setMode] = useState<'rendered' | 'source'>('rendered')
  const [linkIndex, setLinkIndex] = useState<Map<string, string> | null>(null)

  useEffect(() => {
    if (!isMarkdown) return
    let alive = true
    loadLinkIndex().then(idx => { if (alive) setLinkIndex(idx) })
    return () => { alive = false }
  }, [isMarkdown])

  const { entries, body } = useMemo(() => splitFrontmatter(content), [content])
  const markdown = useMemo(() => rewriteWikilinks(body), [body])

  const components = useMemo<Components>(() => ({
    a: ({ href = '', children }) => {
      if (href.startsWith('wikilink:')) {
        const target = decodeURIComponent(href.slice('wikilink:'.length))
        const resolved = linkIndex ? resolveWikilink(linkIndex, target) : null
        if (!resolved) {
          return <span className="md-wikilink md-wikilink-missing" title={`${target} — not found`}>{children}</span>
        }
        return (
          <button type="button" className="md-wikilink" title={resolved} onClick={() => onOpenNote(resolved)}>
            {children}
          </button>
        )
      }
      if (/^https?:|^mailto:/i.test(href)) {
        return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
      }
      if (href.startsWith('#')) return <a href={href}>{children}</a>
      // Relative vault link, e.g. [notes](../other.md)
      const target = resolveRelative(path, decodeURIComponent(href.split('#')[0]))
      return (
        <button type="button" className="md-wikilink" title={target} onClick={() => onOpenNote(target)}>
          {children}
        </button>
      )
    },
    // Vault images aren't served by the API — show a placeholder instead of a broken <img>.
    img: ({ src = '', alt = '' }) =>
      /^https:/i.test(src)
        ? <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" />
        : <span className="md-image-missing" title={src}>🖼 {alt || src.split('/').pop()}</span>,
    blockquote: ({ node, children, ...rest }) => {
      const props = node?.properties as Record<string, unknown> | undefined
      const type = props?.dataCallout as string | undefined
      if (!type) return <blockquote {...rest}>{children}</blockquote>
      return (
        <div className="md-callout" data-tone={CALLOUT_TONE[type] ?? 'accent'}>
          <div className="md-callout-title">{String(props?.dataCalloutTitle)}</div>
          {children}
        </div>
      )
    },
    pre: ({ children }) => <pre className="md-pre">{children}</pre>,
  }), [linkIndex, onOpenNote, path])

  if (!isMarkdown) {
    return (
      <pre className={`md-source overflow-auto p-4 ${className}`}>{content}</pre>
    )
  }

  return (
    <div className={`relative flex flex-col min-h-0 ${className}`}>
      <div className="absolute top-2 right-3 z-10 flex rounded-md overflow-hidden" style={{ border: '1px solid rgb(var(--c-border))', background: 'rgb(var(--c-surface))' }} role="group" aria-label="View mode">
        {(['rendered', 'source'] as const).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className="px-2 py-0.5 text-[10px] font-mono capitalize transition-colors"
            style={{
              background: mode === m ? 'rgb(var(--c-accent) / 0.16)' : 'transparent',
              color: mode === m ? 'rgb(var(--c-text))' : 'rgb(var(--c-faint))',
            }}
          >
            {m}
          </button>
        ))}
      </div>

      {mode === 'source' ? (
        <pre className="md-source flex-1 overflow-auto p-4 pt-10">{content}</pre>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <article className="md-prose px-5 pt-10 pb-8">
            {entries.length > 0 && (
              <dl className="md-props">
                {entries.map(([k, vals]) => (
                  <div key={k} className="md-prop">
                    <dt>{k}</dt>
                    <dd>
                      {vals.length === 0
                        ? <span className="md-prop-empty">—</span>
                        : vals.map((v, i) => <span key={i} className="md-chip">{v}</span>)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeCallouts]}
              urlTransform={urlTransform}
              components={components}
            >
              {markdown}
            </ReactMarkdown>
          </article>
        </div>
      )}
    </div>
  )
}

function resolveRelative(fromPath: string, href: string): string {
  const parts = fromPath.split('/').slice(0, -1)
  for (const seg of href.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}
