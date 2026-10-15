import { useEffect, useRef, useState } from 'react'
import type {
  Attachment,
  Message,
  OutgoingAttachment,
} from '../lib/api'
import {
  AttachIcon,
  CameraIcon,
  CheckIcon,
  CloseIcon,
  CopyIcon,
  FileIcon,
  NoteIcon,
  RefreshIcon,
  StopIcon,
} from './Icons'
import Markdown from './Markdown'

interface ChatViewProps {
  messages: Message[]
  busy: boolean
  onSend: (text: string, attachments: OutgoingAttachment[]) => void
  onStop: () => void
  onRegenerate: () => void
  onSaveNote: (text: string) => void
}

const MAX_ATTACHMENTS = 6
const MAX_BYTES = 8 * 1024 * 1024

const STARTERS = [
  { label: '📖 Explain a topic', prompt: 'Explain a topic to me: ' },
  { label: '🎯 Quiz me', prompt: 'Quiz me on a topic I am learning. ' },
  { label: '📝 Help with homework', prompt: 'Help me with my homework: ' },
  { label: '💡 Study tips', prompt: 'Give me practical study tips.' },
]

interface PendingAttachment extends Attachment, OutgoingAttachment {
  id: string
  size: number
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export default function ChatView({
  messages,
  busy,
  onSend,
  onStop,
  onRegenerate,
  onSaveNote,
}: ChatViewProps) {
  const [input, setInput] = useState('')
  const [pending, setPending] = useState<PendingAttachment[]>([])
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<number | null>(null)
  const [saved, setSaved] = useState<number | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [input])

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const next: PendingAttachment[] = []
    let message = ''
    for (const file of Array.from(files)) {
      if (pending.length + next.length >= MAX_ATTACHMENTS) {
        message = `Up to ${MAX_ATTACHMENTS} attachments.`
        break
      }
      if (file.size > MAX_BYTES) {
        message = `"${file.name}" is larger than 8 MB.`
        continue
      }
      const url = await readAsDataUrl(file)
      next.push({
        id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
        name: file.name,
        mime_type: file.type || 'application/octet-stream',
        data: url,
        url,
        kind: file.type.startsWith('image/') ? 'image' : 'file',
        size: file.size,
      })
    }
    if (next.length) setPending((prev) => [...prev, ...next])
    setError(message)
    if (fileRef.current) fileRef.current.value = ''
    if (cameraRef.current) cameraRef.current.value = ''
  }

  function removePending(id: string) {
    setPending((prev) => prev.filter((item) => item.id !== id))
  }

  function submit() {
    const text = input.trim()
    if (busy || (!text && pending.length === 0)) return
    const outgoing: OutgoingAttachment[] = pending.map((item) => ({
      name: item.name,
      mime_type: item.mime_type,
      data: item.data,
      url: item.url,
      kind: item.kind,
    }))
    setInput('')
    setPending([])
    setError('')
    onSend(text, outgoing)
  }

  async function copy(index: number, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(index)
      setTimeout(
        () => setCopied((value) => (value === index ? null : value)),
        1500,
      )
    } catch {
      // clipboard unavailable
    }
  }

  function save(index: number, text: string) {
    onSaveNote(text)
    setSaved(index)
    setTimeout(
      () => setSaved((value) => (value === index ? null : value)),
      1500,
    )
  }

  const lastModelIndex = messages.reduce(
    (acc, message, index) => (message.role === 'model' ? index : acc),
    -1,
  )

  return (
    <div className="chat">
      <main className="messages">
        {messages.length === 0 && (
          <div className="empty">
            <img className="logo-mark large" src="/muri-logo.jpg" alt="" />
            <h2>Hi, I'm Muri</h2>
            <p className="empty-tag">Learn. Play. Grow.</p>
            <p className="empty-hint">
              Not sure where to start? Tap a suggestion below, or just type
              your question.
            </p>
            <div className="suggest-row">
              {STARTERS.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className="suggest-chip"
                  disabled={busy}
                  onClick={() => onSend(item.prompt, [])}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message, index) => {
          const streaming =
            busy &&
            index === messages.length - 1 &&
            message.role === 'model'
          return (
            <div key={index} className={`bubble-row ${message.role}`}>
              <div className={`bubble ${message.role}`}>
                {message.attachments && message.attachments.length > 0 && (
                  <div className="bubble-files">
                    {message.attachments.map((att, attIndex) =>
                      att.kind === 'image' ? (
                        <a
                          key={attIndex}
                          className="bubble-image"
                          href={att.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <img src={att.url} alt={att.name} />
                        </a>
                      ) : (
                        <a
                          key={attIndex}
                          className="bubble-file"
                          href={att.url}
                          download={att.name}
                        >
                          <FileIcon size={15} />
                          <span>{att.name}</span>
                        </a>
                      ),
                    )}
                  </div>
                )}
                {message.text ? (
                  message.role === 'model' ? (
                    <div className="bubble-text md-slot">
                      <Markdown text={message.text} />
                    </div>
                  ) : (
                    <div className="bubble-text">{message.text}</div>
                  )
                ) : (
                  streaming && <div className="bubble-text">…</div>
                )}
              </div>
              {!busy && message.text && (
                <div className="bubble-actions">
                  <button
                    type="button"
                    className="icon-btn tiny"
                    title="Copy"
                    onClick={() => void copy(index, message.text)}
                  >
                    {copied === index ? (
                      <CheckIcon size={14} />
                    ) : (
                      <CopyIcon size={14} />
                    )}
                  </button>
                  <button
                    type="button"
                    className="icon-btn tiny"
                    title="Save to notes"
                    onClick={() => save(index, message.text)}
                  >
                    {saved === index ? (
                      <CheckIcon size={14} />
                    ) : (
                      <NoteIcon size={14} />
                    )}
                  </button>
                  {index === lastModelIndex && (
                    <button
                      type="button"
                      className="icon-btn tiny"
                      title="Regenerate"
                      onClick={onRegenerate}
                    >
                      <RefreshIcon size={14} />
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
        <div ref={bottomRef} />
      </main>

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {pending.length > 0 && (
          <div className="attach-strip">
            {pending.map((item) => (
              <div key={item.id} className="attach-chip">
                {item.kind === 'image' ? (
                  <img src={item.url} alt={item.name} />
                ) : (
                  <span className="attach-file-icon">
                    <FileIcon size={16} />
                  </span>
                )}
                <span className="attach-name">{item.name}</span>
                <button
                  type="button"
                  className="attach-remove"
                  title="Remove"
                  onClick={() => removePending(item.id)}
                >
                  <CloseIcon size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {error && <p className="attach-error">{error}</p>}

        <div className="composer-row">
          <input
            ref={fileRef}
            type="file"
            className="hidden-input"
            multiple
            accept="image/*,application/pdf,text/*,.md,.json,.csv,.yaml,.yml,.log"
            onChange={(event) => void addFiles(event.target.files)}
          />
          <input
            ref={cameraRef}
            type="file"
            className="hidden-input"
            accept="image/*"
            capture="environment"
            onChange={(event) => void addFiles(event.target.files)}
          />
          <button
            type="button"
            className="icon-btn attach-btn"
            title="Attach files"
            aria-label="Attach files"
            onClick={() => fileRef.current?.click()}
          >
            <AttachIcon />
          </button>
          <button
            type="button"
            className="icon-btn attach-btn"
            title="Take a photo"
            aria-label="Take a photo"
            onClick={() => cameraRef.current?.click()}
          >
            <CameraIcon />
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            placeholder="Message Muri…"
            rows={1}
            autoComplete="off"
            enterKeyHint="send"
            aria-label="Message Muri"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submit()
              }
            }}
          />
          {busy ? (
            <button
              type="button"
              className="send-btn stop"
              onClick={onStop}
              title="Stop generating"
            >
              <StopIcon />
              <span>Stop</span>
            </button>
          ) : (
            <button
              type="submit"
              className="send-btn"
              disabled={input.trim() === '' && pending.length === 0}
            >
              Send
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
