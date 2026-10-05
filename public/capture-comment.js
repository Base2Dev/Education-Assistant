const byId = id => document.getElementById(id);
let data;
function refresh() {
  byId('text-fields').style.display = byId('action').value === 'text' ? 'block' : 'none';
  byId('video-fields').style.display = byId('action').value === 'video' ? 'block' : 'none';
  byId('destination').textContent = `${data?.workspace || ''}/notes/${byId('course').value || 'Unfiled'}/${byId('topic').value || 'General'}/<note>/`;
}
byId('action').addEventListener('change', refresh);
byId('course').addEventListener('input', refresh);
byId('topic').addEventListener('input', refresh);
byId('cancel').addEventListener('click', () => window.capture.cancel());
document.addEventListener('keydown', e => { if (e.key === 'Escape') window.capture.cancel(); });
window.capture.data().then(result => {
  data = result; byId('image').src = result.image;
  byId('title').value = result.source_app || 'Screen capture';
  byId('url').value = result.url || '';
  byId('start').value = result.time || '';
  byId('text').value = result.text || '';
  byId('status').textContent = result.ocr_error || 'Selection read locally. Review before saving.';
  byId('action').value = result.url ? 'video' : result.text?.trim() ? 'text' : 'image';
  refresh();
});
byId('form').addEventListener('submit', async e => {
  e.preventDefault(); byId('save').disabled = true; byId('error').textContent = '';
  try {
    const input = Object.fromEntries(['action', 'title', 'course', 'topic', 'text', 'url', 'start', 'end', 'comment'].map(id => [id, byId(id).value]));
    await window.capture.save(input);
  } catch (error) { byId('error').textContent = error.message; byId('save').disabled = false; }
});
