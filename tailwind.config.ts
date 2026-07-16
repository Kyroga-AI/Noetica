import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
    './config/**/*.{js,ts,jsx,tsx,mdx}'
  ],
  theme: {
    extend: {
      colors: {
        accent: 'var(--accent)',
        'accent-soft': 'var(--accent-soft)',
        noetica: {
          blue: 'var(--noetica-blue)',
          light: 'var(--noetica-blue-light)',
          mid: 'var(--noetica-blue-mid)',
          ink: 'var(--noetica-ink)',
          line: 'var(--noetica-line)'
        }
      },
      boxShadow: {
        shell: '0 20px 60px rgba(20, 20, 20, 0.12)'
      }
    }
  },
  plugins: []
}

export default config
