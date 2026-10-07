// Modified / added lines: 1, 33-38 (Added openLink helper to launch URLs in external browser)
let token = '';
export function configureToken(value) { token = value; }
export async function request(method, path, body) {
  if (window.scholo) return window.scholo.request(method, path, body);
  const response = await fetch(`http://127.0.0.1:8765${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail || `Request failed (${response.status})`));
  }
  return response.json();
}
export async function importImage(noteId, file) {
  if (file.size > 10 * 1024 * 1024) throw new Error('Image must be at most 10 MB.');
  if (window.scholo) return window.scholo.importImage(noteId, file.name, Array.from(new Uint8Array(await file.arrayBuffer())));
  const data = new FormData(); data.append('file', file);
  const response = await fetch(`http://127.0.0.1:8765/notes/${noteId}/attachments`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: data });
  if (!response.ok) throw new Error((await response.json()).detail);
  return response.json();
}
export async function exportNote(noteId) {
  if (window.scholo) return window.scholo.exportNote(noteId);
  const response = await fetch(`http://127.0.0.1:8765/notes/${noteId}/export`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error('Export failed');
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a'); link.href = url; link.download = 'scholo-note.zip'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
export async function openLink(url) {
  if (window.scholo?.openLink) return window.scholo.openLink(url);
  window.open(url, '_blank');
  return true;
}
