# Atlas — single-agent life dashboard

Clone of the Reddit "Life Atlas" idea, done **better**: one local SQLite
store, one brain (Hermes). No ChatGPT + Claude + Hermes MCP relay, no
nightly three-way "memory exchange" hack. The dashboard is just the UI over
one DB that Hermes reads and writes directly.

## Why this is better than the original
- **No context fragmentation.** The OP ran 3 separate assistants on the same
  DB and bolted on a nightly summary swap so they could "read each other's
  notes." That's three brains that never actually share context. Atlas has
  ONE brain — Hermes — so there's nothing to reconcile.
- **No multi-vendor API keys / MCP servers.** Just Python stdlib + a browser.
- **Auditable.** Every mutation Hermes makes is written to a `ledger` table
  you can open on the Ledger tab. The original's "memory exchange" was
  invisible glue.
- **Local-first, portable.** SQLite file under `~/.atlas/atlas.db`. Runs on
  your Mac or any VPS you control.

## Run it
```bash
cd ~/atlas
python3 atlas_server.py
# open http://localhost:8731
```
Click **seed demo** to populate a starter corpus, then **+ add** to create
rows in any view. The Board tab is a Kanban over tasks; the Ledger tab shows
every change Hermes has made.

## Hermes integration
Hermes doesn't need an MCP server — it can just call the REST API (or the
SQLite file directly). Examples:
```bash
# add a task
curl -X POST localhost:8731/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Buy milk","status":"open","priority":3}'

# classify a captured note (the original needed Telegram→3 bots; here it's 1 call)
curl -X POST localhost:8731/api/notes \
  -H 'Content-Type: application/json' \
  -d '{"title":"Recipe: curry","folder":"kitchen","tags":"food","body":"..."}'
```

## API
| Method | Route | Purpose |
|--------|-------|---------|
| GET  | /api/overview | counts + recent ledger |
| GET  | /api/<resource> | list |
| POST | /api/<resource> | create |
| PATCH| /api/<resource>/<id> | update (partial) |
| DELETE|/api/<resource>/<id> | delete |

Resources: `areas, projects, tasks, notes, habits, goals`.
