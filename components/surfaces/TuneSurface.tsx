'use client'

import { useState } from 'react'
import { models } from '@/config/models'
import { sendNoeticaChat } from '@/lib/client/noeticaTransport'
import { useSettings } from '@/lib/settings/context'
import { isTauri } from '@/lib/tauri/bridge'
import { VoiceTrainer } from '@/components/voice/VoiceTrainer'
import type { ChatMessage } from '@/lib/types/message'

function tuneUrl(path: string): string {
  return isTauri() ? `http://127.0.0.1:8080${path}` : path
}

type RunStatus = 'idle' | 'running' | 'done'
type PreferenceLabel = 'preferred' | 'rejected' | null

type DistillJobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

interface DistillJob {
  id: string
  status: DistillJobStatus
  step: number
  total_steps: number
  loss: number | null
  error: string | null
  adapter_path: string | null
  log: string[]
}

interface ComparisonRun {
  id: string
  prompt: string
  teacherResponse: string
  studentResponse: string
  preference: PreferenceLabel
  teacherModel: string
  studentModel: string
  createdAt: string
}

function runModelPromise(
  modelId: string,
  prompt: string,
  providerKeys: Record<string, string | undefined>,
  thinkingBudget?: number
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let text = ''
    const msgs: ChatMessage[] = [{ id: 'u', role: 'user', content: prompt, created_at: new Date().toISOString() }]
    sendNoeticaChat(
      { session_id: `tune:${crypto.randomUUID()}`, mode: 'standalone', model_id: modelId, messages: msgs, memory_scope: 'noetica-tune', provider_keys: providerKeys, thinking_budget: thinkingBudget },
      {
        onMeta: () => {},
        onDelta: (delta) => { text += delta },
        onThinkingDelta: () => {},
        onDone: (result) => resolve(result.content || text || '(empty response)'),
        onError: (err) => reject(new Error(err)),
      }
    ).catch(reject)
  })
}

const whiteboxModels = models.filter((m) => m.local_capable)

