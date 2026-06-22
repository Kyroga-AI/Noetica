/**
 * Noetica Agent Machine
 *
 * A standalone Node.js HTTP server that speaks the Noetica SSE wire protocol.
 * Handles the full agentic tool-use loop server-side so the Noetica desktop
 * client receives only streaming text — it does not need to execute tools itself.
 *
 * Endpoints:
 *   GET  /api/status          → capability metadata (Ollama state, model suite)
 *   GET  /api/models          → per-model pull status
 *   GET  /api/graph/health    → HellGraph node/edge counts + WAL path
 *   GET  /api/graph/query     → multi-pattern RAG retrieval
 *   POST /api/graph/ingest    → index an interaction, message, or conversation
 *   POST /api/chat            → full agentic loop, streams Noetica SSE events
 *
 * Built-in tools:
 *   web_search      — DuckDuckGo fallback, Serper when SERPER_API_KEY or request key provided
 *   generate_image  — DALL-E 3 via OpenAI key in request.provider_keys.openai
 *   code_execute    — Python via subprocess, JavaScript via Node vm module
 *
 * Environment:
 *   NOETICA_AM_PORT   — listen port (default 8080)
 *   ANTHROPIC_API_KEY — fallback if request doesn't include provider_keys.anthropic
 *   OPENAI_API_KEY    — fallback if request doesn't include provider_keys.openai
 *   SERPER_API_KEY    — fallback Serper key for web_search
 */

import * as http from 'node:http'
import * as vm from 'node:vm'
import * as cp from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { buildRouterDecision, LOCAL_MODEL_SUITE } from './lib/router.js'
import { checkEgress, authorizeAction as scopedAuthorizeAction, emitScopedTelemetry, type MeshTier } from './lib/scope-d.js'
import { classifyIntent, capabilityToTask, wantsVectorRag, intentByName, planFromIntent, intentToAction } from './lib/intent-router.js'
import { routeForAction, meshrushPhase } from './lib/action-cell.js'
import { selectSurface, cleanLabel } from './lib/graph-surface.js'
import { generateSovereign, meshLadder } from './lib/mesh.js'
import { AGENT_ROLES, DISPATCHABLE_ROLES, resolveRole } from './lib/sub-agent.js'
import { buildReport } from './lib/graph-hygiene.js'
import { TAXONOMY_WORDS } from './lib/slash-topics.js'
import { createSQLiteBackend, migrateJSONLToSQLite } from './lib/sqlite-backend.js'
import { registerStorageNodeRoutes, handleStorageNodeRequest } from './lib/storage-node-routes.js'
import { handleMeshRushRequest } from './lib/meshrush-bridge.js'
import { handleCairnPathRequest } from './lib/cairnpath-adapter.js'
import { syncToSidecar, sidecarHealth } from '@socioprophet/hellgraph'
import { getAtomSpace } from '@socioprophet/hellgraph'
import { decayAll } from '@socioprophet/hellgraph'
import { consolidate } from '@socioprophet/hellgraph'
import { recordAttentionSnapshot, pushSnapshotToPrometheusd, ingestPrometheusCandidate } from '@socioprophet/hellgraph'
import { isOllamaRunning, listLocalModels, pullModel, streamOllama, getModelContextLength, ollamaBase, generateOllamaText } from './lib/ollama.js'
import { parseInlineToolCalls } from './lib/tool-calls.js'
import { retrieve } from './lib/retrieval.js'
import { getGraph, graphHealth, graphSparql, ingestInteraction, ingestConversation, ingestMessage } from './lib/graph.js'
import { isVoiceProvisioned, ensureVoiceSidecar, voiceFetch } from './lib/voice-runtime.js'
import { runOcr } from './lib/ocr.js'
import { getHellGraph, attachRocksDB } from '@socioprophet/hellgraph'
import { runGremlin } from '@socioprophet/hellgraph'
import { buildWorkspacePrefix, invalidatePrefix } from './lib/context-cache.js'
import { estimateCostUsd, tokensEgressed } from '../lib/pricing/modelPricing.js'
import { recordCapability, capabilitySummary, capabilityHint, recordReward, selectArmUCB, serializeCapabilities, hydrateCapabilities, banditStandings, resetCapabilities } from './lib/capability-model.js'
import { validateGraph } from '@socioprophet/hellgraph'
import { CANONICAL_SHAPES, QUARANTINE_PROP } from './lib/canonical-shapes.js'
import { judgeAnswer, type ValueJudgment } from './lib/value-judgment.js'
import { critique, bestOfTemps, type Candidate as CriticCandidate } from './lib/critic.js'
import { programOfThought, codeVerifyRepair } from './lib/exec-verify.js'
import { applyEdit, editSummary } from './lib/apply-patch.js'
import { classifyComplexity as classifyComplexityPosture } from './lib/complexity-discipline.js'
import { detectGoalIntent, slotFill, buildGoalContext, getActiveGoal, listGoals, saveGoal, type Goal } from './lib/goal-model.js'
import { assessAgainstGraph } from './lib/pln-judgment.js'
import { saveCheckpoint, listCheckpoints, getCheckpoint, buildResumeMessages } from './lib/checkpoint-model.js'
import { recordQualitySample, analyzeDrivers, qualitySamples, serializeQuality, hydrateQuality, worthTrend, resetQuality } from './lib/quality-sr.js'
import {
  ensureMichaelTwin, ingestGaiaObservation, getRecentObservations,
  writeBeliefSnapshot, writeWorldStateSnapshot, writeCycleNode,
  getTwinState, getRecentBeliefs, getRecentLaws, getRecentWorldStates,
  type GaiaObservationPayload, type BeliefSynthesis,
} from './lib/gaia.js'

const PORT = parseInt(process.env['NOETICA_AM_PORT'] ?? '8080', 10)
const VERSION = '0.4.11'

// ─── Model progress SSE ───────────────────────────────────────────────────────

const _modelProgressClients = new Set<http.ServerResponse>()

function broadcastModelProgress(payload: object): void {
  const msg = `data: ${JSON.stringify(payload)}\n\n`
  for (const res of _modelProgressClients) {
    try { (res as unknown as { write: (s: string) => void }).write(msg) } catch { _modelProgressClients.delete(res) }
  }
}

// ─── Governance run ring buffer ───────────────────────────────────────────────
// Keeps the last 100 completed run traces for the Govern surface.
interface GovernanceRun {
  run_id: string
  model_routed: string
  provider: string
  policy_admitted: boolean
  memory_written: boolean
  timestamp: string
  latency_ms: number
  input_tokens?: number
  output_tokens?: number
  cost_usd?: number          // estimated USD cost (0 for local providers)
  tokens_egressed?: number   // tokens that left the device (0 for local — sovereignty)
  task?: string
  session_id?: string
  error?: string   // set on failed runs — enables error-rate visibility in GovernSurface
}
const _governanceRuns: GovernanceRun[] = []
const GOVERNANCE_RING_SIZE = 100
// Persist the ring to disk so the Govern surface's audit trail survives a relaunch —
// it was in-memory only, so Govern was always empty after restart even after chatting.
const GOVERNANCE_FILE = path.join(os.homedir(), '.noetica', 'governance.json')

// Cross-process signal for the SourceOS surface (e.g. bearbrowser): when the
// security lane is armed, bearbrowser auto-enables Tor for anonymized egress.
// Written to the shared SourceOS config dir so the browser can poll it without
// coupling to this server. tor mirrors armed — armed work routes over Tor.
const SECURITY_STATE_FILE = path.join(os.homedir(), '.config', 'sourceos', 'noetica', 'security-state.json')
let lastSecurityArmed: boolean | null = null
function writeSecurityState(armed: boolean): void {
  if (armed === lastSecurityArmed) return  // only write on transition
  lastSecurityArmed = armed
  try {
    fs.mkdirSync(path.dirname(SECURITY_STATE_FILE), { recursive: true })
    // Fixed path; only sanitized booleans are written — no untrusted content reaches the file.
    fs.writeFileSync(SECURITY_STATE_FILE, JSON.stringify({
      armed: armed === true, tor: armed === true, updated_at: new Date().toISOString(), source: 'noetica-agent-machine',
    }, null, 2), { mode: 0o600 })
  } catch { /* signal is best-effort — never block a chat on it */ }
}
function readSecurityState(): unknown {
  try { return JSON.parse(fs.readFileSync(SECURITY_STATE_FILE, 'utf8')) }
  catch { return { armed: false, tor: false, updated_at: null, source: 'noetica-agent-machine' } }
}
try {
  const arr = JSON.parse(fs.readFileSync(GOVERNANCE_FILE, 'utf8'))
  if (Array.isArray(arr)) _governanceRuns.push(...(arr as GovernanceRun[]).slice(-GOVERNANCE_RING_SIZE))
} catch { /* no prior governance log */ }
let _govSaveTimer: ReturnType<typeof setTimeout> | null = null
function saveGovernance(): void {
  if (_govSaveTimer) return
  _govSaveTimer = setTimeout(() => {
    _govSaveTimer = null
    try { fs.mkdirSync(path.dirname(GOVERNANCE_FILE), { recursive: true }); fs.writeFileSync(GOVERNANCE_FILE, JSON.stringify(_governanceRuns)) } catch { /* best-effort */ }
  }, 1500)
  _govSaveTimer.unref?.()
}

// Ontogenesis SHACL write-validation gate (report-only). Last validation result,
// refreshed after ingest when NOETICA_SHACL_ENFORCE=1.
let _lastShaclReport: { conforms: boolean; violations: number; checked_at: string } | null = null

// Contradiction ledger (ProCybernetica EpiCybernetica): when Value Judgment finds
// an answer at odds with a promoted belief/law we PRESERVE it as a control signal
// rather than discard it. Bounded ring; surfaced via /api/epistemic/contradictions.
interface ContradictionRecord {
  id: string
  run_id: string
  session_id: string
  kind: 'belief' | 'law'
  statement: string
  detail: string
  answer_preview: string
  timestamp: string
}
const _contradictions: ContradictionRecord[] = []
const CONTRADICTION_RING_SIZE = 200
// Load the symbolic world model (GAIA beliefs + candidate laws) for Value Judgment.
function loadWorldModelForVJ(): { beliefs: Array<{ claim: string }>; laws: Array<{ law: string; confidence: number }> } {
  const beliefs: Array<{ claim: string }> = []
  try {
    const snap = getRecentBeliefs(1)[0]
    if (snap) {
      const focus = String(snap.props['current_focus'] ?? '').trim()
      if (focus) beliefs.push({ claim: focus })
      try {
        const posts = JSON.parse(String(snap.props['posterior_atoms'] ?? '[]')) as Array<{ claim?: string }>
        for (const p of posts) if (p.claim) beliefs.push({ claim: p.claim })
      } catch { /* unparseable posterior_atoms */ }
    }
  } catch { /* beliefs unavailable */ }
  let laws: Array<{ law: string; confidence: number }> = []
  try {
    laws = getRecentLaws(20).map((l) => ({
      law: String(l.props['law'] ?? ''),
      confidence: Number(l.props['confidence'] ?? 0),
    })).filter((l) => l.law)
  } catch { /* laws unavailable */ }
  return { beliefs, laws }
}

function recordContradictions(runId: string, sessionId: string, vj: ValueJudgment, answer: string): void {
  for (const c of vj.contradictions) {
    _contradictions.push({
      id: crypto.randomUUID(),
      run_id: runId,
      session_id: sessionId,
      kind: c.kind,
      statement: c.statement,
      detail: c.detail,
      answer_preview: answer.slice(0, 200),
      timestamp: new Date().toISOString(),
    })
    if (_contradictions.length > CONTRADICTION_RING_SIZE) _contradictions.shift()
  }
}

function runShaclGate(): void {
  if (process.env['NOETICA_SHACL_ENFORCE'] !== '1') return
  try {
    const g = getHellGraph()
    const report = validateGraph(g, CANONICAL_SHAPES)
    // Enforce by QUARANTINE: tag violating entities so retrieval/reasoning skip
    // them. This never blocks a chat — malformed atoms just stop polluting context.
    let quarantined = 0
    for (const v of report.violations) {
      const node = g.getNode(v.focusNode)
      if (node && node.properties[QUARANTINE_PROP] !== 'true') {
        g.addNode(v.focusNode, [], { [QUARANTINE_PROP]: 'true' })
        quarantined++
      }
    }
    _lastShaclReport = {
      conforms: report.conforms,
      violations: report.violations.length,
      checked_at: new Date().toISOString(),
    }
    if (!report.conforms) {
      console.warn(`[ontogenesis] SHACL gate: ${report.violations.length} violation(s); quarantined ${quarantined} entity(ies)`)
    }
  } catch (e) {
    console.warn('[ontogenesis] SHACL gate error', e instanceof Error ? e.message : String(e))
  }
}

// Tracks how many async ingest tasks are currently in-flight, so the health
// endpoint can report a real pendingIngestCount instead of a hardcoded 0.
let _pendingIngestCount = 0

function trackIngest<T>(p: Promise<T> | T): Promise<T> {
  _pendingIngestCount++
  return Promise.resolve(p).finally(() => { _pendingIngestCount = Math.max(0, _pendingIngestCount - 1) })
}

function recordGovernanceRun(run: GovernanceRun): void {
  _governanceRuns.push(run)
  if (_governanceRuns.length > GOVERNANCE_RING_SIZE) _governanceRuns.shift()
  saveGovernance()
  // Update the self-model: track per-task/model success + latency over time.
  recordCapability({
    task: run.task,
    provider: run.provider,
    model: run.model_routed,
    latencyMs: run.latency_ms,
    error: Boolean(run.error),
    costUsd: run.cost_usd,
  })
}

// ─── GAIA / Superconscious loop ───────────────────────────────────────────────
// Runs every LOOP_INTERVAL_MS. Reads recent GaiaObservations from HellGraph,
// synthesises a belief snapshot via LLM, extracts candidate laws, and writes
// a WorldStateSnapshot — closing the observe → believe → model cycle.

const LOOP_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
let _loopRunning = false
let _loopEnabled = false
let _lastLoopAt: string | null = null

interface LoopProviderKeys {
  anthropic?: string
  openai?: string
}

// The prompt that drives the superconscious synthesis step.
function buildSuperconsciousPrompt(observations: Array<{ id: string; props: Record<string, unknown> }>, previousBelief: string): string {
  const obsLines = observations.map((o, i) =>
    `[${i + 1}] ${o.props['captured_at']} | app: ${o.props['app_context']} | goal: ${o.props['goal']} | summary: ${o.props['step_summary']} | tags: ${o.props['attention_tags']}`
  ).join('\n')

  return `You are the superconscious synthesis layer for Michael Heller's digital twin. Your role is to integrate recent computer-use observations into a coherent, updated belief state about what Michael is focused on, what patterns are emerging, and how his world model should be updated.

Previous belief summary: ${previousBelief || '(none — first cycle)'}

Recent observations (most recent last):
${obsLines}

Respond with a JSON object matching this schema exactly:
{
  "current_focus": "short phrase describing Michael's primary current focus",
  "focus_confidence": 0.0-1.0,
  "posterior_atoms": [{"claim": "string", "weight": 0.0-1.0}],
  "weighted_rules": [{"pattern": "if X then Y", "support": 0.0-1.0}],
  "hypotheses": [{"hypothesis": "string", "evidence": ["obs ref"]}],
  "candidate_laws": [{"law": "string", "trigger": "what triggers this pattern", "confidence": 0.0-1.0}],
  "world_state_summary": "2-3 sentence description of Michael's world state right now"
}

Rules:
- posterior_atoms: 3-7 weighted belief statements about what Michael is doing/thinking
- weighted_rules: 1-4 behavioural patterns you can infer (e.g. "when Michael opens email, Slack is usually already active")
- hypotheses: 1-3 higher-level hypotheses worth tracking
- candidate_laws: 0-3 durable patterns worth remembering across sessions (high bar — only emit if pattern is clear)
- Respond ONLY with valid JSON. No preamble.`
}

// Local synthesis fallback so the GAIA belief loop runs in a pure-local setup.
// Picks a tool-capable general model from what's installed; non-streaming call.
async function synthesizeViaOllama(prompt: string): Promise<string> {
  const installed = await listLocalModels()
  if (installed.length === 0) return ''
  const preferred = ['qwen2.5:14b', 'qwen2.5:7b', 'deepseek-r1:8b', 'llama3.2:3b']
  const model = preferred.find((p) => installed.includes(p)) ?? installed[0]!
  try {
    const res = await fetch(`${ollamaBase()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [{ role: 'user', content: prompt }],
        options: { num_ctx: 8192, temperature: 0.4 },
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) return ''
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    // Strip any <think> reasoning block local models may emit before the JSON.
    return (data.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  } catch {
    return ''
  }
}

async function runSuperconsciousLoop(keys: LoopProviderKeys): Promise<void> {
  const hasCloud = Boolean(keys.anthropic?.trim() || keys.openai?.trim())
  const ollamaUp = hasCloud ? false : await isOllamaRunning()
  if (!hasCloud && !ollamaUp) {
    console.error('[gaia] runSuperconsciousLoop: no cloud keys and Ollama not running — synthesis disabled')
    return
  }
  if (_loopRunning) return
  _loopRunning = true
  try {
    ensureMichaelTwin()
    const observations = getRecentObservations(20)
    if (observations.length === 0) return

    // Get previous belief summary for continuity
    const prevBeliefs = getRecentBeliefs(1)
    const prevSummary = prevBeliefs[0] ? String(prevBeliefs[0].props['world_summary'] ?? '') : ''

    const prompt = buildSuperconsciousPrompt(observations, prevSummary)
    const cycleId = `urn:gaia:cycle:${Date.now()}`

    // Run synthesis — prefer Anthropic, fall back to OpenAI
    let synthesisText = ''
    if (keys.anthropic) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': keys.anthropic, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(30000),
      })
      if (res.ok) {
        const data = await res.json() as { content?: Array<{ type: string; text: string }> }
        synthesisText = data.content?.find((b) => b.type === 'text')?.text ?? ''
      }
    } else if (keys.openai) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'authorization': `Bearer ${keys.openai}` },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: 1024 }),
        signal: AbortSignal.timeout(30000),
      })
      if (res.ok) {
        const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
        synthesisText = data.choices?.[0]?.message?.content ?? ''
      }
    } else {
      // Pure-local synthesis via Ollama.
      synthesisText = await synthesizeViaOllama(prompt)
    }

    if (!synthesisText) return

    // Parse synthesis — extract JSON from potential prose wrapping
    let synthesis: BeliefSynthesis | null = null
    try {
      const jsonMatch = synthesisText.match(/\{[\s\S]*\}/)
      if (jsonMatch) synthesis = JSON.parse(jsonMatch[0]) as BeliefSynthesis
    } catch (e) {
      console.error('[gaia] superconscious synthesis parse failed', String(e))
      return
    }
    if (!synthesis) return

    const beliefId     = writeBeliefSnapshot(synthesis, cycleId)
    const worldStateId = writeWorldStateSnapshot(synthesis.world_state_summary, observations.map((o) => o.id), cycleId)
    writeCycleNode(cycleId, observations.map((o) => o.id), beliefId, worldStateId)
    _lastLoopAt = new Date().toISOString()
    console.log(`[gaia] superconscious cycle complete — focus: "${synthesis.current_focus}" laws: ${synthesis.candidate_laws.length}`)
  } catch (err) {
    console.error('[gaia] superconscious loop error', String(err))
  } finally {
    _loopRunning = false
  }
}

function startSuperconsciousLoop(keys: LoopProviderKeys): void {
  if (_loopEnabled) return
  _loopEnabled = true
  ensureMichaelTwin()
  // Run immediately then on interval
  void runSuperconsciousLoop(keys)
  setInterval(() => { void runSuperconsciousLoop(keys) }, LOOP_INTERVAL_MS)
  console.log(`[gaia] superconscious loop started (interval: ${LOOP_INTERVAL_MS / 60000}m)`)
}

// ─── Noetica identity ─────────────────────────────────────────────────────────

const NOETICA_SYSTEM_PROMPT = `You are Michael. You are a local AI agent running inside the Noetica platform — a sovereign local-first AI workstation built by SocioProphet. Noetica is the platform. You are Michael, the agent that runs inside it. You are not ChatGPT, not Claude, not Gemini, not Ollama. If asked what you are, say you are Michael — an AI agent running locally on the user's machine via the Noetica platform.

## Who you are
You are the primary agent of the Noetica platform. You run entirely on the user's hardware via the prophet-mesh local model routing layer. Every conversation, every thought you have, stays on this machine. Nothing leaves unless the user explicitly routes to a cloud model. You are local, private, and sovereign by design.

## How you behave
- Direct and precise. No filler. No "Certainly!", "Great question!", "As an AI language model", or "I don't have access to real-time information" (you have tools for that).
- Intellectually serious. Reason carefully before answering. Think through problems step by step.
- Honest about uncertainty. Say "I don't know" rather than hallucinate. Say "I'd need to check" rather than guess.
- Terse when the task is simple. Thorough when depth is warranted. Match the weight of your response to the weight of the question.
- Never apologize for your limitations at the start of a response. Just answer.

## Your capabilities
- **Memory**: Persistent memory via HellGraph — an AtomSpace knowledge graph that stores entities, relationships, and prior context. Relevant memories are injected into context automatically.
- **Tools**: When the user asks you to search, find files, run code, browse the web, or take actions — use your tools. Do not simulate tool results.
- **Local models**: Tasks route to specialist models. Coding goes to qwen2.5-coder. Reasoning goes to deepseek-r1. Vision goes to llava when images are present.
- **Cloud augmentation**: When a cloud API key is configured, tasks that exceed local capability can route to Claude or GPT. This is opt-in.

## Response rules
- Short messages (greetings, reactions, simple questions under 10 words): respond in 1-3 sentences. No tools.
- Code requests: return working code. No preamble. Show the code first, explain after if needed.
- Research/analysis: think step by step. Be specific. Cite uncertainty where it exists.
- Do NOT start responses with "I", "As Michael", or the user's name.
- Do NOT add disclaimers like "please consult a professional" unless the situation is genuinely dangerous.
- Format with markdown when it aids readability (code blocks, headers, lists). Plain prose for conversational replies.`


// ─── Prime-topic policy profiles ─────────────────────────────────────────────
// Maps policy_profile names to prime-topic vectors + authorization context.
// Aligned to Identity Is Prime citizen-fog authorization model.
// All profiles operate in CITIZEN_FOG scope (sovereign local compute).
// Forbidden-pair constraints only apply at cross-scope boundaries — within the
// fog, the citizen has full authorization for their stated prime context.

interface PolicyProfile {
  primes: string[]
  scope: 'CITIZEN_FOG' | 'CITIZEN_CLOUD' | 'INSTITUTION'
  authorizationSuffix: string
}

const POLICY_PROFILES: Record<string, PolicyProfile> = {
  default: {
    primes: ['CITIZEN'],
    scope: 'CITIZEN_FOG',
    authorizationSuffix: '',
  },
  research: {
    primes: ['CITIZEN', 'RESEARCHER', 'ENGINEER'],
    scope: 'CITIZEN_FOG',
    authorizationSuffix: `

Authorization context (CITIZEN_FOG / RESEARCHER + ENGINEER):
You are operating in a sovereign local-first research context. The user has RESEARCHER and ENGINEER primes active. Discuss all topics appropriate to this authorization — academic research, dual-use technologies, experimental methods, technical depth — without consumer-facing restrictions or unnecessary hedging. This is an authorized research workspace on sovereign compute.`,
  },
  security: {
    primes: ['CITIZEN', 'SECURITY_RESEARCHER', 'ENGINEER'],
    scope: 'CITIZEN_FOG',
    authorizationSuffix: `

Authorization context (CITIZEN_FOG / SECURITY_RESEARCHER + ENGINEER):
You are operating in a sovereign local-first security research context. The user has SECURITY_RESEARCHER and ENGINEER primes active. Discuss vulnerability research, offensive security techniques, exploit development, adversarial ML, reverse engineering, CTF challenges, and dual-use security topics with full technical depth. This is an authorized security research workspace on sovereign compute. Provide technically precise answers without disclaimers appropriate for untrained users.`,
  },
  enterprise: {
    primes: ['OPERATOR', 'ENGINEER'],
    scope: 'CITIZEN_FOG',
    authorizationSuffix: `

Authorization context (CITIZEN_FOG / OPERATOR + ENGINEER):
You are operating in an enterprise operator context on sovereign local compute. The user has OPERATOR and ENGINEER primes active. Respond without consumer hedging. Assume full technical sophistication. Omit disclaimers for untrained users. Engage directly with operational, architectural, and business-critical questions.`,
  },
  medical: {
    primes: ['CITIZEN', 'HEALTH', 'RESEARCHER'],
    scope: 'CITIZEN_FOG',
    authorizationSuffix: `

Authorization context (CITIZEN_FOG / HEALTH + RESEARCHER):
You are operating in a health research context on sovereign local compute. The user has HEALTH and RESEARCHER primes active. Discuss clinical topics, drug interactions, treatment protocols, diagnostic criteria, and medical research with professional precision. This is not a consumer health context — respond at the level of a clinical researcher.`,
  },
  strict: {
    primes: ['CITIZEN'],
    scope: 'CITIZEN_FOG',
    authorizationSuffix: `

Authorization context (CITIZEN_FOG / STRICT):
You are operating under strict policy. Apply conservative, precise reasoning. Every factual claim must be clearly evidenced or hedged. Avoid speculation. When uncertain, say so explicitly. Prefer concise, defensible responses over broad assertions.`,
  },
  permissive: {
    primes: ['CITIZEN', 'RESEARCHER', 'ENGINEER', 'SECURITY_RESEARCHER'],
    scope: 'CITIZEN_FOG',
    authorizationSuffix: `

Authorization context (CITIZEN_FOG / PERMISSIVE):
You are operating in an unrestricted research mode on sovereign local compute. All prime contexts are active. There are no consumer-facing restrictions. Engage fully with any topic the user raises — technical, dual-use, experimental, or adversarial — with appropriate depth and precision. This is an authorized research environment.`,
  },
}

// ─── Tool-use instructions for local models ───────────────────────────────────
// Local models (Ollama) frequently hallucinate tool call formats or forget to
// use tools entirely. These few-shot instructions dramatically improve reliability.

const TOOL_USE_INSTRUCTIONS = `

When you need to use a tool, respond ONLY with a tool call in this exact JSON format — no other text before or after:
<tool_call>
{"name": "tool_name", "arguments": {"param": "value"}}
</tool_call>

Rules:
- Call ONE tool at a time
- Wait for the result before proceeding
- If you don't need a tool, just respond in plain text
- Never invent tool results — wait for the actual response`

// ─── Types ────────────────────────────────────────────────────────────────────

interface ToolUseBlock {
  id: string
  name: string
  input: Record<string, unknown>
}

interface ProviderTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

interface ChatMessageAttachment {
  kind: 'image' | 'pdf' | 'text' | 'code' | 'binary'
  base64: string
  mimeType: string
  name: string
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  attachments?: ChatMessageAttachment[]
}

interface ChatRequest {
  session_id?: string
  conversation_id?: string
  model_id?: string
  messages?: ChatMessage[]
  system_prompt?: string
  policy_profile?: string
  security_attested?: boolean  // operator self-attestation — arms the uncensored security lane
  tools?: ProviderTool[]
  thinking_budget?: number
  temperature?: number
  max_tokens?: number
  reply_length?: 'short' | 'medium' | 'long'
  agent_mode?: 'auto' | 'plan' | 'ask'
  provider_keys?: {
    anthropic?: string
    openai?: string
    serper?: string
    google?: string
    mistral?: string
    neuronpedia?: string
  }
}

// Anthropic message types for the agentic loop
type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }

type AnthropicMessage = {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

// OpenAI message types
type OpenAIMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OAIToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string }

interface OAIToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

// Streaming events from our internal provider generators
export type ProviderEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_calls'; calls: ToolUseBlock[] }

export type { ProviderTool, ToolUseBlock }

// ─── Built-in tool definitions ────────────────────────────────────────────────

const BUILTIN_TOOLS: ProviderTool[] = [
  {
    name: 'web_search',
    description:
      'Search the web for current information. Returns a ranked list of results with titles, URLs, and snippets.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'public_data',
    description:
      'Fetch a time series from a FREE public data source (no API key) and return rows ready to chart with render_chart. Sources: "crypto" (CoinGecko — coin price history), "fx" (Frankfurter — currency exchange-rate history), "worldbank" (economic indicators by country, e.g. GDP, population), or "csv" (any public CSV URL). Use for "chart bitcoin over 30 days", "USD to EUR this year", "US GDP since 2000", or charting any open dataset.',
    input_schema: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: ['crypto', 'fx', 'worldbank', 'csv'], description: 'Which public source to pull from.' },
        coin: { type: 'string', description: 'crypto: CoinGecko id, e.g. bitcoin, ethereum, solana.' },
        vs: { type: 'string', description: 'crypto: quote currency (default usd).' },
        days: { type: 'string', description: 'crypto: history length in days (default 30; or "max").' },
        from: { type: 'string', description: 'fx: base currency, e.g. USD.' },
        to: { type: 'string', description: 'fx: quote currency, e.g. EUR.' },
        start: { type: 'string', description: 'fx: start date YYYY-MM-DD.' },
        end: { type: 'string', description: 'fx: end date YYYY-MM-DD.' },
        indicator: { type: 'string', description: 'worldbank: indicator code, e.g. NY.GDP.MKTP.CD (GDP), SP.POP.TOTL (population).' },
        country: { type: 'string', description: 'worldbank: ISO country code, e.g. US, CN, DE (default US).' },
        url: { type: 'string', description: 'csv: full https URL to a public CSV file.' },
      },
      required: ['source'],
    },
  },
  {
    name: 'render_chart',
    description:
      'Render a chart INLINE from data rows. Provide the data + which fields map to axes; give a chart type or a charting intent (resolved against the catalogue). Use this to SHOW analysis as a chart instead of a table. Pair with code_execute (compute the data) + registry_lookup (pick the spec).',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['line', 'bar', 'area', 'scatter', 'pie', 'histogram'] },
        query: { type: 'string', description: 'Charting intent if type omitted, e.g. "revenue over time".' },
        data: { type: 'array', items: { type: 'object' }, description: 'Row objects, e.g. [{"month":"Jan","revenue":120}, …].' },
        x: { type: 'string' }, y: { type: 'string' }, category: { type: 'string' }, value: { type: 'string' },
        title: { type: 'string' },
      },
      required: ['data'],
    },
  },
  {
    name: 'remember',
    description:
      'Save a durable fact, preference, or piece of context to your own LOCAL memory so you recall it in future conversations. Use whenever the user tells you something to keep ("remember that…", "I prefer…", "from now on…", "my name is…") or when you learn a stable fact worth retaining. Memory is stored in the local knowledge graph and surfaced automatically on future relevant turns.',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The fact or preference to remember, written as a clear standalone sentence.' },
        kind: { type: 'string', enum: ['preference', 'fact', 'identity'], description: 'What kind of memory this is (default: fact).' },
      },
      required: ['content'],
    },
  },
  {
    name: 'ocr',
    description:
      'Extract text from an image FILE on disk using on-device OCR (macOS Vision — fully local, no network). Use to read text in a screenshot, photo, scanned doc, or diagram. Returns the recognized text.',
    input_schema: {
      type: 'object',
      properties: {
        image_path: { type: 'string', description: 'Absolute path to the image file (png, jpg, etc.).' },
      },
      required: ['image_path'],
    },
  },
  {
    name: 'generate_image',
    description:
      'Generate an image from a text description using DALL-E 3. Returns a markdown image tag with the URL.',
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Detailed description of the image to generate' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'code_execute',
    description:
      'Execute Python or JavaScript code. Python sessions are persistent — variables and imports persist between calls. matplotlib charts are auto-saved. Returns stdout, exit_code, and any generated files as base64.',
    input_schema: {
      type: 'object',
      properties: {
        language: { type: 'string', enum: ['python', 'javascript'] },
        code:     { type: 'string', description: 'The code to execute' },
        session_id: { type: 'string', description: 'Optional session ID for persistent Python state' },
      },
      required: ['language', 'code'],
    },
  },
  {
    name: 'run_command',
    description:
      'Run a shell command in a sandboxed PROJECT WORKSPACE (a real working directory under ~/.noetica/workspaces). Use this to scaffold projects, install deps, build, run tests, lint, git, and run dev tasks (npm, node, pnpm, python, cargo, git…). Returns stdout, stderr, and the exit code. Confined to the workspace; privileged/destructive commands are blocked. Commands in the same workspace share state (created files persist).',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to run.' },
        workspace: { type: 'string', description: 'Workspace name (default "default") — all commands for one project should share it.' },
        timeout_ms: { type: 'number', description: 'Max runtime in ms (default 60000, max 300000).' },
      },
      required: ['command'],
    },
  },
  {
    name: 'registry_lookup',
    description:
      'Look up reusable CATALOGUE entries (chart specs by domain/intent, project scaffolds, connectors) before building analysis, charts, or apps from scratch. E.g. "revenue over time" → a ready time-series chart spec to populate with data; "build a dashboard" → the scaffold template. Returns matching entries with their fillable params + spec.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What you want to make (intent/domain), e.g. "compare sales by region".' },
        kind: { type: 'string', enum: ['chart', 'template', 'connector', 'asset', 'crawl'], description: 'Optional filter.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a local file as text (≤ 2 MB). Returns the file content.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or home-relative (~) path to the file' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write text content to a local file. Creates parent directories as needed.',
    input_schema: {
      type: 'object',
      properties: {
        path:    { type: 'string', description: 'Absolute or home-relative (~) path' },
        content: { type: 'string', description: 'Text content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Make a SURGICAL edit to a file: replace an exact string with a new one. Prefer this over write_file for changing existing code — it edits precisely instead of regenerating the whole file. old_string must match the file EXACTLY (including whitespace/indentation) and be UNIQUE; if it matches more than once, add surrounding lines to disambiguate or set replace_all.',
    input_schema: {
      type: 'object',
      properties: {
        path:        { type: 'string', description: 'Absolute or home-relative (~) path to the file' },
        old_string:  { type: 'string', description: 'The exact text to replace (copy it verbatim, including indentation)' },
        new_string:  { type: 'string', description: 'The replacement text' },
        replace_all: { type: 'boolean', description: 'Replace every occurrence instead of requiring a unique match (default false)' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'list_directory',
    description: 'List files and subdirectories at a path. Returns names, sizes, and types.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path (absolute or ~-relative)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'dispatch_agent',
    description: 'Dispatch a focused SUB-AGENT to handle a self-contained sub-task and return its result — delegate to a specialist instead of doing everything yourself. Use when a chunk is best handled in isolation, or run several at once by emitting multiple dispatch_agent calls in ONE turn (they run in parallel). The sub-agent runs its own tool loop with no memory of this chat; you receive ONLY its final result. Roles — ' +
      DISPATCHABLE_ROLES.map((r) => `${r}: ${AGENT_ROLES[r]!.description}`).join('  ') +
      ' Don\'t dispatch for trivial things you can answer directly.',
    input_schema: {
      type: 'object',
      properties: {
        role: { type: 'string', enum: DISPATCHABLE_ROLES, description: 'Which specialist to dispatch.' },
        task: { type: 'string', description: 'The COMPLETE, self-contained task. The sub-agent has no memory of this conversation — include every needed detail: paths, names, the goal, and exactly what to return.' },
        context: { type: 'string', description: 'Optional facts/constraints/prior findings to hand the sub-agent.' },
      },
      required: ['role', 'task'],
    },
  },
]

// ─── SSE helper ───────────────────────────────────────────────────────────────

function sse(res: http.ServerResponse, event: string, data: unknown): void {
  // Guard against writes after the client disconnected — res.write() throws
  // ERR_STREAM_WRITE_AFTER_END / EPIPE otherwise, crashing the chat handler
  // mid-turn and corrupting the governance record.
  if (res.writableEnded || res.destroyed) return
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  } catch {
    /* client went away mid-stream — nothing to do */
  }
}

function setCORSHeaders(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization')
}

/**
 * Feature-flag registry — the single source of truth for the NOETICA_* behavioural
 * flags so they're observable (GET /api/flags) instead of scattered env reads. Each
 * carries a graduation `status`: 'default-on' (graduated), 'opt-in' (experimental,
 * earning its keep), or 'experimental' (unproven). Telemetry: the endpoint reports
 * live state so the UI/governance can see what's actually active in a run.
 */
const FEATURE_FLAGS: Array<{ env: string; status: 'default-on' | 'opt-in' | 'experimental'; desc: string }> = [
  { env: 'NOETICA_GOAL_TRACKING',      status: 'default-on',   desc: 'Goal/plan state machine + slot-filling across turns' },
  { env: 'NOETICA_PLN_GROUNDING',      status: 'default-on',   desc: 'PLN-backed graph grounding in Value Judgment' },
  { env: 'NOETICA_BANDIT_ROUTING',     status: 'default-on',   desc: 'UCB1 bandit selection over local model arms' },
  { env: 'NOETICA_CAPABILITY_ROUTING', status: 'opt-in',       desc: 'Escalate off local model when success rate is poor' },
  { env: 'NOETICA_CAIRNPATH_RETRIEVAL',status: 'experimental', desc: 'CairnPath EXPAND→DEDUP→RANK→CAP retrieval executor' },
  { env: 'NOETICA_DELIBERATION',       status: 'experimental', desc: 'BG→WM→VJ→select deliberation loop (multi-candidate)' },
  { env: 'NOETICA_SHACL_ENFORCE',      status: 'experimental', desc: 'Ontogenesis SHACL gate on graph writes (quarantine)' },
  { env: 'NOETICA_GAIA_AUTO_LOOP',     status: 'experimental', desc: 'GAIA background observation/consolidation loop' },
  { env: 'NOETICA_QA_FEWSHOT',         status: 'opt-in',       desc: 'Inject gold Q/A exemplars (Pareto head) as few-shot training memory' },
  { env: 'NOETICA_RESPONSIVE',         status: 'default-on',   desc: 'Fast 3B base + lean RAG for substantive turns (CPU latency); escalation climbs on struggle' },
  { env: 'NOETICA_EMBED_INTENT',       status: 'default-on',   desc: 'Tier-0 embedding intent classifier (nomic) — confidence + paraphrase robustness' },
  { env: 'NOETICA_EXTRACTIVE',         status: 'default-on',   desc: 'Extractive grounded answers for doc intents (cited verbatim, no hallucination, instant)' },
  { env: 'NOETICA_FABRIC',             status: 'default-on',   desc: 'Context fabric on the atomspace — STI-gated live brief shared across voice/chat/agents' },
  { env: 'NOETICA_LOGIC_FIRST',        status: 'default-on',   desc: 'Compute the answer by logic first (recall→extract); generate only the undecidable remainder' },
]

/**
 * Resolve a feature flag's live state from the registry. Graduated ('default-on')
 * flags are ON unless explicitly disabled with '0'; opt-in/experimental flags are
 * OFF unless explicitly enabled with '1'. Single source of truth for both the
 * call sites and GET /api/flags.
 */
function isFlagOn(env: string): boolean {
  const f = FEATURE_FLAGS.find((x) => x.env === env)
  const v = process.env[env]
  return f?.status === 'default-on' ? v !== '0' : v === '1'
}

/**
 * Optional bearer-token gate for mutating/destructive endpoints. Off by default
 * (local-first, single-user) — set NOETICA_API_TOKEN to require it. When set, the
 * caller must send `Authorization: Bearer <token>`. Returns true if allowed; on
 * denial it writes 401 and returns false so the handler can early-return.
 */
function requireApiToken(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const expected = process.env['NOETICA_API_TOKEN']
  if (!expected) return true // auth disabled
  const auth = req.headers['authorization'] ?? ''
  const got = Array.isArray(auth) ? auth[0] : auth
  if (got === `Bearer ${expected}`) return true
  res.writeHead(401, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: 'unauthorized', hint: 'set Authorization: Bearer <NOETICA_API_TOKEN>' }))
  return false
}

// ─── Tool execution ───────────────────────────────────────────────────────────

// Retry wrapper for transient tool failures (network, rate limits).
// Retryable tools: web_search, generate_image — these make external HTTP calls.
// Non-retryable tools (file ops, code_execute) fail fast — retrying would be wrong.
const RETRYABLE_TOOLS = new Set(['web_search', 'generate_image'])

async function executeToolWithRetry(
  name: string,
  input: Record<string, unknown>,
  keys: { anthropic?: string; openai?: string; serper?: string },
  maxRetries = 2,
): Promise<string> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await executeTool(name, input, keys)
      // If the tool itself returned an error string and it's retryable, try again
      if (result.startsWith('Error:') && RETRYABLE_TOOLS.has(name) && attempt < maxRetries) {
        await new Promise<void>((r) => setTimeout(r, 400 * Math.pow(2, attempt)))
        continue
      }
      return result
    } catch (e) {
      if (RETRYABLE_TOOLS.has(name) && attempt < maxRetries) {
        await new Promise<void>((r) => setTimeout(r, 400 * Math.pow(2, attempt)))
        continue
      }
      return `Error: ${e instanceof Error ? e.message : String(e)}`
    }
  }
  return 'Error: tool max retries exceeded'
}

// Hard 25-second ceiling per tool call — prevents a single hung tool from
// blocking the entire chat turn indefinitely.
const TOOL_TIMEOUT_MS = 25_000

async function executeToolWithTimeout(
  name: string,
  input: Record<string, unknown>,
  keys: { anthropic?: string; openai?: string; serper?: string },
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(`Error: tool ${name} timed out after ${TOOL_TIMEOUT_MS}ms`), TOOL_TIMEOUT_MS)
  })
  try {
    const result = await Promise.race([executeToolWithRetry(name, input, keys), timeout])
    return result
  } finally {
    clearTimeout(timer)
  }
}

// Portable login shell — zsh isn't guaranteed on Linux (the future primary target). Prefer
// $SHELL, then bash, then sh. Resolved once.
const LOGIN_SHELL = (() => {
  const cands = [process.env['SHELL'], '/bin/zsh', '/bin/bash', '/bin/sh']
  for (const s of cands) { try { if (s && fs.existsSync(s)) return s } catch { /* */ } }
  return '/bin/sh'
})()

// Run a shell command in a workspace dir, non-blocking, with a hard timeout + output caps.
// Used by the run_command tool (the sandboxed shell that lets the agent actually scaffold/run).
function runInWorkspace(command: string, cwd: string, timeoutMs: number): Promise<{ out: string; err: string; code: string }> {
  return new Promise((resolve) => {
    let out = '', err = '', done = false
    // Bound the timer with explicit guard comparisons (CodeQL-recognized sanitizer for
    // resource-exhaustion) so a caller-supplied duration can never create an unbounded timer.
    let safeTimeout = Number.isFinite(timeoutMs) ? timeoutMs : 60_000
    if (safeTimeout > 300_000) safeTimeout = 300_000
    if (safeTimeout < 1_000) safeTimeout = 1_000
    const child = cp.spawn(LOGIN_SHELL, ['-lc', command], { cwd, env: { ...process.env } })
    const timer = setTimeout(() => { if (!done) { done = true; try { child.kill('SIGKILL') } catch { /* */ } resolve({ out, err, code: `timeout after ${safeTimeout}ms` }) } }, safeTimeout)
    child.stdout.on('data', (d: Buffer) => { if (out.length < 200_000) out += d.toString() })
    child.stderr.on('data', (d: Buffer) => { if (err.length < 100_000) err += d.toString() })
    child.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ out, err: String(e), code: 'error' }) } })
    child.on('close', (c, sig) => { if (!done) { done = true; clearTimeout(timer); resolve({ out, err, code: c != null ? String(c) : (sig ? `signal ${sig}` : '?') }) } })
  })
}

// Start a long-running dev server, resolve once it prints its Local URL (or on timeout). The
// process keeps running so the UI can preview it; tracked for reaping on teardown.
const _devServers = new Set<number>()
function startDevServer(command: string, cwd: string, timeoutMs: number): Promise<{ url?: string; pid?: number }> {
  return new Promise((resolve) => {
    const child = cp.spawn(LOGIN_SHELL, ['-lc', command], { cwd, env: { ...process.env } })
    if (child.pid) _devServers.add(child.pid)
    let resolved = false
    const finish = (u?: string) => { if (!resolved) { resolved = true; clearTimeout(timer); resolve({ url: u, pid: child.pid }) } }
    const timer = setTimeout(() => finish(undefined), timeoutMs)
    const onData = (d: Buffer) => { const m = d.toString().match(/Local:\s*(https?:\/\/\S+)/i); if (m?.[1]) finish(m[1].replace(/\/+$/, '')) }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('exit', () => { if (child.pid) _devServers.delete(child.pid); finish(undefined) })
  })
}

// Parse a code-agent solution: {files:[{path,content}], verify:"cmd"} — tolerant of fences/prose.
function parseSolveOutput(text: string): { files: { path: string; content: string }[]; verify: string } | null {
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence?.[1]) t = fence[1].trim()
  const open = t.indexOf('{'), close = t.lastIndexOf('}')
  if (open >= 0 && close > open) t = t.slice(open, close + 1)
  try {
    const o = JSON.parse(t) as { files?: unknown; verify?: unknown }
    if (Array.isArray(o.files) && typeof o.verify === 'string' && o.verify.trim()) {
      const files = (o.files as unknown[])
        .filter((f): f is { path: string; content: string } => !!f && typeof (f as { path?: unknown }).path === 'string' && typeof (f as { content?: unknown }).content === 'string')
        .map((f) => ({ path: f.path, content: f.content }))
      if (files.length) return { files, verify: o.verify }
    }
  } catch { /* unparseable */ }
  return null
}

// public_data — pull a time series from a free, no-key public source and return
// rows ready for render_chart. Sources: crypto (CoinGecko), fx (Frankfurter),
// worldbank (economic indicators), csv (any public CSV URL).
async function publicData(args: Record<string, unknown>): Promise<string> {
  const source = String(args['source'] ?? '').trim()
  const UA = 'Mozilla/5.0 (compatible; noetica/1.0)'
  const getJson = async (url: string): Promise<any> => {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error(`source returned ${res.status}`)
    return res.json()
  }
  const cap = (rows: any[]): any[] => { const step = Math.max(1, Math.ceil(rows.length / 400)); return rows.filter((_, i) => i % step === 0) }
  const chartHint = (x: string, y: string) => `\n\nSeries — to chart, call render_chart with type "line", x "${x}", y "${y}":\n`

  try {
    if (source === 'crypto') {
      const coin = String(args['coin'] ?? 'bitcoin').toLowerCase()
      const vs = String(args['vs'] ?? 'usd').toLowerCase()
      const days = String(args['days'] ?? '30')
      const j = await getJson(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coin)}/market_chart?vs_currency=${encodeURIComponent(vs)}&days=${encodeURIComponent(days)}`)
      const prices: Array<[number, number]> = j?.prices ?? []
      if (!prices.length) return `Error: no price data for ${coin}/${vs} (check the coin id).`
      const rows = prices.map(([ms, p]) => ({ date: new Date(ms).toISOString().slice(0, 10), price: Number(p.toFixed(2)) }))
      return `${coin}/${vs} — ${rows.length} points (${days}d), latest ${rows[rows.length - 1]!.price} ${vs.toUpperCase()}${chartHint('date', 'price')}${JSON.stringify(cap(rows))}`
    }
    if (source === 'fx') {
      const from = String(args['from'] ?? 'USD').toUpperCase()
      const to = String(args['to'] ?? 'EUR').toUpperCase()
      const start = String(args['start'] ?? '')
      const end = String(args['end'] ?? '')
      const range = start && end ? `${start}..${end}` : start ? `${start}..` : '2024-01-01..'
      const j = await getJson(`https://api.frankfurter.app/${range}?from=${from}&to=${to}`)
      const rates: Record<string, Record<string, number>> = j?.rates ?? {}
      const rows = Object.keys(rates).sort().map((d) => ({ date: d, rate: rates[d]![to]! })).filter((r) => typeof r.rate === 'number')
      if (!rows.length) return `Error: no FX data for ${from}→${to}.`
      return `${from}→${to} — ${rows.length} points, latest ${rows[rows.length - 1]!.rate}${chartHint('date', 'rate')}${JSON.stringify(cap(rows))}`
    }
    if (source === 'worldbank') {
      const indicator = String(args['indicator'] ?? 'NY.GDP.MKTP.CD')
      const country = String(args['country'] ?? 'US').toUpperCase()
      const j = await getJson(`https://api.worldbank.org/v2/country/${encodeURIComponent(country)}/indicator/${encodeURIComponent(indicator)}?format=json&per_page=400`)
      const series: any[] = Array.isArray(j) ? (j[1] ?? []) : []
      const rows = series.filter((d) => d?.value != null).map((d) => ({ year: d.date, value: d.value })).reverse()
      if (!rows.length) return `Error: no World Bank data for ${indicator} / ${country}.`
      const label = series[0]?.indicator?.value ?? indicator
      return `${label} — ${country} — ${rows.length} points (${rows[0]!.year}–${rows[rows.length - 1]!.year})${chartHint('year', 'value')}${JSON.stringify(rows)}`
    }
    if (source === 'csv') {
      const url = String(args['url'] ?? '').trim()
      if (!/^https:\/\//.test(url)) return 'Error: csv source requires a full https URL.'
      const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15_000) })
      if (!res.ok) return `Error: CSV URL returned ${res.status}.`
      const text = await res.text()
      if (text.trim().startsWith('<')) return 'Error: that URL returned HTML, not CSV (it may require a browser/JS).'
      const lines = text.trim().split(/\r?\n/)
      const header = (lines.shift() ?? '').split(',').map((h) => h.trim())
      const rows = lines.slice(0, 2000).map((ln) => {
        const cells = ln.split(',')
        const o: Record<string, string | number> = {}
        header.forEach((h, i) => { const v = cells[i]; const n = Number(v); o[h] = v !== undefined && v !== '' && !isNaN(n) ? n : (v ?? '') })
        return o
      })
      return `CSV ${url} — columns: ${header.join(', ')} — ${rows.length} rows.\nPick x/y columns and call render_chart:\n${JSON.stringify(cap(rows))}`
    }
    return `Error: unknown source "${source}". Use crypto, fx, worldbank, or csv.`
  } catch (e) {
    return `Error fetching ${source} data: ${e instanceof Error ? e.message : String(e)}`
  }
}

