import json
import sqlite3
import re
import shutil
import threading
from pathlib import Path
from contextlib import contextmanager
from datetime import datetime, timezone
from uuid import uuid4
from .citations import format_timestamp, timed_link

SCHEMA = '''
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
INSERT OR IGNORE INTO schema_version VALUES (1);
CREATE TABLE IF NOT EXISTS notes (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
 course TEXT NOT NULL, topic TEXT NOT NULL, tags TEXT NOT NULL,
 comment TEXT NOT NULL, source_app TEXT NOT NULL, source_reference TEXT NOT NULL,
 source_timestamp TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS citations (
 id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
 title TEXT NOT NULL, url TEXT NOT NULL, start_ms INTEGER NOT NULL CHECK(start_ms >= 0),
 end_ms INTEGER CHECK(end_ms >= start_ms), comment TEXT NOT NULL, transcript_excerpt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attachments (
 id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
 filename TEXT NOT NULL, stored_name TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL,
 size INTEGER NOT NULL, media_type TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ocr_jobs (
 id TEXT PRIMARY KEY, attachment_id TEXT NOT NULL UNIQUE REFERENCES attachments(id),
 state TEXT NOT NULL, raw_text TEXT NOT NULL DEFAULT '', corrected_text TEXT,
 error TEXT, provider TEXT NOT NULL DEFAULT 'tesseract', language TEXT NOT NULL DEFAULT 'eng'
);
CREATE INDEX IF NOT EXISTS notes_course ON notes(course);
CREATE TABLE IF NOT EXISTS workspace_files (
 note_id TEXT PRIMARY KEY REFERENCES notes(id), relative_folder TEXT NOT NULL
);
'''

