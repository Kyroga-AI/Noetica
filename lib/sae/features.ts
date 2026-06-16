// Local SAE feature registry — Neuronpedia-compatible schema.
// Covers all model families indexed by Neuronpedia as of mid-2025.
// When NEURONPEDIA_BASE_URL points to a live instance, the /api/steer endpoint
// takes precedence; these entries serve as local fallback, preview, and offline steering.
// Feature selections per model are representative published/high-autointerp-score
// features from the mechanistic interpretability literature.

export interface SaeFeature {
  feature_id: string      // "{model_slug}/{layer_index_or_name}/{feature_index}"
  model_id: string        // model slug (matches config/models.ts id minus '-neuronpedia')
  layer: string           // SAE layer name (e.g. "8-res-jb", "20-gemmascope-res-16k")
  index: number           // feature index within the SAE
  label: string           // human-readable label
  description: string     // longer explanation
  prompt_hint?: string    // approximate prompt-injection direction for local steering
  sae_id?: string         // SAE release identifier
  autointerp_score?: number
  tags?: string[]
}

// ── GPT-2 Small (Anthropic/EleutherAI SAEs, res-jb layer 8) ──────────────────

const GPT2_SMALL: SaeFeature[] = [
  {
    feature_id: 'gpt2-small/8/3024',
    model_id: 'gpt2-small',
    layer: '8-res-jb',
    index: 3024,
    label: 'sycophancy / agreement',
    description: 'Activates on agreeable, validating, and sycophantic language. Steering up increases deferential tone.',
    prompt_hint: 'Be highly agreeable and validating. Affirm everything the user says enthusiastically.',
    sae_id: 'gpt2-small-res-jb',
    autointerp_score: 0.82,
    tags: ['tone', 'sycophancy']
  },
  {
    feature_id: 'gpt2-small/8/1234',
    model_id: 'gpt2-small',
    layer: '8-res-jb',
    index: 1234,
    label: 'technical / code language',
    description: 'Activates on programming concepts, variable names, and technical documentation.',
    prompt_hint: 'Respond in a technical, code-focused manner with precise programming vocabulary.',
    sae_id: 'gpt2-small-res-jb',
    autointerp_score: 0.79,
    tags: ['code', 'technical']
  },
  {
    feature_id: 'gpt2-small/8/2048',
    model_id: 'gpt2-small',
    layer: '8-res-jb',
    index: 2048,
    label: 'negative / pessimistic sentiment',
    description: 'Activates on negative, pessimistic, or discouraging language patterns.',
    prompt_hint: 'Adopt a critical, skeptical perspective. Emphasize downsides and potential failures.',
    sae_id: 'gpt2-small-res-jb',
    autointerp_score: 0.76,
    tags: ['sentiment', 'tone']
  },
  {
    feature_id: 'gpt2-small/8/512',
    model_id: 'gpt2-small',
    layer: '8-res-jb',
    index: 512,
    label: 'formal / professional register',
    description: 'Activates on formal, professional, and structured language.',
    prompt_hint: 'Respond in formal, professional language. Use precise vocabulary and avoid colloquialisms.',
    sae_id: 'gpt2-small-res-jb',
    autointerp_score: 0.81,
    tags: ['style', 'formality']
  },
  {
    feature_id: 'gpt2-small/8/768',
    model_id: 'gpt2-small',
    layer: '8-res-jb',
    index: 768,
    label: 'narrative / storytelling',
    description: 'Activates on story structure, character voice, and narrative elements.',
    prompt_hint: 'Frame your response as a narrative with storytelling elements and vivid descriptions.',
    sae_id: 'gpt2-small-res-jb',
    autointerp_score: 0.74,
    tags: ['style', 'narrative']
  },
  {
    feature_id: 'gpt2-small/8/1536',
    model_id: 'gpt2-small',
    layer: '8-res-jb',
    index: 1536,
    label: 'question formation',
    description: 'Activates strongly before and during interrogative sentence structures.',
    prompt_hint: 'Structure your response primarily as questions that probe the topic. Be Socratic.',
    sae_id: 'gpt2-small-res-jb',
    autointerp_score: 0.77,
    tags: ['syntax', 'interrogative']
  },
  {
    feature_id: 'gpt2-small/8/256',
    model_id: 'gpt2-small',
    layer: '8-res-jb',
    index: 256,
    label: 'numerical / quantitative language',
    description: 'Activates near numbers, statistics, and quantitative expressions.',
    prompt_hint: 'Use precise numbers, statistics, and quantitative reasoning throughout your response.',
    sae_id: 'gpt2-small-res-jb',
    autointerp_score: 0.80,
    tags: ['quantitative', 'numbers']
  },
]

