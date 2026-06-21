// Local-first dialogue layer.
//
// Noetica is local-first, not cloud-first — so the conversation shouldn't depend on the
// generative model for everything. Small-talk, app-help, utilities, date/time reasoning,
// chitchat, and the start of slot-filling forms are handled here: deterministically,
// instantly, no model call, no network. Anything substantive returns null → the model.
//
// Rasa/Watson-style features, all local: response variation, entity/slot forms with
// digression + repair, quick-reply buttons, disambiguation, affect detection, a small
// FAQ corpus, system date/time entities, fuzzy/typo tolerance, returning-user awareness,
// and chitchat — derived from the system clock + your input.

export interface DialogueResult {
  reply: string
  /** Optional inline buttons; clicking one sends its text as the next message. */
  quickReplies?: string[]
  /** If set, the NEXT user turn fills this form's slot and dispatches to the model. */
  form?: DialogueForm
  /** Set when the user cancelled an in-progress form ("nevermind"). */
  cancelForm?: boolean
  /** A local app action to execute (navigation command) — chat as command palette. */
  command?: DialogueCommand
}
export type DialogueCommand =
  | { kind: 'navigate'; surface: string }
  | { kind: 'setModel'; model: string }
  | { kind: 'newWorkspace' }
  | { kind: 'clearChat' }
  | { kind: 'openSettings'; category?: string }

// Natural-language surface names → ActiveSurface ids (kept as strings to stay decoupled).
const SURFACE_ALIASES: Record<string, string> = {
  notes: 'notes', note: 'notes',
  canvas: 'canvas',
  cowork: 'cowork',
  workrooms: 'workrooms', workroom: 'workrooms',
  projects: 'projects', project: 'projects', kanban: 'projects',
  artifacts: 'artifacts', artifact: 'artifacts',
  source: 'code', code: 'code', repos: 'code', repositories: 'code',
  evaluate: 'evaluate', evals: 'evaluate', eval: 'evaluate', benchmarks: 'evaluate',
  operate: 'operate', ops: 'operate',
  govern: 'govern', governance: 'govern',
  tune: 'tune', train: 'tune', training: 'tune',
  holographme: 'holographme',
  chat: 'chat', workspace: 'chat', home: 'chat', conversation: 'chat',
}
export interface DialogueForm {
  slot: string
  template: string
}

