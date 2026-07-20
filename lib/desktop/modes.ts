export type ModeKey = 'chat' | 'cowork' | 'code'

export type ShellNavItem = {
  id: string
  label: string
  icon?: string
  disabled?: boolean
  badge?: string
}

export type ShellModeConfig = {
  key: ModeKey
  label: string
  primaryActionLabel: string
  navItems: ShellNavItem[]
  recentsTitle: string
  recents: string[]
  emptyState: {
    title: string
    subtitle?: string
  }
}

export const shellModes: Record<ModeKey, ShellModeConfig> = {
  chat: {
    key: 'chat',
    label: 'Chat',
    primaryActionLabel: 'New chat',
    navItems: [
      { id: 'projects', label: 'Projects', icon: '□' },
      { id: 'artifacts', label: 'Artifacts', icon: '◇' },
      { id: 'ask-socioprophet', label: 'Ask Socioprophet', icon: '⌁' },
      { id: 'customize', label: 'Customize', icon: '▤' }
    ],
    recentsTitle: 'Recents',
    recents: ['Workspace control plane', 'Provider route checks', 'Noetica desktop shell'],
    emptyState: {
      title: 'What are we working through?',
      subtitle: 'Ask, inspect, plan, or route work through the governed Noetica surface.'
    }
  },
  cowork: {
    key: 'cowork',
    label: 'Cowork',
    primaryActionLabel: 'New task',
    navItems: [
      { id: 'projects', label: 'Projects', icon: '□' },
      { id: 'scheduled', label: 'Scheduled', icon: '◴' },
      { id: 'live-artifacts', label: 'Live artifacts', icon: '◇' },
      { id: 'dispatch', label: 'Dispatch', icon: '↗', badge: 'Gate' },
      { id: 'customize', label: 'Customize', icon: '▤' }
    ],
    recentsTitle: 'Active work',
    recents: ['Prepare project brief', 'Review open commitments', 'Route office workflow'],
    emptyState: {
      title: "Let's move the work forward",
      subtitle: 'Plan, brief, delegate, and track office/admin work with governance-aware execution boundaries.'
    }
  },
  code: {
    key: 'code',
    label: 'Code',
    primaryActionLabel: 'New session',
    navItems: [
      { id: 'routines', label: 'Routines', icon: '↻' },
      { id: 'customize', label: 'Customize', icon: '▤' },
      { id: 'more', label: 'More', icon: '⋯' }
    ],
    recentsTitle: 'Sessions',
    recents: ['Noetica shell scaffold', 'Tauri build check', 'SourceOS export path'],
    emptyState: {
      title: "What's next, Lord Michael?",
      subtitle: 'Bind a local project, inspect readiness, and work through governed coding sessions.'
    }
  }
}
