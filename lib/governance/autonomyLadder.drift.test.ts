import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AUTONOMY_LADDER, TRUST_KERNEL_GATE_ORDER } from './autonomyLadder.js'
import canonical from './ai-driven-development.ladder.json' with { type: 'json' }

// Drift guard: the inline ladder must match the canonical export vendored from
// prophet-mesh (the single source of truth). Re-vendor with:
//   prophet-mesh export-autonomy-ladder --out  (then copy the .ladder.json here)

test('inline ladder matches the canonical prophet-mesh export', () => {
  assert.deepEqual([...TRUST_KERNEL_GATE_ORDER], canonical.trust_kernel_gate_order)

  const inlineByLevel = new Map(AUTONOMY_LADDER.map((l) => [l.level, l]))
  assert.equal(inlineByLevel.size, canonical.levels.length, 'level count drifted')

  for (const c of canonical.levels) {
    const local = inlineByLevel.get(c.level)
    assert.ok(local, `missing level ${c.level}`)
    assert.equal(local!.rank, c.rank, `${c.level} rank drifted`)
    assert.equal(local!.label, c.label, `${c.level} label drifted`)
    assert.equal(local!.gate, c.gate, `${c.level} gate drifted`)
    assert.equal(local!.evidenceRequired, c.evidence_required, `${c.level} evidence drifted`)
    assert.equal(local!.enforcedAt, c.enforced_at, `${c.level} enforced_at drifted`)
    assert.deepEqual(local!.roles, c.roles, `${c.level} roles drifted`)
  }
})
