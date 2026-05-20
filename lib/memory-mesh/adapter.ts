export interface MemoryScopeRef {
  scope_id: string
  label: string
  writable: boolean
}

// Authority boundary: Noetica may display and request a memory scope, but memory
// persistence and policy belong to github.com/SocioProphet/memory-mesh.
export async function listMemoryScopes(): Promise<MemoryScopeRef[]> {
  return [
    {
      scope_id: 'noetica-session-local',
      label: 'Noetica session-local scope',
      writable: false
    }
  ]
}