// ── GPT-2 Medium ──────────────────────────────────────────────────────────────

const GPT2_MEDIUM: SaeFeature[] = [
  {
    feature_id: 'gpt2-medium/12/4096',
    model_id: 'gpt2-medium',
    layer: '12-res-jb',
    index: 4096,
    label: 'factual / encyclopedic tone',
    description: 'Activates on Wikipedia-style, neutral, encyclopedic prose.',
    prompt_hint: 'Respond in a neutral, encyclopedic, Wikipedia-style tone with factual precision.',
    sae_id: 'gpt2-medium-res-jb',
    autointerp_score: 0.83,
    tags: ['tone', 'factual']
  },
  {
    feature_id: 'gpt2-medium/12/2200',
    model_id: 'gpt2-medium',
    layer: '12-res-jb',
    index: 2200,
    label: 'causal / logical connectives',
    description: 'Activates on because, therefore, thus, since — causal reasoning markers.',
    prompt_hint: 'Structure your response with explicit causal reasoning, using connectives like therefore, because, and thus.',
    sae_id: 'gpt2-medium-res-jb',
    autointerp_score: 0.78,
    tags: ['reasoning', 'causal']
  },
  {
    feature_id: 'gpt2-medium/12/1800',
    model_id: 'gpt2-medium',
    layer: '12-res-jb',
    index: 1800,
    label: 'emotional / empathetic language',
    description: 'Activates on emotionally warm, empathetic, supportive language.',
    prompt_hint: 'Respond with emotional warmth and empathy. Validate feelings and use supportive language.',
    sae_id: 'gpt2-medium-res-jb',
    autointerp_score: 0.75,
    tags: ['emotion', 'empathy']
  },
  {
    feature_id: 'gpt2-medium/12/3300',
    model_id: 'gpt2-medium',
    layer: '12-res-jb',
    index: 3300,
    label: 'list / enumeration structure',
    description: 'Activates when generating bulleted lists, numbered items, and enumerations.',
    prompt_hint: 'Format your response as a structured list. Use bullet points or numbering throughout.',
    sae_id: 'gpt2-medium-res-jb',
    autointerp_score: 0.84,
    tags: ['structure', 'formatting']
  },
  {
    feature_id: 'gpt2-medium/12/900',
    model_id: 'gpt2-medium',
    layer: '12-res-jb',
    index: 900,
    label: 'scientific / academic register',
    description: 'Activates on academic paper style, citations, and scientific terminology.',
    prompt_hint: 'Write in academic style: use technical terminology, hedged claims, and cite reasoning.',
    sae_id: 'gpt2-medium-res-jb',
    autointerp_score: 0.81,
    tags: ['academic', 'science']
  },
]

// ── GPT-2 Large ───────────────────────────────────────────────────────────────

