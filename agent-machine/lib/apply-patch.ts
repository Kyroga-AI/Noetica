/**
 * apply-patch — the reliable surgical edit primitive (gap #4 vs Claude Code).
 *
 * write_file forces the model to regenerate a whole file to change one line — error-prone
 * on anything non-trivial. Claude Code's reliability comes from exact-string replacement
 * with a UNIQUENESS guarantee: the edit either lands precisely or fails loudly. No fuzzy
 * matching, no silent wrong-line edits. This module is that primitive — pure + testable;
 * the server wires it to an edit_file tool over confined paths.
 */

export type EditResult =
  | { ok: true; content: string; replacements: number }
  | { ok: false; error: string }

export interface EditOptions { replaceAll?: boolean }

/** Count non-overlapping occurrences of needle in haystack. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0
  let n = 0
  let i = haystack.indexOf(needle)
  while (i !== -1) { n++; i = haystack.indexOf(needle, i + needle.length) }
  return n
}

/**
 * Replace oldString with newString in content. Fails (rather than guessing) when:
 *   • oldString is empty or equals newString (no-op),
 *   • oldString is not present,
 *   • oldString appears more than once and replaceAll isn't set (ambiguous — the model
 *     must add surrounding context to make the match unique, exactly like Claude Code).
 */
export function applyEdit(content: string, oldString: string, newString: string, opts: EditOptions = {}): EditResult {
  if (oldString === '') return { ok: false, error: 'old_string must not be empty.' }
  if (oldString === newString) return { ok: false, error: 'old_string and new_string are identical — nothing to change.' }
  const count = countOccurrences(content, oldString)
  if (count === 0) return { ok: false, error: 'old_string not found in the file. Copy the exact text to replace (including whitespace and indentation).' }
  if (count > 1 && !opts.replaceAll) {
    return { ok: false, error: `old_string is not unique — it matches ${count} places. Add surrounding lines so the match is unique, or set replace_all to change every occurrence.` }
  }
  const next = opts.replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString)
  return { ok: true, content: next, replacements: opts.replaceAll ? count : 1 }
}

export interface Edit { oldString: string; newString: string; replaceAll?: boolean }

/**
 * Apply a sequence of edits to content, each validated against the running result so
 * later edits see earlier changes (like MultiEdit). Fails on the first invalid edit and
 * reports which one, leaving the original content untouched (atomic — caller writes only
 * on ok).
 */
export function applyEdits(content: string, edits: Edit[]): EditResult {
  let cur = content
  let total = 0
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i]!
    const r = applyEdit(cur, e.oldString, e.newString, { replaceAll: e.replaceAll })
    if (!r.ok) return { ok: false, error: `edit ${i + 1}/${edits.length}: ${r.error}` }
    cur = r.content
    total += r.replacements
  }
  return { ok: true, content: cur, replacements: total }
}

/** One-line summary of an edit's effect for the tool result. */
export function editSummary(before: string, after: string, replacements: number): string {
  const d = after.split('\n').length - before.split('\n').length
  const delta = d === 0 ? 'no line-count change' : `${d > 0 ? '+' : ''}${d} line${Math.abs(d) === 1 ? '' : 's'}`
  return `${replacements} replacement${replacements === 1 ? '' : 's'}, ${delta}`
}
