/**
 * mail-bridge — the IMAP↔REST bridge (workspace-mailapi) that lets the Vue Mail UI talk to Dovecot for real, with
 * the Hey model (Imbox / Feed / Paper Trail + Screener) layered on top. The ImapStore is injectable so the logic is
 * proven in-process against a fake; production wires it to Dovecot over IMAP. The choir's summarize/draft then run on
 * actual mail. This is the gate on leaving Google.
 */
export type MailView = "imbox" | "feed" | "papertrail";
export type ThreadAction = "read" | "reply-later" | "set-aside" | "done";

export interface RawMessage {
  id: string;
  folder: string;            // INBOX, Archive, Spam, …
  from: string;
  fromEmail: string;
  subject: string;
  ts: string;
  bodyText: string;
  headers: Record<string, string>;
  flags: string[];           // \Seen, $ReplyLater, $SetAside, …
}

export interface Thread {
  id: string;
  view: MailView;
  from: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  ts: string;
  unread: boolean;
  replyLaterAt?: string | null;
  setAside?: boolean;
  messages?: RawMessage[];
}

export interface ImapStore {
  list(folder: string): RawMessage[] | Promise<RawMessage[]>;
  get(id: string): RawMessage | undefined | Promise<RawMessage | undefined>;
  setFlag(id: string, flag: string, on: boolean): void | Promise<void>;
  move(id: string, folder: string): void | Promise<void>;
}

const normSubject = (s: string): string => s.replace(/^\s*(re|fwd?):\s*/i, "").trim().toLowerCase();

/** Hey-style classification: bulk/list mail → Feed; transactional → Paper Trail; the rest → Imbox. */
export function classifyView(m: RawMessage): MailView {
  const h = m.headers;
  if (h["list-unsubscribe"] || (h["precedence"] ?? "").toLowerCase() === "bulk" || (h["list-id"])) return "feed";
  if (/\b(receipt|invoice|order|payment|confirmation|statement|shipped|tracking)\b/i.test(m.subject)) return "papertrail";
  return "imbox";
}

function toThread(messages: RawMessage[]): Thread {
  const sorted = messages.slice().sort((a, b) => a.ts.localeCompare(b.ts));
  const last = sorted[sorted.length - 1];
  return {
    id: "t:" + normSubject(last.subject) + ":" + last.fromEmail,
    view: classifyView(last),
    from: last.from, fromEmail: last.fromEmail, subject: last.subject,
    snippet: last.bodyText.slice(0, 140), ts: last.ts,
    unread: sorted.some((m) => !m.flags.includes("\\Seen")),
    replyLaterAt: sorted.some((m) => m.flags.includes("$ReplyLater")) ? last.ts : null,
    setAside: sorted.some((m) => m.flags.includes("$SetAside")),
    messages: sorted,
  };
}

function group(messages: RawMessage[]): Thread[] {
  const by = new Map<string, RawMessage[]>();
  for (const m of messages) { const k = normSubject(m.subject); (by.get(k) ?? by.set(k, []).get(k)!).push(m); }
  return [...by.values()].map(toThread).sort((a, b) => b.ts.localeCompare(a.ts));
}

export interface MailBridge {
  listThreads(view: MailView): Promise<Thread[]>;
  getThread(id: string): Promise<Thread | null>;
  act(threadId: string, action: ThreadAction): Promise<{ ok: boolean }>;
  listScreener(): Promise<Array<{ from: string; fromEmail: string; subject: string }>>;
  screen(email: string, decision: "approve" | "block"): Promise<{ ok: boolean }>;
}

/** Build the bridge over an ImapStore. `approved` = the Screener allow-list (Hey: new senders wait in the Screener). */
export function createMailBridge(store: ImapStore, approved: Set<string> = new Set()): MailBridge {
  const inbox = async (): Promise<RawMessage[]> => await store.list("INBOX");

  return {
    async listThreads(view) {
      const msgs = (await inbox()).filter((m) => approved.has(m.fromEmail) && classifyView(m) === view);
      return group(msgs);
    },
    async getThread(id) {
      const all = await inbox();
      const t = group(all).find((x) => x.id === id);
      return t ?? null;
    },
    async act(threadId, action) {
      const all = await inbox();
      const t = group(all).find((x) => x.id === threadId);
      if (!t?.messages) return { ok: false };
      for (const m of t.messages) {
        if (action === "read") await store.setFlag(m.id, "\\Seen", true);
        else if (action === "reply-later") await store.setFlag(m.id, "$ReplyLater", true);
        else if (action === "set-aside") await store.setFlag(m.id, "$SetAside", true);
        else if (action === "done") await store.move(m.id, "Archive");
      }
      return { ok: true };
    },
    async listScreener() {
      const newSenders = new Map<string, RawMessage>();
      for (const m of await inbox()) if (!approved.has(m.fromEmail) && !newSenders.has(m.fromEmail)) newSenders.set(m.fromEmail, m);
      return [...newSenders.values()].map((m) => ({ from: m.from, fromEmail: m.fromEmail, subject: m.subject }));
    },
    async screen(email, decision) {
      if (decision === "approve") { approved.add(email); return { ok: true }; }
      for (const m of await inbox()) if (m.fromEmail === email) await store.move(m.id, "Spam");
      return { ok: true };
    },
  };
}
