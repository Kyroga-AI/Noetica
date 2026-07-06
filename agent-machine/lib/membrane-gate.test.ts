/** Proofs for the capability-membrane gate client: tool→surface mapping, exit-code
 * interpretation, and the inert / observe-first / fail-closed enforcement contract. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toolScope, interpretResult, membraneGate, membraneConfigFromEnv,
  type MembraneConfig, type MembraneRunner,
} from './membrane-gate.js';

const cfg = (over: Partial<MembraneConfig> = {}): MembraneConfig => ({
  bin: '/x/capability_membrane.py', enforce: false,
  subject: 'urn:srcos:agent:noetica', tension: ['policy', 'identity', 'provenance'],
  python: 'python3', ...over,
});
const allow: MembraneRunner = () => ({ status: 0, stdout: '{"execution_decision":"allow","radius":"R1"}' });
const deny: MembraneRunner = () => ({ status: 3, stdout: '{"execution_decision":"deny","radius":"R3","missing_tension":["evidence","replay"]}' });

test('tool→surface/access mapping: shell/filesystem/http + safe default', () => {
  assert.deepEqual(toolScope('run_command'), { surface: 'shell', access: 'scopedWrite' });
  assert.deepEqual(toolScope('read_file'), { surface: 'filesystem', access: 'readOnly' });
  assert.deepEqual(toolScope('update_self'), { surface: 'deployment', access: 'control' });
  assert.deepEqual(toolScope('web_search'), { surface: 'httpApi', access: 'readOnly' });
  assert.deepEqual(toolScope('some_unknown_tool'), { surface: 'filesystem', access: 'readOnly' });
});

test('interpretResult: exit code is authoritative; stdout parsed best-effort', () => {
  const ok = interpretResult(0, '{"execution_decision":"allow","radius":"R1"}');
  assert.equal(ok.allowed, true);
  assert.equal(ok.executionDecision, 'allow');
  const no = interpretResult(3, '{"execution_decision":"deny","missing_tension":["audit"]}');
  assert.equal(no.allowed, false);
  assert.equal(no.reason, 'missing_tension:audit');
  // Non-JSON stdout falls back to the exit code alone.
  const raw = interpretResult(0, 'not json');
  assert.equal(raw.allowed, true);
  assert.equal(raw.executionDecision, 'allow');
});

test('inert when the membrane is not configured (no bin) — always proceeds', () => {
  const g = membraneGate('run_command', cfg({ bin: undefined }), deny);
  assert.equal(g.proceed, true);
  assert.equal(g.decision, undefined); // never consulted
});

test('observe mode: a denial does NOT block (proceeds), decision recorded', () => {
  const g = membraneGate('run_command', cfg({ enforce: false }), deny);
  assert.equal(g.proceed, true);
  assert.equal(g.decision?.allowed, false);
});

test('enforce mode: denial fails closed (does not proceed) with a reason', () => {
  const g = membraneGate('run_command', cfg({ enforce: true }), deny);
  assert.equal(g.proceed, false);
  assert.match(g.denial ?? '', /capability denied by membrane.*run_command.*shell\/scopedWrite/);
});

test('enforce mode: an allow proceeds', () => {
  const g = membraneGate('read_file', cfg({ enforce: true }), allow);
  assert.equal(g.proceed, true);
  assert.equal(g.decision?.allowed, true);
});

test('enforce mode: an unreachable membrane fails closed (deny)', () => {
  const boom: MembraneRunner = () => { throw new Error('ENOENT'); };
  const g = membraneGate('run_command', cfg({ enforce: true }), boom);
  assert.equal(g.proceed, false);
  assert.match(g.denial ?? '', /membrane_unreachable/);
});

test('config from env: default-inert, opt-in enforce, tunable tension', () => {
  assert.equal(membraneConfigFromEnv({}).bin, undefined);
  assert.equal(membraneConfigFromEnv({}).enforce, false);
  const c = membraneConfigFromEnv({ NOETICA_MEMBRANE_BIN: '/m.py', NOETICA_MEMBRANE_ENFORCE: '1', NOETICA_MEMBRANE_TENSION: 'policy, identity' });
  assert.equal(c.bin, '/m.py');
  assert.equal(c.enforce, true);
  assert.deepEqual(c.tension, ['policy', 'identity']);
});