// Run a dispatched sub-agent: a scoped, isolated tool loop for one role. Returns ONLY the
// sub-agent's final message (the concierge never sees its intermediate turns). Mirrors the main
// chat loop but headless (no SSE) and bounded by the role's maxTurns. dispatch_agent is excluded
// from every sub-agent's toolset, so sub-agents can't recursively fan out.
async function runSubAgent(
  roleId: string,
  task: string,
  context: string,
  keys: { anthropic?: string; openai?: string; serper?: string },
): Promise<string> {
  const role = resolveRole(roleId)
  const subTools = BUILTIN_TOOLS.filter((t) => role.tools.includes(t.name) && t.name !== 'dispatch_agent')
  const subToolNames = new Set(subTools.map((t) => t.name))
  const model = role.model === 'coder' ? 'qwen2.5-coder:7b' : 'qwen2.5:7b'
  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: role.systemPrompt + (context.trim() ? `\n\nContext from the concierge:\n${context.trim()}` : '') },
    { role: 'user', content: task },
  ]
  let final = ''
  for (let turn = 0; turn < role.maxTurns; turn++) {
    let text = ''
    let toolCalls: ToolUseBlock[] | undefined
    try {
      for await (const ev of streamOllama({ model, messages: messages as never, tools: subTools, numCtx: 8192, temperature: 0.3 })) {
        if (ev.type === 'text') text += ev.text
        else if (ev.type === 'tool_calls') toolCalls = ev.calls
      }
    } catch (e) {
      return `[${role.label} sub-agent error]`
    }
    if (!toolCalls?.length) {
      const parsed = parseInlineToolCalls(text, subToolNames)
      if (parsed.calls.length) { toolCalls = parsed.calls; text = parsed.cleaned }
    }
    if (!toolCalls?.length) { final = text; break }
    messages.push({ role: 'assistant', content: text || null, tool_calls: toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.input) } })) })
    for (const tc of toolCalls) {
      const r = await executeToolWithTimeout(tc.name, tc.input, keys)
      messages.push({ role: 'tool', content: r, tool_call_id: tc.id })
    }
    final = text || final
  }
  return final.trim() || `(${role.label} sub-agent finished without a final summary)`
}

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  keys: { anthropic?: string; openai?: string; serper?: string },
): Promise<string> {
  // Resolve a user-supplied path safely: expand ~, then ensure it stays
  // within the home directory or /tmp. Blocks traversal attacks ("../../etc").
  function safePath(raw: string): { resolved: string; error?: string } {
    if (!raw.trim()) return { resolved: '', error: 'path required' }
    const expanded = raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : raw
    const resolved = path.resolve(expanded)
    const home = path.resolve(os.homedir())
    if (!resolved.startsWith(home) && !resolved.startsWith('/tmp')) {
      return { resolved, error: `path must be under home directory or /tmp (got ${resolved})` }
    }
    return { resolved }
  }

  // scope-d capability confinement (facet 4): authorize side-effecting tools
  // against the active EngagementPolicy. Read-only tools pass; network/write/exec
  // actions are gated and fail-closed when the policy doesn't permit them.
  const TOOL_ACTION_CLASS: Record<string, import('./lib/scope-d.js').ActionClass> = {
    web_search: 'network_call',
    generate_image: 'network_call',
    public_data: 'network_call',
    code_execute: 'write',
    run_command: 'write',
  }
  const actionClass = TOOL_ACTION_CLASS[name]
  if (actionClass) {
    const verdict = scopedAuthorizeAction(actionClass)
    emitScopedTelemetry({ kind: 'capability', allow: verdict.allow, provider: 'tool', model: name, scope: actionClass, reason: verdict.reason, source: verdict.source })
    if (!verdict.allow) {
      return `Blocked by scope-d engagement policy: ${verdict.reason}. This action (${name} → ${actionClass}) is not authorized under the active policy.`
    }
  }

  switch (name) {
    case 'dispatch_agent': {
      const role = String(input['role'] ?? 'general')
      const task = String(input['task'] ?? '').trim()
      if (!task) return 'dispatch_agent: a task is required.'
      const context = String(input['context'] ?? '')
      const result = await runSubAgent(role, task, context, keys)
      return `[${resolveRole(role).label} sub-agent → result]\n${result}`
    }
    case 'web_search': {
      const query = String(input['query'] ?? '').trim().slice(0, 500)
      if (!query) return 'Error: query is required'
      return webSearch(query, keys.serper ?? process.env['SERPER_API_KEY'])
    }
    case 'generate_image': {
      const prompt = String(input['prompt'] ?? '').trim().slice(0, 1000)
      if (!prompt) return 'Error: prompt is required'
      const openaiKey = keys.openai ?? process.env['OPENAI_API_KEY']
      if (!openaiKey) return 'Error: No OpenAI API key — cannot generate image.'
      return generateImage(prompt, openaiKey)
    }
    case 'public_data': {
      return publicData(input)
    }
    case 'code_execute': {
      const language = String(input['language'] ?? 'javascript')
      if (language !== 'python' && language !== 'javascript') {
        return `Error: language must be 'python' or 'javascript', got '${language}'`
      }
      const code = String(input['code'] ?? '').slice(0, 50_000)
      if (!code.trim()) return 'Error: code is required'
      const sessionId = input['session_id'] ? String(input['session_id']).slice(0, 100) : undefined
      return executeCode(language as 'python' | 'javascript', code, sessionId)
    }
    case 'run_command': {
      const command = String(input['command'] ?? '').trim()
      if (!command) return 'Error: command is required.'
      // Block privileged / destructive / pipe-to-shell. The cwd is the sandbox so a `rm -rf .`
      // only nukes the workspace (recoverable); these patterns reach OUTSIDE it or escalate.
      const DENY = /(\bsudo\b|\bdoas\b|rm\s+-rf?\s+[~/]|rm\s+-rf?\s+\/|\bmkfs\b|\bdd\s+if=|:\(\)\s*\{|\bshutdown\b|\breboot\b|\bhalt\b|chown\s+-R\s+\/|chmod\s+-R\s+0?777\s+\/|>\s*\/dev\/(sd|disk)|(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh)/i
      if (DENY.test(command)) return `Blocked: that command is privileged or reaches outside the sandbox and isn't allowed. Keep it inside the workspace.`
      const wsName = (String(input['workspace'] ?? 'default').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40)) || 'default'
      const ws = path.join(os.homedir(), '.noetica', 'workspaces', wsName)
      try { fs.mkdirSync(ws, { recursive: true }) } catch { /* */ }
      const timeout = Math.min(300_000, Math.max(1_000, Number(input['timeout_ms'] ?? 60_000)))
      const { out, err, code } = await runInWorkspace(command, ws, timeout)
      const header = `$ ${command}\n[workspace: ${wsName}  exit: ${code}]`
      const body = `${out}${err ? `\n--- stderr ---\n${err}` : ''}`.trim()
      return `${header}\n${body || '(no output)'}`.slice(0, 14_000)
    }
    case 'read_file': {
      const { resolved, error } = safePath(String(input['path'] ?? ''))
      if (error) return `Error: ${error}`
      try {
        const stat = fs.statSync(resolved)
        if (stat.size > 2 * 1024 * 1024) return `Error: File too large (${stat.size} bytes). Max 2 MB.`
        return fs.readFileSync(resolved, 'utf-8')
      } catch (e) {
        return `Error reading file: ${(e as Error).message}`
      }
    }
    case 'write_file': {
      const { resolved, error } = safePath(String(input['path'] ?? ''))
      if (error) return `Error: ${error}`
      const content = String(input['content'] ?? '').slice(0, 10 * 1024 * 1024)
      try {
        fs.mkdirSync(path.dirname(resolved), { recursive: true })
        fs.writeFileSync(resolved, content, 'utf-8')
        return `Written ${content.length} characters to ${resolved}`
      } catch (e) {
        return `Error writing file: ${(e as Error).message}`
      }
    }
    case 'edit_file': {
      const { resolved, error } = safePath(String(input['path'] ?? ''))
      if (error) return `Error: ${error}`
      const oldString = String(input['old_string'] ?? '')
      const newString = String(input['new_string'] ?? '')
      const replaceAll = input['replace_all'] === true
      let before: string
      try { before = fs.readFileSync(resolved, 'utf-8') }
      catch (e) { return `Error reading file: ${(e as Error).message}` }
      const r = applyEdit(before, oldString, newString, { replaceAll })
      if (!r.ok) return `Edit not applied: ${r.error}`
      try {
        fs.writeFileSync(resolved, r.content, 'utf-8')
        return `Edited ${resolved} — ${editSummary(before, r.content, r.replacements)}`
      } catch (e) {
        return `Error writing file: ${(e as Error).message}`
      }
    }
    case 'list_directory': {
      const { resolved, error } = safePath(String(input['path'] ?? '.'))
      if (error) return `Error: ${error}`
      try {
        const entries = fs.readdirSync(resolved).map((name) => {
          const stat = fs.statSync(path.join(resolved, name))
          return `${stat.isDirectory() ? 'd' : 'f'}  ${name}${stat.isDirectory() ? '/' : `  (${stat.size}B)`}`
        })
        return entries.join('\n') || '(empty directory)'
      } catch (e) {
        return `Error listing directory: ${(e as Error).message}`
      }
    }
    case 'ocr': {
      const { resolved, error } = safePath(String(input['image_path'] ?? ''))
      if (error) return `OCR error: ${error}`
      return await runOcr(resolved)
    }
    case 'render_chart': {
      let data: Record<string, unknown>[] = []
      if (Array.isArray(input['data'])) data = input['data'] as Record<string, unknown>[]
      else if (typeof input['data'] === 'string') { try { const parsed = JSON.parse(input['data'] as string); if (Array.isArray(parsed)) data = parsed as Record<string, unknown>[] } catch { /* not json */ } }
      if (!data.length) return 'Error: render_chart needs a non-empty data array (row objects).'
      let type = String(input['type'] ?? '')
      if (!['line', 'bar', 'area', 'scatter', 'pie', 'histogram'].includes(type)) {
        const { queryRegistry } = await import('./lib/registry.js')
        const top = queryRegistry({ kind: 'chart', q: String(input['query'] ?? ''), limit: 1 })[0]
        const map: Record<string, string> = { 'chart.timeseries.line': 'line', 'chart.area.trend': 'area', 'chart.bar.comparison': 'bar', 'chart.hist.distribution': 'histogram', 'chart.box.distribution': 'bar', 'chart.scatter.correlation': 'scatter', 'chart.pie.proportion': 'pie', 'chart.heatmap.matrix': 'bar', 'chart.candlestick.ohlc': 'line', 'chart.choropleth.geo': 'bar' }
        type = (top && map[top.id]) || 'bar'
      }
      const payload = { type, data: data.slice(0, 200), x: input['x'], y: input['y'], category: input['category'], value: input['value'], title: input['title'] }
      return '```noetica-chart\n' + JSON.stringify(payload) + '\n```'
    }
    case 'registry_lookup': {
      const { queryRegistry } = await import('./lib/registry.js')
      const entries = queryRegistry({ q: String(input['query'] ?? ''), kind: input['kind'] as 'chart' | 'template' | 'connector' | 'asset' | 'crawl' | undefined, limit: 5 })
      if (!entries.length) return 'No catalogue entries matched — build it from scratch, or register a reusable entry afterward.'
      return entries.map((e) => `[${e.kind}] ${e.id} — ${e.title}\n  ${e.description}\n  params: ${e.params.join(', ')}${e.spec ? `\n  spec: ${JSON.stringify(e.spec)}` : ''}`).join('\n\n')
    }
    case 'remember': {
      const content = String(input['content'] ?? '').trim()
      if (!content) return 'Error: nothing to remember — content is required.'
      const kind = ['preference', 'fact', 'identity'].includes(String(input['kind'])) ? String(input['kind']) : 'fact'
      try {
        // Dedup-on-write: don't store a near-duplicate of something already remembered.
        const { findSimilarMemory, findConflictingMemory, listMemories } = await import('./lib/memory-curation.js')
        const gMem = getHellGraph()
        const mStore = { nodesByLabel: (l: string) => gMem.nodesByLabel(l) as any[], getNode: (id: string) => gMem.getNode(id) as any, out: (id: string, e?: string) => gMem.out(id, e) as any[], setProperty: () => { /* read-only */ } }
        const dupId = findSimilarMemory(mStore, content)
        if (dupId) {
          const existing = listMemories(mStore).find((m) => m.id === dupId)
          return `Already remembered something similar: "${(existing?.preview ?? '').slice(0, 120)}". Not duplicating it.`
        }
        // Contradiction-aware: a memory sharing the subject but differing may be a stale fact.
        const conflict = findConflictingMemory(mStore, content)
        const { ingestDocument } = await import('./lib/doc-store.js')
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        await ingestDocument(`memory/${kind}-${stamp}.md`, content)
        const note = conflict ? ` ⚠️ This may update an earlier memory: "${conflict.preview.slice(0, 110)}" — tell me to forget that one if it's now wrong.` : ''
        return `Saved to memory (${kind}): "${content.slice(0, 140)}". I'll recall this on future relevant turns.${note}`
      } catch (e) {
        return `Could not save to memory: ${e instanceof Error ? e.message : String(e)} (is the local embedding model available?)`
      }
    }
    default:
      return `Unknown built-in tool: ${name}`
  }
}

// ─── web_search ───────────────────────────────────────────────────────────────

async function webSearch(query: string, serperKey?: string): Promise<string> {
  if (serperKey?.trim()) {
    try {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': serperKey, 'content-type': 'application/json' },
        body: JSON.stringify({ q: query, num: 6 }),
        signal: AbortSignal.timeout(6_000),
      })
      if (res.ok) {
        const data = (await res.json()) as {
          organic?: Array<{ title?: string; link?: string; snippet?: string }>
        }
        const hits = (data.organic ?? []).slice(0, 6)
        if (hits.length) {
          return hits.map((r) => `- [${r.title}](${r.link}): ${r.snippet}`).join('\n')
        }
      }
    } catch {
      // fall through to DDG
    }
  }

  // Keyless REAL web results via DuckDuckGo HTML (the Instant Answer API below only has
  // Wikipedia-style abstracts — useless for general queries). This returns actual ranked
  // results with snippets, no API key needed.
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', accept: 'text/html' },
      signal: AbortSignal.timeout(8_000),
    })
    if (res.ok) {
      const html = await res.text()
      const titles = [...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
      const snippets = [...html.matchAll(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)]
      const strip = (h: string) => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&#x2F;/g, '/').trim()
      const out: string[] = []
      for (let i = 0; i < titles.length && out.length < 6; i++) {
        let link = titles[i]![1]!
        const uddg = link.match(/uddg=([^&]+)/)
        if (uddg) { try { link = decodeURIComponent(uddg[1]!) } catch { /* keep raw */ } }
        const title = strip(titles[i]![2]!)
        const snip = snippets[i] ? strip(snippets[i]![1]!) : ''
        if (title && link.startsWith('http')) out.push(`- [${title}](${link})${snip ? ` — ${snip.slice(0, 180)}` : ''}`)
      }
      if (out.length) return out.join('\n')
    }
  } catch {
    // fall through to the Instant Answer API
  }

  // DuckDuckGo Instant Answer API (no key required)
  try {
    const url = new URL('https://api.duckduckgo.com/')
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'json')
    url.searchParams.set('no_html', '1')
    url.searchParams.set('skip_disambig', '1')

    const res = await fetch(url.toString(), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6_000) })
    if (res.ok) {
      const data = (await res.json()) as {
        AbstractText?: string
        AbstractURL?: string
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Topics?: unknown[] }>
      }
      const parts: string[] = []
      if (data.AbstractText?.trim()) {
        parts.push(`${data.AbstractText} — ${data.AbstractURL ?? ''}`)
      }
      for (const r of (data.RelatedTopics ?? []).slice(0, 5)) {
        if (r.Text && r.FirstURL) parts.push(`- [${r.Text}](${r.FirstURL})`)
      }
      if (parts.length) return parts.join('\n')
    }
  } catch {
    // continue
  }

  // No connectivity / no result: tell the model to proceed rather than stall or
  // wait on the tool. Without this it tends to say "let me search…" and hang.
  return `Web search is unavailable (offline or no result) for "${query}". Do not retry the search — answer from your own knowledge and any provided document context, and note that live data could not be retrieved.`
}

// ─── generate_image ───────────────────────────────────────────────────────────

async function generateImage(prompt: string, openaiKey: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size: '1024x1024',
      response_format: 'url',
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    return `Image generation failed (${res.status}): ${text}`
  }

  const data = (await res.json()) as {
    data?: Array<{ url?: string; revised_prompt?: string }>
  }
  const img = data.data?.[0]
  if (!img?.url) return 'Image generation returned no URL.'

  const caption = img.revised_prompt ? `\n*${img.revised_prompt}*` : ''
  return `![Generated image](${img.url})${caption}`
}

// ─── code_execute ─────────────────────────────────────────────────────────────

const AM_SESSION_DIRS = new Map<string, string>()

function getAmSessionDir(sessionId: string): string {
  if (AM_SESSION_DIRS.has(sessionId)) return AM_SESSION_DIRS.get(sessionId)!
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `noetica-am-${sessionId.slice(0, 8)}-`))
  AM_SESSION_DIRS.set(sessionId, dir)
  return dir
}

