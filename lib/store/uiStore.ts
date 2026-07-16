'use client'

import { create } from 'zustand'

// NOTE: 'mode' (standalone|sourceos) deliberately does NOT live here — AppShell.tsx
// already owns it as real state (`const [mode, setMode] = useState<NoeticaMode>(...)`,
// threaded into chat submission/routing) and passes it down as props. Components that
// need it (Topbar, BrandLockup's status dot, GovernanceDrawer) receive it as a prop
// from AppShell rather than reading a second, potentially-divergent copy here.
export type SteeringTier = 'full' | 'local' | 'none'
export type KnowledgeFilter = 'all' | 'tech' | 'knowledge' | 'memory' | 'document' | 'domain'
export type KnowledgeScope = 'chat' | 'project' | 'everything'

interface UiState {
  steeringTier: SteeringTier
  setSteeringTier: (tier: SteeringTier) => void

  privateSessionOn: boolean
  togglePrivateSession: () => void

  knowledgePanelOpen: boolean
  toggleKnowledgePanel: () => void
  knowledgeFilter: KnowledgeFilter
  setKnowledgeFilter: (filter: KnowledgeFilter) => void

  knowledgeScope: KnowledgeScope
  cycleKnowledgeScope: () => void

  governanceDrawerOpen: boolean
  toggleGovernanceDrawer: () => void

  sidebarAdvancedOpen: boolean
  toggleSidebarAdvanced: () => void
}

const SCOPE_ORDER: KnowledgeScope[] = ['chat', 'project', 'everything']

export const useUiStore = create<UiState>((set, get) => ({
  steeringTier: 'none',
  setSteeringTier: (steeringTier) => set({ steeringTier }),

  privateSessionOn: false,
  togglePrivateSession: () => set((s) => ({ privateSessionOn: !s.privateSessionOn })),

  knowledgePanelOpen: true,
  toggleKnowledgePanel: () => set((s) => ({ knowledgePanelOpen: !s.knowledgePanelOpen })),
  knowledgeFilter: 'all',
  setKnowledgeFilter: (knowledgeFilter) => set({ knowledgeFilter }),

  knowledgeScope: 'project',
  cycleKnowledgeScope: () => {
    const order = SCOPE_ORDER
    const next = order[(order.indexOf(get().knowledgeScope) + 1) % order.length]
    set({ knowledgeScope: next })
  },

  governanceDrawerOpen: false,
  toggleGovernanceDrawer: () => set((s) => ({ governanceDrawerOpen: !s.governanceDrawerOpen })),

  sidebarAdvancedOpen: false,
  toggleSidebarAdvanced: () => set((s) => ({ sidebarAdvancedOpen: !s.sidebarAdvancedOpen })),
}))
