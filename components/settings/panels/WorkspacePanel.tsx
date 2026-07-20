'use client'

import { useSettings } from '@/lib/settings/context'

/**
 * WorkspacePanel — Prophet Workspace setup. Configure your OWN sovereign mail (IMAP/SMTP) + calendar (CalDAV)
 * so you can move off Google Workspace. Self-hosted by design; credentials stay local (see the keychain
 * follow-up). The Mail/Calendar rail panels read this config.
 */
function Field({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-[var(--color-text-secondary)]">{label}</span>
      <input
        type={type} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] outline-none focus:border-[#1d4ed8] focus:bg-[var(--color-background-primary)]"
      />
    </label>
  )
}

export function WorkspacePanel() {
  const { settings, update } = useSettings()
  const mailReady = !!(settings.mailImapHost && settings.mailUser)
  const calReady = !!settings.calCaldavUrl

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[#bfdbfe] bg-[#eff6ff] px-4 py-3 text-xs leading-5 text-[#1e40af]">
        <span className="font-semibold">Prophet Workspace</span> — your sovereign replacement for Google Workspace.
        Bring your own mail + calendar server; nothing routes through Google. Credentials are stored locally.
      </div>

      {/* Mail */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-[var(--color-text-primary)]">Mail (IMAP / SMTP)</div>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${mailReady ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent)]' : 'bg-[var(--color-background-tertiary)] text-[var(--color-text-tertiary)]'}`}>{mailReady ? 'Configured' : 'Not set up'}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="IMAP host" value={settings.mailImapHost} onChange={(v) => update({ mailImapHost: v })} placeholder="imap.fastmail.com" />
          <Field label="IMAP port" value={settings.mailImapPort} onChange={(v) => update({ mailImapPort: v })} placeholder="993" />
          <Field label="SMTP host" value={settings.mailSmtpHost} onChange={(v) => update({ mailSmtpHost: v })} placeholder="smtp.fastmail.com" />
          <Field label="SMTP port" value={settings.mailSmtpPort} onChange={(v) => update({ mailSmtpPort: v })} placeholder="465" />
          <Field label="Email / username" value={settings.mailUser} onChange={(v) => update({ mailUser: v })} placeholder="you@yourdomain.com" />
          <Field label="Password / app token" type="password" value={settings.mailPassword} onChange={(v) => update({ mailPassword: v })} />
        </div>
        <p className="text-[11px] text-[var(--color-text-tertiary)]">Works with any IMAP/SMTP provider — Fastmail, Migadu, mailbox.org, Proton Bridge, or your own mailserver.</p>
      </div>

      {/* Calendar */}
      <div className="space-y-3 border-t border-[var(--color-border-secondary)] pt-5">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-[var(--color-text-primary)]">Calendar (CalDAV)</div>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${calReady ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent)]' : 'bg-[var(--color-background-tertiary)] text-[var(--color-text-tertiary)]'}`}>{calReady ? 'Configured' : 'Not set up'}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Field label="CalDAV URL" value={settings.calCaldavUrl} onChange={(v) => update({ calCaldavUrl: v })} placeholder="https://caldav.fastmail.com/dav/calendars/user/you/" /></div>
          <Field label="Username" value={settings.calUser} onChange={(v) => update({ calUser: v })} />
          <Field label="Password / app token" type="password" value={settings.calPassword} onChange={(v) => update({ calPassword: v })} />
        </div>
        <p className="text-[11px] text-[var(--color-text-tertiary)]">Any CalDAV server (Fastmail, Nextcloud, Radicale, mailbox.org). The Calendar rail reads from here.</p>
      </div>
    </div>
  )
}