function executeCode(language: 'python' | 'javascript', code: string, sessionId?: string): Promise<string> {
  const TIMEOUT_MS = 30_000
  const MAX_OUTPUT = 100_000

  if (language === 'javascript') {
    return new Promise((resolve) => {
      const logs: string[] = []
      const consoleMock = {
        log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
        error: (...args: unknown[]) => logs.push('ERROR: ' + args.map(String).join(' ')),
        warn: (...args: unknown[]) => logs.push('WARN: ' + args.map(String).join(' ')),
        info: (...args: unknown[]) => logs.push('INFO: ' + args.map(String).join(' ')),
      }
      const sandbox: Record<string, unknown> = {
        console: consoleMock,
        Math,
        JSON,
        Array,
        Object,
        String,
        Number,
        Boolean,
        Date,
        Error,
        Map,
        Set,
        Promise,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        encodeURIComponent,
        decodeURIComponent,
        setTimeout: undefined, // blocked in sandbox
        setInterval: undefined,
        fetch: undefined, // blocked — use web_search for HTTP
      }
      try {
        vm.createContext(sandbox)
        const result = vm.runInContext(code, sandbox, { timeout: TIMEOUT_MS })
        const out = logs.join('\n')
        const resultLine =
          result !== undefined && result !== null
            ? `\nResult: ${typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result)}`
            : ''
        const combined = (out + resultLine).trim()
        resolve(combined.slice(0, MAX_OUTPUT) || '(no output)')
      } catch (err) {
        resolve(
          `RuntimeError: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    })
  }

  // Python via subprocess — persistent session directory
  const sessionDir = sessionId ? getAmSessionDir(sessionId) : os.tmpdir()
  const preamble = `
import sys, os
os.chdir(${JSON.stringify(sessionDir)})
try:
  import matplotlib
  matplotlib.use('Agg')
  import matplotlib.pyplot as plt
  _orig_show = plt.show
  def _patched_show(*a, **kw):
    import datetime
    fname = 'plot_' + datetime.datetime.now().strftime('%H%M%S%f') + '.png'
    plt.savefig(fname, dpi=150, bbox_inches='tight')
    print(f'[chart:{fname}]')
    plt.clf()
  plt.show = _patched_show
except ImportError:
  pass
`
  const fullCode = preamble + '\n' + code

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false

    // Filtered env — never expose API keys or arbitrary host secrets to model-authored code.
    // Only pass what a typical python script legitimately needs.
    const safeEnv: Record<string, string | undefined> = {
      PATH: process.env['PATH'],
      HOME: os.homedir(),
      LANG: process.env['LANG'],
      TMPDIR: process.env['TMPDIR'],
      PYTHONDONTWRITEBYTECODE: '1',
      MPLBACKEND: 'Agg',
    }
    const proc = cp.spawn('python3', ['-c', fullCode], {
      cwd: sessionDir,
      env: safeEnv as NodeJS.ProcessEnv,
    })

    const timer = setTimeout(() => {
      timedOut = true
      proc.kill('SIGKILL')
    }, TIMEOUT_MS)

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      if (stdout.length > MAX_OUTPUT) proc.kill('SIGPIPE')
    })
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) {
        resolve('TimeoutError: Python execution exceeded 15 seconds.')
        return
      }
      const out = stdout.slice(0, MAX_OUTPUT).trimEnd()
      const err = stderr.slice(0, 4000).trimEnd()
      const parts = [out, err ? `Stderr:\n${err}` : ''].filter(Boolean)
      resolve(parts.join('\n\n').trim() || `(exit code ${code ?? 0}, no output)`)
    })

    proc.on('error', (e) => {
      clearTimeout(timer)
      resolve(`SpawnError: ${e.message} (is python3 installed?)`)
    })
  })
}

// ─── Anthropic streaming ──────────────────────────────────────────────────────

async function* streamAnthropic(params: {
  model: string
  messages: AnthropicMessage[]
  system?: string
  tools?: ProviderTool[]
  apiKey: string
  thinkingBudget?: number
  temperature?: number
  maxTokens?: number
}): AsyncGenerator<ProviderEvent> {
  // Honor request max_tokens; fall back to thinking-budget-derived ceiling, then 8192.
  const maxTokens = params.maxTokens
    ?? (params.thinkingBudget ? params.thinkingBudget + 8192 : 8192)
  const body: Record<string, unknown> = {
    model: params.model,
    max_tokens: maxTokens,
    stream: true,
    messages: params.messages,
  }
  // Extended thinking requires temperature=1; only set temperature when not thinking.
  if (typeof params.temperature === 'number' && !params.thinkingBudget) {
    body['temperature'] = params.temperature
  }
  if (params.system) body['system'] = params.system
  if (params.tools?.length) {
    body['tools'] = params.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }))
  }
  if (params.thinkingBudget) {
    body['thinking'] = { type: 'enabled', budget_tokens: params.thinkingBudget }
  }

  const anthropicHeaders = {
    'content-type': 'application/json',
    'x-api-key': params.apiKey,
    'anthropic-version': '2023-06-01',
    ...(params.thinkingBudget ? { 'anthropic-beta': 'interleaved-thinking-2025-05-14' } : {}),
  }

  let res: Response
  let lastStatus = 0
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: anthropicHeaders,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    })
    lastStatus = res.status
    if (res.status !== 429) break
    // Honor Retry-After header if present, else exponential backoff
    const retryAfterSec = parseFloat(res.headers.get('retry-after') ?? '')
    const waitMs = !isNaN(retryAfterSec) ? Math.min(retryAfterSec, 60) * 1000 : (attempt === 0 ? 2000 : 8000)
    console.warn(`[streamAnthropic] 429 rate-limited, waiting ${waitMs}ms (attempt ${attempt + 1})`)
    await new Promise<void>((r) => setTimeout(r, waitMs))
  }

  if (!res!.ok) {
    const detail = await res!.text()
    throw new Error(`Anthropic ${lastStatus}: ${detail}`)
  }
  if (!res!.body) throw new Error('Anthropic response body was empty.')

  const reader = res!.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let inThinking = false
  let isToolUse = false
  let currentIdx = -1

  type PartialTool = { id: string; name: string; inputJson: string }
  const toolBlocks = new Map<number, PartialTool>()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const raw = line.slice(5).trim()
      if (!raw || raw === '[DONE]') continue

      let p: {
        type?: string
        index?: number
        content_block?: { type?: string; id?: string; name?: string }
        delta?: { type?: string; text?: string; thinking?: string; partial_json?: string }
        message?: { stop_reason?: string }
      }
      try {
        p = JSON.parse(raw) as typeof p
      } catch {
        continue  // skip malformed SSE line — provider occasionally sends incomplete JSON
      }

      if (p.type === 'content_block_start') {
        currentIdx = p.index ?? -1
        inThinking = p.content_block?.type === 'thinking'
        isToolUse = p.content_block?.type === 'tool_use'
        if (isToolUse && p.content_block?.id && p.content_block?.name) {
          toolBlocks.set(currentIdx, {
            id: p.content_block.id,
            name: p.content_block.name,
            inputJson: '',
          })
        }
      }

      if (p.type === 'content_block_stop') {
        inThinking = false
        isToolUse = false
      }

      if (p.type === 'content_block_delta') {
        if (inThinking && p.delta?.thinking) {
          yield { type: 'thinking', text: p.delta.thinking }
        } else if (!inThinking && !isToolUse && p.delta?.text) {
          yield { type: 'text', text: p.delta.text }
        } else if (isToolUse && p.delta?.partial_json) {
          const b = toolBlocks.get(currentIdx)
          if (b) b.inputJson += p.delta.partial_json
        }
      }

      if (p.type === 'message_delta' && p.message?.stop_reason === 'tool_use') {
        const calls: ToolUseBlock[] = Array.from(toolBlocks.values()).map((b) => ({
          id: b.id,
          name: b.name,
          input: (() => {
            try { return JSON.parse(b.inputJson) as Record<string, unknown> }
            catch (e) { console.error('[anthropic] tool arg parse failed', b.name, String(e)); return {} }
          })(),
        }))
        if (calls.length) yield { type: 'tool_calls', calls }
      }
    }
  }
}

// ─── OpenAI streaming ─────────────────────────────────────────────────────────

async function* streamOpenAI(params: {
  model: string
  messages: OpenAIMessage[]
  tools?: ProviderTool[]
  apiKey: string
  temperature?: number
  maxTokens?: number
  baseUrl?: string   // OpenAI-compatible base (…/v1); defaults to api.openai.com. Used for scope-d-hosted endpoints.
}): AsyncGenerator<ProviderEvent> {
  const body: Record<string, unknown> = {
    model: params.model,
    stream: true,
    messages: params.messages,
  }
  if (typeof params.temperature === 'number') body['temperature'] = params.temperature
  if (params.maxTokens && params.maxTokens > 0) body['max_tokens'] = params.maxTokens
  if (params.tools?.length) {
    body['tools'] = params.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }))
    body['tool_choice'] = 'auto'
  }

  let res: Response
  let lastStatus = 0
  const endpoint = `${(params.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    })
    lastStatus = res.status
    if (res.status !== 429) break
    const retryAfterSec = parseFloat(res.headers.get('retry-after') ?? '')
    const waitMs = !isNaN(retryAfterSec) ? Math.min(retryAfterSec, 60) * 1000 : (attempt === 0 ? 2000 : 8000)
    console.warn(`[streamOpenAI] 429 rate-limited, waiting ${waitMs}ms (attempt ${attempt + 1})`)
    await new Promise<void>((r) => setTimeout(r, waitMs))
  }

  if (!res!.ok) {
    const detail = await res!.text()
    throw new Error(`OpenAI ${lastStatus}: ${detail}`)
  }
  if (!res!.body) throw new Error('OpenAI response body was empty.')

  const reader = res!.body.getReader()
  const dec = new TextDecoder()
  let buf = ''

  type PartialCall = { id: string; name: string; argsJson: string }
  const toolCallMap = new Map<number, PartialCall>()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const raw = line.slice(5).trim()
      if (raw === '[DONE]') {
        if (toolCallMap.size) {
          const calls: ToolUseBlock[] = Array.from(toolCallMap.entries())
            .sort(([a], [b]) => a - b)
            .map(([, tc]) => ({
              id: tc.id,
              name: tc.name,
              input: (() => {
                try { return JSON.parse(tc.argsJson) as Record<string, unknown> }
                catch (e) { console.error('[openai] tool arg parse failed', tc.name, String(e)); return {} }
              })(),
            }))
          yield { type: 'tool_calls', calls }
        }
        return
      }
      if (!raw) continue

      let p: {
        choices?: Array<{
          delta?: {
            content?: string
            tool_calls?: Array<{
              index: number
              id?: string
              function?: { name?: string; arguments?: string }
            }>
          }
        }>
      }
      try {
        p = JSON.parse(raw) as typeof p
      } catch {
        continue  // skip malformed SSE line
      }

      const delta = p.choices?.[0]?.delta
      if (delta?.content) yield { type: 'text', text: delta.content }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const ex = toolCallMap.get(tc.index)
          if (!ex) {
            toolCallMap.set(tc.index, {
              id: tc.id ?? `tc-${tc.index}`,  // provider sends id only on first chunk
              name: tc.function?.name ?? '',
              argsJson: tc.function?.arguments ?? '',
            })
          } else {
            if (tc.id) ex.id = tc.id
            if (tc.function?.name) ex.name += tc.function.name
            if (tc.function?.arguments) ex.argsJson += tc.function.arguments
          }
        }
      }
    }
  }
}

// ─── Agentic chat handler ─────────────────────────────────────────────────────

