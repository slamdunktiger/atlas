#!/usr/bin/env python3
"""Atlas — single-agent life dashboard backend.

Local-first: ONE SQLite store, ONE agent (Hermes). No ChatGPT/Claude/MCP
three-brain circus, no nightly "memory exchange" hack. Hermes reads/writes
this same DB directly; the dashboard is just the UI over it.
"""
import json, os, sqlite3, datetime
import urllib.parse as urllib_parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DB_PATH = os.environ.get("ATLAS_DB", os.path.expanduser("~/.atlas/atlas.db"))
PORT = int(os.environ.get("ATLAS_PORT", "8731"))
HERE = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(HERE, "index.html")

RESOURCES = {
    "areas":     ["id", "name", "description"],
    "projects":  ["id", "name", "area_id", "status"],
    "tasks":     ["id", "title", "project_id", "area_id", "status", "priority", "due", "notes", "recur", "parent_id"],
    "notes":     ["id", "title", "body", "folder", "tags", "created"],
    "habits":    ["id", "name", "area_id", "frequency", "streak", "last_done"],
    "goals":     ["id", "title", "area_id", "status", "target"],
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS areas    (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT);
CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, area_id INTEGER, status TEXT DEFAULT 'active');
CREATE TABLE IF NOT EXISTS tasks    (id INTEGER PRIMARY KEY, title TEXT NOT NULL, project_id INTEGER, area_id INTEGER, status TEXT DEFAULT 'open', priority INTEGER DEFAULT 2, due TEXT, notes TEXT, recur TEXT DEFAULT '', parent_id INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS notes    (id INTEGER PRIMARY KEY, title TEXT, body TEXT, folder TEXT DEFAULT 'inbox', tags TEXT, created TEXT);
CREATE TABLE IF NOT EXISTS habits   (id INTEGER PRIMARY KEY, name TEXT NOT NULL, area_id INTEGER, frequency TEXT DEFAULT 'daily', streak INTEGER DEFAULT 0, last_done TEXT);
CREATE TABLE IF NOT EXISTS goals    (id INTEGER PRIMARY KEY, title TEXT NOT NULL, area_id INTEGER, status TEXT DEFAULT 'active', target TEXT);
CREATE TABLE IF NOT EXISTS ledger   (id INTEGER PRIMARY KEY, ts TEXT, actor TEXT, action TEXT, detail TEXT);
"""

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    # migrate: add columns that didn't exist when an old DB was first created
    cols = [r[1] for r in conn.execute("PRAGMA table_info(tasks)").fetchall()]
    for col, ddl in [("recur", "TEXT DEFAULT ''"), ("parent_id", "INTEGER DEFAULT 0")]:
        if col not in cols:
            conn.execute(f"ALTER TABLE tasks ADD COLUMN {col} {ddl}")
    conn.commit()
    return conn

def log(conn, actor, action, detail=""):
    conn.execute("INSERT INTO ledger(ts,actor,action,detail) VALUES(?,?,?,?)",
                 (datetime.datetime.now().isoformat(timespec="seconds"), actor, action, detail))
    conn.commit()

def json_body(handler):
    length = int(handler.headers.get("Content-Length", 0) or 0)
    if not length:
        return {}
    raw = handler.rfile.read(length)
    try:
        return json.loads(raw or b"{}")
    except json.JSONDecodeError:
        return {}

def clean(table, data):
    cols = RESOURCES[table]
    return {k: v for k, v in data.items() if k in cols and v is not None}

# Lightweight single-brain classifier. Server-side analog of the OP's
# "Hermes classifies the recipe video" — deterministic rules so capture works
# with zero LLM calls. A real Hermes session can still override folder/tags
# via POST /api/notes; this is the fast default path.
# Keywords matched on WORD BOUNDARIES so "runs" doesn't trip "run", etc.
import re as _re
_RULES = [
    ("food",     ["recipe", "cook", "food", "meal", "curry", "pasta", "bake", "restaurant", "ingredient", "eat"]),
    ("health",   ["workout", "gym", "run", "sleep", "pain", "injury", "doctor", "stretch", "lift", "recovery", "vitamin"]),
    ("work",     ["meeting", "client", "invoice", "project", "deadline", "ticket", "bug", "deploy", "sprint", "standup"]),
    ("code",     ["python", "javascript", "function", "api", "sql", "repo", "git", "docker", "server", "code"]),
    ("money",    ["price", "cost", "budget", "pay", "salary", "invest", "crypto", "subscription", "bill"]),
    ("reading",  ["article", "book", "read", "paper", "blog", "thread", "post", "newsletter"]),
    ("ideas",    ["idea", "maybe", "brainstorm", "what if", "could we", "should i"]),
    ("atlas",    ["atlas", "dashboard", "habit", "task", "note system"]),
]
_BOUND = [(f, [_re.compile(r"(?:\b|(?<=/))" + _re.escape(k) + r"\b", _re.I) for k in kws]) for f, kws in _RULES]

def classify(text):
    t = text or ""
    tags, best = [], None
    for folder, pats in _BOUND:
        if any(p.search(t) for p in pats):
            tags.append(folder)
    if tags:
        best = tags[0]
    if "http://" in t or "https://" in t:
        tags.append("web")
        best = best or "reading"
    return (best or "inbox"), sorted(set(tags)) or ["inbox"]

class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj=None, body=None):
        self.send_response(code)
        if obj is not None:
            self.send_header("Content-Type", "application/json")
            payload = json.dumps(obj).encode()
        else:
            payload = body if body is not None else b""
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        parsed = urllib_parse.urlparse(self.path)
        if parsed.path == "/capture":
            try:
                with open(os.path.join(HERE, "capture.html"), "rb") as f:
                    self._send(200, body=f.read())
            except FileNotFoundError:
                self._send(404, body=b"capture.html missing")
            return
        if parsed.path in ("/", "/index.html"):
            try:
                with open(INDEX, "rb") as f:
                    self._send(200, body=f.read())
            except FileNotFoundError:
                self._send(404, body=b"index.html missing")
            return
        if parsed.path in ("/app.js", "/style.css"):
            p = os.path.join(HERE, parsed.path.lstrip("/"))
            try:
                with open(p, "rb") as f:
                    self._send(200, body=f.read())
            except FileNotFoundError:
                self._send(404, body=b"missing")
            return
        if parsed.path.startswith("/api/"):
            self.handle_api_get(parsed)
            return
        self._send(404, body=b"not found")

    def handle_api_get(self, parsed):
        parts = [p for p in parsed.path.split("/") if p]
        if parts[1] == "overview":
            self._send(200, obj=self.overview())
            return
        if parts[1] == "today":
            self._send(200, obj=self.today())
            return
        if parts[1] == "habit" and len(parts) == 4 and parts[3] == "checkin":
            self.habit_checkin(int(parts[2]))
            return
        conn = get_db()
        if len(parts) == 2:
            table = parts[1]
            rows = [dict(r) for r in conn.execute(f"SELECT * FROM {table}").fetchall()]
            conn.close()
            self._send(200, obj=rows)
            return
        if len(parts) == 3:
            table, rid = parts[1], parts[2]
            row = conn.execute(f"SELECT * FROM {table} WHERE id=?", (rid,)).fetchone()
            conn.close()
            self._send(200, obj=dict(row) if row else {"error": "not found"})
            return
        self._send(400, obj={"error": "bad route"})

    def do_POST(self):
        parts = [p for p in urllib_parse.urlparse(self.path).path.split("/") if p]
        if len(parts) == 2 and parts[1] == "capture":
            self.handle_capture()
            return
        if len(parts) == 4 and parts[1] == "habit" and parts[3] == "checkin":
            self.habit_checkin(int(parts[2]))
            return
        if len(parts) != 2:
            self._send(400, obj={"error": "bad route"})
            return
        table = parts[1]
        data = clean(table, json_body(self))
        conn = get_db()
        cols = list(data.keys())
        ph = ",".join("?" for _ in cols)
        conn.execute(f"INSERT INTO {table} ({','.join(cols)}) VALUES ({ph})",
                     [data[c] for c in cols])
        new_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        if table == "notes":
            conn.execute("UPDATE notes SET created=? WHERE id=?",
                         (datetime.datetime.now().isoformat(timespec="seconds"), new_id))
        if table == "habits":
            conn.execute("UPDATE habits SET streak=0 WHERE id=?", (new_id,))
        log(conn, "hermes", f"create {table}", f"#{new_id} {data.get('name') or data.get('title')}")
        conn.commit()
        row = conn.execute(f"SELECT * FROM {table} WHERE id=?", (new_id,)).fetchone()
        conn.close()
        self._send(201, obj=dict(row))

    def handle_capture(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b"{}"
        data = {}
        try:
            data = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            qs = urllib_parse.parse_qs(raw.decode("utf-8", "ignore"))
            data = {k: (v[0] if v else "") for k, v in qs.items()}
        text = data.get("text") or data.get("body") or data.get("content") or ""
        title = data.get("title") or (text.strip().split("\n")[0][:80] if text.strip() else "capture")
        url = data.get("url") or ""
        folder = data.get("folder")
        tags = data.get("tags")
        blob = f"{title}\n{text}\n{url}".strip()
        if not folder or not tags:
            cf, ct = classify(blob)
            folder = folder or cf
            tags = tags or ",".join(ct)
        conn = get_db()
        conn.execute(
            "INSERT INTO notes(title,body,folder,tags,created) VALUES(?,?,?,?,?)",
            (title, text, folder, tags, datetime.datetime.now().isoformat(timespec="seconds")))
        new_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        log(conn, "capture", "create notes", f"#{new_id} {title} → {folder} [{tags}]")
        conn.commit()
        row = conn.execute("SELECT * FROM notes WHERE id=?", (new_id,)).fetchone()
        conn.close()
        self._send(201, obj=dict(row))

    def do_PATCH(self):
        parts = [p for p in urllib_parse.urlparse(self.path).path.split("/") if p]
        if len(parts) != 3:
            self._send(400, obj={"error": "bad route"})
            return
        table, rid = parts[1], parts[2]
        data = clean(table, json_body(self))
        if not data:
            self._send(400, obj={"error": "no fields"})
            return
        conn = get_db()
        sets = ",".join(f"{k}=?" for k in data)
        conn.execute(f"UPDATE {table} SET {sets} WHERE id=?", [data[k] for k in data] + [rid])
        log(conn, "hermes", f"update {table}", f"#{rid} {list(data)}")
        conn.commit()
        row = conn.execute(f"SELECT * FROM {table} WHERE id=?", (rid,)).fetchone()
        conn.close()
        self._send(200, obj=dict(row) if row else {"error": "not found"})

    def do_DELETE(self):
        parts = [p for p in urllib_parse.urlparse(self.path).path.split("/") if p]
        if len(parts) != 3:
            self._send(400, obj={"error": "bad route"})
            return
        table, rid = parts[1], parts[2]
        conn = get_db()
        conn.execute(f"DELETE FROM {table} WHERE id=?", (rid,))
        log(conn, "hermes", f"delete {table}", f"#{rid}")
        conn.commit()
        conn.close()
        self._send(200, obj={"ok": True})

    def today(self):
        conn = get_db()
        self.rollover_recurring(conn)
        today = datetime.date.today().isoformat()
        rows = conn.execute(
            "SELECT * FROM tasks WHERE status!='done' AND due IS NOT NULL AND due<='%s' ORDER BY due"
            % today).fetchall()
        due = [dict(r) for r in rows]
        habits = [dict(r) for r in conn.execute("SELECT * FROM habits").fetchall()]
        conn.close()
        return {"date": today, "due": due, "habits": habits}

    def rollover_recurring(self, conn):
        """When a recurring task is marked done, clone the next instance with a
        shifted due date. Keeps the single-brain model: no cron, no 3-bot swap."""
        today = datetime.date.today()
        for t in conn.execute("SELECT * FROM tasks WHERE recur!='' AND recur IS NOT NULL").fetchall():
            due = t["due"]
            if not due:
                continue
            try:
                d = datetime.date.fromisoformat(due)
            except ValueError:
                continue
            if d < today:  # overdue and not yet rolled → shift it forward
                shift = {"daily": 1, "weekly": 7, "monthly": 30}.get(t["recur"], 1)
                nd = d + datetime.timedelta(days=shift)
                conn.execute("UPDATE tasks SET due=? WHERE id=?", (nd.isoformat(), t["id"]))
                log(conn, "atlas", "recur shift", f"#{t['id']} {t['title']} → {nd.isoformat()}")
        conn.commit()

    def habit_checkin(self, hid):
        conn = get_db()
        h = conn.execute("SELECT * FROM habits WHERE id=?", (hid,)).fetchone()
        if not h:
            conn.close()
            self._send(404, obj={"error": "no habit"})
            return
        today = datetime.date.today().isoformat()
        last = h["last_done"] or ""
        if last == today:
            conn.close()
            self._send(200, obj={"ok": True, "streak": h["streak"], "note": "already done today"})
            return
        # consecutive-day streak for daily; otherwise just bump
        bump = 1
        if h["frequency"] == "daily" and last:
            try:
                prev = datetime.date.fromisoformat(last)
                if (datetime.date.today() - prev).days == 1:
                    bump = h["streak"] + 1
                else:
                    bump = 1
            except ValueError:
                bump = 1
        conn.execute("UPDATE habits SET streak=?, last_done=? WHERE id=?",
                     (bump, today, hid))
        log(conn, "hermes", "habit checkin", f"#{hid} {h['name']} → streak {bump}")
        conn.commit()
        row = conn.execute("SELECT * FROM habits WHERE id=?", (hid,)).fetchone()
        conn.close()
        self._send(200, obj=dict(row))

    def overview(self):
        conn = get_db()
        o = {}
        for t in RESOURCES:
            o[t] = [dict(r) for r in conn.execute(f"SELECT * FROM {t}").fetchall()]
        o["ledger"] = [dict(r) for r in
                       conn.execute("SELECT * FROM ledger ORDER BY id DESC LIMIT 12").fetchall()]
        o["counts"] = {t: len(o[t]) for t in RESOURCES}
        conn.close()
        return o

    def log_message(self, *args):
        pass

if __name__ == "__main__":
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Atlas running on http://localhost:{PORT}  (db: {DB_PATH})")
    srv.serve_forever()
