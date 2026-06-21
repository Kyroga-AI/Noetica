// Local-first dialogue layer.
//
// Noetica is local-first, not cloud-first — so the conversation shouldn't depend on the
// generative model for everything. Small-talk, app-help, simple utilities, and the start
// of slot-filling forms are handled here: deterministically, instantly, no model call, no
// network. That means "hi" works while the runtime warms up, "flip a coin" never spends a
// token, and "research" asks *what* before dispatching. Anything substantive returns null
// and goes to the model.
//
// Rasa-style features, all local: response variation, entity/slot forms, quick-reply
// buttons, disambiguation, affect detection, and small-talk — derived from the system
// clock + your input.

export interface DialogueResult {
  reply: string
  /** Optional inline buttons; clicking one sends its text as the next message. */
  quickReplies?: string[]
  /** If set, the NEXT user turn fills this form's slot and dispatches to the model. */
  form?: DialogueForm
}
export interface DialogueForm {
  /** Human label of the slot we're collecting, e.g. "topic". */
  slot: string
  /** Prompt template; {value} is replaced by the next user turn, then sent to the model. */
  template: string
}

export interface DialogueCtx {
  userName?: string
  modelLabel?: string
}

// ── No-immediate-repeat picker ──────────────────────────────────────────────
const lastPick = new Map<string, string>()
function pick(category: string, variants: string[]): string {
  if (variants.length <= 1) return variants[0] ?? ''
  const prev = lastPick.get(category)
  let i = Math.floor(Math.random() * variants.length)
  if (variants[i] === prev) i = (i + 1) % variants.length
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
const LANG_GREETINGS: Array<{ re: RegExp; replies: string[] }> = [
  { re: /^(hola|buenas|buenos d[ií]as|buenas tardes|buenas noches|qu[ée] tal)$/i,
    replies: ['¡Hola! ¿En qué te ayudo?', '¡Hola! ¿Qué necesitas?', '¡Buenas! ¿En qué trabajamos?'] },
  { re: /^(bonjour|salut|coucou|bonsoir)$/i,
    replies: ['Bonjour ! Comment puis-je aider ?', 'Salut ! Que puis-je faire pour toi ?'] },
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

// ── Safe arithmetic (no eval): tokenize → shunting-yard → RPN eval ──────────
function safeArithmetic(expr: string): number | null {
  const norm = expr.replace(/[x×]/gi, '*').replace(/÷/g, '/')
  if (!/^[\d\s.+\-*/()]+$/.test(norm) || !/[+\-*/]/.test(norm)) return null
  const tokens = norm.match(/\d+\.?\d*|[+\-*/()]/g)
  if (!tokens) return null
  const prec: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 }
  const out: string[] = []; const ops: string[] = []
  for (const t of tokens) {
    if (/\d/.test(t)) out.push(t)
    else if (t === '(') ops.push(t)
    else if (t === ')') { while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop()!); if (ops.pop() !== '(') return null }
    else { while (ops.length && ops[ops.length - 1] !== '(' && prec[ops[ops.length - 1]!]! >= prec[t]!) out.push(ops.pop()!); ops.push(t) }
  }
  while (ops.length) { const o = ops.pop()!; if (o === '(') return null; out.push(o) }
  const st: number[] = []
  for (const t of out) {
    if (/\d/.test(t)) st.push(parseFloat(t))
    else { const b = st.pop(); const a = st.pop(); if (a === undefined || b === undefined) return null
      st.push(t === '+' ? a + b : t === '-' ? a - b : t === '*' ? a * b : b === 0 ? NaN : a / b) }
  }
  const r = st.pop()
  return r === undefined || st.length || !isFinite(r) ? null : r
}