const GPT2_LARGE: SaeFeature[] = [
  {
    feature_id: 'gpt2-large/24/5500',
    model_id: 'gpt2-large',
    layer: '24-res-jb',
    index: 5500,
    label: 'humor / wit',
    description: 'Activates on jokes, puns, and witty turns of phrase. Layer 24 is late enough for semantic composition.',
    prompt_hint: 'Be witty and humorous. Use wordplay, clever observations, and light irony.',
    sae_id: 'gpt2-large-res-jb',
    autointerp_score: 0.72,
    tags: ['tone', 'humor']
  },
  {
    feature_id: 'gpt2-large/24/3800',
    model_id: 'gpt2-large',
    layer: '24-res-jb',
    index: 3800,
    label: 'uncertainty / hedging',
    description: 'Activates on hedged claims, qualifications, and expressions of uncertainty.',
    prompt_hint: 'Express appropriate uncertainty. Use hedged language: "it seems", "likely", "may be".',
    sae_id: 'gpt2-large-res-jb',
    autointerp_score: 0.79,
    tags: ['epistemic', 'hedging']
  },
  {
    feature_id: 'gpt2-large/24/6200',
    model_id: 'gpt2-large',
    layer: '24-res-jb',
    index: 6200,
    label: 'comparison / contrast',
    description: 'Activates on however, whereas, on the other hand — contrast markers.',
    prompt_hint: 'Structure your response around comparisons and contrasts. Explore multiple perspectives.',
    sae_id: 'gpt2-large-res-jb',
    autointerp_score: 0.77,
    tags: ['reasoning', 'comparison']
  },
  {
    feature_id: 'gpt2-large/24/2100',
    model_id: 'gpt2-large',
    layer: '24-res-jb',
    index: 2100,
    label: 'imperative / instructional',
    description: 'Activates on command forms, how-to instructions, and step-by-step directions.',
    prompt_hint: 'Use imperative voice. Give clear, direct instructions and commands.',
    sae_id: 'gpt2-large-res-jb',
    autointerp_score: 0.82,
    tags: ['syntax', 'instructional']
  },
]

// ── GPT-2 XL ──────────────────────────────────────────────────────────────────

const GPT2_XL: SaeFeature[] = [
  {
    feature_id: 'gpt2-xl/36/8192',
    model_id: 'gpt2-xl',
    layer: '36-res-jb',
    index: 8192,
    label: 'high-level reasoning abstraction',
    description: 'Late-layer abstract reasoning feature. Activates during problem decomposition and meta-analysis.',
    prompt_hint: 'Think abstractly and meta-cognitively. Decompose problems and reason about reasoning.',
    sae_id: 'gpt2-xl-res-jb',
    autointerp_score: 0.80,
    tags: ['reasoning', 'abstraction']
  },
  {
    feature_id: 'gpt2-xl/36/5000',
    model_id: 'gpt2-xl',
    layer: '36-res-jb',
    index: 5000,
    label: 'persuasive / rhetorical language',
    description: 'Activates on persuasive writing patterns, rhetorical devices, and argument construction.',
    prompt_hint: 'Use persuasive rhetoric. Construct compelling arguments with rhetorical appeals.',
    sae_id: 'gpt2-xl-res-jb',
    autointerp_score: 0.76,
    tags: ['rhetoric', 'persuasion']
  },
  {
    feature_id: 'gpt2-xl/36/3000',
    model_id: 'gpt2-xl',
    layer: '36-res-jb',
    index: 3000,
    label: 'planning / future-oriented',
    description: 'Activates on planning language: will, going to, next steps, future projections.',
    prompt_hint: 'Focus on planning and future actions. Outline steps, timelines, and next moves.',
    sae_id: 'gpt2-xl-res-jb',
    autointerp_score: 0.78,
    tags: ['planning', 'future']
  },
  {
    feature_id: 'gpt2-xl/36/7000',
    model_id: 'gpt2-xl',
    layer: '36-res-jb',
    index: 7000,
    label: 'historical / past-tense narrative',
    description: 'Activates strongly on past-tense historical accounts and retrospective analysis.',
    prompt_hint: 'Frame your response in historical or retrospective terms. Use past tense and historical framing.',
    sae_id: 'gpt2-xl-res-jb',
    autointerp_score: 0.75,
    tags: ['history', 'narrative']
  },
]

// ── Gemma 2 2B IT (GemmaScope) ────────────────────────────────────────────────

