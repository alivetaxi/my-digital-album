"""Thumbnail proxy — redirects /thumbnails/{path} to the public GCS object."""
from __future__ import annotations

import os

from fastapi import APIRouter
from fastapi.responses import RedirectResponse

router = APIRouter(tags=["thumbnails"])

_THUMBNAILS_BUCKET = os.environ.get("THUMBNAILS_BUCKET", "")


@router.get("/thumbnail/{path:path}")
async def get_thumbnail(path: str) -> RedirectResponse:
    """Redirect to the public GCS URL for the thumbnail.

    The bucket name comes from the THUMBNAILS_BUCKET environment variable so
    the frontend never needs to know the bucket URL.
    """
    url = f"https://storage.googleapis.com/{_THUMBNAILS_BUCKET}/{path}"
    return RedirectResponse(url=url, status_code=302)
