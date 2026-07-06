#!/usr/bin/env -S node --import tsx
/**
 * ocw-capture — slow, resumable capture of the FULL MIT OpenCourseWare catalog
 * (~2,577 courses) in priority-tier order, staged through a small local working
 * budget and archived to external storage.
 *
 * The economics: full zips are video-heavy (~300GB for the catalog) but the SUBSTANCE
 * we educate on (PDF text, lecture transcripts, JSON metadata) is a few MB/course. So
 * for every course we: download the zip to staging → extract substance to the kept
 * corpus → ARCHIVE the raw zip to the 4TB disk (or, if no archive disk is mounted,
 * delete it after extraction so the working budget never blows past the cap). The
 * substance is always preserved; the raw zip is preserved iff an archive disk is set.
 *
 * Resumable (manifest-driven, skips done), rate-limited (polite delay), disk-guarded
 * (pauses below a free-space floor). Pure I/O — never loads a model. Safe to run for
 * hours in the background; re-run to continue where it stopped.
 *
 * Env:
 *   OCW_CATALOG   slug list (default ~/Downloads/MIT OCW/_catalog_all_slugs.txt)
 *   OCW_CORPUS    kept substance (default ~/Downloads/MIT OCW/_corpus)
 *   OCW_STAGING   scratch for zips   (default ~/Downloads/ocw-staging)
 *   OCW_ARCHIVE   4TB disk path for raw zips (default '' → delete zip after extract)
 *   OCW_KEEP_ZIPS '1' → keep zips in staging even without an archive disk
 *   OCW_MAX_TIER  highest tier to capture (default 4 = all)
 *   OCW_DEPTS   restrict to these dept codes, comma list (e.g. "18,8,5,7,20,6,12"
 *               = MMLU-STEM only); empty = whole catalog
 *   OCW_DELAY_MS  polite delay between courses (default 3000)
 *   OCW_MIN_FREE_GB  pause below this free space on staging fs (default 15)
 *
 * Usage:  npx tsx scripts/ocw-capture.ts [--tier N] [--limit N] [--dry-run]
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'

const HOME = os.homedir()
const CATALOG = process.env['OCW_CATALOG'] || path.join(HOME, 'Downloads', 'MIT OCW', '_catalog_all_slugs.txt')
const CORPUS = process.env['OCW_CORPUS'] || path.join(HOME, 'Downloads', 'MIT OCW', '_corpus')
const STAGING = process.env['OCW_STAGING'] || path.join(HOME, 'Downloads', 'ocw-staging')
const ARCHIVE = process.env['OCW_ARCHIVE'] || ''
const KEEP_ZIPS = process.env['OCW_KEEP_ZIPS'] === '1'
const DELAY_MS = Number(process.env['OCW_DELAY_MS'] || 3000)
const MIN_FREE_GB = Number(process.env['OCW_MIN_FREE_GB'] || 15)
const MANIFEST = path.join(CORPUS, '_manifest.jsonl')
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

const argTier = (() => { const i = process.argv.indexOf('--tier'); return i >= 0 ? Number(process.argv[i + 1]) : Number(process.env['OCW_MAX_TIER'] || 4) })()
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i >= 0 ? Number(process.argv[i + 1]) : Infinity })()
const DRY = process.argv.includes('--dry-run')

// MIT dept prefix → tier (1 STEM core · 2 eng/applied · 3 quant-social · 4 humanities/other)
const TIER: Record<string, number> = {
  '18': 1, '8': 1, '5': 1, '7': 1, '6': 1, '12': 1, '9': 1, '20': 1,
  '1': 2, '2': 2, '3': 2, '10': 2, '16': 2, '22': 2, hst: 2, esd: 2, mas: 2,
  '14': 3, '15': 3, '11': 3,
}
function dept(slug: string): string {
  const m = slug.match(/^(res|hst|sts|mas|esd|cms|wgs|ec|es|cc)\b/) || slug.match(/^(\d+)/)
  return m ? m[1]! : '?'
}
const tierOf = (slug: string) => TIER[dept(slug)] ?? 4
// Optional dept whitelist (OCW_DEPTS="18,8,5,7,20,6,12" = MMLU-STEM only) — capture
// just the test-relevant departments now and defer the rest of the catalog.
const DEPTS = new Set((process.env['OCW_DEPTS'] || '').split(',').map((d) => d.trim()).filter(Boolean))
const deptAllowed = (slug: string) => DEPTS.size === 0 || DEPTS.has(dept(slug))

interface ManifestRow { slug: string; tier: number; status: string; zip_mb?: number; kept_kb?: number; files?: number; archived?: boolean; ts: string }
function loadDone(): Set<string> {
  const done = new Set<string>()
  if (!fs.existsSync(MANIFEST)) return done
  for (const l of fs.readFileSync(MANIFEST, 'utf8').trim().split('\n').filter(Boolean)) {
    try { const r = JSON.parse(l) as ManifestRow; if (r.status === 'ok' || r.status === 'empty') done.add(r.slug) } catch { /* */ }
  }
  return done
}
function record(r: ManifestRow): void { fs.appendFileSync(MANIFEST, JSON.stringify(r) + '\n') }

