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

  fanoutModels: ['claude-sonnet-4-6', 'gpt-4o'],
  fanoutConcurrency: 3,

  wakeWordEnabled: true,
  voiceLanguage: 'en-US',

  agentSlots: {
    context: 'claude-sonnet-4-6',
    mail: 'claude-sonnet-4-6',
    calendar: 'claude-sonnet-4-6',
    tasks: 'claude-sonnet-4-6',
  },

  oauthGoogleClientId: '',
  oauthGithubClientId: '',
  oauthSlackClientId: '',
  oauthLinearClientId: '',
  oauthNotionClientId: '',

  matrixHomeserver: 'https://matrix.org',

  apiEndpointOverride: '',
  showRawEvents: false,
}
