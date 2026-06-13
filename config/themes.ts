export type ThemeId = 'claude' | 'navy' | 'light'

export interface ThemeDefinition {
  id: ThemeId
  label: string
  description: string
  preview: { bg: string; sidebar: string; text: string }
}

export const themes: ThemeDefinition[] = [
  {
    id: 'claude',
    label: 'Claude',
    description: 'Charcoal dark',
    preview: { bg: '#1e1e1e', sidebar: '#262626', text: '#ece9e3' },
  },
  {
    id: 'navy',
    label: 'Navy',
    description: 'Deep navy',
    preview: { bg: '#1e2130', sidebar: '#171923', text: '#dde1ea' },
  },
  {
    id: 'light',
    label: 'Light',
    description: 'Clean light',
    preview: { bg: '#ffffff', sidebar: '#f3f6fa', text: '#111827' },
  },
]

export const DEFAULT_THEME: ThemeId = 'claude'
