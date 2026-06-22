/**
 * text-normalize — proper lexical normalization (Porter stemmer + a real stopwords dictionary),
 * replacing the ad-hoc length-filters and tiny hand-rolled stopword sets scattered across the
 * lexical paths (study-brain rerank, concept-defs, extractive-qa). Zero-dep (local-first).
 *
 * stem() is the classic Porter (1980) algorithm — the foundation of the Snowball English stemmer —
 * so "selection"/"selecting"/"selected" all match "select". Deterministic and well-tested.
 */

// A proper English stopwords dictionary (NLTK-style core list + contraction stems).
export const STOPWORDS = new Set<string>([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren',
  'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'cannot', 'could', 'couldn', 'did', 'didn', 'do', 'does', 'doesn', 'doing', 'don', 'down',
  'during', 'each', 'few', 'for', 'from', 'further', 'had', 'hadn', 'has', 'hasn', 'have', 'haven',
  'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'i', 'if', 'in',
  'into', 'is', 'isn', 'it', 'its', 'itself', 'just', 'let', 'me', 'more', 'most', 'mustn', 'my',
  'myself', 'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought',
  'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'shan', 'she', 'should', 'shouldn', 'so',
  'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there',
  'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was',
  'wasn', 'we', 'were', 'weren', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why',
  'will', 'with', 'won', 'would', 'wouldn', 'you', 'your', 'yours', 'yourself', 'yourselves',
  's', 't', 'will', 'don', 'should', 'now', 'd', 'll', 'm', 'o', 're', 've', 'y', 'also', 'one',
])

const step2 = { ational: 'ate', tional: 'tion', enci: 'ence', anci: 'ance', izer: 'ize', bli: 'ble', alli: 'al', entli: 'ent', eli: 'e', ousli: 'ous', ization: 'ize', ation: 'ate', ator: 'ate', alism: 'al', iveness: 'ive', fulness: 'ful', ousness: 'ous', aliti: 'al', iviti: 'ive', biliti: 'ble', logi: 'log' } as Record<string, string>
const step3 = { icate: 'ic', ative: '', alize: 'al', iciti: 'ic', ical: 'ic', ful: '', ness: '' } as Record<string, string>
const c = '[^aeiou]', v = '[aeiouy]', C = c + '[^aeiouy]*', V = v + '[aeiou]*'
const mgr0 = new RegExp('^(' + C + ')?' + V + C)
const meq1 = new RegExp('^(' + C + ')?' + V + C + '(' + V + ')?$')
const mgr1 = new RegExp('^(' + C + ')?' + V + C + V + C)
const sv = new RegExp('^(' + C + ')?' + v)

/** Porter stemmer (1980) — the standard English stemmer. */
export function stem(w: string): string {
  if (w.length < 3) return w
  let word = w
  const first = word[0]!
  if (first === 'y') word = 'Y' + word.substr(1)
  let re: RegExp, re2: RegExp, re3: RegExp, re4: RegExp, fp: RegExpExecArray | null, st: string, sfx: string

  re = /^(.+?)(ss|i)es$/; re2 = /^(.+?)([^s])s$/
  if (re.test(word)) word = word.replace(re, '$1$2')
  else if (re2.test(word)) word = word.replace(re2, '$1$2')

  re = /^(.+?)eed$/; re2 = /^(.+?)(ed|ing)$/
  if (re.test(word)) { fp = re.exec(word); if (fp && mgr0.test(fp[1]!)) word = word.replace(/.$/, '') }
  else if (re2.test(word)) {
    fp = re2.exec(word); st = fp![1]!
    if (sv.test(st)) {
      word = st
      re2 = /(at|bl|iz)$/; re3 = /([^aeiouylsz])\1$/; re4 = new RegExp('^' + C + v + '[^aeiouwxy]$')
      if (re2.test(word)) word = word + 'e'
      else if (re3.test(word)) word = word.replace(/.$/, '')
      else if (re4.test(word)) word = word + 'e'
    }
  }

  re = /^(.+?)y$/
  if (re.test(word)) { fp = re.exec(word); st = fp![1]!; if (sv.test(st)) word = st + 'i' }

  re = /^(.+?)(ational|tional|enci|anci|izer|bli|alli|entli|eli|ousli|ization|ation|ator|alism|iveness|fulness|ousness|aliti|iviti|biliti|logi)$/
  if (re.test(word)) { fp = re.exec(word); st = fp![1]!; sfx = fp![2]!; if (mgr0.test(st)) word = st + step2[sfx] }

  re = /^(.+?)(icate|ative|alize|iciti|ical|ful|ness)$/
  if (re.test(word)) { fp = re.exec(word); st = fp![1]!; sfx = fp![2]!; if (mgr0.test(st)) word = st + step3[sfx] }

  re = /^(.+?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize)$/; re2 = /^(.+?)(s|t)(ion)$/
  if (re.test(word)) { fp = re.exec(word); st = fp![1]!; if (mgr1.test(st)) word = st }
  else if (re2.test(word)) { fp = re2.exec(word); st = fp![1]! + fp![2]!; if (mgr1.test(st)) word = st }

  re = /^(.+?)e$/
  if (re.test(word)) { fp = re.exec(word); st = fp![1]!; re3 = new RegExp('^' + C + v + '[^aeiouwxy]$'); if (mgr1.test(st) || (meq1.test(st) && !re3.test(st))) word = st }
  if (/ll$/.test(word) && mgr1.test(word)) word = word.replace(/.$/, '')

  if (first === 'y') word = 'y' + word.substr(1)
  return word
}

export function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
}

export function isStopword(w: string): boolean { return STOPWORDS.has(w.toLowerCase()) }

/** Tokenize → drop stopwords → stem. The canonical query/document term representation. */
export function normalizeTerms(text: string, opts: { minLen?: number } = {}): string[] {
  const minLen = opts.minLen ?? 2
  const out: string[] = []
  for (const t of tokenize(text)) {
    if (t.length < minLen || STOPWORDS.has(t)) continue
    out.push(stem(t))
  }
  return out
}

/** Stemmed, stopword-free term SET — for overlap/Jaccard scoring. */
export function termSet(text: string): Set<string> { return new Set(normalizeTerms(text)) }
