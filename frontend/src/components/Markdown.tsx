import type { ReactNode } from 'react'

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  // Escape first, then apply inline markdown on the escaped string.
  // Escaped entities contain no * ` [ ] characters, so this is safe.
  const safe = escapeHtml(text)
  const pattern =
    /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~|\[[^\]]+\]\((?:https?:\/\/|mailto:)[^)]+\)|\bhttps?:\/\/[^\s<]+)/g
  const nodes: ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  let i = 0
  const pushText = (chunk: string) => {
    if (chunk) nodes.push(<span key={`${keyPrefix}-t${i++}`}>{chunk}</span>)
  }
  // Render escaped chunk as plain text via dangerouslySetInnerHTML-free span:
  // React escapes strings automatically, so decode entities back by using
  // a temporary element-free approach: keep as string (already escaped for
  // our regex, but React will escape again). Instead work on raw text below.
  void pushText
  nodes.length = 0

  // Simpler + XSS-safe: work on raw text, build elements, let React escape.
  const raw = text
  last = 0
  i = 0
  while ((match = pattern.exec(raw)) !== null) {
    if (match.index > last) {
      nodes.push(
        <span key={`${keyPrefix}-p${i++}`}>{raw.slice(last, match.index)}</span>,
      )
    }
    const token = match[0]
    if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code key={`${keyPrefix}-c${i++}`} className="md-code">
          {token.slice(1, -1)}
        </code>,
      )
    } else if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(
        <strong key={`${keyPrefix}-b${i++}`}>
          {token.slice(2, -2)}
        </strong>,
      )
    } else if (token.startsWith('~~') && token.endsWith('~~')) {
      nodes.push(<del key={`${keyPrefix}-d${i++}`}>{token.slice(2, -2)}</del>)
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push(<em key={`${keyPrefix}-e${i++}`}>{token.slice(1, -1)}</em>)
    } else if (token.startsWith('[')) {
      const m = /\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)]+)\)/.exec(token)
      if (m) {
        nodes.push(
          <a
            key={`${keyPrefix}-a${i++}`}
            href={m[2]}
            target="_blank"
            rel="noreferrer noopener"
          >
            {m[1]}
          </a>,
        )
      } else {
        nodes.push(<span key={`${keyPrefix}-p${i++}`}>{token}</span>)
      }
    } else {
      nodes.push(
        <a
          key={`${keyPrefix}-u${i++}`}
          href={token}
          target="_blank"
          rel="noreferrer noopener"
        >
          {token}
        </a>,
      )
    }
    last = match.index + token.length
  }
  if (last < raw.length) {
    nodes.push(
      <span key={`${keyPrefix}-p${i++}`}>{raw.slice(last)}</span>,
    )
  }
  void safe
  return nodes
}

