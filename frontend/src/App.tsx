import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import Sidebar from './components/Sidebar'
import ChatView from './components/ChatView'
import Dashboard from './components/Dashboard'
import HistoryView from './components/HistoryView'
import SettingsView from './components/SettingsView'
import AuthScreen from './components/AuthScreen'
import LearnView from './components/LearnView'
import GamesView from './components/GamesView'
import NotesView from './components/NotesView'
import AchievementsView from './components/AchievementsView'
import OnboardingModal from './components/OnboardingModal'
import DesktopLayout from './components/DesktopLayout'
import MobileLayout from './components/MobileLayout'
import { useIsMobile } from './hooks/useIsMobile'
import { DownloadIcon, MenuIcon, SparklesIcon } from './components/Icons'
import {
  clearAllSessions,
  completeOnboarding,
  createNote,
  createSession,
  deleteSession as deleteSessionApi,
  getHistory,
  getLearnProfile,
  getMe,
  getModels,
  getProviders,
  getSettings,
  getStats,
  listSessions,
  logout,
  saveSettings as saveSettingsApi,
  streamChat,
  updateSession,
  type AppSettings,
  type AuthUser,
  type BadgeDef,
  type LearnProfile,
  type Message,
  type OutgoingAttachment,
  type Providers,
  type SessionSummary,
  type Stats,
  type Theme,
  type View,
} from './lib/api'

const SESSION_KEY = 'muri.sessionId'
const THEME_KEY = 'muri.theme'

function readTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY)
  return saved === 'light' || saved === 'dark' || saved === 'system'
    ? saved
    : 'system'
}

function updateLastText(messages: Message[], delta: string): Message[] {
  const next = messages.slice()
  const last = next[next.length - 1]
  if (last && last.role === 'model') {
    next[next.length - 1] = { ...last, text: last.text + delta }
  }
  return next
}

function newId(): string {
  return crypto.randomUUID()
}

