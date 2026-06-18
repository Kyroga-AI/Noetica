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
import { createSQLiteBackend, migrateJSONLToSQLite } from './lib/sqlite-backend.js'
import { registerStorageNodeRoutes, handleStorageNodeRequest } from './lib/storage-node-routes.js'
import { handleMeshRushRequest } from './lib/meshrush-bridge.js'
import { handleCairnPathRequest } from './lib/cairnpath-adapter.js'
import { syncToSidecar, sidecarHealth } from '../lib/hellgraph/sidecar.js'
import { getAtomSpace } from '../lib/hellgraph/atomspace.js'
import { decayAll } from '../lib/hellgraph/ecan.js'
import { consolidate } from '../lib/hellgraph/consolidate.js'
import { recordAttentionSnapshot, pushSnapshotToPrometheusd, ingestPrometheusCandidate } from '../lib/hellgraph/prometheus.js'
import { isOllamaRunning, listLocalModels, pullModel, streamOllama, getModelContextLength } from './lib/ollama.js'
import { retrieve } from './lib/retrieval.js'
import { getGraph, graphHealth, graphSparql, ingestInteraction, ingestConversation, ingestMessage } from './lib/graph.js'
import { getHellGraph } from '../lib/hellgraph/store.js'
import { runGremlin } from '../lib/hellgraph/gremlin.js'
import { buildWorkspacePrefix, invalidatePrefix } from './lib/context-cache.js'
import {
  ensureMichaelTwin, ingestGaiaObservation, getRecentObservations,
  writeBeliefSnapshot, writeWorldStateSnapshot, writeCycleNode,
  getTwinState, getRecentBeliefs, getRecentLaws, getRecentWorldStates,
  type GaiaObservationPayload, type BeliefSynthesis,
} from './lib/gaia.js'

const PORT = parseInt(process.env['NOETICA_AM_PORT'] ?? '8080', 10)
const VERSION = '0.4.10'

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
  task?: string
  session_id?: string
  error?: string   // set on failed runs — enables error-rate visibility in GovernSurface
}
const _governanceRuns: GovernanceRun[] = []
const GOVERNANCE_RING_SIZE = 100

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

