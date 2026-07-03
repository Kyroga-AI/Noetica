/**
 * retention-scheduler.ts — Layer 5 retention: TTL / delete / legal-hold, driving the content-lifecycle.
 *
 * The Policy/Retention layer's scheduler: evaluate content items against a retention policy and apply the
 * resulting transitions THROUGH content-lifecycle.transition() — so the legal-hold gate is honored (a held
 * item is never deleted) and every action is audited. This is the enforcement arm of the content model's
 * retention policy; it does not bypass the lifecycle SM, it drives it.
 */
import { transition, type ContentItem, type AuditHook } from './content-lifecycle.js'

export interface RetentionPolicy {
  /** delete an item this long after creation (unless under legal hold). */
  ttlMs?: number
}

export interface RetentionAction { itemId: string; action: 'delete' | 'keep' | 'held'; reason: string }
export interface RetentionResult { actions: RetentionAction[]; deleted: ContentItem[] }

/** Sweep items against the retention policy; delete the expired (unless held), keep the rest. */
export function scheduleRetention(items: ContentItem[], policy: RetentionPolicy, opts: { now?: number; audit?: AuditHook } = {}): RetentionResult {
  const now = opts.now ?? Date.now()
  const actions: RetentionAction[] = []
  const deleted: ContentItem[] = []

  for (const item of items) {
    if (item.state === 'Deleted') { actions.push({ itemId: item.id, action: 'keep', reason: 'already deleted' }); continue }
    const expired = policy.ttlMs != null && now - item.createdAt >= policy.ttlMs
    if (!expired) { actions.push({ itemId: item.id, action: 'keep', reason: 'within retention TTL' }); continue }

    // TTL expired → attempt deletion through the lifecycle (which enforces the legal-hold gate + audits).
    const r = transition(item, 'Deleted', { audit: opts.audit })
    if (r.ok) { deleted.push(r.item); actions.push({ itemId: item.id, action: 'delete', reason: 'TTL expired' }) }
    else actions.push({ itemId: item.id, action: 'held', reason: r.reason })
  }
  return { actions, deleted }
}
