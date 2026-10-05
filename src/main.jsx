import React, { useEffect, useId, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { configureToken, request, importImage, exportNote } from './api';
import './styles.css';

const blankNote = () => ({ title: '', body: '', course: '', topic: '', tags: [], comment: '', source_app: '', source_reference: '', source_timestamp: null, citations: [], attachments: [] });
const modules = ['Notes', 'Learning records', 'Style profiles'];
function Field({ label, children, ...props }) {
  const id = useId();
  const control = children ? React.cloneElement(children, { id, 'aria-labelledby': `${id}-label` }) : <input {...props} id={id} aria-labelledby={`${id}-label`}/>;
  return <label className="field" htmlFor={id}><span id={`${id}-label`}>{label}</span>{control}</label>;
}
function OCRResult({ attachment, onChange, onError }) {
  const [corrected, setCorrected] = useState(attachment.corrected_text ?? attachment.raw_text ?? '');
  return <div className="attachment">
    <div className="row"><strong>{attachment.filename}</strong><span className="badge">{attachment.ocr_state || 'Imported'}</span></div>
    <p className="muted">{Math.ceil(attachment.size / 1024)} KB · Original image kept with this note</p>
    {attachment.ocr_error && <p className="error">{attachment.ocr_error}</p>}
    <button type="button" className="secondary" disabled={['queued', 'processing'].includes(attachment.ocr_state)} onClick={async () => {
      try { await request('POST', `/attachments/${attachment.id}/ocr`); await onChange(); } catch (error) { onError(error.message); }
    }}>{attachment.ocr_state === 'failed' ? 'Retry OCR' : 'Extract text'}</button>
    {attachment.ocr_state === 'succeeded' && <>
      <details><summary>Original OCR output</summary><pre>{attachment.raw_text || '(No text detected)'}</pre></details>
      <Field label="Reviewed OCR text"><textarea rows="5" value={corrected} onChange={e => setCorrected(e.target.value)}/></Field>
      <button type="button" className="secondary" onClick={async () => {
        try { await request('PUT', `/ocr/${attachment.ocr_id}/correction`, { text: corrected }); await onChange(); } catch (error) { onError(error.message); }
      }}>Save reviewed text</button>
    </>}
  </div>;
}

function App() {
  const [connected, setConnected] = useState(false);
  const [health, setHealth] = useState(null);
  const [desktop, setDesktop] = useState(null);
  const [developmentToken, setDevelopmentToken] = useState('');
  const [notes, setNotes] = useState([]);
  const [note, setNote] = useState(blankNote);
  const [module, setModule] = useState('Notes');
  const [query, setQuery] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [citation, setCitation] = useState({ title: '', url: '', start: '', end: '', comment: '' });
  const fileRef = useRef();

  async function connect() {
    try { configureToken(developmentToken); setHealth(await request('GET', '/health')); if (window.scholo) setDesktop(await window.scholo.desktopInfo()); setConnected(true); setError(''); }
    catch (error) { setError(error.message); }
  }
  useEffect(() => { if (window.scholo) connect(); }, []);
  useEffect(() => {
    if (!window.scholo) return;
    const stopCapture = window.scholo.onCaptureSaved(async () => {
      try { setNotes(await request('GET', '/notes')); setMessage('Capture saved in your workspace.'); } catch (e) { setError(e.message); }
    });
    const stopWorkspace = window.scholo.onWorkspaceChanged(async () => {
      try { setNote(blankNote()); setDirty(false); setQuery(''); setCourseFilter(''); setNotes(await request('GET', '/notes')); await connect(); } catch (e) { setError(e.message); }
    });
    return () => { stopCapture(); stopWorkspace(); };
  }, []);
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    const timer = setTimeout(() => request('GET', `/notes?q=${encodeURIComponent(query)}&course=${encodeURIComponent(courseFilter)}`)
      .then(data => { if (!cancelled) setNotes(data); }).catch(e => { if (!cancelled) setError(e.message); }), 180);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, courseFilter, connected]);
  useEffect(() => {
    const warn = event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const workingOCR = note.attachments.some(a => ['queued', 'processing'].includes(a.ocr_state));
  useEffect(() => {
    if (!workingOCR || !note.id) return;
    let cancelled = false;
    const id = note.id;
    const interval = setInterval(() => request('GET', `/notes/${id}`).then(data => {
      if (!cancelled) setNote(current => current.id === id ? { ...current, attachments: data.attachments } : current);
    }).catch(e => { if (!cancelled) setError(e.message); }), 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [workingOCR, note.id]);

  function change(key, value) { setNote(current => ({ ...current, [key]: value })); setDirty(true); setMessage(''); }
  function select(next) {
    if (dirty && !window.confirm('Discard the unsaved changes to this note?')) return;
    setNote(next); setDirty(false); setMessage(''); setError('');
    setCitation({ title: '', url: '', start: '', end: '', comment: '' });
  }
  async function refreshAttachments() {
    const data = await request('GET', `/notes/${note.id}`);
    setNote(current => current.id === data.id ? { ...current, attachments: data.attachments } : current);
  }
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const data = await request(note.id ? 'PUT' : 'POST', note.id ? `/notes/${note.id}` : '/notes', note);
      setNote(data); setDirty(false); setMessage('Saved on this device.');
      setNotes(await request('GET', `/notes?q=${encodeURIComponent(query)}&course=${encodeURIComponent(courseFilter)}`));
    } catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  async function addCitation() {
    setError('');
    try {
      if (!citation.title.trim() || !citation.url.trim()) throw new Error('Add the video title and URL.');
      const parsedURL = new URL(citation.url);
      if (!['http:', 'https:'].includes(parsedURL.protocol) || parsedURL.username || parsedURL.password) throw new Error('Use an HTTP or HTTPS video URL without credentials.');
      const start = await request('POST', '/timestamps', { value: citation.start });
      const end = citation.end ? await request('POST', '/timestamps', { value: citation.end }) : null;
      if (end && end.milliseconds < start.milliseconds) throw new Error('End time must be at or after the start time.');
      change('citations', [...note.citations, { title: citation.title, url: citation.url, start_ms: start.milliseconds,
        end_ms: end?.milliseconds ?? null, timestamp: start.formatted, end_timestamp: end?.formatted ?? null, comment: citation.comment, transcript_excerpt: '' }]);
      setCitation({ title: '', url: '', start: '', end: '', comment: '' });
    } catch (error) { setError(error.message); }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-icon">s.</span><div>scholo<span>Your study workspace</span></div></div>
      <div className="nav-label">WORKSPACE</div>
      <nav aria-label="Workspace">{modules.map((name, index) => <button key={name} className={module === name ? 'nav-item active' : 'nav-item'} onClick={() => setModule(name)}><span>{['▤', '◷', 'Aa'][index]}</span>{name}{index > 0 && <small>Next</small>}</button>)}</nav>
      <div className="scope-note"><strong>Built around your work.</strong><p>Keep your notes, sources, and learning evidence together.</p></div>
      <div className="local-state"><i className={connected ? 'online' : ''}/>{connected ? 'Local workspace connected' : 'Waiting for local backend'}<small>Phase 1 · Development build</small></div>
    </aside>
    <main>
      <header><div><div className="eyebrow">YOUR KNOWLEDGE, KEPT CLOSE</div><h1>{module}</h1><p>{module === 'Notes' ? 'Capture the idea. Keep the source. Make it yours.' : 'Part of your Phase 1 build.'}</p></div>{window.scholo ? <button onClick={async () => { try { await window.scholo.startCapture(); } catch (e) { setError(e.message); } }}>Capture · Ctrl+Shift+Space</button> : <span className="local-pill">◉ Stored on this device</span>}</header>
      {desktop && <div className="workspace-bar"><div><strong>{desktop.workspace ? 'Workspace folder' : 'Choose where your study files live'}</strong><span>{desktop.workspace || 'Notes, images, and citations will be organized inside this folder.'}</span>{desktop.workspace && !desktop.shortcutRegistered && <small>The shortcut is occupied by another app. Use the Capture button or tray.</small>}</div><button className="secondary" onClick={async () => { if (dirty && !window.confirm('Discard unsaved edits before changing workspace folders?')) return; try { await window.scholo.chooseWorkspace(); } catch (e) { setError(e.message); } }}>{desktop.workspace ? 'Change folder' : 'Choose folder'}</button></div>}
      {error && <div className="banner error" role="alert">{error}</div>}
      {!connected && <section className="connect-panel"><h2>Connect to your local workspace</h2><p>The Electron app connects automatically. For browser development, start the Python backend and enter its session token.</p>{!window.scholo && <><Field label="Development session token" type="password" value={developmentToken} onChange={e => setDevelopmentToken(e.target.value)}/><button onClick={connect}>Connect</button></>}</section>}
      {connected && module !== 'Notes' && <section className="connect-panel"><div className="eyebrow">UP NEXT</div><h2>{module === 'Learning records' ? 'Turn finished work into lasting knowledge.' : 'Keep your work consistently yours.'}</h2><p>{module === 'Learning records' ? 'The next slice adds assignment briefs, explained steps, code, commands, and durable evidence.' : 'The next slice adds a style questionnaire, versioned profiles, explicit approval, and profile locking.'}</p><p className="muted">This module is planned and has not been implemented yet.</p><button className="secondary" onClick={() => setModule('Notes')}>Back to Notes</button></section>}
      {connected && module === 'Notes' && <div className="notes-workspace">
        <section className="note-library" aria-label="Saved notes">
          <div className="row"><h2>Your notes <span className="count">{notes.length}</span></h2><button className="icon-button" aria-label="Create new note" onClick={() => select(blankNote())}>+</button></div>
          <input aria-label="Search notes" className="search" placeholder="Search notes, topics, tags…" value={query} onChange={e => setQuery(e.target.value)}/>
          <Field label="Filter by course" value={courseFilter} onChange={e => setCourseFilter(e.target.value)} placeholder="All courses"/>
          <div className="note-list">{notes.length === 0 ? <div className="empty"><span>▤</span><h3>{query || courseFilter ? 'No matching notes' : 'A fresh page awaits'}</h3><p>{query || courseFilter ? 'Try another search or course.' : 'Create your first note and give it a source worth returning to.'}</p></div> : notes.map(item => <button key={item.id} className={`note-card ${note.id === item.id ? 'selected' : ''}`} onClick={() => select(item)}><span className="note-course">{item.course || 'Unfiled'}</span><strong>{item.title}</strong><p>{item.body.slice(0, 90) || item.comment || 'No text yet'}</p><small>{item.citations.length > 0 ? `${item.citations.length} video reference${item.citations.length === 1 ? '' : 's'} · ` : ''}{new Date(item.updated_at).toLocaleDateString()}</small></button>)}</div>
        </section>
        <section className="editor">
          <form onSubmit={save}>
            <div className="row editor-top"><span className="eyebrow">{note.id ? 'EDIT NOTE' : 'NEW NOTE'} {dirty && '· UNSAVED'}</span><div className="actions"><button type="button" className="secondary" disabled={!note.id || dirty || busy} onClick={async () => { try { if (await exportNote(note.id)) setMessage('Note exported with its sources and images.'); } catch (e) { setError(e.message); } }}>Export</button><button disabled={busy}>{busy ? 'Saving…' : 'Save note'}</button></div></div>
            {message && <p className="success" role="status">{message}</p>}
            <input className="title-input" aria-label="Note title" required maxLength="300" placeholder="Give this idea a title" value={note.title} onChange={e => change('title', e.target.value)}/>
            <div className="grid two"><Field label="Course" placeholder="e.g. Data Structures" value={note.course} onChange={e => change('course', e.target.value)}/><Field label="Topic" placeholder="e.g. Binary search trees" value={note.topic} onChange={e => change('topic', e.target.value)}/></div>
            <Field label="Your notes"><textarea className="body-input" rows="8" placeholder="What did you learn? Write it in your own words…" value={note.body} onChange={e => change('body', e.target.value)}/></Field>
            <Field label="Tags · separate with commas" value={note.tags.join(', ')} onChange={e => change('tags', e.target.value.split(','))} placeholder="revision, lecture, important"/>
            <details className="section-details"><summary>Source & context <span>Keep the origin with the idea</span></summary><div className="grid two"><Field label="Source application" value={note.source_app} onChange={e => change('source_app', e.target.value)} placeholder="Unknown"/><Field label="File / page / URL reference" value={note.source_reference} onChange={e => change('source_reference', e.target.value)} placeholder="Unknown"/></div><Field label="Comment"><textarea rows="2" value={note.comment} onChange={e => change('comment', e.target.value)}/></Field></details>
            <section className="citations-section"><div className="row"><h2>Video references</h2><span className="badge">Exact moments</span></div><p className="muted">Save the moment that made it click. Use MM:SS or HH:MM:SS, with optional milliseconds.</p>
              {note.citations.map((c, index) => <div className="citation" key={c.id || `${c.url}-${index}`}><div className="row"><strong>{c.title}</strong><button type="button" className="text-button" onClick={() => change('citations', note.citations.filter((_, i) => i !== index))}>Remove</button></div><span className="time-chip">▶ {c.timestamp}{c.end_timestamp ? ` – ${c.end_timestamp}` : ''}</span><p className="citation-url">{c.link || c.url}</p>{c.comment && <p>{c.comment}</p>}</div>)}
              <div className="grid two"><Field label="Video title" value={citation.title} onChange={e => setCitation({ ...citation, title: e.target.value })} placeholder="Lecture or tutorial title"/><Field label="Video URL" value={citation.url} onChange={e => setCitation({ ...citation, url: e.target.value })} placeholder="https://…"/><Field label="Start time" value={citation.start} onChange={e => setCitation({ ...citation, start: e.target.value })} placeholder="01:23.250"/><Field label="End time · optional" value={citation.end} onChange={e => setCitation({ ...citation, end: e.target.value })} placeholder="02:10"/></div><Field label="Why this moment matters" value={citation.comment} onChange={e => setCitation({ ...citation, comment: e.target.value })} placeholder="Add a little context"/><button type="button" className="secondary" onClick={addCitation}>+ Add video reference</button>
            </section>
          </form>
          <section className="images-section"><div className="row"><h2>Images & OCR</h2><button className="secondary" disabled={!note.id || busy} onClick={() => fileRef.current.click()}>+ Import image</button></div><p className="muted">{!note.id ? 'Save your note first to attach an image.' : health.ocr_available ? 'Import a screenshot and extract its text locally.' : 'Image imports are ready. OCR needs a local Tesseract installation.'}</p><input hidden ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={async event => { const file = event.target.files[0]; if (!file) return; setBusy(true); try { const data = await importImage(note.id, file); setNote(current => ({ ...current, attachments: data.attachments })); setMessage('Image stored with this note.'); } catch (e) { setError(e.message); } finally { setBusy(false); event.target.value = ''; } }}/>{note.attachments.map(a => <OCRResult key={`${a.id}-${a.ocr_state}`} attachment={a} onChange={refreshAttachments} onError={setError}/>)}</section>
        </section>
      </div>}
    </main>
  </div>;
}
createRoot(document.getElementById('root')).render(<App/>);
