# Phase 1: Notes, OCR, learning records, style profiles, and video citations

## Scope decision

Build in Education-Assistant. Casrion (https://github.com/DyneStein/Casrion) is a reference for folder-based notes and background capture. Its README and GPL-3.0 license have been reviewed; no code has been copied from it.

The source requirements are the Scholo Education Assistant Project Requirements Document dated 2 October 2026. The user's narrower scope takes precedence over the document's complete Tier 1 scope. This document is a proposed implementation baseline; it does not claim the features are implemented.

The user also explicitly requested video citations with exact timings. Include this within notes and learning records. The user identifies it as a new feature relative to Casrion; that comparison has not been independently verified.

## Included workflows

### Single activation and folder workspace (user clarification, 5 October 2026)

- The student chooses a workspace folder. Notes, captured assets, OCR results, source references, comments, and later learning records/style profiles live inside that folder. Ordinary Markdown and JSON files remain readable without the app; SQLite is a local search/index aid.
- One global shortcut, Ctrl+Shift+Space, activates a screen overlay. No separate copy-text, screenshot, or quick-note shortcuts are registered. The student points to a target or drags a region, then receives a compact comment/instruction popup.
- Text is extracted locally with review before saving; images are retained as original capture evidence. Videos are stored as source citations with exact start/end times, not downloaded or copied as video content.
- The popup previews the capture, proposed content type, source, filing destination, and comment/instruction. The student can correct each item before saving. Never invent a video URL or timing when screen/accessibility metadata cannot provide it.
- Comments and instructions are retained with the captured data. Only implemented actions are executed; model-dependent explanations or summaries must not be presented as completed without a model.
- Create course/topic subfolders, Markdown notes, JSON metadata, and asset folders inside the selected workspace. All generated paths are constrained to that workspace. Keep runtime settings outside it only to remember the chosen folder.
- The desktop launch shortcut opens the app; closing the main window leaves the single capture shortcut available through the tray. Tray Quit exits the app and releases the shortcut.

### Notes (NOT-1 through NOT-3)

- Create and edit text notes; import an image or screenshot as an attachment.
- Add a title, comment, course, topic, type, and tags. Show the destination before saving and allow corrections.
- Retain the original image, OCR text, source application, source timestamp, and optional file/page or URL reference. Mark unknown source information as unknown rather than inventing it.
- Suggest filing destinations from previous user-confirmed choices, with manual selection always available. Begin with deterministic rules; automatic AI classification is a later enhancement.
- Search and filter notes and export them as Markdown with source references and attached files.

### OCR

- Extract text from imported images using a local OCR provider. Tesseract is the proposed first provider, pending a small accuracy evaluation; keep the provider replaceable.
- Preserve raw OCR output separately from student-corrected text and record provider/language details.
- Show queued, processing, succeeded, and failed states, with retry and understandable errors. OCR failure must not prevent saving the original note.
- Run work outside the interactive request path. Bound image dimensions, upload size, and job concurrency; validate image contents before processing.
- Core acceptance covers English printed text. Handwriting and additional languages require separate measured support.

### Video citations with exact timings

- Attach one or more citations to a note or learning record: video URL or imported local video, title, optional creator, start time, optional end time, and the student's comment.
- Accept readable timestamps such as `01:23` and `01:02:03.250`; store integer milliseconds to preserve precision. Reject malformed or negative times and end times before the start. Validate against duration when known.
- Keep the original URL and exact timing as canonical evidence. Generate a provider-supported link to the cited moment where possible; always display the exact timestamp or range even when the provider rounds playback precision or does not support deep links.
- Export title, source, timing, comment, and link together so a reference still makes sense outside the app. Imported local videos use portable relative references in export bundles and app-owned copies for persistence.
- Support multiple cited moments from the same video. Offline users can read all saved citation metadata and play imported local videos; remote video playback requires connectivity.
- Allow an optional manually supplied transcript excerpt, labelled as user supplied. Do not claim a quote has been verified against a video without evidence.
- The initial workflow uses student-entered timestamps. Automatic current-player timing, transcript fetching, speech transcription, and video understanding are later integrations.

### Learning records (REC-1 through REC-3; REC-4 deferred)

- Create a record containing the assignment brief, answer, course, topic, code, commands, outputs, screenshots, and ordered steps explaining why each step was performed.
- Support drafts and an explicit finish action. Require a title, course, brief, and at least one explained step to mark a record finished.
- Copy imported evidence into app-managed storage, rather than depending on the original installation or file path. Retain provenance and distinguish student-entered evidence from captured execution output.
- Link related notes; search records and export an open-format bundle containing JSON, Markdown, and evidence files.
- Do not execute commands entered into a record.
- Provide SQLite text search now. Vector indexing, AI explanations, and revision-question generation depend on the deferred tutor/model infrastructure and are not part of this first release.

### Style profiles (STY-1 through STY-5, with staged delivery)

- Start with a questionnaire for report, lab journal, or proposal profiles: cover-page fields, fonts, margins, headings, captions, spelling variant, references, voice, and code conventions.
- Save immutable profile versions. Proposed edits remain drafts until explicitly approved in the app; locked profiles cannot be changed until unlocked.
- Allow separate profiles per document type. An approved version is selected explicitly for each style check.
- Support local writing-sample attachment and basic measured sentence-length statistics. Automatic inference of formatting or writing voice from samples is a later enhancement, not a promised initial capability.
- Check pasted text for measurable deviations and clearly identify checks that cannot be assessed from plain text, including fonts, margins, and page layout.
- Resolve settings in this order: instructor requirements, selected approved profile, app defaults. Include the resolved settings in exports for a future document generator.
- Store the "match my style but fix errors" preference. Full document generation and error correction remain deferred until the generation module exists.

## Explicitly deferred

Tutor chat, RAG/vector search, local language models, fine-tuning, flashcards, adaptive revision, video transcripts, mascot overlays, cloud providers, Privacy Gateway, lab installation/execution, generated PDF/DOCX reports, coding-agent integration, portal automation, and submission packaging. The single capture activation and comment popup are now included by the user's clarification.

## Architecture baseline

Use Electron as the Windows desktop shell, with a React frontend, local FastAPI backend, SQLite metadata, and app-managed plain-file attachments. This user-directed decision supersedes the source requirements' Tauri choice. Keep notes, OCR, records, and styles behind separate service boundaries. The first integration slice can run in a browser against the same local API before Electron packaging.

The Electron main process owns desktop integration and the FastAPI child-process lifecycle. Expose only the required desktop operations through a narrow preload interface, with renderer context isolation enabled and Node integration disabled. Package the Python backend and local dependencies for Windows, and shut down the owned backend when the app exits. Measure the Electron shell's memory use on the reference laptop before setting a validated performance budget.

Keep study data in the student-selected workspace folder. Store only runtime settings, including the remembered workspace location, in the Windows per-user application-data directory. Bind the backend to loopback, validate allowed origins, and require a per-launch session token. Never send notes, evidence, or writing samples to a remote service in this release.

Use schema migrations, foreign-key enforcement, transaction boundaries, and crash-safe attachment writes. Imports receive generated storage names; user-supplied filenames never become filesystem paths. Store attachment hashes and sizes. Export must remain usable on a machine without the app.

## Initial data model

| Entity | Main fields / relationships |
| --- | --- |
| Course | ID, name, timestamps |
| Topic | ID, course ID, name |
| Note | ID, title, body, comment, course/topic IDs, type, source app/time, optional source reference, timestamps |
| Tag / note tag | Unique tag name; note-to-tag relationship |
| Attachment | ID, generated relative storage path, original filename, media type, byte size, SHA-256, imported timestamp, provenance |
| Note attachment / record attachment | Explicit foreign-key relationships to attachments |
| OCR job | ID, attachment ID, state, provider, language, raw result, corrected result, error, timestamps |
| Learning record | ID, title, course/topic IDs, brief, answer, draft/finished status, finished timestamp |
| Record step | ID, record ID, sequence, action, rationale, command, output; optional evidence links |
| Record note | Record-to-note relationship |
| Video source | ID, original URL or owned local attachment ID, title, optional creator and duration in milliseconds |
| Video citation | ID, video source ID, start/end milliseconds, comment, optional user-supplied transcript excerpt |
| Note citation / record citation | Explicit note/record-to-video-citation relationships |
| Style profile | ID, name, document type, locked state, active approved version ID |
| Style version | ID, profile ID, version number, settings, draft/approved state, approval timestamp |
| Style sample | Profile-to-attachment relationship and extracted local text |
| Filing preference | Confirmed course/topic/type mapping and usage count |
| Action event | Entity ID, action, timestamp, relevant version/provenance information |

## Build order and completion checks

1. **Foundation:** repository setup, frontend/backend boundaries, migrations, local storage, and API session protection. Verify database persistence across restart and rejection of unauthorized requests.
2. **Notes vertical slice:** create, edit, list, filter, attach, and export. Verify note content and attachment bytes survive restart and export retains source metadata.
3. **OCR integration:** queued extraction, review, correction, and retry. Verify a known printed-text fixture, an invalid image, unavailable OCR engine, and preservation of the original image on failure. Measure accuracy on representative course screenshots before choosing the final engine.
4. **Learning records:** explained steps, owned evidence, note links, finish validation, search, and export. Verify records remain readable after the original imported evidence is removed and export includes every referenced attachment.
5. **Style profiles:** questionnaire, drafts, approval, immutable versions, locking, instructor overrides, and limited consistency checks. Verify draft edits do not change the active approved profile, locked profiles reject changes, and instructor values override profile values.
6. **Windows packaging and offline demo:** package the shell/backend and document the local OCR prerequisite or bundled distribution. Test all four workflows with networking disabled and verify no external requests occur. Test backup restoration on a fresh data directory.

Video citations are part of the notes and records slices: verify timestamp parsing and exact millisecond round trips, multiple moments per video, invalid range rejection, provider-link generation, generic URL fallback, and portable exports. Verify saved remote citations remain readable offline and local citations retain their video evidence after the original file is removed. Do not fetch remote URLs during citation creation.

The release is complete when these implemented workflows pass their checks on Windows and the UI accurately describes deferred capabilities. No automatic AI feature should be represented by a placeholder success result.
