"""Add the authoritative scope revision while preserving the original requirements."""
from pathlib import Path
from io import BytesIO
from html import escape
import re
import shutil
from pypdf import PdfReader, PdfWriter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / 'Scholo Education Assistant Project Requirements Document.pdf'
BACKUP = ROOT / 'docs' / 'archive' / 'requirements-2026-10-02.pdf'
BACKUP.parent.mkdir(parents=True, exist_ok=True)
if not BACKUP.exists():
    shutil.copy2(SOURCE, BACKUP)
styles = getSampleStyleSheet()
styles['BodyText'].fontSize = 10
styles['BodyText'].leading = 14
styles['BodyText'].spaceAfter = 7
styles['Heading1'].textColor = colors.HexColor('#145c50')
styles['Heading2'].textColor = colors.HexColor('#145c50')
story = [Paragraph('Scholo Education Assistant', styles['Title']),
         Paragraph('Project Requirements - Phase 1 Revision', styles['Heading1']),
         Paragraph('5 October 2026 | Authoritative implementation scope', styles['BodyText']), Spacer(1, 16),
         Paragraph('Decision: Electron desktop shell', styles['Heading2']),
         Paragraph('Electron replaces Tauri. React, local FastAPI, SQLite, and app-managed file storage remain the architecture baseline. The earlier Tauri and Rust shell decisions in the preserved historical requirements are superseded. The earlier shell memory target must be remeasured for Electron.', styles['BodyText']),
         Paragraph('Decision: Focused Phase 1', styles['Heading2']),
         Paragraph('Build Notes, local OCR, learning records, personal style profiles, and video citations with exact timestamps. Use one global activation shortcut for pointing or selecting screen content, followed by a comment/instruction popup. The student chooses a workspace folder containing organized subfolders, Markdown notes, JSON metadata, and assets. Video citations belong to notes and records and support exact moments or ranges. This scope replaces the broader Tier 1 delivery commitment for the initial release.', styles['BodyText']),
         Paragraph('Delivery boundaries', styles['Heading2']),
         Paragraph('The implementation baseline on the following pages describes the included workflows, staged enhancements, deferred modules, architecture, and completion checks. Tutor/RAG, models, mascot, labs, cloud routing, and portal automation remain future work. The single screen-capture activation is included. Video URLs and exact timestamps must be confirmed whenever player metadata is unavailable; automatic transcription is deferred.', styles['BodyText']),
         Paragraph('Document precedence', styles['Heading2']),
         Paragraph('This revision and its implementation baseline take precedence over conflicting statements in the original 2 October 2026 document, preserved at the end for traceability. Requirements describe intended behavior, not implementation status. Casrion is a reference for folder-based note taking; its README and license have been reviewed, and no code has been copied.', styles['BodyText']), PageBreak()]
for line in (ROOT / 'docs' / 'phase-1.md').read_text(encoding='utf-8').splitlines():
    if not line.strip():
        continue
    if line.startswith('|'):
        cells = [c.strip() for c in line.strip('|').split('|')]
        if cells[0] == 'Entity' or set(cells[0]) <= {' ', '-'}:
            continue
        line = f'{cells[0]}: {cells[1]}'
    level = len(line) - len(line.lstrip('#'))
    if level:
        style = styles['Heading1' if level <= 2 else 'Heading2']
        text = line[level:].strip()
    else:
        style = styles['BodyText']
        text = line
    text = re.sub(r'\*\*(.*?)\*\*', r'\1', text).replace('`', '')
    if text == 'Initial data model':
        story.append(PageBreak())
    story.append(Paragraph(escape(text), style))
story.extend([PageBreak(), Paragraph('Historical requirements', styles['Title']),
              Paragraph('Original document dated 2 October 2026', styles['Heading2']),
              Paragraph('The following eleven pages are preserved unchanged. The Electron choice and focused Phase 1 scope in the revision at the beginning supersede their conflicting decisions. All other future-phase requirements remain reference material.', styles['BodyText'])])
def footer(canvas, doc):
    canvas.setFont('Helvetica', 8)
    canvas.setFillColor(colors.HexColor('#52615e'))
    canvas.drawString(45, 26, 'Scholo | Phase 1 revision | 5 October 2026')
    canvas.drawRightString(567, 26, str(doc.page))
buffer = BytesIO()
SimpleDocTemplate(buffer, pagesize=(612, 792), leftMargin=45, rightMargin=45,
                  topMargin=45, bottomMargin=45).build(story, onFirstPage=footer, onLaterPages=footer)
writer = PdfWriter()
revision = PdfReader(buffer)
for page in revision.pages:
    writer.add_page(page)
for page in PdfReader(BACKUP).pages:
    writer.add_page(page)
writer.add_metadata({'/Title': 'Scholo Education Assistant - Revised Phase 1 Requirements', '/Subject': 'Electron, Notes, OCR, learning records, style profiles, video citations'})
temp = SOURCE.with_suffix('.revised.tmp.pdf')
with temp.open('wb') as stream:
    writer.write(stream)
temp.replace(SOURCE)
print(f'Updated {SOURCE.name}: {len(revision.pages)} revision pages + 11 historical pages')
