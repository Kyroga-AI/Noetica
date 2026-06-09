export type Theme = 'light' | 'dark' | 'system'
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

  // Runtime
  runtimeMode: 'standalone' | 'sourceos'
  agentMachineEndpoint: string

  // Connectors — MCP servers keyed by name, matching Claude Desktop format
  mcpServers: Record<string, McpServerConfig>

  // Memory
  memoryScope: MemoryScope
  memoryRetentionDays: number

  // Governance
  defaultEvidenceLevel: 'minimal' | 'standard' | 'full'
  defaultPolicyProfile: string

  // Developer
  apiEndpointOverride: string
  showRawEvents: boolean
}
