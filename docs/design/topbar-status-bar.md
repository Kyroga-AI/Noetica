# Topbar / status bar — design reference

Source: [`components/shell/Topbar.tsx`](../../components/shell/Topbar.tsx),
[`components/status/EgressMeter.tsx`](../../components/status/EgressMeter.tsx),
[`components/status/RuntimeStatus.tsx`](../../components/status/RuntimeStatus.tsx),
[`components/risk/WarmingLevel.tsx`](../../components/risk/WarmingLevel.tsx),
[`components/shell/ThemePicker.tsx`](../../components/shell/ThemePicker.tsx)

Written for design/UI reference when building the new skin around the topbar. This is a
functional inventory of what's currently there, left to right, plus one explicit instruction
below.

## ⚠️ Exclude from the new skin: the Mic button

**Drop the microphone / voice-dictation icon (push-to-talk) from the redesigned topbar.** This
is a direct instruction from Gus, not a discovered constraint — the rest of the elements below
are documented as-is, but this one should not carry over into the new UI.

## The rest of the topbar, left to right

| Element | Component | What it does |
|---|---|---|
| **N₀ Noetica** | `Topbar.tsx` | App identity mark + name. Doubles as the actual window titlebar (draggable via `data-tauri-drag-region`; double-click to maximize) since the desktop app uses a transparent overlay titlebar. |
| **↗ N egressed** (amber) / **🔒 0 left this device** (green) | `EgressMeter.tsx` | Live sovereignty gauge. Polls `/api/governance/recent` every 8s and sums tokens that left the device across recent runs. Green when everything ran fully local/on-device; amber the instant anything routes to a cloud/sovereign-mesh provider. |
| **● Desktop — mode / runtime / provider [N]** | `RuntimeStatus.tsx` | Live health/connection pill. Dot color reflects connection state (green=ready, red=error, amber=not-configured, gray=loading/pulsing). Click expands a dropdown with all 6 fields: mode, runtime, provider, sourceos, agent, mesh. The numbered badge counts active remediation items (detected problems with a one-line fix, e.g. a suggested CLI command) surfaced without opening the dropdown. |
| ~~🎙 Mic~~ | `Topbar.tsx` | **Excluded — see above.** (Voice dictation, push-to-talk single-turn speech-to-text.) |
| ▮▮▮▮ Waveform | `Topbar.tsx` | Live voice chat — continuous, hands-free conversation mode, fully local. Bars animate while active. |
| ● Plain dot | `WarmingLevel.tsx` | Risk-aversion indicator, labeled "Risk: Cool / Warm / Hot" in its tooltip — flags whether the model's responses in the current conversation show signs of steering or deflection under risk pressure. Click opens the full inspector. |
| 🕐 Clock-face | `ThemePicker.tsx` | **Misleadingly shaped** — its icon is a literal clock face (circle + hands), but it's the theme/appearance picker, not anything time-related. Worth a genuine icon fix in the redesign, not just a skin. |
| ⬇ Download arrow | `Topbar.tsx` | Export conversation — conditionally rendered, only appears once the active chat has messages. |
| 🔍 Magnifying glass | `Topbar.tsx` | Command palette (⌘K). |
| ⚙ Gear | `Topbar.tsx` | Settings (⌘,). At small sizes its radiating-line icon can read as a sun glyph — another candidate for a clearer icon in the redesign. |
