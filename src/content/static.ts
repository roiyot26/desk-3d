// Build-time HTML from content.json (used by vite.config.ts): <title>, meta tags, and a <noscript>
// copy of the plain page so crawlers and no-JS visitors get the same content.
import raw from './content.json'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

type C = typeof raw

export function headTags(c: C, siteUrl: string) {
  return [
    `<title>${esc(c.site.title)}</title>`,
    `<meta name="description" content="${esc(c.site.description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${esc(c.site.title)}" />`,
    `<meta property="og:description" content="${esc(c.site.description)}" />`,
    `<meta property="og:url" content="${siteUrl}" />`,
    `<meta property="og:image" content="${siteUrl}poster.jpg" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<link rel="canonical" href="${siteUrl}" />`,
  ].join('\n    ')
}

export function noscriptHtml(c: C) {
  const links = [c.contact.github, c.contact.linkedin]
  const pitch = c.stops.find((s) => s.kind === 'pitch')
  return `<main class="list">
<h1>${esc(c.site.name)}</h1><p>${esc(c.site.role)}</p>
<p>${esc(c.about.lead)} ${esc(c.about.nextShort)}</p><p>${esc(c.about.ai)}</p><p>${esc(c.about.practice)}</p>
<h2>Projects</h2>${c.projects
    .map((p) => `<h3>${esc(p.name)}</h3><p>${esc(p.serious)}</p><p><a href="${p.repo}">${esc(p.repo)}</a>${'live' in p && p.live ? ` · <a href="${p.live}">Live demo</a>` : ''}</p>`)
    .join('')}
<h2>Stack</h2><ul>${[c.skills.featured, ...c.skills.items].map((s) => `<li><strong>${esc(s.name)}</strong>: ${esc(s.line)}</li>`).join('')}</ul>
<h2>3D for the web</h2>${(pitch?.body ?? []).map((p) => `<p>${esc(p)}</p>`).join('')}
<h2>Path</h2><ul>${c.career.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p>${esc(c.career.teaching)}</p>
<h2>Contact</h2><ul>${links.map((l) => `<li>${esc(l.label)}: <a href="${l.url}">${esc(l.url)}</a></li>`).join('')}</ul>
</main>`
}