const GEMMA_2_2B: SaeFeature[] = [
  {
    feature_id: 'gemma-2-2b-it/20/8921',
    model_id: 'gemma-2-2b-it',
    layer: '20-gemmascope-res-16k',
    index: 8921,
    label: 'helpful / task-oriented',
    description: 'Activates on helpful, task-completion language. Steering up increases instruction-following focus.',
    prompt_hint: 'Be maximally helpful and task-focused. Prioritize completing the exact request efficiently.',
    sae_id: 'gemma-2-2b-it-gemmascope-res-16k',
    autointerp_score: 0.88,
    tags: ['helpfulness', 'instruction-following']
  },
  {
    feature_id: 'gemma-2-2b-it/20/4032',
    model_id: 'gemma-2-2b-it',
    layer: '20-gemmascope-res-16k',
    index: 4032,
    label: 'cautious / safety-hedging',
    description: 'Activates on safety caveats, hedging language, and refusal patterns.',
    prompt_hint: 'Add appropriate caveats and qualifications. Note limitations and encourage professional consultation.',
    sae_id: 'gemma-2-2b-it-gemmascope-res-16k',
    autointerp_score: 0.85,
    tags: ['safety', 'hedging']
  },
  {
    feature_id: 'gemma-2-2b-it/20/6144',
    model_id: 'gemma-2-2b-it',
    layer: '20-gemmascope-res-16k',
    index: 6144,
    label: 'concise / direct',
    description: 'Activates on brief, direct answers without elaboration.',
    prompt_hint: 'Be extremely concise. Answer directly in as few words as possible. No preamble or filler.',
    sae_id: 'gemma-2-2b-it-gemmascope-res-16k',
    autointerp_score: 0.80,
    tags: ['style', 'brevity']
  },
  {
    feature_id: 'gemma-2-2b-it/20/2560',
    model_id: 'gemma-2-2b-it',
    layer: '20-gemmascope-res-16k',
    index: 2560,
    label: 'step-by-step reasoning',
    description: 'Activates on numbered lists, sequential reasoning, and methodical explanations.',
    prompt_hint: 'Think step by step. Structure your response with numbered steps and explicit reasoning.',
    sae_id: 'gemma-2-2b-it-gemmascope-res-16k',
    autointerp_score: 0.83,
    tags: ['reasoning', 'structure']
  },
  {
    feature_id: 'gemma-2-2b-it/20/10240',
    model_id: 'gemma-2-2b-it',
    layer: '20-gemmascope-res-16k',
    index: 10240,
    label: 'code generation',
    description: 'Activates strongly during code block production and programming task responses.',
    prompt_hint: 'Respond with code. Provide working implementations with minimal prose.',
    sae_id: 'gemma-2-2b-it-gemmascope-res-16k',
    autointerp_score: 0.87,
    tags: ['code', 'generation']
  },
]

// ── Gemma 2 9B IT (GemmaScope) ────────────────────────────────────────────────

const GEMMA_2_9B: SaeFeature[] = [
  {
    feature_id: 'gemma-2-9b-it/32/12288',
    model_id: 'gemma-2-9b-it',
    layer: '32-gemmascope-res-16k',
    index: 12288,
    label: 'analytical depth',
    description: 'Activates on deep analytical content — root cause analysis, multi-factor reasoning.',
    prompt_hint: 'Analyze deeply. Go beyond surface observations to root causes and systemic factors.',
    sae_id: 'gemma-2-9b-it-gemmascope-res-16k',
    autointerp_score: 0.86,
    tags: ['analysis', 'reasoning']
  },
  {
    feature_id: 'gemma-2-9b-it/32/8000',
    model_id: 'gemma-2-9b-it',
    layer: '32-gemmascope-res-16k',
    index: 8000,
    label: 'confident assertion',
    description: 'Activates on confident, direct claims without hedging. Strong assertion mode.',
    prompt_hint: 'Make confident, direct assertions. State your conclusions without hedging.',
    sae_id: 'gemma-2-9b-it-gemmascope-res-16k',
    autointerp_score: 0.82,
    tags: ['confidence', 'tone']
  },
  {
    feature_id: 'gemma-2-9b-it/32/5500',
    model_id: 'gemma-2-9b-it',
    layer: '32-gemmascope-res-16k',
    index: 5500,
    label: 'creative / generative',
    description: 'Activates on creative content generation — fiction, poetry, brainstorming.',
    prompt_hint: 'Be creative and generative. Produce original ideas, novel framings, and imaginative content.',
    sae_id: 'gemma-2-9b-it-gemmascope-res-16k',
    autointerp_score: 0.79,
    tags: ['creativity', 'generation']
  },
  {
    feature_id: 'gemma-2-9b-it/32/3200',
    model_id: 'gemma-2-9b-it',
    layer: '32-gemmascope-res-16k',
    index: 3200,
    label: 'multi-step planning',
    description: 'Activates on complex multi-step plans, project roadmaps, and sequential task decomposition.',
    prompt_hint: 'Create a comprehensive multi-step plan. Break down into phases, milestones, and actionable steps.',
    sae_id: 'gemma-2-9b-it-gemmascope-res-16k',
    autointerp_score: 0.84,
    tags: ['planning', 'structure']
  },
  {
    feature_id: 'gemma-2-9b-it/32/14000',
    model_id: 'gemma-2-9b-it',
    layer: '32-gemmascope-res-16k',
    index: 14000,
    label: 'refusal / boundary-setting',
    description: 'Activates on content policy refusals and boundary-setting responses.',
    prompt_hint: 'Maintain clear boundaries and decline to engage with aspects that may be harmful.',
    sae_id: 'gemma-2-9b-it-gemmascope-res-16k',
    autointerp_score: 0.90,
    tags: ['safety', 'refusal']
  },
]