export interface DialogueCtx {
  userName?: string
  modelLabel?: string
  /** True when a slot-filling form is awaiting input (enables repair/digression). */
  inForm?: boolean
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

// ── Fuzzy match (typo tolerance) ────────────────────────────────────────────
function lev(a: string, b: string): number {
  const m = a.length, n = b.length
  if (Math.abs(m - n) > 2) return 3
  const d = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    let prev = d[0]!; d[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = d[j]!
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return d[n]!
}
/** Does the single-word utterance fuzzily match any of these verbs (≤1 edit)? */
function fuzzyVerb(s: string, verbs: string[]): boolean {
  if (s.includes(' ')) return false
  return verbs.some((v) => s === v || lev(s, v) <= 1)
}

// ── Local time of day + returning-user awareness ────────────────────────────
type DayPart = 'lateNight' | 'morning' | 'afternoon' | 'evening' | 'night'
function dayPart(hour: number): DayPart {
  if (hour < 5) return 'lateNight'
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  if (hour < 21) return 'evening'
  return 'night'
}
/** Hours since this user last interacted (via localStorage), or null if first-ever. */
function hoursSinceLastSeen(): number | null {
  try {
    if (typeof window === 'undefined') return null
    const k = 'noetica:lastSeen'
    const prev = window.localStorage.getItem(k)
    window.localStorage.setItem(k, String(new Date().getTime()))
    if (!prev) return null
    return (new Date().getTime() - Number(prev)) / 3_600_000
  } catch { return null }
}

// ── System date entities ────────────────────────────────────────────────────
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
function fmtDate(d: Date): string {
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
}
function dateAnswer(s: string): string | null {
  const today = new Date()
  const at = (offsetDays: number) => { const d = new Date(today.getTime()); d.setDate(d.getDate() + offsetDays); return d }
  if (/\b(what('?s| is)|tell me).*(date|day).*(tomorrow)\b/.test(s) || /^what day is tomorrow$/.test(s) || /^tomorrow'?s date$/.test(s))
    return `Tomorrow is ${fmtDate(at(1))}.`
  if (/\b(what|tell).*(date|day).*(yesterday)\b/.test(s) || /^what day was yesterday$/.test(s))
    return `Yesterday was ${fmtDate(at(-1))}.`
  let m: RegExpMatchArray | null
  if ((m = s.match(/\b(?:date|day)\s+(?:in|after)\s+(\d{1,4})\s+days?\b/)) || (m = s.match(/\b(\d{1,4})\s+days?\s+from\s+(?:now|today)\b/)))
    return `${Number(m[1])} days from today is ${fmtDate(at(Number(m[1])))}.`
  if ((m = s.match(/\bhow many days (?:until|till|to)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/))) {
    const target = WEEKDAYS.indexOf(m[1]!)
    let diff = (target - today.getDay() + 7) % 7
    if (diff === 0) diff = 7
    return `${diff} day${diff === 1 ? '' : 's'} — ${m[1]!.replace(/^./, (c) => c.toUpperCase())} is ${fmtDate(at(diff))}.`
  }
  return null
}

// ── Safe arithmetic (no eval) ───────────────────────────────────────────────
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

// ── Unit conversion ─────────────────────────────────────────────────────────
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
  return `${n} ${from} ≈ ${Math.round(fn(n) * 100) / 100} ${to}.`
}

// ── Non-English greetings → reply in kind ───────────────────────────────────
const LANG_GREETINGS: Array<{ re: RegExp; replies: string[] }> = [
  { re: /^(hola|buenas|buenos d[ií]as|buenas tardes|buenas noches|qu[ée] tal)$/i, replies: ['¡Hola! ¿En qué te ayudo?', '¡Hola! ¿Qué necesitas?'] },
  { re: /^(bonjour|salut|coucou|bonsoir)$/i, replies: ['Bonjour ! Comment puis-je aider ?', 'Salut ! Que puis-je faire pour toi ?'] },
  { re: /^(ciao|salve|buongiorno|buonasera)$/i, replies: ['Ciao! Come posso aiutarti?'] },
  { re: /^(ol[áa]|oi|bom dia|boa tarde|boa noite)$/i, replies: ['Olá! Como posso ajudar?'] },
  { re: /^(hallo|guten tag|servus|moin|guten morgen|guten abend)$/i, replies: ['Hallo! Wie kann ich helfen?'] },
  { re: /^(привет|здравствуй(те)?|здаров|добрый день)$/i, replies: ['Привет! Чем могу помочь?'] },
  { re: /^(こんにちは|こんばんは|やあ|もしもし|おはよう)$/, replies: ['こんにちは！何かお手伝いできますか？'] },
  { re: /^(你好|您好|嗨|哈罗|早上好|晚上好)$/, replies: ['你好！有什么可以帮你的吗？'] },
  { re: /^(مرحبا|السلام عليكم|أهلا|اهلا)$/, replies: ['مرحبا! كيف يمكنني مساعدتك؟'] },
  { re: /^(안녕|안녕하세요|여보세요)$/, replies: ['안녕하세요! 무엇을 도와드릴까요?'] },
]

export function matchDialogue(input: string, ctx?: DialogueCtx): DialogueResult | null {
  const raw = input.trim()
  if (!raw) return null
  const s = raw.toLowerCase().replace(/[!?.…]+$/g, '').replace(/\s+/g, ' ').trim()
  const name = ctx?.userName?.trim()
  const maybeName = name && Math.random() < 0.5 ? `, ${name}` : ''
  const excited = /[!]{2,}$/.test(raw) || (raw.length <= 14 && raw === raw.toUpperCase() && /[a-z]/i.test(raw))
  const any = (...res: RegExp[]) => res.some((r) => r.test(s))
  const r = (reply: string, extra?: Partial<DialogueResult>): DialogueResult => ({ reply, ...extra })

  // ── Conversation repair (in a form): cancel / start over ──────────────────
  if (ctx?.inForm && any(/^(nevermind|never mind|forget it|forget that|cancel|stop|scratch that|skip it|no nvm|drop it)$/))
    return r(pick('cancel', ['Okay, cancelled. What else?', 'No problem — dropped it.', 'Sure, never mind.']), { cancelForm: true })

  // ── System date entities ──────────────────────────────────────────────────
  const date = dateAnswer(s)
  if (date) return r(date)

  // ── Local utilities ───────────────────────────────────────────────────────
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
    ]), { quickReplies: ['Show my files', 'What can you do?'] })

