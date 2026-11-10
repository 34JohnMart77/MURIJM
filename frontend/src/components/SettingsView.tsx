import { useState } from 'react'
import type { AppSettings, Theme } from '../lib/api'
import { CheckIcon } from './Icons'

interface SettingsViewProps {
  settings: AppSettings | null
  theme: Theme
  chatBusy: boolean
  models?: string[]
  onSave: (patch: Partial<AppSettings>) => Promise<void>
  onThemeChange: (theme: Theme) => void
  onClearAll: () => Promise<boolean>
}

const MODEL_SUGGESTIONS = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
  'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
]

const THEMES: { id: Theme; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' },
]

export default function SettingsView({
  settings,
  theme,
  chatBusy,
  models,
  onSave,
  onThemeChange,
  onClearAll,
}: SettingsViewProps) {
  const [model, setModel] = useState(settings?.model ?? '')
  const [instruction, setInstruction] = useState(
    settings?.system_instruction ?? '',
  )
  const [temperature, setTemperature] = useState(
    settings?.temperature ?? 0.7,
  )
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [clearing, setClearing] = useState(false)
  const [clearError, setClearError] = useState('')
  const [cleared, setCleared] = useState(false)

  const modelOptions = models != null && models.length > 0 ? models : MODEL_SUGGESTIONS

  async function save() {
    setSaveError('')
    setSaving(true)
    try {
      await onSave({
        model,
        system_instruction: instruction,
        temperature,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 1600)
    } catch (error) {
      setSaveError(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function clearHistory() {
    setClearError('')
    setCleared(false)
    setClearing(true)
    try {
      setCleared(await onClearAll())
    } catch (error) {
      setClearError(errorMessage(error))
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="view-pad">
      <header className="view-head">
        <div>
          <h2>Settings</h2>
          <p className="muted">Tune how Muri behaves and looks.</p>
        </div>
      </header>

      <section className="panel">
        <h3>Model</h3>
        <p className="muted">
          Pick the Gemini model Muri replies with. Custom ids are allowed.
        </p>
        <div className="model-list">
          {modelOptions.map((name) => (
            <button
              key={name}
              type="button"
              className={model === name ? 'active' : ''}
              onClick={() => setModel(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <input
          className="field"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder="type a custom model id"
        />
      </section>

      <section className="panel">
        <h3>Persona</h3>
        <p className="muted">
          The system instruction that shapes Muri's tone and rules.
        </p>
        <textarea
          className="field"
          rows={4}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="You are Muri, a friendly assistant…"
        />
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Creativity</h3>
          <span className="muted">temperature {temperature.toFixed(1)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={2}
          step={0.1}
          value={temperature}
          onChange={(event) => setTemperature(Number(event.target.value))}
        />
        <div className="range-legend">
          <span>Precise</span>
          <span>Balanced</span>
          <span>Creative</span>
        </div>
      </section>

      <section className="panel">
        <h3>Appearance</h3>
        <div className="segmented">
          {THEMES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={theme === item.id ? 'active' : ''}
              onClick={() => onThemeChange(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <div className="settings-actions">
        <button
          type="button"
          className="primary-btn"
          onClick={() => void save()}
          disabled={saving}
          aria-busy={saving}
        >
          {saving ? (
            'Saving…'
          ) : saved ? (
            <>
              <CheckIcon size={16} /> Saved
            </>
          ) : (
            'Save settings'
          )}
        </button>
      </div>
      {saveError && (
        <p className="settings-error" role="alert">
          Could not save settings: {saveError}
        </p>
      )}

      <section className="panel privacy-panel">
        <h3>Privacy &amp; your data</h3>
        <p className="muted">
          Your conversations, notes, settings, and learning progress are stored
          in this Muri deployment’s database. Chat prompts and attachments are
          sent to Google Gemini to generate replies.
        </p>
        <p className="muted">
          Sign out ends your session but does not erase saved data. You can
          download the open conversation with the export button in Chat, or
          permanently delete all conversations below. This does not delete your
          notes, account, or learning progress.
        </p>
        <p className="muted">
          Avoid including passwords, payment details, or other sensitive
          information in chats and attachments.
        </p>
      </section>

      <section className="panel danger">
        <h3>Danger zone</h3>
        <p className="muted">
          Permanently delete every conversation and its messages.
        </p>
        <button
          type="button"
          className="danger-btn"
          onClick={() => void clearHistory()}
          disabled={clearing || chatBusy}
          aria-busy={clearing}
        >
          {clearing
            ? 'Deleting…'
            : chatBusy
              ? 'Stop the reply to delete history'
              : 'Delete all conversations'}
        </button>
        {cleared && (
          <p className="settings-success" role="status">
            Conversation history deleted.
          </p>
        )}
        {clearError && (
          <p className="settings-error" role="alert">
            Could not delete conversation history: {clearError}
          </p>
        )}
      </section>
    </div>
  )
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Please try again.'
  try {
    const body = JSON.parse(error.message) as { detail?: string }
    return body.detail || error.message
  } catch {
    return error.message
  }
}