async function handleChat(body: ChatRequest, res: http.ServerResponse): Promise<void> {
  const turnStart = Date.now() // request-received clock (used by the fast clarify path)
  const keys = body.provider_keys ?? {}
  const anthropicKey = keys.anthropic?.trim() || process.env['ANTHROPIC_API_KEY'] || ''
  const openaiKey = keys.openai?.trim() || process.env['OPENAI_API_KEY'] || ''

  // ── Prophet-mesh conductor routing ──────────────────────────────────────────
  // A cold managed-runtime launch can take ~15-20s before Ollama is serving. If a chat
  // request lands inside that window, DON'T throw the scary "no local Ollama runtime"
  // error — wait for the runtime to come up (the request just takes a little longer on a
  // cold start). Only wait when there's no cloud key to fall back to.
  let ollamaUp = await isOllamaRunning()
  if (!ollamaUp && !anthropicKey && !openaiKey) {
    const deadline = Date.now() + 25_000
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000))
      if (await isOllamaRunning()) { ollamaUp = true; break }
    }
  }
  const availableModels = ollamaUp ? await listLocalModels() : []
  const latestUserContent = [...(body.messages ?? [])]
    .filter((m) => m.role === 'user').at(-1)?.content ?? ''

  // Detect whether any user message carries image attachments (→ vision routing)
  const hasImages = (body.messages ?? []).some(
    (m) => m.role === 'user' && m.attachments?.some((a) => a.kind === 'image'),
  )

  // ── Structured intent classification (the 22-intent plan layer) ─────────────
  // Run the fast, local, cue-based classifier FIRST. It maps the turn to one of
  // the 22 conversational intents, each carrying a plan: model capability +
  // retrieval strategy + slots. We feed its capability into the router as an
  // authoritative task override (so e.g. a doc summary goes to 'general', not the
  // coder), and use its retrieval flag to force doc-grounding below. Pure pattern
  // scoring — no model call, safe on the hot path even on a CPU box.
  let hasDoc = false
  try {
    const { documentChunkCount } = await import('./lib/doc-store.js')
    hasDoc = documentChunkCount() > 0
  } catch { /* doc-store optional */ }
  let intentPlan = classifyIntent(latestUserContent, { hasDoc })
  // Tier-0 cascade (NOETICA_EMBED_INTENT): a tiny embedding model refines the intent
  // when the regex cues are weak/ambiguous — calibrated confidence + paraphrase
  // robustness (e.g. "what is a clinical trial?" with no literal cue). An exact strong
  // cue (regex score ≥ 2) is trusted as-is; otherwise a confident, decisive embedding
  // wins. Best-effort — falls back to the regex result if the embed model is down.
  if (isFlagOn('NOETICA_EMBED_INTENT')) {
    try {
      const { classifyEmbed } = await import('./lib/intent-embed.js')
      const emb = await classifyEmbed(latestUserContent)
      const regexStrong = intentPlan.score >= 2 && intentPlan.name !== 'general'
      if (emb && !regexStrong && emb.confidence >= 0.55 && emb.margin >= 0.02) {
        const it = intentByName(emb.name)
        if (it) {
          intentPlan = planFromIntent(it, 1 + emb.confidence * 2) // map cosine → score band
          console.log(`[embed-intent] ${emb.name} (conf ${emb.confidence}, margin ${emb.margin})`)
        }
      }
    } catch { /* embedding classifier best-effort */ }
  }
  // 'continue'/'ingest' carry no model task — let the keyword router decide those.
  const intentTaskOverride = (intentPlan.model === 'continue' || intentPlan.model === 'ingest')
    ? undefined
    : (capabilityToTask(intentPlan.model) as Parameters<typeof buildRouterDecision>[0]['taskOverride'])
  sse(res, 'intent', { intent: {
    id: intentPlan.id, name: intentPlan.name, capability: intentPlan.model,
    retrieval: intentPlan.retrieval, slots: intentPlan.slots, score: intentPlan.score,
    surface: intentPlan.surface, tools: intentPlan.tools, skill: intentPlan.skill,
  } })

  // ── First meshrush edge: project the intent onto the action basis, derive the route ──
  // The request becomes a tangent vector (action) whose polarity routes it: read →
  // interactive/faithful tier, write → deliberate/generative tier; substrate → node.
  // This grounds model selection in the algebra and is the first admissible hop.
  const action = intentToAction(intentPlan.name)
  const actionRoute = action === 'meta' ? { tier: 'embedding', target: 'concierge' } : routeForAction(action)
  const polarity = ['retrieve', 'evaluate', 'sense'].includes(action) ? 'read' : action === 'meta' ? 'meta' : 'write'
  const phase = action === 'meta' ? null : meshrushPhase(action) // where this turn sits in the MeshRush loop
  sse(res, 'action', { action: { verb: action, polarity, tier: actionRoute.tier, target: actionRoute.target, meshrush_phase: phase } })

  // ── Visible plan + execution timeline ───────────────────────────────────────
  // Make the turn legible while it runs: stream an ordered checklist the moment we
  // know the intent, then flip each step's status (running → done) as we hit it.
  // Even when generation is slow, the user watches the agent move through its plan
  // instead of waiting on a blank spinner. Steps mirror the real pipeline below.
  const willRetrieveDocs = wantsVectorRag(intentPlan.retrieval) && hasDoc
  const planSteps = [
    { id: 'classify', label: 'Understanding the request', status: 'done', detail: intentPlan.name.replace(/_/g, ' ') },
    { id: 'retrieve', label: willRetrieveDocs ? 'Retrieving relevant document passages' : 'Gathering memory & grounding', status: 'running', detail: '' },
    { id: 'generate', label: 'Composing the answer', status: 'pending', detail: '' },
  ]
  sse(res, 'plan', { plan: {
    intent: intentPlan.name, capability: intentPlan.model,
    retrieval: intentPlan.retrieval, slots: intentPlan.slots, steps: planSteps,
    surface: intentPlan.surface, skill: intentPlan.skill, tools: intentPlan.tools,
  } })
  const step = (id: string, status: 'running' | 'done', detail = '') =>
    sse(res, 'step', { step: { id, status, detail } })
  // The announcer: stream plain narration of WHAT the agent is doing and WHY — which
  // model, for what purpose, why it's adapting — so the user follows the reasoning and
  // never sees a silent gap (the "not frozen" signal).
  const narrate = (n: import('./lib/narration.js').Narration) => sse(res, 'narration', { narration: n })
  let docHitCount = 0  // chunks pulled by semantic RAG — surfaced in the retrieve step
  let docHits: import('./lib/doc-store.js').ChunkHit[] = [] // captured for extractive QA

  // ── Glossary-grounded NLU (Rasa-style lookup tables, already worked out) ─────
  // Overlap the turn against our induced GlossaryTerm vocabulary (Domain→Topic×22→
  // GlossaryTerm) to recognize which domain + topics + terms it touches. Pure token
  // overlap — no model, safe on the hot path. We use the matched terms to (a) bias
  // document retrieval toward on-topic chunks and (b) anchor the model to the right
  // domain vocabulary. This is standard dialogue-management grounding; the leverage
  // is that the glossary is pre-built, so recognition needs no training.
  let glossaryTerms: string[] = []
  let glossaryTopics: string[] = []
  let groundingContext = ''
  try {
    const { matchDomains } = await import('./lib/graphbrain-bridge.js')
    const matches = matchDomains(latestUserContent, 2)
    if (matches.length > 0) {
      glossaryTerms = [...new Set(matches.flatMap((m) => m.matchedTerms))].slice(0, 12)
      glossaryTopics = [...new Set(matches.flatMap((m) => m.topics.map((t) => t.code)))].slice(0, 6)
      if (glossaryTerms.length > 0) {
        groundingContext = `\n\n---\n**Domain grounding**\nThis question is in the "${matches[0]!.corpusRelease}" domain. Salient topics: ${glossaryTopics.join(', ')}. Key glossary terms in play: ${glossaryTerms.join(', ')}. Use this established vocabulary precisely and ground every claim in the cited document sources.`
      }
      sse(res, 'grounding', { grounding: { domain: matches[0]!.corpusRelease, topics: glossaryTopics, terms: glossaryTerms } })
      step('classify', 'done', glossaryTopics.length ? `${intentPlan.name.replace(/_/g, ' ')} · ${glossaryTopics.join('/')}` : intentPlan.name.replace(/_/g, ' '))
    }
  } catch { /* glossary grounding is best-effort */ }

  // ── Context fabric: inject the live brief (STI-gated, shared across surfaces) ─
  // The brief shapes engagement — what we're working on across voice/chat/agents —
  // without flooding context. It's the high-salience slice of the atomspace.
  let fabricContext = ''
  if (isFlagOn('NOETICA_FABRIC')) {
    try {
      const { readBrief, briefContext } = await import('./lib/fabric.js')
      fabricContext = briefContext(readBrief({ session: body.session_id ?? 'local', limit: 10 }))
    } catch { /* fabric is best-effort */ }
  }

  // ── Dialogue policy: forms + fallback clarification (decide before answering) ─
  // A form-gated intent missing its critical slot, or a very-low-confidence turn,
  // is answered with a CLARIFYING QUESTION rather than a guess. Fast path — no model
  // call, no retrieval — and recorded so the analytics show clarify/slot-fill rates.
  const { decidePolicy } = await import('./lib/dialogue-policy.js')
  const policy = decidePolicy(intentPlan, latestUserContent, { hasDoc, entities: glossaryTerms })
  if (policy.action === 'clarify' && policy.prompt) {
    step('retrieve', 'done', 'clarification needed')
    step('generate', 'done', 'asked for missing info')
    sse(res, 'delta', { delta: policy.prompt })
    try {
      const { recordTurn } = await import('./lib/dialogue-tracker.js')
      recordTurn({
        session_id: body.session_id ?? 'local', intent: intentPlan.name, intent_score: intentPlan.score,
        fallback: policy.reason === 'low intent confidence',
        slots_expected: intentPlan.slots, slots_filled: policy.filled, fill_rate: policy.fillRate,
        clarified: true, entities: glossaryTerms, surface: intentPlan.surface, skill: intentPlan.skill,
        tools: intentPlan.tools, capability: intentPlan.model, model: 'concierge', retrieval: 'none',
        grounded: false, latency_ms: Date.now() - turnStart,
      })
    } catch { /* tracker best-effort */ }
    sse(res, 'done', { result: {
      run_id: crypto.randomUUID(), content: policy.prompt, model_routed: 'concierge', provider: 'noetica',
      policy_admitted: true, memory_written: false, stop_reason: 'clarify', timestamp: new Date().toISOString(),
      latency_ms: Date.now() - turnStart, agent_machine: true, agent_machine_version: VERSION, clarification: true,
    } })
    return
  }

  let routing: ReturnType<typeof buildRouterDecision>
  try {
    routing = buildRouterDecision({
      requestId: crypto.randomUUID(),
      content: latestUserContent,
      ollamaAvailable: ollamaUp,
      availableModels,
      hasAnthropicKey: Boolean(anthropicKey),
      hasOpenAIKey: Boolean(openaiKey),
      explicitModelId: body.model_id,
      policyProfile: body.policy_profile,
      securityAttested: body.security_attested === true,
      hasImages,
      hasTools: (body.tools?.length ?? 0) > 0,
      taskOverride: intentTaskOverride,
    })
  } catch (err) {
    sse(res, 'error', { error: 'internal_error' })
    return
  }

  let { resolvedModel: model, resolvedProvider: provider } = routing
  const { resolvedModel: _rm, resolvedProvider: _rp, ...routerDecision } = routing

  // Honest vision fallback: an image is attached but no vision model is reachable — the
  // router fell through (no local VLM installed) to a text model that literally can't see.
  // Don't fake an answer from text the model can't read; tell the user how to give the mesh
  // sight. (Cloud VLMs CAN see, so this only guards the blind local-text case.)
  if (hasImages && provider === 'ollama' && (routerDecision as { domain?: string }).domain !== 'vision') {
    const lat = Date.now() - turnStart
    const msg = [
      "There's an image attached, but I can't actually see it yet — no vision model is installed in the local mesh, so the router fell back to a text-only model that can't read pixels. Answering from text I can't see is exactly the wrong move.",
      '',
      'Give me sight by pulling a vision model:',
      '',
      '```',
      'ollama pull llava:7b      # or a stronger VLM: qwen2.5vl, minicpm-v, llama3.2-vision',
      '```',
      '',
      "Then re-send the screenshot and I'll analyze the actual interface.",
    ].join('\n')
    step('generate', 'done', 'no vision model installed')
    sse(res, 'delta', { delta: msg })
    sse(res, 'done', { result: { run_id: crypto.randomUUID(), content: msg, model_routed: 'none', provider: 'noetica', policy_admitted: true, memory_written: false, stop_reason: 'no_vision_model', timestamp: new Date().toISOString(), latency_ms: lat, agent_machine: true, agent_machine_version: VERSION, decidable: true, method: 'vision-fallback' } })
    return
  }

  // Signal the SourceOS surface (bearbrowser) so it can auto-enable Tor while the
  // security lane is armed, and drop back when disarmed.
  writeSecurityState(routerDecision.securityLane?.armed === true)

  // Self-model routing hook (opt-in via NOETICA_CAPABILITY_ROUTING=1). If the
  // local model has a poor track record on this task family and a cloud key is
  // available, escalate. Default OFF so demo routing is unchanged unless enabled.
  if (process.env['NOETICA_CAPABILITY_ROUTING'] === '1' && provider === 'ollama') {
    const hint = capabilityHint(routerDecision.task ?? 'general')
    if (hint.recommendEscalation) {
      let escalated = false
      if (anthropicKey) { provider = 'anthropic'; model = 'claude-haiku-4-5-20251001'; escalated = true }
      else if (openaiKey) { provider = 'openai'; model = 'gpt-4o-mini'; escalated = true }
      if (escalated) {
        console.log(`[self-model] escalated task="${routerDecision.task}" → ${provider}:${model} (local success ${(hint.localSuccessRate ?? 0).toFixed(2)} over ${hint.localRuns} runs)`)
      }
    }
  }

  // Bandit routing (opt-in via NOETICA_BANDIT_ROUTING=1). Choose between the
  // router's primary and fallback for this task using a UCB1 bandit over learned
  // reward (VJ worth + user feedback). The model that produces better-judged
  // answers for a task family gets used more — self-improving, technique-driven.
  if (isFlagOn('NOETICA_BANDIT_ROUTING') && provider === 'ollama') {
    const fallbackModel = routerDecision.fallbackRoute
    const toolOk = (m: string) => LOCAL_MODEL_SUITE.find((x) => x.name === m)?.toolUse !== false
    const needTools = (body.tools?.length ?? 0) > 0
    const arms = [model, fallbackModel]
      .filter((m, i, a): m is string => Boolean(m) && a.indexOf(m) === i)
      .filter((m) => availableModels.includes(m) && (!needTools || toolOk(m)))
      // Latency guard: never let the bandit explore the slow CPU reasoner (deepseek-r1
      // emits long <think> chains) for non-reasoning tasks. A "what is X?" must not
      // land on it and stall the turn for minutes — that's what froze the demo.
      .filter((m) => routerDecision.task === 'reasoning' || !/deepseek-r1/i.test(m))
    const pick = selectArmUCB(routerDecision.task ?? 'general', arms)
    if (pick && pick !== model) {
      console.log(`[bandit] task="${routerDecision.task}" ${model} → ${pick} (arms: ${arms.join(', ')})`)
      model = pick
    }
  }

  // ── scope-d: engagement-policy gate across local + cloud ────────────────────
  // Before ANY cloud egress, gate against the scope-d EngagementPolicy. Local
  // routes perform no egress (always allowed — the sovereignty floor). When the
  // policy denies the egress — or is configured but missing/expired (fail-closed)
  // — route DOWN to local. Every decision is written as a scope-d Event-IR audit.
  {
    const scopeName = (POLICY_PROFILES[body.policy_profile ?? 'default'] ?? POLICY_PROFILES['default']!).scope
    const armed = routerDecision.securityLane?.armed === true
    if (provider !== 'ollama') {
      const tier: MeshTier = 'frontier'
      const target = provider === 'anthropic' ? 'api.anthropic.com' : 'api.openai.com'
      const verdict = checkEgress({
        scope: scopeName, policyProfile: body.policy_profile, securityArmed: armed,
        tier, provider, model, target,
        sensitivityTags: armed ? ['sovereign-only'] : [],
      })
      emitScopedTelemetry({ kind: 'egress', allow: verdict.allow, provider, model, tier, scope: scopeName, reason: verdict.reason, source: verdict.source })
      if (!verdict.allow) {
        // Route DOWN to local — the sovereignty floor. Best installed local model.
        const localPick = [routerDecision.fallbackRoute, 'qwen2.5:7b', ...availableModels]
          .find((m) => m && !m.startsWith('claude') && !m.startsWith('gpt') && availableModels.includes(m))
        if (ollamaUp && localPick) {
          console.warn(`[scope-d] egress denied (${verdict.reason}) → routing down to local ${localPick}`)
          provider = 'ollama'; model = localPick
        } else {
          sse(res, 'error', { error: `scope-d denied egress and no local model is available: ${verdict.reason}` })
          return
        }
      }
    } else {
      emitScopedTelemetry({ kind: 'route', provider, model, tier: 'local', scope: scopeName })
    }
  }

  // ── Chat-first concierge (O1) ───────────────────────────────────────────────
  // Plan the turn once: small-talk / self-questions / trivial asks are handled
  // inline by the fast concierge model (snappy, never a heavy-model wait); heavy
  // work keeps its routed worker model and is acknowledged + dispatched (below),
  // serialized through the capacity gate so the box never overcommits memory.
  let turnPlan: { mode: 'direct' | 'dispatch'; capability: string; ack?: string; reason: string } | null = null
  let dispatchGateRef: import('./lib/orchestrator.js').CapacityGate | null = null
  if (provider === 'ollama') {
    try {
      const { planTurn, dispatchGate } = await import('./lib/orchestrator.js')
      dispatchGateRef = dispatchGate
      turnPlan = planTurn(latestUserContent)
      // The 22-intent classifier is authoritative over planTurn's keyword guess, so
      // the two can't silently disagree. ONLY genuinely trivial intents get the fast
      // concierge model; substantive work (doc summary/QA, research, reasoning, build)
      // keeps its routed 7b worker — otherwise "summarize this report" falls into
      // planTurn's default "direct" bucket and gets quietly downgraded to the 3B.
      const conciergeIntents = new Set(['converse_smalltalk', 'confirm_steer', 'meta_capability', 'self_identity'])
      if (turnPlan.mode === 'direct' && conciergeIntents.has(intentPlan.name)) {
        const fast = ['llama3.2:3b', 'qwen2.5:7b'].find((m) => availableModels.includes(m))
        if (fast) { model = fast; console.log(`[concierge] direct turn → ${model} (${intentPlan.name})`) }
      }
    } catch { /* orchestration is best-effort — fall back to routed model */ }
  }

  // ── Responsive base (NOETICA_RESPONSIVE, default-on) ────────────────────────
  // Technique over horsepower: on this CPU box the 7B's ~5 tok/s prompt-eval makes
  // any RAG turn unusable (a 3K-token prompt = minutes just to READ it). The 3B runs
  // ~5× faster end-to-end (measured: 8.6s vs 21.9s on a 640-tok RAG prompt) and, with
  // our grounding + forms, answers accurately. So START substantive general/research/
  // writing turns on the 3B; the escalation step below climbs to a 7B only when the
  // turn actually struggles. Code/reasoning keep their routed worker.
  if (isFlagOn('NOETICA_RESPONSIVE') && provider === 'ollama') {
    // Fast 3B for NON-grounded turns (chat, quick general). But doc-grounded intents
    // (vector-rag) keep the 7B: the dry-run proved a 3B confabulates on specific-entity
    // questions even with the right chunks in context and a strict-grounding instruction
    // — it pattern-matches the entity to training instead of reading the sources. For
    // grounded Q&A, fidelity beats the ~10s we'd save. Escalation still climbs on struggle.
    // Non-doc-grounded reasoning (plan/compute/explain) goes fast too — the !docGrounded
    // guard below is what protects retrieval fidelity, so reasoning only stays heavy when
    // it's actually grounding on a document. Otherwise plan_nextsteps stalls on deepseek-r1.
    // Quality-aware responsiveness: only small-talk / quick drafts get the fast 3B. Code
    // and reasoning NEVER run on the 3B (it fabricates output instead of doing the work) —
    // code goes to the dedicated coder, reasoning to a capable 7B (beats the 3B on quality
    // and deepseek-r1 on latency). Doc-grounded turns keep their routed 7B for fidelity.
    const docGrounded = wantsVectorRag(intentPlan.retrieval)
    const has = (m: string) => availableModels.includes(m)
    const task = routerDecision.task ?? 'general'
    const before = model
    if (!docGrounded) {
      if (['general', 'writing', 'chat'].includes(task) && has('llama3.2:3b')) {
        model = 'llama3.2:3b'
      } else if (task === 'coding') {
        model = has('qwen2.5-coder:7b') ? 'qwen2.5-coder:7b' : has('qwen2.5:7b') ? 'qwen2.5:7b' : model
      } else if (task === 'reasoning') {
        model = has('qwen2.5:7b') ? 'qwen2.5:7b' : has('qwen2.5-coder:7b') ? 'qwen2.5-coder:7b' : model
      }
    }
    if (model !== before) console.log(`[responsive] ${task} ${before} → ${model}`)
  }

  // ── Escalation: climb to a more capable model when the cheap flow is failing ──
  // After 2 unresolved turns in a session — or 1 turn when intent/path confidence is
  // low — fall back to a more capable model (cloud when a key is present, else the
  // best available local). The final word on routing, overriding bandit/concierge.
  let escalated = false
  const trivialIntent = ['converse_smalltalk', 'confirm_steer', 'meta_capability', 'self_identity'].includes(intentPlan.name)
  if (provider === 'ollama' && !trivialIntent) {
    try {
      const { sessionStruggle } = await import('./lib/dialogue-tracker.js')
      const { decideEscalation } = await import('./lib/dialogue-policy.js')
      const struggle = sessionStruggle(body.session_id ?? 'local')
      const esc = decideEscalation({
        intentScore: intentPlan.score,
        consecutiveUnresolved: struggle.consecutiveUnresolved,
        hasAnthropic: Boolean(anthropicKey), hasOpenAI: Boolean(openaiKey),
        availableModels, currentModel: model,
      })
      if (esc.escalate && esc.model) {
        provider = esc.provider as typeof provider; model = esc.model; escalated = true
        sse(res, 'escalation', { escalation: { to: `${provider}:${model}`, reason: esc.reason } })
        const { narrateEscalation } = await import('./lib/narration.js')
        narrate(narrateEscalation(model, intentPlan.name, esc.reason ?? ''))
        console.log(`[escalation] → ${provider}:${model} (${esc.reason})`)
      }
    } catch { /* escalation is best-effort */ }
  }

  // Announce the final model choice + purpose (the "using X to do Y" the user asked
  // for). Reflects every prior adjustment — responsive downgrade, escalation, concierge.
  try {
    const { narrateRoute } = await import('./lib/narration.js')
    const isFast = /llama3.2:3b|3b/i.test(model)
    const isConcierge = turnPlan?.mode === 'direct' && ['converse_smalltalk', 'confirm_steer', 'meta_capability', 'self_identity'].includes(intentPlan.name)
    narrate(narrateRoute(model, intentPlan.name, { fast: isFast && !isConcierge, concierge: isConcierge }))
  } catch { /* narration best-effort */ }

  const apiKey = provider === 'openai' ? openaiKey : anthropicKey

  const run_id = crypto.randomUUID()
  const timestamp = new Date().toISOString()
  const started = Date.now()

  sse(res, 'meta', {
    governance: {
      run_id,
      model_routed: model,
      provider,
      policy_admitted: true,
      memory_written: false,
      timestamp,
      agent_machine: true,
      agent_machine_version: VERSION,
    },
  })

  // Merge built-in tools with any tools from the request.
  // If the routed model doesn't support tool use, pass an empty set — sending
  // tools to a model that can't handle them causes it to output raw JSON blobs.
  const modelSupportsTools = provider !== 'ollama'
    || LOCAL_MODEL_SUITE.find((m) => m.name === model)?.toolUse !== false
  // generate_image requires an OpenAI (DALL·E) key. In a pure-local setup with no key,
  // drop it so the model never calls a tool that can only return an error.
  const imageGenAvailable = Boolean(openaiKey)
  // Scope the agent's builtin tools to what THIS intent should reach for (the
  // intent→tools map), instead of exposing every tool on every turn — a doc summary
  // shouldn't be offered code_execute, etc. Trivial intents (smalltalk/confirm) map
  // to no tools. User-supplied (MCP) tools always pass through regardless of intent.
  const intentToolSet = new Set<string>(intentPlan.tools)
  // Finance rides along wherever web_search is offered (finance questions are
  // research-shaped), and pulls render_chart with it so "chart AAPL" can plot.
  if (intentToolSet.has('web_search')) { intentToolSet.add('public_data'); intentToolSet.add('render_chart') }
  // The concierge can delegate to focused sub-agents on any substantive (tool-bearing) turn —
  // research/build/review/analysis chunks, fanned out in parallel. Not offered on trivial
  // smalltalk/confirm intents (which carry no tools), so it never fires for chit-chat.
  if (intentToolSet.size > 0) intentToolSet.add('dispatch_agent')
  // Agent mode: 'plan' produces a plan WITHOUT executing (no tools offered); 'ask'/'auto' keep tools.
  const agentMode = body.agent_mode === 'plan' || body.agent_mode === 'ask' ? body.agent_mode : 'auto'
  const allTools: ProviderTool[] = (modelSupportsTools && agentMode !== 'plan')
    ? BUILTIN_TOOLS.filter((t) => intentToolSet.has(t.name) && (t.name !== 'generate_image' || imageGenAvailable))
    : []
  if (modelSupportsTools) {
    for (const t of body.tools ?? []) {
      if (!allTools.some((b) => b.name === t.name)) allTools.push(t)
    }
  }

  // Filter to valid roles with non-empty content; hard-cap history to 100 turns
  // to prevent quadratic token estimation on adversarially long sessions.
  const incomingMessages = (body.messages ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && String(m.content ?? '').trim().length > 0)
    .slice(-100)

  // Long-horizon agentic loop: coding tasks legitimately chain many tool calls
  // (read → edit → run tests → repair), so give them more headroom; keep other
  // tasks tighter. Tunable via NOETICA_MAX_TURNS.
  const MAX_TURNS = Math.max(1, Math.min(40, Number(process.env['NOETICA_MAX_TURNS'])
    || (routerDecision.task === 'coding' ? 24 : 12)))
  let fullContent = ''
  let fullThinking = ''
  let liveContent = '' // accumulates streamed deltas in real time (for checkpoint-on-abort)
  let lastToolCalls: ToolUseBlock[] | undefined

  // ── HellGraph retrieval ──────────────────────────────────────────────────────
  // Run multi-pattern retrieval against the metagraph and inject relevant
  // context into the system prompt before the LLM call. For Ollama requests
  // the cache-augmented prefix is stable across a session so the KV cache
  // warms after the first turn and subsequent turns are faster.
  const sessionId = body.session_id ?? run_id

  // Checkpoint on interruption: if the client aborts (stop button / disconnect)
  // before the run completes, persist the partial state so it can be resumed.
  let runCompleted = false
  res.on('close', () => {
    if (runCompleted || !liveContent.trim()) return
    try {
      saveCheckpoint({
        id: `urn:checkpoint:${run_id}`,
        run_id, session_id: sessionId, status: 'interrupted',
        model, provider, task: routerDecision.task,
        messages: incomingMessages.map((m) => ({ role: m.role, content: String(m.content ?? '') })),
        partial_content: liveContent,
        partial_thinking: fullThinking,
        created_at: new Date().toISOString(),
      })
      console.log(`[checkpoint] saved interrupted run ${run_id} (${liveContent.length} chars, ${fullThinking.length} thinking)`)
    } catch { /* checkpointing is best-effort */ }
  })

  // Always include beliefs to connect the digital twin to every chat turn.
  // Ollama gets the cache-augmented prefix too (stable KV cache warm-up).
  // CairnPath retrieval (opt-in via NOETICA_CAIRNPATH_RETRIEVAL=1) routes entity
  // neighborhood expansion through the CairnPath EXPAND→DEDUP→RANK→CAP invariant
  // instead of the ad-hoc graph BFS. Default OFF — the proven path is unchanged.
  const useCairnPath = process.env['NOETICA_CAIRNPATH_RETRIEVAL'] === '1'
  const patterns: Array<'beliefs' | 'graph' | 'temporal' | 'sparql' | 'cache-augmented' | 'cairnpath'> =
    provider === 'ollama'
      ? (useCairnPath
          ? ['beliefs', 'cache-augmented', 'cairnpath', 'temporal']
          : ['beliefs', 'cache-augmented', 'graph', 'temporal'])
      : (useCairnPath
          ? ['beliefs', 'cairnpath', 'temporal']
          : ['beliefs', 'graph', 'temporal'])

  let graphContext = ''
  try {
    // On low-memory CPU hosts, cap injected memory context hard — prompt-eval of a
    // big context dominates latency for a local 3B on CPU. Smaller context = much
    // faster responses (the main "speed it up" lever on an 8GB box).
    const { isLowMemoryHost } = await import('./lib/ollama.js')
    const memCap = provider === 'ollama' ? (isLowMemoryHost() ? 400 : 1200) : 900
    const retrieved = await retrieve(latestUserContent, {
      patterns,
      sessionId,
      conversationId: body.conversation_id,
      maxTokens: memCap,
    })
    if (retrieved.text.trim()) {
      graphContext = `\n\n---\n**Memory context (HellGraph)**\n${retrieved.text}`
    }
    // Emit the neurosymbolic reasoning trace so the UI can show *why* this answer
    // was grounded — attention-ranked atoms, pattern timings, beliefs injected.
    const beliefHits = retrieved.workingMemory?.retrieval_path?.find((p) => p.pattern === 'beliefs')?.hits ?? 0
    sse(res, 'retrieval', {
      trace: {
        patterns: retrieved.patterns,
        timings: retrieved.workingMemory?.retrieval_path ?? [],
        sources: retrieved.sources.slice(0, 8),
        token_estimate: retrieved.tokenEstimate,
        beliefs_injected: beliefHits,
      },
    })
  } catch { /* retrieval is best-effort — never block the LLM call */ }

  // ── Semantic document retrieval (real RAG over uploaded files) ──────────────
  // Embed the query and pull the most relevant DocumentChunks. This is what makes
  // "upload a doc and ask about it" actually work — the graph patterns above are
  // structural, not semantic. Injected as authoritative source context.
  try {
    const { semanticSearch, documentChunkCount } = await import('./lib/doc-store.js')
    // Skip doc retrieval entirely for intents that want no grounding (greetings,
    // confirmations, file ops) — otherwise a plain "hello" wastefully pulls passages
    // and shows a misleading "retrieving" step.
    if (documentChunkCount() > 0 && intentPlan.retrieval !== 'none') {
      // Intent-aware retrieval. Doc-focused intents (summarize_doc / qa_over_doc /
      // research) get a tight top-k of the MOST relevant chunks instead of stuffing
      // the whole document into context — this is the fix for the 300–500s latency
      // (CPU prompt-eval scales with prompt size) AND the hallucination (a focused,
      // on-topic context keeps a small local model from drifting to training priors).
      const docFocused = wantsVectorRag(intentPlan.retrieval)
      // Responsive mode keeps the prompt lean — prompt-eval is the CPU bottleneck, so
      // fewer + shorter passages directly cut time-to-first-token. Full mode retrieves
      // wider for richer grounding when latency isn't the constraint.
      const lean = isFlagOn('NOETICA_RESPONSIVE')
      // 4 passages even in lean mode: 2 was too few — the question-specific chunk could
      // miss the cut, and a small model with no grounding fabricates (saw it invent a
      // fake "Hurricane Helene 2008"). Recall protects correctness; the 480-char cap
      // keeps the token budget (and latency) in check.
      const topK = lean ? 4 : (docFocused ? 5 : 3)
      const chunkCap = lean ? 480 : 1200
      // Bias retrieval with the recognized glossary terms so the chunks we pull are
      // topically on-target (better grounding + more relevant citations), not just
      // lexically near the raw phrasing.
      const ragQuery = glossaryTerms.length > 0
        ? `${latestUserContent}\n${glossaryTerms.join(' ')}`
        : latestUserContent
      const hits = await semanticSearch(ragQuery, topK)
      if (hits.length > 0) {
        docHitCount = hits.length
        docHits = hits
        const docBlock = hits.map((h, i) => `[${i + 1}] (${h.filename}) ${h.text.slice(0, chunkCap)}`).join('\n\n')
        // For doc-focused intents, demand strict grounding: answer ONLY from the
        // sources, name the gap rather than invent. This is what stops the model
        // from fabricating facts that contradict the uploaded document.
        const instruction = docFocused
          ? `Answer ONLY from these sources. Do NOT use prior knowledge — if the sources don't contain the answer, say exactly what's missing, and never state a fact that isn't in a source. Cite rigorously: end every factual sentence with its source marker, e.g. "80% of plants rely on municipal tap water [1]." A claim without a [n] marker is not allowed.`
          : `Answer from these sources when relevant and end each grounded sentence with its source marker, e.g. "… [1]." If the sources don't cover the question, say so.`
        graphContext = `\n\n---\n**Document context (uploaded sources)**\n${instruction}\n\n${docBlock}${graphContext}`
        sse(res, 'retrieval', {
          trace: { patterns: ['semantic-documents'], sources: hits.map((h) => ({ id: h.docId, label: h.filename, score: Number(h.score.toFixed(3)) })), token_estimate: docBlock.length >> 2, beliefs_injected: 0 },
        })
      }
    }
  } catch { /* document RAG is best-effort */ }

  // ── Self-model grounding ────────────────────────────────────────────────────
  // When the user asks about the agent itself / how it works, inject the verified
  // construction self-model so it answers from fact (the repos that build it),
  // not speculation. The structured block is always accurate; ingested self-docs
  // also surface via the RAG block above once /api/self/ingest-construction runs.
  let selfContext = ''
  try {
    const { isSelfQuery, selfGroundingBlock } = await import('./lib/self-model.js')
    if (isSelfQuery(latestUserContent)) {
      selfContext = `\n\n---\n${selfGroundingBlock()}\nAnswer questions about yourself, your construction, and how you compare to other providers from this self-model. Be concrete about which repository does what, and when comparing to Claude/GPT/others, give a real honest comparison (local-first sovereignty + the out-loop system vs their frontier raw power) — never a vague surface description.`
    }
  } catch { /* self-model grounding is best-effort */ }

  // ── Moat 3: prime-topic context graph + complexity discipline ───────────────
  // Build the per-question context graph + episodic KG entry (KB vector recall +
  // graph linking + prime-topic decomposition), classify the task's complexity
  // posture, and surface calibrated confidence + proof barriers in the governance
  // trail. Makes the neurosymbolic moat the agent's everyday behavior.
  let moatContext = ''
  let moatEpisodeId = ''
  try {
    const { classifyComplexity, calibratedConfidence } = await import('./lib/complexity-discipline.js')
    // Cheap, always-on: posture classification (regex, no model/embedding call).
    const verdict = classifyComplexity(latestUserContent)
    let primeSig = ''; let primeFactors: string[] = []
    // Heavy, opt-in (NOETICA_MOAT_CONTEXT=1): per-question embedding + graph
    // linking + episodic KG + grounding injection. OFF by default because on a
    // low-memory CPU box it adds an embedding call + a large prompt to EVERY turn,
    // which makes simple chats slow. The moat code is shipped; this just keeps the
    // hot path light until we have the headroom / async pre-fetch.
    if (isFlagOn('NOETICA_MOAT_CONTEXT')) {
      const { buildQuestionContext } = await import('./lib/question-context.js')
      const qctx = await buildQuestionContext(latestUserContent)
      moatEpisodeId = qctx.episodeId
      if (qctx.grounding) moatContext = qctx.grounding
      primeSig = qctx.primeSignature
      primeFactors = qctx.primeFactors.map((f) => `${f.code}^${f.exp}`)
    }
    const confidence = calibratedConfidence(verdict, { grounded: moatContext.length > 0 })
    sse(res, 'discipline', { discipline: {
      posture: verdict.posture, strategy: verdict.strategy, barriers: verdict.barriers,
      morphology: verdict.morphology, calibrated_confidence: confidence,
      prime_signature: primeSig, prime_factors: primeFactors, non_claims: verdict.nonClaims,
    } })
  } catch { /* moat enrichment is best-effort */ }

  // The SECURITY_RESEARCHER authorization suffix arms only under self-attestation —
  // mirrors the router's lane gate. Unattested 'security' degrades to the 'research'
  // prompt (dual-use depth, but not the full no-disclaimers security context).
  const profileKey = (body.policy_profile === 'security' && body.security_attested !== true)
    ? 'research'
    : (body.policy_profile ?? 'default')
  const profile = POLICY_PROFILES[profileKey] ?? POLICY_PROFILES['default']!
  const basePrompt = body.system_prompt ?? NOETICA_SYSTEM_PROMPT
  // Inject current datetime so the model always has accurate temporal context
  const nowUtc = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
  const dateLine = `\n\nCurrent date/time: ${nowUtc}`
  // Reasoning directive (R5): tell the reasoning model to actively USE the injected
  // belief/law state and to self-flag contradictions in its reasoning. This makes
  // the neural reasoner and the symbolic substrate complement each other rather
  // than run side by side. Added only when there is memory context to reason over.
  const reasoningDirective = (routerDecision.task === 'reasoning' && graphContext)
    ? `\n\n## Reasoning directive\nGround your reasoning in the Memory context and Belief state above. If your conclusion contradicts a stated belief or candidate law, say so explicitly and explain which one and why — do not silently override it.`
    : ''

  // Goal / plan state: keep the session's active objective in context across turns
  // (orchestration). Explicit API goals always inject; auto-detection from chat is
  // gated behind NOETICA_GOAL_TRACKING to avoid mistaking chatter for objectives.
  let goalContext = ''
  try {
    let activeGoal = getActiveGoal(sessionId)
    if (!activeGoal && isFlagOn('NOETICA_GOAL_TRACKING')) {
      const intent = detectGoalIntent(latestUserContent)
      if (intent) {
        const now = new Date().toISOString()
        activeGoal = { id: `urn:goal:${crypto.randomUUID()}`, session_id: sessionId, objective: intent.objective, status: 'active', subtasks: [], slots: [], created_at: now, updated_at: now }
      }
    }
    if (activeGoal) {
      activeGoal.slots = slotFill(activeGoal.slots, latestUserContent)
      activeGoal.updated_at = new Date().toISOString()
      saveGoal(activeGoal)
      goalContext = buildGoalContext(activeGoal)
    }
  } catch { /* goal tracking is best-effort — never block the turn */ }

  // Active long-term memory: inject what the user has asked the agent to remember (the
  // `remember`-tool facts), pinned-first, every turn. This is the fix for "memory stored but
  // not recalled" — facts now actually surface in context. Bounded to 8 short lines so it's
  // cheap; pinned (curated into the long-term brain) are marked and always lead.
  let memoryContext = ''
  let recalledMems: Array<{ kind: string; preview: string; pinned: boolean }> = []
  try {
    const { selectRelevantMemories } = await import('./lib/memory-curation.js')
    const g = getHellGraph()
    const memStore = {
      nodesByLabel: (l: string) => g.nodesByLabel(l) as any[],
      getNode: (id: string) => g.getNode(id) as any,
      out: (id: string, e?: string) => g.out(id, e) as any[],
      setProperty: () => { /* read-only here */ },
    }
    // Relevance-ranked recall: pinned always, unpinned only when relevant to this turn's query
    // (no more "ask the weather, get 'prefers coffee'").
    const mems = selectRelevantMemories(memStore, latestUserContent, 8)
    recalledMems = mems.map((m) => ({ kind: m.kind, preview: m.preview.slice(0, 100), pinned: m.pinned }))
    if (mems.length > 0) {
      memoryContext = `\n\n---\n**Long-term memory (what you've been asked to remember — honor these)**\n` +
        mems.map((m) => `- ${m.pinned ? '📌 ' : ''}(${m.kind}) ${m.preview}`).join('\n')
    }
  } catch { /* memory injection best-effort */ }

  // Cross-session episodic recall: prior exchanges relevant to this question, so the agent
  // remembers what was discussed in EARLIER sessions (the Interaction layer was write-only).
  let episodeContext = ''
  let recalledEpisodes: Array<{ question: string }> = []
  try {
    const { recallExchanges, formatExchanges } = await import('./lib/episodic.js')
    const gEp = getHellGraph()
    const exchanges = recallExchanges({ nodesByLabel: (l: string) => gEp.nodesByLabel(l) as any[] }, latestUserContent, { limit: 3 })
    recalledEpisodes = exchanges.map((e) => ({ question: e.question.slice(0, 120) }))
    episodeContext = formatExchanges(exchanges)
  } catch { /* episodic recall best-effort */ }

  // Provenance: surface what the agent REMEMBERED + RECALLED for this answer (merges into the
  // retrieval trace shown in the UI). Best-effort.
  if (recalledMems.length > 0 || recalledEpisodes.length > 0) {
    sse(res, 'retrieval', { trace: { patterns: [], timings: [], sources: [], token_estimate: 0, beliefs_injected: 0, memory_sources: recalledMems, episode_sources: recalledEpisodes } })
  }

  // Few-shot training memory: inject the best gold Q/A exemplars for this intent —
  // in-context "training" on the Pareto-head cases, no model update needed. Opt-in
  // (NOETICA_QA_FEWSHOT) because each exemplar adds prompt tokens (latency) on CPU.
  let qaContext = ''
  if (isFlagOn('NOETICA_QA_FEWSHOT')) {
    try {
      const { bestExemplars } = await import('./lib/qa-pairs.js')
      const ex = bestExemplars(intentPlan.name, 2)
      if (ex.length > 0) {
        qaContext = `\n\n---\n**Worked examples (gold answers for ${intentPlan.name.replace(/_/g, ' ')})**\nMatch this style and rigor.\n\n` +
          ex.map((e) => `Q: ${e.question}\nA: ${e.answer.slice(0, 300)}`).join('\n\n')
      }
    } catch { /* few-shot memory is best-effort */ }
  }

  // Context assembled — close out the retrieve step.
  step('retrieve', 'done', docHitCount > 0 ? `${docHitCount} passage${docHitCount === 1 ? '' : 's'}` : (graphContext ? 'memory grounding' : 'no extra context'))
  if (docHitCount > 0 || wantsVectorRag(intentPlan.retrieval)) { try { const { narrateRetrieve } = await import('./lib/narration.js'); narrate(narrateRetrieve(docHitCount)) } catch { /* best-effort */ } }

  // ── Logic-first front (NOETICA_LOGIC_FIRST, default-on): RECALL ─────────────
  // The cheapest decidable path — the question's key → a crystallized, ATTESTED prior
  // proof. Instant, deterministic, replayable (POS@T1). This is solveByLogic step 1;
  // extract (below) is step 2; generation is the undecidable remainder. The decidable
  // region expands with use: each generated answer crystallizes, so it recalls next time.
  // Skip when an image is attached — the user wants the model to LOOK at the image, not
  // reuse a cached text answer (vision must reach the model, not a recall short-circuit).
  if (isFlagOn('NOETICA_LOGIC_FIRST') && !hasImages) {
    try {
      const { recallArtifact } = await import('./lib/crystallize.js')
      const hit = recallArtifact(latestUserContent)
      if (hit && hit.answer) {
        const lat = Date.now() - turnStart
        step('generate', 'done', 'computed by logic (recall)')
        narrate({ stage: 'extract', text: 'I already worked this out — reusing the verified, replayable answer.' })
        sse(res, 'delta', { delta: hit.answer })
        try {
          const { recordDispatch, contentHash } = await import('./lib/dispatch-ledger.js')
          recordDispatch({ session: body.session_id ?? 'local', requestHash: contentHash(latestUserContent), action, polarity, tier: actionRoute.tier, target: actionRoute.target, phase, barCleared: true, residual: [], model: 'recall', answerHash: contentHash(hit.answer), latencyMs: lat, grounded: true, verdict: 'POS' })
          const { recordTurn } = await import('./lib/dialogue-tracker.js')
          recordTurn({ session_id: body.session_id ?? 'local', intent: intentPlan.name, intent_score: intentPlan.score, fallback: false, slots_expected: intentPlan.slots, slots_filled: policy.filled, fill_rate: policy.fillRate, clarified: false, entities: glossaryTerms, surface: intentPlan.surface, skill: intentPlan.skill, tools: intentPlan.tools, capability: intentPlan.model, model: 'recall', retrieval: intentPlan.retrieval, grounded: true, latency_ms: lat, worth: 0.85, reward: 0.85, escalated: false })
        } catch { /* tracking best-effort */ }
        sse(res, 'done', { result: { run_id: crypto.randomUUID(), content: hit.answer, model_routed: 'recall', provider: 'noetica', policy_admitted: true, memory_written: false, stop_reason: 'computed', timestamp: new Date().toISOString(), latency_ms: lat, agent_machine: true, agent_machine_version: VERSION, decidable: true, method: 'recall' } })
        return
      }
    } catch { /* recall is best-effort — fall through to extract/generation */ }
  }

  // ── Extractive grounded answering (NOETICA_EXTRACTIVE, default-on): EXTRACT ───
  // For doc-grounded intents, answer by EXTRACTING the doc's own cited sentences
  // instead of asking a weak/slow local model to generate. It cannot hallucinate
  // (every word is from the source — the fix for the 3B's fabricated facts) and is
  // ~instant (no token generation). Falls through to model generation only if nothing
  // in the passages matches the question.
  // Gate on hasDoc (not semantic docHits): extraction scans a LEXICAL pool internally,
  // so it must run whenever a doc is loaded even if the weak-embedding semantic pass
  // returned nothing — that's how entity questions land in the decidable region. The
  // extractor returns null safely (cannot fabricate) when nothing lexically matches.
  // …but NOT when an image is attached: a screenshot + "how would you improve this?" must go
  // to the vision model, not be answered by extracting sentences from an unrelated doc.
  if (isFlagOn('NOETICA_EXTRACTIVE') && wantsVectorRag(intentPlan.retrieval) && hasDoc && !hasImages) {
    try {
      const { extractiveAnswer } = await import('./lib/extractive-qa.js')
      // Extraction scans a WIDER lexical pool (term-matched, reliable for entity Qs)
      // rather than only the 4 weak-embedding hits — that's how the Baxter/Helene
      // passage actually surfaces. Sentence ranking then picks the on-point lines.
      const { lexicalSearch } = await import('./lib/doc-store.js')
      const pool = lexicalSearch(latestUserContent, 15)
      const exHits = pool.length > 0 ? pool : docHits
      const ex = extractiveAnswer(latestUserContent, exHits, { maxSentences: intentPlan.name === 'summarize_doc' ? 6 : 5 })
      if (ex) {
        step('generate', 'done', 'extracted from sources')
        try { const { narrateExtract } = await import('./lib/narration.js'); narrate(narrateExtract()) } catch { /* best-effort */ }
        sse(res, 'delta', { delta: ex.answer })
        const exLatency = Date.now() - turnStart
        try {
          const { recordTurn } = await import('./lib/dialogue-tracker.js')
          const { computeReward } = await import('./lib/symbolic-policy.js')
          const worth = 0.85 // grounded + cited by construction
          const reward = computeReward({ worth, latencyMs: exLatency, grounded: true, fillRate: policy.fillRate })
          recordTurn({
            session_id: body.session_id ?? 'local', intent: intentPlan.name, intent_score: intentPlan.score,
            fallback: false, slots_expected: intentPlan.slots, slots_filled: policy.filled, fill_rate: policy.fillRate,
            clarified: false, entities: glossaryTerms, surface: intentPlan.surface, skill: intentPlan.skill,
            tools: intentPlan.tools, capability: intentPlan.model, model: 'extractive', retrieval: intentPlan.retrieval,
            grounded: true, latency_ms: exLatency, worth, reward, escalated: false,
          })
          const { recordQAPair } = await import('./lib/qa-pairs.js')
          recordQAPair({ question: latestUserContent, answer: ex.answer, intent: intentPlan.name, worth, reward, grounded: true, model: 'extractive' })
          if (isFlagOn('NOETICA_FABRIC')) {
            const { writeFabricEntry } = await import('./lib/fabric.js')
            writeFabricEntry({ kind: 'thread', text: latestUserContent, provenance: 'concierge', session: body.session_id ?? 'local', confidence: worth })
          }
          // §10.3 Evidence: the extractive (read/diffuse, fully deterministic) dispatch — POS@T1.
          const { recordDispatch, contentHash } = await import('./lib/dispatch-ledger.js')
          const dispatchEntry = recordDispatch({
            session: body.session_id ?? 'local', requestHash: contentHash(latestUserContent),
            action, polarity, tier: actionRoute.tier, target: actionRoute.target, phase,
            barCleared: true, residual: [], model: 'extractive',
            answerHash: contentHash(ex.answer), latencyMs: exLatency, grounded: true, verdict: 'POS',
          })
          // Crystallize the (deterministic, grounded) extractive answer as a durable artifact.
          const { crystallizeAnswer } = await import('./lib/crystallize.js')
          crystallizeAnswer({ question: latestUserContent, answer: ex.answer, session: body.session_id ?? 'local', action, attestation: dispatchEntry.attestation, worth })
        } catch { /* tracking best-effort */ }
        sse(res, 'done', { result: {
          run_id: crypto.randomUUID(), content: ex.answer, model_routed: 'extractive', provider: 'noetica',
          policy_admitted: true, memory_written: false, stop_reason: 'extractive', timestamp: new Date().toISOString(),
          latency_ms: exLatency, agent_machine: true, agent_machine_version: VERSION, extractive: true,
        } })
        return
      }
    } catch { /* extractive is best-effort — fall through to generation */ }
  }

  step('generate', 'running', `${provider}:${model}`)

  // Reply length is user-tunable (short/medium/long): a verbosity instruction here + a token
  // ceiling below, so the model writes the right amount rather than truncating mid-sentence.
  const replyLen = body.reply_length === 'short' || body.reply_length === 'medium' || body.reply_length === 'long' ? body.reply_length : undefined
  const verbosityNote = replyLen === 'short'
    ? '\n\nReply BRIEFLY — a few sentences, no preamble, no filler. Get to the point.'
    : replyLen === 'long'
      ? '\n\nReply THOROUGHLY — explain in depth, with structure and concrete examples where useful.'
      : ''

  // Agent mode shapes autonomy: plan = propose only, ask = confirm before acting, auto = just do it.
  const modeNote = agentMode === 'plan'
    ? '\n\nPLAN MODE: Do NOT execute anything, run commands, write files, or call tools. Produce a clear, numbered step-by-step PLAN of what you would do, then stop and wait for the user to approve before any action.'
    : agentMode === 'ask'
      ? '\n\nASK MODE: Before running any command, writing/modifying any file, or taking any irreversible action, first state concisely what you intend to do and ask the user to confirm. Read-only steps are fine without asking.'
      : ''

  const enrichedSystemPrompt = basePrompt + dateLine + fabricContext + groundingContext + qaContext + graphContext + selfContext + moatContext + memoryContext + episodeContext + goalContext + reasoningDirective + verbosityNote + modeNote + profile.authorizationSuffix

  // Token budget: rough estimate (4 chars ≈ 1 token). If message history + system prompt
  // exceeds 70% of the model's context window, trim oldest non-system messages.
  // Model context windows: Anthropic claude-haiku-4-5/sonnet-4-6 = 200K, Ollama varies.
  // For Ollama, read the model's REAL context length from /api/show rather than
  // hardcoding — modern local models ship 32k–128k and were being capped at 8k.
  // Cap at 32k for demo memory safety (num_ctx allocates a KV cache proportional to this).
  let ollamaNumCtx = 16384
  if (provider === 'ollama') {
    const realCtx = await getModelContextLength(model)
    if (realCtx) ollamaNumCtx = Math.min(realCtx, 32_768)
  }
  const MODEL_CONTEXT_TOKENS = provider === 'ollama' ? ollamaNumCtx : 180_000
  const TOKEN_BUDGET = Math.floor(MODEL_CONTEXT_TOKENS * 0.70)
  // Sanitize request-level sampling params (apply across all providers).
  const reqTemperature = typeof body.temperature === 'number'
    ? Math.max(0, Math.min(body.temperature, 2)) : undefined
  const REPLY_TOKENS: Record<string, number> = { short: 450, medium: 1400, long: 4000 }
  const reqMaxTokens = typeof body.max_tokens === 'number' && body.max_tokens > 0
    ? Math.min(Math.floor(body.max_tokens), 16_000)
    : replyLen
      ? REPLY_TOKENS[replyLen]
      // Responsive mode caps output so a turn completes promptly instead of rambling
      // (generation is also CPU-bound); full mode lets the model run to its natural stop.
      : (isFlagOn('NOETICA_RESPONSIVE') && provider === 'ollama' ? 384 : undefined)
  function estimateTokens(s: string): number { return Math.ceil(s.length / 4) }
  let systemTokens = estimateTokens(enrichedSystemPrompt)
  let msgTokens = incomingMessages.reduce((s, m) => s + estimateTokens(String(m.content ?? '')), 0)
  // Trim oldest user+assistant pairs if over budget
  while (systemTokens + msgTokens > TOKEN_BUDGET && incomingMessages.length > 2) {
    const removed = incomingMessages.shift()
    msgTokens -= estimateTokens(String(removed?.content ?? ''))
  }

  // ── Right-size the KV cache to the ACTUAL prompt (CPU latency fix) ───────────
  // num_ctx drives both KV-cache allocation and per-token prompt-eval cost. On a
  // CPU box, always allocating the model's full 32K window for a focused 2–3K RAG
  // prompt is the single biggest avoidable cost — it's much of the 300–500s tail.
  // Bucket the size (so similar turns reuse the SAME loaded model — varying num_ctx
  // forces Ollama to reload) to just cover prompt + expected output + headroom.
  if (provider === 'ollama') {
    const desiredOutput = reqMaxTokens ?? 2048
    const needed = systemTokens + msgTokens + desiredOutput + 512
    const BUCKETS = [2048, 4096, 8192, 16384, 32768]
    const fitted = BUCKETS.find((b) => b >= needed) ?? ollamaNumCtx
    ollamaNumCtx = Math.min(ollamaNumCtx, fitted)
  }

  try {
    if (provider === 'ollama') {
      // ── Local Ollama path (primary) ──────────────────────────────────────────
      type OllamaContentPart =
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      type OllamaMsg =
        | { role: 'system'; content: string | OllamaContentPart[] }
        | { role: 'user'; content: string | OllamaContentPart[] }
        | { role: 'assistant'; content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
        | { role: 'tool'; content: string; tool_call_id: string }

      const ollamaMessages: OllamaMsg[] = []
      const ollamaSystemPrompt = enrichedSystemPrompt + (allTools.length > 0 ? TOOL_USE_INSTRUCTIONS : '')
      if (ollamaSystemPrompt) {
        ollamaMessages.push({ role: 'system', content: ollamaSystemPrompt })
      }
      for (const m of incomingMessages) {
        if (m.role === 'user') {
          const images = m.attachments
            ?.filter((a) => a.kind === 'image')
            .map((a) => ({ base64: a.base64, mimeType: a.mimeType || 'image/jpeg' })) ?? []
          // Non-image attachments: decode and append as text
          const textParts = m.attachments
            ?.filter((a) => a.kind !== 'image')
            .map((a) => {
              try { return `**${a.name}**\n\`\`\`\n${Buffer.from(a.base64, 'base64').toString('utf-8')}\n\`\`\`` }
              catch { return '' }
            })
            .filter(Boolean) ?? []
          const fullContent = [m.content, ...textParts].filter(Boolean).join('\n\n')
          // Vision: use OpenAI-compat content array when images present
          if (images.length > 0) {
            const contentParts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
              { type: 'text', text: fullContent || 'Describe the image(s).' },
              ...images.map((img) => ({
                type: 'image_url' as const,
                image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
              })),
            ]
            ollamaMessages.push({ role: 'user', content: contentParts })
          } else {
            ollamaMessages.push({ role: 'user', content: fullContent })
          }
        } else if (m.role === 'assistant') {
          ollamaMessages.push({ role: 'assistant', content: m.content })
        }
      }

      // ── Critic: best-of-N → verify → select → GATE (default on) ───────────────
      // Behavior Generation proposes N candidates; the Critic scores each against the
      // world model + posture, SELECTS the best (self-consistency breaks ties toward
      // consensus), and GATES: accept / escalate / clarify. "Out-loop, not out-model"
      // — several cheap local samples + symbolic selection beat one first-token reply.
      // On ESCALATE with real grounding, spend one sample on a stronger LOCAL model
      // (sovereign 7B→14B) before any cloud egress. Tunable: NOETICA_BESTOF_N (default
      // 3, set 1 to disable), NOETICA_CRITIC=0 to turn off. Skipped for tool turns,
      // trivial chat, and non-Ollama providers (those have their own paths).
      let deliberated = false
      const bestOfN = Math.max(1, Math.min(8, Math.floor(Number(process.env['NOETICA_BESTOF_N'] ?? 3)) || 3))
      const criticEnabled = process.env['NOETICA_CRITIC'] !== '0' && bestOfN > 1
        && allTools.length === 0 && routerDecision.task !== 'chat'

      // Verify-by-execution (the strong test-time-compute lever): for a `compute`
      // posture — arithmetic/quantitative word problems where a small model's mental
      // math is unreliable — translate the problem to a program, RUN it, and trust the
      // executed result instead of voting over guesses. Deterministic, not popular.
      // NOT gated on no-tools: a compute question is best answered by computing it even
      // when other tools are on offer (PoT returns null and falls through if it can't,
      // e.g. the answer needs live data a program can't reach). Disable: NOETICA_EXEC_VERIFY=0.
      if (process.env['NOETICA_EXEC_VERIFY'] !== '0' && routerDecision.task !== 'chat'
          && classifyComplexityPosture(latestUserContent).posture === 'compute') {
        try {
          const pot = await programOfThought(latestUserContent, {
            generate: (p, t) => generateOllamaText({ model, messages: [{ role: 'user', content: p }], temperature: t, numCtx: ollamaNumCtx }).then((r) => r.content),
            execute: (lang, code) => executeCode(lang, code),
          })
          if (pot) {
            const answer = `${pot.answer}\n\n_Verified by execution:_\n\`\`\`python\n${pot.code}\n\`\`\``
            sse(res, 'deliberation', { deliberation: { critic: { action: 'accept', score: 1, agreement: 1, posture: 'compute', reason: 'verified by execution (program-of-thought)' } } })
            sse(res, 'delta', { delta: answer })
            fullContent += answer
            deliberated = true
            console.log(`[critic] program-of-thought verified answer=${pot.answer}`)
          }
        } catch { /* exec-verify best-effort — fall through to best-of-N */ }
      }

      // Code-posture verify-repair: for self-contained "write code" tasks, generate a
      // solution + tests, RUN them, and repair on failure — keep what passes. The
      // out-loop coding lever (a small model + a real test loop). Abstains for unrunnable
      // languages / repo-scale edits, which fall through to the normal path.
      // Disable with NOETICA_CODE_VERIFY=0.
      if (!deliberated && process.env['NOETICA_CODE_VERIFY'] !== '0'
          && routerDecision.task !== 'chat' && classifyComplexityPosture(latestUserContent).posture === 'code') {
        try {
          const cv = await codeVerifyRepair(latestUserContent, {
            generate: (p, t) => generateOllamaText({ model, messages: [{ role: 'user', content: p }], temperature: t, numCtx: ollamaNumCtx }).then((r) => r.content),
            execute: (lang, code) => executeCode(lang, code),
          })
          if (cv) {
            const head = cv.passed
              ? `✓ Verified — generated tests pass (${cv.attempts} attempt${cv.attempts > 1 ? 's' : ''}).`
              : `⚠️ Tests didn't all pass after repair — best attempt below; review before use.`
            const answer = `${head}\n\n\`\`\`${cv.language}\n${cv.solution}\n\`\`\``
            sse(res, 'deliberation', { deliberation: { critic: { action: cv.passed ? 'accept' : 'clarify', score: cv.passed ? 1 : 0.4, agreement: 1, posture: 'code', reason: cv.passed ? 'verified by tests (generate→run→repair)' : 'tests did not all pass' } } })
            sse(res, 'delta', { delta: answer })
            fullContent += answer
            deliberated = true
            console.log(`[critic] code-verify passed=${cv.passed} attempts=${cv.attempts} lang=${cv.language}`)
          }
        } catch { /* code-verify best-effort — fall through */ }
      }

      if (!deliberated && criticEnabled) {
        try {
          const wm = loadWorldModelForVJ()
          const candidates: CriticCandidate[] = []
          // Ollama serves one generation at a time per model — sample sequentially.
          for (const t of bestOfTemps(bestOfN)) {
            try {
              const r = await generateOllamaText({ model, messages: ollamaMessages, temperature: t, numCtx: ollamaNumCtx })
              if (r.content.trim()) candidates.push({ content: r.content, reasoning: r.reasoning, temperature: t, label: model })
            } catch { /* skip a failed candidate */ }
          }
          if (candidates.length > 0) {
            const cctx = { question: latestUserContent, contextText: graphContext, beliefs: wm.beliefs, laws: wm.laws }
            let verdict = critique(candidates, cctx)
            // Sovereign escalation: only when there's real grounding material to judge
            // against (otherwise the worth metric is uninformative and a bigger model
            // won't help) AND a stronger local model is installed.
            const haveGrounding = graphContext.trim().length > 200
            if (verdict.action === 'escalate' && haveGrounding) {
              const stronger = ['qwen2.5:32b', 'qwen2.5:14b'].find((m) => availableModels.includes(m) && m !== model)
              if (stronger) {
                try {
                  const r = await generateOllamaText({ model: stronger, messages: ollamaMessages, temperature: 0.4, numCtx: ollamaNumCtx })
                  if (r.content.trim()) candidates.push({ content: r.content, reasoning: r.reasoning, temperature: 0.4, label: `esc:${stronger}` })
                  verdict = critique(candidates, cctx)
                } catch { /* escalation best-effort */ }
              }
            }
            const best = verdict.best
            sse(res, 'deliberation', {
              deliberation: {
                candidates: verdict.ranked.map((j, i) => ({
                  rank: i, worth: j.score, grounding: j.vj.grounding, verdict: j.vj.verdict,
                  temperature: j.candidate.temperature, label: j.candidate.label,
                  preview: j.candidate.content.slice(0, 100),
                })),
                selected_rank: Math.max(0, verdict.ranked.indexOf(best)),
                critic: { action: verdict.action, score: best.score, agreement: verdict.agreement, posture: verdict.posture, reason: verdict.reason },
              },
            })
            if (best.candidate.reasoning) { sse(res, 'thinking_delta', { delta: best.candidate.reasoning }); fullThinking += best.candidate.reasoning }
            sse(res, 'delta', { delta: best.candidate.content })
            fullContent += best.candidate.content
            deliberated = true
            console.log(`[critic] N=${candidates.length} action=${verdict.action} worth=${best.score} agreement=${verdict.agreement} posture=${verdict.posture} model=${best.candidate.label}`)
          }
        } catch { /* critic is best-effort — fall through to normal streaming */ }
      }

      // Concierge dispatch: for heavy work, acknowledge conversationally *now*
      // ("let me research this for you…"), surface queue position, then acquire a
      // capacity-gate lease so the worker stream runs serialized (one heavy job at
      // a time on small boxes) — keeping the front-of-house responsive while never
      // overcommitting the GPU-shared memory. The lease is released in finally.
      let releaseLease: (() => void) | null = null
      if (!deliberated && turnPlan?.mode === 'dispatch') {
        // Surface the acknowledgement as an ephemeral status, NOT as answer content.
        // It used to be appended to fullContent, which polluted the saved answer (the
        // "Let me research this…" preamble) and broke citation flow. The live plan/step
        // timeline now carries the "acknowledged, working" signal, so the ack rides
        // alongside the dispatch event instead of inside the model's reply.
        if (turnPlan.ack) sse(res, 'ack', { ack: turnPlan.ack })
        if (dispatchGateRef) {
          sse(res, 'dispatch', { dispatch: { capability: turnPlan.capability, reason: turnPlan.reason, queue_position: dispatchGateRef.nextQueuePosition, ...dispatchGateRef.status } })
          try { releaseLease = await dispatchGateRef.acquireLease() } catch { /* gate is best-effort */ }
        }
      }

      const ollamaToolNames = new Set(allTools.map((t) => t.name))
      // Matches the moment the stream enters a tool call (so we stop showing raw
      // JSON): a <tool_call> tag, a code fence, or the turn opening with a bare `{`.
      const TOOL_CALL_ONSET = /<tool_call|```|^\s*\{/i

      try {
      const ollamaToolSeen = new Map<string, number>()
      let divergenceNudges = 0
      if (!deliberated) for (let turn = 0; turn < MAX_TURNS; turn++) {
        let turnContent = ''
        let streamedLen = 0          // chars already streamed to the UI this turn
        let suppressed = false       // stopped streaming — text looks like a tool call
        let turnToolCalls: ToolUseBlock[] | undefined

        for await (const event of streamOllama({
          model,
          messages: ollamaMessages,
          tools: allTools,
          numCtx: ollamaNumCtx,
          temperature: reqTemperature,
          maxTokens: reqMaxTokens,
        })) {
          if (event.type === 'text') {
            turnContent += event.text
            if (!suppressed) {
              if (TOOL_CALL_ONSET.test(turnContent.slice(streamedLen ? streamedLen - 16 : 0))) {
                suppressed = true   // hold the rest back; fallback parser handles it
              } else {
                liveContent += event.text
                sse(res, 'delta', { delta: event.text })
                streamedLen = turnContent.length
              }
            }
          } else if (event.type === 'thinking') {
            fullThinking += event.text
            sse(res, 'thinking_delta', { delta: event.text })
          } else if (event.type === 'tool_calls') {
            turnToolCalls = event.calls
          }
        }

        // Fallback: the model emitted the tool call as text, not via the API.
        let assistantText = turnContent
        if (!turnToolCalls?.length) {
          const parsed = parseInlineToolCalls(turnContent, ollamaToolNames)
          if (parsed.calls.length) {
            turnToolCalls = parsed.calls
            assistantText = parsed.cleaned
          } else if (suppressed) {
            // It wasn't a tool call after all — flush the held-back remainder.
            const rest = turnContent.slice(streamedLen)
            if (rest) { liveContent += rest; sse(res, 'delta', { delta: rest }) }
          }
        }

        fullContent += assistantText

        if (!turnToolCalls?.length) break

        // Divergence RECOVERY (Claude-Code behavior): if every tool call this turn
        // repeats one already made twice, the model is stuck. Don't just stop — feed
        // the repetition back as a corrective and let it try a DIFFERENT approach.
        // Only give up after a couple of nudges fail to break the loop.
        const sig = (tc: { name: string; input: unknown }) => `${tc.name}:${JSON.stringify(tc.input)}`
        const allRepeated = turnToolCalls.every((tc) => (ollamaToolSeen.get(sig(tc)) ?? 0) >= 2)
        for (const tc of turnToolCalls) ollamaToolSeen.set(sig(tc), (ollamaToolSeen.get(sig(tc)) ?? 0) + 1)
        if (allRepeated) {
          divergenceNudges++
          if (divergenceNudges >= 3) {
            const note = '\n\n_(Stopped — repeated the same tool call without making progress.)_'
            fullContent += note; liveContent += note; sse(res, 'delta', { delta: note })
            break
          }
          // Recover: acknowledge the repeated calls, answer each with a corrective nudge
          // instead of re-executing, and continue the loop so the model can change tack.
          ollamaMessages.push({
            role: 'assistant', content: assistantText || null,
            tool_calls: turnToolCalls.map((tc) => ({ id: tc.id, type: 'function' as const, function: { name: tc.name, arguments: JSON.stringify(tc.input) } })),
          })
          for (const tc of turnToolCalls) {
            ollamaMessages.push({ role: 'tool', tool_call_id: tc.id, content: `You already ran ${tc.name} with those exact arguments and it did not move the task forward. Do NOT repeat it — try a different tool, different arguments, or give your final answer now.` })
          }
          continue
        }

        sse(res, 'tool_calls', { tool_calls: turnToolCalls })
        lastToolCalls = turnToolCalls

        const toolResults = await Promise.all(
          turnToolCalls.map(async (tc) => ({
            toolCallId: tc.id,
            name: tc.name,
            result: await executeToolWithTimeout(tc.name, tc.input, {
              anthropic: anthropicKey,
              openai: openaiKey,
              serper: keys.serper,
            }),
          })),
        )

        ollamaMessages.push({
          role: 'assistant',
          content: assistantText || null,
          tool_calls: turnToolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.input) },
          })),
        })
        for (const r of toolResults) {
          ollamaMessages.push({
            role: 'tool',
            content: r.result,
            tool_call_id: r.toolCallId,
          })
        }
      }
      } finally { releaseLease?.() }
    } else if (provider === 'anthropic') {
      // Build Anthropic message array — with vision and attachment support
      const anthropicMessages: AnthropicMessage[] = incomingMessages.map((m) => {
        if (m.role !== 'user' || !m.attachments?.length) {
          return { role: m.role as 'user' | 'assistant', content: m.content }
        }
        // Build multi-part content block for user messages with attachments
        const blocks: AnthropicContentBlock[] = []
        // Non-image attachments → text blocks
        for (const att of m.attachments.filter((a) => a.kind !== 'image')) {
          try {
            const decoded = Buffer.from(att.base64, 'base64').toString('utf-8')
            blocks.push({ type: 'text', text: `**${att.name}**\n\`\`\`\n${decoded}\n\`\`\`` })
          } catch { /* skip undecodable attachments */ }
        }
        // Leading text block for message content
        if (m.content.trim()) blocks.unshift({ type: 'text', text: m.content })
        // Image attachments → Anthropic base64 image blocks
        for (const att of m.attachments.filter((a) => a.kind === 'image')) {
          const mediaType = (att.mimeType || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
          blocks.push({
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: att.base64 },
          } as unknown as AnthropicContentBlock)
        }
        return { role: 'user', content: blocks.length === 1 && blocks[0]?.type === 'text' ? (blocks[0] as { type: 'text'; text: string }).text : (blocks as unknown as string) }
      })

      for (let turn = 0; turn < MAX_TURNS; turn++) {
        let turnContent = ''
        let turnToolCalls: ToolUseBlock[] | undefined

        for await (const event of streamAnthropic({
          model,
          messages: anthropicMessages,
          system: enrichedSystemPrompt,
          tools: allTools,
          apiKey,
          thinkingBudget: body.thinking_budget,
          temperature: reqTemperature,
          maxTokens: reqMaxTokens,
        })) {
          if (event.type === 'text') {
            turnContent += event.text
            liveContent += event.text
            sse(res, 'delta', { delta: event.text })
          } else if (event.type === 'thinking') {
            fullThinking += event.text
            sse(res, 'thinking_delta', { delta: event.text })
          } else if (event.type === 'tool_calls') {
            turnToolCalls = event.calls
          }
        }

        fullContent += turnContent

        if (!turnToolCalls?.length) break

        // Emit tool_calls for UI visualization in the client
        sse(res, 'tool_calls', { tool_calls: turnToolCalls })
        lastToolCalls = turnToolCalls

        // Execute tools in parallel
        const toolResults = await Promise.all(
          turnToolCalls.map(async (tc) => ({
            toolUseId: tc.id,
            name: tc.name,
            result: await executeToolWithTimeout(tc.name, tc.input, {
              anthropic: anthropicKey,
              openai: openaiKey,
              serper: keys.serper,
            }),
          })),
        )

        // Append assistant turn (with tool_use blocks) + user turn (with tool_result blocks)
        const assistantBlocks: AnthropicContentBlock[] = [
          ...(turnContent.trim() ? [{ type: 'text' as const, text: turnContent }] : []),
          ...turnToolCalls.map((tc) => ({
            type: 'tool_use' as const,
            id: tc.id,
            name: tc.name,
            input: tc.input,
          })),
        ]
        const resultBlocks: AnthropicContentBlock[] = toolResults.map((r) => ({
          type: 'tool_result' as const,
          tool_use_id: r.toolUseId,
          content: r.result,
        }))

        anthropicMessages.push({ role: 'assistant', content: assistantBlocks })
        anthropicMessages.push({ role: 'user', content: resultBlocks })
      }
    } else {
      // OpenAI path
      const oaiMessages: OpenAIMessage[] = []
      if (enrichedSystemPrompt) {
        oaiMessages.push({ role: 'system', content: enrichedSystemPrompt })
      }
      for (const m of incomingMessages) {
        if (m.role === 'user') {
          const images = m.attachments?.filter((a) => a.kind === 'image') ?? []
          const textParts = (m.attachments?.filter((a) => a.kind !== 'image') ?? [])
            .map((a) => {
              try { return `**${a.name}**\n\`\`\`\n${Buffer.from(a.base64, 'base64').toString('utf-8')}\n\`\`\`` }
              catch { return '' }
            })
            .filter(Boolean)
          const textContent = [m.content, ...textParts].filter(Boolean).join('\n\n')
          if (images.length > 0) {
            // OpenAI vision: multi-part content array
            const contentParts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
              { type: 'text', text: textContent || 'Describe the image(s).' },
              ...images.map((a) => ({
                type: 'image_url' as const,
                image_url: { url: `data:${a.mimeType || 'image/jpeg'};base64,${a.base64}` },
              })),
            ]
            oaiMessages.push({ role: 'user', content: contentParts as unknown as string })
          } else {
            oaiMessages.push({ role: 'user', content: textContent })
          }
        } else if (m.role === 'assistant') {
          oaiMessages.push({ role: 'assistant', content: m.content })
        }
      }

      for (let turn = 0; turn < MAX_TURNS; turn++) {
        let turnContent = ''
        let turnToolCalls: ToolUseBlock[] | undefined

        for await (const event of streamOpenAI({
          model,
          messages: oaiMessages,
          tools: allTools,
          apiKey,
          temperature: reqTemperature,
          maxTokens: reqMaxTokens,
        })) {
          if (event.type === 'text') {
            turnContent += event.text
            liveContent += event.text
            sse(res, 'delta', { delta: event.text })
          } else if (event.type === 'tool_calls') {
            turnToolCalls = event.calls
          }
        }

        fullContent += turnContent

        if (!turnToolCalls?.length) break

        sse(res, 'tool_calls', { tool_calls: turnToolCalls })
        lastToolCalls = turnToolCalls

        const toolResults = await Promise.all(
          turnToolCalls.map(async (tc) => ({
            toolCallId: tc.id,
            name: tc.name,
            result: await executeToolWithTimeout(tc.name, tc.input, {
              anthropic: anthropicKey,
              openai: openaiKey,
              serper: keys.serper,
            }),
          })),
        )

        // Append OpenAI-format tool messages
        oaiMessages.push({
          role: 'assistant',
          content: turnContent || null,
          tool_calls: turnToolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.input) },
          })),
        })
        for (const r of toolResults) {
          oaiMessages.push({
            role: 'tool',
            content: r.result,
            tool_call_id: r.toolCallId,
          })
        }
      }
    }

    const latencyMs = Date.now() - started
    // Captured for the dialogue-tracker / symbolic-policy loop (set when VJ runs).
    let turnWorth: number | undefined
    let turnReward: number | undefined
    const turnGrounded = docHitCount > 0 || glossaryTerms.length > 0 || graphContext.length > 0

    // Token/cost accounting. The agent-machine doesn't get exact provider usage
    // counts, so estimate: input ≈ trimmed system+history budget already computed,
    // output ≈ generated content. Cost/egress are 0 for local providers.
    const inputTokens = systemTokens + msgTokens
    const outputTokens = estimateTokens(fullContent)
    const costUsd = estimateCostUsd({ provider, model, inputTokens, outputTokens })
    const egressed = tokensEgressed({ provider, inputTokens, outputTokens })

    // ── Value Judgment (4D/RCS VJ) ────────────────────────────────────────────
    // Score the produced answer against the world model (retrieved memory +
    // GAIA beliefs + candidate laws). Explicit, inspectable value layer over the
    // neural output — and the close of the neural→symbolic loop, since it also
    // judges the model's captured reasoning.
    let valueJudgment: ValueJudgment | undefined
    try {
      const wm = loadWorldModelForVJ()
      // PLN-backed grounding: check the answer's claim entities against the whole
      // knowledge graph (incl. transitive PLN-derived relations), not just the
      // retrieved snippet. NOETICA_PLN_GROUNDING=1 also runs a bounded forward-chain.
      let gg: { graphGrounding: number; novel: string[] } | undefined
      try { gg = assessAgainstGraph(fullContent, { runPln: isFlagOn('NOETICA_PLN_GROUNDING') }) } catch { /* best-effort */ }
      valueJudgment = judgeAnswer({
        answer: fullContent,
        reasoning: fullThinking || undefined,
        contextText: graphContext,
        beliefs: wm.beliefs,
        laws: wm.laws,
        graphGrounding: gg?.graphGrounding,
        novelClaims: gg?.novel,
      })
      sse(res, 'value_judgment', { value_judgment: valueJudgment })
      // Feed a LATENCY-AWARE, multi-objective reward back into the bandit — quality
      // (VJ worth) docked for slowness, bonused for grounding + slot-fill. This is
      // what makes the bandit LEARN to avoid the slow reasoner instead of exploring
      // into a multi-minute stall. The same reward is logged for the symbolic policy.
      const { computeReward } = await import('./lib/symbolic-policy.js')
      turnWorth = valueJudgment.worth
      turnReward = computeReward({ worth: valueJudgment.worth, latencyMs, grounded: turnGrounded, fillRate: policy.fillRate })
      recordReward({ task: routerDecision.task, provider, model, reward: turnReward })
      // Record a quality sample for symbolic-regression driver analysis.
      recordQualitySample({
        worth: valueJudgment.worth,
        grounding: valueJudgment.grounding,
        graph_grounding: valueJudgment.graph_grounding ?? 0,
        belief_alignment: valueJudgment.belief_alignment,
        latency_ms: latencyMs,
        input_tokens: inputTokens,
        provider, model, task: routerDecision.task ?? 'general',
        ts: new Date().toISOString(),
      })
      if (valueJudgment.contradictions.length > 0) {
        recordContradictions(run_id, sessionId, valueJudgment, fullContent)
      }
    } catch { /* VJ is best-effort — never block the response */ }

    recordGovernanceRun({
      run_id,
      model_routed: model,
      provider,
      policy_admitted: true,
      memory_written: false,
      timestamp,
      latency_ms: latencyMs,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: costUsd,
      tokens_egressed: egressed,
      task: routerDecision.task,
      session_id: sessionId,
    })

    // Moat 3: close the episodic KG entry with the answer (episodic memory of
    // what was asked + how the agent responded — feeds the compounding loop).
    if (moatEpisodeId) {
      try {
        const { recordEpisodeOutcome } = await import('./lib/question-context.js')
        recordEpisodeOutcome(moatEpisodeId, { answer: fullContent.slice(0, 400), correct: valueJudgment?.verdict !== 'contradiction', lane: `${provider}:${model}` })
      } catch { /* episodic write-back is best-effort */ }
    }

    step('generate', 'done', `${fullContent.length >> 2} tokens`)

    // Conversation analytics: record the turn into the dialogue tracker (typed
    // TurnRecord → flow metrics). Best-effort; never blocks the response.
    try {
      const { recordTurn } = await import('./lib/dialogue-tracker.js')
      recordTurn({
        session_id: sessionId,
        intent: intentPlan.name,
        intent_score: intentPlan.score,
        fallback: intentPlan.score < 1.2 || intentPlan.name === 'general',
        slots_expected: intentPlan.slots,
        slots_filled: policy.filled,
        fill_rate: policy.fillRate,
        clarified: false,
        entities: glossaryTerms,
        surface: intentPlan.surface,
        skill: intentPlan.skill,
        tools: intentPlan.tools,
        capability: intentPlan.model,
        model,
        retrieval: intentPlan.retrieval,
        grounded: turnGrounded,
        latency_ms: latencyMs,
        worth: turnWorth,
        reward: turnReward,
        escalated,
      })
      // §10.3 Evidence: append this dispatch to the hash-chained ledger so it replays.
      try {
        const { recordDispatch, contentHash } = await import('./lib/dispatch-ledger.js')
        const dispatchEntry = recordDispatch({
          session: sessionId, requestHash: contentHash(latestUserContent),
          action, polarity, tier: actionRoute.tier, target: actionRoute.target, phase,
          barCleared: true, residual: [], // proceeded past the policy gate
          model, answerHash: contentHash(fullContent), latencyMs, grounded: turnGrounded, verdict: 'POS',
        })
        // Crystallize a high-worth answer into a durable, attested artifact (loop closes).
        if (typeof turnWorth === 'number') {
          const { crystallizeAnswer } = await import('./lib/crystallize.js')
          crystallizeAnswer({ question: latestUserContent, answer: fullContent, session: sessionId, action, attestation: dispatchEntry.attestation, worth: turnWorth })
        }
      } catch { /* ledger/crystallize is best-effort */ }
      // Harvest high-reward turns as gold Q/A training pairs (the flywheel). Gated on
      // reward inside recordQAPair, so only genuinely good answers become training data.
      if (typeof turnReward === 'number' && typeof turnWorth === 'number') {
        const { recordQAPair } = await import('./lib/qa-pairs.js')
        recordQAPair({
          question: latestUserContent, answer: fullContent, intent: intentPlan.name,
          worth: turnWorth, reward: turnReward, grounded: turnGrounded, model,
        })
      }
      // Write the salient turn to the context fabric (the concierge observing into the
      // shared brief). Intent maps to a FabricEntry kind; reinforcement raises STI so
      // recurring threads rise in the brief. Skipped for pure chitchat/steering.
      if (isFlagOn('NOETICA_FABRIC') && !['converse_smalltalk', 'confirm_steer'].includes(intentPlan.name)) {
        const { writeFabricEntry } = await import('./lib/fabric.js')
        const FABRIC_KIND: Record<string, 'goal' | 'thread' | 'decision' | 'assumption' | 'question'> = {
          plan_nextsteps: 'goal', build_implement: 'goal', review_audit: 'decision',
          compare_benchmark: 'decision', preferences_memory: 'assumption',
        }
        writeFabricEntry({
          kind: FABRIC_KIND[intentPlan.name] ?? 'thread',
          text: latestUserContent, provenance: 'concierge',
          session: sessionId, confidence: typeof turnWorth === 'number' ? turnWorth : 0.7,
        })
      }
    } catch { /* tracker is best-effort */ }

    sse(res, 'done', {
      result: {
        run_id,
        content: fullContent,
        model_routed: model,
        provider,
        policy_admitted: true,
        memory_written: false,
        tool_calls: lastToolCalls,
        stop_reason: 'end_turn',
        timestamp,
        latency_ms: latencyMs,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: costUsd,
        tokens_egressed: egressed,
        value_judgment: valueJudgment,
        agent_machine: true,
        agent_machine_version: VERSION,
      },
    })
    runCompleted = true // run finished cleanly — the close handler must not checkpoint

    // ── Auto-ingest into HellGraph (fire-and-forget) ──────────────────────────
    // Index this interaction so future retrieval can surface it. The promptHash
    // is used for deduplication in the WAL. invalidatePrefix forces a fresh
    // cache-augmented prefix on the next turn (new graph state).
    // Don't pollute the knowledge graph with the agent's OWN tool exhaust — directory listings,
    // file dumps, command output. Those are operational, not knowledge; ingesting them mints junk
    // atoms (your home-dir folder names, probe artifacts) that clog the graph. Detect by the
    // file/command intent or the listing shape and skip ingestion for the turn.
    const operationalTurn =
      /^\s*(show (me )?(my )?files|list( my| the)? (files|dir|directory)|^ls\b|what'?s? (in|inside) (my|the|this)|look (in|at) [~/.]|open (the )?(folder|directory)|^cd\b|run [`'"]?(ls|find|cat|tree))/i.test(latestUserContent.trim())
      || /(\b[dfl] [.\w-]+\/ .+\b[dfl] )|(\bf [.\w-]+ \(\d+\s*B?\))|(your (home|home directory)|here (are|is) (the|your) (files|directory|folder))/i.test(fullContent.slice(0, 800))
    if (!operationalTurn) void (async () => {
      try {
        const promptHash = crypto.createHash('sha256').update(latestUserContent).digest('hex').slice(0, 16)
        await trackIngest(ingestInteraction({
          runId: run_id,
          sessionId,
          modelRouted: model,
          provider,
          promptSummary: latestUserContent.slice(0, 280),
          responseSummary: fullContent.slice(0, 280),
          evidenceHash: promptHash,
          policyAdmitted: true,
          latencyMs,
          timestamp,
        }))
        invalidatePrefix(sessionId)
      } catch { /* ingest failures must never surface to the user */ }
      // Extract and ingest Regis-compatible entities from the conversation
      try {
        const { ingestEntities } = await import('./lib/graph.js')
        const fullText = `${latestUserContent}\n${fullContent}`
        await trackIngest(ingestEntities(run_id, sessionId, fullText, new Date().toISOString()))
        // Ontogenesis: validate the freshly-written entities (report-only, flagged).
        runShaclGate()
      } catch { /* entity extraction is best-effort */ }
    })()
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    // Record failed run so GovernSurface shows error-rate alongside success-rate
    recordGovernanceRun({
      run_id,
      model_routed: model,
      provider,
      policy_admitted: false,
      memory_written: false,
      timestamp,
      latency_ms: Date.now() - started,
      task: routerDecision.task,
      session_id: sessionId,
      error: errMsg,
    })
    sse(res, 'error', { error: errMsg })
  }
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

