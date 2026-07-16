export type ThemeId = 'light' | 'dark'

export interface ThemeDefinition {
  id: ThemeId
  label: string
  description: string
  preview: { bg: string; sidebar: string; text: string }
}

// Preview swatches sampled from the OKLCH tokens in styles/globals.css.
export const themes: ThemeDefinition[] = [
  {
    id: 'light',
    label: 'Light',
    description: 'Warm paper',
    preview: { bg: '#fbfaf8', sidebar: '#f1efeb', text: '#3a332f' },
  },
  {
    id: 'dark',
    label: 'Dark',
    description: 'Warm charcoal',
    preview: { bg: '#25211d', sidebar: '#2c2823', text: '#eae6e0' },
  },
]

export const DEFAULT_THEME: ThemeId = 'dark'
