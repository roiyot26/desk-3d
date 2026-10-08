import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import content from './src/content/content.json'
import { headTags, noscriptHtml } from './src/content/static'

const SITE_URL = 'https://roiyot26.github.io/desk-3d/'

/** Title, meta and a <noscript> copy of the plain page, all from content.json. */
function contentHtml(): Plugin {
  return {
    name: 'content-html',
    transformIndexHtml(html) {
      return html.replace('<!--HEAD-->', headTags(content, SITE_URL)).replace('<!--NOSCRIPT-->', noscriptHtml(content))
    },
  }
}

const path = (p: string) => decodeURIComponent(new URL(p, import.meta.url).pathname)

export default defineConfig({
  base: '/desk-3d/',
  plugins: [react(), contentHtml()],
  resolve: {
    // `three` -> a shim that re-exports three.js with a Timer-backed Clock (see src/three-shim.ts).
    alias: [
      { find: /^three$/, replacement: path('./src/three-shim.ts') },
      { find: /^three-real$/, replacement: path('./node_modules/three/build/three.module.js') },
    ],
  },
})
