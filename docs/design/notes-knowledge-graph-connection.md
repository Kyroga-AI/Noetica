# How Notes connects to the knowledge graph — design reference

Source: [`components/surfaces/NotesSurface.tsx`](../../components/surfaces/NotesSurface.tsx),
[`agent-machine/lib/doc-store.ts`](../../agent-machine/lib/doc-store.ts),
[`agent-machine/lib/collections.ts`](../../agent-machine/lib/collections.ts)

Written for design/UI reference — the connection between a Note and the knowledge graph is real,
but it's opt-in and was previously invisible in the UI (see "What changed" below). This describes
the mechanism as of PR #479, not the pre-fix behavior.

## The short version

**A note is not in the knowledge graph by default.** Writing in Notes is a private, local scratch
space. Only when you click the **Index** button does that note's content get pushed through the
same ingestion pipeline as an uploaded file — chunked, embedded, entity-grounded — and become
something the agent can recall in unrelated conversations.

## The mechanism

1. Clicking **Index** builds `# {title}\n\n{body}` as markdown and POSTs it to
   `/api/ingest/queue` with `filename: "notes/<id>.md"` and `collection: "notes"`.
2. The ingest route registers a **stable, named collection** the first time it's used —
   `ensureCollection('notes', 'Notes')` — the same pattern the built-in "Inbox" catch-all
   collection already follows. This is what gives indexed notes a dedicated, human-readable
   group ("Notes") in the Library/Knowledge Graph view, instead of blending into generic
   unsorted uploads.
3. Ingestion itself is **queued and asynchronous** (`agent-machine/lib/ingest-queue.ts`) — a
   background worker chunks the text, embeds each chunk, and grounds recognized entities into
   the graph. The frontend polls `/api/ingest/status` until the job reports `done`, and only
   then does it consider the note actually indexed.
4. On success, the **Note itself** records the outcome: `indexedDocId`, `indexedAt`, and
   `indexedSnapshot` (the exact markdown that was indexed). These live on the note, not just in
   transient component state — reload the app and the indexed state is still correct.
5. **Re-indexing** (editing a previously-indexed note, then clicking Index again) produces a new
   content-hashed document id — correct, since the graph's document ids are `sha1(text)`-derived.
   The *previous* document id is passed back as `previousDocId` and explicitly hidden
   (`hideDocument()`) so the old, stale version doesn't linger in the graph as an orphaned
   duplicate.

## What the Index button actually communicates

The button reflects real, persistent state — not a fire-and-forget toast:

| State | Meaning |
|---|---|
| **Index** | Never indexed, or no content yet |
| **Indexing…** | Job enqueued, waiting on the background worker |
| **Indexed Xh ago** | `indexedSnapshot` matches the current title+body — the graph has your latest content |
| **Re-index** (amber) | The note has changed since `indexedSnapshot` was captured — the graph still has the *old* version |
| **Index failed** (red) | The background job reported an error (shown as the button's title/tooltip) |

## What's still NOT connected

- **Chat and Canvas do not feed the graph this way.** Canvas documents are never ingested at all.
  Regular Chat conversations may contribute to episodic memory through a separate mechanism, but
  that's a different pipeline from document ingestion.
- **No link from a Library/Knowledge Graph row back to its source Note**, and vice versa — once
  indexed, the resulting Document node doesn't carry a reference back to `note.id`. If a designer
  wants a "Open source note" affordance in the graph explorer, that reverse link doesn't exist yet
  and would need a new field (e.g. a `sourceNoteId` property on the Document node).
- **No bulk "index all notes" or auto-index-on-save.** Every note has to be indexed individually,
  and never automatically — this is a deliberate, explicit user action, not an ambient background
  sync.
