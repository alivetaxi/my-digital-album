"""My Digital Album — combined API service."""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from albums import router as albums_router
from fastapi import FastAPI
from media import router as media_router
from thumbnail_proxy import router as thumbnails_router

app = FastAPI(title="My Digital Album API", root_path="/api")

app.include_router(albums_router)
app.include_router(media_router)
app.include_router(thumbnails_router)
