"""Vercel entry point for the Muri FastAPI backend.

Vercel's FastAPI framework support looks for a module exposing an ASGI ``app``
at a supported filename (``app.py``, ``main.py``, ``index.py`` ...). The real
application lives in ``muri/backend/main.py``; this thin shim puts that folder
on the import path (the backend uses top-level imports such as ``import auth``)
and re-exports its ``app`` instance.

Note: on Vercel the backend runs as a serverless function and does NOT serve the
frontend. ``main.py`` only mounts static files when ``FRONTEND_DIST`` exists,
which it does not here -- the Vite frontend is deployed as its own service.
"""

from __future__ import annotations

import os
import sys

_BACKEND_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "muri", "backend"
)
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from main import app  # noqa: E402,F401  (re-exported for Vercel)

__all__ = ["app"]