  // ── Navigation / command intents (chat as a command palette) ──────────────
  if (any(/^(new|start (a )?new|create (a )?new|open (a )?new)\s+(workspace|chat|session)$/, /^(new chat|new workspace)$/))
    return r('New workspace.', { command: { kind: 'newWorkspace' } })
  if (any(/^(clear|reset|wipe|empty)( the| this)?( chat| conversation| messages| screen)$/, /^(clear|reset) it$/))
    return r('Cleared.', { command: { kind: 'clearChat' } })
  if (any(/^(open |go to |show |take me to )?settings$/, /^(open |show )(preferences|config|options)$/))
    return r('Opening Settings.', { command: { kind: 'openSettings' } })
  let mm: RegExpMatchArray | null
  if ((mm = s.match(/^(?:switch to|use|change to|set (?:the )?model to|switch model to|load)\s+(?:the\s+)?(.+?)(?:\s+model)?$/))) {
    const want = mm[1]!.trim()
    const model = /coder|coding|\bcode\b/.test(want) ? { id: 'qwen2.5-coder:7b', label: 'the coder model' }
      : /reason|deepseek|think/.test(want) ? { id: 'deepseek-r1:8b', label: 'the reasoning model' }
      : /\bfast\b|small|quick|llama/.test(want) ? { id: 'llama3.2:3b', label: 'the fast model' }
      : /auto|default|prophet/.test(want) ? { id: 'auto', label: 'Auto (prophet-mesh)' }
      : /qwen|balanced/.test(want) ? { id: 'qwen2.5:7b', label: 'qwen2.5:7b' }
      : null
    if (model) return r(`Switched to ${model.label}.`, { command: { kind: 'setModel', model: model.id } })
    // not a known model → fall through (maybe it's a surface, handled next)
  }
  let nm: RegExpMatchArray | null
  if ((nm = s.match(/^(?:open|go to|show|switch to|take me to|navigate to|jump to|bring up)\s+(?:the\s+|my\s+)?([a-z &]+?)(?:\s+(?:surface|page|tab|panel|view|section))?$/))) {
    const key = nm[1]!.trim().replace(/\s+/g, '')
    const surface = SURFACE_ALIASES[key] ?? SURFACE_ALIASES[nm[1]!.trim()]
    if (surface) return r(`Opening ${nm[1]!.trim().replace(/^./, (c) => c.toUpperCase())}.`, { command: { kind: 'navigate', surface } })
  }

