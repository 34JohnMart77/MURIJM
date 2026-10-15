import { useCallback, useEffect, useState } from 'react'
import {
  createNote,
  deleteNote,
  listNotes,
  updateNote,
  type BadgeDef,
  type Note,
} from '../lib/api'
import { relativeTime } from '../lib/format'
import {
  CheckIcon,
  NoteIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from './Icons'

interface NotesViewProps {
  onEarned: (badges: BadgeDef[]) => void
  onProgress: () => void
}

interface Draft {
  id: string | null
  title: string
  content: string
  tags: string
}

const EMPTY_DRAFT: Draft = { id: null, title: '', content: '', tags: '' }

export default function NotesView({ onEarned, onProgress }: NotesViewProps) {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (q?: string) => {
    try {
      const data = await listNotes(q)
      setNotes(data.notes)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const handle = setTimeout(() => void load(query), 250)
    return () => clearTimeout(handle)
  }, [query, load])

  async function save() {
    if (!draft || busy) return
    const title = draft.title.trim()
    const content = draft.content.trim()
    if (!title && !content) return
    setBusy(true)
    try {
      if (draft.id) {
        const result = await updateNote(draft.id, {
          title,
          content,
          tags: draft.tags.trim(),
        })
        setNotes((prev) =>
          prev.map((note) => (note.id === result.note.id ? result.note : note)),
        )
      } else {
        const result = await createNote({
          title,
          content,
          tags: draft.tags.trim(),
        })
        setNotes((prev) => [result.note, ...prev])
        if (result.new_badges.length) onEarned(result.new_badges)
        onProgress()
      }
      setDraft(null)
    } catch {
      // ignore
    } finally {
      setBusy(false)
    }
  }

  async function togglePin(note: Note) {
    try {
      const result = await updateNote(note.id, { pinned: !note.pinned })
      setNotes((prev) =>
        prev
          .map((item) => (item.id === note.id ? result.note : item))
          .sort((a, b) => Number(b.pinned) - Number(a.pinned)),
      )
    } catch {
      // ignore
    }
  }

  async function remove(note: Note) {
    if (!window.confirm('Delete this note?')) return
    try {
      await deleteNote(note.id)
      setNotes((prev) => prev.filter((item) => item.id !== note.id))
    } catch {
      // ignore
    }
  }

  return (
    <div className="view-pad">
      <header className="view-head">
        <div>
          <h2>Notes &amp; saves</h2>
          <p className="muted">
            Keep highlights, formulas and ideas in one place.
          </p>
        </div>
        <div className="view-head-actions">
          <div className="search-box">
            <SearchIcon size={16} />
            <input
              value={query}
              placeholder="Search notes"
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search notes"
            />
          </div>
          <button
            type="button"
            className="primary-btn"
            onClick={() =>
              setDraft({ ...EMPTY_DRAFT, id: null })
            }
          >
            <PlusIcon size={16} /> New note
          </button>
        </div>
      </header>

      {draft && (
        <section className="panel note-editor">
          <input
            className="field"
            placeholder="Title"
            value={draft.title}
            maxLength={160}
            onChange={(event) =>
              setDraft({ ...draft, title: event.target.value })
            }
          />
          <textarea
            className="field"
            placeholder="Write your note…"
            rows={6}
            value={draft.content}
            onChange={(event) =>
              setDraft({ ...draft, content: event.target.value })
            }
          />
          <input
            className="field"
            placeholder="Tags (comma separated)"
            value={draft.tags}
            onChange={(event) =>
              setDraft({ ...draft, tags: event.target.value })
            }
          />
          <div className="settings-actions">
            <button
              type="button"
              className="text-btn"
              onClick={() => setDraft(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary-btn"
              disabled={busy}
              onClick={() => void save()}
            >
              <CheckIcon size={16} /> Save note
            </button>
          </div>
        </section>
      )}

      {loading && (
        <div className="loading-state" role="status">
          <span className="spinner" aria-hidden="true" />
          Loading your notes…
        </div>
      )}

      {!loading && notes.length === 0 && !draft && (
        <div className="empty-state">
          <NoteIcon size={40} />
          <p className="muted">
            No notes yet. Save one from a chat or start a new note.
          </p>
        </div>
      )}

      <div className="note-grid">
        {notes.map((note) => (
          <article key={note.id} className="note-card">
            <div className="note-card-head">
              <h3>
                {note.pinned && <PinIcon size={13} />}
                {note.title}
              </h3>
              <div className="note-actions">
                <button
                  type="button"
                  className="icon-btn tiny"
                  title={note.pinned ? 'Unpin' : 'Pin'}
                  onClick={() => void togglePin(note)}
                >
                  <PinIcon size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn tiny"
                  title="Edit"
                  onClick={() =>
                    setDraft({
                      id: note.id,
                      title: note.title,
                      content: note.content,
                      tags: note.tags ?? '',
                    })
                  }
                >
                  <NoteIcon size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn tiny danger"
                  title="Delete"
                  onClick={() => void remove(note)}
                >
                  <TrashIcon size={14} />
                </button>
              </div>
            </div>
            <p className="note-content">{note.content}</p>
            <div className="note-foot">
              {note.tags && <span className="pill">{note.tags}</span>}
              <span className="muted">{relativeTime(note.updated_at)}</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