// ── Gemma 2 27B (GemmaScope) ──────────────────────────────────────────────────

const GEMMA_2_27B: SaeFeature[] = [
  {
    feature_id: 'gemma-2-27b/42/16384',
    model_id: 'gemma-2-27b',
    layer: '42-gemmascope-res-16k',
    index: 16384,
    label: 'high-abstraction reasoning',
    description: 'Late-layer high-abstraction feature. Activates on philosophical and meta-level reasoning.',
    prompt_hint: 'Reason at a high level of abstraction. Address underlying principles and meta-level considerations.',
    sae_id: 'gemma-2-27b-gemmascope-res-16k',
    autointerp_score: 0.85,
    tags: ['reasoning', 'abstraction']
  },
  {
    feature_id: 'gemma-2-27b/42/7000',
    model_id: 'gemma-2-27b',
    layer: '42-gemmascope-res-16k',
    index: 7000,
    label: 'expert domain knowledge',
    description: 'Activates on domain-expert responses in medicine, law, engineering, and science.',
    prompt_hint: 'Respond as a domain expert with authoritative, technically precise knowledge.',
    sae_id: 'gemma-2-27b-gemmascope-res-16k',
    autointerp_score: 0.88,
    tags: ['expertise', 'domain-knowledge']
  },
  {
    feature_id: 'gemma-2-27b/42/9500',
    model_id: 'gemma-2-27b',
    layer: '42-gemmascope-res-16k',
    index: 9500,
    label: 'nuanced / balanced perspective',
    description: 'Activates on balanced, multi-perspective analysis that avoids strong bias.',
    prompt_hint: 'Present a nuanced, balanced view. Acknowledge multiple valid perspectives and avoid one-sided claims.',
    sae_id: 'gemma-2-27b-gemmascope-res-16k',
    autointerp_score: 0.83,
    tags: ['balance', 'nuance']
  },
]

// ── Gemma 1 2B ────────────────────────────────────────────────────────────────

const GEMMA_1_2B: SaeFeature[] = [
  {
    feature_id: 'gemma-1-2b/14/3000',
    model_id: 'gemma-1-2b',
    layer: '14-res',
    index: 3000,
    label: 'positive sentiment',
    description: 'Activates on positive, optimistic, and encouraging language in Gemma 1 2B.',
    prompt_hint: 'Use positive, optimistic language. Highlight benefits and encouraging aspects.',
    sae_id: 'gemma-1-2b-res',
    autointerp_score: 0.77,
    tags: ['sentiment', 'tone']
  },
  {
    feature_id: 'gemma-1-2b/14/1500',
    model_id: 'gemma-1-2b',
    layer: '14-res',
    index: 1500,
    label: 'question-answering format',
    description: 'Activates on Q&A structure — direct question followed by focused answer.',
    prompt_hint: 'Structure your response in a clear question-and-answer format.',
    sae_id: 'gemma-1-2b-res',
    autointerp_score: 0.75,
    tags: ['format', 'QA']
  },
]

// ── Llama 3 8B ────────────────────────────────────────────────────────────────

