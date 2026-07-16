'use client'

import { create } from 'zustand'

export type NoeticaMode = 'standalone' | 'sourceos'
export type SteeringTier = 'full' | 'local' | 'none'
export type KnowledgeFilter = 'all' | 'tech' | 'knowledge' | 'memory' | 'document' | 'domain'
export type KnowledgeScope = 'chat' | 'project' | 'everything'

interface UiState {
  mode: NoeticaMode
  setMode: (mode: NoeticaMode) => void
  toggleMode: () => void

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
  mode: 'standalone',
  setMode: (mode) => set({ mode }),
  toggleMode: () => set((s) => ({ mode: s.mode === 'standalone' ? 'sourceos' : 'standalone' })),

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
