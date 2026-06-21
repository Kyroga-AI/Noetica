// Local-first dialogue layer.
//
// Noetica is local-first, not cloud-first — so the conversation shouldn't depend on the
// generative model for everything. Small-talk and app-help are answered here,
// deterministically and instantly, with no model call. That means "hi" works even while
// the local runtime is still warming up, costs nothing, and never errors with
// "no local Ollama runtime". Anything substantive returns null and goes to the model.
//
// Deterministic does NOT mean robotic: the surface form varies by time of day, the
// language you greeted in, your name, and your energy — and never repeats the same line
// twice in a row. All of it derived locally (system clock + your input); no network.

// ── No-immediate-repeat picker ──────────────────────────────────────────────
// Module-level so a variant isn't echoed back-to-back within a session.
const lastPick = new Map<string, string>()
function pick(category: string, variants: string[]): string {
  if (variants.length <= 1) return variants[0] ?? ''
  const prev = lastPick.get(category)
  let i = Math.floor(Math.random() * variants.length)
  if (variants[i] === prev) i = (i + 1) % variants.length // skip an immediate repeat
  const choice = variants[i]!
  lastPick.set(category, choice)
  return choice
}

// ── Local time of day ───────────────────────────────────────────────────────
type DayPart = 'lateNight' | 'morning' | 'afternoon' | 'evening' | 'night'
function dayPart(hour: number): DayPart {
  if (hour < 5) return 'lateNight'
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  if (hour < 21) return 'evening'
  return 'night'
}

// ── Non-English greetings: detect → reply in kind ───────────────────────────
// Matched before the English path. Each maps a greeting to localized replies.
const LANG_GREETINGS: Array<{ re: RegExp; replies: string[] }> = [
  { re: /^(hola|buenas|buenos d[ií]as|buenas tardes|buenas noches|qu[ée] tal)$/i,
    replies: ['¡Hola! ¿En qué te ayudo?', '¡Hola! ¿Qué necesitas?', '¡Buenas! ¿En qué trabajamos?'] },
  { re: /^(bonjour|salut|coucou|bonsoir)$/i,
    replies: ['Bonjour ! Comment puis-je aider ?', 'Salut ! Que puis-je faire pour toi ?', 'Bonjour ! Sur quoi travaille-t-on ?'] },
  { re: /^(ciao|salve|buongiorno|buonasera)$/i,
    replies: ['Ciao! Come posso aiutarti?', 'Ciao! Su cosa lavoriamo?'] },
  { re: /^(ol[áa]|oi|bom dia|boa tarde|boa noite)$/i,
    replies: ['Olá! Como posso ajudar?', 'Oi! No que você está trabalhando?'] },
  { re: /^(hallo|guten tag|servus|moin|guten morgen|guten abend)$/i,
    replies: ['Hallo! Wie kann ich helfen?', 'Hallo! Woran arbeiten wir?'] },
  { re: /^(привет|здравствуй(те)?|здаров|добрый день)$/i,
    replies: ['Привет! Чем могу помочь?', 'Здравствуйте! Над чем работаем?'] },
  { re: /^(こんにちは|こんばんは|やあ|もしもし|おはよう)$/,
    replies: ['こんにちは！何かお手伝いできますか？', 'やあ！今日は何をしますか？'] },
  { re: /^(你好|您好|嗨|哈罗|早上好|晚上好)$/,
    replies: ['你好！有什么可以帮你的吗？', '你好！我们来做点什么？'] },
  { re: /^(مرحبا|السلام عليكم|أهلا|اهلا)$/,
    replies: ['مرحبا! كيف يمكنني مساعدتك؟', 'أهلاً! بماذا أساعدك؟'] },
  { re: /^(안녕|안녕하세요|여보세요)$/,
    replies: ['안녕하세요! 무엇을 도와드릴까요?'] },
]