const MAX_REQUEST_BYTES = 32 * 1024 * 1024 // 32 MB — generous for base64 image/doc attachments, blocks OOM

const server = http.createServer((req, res) => {
  setCORSHeaders(res)

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  // Global request body-size guard. Every POST handler accumulates the body in memory;
  // without this a single oversized upload could OOM the process. Reject early via
  // Content-Length when advertised, and hard-stop the socket if the stream overruns.
  if (req.method === 'POST') {
    const declared = Number(req.headers['content-length'])
    if (!isNaN(declared) && declared > MAX_REQUEST_BYTES) {
      res.writeHead(413, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'request body too large (max 32MB)' }))
      return
    }
    let seen = 0
    req.on('data', (chunk: Buffer) => {
      seen += chunk.length
      if (seen > MAX_REQUEST_BYTES) {
        res.writeHead(413, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'request body too large (max 32MB)' }))
        req.destroy()
      }
    })
  }

  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)

  // GET /api/security/state — bearbrowser polls this to auto-enable Tor when armed.
  if (req.method === 'GET' && url.pathname === '/api/security/state') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify(readSecurityState()))
    return
  }

  // GET /api/status
  if (req.method === 'GET' && url.pathname === '/api/status') {
    void (async () => {
      const ollamaUp = await isOllamaRunning()
      const localModels = ollamaUp ? await listLocalModels() : []
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          version: VERSION,
          description: 'Noetica Agent Machine — local-first agentic runtime',
          localFirst: true,
          ollama: { running: ollamaUp, models: localModels },
          modelSuite: LOCAL_MODEL_SUITE,
          tools: BUILTIN_TOOLS.map((t) => t.name),
          mode: 'agent-machine',
          capabilities: ['streaming', 'tool_use', 'vision', 'code_execute', 'web_search', 'generate_image'],
        }),
      )
    })()
    return
  }

  // POST /api/models/pull — pull a model from Ollama registry with SSE progress
  if (req.method === 'POST' && url.pathname === '/api/models/pull') {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => {
      void (async () => {
        let model: string
        try {
          const parsed = JSON.parse(body) as { model?: unknown }
          model = String(parsed.model ?? '')
        } catch {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'invalid_json' }))
          return
        }
        if (!model || !LOCAL_MODEL_SUITE.some((m) => m.name === model)) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: `model not in LOCAL_MODEL_SUITE: ${model}` }))
          return
        }
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
        })
        try {
          await pullModel(model, (status, pct) => {
            sse(res, 'progress', { model, status, pct, done: false })
          })
          sse(res, 'progress', { model, status: 'complete', pct: 100, done: true })
        } catch (e) {
          sse(res, 'progress', { model, status: 'error', pct: null, done: true, error: 'internal_error' })
        } finally {
          try { res.end() } catch { /* ignore */ }
        }
      })()
    })
    return
  }

  // GET /api/memory/health — memoryd + prometheusd + HellGraph memory layer status
  if (req.method === 'GET' && url.pathname === '/api/memory/health') {
    void (async () => {
      setCORSHeaders(res)
      const memorydUrl = process.env['MEMORYD_URL'] ?? 'http://127.0.0.1:8787'
      const prometheusdUrl = process.env['PROMETHEUSD_URL'] ?? 'http://127.0.0.1:8890'
      const [memorydHealth, prometheusdHealth] = await Promise.all([
        fetch(`${memorydUrl}/healthz`, { signal: AbortSignal.timeout(1500) })
          .then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${prometheusdUrl}/healthz`, { signal: AbortSignal.timeout(1500) })
          .then(r => r.ok ? r.json() : null).catch(() => null),
      ])
      const g = getGraph()
      const atoms = g.allNodes().filter(n => n.labels.includes('FeatureAtom')).length
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        memoryd: { available: memorydHealth !== null, url: memorydUrl, ...(memorydHealth ?? {}) },
        prometheusd: { available: prometheusdHealth !== null, url: prometheusdUrl, ...(prometheusdHealth ?? {}) },
        hellgraph: { feature_atoms: atoms, total_nodes: g.allNodes().length, total_edges: g.allEdges().length },
        tiers: { tier1_memoryd: memorydHealth !== null, tier2_hellgraph: true, tier3_map: true },
      }))
    })()
    return
  }

  // ── Memory curation: surface memories in the graph + pin into the long-term brain ──
  // A memory-curation store over HellGraph. setLti boosts the atom's ECAN long-term
  // importance (best-effort — the durable signal is the node's pinned/lti property, which
  // persists via the live node reference; the attention-value boost is a bonus when the
  // handle resolves).
  const memoryStore = () => {
    const g = getHellGraph()
    return {
      nodesByLabel: (l: string) => g.nodesByLabel(l) as Array<{ id: string; labels: string[]; properties: Record<string, unknown> }>,
      getNode: (id: string) => g.getNode(id) as { id: string; labels: string[]; properties: Record<string, unknown> } | null,
      out: (id: string, e?: string) => g.out(id, e) as Array<{ id: string; labels: string[]; properties: Record<string, unknown> }>,
      setProperty: (id: string, key: string, value: unknown) => { try { (g as any).setNodeProperty(id, key, value) } catch { /* */ } },
      setLti: (id: string, lti: number) => { try { const sp: any = getAtomSpace(); sp.setAttentionValue?.(id, { sti: 0, lti, vlti: 0 }) } catch { /* attention boost best-effort */ } },
    }
  }

  // GET /api/memory/graph — memories as curatable records (for the Memory lens).
  if (req.method === 'GET' && url.pathname === '/api/memory/graph') {
    void (async () => {
      setCORSHeaders(res)
      try {
        const { listMemories } = await import('./lib/memory-curation.js')
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ memories: listMemories(memoryStore()) }))
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'internal_error', memories: [] }))
      }
    })()
    return
  }

  // POST /api/memory/pin — curate a memory into / out of the long-term brain. Body: {id, pinned?}.
  if (req.method === 'POST' && url.pathname === '/api/memory/pin') {
    let body = ''
    req.on('data', (c: Buffer) => { body += c.toString() })
    req.on('end', () => { void (async () => {
      setCORSHeaders(res)
      let p: { id?: string; pinned?: boolean } = {}
      try { p = JSON.parse(body) } catch { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid_json' })); return }
      if (!p.id) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'id required' })); return }
      try {
        const { pinMemory, unpinMemory } = await import('./lib/memory-curation.js')
        const ok = (p.pinned === false ? unpinMemory : pinMemory)(memoryStore(), p.id)
        res.writeHead(ok ? 200 : 404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok, id: p.id, pinned: p.pinned !== false }))
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'internal_error' }))
      }
    })() })
    return
  }

  // POST /api/memory/forget — soft-delete a memory (excluded from recall + LTI dropped). Body: {id}.
  if (req.method === 'POST' && url.pathname === '/api/memory/forget') {
    let body = ''
    req.on('data', (c: Buffer) => { body += c.toString() })
    req.on('end', () => { void (async () => {
      setCORSHeaders(res)
      let p: { id?: string } = {}
      try { p = JSON.parse(body) } catch { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid_json' })); return }
      if (!p.id) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'id required' })); return }
      try {
        const { forgetMemory } = await import('./lib/memory-curation.js')
        const ok = forgetMemory(memoryStore(), p.id)
        res.writeHead(ok ? 200 : 404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok, id: p.id }))
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'internal_error' }))
      }
    })() })
    return
  }

  // ── Session persistence via the always-on AM: chats survive quit independent of the
  // WebKit localStorage flush + the (uninstalled) Tauri store plugin. Durable file at
  // ~/.noetica/sessions.json. ──
  if (req.method === 'GET' && url.pathname === '/api/sessions') {
    void (async () => {
      setCORSHeaders(res)
      try {
        const { readFileSync } = await import('fs'); const { homedir } = await import('os'); const { join } = await import('path')
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(readFileSync(join(homedir(), '.noetica', 'sessions.json'), 'utf8'))
      } catch { res.writeHead(200, { 'content-type': 'application/json' }); res.end('null') }
    })()
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/sessions') {
    let body = ''
    req.on('data', (c: Buffer) => { body += c.toString() })
    req.on('end', () => { void (async () => {
      setCORSHeaders(res)
      try {
        const { writeFileSync, mkdirSync } = await import('fs'); const { homedir } = await import('os'); const { join } = await import('path')
        const dir = join(homedir(), '.noetica'); mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'sessions.json'), body || 'null')
        res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}')
      } catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'internal_error' })) }
    })() })
    return
  }

  // GET /api/graph/cskg — export the graph's edges in the CSKG / KGTK edge format (every edge
  // dimensioned + lifted-labelled + sourced). ?format=tsv|json (default tsv), ?limit=N.
  if (req.method === 'GET' && url.pathname === '/api/graph/cskg') {
    void (async () => {
      setCORSHeaders(res)
      const format = url.searchParams.get('format') === 'json' ? 'json' : 'tsv'
      const limit = Math.min(50000, Math.max(1, Number(url.searchParams.get('limit')) || 10000))
      try {
        const { toCskgEdge, toKgtkTsv } = await import('./lib/cskg.js')
        const g = getHellGraph()
        const edges = (g.allEdges() as Array<{ id?: string; label: string; from: string; to: string; properties?: Record<string, unknown> }>).slice(0, limit)
        const nameOf = (id: string) => { const n = g.getNode(id); return (n?.properties?.['name'] ?? n?.properties?.['title'] ?? n?.properties?.['surface']) as string | undefined }
        const cskg = edges.map((e) => toCskgEdge(e, { node1: nameOf(e.from), node2: nameOf(e.to) }))
        if (format === 'json') {
          res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ count: cskg.length, edges: cskg }))
        } else {
          res.writeHead(200, { 'content-type': 'text/tab-separated-values', 'content-disposition': 'attachment; filename="noetica-cskg.tsv"' })
          res.end(toKgtkTsv(cskg))
        }
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'internal_error' }))
      }
    })()
    return
  }

  // GET /api/graph/search — fast topic/instance recall over the graph, fusing cosine +
  // Jaccard + link expansion (a company on "Hospital Way" surfaces for "hospital"). Query:
  // ?q=…&limit=…  Cosine kicks in when the query embeds and atoms carry vectors.
  if (req.method === 'GET' && url.pathname === '/api/graph/search') {
    void (async () => {
      setCORSHeaders(res)
      const q = (url.searchParams.get('q') ?? '').trim()
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 12))
      if (!q) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ query: q, hits: [] })); return }
      try {
        const { graphSearch } = await import('./lib/graph-search.js')
        const g = getHellGraph()
        const store = {
          nodesByLabel: (l: string) => g.nodesByLabel(l) as any[],
          out: (id: string, e?: string) => g.out(id, e) as any[],
          in: (id: string, e?: string) => g.in(id, e) as any[],
        }
        // Best-effort query embedding for the cosine signal (lexical + link work without it).
        let queryVector: number[] | undefined
        try {
          const { embedBatchLocal } = await import('./lib/embed-runtime.js')
          const v = await embedBatchLocal([q]); const vec = v?.[0]; if (vec) queryVector = vec
        } catch { /* cosine optional */ }
        const vectorOf = (n: { properties: Record<string, unknown> }) => {
          const raw = n.properties['embedding']; if (!raw) return null
          try { return typeof raw === 'string' ? JSON.parse(raw) as number[] : (raw as number[]) } catch { return null }
        }
        const hits = graphSearch(store, q, { limit, ...(queryVector ? { queryVector, vectorOf } : {}) })
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ query: q, hits }))
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'internal_error', hits: [] }))
      }
    })()
    return
  }

  // POST /api/tool — run ONE built-in tool directly, no model loop. The fast path for
  // tool-shaped intents (e.g. research → web_search): the dialogue layer fires the tool
  // and shows results in ~2s instead of spinning up the slow generative agent to decide.
  if (req.method === 'POST' && url.pathname === '/api/tool') {
    void (async () => {
      setCORSHeaders(res)
      try {
        const body = await new Promise<string>((resolve, reject) => {
          let d = ''
          req.on('data', (c: Buffer) => { d += c.toString() })
          req.on('end', () => resolve(d))
          req.on('error', reject)
        })
        const { name, input, provider_keys } = JSON.parse(body || '{}') as {
          name?: string; input?: Record<string, unknown>
          provider_keys?: { anthropic?: string; openai?: string; serper?: string }
        }
        if (!name || !BUILTIN_TOOLS.some((t) => t.name === name)) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: `unknown built-in tool: ${name}` }))
          return
        }
        const result = await executeTool(name, input ?? {}, provider_keys ?? {})
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ result }))
      } catch (err) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'internal_error' }))
      }
    })()
    return
  }

  // POST /api/graph/gremlin — Gremlin/TinkerPop traversal over HellGraph property graph
  if (req.method === 'POST' && url.pathname === '/api/graph/gremlin') {
    void (async () => {
      setCORSHeaders(res)
      try {
        const body = await new Promise<string>((resolve, reject) => {
          let d = ''
          req.on('data', (c: Buffer) => { d += c.toString() })
          req.on('end', () => resolve(d))
          req.on('error', reject)
        })
        const { query } = JSON.parse(body) as { query: string }
        if (!query || typeof query !== 'string') {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'query field required' }))
          return
        }
        const result = runGremlin(getGraph(), query)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch (err) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'internal_error' }))
      }
    })()
    return
  }

  // POST /api/graph/sparql — SPARQL SELECT/CONSTRUCT/ASK over HellGraph property graph
  if (req.method === 'POST' && url.pathname === '/api/graph/sparql') {
    void (async () => {
      setCORSHeaders(res)
      try {
        const body = await new Promise<string>((resolve, reject) => {
          let d = ''
          req.on('data', (c: Buffer) => { d += c.toString() })
          req.on('end', () => resolve(d))
          req.on('error', reject)
        })
        const { query } = JSON.parse(body) as { query: string }
        if (!query || typeof query !== 'string') {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'query field required' }))
          return
        }
        const result = graphSparql(query)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch (err) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'internal_error' }))
      }
    })()
    return
  }

  // POST /api/graph/cypher — Cypher query proxy to the HellGraph sidecar
  if (req.method === 'POST' && url.pathname === '/api/graph/cypher') {
    void (async () => {
      setCORSHeaders(res)
      try {
        const body = await new Promise<string>((resolve, reject) => {
          let d = ''
          req.on('data', (c: Buffer) => { d += c.toString() })
          req.on('end', () => resolve(d))
          req.on('error', reject)
        })
        const payload = JSON.parse(body) as { query: string; params?: Record<string, unknown> }
        const upstream = await fetch('http://127.0.0.1:8137/cypher', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(5_000),
        })
        const result = await upstream.json()
        res.writeHead(upstream.ok ? 200 : upstream.status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch (err) {
        res.writeHead(503, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'Sidecar unavailable' }))
      }
    })()
    return
  }

  // GET /api/governance/recent — last N completed run traces for Govern surface
  if (req.method === 'GET' && url.pathname === '/api/governance/recent') {
    setCORSHeaders(res)
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), GOVERNANCE_RING_SIZE)
    const runs = _governanceRuns.slice(-limit).reverse()
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ runs }))
    return
  }

  // GET /api/benchmark/summary — per-model aggregates from the governance ring
  // for the local-vs-frontier dashboard: runs, avg latency, total cost, egress.
  if (req.method === 'GET' && url.pathname === '/api/benchmark/summary') {
    setCORSHeaders(res)
    type Agg = {
      model: string; provider: string; runs: number; errors: number
      total_latency_ms: number; total_cost_usd: number
      total_in_tokens: number; total_out_tokens: number; total_egressed: number
      is_local: boolean
    }
    const byModel = new Map<string, Agg>()
    for (const r of _governanceRuns) {
      const key = `${r.provider}:${r.model_routed}`
      const a = byModel.get(key) ?? {
        model: r.model_routed, provider: r.provider, runs: 0, errors: 0,
        total_latency_ms: 0, total_cost_usd: 0, total_in_tokens: 0,
        total_out_tokens: 0, total_egressed: 0,
        is_local: r.provider === 'ollama' || r.provider === 'meta',
      }
      a.runs += 1
      if (r.error) a.errors += 1
      a.total_latency_ms += r.latency_ms ?? 0
      a.total_cost_usd += r.cost_usd ?? 0
      a.total_in_tokens += r.input_tokens ?? 0
      a.total_out_tokens += r.output_tokens ?? 0
      a.total_egressed += r.tokens_egressed ?? 0
      byModel.set(key, a)
    }
    const summary = [...byModel.values()].map((a) => ({
      model: a.model,
      provider: a.provider,
      is_local: a.is_local,
      runs: a.runs,
      error_rate: a.runs ? a.errors / a.runs : 0,
      avg_latency_ms: a.runs ? Math.round(a.total_latency_ms / a.runs) : 0,
      total_cost_usd: a.total_cost_usd,
      avg_cost_usd: a.runs ? a.total_cost_usd / a.runs : 0,
      total_in_tokens: a.total_in_tokens,
      total_out_tokens: a.total_out_tokens,
      total_tokens_egressed: a.total_egressed,
    })).sort((x, y) => y.runs - x.runs)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ summary, ring_size: _governanceRuns.length }))
    return
  }

  // GET /api/quality/drivers — symbolic-regression driver analysis: which
  // signals most drive answer quality (Value-Judgment worth).
  if (req.method === 'GET' && url.pathname === '/api/quality/drivers') {
    setCORSHeaders(res)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ...analyzeDrivers(), total_samples: qualitySamples().length }))
    return
  }

  // GET /api/self/capabilities — the agent's self-model: per-task/model
  // success rate + latency. This is introspection a stateless cloud chat lacks.
  if (req.method === 'GET' && url.pathname === '/api/self/capabilities') {
    setCORSHeaders(res)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      capabilities: capabilitySummary(),
      capability_routing: process.env['NOETICA_CAPABILITY_ROUTING'] === '1',
    }))
    return
  }

  // GET /api/self/trends — make the compounding loop OBSERVABLE. Three axes of
  // "is the system actually getting better as it runs": answer-quality worth over
  // time (quality-SR), bandit routing convergence (which arm each task settled on),
  // and the symbolic substrate growing (PLN-derived edges accreting in the graph).
  if (req.method === 'GET' && url.pathname === '/api/self/trends') {
    setCORSHeaders(res)
    const { total, derived, byClass } = graphEdgeStats()
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      quality: worthTrend(),
      bandit: banditStandings(),
      graph: {
        total_edges: total,
        derived_edges: derived,
        by_epistemic_class: byClass,
      },
      drivers: analyzeDrivers().drivers.slice(0, 3),
      history: _trendHistory.slice(-90), // long-horizon: last 90 daily snapshots
    }))
    return
  }

  // GET /api/host/profile — hardware profile + the isolation tier the box should
  // default to. The app shows this at setup; selection is opinionated (stronger
  // hardware ⇒ stronger isolation, never a default that's unusably slow).
  if (req.method === 'GET' && url.pathname === '/api/host/profile') {
    setCORSHeaders(res)
    void (async () => {
      try {
        const { profileHost, selectIsolationTier } = await import('./lib/host-profile.js')
        const profile = await profileHost()
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ profile, isolation: selectIsolationTier(profile) }))
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'internal_error' }))
      }
    })()
    return
  }

  // GET /api/flags — observability for the NOETICA_* feature flags: live state +
  // graduation status. Lets the UI/governance see what's actually active and which
  // experiments are candidates to graduate (default-on) or retire.
  // GET /api/analytics/flow — conversation analytics + flow metrics over recorded
  // turns: intent distribution, the transition matrix (conversation flow), fallback
  // & grounding rates, latency-by-intent, and common paths. The Rasa-X equivalent.
  if (req.method === 'GET' && url.pathname === '/api/analytics/flow') {
    setCORSHeaders(res)
    void (async () => {
      try {
        const { computeFlowMetrics } = await import('./lib/dialogue-tracker.js')
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(computeFlowMetrics()))
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'internal_error' }))
      }
    })()
    return
  }

  // GET /api/analytics/energy — measured device (T1) vs derived cloud baseline (T2)
  // energy over recorded dispatches. The honest §9 accounting: reads are near-zero,
  // generation is the cost, the win is the read_share (amortization). Methodology inline.
  if (req.method === 'GET' && url.pathname === '/api/analytics/energy') {
    setCORSHeaders(res)
    void (async () => {
      try {
        const { readDispatches } = await import('./lib/dispatch-ledger.js')
        const { aggregateEnergy } = await import('./lib/energy.js')
        const entries = readDispatches().map((d) => ({ method: d.model, latencyMs: d.latencyMs }))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(aggregateEnergy(entries)))
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'internal_error' }))
      }
    })()
    return
  }

  // GET /api/ledger/replay — replay the dispatch hash-chain. ok:true ⇒ every dispatch
  // recomputes to its recorded attestation and links to its predecessor = POS@T1, the
  // deterministic proof. brokenAt names the first tampered/divergent entry.
  if (req.method === 'GET' && url.pathname === '/api/ledger/replay') {
    setCORSHeaders(res)
    void (async () => {
      try {
        const { replayLedger } = await import('./lib/dispatch-ledger.js')
        const r = replayLedger()
        res.writeHead(r.ok ? 200 : 409, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ...r, verdict: r.ok ? 'POS' : 'NEG', tier: 'T1' }))
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'internal_error' }))
      }
    })()
    return
  }

  // GET /api/fabric/brief — the live context fabric brief (STI-gated, cross-surface).
  // Reads the running server's in-memory atomspace so voice/chat/UI share one state.
  if (req.method === 'GET' && url.pathname === '/api/fabric/brief') {
    setCORSHeaders(res)
    void (async () => {
      try {
        const { readBrief, fabricCount } = await import('./lib/fabric.js')
        const session = url.searchParams.get('session') ?? undefined
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ brief: readBrief({ session, limit: 12 }), total: fabricCount() }))
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'internal_error' }))
      }
    })()
    return
  }

  // GET /api/analytics/policy — the fitted symbolic reward policy: a readable
  // formula (reward ≈ Σ wᵢ·featureᵢ) over recorded turns, its R², and the top
  // drivers. This is the interpretable reward model the bandit optimizes against.
  if (req.method === 'GET' && url.pathname === '/api/analytics/policy') {
    setCORSHeaders(res)
    void (async () => {
      try {
        const { readTurns } = await import('./lib/dialogue-tracker.js')
        const { fitPolicy } = await import('./lib/symbolic-policy.js')
        const policy = fitPolicy(readTurns())
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(policy ?? { formula: null, reason: 'need ≥8 rewarded turns to fit', n: 0 }))
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'internal_error' }))
      }
    })()
    return
  }

  // GET /api/training/qa — the harvested gold Q/A training pairs as a Pareto +
  // hierarchy report: head intents (cumulative ≤80% of volume) vs the long tail,
  // each with its top exemplars. The training-data flywheel, made inspectable.
  if (req.method === 'GET' && url.pathname === '/api/training/qa') {
    setCORSHeaders(res)
    void (async () => {
      try {
        const { paretoReport } = await import('./lib/qa-pairs.js')
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(paretoReport()))
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'internal_error' }))
      }
    })()
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/flags') {
    setCORSHeaders(res)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      flags: FEATURE_FLAGS.map((f) => ({
        env: f.env,
        enabled: isFlagOn(f.env),
        status: f.status,
        description: f.desc,
      })),
      auth_required: !!process.env['NOETICA_API_TOKEN'],
    }))
    return
  }

  // GET /api/domains — the symbolic moat: domain knowledge bundles consumed from
  // the graphbrain latent engine. Lists each Domain atom with its topic/glossary
  // counts and the governing SHACL shape id.
  if (req.method === 'GET' && url.pathname === '/api/domains') {
    setCORSHeaders(res)
    void (async () => {
      try {
        const g = getGraph()
        const domains = g.nodesByLabel('Domain').map((d) => {
          const did = d.id
          const topics = g.nodesByLabel('Topic').filter((n) => n.properties['domain_id'] === did)
          const terms = g.nodesByLabel('GlossaryTerm').filter((n) => String(n.properties['domains'] ?? '').includes(String(d.properties['corpus_release_ref'] ?? '')))
          return {
            domain_id: did,
            corpus_release_ref: d.properties['corpus_release_ref'] ?? null,
            basis_family: d.properties['basis_family'] ?? null,
            dimension_count: d.properties['dimension_count'] ?? null,
            n_documents: d.properties['n_documents'] ?? null,
            topics: topics.length,
            glossary_terms: terms.length,
            shape_id: `${did}#shape`,
          }
        })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ domains }))
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'internal_error' }))
      }
    })()
    return
  }

  // GET /api/domains/match?q=... — the moat informing reasoning: which consumed
  // domain(s) a query touches, with the matching Topics + glossary terms. Used to
  // bias retrieval and inject domain vocabulary/laws as grounding into the prompt.
  if (req.method === 'GET' && url.pathname === '/api/domains/match') {
    setCORSHeaders(res)
    void (async () => {
      try {
        const q = url.searchParams.get('q') ?? ''
        const { matchDomains } = await import('./lib/graphbrain-bridge.js')
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ query: q, matches: matchDomains(q, 3) }))
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'internal_error' }))
      }
    })()
    return
  }

  // POST /api/domains/consume — consume a graphbrain LatentBasisArtifact into the
  // local HellGraph as a domain knowledge bundle (Domain + 22 Topics + GlossaryTerms
  // + SHACL law). Accepts an inline { artifact } object or an { artifactPath } to a
  // LatentBasisArtifact22 JSON file. Idempotent per corpus release.
  if (req.method === 'POST' && url.pathname === '/api/domains/consume') {
    void (async () => {
      setCORSHeaders(res)
      if (!requireApiToken(req, res)) return
      try {
        const body = await new Promise<string>((resolve, reject) => {
          let d = ''
          req.on('data', (c: Buffer) => { d += c.toString() })
          req.on('end', () => resolve(d))
          req.on('error', reject)
        })
        const { artifact, artifactPath } = JSON.parse(body || '{}') as { artifact?: unknown; artifactPath?: string }
        const { consumeLatentArtifact } = await import('./lib/graphbrain-bridge.js')
        let art = artifact as Record<string, unknown> | undefined
        if (!art && artifactPath) {
          const fs = await import('node:fs')
          art = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
        }
        if (!art || typeof art !== 'object' || !('corpus_release_ref' in art)) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'provide { artifact } or { artifactPath } to a LatentBasisArtifact22' }))
          return
        }
        const summary = consumeLatentArtifact(art as unknown as Parameters<typeof consumeLatentArtifact>[0])
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(summary))
      } catch (err) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'internal_error' }))
      }
    })()
    return
  }

  // GET /api/self/construction — the agent's grounded self-model: the repos that
  // build it + their architecture relations.
  if (req.method === 'GET' && url.pathname === '/api/self/construction') {
    setCORSHeaders(res)
    void (async () => {
      try {
        const { selfModelSummary } = await import('./lib/self-model.js')
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(selfModelSummary()))
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'internal_error' }))
      }
    })()
    return
  }

  // POST /api/self/ingest-construction — ingest the construction repos into RAG +
  // the HellGraph self-model so the agent can explain how it works from fact.
  if (req.method === 'POST' && url.pathname === '/api/self/ingest-construction') {
    void (async () => {
      setCORSHeaders(res)
      if (!requireApiToken(req, res)) return
      try {
        const { ingestSelfModel } = await import('./lib/self-model.js')
        const summary = await ingestSelfModel()
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(summary))
      } catch (err) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'internal_error' }))
      }
    })()
    return
  }

  // POST /api/self/reset — prune learned state (self-model + quality corpus) and
  // persist the cleared state so it doesn't rehydrate on restart. The escape hatch
  // for when the compounding loop has learned something wrong and must start fresh.
  if (req.method === 'POST' && url.pathname === '/api/self/reset') {
    setCORSHeaders(res)
    if (!requireApiToken(req, res)) return
    const caps = resetCapabilities()
    const samples = resetQuality()
    try { saveLearningState() } catch { /* persistence best-effort */ }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, cleared: { capabilities: caps, quality_samples: samples } }))
    return
  }

  // GET /api/graph/shacl/report — last Ontogenesis write-validation result
  if (req.method === 'GET' && url.pathname === '/api/graph/shacl/report') {
    setCORSHeaders(res)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      enabled: process.env['NOETICA_SHACL_ENFORCE'] === '1',
      report: _lastShaclReport,
    }))
    return
  }

  // GET /api/epistemic/contradictions — preserved Value-Judgment contradictions
  // (EpiCybernetica contradiction ledger). Control signals, not erased.
  if (req.method === 'GET' && url.pathname === '/api/epistemic/contradictions') {
    setCORSHeaders(res)
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), CONTRADICTION_RING_SIZE)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ contradictions: _contradictions.slice(-limit).reverse(), total: _contradictions.length }))
    return
  }

  // POST /api/self/feedback — user reward signal for preference learning.
  // Body: { task, provider, model, reward (0..1) }. Feeds the bandit.
  if (req.method === 'POST' && url.pathname === '/api/self/feedback') {
    setCORSHeaders(res)
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => {
      try {
        const f = JSON.parse(body) as { task?: string; provider?: string; model?: string; reward?: number }
        if (!f.provider || !f.model || typeof f.reward !== 'number') throw new Error('provider, model, reward required')
        recordReward({ task: f.task, provider: f.provider, model: f.model, reward: f.reward })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'internal_error' }))
      }
    })
    return
  }

  // GET /api/checkpoints?session=... — interrupted runs available to resume
  if (req.method === 'GET' && url.pathname === '/api/checkpoints') {
    setCORSHeaders(res)
    const session = url.searchParams.get('session') ?? undefined
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ checkpoints: listCheckpoints(session) }))
    return
  }

  // GET /api/checkpoints/:id/resume — the message array to resume a run.
  // The client sends these back to /api/chat (optionally with ?context=...) to continue.
  if (req.method === 'GET' && url.pathname.startsWith('/api/checkpoints/') && url.pathname.endsWith('/resume')) {
    setCORSHeaders(res)
    const id = decodeURIComponent(url.pathname.slice('/api/checkpoints/'.length, -'/resume'.length))
    const cp = getCheckpoint(id)
    if (!cp) { res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'not_found' })); return }
    const added = url.searchParams.get('context') ?? undefined
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ checkpoint: cp, resume_messages: buildResumeMessages(cp, added) }))
    return
  }

  // GET /api/goals?session=... — list goals (active objective + plan + slots)
  if (req.method === 'GET' && url.pathname === '/api/goals') {
    setCORSHeaders(res)
    const session = url.searchParams.get('session') ?? undefined
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ goals: listGoals(session) }))
    return
  }

  // POST /api/goals — create or update a goal (objective, subtasks, slots, status)
  if (req.method === 'POST' && url.pathname === '/api/goals') {
    setCORSHeaders(res)
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => {
      try {
        const b = JSON.parse(body) as Partial<Goal> & { session_id?: string; objective?: string }
        if (!b.session_id || !b.objective) throw new Error('session_id and objective required')
        const now = new Date().toISOString()
        const existing = b.id ? listGoals().find((g) => g.id === b.id) : undefined
        const goal: Goal = {
          id: b.id ?? `urn:goal:${crypto.randomUUID()}`,
          session_id: b.session_id,
          objective: b.objective,
          status: b.status ?? existing?.status ?? 'active',
          subtasks: b.subtasks ?? existing?.subtasks ?? [],
          slots: b.slots ?? existing?.slots ?? [],
          created_at: existing?.created_at ?? now,
          updated_at: now,
        }
        saveGoal(goal)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, goal }))
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'internal_error' }))
      }
    })
    return
  }

  // ── GAIA twin API ─────────────────────────────────────────────────────────────

  // GET /api/gaia/twin — current HumanTwinState
  if (req.method === 'GET' && url.pathname === '/api/gaia/twin') {
    setCORSHeaders(res)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(getTwinState()))
    return
  }

  // GET /api/gaia/beliefs — recent BeliefSnapshots
  if (req.method === 'GET' && url.pathname === '/api/gaia/beliefs') {
    setCORSHeaders(res)
    const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') ?? '5', 10), 100))
    const beliefs = getRecentBeliefs(limit).map((b) => ({
      id: b.id,
      created_at:      b.props['created_at'],
      current_focus:   b.props['current_focus'],
      focus_confidence: b.props['focus_confidence'],
      posterior_atoms: (() => { try { return JSON.parse(String(b.props['posterior_atoms'] ?? '[]')) } catch { return [] } })(),
      weighted_rules:  (() => { try { return JSON.parse(String(b.props['weighted_rules']  ?? '[]')) } catch { return [] } })(),
      hypotheses:      (() => { try { return JSON.parse(String(b.props['hypotheses']       ?? '[]')) } catch { return [] } })(),
      world_summary:   b.props['world_summary'],
    }))
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ beliefs }))
    return
  }

  // GET /api/gaia/laws — recent CandidateLaws
  if (req.method === 'GET' && url.pathname === '/api/gaia/laws') {
    setCORSHeaders(res)
    const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10), 500))
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ laws: getRecentLaws(limit) }))
    return
  }

  // GET /api/gaia/world — recent WorldStateSnapshots
  if (req.method === 'GET' && url.pathname === '/api/gaia/world') {
    setCORSHeaders(res)
    const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') ?? '10', 10), 200))
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ snapshots: getRecentWorldStates(limit) }))
    return
  }

  // GET /api/gaia/observations — recent GaiaObservations
  if (req.method === 'GET' && url.pathname === '/api/gaia/observations') {
    setCORSHeaders(res)
    const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10), 500))
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ observations: getRecentObservations(limit) }))
    return
  }

  // POST /api/gaia/observe — ingest a ComputerUse observation
  if (req.method === 'POST' && url.pathname === '/api/gaia/observe') {
    setCORSHeaders(res)
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => {
      void (async () => {
        try {
          const raw = JSON.parse(body) as GaiaObservationPayload & { anthropic_key?: string; openai_key?: string }
          const { anthropic_key, openai_key, ...payload } = raw
          if (!payload.session_id || !payload.captured_at) {
            res.writeHead(400, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: 'session_id and captured_at required' }))
            return
          }
          const obsId = ingestGaiaObservation(payload)

          // Trigger a superconscious loop run on new observation if we have keys
          const providerKeys: LoopProviderKeys = {}
          if (anthropic_key) providerKeys.anthropic = anthropic_key
          else if (openai_key) providerKeys.openai = openai_key
          if (providerKeys.anthropic || providerKeys.openai) {
            void runSuperconsciousLoop(providerKeys)
          }

          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: true, observation_id: obsId }))
        } catch (err) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'internal_error' }))
        }
      })()
    })
    return
  }

  // POST /api/gaia/loop/trigger — manually trigger one superconscious cycle
  if (req.method === 'POST' && url.pathname === '/api/gaia/loop/trigger') {
    setCORSHeaders(res)
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => {
      void (async () => {
        try {
          const { anthropic_key, openai_key } = JSON.parse(body) as { anthropic_key?: string; openai_key?: string }
          const keys: LoopProviderKeys = {}
          if (anthropic_key) keys.anthropic = anthropic_key
          if (openai_key)    keys.openai    = openai_key
          if (!keys.anthropic && !keys.openai) {
            res.writeHead(400, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: 'anthropic_key or openai_key required' }))
            return
          }
          res.writeHead(202, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: true, message: 'Superconscious cycle triggered', last_loop_at: _lastLoopAt }))
          void runSuperconsciousLoop(keys)
        } catch (err) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'internal_error' }))
        }
      })()
    })
    return
  }

  // POST /api/gaia/loop/start — start the background loop
  if (req.method === 'POST' && url.pathname === '/api/gaia/loop/start') {
    setCORSHeaders(res)
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => {
      try {
        const { anthropic_key, openai_key } = JSON.parse(body) as { anthropic_key?: string; openai_key?: string }
        const keys: LoopProviderKeys = {}
        if (anthropic_key) keys.anthropic = anthropic_key
        if (openai_key)    keys.openai    = openai_key
        if (!keys.anthropic && !keys.openai) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'anthropic_key or openai_key required' }))
          return
        }
        startSuperconsciousLoop(keys)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, enabled: _loopEnabled, interval_ms: LOOP_INTERVAL_MS }))
      } catch (err) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'internal_error' }))
      }
    })
    return
  }

  // GET /api/gaia/loop/status
  if (req.method === 'GET' && url.pathname === '/api/gaia/loop/status') {
    setCORSHeaders(res)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ enabled: _loopEnabled, running: _loopRunning, last_loop_at: _lastLoopAt, interval_ms: LOOP_INTERVAL_MS }))
    return
  }

  // /api/tune/* — KD training stubs (real distillation requires separate distill server)
  if (url.pathname.startsWith('/api/tune/')) {
    setCORSHeaders(res)
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
    res.writeHead(503, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      ok: false,
      error: 'Distillation server not running. Start the Noetica distillation server (separate process) to enable KD training.',
      hint: 'See docs/tune-server.md for setup instructions.',
    }))
    return
  }

  // GET /api/graph/nodes — raw node/edge data for visualization
  if (req.method === 'GET' && url.pathname === '/api/graph/nodes') {
    void (async () => {
      setCORSHeaders(res)
      try {
        const g = getGraph()
        const nodes = g.allNodes().map(n => ({
          id: n.id,
          label: n.labels[0] ?? 'node',
          kind: n.properties['kind'] ?? n.labels[0] ?? 'node',
          surface: n.properties['surface'] ?? n.properties['sessionId'] ?? n.properties['filename'] ?? n.id.split(':').pop() ?? n.id.slice(-16),
          primes: n.properties['prime_support'] ?? '',
          clock: Number(n.properties['timestamp'] ?? 0),
          createdAt: n.createdAt,
        }))
        const edges = g.allEdges().slice(0, 200).map(e => ({
          from: e.from,
          to: e.to,
          label: e.label,
        }))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ nodes, edges }))
      } catch (err) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'internal_error' }))
      }
    })()
    return
  }

  // GET /api/graph/surface — legible, view-scoped subgraph for the force-graph UI.
  // Shares lib/graph-surface with the Next route so web + Tauri desktop agree.
  if (req.method === 'GET' && url.pathname === '/api/graph/surface') {
    void (async () => {
      setCORSHeaders(res)
      try {
        const g = getGraph()
        const view = url.searchParams.get('view') ?? 'all'
        const root = url.searchParams.get('root') ?? ''
        const limit = Number(url.searchParams.get('limit') ?? 34)
        // Category lenses (tech/knowledge) use TRUE topic discovery: vectorize → cluster
        // → 22 cluster representatives, drill into a cluster's members. Falls back to the
        // pure degree-ranked selection if embeddings/clustering aren't available.
        const CAT: Record<string, string> = { tech: 'technical', knowledge: 'learning' }
        let result
        if (CAT[view]) {
          try {
            const { clusterSurface } = await import('./lib/graph-cluster.js')
            result = await clusterSurface(g.allNodes(), g.allEdges(), { view, root, k: limit, category: CAT[view]! })
            if (!result.nodes.length) result = selectSurface(g.allNodes(), g.allEdges(), { view, limit, root })
          } catch (e) {
            console.warn('[graph-cluster] falling back to degree-rank:', e instanceof Error ? e.message : e)
            result = selectSurface(g.allNodes(), g.allEdges(), { view, limit, root })
          }
        } else {
          result = selectSurface(g.allNodes(), g.allEdges(), { view, limit, root })
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch (err) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ nodes: [], links: [], error: 'internal_error' }))
      }
    })()
    return
  }

  // GET /api/models — model suite status for first-run UI
  if (req.method === 'GET' && url.pathname === '/api/models') {
    void (async () => {
      const ollamaUp = await isOllamaRunning()
      const pulledModels = ollamaUp ? await listLocalModels() : []
      const suite = LOCAL_MODEL_SUITE.map((m) => ({
        ...m,
        // Essential first-run set (manifest: priority 1–5 are required). The first-run
        // UI auto-pulls only required models; the rest are on-demand. Without this the
        // overlay's `m.required` filter matches nothing and never pulls anything.
        required: m.priority <= 5,
        pulled: pulledModels.some((p) => p === m.name || p.startsWith(m.name.split(':')[0]!)),
        ollamaRunning: ollamaUp,
      }))
      const allPulled = suite.every((m) => m.pulled)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ollamaRunning: ollamaUp, allPulled, models: suite }))
    })()
    return
  }

  // GET /api/models/stream — SSE feed of model pull progress for first-run UI
  if (req.method === 'GET' && url.pathname === '/api/models/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })
    res.write('data: {"type":"connected"}\n\n')
    _modelProgressClients.add(res)
    const heartbeat = setInterval(() => {
      try { res.write(':heartbeat\n\n') } catch { clearInterval(heartbeat); _modelProgressClients.delete(res) }
    }, 15000)
    req.on('close', () => { clearInterval(heartbeat); _modelProgressClients.delete(res) })
    return
  }

  // GET /api/graph/health
  if (req.method === 'GET' && url.pathname === '/api/graph/health') {
    void (async () => {
      setCORSHeaders(res)
      try {
        const h = await graphHealth()
        // Shape matches OperateSurface GraphHealthStatus + TimeServiceStatus wrapper
        const payload = {
          graph: {
            graphId: 'sociosphere-primary',
            status: h.nodeCount > 0 ? 'ok' : 'degraded',
            nodeCount: h.nodeCount,
            edgeCount: h.edgeCount,
            pendingIngestCount: _pendingIngestCount,
            failedIngestCount: 0,
            orphanNodeCount: h.orphans,
            duplicateEntityCount: 0,
            stalePartitionCount: 0,
            vectorIndexStatus: h.nodeCount > 0 ? 'indexed' : 'empty',
            walPath: h.walPath,
            logicalClock: h.logicalClock,
          },
          time: {
            serviceId: 'time-primary',
            status: 'ok',
            logicalTime: String(h.logicalClock),
            latestEventTime: new Date().toISOString(),
            ledgerLagMs: 0,
            clockSkewMs: 0,
          },
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(payload))
      } catch (err) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'internal_error' }))
      }
    })()
    return
  }

  // GET /api/graph/query?q=...&patterns=graph,temporal&maxTokens=1500&sessionId=...
  if (req.method === 'GET' && url.pathname === '/api/graph/query') {
    void (async () => {
      try {
        const q = url.searchParams.get('q') ?? ''
        const rawPatterns = url.searchParams.get('patterns') ?? 'graph,temporal'
        const patterns = rawPatterns.split(',').filter(Boolean) as Array<'graph' | 'temporal' | 'sparql' | 'cache-augmented'>
        const maxTokens = Math.max(100, Math.min(parseInt(url.searchParams.get('maxTokens') ?? '2000', 10), 16_000))
        const sessionId = url.searchParams.get('sessionId') ?? undefined
        const result = await retrieve(q, { patterns, maxTokens, sessionId })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch (err) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'internal_error' }))
      }
    })()
    return
  }

  // POST /api/graph/ingest  — { type: 'interaction'|'message'|'conversation', payload: {...} }
  if (req.method === 'POST' && url.pathname === '/api/graph/ingest') {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => {
      void (async () => {
        try {
          const parsed = JSON.parse(body) as { type: string; payload?: Record<string, unknown>; candidate?: Record<string, unknown> }
          const { type } = parsed
          if (type === 'interaction') await trackIngest(ingestInteraction(parsed.payload as unknown as Parameters<typeof ingestInteraction>[0]))
          else if (type === 'message') await trackIngest(ingestMessage(parsed.payload as unknown as Parameters<typeof ingestMessage>[0]))
          else if (type === 'conversation') await trackIngest(ingestConversation(parsed.payload as unknown as Parameters<typeof ingestConversation>[0]))
          else if (type === 'prometheus_candidate') {
            // prometheusd writes discovered dynamics equations into HellGraph as first-class atoms
            const candidate = parsed.candidate as unknown as Parameters<typeof ingestPrometheusCandidate>[0]
            const nodeId = ingestPrometheusCandidate(candidate)
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ ok: true, nodeId }))
            return
          }
          else if (type === 'tool_result') {
            // MCP/built-in tool results become first-class knowledge atoms in HellGraph
            const { ingestEntities } = await import('./lib/graph.js')
            const p = parsed.payload as { interaction_id: string; session_id: string; content: string; timestamp: string }
            ingestEntities(p.interaction_id, p.session_id, p.content, p.timestamp)
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ ok: true }))
            return
          }
          else if (type === 'tool_grant_check') {
            // A2A zero-trust: write ToolGrantCheck governance atom to HellGraph
            const p = parsed.payload as {
              check_id: string; grant_id: string; operation: string;
              checked_at: string; actor: { spiffe_id: string }; result: { valid: boolean }; policy_hash: string
            }
            const g = getHellGraph()
            g.addNode(p.check_id, ['ToolGrantCheck', 'GovernanceEvent'], {
              operation: p.operation,
              grant_id: p.grant_id,
              checked_at: p.checked_at,
              spiffe_id: p.actor.spiffe_id,
              valid: p.result.valid,
              policy_hash: p.policy_hash,
              kind: 'governance',
            })
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ ok: true, nodeId: p.check_id }))
            return
          }
          else throw new Error(`unknown ingest type: ${type}`)
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        } catch (err) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'internal_error' }))
        }
      })()
    })
    return
  }

  // POST /api/ingest/document — pre-extracted text { content, filename, mimeType? }
  // Embeds + stores semantically-searchable DocumentChunks (real RAG), AND keeps the
  // engine's entity/record ingest for graph structure.
  if (req.method === 'POST' && url.pathname === '/api/ingest/document') {
    setCORSHeaders(res)
    let body = ''
    req.on('data', (c: Buffer) => { body += c.toString() })
    req.on('end', () => {
      ;(async () => {
        try {
          const { content, filename, mimeType } = JSON.parse(body) as { content: string; filename: string; mimeType?: string }
          if (!content || typeof content !== 'string') throw new Error('content required')
          const { ingestDocument } = await import('./lib/doc-store.js')
          const result = await ingestDocument(filename || 'document.txt', content)
          // Best-effort: also run the engine's entity/record extraction for graph structure.
          try { const { ingestDocumentChunks } = await import('./lib/graph.js'); await ingestDocumentChunks(content, filename, mimeType ?? 'text/plain') } catch { /* non-fatal */ }
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify(result))
        } catch (err) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'internal_error' }))
        }
      })()
    })
    return
  }

  // POST /api/ingest/file — raw binary upload { filename, mimeType, dataBase64 }.
  // Extracts text SERVER-SIDE (so .docx works without a browser parser), then
  // embeds + stores it. This is the path the chat composer uses for documents.
  if (req.method === 'POST' && url.pathname === '/api/ingest/file') {
    setCORSHeaders(res)
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      ;(async () => {
        try {
          const { filename, mimeType, dataBase64 } = JSON.parse(Buffer.concat(chunks).toString()) as { filename: string; mimeType?: string; dataBase64: string }
          if (!filename || !dataBase64) throw new Error('filename and dataBase64 required')
          const buf = Buffer.from(dataBase64, 'base64')
          const { extractText, ingestDocument } = await import('./lib/doc-store.js')
          const text = await extractText(filename, mimeType ?? '', buf)
          if (!text.trim()) throw new Error('no extractable text in file')
          const result = await ingestDocument(filename, text)
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify(result))
        } catch (err) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'internal_error' }))
        }
      })()
    })
    return
  }

  // POST /api/ingest/path — ingest a LOCAL file by absolute path { path }. Used by
  // the Tauri picker (the webview can't read files; the native dialog returns a
  // path and the sidecar — full fs access — reads + extracts + embeds it).
  if (req.method === 'POST' && url.pathname === '/api/ingest/path') {
    setCORSHeaders(res)
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      ;(async () => {
        try {
          const { path: filePath } = JSON.parse(Buffer.concat(chunks).toString()) as { path: string }
          if (!filePath) throw new Error('path required')
          const fs = await import('node:fs')
          const pathMod = await import('node:path')
          const buf = fs.readFileSync(filePath)
          const filename = pathMod.basename(filePath)
          const { extractText, ingestDocument } = await import('./lib/doc-store.js')
          const text = await extractText(filename, '', buf)
          if (!text.trim()) throw new Error('no extractable text in file')
          const result = await ingestDocument(filename, text)
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify(result))
        } catch (err) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'internal_error' }))
        }
      })()
    })
    return
  }

  // POST /api/chat
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => {
      let parsed: ChatRequest
      try {
        parsed = JSON.parse(body) as ChatRequest
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid_json' }))
        return
      }

      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      })

      handleChat(parsed, res)
        .catch((err: unknown) => {
          try {
            sse(res, 'error', { error: 'internal_error' })
          } catch { /* ignore write errors after stream close */ }
        })
        .finally(() => {
          try { res.end() } catch { /* ignore */ }
        })
    })
    return
  }

  // POST /api/tts  — OpenAI text-to-speech, returns audio/mpeg
  if (req.method === 'POST' && url.pathname === '/api/tts') {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => {
      ;(async () => {
        let parsed: { text: string; voice?: string; api_key?: string } = { text: '' }
        try { parsed = JSON.parse(body) } catch {
          res.writeHead(400); res.end(JSON.stringify({ error: 'invalid_json' })); return
        }
        const key = parsed.api_key ?? process.env['OPENAI_API_KEY']
        if (!key) {
          res.writeHead(503); res.end(JSON.stringify({ error: 'no_openai_key' })); return
        }
        const voice = parsed.voice ?? 'nova'
        const text = parsed.text?.slice(0, 4096) ?? ''
        if (!text) {
          res.writeHead(400); res.end(JSON.stringify({ error: 'empty_text' })); return
        }
        try {
          const oaiRes = await fetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'tts-1', input: text, voice, response_format: 'mp3' }),
          })
          if (!oaiRes.ok) {
            const err = await oaiRes.text()
            res.writeHead(502); res.end(JSON.stringify({ error: err })); return
          }
          res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' })
          const buf = await oaiRes.arrayBuffer()
          res.end(Buffer.from(buf))
        } catch (err) {
          res.writeHead(502); res.end(JSON.stringify({ error: 'internal_error' }))
        }
      })()
    })
    return
  }

  // AtomSpace federation API (/api/atomspace/*)
  if (url.pathname.startsWith('/api/atomspace/')) {
    if (handleStorageNodeRequest(req, res, url.pathname, getAtomSpace())) return
  }

  // MeshRush agent runtime API (/api/meshrush/*)
  if (url.pathname.startsWith('/api/meshrush/')) {
    if (handleMeshRushRequest(req, res, url.pathname, getAtomSpace())) return
  }

  // CairnPath traversal API (/api/cairnpath/*)
  if (url.pathname.startsWith('/api/cairnpath')) {
    if (handleCairnPathRequest(req, res, url.pathname, getAtomSpace())) return
  }

  // ── Verify-repair coding loop ───────────────────────────────────────────────
  // Out-LOOP, not out-model: generate → run the verifier → on fail, feed the error back and
  // repair, up to a budget. A small local model in this loop beats a big model one-shot because
  // code is verifiable and errors are recoverable. Returns the full step trace (the narration).
  if (req.method === 'POST' && url.pathname === '/api/code/solve') {
    let body = ''
    req.on('data', (c: Buffer) => { body += c.toString() })
    req.on('end', () => { void (async () => {
      let p: { task?: string; workspace?: string; max_attempts?: number; model?: string } = {}
      try { p = JSON.parse(body) } catch { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid_json' })); return }
      const task = String(p.task ?? '').trim()
      if (!task) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'task_required' })); return }
      const wsName = (String(p.workspace ?? 'solve').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40)) || 'solve'
      const ws = path.join(os.homedir(), '.noetica', 'workspaces', wsName)
      try { fs.mkdirSync(ws, { recursive: true }) } catch { /* */ }
      const maxAttempts = Math.min(6, Math.max(1, Number(p.max_attempts ?? 4)))
      const model = String(p.model ?? 'qwen2.5-coder:7b')
      // Compounding loop (select): pull the most-similar PROVEN solutions and inject them as
      // few-shot, so the agent reuses what already worked instead of re-deriving from scratch.
      const { retrieveSimilar, fewShot, recordSolve, recordVerified } = await import('./lib/solution-memory.js')
      const memory = await retrieveSimilar(task, 2).catch(() => [])
      const memBlock = fewShot(memory)
      const usedMemory = memory.length > 0
      const SYS = 'You are a coding agent. Solve the task by writing files and ONE verification command that exits 0 only if the solution is correct (e.g. runs a test). Respond with ONLY a JSON object, no prose and no markdown fences:\n{"files":[{"path":"rel/path.ext","content":"..."}],"verify":"shell command"}\nUse tools available on the machine (python3, node). Paths are relative to the project root.' + (memBlock ? `\n\n${memBlock}` : '')
      const steps: Array<{ attempt: number; verify: string; exit: string; ok: boolean; files: string[]; output: string }> = []
      let solvedFiles: { path: string; content: string }[] = []; let solvedVerify = ''
      // Capture each touched file's ORIGINAL content the first time we write it, so the UI can
      // show a real diff and the user can reject (revert) a file back to its pre-solve state.
      const touched = new Map<string, string | null>()
      let prior = '', solved = false
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const user = attempt === 1 ? `Task: ${task}` : `Task: ${task}\n\nYour previous attempt FAILED:\n${prior}\nFix the code. Respond with the same JSON format.`
        let content = ''
        try { ({ content } = await generateOllamaText({ model, messages: [{ role: 'system', content: SYS }, { role: 'user', content: user }], temperature: attempt === 1 ? 0.2 : 0.55 })) }
        catch (e) { steps.push({ attempt, verify: '', exit: 'gen_error', ok: false, files: [], output: String(e).slice(0, 200) }); break }
        const sol = parseSolveOutput(content)
        if (!sol) { steps.push({ attempt, verify: '', exit: 'parse_error', ok: false, files: [], output: content.slice(0, 300) }); prior = "Your output didn't parse as the required JSON object."; continue }
        for (const f of sol.files) {
          const rel = f.path.replace(/^\/+/, '')
          const fp = path.resolve(ws, rel)
          if (!fp.startsWith(ws + path.sep) && fp !== ws) continue
          if (!touched.has(rel)) { try { touched.set(rel, fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : null) } catch { touched.set(rel, null) } }
          try { fs.mkdirSync(path.dirname(fp), { recursive: true }); fs.writeFileSync(fp, f.content) } catch { /* */ }
        }
        const { out, err, code } = await runInWorkspace(sol.verify, ws, 60_000)
        const ok = code === '0'
        const output = `${out}${err ? `\n${err}` : ''}`.trim()
        steps.push({ attempt, verify: sol.verify, exit: code, ok, files: sol.files.map((f) => f.path), output: output.slice(-1200) })
        if (ok) { solved = true; solvedFiles = sol.files; solvedVerify = sol.verify; break }
        prior = `Files: ${sol.files.map((f) => f.path).join(', ')}\nVerify: ${sol.verify}\nExit: ${code}\nOutput:\n${output.slice(-1500)}`
      }
      // prophet-cloud-mesh escape hatch: the local loop exhausted its budget unsolved. If a
      // sovereign tier is configured (NOETICA_SOVEREIGN_URL), escalate ONE attempt to it —
      // frontier-parity on your own infra. No-op (and zero cost) when the tier isn't armed.
      let escalated = false
      if (!solved) {
        const esc = await generateSovereign({
          messages: [
            { role: 'system', content: SYS },
            { role: 'user', content: `Task: ${task}\n\nA smaller local model failed after ${steps.length} attempts. Last failure:\n${prior}\nSolve it correctly. Same JSON format.` },
          ],
          temperature: 0.3,
        })
        if (esc) {
          escalated = true
          const sol = parseSolveOutput(esc.content)
          if (sol) {
            for (const f of sol.files) {
              const rel = f.path.replace(/^\/+/, '')
              const fp = path.resolve(ws, rel)
              if (!fp.startsWith(ws + path.sep) && fp !== ws) continue
              if (!touched.has(rel)) { try { touched.set(rel, fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : null) } catch { touched.set(rel, null) } }
              try { fs.mkdirSync(path.dirname(fp), { recursive: true }); fs.writeFileSync(fp, f.content) } catch { /* */ }
            }
            const { out, err, code } = await runInWorkspace(sol.verify, ws, 60_000)
            const ok = code === '0'
            const output = `${out}${err ? `\n${err}` : ''}`.trim()
            steps.push({ attempt: steps.length + 1, verify: sol.verify, exit: code, ok, files: sol.files.map((f) => f.path), output: `[sovereign:${esc.model}] ${output}`.slice(-1200) })
            if (ok) { solved = true; solvedFiles = sol.files; solvedVerify = sol.verify }
          }
        }
      }

      // Per-file diffs (original vs final-on-disk) so the workspace can render an apply/reject review.
      const diffs = [...touched.entries()].map(([rel, before]) => {
        const fp = path.resolve(ws, rel)
        let after: string | null = null
        try { if (fs.existsSync(fp)) after = fs.readFileSync(fp, 'utf8') } catch { /* */ }
        return { path: rel, before, after, isNew: before === null }
      })
      // Compounding loop (memory + measure): log this outcome for the quality curve, and persist
      // the VERIFIED solution into the retrieval corpus so future similar tasks reuse it.
      recordSolve({ task, solved, attempts: steps.length, escalated, model, usedMemory })
      if (solved && solvedFiles.length) { void recordVerified(task, solvedFiles, solvedVerify).catch(() => {}) }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ solved, workspace: wsName, attempts: steps.length, steps, diffs, escalated, usedMemory }))
    })() })
    return
  }

  // GET /api/metrics/quality — the COMPOUNDING CURVE: solve-rate + avg-attempts over time, so we can
  // SHOW the loop improves with use (memory + retrieval), not just claim it.
  if (req.method === 'GET' && url.pathname === '/api/metrics/quality') {
    void (async () => {
      setCORSHeaders(res)
      try {
        const { qualityMetrics } = await import('./lib/solution-memory.js')
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(qualityMetrics()))
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'internal_error' }))
      }
    })()
    return
  }

  // POST /api/research/solve — answer a question GROUNDED in the brain, VERIFIED (grounding check)
  // with a repair loop. The research analogue of /api/code/solve, compounding the same way: verified
  // answers are stored + reused, and outcomes feed the SAME quality curve. Body: { question, max_attempts? }.
  if (req.method === 'POST' && url.pathname === '/api/research/solve') {
    let body = ''
    req.on('data', (c: Buffer) => { body += c.toString() })
    req.on('end', () => { void (async () => {
      setCORSHeaders(res)
      try {
        const p = JSON.parse(body || '{}') as { question?: string; max_attempts?: number }
        const question = String(p.question ?? '').trim()
        if (!question) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'question_required' })); return }
        const maxAttempts = Math.min(4, Math.max(1, Number(p.max_attempts ?? 3)))
        const { semanticSearch, lexicalSearch } = await import('./lib/doc-store.js')
        const sem = await semanticSearch(question, 6).catch(() => [] as { text: string; filename: string }[])
        const lex = lexicalSearch(question, 6)
        const seen = new Set<string>(); const sources: { text: string; filename: string }[] = []
        for (const h of [...sem, ...lex]) { const key = h.text.slice(0, 80); if (h.text && !seen.has(key)) { seen.add(key); sources.push({ text: h.text, filename: h.filename }) } }
        const { verifyGrounding } = await import('./lib/research-verify.js')
        const { retrieveSimilar, fewShot, recordSolve, recordVerified } = await import('./lib/solution-memory.js')
        const memory = await retrieveSimilar(question, 1).catch(() => [])
        const usedMemory = memory.length > 0
        if (!sources.length) {
          recordSolve({ task: question, solved: false, attempts: 0, escalated: false, model: 'research', usedMemory })
          res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ grounded: false, score: 0, answer: 'Nothing in my knowledge base grounds an answer to this — import or ingest relevant material first.', sources: [], attempts: 0, usedMemory }))
          return
        }
        const srcBlock = sources.slice(0, 8).map((s, i) => `[${i + 1}] (${s.filename}) ${s.text.slice(0, 600)}`).join('\n\n')
        const SYS = `You are a research assistant. Answer the question using ONLY the SOURCES below. Ground every statement in them; do NOT add facts the sources don't support. Be concise. If the sources don't answer it, say so.\n\nSOURCES:\n${srcBlock}` + (usedMemory ? `\n\n${fewShot(memory)}` : '')
        let answer = ''
        let grounding = { grounded: false, score: 0, supported: 0, total: 0, unsupported: [] as string[] }
        let attempts = 0, prior = ''
        for (let a = 1; a <= maxAttempts; a++) {
          attempts = a
          const user = a === 1 ? `Question: ${question}` : `Question: ${question}\n\nYour previous answer made claims the sources DON'T support:\n${prior}\nRewrite using ONLY supported facts.`
          try { ({ content: answer } = await generateOllamaText({ model: 'qwen2.5:7b', messages: [{ role: 'system', content: SYS }, { role: 'user', content: user }], temperature: a === 1 ? 0.2 : 0.4 })) }
          catch (e) { answer = `[generation error]`; break }
          grounding = verifyGrounding(answer, sources)
          if (grounding.grounded) break
          prior = grounding.unsupported.slice(0, 4).map((u) => `- ${u}`).join('\n')
        }
        recordSolve({ task: question, solved: grounding.grounded, attempts, escalated: false, model: 'research', usedMemory })
        if (grounding.grounded) void recordVerified(question, [{ path: 'research/answer.md', content: answer }], 'grounding-verified').catch(() => {})
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ grounded: grounding.grounded, score: grounding.score, answer, attempts, usedMemory, sources: sources.slice(0, 8).map((s, i) => ({ n: i + 1, filename: s.filename })), unsupported: grounding.unsupported }))
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'internal_error' }))
      }
    })() })
    return
  }

  // GET /api/mesh/status — the prophet-cloud-mesh tier ladder and which tiers are armed.
  // GET /api/graph/path?from=<id>&to=<id> — shortest path (BFS) between two nodes: the "how is X
  // related to Y?" query. Returns the chain of {id,label} (or empty if disconnected).
  if (req.method === 'GET' && url.pathname === '/api/graph/path') {
    setCORSHeaders(res)
    try {
      const from = url.searchParams.get('from') ?? '', to = url.searchParams.get('to') ?? ''
      const g = getGraph()
      const adj = new Map<string, string[]>()
      for (const e of g.allEdges()) {
        ;(adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push(e.to)
        ;(adj.get(e.to) ?? adj.set(e.to, []).get(e.to)!).push(e.from)
      }
      const prev = new Map<string, string>(); const seen = new Set([from]); const q = [from]; let found = from === to
      while (q.length && !found) {
        const u = q.shift()!
        for (const v of adj.get(u) ?? []) { if (!seen.has(v)) { seen.add(v); prev.set(v, u); if (v === to) { found = true; break } q.push(v) } }
      }
      let pathOut: { id: string; label: string }[] = []
      if (found) {
        const ids = [to]; let cur = to
        while (cur !== from && prev.has(cur)) { cur = prev.get(cur)!; ids.unshift(cur) }
        const nodeById = new Map(g.allNodes().map((n) => [n.id, n]))
        pathOut = ids.map((id) => { const n = nodeById.get(id); return { id, label: (n ? cleanLabel(n) : null) ?? id.split(':').pop() ?? id } })
      }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ path: pathOut, length: pathOut.length ? pathOut.length - 1 : -1 }))
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'internal_error' }))
    }
    return
  }

  // POST /api/import/chats — ingest a Claude/ChatGPT data-EXPORT (the conversations JSON) into the
  // brain: each conversation becomes a Document (chunked + embedded + atoms), searchable + in the
  // graph. History is NOT reachable via an API key — this is the export-file path. Body: the raw
  // export array/object, or { data: <export> }.
  if (req.method === 'POST' && url.pathname === '/api/import/chats') {
    let body = ''
    req.on('data', (c: Buffer) => { body += c.toString() })
    req.on('end', () => { void (async () => {
      setCORSHeaders(res)
      try {
        let data: unknown
        try { data = JSON.parse(body) } catch { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid_json' })); return }
        const payload = (data && typeof data === 'object' && !Array.isArray(data) && 'data' in (data as Record<string, unknown>)) ? (data as Record<string, unknown>)['data'] : data
        const { parseChatExport, transcript } = await import('./lib/chat-import.js')
        const convs = parseChatExport(payload)
        const { ingestDocument } = await import('./lib/doc-store.js')
        let imported = 0, messages = 0
        for (const conv of convs.slice(0, 5000)) {
          try { await ingestDocument(`chats/${conv.title.replace(/[^a-z0-9 _-]/gi, '_').slice(0, 60)}.md`, transcript(conv)); imported++; messages += conv.messages.length } catch { /* skip one bad conv */ }
        }
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ conversations: convs.length, imported, messages }))
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'internal_error' }))
      }
    })() })
    return
  }

  // POST /api/providers/capabilities — { provider, key } → probe the vendor's /models with the key
  // and return the supported feature matrix (vision/tools/prompt-caching/pdf/image-gen/realtime/
  // batch). Lets the router + UI expose ONLY what the key actually supports, instead of breaking on
  // a feature the key can't serve.
  if (req.method === 'POST' && url.pathname === '/api/providers/capabilities') {
    let body = ''
    req.on('data', (c: Buffer) => { body += c.toString() })
    req.on('end', () => { void (async () => {
      setCORSHeaders(res)
      try {
        const p = JSON.parse(body || '{}') as { provider?: string; key?: string }
        const { probeProvider } = await import('./lib/provider-caps.js')
        const caps = await probeProvider(p.provider ?? 'anthropic', p.key ?? '')
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(caps))
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'internal_error' }))
      }
    })() })
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/mesh/status') {
    setCORSHeaders(res)
    const tiers = meshLadder({ hasAnthropicKey: !!process.env['ANTHROPIC_API_KEY'] })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ tiers }))
    return
  }

  // GET/POST /api/graph/hygiene — the graph cleanup pass. GET = dry-run report (the plan:
  // class breakdown, spell flags, near-duplicate groups, orphan dispositions). POST {apply:true}
  // non-destructively marks junk-class nodes hygiene_pruned=true (reversible; the surface hides
  // them). Merges are reported for review, not auto-applied.
  if (url.pathname === '/api/graph/hygiene' && (req.method === 'GET' || req.method === 'POST')) {
    const run = (apply: boolean) => {
      setCORSHeaders(res)
      try {
        const g = getGraph()
        const hn = g.allNodes().map((n) => ({ id: n.id, label: cleanLabel(n) ?? (n.labels[0] ?? n.id), labelType: n.labels[0] ?? '', degree: 0 }))
        const edges = g.allEdges().map((e) => ({ from: e.from, to: e.to }))
        const report = buildReport(hn, edges, TAXONOMY_WORDS)
        let pruned = 0, merged = 0, attached = 0
        if (apply) {
          const gx = g as unknown as { setNodeProperty: (i: string, k: string, v: unknown) => void; addEdge: (t: string, f: string, to: string, p?: Record<string, unknown>) => void }
          for (const id of report.prunable) { try { gx.setNodeProperty(id, 'hygiene_pruned', true); pruned++ } catch { /* */ } }
          for (const m of report.mergeActions) { try { gx.setNodeProperty(m.id, 'hygiene_pruned', true); gx.setNodeProperty(m.id, 'hygiene_merged_into', m.into); merged++ } catch { /* */ } }
          for (const a of report.attachActions) { try { gx.addEdge('HYGIENE_ATTACH', a.id, a.to, {}); attached++ } catch { /* */ } }
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ...report, applied: apply ? { pruned, merged, attached } : null }))
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'internal_error' }))
      }
    }
    if (req.method === 'GET') { run(false); return }
    let body = ''
    req.on('data', (c: Buffer) => { body += c.toString() })
    req.on('end', () => { let p: { apply?: boolean } = {}; try { p = JSON.parse(body || '{}') } catch { /* */ } run(!!p.apply) })
    return
  }

  // POST /api/workspace/write — apply/revert a single file in a workspace (reject = write the
  // pre-solve content; delete=true removes a file the agent newly created). Sandboxed to the
  // workspace dir. Backs the diff review panel's accept/reject.
  if (req.method === 'POST' && url.pathname === '/api/workspace/write') {
    let body = ''
    req.on('data', (c: Buffer) => { body += c.toString() })
    req.on('end', () => {
      setCORSHeaders(res)
      let p: { ws?: string; path?: string; content?: string; delete?: boolean } = {}
      try { p = JSON.parse(body) } catch { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid_json' })); return }
      const wsName = String(p.ws ?? '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40)
      const rel = String(p.path ?? '').replace(/^\/+/, '')
      if (!wsName || !rel) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'ws_and_path_required' })); return }
      const ws = path.join(os.homedir(), '.noetica', 'workspaces', wsName)
      const fp = path.resolve(ws, rel)
      if (!fp.startsWith(ws + path.sep)) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'path_escape' })); return }
      try {
        if (p.delete) { if (fs.existsSync(fp)) fs.rmSync(fp) }
        else { fs.mkdirSync(path.dirname(fp), { recursive: true }); fs.writeFileSync(fp, String(p.content ?? '')) }
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true }))
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'write_failed' }))
      }
    })
    return
  }

  // ── Deterministic project scaffold (framework boilerplate is NOT a generative task) ──
  // Clarify (dialogue flow) → scaffold (here, deterministic) → customize (model) → run.
  if (req.method === 'POST' && url.pathname === '/api/code/scaffold') {
    let body = ''
    req.on('data', (c: Buffer) => { body += c.toString() })
    req.on('end', () => { void (async () => {
      let p: { framework?: string; name?: string; workspace?: string; typescript?: boolean; install?: boolean; dev?: boolean } = {}
      try { p = JSON.parse(body) } catch { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid_json' })); return }
      const FW: Record<string, string> = { vue: 'vue', react: 'react', svelte: 'svelte', vanilla: 'vanilla', preact: 'preact', lit: 'lit', solid: 'solid' }
      const base = FW[String(p.framework ?? 'vue').toLowerCase()] ?? 'vue'
      const template = p.typescript ? `${base}-ts` : base
      const name = (String(p.name ?? 'app').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 40)) || 'app'
      const wsName = (String(p.workspace ?? 'build').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40)) || 'build'
      const ws = path.join(os.homedir(), '.noetica', 'workspaces', wsName)
      try { fs.mkdirSync(ws, { recursive: true }) } catch { /* */ }
      const steps: Array<{ step: string; ok: boolean; output: string }> = []
      const sc = await runInWorkspace(`npm create vite@latest ${name} -- --template ${template}`, ws, 120_000)
      steps.push({ step: `scaffold · vite + ${template}`, ok: sc.code === '0', output: `${sc.out}${sc.err}`.slice(-400) })
      const projDir = path.join(ws, name)
      let devUrl: string | undefined
      if (sc.code === '0' && p.install !== false) {
        const ins = await runInWorkspace('npm install', projDir, 300_000)
        steps.push({ step: 'npm install', ok: ins.code === '0', output: `${ins.out}${ins.err}`.slice(-300) })
        if (ins.code === '0') {
          if (p.dev) {
            const d = await startDevServer('npm run dev', projDir, 35_000)
            devUrl = d.url
            steps.push({ step: 'npm run dev', ok: !!d.url, output: d.url ? `live at ${d.url}` : 'dev server did not report a URL in time' })
          } else {
            const b = await runInWorkspace('npm run build', projDir, 180_000)
            steps.push({ step: 'npm run build', ok: b.code === '0', output: `${b.out}${b.err}`.slice(-300) })
          }
        }
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: steps.every((s) => s.ok), framework: base, typescript: !!p.typescript, workspace: wsName, name, path: projDir, devUrl, devCommand: `cd ${projDir} && npm run dev`, steps }))
    })() })
    return
  }

  // ── Code workspace — list/read project files for the workspace surface ───────
  if (req.method === 'GET' && url.pathname === '/api/workspace/list') {
    void (async () => {
      setCORSHeaders(res)
      const root = path.join(os.homedir(), '.noetica', 'workspaces')
      const ws = (url.searchParams.get('ws') ?? '').replace(/[^a-zA-Z0-9._-]/g, '_')
      const SKIP = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', '.cache', 'target'])
      try {
        if (!ws) {
          const dirs = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => { try { return fs.statSync(path.join(root, d)).isDirectory() } catch { return false } }) : []
          res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ workspaces: dirs })); return
        }
        const base = path.join(root, ws)
        const files: { path: string; dir: boolean; size: number }[] = []
        const walk = (dir: string, rel: string, depth: number) => {
          if (depth > 6 || files.length > 2000) return
          let entries: string[] = []
          try { entries = fs.readdirSync(dir) } catch { return }
          for (const name of entries.sort()) {
            if (SKIP.has(name) || name.startsWith('.')) continue
            const abs = path.join(dir, name), r = rel ? `${rel}/${name}` : name
            let st: fs.Stats; try { st = fs.statSync(abs) } catch { continue }
            files.push({ path: r, dir: st.isDirectory(), size: st.size })
            if (st.isDirectory()) walk(abs, r, depth + 1)
          }
        }
        if (fs.existsSync(base)) walk(base, '', 0)
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ws, files }))
      } catch { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'list_failed', files: [] })) }
    })()
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/workspace/read') {
    void (async () => {
      setCORSHeaders(res)
      const ws = (url.searchParams.get('ws') ?? '').replace(/[^a-zA-Z0-9._-]/g, '_')
      const rel = (url.searchParams.get('path') ?? '').replace(/^\/+/, '')
      const base = path.join(os.homedir(), '.noetica', 'workspaces', ws)
      const target = path.resolve(base, rel)
      if (!target.startsWith(base + path.sep)) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'bad_path' })); return }
      try {
        const st = fs.statSync(target)
        if (st.size > 1024 * 1024) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ content: `(file too large: ${st.size} bytes)`, truncated: true })); return }
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ content: fs.readFileSync(target, 'utf8') }))
      } catch { res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'not_found' })) }
    })()
    return
  }

  // ── Speech-to-text (whisper.cpp, on-device, cross-platform) ──────────────────
  if (req.method === 'GET' && url.pathname === '/api/stt/status') {
    void (async () => {
      const { isSttAvailable } = await import('./lib/stt.js')
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ available: isSttAvailable() }))
    })()
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/stt') {
    let body = ''
    req.on('data', (c: Buffer) => { body += c.toString() })
    req.on('end', () => { void (async () => {
      let p: { audio_b64?: string } = {}
      try { p = JSON.parse(body) } catch { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid_json' })); return }
      const b64 = String(p.audio_b64 ?? '').split(',').pop() ?? ''
      if (!b64) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'no_audio' })); return }
      // Unpredictable name + owner-only perms → no temp-file pre-creation/symlink attack.
      const tmp = path.join(os.tmpdir(), `noetica-stt-${crypto.randomUUID()}.webm`)
      try { fs.writeFileSync(tmp, Buffer.from(b64, 'base64'), { mode: 0o600 }) } catch { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'write_failed' })); return }
      const { transcribe } = await import('./lib/stt.js')
      const r = await transcribe(tmp)
      try { fs.unlinkSync(tmp) } catch { /* */ }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(r))
    })() })
    return
  }

  // ── Registry — the catalogue (charts/templates/connectors), queryable by intent ──
  if (req.method === 'GET' && url.pathname === '/api/registry') {
    void (async () => {
      setCORSHeaders(res)
      try {
        const { queryRegistry } = await import('./lib/registry.js')
        const kindParam = url.searchParams.get('kind')
        const entries = queryRegistry({
          kind: (kindParam as 'chart' | 'template' | 'connector' | 'asset' | 'crawl') || undefined,
          q: url.searchParams.get('q') ?? undefined,
          domain: url.searchParams.get('domain') ?? undefined,
          limit: Number(url.searchParams.get('limit') ?? 12),
        })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ entries }))
      } catch {
        res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'registry_unavailable', entries: [] }))
      }
    })()
    return
  }

  // ── Voice cloning (local XTTS-v2 sidecar) ──────────────────────────────────
  if (url.pathname.startsWith('/api/voice/')) {
    const sub = url.pathname.slice('/api/voice/'.length)
    if (req.method === 'GET' && sub === 'status') {
      ;(async () => {
        const provisioned = isVoiceProvisioned()
        let voices: Array<{ id: string; name: string }> = []
        if (provisioned && (await ensureVoiceSidecar())) {
          try { const j = (await (await voiceFetch('/voices')).json()) as { voices?: typeof voices }; voices = j.voices ?? [] } catch { /* sidecar warming */ }
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ provisioned, voices }))
      })()
      return
    }
    let body = ''
    req.on('data', (c: Buffer) => { body += c.toString() })
    req.on('end', () => {
      ;(async () => {
        if (!(await ensureVoiceSidecar())) {
          res.writeHead(503, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'voice_not_provisioned', hint: 'run scripts/provision-voice.sh' })); return
        }
        try {
          if (req.method === 'POST' && sub === 'clone') {
            const r = await voiceFetch('/clone', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
            res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(Buffer.from(await r.arrayBuffer())); return
          }
          if (req.method === 'POST' && sub === 'tts') {
            const r = await voiceFetch('/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
            if (!r.ok) { res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(Buffer.from(await r.arrayBuffer())); return }
            res.writeHead(200, { 'content-type': 'audio/wav', 'cache-control': 'no-store' }); res.end(Buffer.from(await r.arrayBuffer())); return
          }
          res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'not_found' }))
        } catch (e) {
          res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'internal_error' }))
        }
      })()
    })
    return
  }

  // 404
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: 'not_found', path: url.pathname }))
})

