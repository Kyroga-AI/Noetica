/**
 * office-toolkit.ts — view + convert + modify Office documents (docx/xlsx/pptx/odt/…) via the LibreOffice
 * headless toolkit (full-fidelity, local, sovereign). Strategy: DETECT a system LibreOffice (don't bundle
 * ~400MB by default; offer an opt-in install as a lattice-forge RuntimeAsset), convert office → PDF/HTML/PNG
 * for display, and round-trip for edits. Client-side renderers (docx-preview/SheetJS) are the no-LibreOffice
 * fallback for plain viewing. The pure parts (detection paths, command construction, format routing) are
 * unit-tested; the spawn is integration.
 */
export type OfficeFormat = 'pdf' | 'html' | 'png' | 'txt' | 'docx' | 'xlsx' | 'pptx' | 'odt' | 'ods' | 'odp' | 'csv'

/** Office inputs we can view/convert. */
export const VIEWABLE_EXT = ['doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'ods', 'csv', 'ppt', 'pptx', 'odp']

/** Candidate soffice binary locations across platforms (checked in order). */
export const SOFFICE_PATHS = [
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/usr/bin/soffice', '/usr/bin/libreoffice', '/usr/local/bin/soffice',
  '/opt/libreoffice/program/soffice', '/snap/bin/libreoffice',
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'soffice',
]

const ext = (filename: string) => filename.toLowerCase().split('.').pop() ?? ''
export function canView(filename: string): boolean { return VIEWABLE_EXT.includes(ext(filename)) }

/** Best display format for an input: spreadsheets → HTML (selectable cells), docs/slides → PDF. */
export function viewTargetFor(filename: string): OfficeFormat {
  const e = ext(filename)
  if (['xls', 'xlsx', 'ods', 'csv'].includes(e)) return 'html'
  return 'pdf'
}

/** LibreOffice headless conversion args: `soffice --headless --convert-to <fmt> --outdir <dir> <input>`. */
export function convertArgs(input: string, to: OfficeFormat, outdir: string): string[] {
  return ['--headless', '--norestore', '--nologo', '--convert-to', to, '--outdir', outdir, input]
}

/** Find an installed LibreOffice binary — known paths first, then probe PATH (so brew/Linux PATH installs
 * report available, keeping `office-detect` consistent with what `office-convert` can actually spawn). */
export async function detectLibreOffice(): Promise<{ available: boolean; path: string | null }> {
  const { existsSync } = await import('node:fs')
  for (const p of SOFFICE_PATHS) {
    if (p === 'soffice') continue
    try { if (existsSync(p)) return { available: true, path: p } } catch { /* skip */ }
  }
  const onPath = await new Promise<boolean>((resolve) => {
    import('node:child_process').then(({ spawn }) => {
      try {
        const proc = spawn('soffice', ['--version'], { timeout: 5000 })
        proc.on('error', () => resolve(false))
        proc.on('close', (c) => resolve(c === 0))
      } catch { resolve(false) }
    }).catch(() => resolve(false))
  })
  return onPath ? { available: true, path: 'soffice' } : { available: false, path: null }
}

/** Convert an office file to a target format via LibreOffice headless. Returns the output path or an error. */
export async function convertWithLibreOffice(input: string, to: OfficeFormat, outdir: string): Promise<{ ok: boolean; outPath?: string; outputs?: string[]; error?: string }> {
  const det = await detectLibreOffice()
  const bin = det.path ?? 'soffice'
  const { spawn } = await import('node:child_process')
  const path = await import('node:path')
  const { mkdirSync } = await import('node:fs')
  try { mkdirSync(outdir, { recursive: true }) } catch { /* exists */ }
  return new Promise((resolve) => {
    const proc = spawn(bin, convertArgs(input, to, outdir), { timeout: 60_000 })
    let err = ''
    proc.stderr.on('data', (d: Buffer) => { err += d.toString() })
    proc.on('error', () => resolve({ ok: false, error: 'libreoffice_not_found' }))
    proc.on('close', (code) => {
      if (code !== 0) { resolve({ ok: false, error: err.slice(0, 200) || `exit ${code}` }); return }
      // Read the ACTUAL produced files (LibreOffice sanitizes/renames; xlsx→html/pptx→png yield several) —
      // don't guess the name + report ok for a file that doesn't exist.
      void import('node:fs').then(({ readdirSync, existsSync }) => {
        const base = path.basename(input).replace(/\.[^.]+$/, '')
        try {
          const files = readdirSync(outdir).filter((f) => f.startsWith(base + '.'))
          if (files.length) { resolve({ ok: true, outPath: path.join(outdir, files[0]!), outputs: files.map((f) => path.join(outdir, f)) }); return }
        } catch { /* fall through */ }
        const guess = path.join(outdir, `${base}.${to}`)
        resolve(existsSync(guess) ? { ok: true, outPath: guess } : { ok: false, error: 'conversion produced no output' })
      }).catch(() => resolve({ ok: true, outPath: path.join(outdir, `${path.basename(input).replace(/\.[^.]+$/, '')}.${to}`) }))
    })
  })
}
