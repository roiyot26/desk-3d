import { useEffect } from 'react'
import { STOPS, content, contactLinks, text } from './content'

/**
 * Plain HTML version (?view=list, and the automatic fallback when WebGL is missing or fails).
 * Renders the same content.json as the room: fast, printable, recruiter- and crawler-friendly.
 * Order follows the narrative: AI-driven full-stack work first, then 3D for the web.
 */
export function ListView({ webglOk, fallback, phone = false }: { webglOk: boolean; fallback: boolean; phone?: boolean }) {
  useEffect(() => {
    document.title = content.site.title
  }, [])
  const pitch = STOPS.find((s) => s.kind === 'pitch')
  const roomUrl = `${import.meta.env.BASE_URL}?view=room`
  return (
    <main className="list">
      {fallback && <p className="list-note">{content.site.webglFallback}</p>}
      {webglOk && (
        <a className="list-hero" href={roomUrl}>
          <img src={`${import.meta.env.BASE_URL}poster.jpg`} alt="A still of the 3D room: a desk with a monitor and lamps, rain on the window, a neon sign." loading="eager" />
          <span className="btn primary">{content.site.enterRoom} →</span>
        </a>
      )}
      {phone && webglOk && <p className="list-note">{content.site.phoneNote}</p>}
      <header>
        <h1>{content.site.name}</h1>
        <p className="list-role">{content.site.role}</p>
        <p>{content.about.lead}</p>
        <p>{content.about.ai}</p>
        <p>{content.about.next}</p>
      </header>

      <section aria-labelledby="l-projects">
        <h2 id="l-projects">Projects</h2>
        {content.projects.map((p) => (
          <article key={p.slug} id={`project-${p.slug}`}>
            <h3>{p.name}</h3>
            <p className="tagline">{p.tagline}</p>
            <p>{p.serious}</p>
            <p className="joke">{p.joke}</p>
            <p className="links">
              <a href={p.repo}>{p.repo.replace('https://', '')}</a>
              {p.live && (
                <>
                  {' · '}
                  <a href={p.live}>Live demo</a>
                </>
              )}
            </p>
          </article>
        ))}
      </section>

      <section aria-labelledby="l-stack">
        <h2 id="l-stack">Stack</h2>
        <p>{content.skills.intro}</p>
        <ul>
          {[content.skills.featured, ...content.skills.items].map((s) => (
            <li key={s.id}>
              <strong>{s.name}</strong>: {s.line}
            </li>
          ))}
        </ul>
      </section>

      {pitch && (
        <section aria-labelledby="l-3d">
          <h2 id="l-3d">3D for the web</h2>
          {pitch.body.map((p, k) => (
            <p key={k}>{text(p)}</p>
          ))}
        </section>
      )}

      <section aria-labelledby="l-path">
        <h2 id="l-path">Path</h2>
        <ul>
          {content.career.items.map((c, k) => (
            <li key={k}>{c}</li>
          ))}
        </ul>
        <p className="small">{content.career.teaching}</p>
      </section>

      <section aria-labelledby="l-contact">
        <h2 id="l-contact">Contact</h2>
        <ul>
          {contactLinks().map((l) => (
            <li key={l.url}>
              {l.label}: <a href={l.url}>{l.url.replace(/^https?:\/\//, '').replace(/^mailto:/, '')}</a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
