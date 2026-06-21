'use client'

import { useSettings } from '@/lib/settings/context'
import { isTauri, invokeTauri } from '@/lib/tauri/bridge'

const OPENAI_VOICES = [
  { id: 'nova',    label: 'Nova',    desc: 'Warm American female' },
  { id: 'shimmer', label: 'Shimmer', desc: 'Soft American female' },
  { id: 'alloy',   label: 'Alloy',   desc: 'Neutral American' },
  { id: 'echo',    label: 'Echo',    desc: 'Clear American male' },
  { id: 'fable',   label: 'Fable',   desc: 'British male' },
  { id: 'onyx',    label: 'Onyx',    desc: 'Deep American male' },
] as const

// Well-known macOS enhanced/premium voices. User can also type any installed name.
const MAC_VOICE_PRESETS = [
  { id: 'Ava',      label: 'Ava',      desc: 'American female (Premium)' },
  { id: 'Samantha', label: 'Samantha', desc: 'American female (Standard)' },
  { id: 'Nicky',    label: 'Nicky',    desc: 'American female (Enhanced)' },
  { id: 'Gordon',   label: 'Gordon',   desc: 'Australian male (Premium — download in System Settings)' },
  { id: 'Karen',    label: 'Karen',    desc: 'Australian female (Standard)' },
  { id: 'Daniel',   label: 'Daniel',   desc: 'British male (Premium)' },
  { id: 'Zoe',      label: 'Zoe',      desc: 'American female (Enhanced)' },
]

// ElevenLabs voice presets — user can also paste any voice ID from elevenlabs.io/voice-lab
const ELEVEN_VOICE_PRESETS = [
  { id: 'ErXwobaYiN019PkySvjV', label: 'Antoni',    desc: 'Well-rounded male' },
  { id: 'VR6AewLTigWG4xSOukaG', label: 'Arnold',    desc: 'Crisp male' },
  { id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam',      desc: 'Deep male (US)' },
  { id: 'jBpfuIE2acCO8z3wKNLl', label: 'Ethan',     desc: 'Soft male' },
  { id: 'MF3mGyEYCl7XYWbV9V6O', label: 'Elli',      desc: 'Friendly female (US)' },
  { id: 'ThT5KcBeYPX3keUQqHPh', label: 'Dorothy',   desc: 'Warm female (UK)' },
  { id: 'AZnzlk1XvdvUeBnXmlld', label: 'Domi',      desc: 'Strong female (US)' },
  { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Bella',     desc: 'Soft female (US)' },
]

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 6 }}>
      {children}
    </span>
  )
}

function Select({ value, onChange, children }: {
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        width: '100%',
        background: 'var(--color-background-secondary)',
        border: '1px solid var(--color-border-secondary)',
        borderRadius: 6,
        padding: '6px 10px',
        fontSize: '13px',
        color: 'var(--color-text-primary)',
        cursor: 'pointer',
      }}
    >
      {children}
    </select>
  )
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%',
        background: 'var(--color-background-secondary)',
        border: '1px solid var(--color-border-secondary)',
        borderRadius: 6,
        padding: '6px 10px',
        fontSize: '13px',
        color: 'var(--color-text-primary)',
        outline: 'none',
        boxSizing: 'border-box',
      }}
    />
  )
}

function PasswordInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="password"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%',
        background: 'var(--color-background-secondary)',
        border: '1px solid var(--color-border-secondary)',
        borderRadius: 6,
        padding: '6px 10px',
        fontSize: '13px',
        color: 'var(--color-text-primary)',
        outline: 'none',
        boxSizing: 'border-box',
      }}
    />
  )
}