// ── Unit conversion (a tasteful subset) ─────────────────────────────────────
function convert(s: string): string | null {
  const m = s.match(/^(-?\d+\.?\d*)\s*(°?\s*c|celsius|°?\s*f|fahrenheit|km|kilometers?|mi|miles?|kg|kilograms?|lb|lbs|pounds?|m|meters?|ft|feet)\s*(?:to|in|→)\s*(°?\s*c|celsius|°?\s*f|fahrenheit|km|kilometers?|mi|miles?|kg|kilograms?|lb|lbs|pounds?|m|meters?|ft|feet)$/i)
  if (!m) return null
  const n = parseFloat(m[1]!); const from = m[2]!.replace(/[°\s]/g, '').toLowerCase(); const to = m[3]!.replace(/[°\s]/g, '').toLowerCase()
  const norm = (u: string) => u.startsWith('cel') || u === 'c' ? 'c' : u.startsWith('fah') || u === 'f' ? 'f'
    : u.startsWith('kilometer') || u === 'km' ? 'km' : u.startsWith('mile') || u === 'mi' ? 'mi'
    : u.startsWith('kilogram') || u === 'kg' ? 'kg' : /^(lb|lbs|pound)/.test(u) ? 'lb'
    : u.startsWith('meter') || u === 'm' ? 'm' : u.startsWith('feet') || u.startsWith('foot') || u === 'ft' ? 'ft' : u
  const f = norm(from); const t = norm(to)
  const pairs: Record<string, (x: number) => number> = {
    'c>f': (x) => x * 9 / 5 + 32, 'f>c': (x) => (x - 32) * 5 / 9,
    'km>mi': (x) => x * 0.621371, 'mi>km': (x) => x / 0.621371,
    'kg>lb': (x) => x * 2.20462, 'lb>kg': (x) => x / 2.20462,
    'm>ft': (x) => x * 3.28084, 'ft>m': (x) => x / 3.28084,
  }
  const fn = pairs[`${f}>${t}`]
  if (!fn) return null
  const r = fn(n)
  return `${n} ${from} ≈ ${Math.round(r * 100) / 100} ${to}.`
}

