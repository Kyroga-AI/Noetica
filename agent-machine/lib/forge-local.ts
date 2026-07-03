/**
 * forge-local.ts — "point at a folder on my Mac → make it a Gitea repo, in one move".
 *
 * This is the seam the Source surface was missing: agent-machine could fetch REMOTE repos
 * (repo-ingest.ts) but had no way to take a LOCAL directory and push it into the sovereign
 * Gitea forge. Gitea has no file:// migration endpoint, so the real path is:
 *   create empty repo via the API  →  git init/add/commit (if needed)  →  git push over HTTP.
 *
 * Everything runs on the backend (git + filesystem), streamed as SSE progress to the UI.
 * The token is used inline on the push URL only (never persisted into .git/config) and is
 * redacted from every emitted event.
 */
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export interface LocalImportRequest {
  localPath: string
  name?: string            // repo name; defaults to the folder's basename
  owner?: string           // gitea owner; defaults to the token's user (or an org)
  ownerIsOrg?: boolean     // create under an org instead of the user
  description?: string
  private?: boolean
  giteaBase: string        // e.g. http://localhost:3001
  token: string
  defaultBranch?: string   // defaults to the repo's current branch, else 'main'
}

export type Emit = (event: string, data: Record<string, unknown>) => void

const redact = (s: string, token: string) =>
  (token ? s.split(token).join('***') : s).replace(/https?:\/\/[^@/\s]+@/g, 'https://***@')

interface RunResult { code: number; stdout: string; stderr: string }