export function matchDialogue(input: string, ctx?: { userName?: string }): string | null {
  const raw = input.trim()
  if (!raw) return null
  const s = raw.toLowerCase().replace(/[!?.…]+$/g, '').trim()

  // Only intercept short utterances — anything substantial is a real request → model.
  if (s.split(/\s+/).length > 7) return null

  const name = ctx?.userName?.trim()
  // Weave the name in ~half the time so it feels natural, not robotic.
  const maybeName = name && Math.random() < 0.5 ? `, ${name}` : ''
  // Energy: mirror an excited greeting (trailing !! or ALL CAPS on a short line).
  const excited = /[!]{2,}$/.test(raw) || (raw.length <= 14 && raw === raw.toUpperCase() && /[a-z]/i.test(raw))
  const any = (...res: RegExp[]) => res.some((r) => r.test(s))

  // Non-English greeting → reply in the same language (checked first).
  for (const { re, replies } of LANG_GREETINGS) {
    if (re.test(raw.trim()) || re.test(s)) return pick(`lang:${replies[0]}`, replies)
  }

  // English greeting → time-of-day opener + varied tail.
  if (any(/^(hi+|hey+|hello+|yo+|howdy|sup|hiya|heya|hi there|hey there|hello there|wassup|wsup)$/, /^good (morning|afternoon|evening|day)$/, /^greetings$/)) {
    const part = dayPart(new Date().getHours())
    const opener = pick(`greet-open:${part}`, {
      lateNight: ['Up late', 'Burning the midnight oil', 'Still up', 'Late one'],
      morning: ['Morning', 'Good morning', 'Mornin’', 'Hey'],
      afternoon: ['Afternoon', 'Good afternoon', 'Hey', 'Hi there'],
      evening: ['Evening', 'Good evening', 'Hey', 'Hi there'],
      night: ['Evening', 'Hey', 'Hi there', 'Hello'],
    }[part])
    const tail = pick('greet-tail', excited
      ? ['What are we building?!', "What's up?!", 'What can I do for you?!', "Let's go — what do you need?"]
      : ['What can I help with?', 'What are you working on?', "What's up?", 'How can I help?', 'What do you need?'])
    return `${opener}${maybeName} — ${tail}`
  }

  // How are you
  if (any(/^how('?s| is| are| r)?\s*(it going|you|things|are you|you doing|are things)?$/, /^how(’| )?s it going$/, /^you (ok|good|alright|well)$/, /^hows things$/))
    return pick('howareyou', [
      'Running local and ready. What are you working on?',
      'All local, all here. What do you need?',
      'Good — on your machine, no cloud. What’s the task?',
      'Ready when you are. What are we doing?',
    ])

  // Thanks
  if (any(/^(thanks|thank you|thank u|thx|ty|cheers|appreciate it|much appreciated|thanks so much|nice one)$/))
    return pick('thanks', [`Anytime${maybeName}.`, 'Anytime.', 'Of course.', 'You got it.', 'Happy to help.', 'Np.'])

  // Acknowledgements
  if (any(/^(ok(ay)?|cool|nice|great|perfect|awesome|sweet|got it|sounds good|word|right on|gotcha|kk|yup|yep)$/))
    return pick('ack', ['👍', 'Got it.', 'On it.', '👌', 'Cool.'])

  // Goodbyes — time-aware sign-off.
  if (any(/^(bye+|goodbye|see ya|see you|later|cya|good ?night|gn|take care|peace|catch you later|laters)$/)) {
    const h = new Date().getHours()
    const night = h >= 21 || h < 5
    return pick('bye', night
      ? [`Good night${maybeName}.`, 'Night — rest well.', `See you${maybeName}.`, 'Sleep well.']
      : [`See you${maybeName}.`, 'Take care.', 'Later.', 'Catch you later.', 'Have a good one.'])
  }

  // Identity / capabilities
  if (any(/who are you/, /what are you/, /what can you do/, /what do you do/, /your name/, /introduce yourself/, /tell me about yourself/))
    return pick('identity', [
      `I'm Noetica — a local-first AI workspace. Everything runs on your machine: I can read and write files, run code, search the web, and build a knowledge graph of our work — without sending your data to the cloud. Try "show my files", "write a python script that…", or just ask me something.`,
      `Noetica — your local-first workspace. I run entirely on this device: code, files, web search, and a persistent knowledge graph, all private. Ask me to do something, or try "show my files".`,
    ])

  // Privacy / local-first
  if (any(/are you (local|offline|cloud|online)/, /where (do|does) (you|my data) (run|live|go)/, /is my data (safe|private|stored)/, /\bprivacy\b/, /local[- ]first/, /do you (work )?offline/, /send.*(cloud|anthropic|openai)/))
    return pick('privacy', [
      'Local-first — I run entirely on this device. Your data stays here unless you explicitly add a cloud provider key in Settings.',
      'Everything runs on your machine. Nothing leaves it unless you wire up a cloud key yourself in Settings.',
    ])

  // Help / getting started
  if (any(/^help$/, /^what now$/, /how do i (start|begin)/, /where do i (start|begin)/, /what should i do/, /^commands$/))
    return `A few things to try:\n- **"show my files"** — I read your filesystem, locally\n- **"write a python script that…"** — I write it and can run it\n- **"research <topic>"** — I search and summarize\n\nI run locally, so the first model-backed reply may take a moment to warm up.`

  // Wake / presence
  if (any(/^(you there|are you there|hello\?*|anyone there|knock knock|test|ping)$/))
    return pick('wake', ['Here — what do you need?', 'Right here.', 'Listening — go ahead.', 'Yep, here. What’s up?'])

  return null // → generative model
}
