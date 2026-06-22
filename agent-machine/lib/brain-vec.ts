/**
 * brain-vec — the ONE canonical base64 ⇄ Float32Array codec for brain/corpus vectors.
 *
 * The encode (build-corpus) and decode (study-brain, the bench) were three separate copies of the
 * same byte layout — a dims/endianness drift in any one silently desyncs the brain. Worse, the decode
 * twins built the typed array as a VIEW over the pooled decode Buffer:
 *     new Float32Array(buf.buffer, buf.byteOffset, dims)
 * `Buffer.from(b64,'base64')` allocates from Node's shared 8 KB pool, so `byteOffset` is NOT guaranteed
 * to be a multiple of 4 — but the `(buffer, byteOffset, length)` view constructor REQUIRES it. A
 * non-aligned offset throws RangeError (caught → the chunk is silently dropped from the brain), and a
 * coincidentally-misaligned-but-valid offset aliases neighbouring bytes so every value and the L2 norm
 * are garbage. Decoding through a copied, offset-0 ArrayBuffer sidesteps the alignment trap entirely.
 */

/** Encode a vector to base64 (little-endian Float32, the on-disk brain format). */
export function encodeVec(vec: number[] | Float32Array): string {
  const f = vec instanceof Float32Array ? vec : Float32Array.from(vec)
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength).toString('base64')
}

/**
 * Decode base64 → Float32Array, ALWAYS through a fresh 0-offset ArrayBuffer so the result is
 * 4-byte aligned regardless of where the decode Buffer landed in the pool. `dims`, when given,
 * caps the length (defends a longer-than-expected payload); a shorter payload returns as-is.
 */
export function decodeVec(b64: string, dims?: number): Float32Array {
  const buf = Buffer.from(b64, 'base64')
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) // copy → offset 0, aligned
  const f = new Float32Array(ab)
  return dims && dims < f.length ? f.subarray(0, dims) : f
}

/** L2 norm, floored at 1 so callers can divide safely (a zero vector → norm 1, cosine → 0). */
export function l2norm(v: Float32Array): number {
  let n = 0
  for (let i = 0; i < v.length; i++) n += v[i]! * v[i]!
  return Math.sqrt(n) || 1
}
