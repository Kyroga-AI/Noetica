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

  // Models
  defaultModelId: string
  anthropicApiKey: string
  openaiApiKey: string
  googleApiKey: string
  mistralApiKey: string
  neuronpediaApiKey: string
  serperApiKey: string

  // Runtime
  runtimeMode: 'standalone' | 'agent-machine' | 'sourceos'
  agentMachineEndpoint: string

  // Source forge
  giteaEndpoint: string
  githubPat: string

  // Connectors — MCP servers keyed by name, matching Claude Desktop format
  mcpServers: Record<string, McpServerConfig>

  // Memory
  memoryScope: MemoryScope
  memoryRetentionDays: number

  // Governance
  defaultEvidenceLevel: 'minimal' | 'standard' | 'full'
  defaultPolicyProfile: 'default' | 'research' | 'security' | 'enterprise' | 'medical'

  // Fan-out
  fanoutModels: string[]
  fanoutConcurrency: number

  // Voice
  wakeWordEnabled: boolean
  voiceLanguage: string
  ttsProvider: 'elevenlabs' | 'openai' | 'system'
  ttsVoice: 'nova' | 'shimmer' | 'alloy' | 'echo' | 'fable' | 'onyx'
  macVoice: string
  elevenlabsApiKey: string
  elevenlabsVoiceId: string

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
