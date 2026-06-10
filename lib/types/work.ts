/**
 * Native work management models.
 *
 * Rule: Noetica native task/backlog/sprint/board = source of truth.
 *       Jira / Linear / GitHub Issues = optional external connectors only.
 */

export type WorkItemStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled'
export type WorkItemPriority = 'critical' | 'high' | 'medium' | 'low' | 'none'
export type WorkItemType = 'task' | 'epic' | 'story' | 'bug' | 'spike' | 'milestone'

export interface WorkItem {
  id: string
  type: WorkItemType
  title: string
  description?: string
  status: WorkItemStatus
  priority: WorkItemPriority
  assigneeId?: string
  projectId?: string
  workroomId?: string
  sprintId?: string
  epicId?: string
  tags: string[]
  order: number
  relatedArtifactIds: string[]
  relatedNoteIds: string[]
  sourceosEventRef?: string
  externalRefs: ExternalWorkRef[]
  createdAt: string
  updatedAt: string
  dueAt?: string
}

export interface ExternalWorkRef {
  provider: 'jira' | 'linear' | 'github_issues' | 'gitlab_issues' | 'asana' | 'other'
  externalId: string
  url?: string
  syncMode: 'read_only' | 'import' | 'bidirectional' | 'webhook_only'
}

export interface Sprint {
  id: string
  name: string
  projectId: string
  startAt: string
  endAt: string
  status: 'planned' | 'active' | 'completed'
  itemIds: string[]
}

export interface Project {
  id: string
  name: string
  description?: string
  status: 'active' | 'paused' | 'archived'
  workroomIds: string[]
  repositoryIds: string[]
  sprintIds: string[]
  sourceosRef?: string
  createdAt: string
  updatedAt: string
}
