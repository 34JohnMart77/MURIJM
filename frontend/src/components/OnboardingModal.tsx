import { useState } from 'react'
import { SparklesIcon, TargetIcon } from './Icons'

interface OnboardingModalProps {
  name?: string | null
  onSubmit: (payload: {
    goal: string
    level: string
    daily_minutes: number
  }) => Promise<void>
}

const GOALS = [
  'Learn a new skill',
  'Do better at school',
  'Grow my career',
  'Stay consistent daily',
  'Just explore',
]

const LEVELS = ['Beginner', 'Intermediate', 'Advanced']
const MINUTES = [5, 10, 15, 30]

export default function OnboardingModal({
  name,
  onSubmit,
}: OnboardingModalProps) {
  const [step, setStep] = useState(0)
  const [goal, setGoal] = useState('')
  const [customGoal, setCustomGoal] = useState('')
  const [level, setLevel] = useState('Beginner')
  const [minutes, setMinutes] = useState(10)
  const [busy, setBusy] = useState(false)

  const chosenGoal = goal === 'Other' ? customGoal.trim() : goal
  const canNext = step === 0 ? chosenGoal.length > 0 : true

  async function finish() {
    if (busy) return
    setBusy(true)
    try {
      await onSubmit({ goal: chosenGoal, level, daily_minutes: minutes })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-scrim">
      <div className="modal-card onboarding">
        <div className="onboarding-head">
          <img className="logo-mark large" src="/muri-logo.jpg" alt="" />
          <h2>
            Welcome{name ? `, ${name.split(' ')[0]}` : ''} to Muri
          </h2>
          <p className="muted">Learn. Play. Grow. Let's set you up in a moment.</p>
        </div>

        <div className="onboarding-dots" aria-hidden="true">
          {[0, 1, 2].map((dot) => (
            <span key={dot} className={dot === step ? 'on' : ''} />
          ))}
        </div>

        {step === 0 && (
          <div className="onboarding-step">
            <h3>
              <TargetIcon size={18} /> What's your goal?
            </h3>
            <div className="chip-wrap">
              {GOALS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`chip ${goal === item ? 'active' : ''}`}
                  onClick={() => setGoal(item)}
                >
                  {item}
                </button>
              ))}
              <button
                type="button"
                className={`chip ${goal === 'Other' ? 'active' : ''}`}
                onClick={() => setGoal('Other')}
              >
                Other
              </button>
            </div>
            {goal === 'Other' && (
              <input
                className="field"
                placeholder="Type your goal…"
                value={customGoal}
                maxLength={200}
                onChange={(event) => setCustomGoal(event.target.value)}
              />
            )}
          </div>
        )}

        {step === 1 && (
          <div className="onboarding-step">
            <h3>
              <SparklesIcon size={18} /> Where are you starting?
            </h3>
            <div className="segmented wide">
              {LEVELS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={level === item ? 'active' : ''}
                  onClick={() => setLevel(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="onboarding-step">
            <h3>
              <TargetIcon size={18} /> Daily learning target
            </h3>
            <p className="muted">
              Pick how long you'd like to learn each day. You can change this
              later.
            </p>
            <div className="chip-wrap">
              {MINUTES.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`chip ${minutes === value ? 'active' : ''}`}
                  onClick={() => setMinutes(value)}
                >
                  {value} min
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="onboarding-actions">
          <button
            type="button"
            className="text-btn"
            disabled={step === 0 || busy}
            onClick={() => setStep((current) => Math.max(0, current - 1))}
          >
            Back
          </button>
          {step < 2 ? (
            <button
              type="button"
              className="primary-btn"
              disabled={!canNext}
              onClick={() => setStep((current) => current + 1)}
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              className="primary-btn"
              disabled={busy || chosenGoal.length === 0}
              onClick={() => void finish()}
            >
              {busy ? 'Setting up…' : 'Start learning'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
