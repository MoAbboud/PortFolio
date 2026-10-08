"""Image processing, without a database: what is refused, what is kept, and what is removed."""

from __future__ import annotations

import io
from pathlib import Path

import pytest
from PIL import ExifTags, Image

from roamer import images


def jpeg_with_gps_and_orientation(width: int = 80, height: int = 40, orientation: int = 6) -> bytes:
    """A JPEG as a phone writes one: GPS position, camera model, and an orientation flag.

    Orientation 6 means "rotate 90 degrees clockwise to display": the pixels are stored on
    their side, and only the flag says which way up the photo was taken.
    """
    image = Image.new("RGB", (width, height), (200, 120, 40))
    exif = Image.Exif()
    exif[ExifTags.Base.Orientation] = orientation
    exif[ExifTags.Base.Make] = "PhoneMaker"
    exif[ExifTags.Base.Model] = "Phone 15"
    gps = exif.get_ifd(ExifTags.IFD.GPSInfo)
    gps[ExifTags.GPS.GPSLatitudeRef] = "N"
    gps[ExifTags.GPS.GPSLatitude] = (39.0, 1.0, 58.44)
    gps[ExifTags.GPS.GPSLongitudeRef] = "W"
    gps[ExifTags.GPS.GPSLongitude] = (94.0, 35.0, 36.96)
    out = io.BytesIO()
    image.save(out, format="JPEG", exif=exif)
    return out.getvalue()


def test_the_fixture_really_carries_gps() -> None:
    # Without this, the test below could pass on a photo that never had a location in it.
    with Image.open(io.BytesIO(jpeg_with_gps_and_orientation())) as original:
        gps = original.getexif().get_ifd(ExifTags.IFD.GPSInfo)
        assert gps[ExifTags.GPS.GPSLatitudeRef] == "N"
        assert original.getexif()[ExifTags.Base.Model] == "Phone 15"


def test_a_photo_with_gps_comes_out_with_no_metadata_at_all() -> None:
    result = images.process(jpeg_with_gps_and_orientation())

    for data in (result.display, result.thumb):
        with Image.open(io.BytesIO(data)) as saved:
            assert saved.format == "JPEG"
            assert len(saved.getexif()) == 0
            assert "exif" not in saved.info
            assert "icc_profile" not in saved.info
            assert "xmp" not in saved.info
        # And not hiding anywhere in the bytes either.
        assert b"Exif" not in data
        assert b"Phone 15" not in data
        assert b"PhoneMaker" not in data


def test_the_orientation_is_applied_before_it_is_thrown_away() -> None:
    # Stored 80 wide by 40 high, flagged to be turned on its side: displayed 40 by 80.
    result = images.process(jpeg_with_gps_and_orientation(80, 40, orientation=6))
    assert (result.width, result.height) == (40, 80)


def test_sizes_are_capped() -> None:
    big = Image.new("RGB", (3000, 2000), (10, 20, 30))
    out = io.BytesIO()
    big.save(out, format="PNG")

    result = images.process(out.getvalue())

    assert max(result.width, result.height) == images.DISPLAY_EDGE
    with Image.open(io.BytesIO(result.thumb)) as thumb:
        assert max(thumb.size) == images.THUMB_EDGE


def test_transparency_goes_onto_white() -> None:
    clear = Image.new("RGBA", (20, 20), (0, 0, 0, 0))
    out = io.BytesIO()
    clear.save(out, format="PNG")

    result = images.process(out.getvalue())

    with Image.open(io.BytesIO(result.display)) as saved:
        r, g, b = saved.convert("RGB").getpixel((5, 5))
        assert min(r, g, b) > 245


def test_a_text_file_renamed_to_jpg_is_refused() -> None:
    with pytest.raises(images.ImageRejected, match="could not be read"):
        images.process(b"this is a text file called dog.jpg\n" * 20)


def test_a_gif_is_refused() -> None:
    out = io.BytesIO()
    Image.new("RGB", (10, 10)).save(out, format="GIF")
    with pytest.raises(images.ImageRejected, match="not a JPEG, PNG or WebP"):
        images.process(out.getvalue())


def test_a_file_over_the_size_limit_is_refused_before_it_is_opened() -> None:
    with pytest.raises(images.ImageRejected, match="larger than"):
        images.process(b"\xff" * (images.MAX_BYTES + 1))


def test_too_many_pixels_is_refused(monkeypatch) -> None:
    # The real ceiling is 40 megapixels; a 40-megapixel test image would be slow for nothing.
    monkeypatch.setattr(images, "MAX_PIXELS", 100)
    out = io.BytesIO()
    Image.new("RGB", (20, 20)).save(out, format="PNG")
    with pytest.raises(images.ImageRejected, match="too many pixels"):
        images.process(out.getvalue())


def test_the_local_store_writes_deletes_and_stays_inside_its_root(tmp_path: Path) -> None:
    store = images.LocalImageStore(tmp_path)
    store.put("listings/abc/one-display.jpg", b"jpeg")

    assert (tmp_path / "listings" / "abc" / "one-display.jpg").read_bytes() == b"jpeg"
    store.delete_prefix("listings/abc/")
    assert not (tmp_path / "listings" / "abc").exists()

    with pytest.raises(ValueError, match="escapes"):
        store.put("../outside.jpg", b"no")
