/**
 * session-id — validation for the user-controlled sessionId that gets interpolated into a SPARQL query
 * literal in retrieval.ts. A quote or whitespace in this value could rewrite the query (injection), so it
 * is restricted to a safe id charset. Kept in its own pure module so the security check is unit-testable
 * without loading the whole retrieval dependency graph.
 */
export function isSafeSessionId(s: string): boolean {
  return /^[A-Za-z0-9:_-]{1,128}$/.test(s)
}