export function VoicePanel() {
  const { settings, update } = useSettings()

  const provider = settings.ttsProvider ?? 'openai'

  function testVoice() {
    const text = "Hello, I'm your local AI agent Michael, running on Noetica."
    if (provider === 'elevenlabs' && settings.elevenlabsApiKey && settings.elevenlabsVoiceId) {
      void fetch(`https://api.elevenlabs.io/v1/text-to-speech/${settings.elevenlabsVoiceId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'xi-api-key': settings.elevenlabsApiKey },
        body: JSON.stringify({ text, model_id: 'eleven_turbo_v2_5', voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
      }).then(r => r.blob()).then(blob => {
        const url = URL.createObjectURL(blob)
        new Audio(url).play()
      })
      return
    }
    if (isTauri()) {
      const macVoice = settings.macVoice || 'Ava'
      void invokeTauri('speak_text', { text, voice: macVoice })
      return
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance(text)
      const macVoice = settings.macVoice || 'Ava'
      const voices = window.speechSynthesis.getVoices()
      const match = voices.find(v => v.name === macVoice) ?? voices.find(v => v.localService && v.lang.startsWith('en'))
      if (match) u.voice = match
      window.speechSynthesis.speak(u)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h3 style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: 600, color: 'var(--color-text-primary)' }}>Voice</h3>
        <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-text-secondary)' }}>
          Text-to-speech settings for Michael&apos;s spoken responses.
        </p>
      </div>

      {/* TTS Provider */}
      <div>
        <Label>TTS Provider</Label>
        <Select value={provider} onChange={v => update({ ttsProvider: v as 'cloned' | 'elevenlabs' | 'openai' | 'system' })}>
          <option value="cloned">Cloned voice (local — train in Tune &amp; Train)</option>
          <option value="elevenlabs">ElevenLabs (highest quality, accents)</option>
          <option value="openai">OpenAI TTS (good quality, needs API key)</option>
          <option value="system">System voice (macOS say / Web Speech)</option>
        </Select>
      </div>

      {/* ElevenLabs config */}
      {provider === 'elevenlabs' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 12, background: 'var(--color-background-secondary)', borderRadius: 8 }}>
          <div>
            <Label>ElevenLabs API Key</Label>
            <PasswordInput
              value={settings.elevenlabsApiKey}
              onChange={v => update({ elevenlabsApiKey: v })}
              placeholder="sk_..."
            />
          </div>
          <div>
            <Label>Voice preset</Label>
            <Select
              value={ELEVEN_VOICE_PRESETS.some(p => p.id === settings.elevenlabsVoiceId) ? settings.elevenlabsVoiceId : 'custom'}
              onChange={v => { if (v !== 'custom') update({ elevenlabsVoiceId: v }) }}
            >
              {ELEVEN_VOICE_PRESETS.map(v => (
                <option key={v.id} value={v.id}>{v.label} — {v.desc}</option>
              ))}
              <option value="custom">Custom voice ID…</option>
            </Select>
          </div>
          <div>
            <Label>Voice ID (paste from elevenlabs.io/voice-lab)</Label>
            <TextInput
              value={settings.elevenlabsVoiceId}
              onChange={v => update({ elevenlabsVoiceId: v })}
              placeholder="Voice ID"
            />
            <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
              For Australian male: search &quot;Australian&quot; at elevenlabs.io/voice-lab and paste the voice ID here.
            </p>
          </div>
        </div>
      )}

      {/* OpenAI voice picker */}
      {provider === 'openai' && (
        <div>
          <Label>Voice</Label>
          <Select value={settings.ttsVoice} onChange={v => update({ ttsVoice: v as typeof settings.ttsVoice })}>
            {OPENAI_VOICES.map(v => (
              <option key={v.id} value={v.id}>{v.label} — {v.desc}</option>
            ))}
          </Select>
          {!settings.openaiApiKey && (
            <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#f59e0b' }}>
              OpenAI API key required — add it in Connections settings.
            </p>
          )}
        </div>
      )}

      {/* macOS / system voice */}
      {(provider === 'system' || (!settings.elevenlabsApiKey && !settings.openaiApiKey)) && (
        <div>
          <Label>macOS voice name</Label>
          <Select value={MAC_VOICE_PRESETS.some(p => p.id === settings.macVoice) ? settings.macVoice : 'custom'}
            onChange={v => { if (v !== 'custom') update({ macVoice: v }) }}>
            {MAC_VOICE_PRESETS.map(v => (
              <option key={v.id} value={v.id}>{v.label} — {v.desc}</option>
            ))}
            <option value="custom">Custom…</option>
          </Select>
          <div style={{ marginTop: 8 }}>
            <Label>Custom voice name (run `say -v &apos;?&apos; in Terminal to list all)</Label>
            <TextInput
              value={settings.macVoice}
              onChange={v => update({ macVoice: v })}
              placeholder="e.g. Gordon, Ava, Samantha"
            />
          </div>
          <p style={{ margin: '6px 0 0', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
            For Australian male: download &quot;Gordon&quot; in System Settings → Accessibility → Spoken Content → System Voice.
          </p>
        </div>
      )}

      {/* Wake word */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-primary)' }}>Wake word</span>
          <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
            Listen for &quot;hey noetica&quot; to start voice input
          </p>
        </div>
        <button
          onClick={() => update({ wakeWordEnabled: !settings.wakeWordEnabled })}
          style={{
            width: 36,
            height: 20,
            borderRadius: 10,
            border: 'none',
            background: settings.wakeWordEnabled ? 'var(--color-accent)' : 'var(--color-background-tertiary)',
            cursor: 'pointer',
            position: 'relative',
            flexShrink: 0,
            transition: 'background 0.15s',
          }}
        >
          <span style={{
            position: 'absolute',
            top: 2,
            left: settings.wakeWordEnabled ? 18 : 2,
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left 0.15s',
          }} />
        </button>
      </div>

      {/* Test button */}
      <div>
        <button
          onClick={testVoice}
          style={{
            background: 'var(--color-background-secondary)',
            border: '1px solid var(--color-border-secondary)',
            borderRadius: 6,
            padding: '7px 14px',
            fontSize: '13px',
            color: 'var(--color-text-primary)',
            cursor: 'pointer',
          }}
        >
          Test voice
        </button>
      </div>
    </div>
  )
}