async function runSuperconsciousLoop(keys: LoopProviderKeys): Promise<void> {
  if (!keys.anthropic?.trim() && !keys.openai?.trim()) {
    console.error('[gaia] runSuperconsciousLoop: no valid API keys — synthesis disabled')
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
  tools?: ProviderTool[]
  thinking_budget?: number
  temperature?: number
  max_tokens?: number
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

  switch (name) {
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

  // DuckDuckGo Instant Answer API (no key required)
  try {
    const url = new URL('https://api.duckduckgo.com/')
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'json')
    url.searchParams.set('no_html', '1')
    url.searchParams.set('skip_disambig', '1')

    const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } })
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

  return `No results found for: "${query}"`
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
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
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
  const keys = body.provider_keys ?? {}
  const anthropicKey = keys.anthropic?.trim() || process.env['ANTHROPIC_API_KEY'] || ''
  const openaiKey = keys.openai?.trim() || process.env['OPENAI_API_KEY'] || ''

  // ── Prophet-mesh conductor routing ──────────────────────────────────────────
  const ollamaUp = await isOllamaRunning()
  const availableModels = ollamaUp ? await listLocalModels() : []
  const latestUserContent = [...(body.messages ?? [])]
    .filter((m) => m.role === 'user').at(-1)?.content ?? ''

  // Detect whether any user message carries image attachments (→ vision routing)
  const hasImages = (body.messages ?? []).some(
    (m) => m.role === 'user' && m.attachments?.some((a) => a.kind === 'image'),
  )

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
      hasImages,
      hasTools: (body.tools?.length ?? 0) > 0,
    })
  } catch (err) {
    sse(res, 'error', { error: err instanceof Error ? err.message : String(err) })
    return
  }

  const { resolvedModel: model, resolvedProvider: provider, ...routerDecision } = routing
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
  const allTools: ProviderTool[] = modelSupportsTools
    ? BUILTIN_TOOLS.filter((t) => t.name !== 'generate_image' || imageGenAvailable)
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

  const MAX_TURNS = 10
  let fullContent = ''
  let lastToolCalls: ToolUseBlock[] | undefined

  // ── HellGraph retrieval ──────────────────────────────────────────────────────
  // Run multi-pattern retrieval against the metagraph and inject relevant
  // context into the system prompt before the LLM call. For Ollama requests
  // the cache-augmented prefix is stable across a session so the KV cache
  // warms after the first turn and subsequent turns are faster.
  const sessionId = body.session_id ?? run_id

  // Always include beliefs to connect the digital twin to every chat turn.
  // Ollama gets the cache-augmented prefix too (stable KV cache warm-up).
  const patterns: Array<'beliefs' | 'graph' | 'temporal' | 'sparql' | 'cache-augmented'> =
    provider === 'ollama'
      ? ['beliefs', 'cache-augmented', 'graph', 'temporal']
      : ['beliefs', 'graph', 'temporal']

  let graphContext = ''
  try {
    const retrieved = await retrieve(latestUserContent, {
      patterns,
      sessionId,
      conversationId: body.conversation_id,
      maxTokens: provider === 'ollama' ? 1200 : 900,
    })
    if (retrieved.text.trim()) {
      graphContext = `\n\n---\n**Memory context (HellGraph)**\n${retrieved.text}`
    }
  } catch { /* retrieval is best-effort — never block the LLM call */ }

  const profile = POLICY_PROFILES[body.policy_profile ?? 'default'] ?? POLICY_PROFILES['default']!
  const basePrompt = body.system_prompt ?? NOETICA_SYSTEM_PROMPT
  // Inject current datetime so the model always has accurate temporal context
  const nowUtc = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
  const dateLine = `\n\nCurrent date/time: ${nowUtc}`
  const enrichedSystemPrompt = basePrompt + dateLine + graphContext + profile.authorizationSuffix

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
  const reqMaxTokens = typeof body.max_tokens === 'number' && body.max_tokens > 0
    ? Math.min(Math.floor(body.max_tokens), 16_000) : undefined
  function estimateTokens(s: string): number { return Math.ceil(s.length / 4) }
  let systemTokens = estimateTokens(enrichedSystemPrompt)
  let msgTokens = incomingMessages.reduce((s, m) => s + estimateTokens(String(m.content ?? '')), 0)
  // Trim oldest user+assistant pairs if over budget
  while (systemTokens + msgTokens > TOKEN_BUDGET && incomingMessages.length > 2) {
    const removed = incomingMessages.shift()
    msgTokens -= estimateTokens(String(removed?.content ?? ''))
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

      for (let turn = 0; turn < MAX_TURNS; turn++) {
        let turnContent = ''
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
            sse(res, 'delta', { delta: event.text })
          } else if (event.type === 'thinking') {
            sse(res, 'thinking_delta', { delta: event.text })
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

        ollamaMessages.push({
          role: 'assistant',
          content: turnContent || null,
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
            sse(res, 'delta', { delta: event.text })
          } else if (event.type === 'thinking') {
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

    recordGovernanceRun({
      run_id,
      model_routed: model,
      provider,
      policy_admitted: true,
      memory_written: false,
      timestamp,
      latency_ms: latencyMs,
      task: routerDecision.task,
      session_id: sessionId,
    })

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
        agent_machine: true,
        agent_machine_version: VERSION,
      },
    })

    // ── Auto-ingest into HellGraph (fire-and-forget) ──────────────────────────
    // Index this interaction so future retrieval can surface it. The promptHash
    // is used for deduplication in the WAL. invalidatePrefix forces a fresh
    // cache-augmented prefix on the next turn (new graph state).
    void (async () => {
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
        trackIngest(ingestEntities(run_id, sessionId, fullText, new Date().toISOString()))
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
          sse(res, 'progress', { model, status: 'error', pct: null, done: true, error: String(e) })
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
        res.end(JSON.stringify({ error: String(err) }))
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
        res.end(JSON.stringify({ error: String(err) }))
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
        res.end(JSON.stringify({ error: 'Sidecar unavailable', detail: String(err) }))
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
          res.end(JSON.stringify({ error: String(err) }))
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
          res.end(JSON.stringify({ error: String(err) }))
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
        res.end(JSON.stringify({ error: String(err) }))
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
        res.end(JSON.stringify({ error: String(err) }))
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
        res.end(JSON.stringify({ error: String(err) }))
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
        res.end(JSON.stringify({ error: String(err) }))
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
          res.end(JSON.stringify({ error: String(err) }))
        }
      })()
    })
    return
  }

  // POST /api/ingest/document
  // Accepts { content: string, filename: string, mimeType?: string }
  // Chunks, stores as RECORD nodes in HellGraph, returns chunk count + preview.
  if (req.method === 'POST' && url.pathname === '/api/ingest/document') {
    setCORSHeaders(res)
    let body = ''
    req.on('data', (c: Buffer) => { body += c.toString() })
    req.on('end', () => {
      ;(async () => {
        try {
          const { content, filename, mimeType } = JSON.parse(body) as {
            content: string
            filename: string
            mimeType?: string
          }
          if (!content || typeof content !== 'string') throw new Error('content required')
          const { ingestDocumentChunks } = await import('./lib/graph.js')
          const result = await ingestDocumentChunks(content, filename, mimeType ?? 'text/plain')
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify(result))
        } catch (err) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: String(err) }))
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
            sse(res, 'error', { error: err instanceof Error ? err.message : String(err) })
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
          res.writeHead(502); res.end(JSON.stringify({ error: String(err) }))
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

  // 404
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: 'not_found', path: url.pathname }))
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[noetica-am] Agent Machine v${VERSION} listening on http://127.0.0.1:${PORT}`)
  console.log(`[noetica-am] Status: http://127.0.0.1:${PORT}/api/status`)

  // ── AtomSpace SQLite backend + StorageNode federation ────────────────────
  // Upgrades the default JSONL WAL to SQLite (O(log n) lookups, atomic writes,
  // WAL-mode concurrent reads, crash recovery). Migrates JSONL on first run.
  // The StorageNode HTTP API (/api/atomspace/*) is always active — the SSE
  // change feed enables real-time sync with remote nodes.
  void (async () => {
    try {
      const sqliteBackend = createSQLiteBackend()
      if (sqliteBackend) {
        const migrated = migrateJSONLToSQLite(sqliteBackend)
        if (migrated > 0) {
          console.log(`[atomspace] Migrated ${migrated} JSONL entries → SQLite`)
        }
        const space = getAtomSpace()
        space.setBackend(sqliteBackend)
        console.log(`[atomspace] SQLite backend active (${sqliteBackend.atomCount()} atoms) — ${sqliteBackend.storagePath()}`)
        registerStorageNodeRoutes(space)
        console.log(`[atomspace] StorageNode federation API ready at /api/atomspace/*`)
      } else {
        const space = getAtomSpace()
        registerStorageNodeRoutes(space)
        console.log(`[atomspace] JSONL backend (bun:sqlite unavailable) — ${space.storagePath}`)
      }
    } catch (e) {
      console.warn('[atomspace] Backend init error (non-fatal):', e)
      try { registerStorageNodeRoutes(getAtomSpace()) } catch { /* ignore */ }
    }
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
  // The loop uses ANTHROPIC_API_KEY or OPENAI_API_KEY from env.
  if (process.env['NOETICA_GAIA_AUTO_LOOP'] === '1') {
    const loopKeys: { anthropic?: string; openai?: string } = {}
    if (process.env['ANTHROPIC_API_KEY']?.trim()) loopKeys.anthropic = process.env['ANTHROPIC_API_KEY']!.trim()
    if (process.env['OPENAI_API_KEY']?.trim())    loopKeys.openai    = process.env['OPENAI_API_KEY']!.trim()
    if (loopKeys.anthropic || loopKeys.openai) {
      startSuperconsciousLoop(loopKeys)
      console.log('[noetica-am] GAIA superconscious loop auto-started (NOETICA_GAIA_AUTO_LOOP=1)')
    } else {
      console.warn('[noetica-am] NOETICA_GAIA_AUTO_LOOP=1 but no ANTHROPIC_API_KEY or OPENAI_API_KEY found — loop not started')
    }
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
      const suite = LOCAL_MODEL_SUITE
        .filter((m) => m.name !== 'dolphin3:8b')   // opt-in only
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
})

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[noetica-am] Port ${PORT} is already in use. Set NOETICA_AM_PORT to use a different port.`)
  } else {
    console.error(`[noetica-am] Server error:`, err)
  }
  process.exit(1)
})
