/** PKCE (RFC 7636) utilities for public-client OAuth flows. */

export async function generateCodeVerifier(): Promise<string> {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return base64urlEncode(array)
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return base64urlEncode(new Uint8Array(digest))
}

export function generateState(): string {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return base64urlEncode(array)
}

function base64urlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export type PkceParams = {
  codeVerifier: string
  codeChallenge: string
  state: string
}

export async function makePkceParams(): Promise<PkceParams> {
  const codeVerifier = await generateCodeVerifier()
  const codeChallenge = await generateCodeChallenge(codeVerifier)
  const state = generateState()
  return { codeVerifier, codeChallenge, state }
}