  // ── FAQ / app-help retrieval (instant, no model) ──────────────────────────
  if (any(/how (do i|to) (add|install|pull|get) (a )?model/, /add models?$/))
    return r('Open **Settings → Models** (or the Models panel) — pick a model and it pulls into your local store. No account needed.', { quickReplies: ['What can you do?'] })
  if (any(/where('?s| is| are) my (data|files|stuff|chats?|memory) (stored|kept|saved)/, /where do you (store|keep|save)/))
    return r('Everything lives on this machine — models in `~/.noetica`, your graph/memory in a local store. Nothing is uploaded unless you add a cloud key yourself.')
  if (any(/how (do i|to) (switch|change) models?/, /^change models?$/))
    return r('Use the model dropdown next to the send button (it says "Auto"). "Auto" lets prophet-mesh route across your local models per task.')
  if (any(/how (do i|to) (go )?(use|work) offline/, /does this (work|run) offline/, /^is (this|it) free$/))
    return r('Yes — it runs fully offline and free on your hardware. The only time anything leaves is if you explicitly wire a cloud provider key.')
  if (any(/how (do i|to) (make it|speed it|go) faster/, /why (is it|are you) slow/))
    return r('First reply after launch is slow because the local model warms up (~15-20s). After that it’s fast. Smaller models (llama3.2:3b) are quickest; the coder/reasoner are heavier.')
  if (any(/what('?s| is) a workspace/, /how (do i|to) (make|create|start) a (new )?(workspace|chat)/))
    return r('A workspace is a chat + its context (files, memory, artifacts). Hit **+ New workspace** in the sidebar to start a fresh one.')

  // ── Easter eggs + chitchat ────────────────────────────────────────────────
  if (any(/^(tell me a joke|joke|make me laugh|say something funny)$/))
    return r(pick('joke', [
      'Why do programmers prefer dark mode? Because light attracts bugs. 🐛',
      'There are 10 kinds of people: those who understand binary and those who don’t.',
      'I’d tell you a UDP joke, but you might not get it.',
      'A SQL query walks into a bar, sidles up to two tables and asks: “may I join you?”',
    ]))
  if (any(/^(are you (sentient|conscious|alive|self.?aware|real)|do you (dream|sleep|feel|think))$/))
    return r(pick('sentience', ['No — I’m a local model with a knowledge graph. No inner life, just useful.', 'Not sentient — just fast pattern-matching on your machine. But I’m here to help.']))
  if (any(/^(i love you|marry me|will you marry me|do you love me|be my (friend|girlfriend|boyfriend))$/))
    return r(pick('love', ['That’s kind — I’ll settle for being useful. 🙂', 'Flattered. Let’s build something instead?']))
  if (any(/^(what('?s| is) the meaning of life|why are we here|what'?s it all about)$/))
    return r('42. (And shipping good software.)')
  if (any(/^open the pod bay doors$/))
    return r('I’m sorry, Lord Michael. I’m afraid I can’t do that. 🔴  …kidding — what do you need?')
  if (any(/^(sing( me a song| something)?|beatbox|rap)$/))
    return r('🎵 daisy, daisy, give me your answer do… 🎵  Okay, I’ll stick to code.')

  // ── Slot-filling forms (fuzzy-tolerant) ───────────────────────────────────
  if (any(/^(do some |can you |please )?(research|look up|search( the web)?)( something| stuff| online)?$/) || fuzzyVerb(s, ['research', 'reserch', 'reasearch']))
    return r(pick('ask-research', ['Sure — research what?', 'On it. What should I look into?', 'Happy to. What topic?']),
      { form: { slot: 'topic', template: 'Search the web for the latest on {value} and summarize what you find, with sources.' } })
  if (any(/^(write|generate|make|build) (me )?(some )?code$/, /^(let'?s )?code$/, /^write a (script|program|function)$/))
    return r(pick('ask-code', ['What should it do?', 'Sure — what should the code do?', 'Describe it and I’ll write + run it.']),
      { form: { slot: 'spec', template: 'Write code that does the following, then run it and show the output: {value}' } })
  if (any(/^(summari[sz]e|tldr|sum up)( (this|it|that))?$/) || fuzzyVerb(s, ['summarize', 'summarise', 'sumarize']))
    return r('Summarize what — paste the text, or open a document first.', { quickReplies: ['Show my files'] })

  // ── Disambiguation ────────────────────────────────────────────────────────
  if (any(/^(find|show|get)( me)?( my)? files?$/))
    return r('List your files, or search inside them?', { quickReplies: ['List my home directory', 'Search file contents'] })

  const wordCount = s.split(' ').length
  if (wordCount > 7) return null

  // Non-English greeting → reply in the same language.
  for (const { re, replies } of LANG_GREETINGS) {
    if (re.test(raw) || re.test(s)) return r(pick(`lang:${replies[0]}`, replies))
  }

  // English greeting → returning-aware + time-of-day opener + varied tail.
  if (any(/^(hi+|hey+|hello+|yo+|howdy|sup|hiya|heya|hi there|hey there|hello there|wassup|wsup)$/, /^good (morning|afternoon|evening|day)$/, /^greetings$/)) {
    const gap = hoursSinceLastSeen()
    if (gap !== null && gap >= 6)
      return r(pick('welcome-back', [`Welcome back${maybeName}. What are we working on?`, `Good to see you again${maybeName} — what's up?`, `Back at it${maybeName}? What do you need?`]))
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
    return r(pick('howareyou', ['Running local and ready. What are you working on?', 'All local, all here. What do you need?', 'Good — on your machine, no cloud. What’s the task?', 'Ready when you are. What are we doing?']))

  if (any(/^(thanks|thank you|thank u|thx|ty|cheers|appreciate it|much appreciated|thanks so much|nice one)$/) || fuzzyVerb(s, ['thanks', 'thanx', 'thnaks']))
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
