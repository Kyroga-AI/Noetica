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

interface LabelledPair {
  runId: string
  prompt: string
  chosenModel: string
  preference: PreferenceLabel
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
  const [savedPairs, setSavedPairs] = useState<LabelledPair[]>([])

  const activeRun = runs.find((r) => r.id === activeRunId) ?? null

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

  function savePair(run: ComparisonRun) {
    if (run.preference === null) return
    if (savedPairs.some((p) => p.runId === run.id)) return
    const chosenModel = run.preference === 'preferred' ? run.teacherModel : run.studentModel
    setSavedPairs((prev) => [...prev, {
      runId: run.id,
      prompt: run.prompt,
      chosenModel,
      preference: run.preference,
    }])
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
      {/* Topbar — slim 50px */}
      <div className="flex h-[50px] shrink-0 items-center gap-3 border-b border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-6">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[14px] font-extrabold text-[var(--color-text-primary)]">Tune & Train</h2>
          <p className="text-[11px] text-[var(--color-text-tertiary)]">Run comparisons, mark preferences, export DPO data or distil in-app</p>
        </div>
        {labelledCount > 0 && (
          <span className="ml-auto rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--accent)]">
            {labelledCount} pair{labelledCount !== 1 ? 's' : ''} labelled
          </span>
        )}
      </div>

      {/* Body — 2 columns */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* LEFT COLUMN — 480px: model config, prompt, response cards */}
        <div className="w-[480px] shrink-0 overflow-y-auto border-r border-[var(--color-border-tertiary)] px-5 py-4">
          {/* Model pair config — sunken row */}
          <div className="flex items-center gap-3 rounded-[14px] bg-[var(--color-background-secondary)] px-4 py-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-[9.5px] font-bold uppercase tracking-wider text-[var(--color-text-tertiary)]">Teacher</span>
              <select
                value={teacherModelId}
                onChange={(e) => setTeacherModelId(e.target.value)}
                className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] outline-none"
              >
                {models.map((m) => <option key={m.id} value={m.id}>{m.label}{m.local_capable ? ' (open)' : ''}</option>)}
              </select>
            </div>
            <span className="mt-4 text-sm text-[var(--color-text-tertiary)]">&rarr;</span>
            <div className="flex flex-col gap-1.5">
              <span className="text-[9.5px] font-bold uppercase tracking-wider text-[var(--color-text-tertiary)]">Student</span>
              {whiteboxModels.length === 0 ? (
                <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-2.5 py-1.5 text-xs text-[#dc2626]">
                  No open-weight models available
                </div>
              ) : (
                <select
                  value={studentModelId}
                  onChange={(e) => setStudentModelId(e.target.value)}
                  className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] outline-none"
                >
                  {whiteboxModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              )}
            </div>
          </div>

          {whiteboxModels.length === 0 && (
            <p className="mt-2 text-[11px] text-[#dc2626]">
              DPO fine-tuning requires an open-weight student model (Llama, Gemma, GPT-2…). Add one via Agent Machine or Neuronpedia to enable distillation.
            </p>
          )}

          {/* Prompt — textarea stacked above run button */}
          <div className="mt-4 flex flex-col gap-2">
            <textarea
              rows={3}
              className="w-full resize-none rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
              placeholder="Enter a prompt to run on both models…"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleRun() }}
            />
            <button
              onClick={() => void handleRun()}
              disabled={!prompt.trim() || runStatus === 'running' || whiteboxModels.length === 0}
              className="w-full rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
            >
              {runStatus === 'running' ? 'Running…' : 'Run'}
            </button>
          </div>

          {/* Response cards or empty/running states */}
          <div className="mt-5 space-y-4">
            {runStatus === 'idle' && !activeRun && (
              <div className="flex items-center justify-center py-12 text-sm text-[var(--color-text-tertiary)]">
                Enter a prompt above and run
              </div>
            )}

            {runStatus === 'running' && activeRun?.teacherResponse === '…' && (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--color-text-tertiary)]">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
                Running teacher & student in parallel…
              </div>
            )}

            {activeRun && !(runStatus === 'running' && activeRun.teacherResponse === '…') && (
              <>
                {/* Teacher response card — green themed */}
                <div className="rounded-2xl border border-[#86efac] bg-[#dcfce7] p-4">
                  <span className="text-[9.5px] font-bold uppercase tracking-wider text-[#16a34a]">
                    Teacher — {models.find((m) => m.id === activeRun.teacherModel)?.label ?? activeRun.teacherModel}
                  </span>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--color-text-primary)]">{activeRun.teacherResponse}</p>
                  <div className="mt-3 border-t border-[#86efac] pt-3">
                    <button
                      onClick={() => markPreference(activeRun.id, activeRun.preference === 'preferred' ? null : 'preferred')}
                      className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                        activeRun.preference === 'preferred'
                          ? 'bg-[#22c55e] text-white'
                          : 'border border-[#86efac] text-[#16a34a] hover:bg-[#bbf7d0]'
                      }`}
                    >
                      {activeRun.preference === 'preferred' ? 'Preferred' : 'Prefer'}
                    </button>
                  </div>
                </div>

                {/* Student response card — violet themed */}
                <div className="rounded-2xl border border-[#c4b5fd] bg-[#ede9fe] p-4">
                  <span className="text-[9.5px] font-bold uppercase tracking-wider text-[#7c3aed]">
                    Student — {models.find((m) => m.id === activeRun.studentModel)?.label ?? activeRun.studentModel}
                  </span>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--color-text-primary)]">{activeRun.studentResponse}</p>
                  <div className="mt-3 flex items-center gap-2 border-t border-[#c4b5fd] pt-3">
                    <button
                      onClick={() => markPreference(activeRun.id, activeRun.preference === 'rejected' ? null : 'rejected')}
                      className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                        activeRun.preference === 'rejected'
                          ? 'bg-[#7c3aed] text-white'
                          : 'border border-[#c4b5fd] text-[#7c3aed] hover:bg-[#ddd6fe]'
                      }`}
                    >
                      {activeRun.preference === 'rejected' ? 'Student preferred' : 'Prefer student'}
                    </button>
                    {activeRun.preference !== null && !savedPairs.some((p) => p.runId === activeRun.id) && (
                      <button
                        onClick={() => savePair(activeRun)}
                        className="rounded-full border border-[var(--color-border-secondary)] px-3 py-1 text-[11px] font-semibold text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-secondary)]"
                      >
                        Save pair
                      </button>
                    )}
                    {savedPairs.some((p) => p.runId === activeRun.id) && (
                      <span className="text-[11px] text-[#16a34a]">Saved</span>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN — flex:1: ledger, DPO export, KD training, voice */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Labelled pairs ledger — only show when pairs exist */}
          {savedPairs.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Labelled pairs</div>
              <div className="mt-2 max-h-[200px] space-y-1 overflow-y-auto">
                {savedPairs.map((p) => (
                  <div key={p.runId} className="flex items-center gap-2 rounded-lg bg-[var(--color-background-secondary)] px-3 py-2">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-[#22c55e]" />
                    <span className="flex-1 truncate text-xs text-[var(--color-text-primary)]">{p.prompt.slice(0, 60)}</span>
                    <span className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">
                      {models.find((m) => m.id === p.chosenModel)?.label ?? p.chosenModel}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* DPO Export card */}
          <div className="rounded-[14px] bg-[var(--color-background-secondary)] p-4">
            <div className="text-[13px] font-extrabold text-[var(--color-text-primary)]">Export DPO data</div>
            <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">
              Export labelled preference pairs as JSONL for DPO fine-tuning. Each line contains the prompt, chosen and rejected responses, and model metadata.
            </p>
            {labelledCount === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-[var(--color-border-secondary)] px-3 py-4 text-center text-[11px] text-[var(--color-text-tertiary)]">
                No labelled pairs yet — mark some preferences first.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                <button
                  onClick={exportDPO}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                    <path d="M6 1v7M3 6l3 3 3-3M1 10h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  {exportStatus === 'done' ? 'Saved!' : `Export ${labelledCount} pairs as JSONL`}
                </button>
                <button
                  onClick={() => void handleSendToDistill()}
                  disabled={distillSendStatus === 'sending'}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                    <path d="M6 1v7M3 6l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                    <circle cx="6" cy="10" r="1.5" fill="currentColor"/>
                  </svg>
                  {distillSendStatus === 'sending' ? 'Sending…' : distillSendStatus === 'sent' ? 'Sent to KD Server' : distillSendStatus === 'error' ? 'Send failed' : `Send to KD`}
                </button>
              </div>
            )}
          </div>

          {/* KD Training card */}
          <div className="rounded-[14px] border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4">
            <div className="text-[13px] font-extrabold text-[var(--color-text-primary)]">Train in-app — Knowledge Distillation</div>

            <div className="mt-3 flex flex-col gap-3">
              {/* Teacher type — radio cards */}
              <div className="flex gap-2">
                <button
                  onClick={() => setDistillTeacherType('blackbox')}
                  className={`flex-1 rounded-xl border-2 px-3 py-2.5 text-left text-xs transition ${
                    distillTeacherType === 'blackbox'
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                      : 'border-[var(--color-border-secondary)] hover:border-[var(--color-border-primary)]'
                  }`}
                >
                  <div className="font-semibold text-[var(--color-text-primary)]">Blackbox &rarr; Whitebox</div>
                  <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">Behavioral cloning</div>
                </button>
                <button
                  onClick={() => setDistillTeacherType('whitebox')}
                  className={`flex-1 rounded-xl border-2 px-3 py-2.5 text-left text-xs transition ${
                    distillTeacherType === 'whitebox'
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                      : 'border-[var(--color-border-secondary)] hover:border-[var(--color-border-primary)]'
                  }`}
                >
                  <div className="font-semibold text-[var(--color-text-primary)]">Whitebox &rarr; Whitebox</div>
                  <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">KD loss + logits</div>
                </button>
              </div>

              {/* LoRA rank — range slider */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-[var(--color-text-tertiary)]">LoRA rank</span>
                  <span className="font-mono text-[11px] text-[var(--color-text-primary)]">{distillLoraR}</span>
                </div>
                <input
                  type="range" min={1} max={64} value={distillLoraR}
                  onChange={(e) => setDistillLoraR(parseInt(e.target.value) || 8)}
                  className="w-full accent-[var(--accent)]"
                />
              </div>

              {/* Max steps — range slider */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-[var(--color-text-tertiary)]">Max steps</span>
                  <span className="font-mono text-[11px] text-[var(--color-text-primary)]">{distillMaxSteps}</span>
                </div>
                <input
                  type="range" min={10} max={10000} step={10} value={distillMaxSteps}
                  onChange={(e) => setDistillMaxSteps(parseInt(e.target.value) || 100)}
                  className="w-full accent-[var(--accent)]"
                />
              </div>

              {/* Cache teacher logits — only for whitebox */}
              {distillTeacherType === 'whitebox' && (
                <div>
                  <button
                    onClick={() => void handleCacheTeacherLogits()}
                    disabled={cacheStatus === 'loading-model' || cacheStatus === 'caching' || labelledCount === 0}
                    title="Run teacher model to extract logits for whitebox KD"
                    className="flex w-full items-center justify-center gap-2 rounded-full bg-[#0f766e] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#0d9488] disabled:opacity-50"
                  >
                    {cacheStatus === 'loading-model' ? 'Loading model…' : cacheStatus === 'caching' ? 'Caching…' : cacheStatus === 'error' ? 'Failed' : cacheStatus === 'done' ? `Logits cached (${cacheStats?.withLogits ?? 0}/${cacheStats?.total ?? 0})` : 'Cache teacher logits'}
                  </button>
                  {cacheStatus === 'error' && cacheError && (
                    <p className="mt-1 text-[10px] text-[#ef4444]">{cacheError}</p>
                  )}
                </div>
              )}

              <button
                onClick={() => void handleStartTraining()}
                disabled={distillTrainStatus === 'polling' || distillTrainStatus === 'starting' || whiteboxModels.length === 0}
                className="w-full rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
              >
                {distillTrainStatus === 'starting' ? 'Starting…' : distillTrainStatus === 'polling' ? 'Training…' : distillTrainStatus === 'done' ? 'Done' : 'Start KD Training'}
              </button>
            </div>

            {distillJob && (
              <div className="mt-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${distillJob.status === 'running' ? 'animate-pulse bg-[var(--accent)]' : distillJob.status === 'done' ? 'bg-[#22c55e]' : distillJob.status === 'error' ? 'bg-[#ef4444]' : 'bg-[#d1d5db]'}`} />
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
                      className="h-1 rounded-full bg-[var(--accent)] transition-all"
                      style={{ width: `${Math.min(100, (distillJob.step / distillJob.total_steps) * 100)}%` }}
                    />
                  </div>
                )}
                {distillJob.adapter_path && (
                  <p className="text-[10px] text-[var(--color-text-tertiary)]">Adapter saved: {distillJob.adapter_path}</p>
                )}
              </div>
            )}
          </div>

          {/* Voice Trainer */}
          <VoiceTrainer />
        </div>
      </div>
    </div>
  )
}
