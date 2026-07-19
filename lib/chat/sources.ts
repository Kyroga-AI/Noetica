// Retrieval sources surfaced to the user must be real knowledge, not dev/test exhaust. The local graph
// is polluted with repo scaffolding (perl release notes, node_modules, test fixtures, changelogs), and
// when retrieval scrapes the bottom of the barrel those leak into the answer's "sources" — making the
// product look broken (e.g. five `perl585delta @ 40%` entries under a product question). Filter them out
// of anything user-facing; they can still exist in the graph, they just don't get shown as provenance.

const JUNK_LABEL = new RegExp(
  [
    '^perl\\w*$',                 // perl561delta, perl585delta, perlhack, perlintern, perldoc…
    'node_modules',
    '\\.(test|spec)\\.',          // test files
    '(^|/)(CHANGELOG|LICENSE|COPYING|AUTHORS)\\b',
    '\\bfixtures?\\b',
    '\\.min\\.(js|css)$',
    '\\.lock$',
    '(^|/)dist/',
  ].join('|'),
  'i',
)

/** True when a retrieval label is dev/test exhaust that should never be shown as an answer source. */
export function isJunkSource(label: string | undefined | null): boolean {
  if (!label) return true
  return JUNK_LABEL.test(label.trim())
}

type Scored = { label?: string; score?: number }

/** Drop junk labels; if every source is junk, return [] rather than showing noise. */
export function cleanSources<T extends Scored>(sources: T[] | undefined | null): T[] {
  if (!sources?.length) return []
  return sources.filter((s) => !isJunkSource(s.label))
}