export function TuneSurface({ thinkingBudget }: { thinkingBudget?: number }) {
  const { settings } = useSettings()
  const [teacherModelId, setTeacherModelId] = useState(models[0]?.id ?? '')
  const [studentModelId, setStudentModelId] = useState(whiteboxModels[0]?.id ?? '')
  const [prompt, setPrompt] = useState('')
  const [runStatus, setRunStatus] = useState<RunStatus>('idle')
  const [runs, setRuns] = useState<ComparisonRun[]>([])
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [exportStatus, setExportStatus] = useState<'idle' | 'done'>('idle')
  const [distillJob, setDistillJob] = useState<DistillJob | null>(null)
  const [distillSendStatus, setDistillSendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [distillTrainStatus, setDistillTrainStatus] = useState<'idle' | 'starting' | 'polling' | 'done' | 'error'>('idle')
  const [distillTeacherType, setDistillTeacherType] = useState<'blackbox' | 'whitebox'>('blackbox')
  const [distillLoraR, setDistillLoraR] = useState(8)
  const [distillMaxSteps, setDistillMaxSteps] = useState(100)
  const [cacheStatus, setCacheStatus] = useState<'idle' | 'loading-model' | 'caching' | 'done' | 'error'>('idle')
  const [cacheStats, setCacheStats] = useState<{ total: number; withLogits: number } | null>(null)

  const activeRun = runs.find((r) => r.id === activeRunId) ?? runs[0] ?? null

  const [cacheError, setCacheError] = useState<string | null>(null)

  async function handleCacheTeacherLogits() {
    const labelled = runs.filter((r) => r.preference !== null)
    if (labelled.length === 0) return
    setCacheStatus('loading-model')
    setCacheStats(null)
    setCacheError(null)
    let loadData: { ok?: boolean; error?: string }
    try {
      const loadRes = await fetch(tuneUrl('/api/tune/teacher-cache'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'load', model_id: studentModelId }),
      })
      loadData = await loadRes.json() as { ok?: boolean; error?: string }
    } catch (e) {
      setCacheStatus('error')
      setCacheError(e instanceof Error ? e.message : 'Network error — distillation server unreachable')
      return
    }
    if (!loadData.ok) {
      setCacheStatus('error')
      setCacheError(loadData.error ?? 'Failed to load teacher model')
      return
    }
    setCacheStatus('caching')
    const pairs = labelled.map((r) => ({
      prompt: r.prompt,
      chosen: r.preference === 'preferred' ? r.teacherResponse : r.studentResponse,
      rejected: r.preference === 'preferred' ? r.studentResponse : r.teacherResponse,
      teacher_model: r.teacherModel,
      student_model: r.studentModel,
    }))
    const cacheRes = await fetch(tuneUrl('/api/tune/teacher-cache'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'cache', pairs }),
    })
    const cacheData = await cacheRes.json() as { ok?: boolean; annotated?: unknown[]; with_logits?: number; total?: number; error?: string }
    if (!cacheData.ok) { setCacheError(cacheData.error ?? 'Teacher-logit caching failed — is the distillation server running?'); setCacheStatus('error'); return }
    // Submit annotated pairs (with logits) to distill server — check the result, else we'd report success
    // while the pairs silently vanished (false "done" → lost training data).
    const distillRes = await fetch(tuneUrl('/api/tune/distill'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'pairs', pairs: cacheData.annotated ?? [] }),
    }).catch(() => null)
    if (!distillRes || !distillRes.ok) { setCacheError('Cached teacher logits, but submitting the pairs to the distill server failed — they were not saved.'); setCacheStatus('error'); return }
    setCacheStats({ total: cacheData.total ?? 0, withLogits: cacheData.with_logits ?? 0 })
    setCacheStatus('done')
    setDistillTeacherType('whitebox')
  }

  async function handleSendToDistill() {
    const labelled = runs.filter((r) => r.preference !== null)
    if (labelled.length === 0) return
    setDistillSendStatus('sending')
    const pairs = labelled.map((r) => ({
      prompt: r.prompt,
      chosen: r.preference === 'preferred' ? r.teacherResponse : r.studentResponse,
      rejected: r.preference === 'preferred' ? r.studentResponse : r.teacherResponse,
      teacher_model: r.teacherModel,
      student_model: r.studentModel,
    }))
    try {
      const res = await fetch(tuneUrl('/api/tune/distill'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'pairs', pairs }),
      })
      if (res.ok) {
        setDistillSendStatus('sent')
        setTimeout(() => setDistillSendStatus('idle'), 2500)
      } else {
        setDistillSendStatus('error')
      }
    } catch {
      setDistillSendStatus('error')
    }
  }

  async function handleStartTraining() {
    if (distillTrainStatus === 'polling') return
    setDistillTrainStatus('starting')
    try {
      const res = await fetch(tuneUrl('/api/tune/distill'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          op: 'train',
          student_model_id: studentModelId,
          teacher_type: distillTeacherType,
          lora_r: distillLoraR,
          max_steps: distillMaxSteps,
        }),
      })
      const data = await res.json() as { ok?: boolean; job_id?: string; error?: string }
      if (!data.ok || !data.job_id) {
        setDistillTrainStatus('error')
        return
      }
      setDistillTrainStatus('polling')
      const jobId = data.job_id
      const poll = async () => {
        const r = await fetch(tuneUrl(`/api/tune/distill?job_id=${encodeURIComponent(jobId)}`))
        const job = await r.json() as DistillJob
        setDistillJob(job)
        if (job.status === 'running' || job.status === 'queued') {
          setTimeout(() => void poll(), 1500)
        } else {
          setDistillTrainStatus(job.status === 'done' ? 'done' : 'error')
        }
      }
      void poll()
    } catch {
      setDistillTrainStatus('error')
    }
  }

  async function handleRun() {
    if (!prompt.trim() || runStatus === 'running') return
    setRunStatus('running')
    const id = crypto.randomUUID()
    const placeholder: ComparisonRun = {
      id, prompt: prompt.trim(),
      teacherResponse: '…', studentResponse: '…',
      preference: null,
      teacherModel: teacherModelId, studentModel: studentModelId,
      createdAt: new Date().toISOString(),
    }
    setRuns((prev) => [placeholder, ...prev])
    setActiveRunId(id)
    setPrompt('')

    const providerKeys = {
      anthropic:   settings.anthropicApiKey   || undefined,
      openai:      settings.openaiApiKey      || undefined,
      google:      settings.googleApiKey      || undefined,
      mistral:     settings.mistralApiKey     || undefined,
      neuronpedia: settings.neuronpediaApiKey || undefined,
      openrouter:  settings.openrouterApiKey  || undefined,
      huggingface: settings.huggingfaceApiKey || undefined,
    }

    try {
      const [teacherText, studentText] = await Promise.all([
        runModelPromise(teacherModelId, placeholder.prompt, providerKeys, thinkingBudget),
        runModelPromise(studentModelId, placeholder.prompt, providerKeys, thinkingBudget),
      ])
      setRuns((prev) => prev.map((r) => r.id === id
        ? { ...r, teacherResponse: teacherText, studentResponse: studentText }
        : r
      ))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error fetching response.'
      setRuns((prev) => prev.map((r) => r.id === id
        ? { ...r, teacherResponse: msg, studentResponse: msg }
        : r
      ))
    } finally {
      setRunStatus('done')
    }
  }

  function markPreference(runId: string, label: PreferenceLabel) {
    setRuns((prev) => prev.map((r) => r.id === runId ? { ...r, preference: label } : r))
  }

  function exportDPO() {
    const labelled = runs.filter((r) => r.preference !== null)
    if (labelled.length === 0) return
    const lines = labelled.map((r) => {
      const chosen = r.preference === 'preferred' ? r.teacherResponse : r.studentResponse
      const rejected = r.preference === 'preferred' ? r.studentResponse : r.teacherResponse
      return JSON.stringify({
        prompt: r.prompt,
        chosen: [{ role: 'assistant', content: chosen }],
        rejected: [{ role: 'assistant', content: rejected }],
        teacher_model: r.teacherModel,
        student_model: r.studentModel,
      })
    }).join('\n')
    const blob = new Blob([lines], { type: 'application/jsonl' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `dpo_${Date.now()}.jsonl`
    a.click()
    URL.revokeObjectURL(url)
    setExportStatus('done')
    setTimeout(() => setExportStatus('idle'), 2000)
  }

  const labelledCount = runs.filter((r) => r.preference !== null).length

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Tune & Train</h2>
            <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Run comparative prompts between models, mark preferences, export DPO training data.</p>
          </div>
          {labelledCount > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => void handleCacheTeacherLogits()}
                disabled={cacheStatus === 'loading-model' || cacheStatus === 'caching'}
                title="Run teacher model to extract logits for whitebox KD"
                className="flex items-center gap-2 rounded-full bg-[#0f766e] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#0d9488] disabled:opacity-50"
              >
                {cacheStatus === 'loading-model' ? 'Loading model…' : cacheStatus === 'caching' ? 'Caching…' : cacheStatus === 'error' ? 'Failed' : cacheStatus === 'done' ? `Logits cached (${cacheStats?.withLogits ?? 0}/${cacheStats?.total ?? 0})` : 'Cache teacher logits'}
              </button>
              {cacheStatus === 'error' && cacheError && (
                <p className="text-[11px] text-[#ef4444]">{cacheError}</p>
              )}
              <button
                onClick={() => void handleSendToDistill()}
                disabled={distillSendStatus === 'sending'}
                className="flex items-center gap-2 rounded-full bg-[#7c3aed] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#6d28d9] disabled:opacity-50"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M6 1v7M3 6l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                  <circle cx="6" cy="10" r="1.5" fill="currentColor"/>
                </svg>
                {distillSendStatus === 'sending' ? 'Sending…' : distillSendStatus === 'sent' ? 'Sent to KD Server' : distillSendStatus === 'error' ? 'Send failed' : `Send ${labelledCount} pair${labelledCount !== 1 ? 's' : ''} to KD`}
              </button>
              <button
                onClick={exportDPO}
                className="flex items-center gap-2 rounded-full bg-[#1d4ed8] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#1e40af]"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M6 1v7M3 6l3 3 3-3M1 10h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                {exportStatus === 'done' ? 'Saved!' : `Export ${labelledCount} JSONL`}
              </button>
            </div>
          )}
        </div>

        {/* Model pair config */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-[#1d4ed8]">Teacher</span>
            <select
              value={teacherModelId}
              onChange={(e) => setTeacherModelId(e.target.value)}
              className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] outline-none"
            >
              {models.map((m) => <option key={m.id} value={m.id}>{m.label}{m.local_capable ? ' (open)' : ''}</option>)}
            </select>
            <span className="text-[11px] text-[var(--color-text-tertiary)]">blackbox or open-weight</span>
          </div>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="mt-2 self-center text-[var(--color-text-tertiary)]">
            <path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-[#7c3aed]">Student</span>
            {whiteboxModels.length === 0 ? (
              <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-2.5 py-1.5 text-xs text-[#dc2626]">
                No open-weight models available
              </div>
            ) : (
              <select
                value={studentModelId}
                onChange={(e) => setStudentModelId(e.target.value)}
                className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] outline-none"
              >
                {whiteboxModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            )}
            <span className="text-[11px] text-[var(--color-text-tertiary)]">open-weight only — weights needed for fine-tuning</span>
          </div>
        </div>
        {whiteboxModels.length === 0 && (
          <p className="mt-2 text-[11px] text-[#dc2626]">
            DPO fine-tuning requires an open-weight student model (Llama, Gemma, GPT-2…). Add one via Agent Machine or Neuronpedia to enable distillation.
          </p>
        )}

        {/* Prompt input */}
        <div className="mt-3 flex gap-2">
          <textarea
            className="min-h-[60px] flex-1 resize-none rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
            placeholder="Enter a prompt to run on both models…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleRun() }}
          />
          <button
            onClick={() => void handleRun()}
            disabled={!prompt.trim() || runStatus === 'running' || whiteboxModels.length === 0}
            className="self-end rounded-full bg-[#1d4ed8] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1e40af] disabled:opacity-50"
          >
            {runStatus === 'running' ? 'Running…' : 'Run'}
          </button>
        </div>

        {/* KD Training panel */}
        <div className="mt-3 rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-4 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-[var(--color-text-tertiary)]">Teacher type</span>
              <select
                value={distillTeacherType}
                onChange={(e) => setDistillTeacherType(e.target.value as 'blackbox' | 'whitebox')}
                className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] outline-none"
              >
                <option value="blackbox">Blackbox → Whitebox (behavioral cloning)</option>
                <option value="whitebox">Whitebox → Whitebox (KD loss + logits)</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-[var(--color-text-tertiary)]">LoRA rank</span>
              <input
                type="number" min={1} max={64} value={distillLoraR}
                onChange={(e) => setDistillLoraR(parseInt(e.target.value) || 8)}
                className="w-16 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-[var(--color-text-tertiary)]">Max steps</span>
              <input
                type="number" min={1} max={10000} value={distillMaxSteps}
                onChange={(e) => setDistillMaxSteps(parseInt(e.target.value) || 100)}
                className="w-20 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] outline-none"
              />
            </div>
            <button
              onClick={() => void handleStartTraining()}
              disabled={distillTrainStatus === 'polling' || distillTrainStatus === 'starting' || whiteboxModels.length === 0}
              className="rounded-full bg-[#7c3aed] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#6d28d9] disabled:opacity-50"
            >
              {distillTrainStatus === 'starting' ? 'Starting…' : distillTrainStatus === 'polling' ? 'Training…' : distillTrainStatus === 'done' ? 'Done' : 'Start KD Training'}
            </button>
          </div>

          {/* Training progress */}
          {distillJob && (
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${distillJob.status === 'running' ? 'animate-pulse bg-[#7c3aed]' : distillJob.status === 'done' ? 'bg-[var(--color-accent)]' : distillJob.status === 'error' ? 'bg-[#ef4444]' : 'bg-[#d1d5db]'}`} />
                <span className="text-xs font-medium text-[var(--color-text-primary)]">
                  {distillJob.status === 'running' || distillJob.status === 'queued'
                    ? `Step ${distillJob.step}/${distillJob.total_steps}${distillJob.loss !== null ? ` — loss ${distillJob.loss.toFixed(4)}` : ''}`
                    : distillJob.status === 'done'
                    ? `Training complete — ${distillJob.total_steps} steps`
                    : distillJob.status === 'error'
                    ? `Error: ${distillJob.error}`
                    : distillJob.status}
                </span>
              </div>
              {distillJob.total_steps > 0 && (
                <div className="h-1 w-full rounded-full bg-[var(--color-background-secondary)]">
                  <div
                    className="h-1 rounded-full bg-[#7c3aed] transition-all"
                    style={{ width: `${Math.min(100, (distillJob.step / distillJob.total_steps) * 100)}%` }}
                  />
                </div>
              )}
              {distillJob.adapter_path && (
                <p className="text-[11px] text-[var(--color-text-tertiary)]">Adapter saved: {distillJob.adapter_path}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Body — run list + detail */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Run list */}
        {runs.length > 0 && (
          <div className="w-56 shrink-0 overflow-y-auto border-r border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] py-2">
            {runs.map((r) => (
              <button
                key={r.id}
                onClick={() => setActiveRunId(r.id)}
                className={`flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition ${
                  r.id === activeRunId ? 'bg-[rgba(29,78,216,0.15)]' : 'hover:bg-[var(--color-background-primary)]'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {r.preference === 'preferred' && <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />}
                  {r.preference === 'rejected' && <span className="h-1.5 w-1.5 rounded-full bg-[#ef4444]" />}
                  {r.preference === null && <span className="h-1.5 w-1.5 rounded-full bg-[#d1d5db]" />}
                  <span className="truncate text-xs font-medium text-[var(--color-text-primary)]">{r.prompt.slice(0, 40)}</span>
                </div>
                <span className="pl-3 text-[11px] text-[var(--color-text-tertiary)]">{new Date(r.createdAt).toLocaleTimeString()}</span>
              </button>
            ))}
          </div>
        )}

        {/* Detail pane */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto mb-4 max-w-4xl">
            <VoiceTrainer />
          </div>
          {!activeRun && (
            <div className="flex h-full items-center justify-center text-sm text-[var(--color-text-tertiary)]">
              Run a prompt to compare model responses.
            </div>
          )}
          {activeRun && (
            <div className="mx-auto max-w-4xl space-y-4">
              <p className="text-xs font-semibold text-[var(--color-text-secondary)]">Prompt</p>
              <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-4 py-3 text-sm text-[var(--color-text-primary)]">
                {activeRun.prompt}
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Teacher */}
                <div className={`rounded-2xl border bg-[var(--color-background-primary)] p-4 space-y-2 ${activeRun.preference === 'preferred' ? 'border-[#86efac] ring-1 ring-[var(--color-accent)]/30' : 'border-[#bfdbfe]'}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-[#1d4ed8]">Teacher — {models.find((m) => m.id === activeRun.teacherModel)?.label ?? activeRun.teacherModel}</span>
                    <button
                      onClick={() => markPreference(activeRun.id, activeRun.preference === 'preferred' ? null : 'preferred')}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                        activeRun.preference === 'preferred'
                          ? 'bg-[var(--color-accent)] text-white'
                          : 'border border-[#d1d5db] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]'
                      }`}
                    >
                      {activeRun.preference === 'preferred' ? '✓ Preferred' : 'Prefer'}
                    </button>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--color-text-primary)]">{activeRun.teacherResponse}</p>
                </div>

                {/* Student */}
                <div className={`rounded-2xl border bg-[var(--color-background-primary)] p-4 space-y-2 ${activeRun.preference === 'rejected' ? 'border-[#fca5a5] ring-1 ring-[#ef4444]/30' : 'border-[#ddd6fe]'}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-[#7c3aed]">Student — {models.find((m) => m.id === activeRun.studentModel)?.label ?? activeRun.studentModel}</span>
                    <button
                      onClick={() => markPreference(activeRun.id, activeRun.preference === 'rejected' ? null : 'rejected')}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                        activeRun.preference === 'rejected'
                          ? 'bg-[#ef4444] text-white'
                          : 'border border-[#d1d5db] text-[var(--color-text-secondary)] hover:border-[#fca5a5] hover:text-[#dc2626]'
                      }`}
                    >
                      {activeRun.preference === 'rejected' ? '✗ Rejected' : 'Reject'}
                    </button>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--color-text-primary)]">{activeRun.studentResponse}</p>
                </div>
              </div>

              {activeRun.preference === null && (
                <p className="text-center text-xs text-[var(--color-text-tertiary)]">Mark the teacher response as &ldquo;Prefer&rdquo; to add this pair to the DPO export.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
