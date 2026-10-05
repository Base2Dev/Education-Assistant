# Scholo Education Assistant

A local Windows study workspace built with Electron, React, FastAPI, and SQLite.

## Current build

The first Phase 1 slice implements note creation/editing, course/topic/tags, source metadata, search, image imports, exact video citations, and ZIP export containing Markdown, JSON, and original images. Notes survive application restarts. Video timestamps retain millisecond precision; YouTube links seek to the containing second, while other providers keep the original URL and explicit timing.

OCR uses a bounded local worker queue. It uses Tesseract when available on PATH, or Windows' built-in OCR with installed language data. It retains raw and reviewed text separately and supports retry. The Windows adapter passed a generated English text fixture; accuracy on course screenshots is still pending.

Learning records, style profiles, automatic filing suggestions, local video imports, AI interpretation of comments, and the Windows installer are pending. Their navigation entries explicitly show this status. This is a developer build, not the completed Phase 1 release. See [the Phase 1 scope](docs/phase-1.md).

## Folder workspace and single capture shortcut

Choose a workspace folder in the app. New study data goes into that folder. Switching folders opens another workspace; it does not move or erase the previous one. Existing development notes in the old app-data directory remain there.

**Ctrl+Shift+Space** is the only global shortcut. It freezes the screen under the pointer and opens a selection overlay. Click a target to use its accessible bounds, or drag a region when targeting is inaccurate. Escape cancels. The comment popup previews the selection, extracts text locally, and lets you choose image, reviewed text, or a video citation; set the course/topic destination and add your comment/instruction before saving.

Video source/time suggestions use available accessibility metadata. Confirm them in the popup. Unsupported or hidden player controls require entering the URL and timing yourself. Video citations save the reference and timing without downloading the video. Image and text captures retain the selected PNG as evidence. AI explanations and summaries are not executed yet.

The chosen folder contains `notes/<course>/<topic>/<note-id>/note.md`, `note.json`, and `assets/`, plus a local SQLite index, an original attachment store, and folders reserved for learning records and style profiles. Notes are readable outside the app. External file edits are not yet imported into the index.

Closing the main window hides it to the tray so capture remains available. Use the tray to open, capture, or quit. If another app owns the shortcut, use the Capture button or tray. The desktop shortcut launches the development runtime and depends on the project remaining at its current path.

## Setup and desktop launch

Prerequisites: Windows, Node.js 22.12+ or 24+, pnpm, and Python 3.12+. The development backend needs a project-local Python environment.

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
pnpm install
# If pnpm does not execute Electron's runtime download:
node node_modules/electron/install.js
pnpm build
pnpm desktop
```

Electron starts the backend on an available loopback port, supplies a random session token, and stores study data in the chosen workspace folder. Only runtime settings remember the workspace path in per-user application data. The renderer receives a restricted preload API. Set `SCHOLO_PYTHON` to a Python executable if it is outside `.venv`. Set `SCHOLO_DATA_DIR` to select a development workspace without a folder dialog.

The desktop window loads bundled local assets. Node integration is disabled; context isolation and sandboxing are enabled. Navigation, new windows, and permission requests are restricted. No external requests are made when creating a video citation, importing an image, or editing a note.

## Browser development

In one terminal:

```powershell
$env:SCHOLO_SESSION_TOKEN = .venv\Scripts\python.exe -c "import secrets; print(secrets.token_hex(32))"
$env:SCHOLO_DATA_DIR = "$PWD\.test-data\development"
.venv\Scripts\python.exe -m backend.run
```

In a second terminal run `pnpm dev`. Open `http://127.0.0.1:5173` and enter the session token from the first terminal. The token is held in memory only. Browser development uses port 8765 for the backend; Electron selects its own port automatically.

## Verification

```powershell
.venv\Scripts\python.exe -m pytest backend/tests -q
pnpm build
```

The backend tests cover authentication/origin rejection, restart persistence, note updates/search, invalid citations, exact timestamp round trips, image validation, exported evidence bytes, and OCR failure without evidence loss.

Verified on 5 October 2026: 17 backend tests pass, the production frontend builds, browser note/citation persistence passes, and native Electron startup, preload IPC, note persistence, and renderer isolation pass. The single activation shortcut, region selection, capture popup, exact video citation, cancellation, and workspace switching also pass. Browser checks found no console errors. Verification data is isolated under `.test-data`, separate from the student's desktop workspace.

Reusable verification scripts are `scripts/verify-browser.cjs`, `scripts/verify-desktop.cjs`, and `scripts/verify-capture.cjs`; they require a local Playwright installation or the `PLAYWRIGHT_MODULE` environment variable pointing to one. The browser script uses Microsoft Edge and the development backend session token. Test runs must have access to their local servers and a writable temporary directory.

Remaining verification includes real OCR accuracy, packaged Windows installation, backup restoration, memory measurement, and the pending module workflows. There is no bundled Python distribution or installer yet.

## Requirements document

The revised [requirements PDF](docs/requirements.pdf) is included in this repository.

`scripts/update_requirements.py` regenerates the revision at the start of the PDF in the parent workspace. It preserves the original 2 October document in a local archive and appends it unchanged as historical requirements. The 5 October revision makes Electron and the narrower Phase 1 scope authoritative.
