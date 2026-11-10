import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getAdminOverview,
  type AdminOverview,
  type AuthUser,
} from '../lib/api'

interface AdminDashboardProps {
  user: AuthUser
  onLogout: () => void
}

function formatDate(value: string | null): string {
  if (!value) return 'Never'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString()
}

export default function AdminDashboard({
  user,
  onLogout,
}: AdminDashboardProps) {
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const refreshInProgress = useRef(false)
  const refreshGeneration = useRef(0)

  const refreshOverview = useCallback(async () => {
    if (refreshInProgress.current) return
    refreshInProgress.current = true
    const generation = ++refreshGeneration.current
    setRefreshing(true)
    setError('')
    try {
      const data = await getAdminOverview()
      if (generation === refreshGeneration.current) {
        setOverview(data)
        setLastUpdated(new Date().toISOString())
      }
    } catch (err: unknown) {
      if (generation === refreshGeneration.current) {
        setError(
          err instanceof Error ? err.message : 'Unable to load admin data.',
        )
      }
    } finally {
      if (generation === refreshGeneration.current) {
        refreshInProgress.current = false
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    const initialRefresh = window.setTimeout(
      () => void refreshOverview(),
      0,
    )
    const refresh = () => void refreshOverview()
    const interval = window.setInterval(refresh, 60_000)
    return () => {
      refreshGeneration.current += 1
      refreshInProgress.current = false
      window.clearTimeout(initialRefresh)
      window.clearInterval(interval)
    }
  }, [refreshOverview])

  return (
    <main className="admin-app">
      <div className="admin-content">
        <header className="view-head admin-head">
          <div>
            <p className="admin-eyebrow">MURI ADMINISTRATION</p>
            <h1>Welcome, Murillon</h1>
            <p className="muted">
              Signed in as {user.email}. This view contains account and model
              usage details only, not private chat messages.
            </p>
          </div>
          <div className="admin-actions">
            <span className="admin-updated" role="status">
              {lastUpdated
                ? `Updated ${formatDate(lastUpdated)} · refreshes every minute`
                : 'Refreshing every minute'}
            </span>
            <button
              type="button"
              className="primary-btn admin-refresh"
              onClick={() => void refreshOverview()}
              disabled={refreshing}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <button
              type="button"
              className="primary-btn admin-logout"
              onClick={onLogout}
            >
              Sign out
            </button>
          </div>
        </header>

        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}

        {!overview && !error && (
          <div className="loading-state" role="status">
            <span className="spinner" aria-hidden="true" />
            Loading system overview…
          </div>
        )}

        {overview && (
          <>
            <section className="stat-grid admin-stat-grid" aria-label="System totals">
              <div className="stat-card">
                <span className="stat-value">{overview.total_users}</span>
                <span className="stat-label">User accounts</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">{overview.total_sessions}</span>
                <span className="stat-label">Conversations</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">{overview.total_prompts}</span>
                <span className="stat-label">User prompts</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">{overview.total_model_calls}</span>
                <span className="stat-label">Successful model runs</span>
              </div>
            </section>

            <section className="panel admin-panel">
              <div className="panel-head">
                <h2>Models used</h2>
              </div>
              {overview.models.length === 0 ? (
                <p className="muted">No successful model runs recorded yet.</p>
              ) : (
                <ul className="admin-model-list">
                  {overview.models.map((item) => (
                    <li key={item.model}>
                      <span>{item.model}</span>
                      <strong>{item.count}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel admin-panel">
              <div className="panel-head">
                <h2>User accounts</h2>
                <span className="muted">{overview.users.length} accounts</span>
              </div>
              {overview.users.length === 0 ? (
                <p className="muted">No user accounts yet.</p>
              ) : (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Name / email</th>
                        <th>Sign-in</th>
                        <th>Created</th>
                        <th>Last active</th>
                        <th>Chats</th>
                        <th>Prompts</th>
                        <th>Selected model</th>
                        <th>Models used</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.users.map((account) => (
                        <tr key={account.id}>
                          <td>
                            <strong>{account.name || 'Muri user'}</strong>
                            <span className="admin-cell-sub">
                              {account.email || 'No email'}
                            </span>
                          </td>
                          <td>{account.provider}</td>
                          <td>{formatDate(account.created_at)}</td>
                          <td>{formatDate(account.last_active)}</td>
                          <td>{account.sessions}</td>
                          <td>{account.prompts}</td>
                          <td>{account.selected_model}</td>
                          <td>
                            {account.models_used.length > 0
                              ? account.models_used
                                  .map((item) => `${item.model} (${item.count})`)
                                  .join(', ')
                              : 'None yet'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  )
}
