// Where the Muri backend lives. Empty string (default) keeps same-origin
// requests, which is what the web build served by FastAPI uses. The Android
// app sets VITE_API_BASE to the public backend URL at build time.
export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '')

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`
}

export type View =
  | 'chat'
  | 'learn'
  | 'games'
  | 'notes'
  | 'achievements'
  | 'dashboard'
  | 'history'
  | 'settings'

export type Theme = 'light' | 'dark' | 'system'

export interface AuthUser {
  id: string
  email: string | null
  name: string | null
  avatar_url: string | null
  provider: string
}

export interface Providers {
  google: boolean
  facebook: boolean
}

export interface PendingLogin {
  email: string
  provider: string
  sent: boolean
}

export type Role = 'user' | 'model'

export interface Attachment {
  name: string
  mime_type: string
  data: string
}

export interface MessageAttachment {
  name: string
  url: string
  kind: 'image' | 'file'
}

export interface OutgoingAttachment {
  name: string
  mime_type: string
  data: string
  url: string
  kind: 'image' | 'file'
}

export interface Message {
  role: Role
  text: string
  attachments?: MessageAttachment[]
}

export interface SessionSummary {
  id: string
  title: string
  pinned: boolean
  created_at: string | null
  updated_at: string | null
  message_count: number
  preview: string
}

export interface ActivityPoint {
  date: string
  count: number
}

export interface Stats {
  total_sessions: number
  total_messages: number
  user_messages: number
  model_messages: number
  sessions_today: number
  messages_today: number
  activity: ActivityPoint[]
  recent: SessionSummary[]
}

export interface AppSettings {
  model: string
  system_instruction: string
  temperature: number
  error?: string
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(url), { credentials: 'include', ...init })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(detail || `Request failed (${res.status})`)
  }
  return (await res.json()) as T
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export function listSessions() {
  return request<{ sessions: SessionSummary[]; error?: string }>('/api/sessions')
}

export function createSession(sessionId: string) {
  return request<{ status: string }>(
    '/api/sessions',
    json('POST', { session_id: sessionId }),
  )
}

export function updateSession(
  sessionId: string,
  patch: { title?: string; pinned?: boolean },
) {
  return request<{ status: string; session: SessionSummary }>(
    `/api/sessions/${sessionId}`,
    json('PATCH', patch),
  )
}

export function deleteSession(sessionId: string) {
  return request<{ status: string }>(`/api/sessions/${sessionId}`, {
    method: 'DELETE',
  })
}

export function clearAllSessions() {
  return request<{ status: string }>('/api/sessions', { method: 'DELETE' })
}

export function getHistory(sessionId: string) {
  return request<{ messages: Message[]; error?: string }>(
    `/api/history/${sessionId}`,
  )
}

export function getStats() {
  return request<Stats>('/api/stats')
}

export function getSettings() {
  return request<AppSettings>('/api/settings')
}

export function getModels() {
  return request<{ models: string[]; default: string }>('/api/models')
}

export function saveSettings(patch: Partial<AppSettings>) {
  return request<{ status: string; settings: AppSettings }>(
    '/api/settings',
    json('PUT', patch),
  )
}

export interface StreamHandlers {
  onDelta: (text: string) => void
  onError: (message: string) => void
  signal?: AbortSignal
}

export interface ChatStreamOptions extends StreamHandlers {
  regenerate?: boolean
  attachments?: Attachment[]
}

export async function getMe(): Promise<AuthUser | null> {
  const res = await fetch(apiUrl('/api/auth/me'), { credentials: 'include' })
  if (res.status === 401) return null
  if (!res.ok) throw new Error(`Failed to check session (${res.status})`)
  const data = (await res.json()) as { user: AuthUser }
  return data.user
}

export function getProviders() {
  return request<Providers>('/api/auth/providers')
}

export async function login(email: string, password: string) {
  const data = await request<{ user: AuthUser }>(
    '/api/auth/login',
    json('POST', { email, password }),
  )
  return data.user
}

export async function signup(email: string, password: string, name?: string) {
  const data = await request<{ user: AuthUser }>(
    '/api/auth/signup',
    json('POST', { email, password, name }),
  )
  return data.user
}

export async function logout() {
  await request<{ status: string }>('/api/auth/logout', { method: 'POST' })
}

export async function getPendingLogin(): Promise<PendingLogin | null> {
  const res = await fetch(apiUrl('/api/auth/pending'), {
    credentials: 'include',
  })
  if (!res.ok) return null
  const data = (await res.json()) as { pending: PendingLogin | null }
  return data.pending
}

export async function verifyLoginCode(code: string): Promise<AuthUser> {
  const data = await request<{ user: AuthUser }>(
    '/api/auth/oauth/verify',
    json('POST', { code }),
  )
  return data.user
}

export function resendLoginCode() {
  return request<{ sent: boolean }>('/api/auth/oauth/resend', {
    method: 'POST',
  })
}

export async function cancelPendingLogin() {
  await request<{ status: string }>('/api/auth/oauth/cancel', {
    method: 'POST',
  })
}

/* ---------- learning / gamification ---------- */

export interface BadgeDef {
  id: string
  title: string
  description: string
  icon: string
}

export interface EarnedBadge extends BadgeDef {
  awarded_at: string | null
}

export interface StreakInfo {
  current: number
  longest: number
  active_today: boolean
  last_active: string | null
}

export interface LearnProfile {
  onboarded: boolean
  goal: string | null
  level: string
  daily_minutes: number
  points: number
  streak: StreakInfo
  counts: {
    notes: number
    lessons: number
    courses: number
    games: number
    messages: number
  }
  certificates: number
  badges: { earned: EarnedBadge[]; catalog: BadgeDef[] }
}

export interface LessonSummary {
  id: string
  title: string
  summary: string
  minutes: number
  completed: boolean
}

export interface CourseSummary {
  id: string
  title: string
  description: string
  emoji: string
  category: string
  level: string
  lesson_count: number
  completed_count: number
  progress: number
  certificate: boolean
  lessons: LessonSummary[]
}

export interface LessonDetail {
  id: string
  title: string
  summary: string
  content: string
  minutes: number
  completed: boolean
}

export interface CourseDetail {
  id: string
  title: string
  description: string
  emoji: string
  category: string
  level: string
  completed_count: number
  lesson_count: number
  progress: number
  certificate: boolean
  certificate_id: string | null
  lessons: LessonDetail[]
}

export interface Certificate {
  id: string
  course_id: string
  course_title: string
  emoji: string
  level: string
  issued_at: string | null
}

export interface Note {
  id: string
  title: string
  content: string
  tags: string | null
  pinned: boolean
  session_id: string | null
  created_at: string | null
  updated_at: string | null
}

export interface QuizQuestion {
  id: string
  course_id: string
  question: string
  options: string[]
  answer: number
  explanation: string
}

export interface LessonCompletion {
  status: string
  first_time: boolean
  points: number
  streak: number
  new_badges: BadgeDef[]
  certificate: {
    id: string
    course_id: string
    course_title: string
    issued_at: string | null
  } | null
}

export function getLearnProfile() {
  return request<LearnProfile>('/api/learn/profile')
}

export function completeOnboarding(payload: {
  goal: string
  level: string
  daily_minutes: number
}) {
  return request<{ status: string; points: number; new_badges: BadgeDef[] }>(
    '/api/learn/onboarding',
    json('POST', payload),
  )
}

export function getCourses() {
  return request<{ courses: CourseSummary[] }>('/api/learn/courses')
}

export function getCourse(courseId: string) {
  return request<CourseDetail>(`/api/learn/courses/${courseId}`)
}

export function completeLesson(lessonId: string) {
  return request<LessonCompletion>(
    `/api/learn/lessons/${lessonId}/complete`,
    { method: 'POST' },
  )
}

export function getCertificates() {
  return request<{ certificates: Certificate[] }>('/api/learn/certificates')
}

export function getQuiz(courseId?: string) {
  const suffix = courseId ? `?course_id=${encodeURIComponent(courseId)}` : ''
  return request<{ questions: QuizQuestion[] }>(
    `/api/learn/game/quiz${suffix}`,
  )
}

export function submitGameScore(payload: {
  game: string
  score: number
  total: number
}) {
  return request<{ status: string; points: number; new_badges: BadgeDef[] }>(
    '/api/learn/game/score',
    json('POST', payload),
  )
}

export function listNotes(q?: string) {
  const suffix = q ? `?q=${encodeURIComponent(q)}` : ''
  return request<{ notes: Note[] }>(`/api/notes${suffix}`)
}

export function createNote(payload: {
  title?: string
  content: string
  tags?: string
  session_id?: string
}) {
  return request<{ note: Note; new_badges: BadgeDef[] }>(
    '/api/notes',
    json('POST', payload),
  )
}

export function updateNote(
  noteId: string,
  patch: { title?: string; content?: string; tags?: string; pinned?: boolean },
) {
  return request<{ note: Note }>(`/api/notes/${noteId}`, json('PATCH', patch))
}

export function deleteNote(noteId: string) {
  return request<{ status: string }>(`/api/notes/${noteId}`, {
    method: 'DELETE',
  })
}

export async function streamChat(
  sessionId: string,
  message: string,
  {
    onDelta,
    onError,
    signal,
    regenerate = false,
    attachments = [],
  }: ChatStreamOptions,
): Promise<void> {
  const res = await fetch(apiUrl('/api/chat/stream'), {
    ...json('POST', {
      session_id: sessionId,
      message,
      regenerate,
      attachments,
    }),
    signal,
    credentials: 'include',
  })
  if (!res.ok || !res.body) {
    throw new Error(`Request failed (${res.status})`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''

    for (const event of events) {
      const line = event.trim()
      if (!line.startsWith('data:')) continue
      const payload = JSON.parse(line.slice(5).trim()) as {
        delta?: string
        error?: string
      }
      if (typeof payload.delta === 'string') onDelta(payload.delta)
      if (typeof payload.error === 'string') onError(payload.error)
    }
  }
}
