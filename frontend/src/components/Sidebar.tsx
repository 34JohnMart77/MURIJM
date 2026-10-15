import { useMemo, useState } from 'react'
import type { AuthUser, SessionSummary, Theme, View } from '../lib/api'
import { relativeTime } from '../lib/format'
import {
  BookIcon,
  ChatIcon,
  CloseIcon,
  DashboardIcon,
  FlameIcon,
  GamepadIcon,
  HistoryIcon,
  LogoutIcon,
  MoonIcon,
  NoteIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  StarIcon,
  SunIcon,
  TrashIcon,
  TrophyIcon,
} from './Icons'

interface SidebarProps {
  sessions: SessionSummary[]
  currentId: string | null
  view: View
  open: boolean
  theme: Theme
  user: AuthUser | null
  streak: number
  points: number
  onNavigate: (view: View) => void
  onNewChat: () => void
  onSelectSession: (id: string) => void
  onDeleteSession: (id: string) => void
  onTogglePin: (session: SessionSummary) => void
  onToggleTheme: () => void
  onLogout: () => void
  onClose: () => void
}

const NAV_GROUPS: { label: string; items: { id: View; label: string; hint: string; icon: typeof ChatIcon }[] }[] = [
  {
    label: 'Workspace',
    items: [
      { id: 'chat', label: 'Chat', hint: 'Talk to Muri', icon: ChatIcon },
      { id: 'dashboard', label: 'Dashboard', hint: 'Your activity', icon: DashboardIcon },
      { id: 'history', label: 'History', hint: 'Past conversations', icon: HistoryIcon },
      { id: 'settings', label: 'Settings', hint: 'Model and appearance', icon: SettingsIcon },
    ],
  },
  {
    label: 'Learn & Play',
    items: [
      { id: 'learn', label: 'Learn', hint: 'Courses and lessons', icon: BookIcon },
      { id: 'games', label: 'Games', hint: 'Quizzes and points', icon: GamepadIcon },
      { id: 'notes', label: 'Notes', hint: 'Saved highlights', icon: NoteIcon },
      { id: 'achievements', label: 'Achievements', hint: 'Badges and streaks', icon: TrophyIcon },
    ],
  },
]

export default function Sidebar({
  sessions,
  currentId,
  view,
  open,
  theme,
  user,
  streak,
  points,
  onNavigate,
  onNewChat,
  onSelectSession,
  onDeleteSession,
  onTogglePin,
  onToggleTheme,
  onLogout,
  onClose,
}: SidebarProps) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.preview.toLowerCase().includes(q),
    )
  }, [sessions, query])

  return (
    <>
      <div
        className={`sidebar-scrim ${open ? 'show' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-head">
          <button
            type="button"
            className="brand"
            onClick={() => onNavigate('learn')}
          >
            <img className="logo-mark" src="/muri-logo.jpg" alt="" />
            <span className="brand-text">
              <span className="brand-name">Muri</span>
              <span className="brand-tag">Learn. Play. Grow.</span>
            </span>
          </button>
          <button
            type="button"
            className="icon-btn drawer-close"
            onClick={onClose}
            aria-label="Close menu"
          >
            <CloseIcon />
          </button>
        </div>

        <button type="button" className="new-chat" onClick={onNewChat}>
          <PlusIcon />
          New chat
        </button>

        <div className="sidebar-stats">
          <button
            type="button"
            className="sidebar-stat"
            onClick={() => onNavigate('achievements')}
            title="Your streak"
          >
            <FlameIcon size={16} />
            <span className="sidebar-stat-value">{streak}</span>
            <span className="sidebar-stat-label">day streak</span>
          </button>
          <button
            type="button"
            className="sidebar-stat"
            onClick={() => onNavigate('achievements')}
            title="Your points"
          >
            <StarIcon size={16} />
            <span className="sidebar-stat-value">{points}</span>
            <span className="sidebar-stat-label">points</span>
          </button>
        </div>

        {NAV_GROUPS.map((group) => (
          <nav key={group.label} className="nav" aria-label={group.label}>
            <span className="section-label">{group.label}</span>
            {group.items.map((item) => {
              const ItemIcon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`nav-item ${view === item.id ? 'active' : ''}`}
                  title={item.hint}
                  onClick={() => onNavigate(item.id)}
                >
                  <ItemIcon />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </nav>
        ))}

        <div className="sidebar-section">
          <span className="section-label">Recent</span>
          <div className="sidebar-search">
            <SearchIcon size={15} />
            <input
              value={query}
              placeholder="Search chats"
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search chats"
            />
          </div>
        </div>

        <div className="session-list">
          {filtered.length === 0 && (
            <p className="session-empty">
              {sessions.length === 0
                ? 'No chats yet. Press New chat to begin.'
                : 'No matches. Try different words.'}
            </p>
          )}
          {filtered.map((session) => (
            <div
              key={session.id}
              className={`session-item ${
                session.id === currentId && view === 'chat' ? 'active' : ''
              }`}
            >
              <button
                type="button"
                className="session-main"
                onClick={() => onSelectSession(session.id)}
              >
                <span className="session-title">
                  {session.pinned && <PinIcon size={13} />}
                  {session.title}
                </span>
                <span className="session-meta">
                  {relativeTime(session.updated_at)} · {session.message_count}{' '}
                  msg
                </span>
              </button>
              <div className="session-actions">
                <button
                  type="button"
                  className="icon-btn tiny"
                  title={session.pinned ? 'Unpin' : 'Pin'}
                  onClick={(event) => {
                    event.stopPropagation()
                    onTogglePin(session)
                  }}
                >
                  <PinIcon size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn tiny danger"
                  title="Delete"
                  onClick={(event) => {
                    event.stopPropagation()
                    onDeleteSession(session.id)
                  }}
                >
                  <TrashIcon size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="sidebar-foot">
          <div className="user-row">
            {user?.avatar_url ? (
              <img className="user-avatar" src={user.avatar_url} alt="" />
            ) : (
              <span className="user-avatar">
                {(user?.name || user?.email || 'M').charAt(0).toUpperCase()}
              </span>
            )}
            <span className="user-name">
              {user?.name || user?.email || 'Account'}
            </span>
            <button
              type="button"
              className="icon-btn tiny"
              title="Log out"
              aria-label="Log out"
              onClick={onLogout}
            >
              <LogoutIcon />
            </button>
          </div>
          <div className="sidebar-foot-row">
            <button
              type="button"
              className="theme-toggle"
              onClick={onToggleTheme}
            >
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
              <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
            </button>
            <span className="version">Muri v1.2</span>
          </div>
        </div>
      </aside>
    </>
  )
}
