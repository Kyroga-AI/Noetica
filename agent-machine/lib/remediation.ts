/**
 * remediation — the compounding learn-from-failure loop.
 *
 * When the agent gets a problem wrong, we don't just log it. We:
 *   1. deep-research the specific problem with the reasoning model (correct
 *      solution + diagnosis of the exact misconception that produced the wrong
 *      answer),
 *   2. distil a generalizable LESSON,
 *   3. write it back to the knowledge base — a RemediationLesson atom in the
 *      HellGraph self-improvement store AND an embedded corpus doc so the lesson
 *      is *retrieved as grounding on the next pass* (closing the loop).
 *
 * Quantitative failures additionally feed symbolic regression (scripts/symreg.py)
 * to recover the governing relation, and the per-concept improvement is tracked
 * with a ridge-regression delta so we can show the "missed lesson" written back.
 */
import { createHash } from 'node:crypto'
import { getHellGraph } from '@socioprophet/hellgraph'
import { ingestDocument } from './doc-store.js'

export interface Failure { subject: string; question: string; choices?: string[]; gold: string; modelAnswer: string }
export interface RemediationLesson {
  id: string; subject: string; question: string
  correctReasoning: string; errorDiagnosis: string; lesson: string; created_at: string
}

const BASE = () => (process.env['OLLAMA_HOST']?.replace(/\/$/, '') || 'http://127.0.0.1:11435')
const REASON_MODEL = () => process.env['REMEDIATION_MODEL'] || 'deepseek-r1:8b-cpu'
const LABEL = 'RemediationLesson'

async function reason(prompt: string): Promise<string> {
  const res = await fetch(`${BASE()}/v1/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: REASON_MODEL(), stream: false, messages: [
      { role: 'system', content: 'You are a rigorous tutor doing error analysis. Be precise and concise.' },
      { role: 'user', content: prompt },
    ] }),
    signal: AbortSignal.timeout(Number(process.env['REMEDIATION_TIMEOUT_MS'] || 300_000)),
  })
  const d = await res.json() as { choices?: Array<{ message?: { content?: string; reasoning_content?: string } }> }
  const m = d.choices?.[0]?.message
  return (m?.content || m?.reasoning_content || '').trim()
}

function section(text: string, tag: string): string {
  const re = new RegExp(`${tag}:\\s*([\\s\\S]*?)(?=\\n(?:CORRECT|ERROR|LESSON):|$)`, 'i')
  return (re.exec(text)?.[1] || '').trim()
}

/** Deep-research a single failure and write the lesson back to the KB. */
export async function remediateFailure(f: Failure): Promise<RemediationLesson> {
  const choices = f.choices?.length ? '\n' + f.choices.map((c, i) => `${'ABCD'[i]}. ${c}`).join('\n') : ''
  const prompt = `Problem (${f.subject}):\n${f.question}${choices}\n\nThe correct answer is ${f.gold}. A student answered ${f.modelAnswer}, which is wrong.\n\nRespond in exactly this format:\nCORRECT: <the correct solution and the reasoning that reaches it>\nERROR: <the specific misconception that leads to "${f.modelAnswer}">\nLESSON: <one generalizable sentence the student should remember next time>`
  const out = await reason(prompt)
  const lesson: RemediationLesson = {
    id: 'remediation:' + createHash('sha1').update(f.subject + '|' + f.question).digest('hex').slice(0, 12),
    subject: f.subject, question: f.question,
    correctReasoning: section(out, 'CORRECT') || out.slice(0, 600),
    errorDiagnosis: section(out, 'ERROR'),
    lesson: section(out, 'LESSON') || 'Review the underlying concept and re-derive carefully.',
    created_at: new Date().toISOString(),
  }

  // Write back: atom (structured self-improvement store) + embedded corpus doc
  // (so the lesson is retrieved as grounding on the next pass).
  const g = getHellGraph()
  if (!g.getNode(lesson.id)) {
    g.addNode(lesson.id, [LABEL], {
      subject: lesson.subject, question: lesson.question.slice(0, 400),
      lesson: lesson.lesson, error_diagnosis: lesson.errorDiagnosis, created_at: lesson.created_at,
    })
    const domainId = `domain:subject:${lesson.subject}`
    if (!g.getNode(domainId)) g.addNode(domainId, ['Domain'], { corpus_release_ref: lesson.subject, kind: 'subject', created_at: lesson.created_at })
    g.addEdge('REMEDIATES', lesson.id, domainId, { at: lesson.created_at })
  }
  await ingestDocument(`remediation/${lesson.subject}/${lesson.id}.md`,
    `Subject: ${lesson.subject}\nQuestion: ${lesson.question}\nCorrect reasoning: ${lesson.correctReasoning}\nCommon error: ${lesson.errorDiagnosis}\nLesson: ${lesson.lesson}`)
  return lesson
}

/** Retrieve remediation lessons relevant to a query (for next-pass grounding). */
export async function lessonGroundingFor(query: string, k = 3): Promise<string> {
  const { semanticSearch } = await import('./doc-store.js')
  const hits = (await semanticSearch(query, 8)).filter((h) => h.filename.startsWith('remediation/')).slice(0, k)
  if (!hits.length) return ''
  return '\n\n## Lessons from prior mistakes (apply these):\n' + hits.map((h, i) => `[${i + 1}] ${h.text}`).join('\n')
}

export function remediationCount(): number {
  return getHellGraph().nodesByLabel(LABEL).length
}
