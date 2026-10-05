import hashlib
import io
import json
import os
import secrets
import shutil
import subprocess
import threading
import zipfile
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field, field_validator, model_validator

from .citations import format_timestamp, parse_timestamp, timed_link
from .store import Store
from .ocr import recognize

class Citation(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    url: str = Field(max_length=2000)
    start_ms: int = Field(ge=0, le=360_000_000)
    end_ms: int | None = Field(default=None, ge=0, le=360_000_000)
    comment: str = Field(default='', max_length=10000)
    transcript_excerpt: str = Field(default='', max_length=20000)

    @field_validator('url')
    @classmethod
    def safe_url(cls, value):
        parts = urlsplit(value)
        if parts.scheme not in {'http', 'https'} or not parts.hostname or parts.username or parts.password:
            raise ValueError('Use an HTTP or HTTPS video URL without credentials.')
        return value

    @model_validator(mode='after')
    def valid_range(self):
        if self.end_ms is not None and self.end_ms < self.start_ms:
            raise ValueError('End time must be at or after the start time.')
        return self

class Note(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    body: str = Field(default='', max_length=200000)
    course: str = Field(default='', max_length=200)
    topic: str = Field(default='', max_length=200)
    tags: list[str] = Field(default_factory=list, max_length=30)
    comment: str = Field(default='', max_length=10000)
    source_app: str = Field(default='', max_length=200)
    source_reference: str = Field(default='', max_length=2000)
    source_timestamp: datetime | None = None
    citations: list[Citation] = Field(default_factory=list, max_length=100)

    @field_validator('title')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError('Title cannot be blank.')
        return value.strip()

    @field_validator('tags')
    @classmethod
    def valid_tags(cls, values):
        if any(len(tag) > 100 for tag in values):
            raise ValueError('Tags must be at most 100 characters.')
        return list(dict.fromkeys(t.strip() for t in values if t.strip()))

class TimestampInput(BaseModel):
    value: str = Field(max_length=30)

class Correction(BaseModel):
    text: str = Field(max_length=200000)

def create_app(data_directory=None, token=None):
    token = token or os.environ.get('SCHOLO_SESSION_TOKEN')
    if not token or len(token) < 32:
        raise RuntimeError('A random session token of at least 32 characters is required.')
    directory = Path(data_directory or os.environ.get('SCHOLO_DATA_DIR') or
                     Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'Scholo')
    store = Store(directory)
    pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='ocr')
    outstanding = threading.BoundedSemaphore(8)

    @asynccontextmanager
    async def lifespan(app):
        yield
        pool.shutdown(wait=True, cancel_futures=True)

    app = FastAPI(title='Scholo local API', docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.store = store
    app.add_middleware(CORSMiddleware, allow_origins=['http://127.0.0.1:5173'],
                       allow_methods=['GET', 'POST', 'PUT'], allow_headers=['Content-Type', 'Authorization'])

    @app.middleware('http')
    async def authenticate(request: Request, call_next):
        if request.method == 'OPTIONS':
            return await call_next(request)
        supplied = request.headers.get('authorization', '')
        if not secrets.compare_digest(supplied, f'Bearer {token}'):
            return Response('Unauthorized', status_code=401)
        # Browser cross-origin requests are restricted in addition to token checks.
        origin = request.headers.get('origin')
        if origin and origin != 'http://127.0.0.1:5173':
            return Response('Origin rejected', status_code=403)
        return await call_next(request)

    def require_note(note_id):
        note = store.get(note_id)
        if note is None:
            raise HTTPException(404, 'Note not found')
        for citation in note['citations']:
            citation['timestamp'] = format_timestamp(citation['start_ms'])
            citation['end_timestamp'] = format_timestamp(citation['end_ms']) if citation['end_ms'] is not None else None
            citation['link'] = timed_link(citation['url'], citation['start_ms'])
        return note

    @app.get('/health')
    def health():
        return {'status': 'ok', 'ocr_available': bool(shutil.which('tesseract')) or os.name == 'nt',
                'workspace': str(store.directory),
                'implemented': ['notes', 'image-import', 'video-citations', 'ocr-adapter', 'note-export']}

    @app.post('/timestamps')
    def timestamp(data: TimestampInput):
        try:
            ms = parse_timestamp(data.value)
            if ms > 360_000_000:
                raise ValueError('Timestamp must be at most 100 hours.')
            return {'milliseconds': ms, 'formatted': format_timestamp(ms)}
        except ValueError as error:
            raise HTTPException(422, str(error)) from error

    @app.get('/notes')
    def list_notes(q: str = '', course: str = ''):
        with store.connection() as db:
            # LIKE wildcards supplied by the user are treated literally.
            literal = q.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
            rows = db.execute("SELECT id FROM notes WHERE (?='' OR course=?) AND (title||' '||body||' '||topic||' '||tags LIKE ? ESCAPE '\\') ORDER BY updated_at DESC LIMIT 500", (course, course, f'%{literal}%'))
            ids = [row['id'] for row in rows]
        return [require_note(note_id) for note_id in ids]

    @app.get('/notes/{note_id}')
    def get_note(note_id: str):
        return require_note(note_id)

    @app.post('/notes', status_code=201)
    def create_note(data: Note):
        return require_note(store.save(data)['id'])

    @app.put('/notes/{note_id}')
    def update_note(note_id: str, data: Note):
        require_note(note_id)
        return require_note(store.save(data, note_id)['id'])

    @app.post('/notes/{note_id}/attachments', status_code=201)
    async def upload_image(note_id: str, file: UploadFile):
        require_note(note_id)
        content = await file.read(10 * 1024 * 1024 + 1)
        await file.close()
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(413, 'Image must be at most 10 MB.')
        try:
            with Image.open(io.BytesIO(content)) as image:
                if image.width * image.height > 20_000_000 or image.format not in {'PNG', 'JPEG', 'WEBP'}:
                    raise HTTPException(422, 'Use PNG, JPEG, or WebP images up to 20 megapixels.')
                media = Image.MIME[image.format]
                suffix = {'PNG': '.png', 'JPEG': '.jpg', 'WEBP': '.webp'}[image.format]
                image.verify()
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
            raise HTTPException(422, 'File is not a valid supported image.') from error
        attachment_id = str(uuid4())
        name = attachment_id + suffix
        dest = store.attachments / name
        staging = dest.with_suffix('.tmp')
        try:
            staging.write_bytes(content)
            staging.replace(dest)
            with store.connection() as db:
                db.execute('INSERT INTO attachments VALUES (?,?,?,?,?,?,?,?)',
                           (attachment_id, note_id, Path(file.filename or 'image').name, name,
                            hashlib.sha256(content).hexdigest(), len(content), media, datetime.now(timezone.utc).isoformat()))
        except Exception:
            staging.unlink(missing_ok=True)
            dest.unlink(missing_ok=True)
            raise
        store.sync_note(note_id)
        return require_note(note_id)

    def run_ocr(job_id, path):
        try:
            with store.connection() as db:
                db.execute("UPDATE ocr_jobs SET state='processing' WHERE id=?", (job_id,))
            text, provider = recognize(path)
            with store.connection() as db:
                db.execute("UPDATE ocr_jobs SET state='succeeded', raw_text=?, provider=?, error=NULL WHERE id=?", (text, provider, job_id))
                note_id = db.execute('SELECT note_id FROM attachments WHERE id=(SELECT attachment_id FROM ocr_jobs WHERE id=?)', (job_id,)).fetchone()['note_id']
            store.sync_note(note_id)
        except Exception as error:
            with store.connection() as db:
                db.execute("UPDATE ocr_jobs SET state='failed', error=? WHERE id=?", (str(error), job_id))
        finally:
            outstanding.release()

    @app.post('/attachments/{attachment_id}/ocr', status_code=202)
    def start_ocr(attachment_id: str):
        with store.connection() as db:
            attachment = db.execute('SELECT * FROM attachments WHERE id=?', (attachment_id,)).fetchone()
            if not attachment:
                raise HTTPException(404, 'Attachment not found')
            job = db.execute('SELECT * FROM ocr_jobs WHERE attachment_id=?', (attachment_id,)).fetchone()
            if job and job['state'] in {'queued', 'processing'}:
                return dict(job)
            if not outstanding.acquire(blocking=False):
                raise HTTPException(429, 'OCR queue is full. Try again shortly.')
            job_id = job['id'] if job else str(uuid4())
            db.execute("INSERT INTO ocr_jobs (id,attachment_id,state) VALUES (?,?,'queued') ON CONFLICT(attachment_id) DO UPDATE SET state='queued', error=NULL", (job_id, attachment_id))
        pool.submit(run_ocr, job_id, store.attachments / attachment['stored_name'])
        return {'id': job_id, 'state': 'queued'}

    @app.get('/ocr/{job_id}')
    def get_ocr(job_id: str):
        with store.connection() as db:
            job = db.execute('SELECT * FROM ocr_jobs WHERE id=?', (job_id,)).fetchone()
            if not job:
                raise HTTPException(404, 'OCR job not found')
            return dict(job)

    @app.put('/ocr/{job_id}/correction')
    def correct_ocr(job_id: str, data: Correction):
        job = get_ocr(job_id)
        if job['state'] != 'succeeded':
            raise HTTPException(409, 'Complete OCR before saving corrected text.')
        with store.connection() as db:
            db.execute('UPDATE ocr_jobs SET corrected_text=? WHERE id=?', (data.text, job_id))
            note_id = db.execute('SELECT note_id FROM attachments WHERE id=?', (job['attachment_id'],)).fetchone()['note_id']
        store.sync_note(note_id)
        return get_ocr(job_id)

    @app.get('/notes/{note_id}/export')
    def export_note(note_id: str):
        note = require_note(note_id)
        lines = [f"# {note['title']}", '', f"Course: {note['course'] or 'Unknown'}", f"Topic: {note['topic'] or 'Unknown'}",
                 f"Tags: {', '.join(note['tags'])}", '', note['body'], '', '## Source',
                 f"Application: {note['source_app'] or 'Unknown'}", f"Reference: {note['source_reference'] or 'Unknown'}",
                 f"Timestamp: {note['source_timestamp'] or 'Unknown'}", '', '## Comment', note['comment'], '', '## Video citations']
        for c in note['citations']:
            timing = c['timestamp'] + (f" - {c['end_timestamp']}" if c['end_timestamp'] else '')
            lines.extend([f"- {c['title']} | {timing}", f"  Source: {c['url']}", f"  Moment: {c['link']}", f"  Comment: {c['comment']}"])
            if c['transcript_excerpt']:
                lines.append(f"  Transcript excerpt (user supplied): {c['transcript_excerpt']}")
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('note.md', '\n'.join(lines))
            archive.writestr('note.json', json.dumps(note, ensure_ascii=False, indent=2))
            for a in note['attachments']:
                archive.write(store.attachments / a['stored_name'], 'attachments/' + a['stored_name'])
        return Response(buffer.getvalue(), media_type='application/zip', headers={'Content-Disposition': 'attachment; filename="scholo-note.zip"'})

    return app
