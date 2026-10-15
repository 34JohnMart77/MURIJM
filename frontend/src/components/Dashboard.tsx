import type { LearnProfile, Stats } from '../lib/api'
import { relativeTime, weekday } from '../lib/format'
import { CertificateIcon, FlameIcon, StarIcon, TrophyIcon } from './Icons'

interface DashboardProps {
  stats: Stats | null
  loading: boolean
  profile: LearnProfile | null
  userName: string | null
  onOpenSession: (id: string) => void
  onViewHistory: () => void
  onViewAchievements: () => void
  onStartChat: () => void
}

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function Dashboard({
  stats,
  loading,
  profile,
  userName,
  onOpenSession,
  onViewHistory,
  onViewAchievements,
  onStartChat,
}: DashboardProps) {
  if (loading && !stats) {
    return (
      <div className="view-pad">
        <div className="loading-state" role="status">
          <span className="spinner" aria-hidden="true" />
          Loading your dashboard…
        </div>
      </div>
    )
  }

  const data: Stats =
    stats ?? {
      total_sessions: 0,
      total_messages: 0,
      user_messages: 0,
      model_messages: 0,
      sessions_today: 0,
      messages_today: 0,
      activity: [],
      recent: [],
    }

  const max = Math.max(1, ...data.activity.map((point) => point.count))

  const cards = [
    { label: 'Conversations', value: data.total_sessions },
    { label: 'Messages', value: data.total_messages },
    { label: 'Messages today', value: data.messages_today },
    { label: 'New today', value: data.sessions_today },
  ]

  return (
    <div className="view-pad">
      <header className="view-head">
        <div>
          <h2>
            {greeting()}
            {userName ? `, ${userName}` : ''} 👋
          </h2>
          <p className="muted">Your Muri activity at a glance.</p>
        </div>
      </header>

      {data.total_sessions === 0 && (
        <section className="panel welcome-banner">
          <h3>Welcome to Muri! 🎉</h3>
          <p className="muted">
            Start a chat to ask anything, pick a short lesson, or try a quick
            game — every step earns points and grows your streak.
          </p>
          <div className="welcome-actions">
            <button
              type="button"
              className="primary-btn"
              onClick={onStartChat}
            >
              Start your first chat
            </button>
          </div>
        </section>
      )}

      {profile && (
        <section className="panel learning-banner">
          <div className="learning-banner-row">
            <div className="learning-chip">
              <FlameIcon size={20} />
              <span>
                <strong>{profile.streak.current}</strong> day streak
              </span>
            </div>
            <div className="learning-chip">
              <StarIcon size={20} />
              <span>
                <strong>{profile.points}</strong> points
              </span>
            </div>
            <div className="learning-chip">
              <TrophyIcon size={20} />
              <span>
                <strong>{profile.badges.earned.length}</strong> badges
              </span>
            </div>
            <div className="learning-chip">
              <CertificateIcon size={20} />
              <span>
                <strong>{profile.certificates}</strong> certificates
              </span>
            </div>
          </div>
          <div className="learning-banner-foot">
            <span className="muted">
              Goal: {profile.goal ?? 'Not set'} · {profile.daily_minutes} min/day
            </span>
            <button
              type="button"
              className="link-btn"
              onClick={onViewAchievements}
            >
              View achievements
            </button>
          </div>
        </section>
      )}

      <div className="stat-grid">
        {cards.map((card) => (
          <div key={card.label} className="stat-card">
            <span className="stat-value">{card.value}</span>
            <span className="stat-label">{card.label}</span>
          </div>
        ))}
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>Last 7 days</h3>
          <span className="muted">
            {data.user_messages} prompts · {data.model_messages} replies
          </span>
        </div>
        <div className="chart">
          {data.activity.map((point) => (
            <div key={point.date} className="chart-col">
              <div className="chart-track">
                <div
                  className="chart-bar"
                  style={{ height: `${(point.count / max) * 100}%` }}
                  title={`${point.count} messages`}
                />
              </div>
              <span className="chart-label">{weekday(point.date)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Recent chats</h3>
          <button type="button" className="link-btn" onClick={onViewHistory}>
            View all
          </button>
        </div>
        {data.recent.length === 0 ? (
          <p className="muted">
            No conversations yet. Your recent chats will appear here.
          </p>
        ) : (
          <ul className="recent-list">
            {data.recent.map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  className="recent-item"
                  onClick={() => onOpenSession(session.id)}
                >
                  <span className="recent-title">{session.title}</span>
                  <span className="recent-meta">
                    {session.message_count} msg ·{' '}
                    {relativeTime(session.updated_at)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