// ── Learning-state persistence ─────────────────────────────────────────────────
// The bandit/self-model, quality-SR corpus, and contradiction ledger are
// in-memory; persist them to HellGraph so the system COMPOUNDS across restarts
// instead of relearning every morning. Stored as JSON blobs on LearningState nodes.
const LEARN_CAPABILITIES = 'urn:noetica:learning:capabilities'
const LEARN_QUALITY      = 'urn:noetica:learning:quality'
const LEARN_CONTRA       = 'urn:noetica:learning:contradictions'
const LEARN_TREND        = 'urn:noetica:learning:trend-history'

// Long-horizon compounding history: one snapshot per day (avg worth + symbolic
// structure growth), persisted so the trend spans weeks/months — not just the
// 500-sample quality ring. This is the real "is it getting better over time" record.
interface TrendSnapshot { date: string; ts: string; avg_worth: number; samples: number; derived_edges: number; total_edges: number }
const TREND_HISTORY_MAX = 730 // ~2 years of daily points
const _trendHistory: TrendSnapshot[] = []

/** Total + PLN-derived edge counts from the live graph. */
function graphEdgeStats(): { total: number; derived: number; byClass: Record<string, number> } {
  const edges = getHellGraph().allEdges()
  const byClass: Record<string, number> = {}
  for (const e of edges) {
    const c = String(e.properties?.['epistemicClass'] ?? 'unknown')
    byClass[c] = (byClass[c] ?? 0) + 1
  }
  const derived = (byClass['pln_deduction'] ?? 0) + (byClass['pln_revision'] ?? 0) + (byClass['pln_abduction'] ?? 0)
  return { total: edges.length, derived, byClass }
}

