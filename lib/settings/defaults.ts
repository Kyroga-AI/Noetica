import { defaultModelId } from '@/config/models'
import type { NoeticaSettings } from './types'

export const defaultSettings: NoeticaSettings = {
  theme: 'claude',
  sidebarDensity: 'comfortable',
  fontSize: 'md',
  userName: 'Lord Michael',

  defaultModelId,
  anthropicApiKey: '',
  openaiApiKey: '',
  googleApiKey: '',
  mistralApiKey: '',
  neuronpediaApiKey: '',
  serperApiKey: '',

  runtimeMode: 'agent-machine',
  agentMachineEndpoint: 'http://127.0.0.1:8080',
  timeServiceEndpoint: '',

  giteaEndpoint: '',
  giteaToken: '',
  githubPat: '',

  mcpServers: {},

  memoryScope: 'session',
  memoryRetentionDays: 30,

  defaultEvidenceLevel: 'standard',
  defaultPolicyProfile: 'default',

  fanoutModels: ['claude-sonnet-4-6', 'gpt-4o'],
  fanoutConcurrency: 3,

  wakeWordEnabled: true,
  voiceLanguage: 'en-US',
  ttsProvider: 'openai',
  ttsVoice: 'nova',
  macVoice: 'Ava',
  elevenlabsApiKey: '',
  elevenlabsVoiceId: '',

  agentSlots: {
    context: 'claude-sonnet-4-6',
    mail: 'claude-sonnet-4-6',
    calendar: 'claude-sonnet-4-6',
    tasks: 'claude-sonnet-4-6',
  },

  oauthGoogleClientId: '',
  oauthGithubClientId: '',
  oauthGithubClientSecret: '',
  oauthSlackClientId: '',
  oauthLinearClientId: '',
  oauthNotionClientId: '',
  oauthNotionClientSecret: '',

  matrixHomeserver: 'https://matrix.org',

  apiEndpointOverride: '',
  showRawEvents: false,

  showAllModels: false,
}
