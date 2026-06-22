/**
 * path-confine — the ONE confinement predicate for user-supplied file paths.
 *
 * Three sites (the read_file/write_file tools, /api/ingest/path, /api/graph/from-image) each inlined
 * `resolved.startsWith(home) || resolved.startsWith('/tmp')`. Without a trailing separator that admits
 * SIBLINGS: `/Users/alice-evil/...` passes the `/Users/alice` prefix, and `/tmpfoo/...` passes `/tmp`.
 * Anchoring on `path.sep` (and matching the exact root) closes the traversal-confinement gap.
 */
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * True iff `resolved` (an already-`path.resolve`d absolute path) is one of the allowed roots or strictly
 * inside one. Roots: the home dir and the OS temp dir (plus the conventional /tmp and macOS /private/tmp).
 */
export function isConfinedToHomeOrTmp(resolved: string): boolean {
  const roots = [path.resolve(os.homedir()), path.resolve(os.tmpdir()), '/tmp', '/private/tmp']
  return roots.some((r) => resolved === r || resolved.startsWith(r + path.sep))
}
