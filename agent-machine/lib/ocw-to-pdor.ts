/**
 * ocw-to-pdor.ts — bridge the OCW capture engine to the PDOR onboarding pipeline. A captured open-courseware
 * resource (the data.json shape: license + content + learning_resource_types) becomes a PDOR, so live CC
 * courseware flows through the SAME governed path as everything else: license-gate → characterize → enrich →
 * catalog into the graph.
 *
 * License-aware: MIT OCW is CC-BY-NC-SA. Under the Knowledge Commons context (`commons:true` in evaluatePdor)
 * that is brain-eligible — the commons is non-commercial + share-alike, so the NC/SA obligations are met — while
 * any no-derivatives (ND) course stays segmented (a trained model is a derivative). The license string is parsed
 * deterministically; an unrecognized string is `unknown` → fail-closed (segmented).
 *
 * Pure + offline.
 */

import type { Pdor, LicenseType } from './data-onboarding.js'

export interface OcwResource {
  course: string                       // course slug, e.g. '18-01sc-single-variable-calculus-fall-2010'
  title: string                        // resource/page title
  license: string                      // raw license string or URL from data.json
  url?: string
  resourceId?: string
  learningResourceTypes?: string[]
  content?: string
}

/** Parse an OCW/CC license string (label or URL) → LicenseType. Order matters: check the most-specific first. */
export function parseCcLicense(raw: string): LicenseType {
  const s = (raw || '').toLowerCase().replace(/[\s_]+/g, '-')
  // Require a CC context throughout (cc0 / publicdomain, or a `cc`/`licenses/` prefixed `by-*`) — a bare word
  // like "zero" (Zero-Clause BSD) or "by" (Created by John Doe) must NOT promote to a brain-eligible CC license.
  if (/cc0|public-?domain|publicdomain/.test(s)) return 'cc0'
  const cc = /(^|[-/])cc-?|licenses\//   // a CC marker must be present before a by-* clause
  if (cc.test(s) && /by-nc-sa/.test(s)) return 'cc-by-nc-sa'
  if (cc.test(s) && /by-nc-nd/.test(s)) return 'cc-by-nc-nd'
  if (cc.test(s) && /by-nc/.test(s)) return 'cc-by-nc'
  if (cc.test(s) && /by-sa/.test(s)) return 'cc-by-sa'
  if (cc.test(s) && /by-nd/.test(s)) return 'cc-by-nd'
  if (/(^|[-/])cc-?by([-/]|$)|licenses\/by\//.test(s)) return 'cc-by'
  return 'unknown'   // unrecognized → fail-closed (the gate will segment it)
}

/** Map a captured OCW resource → a PDOR. Open-courseware, attribution always required, SA flagged from license. */
export function ocwResourceToPdor(r: OcwResource, opts: { requester?: string } = {}): Pdor {
  const type = parseCcLicense(r.license)
  return {
    id: `ocw:${r.course}${r.resourceId ? `/${r.resourceId}` : ''}`,
    requester: opts.requester ?? 'ocw-capture',
    intent: 'capture',
    source: { name: r.title || r.course, provider: 'OpenCourseWare', sourceType: 'open-courseware', url: r.url },
    license: { type, termsUrl: /^https?:/.test(r.license) ? r.license : undefined, attribution: type.startsWith('cc-by'), shareAlike: type.includes('-sa') },
    // Open courseware carries no PII by construction; characterization still scans the content downstream.
    classification: {},
  }
}
