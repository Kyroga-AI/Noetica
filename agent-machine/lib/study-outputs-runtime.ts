/**
 * study-outputs-runtime.ts — production wiring for the NotebookLM-class output layer: binds the tested,
 * model-agnostic core (study-outputs.ts) to the preset model (generateOllamaText) and the FRONTIER-AUTHORED
 * canon (canonDef), so study-guide/glossary definitions are authoritative where the canon covers the term.
 * The TTS step that voices the audio script is the voice layer's job (lib/voice) — this produces the script.
 */
import { generateBriefing, generateStudyGuide, generateAudioScript, type Generate, type Briefing, type StudyGuide, type DialogueTurn, type AudioFormat } from './study-outputs.js'
import { generateOllamaText } from './ollama.js'
import { canonDef } from './canon-lookup.js'
import { resolveConfig } from './presets.js'

const liveGenerate: Generate = async (prompt) => {
  const { content } = await generateOllamaText({
    model: resolveConfig().model,
    temperature: 0.3,
    messages: [{ role: 'user', content: prompt }],
  })
  return content
}

export const briefingDoc = (sources: string[]): Promise<Briefing> => generateBriefing(sources, liveGenerate)
export const studyGuide = (sources: string[]): Promise<StudyGuide> => generateStudyGuide(sources, liveGenerate, canonDef)
export const audioScript = (sources: string[], format: AudioFormat = 'brief'): Promise<DialogueTurn[]> =>
  generateAudioScript(sources, liveGenerate, format)