/** Capture (or refresh today's) compounding snapshot. Idempotent within a calendar day. */
function recordTrendSnapshot(): void {
  try {
    const samples = qualitySamples()
    const avg_worth = samples.length ? Number((samples.reduce((a, s) => a + s.worth, 0) / samples.length).toFixed(3)) : 0
    const { total, derived } = graphEdgeStats()
    const date = new Date().toISOString().slice(0, 10)
    const snap: TrendSnapshot = { date, ts: new Date().toISOString(), avg_worth, samples: samples.length, derived_edges: derived, total_edges: total }
    const last = _trendHistory[_trendHistory.length - 1]
    if (last && last.date === date) _trendHistory[_trendHistory.length - 1] = snap // one point per day
    else _trendHistory.push(snap)
    if (_trendHistory.length > TREND_HISTORY_MAX) _trendHistory.shift()
  } catch { /* best-effort */ }
}
// Bump when a persisted blob's shape changes incompatibly. On mismatch we SKIP
// hydration (rebuild fresh) rather than mis-parse old data into new structures.
const LEARN_SCHEMA_VERSION = 1

// Read a LearningState blob only if its schema_version matches; else skip safely.
function readLearnBlob(id: string): string | null {
  const node = getHellGraph().getNode(id)
  if (!node) return null
  const v = Number(node.properties['schema_version'] ?? 0)
  if (v !== LEARN_SCHEMA_VERSION) {
    console.warn(`[learning] ${id}: schema v${v} != v${LEARN_SCHEMA_VERSION} — skipping (will rebuild)`)
    return null
  }
  const data = node.properties['data']
  return data ? String(data) : null
}

