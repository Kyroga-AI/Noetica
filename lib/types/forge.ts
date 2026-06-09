/**
 * Source-control authority model.
 *
 * Rule: Gitea Sovereign / SourceOS Git substrate = native authority.
 *       GitHub / GitLab / Forgejo = optional external connectors.
 *       GitHub must never appear as the default source substrate.
 */

export type ForgeProvider =
  | 'gitea_sovereign'
  | 'local_git'
  | 'git_ssh'
  | 'github'
  | 'gitlab'
  | 'forgejo'
  | 'other'

export type ForgeTrustTier = 'native' | 'trusted' | 'external' | 'untrusted'
export type ForgeAuthMode = 'local' | 'ssh_key' | 'token' | 'oauth' | 'sourceos_grant'
export type ForgeConnectionStatus = 'connected' | 'disconnected' | 'degraded' | 'error'

export interface SourceForge {
  id: string
  provider: ForgeProvider
  name: string
  baseUrl?: string
  default: boolean
  trustTier: ForgeTrustTier
  connectionStatus: ForgeConnectionStatus
  authMode: ForgeAuthMode
  sourceosRef?: string
  lastSyncAt?: string
}

export type RepoVisibility = 'private' | 'internal' | 'public'
export type RepoHealthStatus = 'healthy' | 'stale' | 'degraded' | 'failed' | 'unknown'

export interface RepositoryRef {
  id: string
  forgeId: string
  name: string
  ownerOrNamespace: string
  cloneUrl: string
  defaultBranch: string
  visibility: RepoVisibility
  localPath?: string
  sourceosNodeId?: string
  graphNodeId?: string
  healthStatus: RepoHealthStatus
  lastObservedAt?: string
}

/** Display metadata for UI — derived from provider. */
export const FORGE_META: Record<ForgeProvider, { label: string; authority: string; trustTier: ForgeTrustTier }> = {
  gitea_sovereign: { label: 'Gitea Sovereign',  authority: 'Native authority',   trustTier: 'native'    },
  local_git:       { label: 'Local Git',         authority: 'Native authority',   trustTier: 'native'    },
  git_ssh:         { label: 'Git over SSH',       authority: 'Trusted remote',     trustTier: 'trusted'   },
  github:          { label: 'GitHub',             authority: 'External connector', trustTier: 'external'  },
  gitlab:          { label: 'GitLab',             authority: 'External connector', trustTier: 'external'  },
  forgejo:         { label: 'Forgejo',            authority: 'External connector', trustTier: 'external'  },
  other:           { label: 'Other Git remote',   authority: 'External connector', trustTier: 'untrusted' },
}
