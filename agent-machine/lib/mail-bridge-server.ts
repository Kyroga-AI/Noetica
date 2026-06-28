/**
 * mail-bridge-server — runnable HTTP front for the mail bridge, matching the Vue `mailApi` contract exactly so the
 * webmail UI runs against it with zero client changes (set VITE_MAIL_API to its URL). Boots over an in-memory demo
 * store; prod swaps the ImapStore for a Dovecot IMAP adapter. AI endpoints route to the choir in prod.
 */
import * as http from "node:http";
import { createMailBridge, type ImapStore, type RawMessage, type ThreadAction } from "./mail-bridge.js";

function demoStore(): ImapStore {
  const msgs: RawMessage[] = [
    { id: "1", folder: "INBOX", from: "Mira Chen", fromEmail: "mira@socioprophet.ai", subject: "Q3 board deck — final pass", ts: "2026-06-27T09:42", bodyText: "Pushed the revenue slide; can you sanity-check the projection before 2pm? Want it airtight for the board.", headers: {}, flags: [] },
    { id: "2", folder: "INBOX", from: "Gus Romero", fromEmail: "gus@socioprophet.ai", subject: "Re: choir GPU sizing", ts: "2026-06-26T16:10", bodyText: "Let's go with the L4 for now and revisit at scale.", headers: {}, flags: ["\\Seen"] },
    { id: "3", folder: "INBOX", from: "Stratechery", fromEmail: "ben@stratechery.com", subject: "The sovereign-AI cost curve", ts: "2026-06-27T07:00", bodyText: "Why flat infra beats per-seat…", headers: { "list-unsubscribe": "<u>" }, flags: [] },
    { id: "4", folder: "INBOX", from: "Stripe", fromEmail: "no-reply@stripe.com", subject: "Payout sent — receipt $12,480", ts: "2026-06-27T08:10", bodyText: "Your payout has been sent.", headers: {}, flags: [] },
    { id: "5", folder: "INBOX", from: "Acme Sales", fromEmail: "sdr@acme.io", subject: "Quick question about your AI stack", ts: "2026-06-27T10:01", bodyText: "Wanted to introduce…", headers: {}, flags: [] },
  ];
  return {
    list: (folder) => msgs.filter((m) => m.folder === folder),
    get: (id) => msgs.find((m) => m.id === id),
    setFlag: (id, flag, on) => { const m = msgs.find((x) => x.id === id); if (m) m.flags = on ? [...new Set([...m.flags, flag])] : m.flags.filter((f) => f !== flag); },
    move: (id, folder) => { const m = msgs.find((x) => x.id === id); if (m) m.folder = folder; },
  };
}

const ACTION_MAP: Record<string, ThreadAction> = { replyLater: "reply-later", setAside: "set-aside", done: "done", snooze: "set-aside", read: "read" };

export function createMailServer(opts: { store?: ImapStore; approved?: Set<string> } = {}): http.Server {
  const bridge = createMailBridge(opts.store ?? demoStore(), opts.approved ?? new Set(["mira@socioprophet.ai", "gus@socioprophet.ai", "ben@stratechery.com", "no-reply@stripe.com"]));
  const send = (res: http.ServerResponse, status: number, body: unknown): void => { res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" }); res.end(JSON.stringify(body)); };
  const readJson = (req: http.IncomingMessage): Promise<Record<string, unknown>> => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { r(b ? JSON.parse(b) : {}); } catch { r({}); } }); });

  return http.createServer(async (req, res) => {
    const seg = new URL(req.url ?? "/", "http://x").pathname.split("/").filter(Boolean);
    try {
      // GET /views/:view/threads
      if (req.method === "GET" && seg[0] === "views" && seg[2] === "threads") return send(res, 200, { threads: await bridge.listThreads(seg[1] as never) });
      // GET /threads/:id
      if (req.method === "GET" && seg[0] === "threads" && seg.length === 2) { const t = await bridge.getThread(seg[1]); return t ? send(res, 200, t) : send(res, 404, { error: "not found" }); }
      // POST /threads/:id/:action
      if (req.method === "POST" && seg[0] === "threads" && seg.length === 3) { const a = ACTION_MAP[seg[2]]; return a ? send(res, 200, await bridge.act(seg[1], a)) : send(res, 400, { error: "bad action" }); }
      // GET /screener
      if (req.method === "GET" && seg[0] === "screener" && seg.length === 1) return send(res, 200, { items: (await bridge.listScreener()).map((s) => ({ id: s.fromEmail, from: s.from, fromEmail: s.fromEmail, subjectPreview: s.subject, firstSeen: "" })) });
      // POST /screener/:id/:decision
      if (req.method === "POST" && seg[0] === "screener" && seg.length === 3) return send(res, 200, await bridge.screen(seg[1], seg[2] === "approve" ? "approve" : "block"));
      // POST /send  (accept; prod hands to Postfix submission)
      if (req.method === "POST" && seg[0] === "send") { await readJson(req); return send(res, 200, { ok: true }); }
      // POST /ai/summary  (prod: choir; here: extractive first-sentence summary of the thread)
      if (req.method === "POST" && seg[0] === "ai" && seg[1] === "summary") { const { threadId } = await readJson(req); const t = await bridge.getThread(String(threadId)); const body = t?.messages?.[t.messages.length - 1]?.bodyText ?? ""; return send(res, 200, { summary: body.split(/(?<=[.!?])\s/)[0] || "(empty)" }); }
      if (req.method === "POST" && seg[0] === "ai" && seg[1] === "draft") return send(res, 200, { draft: "" });
      if (req.method === "GET" && seg[0] === "healthz") return send(res, 200, { ok: true });
      send(res, 404, { error: "not found" });
    } catch (e) { send(res, 500, { error: (e as Error).message }); }
  });
}

export function startMailServer(port = Number(process.env["PORT"] ?? 8090)): http.Server {
  const server = createMailServer();
  server.listen(port, () => console.log(`mail-bridge listening on :${port}`));
  return server;
}