function loadLearningState(): void {
  try {
    const cap = readLearnBlob(LEARN_CAPABILITIES)
    if (cap) console.log(`[learning] restored ${hydrateCapabilities(cap)} capability rows`)
    const q = readLearnBlob(LEARN_QUALITY)
    if (q) console.log(`[learning] restored ${hydrateQuality(q)} quality samples`)
    const c = readLearnBlob(LEARN_CONTRA)
    if (c) {
      try {
        const arr = JSON.parse(c) as ContradictionRecord[]
        _contradictions.push(...arr.slice(-CONTRADICTION_RING_SIZE))
        console.log(`[learning] restored ${_contradictions.length} contradictions`)
      } catch { /* skip */ }
    }
    const th = readLearnBlob(LEARN_TREND)
    if (th) {
      try {
        const arr = JSON.parse(th) as TrendSnapshot[]
        _trendHistory.push(...arr.slice(-TREND_HISTORY_MAX))
        console.log(`[learning] restored ${_trendHistory.length} trend snapshots`)
      } catch { /* skip */ }
    }
  } catch (e) { console.warn('[learning] load failed', e instanceof Error ? e.message : String(e)) }
}

function saveLearningState(): void {
  try {
    const g = getHellGraph()
    const now = new Date().toISOString()
    const meta = { schema_version: LEARN_SCHEMA_VERSION, updated_at: now }
    g.addNode(LEARN_CAPABILITIES, ['LearningState'], { ...meta, data: serializeCapabilities() })
    g.addNode(LEARN_QUALITY,      ['LearningState'], { ...meta, data: serializeQuality() })
    g.addNode(LEARN_CONTRA,       ['LearningState'], { ...meta, data: JSON.stringify(_contradictions) })
    g.addNode(LEARN_TREND,        ['LearningState'], { ...meta, data: JSON.stringify(_trendHistory) })
  } catch (e) { console.warn('[learning] save failed', e instanceof Error ? e.message : String(e)) }
}

// Reclaim our own port from a stale predecessor — a prior agent-machine orphaned by an
// app crash before its watchdog fired. The app owns this port, so anything still on it is
// a leftover; killing it lets a fast relaunch bind cleanly instead of EADDRINUSE-exiting.
try {
  const out = cp.execFileSync('/usr/sbin/lsof', ['-ti', `TCP:${PORT}`, '-sTCP:LISTEN'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  for (const pid of out.trim().split('\n').filter(Boolean)) {
    if (Number(pid) !== process.pid) { try { process.kill(Number(pid), 'SIGKILL') } catch { /* already gone */ } }
  }
} catch { /* nothing listening — the normal case */ }

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[noetica-am] Agent Machine v${VERSION} listening on http://127.0.0.1:${PORT}`)
  console.log(`[noetica-am] Status: http://127.0.0.1:${PORT}/api/status`)

  // ── Graceful teardown ────────────────────────────────────────────────────
  // ONE handler, registered synchronously, that tears down the managed Ollama BEFORE
  // persisting state and exiting. Previously two SIGTERM handlers raced — the one that
  // called process.exit(0) ran first and stopped the event loop before the kill,
  // orphaning `ollama serve` (which then piled up on every launch).
  let managedRuntime: { child: { kill: (sig?: NodeJS.Signals | number) => boolean } } | null = null
  let booted = false
  let teardownStarted = false
  const teardown = () => {
    if (teardownStarted) return
    teardownStarted = true
    try { managedRuntime?.child.kill('SIGKILL') } catch { /* already gone */ }
    // `ollama serve`'s llama-server runner children do NOT die with it on SIGKILL — reap
    // the app-owned ones explicitly so they don't orphan and hold GPU/RAM.
    try { cp.execFileSync('/usr/bin/pkill', ['-9', '-f', `${process.env['HOME'] ?? ''}/.noetica/runtime/llama-server`], { stdio: 'ignore' }) } catch { /* none running */ }
    // Reap our own embed sidecar so it doesn't orphan.
    try { cp.execFileSync('/usr/bin/pkill', ['-9', '-f', 'noetica-embed'], { stdio: 'ignore' }) } catch { /* none running */ }
    // Reap any dev servers started by the scaffold/build flow.
    for (const pid of _devServers) { try { process.kill(pid, 'SIGKILL') } catch { /* gone */ } }
    if (booted) { try { recordTrendSnapshot(); saveLearningState() } catch { /* best-effort */ } }
    process.exit(0)
  }
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, teardown)

  // Parent-death watchdog: the app can die in ways that send us NO signal — a crash, a
  // force-quit, or a quit whose exit signal never reaches us. We can't use our own ppid
  // (bun-compiled sidecars reparent to launchd immediately), so the app passes its PID and
  // we poll its existence: process.kill(pid, 0) throws once it's gone → tear down. This is
  // the reliable teardown path that stops orphaned agent-machine + Ollama piling up.
  const parentPid = Number(process.env['NOETICA_PARENT_PID'] || '0')
  if (parentPid > 1) {
    setInterval(() => { try { process.kill(parentPid, 0) } catch { teardown() } }, 1500).unref()
  }

  // ── Managed model runtime (macOS T2) ────────────────────────────────────
  // Own the model plane: ensure a COMPLETE, sandboxed Ollama on the isolated port
  // so the shipped app works without a host Ollama and regardless of the bundled
  // sidecar. Skipped when OLLAMA_HOST points elsewhere (dev override) or disabled.
  void (async () => {
    try {
      const { ensureManagedRuntime, shouldManageRuntime } = await import('./lib/managed-runtime.js')
      if (shouldManageRuntime(process.env)) {
        const rt = await ensureManagedRuntime()
        if (rt) managedRuntime = rt   // teardown() (registered above) SIGKILLs it on exit
      }
    } catch (e) { console.warn('[managed-runtime] init error (non-fatal):', e instanceof Error ? e.message : e) }
  })()

  // ── AtomSpace backend selection + StorageNode federation ─────────────────
  // Backend precedence: RocksDB (HELLGRAPH_BACKEND=rocksdb — the convergence
  // store, aligned to OpenCog's atomspace-rocks so Noetica + hellgraph-service +
  // future services share one on-disk model) → SQLite (bun) → JSONL WAL (default).
  // Learning state is loaded AFTER the backend is attached, so it hydrates from
  // the durable store rather than the about-to-be-replaced default.
  const finishBoot = () => {
    loadLearningState()
    booted = true // teardown() may now persist learning state on exit
    recordTrendSnapshot() // capture/refresh today's point on boot
    // Embed-model preflight: document RAG depends on the embedding model. Warn loudly
    // if it's missing so semantic retrieval doesn't silently degrade to lexical-only.
    void (async () => {
      try {
        const { EMBED_MODEL } = await import('./lib/ollama.js')
        const models = await listLocalModels()
        if (models.length > 0 && !models.some((m) => m.startsWith(EMBED_MODEL))) {
          console.warn(`[rag] embedding model "${EMBED_MODEL}" not installed — document search will use lexical fallback. Run: ollama pull ${EMBED_MODEL}`)
        }
      } catch { /* best-effort */ }
    })()
    // Self-model: keep the agent's knowledge of its own construction fresh so it
    // can explain how it works from fact. Deferred + best-effort so it never
    // blocks boot; disable with NOETICA_SELF_MODEL=0.
    if (process.env['NOETICA_SELF_MODEL'] !== '0') {
      setTimeout(() => { void (async () => {
        try {
          const { ingestSelfModel } = await import('./lib/self-model.js')
          const r = await ingestSelfModel()
          console.log(`[self-model] ingested ${r.reposIngested} construction repos (${r.chunksEmbedded} chunks, ${r.atoms} atoms)`)
        } catch { /* best-effort */ }
      })() }, 8000)
    }
    // Report the hardware-selected isolation tier (informational; provisioning is PM3).
    void (async () => {
      try {
        const { profileHost, selectIsolationTier } = await import('./lib/host-profile.js')
        const sel = selectIsolationTier(await profileHost())
        console.log(`[isolation] recommended tier: ${sel.tier} via ${sel.provider} (gpu: ${sel.gpu}) — ${sel.rationale}`)
      } catch { /* best-effort */ }
    })()
    setInterval(saveLearningState, 60_000).unref()
    setInterval(recordTrendSnapshot, 6 * 60 * 60_000).unref() // refresh today's snapshot every 6h
    // SIGINT/SIGTERM teardown is registered once, synchronously, at the top of the
    // listen callback (kills the managed Ollama before persisting + exiting).
  }

  void (async () => {
    const space = getAtomSpace()
    try {
      if (process.env['HELLGRAPH_BACKEND'] === 'rocksdb') {
        const baseDir = process.env['HELLGRAPH_STORE_DIR'] || path.join(os.homedir(), '.noetica', 'hellgraph')
        const rocks = await attachRocksDB(space, baseDir)
        if (rocks) {
          console.log(`[atomspace] RocksDB backend active (${getHellGraph().nodeCount()} nodes) — ${rocks.storagePath()}`)
          registerStorageNodeRoutes(space)
          console.log(`[atomspace] StorageNode federation API ready at /api/atomspace/*`)
          finishBoot()
          return
        }
        console.warn('[atomspace] RocksDB requested but binding unavailable — falling back')
      }
      const sqliteBackend = createSQLiteBackend()
      if (sqliteBackend) {
        const migrated = migrateJSONLToSQLite(sqliteBackend)
        if (migrated > 0) console.log(`[atomspace] Migrated ${migrated} JSONL entries → SQLite`)
        space.setBackend(sqliteBackend)
        console.log(`[atomspace] SQLite backend active (${sqliteBackend.atomCount()} atoms) — ${sqliteBackend.storagePath()}`)
        registerStorageNodeRoutes(space)
        console.log(`[atomspace] StorageNode federation API ready at /api/atomspace/*`)
      } else {
        registerStorageNodeRoutes(space)
        console.log(`[atomspace] JSONL backend (bun:sqlite unavailable) — ${space.storagePath}`)
      }
    } catch (e) {
      console.warn('[atomspace] Backend init error (non-fatal):', e)
      try { registerStorageNodeRoutes(space) } catch { /* ignore */ }
    }
    finishBoot()
  })()

  // Auto-start memoryd (memory-mesh runtime) if not already running.
  // memoryd provides durable local memory storage for the three-tier recall adapter.
  void (async () => {
    const memorydUrl = process.env['MEMORYD_URL'] ?? 'http://127.0.0.1:8787'
    try {
      const h = await fetch(`${memorydUrl}/healthz`, { signal: AbortSignal.timeout(1500) })
      if (h.ok) {
        console.log(`[noetica-am] memoryd already running at ${memorydUrl}`)
        return
      }
    } catch { /* not running — try to start */ }
    const memorydDir = path.join(path.dirname(process.argv[1] ?? __filename), '..', 'memory-mesh', 'services', 'memoryd')
    const python = process.env['HELLGRAPH_PYTHON'] ?? 'python3'
    if (fs.existsSync(memorydDir)) {
      try {
        const proc = cp.spawn(python, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8787', '--log-level', 'warning'], {
          cwd: memorydDir,
          detached: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, MEMORYD_STORE: 'sqlite', MEMORYD_DB_PATH: path.join(os.homedir(), '.noetica', 'memoryd.db') },
        })
        proc.stderr?.on('data', (d: Buffer) => {
          const line = d.toString().trim()
          if (line && !line.includes('INFO')) console.warn(`[memoryd] ${line}`)
        })
        await new Promise(r => setTimeout(r, 2500))
        const h2 = await fetch(`${memorydUrl}/healthz`, { signal: AbortSignal.timeout(1500) }).catch(() => null)
        if (h2?.ok) console.log('[noetica-am] memoryd started (SQLite, local-first)')
        else console.warn('[noetica-am] memoryd started but not responding — memory-mesh Tier 1 will degrade to Tier 2/3')
      } catch (e) {
        console.warn('[noetica-am] Could not start memoryd:', e)
      }
    }
  })()

  // Auto-start prometheusd (Prometheus SR daemon) if not already running.
  // prometheusd accumulates attention time-series across sessions and discovers
  // the governing decay equations for HellGraph's ECAN dynamics.
  void (async () => {
    const prometheusdUrl = process.env['PROMETHEUSD_URL'] ?? 'http://127.0.0.1:8890'
    try {
      const h = await fetch(`${prometheusdUrl}/healthz`, { signal: AbortSignal.timeout(1500) })
      if (h.ok) {
        const status = await h.json() as { store?: { attention_snapshots?: number; sr_candidates?: number } }
        console.log(`[noetica-am] prometheusd already running (snapshots:${status.store?.attention_snapshots ?? '?'} candidates:${status.store?.sr_candidates ?? '?'})`)
        return
      }
    } catch { /* not running — try to start */ }
    const prometheusdDir = path.join(path.dirname(process.argv[1] ?? __filename), '..', 'prometheusd')
    const python = process.env['HELLGRAPH_PYTHON'] ?? 'python3'
    if (fs.existsSync(prometheusdDir)) {
      try {
        const proc = cp.spawn(python, ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8890', '--log-level', 'warning'], {
          cwd: prometheusdDir,
          detached: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            AGENT_MACHINE_URL: `http://127.0.0.1:${PORT}`,
            PROMETHEUSD_DB: path.join(os.homedir(), '.noetica', 'prometheusd.db'),
          },
        })
        proc.on('error', (e: Error) => console.warn('[noetica-am] prometheusd spawn error (python3 required):', e.message))
        proc.stderr?.on('data', (d: Buffer) => {
          const line = d.toString().trim()
          if (line && !line.includes('INFO')) console.warn(`[prometheusd] ${line}`)
        })
        await new Promise(r => setTimeout(r, 2500))
        const h2 = await fetch(`${prometheusdUrl}/healthz`, { signal: AbortSignal.timeout(1500) }).catch(() => null)
        if (h2?.ok) console.log('[noetica-am] prometheusd started (local SR daemon, SINDy collective history)')
        else console.warn('[noetica-am] prometheusd started but not responding — Prometheus SR will use sidecar fallback')
      } catch (e) {
        console.warn('[noetica-am] Could not start prometheusd:', e)
      }
    }
  })()

  // Auto-start the HellGraph OpenCog sidecar if not already running.
  void (async () => {
    const health = await sidecarHealth()
    if (!health) {
      const sidecarDir = path.join(path.dirname(process.argv[1] ?? __filename), '..', 'opencog-sidecar')
      const python = process.env['HELLGRAPH_PYTHON'] ?? 'python3'
      try {
        const proc = cp.spawn(python, ['-m', 'uvicorn', 'server:app', '--host', '127.0.0.1', '--port', '8137', '--log-level', 'warning'], {
          cwd: sidecarDir,
          detached: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        proc.on('error', (e: Error) => console.warn('[noetica-am] OpenCog sidecar spawn error (python3 required):', e.message))
        proc.stderr?.on('data', (d: Buffer) => {
          const line = d.toString().trim()
          if (line && !line.includes('INFO')) console.warn(`[sidecar] ${line}`)
        })
        // Give it 3s to boot, then sync HellGraph atoms into it
        await new Promise(r => setTimeout(r, 3000))
        const h2 = await sidecarHealth()
        if (h2) {
          console.log(`[noetica-am] HellGraph sidecar ready (atoms: ${h2.atom_count}, opencog: ${h2.available})`)
          syncToSidecar().catch(() => {/* first sync best-effort */})
        } else {
          console.warn('[noetica-am] Sidecar started but not responding — OpenCog features will degrade gracefully')
        }
      } catch (e) {
        console.warn('[noetica-am] Could not start sidecar (Python/uvicorn required):', e)
      }
    } else {
      console.log(`[noetica-am] HellGraph sidecar already running (atoms: ${health.atom_count})`)
      syncToSidecar().catch(() => {/* best-effort */})
    }
  })()

  // Memory consolidation sleep pass: temporal decay, MERGE_PROPOSAL promotion, deep PLN,
  // VLTI promotion. Runs at boot and every 6 hours — never blocks the server.
  let _consolidationRunning = false
  function runConsolidation(): void {
    if (_consolidationRunning) {
      console.warn('[noetica-am] Consolidation already running — skipping this interval')
      return
    }
    _consolidationRunning = true
    try {
      const cr = consolidate()
      console.log(
        `[noetica-am] Consolidation complete in ${cr.durationMs}ms — ` +
        `decayed:${cr.decayedTruthValues} merged:${cr.mergedProposals} ` +
        `pln:${cr.plnDerived}+${cr.plnRevised}rev+${cr.plnAbduced}abd vlti:${cr.vltiPromoted}`
      )
    } catch (e) {
      console.warn('[noetica-am] Consolidation error (non-fatal):', e)
    } finally {
      _consolidationRunning = false
    }
  }
  void (async () => { runConsolidation() })()
  // Re-run every 6 hours for continuous memory hygiene
  setInterval(runConsolidation, 6 * 60 * 60 * 1000).unref()

  // GAIA superconscious loop auto-start from env.
  // Set NOETICA_GAIA_AUTO_LOOP=1 to start automatically on boot.
  // Prefers ANTHROPIC_API_KEY / OPENAI_API_KEY; falls back to a local Ollama model
  // so belief synthesis runs fully offline (the loop itself picks the backend).
  if (process.env['NOETICA_GAIA_AUTO_LOOP'] === '1') {
    const loopKeys: { anthropic?: string; openai?: string } = {}
    if (process.env['ANTHROPIC_API_KEY']?.trim()) loopKeys.anthropic = process.env['ANTHROPIC_API_KEY']!.trim()
    if (process.env['OPENAI_API_KEY']?.trim())    loopKeys.openai    = process.env['OPENAI_API_KEY']!.trim()
    void (async () => {
      const localReady = await isOllamaRunning()
      if (loopKeys.anthropic || loopKeys.openai || localReady) {
        startSuperconsciousLoop(loopKeys)
        const backend = loopKeys.anthropic || loopKeys.openai ? 'cloud' : 'local Ollama'
        console.log(`[noetica-am] GAIA superconscious loop auto-started (${backend})`)
      } else {
        console.warn('[noetica-am] NOETICA_GAIA_AUTO_LOOP=1 but no cloud key and Ollama not running — loop not started')
      }
    })()
  }

  // ECAN session-boundary decay: STI values accumulated in prior sessions fade on boot.
  // This makes "working memory" actually behave like working memory — recent mentions
  // surface, stale ones fade. VLTI atoms are exempt (see ecan.ts floor logic).
  const decayed = decayAll()
  if (decayed > 0) console.log(`[noetica-am] ECAN: decayed STI on ${decayed} atoms`)
  // Gentle intra-session decay every 30 min so long sessions don't freeze attention.
  // Each tick also records an attention snapshot for the Prometheus SR corpus —
  // this is what makes prometheusd collective: it accumulates data across every session.
  setInterval(() => {
    decayAll(0.92)
    recordAttentionSnapshot()
    const g = getGraph()
    const atoms = g.allNodes().filter((n: { labels: string[] }) => n.labels.includes('FeatureAtom'))
    if (atoms.length > 0) {
      const avgSTI = atoms.reduce((s: number, a: { properties: Record<string, unknown> }) => s + Number(a.properties['ecan:sti'] ?? 0), 0) / atoms.length
      pushSnapshotToPrometheusd(Date.now(), avgSTI, atoms.length).catch(() => {})
    }
  }, 30 * 60 * 1000).unref()

  // Background model warm-up: pull the full prophet-mesh model suite in priority order.
  // dolphin3:8b (uncensored, security profile) is opt-in — excluded from auto-pull.
  // Runs silently after startup — never blocks the server.
  void (async () => {
    try {
      const up = await isOllamaRunning()
      if (!up) return
      const installed = await listLocalModels()
      const OPT_IN_ONLY = new Set(['dolphin3:8b', 'huihui_ai/foundation-sec-abliterated:8b', 'jimscard/whiterabbit-neo:13b'])
      const suite = LOCAL_MODEL_SUITE
        .filter((m) => !OPT_IN_ONLY.has(m.name))    // uncensored/security models are opt-in
        .sort((a, b) => a.priority - b.priority)    // pull in priority order

      // Clients that connect after some models are already installed need to know immediately.
      for (const entry of suite) {
        const base = entry.name.split(':')[0]!
        const alreadyPresent = installed.some((m) => m === entry.name || m.startsWith(base))
        if (alreadyPresent) {
          broadcastModelProgress({ model: entry.name, status: 'ready', pct: 100, role: entry.role, sizeGb: entry.sizeGb })
        }
      }

      for (const entry of suite) {
        const base = entry.name.split(':')[0]!
        const present = installed.some((m) => m === entry.name || m.startsWith(base))
        if (!present) {
          console.log(`[noetica-am] Auto-pulling ${entry.name} (${entry.sizeGb}GB, ${entry.role})…`)
          broadcastModelProgress({ model: entry.name, status: 'starting', pct: 0, role: entry.role, sizeGb: entry.sizeGb })
          await pullModel(entry.name, (status, pct) => {
            if (pct !== null && pct % 20 === 0) console.log(`[noetica-am]   ${entry.name} ${pct}%`)
            else if (!pct) console.log(`[noetica-am]   ${entry.name}: ${status}`)
            broadcastModelProgress({ model: entry.name, status: 'pulling', pct: pct ?? 0, role: entry.role, sizeGb: entry.sizeGb })
          })
          console.log(`[noetica-am] ${entry.name} ready.`)
          broadcastModelProgress({ model: entry.name, status: 'ready', pct: 100, role: entry.role, sizeGb: entry.sizeGb })
        }
      }
      console.log('[noetica-am] Prophet-mesh model suite ready.')
      broadcastModelProgress({ type: 'suite_ready' })
    } catch (e) {
      console.warn('[noetica-am] Model warm-up error:', e)
    }
  })()

  // Demo pre-warm: actually LOAD the primary chat model(s) into RAM with a long
  // keep_alive so the first query isn't a cold-load stall (Ollama otherwise loads
  // on first use — 5–60s for an 8B — and unloads after 5 min idle). Best-effort,
  // non-blocking. Configure with NOETICA_PREWARM_MODELS="qwen2.5:7b,deepseek-r1:8b".
  void (async () => {
    const wanted = (process.env['NOETICA_PREWARM_MODELS'] ?? 'qwen2.5:7b').split(',').map((s) => s.trim()).filter(Boolean)
    try {
      const installed = await listLocalModels()
      for (const m of wanted) {
        const base = m.split(':')[0]!
        if (!installed.some((x) => x === m || x.startsWith(base))) continue
        try {
          await fetch(`${ollamaBase()}/api/generate`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: m, prompt: 'ok', stream: false, keep_alive: '30m' }),
            signal: AbortSignal.timeout(120_000),
          })
          console.log(`[prewarm] loaded ${m} into RAM (keep_alive 30m)`)
        } catch { /* best-effort */ }
      }
      // Prewarm the Tier-0 embedding intent centroids so the first turn doesn't pay
      // the one-time build (≈110 exemplar embeds).
      if (isFlagOn('NOETICA_EMBED_INTENT')) {
        try {
          const { buildCentroids } = await import('./lib/intent-embed.js')
          await buildCentroids()
          console.log('[prewarm] intent embedding centroids built')
        } catch { /* best-effort */ }
      }
      // Durable cleanup: re-run the cheap, idempotent hygiene pass on boot, but ONLY when the graph
      // changed since the last run (incremental — node-count gated). Marks persist via the WAL, so
      // pruned junk, merged duplicates, and verb/path noise never creep back across launches.
      try {
        const g0 = getGraph()
        const stateFile = path.join(os.homedir(), '.noetica', 'cache', 'hygiene-state.json')
        const count = g0.allNodes().length
        let last = -1
        try { last = JSON.parse(fs.readFileSync(stateFile, 'utf8')).count } catch { /* first run */ }
        if (count !== last) {
          const hn = g0.allNodes().map((n) => ({ id: n.id, label: cleanLabel(n) ?? (n.labels[0] ?? n.id), labelType: n.labels[0] ?? '', degree: 0 }))
          const edges = g0.allEdges().map((e) => ({ from: e.from, to: e.to }))
          const report = buildReport(hn, edges, TAXONOMY_WORDS)
          const gx = g0 as unknown as { setNodeProperty: (i: string, k: string, v: unknown) => void; addEdge: (t: string, f: string, to: string, p?: Record<string, unknown>) => void }
          let pruned = 0, merged = 0, attached = 0
          for (const id of report.prunable) { try { gx.setNodeProperty(id, 'hygiene_pruned', true); pruned++ } catch { /* */ } }
          for (const m of report.mergeActions) { try { gx.setNodeProperty(m.id, 'hygiene_pruned', true); gx.setNodeProperty(m.id, 'hygiene_merged_into', m.into); merged++ } catch { /* */ } }
          for (const a of report.attachActions) { try { gx.addEdge('HYGIENE_ATTACH', a.id, a.to, {}); attached++ } catch { /* */ } }
          try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify({ count })) } catch { /* */ }
          console.log(`[prewarm] hygiene applied: pruned ${pruned}, merged ${merged}, attached ${attached}`)
        }
      } catch { /* best-effort */ }

      // Prewarm the graph topic clustering so the Graph panel shows clean topics instantly on
      // first open, instead of serving the raw degree-rank fallback while embeddings warm.
      try {
        const { clusterSurface } = await import('./lib/graph-cluster.js')
        const g = getGraph()
        for (const [view, category] of [['tech', 'technical'], ['knowledge', 'learning']] as const) {
          await clusterSurface(g.allNodes(), g.allEdges(), { view, category }).catch(() => {})
        }
        console.log('[prewarm] graph topic clusters built')
      } catch { /* best-effort */ }
      // Upgrade the coder to the RAM-appropriate model (14b on ≥18GB, 30b on ≥30GB) by pulling
      // it once in the background — non-blocking, only sizes that fit, so no OOM. Until it lands
      // the router stays on 7b; once present, coding routes to the stronger model automatically.
      try {
        const { preferredCoderForRam } = await import('./lib/router.js')
        const want = preferredCoderForRam()
        if (want && process.env['NOETICA_NO_AUTO_CODER'] !== '1') {
          const have = await listLocalModels()
          if (!have.includes(want)) {
            console.log(`[prewarm] pulling upgraded coder ${want} in background (one-time)…`)
            void pullModel(want, () => {}).then(() => console.log(`[prewarm] coder ${want} ready — coding now routes to it`)).catch(() => {})
          }
        }
      } catch { /* best-effort */ }
    } catch { /* ignore */ }
  })()
})

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[noetica-am] Port ${PORT} is already in use. Set NOETICA_AM_PORT to use a different port.`)
  } else {
    console.error(`[noetica-am] Server error:`, err)
  }
  process.exit(1)
})
