import { Resvg } from '@resvg/resvg-js'
import { writeFileSync } from 'node:fs'

// Noetica menu-bar tray glyph — a single bold serif HEBREW aleph (U+05D0), centered.
// No subscript: one clean mark reads best at ~18px. Black-on-transparent → macOS
// template (icon_as_template recolors per light/dark bar). Regenerate:
//   node scripts/generate-tray-icon.mjs
const aleph = (size, fill) =>
  `<text x="22" y="35" text-anchor="middle" font-family="'Times New Roman', Georgia, serif" font-weight="700" font-size="42" fill="${fill}">&#1488;</text>`
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">${aleph(44,'#000')}</svg>`
writeFileSync('src-tauri/icons/tray-aleph-template.png',
  new Resvg(svg, { fitTo:{mode:'width',value:44}, font:{loadSystemFonts:true}, background:'rgba(0,0,0,0)' }).render().asPng())

// preview: menu-bar scale (dark) + enlarged
const prev = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="84" viewBox="0 0 300 84">
  <rect width="300" height="34" fill="#1c1c1e"/>
  <text x="14" y="22" font-family="sans-serif" font-size="13" fill="#b9b9bd">Noetica</text>
  <g transform="translate(248,-4) scale(0.5)"><text x="22" y="35" text-anchor="middle" font-family="'Times New Roman',serif" font-weight="700" font-size="42" fill="#f2f2f7">&#1488;</text></g>
  <g transform="translate(110,40)">${aleph(44,'#000')}</g>
</svg>`
writeFileSync('/tmp/aleph-solo.png', new Resvg(prev, { fitTo:{mode:'width',value:300}, font:{loadSystemFonts:true}, background:'rgba(255,255,255,1)' }).render().asPng())
console.log('wrote solo-aleph tray asset + /tmp/aleph-solo.png')
