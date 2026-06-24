/**
 * safeShellEnv — a minimal, SECRET-FREE environment for agent-run shell commands.
 *
 * run_command / startDevServer spawn a LOGIN shell (`zsh -lc`) that re-sources the user's profile and
 * rebuilds PATH + dev tooling on its own, so the parent only needs to hand down locale/term essentials —
 * NOT process.env, which carries NOETICA_API_TOKEN, provider API keys (ANTHROPIC/OPENAI/…), OAuth tokens,
 * and the at-rest key path. An allowlist (not a denylist) means a newly-introduced secret env var can never
 * silently start leaking: anything not named here simply never crosses into the child.
 *
 * This mirrors the executeCode stripped-env hardening (#240) for the shell path, which was still passing the
 * full parent env — so `run_command` with `env`/`printenv` could read every credential.
 */
const ALLOW = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TMPDIR', 'TZ', 'PWD'] as const

export function safeShellEnv(): NodeJS.ProcessEnv {
  // NODE_ENV set at construction (the project types it as a required, read-only ProcessEnv member).
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env['NODE_ENV'] ?? 'production' }
  for (const k of ALLOW) { const v = process.env[k]; if (v !== undefined) env[k] = v }
  return env
}
