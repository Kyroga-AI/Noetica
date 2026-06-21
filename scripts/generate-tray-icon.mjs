import { Resvg } from '@resvg/resvg-js'
import { writeFileSync } from 'node:fs'

// ℵ₀ menu-bar tray glyph — aleph-null, HEBREW aleph (U+05D0) in serif to match the N₀
// wordmark, + the zero as a heavy ring (path) so the subscript survives at ~18px. Pure
// black on transparent → macOS template (icon_as_template recolors per menu-bar theme).
// Regenerate: node scripts/generate-tray-icon.mjs
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
  <text x="0" y="32" font-family="'Times New Roman', Georgia, serif" font-weight="700" font-size="38" fill="#000">&#1488;</text>
  <circle cx="35" cy="33" r="6.6" fill="none" stroke="#000" stroke-width="3.8"/>
</svg>`
writeFileSync('src-tauri/icons/tray-aleph-template.png',
  new Resvg(svg, { fitTo:{mode:'width',value:44}, font:{loadSystemFonts:true}, background:'rgba(0,0,0,0)' }).render().asPng())
// preview strip at menu-bar scale + enlarged, on a dark bar
const prev = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80" viewBox="0 0 300 80">
  <rect width="300" height="34" fill="#1c1c1e"/>
  <text x="14" y="22" font-family="sans-serif" font-size="13" fill="#b9b9bd">Noetica</text>
  <g transform="translate(250,4)"><text x="0" y="26" font-family="'Times New Roman',serif" font-weight="700" font-size="22" fill="#f2f2f7">&#1488;</text><circle cx="20" cy="20" r="4" fill="none" stroke="#f2f2f7" stroke-width="2.2"/></g>
  <g transform="translate(120,40)"><text x="0" y="32" font-family="'Times New Roman',serif" font-weight="700" font-size="38" fill="#000"><tspan>&#1488;</tspan></text><circle cx="35" cy="33" r="6.6" fill="none" stroke="#000" stroke-width="3.8"/></g>
</svg>`
writeFileSync('/tmp/tray-final.png', new Resvg(prev, { fitTo:{mode:'width',value:300}, font:{loadSystemFonts:true}, background:'rgba(255,255,255,1)' }).render().asPng())
console.log('wrote tray asset + /tmp/tray-final.png')
