# Phase 1 implementation status

Updated 5 October 2026.

| Area | Current state |
| --- | --- |
| Electron + React + FastAPI foundation | Implemented; native startup and restricted IPC verified |
| SQLite persistence | Implemented; schema version 1 and restart persistence verified |
| Notes | Create/edit/search, course/topic/tags, comments, source metadata, and export implemented |
| Folder workspace | User-selected workspace; readable course/topic Markdown and JSON files with local asset folders |
| Screen capture | One Ctrl+Shift+Space activation, click/drag overlay, review/comment popup, and tray behavior implemented |
| Image evidence | Validated image imports, selected screen regions, generated storage names, hashes, and portable ZIP export implemented |
| Video citations | Remote URLs, exact millisecond timestamps/ranges, multiple citations, and exports implemented |
| OCR | Tesseract and Windows OCR adapters, bounded queue, states, retry, and reviewed text; Windows text fixture verified; course accuracy pending |
| Learning records | Pending |
| Style profiles | Pending |
| Filing suggestions | Pending |
| Local video imports | Pending |
| Windows installer / bundled backend | Pending; current app requires the local Python environment |

Verification: 17 backend tests pass; production build passes; browser Notes/citation flow passes without console errors; native Electron Notes flow and renderer isolation pass. The single shortcut, selected image, exact video citation, and Escape cancellation have been verified in the native capture flow. No external requests occur when creating citations. The PDF includes the single activation and folder workspace clarification, followed by preserved historical requirements.

Capture boundaries: source URLs and player times use available accessibility metadata and must be confirmed; unsupported players need manual input. The popup saves content and filing choices and retains free-text instructions. Model-driven execution of those instructions is pending. External Markdown edits are not reindexed yet. Switching workspace folders does not move previous data.

Next implementation slice: learning-record schema and UI with assignment brief, ordered explained steps, note links, owned evidence, finish validation, and portable export. Then implement versioned style profiles with approval and locking, followed by OCR accuracy evaluation and desktop packaging.
