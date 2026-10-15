import { useEffect, useState } from 'react'
import {
  getCertificates,
  type BadgeDef,
  type Certificate,
  type LearnProfile,
} from '../lib/api'
import { formatDate } from '../lib/format'
import {
  BookIcon,
  CertificateIcon,
  FlameIcon,
  GamepadIcon,
  NoteIcon,
  SparklesIcon,
  StarIcon,
  TrophyIcon,
} from './Icons'

interface AchievementsViewProps {
  profile: LearnProfile | null
  loading: boolean
}

function badgeGlyph(icon: string) {
  switch (icon) {
    case 'flame':
      return <FlameIcon size={22} />
    case 'note':
      return <NoteIcon size={22} />
    case 'book':
      return <BookIcon size={22} />
    case 'game':
      return <GamepadIcon size={22} />
    case 'cert':
      return <CertificateIcon size={22} />
    case 'star':
      return <StarIcon size={22} />
    default:
      return <SparklesIcon size={22} />
  }
}

export default function AchievementsView({
  profile,
  loading,
}: AchievementsViewProps) {
  const [certificates, setCertificates] = useState<Certificate[]>([])

  useEffect(() => {
    void (async () => {
      try {
        const data = await getCertificates()
        setCertificates(data.certificates)
      } catch {
        // ignore
      }
    })()
  }, [profile?.certificates])

  if (loading && !profile) {
    return (
      <div className="view-pad">
        <div className="loading-state" role="status">
          <span className="spinner" aria-hidden="true" />
          Loading your achievements…
        </div>
      </div>
    )
  }

  const earnedIds = new Set(profile?.badges.earned.map((badge) => badge.id))
  const catalog: BadgeDef[] = profile?.badges.catalog ?? []
  const streak = profile?.streak

  return (
    <div className="view-pad">
      <header className="view-head">
        <div>
          <h2>Achievements</h2>
          <p className="muted">
            Stay consistent, unlock badges and collect certificates.
          </p>
        </div>
      </header>

      <div className="stat-grid">
        <div className="stat-card streak-card">
          <FlameIcon size={28} />
          <span className="stat-value">{streak?.current ?? 0}</span>
          <span className="stat-label">
            {streak?.active_today ? 'Day streak · active today' : 'Day streak'}
          </span>
        </div>
        <div className="stat-card">
          <TrophyIcon size={28} />
          <span className="stat-value">{streak?.longest ?? 0}</span>
          <span className="stat-label">Longest streak</span>
        </div>
        <div className="stat-card">
          <StarIcon size={28} />
          <span className="stat-value">{profile?.points ?? 0}</span>
          <span className="stat-label">Total points</span>
        </div>
        <div className="stat-card">
          <CertificateIcon size={28} />
          <span className="stat-value">{certificates.length}</span>
          <span className="stat-label">Certificates</span>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>
            <TrophyIcon size={16} /> Badges
          </h3>
          <span className="muted">
            {earnedIds.size}/{catalog.length} unlocked
          </span>
        </div>
        <div className="badge-grid">
          {catalog.map((badge) => {
            const earned = earnedIds.has(badge.id)
            return (
              <div
                key={badge.id}
                className={`badge-tile ${earned ? 'earned' : 'locked'}`}
              >
                <span className="badge-glyph">{badgeGlyph(badge.icon)}</span>
                <span className="badge-title">{badge.title}</span>
                <span className="badge-desc">{badge.description}</span>
              </div>
            )
          })}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>
            <CertificateIcon size={16} /> Certificates
          </h3>
        </div>
        {certificates.length === 0 ? (
          <p className="muted">
            Finish every lesson in a course to earn your first certificate.
          </p>
        ) : (
          <div className="cert-grid">
            {certificates.map((cert) => (
              <div key={cert.id} className="cert-card">
                <span className="cert-emoji">{cert.emoji}</span>
                <div>
                  <h3>{cert.course_title}</h3>
                  <p className="muted">
                    {cert.level} · issued {formatDate(cert.issued_at)}
                  </p>
                </div>
                <CertificateIcon size={20} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
