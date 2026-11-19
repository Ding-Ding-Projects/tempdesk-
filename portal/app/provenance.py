"""Provenance for the packaged portal code shared by both portal modes."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
from datetime import datetime
from pathlib import Path

FILENAME = "build-provenance.json"
APP_ROOT = Path(__file__).resolve().parent
VERSION = re.compile(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:[-+][0-9A-Za-z.-]+)?")
REVISION = re.compile(r"[0-9a-f]{40}")
UTC = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z")


def application_digest(root: Path) -> str:
    entries = []

    def raise_walk_error(error):
        raise error

    for folder, directories, files in os.walk(root, onerror=raise_walk_error):
        directories[:] = [name for name in directories if name != "__pycache__"]
        base = Path(folder)
        for name in directories + files:
            if (base / name).is_symlink():
                raise ValueError("symlink in portal application")
        for name in files:
            file = base / name
            if file == root / FILENAME or name.endswith((".pyc", ".pyo")):
                continue
            if not file.is_file():
                raise ValueError("non-regular portal application file")
            relative = file.relative_to(root).as_posix().encode("utf-8")
            entries.append((relative, hashlib.sha256(file.read_bytes()).hexdigest().encode("ascii")))

    digest = hashlib.sha256()
    for relative, file_hash in sorted(entries):
        digest.update(relative + b"\0" + file_hash + b"\n")
    return digest.hexdigest()


def load_build_provenance(root: Path = APP_ROOT) -> dict[str, str] | None:
    try:
        if (root / FILENAME).is_symlink():
            return None
        with (root / FILENAME).open("rb") as stream:
            contents = stream.read(1025)
        if len(contents) > 1024:
            return None
        record = json.loads(contents.decode("utf-8"))
        if not isinstance(record, dict) or set(record) != {"schema", "version", "revision", "updated_utc", "application_sha256"}:
            return None
        if type(record["schema"]) is not int or record["schema"] != 1:
            return None
        version, revision, updated, digest = (record[key] for key in ("version", "revision", "updated_utc", "application_sha256"))
        if not all(isinstance(value, str) for value in (version, revision, updated, digest)):
            return None
        if len(version) > 64 or not VERSION.fullmatch(version) or not REVISION.fullmatch(revision) or not UTC.fullmatch(updated):
            return None
        datetime.fromisoformat(updated)
        if not re.fullmatch(r"[0-9a-f]{64}", digest) or digest != application_digest(root):
            return None
        return {"version": version, "revision": revision, "updated_utc": updated}
    except (OSError, ValueError, RecursionError):
        return None


def prepare_container(source: Path, bundled_docs: Path) -> None:
    """Called only by the image producer after copying the portal application."""
    bundled_docs.mkdir(exist_ok=True)
    if (source / "docs").is_dir():
        shutil.copytree(source / "docs", bundled_docs, dirs_exist_ok=True)
    if (source / "CHANGELOG.md").is_file():
        shutil.copyfile(source / "CHANGELOG.md", bundled_docs / "CHANGELOG.md")

    # An already staged distribution has the build record for its exact application bytes.
    if load_build_provenance(APP_ROOT) is not None:
        return
    (APP_ROOT / FILENAME).unlink(missing_ok=True)
    for name in ("base64.js", "zip.js", "regex-builder.js"):
        asset = source / "site" / "assets" / name
        if asset.is_file():
            shutil.copyfile(asset, APP_ROOT / "static" / "js" / name)


if __name__ == "__main__":
    import sys

    prepare_container(Path(sys.argv[1]), Path(sys.argv[2]))
