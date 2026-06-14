'use client'

import { useState } from 'react'
import type { MailProvider } from '@/lib/types/mail'
import { MAIL_META } from '@/lib/types/mail'

type AccountEntry = { id: string; provider: MailProvider; address: string; native: boolean }

const STUB_ACCOUNTS: AccountEntry[] = [
  { id: 'prophet-primary', provider: 'prophet_mail', address: 'workspace@noetica.local', native: true },
]

const FOLDERS = ['Inbox', 'Sent', 'Flagged', 'Project-linked', 'Workroom', 'Archived']

type StubThread = {
  id: string
  subject: string
  from: string
  preview: string
  unread: boolean
  time: string
  projectLinked?: boolean
}

const STUB_THREADS: StubThread[] = []

export function MailPanel() {
  const [activeAccount, setActiveAccount] = useState<string>('prophet-primary')
  const [folder, setFolder] = useState('Inbox')
  const [showAccounts, setShowAccounts] = useState(false)

  const account = STUB_ACCOUNTS.find((a) => a.id === activeAccount) ?? STUB_ACCOUNTS[0]
  const meta = MAIL_META[account.provider]

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-[var(--color-border-secondary)] px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">Mail</div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className="text-xs text-[var(--color-text-secondary)] font-medium truncate max-w-[140px]">{account.address}</span>
              {meta.native && (
                <span className="rounded-full bg-[#dcfce7] px-1.5 py-0.5 text-[9px] font-semibold text-[#16a34a]">Native</span>
              )}
            </div>
          </div>
          <button
            onClick={() => setShowAccounts((v) => !v)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-tertiary)]"
            title="Switch account"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
              <path d="M6.5 2v9M2 6.5h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Account switcher */}
        {showAccounts && (
          <div className="mt-2 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-sm overflow-hidden">
            {/* Native accounts */}
            <div className="px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#1d4ed8] bg-[var(--color-background-secondary)]">
              Native
            </div>
            {STUB_ACCOUNTS.filter((a) => a.native).map((a) => (
              <button
                key={a.id}
                onClick={() => { setActiveAccount(a.id); setShowAccounts(false) }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-xs transition hover:bg-[var(--color-background-secondary)] ${a.id === activeAccount ? 'bg-[#eff6ff] font-semibold text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[#22c55e] shrink-0" />
                <span className="truncate">{a.address}</span>
              </button>
            ))}
            {/* External accounts (empty by default) */}
            <div className="px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-tertiary)] bg-[var(--color-background-secondary)] border-t border-[#f1f5f9]">
              External connectors
            </div>
            <div className="px-3 py-2">
              <button className="w-full rounded-lg border border-dashed border-[var(--color-border-secondary)] py-1.5 text-[10px] text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-secondary)]">
                + Add Gmail / IMAP
              </button>
            </div>
          </div>
        )}

        {/* Quick compose */}
        <button className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-[#bfdbfe] bg-[#eff6ff] py-1.5 text-xs font-semibold text-[#1d4ed8] transition hover:bg-[#dbeafe]">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
            <path d="M5.5 1v9M1 5.5h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          Compose
        </button>
      </div>

      {/* Folder tabs */}
      <div className="flex gap-0.5 overflow-x-auto border-b border-[var(--color-border-secondary)] px-2 py-1.5 scrollbar-hide">
        {FOLDERS.map((f) => (
          <button
            key={f}
            onClick={() => setFolder(f)}
            className={`shrink-0 rounded-lg px-2 py-1 text-[10px] font-medium transition whitespace-nowrap ${
              folder === f ? 'bg-[#dbeafe] text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto">
        {STUB_THREADS.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
            <div className="mb-2 h-10 w-10 rounded-full bg-[#eff6ff] flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden>
                <rect x="2" y="4" width="12" height="9" rx="1.5" stroke="#93c5fd" strokeWidth="1.4"/>
                <path d="M2 5l6 5 6-5" stroke="#93c5fd" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </div>
            <div className="text-xs font-semibold text-[var(--color-text-secondary)]">No mail in {folder}</div>
            <div className="mt-1 text-[10px] text-[var(--color-text-tertiary)] leading-relaxed">
              {folder === 'Inbox'
                ? 'Prophet Mail is native. Configure endpoint in Settings → Runtime.'
                : 'No messages in this folder.'}
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-[#f1f5f9]">
            {STUB_THREADS.map((t) => (
              <li key={t.id} className={`px-4 py-3 cursor-pointer transition hover:bg-[var(--color-background-secondary)] ${t.unread ? 'bg-[var(--color-background-primary)]' : 'bg-[#fafafa]'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-xs ${t.unread ? 'font-semibold text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}>{t.subject}</div>
                    <div className="truncate text-[10px] text-[var(--color-text-secondary)]">{t.from}</div>
                    <div className="truncate text-[10px] text-[var(--color-text-tertiary)]">{t.preview}</div>
                  </div>
                  <div className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">{t.time}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Quick actions */}
      <div className="border-t border-[var(--color-border-secondary)] px-3 py-2 space-y-1">
        {['Attach to note', 'Create task from email', 'Create artifact from thread'].map((action) => (
          <button key={action} className="w-full rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2 text-left text-[10px] text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-secondary)]">
            {action}
          </button>
        ))}
      </div>
    </div>
  )
}
