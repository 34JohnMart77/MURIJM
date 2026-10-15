import { useState } from 'react'
import type { AppSettings, Theme } from '../lib/api'
import { CheckIcon } from './Icons'

interface SettingsViewProps {
  settings: AppSettings | null
  theme: Theme
  models?: string[]
  onSave: (patch: Partial<AppSettings>) => Promise<void>
  onThemeChange: (theme: Theme) => void
  onClearAll: () => void
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

  const modelOptions = models != null && models.length > 0 ? models : MODEL_SUGGESTIONS

  async function save() {
    setSaving(true)
    try {
      await onSave({
        model,
        system_instruction: instruction,
        temperature,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 1600)
    } finally {
      setSaving(false)
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
        >
          {saved ? (
            <>
              <CheckIcon size={16} /> Saved
            </>
          ) : (
            'Save settings'
          )}
        </button>
      </div>

      <section className="panel danger">
        <h3>Danger zone</h3>
        <p className="muted">
          Permanently delete every conversation and its messages.
        </p>
        <button type="button" className="danger-btn" onClick={onClearAll}>
          Delete all conversations
        </button>
      </section>
    </div>
  )
}
