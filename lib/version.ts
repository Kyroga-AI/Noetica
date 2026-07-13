/**
 * App version, sourced from package.json at build time (see next.config.mjs env injection) so the UI
 * always shows the shipped version with no manual bump. BUILD_SHA is best-effort (empty in a git-less build).
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0'
export const BUILD_SHA = process.env.NEXT_PUBLIC_BUILD_SHA ?? ''

/** Human label: "v0.4.22" or "v0.4.22 · a1b2c3d" when a build SHA is available. */
export function versionLabel(): string {
  return BUILD_SHA ? `v${APP_VERSION} · ${BUILD_SHA}` : `v${APP_VERSION}`
}
