import { content } from './content'
import { CV_URL } from './links'

/**
 * The CV link, "CV (PDF) ↗" everywhere (Shuri #70): opens the 1-page PDF in a new tab. No `download`
 * attribute, so phones show their PDF viewer instead of a silent save; the sr-only note says so.
 * - `pill` (first card, Career panel, Quick version header): a 44 px bordered control.
 * - `inline` (Contact panel): a third link in the GitHub ↗ / LinkedIn ↗ row, styled like them (Shuri #68).
 */
export function CvLink({ className = '', variant = 'pill' }: { className?: string; variant?: 'pill' | 'inline' }) {
  const cls = variant === 'pill' ? `cv-link${className ? ` ${className}` : ''}` : `cv-inline${className ? ` ${className}` : ''}`
  return (
    <a className={cls} href={CV_URL} target="_blank" rel="noopener noreferrer" type="application/pdf">
      {content.cv.label}
      <span className="sr-only"> ({content.cv.fileNote})</span>
    </a>
  )
}

/** Year-by-year experience and education (Career panel and Quick version). Years, role, a short summary: no company names. */
export function Experience({ as: H = 'h3' }: { as?: 'h2' | 'h3' }) {
  return (
    <section className="experience" aria-labelledby={`xp-${H}`}>
      <H id={`xp-${H}`}>{content.cv.experienceTitle}</H>
      <ol>
        {content.cv.experience.map((x) => (
          <li key={x.years}>
            <span className="xp-years">{x.years}</span>
            <strong className="xp-role">{x.role}</strong>
            <p className="xp-summary">{x.summary}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}
