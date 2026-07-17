'use client'

import { create } from 'zustand'

// NOTE: 'mode' (standalone|sourceos) deliberately does NOT live here — AppShell.tsx
// already owns it as real state (`const [mode, setMode] = useState<NoeticaMode>(...)`,
// threaded into chat submission/routing) and passes it down as props. Components that
// need it (Topbar, BrandLockup's status dot, GovernanceDrawer) receive it as a prop
// from AppShell rather than reading a second, potentially-divergent copy here.
//
// Also deliberately absent: a user-settable "steering tier" toggle and a standalone
// "knowledge scope" cycle. Both already exist as real, better-scoped mechanisms —
// steering tier is a static per-model capability (config/models.ts / SteeringPanel.tsx;
// AGENTS.md: never let the UI claim a steering tier the selected model doesn't actually
// have), and retrieval scope is InputArea.tsx's own functional `retrievalScope` state
// (it actually filters what the model reads, unlike the design handoff's decorative
// click-to-cycle pill). Duplicating either here would create a second, divergent source
// of truth — or in the steering case, a UI that can lie about model capability.
export type KnowledgeFilter = 'all' | 'tech' | 'knowledge' | 'memory' | 'document' | 'domain'

interface UiState {
  privateSessionOn: boolean
  togglePrivateSession: () => void

  knowledgePanelOpen: boolean
  toggleKnowledgePanel: () => void
  knowledgeFilter: KnowledgeFilter
  setKnowledgeFilter: (filter: KnowledgeFilter) => void

  governanceDrawerOpen: boolean
  toggleGovernanceDrawer: () => void
}

export const useUiStore = create<UiState>((set) => ({
  privateSessionOn: false,
  togglePrivateSession: () => set((s) => ({ privateSessionOn: !s.privateSessionOn })),

  knowledgePanelOpen: true,
  toggleKnowledgePanel: () => set((s) => ({ knowledgePanelOpen: !s.knowledgePanelOpen })),
  knowledgeFilter: 'all',
  setKnowledgeFilter: (knowledgeFilter) => set({ knowledgeFilter }),

  governanceDrawerOpen: false,
  toggleGovernanceDrawer: () => set((s) => ({ governanceDrawerOpen: !s.governanceDrawerOpen })),
}))
