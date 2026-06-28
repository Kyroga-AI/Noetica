/** Proofs for the mail bridge: Hey-style view classification, screener allow-list, thread actions mutating IMAP,
 *  all over a fake in-memory ImapStore (production swaps in real Dovecot IMAP). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMailBridge, classifyView, type ImapStore, type RawMessage } from "./mail-bridge.js";

const mk = (o: Partial<RawMessage> & { id: string }): RawMessage => ({
  folder: "INBOX", from: "X", fromEmail: "x@e.com", subject: "Hi", ts: "2026-06-01", bodyText: "body", headers: {}, flags: [], ...o,
});

function fakeStore(seed: RawMessage[]): ImapStore & { msgs: RawMessage[] } {
  const msgs = seed.slice();
  return {
    msgs,
    list: (folder) => msgs.filter((m) => m.folder === folder),
    get: (id) => msgs.find((m) => m.id === id),
    setFlag: (id, flag, on) => { const m = msgs.find((x) => x.id === id); if (m) m.flags = on ? [...new Set([...m.flags, flag])] : m.flags.filter((f) => f !== flag); },
    move: (id, folder) => { const m = msgs.find((x) => x.id === id); if (m) m.folder = folder; },
  };
}

test("classifyView: bulk → feed, transactional → papertrail, else imbox", () => {
  assert.equal(classifyView(mk({ id: "1", headers: { "list-unsubscribe": "<u>" } })), "feed");
  assert.equal(classifyView(mk({ id: "2", subject: "Your receipt #123" })), "papertrail");
  assert.equal(classifyView(mk({ id: "3", subject: "Lunch tomorrow?" })), "imbox");
});

test("listThreads(imbox) returns only approved senders' personal mail", async () => {
  const store = fakeStore([
    mk({ id: "1", fromEmail: "gus@e.com", subject: "Project plan" }),
    mk({ id: "2", fromEmail: "news@e.com", subject: "Weekly", headers: { "list-unsubscribe": "<u>" } }),
    mk({ id: "3", fromEmail: "stranger@e.com", subject: "Hi there" }),
  ]);
  const b = createMailBridge(store, new Set(["gus@e.com", "news@e.com"]));
  const imbox = await b.listThreads("imbox");
  assert.deepEqual(imbox.map((t) => t.fromEmail), ["gus@e.com"], "stranger not approved; news is feed");
  assert.equal((await b.listThreads("feed")).length, 1);
});

test("screener lists new senders; approve makes their mail appear", async () => {
  const store = fakeStore([mk({ id: "1", fromEmail: "new@e.com", subject: "Intro" })]);
  const b = createMailBridge(store, new Set());
  assert.deepEqual((await b.listScreener()).map((s) => s.fromEmail), ["new@e.com"]);
  assert.equal((await b.listThreads("imbox")).length, 0, "pending sender hidden");
  await b.screen("new@e.com", "approve");
  assert.equal((await b.listThreads("imbox")).length, 1, "now visible");
});

test("actions mutate IMAP: done archives, read sets \\Seen", async () => {
  const store = fakeStore([mk({ id: "1", fromEmail: "gus@e.com", subject: "Ping" })]);
  const b = createMailBridge(store, new Set(["gus@e.com"]));
  const t = (await b.listThreads("imbox"))[0];
  await b.act(t.id, "read");
  assert.ok(store.msgs[0].flags.includes("\\Seen"));
  await b.act(t.id, "done");
  assert.equal(store.msgs[0].folder, "Archive");
});

test("block moves a sender's mail to Spam", async () => {
  const store = fakeStore([mk({ id: "1", fromEmail: "spam@e.com", subject: "Buy now" })]);
  const b = createMailBridge(store, new Set());
  await b.screen("spam@e.com", "block");
  assert.equal(store.msgs[0].folder, "Spam");
});
