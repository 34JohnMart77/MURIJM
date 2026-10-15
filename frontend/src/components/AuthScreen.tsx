import { useEffect, useState } from 'react'
import type { AuthUser, PendingLogin, Providers } from '../lib/api'
import {
  apiUrl,
  cancelPendingLogin,
  getPendingLogin,
  login,
  resendLoginCode,
  signup,
  verifyLoginCode,
} from '../lib/api'
import { CloseIcon } from './Icons'

interface AuthScreenProps {
  providers: Providers
  onAuthed: (user: AuthUser) => void
}

const AUTH_ERRORS: Record<string, string> = {
  provider_unavailable:
    'That sign-in provider is not configured yet. Add its credentials to muri/backend/.env and restart the server.',
  email_required:
    "We couldn't read an email from that account, so no code could be sent. Try another sign-in method.",
  access_denied: 'Sign-in was cancelled.',
  invalid_state: 'That sign-in link expired. Please try again.',
  rate_limited: 'Too many attempts. Please wait a moment and try again.',
  login_failed:
    'OAuth sign-in failed. Try again, or use your email and password.',
}

function readError(err: unknown): string {
  if (err instanceof Error && err.message) {
    try {
      const detail = JSON.parse(err.message) as { detail?: string }
      return detail.detail || 'Something went wrong.'
    } catch {
      return err.message
    }
  }
  return 'Something went wrong.'
}

function startProvider(provider: 'google' | 'facebook') {
  window.location.assign(apiUrl(`/api/auth/oauth/${provider}/start`))
}

export default function AuthScreen({ providers, onAuthed }: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [step, setStep] = useState<'account' | 'code'>('account')
  const [pending, setPending] = useState<PendingLogin | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const params = new URLSearchParams(window.location.search)
  const authError = params.get('auth_error')

  useEffect(() => {
    let active = true
    void (async () => {
      const pendingLogin = await getPendingLogin()
      if (active && pendingLogin) {
        setPending(pendingLogin)
        setStep('code')
      }
    })()
    return () => {
      active = false
    }
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setError('')
    setBusy(true)
    try {
      const user =
        mode === 'login'
          ? await login(email, password)
          : await signup(email, password, name)
      onAuthed(user)
    } catch (err) {
      setError(readError(err))
    } finally {
      setBusy(false)
    }
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault()
    if (busy || code.length < 6) return
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const user = await verifyLoginCode(code)
      onAuthed(user)
    } catch (err) {
      setError(readError(err))
    } finally {
      setBusy(false)
    }
  }

  async function resend() {
    if (busy) return
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const { sent } = await resendLoginCode()
      setNotice(
        sent
          ? `A new code was sent to ${pending?.email ?? 'your email'}.`
          : 'A new code was generated. Check the server console (SMTP is not configured).',
      )
    } catch (err) {
      setError(readError(err))
    } finally {
      setBusy(false)
    }
  }

  async function switchAccount() {
    try {
      await cancelPendingLogin()
    } catch {
      // ignore
    }
    setPending(null)
    setStep('account')
    setCode('')
    setError('')
    setNotice('')
    window.history.replaceState({}, '', window.location.pathname)
  }

  if (step === 'code' && pending) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <span className="auth-brand">
            <img className="logo-mark" src="/muri-logo.jpg" alt="" />
          </span>
          <h1 className="auth-title">Enter your code</h1>
          <p className="auth-subtitle">
            {pending.sent
              ? `We emailed a 6-digit security code to ${pending.email}.`
              : `Your code was generated for ${pending.email}. Email isn't configured, so check the server console.`}
          </p>

          {error && (
            <div className="auth-error">
              <CloseIcon size={15} />
              <span>{error}</span>
            </div>
          )}
          {notice && (
            <div className="auth-notice">
              <span>{notice}</span>
            </div>
          )}

          <form className="auth-form" onSubmit={(event) => void verify(event)}>
            <input
              className="field auth-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              maxLength={6}
              autoFocus
              required
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
              }
            />
            <button
              type="submit"
              className="primary-btn auth-submit"
              disabled={busy || code.length < 6}
            >
              {busy ? 'Verifying…' : 'Verify and continue'}
            </button>
          </form>

          <div className="auth-code-actions">
            <button
              type="button"
              className="auth-switch"
              disabled={busy}
              onClick={() => void resend()}
            >
              Resend code
            </button>
            <button
              type="button"
              className="auth-switch"
              onClick={() => void switchAccount()}
            >
              Use another account
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <span className="auth-brand">
          <img className="logo-mark" src="/muri-logo.jpg" alt="" />
        </span>
        <h1 className="auth-title">
          {mode === 'login' ? 'Welcome back' : 'Create your account'}
        </h1>
        <p className="auth-subtitle">
          {mode === 'login'
            ? 'Sign in to continue to Muri.'
            : 'Get started with Muri.'}
        </p>

        {authError && (
          <div className="auth-error">
            <CloseIcon size={15} />
            <span>{AUTH_ERRORS[authError] ?? 'Sign-in failed. Please try again.'}</span>
          </div>
        )}
        {error && (
          <div className="auth-error">
            <CloseIcon size={15} />
            <span>{error}</span>
          </div>
        )}

        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          {mode === 'signup' && (
            <input
              className="field"
              type="text"
              placeholder="Your name (optional)"
              value={name}
              autoComplete="name"
              onChange={(event) => setName(event.target.value)}
            />
          )}
          <input
            className="field"
            type="email"
            placeholder="Email"
            required
            value={email}
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
          />
          <input
            className="field"
            type="password"
            placeholder="Password"
            required
            minLength={8}
            value={password}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button type="submit" className="primary-btn auth-submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div className="auth-divider">
          <span>or continue with</span>
        </div>
        <div className="auth-providers">
          {providers.google && (
            <button
              type="button"
              className="provider-btn google"
              onClick={() => startProvider('google')}
            >
              <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
                <path
                  fill="#FFC107"
                  d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.2 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"
                />
                <path
                  fill="#FF3D00"
                  d="m6.3 14.7 6.6 4.8C14.7 15.1 18.9 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.2 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
                />
                <path
                  fill="#4CAF50"
                  d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.4-8.1l-6.5 5C9.5 39.6 16.2 44 24 44z"
                />
                <path
                  fill="#1976D2"
                  d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"
                />
              </svg>
              Continue with Google
            </button>
          )}
          {providers.facebook && (
            <button
              type="button"
              className="provider-btn facebook"
              onClick={() => startProvider('facebook')}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.09 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.7 4.53-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.09 24 18.1 24 12.07z"
                />
              </svg>
              Continue with Facebook
            </button>
          )}
          {!providers.google && !providers.facebook && (
            <p className="auth-subtitle">
              Social sign-in is not configured yet. Use your email and
              password, or ask the admin to connect Google/Facebook.
            </p>
          )}
        </div>

        <button
          type="button"
          className="auth-switch"
          onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
        >
          {mode === 'login'
            ? "Don't have an account? Create one"
            : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  )
}