export function matchDialogue(input: string, ctx?: DialogueCtx): DialogueResult | null {
  const raw = input.trim()
  if (!raw) return null
  const s = raw.toLowerCase().replace(/[!?.…]+$/g, '').trim()
  const name = ctx?.userName?.trim()
  const maybeName = name && Math.random() < 0.5 ? `, ${name}` : ''
  const excited = /[!]{2,}$/.test(raw) || (raw.length <= 14 && raw === raw.toUpperCase() && /[a-z]/i.test(raw))
  const any = (...res: RegExp[]) => res.some((r) => r.test(s))
  const r = (reply: string, extra?: Partial<DialogueResult>): DialogueResult => ({ reply, ...extra })

  // ── Local utilities (answered with zero model, any length) ────────────────
  if (any(/^(what('?s| is) the time|what time is it|current time|the time)$/))
    return r(`It's ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`)
  if (any(/^(what('?s| is) (the |today'?s )?date|what day is (it|today)|today'?s date)$/))
    return r(`Today is ${new Date().toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`)
  if (any(/^(what model|which model|what (are you|model are you) running( on)?|what'?s your model)$/))
    return r(ctx?.modelLabel ? `Right now I'm routing to ${ctx.modelLabel} — all local.` : `I route across your local models automatically (prophet-mesh).`)
  if (any(/^(flip a coin|coin flip|heads or tails|toss a coin)$/))
    return r(Math.random() < 0.5 ? '🪙 Heads.' : '🪙 Tails.')
  let dm: RegExpMatchArray | null
  if ((dm = s.match(/^roll (?:a |an )?(?:dice|die|d(\d+))$/))) {
    const sides = dm[1] ? Math.max(2, Math.min(1000, parseInt(dm[1], 10))) : 6
    return r(`🎲 ${1 + Math.floor(Math.random() * sides)} (d${sides}).`)
  }
  const conv = convert(s.replace(/^(convert|how many \w+ (is|in)|what('?s| is)) /, ''))
  if (conv) return r(conv)
  const mathExpr = s.replace(/^(what('?s| is)|calculate|compute|eval(uate)?)\s+/, '')
  if (/[+\-*/x×÷]/.test(mathExpr) && /\d/.test(mathExpr)) {
    const val = safeArithmetic(mathExpr)
    if (val !== null) return r(`${Math.round(val * 1e6) / 1e6}`)
  }

  // ── Affect: notice frustration before helping ─────────────────────────────
  if (any(/^(ugh+|argh+|this sucks|that sucks|this is (broken|frustrating|annoying|garbage)|wtf|fml|come on|seriously|so annoying|i hate this|why (doesn'?t|won'?t) (this|it) work|nothing works|still broken)$/))
    return r(pick('frustrated', [
      `Sorry — that's frustrating${maybeName}. Tell me what broke and I'll dig in.`,
      `Ugh, I hear you. What's not working? Let's fix it.`,
      `That's annoying — point me at it and I'll sort it out.`,
    ]), { quickReplies: ["Show my files", "What can you do?"] })

  // Only short utterances pass to the small-talk matchers below.
  const wordCount = s.split(/\s+/).length

  // ── Slot-filling forms: bare verb with no object → ask, then dispatch ──────
  if (any(/^(do some |can you |please )?(research|look up|search( the web)?)( something| stuff| online)?$/))
    return r(pick('ask-research', ['Sure — research what?', 'On it. What should I look into?', 'Happy to. What topic?']),
      { form: { slot: 'topic', template: 'Search the web for the latest on {value} and summarize what you find, with sources.' } })
  if (any(/^(write|generate|make|build) (me )?(some )?code$/, /^(let'?s )?code$/, /^write a (script|program|function)$/))
    return r(pick('ask-code', ["What should it do?", 'Sure — what should the code do?', 'Describe it and I’ll write + run it.']),
      { form: { slot: 'spec', template: 'Write code that does the following, then run it and show the output: {value}' } })
  if (any(/^(summari[sz]e|tldr|sum up)( (this|it|that))?$/))
    return r('Summarize what — paste the text, or open a document first.',
      { quickReplies: ['Show my files'] })

  // ── Disambiguation ────────────────────────────────────────────────────────
  if (any(/^(find|show|get)( me)?( my)? files?$/))
    return r('List your files, or search inside them?',
      { quickReplies: ['List my home directory', 'Search file contents'] })

  if (wordCount > 7) return null

  // Non-English greeting → reply in the same language.
  for (const { re, replies } of LANG_GREETINGS) {
    if (re.test(raw) || re.test(s)) return r(pick(`lang:${replies[0]}`, replies))
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
    return r(`${opener}${maybeName} — ${tail}`)
  }

  if (any(/^how('?s| is| are| r)?\s*(it going|you|things|are you|you doing|are things)?$/, /^how(’| )?s it going$/, /^you (ok|good|alright|well)$/, /^hows things$/))
    return r(pick('howareyou', [
      'Running local and ready. What are you working on?',
      'All local, all here. What do you need?',
      'Good — on your machine, no cloud. What’s the task?',
      'Ready when you are. What are we doing?',
    ]))

  if (any(/^(thanks|thank you|thank u|thx|ty|cheers|appreciate it|much appreciated|thanks so much|nice one)$/))
    return r(pick('thanks', [`Anytime${maybeName}.`, 'Anytime.', 'Of course.', 'You got it.', 'Happy to help.', 'Np.']))

  if (any(/^(ok(ay)?|cool|nice|great|perfect|awesome|sweet|got it|sounds good|word|right on|gotcha|kk|yup|yep)$/))
    return r(pick('ack', ['👍', 'Got it.', 'On it.', '👌', 'Cool.']))

  if (any(/^(bye+|goodbye|see ya|see you|later|cya|good ?night|gn|take care|peace|catch you later|laters)$/)) {
    const h = new Date().getHours(); const night = h >= 21 || h < 5
    return r(pick('bye', night
      ? [`Good night${maybeName}.`, 'Night — rest well.', `See you${maybeName}.`, 'Sleep well.']
      : [`See you${maybeName}.`, 'Take care.', 'Later.', 'Catch you later.', 'Have a good one.']))
  }

  if (any(/who are you/, /what are you/, /what can you do/, /what do you do/, /your name/, /introduce yourself/, /tell me about yourself/))
    return r(pick('identity', [
      `I'm Noetica — a local-first AI workspace. Everything runs on your machine: I read and write files, run code, search the web, and build a knowledge graph of our work — without sending your data to the cloud.`,
      `Noetica — your local-first workspace. I run entirely on this device: code, files, web search, and a persistent knowledge graph, all private.`,
    ]), { quickReplies: ['Show my files', 'Research something', 'Write code'] })

  if (any(/are you (local|offline|cloud|online)/, /where (do|does) (you|my data) (run|live|go)/, /is my data (safe|private|stored)/, /\bprivacy\b/, /local[- ]first/, /do you (work )?offline/, /send.*(cloud|anthropic|openai)/))
    return r(pick('privacy', [
      'Local-first — I run entirely on this device. Your data stays here unless you explicitly add a cloud provider key in Settings.',
      'Everything runs on your machine. Nothing leaves it unless you wire up a cloud key yourself in Settings.',
    ]))

  if (any(/^help$/, /^what now$/, /how do i (start|begin)/, /where do i (start|begin)/, /what should i do/, /^commands$/))
    return r(`A few things to try:\n- **"show my files"** — I read your filesystem, locally\n- **"write a python script that…"** — I write it and can run it\n- **"research <topic>"** — I search and summarize\n\nI run locally, so the first model-backed reply may take a moment to warm up.`,
      { quickReplies: ['Show my files', 'Research something', 'Write code'] })

  if (any(/^(you there|are you there|hello\?*|anyone there|knock knock|test|ping)$/))
    return r(pick('wake', ['Here — what do you need?', 'Right here.', 'Listening — go ahead.', 'Yep, here. What’s up?']))

  return null // → generative model
}
