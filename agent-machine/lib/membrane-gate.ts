/**
 * membrane-gate — route a tool call through the CANONICAL capability membrane
 * (prophet-platform tools/capability_membrane.py) before it executes.
 *
 * This is the runtime last-mile of the unified membrane: agent-machine already has a
 * local autonomy gate; this adds the option to defer the allow/deny to the canonical
 * kernel (surface + radius + membrane + autonomy → one sourceos ExecutionDecision,
 * fail-closed, sealed receipt).
 *
 * DEFAULT-INERT + OBSERVE-FIRST, so it changes nothing until an operator opts in:
 *   - NOETICA_MEMBRANE_BIN unset            → inert (no subprocess, proceed).
 *   - set, NOETICA_MEMBRANE_ENFORCE != '1'  → OBSERVE: log the would-be decision, proceed.
 *   - set, NOETICA_MEMBRANE_ENFORCE == '1'  → ENFORCE: deny (fail-closed) when the
 *                                             membrane denies OR is unreachable.
 *
 * The membrane CLI's exit code is authoritative (0 = allow, non-zero = deny); stdout
 * (the sealed resolution) is parsed best-effort for logging detail only.
 */
import * as cp from 'node:child_process';

export interface ToolScope {
  /** sourceos connectorKind (capability_membrane CONNECTOR_KINDS). */
  surface: string;
  /** sourceos ConnectorActionScope.accessLevel (capability_membrane ACCESS_LEVELS). */
  access: string;
}

export interface MembraneDecision {
  allowed: boolean;
  executionDecision: string; // allow|deny|ask|defer|rewrite (best-effort from stdout)
  radius?: string;
  reason?: string;
}

export interface MembraneConfig {
  bin?: string;        // path to capability_membrane.py (NOETICA_MEMBRANE_BIN)
  enforce: boolean;    // NOETICA_MEMBRANE_ENFORCE === '1'
  subject: string;     // agent urn
  tension: string[];   // present governance tension members (policy/identity/provenance/...)
  python: string;      // interpreter
}

export interface GateResult {
  proceed: boolean;
  denial?: string;               // set when !proceed (enforcing + denied)
  decision?: MembraneDecision;   // present when the membrane was consulted
}

// tool name → (connector surface, access level). Read/assistive tools sit low; shell,
// filesystem writes, and self-modification floor high (shell/computer→R3, control→R5).
const TOOL_SCOPE: Record<string, ToolScope> = {
  run_command: { surface: 'shell', access: 'scopedWrite' },
  code_execute: { surface: 'shell', access: 'scopedWrite' },
  execute_action: { surface: 'shell', access: 'scopedWrite' },
  update_self: { surface: 'deployment', access: 'control' },
  set_identity: { surface: 'custom', access: 'control' },
  dispatch_agent: { surface: 'custom', access: 'scopedWrite' },
  scaffold_app: { surface: 'filesystem', access: 'scopedWrite' },
  write_file: { surface: 'filesystem', access: 'scopedWrite' },
  edit_file: { surface: 'filesystem', access: 'scopedWrite' },
  remember: { surface: 'filesystem', access: 'scopedWrite' },
  read_file: { surface: 'filesystem', access: 'readOnly' },
  web_search: { surface: 'httpApi', access: 'readOnly' },
  generate_image: { surface: 'httpApi', access: 'readOnly' },
  public_data: { surface: 'httpApi', access: 'readOnly' },
};
const DEFAULT_SCOPE: ToolScope = { surface: 'filesystem', access: 'readOnly' };

/** Map a tool name to its membrane surface + access level (pure). */
export function toolScope(tool: string): ToolScope {
  return TOOL_SCOPE[tool] ?? DEFAULT_SCOPE;
}

export function membraneConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MembraneConfig {
  return {
    bin: env['NOETICA_MEMBRANE_BIN'] || undefined,
    enforce: env['NOETICA_MEMBRANE_ENFORCE'] === '1',
    subject: env['NOETICA_AGENT_URN'] || 'urn:srcos:agent:noetica',
    // The governance members agent-machine actually presents; operator-tunable so the
    // observed/enforced decision reflects real tension, not an assumed set.
    tension: (env['NOETICA_MEMBRANE_TENSION'] || 'policy,identity,provenance')
      .split(',').map((t) => t.trim()).filter(Boolean),
    python: env['NOETICA_PYTHON'] || 'python3',
  };
}

/** Interpret the membrane CLI result (exit code authoritative; stdout best-effort). */
export function interpretResult(status: number | null, stdout: string): MembraneDecision {
  const allowed = status === 0;
  let executionDecision = allowed ? 'allow' : 'deny';
  let radius: string | undefined;
  let reason: string | undefined;
  try {
    const s = JSON.parse(stdout) as Record<string, unknown>;
    if (typeof s['execution_decision'] === 'string') executionDecision = s['execution_decision'] as string;
    if (typeof s['radius'] === 'string') radius = s['radius'] as string;
    if (typeof s['reason'] === 'string') reason = s['reason'] as string;
    else if (Array.isArray(s['missing_tension']) && (s['missing_tension'] as unknown[]).length) {
      reason = `missing_tension:${(s['missing_tension'] as unknown[]).join(',')}`;
    }
  } catch { /* non-JSON output — rely on the exit code */ }
  return { allowed, executionDecision, radius, reason };
}

export type MembraneRunner = (python: string, args: string[]) => { status: number | null; stdout: string };

const defaultRunner: MembraneRunner = (python, args) => {
  const r = cp.spawnSync(python, args, { encoding: 'utf8', timeout: 5000 });
  return { status: r.status, stdout: r.stdout ?? '' };
};

/**
 * Gate a tool call through the membrane. Pure orchestration over an injectable runner
 * so it is unit-testable without spawning Python.
 */
export function membraneGate(tool: string, cfg: MembraneConfig, run: MembraneRunner = defaultRunner): GateResult {
  if (!cfg.bin) return { proceed: true }; // membrane not configured → inert

  const scope = toolScope(tool);
  const args = [cfg.bin, '--surface', scope.surface, '--access', scope.access, '--subject', cfg.subject];
  if (cfg.tension.length) args.push('--tension', cfg.tension.join(','));

  let decision: MembraneDecision;
  try {
    const { status, stdout } = run(cfg.python, args);
    decision = interpretResult(status, stdout);
  } catch (e) {
    // Membrane unreachable — deny fail-closed under enforcement.
    decision = { allowed: false, executionDecision: 'deny', reason: `membrane_unreachable: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (!cfg.enforce) {
    if (!decision.allowed) {
      const detail = [decision.executionDecision, decision.radius, decision.reason].filter(Boolean).join(' ');
      console.log(`[membrane:observe] would DENY tool '${tool}' (${scope.surface}/${scope.access}) → ${detail}`);
    }
    return { proceed: true, decision };
  }
  if (!decision.allowed) {
    const detail = [decision.executionDecision, decision.radius, decision.reason].filter(Boolean).join(' ');
    return { proceed: false, denial: `capability denied by membrane: '${tool}' (${scope.surface}/${scope.access}) → ${detail}`, decision };
  }
  return { proceed: true, decision };
}
