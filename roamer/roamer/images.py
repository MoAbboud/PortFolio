"""Uploaded images: checked, turned upright, stripped, resized, stored.

What an upload claims to be - its file name, its content type - is ignored. The bytes are
opened as an image; if Pillow cannot open them as a JPEG, PNG or WebP, they are refused.

Every image is rebuilt from its pixels alone before it is saved. A phone writes its GPS
position into each photo's EXIF, so a picture taken in the back garden carries the owner's
address inside it. Rebuilding from pixels drops the EXIF, the GPS block, the maker notes, any
XMP, ICC profile or comment - everything that is not the picture - and the original upload is
never written anywhere.
"""

from __future__ import annotations

import io
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from PIL import Image, ImageOps, UnidentifiedImageError

from roamer.config import settings

ACCEPTED_FORMATS = {"JPEG", "PNG", "WEBP"}
# What the file input offers. Listing the formats rather than image/* matters on iPhones: given
# a list without HEIC, iOS converts its HEIC photos to JPEG as they are picked.
ACCEPT_ATTRIBUTE = "image/jpeg,image/png,image/webp"

MAX_BYTES = 10 * 1024 * 1024  # a large phone photo is 4-8 MB
MAX_PIXELS = 40_000_000  # past this, a small file that decompresses to gigabytes is an attack
MAX_PHOTOS = 6
DISPLAY_EDGE = 1600
THUMB_EDGE = 400
JPEG_QUALITY = 85

# Pillow's own decompression-bomb guard, set to the same ceiling so the two agree.
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


class ImageRejected(ValueError):
    """The upload is not an image this site accepts. The message is shown to the person."""


@dataclass(frozen=True)
class ProcessedImage:
    display: bytes
    thumb: bytes
    width: int  # of the display size
    height: int


def _flatten(image: Image.Image) -> Image.Image:
    """To plain RGB. Transparency goes onto white, which is how a flyer would be printed."""
    if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.getchannel("A"))
        return background
    return image.convert("RGB")


def _jpeg(image: Image.Image, longest_edge: int) -> tuple[bytes, int, int]:
    resized = image.copy()
    resized.thumbnail((longest_edge, longest_edge), Image.Resampling.LANCZOS)
    # Rebuilt from raw pixels: a new image object with an empty `info`, so there is nothing
    # left for any encoder to carry across.
    clean = Image.frombytes(resized.mode, resized.size, resized.tobytes())
    out = io.BytesIO()
    clean.save(out, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    return out.getvalue(), clean.width, clean.height


def process(data: bytes) -> ProcessedImage:
    """Turn uploaded bytes into a clean display image and thumbnail, or refuse them."""
    if len(data) > MAX_BYTES:
        raise ImageRejected(f"is larger than {MAX_BYTES // (1024 * 1024)} MB")
    try:
        with Image.open(io.BytesIO(data)) as probe:
            if probe.format not in ACCEPTED_FORMATS:
                raise ImageRejected("is not a JPEG, PNG or WebP image")
            width, height = probe.size
            if width * height > MAX_PIXELS:
                raise ImageRejected("has too many pixels")
            probe.load()
            # Applies the EXIF orientation, so a photo taken on its side is shown upright -
            # once the EXIF is gone, nothing else would know which way up it was.
            upright = ImageOps.exif_transpose(probe)
            flat = _flatten(upright)
    except ImageRejected:
        raise
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError) as exc:
        raise ImageRejected("could not be read as an image") from exc

    display, display_w, display_h = _jpeg(flat, DISPLAY_EDGE)
    thumb, _, _ = _jpeg(flat, THUMB_EDGE)
    return ProcessedImage(display=display, thumb=thumb, width=display_w, height=display_h)


def new_storage_key(listing_id: uuid.UUID, photo_id: uuid.UUID) -> str:
    """S3-shaped, so moving to object storage later is a different store, not a new schema."""
    return f"listings/{listing_id}/{photo_id}"


class ImageStore(Protocol):
    def put(self, key: str, data: bytes) -> None: ...
    def delete_prefix(self, prefix: str) -> None: ...


class LocalImageStore:
    """Files on a volume, served at /media."""

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root).resolve()

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        # Keys are built by this module from UUIDs, but a store that could be talked into
        # writing outside its root is a store waiting for the day that stops being true.
        if self.root not in path.parents:
            raise ValueError(f"key escapes the image store: {key!r}")
        return path

    def put(self, key: str, data: bytes) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def delete_prefix(self, prefix: str) -> None:
        path = self._path(prefix.rstrip("/"))
        if path.is_dir():
            shutil.rmtree(path)


class MemoryImageStore:
    """For tests. Keeps everything in a dict and never touches the disk."""

    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}

    def put(self, key: str, data: bytes) -> None:
        self.files[key] = data

    def delete_prefix(self, prefix: str) -> None:
        prefix = prefix.rstrip("/") + "/"
        for key in [k for k in self.files if k.startswith(prefix)]:
            del self.files[key]


def default_store() -> ImageStore:
    return LocalImageStore(settings.image_dir)
