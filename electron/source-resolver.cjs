// Modified / added lines: 1-140 (Robust URL extractor, Link vs Image vs Text classification, metadata derivation)
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

// Helper to sanitize and normalize URLs
function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'about:blank') return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?$/i.test(trimmed)) {
    return 'https://' + trimmed.replace(/^www\./i, 'www.');
  }
  return null;
}

// Detect whether the captured text or metadata is a URL
function detectUrl(text, metadata) {
  if (metadata && metadata.url) {
    const norm = normalizeUrl(metadata.url);
    if (norm) return norm;
  }

  if (!text || typeof text !== 'string') return null;

  let str = text.replace(/https?\s*[:;.]?\s*\/+\s*/gi, 'https://');
  str = str.replace(/http\s*[:;.]?\s*\/+\s*/gi, 'http://');
  str = str.replace(/([a-zA-Z0-9-]+)\s*\.\s*(com|org|net|edu|gov|io|ai|co|dev|app|me|tv|be|uk|ca|de|in|pk|info|tech|ly|is|to|cc|html?|php)\b/gi, '$1.$2');
  str = str.replace(/^[CcoO0QqGg🔒🛡️🔍\s:|]+\s*(https?|www|[a-zA-Z0-9-]+\.[a-zA-Z]{2,})/i, '$1');

  // 1. Search for explicit http/https URL
  const httpMatch = str.match(/https?:\/\/[^\s"'<>]+/i);
  if (httpMatch) {
    const raw = httpMatch[0].replace(/[.,;:!?)\]>]+$/, '');
    const norm = normalizeUrl(raw);
    if (norm) return norm;
  }

  // 2. Search for www. pattern
  const wwwMatch = str.match(/\bwww\.[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s"'<>]*)?/i);
  if (wwwMatch) {
    const raw = wwwMatch[0].replace(/[.,;:!?)\]>]+$/, '');
    const norm = normalizeUrl('https://' + raw);
    if (norm) return norm;
  }

  // 3. Search for known domain patterns (youtube.com, youtu.be, github.com, etc.)
  const domainMatch = str.match(/\b([a-zA-Z0-9-]+\.(?:com|org|net|edu|gov|io|ai|co|dev|app|me|tv|be|uk|ca|de|in|pk|info|tech|ly|is|to|cc)(?:\/[^\s"'<>]*)?)/i);
  if (domainMatch) {
    const raw = domainMatch[1].replace(/[.,;:!?)\]>]+$/, '');
    const norm = normalizeUrl('https://' + raw);
    if (norm) return norm;
  }

  // 4. Localhost or IP
  const ipMatch = str.match(/\b(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/[^\s"'<>]*)?/i);
  if (ipMatch) {
    return 'http://' + ipMatch[0].replace(/[.,;:!?)\]>]+$/, '');
  }

  return null;
}

// Extract clean title, topic, course from window title and extracted text
function extractTopicAndTitle(metadata, text) {
  const rawTitle = (metadata.window_title || metadata.source_app || '').trim();
  let cleanTitle = rawTitle;

  const suffixes = [
    /\s*-\s*Google Chrome$/i,
    /\s*-\s*Microsoft\s*Edge$/i,
    /\s*-\s*Mozilla Firefox$/i,
    /\s*-\s*Brave$/i,
    /\s*-\s*Opera$/i,
    /\s*-\s*Vivaldi$/i,
    /\s*-\s*YouTube$/i,
    /\s*-\s*VLC media player$/i,
    /\s*-\s*Adobe Acrobat(?: Reader)?(?: DC)?$/i,
    /\s*-\s*Word$/i,
    /\s*-\s*PowerPoint$/i,
    /\s*-\s*Excel$/i,
    /\s*-\s*Visual Studio Code$/i,
    /\s*-\s*Notepad$/i,
  ];
  for (const suffix of suffixes) {
    cleanTitle = cleanTitle.replace(suffix, '').trim();
  }

  let topic = '';
  let course = '';

  const isGeneric = /^(notepad|google chrome|microsoft edge|edge|chrome|firefox|brave|vlc|screen capture|untitled)$/i.test(cleanTitle);

  const parts = cleanTitle.split(/\s*[-|–—:]\s*/).filter(p => p.trim().length > 0);
  if (parts.length >= 3) {
    course = parts[0].trim();
    topic = parts[1].trim();
    cleanTitle = parts.slice(1).join(' - ');
  } else if (parts.length === 2) {
    course = parts[0].trim();
    topic = parts[1].trim();
  } else if (parts.length === 1 && parts[0].length > 0 && !isGeneric) {
    topic = parts[0].trim();
  }

  if ((!topic || isGeneric) && text) {
    const firstLine = text.trim().split(/[\r\n]+/)[0]?.trim();
    if (firstLine && firstLine.length > 2 && firstLine.length < 80) {
      topic = firstLine;
      if (!cleanTitle || isGeneric) {
        cleanTitle = firstLine;
      }
    }
  }

  return {
    title: cleanTitle || metadata.source_app || 'Captured link',
    topic: topic || 'General',
    course: course || '',
  };
}

// Automatically detect whether the content is a link, image, or extracted text
function detectContentType({ metadata, text }) {
  const detectedUrl = detectUrl(text, metadata);
  if (detectedUrl) {
    return { contentType: 'link', action: 'link', url: detectedUrl };
  }

  const textLen = (text || '').trim().length;
  if (textLen >= 15) {
    return { contentType: 'text', action: 'text', url: null };
  }

  return { contentType: 'image', action: 'image', url: null };
}

// Source Resolver: queries UI Automation via screen-context.ps1 with timeout safety
async function resolveSourceContext(point, scriptPath, timeoutMs = 3500) {
  try {
    const result = await run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      '-PointX', String(point.x), '-PointY', String(point.y)
    ], {
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 64 * 1024
    });
    const parsed = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
    parsed.url = normalizeUrl(parsed.url);
    return parsed;
  } catch {
    return {
      source_app: '',
      target_name: '',
      window_title: '',
      process_name: '',
      control_type: '',
      url: null,
      time: '',
      bounds: null
    };
  }
}

module.exports = {
  normalizeUrl,
  detectUrl,
  extractTopicAndTitle,
  detectContentType,
  resolveSourceContext,
};
