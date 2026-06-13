'use client'

import { useState } from 'react'
import { models } from '@/config/models'

type RunStatus = 'idle' | 'running' | 'done'
type PreferenceLabel = 'preferred' | 'rejected' | null

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

export function TuneSurface() {
  const [teacherModelId, setTeacherModelId] = useState(models[0]?.id ?? '')
  const [studentModelId, setStudentModelId] = useState(models[1]?.id ?? '')
  const [prompt, setPrompt] = useState('')
  const [runStatus, setRunStatus] = useState<RunStatus>('idle')
  const [runs, setRuns] = useState<ComparisonRun[]>([])
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [exportStatus, setExportStatus] = useState<'idle' | 'done'>('idle')

  const activeRun = runs.find((r) => r.id === activeRunId) ?? runs[0] ?? null

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

    try {
      const [teacherRes, studentRes] = await Promise.all([
        fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [{ role: 'user', content: placeholder.prompt }], model: teacherModelId }),
        }),
        fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [{ role: 'user', content: placeholder.prompt }], model: studentModelId }),
        }),
      ])

      const teacherText = await collectStream(teacherRes)
      const studentText = await collectStream(studentRes)

      setRuns((prev) => prev.map((r) => r.id === id
        ? { ...r, teacherResponse: teacherText, studentResponse: studentText }
        : r
      ))
    } catch {
      setRuns((prev) => prev.map((r) => r.id === id
        ? { ...r, teacherResponse: 'Error fetching response.', studentResponse: 'Error fetching response.' }
        : r
      ))
    } finally {
      setRunStatus('done')
    }
  }

  async function collectStream(res: Response): Promise<string> {
    if (!res.ok) return `Error ${res.status}`
    const reader = res.body?.getReader()
    if (!reader) return ''
    const decoder = new TextDecoder()
    let text = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            const d = JSON.parse(line.slice(6))
            if (d.event === 'delta' && d.text) text += d.text
            if (d.event === 'done') break
          } catch { /* skip */ }
        }
      }
    }
    return text || '(no response)'
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
      <div className="border-b border-[#d7dee8] bg-[#f8fafc] px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[#0f172a]">Tune & Train</h2>
            <p className="mt-0.5 text-xs text-[#64748b]">Run comparative prompts between models, mark preferences, export DPO training data.</p>
          </div>
          {labelledCount > 0 && (
            <button
              onClick={exportDPO}
              className="flex items-center gap-2 rounded-full bg-[#0f172a] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#1e293b]"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M6 1v7M3 6l3 3 3-3M1 10h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {exportStatus === 'done' ? 'Saved!' : `Export ${labelledCount} pair${labelledCount !== 1 ? 's' : ''} JSONL`}
            </button>
          )}
        </div>

        {/* Model pair config */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[#1d4ed8]">Teacher</span>
            <select
              value={teacherModelId}
              onChange={(e) => setTeacherModelId(e.target.value)}
              className="rounded-xl border border-[#bfdbfe] bg-white px-2.5 py-1.5 text-xs text-[#0f172a] outline-none"
            >
              {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-[#94a3b8]">
            <path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[#7c3aed]">Student</span>
            <select
              value={studentModelId}
              onChange={(e) => setStudentModelId(e.target.value)}
              className="rounded-xl border border-[#ddd6fe] bg-white px-2.5 py-1.5 text-xs text-[#0f172a] outline-none"
            >
              {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
        </div>

        {/* Prompt input */}
        <div className="mt-3 flex gap-2">
          <textarea
            className="min-h-[60px] flex-1 resize-none rounded-2xl border border-[#bfdbfe] bg-white px-3 py-2 text-sm text-[#111827] outline-none placeholder:text-[#94a3b8]"
            placeholder="Enter a prompt to run on both models…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleRun() }}
          />
          <button
            onClick={() => void handleRun()}
            disabled={!prompt.trim() || runStatus === 'running'}
            className="self-end rounded-full bg-[#1d4ed8] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1e40af] disabled:opacity-50"
          >
            {runStatus === 'running' ? 'Running…' : 'Run'}
          </button>
        </div>
      </div>

      {/* Body — run list + detail */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Run list */}
        {runs.length > 0 && (
          <div className="w-56 shrink-0 overflow-y-auto border-r border-[#d7dee8] bg-[#f8fafc] py-2">
            {runs.map((r) => (
              <button
                key={r.id}
                onClick={() => setActiveRunId(r.id)}
                className={`flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition ${
                  r.id === activeRunId ? 'bg-[#dbeafe]' : 'hover:bg-white'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {r.preference === 'preferred' && <span className="h-1.5 w-1.5 rounded-full bg-[#22c55e]" />}
                  {r.preference === 'rejected' && <span className="h-1.5 w-1.5 rounded-full bg-[#ef4444]" />}
                  {r.preference === null && <span className="h-1.5 w-1.5 rounded-full bg-[#d1d5db]" />}
                  <span className="truncate text-xs font-medium text-[#0f172a]">{r.prompt.slice(0, 40)}</span>
                </div>
                <span className="pl-3 text-[10px] text-[#94a3b8]">{new Date(r.createdAt).toLocaleTimeString()}</span>
              </button>
            ))}
          </div>
        )}

        {/* Detail pane */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {!activeRun && (
            <div className="flex h-full items-center justify-center text-sm text-[#94a3b8]">
              Run a prompt to compare model responses.
            </div>
          )}
          {activeRun && (
            <div className="mx-auto max-w-4xl space-y-4">
              <p className="text-xs font-semibold text-[#475569]">Prompt</p>
              <div className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3 text-sm text-[#0f172a]">
                {activeRun.prompt}
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Teacher */}
                <div className={`rounded-2xl border bg-white p-4 space-y-2 ${activeRun.preference === 'preferred' ? 'border-[#86efac] ring-1 ring-[#22c55e]/30' : 'border-[#bfdbfe]'}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-[#1d4ed8]">Teacher — {models.find((m) => m.id === activeRun.teacherModel)?.label ?? activeRun.teacherModel}</span>
                    <button
                      onClick={() => markPreference(activeRun.id, activeRun.preference === 'preferred' ? null : 'preferred')}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                        activeRun.preference === 'preferred'
                          ? 'bg-[#22c55e] text-white'
                          : 'border border-[#d1d5db] text-[#64748b] hover:border-[#22c55e] hover:text-[#16a34a]'
                      }`}
                    >
                      {activeRun.preference === 'preferred' ? '✓ Preferred' : 'Prefer'}
                    </button>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-6 text-[#111827]">{activeRun.teacherResponse}</p>
                </div>

                {/* Student */}
                <div className={`rounded-2xl border bg-white p-4 space-y-2 ${activeRun.preference === 'rejected' ? 'border-[#fca5a5] ring-1 ring-[#ef4444]/30' : 'border-[#ddd6fe]'}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-[#7c3aed]">Student — {models.find((m) => m.id === activeRun.studentModel)?.label ?? activeRun.studentModel}</span>
                    <button
                      onClick={() => markPreference(activeRun.id, activeRun.preference === 'rejected' ? null : 'rejected')}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                        activeRun.preference === 'rejected'
                          ? 'bg-[#ef4444] text-white'
                          : 'border border-[#d1d5db] text-[#64748b] hover:border-[#fca5a5] hover:text-[#dc2626]'
                      }`}
                    >
                      {activeRun.preference === 'rejected' ? '✗ Rejected' : 'Reject'}
                    </button>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-6 text-[#111827]">{activeRun.studentResponse}</p>
                </div>
              </div>

              {activeRun.preference === null && (
                <p className="text-center text-xs text-[#94a3b8]">Mark the teacher response as &ldquo;Prefer&rdquo; to add this pair to the DPO export.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
