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
  teacherLatency: number | null
  studentLatency: number | null
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
): Promise<{ text: string; latency: number }> {
  return new Promise<{ text: string; latency: number }>((resolve, reject) => {
    let text = ''
    const start = Date.now()
    const msgs: ChatMessage[] = [{ id: 'u', role: 'user', content: prompt, created_at: new Date().toISOString() }]
    sendNoeticaChat(
      { session_id: `tune:${crypto.randomUUID()}`, mode: 'standalone', model_id: modelId, messages: msgs, memory_scope: 'noetica-tune', provider_keys: providerKeys, thinking_budget: thinkingBudget },
      {
        onMeta: () => {},
        onDelta: (delta) => { text += delta },
        onThinkingDelta: () => {},
        onDone: (result) => resolve({ text: result.content || text || '(empty response)', latency: Date.now() - start }),
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
      teacherResponse: '...', studentResponse: '...',
      preference: null,
      teacherModel: teacherModelId, studentModel: studentModelId,
      teacherLatency: null, studentLatency: null,
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
      const [teacherResult, studentResult] = await Promise.all([
        runModelPromise(teacherModelId, placeholder.prompt, providerKeys, thinkingBudget),
        runModelPromise(studentModelId, placeholder.prompt, providerKeys, thinkingBudget),
      ])
      setRuns((prev) => prev.map((r) => r.id === id
        ? { ...r, teacherResponse: teacherResult.text, studentResponse: studentResult.text, teacherLatency: teacherResult.latency, studentLatency: studentResult.latency }
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

  const labelledCount = savedPairs.length

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* topbar */}
      <div style={{ height: 50, flexShrink: 0, borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', padding: '0 22px', gap: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)' }}>Tune &amp; Train</span>
        <span style={{ fontSize: 12, color: 'var(--ink3)' }}>Run comparisons, mark preferences, export DPO data or distil in-app</span>
        <div style={{ flex: 1 }} />
        {labelledCount > 0 && (
          <div style={{ padding: '6px 14px', borderRadius: 999, background: 'var(--verified-soft)', border: '1px solid var(--verified-line)', fontSize: 12, fontWeight: 700, color: 'var(--verified-fg)' }}>
            {labelledCount} labelled pair{labelledCount !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* body: left prompt area + right training panel */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>

        {/* LEFT: teacher/student + prompt + responses */}
        <div style={{ width: 480, flexShrink: 0, borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* model config */}
          <div style={{ flexShrink: 0, borderBottom: '1px solid var(--line)', background: 'var(--paper-sunk)', padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.6, color: 'var(--ink2)', textTransform: 'uppercase' as const, marginBottom: 5 }}>Teacher</div>
              <select
                value={teacherModelId}
                onChange={(e) => setTeacherModelId(e.target.value)}
                style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: '7px 10px', fontSize: 12.5, fontFamily: "'Manrope',sans-serif", color: 'var(--ink)', background: 'var(--paper)' }}
              >
                {models.map((m) => <option key={m.id} value={m.id}>{m.label}{m.local_capable ? ' (open)' : ''}</option>)}
              </select>
            </div>
            <div style={{ padding: '7px 10px', fontSize: 13, color: 'var(--ink3)' }}>&rarr;</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.6, color: 'var(--ink2)', textTransform: 'uppercase' as const, marginBottom: 5 }}>
                Student <span style={{ fontWeight: 400, color: 'var(--ink3)' }}>(open-weight only)</span>
              </div>
              {whiteboxModels.length === 0 ? (
                <div style={{ width: '100%', border: '1px solid var(--danger)', borderRadius: 8, padding: '7px 10px', fontSize: 12.5, color: 'var(--danger-fg)', background: 'var(--paper)' }}>
                  No open-weight models available
                </div>
              ) : (
                <select
                  value={studentModelId}
                  onChange={(e) => setStudentModelId(e.target.value)}
                  style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: '7px 10px', fontSize: 12.5, fontFamily: "'Manrope',sans-serif", color: 'var(--ink)', background: 'var(--paper)' }}
                >
                  {whiteboxModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              )}
            </div>
          </div>

          {whiteboxModels.length === 0 && (
            <p style={{ padding: '8px 16px', fontSize: 11, color: 'var(--danger-fg)' }}>
              DPO fine-tuning requires an open-weight student model (Llama, Gemma, GPT-2...). Add one via Agent Machine or Neuronpedia to enable distillation.
            </p>
          )}

          {/* prompt input */}
          <div style={{ flexShrink: 0, padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
            <textarea
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleRun() }}
              placeholder="Enter a prompt to run against both models simultaneously..."
              style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', fontSize: 13.5, fontFamily: "'Manrope',sans-serif", color: 'var(--ink)', background: 'var(--paper)', resize: 'vertical', lineHeight: 1.6, marginBottom: 10 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => void handleRun()}
                disabled={!prompt.trim() || runStatus === 'running' || whiteboxModels.length === 0}
                style={{ flex: 1, padding: '9px 0', borderRadius: 10, background: 'var(--accent)', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', textAlign: 'center' as const, border: 'none', opacity: (!prompt.trim() || runStatus === 'running' || whiteboxModels.length === 0) ? 0.5 : 1 }}
              >
                {runStatus === 'running' ? 'Running...' : 'Run'}
              </button>
            </div>
          </div>

          {/* responses */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

            {activeRun && !(runStatus === 'running' && activeRun.teacherResponse === '...') && (
              <>
                {/* teacher response */}
                <div style={{ borderRadius: 12, border: '1.5px solid var(--verified-line)', background: 'var(--verified-soft)', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--verified-fg)', textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>
                      Teacher &mdash; {models.find((m) => m.id === activeRun.teacherModel)?.label ?? activeRun.teacherModel}
                    </div>
                    {activeRun.teacherLatency !== null && (
                      <span className="font-mono" style={{ fontSize: 10, color: 'var(--ink3)' }}>{activeRun.teacherLatency}ms</span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{activeRun.teacherResponse}</div>
                  <div style={{ display: 'flex', gap: 6, paddingTop: 6, borderTop: '1px solid var(--verified-line)' }}>
                    <button
                      onClick={() => markPreference(activeRun.id, activeRun.preference === 'preferred' ? null : 'preferred')}
                      style={activeRun.preference === 'preferred'
                        ? { padding: '5px 12px', borderRadius: 999, background: 'var(--verified)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none' }
                        : { padding: '5px 12px', borderRadius: 999, border: '1px solid var(--verified-line)', color: 'var(--verified-fg)', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'transparent' }
                      }
                    >
                      {activeRun.preference === 'preferred' ? '✓ Preferred' : 'Prefer'}
                    </button>
                  </div>
                </div>

                {/* student response */}
                <div style={{ borderRadius: 12, border: '1.5px solid var(--violet-line)', background: 'var(--violet-soft)', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--violet-fg)', textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>
                      Student &mdash; {models.find((m) => m.id === activeRun.studentModel)?.label ?? activeRun.studentModel}
                    </div>
                    {activeRun.studentLatency !== null && (
                      <span className="font-mono" style={{ fontSize: 10, color: 'var(--ink3)' }}>{activeRun.studentLatency}ms</span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{activeRun.studentResponse}</div>
                  <div style={{ display: 'flex', gap: 6, paddingTop: 6, borderTop: '1px solid var(--violet-line)' }}>
                    <button
                      onClick={() => markPreference(activeRun.id, activeRun.preference === 'rejected' ? null : 'rejected')}
                      style={activeRun.preference === 'rejected'
                        ? { padding: '5px 12px', borderRadius: 999, background: 'var(--violet)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none' }
                        : { padding: '5px 12px', borderRadius: 999, border: '1px solid var(--violet-line)', color: 'var(--violet-fg)', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'transparent' }
                      }
                    >
                      {activeRun.preference === 'rejected' ? '✓ Student preferred' : 'Prefer student'}
                    </button>
                    <button
                      onClick={() => savePair(activeRun)}
                      style={{ padding: '5px 12px', borderRadius: 999, border: '1px solid var(--line)', color: 'var(--ink2)', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'transparent' }}
                    >
                      {savedPairs.some((p) => p.runId === activeRun.id) ? 'Saved' : 'Save pair'}
                    </button>
                  </div>
                </div>
              </>
            )}

            {runStatus === 'running' && activeRun?.teacherResponse === '...' && (
              <div style={{ display: 'flex', gap: 10, opacity: 0.6, fontSize: 12.5, color: 'var(--ink2)' }}>Running teacher &amp; student in parallel...</div>
            )}

            {runStatus === 'idle' && !activeRun && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.35 }}>
                <div style={{ fontSize: 13, color: 'var(--ink2)' }}>Enter a prompt above and run</div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: pairs ledger + export + KD training + voice */}
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* labelled pairs ledger */}
          {savedPairs.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, color: 'var(--ink2)', textTransform: 'uppercase' as const, marginBottom: 8 }}>Labelled pairs</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {savedPairs.map((p) => (
                  <div key={p.runId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--paper-sunk)', borderRadius: 9, border: '1px solid var(--line)' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--verified)', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: 'var(--ink)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.prompt}</span>
                    <span style={{ fontSize: 10.5, color: 'var(--ink3)' }}>
                      {models.find((m) => m.id === p.chosenModel)?.label ?? p.chosenModel}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* DPO Export */}
          <div style={{ background: 'var(--paper-sunk)', borderRadius: 14, padding: 16, border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>Export DPO data</div>
            <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.6 }}>
              Bundles labelled pairs into a <span className="font-mono" style={{ fontSize: 11 }}>.jsonl</span> file — one line per pair with prompt, chosen, rejected, teacher and student model IDs. Client-side only, nothing leaves this device.
            </div>
            {labelledCount > 0 ? (
              <button
                onClick={exportDPO}
                style={{ padding: '9px 18px', borderRadius: 10, background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', alignSelf: 'flex-start', border: 'none' }}
              >
                {exportStatus === 'done' ? 'Saved!' : `Export ${labelledCount} pairs as JSONL`}
              </button>
            ) : (
              <div style={{ padding: '9px 18px', borderRadius: 10, background: 'var(--paper-sunk-2)', color: 'var(--ink3)', fontSize: 13, fontWeight: 600, alignSelf: 'flex-start' }}>
                No labelled pairs yet — mark some preferences first
              </div>
            )}
          </div>

          {/* KD Training */}
          <div style={{ background: 'var(--paper-sunk)', borderRadius: 14, padding: 16, border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>Train in-app — Knowledge Distillation</div>

            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: 'var(--ink2)', textTransform: 'uppercase' as const, marginBottom: 8 }}>Teacher type</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* Blackbox radio card */}
                <button
                  onClick={() => setDistillTeacherType('blackbox')}
                  style={distillTeacherType === 'blackbox'
                    ? { border: '1.5px solid var(--accent)', background: 'var(--accent-soft)', borderRadius: 10, padding: '10px 12px', cursor: 'pointer', textAlign: 'left' as const }
                    : { border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', cursor: 'pointer', textAlign: 'left' as const, background: 'transparent' }
                  }
                >
                  <div style={{ fontSize: 12.5, fontWeight: distillTeacherType === 'blackbox' ? 700 : 600, color: distillTeacherType === 'blackbox' ? 'var(--accent)' : 'var(--ink)' }}>
                    Blackbox &rarr; Whitebox
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink2)', marginTop: 2 }}>
                    Behavioural cloning from text outputs — works with any teacher including closed-source models.
                  </div>
                </button>
                {/* Whitebox radio card */}
                <button
                  onClick={() => setDistillTeacherType('whitebox')}
                  style={distillTeacherType === 'whitebox'
                    ? { border: '1.5px solid var(--accent)', background: 'var(--accent-soft)', borderRadius: 10, padding: '10px 12px', cursor: 'pointer', textAlign: 'left' as const }
                    : { border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', cursor: 'pointer', textAlign: 'left' as const, background: 'transparent' }
                  }
                >
                  <div style={{ fontSize: 12.5, fontWeight: distillTeacherType === 'whitebox' ? 700 : 600, color: distillTeacherType === 'whitebox' ? 'var(--accent)' : 'var(--ink)' }}>
                    Whitebox &rarr; Whitebox
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink2)', marginTop: 2 }}>
                    Real KD loss using teacher token-probability distributions — requires caching teacher logits first.
                  </div>
                </button>
              </div>
            </div>

            {/* Cache logits button (whitebox only) */}
            {distillTeacherType === 'whitebox' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--paper-sunk-2)', borderRadius: 10, border: '1px solid var(--line)' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)' }}>Cache teacher logits</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink2)' }}>
                    {cacheStatus === 'loading-model' ? 'Loading model...' : cacheStatus === 'caching' ? 'Caching...' : cacheStatus === 'done' ? `${cacheStats?.withLogits ?? 0}/${cacheStats?.total ?? 0} pairs cached` : cacheStatus === 'error' ? (cacheError ?? 'Failed') : 'Not cached yet'}
                  </div>
                </div>
                <button
                  onClick={() => void handleCacheTeacherLogits()}
                  disabled={cacheStatus === 'loading-model' || cacheStatus === 'caching' || labelledCount === 0}
                  style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--line)', fontSize: 12, fontWeight: 600, color: 'var(--ink2)', cursor: 'pointer', background: 'transparent', opacity: (cacheStatus === 'loading-model' || cacheStatus === 'caching' || labelledCount === 0) ? 0.5 : 1 }}
                >
                  {cacheStatus === 'loading-model' ? 'Loading...' : cacheStatus === 'caching' ? 'Caching...' : 'Cache'}
                </button>
              </div>
            )}
            {cacheStatus === 'error' && cacheError && (
              <p style={{ fontSize: 10, color: 'var(--danger-fg)' }}>{cacheError}</p>
            )}

            {/* LoRA rank + Max steps — side by side */}
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: 'var(--ink2)', textTransform: 'uppercase' as const }}>LoRA rank</span>
                  <span className="font-mono" style={{ fontSize: 12, color: 'var(--ink)' }}>{distillLoraR}</span>
                </div>
                <input
                  type="range" min={1} max={64} step={1} value={distillLoraR}
                  onChange={(e) => setDistillLoraR(parseInt(e.target.value) || 8)}
                  style={{ width: '100%', accentColor: 'var(--accent)' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: 'var(--ink2)', textTransform: 'uppercase' as const }}>Max steps</span>
                  <span className="font-mono" style={{ fontSize: 12, color: 'var(--ink)' }}>{distillMaxSteps}</span>
                </div>
                <input
                  type="range" min={1} max={500} step={1} value={distillMaxSteps}
                  onChange={(e) => setDistillMaxSteps(parseInt(e.target.value) || 100)}
                  style={{ width: '100%', accentColor: 'var(--accent)' }}
                />
              </div>
            </div>

            {/* training job status */}
            {distillJob && (distillJob.status === 'running' || distillJob.status === 'queued') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)' }}>Training...</span>
                  <span className="font-mono" style={{ fontSize: 11, color: 'var(--ink2)' }}>
                    {distillJob.step}/{distillMaxSteps}{distillJob.loss !== null ? ` · loss ${distillJob.loss.toFixed(4)}` : ''}
                  </span>
                </div>
                <div style={{ height: 6, borderRadius: 999, background: 'var(--paper-sunk-2)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(100, (distillJob.step / distillJob.total_steps) * 100)}%`, background: 'var(--accent)', borderRadius: 999, transition: 'width 0.3s' }} />
                </div>
              </div>
            )}

            {distillJob && distillJob.status === 'done' && (
              <div style={{ background: 'var(--verified-soft)', border: '1px solid var(--verified-line)', borderRadius: 10, padding: '10px 14px' }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--verified-fg)' }}>Training complete — {distillJob.total_steps} steps</div>
                {distillJob.adapter_path && (
                  <div className="font-mono" style={{ fontSize: 11, color: 'var(--ink2)', marginTop: 3 }}>Adapter saved: {distillJob.adapter_path}</div>
                )}
              </div>
            )}

            {distillJob && distillJob.status === 'error' && (
              <div style={{ background: 'var(--paper-sunk-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 14px' }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--danger-fg)' }}>Error: {distillJob.error ?? 'Training failed'}</div>
              </div>
            )}

            {(!distillJob || distillJob.status === 'done' || distillJob.status === 'error' || distillJob.status === 'cancelled') && distillTrainStatus !== 'polling' && distillTrainStatus !== 'starting' && (
              <button
                onClick={() => void handleStartTraining()}
                disabled={whiteboxModels.length === 0}
                style={{ padding: '10px 18px', borderRadius: 10, background: 'var(--accent)', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', textAlign: 'center' as const, border: 'none', opacity: whiteboxModels.length === 0 ? 0.5 : 1 }}
              >
                Start KD Training
              </button>
            )}
          </div>

          {/* Voice Trainer */}
          <VoiceTrainer />
        </div>
      </div>
    </div>
  )
}
