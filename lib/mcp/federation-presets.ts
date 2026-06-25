/**
 * federation-presets.ts — one-click FEDERATED PEER presets.
 *
 * These register another agent framework's MCP server as a peer in Noetica's A2A zero-trust mesh. Because each
 * carries a `spiffeId`, every tool call routes through the federated path in the MCP manager (checkActorGrant →
 * behavioral trust + authority status, outcomes fed back), NOT the plain local-session grant — so a peer earns
 * trust slowly and loses it instantly, and sensitive capabilities demand a higher floor. Disabled by default;
 * the framework's CLI (e.g. `aiwg mcp serve`) is spawned over stdio when the user enables the peer.
 */
import type { McpServerConfig } from '@/lib/types/mcp'

export type FederationPreset = Pick<McpServerConfig, 'name' | 'transport' | 'command' | 'args' | 'spiffeId' | 'peerKind'> & { description: string }

export const FEDERATION_PRESETS: FederationPreset[] = [
  {
    peerKind: 'aiwg',
    name: 'AIWG (federated peer)',
    description: "Steve-Yegge-style? No — jmagly/aiwg: deploy-time cognitive SDLC framework. Ships an MCP server (`aiwg mcp serve`). Lowest-friction peer.",
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'aiwg@latest', 'mcp', 'serve'],
    spiffeId: 'spiffe://aiwg.io/server/local',
  },
  {
    peerKind: 'ruflo',
    name: 'Ruflo (federated peer)',
    description: 'ruvnet/ruflo (formerly Claude Flow): swarm harness with consensus. MCP transport.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'ruflo@latest', 'mcp', 'start'],
    spiffeId: 'spiffe://ruflo.swarm/local',
  },
]

/** Build a connectable server config from a preset (caller adds id/createdAt/enabled via the MCP manager). */
export function presetToServerConfig(p: FederationPreset): Omit<McpServerConfig, 'id' | 'createdAt'> {
  return { name: p.name, transport: p.transport, command: p.command, args: p.args, spiffeId: p.spiffeId, peerKind: p.peerKind, enabled: true }
}
