import { content } from './content'
import { CV_URL } from './links'

/**
 * "Download CV": opens the 1-page PDF in a new tab (no `download` attribute, so phones show their PDF
 * viewer instead of a silent save). At least 44 px tall; the file note is for screen readers.
 */
export function CvLink({ className = '' }: { className?: string }) {
  return (
    <a className={`cv-link${className ? ` ${className}` : ''}`} href={CV_URL} target="_blank" rel="noopener noreferrer" type="application/pdf">
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" />
      </svg>
      <span>{content.cv.download}</span>
      <span className="sr-only"> ({content.cv.fileNote})</span>
    </a>
  )
}

/** Year-by-year experience (Career panel and Quick version). Years, role, summary: no company names. */
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
