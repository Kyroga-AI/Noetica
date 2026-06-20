// Local-first dialogue layer.
//
// Noetica is local-first, not cloud-first — so the conversation shouldn't depend on the
// generative model for everything. Small-talk and app-help are answered here,
// deterministically and instantly, with no model call. That means "hi" works even while
// the local runtime is still warming up, costs nothing, and never errors with
// "no local Ollama runtime". Anything substantive returns null and goes to the model.

export function matchDialogue(input: string, ctx?: { userName?: string }): string | null {
  const raw = input.trim()
  if (!raw) return null
  const s = raw.toLowerCase().replace(/[!?.…]+$/g, '').trim()

  // Only intercept short utterances — anything substantial is a real request → model.
  if (s.split(/\s+/).length > 7) return null

  const name = ctx?.userName?.trim()
  const withName = name ? `, ${name}` : ''
  const any = (...res: RegExp[]) => res.some((r) => r.test(s))

  // Greetings
  if (any(/^(hi+|hey+|hello+|yo|howdy|sup|hiya|heya|hi there|hey there|hello there)$/, /^good (morning|afternoon|evening|day)$/, /^greetings$/))
    return `Hi${withName} — I'm here. What can I help with?`

  // How are you
  if (any(/^how('?s| is| are| r)?\s*(it going|you|things|are you|you doing|are things)?$/, /^how(’| )?s it going$/, /^you (ok|good|alright|well)$/, /^hows things$/))
    return `Running local and ready. What are you working on?`

  // Thanks
  if (any(/^(thanks|thank you|thank u|thx|ty|cheers|appreciate it|much appreciated|thanks so much)$/))
    return `Anytime${withName}.`

  // Acknowledgements
  if (any(/^(ok(ay)?|cool|nice|great|perfect|awesome|sweet|got it|sounds good|word|right on|gotcha|kk|yup|yep)$/))
    return `👍`

  // Goodbyes
  if (any(/^(bye+|goodbye|see ya|see you|later|cya|good ?night|gn|take care|peace|catch you later)$/))
    return `See you${withName}.`

  // Identity / capabilities
  if (any(/who are you/, /what are you/, /what can you do/, /what do you do/, /your name/, /introduce yourself/, /tell me about yourself/))
    return `I'm Noetica — a local-first AI workspace. Everything runs on your machine: I can read and write files, run code, search the web, and build a knowledge graph of our work — without sending your data to the cloud. Try "show my files", "write a python script that…", or just ask me something.`

  // Privacy / local-first
  if (any(/are you (local|offline|cloud|online)/, /where (do|does) (you|my data) (run|live|go)/, /is my data (safe|private|stored)/, /\bprivacy\b/, /local[- ]first/, /do you (work )?offline/, /send.*(cloud|anthropic|openai)/))
    return `Local-first — I run entirely on this device. Your data stays here unless you explicitly add a cloud provider key in Settings.`

  // Help / getting started
  if (any(/^help$/, /^what now$/, /how do i (start|begin)/, /where do i (start|begin)/, /what should i do/, /^commands$/))
    return `A few things to try:\n- **"show my files"** — I read your filesystem, locally\n- **"write a python script that…"** — I write it and can run it\n- **"research <topic>"** — I search and summarize\n\nI run locally, so the first model-backed reply may take a moment to warm up.`

  // Wake / presence
  if (any(/^(you there|are you there|hello\?*|anyone there|knock knock|test|ping)$/))
    return `Here — what do you need?`

  return null // → generative model
}