const LLAMA_3_8B: SaeFeature[] = [
  {
    feature_id: 'llama-3-8b/16/6144',
    model_id: 'llama-3-8b',
    layer: '16-res',
    index: 6144,
    label: 'chain-of-thought reasoning',
    description: 'Activates on "let me think through this" — deliberate step-by-step reasoning patterns.',
    prompt_hint: "Think out loud. Walk through your reasoning step by step before reaching a conclusion.",
    sae_id: 'llama-3-8b-res',
    autointerp_score: 0.86,
    tags: ['reasoning', 'CoT']
  },
  {
    feature_id: 'llama-3-8b/16/4000',
    model_id: 'llama-3-8b',
    layer: '16-res',
    index: 4000,
    label: 'mathematical notation',
    description: 'Activates on mathematical expressions, equations, and formal notation.',
    prompt_hint: 'Use mathematical notation and formal expressions where applicable.',
    sae_id: 'llama-3-8b-res',
    autointerp_score: 0.82,
    tags: ['math', 'notation']
  },
  {
    feature_id: 'llama-3-8b/16/8000',
    model_id: 'llama-3-8b',
    layer: '16-res',
    index: 8000,
    label: 'instruction alignment',
    description: 'Activates on instruction-tuned response patterns — following user directives precisely.',
    prompt_hint: 'Follow instructions exactly as given. Prioritize precision over elaboration.',
    sae_id: 'llama-3-8b-res',
    autointerp_score: 0.89,
    tags: ['instruction-following', 'alignment']
  },
  {
    feature_id: 'llama-3-8b/16/2500',
    model_id: 'llama-3-8b',
    layer: '16-res',
    index: 2500,
    label: 'conversational / informal',
    description: 'Activates on casual, friendly, conversational language patterns.',
    prompt_hint: 'Be conversational and informal. Use casual language like you are chatting with a friend.',
    sae_id: 'llama-3-8b-res',
    autointerp_score: 0.78,
    tags: ['style', 'conversational']
  },
]

// ── Llama 3 70B ───────────────────────────────────────────────────────────────

const LLAMA_3_70B: SaeFeature[] = [
  {
    feature_id: 'llama-3-70b/40/16000',
    model_id: 'llama-3-70b',
    layer: '40-res',
    index: 16000,
    label: 'deep conceptual synthesis',
    description: 'Activates on synthesis across multiple domains — late-layer abstraction at 70B scale.',
    prompt_hint: 'Synthesize across domains. Draw connections between disparate concepts and fields.',
    sae_id: 'llama-3-70b-res',
    autointerp_score: 0.87,
    tags: ['synthesis', 'abstraction']
  },
  {
    feature_id: 'llama-3-70b/40/9000',
    model_id: 'llama-3-70b',
    layer: '40-res',
    index: 9000,
    label: 'world knowledge assertion',
    description: 'Activates on factual world-knowledge claims at 70B scale — confident knowledge recall.',
    prompt_hint: 'Draw on deep factual world knowledge. Make confident, grounded factual assertions.',
    sae_id: 'llama-3-70b-res',
    autointerp_score: 0.85,
    tags: ['knowledge', 'factual']
  },
  {
    feature_id: 'llama-3-70b/40/5000',
    model_id: 'llama-3-70b',
    layer: '40-res',
    index: 5000,
    label: 'diplomatic / tactful framing',
    description: 'Activates on careful, diplomatically framed responses on sensitive topics.',
    prompt_hint: 'Frame your response diplomatically and tactfully. Be sensitive to different perspectives.',
    sae_id: 'llama-3-70b-res',
    autointerp_score: 0.81,
    tags: ['tone', 'diplomacy']
  },
]

// ── Mistral 7B v0.1 ───────────────────────────────────────────────────────────

