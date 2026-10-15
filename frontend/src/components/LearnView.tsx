import { Fragment, useEffect, useState, type ReactNode } from 'react'
import {
  completeLesson,
  getCourse,
  getCourses,
  type BadgeDef,
  type CourseDetail,
  type CourseSummary,
} from '../lib/api'
import {
  BookIcon,
  CertificateIcon,
  CheckIcon,
  ChevronLeftIcon,
  ClockIcon,
} from './Icons'

interface LearnViewProps {
  onEarned: (badges: BadgeDef[]) => void
  onProgress: () => void
}

function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean)
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index}>{part.slice(1, -1)}</code>
    }
    return <Fragment key={index}>{part}</Fragment>
  })
}

function Prose({ content }: { content: string }) {
  const lines = content.split('\n')
  return (
    <div className="prose">
      {lines.map((line, index) => {
        const trimmed = line.trim()
        if (!trimmed) return <div key={index} className="prose-gap" />
        const bullet = /^[-*]\s+/.test(trimmed)
        const numbered = /^\d+\.\s+/.test(trimmed)
        const text = trimmed.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '')
        if (bullet) {
          return (
            <p key={index} className="prose-item">
              <span className="prose-dot" /> {renderInline(text)}
            </p>
          )
        }
        if (numbered) {
          return (
            <p key={index} className="prose-item">
              <span className="prose-num">{trimmed.match(/^\d+/)?.[0]}.</span>{' '}
              {renderInline(text)}
            </p>
          )
        }
        return <p key={index}>{renderInline(trimmed)}</p>
      })}
    </div>
  )
}

export default function LearnView({ onEarned, onProgress }: LearnViewProps) {
  const [courses, setCourses] = useState<CourseSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<CourseDetail | null>(null)
  const [lessonId, setLessonId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const data = await getCourses()
        if (active) setCourses(data.courses)
      } catch {
        // ignore
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  async function openCourse(courseId: string) {
    setBusy(true)
    setNotice('')
    try {
      setDetail(await getCourse(courseId))
    } catch {
      // ignore
    } finally {
      setBusy(false)
    }
  }

  async function refreshCourses() {
    try {
      const data = await getCourses()
      setCourses(data.courses)
    } catch {
      // ignore
    }
  }

  async function markComplete(id: string) {
    if (busy) return
    setBusy(true)
    try {
      const result = await completeLesson(id)
      if (detail) setDetail(await getCourse(detail.id))
      await refreshCourses()
      if (result.new_badges.length) onEarned(result.new_badges)
      if (result.certificate) {
        setNotice(`🎉 Certificate earned: ${result.certificate.course_title}`)
      } else if (result.first_time) {
        setNotice(`+10 points · streak ${result.streak} 🔥`)
      }
      onProgress()
    } catch {
      // ignore
    } finally {
      setBusy(false)
    }
  }

  if (lessonId && detail) {
    const lesson = detail.lessons.find((item) => item.id === lessonId)
    if (lesson) {
      return (
        <div className="view-pad">
          <header className="view-head">
            <div className="lesson-head">
              <button
                type="button"
                className="icon-btn tiny"
                title="Back to course"
                onClick={() => setLessonId(null)}
              >
                <ChevronLeftIcon />
              </button>
              <div>
                <h2>{lesson.title}</h2>
                <p className="muted">
                  {detail.emoji} {detail.title} · {lesson.minutes} min
                </p>
              </div>
            </div>
          </header>

          <section className="panel lesson-reader">
            <Prose content={lesson.content} />
          </section>

          {notice && <p className="notice-inline">{notice}</p>}

          <div className="settings-actions">
            <button
              type="button"
              className="primary-btn"
              disabled={busy || lesson.completed}
              onClick={() => void markComplete(lesson.id)}
            >
              {lesson.completed ? (
                <>
                  <CheckIcon size={16} /> Completed
                </>
              ) : (
                'Mark as complete'
              )}
            </button>
          </div>
        </div>
      )
    }
  }

  if (detail) {
    return (
      <div className="view-pad">
        <header className="view-head">
          <div className="lesson-head">
            <button
              type="button"
              className="icon-btn tiny"
              title="Back to courses"
              onClick={() => {
                setDetail(null)
                setNotice('')
              }}
            >
              <ChevronLeftIcon />
            </button>
            <div>
              <h2>
                {detail.emoji} {detail.title}
              </h2>
              <p className="muted">
                {detail.category} · {detail.level} · {detail.completed_count}/
                {detail.lesson_count} lessons
              </p>
            </div>
          </div>
          {detail.certificate && (
            <span className="pill success">
              <CertificateIcon size={15} /> Certificate earned
            </span>
          )}
        </header>

        <div className="progress-track wide">
          <div className="progress-fill" style={{ width: `${detail.progress}%` }} />
        </div>

        {notice && <p className="notice-inline">{notice}</p>}

        <ul className="lesson-list">
          {detail.lessons.map((lesson, index) => (
            <li key={lesson.id}>
              <button
                type="button"
                className="lesson-row"
                onClick={() => setLessonId(lesson.id)}
              >
                <span
                  className={`lesson-badge ${lesson.completed ? 'done' : ''}`}
                >
                  {lesson.completed ? <CheckIcon size={15} /> : index + 1}
                </span>
                <span className="lesson-info">
                  <span className="lesson-title">{lesson.title}</span>
                  <span className="lesson-summary">{lesson.summary}</span>
                </span>
                <span className="lesson-min">
                  <ClockIcon size={14} /> {lesson.minutes}m
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div className="view-pad">
      <header className="view-head">
        <div>
          <h2>Learn</h2>
          <p className="muted">
            Short lessons with Muri by your side. Finish a course to earn a
            certificate.
          </p>
        </div>
      </header>

      {loading && (
        <div className="loading-state" role="status">
          <span className="spinner" aria-hidden="true" />
          Loading courses…
        </div>
      )}

      <div className="course-grid">
        {courses.map((course) => (
          <button
            key={course.id}
            type="button"
            className="course-card"
            onClick={() => void openCourse(course.id)}
          >
            <div className="course-emoji">{course.emoji}</div>
            <div className="course-body">
              <div className="course-top">
                <span className="pill">{course.level}</span>
                {course.certificate && <CertificateIcon size={16} />}
              </div>
              <h3>{course.title}</h3>
              <p className="muted course-desc">{course.description}</p>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: `${course.progress}%` }}
                />
              </div>
              <span className="course-meta">
                <BookIcon size={14} /> {course.completed_count}/
                {course.lesson_count} lessons · {course.progress}%
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
