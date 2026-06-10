import { defaultModelId } from '@/config/models'
import type { NoeticaSettings } from './types'

export const defaultSettings: NoeticaSettings = {
  theme: 'light',
  sidebarDensity: 'comfortable',
  fontSize: 'md',

  defaultModelId,
  anthropicApiKey: '',
  openaiApiKey: '',
  googleApiKey: '',
  mistralApiKey: '',
  neuronpediaApiKey: '',

  runtimeMode: 'standalone',
  agentMachineEndpoint: 'http://localhost:8080',

  mcpServers: {},

  memoryScope: 'session',
  memoryRetentionDays: 30,

  defaultEvidenceLevel: 'standard',
  defaultPolicyProfile: 'default',

  apiEndpointOverride: '',
  showRawEvents: false,
}
