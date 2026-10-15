import { useMemo, useState } from 'react'
import type { SessionSummary } from '../lib/api'
import { formatDate } from '../lib/format'
import {
  CheckIcon,
  CloseIcon,
  HistoryIcon,
  PinIcon,
  SearchIcon,
  TrashIcon,
} from './Icons'

interface HistoryViewProps {
  sessions: SessionSummary[]
  loading: boolean
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
  onTogglePin: (session: SessionSummary) => void
}

export default function HistoryView({
  sessions,
  loading,
  onOpen,
  onDelete,
  onRename,
  onTogglePin,
}: HistoryViewProps) {
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.preview.toLowerCase().includes(q),
    )
  }, [sessions, query])

  function startEdit(session: SessionSummary) {
    setEditingId(session.id)
    setDraft(session.title)
  }

  function commitEdit() {
    if (editingId) onRename(editingId, draft.trim())
    setEditingId(null)
  }

  return (
    <div className="view-pad">
      <header className="view-head">
        <div>
          <h2>History</h2>
          <p className="muted">
            {sessions.length} conversation{sessions.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="search-box">
          <SearchIcon size={16} />
          <input
            value={query}
            placeholder="Search prompts and titles"
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search history"
          />
        </div>
      </header>

      {loading && (
        <div className="loading-state" role="status">
          <span className="spinner" aria-hidden="true" />
          Loading history…
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="empty-state">
          <HistoryIcon size={40} />
          <p className="muted">
            {sessions.length === 0
              ? 'Nothing here yet. Chats you start will be saved here automatically.'
              : 'No matches for that search. Try different words.'}
          </p>
        </div>
      )}

      <ul className="history-list">
        {filtered.map((session) => (
          <li key={session.id} className="history-row">
            <div className="history-main">
              {editingId === session.id ? (
                <input
                  className="rename-input"
                  value={draft}
                  autoFocus
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitEdit()
                    if (event.key === 'Escape') setEditingId(null)
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="history-title"
                  onClick={() => onOpen(session.id)}
                >
                  {session.pinned && <PinIcon size={13} />}
                  {session.title}
                </button>
              )}
              {session.preview && (
                <p className="history-preview">{session.preview}</p>
              )}
              <span className="history-meta">
                {formatDate(session.updated_at)} · {session.message_count}{' '}
                messages
              </span>
            </div>

            <div className="history-actions">
              {editingId === session.id ? (
                <>
                  <button
                    type="button"
                    className="icon-btn tiny"
                    title="Save"
                    onClick={commitEdit}
                  >
                    <CheckIcon size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn tiny"
                    title="Cancel"
                    onClick={() => setEditingId(null)}
                  >
                    <CloseIcon size={15} />
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => startEdit(session)}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="icon-btn tiny"
                    title={session.pinned ? 'Unpin' : 'Pin'}
                    onClick={() => onTogglePin(session)}
                  >
                    <PinIcon size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn tiny danger"
                    title="Delete"
                    onClick={() => onDelete(session.id)}
                  >
                    <TrashIcon size={15} />
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