function App() {
  const [view, setView] = useState<View>('chat')
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [busy, setBusy] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>(readTheme)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [loadingStats, setLoadingStats] = useState(true)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [providers, setProviders] = useState<Providers>({
    google: false,
    facebook: false,
  })
  const [profile, setProfile] = useState<LearnProfile | null>(null)
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [earned, setEarned] = useState<BadgeDef[]>([])
  const [toast, setToast] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const isMobile = useIsMobile()

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  useEffect(() => {
    let active = true
    async function checkSession() {
      try {
        const [me, prov] = await Promise.all([getMe(), getProviders()])
        if (active) {
          setUser(me)
          setProviders(prov)
        }
      } catch {
        if (active) setUser(null)
      } finally {
        if (active) setAuthLoading(false)
      }
    }
    void checkSession()
    return () => {
      active = false
    }
  }, [])

  const refreshSessions = useCallback(async () => {
    try {
      const data = await listSessions()
      setSessions(data.sessions)
    } catch {
      // ignore transient failures
    } finally {
      setLoadingSessions(false)
    }
  }, [])

  const refreshStats = useCallback(async () => {
    try {
      setStats(await getStats())
    } catch {
      // ignore
    } finally {
      setLoadingStats(false)
    }
  }, [])

  const refreshProfile = useCallback(async () => {
    try {
      setProfile(await getLearnProfile())
    } catch {
      // ignore
    } finally {
      setLoadingProfile(false)
    }
  }, [])

  const handleEarned = useCallback(
    (badges: BadgeDef[]) => {
      if (badges.length === 0) return
      setEarned((prev) => [...prev, ...badges])
      void refreshProfile()
    },
    [refreshProfile],
  )

  const showToast = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(
      () => setToast((current) => (current === message ? '' : current)),
      2600,
    )
  }, [])

  useEffect(() => {
    if (earned.length === 0) return
    const handle = window.setTimeout(() => setEarned([]), 5200)
    return () => window.clearTimeout(handle)
  }, [earned])

  useEffect(() => {
    if (!user) return
    let active = true
    async function init() {
      try {
        const [sessionData, settingsData, modelsData] = await Promise.all([
          listSessions(),
          getSettings(),
          getModels(),
        ])
        if (!active) return
        setSessions(sessionData.sessions)
        setSettings(settingsData)
        setModels(modelsData.models)

        if (sessionData.sessions.length > 0) {
          const saved = localStorage.getItem(SESSION_KEY)
          const pick =
            sessionData.sessions.find((s) => s.id === saved) ??
            sessionData.sessions[0]
          setCurrentId(pick.id)
          localStorage.setItem(SESSION_KEY, pick.id)
          const history = await getHistory(pick.id)
          if (active) setMessages(history.messages)
        } else {
          const id = newId()
          localStorage.setItem(SESSION_KEY, id)
          await createSession(id)
          if (active) setCurrentId(id)
        }
      } catch {
        // backend unavailable; start a local session anyway
        const id = localStorage.getItem(SESSION_KEY) ?? newId()
        localStorage.setItem(SESSION_KEY, id)
        if (active) setCurrentId(id)
      } finally {
        if (active) setLoadingSessions(false)
      }
      void refreshStats()
    }
    void init()
    return () => {
      active = false
    }
  }, [user, refreshStats])

  useEffect(() => {
    if (!user) {
      setProfile(null)
      setLoadingProfile(false)
      return
    }
    setLoadingProfile(true)
    void refreshProfile()
  }, [user, refreshProfile])

  const startNewChat = useCallback(async () => {
    if (busy) return
    const id = newId()
    localStorage.setItem(SESSION_KEY, id)
    setCurrentId(id)
    setMessages([])
    setView('chat')
    setSidebarOpen(false)
    try {
      await createSession(id)
    } catch {
      // offline fallback
    }
    void refreshSessions()
  }, [busy, refreshSessions])

  const selectSession = useCallback(
    async (id: string) => {
      if (busy) return
      setCurrentId(id)
      localStorage.setItem(SESSION_KEY, id)
      setView('chat')
      setSidebarOpen(false)
      try {
        const history = await getHistory(id)
        setMessages(history.messages)
      } catch {
        setMessages([])
      }
    },
    [busy],
  )

  const removeSession = useCallback(
    async (id: string) => {
      if (busy) return
      if (!window.confirm('Delete this conversation?')) return
      try {
        await deleteSessionApi(id)
      } catch {
        // ignore
      }
      await refreshSessions()
      if (id === currentId) await startNewChat()
      void refreshStats()
    },
    [busy, currentId, refreshSessions, refreshStats, startNewChat],
  )

  const renameSession = useCallback(
    async (id: string, title: string) => {
      if (!title) return
      try {
        await updateSession(id, { title })
      } catch {
        // ignore
      }
      void refreshSessions()
    },
    [refreshSessions],
  )

  const togglePin = useCallback(
    async (session: SessionSummary) => {
      try {
        await updateSession(session.id, { pinned: !session.pinned })
      } catch {
        // ignore
      }
      void refreshSessions()
    },
    [refreshSessions],
  )

  const runStream = useCallback(
    async (
      text: string,
      regenerate: boolean,
      attachments: OutgoingAttachment[] = [],
    ) => {
      if (!currentId || busy) return
      if (!regenerate) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'user',
            text,
            attachments: attachments.map((item) => ({
              name: item.name,
              url: item.url,
              kind: item.kind,
            })),
          },
          { role: 'model', text: '' },
        ])
      } else {
        setMessages((prev) => {
          const next = prev.slice()
          while (next.length && next[next.length - 1].role === 'model') next.pop()
          return [...next, { role: 'model', text: '' }]
        })
      }
      setBusy(true)
      const controller = new AbortController()
      abortRef.current = controller

      try {
        await streamChat(currentId, text, {
          signal: controller.signal,
          regenerate,
          attachments: attachments.map((item) => ({
            name: item.name,
            mime_type: item.mime_type,
            data: item.data,
          })),
          onDelta: (delta) =>
            setMessages((prev) => updateLastText(prev, delta)),
          onError: (message) =>
            setMessages((prev) =>
              updateLastText(prev, `\n\n[error] ${message}`),
            ),
        })
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          const message = err instanceof Error ? err.message : String(err)
          setMessages((prev) => updateLastText(prev, `\n\n[error] ${message}`))
        }
      } finally {
        setBusy(false)
        abortRef.current = null
        setMessages((prev) => {
          const next = prev.slice()
          const last = next[next.length - 1]
          if (last && last.role === 'model' && last.text === '') next.pop()
          return next
        })
        void refreshSessions()
        void refreshStats()
      }
    },
    [busy, currentId, refreshSessions, refreshStats],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const regenerate = useCallback(() => {
    void runStream('', true)
  }, [runStream])

  const saveSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const data = await saveSettingsApi(patch)
    setSettings(data.settings)
  }, [])

  const saveNoteFromChat = useCallback(
    async (text: string) => {
      const content = text.trim()
      if (!content) return
      try {
        const result = await createNote({
          content,
          session_id: currentId ?? undefined,
        })
        if (result.new_badges.length) handleEarned(result.new_badges)
        void refreshProfile()
        showToast('Saved to Notes')
      } catch {
        showToast('Could not save note')
      }
    },
    [currentId, handleEarned, refreshProfile, showToast],
  )

  const finishOnboarding = useCallback(
    async (payload: {
      goal: string
      level: string
      daily_minutes: number
    }) => {
      const result = await completeOnboarding(payload)
      if (result.new_badges.length) handleEarned(result.new_badges)
      await refreshProfile()
      void refreshStats()
      showToast('Welcome to Muri! +5 points')
    },
    [handleEarned, refreshProfile, refreshStats, showToast],
  )

  const clearAll = useCallback(async () => {
    if (!window.confirm('Delete ALL conversations? This cannot be undone.'))
      return
    try {
      await clearAllSessions()
    } catch {
      // ignore
    }
    setSessions([])
    await startNewChat()
    void refreshStats()
  }, [refreshStats, startNewChat])

  const handleAuthed = useCallback(
    (me: AuthUser) => {
      setUser(me)
      void refreshStats()
    },
    [refreshStats],
  )

  const handleLogout = useCallback(async () => {
    try {
      await logout()
    } catch {
      // ignore
    }
    setUser(null)
    setSessions([])
    setMessages([])
    setCurrentId(null)
    setSettings(null)
    setStats(null)
    setProfile(null)
    setEarned([])
    localStorage.removeItem(SESSION_KEY)
    setView('chat')
    setSidebarOpen(false)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const effective =
        current === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : current
      return effective === 'dark' ? 'light' : 'dark'
    })
  }, [])

  function exportChat() {
    if (messages.length === 0) return
    const title =
      sessions.find((s) => s.id === currentId)?.title ?? 'Muri chat'
    const body = messages
      .map((m) => `### ${m.role === 'user' ? 'You' : 'Muri'}\n\n${m.text}`)
      .join('\n\n')
    const blob = new Blob([`# ${title}\n\n${body}\n`], {
      type: 'text/markdown',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${title.replace(/[^\w.-]+/g, '_')}.md`
    link.click()
    URL.revokeObjectURL(url)
  }

  const currentTitle =
    view === 'chat'
      ? sessions.find((s) => s.id === currentId)?.title ?? 'New chat'
      : view[0].toUpperCase() + view.slice(1)

  if (authLoading) {
    return (
      <div className="auth-screen">
        <div className="auth-card auth-card--splash">
          <img className="logo-mark" src="/muri-logo.jpg" alt="" />
          <p className="auth-subtitle">Loading…</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <AuthScreen providers={providers} onAuthed={handleAuthed} />
  }

  const showOnboarding =
    !!user && !!profile && !profile.onboarded && !loadingProfile

  const navigate = (next: View) => {
    setView(next)
    setSidebarOpen(false)
  }

  const sidebar = (
    <Sidebar
      sessions={sessions}
      currentId={currentId}
      view={view}
      open={sidebarOpen}
      theme={theme}
      user={user}
      streak={profile?.streak.current ?? 0}
      points={profile?.points ?? 0}
      onNavigate={navigate}
      onNewChat={() => void startNewChat()}
      onSelectSession={(id) => void selectSession(id)}
      onDeleteSession={(id) => void removeSession(id)}
      onTogglePin={(session) => void togglePin(session)}
      onToggleTheme={toggleTheme}
      onLogout={() => void handleLogout()}
      onClose={() => setSidebarOpen(false)}
    />
  )

  const topbar = (
    <header className="topbar">
      <button
        type="button"
        className="icon-btn menu-btn"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open menu"
      >
        <MenuIcon />
      </button>
      <h1 className="topbar-title">{currentTitle}</h1>
      {view === 'chat' && messages.length > 0 && (
        <button
          type="button"
          className="icon-btn"
          onClick={exportChat}
          title="Export chat"
          aria-label="Export chat"
        >
          <DownloadIcon />
        </button>
      )}
    </header>
  )

  const content = (
    <>
      {view === 'chat' && (
        <ChatView
          messages={messages}
          busy={busy}
          onSend={(text, attachments) =>
            void runStream(text, false, attachments)
          }
          onStop={stop}
          onRegenerate={regenerate}
          onSaveNote={(text) => void saveNoteFromChat(text)}
        />
      )}

      {view === 'learn' && (
        <LearnView onEarned={handleEarned} onProgress={refreshProfile} />
      )}

      {view === 'games' && (
        <GamesView onEarned={handleEarned} onProgress={refreshProfile} />
      )}

      {view === 'notes' && (
        <NotesView onEarned={handleEarned} onProgress={refreshProfile} />
      )}

      {view === 'achievements' && (
        <AchievementsView profile={profile} loading={loadingProfile} />
      )}

      {view === 'dashboard' && (
        <Dashboard
          stats={stats}
          loading={loadingStats}
          profile={profile}
          userName={user?.name ?? user?.email ?? null}
          onOpenSession={(id) => void selectSession(id)}
          onViewHistory={() => setView('history')}
          onViewAchievements={() => setView('achievements')}
          onStartChat={() => void startNewChat()}
        />
      )}

      {view === 'history' && (
        <HistoryView
          sessions={sessions}
          loading={loadingSessions}
          onOpen={(id) => void selectSession(id)}
          onDelete={(id) => void removeSession(id)}
          onRename={(id, title) => void renameSession(id, title)}
          onTogglePin={(session) => void togglePin(session)}
        />
      )}

      {view === 'settings' && (
        <SettingsView
          key={settings ? 'ready' : 'loading'}
          settings={settings}
          theme={theme}
          models={models}
          onSave={saveSettings}
          onThemeChange={setTheme}
          onClearAll={() => void clearAll()}
        />
      )}
    </>
  )

  const overlays = (
    <>
      {showOnboarding && (
        <OnboardingModal name={user?.name} onSubmit={finishOnboarding} />
      )}

      {earned.length > 0 && (
        <div className="badge-toast" role="status">
          <span className="badge-toast-icon">
            <SparklesIcon size={20} />
          </span>
          <div>
            <strong>Badge unlocked</strong>
            <span>{earned.map((badge) => badge.title).join(' · ')}</span>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  )

  // Separate laptop vs phone shells. CSS media queries remain as a fallback,
  // but each device now has its own layout component.
  if (isMobile) {
    return (
      <MobileLayout
        sidebar={sidebar}
        topbar={topbar}
        content={content}
        overlays={overlays}
        view={view}
        onNavigate={navigate}
        onNewChat={() => void startNewChat()}
        onOpenMenu={() => setSidebarOpen(true)}
      />
    )
  }

  return (
    <DesktopLayout
      sidebar={sidebar}
      topbar={topbar}
      content={content}
      overlays={overlays}
    />
  )
}

export default App
