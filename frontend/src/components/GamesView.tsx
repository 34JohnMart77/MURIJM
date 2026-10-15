import { useCallback, useEffect, useState } from 'react'
import {
  getQuiz,
  submitGameScore,
  type BadgeDef,
  type QuizQuestion,
} from '../lib/api'
import { GamepadIcon, RefreshIcon, StarIcon, TrophyIcon } from './Icons'

interface GamesViewProps {
  onEarned: (badges: BadgeDef[]) => void
  onProgress: () => void
}

function shuffle<T>(items: T[]): T[] {
  const next = items.slice()
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[next[i], next[j]] = [next[j], next[i]]
  }
  return next
}

export default function GamesView({ onEarned, onProgress }: GamesViewProps) {
  const [loading, setLoading] = useState(true)
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [index, setIndex] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [score, setScore] = useState(0)
  const [finished, setFinished] = useState(false)
  const [saving, setSaving] = useState(false)
  const [best, setBest] = useState<number | null>(null)

  const start = useCallback(async () => {
    setLoading(true)
    setFinished(false)
    setIndex(0)
    setPicked(null)
    setScore(0)
    try {
      const data = await getQuiz()
      setQuestions(shuffle(data.questions).slice(0, 8))
    } catch {
      setQuestions([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void start()
  }, [start])

  const total = questions.length
  const current = questions[index]

  async function choose(option: number) {
    if (picked !== null || !current) return
    setPicked(option)
    const correct = option === current.answer
    const nextScore = correct ? score + 1 : score
    setScore(nextScore)
    if (index + 1 >= total) {
      setSaving(true)
      try {
        const result = await submitGameScore({
          game: 'quick_quiz',
          score: nextScore,
          total,
        })
        if (result.new_badges.length) onEarned(result.new_badges)
        setBest(result.points)
        onProgress()
      } catch {
        // ignore
      } finally {
        setSaving(false)
        setFinished(true)
      }
    }
  }

  function next() {
    setPicked(null)
    setIndex((value) => value + 1)
  }

  if (loading) {
    return (
      <div className="view-pad">
        <div className="loading-state" role="status">
          <span className="spinner" aria-hidden="true" />
          Getting your game ready…
        </div>
      </div>
    )
  }

  if (total === 0) {
    return (
      <div className="view-pad">
        <p className="muted">No questions available right now.</p>
      </div>
    )
  }

  if (finished) {
    const percent = Math.round((score / total) * 100)
    return (
      <div className="view-pad">
        <section className="panel quiz-result">
          <TrophyIcon size={48} />
          <h2>
            {score}/{total} correct
          </h2>
          <p className="muted">
            {percent === 100
              ? 'Perfect score! Outstanding.'
              : percent >= 60
                ? 'Nice work — keep the streak going!'
                : 'Good effort. Review the lessons and try again.'}
          </p>
          <div className="quiz-result-stats">
            <span className="pill success">
              <StarIcon size={14} /> {percent}%
            </span>
            {best !== null && (
              <span className="pill">+{total * 5} points banked</span>
            )}
          </div>
          <button type="button" className="primary-btn" onClick={() => void start()}>
            <RefreshIcon size={16} /> Play again
          </button>
        </section>
      </div>
    )
  }

  return (
    <div className="view-pad">
      <header className="view-head">
        <div>
          <h2>
            <GamepadIcon size={20} /> Quick Quiz
          </h2>
          <p className="muted">
            Question {index + 1} of {total} · score {score}
          </p>
        </div>
      </header>

      <div className="progress-track wide">
        <div
          className="progress-fill"
          style={{ width: `${((index + (picked !== null ? 1 : 0)) / total) * 100}%` }}
        />
      </div>

      <section className="panel quiz-card">
        <h3 className="quiz-question">{current.question}</h3>
        <div className="quiz-options">
          {current.options.map((option, optionIndex) => {
            let state = ''
            if (picked !== null) {
              if (optionIndex === current.answer) state = 'correct'
              else if (optionIndex === picked) state = 'wrong'
            }
            return (
              <button
                key={option}
                type="button"
                className={`quiz-option ${state}`}
                disabled={picked !== null}
                onClick={() => void choose(optionIndex)}
              >
                {option}
              </button>
            )
          })}
        </div>

        {picked !== null && (
          <div className="quiz-feedback">
            <p>{current.explanation}</p>
            <div className="settings-actions">
              <button type="button" className="primary-btn" onClick={next}>
                {index + 1 >= total ? 'See results' : 'Next question'}
              </button>
            </div>
          </div>
        )}
        {saving && <p className="muted">Saving score…</p>}
      </section>
    </div>
  )
}