interface Block {
  type:
    | 'heading'
    | 'para'
    | 'ul'
    | 'ol'
    | 'quote'
    | 'code'
    | 'table'
    | 'hr'
  level?: number
  lines?: string[]
  items?: string[][]
  lang?: string
  text?: string
  rows?: string[][]
}

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    // fenced code
    const fence = /^```(\w*)\s*$/.exec(line.trim())
    if (fence) {
      const lang = fence[1] || ''
      const buf: string[] = []
      i++
      while (i < lines.length && lines[i].trim() !== '```') {
        buf.push(lines[i])
        i++
      }
      i++ // skip closing fence
      blocks.push({ type: 'code', lang, text: buf.join('\n') })
      continue
    }
    if (/^\s*---+\s*$/.test(line) || /^\s*\*\*\*+\s*$/.test(line)) {
      blocks.push({ type: 'hr' })
      i++
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        text: heading[2].trim(),
      })
      i++
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      blocks.push({ type: 'quote', lines: buf })
      continue
    }
    // table: header | --- | rows
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:|-]+\|?[\s:|-]*$/.test(lines[i + 1]) &&
      lines[i + 1].includes('-')
    ) {
      const header = line
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => c.trim())
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(
          lines[i]
            .trim()
            .replace(/^\||\|$/g, '')
            .split('|')
            .map((c) => c.trim()),
        )
        i++
      }
      blocks.push({ type: 'table', items: [header], rows })
      continue
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line)
      const items: string[][] = []
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        const cleaned = lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '')
        // support task list "- [ ]" / "- [x]"
        items.push([cleaned])
        i++
      }
      blocks.push({ type: ordered ? 'ol' : 'ul', items })
      continue
    }
    if (line.trim() === '') {
      i++
      continue
    }
    // paragraph: gather until blank or special block
    const buf: string[] = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,4}\s|```|>|\s*---+\s*)/.test(lines[i]) &&
      !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && lines[i + 1].includes('-'))
    ) {
      buf.push(lines[i])
      i++
    }
    blocks.push({ type: 'para', text: buf.join('\n') })
  }
  return blocks
}

export default function Markdown({ text }: { text: string }) {
  // Strip a leading "[error] ..." marker so backend errors render as alerts.
  const isError = text.startsWith('[error]')
  const body = isError ? text.replace(/^\[error\]\s*/, '') : text
  const blocks = parseBlocks(body)
  return (
    <div className={isError ? 'md md-error' : 'md'}>
      {blocks.map((block, bi) => {
        switch (block.type) {
          case 'heading': {
            const Tag = `h${Math.min(block.level ?? 2, 4)}` as 'h1'
            return (
              <Tag key={bi} className={`md-h${block.level}`}>
                {renderInline(block.text ?? '', `h${bi}`)}
              </Tag>
            )
          }
          case 'code':
            return (
              <div key={bi} className="md-pre-wrap">
                {block.lang && <div className="md-pre-lang">{block.lang}</div>}
                <pre className="md-pre">
                  <code>{block.text}</code>
                </pre>
              </div>
            )
          case 'quote':
            return (
              <blockquote key={bi} className="md-quote">
                {(block.lines ?? []).map((l, li) => (
                  <p key={li}>{renderInline(l, `q${bi}-${li}`)}</p>
                ))}
              </blockquote>
            )
          case 'ul':
            return (
              <ul key={bi} className="md-list">
                {(block.items ?? []).map((item, li) => {
                  const task = /^\[( |x|X)\]\s*(.*)$/.exec(item[0])
                  if (task) {
                    return (
                      <li key={li} className="md-task">
                        <input
                          type="checkbox"
                          checked={task[1].toLowerCase() === 'x'}
                          readOnly
                          tabIndex={-1}
                        />
                        <span>{renderInline(task[2], `u${bi}-${li}`)}</span>
                      </li>
                    )
                  }
                  return (
                    <li key={li}>{renderInline(item[0], `u${bi}-${li}`)}</li>
                  )
                })}
              </ul>
            )
          case 'ol':
            return (
              <ol key={bi} className="md-list md-ordered">
                {(block.items ?? []).map((item, li) => (
                  <li key={li}>{renderInline(item[0], `o${bi}-${li}`)}</li>
                ))}
              </ol>
            )
          case 'table':
            return (
              <div key={bi} className="md-table-wrap">
                <table className="md-table">
                  <thead>
                    <tr>
                      {(block.items?.[0] ?? []).map((cell, ci) => (
                        <th key={ci}>{renderInline(cell, `th${bi}-${ci}`)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(block.rows ?? []).map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td key={ci}>{renderInline(cell, `td${bi}-${ri}-${ci}`)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          case 'hr':
            return <hr key={bi} className="md-hr" />
          default: {
            // paragraph: hard line breaks become <br/>
            const parts = (block.text ?? '').split('\n')
            return (
              <p key={bi} className="md-p">
                {parts.map((part, pi) => (
                  <span key={pi}>
                    {pi > 0 && <br />}
                    {renderInline(part, `p${bi}-${pi}`)}
                  </span>
                ))}
              </p>
            )
          }
        }
      })}
    </div>
  )
}
