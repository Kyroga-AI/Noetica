/**
 * Mail and workspace messaging models.
 *
 * Rule: Prophet Mail / Workspace = native authority.
 *       Gmail / Google Calendar / Microsoft Graph = optional external connectors.
 */

export type MailProvider =
  | 'prophet_mail'
  | 'gmail'
  | 'imap'
  | 'microsoft_graph'
  | 'other'

export const MAIL_META: Record<MailProvider, { label: string; native: boolean }> = {
  prophet_mail:    { label: 'Prophet Mail',      native: true  },
  gmail:           { label: 'Gmail',             native: false },
  imap:            { label: 'IMAP',              native: false },
  microsoft_graph: { label: 'Microsoft / Outlook', native: false },
  other:           { label: 'Other',             native: false },
}

export interface MailAccount {
  id: string
  provider: MailProvider
  address: string
  displayName: string
  native: boolean
  status: 'connected' | 'disconnected' | 'degraded' | 'error'
  sourceosRef?: string
  lastSyncAt?: string
}

export interface WorkspaceMessage {
  id: string
  accountId: string
  subject: string
  from: string
  to: string[]
  receivedAt: string
  projectId?: string
  workroomId?: string
  relatedNoteIds: string[]
  relatedTaskIds: string[]
  sourceosEventRef?: string
}
