export type Theme = 'claude' | 'navy' | 'light' | 'dark' | 'system'
export type SidebarDensity = 'comfortable' | 'compact'
export type MemoryScope = 'session' | 'project' | 'global' | 'disabled'

export interface McpServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface NoeticaSettings {
  // Appearance
  theme: Theme
  sidebarDensity: SidebarDensity
  fontSize: 'sm' | 'md' | 'lg'
  userName: string

  // Models
  defaultModelId: string
  anthropicApiKey: string
  openaiApiKey: string
  googleApiKey: string
  mistralApiKey: string
  neuronpediaApiKey: string
  openrouterApiKey: string
  huggingfaceApiKey: string
  customModelIds: string[]   // user-added models: hf.co/… (local GGUF), openrouter/…, hf/… (hosted)
  serperApiKey: string

  // Runtime
  runtimeMode: 'standalone' | 'agent-machine' | 'sourceos'
  agentMachineEndpoint: string
  timeServiceEndpoint: string

  // Source forge
  giteaEndpoint: string
  giteaToken: string
  githubPat: string

  // Connectors — MCP servers keyed by name, matching Claude Desktop format
  mcpServers: Record<string, McpServerConfig>

  // Memory
  memoryScope: MemoryScope
  memoryRetentionDays: number

  // Governance
  defaultEvidenceLevel: 'minimal' | 'standard' | 'full'
  defaultPolicyProfile: 'default' | 'strict' | 'permissive' | 'research' | 'security' | 'enterprise' | 'medical'
  // Operator self-attestation for the SECURITY_RESEARCHER profile. The uncensored
  // security lane (WhiteRabbitNeo / Foundation-Sec / dolphin) arms ONLY when this is
  // accepted — local-first: the operator attests, the mesh records it. Revocable.
  securityAttestation?: { accepted: boolean; statement: string; acceptedAt: string }
  // When the security lane is armed, chats become ephemeral and are obliterated
  // after this many minutes of inactivity (sliding window). 0 disables ephemerality.
  securityEphemeralMinutes: number

  // Fan-out
  replyLength: 'short' | 'medium' | 'long'
  agentMode: 'auto' | 'plan' | 'ask'
  fanoutModels: string[]
  fanoutConcurrency: number

  // Voice
  wakeWordEnabled: boolean
  voiceLanguage: string
  ttsProvider: 'cloned' | 'elevenlabs' | 'openai' | 'system'
  ttsVoice: 'nova' | 'shimmer' | 'alloy' | 'echo' | 'fable' | 'onyx'
  macVoice: string
  elevenlabsApiKey: string
  elevenlabsVoiceId: string
  clonedVoiceId: string  // local XTTS-v2 cloned voice id (Tune & Train → Voice)

  // Agent slots — maps slot id to agent/model id
  agentSlots: Record<string, string>

  // OAuth credentials (user-registered OAuth app client IDs)
  oauthGoogleClientId: string
  oauthGithubClientId: string
  oauthGithubClientSecret: string
  oauthSlackClientId: string
  oauthLinearClientId: string
  oauthNotionClientId: string
  oauthNotionClientSecret: string

  // Matrix homeserver
  matrixHomeserver: string

  // Developer
  apiEndpointOverride: string
  showRawEvents: boolean

  // Model picker
  showAllModels: boolean
}