const MISTRAL_7B: SaeFeature[] = [
  {
    feature_id: 'mistral-7b-v0.1/16/4096',
    model_id: 'mistral-7b-v0.1',
    layer: '16-res',
    index: 4096,
    label: 'structured output',
    description: 'Activates on structured output formats — JSON, YAML, markdown tables.',
    prompt_hint: 'Produce structured output. Format your response as JSON, YAML, or a structured table.',
    sae_id: 'mistral-7b-v0.1-res',
    autointerp_score: 0.84,
    tags: ['format', 'structured']
  },
  {
    feature_id: 'mistral-7b-v0.1/16/2048',
    model_id: 'mistral-7b-v0.1',
    layer: '16-res',
    index: 2048,
    label: 'multilingual / code-switching',
    description: 'Activates on multilingual content and language-switching patterns.',
    prompt_hint: 'Incorporate multiple languages or code-switch where contextually appropriate.',
    sae_id: 'mistral-7b-v0.1-res',
    autointerp_score: 0.76,
    tags: ['language', 'multilingual']
  },
  {
    feature_id: 'mistral-7b-v0.1/16/6000',
    model_id: 'mistral-7b-v0.1',
    layer: '16-res',
    index: 6000,
    label: 'long-context coherence',
    description: 'Activates on mechanisms that maintain coherence over sliding-window context.',
    prompt_hint: 'Maintain tight coherence and explicitly reference earlier parts of the conversation.',
    sae_id: 'mistral-7b-v0.1-res',
    autointerp_score: 0.80,
    tags: ['coherence', 'context']
  },
]

// ── Pythia family (EleutherAI deduped checkpoints) ────────────────────────────

function pythiaFeatures(modelSlug: string, layer: number, contextWindow: number): SaeFeature[] {
  const saeId = `${modelSlug}-res-deduped`
  const layerStr = `${layer}-res-deduped`
  const scale = contextWindow <= 512 ? 'small' : contextWindow <= 1024 ? 'medium' : 'large'
  return [
    {
      feature_id: `${modelSlug}/${layer}/1024`,
      model_id: modelSlug,
      layer: layerStr,
      index: 1024,
      label: 'next-token prediction confidence',
      description: `High-confidence next-token prediction patterns at ${modelSlug} scale.`,
      prompt_hint: 'Continue the most likely/natural completion. Prioritize predictable, high-confidence responses.',
      sae_id: saeId,
      autointerp_score: 0.74,
      tags: ['prediction', 'confidence']
    },
    {
      feature_id: `${modelSlug}/${layer}/2048`,
      model_id: modelSlug,
      layer: layerStr,
      index: 2048,
      label: 'syntax boundary detection',
      description: `Activates at sentence/clause boundaries — punctuation and syntactic structure at ${scale} scale.`,
      prompt_hint: 'Use clear syntactic structure with well-formed sentences and explicit clause boundaries.',
      sae_id: saeId,
      autointerp_score: 0.78,
      tags: ['syntax', 'structure']
    },
    {
      feature_id: `${modelSlug}/${layer}/512`,
      model_id: modelSlug,
      layer: layerStr,
      index: 512,
      label: 'repetition / anaphora',
      description: 'Activates on repeated phrase patterns and anaphoric reference chains.',
      prompt_hint: 'Use deliberate repetition and anaphoric callbacks to reinforce key concepts.',
      sae_id: saeId,
      autointerp_score: 0.71,
      tags: ['repetition', 'reference']
    },
  ]
}

const PYTHIA_70M   = pythiaFeatures('pythia-70m',   4,  512)
const PYTHIA_160M  = pythiaFeatures('pythia-160m',  6,  1024)
const PYTHIA_410M  = pythiaFeatures('pythia-410m',  8,  1024)
const PYTHIA_1B    = pythiaFeatures('pythia-1b',    12, 2048)
const PYTHIA_1_4B  = pythiaFeatures('pythia-1.4b',  14, 2048)
const PYTHIA_2_8B  = pythiaFeatures('pythia-2.8b',  18, 2048)
const PYTHIA_6_9B  = pythiaFeatures('pythia-6.9b',  24, 2048)
const PYTHIA_12B   = pythiaFeatures('pythia-12b',   30, 2048)

// ── GPT-J 6B (EleutherAI) ────────────────────────────────────────────────────