class Store:
    def __init__(self, directory: Path):
        self.directory = directory.resolve()
        self.mirror_lock = threading.RLock()
        directory.mkdir(parents=True, exist_ok=True)
        self.attachments = directory / 'attachments'
        self.attachments.mkdir(exist_ok=True)
        self.db = directory / 'scholo.sqlite3'
        for folder in ('notes', 'learning-records', 'style-profiles'):
            (directory / folder).mkdir(exist_ok=True)
        with self.connection() as db:
            db.executescript(SCHEMA)
            # Interrupted work is explicitly retryable, never left processing forever.
            db.execute("UPDATE ocr_jobs SET state='failed', error='Interrupted. Retry OCR.' WHERE state IN ('queued','processing')")

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.db, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        try:
            with db:
                yield db
        finally:
            db.close()

    def get(self, note_id):
        with self.connection() as db:
            row = db.execute('SELECT * FROM notes WHERE id=?', (note_id,)).fetchone()
            if not row:
                return None
            note = dict(row)
            note['tags'] = json.loads(note['tags'])
            note['citations'] = [dict(c) for c in db.execute('SELECT * FROM citations WHERE note_id=? ORDER BY rowid', (note_id,))]
            note['attachments'] = [dict(a) for a in db.execute('SELECT a.*, j.id AS ocr_id, j.state AS ocr_state, j.raw_text, j.corrected_text, j.error AS ocr_error FROM attachments a LEFT JOIN ocr_jobs j ON j.attachment_id=a.id WHERE a.note_id=? ORDER BY a.rowid', (note_id,))]
            return note

    def save(self, data, note_id=None):
        note_id = note_id or str(uuid4())
        now = datetime.now(timezone.utc).isoformat()
        values = data.model_dump(mode='json', exclude={'citations'})
        values['tags'] = json.dumps(values['tags'])
        with self.connection() as db:
            exists = db.execute('SELECT id FROM notes WHERE id=?', (note_id,)).fetchone()
            if exists:
                db.execute('UPDATE notes SET ' + ','.join(f'{k}=?' for k in values) + ',updated_at=? WHERE id=?', (*values.values(), now, note_id))
            else:
                db.execute('INSERT INTO notes (' + ','.join(['id', *values, 'created_at', 'updated_at']) + ') VALUES (' + ','.join('?' for _ in range(len(values)+3)) + ')', (note_id, *values.values(), now, now))
            db.execute('DELETE FROM citations WHERE note_id=?', (note_id,))
            for citation in data.citations:
                c = citation.model_dump()
                db.execute('INSERT INTO citations VALUES (?,?,?,?,?,?,?,?)', (str(uuid4()), note_id, c['title'], c['url'], c['start_ms'], c['end_ms'], c['comment'], c['transcript_excerpt']))
        self.sync_note(note_id)
        return self.get(note_id)

    def safe_component(self, text, fallback):
        # Names are labels, never user-supplied relative paths.
        name = re.sub(r'[^\w -]', '-', text, flags=re.UNICODE).strip(' .-')[:70]
        if not name or name.upper() in {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(10)), *(f'LPT{i}' for i in range(10))}:
            return fallback
        return name

    def within_workspace(self, relative):
        target = (self.directory / relative).resolve()
        if not target.is_relative_to(self.directory):
            raise ValueError('Storage path escapes the workspace.')
        return target

    def sync_note(self, note_id):
        """Write readable files after each save/import/OCR update, with stable asset links."""
        with self.mirror_lock:
            note = self.get(note_id)
            if not note:
                return
            relative = Path('notes') / self.safe_component(note['course'], 'Unfiled') / self.safe_component(note['topic'], 'General') / note_id
            folder = self.within_workspace(relative)
            folder.parent.mkdir(parents=True, exist_ok=True)
            with self.connection() as db:
                previous = db.execute('SELECT relative_folder FROM workspace_files WHERE note_id=?', (note_id,)).fetchone()
            if previous and previous['relative_folder'] != relative.as_posix():
                old = self.within_workspace(previous['relative_folder'])
                if old.exists() and not folder.exists():
                    old.rename(folder)
            folder.mkdir(exist_ok=True)
            assets = folder / 'assets'
            assets.mkdir(exist_ok=True)
            lines = [f"# {note['title']}", '', f"Course: {note['course'] or 'Unfiled'}", f"Topic: {note['topic'] or 'General'}",
                     f"Tags: {', '.join(note['tags'])}", '', note['body'], '', '## Comment / instructions', note['comment'],
                     '', '## Source', f"Application: {note['source_app'] or 'Unknown'}",
                     f"Reference: {note['source_reference'] or 'Unknown'}", f"Captured at: {note['source_timestamp'] or 'Unknown'}"]
            for citation in note['citations']:
                timing = format_timestamp(citation['start_ms'])
                if citation['end_ms'] is not None:
                    timing += ' - ' + format_timestamp(citation['end_ms'])
                lines.extend(['', '## Video citation', citation['title'], f"Time: {timing}", f"Source: {citation['url']}",
                              f"Moment link: {timed_link(citation['url'], citation['start_ms'])}", citation['comment']])
            for attachment in note['attachments']:
                source = self.within_workspace(Path('attachments') / attachment['stored_name'])
                copied = assets / attachment['stored_name']
                if not copied.exists():
                    shutil.copy2(source, copied)
                lines.extend(['', f"![Captured evidence](assets/{attachment['stored_name']})"])
                if attachment['ocr_state'] == 'succeeded':
                    text = attachment['corrected_text'] if attachment['corrected_text'] is not None else attachment['raw_text']
                    lines.extend(['', '### Extracted text', text])
            for name, text in [('note.md', '\n'.join(lines)), ('note.json', json.dumps(note, ensure_ascii=False, indent=2))]:
                temporary = folder / (name + '.tmp')
                temporary.write_text(text, encoding='utf-8')
                temporary.replace(folder / name)
            with self.connection() as db:
                db.execute('INSERT INTO workspace_files VALUES (?,?) ON CONFLICT(note_id) DO UPDATE SET relative_folder=excluded.relative_folder', (note_id, relative.as_posix()))
