import hashlib
import io
import json
import time
import zipfile
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from backend.app import create_app
from backend.citations import parse_timestamp, format_timestamp, timed_link

TOKEN = 'test-token-' + 'a' * 48
HEADERS = {'Authorization': f'Bearer {TOKEN}'}

@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path, TOKEN)) as client:
        client.headers.update(HEADERS)
        yield client

def payload():
    return {'title': 'Binary search', 'body': 'Halve the search space.', 'course': 'Algorithms',
            'topic': 'Search', 'tags': ['revision'], 'source_app': 'Lecture player',
            'source_timestamp': '2026-10-05T08:00:00Z',
            'citations': [{'title': 'Lecture 3', 'url': 'https://www.youtube.com/watch?v=example',
                           'start_ms': 83250, 'end_ms': 130000, 'comment': 'Invariant explanation'}]}

def image_bytes():
    stream = io.BytesIO()
    Image.new('RGB', (30, 30), 'white').save(stream, format='PNG')
    return stream.getvalue()

def test_auth_and_origins(client):
    assert client.get('/notes', headers={'Authorization': ''}).status_code == 401
    assert client.post('/notes', json={'title': 'Injected'}, headers={'Origin': 'https://untrusted.example'}).status_code == 403
    assert client.get('/notes', headers={'Origin': 'http://127.0.0.1:5173'}).status_code == 200
    assert client.get('/docs').status_code == 404

def test_restart_preserves_note_and_exact_citations(tmp_path):
    with TestClient(create_app(tmp_path, TOKEN), headers=HEADERS) as first:
        response = first.post('/notes', json=payload())
        assert response.status_code == 201, response.text
        note_id = response.json()['id']
    with TestClient(create_app(tmp_path, TOKEN), headers=HEADERS) as second:
        note = second.get(f'/notes/{note_id}').json()
        assert note['body'] == 'Halve the search space.'
        assert note['citations'][0]['start_ms'] == 83250
        assert note['citations'][0]['timestamp'] == '01:23.250'
        assert note['citations'][0]['link'].endswith('t=83')
        assert note['source_timestamp'].startswith('2026-10-05')

def test_update_search_and_validation(client):
    note = client.post('/notes', json=payload()).json()
    updated = payload() | {'title': 'Search invariant', 'citations': []}
    assert client.put(f"/notes/{note['id']}", json=updated).status_code == 200
    assert len(client.get('/notes?q=invariant&course=Algorithms').json()) == 1
    assert client.get('/notes?q=%25').json() == []
    assert client.post('/notes', json={'title': '  '}).status_code == 422
    invalid = payload()
    invalid['citations'][0]['end_ms'] = 2
    assert client.post('/notes', json=invalid).status_code == 422
    invalid['citations'][0]['url'] = 'javascript:alert(1)'
    assert client.post('/notes', json=invalid).status_code == 422

def test_import_and_portable_export(client):
    note = client.post('/notes', json=payload()).json()
    content = image_bytes()
    response = client.post(f"/notes/{note['id']}/attachments", files={'file': ('../../evidence.png', content, 'image/png')})
    assert response.status_code == 201
    attachment = response.json()['attachments'][0]
    assert '/' not in attachment['stored_name'] and '\\' not in attachment['stored_name']
    assert attachment['sha256'] == hashlib.sha256(content).hexdigest()
    bundle = client.get(f"/notes/{note['id']}/export")
    with zipfile.ZipFile(io.BytesIO(bundle.content)) as archive:
        assert archive.read('attachments/' + attachment['stored_name']) == content
        text = archive.read('note.md').decode()
        assert '01:23.250 - 02:10' in text and 'Lecture player' in text
        assert json.loads(archive.read('note.json'))['citations'][0]['start_ms'] == 83250
    assert client.post(f"/notes/{note['id']}/attachments", files={'file': ('bad.png', b'not an image', 'image/png')}).status_code == 422

def test_missing_ocr_engine_preserves_evidence(client):
    note = client.post('/notes', json={'title': 'Screenshot'}).json()
    attachment = client.post(f"/notes/{note['id']}/attachments", files={'file': ('capture.png', image_bytes(), 'image/png')}).json()['attachments'][0]
    with patch('backend.app.recognize', side_effect=RuntimeError('No OCR engine available. Configure Tesseract, then retry.')):
        job = client.post(f"/attachments/{attachment['id']}/ocr").json()
        for _ in range(100):
            result = client.get(f"/ocr/{job['id']}").json()
            if result['state'] == 'failed':
                break
            time.sleep(.01)
        assert result['state'] == 'failed'
        assert 'Tesseract' in result['error']
    assert client.get(f"/notes/{note['id']}").json()['attachments'][0]['sha256'] == attachment['sha256']
    assert client.put(f"/ocr/{job['id']}/correction", json={'text': 'review'}).status_code == 409

def test_workspace_files_are_readable_and_constrained(client):
    note = client.post('/notes', json=payload()).json()
    workspace = client.app.state.store.directory
    folder = workspace / 'notes' / 'Algorithms' / 'Search' / note['id']
    assert '01:23.250 - 02:10' in (folder / 'note.md').read_text(encoding='utf-8')
    assert json.loads((folder / 'note.json').read_text(encoding='utf-8'))['body'] == 'Halve the search space.'
    content = image_bytes()
    attachment = client.post(f"/notes/{note['id']}/attachments", files={'file': ('capture.png', content, 'image/png')}).json()['attachments'][0]
    assert (folder / 'assets' / attachment['stored_name']).read_bytes() == content
    changed = payload() | {'course': '../../CON', 'topic': '../../../escape'}
    assert client.put(f"/notes/{note['id']}", json=changed).status_code == 200
    with client.app.state.store.connection() as db:
        relative = db.execute('SELECT relative_folder FROM workspace_files WHERE note_id=?', (note['id'],)).fetchone()[0]
    assert (workspace / relative).resolve().is_relative_to(workspace)
    assert (workspace / relative / 'assets' / attachment['stored_name']).read_bytes() == content
    assert not folder.exists()

@pytest.mark.parametrize('value,expected', [('00:00', 0), ('01:23.250', 83250), ('01:02:03.001', 3723001), ('90:00', 5400000)])
def test_exact_timestamps(value, expected):
    assert parse_timestamp(value) == expected
    assert parse_timestamp(format_timestamp(expected)) == expected

@pytest.mark.parametrize('value', ['-01:00', '01:60', '01:60:00', '12', '01:02.1234', 'garbage'])
def test_invalid_timestamps(value):
    with pytest.raises(ValueError):
        parse_timestamp(value)

def test_unsupported_provider_keeps_original_url():
    url = 'https://video.example/watch?id=123'
    assert timed_link(url, 1234) == url
    assert timed_link('https://youtube.com.evil.example/watch?v=x', 1234).startswith('https://youtube.com.evil.example/')
