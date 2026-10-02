#!/usr/bin/env python3
"""Download an editor asset ZIP by POST and extract it inside the chosen directory."""

from __future__ import annotations

import argparse
import json
import shutil
import stat
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath, PureWindowsPath


def load_request(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    if isinstance(value, dict) and isinstance(value.get("content"), list):
        texts = [item.get("text") for item in value["content"] if isinstance(item, dict) and item.get("type") == "text"]
        for text in texts:
            try:
                candidate = json.loads(text)
            except (TypeError, json.JSONDecodeError):
                continue
            if isinstance(candidate, dict) and ("request" in candidate or "url" in candidate):
                value = candidate
                break
    if isinstance(value, dict) and isinstance(value.get("request"), dict):
        value = value["request"]
    if not isinstance(value, dict):
        raise ValueError("request JSON must contain an object")
    if str(value.get("method", "POST")).upper() != "POST":
        raise ValueError("asset pack request method must be POST")
    if not isinstance(value.get("url"), str) or not isinstance(value.get("body"), dict):
        raise ValueError("request JSON must contain url and body")
    return value


def validate_body(body: dict) -> dict:
    if body.get("all") is True:
        if "ids" in body:
            raise ValueError("ids and all are mutually exclusive")
        return {"all": True}
    if "all" in body and body["all"] is not False:
        raise ValueError("all must be a boolean")
    ids = body.get("ids")
    if not isinstance(ids, list) or not ids:
        raise ValueError("choose at least one ID or all:true")
    if any(isinstance(asset_id, bool) or not isinstance(asset_id, int) or asset_id <= 0 for asset_id in ids):
        raise ValueError("asset IDs must be positive integers")
    return {"ids": list(dict.fromkeys(ids))}


def checked_target(root: Path, name: str) -> Path:
    normalized = name.replace("\\", "/")
    posix = PurePosixPath(normalized)
    windows = PureWindowsPath(name)
    if not normalized or "\x00" in normalized or posix.is_absolute() or windows.drive or windows.root:
        raise ValueError(f"unsafe ZIP path: {name!r}")
    if ".." in posix.parts or any(":" in part for part in posix.parts):
        raise ValueError(f"unsafe ZIP path: {name!r}")
    reserved = {"CON", "PRN", "AUX", "NUL", *(f"COM{number}" for number in range(1, 10)), *(f"LPT{number}" for number in range(1, 10))}
    if any(part.rstrip(" .") != part or part.split(".")[0].upper() in reserved for part in posix.parts):
        raise ValueError(f"unsafe Windows ZIP path: {name!r}")
    target = root.joinpath(*posix.parts).resolve()
    if target == root or not target.is_relative_to(root):
        raise ValueError(f"ZIP path escapes output directory: {name!r}")
    return target


def extract_checked(archive: zipfile.ZipFile, root: Path) -> None:
    entries = []
    seen = set()
    for member in archive.infolist():
        if stat.S_ISLNK(member.external_attr >> 16):
            raise ValueError(f"ZIP symbolic links are unsupported: {member.filename!r}")
        target = checked_target(root, member.filename)
        if target in seen:
            raise ValueError(f"duplicate ZIP path: {member.filename!r}")
        seen.add(target)
        entries.append((member, target))
    for member, target in entries:
        # Check again after creating parents, including existing output symlinks.
        target = checked_target(root, member.filename)
        if member.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target = checked_target(root, member.filename)
        with archive.open(member) as source, target.open("wb") as destination:
            shutil.copyfileobj(source, destination)


def report_manifest(root: Path) -> int:
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8-sig"))
    if not isinstance(manifest, dict) or not isinstance(manifest.get("counts"), dict):
        raise ValueError("asset pack manifest is missing counts")
    counts = manifest["counts"]
    failed = counts.get("failed", 0)
    if isinstance(failed, bool) or not isinstance(failed, int) or failed < 0:
        raise ValueError("asset pack manifest has invalid failed count")
    print(f"requested={counts.get('requested', '?')} ok={counts.get('ok', '?')} failed={failed}")
    print(f"output={root}")
    entries = manifest.get("assets")
    if not isinstance(entries, list):
        raise ValueError("asset pack manifest is missing assets")
    has_failed_entry = False
    for entry in entries:
        if isinstance(entry, dict) and (entry.get("status") not in (None, "ok", "success") or entry.get("error")):
            has_failed_entry = True
            print(f"failed ID {entry.get('id', '?')}: {entry.get('error') or entry.get('status')}", file=sys.stderr)
    return 1 if failed or has_failed_entry else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8439", help="editor service URL")
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--ids", nargs="+", type=int, metavar="ID")
    selection.add_argument("--all", action="store_true", help="download all assets that have images")
    selection.add_argument("--request", type=Path, help="prepare_asset_pack request or full result JSON")
    parser.add_argument("--output", type=Path, required=True, help="directory for extracted pack files")
    parser.add_argument("--timeout", type=float, default=1800, help="download timeout in seconds (default: 1800)")
    args = parser.parse_args()
    try:
        if args.timeout <= 0:
            raise ValueError("timeout must be positive")
        prepared = load_request(args.request) if args.request else {
            "url": args.base_url.rstrip("/") + "/api/library/assets.zip",
            "body": {"all": True} if args.all else {"ids": args.ids},
        }
        url = prepared["url"]
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError("request URL must be an absolute HTTP(S) URL")
        body = validate_body(prepared["body"])
        request = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json", "Accept": "application/zip"},
        )
        root = args.output.expanduser().resolve()
        root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryFile() as downloaded:
            with urllib.request.urlopen(request, timeout=args.timeout) as response:
                shutil.copyfileobj(response, downloaded)
            downloaded.seek(0)
            with zipfile.ZipFile(downloaded) as archive:
                if "manifest.json" not in archive.namelist():
                    raise ValueError("asset ZIP is missing manifest.json")
                extract_checked(archive, root)
        return report_manifest(root)
    except urllib.error.HTTPError as exc:
        detail = exc.read(4096).decode("utf-8", errors="replace")
        print(f"download failed: HTTP {exc.code}: {detail}", file=sys.stderr)
    except (OSError, ValueError, zipfile.BadZipFile, urllib.error.URLError) as exc:
        print(f"asset pack failed: {exc}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
