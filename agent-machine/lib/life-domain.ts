/**
 * life-domain — a lightweight TOPIC tagger for everyday/general-life questions, orthogonal to the
 * intent (the task type). Runs intent-independently so a health/finance/legal question gets the right
 * safety framing no matter which lane caught it, and so travel/local questions can reach for fresh info.
 *
 * It is deliberately a cheap keyword classifier (deterministic, no model): it only needs to recognize
 * the handful of domains that change POLICY — safety disclaimers and whether web access helps. Every
 * other everyday topic falls through to the neutral default (a plain, tool-free general-knowledge answer).
 */
export interface LifeDomain {
  domain: string       // health | finance | legal | home_repair | pets | travel | local | everyday
  safetyNote: string   // appended to the system prompt when the domain is regulated-adjacent ('' otherwise)
  needsWeb: boolean    // the answer benefits from fresh/local info → allow web_search
}

const HEALTH = /\b(home remed(y|ies)|symptom|headache|migraine|fever|the flu|a cold|cough|sore throat|nausea|rash|insomnia|first aid|sprain|dosage|how much (ibuprofen|tylenol|advil|medicine)|vitamin|supplement|blood pressure|anxiety|depress|sore muscle|is it safe to (eat|take|drink))\b/i
const FINANCE = /\b(budget|save money|saving for|invest(ing|ment)?|retirement|401\s?k|roth|\bira\b|stocks?|bonds?|\betf\b|mutual fund|credit score|credit card debt|mortgage|interest rate|refinanc|emergency fund|net worth|should i buy)\b/i
const LEGAL = /\b(contract|lease|tenant|landlord|evict|sue|lawsuit|small claims|a will\b|estate plan|power of attorney|custody|divorce|my rights|is it legal|am i liable|liability)\b/i
const HAZARD = /\b(gas (leak|line)|electrical (wiring|panel|outlet)|circuit breaker|live wire|breaker box|240v|main (water|gas) (line|valve)|load[- ]bearing)\b/i
const PETS = /\b(my (dog|cat|puppy|kitten|pet) (is|has|won'?t|keeps)|is .* (safe|toxic|poisonous) for (dogs?|cats?)|\bvet\b|deworm|fleas?|kennel cough)\b/i
const TRAVEL = /\b(travel to|a trip to|flight to|cheap flights?|hotel in|airbnb|itinerary|\bvisa\b|passport|packing (list|for)|things to do in|jet ?lag|layover|currency exchange|tourist|sightsee|best time to visit)\b/i
const LOCAL = /\b(near me|nearby|open now|restaurants? in|cafe in|coffee shop near|directions to|weather (today|tomorrow|this week|right now)|forecast|what'?s the weather|gas (price|station) near)\b/i

export function classifyLifeDomain(query: string): LifeDomain {
  const q = query
  if (HAZARD.test(q)) return { domain: 'home_repair', needsWeb: false, safetyNote: '\n\nSAFETY: For gas, high-voltage electrical, plumbing-main, or structural work, advise the user to hire a licensed professional rather than attempting it themselves.' }
  if (HEALTH.test(q)) return { domain: 'health', needsWeb: false, safetyNote: '\n\nNOTE: Give general wellness information only — you are not a medical professional. For diagnosis, medication or dosing, or any serious or persistent symptom, tell the user to consult a doctor or pharmacist.' }
  if (FINANCE.test(q)) return { domain: 'finance', needsWeb: false, safetyNote: '\n\nNOTE: Explain financial concepts in general terms only — you are not a licensed financial advisor and must not give personalized investment advice. For decisions about their own money, recommend a qualified professional.' }
  if (LEGAL.test(q)) return { domain: 'legal', needsWeb: false, safetyNote: '\n\nNOTE: Provide general legal information only — you are not a lawyer and this is not legal advice. For their specific situation, recommend a licensed attorney in their jurisdiction.' }
  if (PETS.test(q)) return { domain: 'pets', needsWeb: false, safetyNote: '\n\nNOTE: For a sick or injured animal, or anything beyond routine care, tell the user to consult a veterinarian.' }
  if (LOCAL.test(q)) return { domain: 'local', needsWeb: true, safetyNote: '' }
  if (TRAVEL.test(q)) return { domain: 'travel', needsWeb: true, safetyNote: '' }
  return { domain: 'everyday', needsWeb: false, safetyNote: '' }
}
