import os
from pathlib import Path
import shutil
import subprocess

def recognize(path: Path):
    engine = shutil.which('tesseract')
    if engine:
        args = [engine, str(path), 'stdout', '-l', 'eng']
        provider = 'tesseract'
    elif os.name == 'nt':
        args = ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
                str(Path(__file__).with_name('windows_ocr.ps1')), '-ImagePath', str(path.resolve())]
        provider = 'windows-ocr'
    else:
        raise RuntimeError('No local OCR engine is available. Configure Tesseract, then retry.')
    result = subprocess.run(args, capture_output=True, timeout=60,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise RuntimeError('Local OCR failed. Check the installed OCR language data or configure Tesseract.')
    return result.stdout.decode('utf-8-sig', errors='replace'), provider
