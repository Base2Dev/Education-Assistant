"""Local backend entry point; configuration is passed by Electron via environment."""
import os
import uvicorn
from backend.app import create_app

if __name__ == '__main__':
    uvicorn.run(create_app(), host='127.0.0.1', port=int(os.environ.get('SCHOLO_PORT', '8765')), access_log=False)
