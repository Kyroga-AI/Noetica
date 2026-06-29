/**
 * characterization.ts — deterministic profiling of an onboarded data set (the curation step of the PDOR
 * pipeline). Given a parsed table it infers per-column types, completeness + a quality score, scans for
 * sensitive data (reusing lib/redact's detectors), and detects geospatial + temporal structure — the
 * "characterization services" that examine an asset on entry to the Commons before it is cataloged + aligned.
 *
 * Pure + offline + model-free. The sensitive-data scan delegates to redact() so the SSN/card/email/phone/PII
 * detectors are the single source of truth shared with the egress firewall.
 */

import { redact } from './redact.js'

export interface Table { header: string[]; rows: string[][] }
export type ColType = 'integer' | 'float' | 'boolean' | 'date' | 'string'

export interface ColumnProfile { name: string; type: ColType; count: number; missing: number; completeness: number; purity: number }
export interface Characterization {
  rows: number
  cols: number
  columns: ColumnProfile[]
  quality: number                                  // 0..1 overall (completeness x type purity)
  sensitive: { hasPII: boolean; kinds: Record<string, number>; columns: string[] }
  geospatial: { hasGeo: boolean; latCol?: string; lonCol?: string; locationCols: string[]; geocodablePct: number }
  temporal: { hasTemporal: boolean; columns: string[]; range?: [string, string] }
}

/** Minimal delimited parser (CSV/TSV); honors RFC 4180 double-quoted fields (including embedded newlines). Deterministic, dependency-free. */
export function parseDelimited(text: string, delim = ','): Table {
  const rows: string[][] = []
  let row: string[] = [], cur = '', q = false
  const src = text.replace(/\r\n?/g, '\n')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') q = false
      else cur += c
    } else if (c === '"') { q = true }
    else if (c === delim) { row.push(cur.trim()); cur = '' }
    else if (c === '\n') { row.push(cur.trim()); if (row.some((v) => v !== '')) rows.push(row); row = []; cur = '' }
    else cur += c
  }
  if (cur !== '' || row.length) { row.push(cur.trim()); if (row.some((v) => v !== '')) rows.push(row) }
  if (q) throw new Error('unbalanced quote in delimited input')
  if (rows.length === 0) return { header: [], rows: [] }
  const [head, ...rest] = rows
  return { header: head!, rows: rest }
}