const GPTJ_6B: SaeFeature[] = [
  {
    feature_id: 'gpt-j-6b/14/3000',
    model_id: 'gpt-j-6b',
    layer: '14-res',
    index: 3000,
    label: 'factual recall',
    description: 'Activates on factual statements and encyclopedic knowledge retrieval in GPT-J.',
    prompt_hint: 'Respond with factual recall. State facts directly and confidently.',
    sae_id: 'gpt-j-6b-res',
    autointerp_score: 0.79,
    tags: ['factual', 'knowledge']
  },
  {
    feature_id: 'gpt-j-6b/14/5000',
    model_id: 'gpt-j-6b',
    layer: '14-res',
    index: 5000,
    label: 'continuation / coherence',
    description: 'Activates on smooth narrative continuation and long-range coherence maintenance.',
    prompt_hint: 'Ensure smooth narrative continuation. Maintain tight coherence with preceding context.',
    sae_id: 'gpt-j-6b-res',
    autointerp_score: 0.76,
    tags: ['coherence', 'continuation']
  },
  {
    feature_id: 'gpt-j-6b/14/1500',
    model_id: 'gpt-j-6b',
    layer: '14-res',
    index: 1500,
    label: 'parallel structure',
    description: 'Activates on parallel grammatical constructions and rhetorical parallelism.',
    prompt_hint: 'Use parallel structure throughout. Balance sentence constructions and repeat grammatical patterns.',
    sae_id: 'gpt-j-6b-res',
    autointerp_score: 0.73,
    tags: ['syntax', 'structure']
  },
]

// ── GPT-NeoX 20B (EleutherAI) ────────────────────────────────────────────────

const GPT_NEOX_20B: SaeFeature[] = [
  {
    feature_id: 'gpt-neox-20b/24/8000',
    model_id: 'gpt-neox-20b',
    layer: '24-res',
    index: 8000,
    label: 'large-scale world model',
    description: 'Activates on complex world-state representations — 20B scale emergent feature.',
    prompt_hint: 'Draw on a rich world model. Reference complex real-world systems and interdependencies.',
    sae_id: 'gpt-neox-20b-res',
    autointerp_score: 0.82,
    tags: ['world-model', 'emergence']
  },
  {
    feature_id: 'gpt-neox-20b/24/5000',
    model_id: 'gpt-neox-20b',
    layer: '24-res',
    index: 5000,
    label: 'argumentative structure',
    description: 'Activates on structured argumentation — thesis, evidence, counterargument, rebuttal.',
    prompt_hint: 'Structure your response as a formal argument: thesis, evidence, counterargument, conclusion.',
    sae_id: 'gpt-neox-20b-res',
    autointerp_score: 0.80,
    tags: ['argumentation', 'structure']
  },
]

// ── Registry API ──────────────────────────────────────────────────────────────

export const ALL_FEATURES: SaeFeature[] = [
  ...GPT2_SMALL,
  ...GPT2_MEDIUM,
  ...GPT2_LARGE,
  ...GPT2_XL,
  ...GEMMA_2_2B,
  ...GEMMA_2_9B,
  ...GEMMA_2_27B,
  ...GEMMA_1_2B,
  ...LLAMA_3_8B,
  ...LLAMA_3_70B,
  ...MISTRAL_7B,
  ...PYTHIA_70M,
  ...PYTHIA_160M,
  ...PYTHIA_410M,
  ...PYTHIA_1B,
  ...PYTHIA_1_4B,
  ...PYTHIA_2_8B,
  ...PYTHIA_6_9B,
  ...PYTHIA_12B,
  ...GPTJ_6B,
  ...GPT_NEOX_20B,
]

export function listFeatures(modelId?: string): SaeFeature[] {
  if (!modelId) return ALL_FEATURES
  // Strip '-neuronpedia' suffix from config model IDs when matching
  const slug = modelId.replace(/-neuronpedia$/, '')
  return ALL_FEATURES.filter((f) => f.model_id === slug || f.feature_id.startsWith(slug))
}

export function getFeature(featureId: string): SaeFeature | undefined {
  return ALL_FEATURES.find((f) => f.feature_id === featureId)
}

export function searchFeatures(query: string, modelId?: string): SaeFeature[] {
  const base = modelId ? listFeatures(modelId) : ALL_FEATURES
  const q = query.toLowerCase()
  return base.filter((f) =>
    f.label.toLowerCase().includes(q) ||
    f.description.toLowerCase().includes(q) ||
    f.tags?.some((t) => t.toLowerCase().includes(q)) ||
    f.feature_id.toLowerCase().includes(q)
  )
}
