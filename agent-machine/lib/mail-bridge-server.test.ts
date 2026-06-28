/** Proof the mail bridge RUNS over HTTP against the exact Vue mailApi contract: views, screener, actions, summary. */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createMailServer } from "./mail-bridge-server.js";

test("live HTTP mail bridge: views, screener, action, summary", async () => {
  const server = createMailServer();
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const imbox = (await (await fetch(`${base}/views/imbox/threads`)).json()) as { threads: Array<{ id: string; fromEmail: string }> };
    assert.ok(imbox.threads.length >= 1 && imbox.threads.every((t) => t.fromEmail !== "ben@stratechery.com"), "imbox excludes the feed sender");

    const feed = (await (await fetch(`${base}/views/feed/threads`)).json()) as { threads: unknown[] };
    assert.ok(feed.threads.length >= 1, "feed has the newsletter");

    const screener = (await (await fetch(`${base}/screener`)).json()) as { items: Array<{ fromEmail: string }> };
    assert.ok(screener.items.some((i) => i.fromEmail === "sdr@acme.io"), "new sender waits in screener");

    const tid = imbox.threads[0].id;
    const act = await fetch(`${base}/threads/${encodeURIComponent(tid)}/done`, { method: "POST" });
    assert.equal(act.status, 200);

    const sum = (await (await fetch(`${base}/ai/summary`, { method: "POST", body: JSON.stringify({ threadId: tid }) })).json()) as { summary: string };
    assert.ok(typeof sum.summary === "string");
  } finally {
    server.close();
  }
});