const INT_RE = /^-?\d+$/
const FLOAT_RE = /^-?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?$/
const BOOL_SET = new Set(['true', 'false', 'yes', 'no'])
const DATE_RE = /^(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/

const nonEmpty = (v: string) => v != null && v.trim() !== ''

function inferType(values: string[]): { type: ColType; purity: number } {
  const vals = values.filter(nonEmpty)
  if (vals.length === 0) return { type: 'string', purity: 0 }
  const frac = (re: RegExp | ((s: string) => boolean)) => {
    const test = typeof re === 'function' ? re : (s: string) => re.test(s)
    return vals.filter(test).length / vals.length
  }
  const fInt = frac(INT_RE)
  const fFloat = frac(FLOAT_RE)
  const fBool = frac((s) => BOOL_SET.has(s.toLowerCase()))
  const fDate = frac(DATE_RE)
  // pick the dominant consistent type (>=90% of non-empty cells)
  if (fBool >= 0.9) return { type: 'boolean', purity: fBool }
  if (fInt >= 0.9) return { type: 'integer', purity: fInt }
  if (fDate >= 0.9) return { type: 'date', purity: fDate }
  if (fFloat >= 0.9) return { type: 'float', purity: fFloat }
  return { type: 'string', purity: 1 }   // string is always "pure"
}

const GEO_LAT = /^(lat|latitude|y)$/i
const GEO_LON = /^(lon|lng|long|longitude|x)$/i
const LOC_HINT = /(address|street|city|state|country|zip|postal|region|location|geo)/i
const looksLatLon = (vals: string[], lat: boolean) => {
  const nums = vals.filter(nonEmpty).map(Number).filter((n) => !Number.isNaN(n))
  if (nums.length < 3) return false   // too few values to distinguish coords from scalars
  const lim = lat ? 90 : 180
  if (!nums.every((n) => n >= -lim && n <= lim)) return false
  // Require >50% fractional AND values that span both positive and negative or span >1 degree
  // to distinguish lat/lon from prices, ratios, or percentages that happen to be in range.
  const fractional = nums.filter((n) => n !== Math.round(n)).length / nums.length
  const span = Math.max(...nums) - Math.min(...nums)
  return fractional > 0.5 && span > 1
}

/** Characterize a parsed table: types, completeness/quality, sensitive scan, geospatial + temporal structure. */
export function characterize(t: Table): Characterization {
  const cols = t.header.length
  const rows = t.rows.length
  const col = (i: number) => t.rows.map((r) => r[i] ?? '')

  const columns: ColumnProfile[] = t.header.map((name, i) => {
    const values = col(i)
    const present = values.filter(nonEmpty).length
    const { type, purity } = inferType(values)
    return { name, type, count: present, missing: rows - present, completeness: rows ? Number((present / rows).toFixed(3)) : 0, purity: Number(purity.toFixed(3)) }
  })

  // sensitive scan — reuse redact's detectors over a bounded sample of cell text.
  const sample = t.rows.slice(0, 500).flat().join(' ')
  const { kinds } = redact(sample)
  const piiKinds = ['SSN', 'CARD', 'EMAIL', 'PHONE']
  const sensitiveCols = t.header.filter((_, i) => { const { kinds: k } = redact(col(i).slice(0, 200).join(' ')); return piiKinds.some((kk) => k[kk]) })
  const hasPII = piiKinds.some((k) => kinds[k])

  // geospatial — explicit lat/lon columns, else location-hint columns.
  let latCol: string | undefined, lonCol: string | undefined
  t.header.forEach((name, i) => {
    if (!latCol && (GEO_LAT.test(name) || looksLatLon(col(i), true))) latCol = name
    if (!lonCol && name !== latCol && (GEO_LON.test(name) || looksLatLon(col(i), false))) lonCol = name
  })
  const locationCols = t.header.filter((n) => LOC_HINT.test(n))
  const hasGeo = !!(latCol && lonCol) || locationCols.length > 0
  const geocodableCols = (latCol && lonCol) ? [latCol, lonCol] : locationCols
  const geocodablePct = hasGeo && rows ? Number((geocodableRows(t, geocodableCols) / rows).toFixed(3)) : 0

  // temporal — date-typed columns + overall range.
  const temporalCols = columns.filter((c) => c.type === 'date').map((c) => c.name)
  let range: [string, string] | undefined
  if (temporalCols.length) {
    const idxs = temporalCols.map((n) => t.header.indexOf(n))
    const times = t.rows.flatMap((r) => idxs.map((i) => Date.parse(r[i] ?? ''))).filter((n) => !Number.isNaN(n))
    if (times.length) range = [new Date(Math.min(...times)).toISOString().slice(0, 10), new Date(Math.max(...times)).toISOString().slice(0, 10)]
  }

  const avgCompleteness = columns.length ? columns.reduce((s, c) => s + c.completeness, 0) / columns.length : 0
  const avgPurity = columns.length ? columns.reduce((s, c) => s + c.purity, 0) / columns.length : 0
  const quality = Number((0.6 * avgCompleteness + 0.4 * avgPurity).toFixed(3))

  return {
    rows, cols, columns, quality,
    sensitive: { hasPII, kinds, columns: sensitiveCols },
    geospatial: { hasGeo, latCol, lonCol, locationCols, geocodablePct },
    temporal: { hasTemporal: temporalCols.length > 0, columns: temporalCols, range },
  }
}

function geocodableRows(t: Table, cols: string[]): number {
  if (cols.length === 0) return 0
  const idxs = cols.map((c) => t.header.indexOf(c)).filter((i) => i >= 0)
  return t.rows.filter((r) => idxs.every((i) => nonEmpty(r[i] ?? ''))).length
}