/** Run a command in cwd, capture output. Never throws — inspect `.code`. */
function run(cmd: string, args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
    let stdout = '', stderr = ''
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    child.on('error', (e) => resolve({ code: -1, stdout, stderr: stderr + String(e) }))
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

const giteaHeaders = (token: string) => ({ Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `token ${token}` })

/**
 * List the immediate subdirectories of `dir` (default: home), flagging which are already
 * git repos — the backend half of an in-app folder picker for "add a local repo".
 */
export async function browseLocal(dir?: string): Promise<{
  path: string
  parent: string | null
  entries: { name: string; path: string; isGitRepo: boolean }[]
}> {
  const target = dir && dir.trim() ? path.resolve(dir) : os.homedir()
  const st = await fs.stat(target).catch(() => null)
  if (!st || !st.isDirectory()) throw new Error('not a directory')
  const dirents = await fs.readdir(target, { withFileTypes: true })
  const entries = await Promise.all(
    dirents
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map(async (d) => {
        const p = path.join(target, d.name)
        const isGitRepo = await fs.stat(path.join(p, '.git')).then((s) => s.isDirectory()).catch(() => false)
        return { name: d.name, path: p, isGitRepo }
      }),
  )
  entries.sort((a, b) => (a.isGitRepo === b.isGitRepo ? a.name.localeCompare(b.name) : a.isGitRepo ? -1 : 1))
  return { path: target, parent: path.dirname(target) === target ? null : path.dirname(target), entries }
}

/**
 * Create a Gitea repo from a local folder and push it. Emits SSE-style events:
 *   step {label}   · created {html_url}   · pushing   · complete {html_url, clone_url, branch}   · error {error}
 */
export async function importLocalRepo(req: LocalImportRequest, emit: Emit): Promise<void> {
  const token = (req.token || '').trim()
  const base = (req.giteaBase || '').replace(/\/$/, '')
  if (!base) { emit('error', { error: 'gitea endpoint not configured' }); return }
  if (!token) { emit('error', { error: 'gitea token not configured (Settings → Connections)' }); return }

  const localPath = path.resolve(req.localPath || '')
  const st = await fs.stat(localPath).catch(() => null)
  if (!st || !st.isDirectory()) { emit('error', { error: `not a directory: ${req.localPath}` }); return }

  const name = (req.name || path.basename(localPath)).replace(/[^\w.-]/g, '-')
  emit('step', { label: `Preparing ${name}…` })

  // Resolve owner (default: the token's user).
  let owner = (req.owner || '').trim()
  if (!owner) {
    const who = await fetch(`${base}/api/v1/user`, { headers: giteaHeaders(token) }).catch(() => null)
    if (!who || !who.ok) { emit('error', { error: `gitea auth failed (${who ? who.status : 'unreachable'}) — check endpoint & token` }); return }
    owner = ((await who.json()) as { login?: string }).login || ''
    if (!owner) { emit('error', { error: 'could not resolve gitea user from token' }); return }
  }

  // 1) Create the (empty) repo. 409 = already exists → reuse it.
  emit('step', { label: `Creating ${owner}/${name} in Gitea…` })
  const createUrl = req.ownerIsOrg ? `${base}/api/v1/orgs/${encodeURIComponent(owner)}/repos` : `${base}/api/v1/user/repos`
  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: giteaHeaders(token),
    body: JSON.stringify({ name, description: req.description || 'Imported from local workstation', private: req.private ?? true, auto_init: false }),
  }).catch(() => null)
  if (!createRes) { emit('error', { error: 'gitea unreachable while creating repo' }); return }
  if (createRes.status === 201) emit('created', { html_url: `${base}/${owner}/${name}` })
  else if (createRes.status === 409) emit('step', { label: `Repo ${owner}/${name} exists — pushing into it` })
  else { const t = await createRes.text().catch(() => ''); emit('error', { error: `create failed (${createRes.status}): ${redact(t, token).slice(0, 200)}` }); return }

  // 2) Ensure the local folder is a git repo with a commit.
  const hasGit = await fs.stat(path.join(localPath, '.git')).then((s) => s.isDirectory()).catch(() => false)
  if (!hasGit) {
    emit('step', { label: 'git init' })
    const init = await run('git', ['init'], localPath)
    if (init.code !== 0) { emit('error', { error: `git init failed: ${redact(init.stderr, token).slice(0, 200)}` }); return }
  }

  // stage everything; commit only if there's something to commit (fresh repo or dirty tree)
  await run('git', ['add', '-A'], localPath)
  const status = await run('git', ['status', '--porcelain'], localPath)
  const headExists = (await run('git', ['rev-parse', '--verify', 'HEAD'], localPath)).code === 0
  if (status.stdout.trim() || !headExists) {
    emit('step', { label: 'Committing working tree' })
    // use existing identity if configured, else a local fallback (import-only)
    const hasEmail = (await run('git', ['config', 'user.email'], localPath)).stdout.trim()
    const idArgs = hasEmail ? [] : ['-c', 'user.name=Noetica', '-c', 'user.email=noetica@localhost']
    const commit = await run('git', [...idArgs, 'commit', '-m', 'Import into Gitea Sovereign'], localPath)
    if (commit.code !== 0 && !headExists) { emit('error', { error: `git commit failed: ${redact(commit.stderr, token).slice(0, 200)}` }); return }
  }

  // 3) Determine branch, set a CLEAN origin (no token on disk), push with an inline-token URL.
  const branch = (req.defaultBranch || (await run('git', ['branch', '--show-current'], localPath)).stdout.trim() || 'main')
  const cleanUrl = `${base}/${owner}/${name}.git`
  const authUrl = `${base.replace(/^(https?:\/\/)/, `$1${encodeURIComponent(token)}@`)}/${owner}/${name}.git`
  const remotes = (await run('git', ['remote'], localPath)).stdout.split(/\s+/)
  await run('git', remotes.includes('origin') ? ['remote', 'set-url', 'origin', cleanUrl] : ['remote', 'add', 'origin', cleanUrl], localPath)

  emit('step', { label: `Pushing ${branch} → ${owner}/${name}` })
  const push = await run('git', ['push', authUrl, `HEAD:refs/heads/${branch}`], localPath)
  if (push.code !== 0) { emit('error', { error: `git push failed: ${redact(push.stderr, token).slice(0, 300)}` }); return }

  // set the pushed branch as default + upstream tracking (best-effort)
  await fetch(`${base}/api/v1/repos/${owner}/${name}`, { method: 'PATCH', headers: giteaHeaders(token), body: JSON.stringify({ default_branch: branch }) }).catch(() => null)
  await run('git', ['branch', `--set-upstream-to=origin/${branch}`, branch], localPath)

  emit('complete', { html_url: `${base}/${owner}/${name}`, clone_url: cleanUrl, owner, name, branch })
}