function freeGB(p: string): number {
  try {
    // execFileSync (no shell) so a crafted path can't inject a command (js/indirect-command-line-injection).
    const out = execFileSync('df', ['-k', p], { encoding: 'utf8' })
    const last = out.trim().split('\n').pop() ?? ''
    return Number(last.split(/\s+/)[3]) / 1048576
  } catch { return Infinity }
}
function get(url: string): string {
  try { return execFileSync('curl', ['-sL', '-m', '40', '-A', UA, url], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) } catch { return '' }
}
function headOk(url: string): boolean {
  try {
    const out = execFileSync('curl', ['-sIL', '-m', '25', '-A', UA, '-o', '/dev/null', '-w', '%{http_code} %{content_type}', url], { encoding: 'utf8' })
    // OCW's SPA returns 200 + text/html for ANY /courses/*.zip path (the app shell), so a bare 200 is a
    // FALSE positive. Only a real archive (application/zip / octet-stream) counts — most post-migration
    // courses no longer serve one, and this correctly classifies them as 'no zip' instead of downloading
    // the 42KB shell and failing.
    return /^200\b/.test(out.trim()) && /(zip|octet-stream)/i.test(out) && !/text\/html/i.test(out)
  } catch { return false }
}
// OCW migrated to a dynamic site: the /download/ page no longer embeds the absolute .zip URL the old regex
// matched (every course came back "no zip"). The zip now lives at the DEPARTMENT-pathed canonical URL —
// https://ocw.mit.edu/courses/{dept}/{slug}/{slug}.zip — where {dept} is the course page's department slug
// (exposed as /search/?d=<Dept Name>). Derive every candidate dept (courses can be cross-listed), build the
// URL, and HEAD-verify so we only commit to a real 200 (a wrong dept → 404 page saved as .zip → bogus 'empty').
function zipUrl(slug: string): string | null {
  const page = get(`https://ocw.mit.edu/courses/${slug}/`)
  // OCW encodes the dept name with HTML entities (&#43; = the "+" that stands for a space), so capture the
  // WHOLE value up to the closing quote, strip any trailing &l=/&t= search params, decode +/&#43; → space,
  // then slugify to the URL form (e.g. "Electrical Engineering and Computer Science" → that hyphenated path).
  const depts = [...new Set([...page.matchAll(/\/search\/\?d=([^"]+?)"/g)].map((m) =>
    m[1]!.split(/&[a-z]+=/)[0]!
      .replace(/&#43;/g, ' ').replace(/\+/g, ' ').replace(/&amp;/gi, 'and').replace(/&[a-z#0-9]+;/gi, ' ')
      .toLowerCase().trim().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  ).filter(Boolean))]
  for (const dept of depts) {
    const url = `https://ocw.mit.edu/courses/${dept}/${slug}/${slug}.zip`
    if (headOk(url)) return url
  }
  return null
}
const dirSize = (d: string): number => { let t = 0; for (const f of walk(d)) try { t += fs.statSync(f).size } catch { /* */ }; return t }
function walk(d: string): string[] { return fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : [] }

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

async function main() {
  if (!fs.existsSync(CATALOG)) { console.error(`no catalog at ${CATALOG} — fetch the sitemap first`); process.exit(1) }
  fs.mkdirSync(CORPUS, { recursive: true }); fs.mkdirSync(STAGING, { recursive: true })
  const archiveOK = ARCHIVE && fs.existsSync(ARCHIVE)
  if (ARCHIVE && !archiveOK) console.log(`! OCW_ARCHIVE=${ARCHIVE} not mounted — zips will be ${KEEP_ZIPS ? 'kept in staging' : 'deleted after extraction'}`)

  const all = fs.readFileSync(CATALOG, 'utf8').trim().split('\n').map((s) => s.trim()).filter(Boolean)
  const done = loadDone()
  // priority order: tier asc, then slug
  const queue = all.filter((s) => tierOf(s) <= argTier && deptAllowed(s) && !done.has(s)).sort((a, b) => tierOf(a) - tierOf(b) || a.localeCompare(b))
  console.log(`# OCW capture — ${all.length} catalog · ${done.size} done · ${queue.length} queued (tier ≤ ${argTier})`)
  console.log(`# corpus=${CORPUS}  staging=${STAGING}  archive=${archiveOK ? ARCHIVE : '(none)'}  delay=${DELAY_MS}ms\n`)
  if (DRY) { const byT: Record<number, number> = {}; for (const s of queue) byT[tierOf(s)] = (byT[tierOf(s)] || 0) + 1; console.log('queued by tier:', byT); return }

  let n = 0, kept = 0
  for (const slug of queue) {
    if (n >= LIMIT) break
    if (freeGB(STAGING) < MIN_FREE_GB) { console.log(`\n# PAUSED — free space < ${MIN_FREE_GB}GB on staging. Archive/free space and re-run.`); break }
    n++
    const tier = tierOf(slug)
    const url = zipUrl(slug)
    if (!url) { console.log(`  ✗ T${tier} ${slug} — no zip`); record({ slug, tier, status: 'no-zip', ts: new Date().toISOString() }); await sleep(DELAY_MS); continue }
    const zip = path.join(STAGING, `${slug}.zip`)
    try { execFileSync('curl', ['-sL', '-m', '900', '-A', UA, '-o', zip, url], { stdio: 'ignore' }) } catch { /* */ }
    const zb = fs.existsSync(zip) ? fs.statSync(zip).size : 0
    if (zb < 50_000) { try { fs.rmSync(zip) } catch { /* */ }; console.log(`  ✗ T${tier} ${slug} — dl failed`); record({ slug, tier, status: 'dl-fail', ts: new Date().toISOString() }); await sleep(DELAY_MS); continue }

    // extract substance only
    const out = path.join(CORPUS, slug)
    fs.mkdirSync(out, { recursive: true })
    try { execFileSync('unzip', ['-o', '-qq', '-j', zip, '*.pdf', '*.vtt', '*.srt', '*.txt', '*.md', '*.tex', '*.json', '-d', out]) } catch { /* partial ok */ }
    const files = walk(out).length
    const keptKb = Math.round(dirSize(out) / 1024)

    // Archive the raw zip — RE-CHECK the mount every course (not once at startup), so a
    // mid-run disconnect never crashes or stalls: we just leave the zip in staging and
    // keep capturing locally. A later run (or sync-archive.ts) drains staging when the
    // disk is back. Substance is already saved locally regardless.
    let archived = false
    const canArchive = ARCHIVE !== '' && fs.existsSync(ARCHIVE)
    if (canArchive) {
      try { fs.mkdirSync(path.join(ARCHIVE, 'ocw-zips'), { recursive: true }); fs.renameSync(zip, path.join(ARCHIVE, 'ocw-zips', `${slug}.zip`)); archived = true }
      catch { try { fs.copyFileSync(zip, path.join(ARCHIVE, 'ocw-zips', `${slug}.zip`)); fs.rmSync(zip); archived = true } catch { /* leave in staging */ } }
    } else if (ARCHIVE === '' && !KEEP_ZIPS) {
      try { fs.rmSync(zip) } catch { /* */ } // no archive configured → discard (substance kept)
    } // else: archive configured but offline → leave zip in staging for later drain

    kept++
    console.log(`  ✓ T${tier} ${slug} — ${(zb / 1048576).toFixed(0)}MB zip → ${files} files / ${keptKb}KB substance${archived ? ' [archived]' : ''}`)
    record({ slug, tier, status: files ? 'ok' : 'empty', zip_mb: Math.round(zb / 1048576), kept_kb: keptKb, files, archived, ts: new Date().toISOString() })
    await sleep(DELAY_MS)
  }
  console.log(`\n# stop: processed ${n}, captured ${kept}. Re-run to continue (resumable via manifest).`)
}
main().catch((e) => { console.error(e); process.exit(1) })
