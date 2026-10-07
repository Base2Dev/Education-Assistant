// Modified / added lines: 1-65 (Client-side URL detector from OCR text, link-fields auto-fill and auto-toggle)
const byId = id => document.getElementById(id);
let data;

function extractUrl(text) {
  if (!text || typeof text !== 'string') return null;
  let str = text.replace(/https?\s*[:;.]?\s*\/+\s*/gi, 'https://');
  str = str.replace(/http\s*[:;.]?\s*\/+\s*/gi, 'http://');
  str = str.replace(/([a-zA-Z0-9-]+)\s*\.\s*(com|org|net|edu|gov|io|ai|co|dev|app|me|tv|be|uk|ca|de|in|pk|info|tech|ly|is|to|cc|html?|php)\b/gi, '$1.$2');
  str = str.replace(/^[CcoO0QqGg🔒🛡️🔍\s:|]+\s*(https?|www|[a-zA-Z0-9-]+\.[a-zA-Z]{2,})/i, '$1');

  const httpMatch = str.match(/https?:\/\/[^\s"'<>]+/i);
  if (httpMatch) return httpMatch[0].replace(/[.,;:!?)\]>]+$/, '');

  const wwwMatch = str.match(/\bwww\.[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s"'<>]*)?/i);
  if (wwwMatch) return 'https://' + wwwMatch[0].replace(/[.,;:!?)\]>]+$/, '');

  const domainMatch = str.match(/\b([a-zA-Z0-9-]+\.(?:com|org|net|edu|gov|io|ai|co|dev|app|me|tv|be|uk|ca|de|in|pk|info|tech|ly|is|to|cc)(?:\/[^\s"'<>]*)?)/i);
  if (domainMatch) return 'https://' + domainMatch[1].replace(/[.,;:!?)\]>]+$/, '');

  const ipMatch = str.match(/\b(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/[^\s"'<>]*)?/i);
  if (ipMatch) return 'http://' + ipMatch[0].replace(/[.,;:!?)\]>]+$/, '');

  return null;
}

function refresh() {
  byId('text-fields').style.display = byId('action').value === 'text' ? 'block' : 'none';
  const isLink = byId('action').value === 'link' || byId('action').value === 'video';
  byId('link-fields').style.display = isLink ? 'block' : 'none';
  byId('destination').textContent = `${data?.workspace || ''}/notes/${byId('course').value || 'Unfiled'}/${byId('topic').value || 'General'}/<note>/`;
}

byId('action').addEventListener('change', refresh);
byId('course').addEventListener('input', refresh);
byId('topic').addEventListener('input', refresh);
byId('cancel').addEventListener('click', () => window.capture.cancel());
document.addEventListener('keydown', e => { if (e.key === 'Escape') window.capture.cancel(); });

window.capture.data().then(result => {
  data = result;
  byId('image').src = result.image;
  byId('title').value = result.title || result.source_app || 'Screen capture';
  byId('course').value = result.course || '';
  byId('topic').value = result.topic || '';
  byId('text').value = result.text || '';

  // Extract link from OCR text or metadata
  const detectedLink = extractUrl(result.text) || extractUrl(result.url) || (result.url && result.url !== 'null' ? result.url : null);

  if (detectedLink) {
    byId('url').value = detectedLink;
    byId('action').value = 'link';
    byId('status').textContent = `Link detected: ${detectedLink}`;
  } else {
    byId('url').value = '';
    byId('action').value = result.action === 'link' ? 'link' : (result.text?.trim() ? 'text' : 'image');
    byId('status').textContent = result.ocr_error || 'Selection read locally. Review before saving.';
  }

  // Display detected content type badge
  const badge = byId('detected-type');
  if (badge) {
    const isLink = Boolean(detectedLink);
    badge.textContent = isLink ? 'Link' : (result.text?.trim() ? 'Text' : 'Image');
    badge.style.display = 'inline-block';
  }

  refresh();
});

byId('form').addEventListener('submit', async e => {
  e.preventDefault(); byId('save').disabled = true; byId('error').textContent = '';
  try {
    const input = Object.fromEntries(['action', 'title', 'course', 'topic', 'text', 'url', 'comment'].map(id => [id, byId(id).value]));
    const isLink = input.action === 'link' || input.action === 'video';
    if (isLink && (!input.url || input.url === 'null' || !input.url.trim())) {
      throw new Error('Please enter or paste the link URL before saving.');
    }
    await window.capture.save(input);
  } catch (error) { byId('error').textContent = error.message; byId('save').disabled = false; }
});
