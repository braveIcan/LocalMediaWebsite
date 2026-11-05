from __future__ import annotations

import json
import mimetypes
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
TEMPLATE_DIR = BASE_DIR / "templates"
CONFIG_PATH = BASE_DIR / "config.json"
HOST = "127.0.0.1"
PORT = 8876
DEFAULT_ROOT_DIR = str(Path("~/Music").expanduser())

MEDIA_EXTENSIONS = {
    ".mp3": "audio",
    ".wav": "audio",
    ".flac": "audio",
    ".m4a": "audio",
    ".aac": "audio",
    ".ogg": "audio",
    ".opus": "audio",
    ".mp4": "video",
    ".mkv": "video",
    ".mov": "video",
    ".webm": "video",
    ".avi": "video",
    ".m4v": "video",
}

CHUNK_SIZE = 64 * 1024


@dataclass
class MediaItem:
    id: str
    title: str
    rel_path: str
    category: str
    kind: str
    url: str

    def to_dict(self) -> dict[str, str]:
        return {
            "id": self.id,
            "title": self.title,
            "rel_path": self.rel_path,
            "category": self.category,
            "kind": self.kind,
            "url": self.url,
        }


def load_config() -> dict[str, list[str]]:
    if not CONFIG_PATH.is_file():
        return {"root_dirs": [DEFAULT_ROOT_DIR]}
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"root_dirs": [DEFAULT_ROOT_DIR]}

    root_dirs = data.get("root_dirs")
    if isinstance(root_dirs, list):
        return {"root_dirs": [path.strip() for path in root_dirs if isinstance(path, str) and path.strip()]}

    # Retain the existing scan path when migrating the old single-path config.
    root_dir = data.get("root_dir", "")
    if isinstance(root_dir, str) and root_dir.strip():
        return {"root_dirs": [root_dir.strip()]}
    return {"root_dirs": [DEFAULT_ROOT_DIR]}


def save_config(root_dirs: list[str]) -> None:
    CONFIG_PATH.write_text(
        json.dumps({"root_dirs": root_dirs}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def normalize_root_dir(raw_path: str) -> Path:
    candidate = Path(raw_path).expanduser().resolve()
    if not candidate.exists():
        raise ValueError("根目录不存在")
    if not candidate.is_dir():
        raise ValueError("根目录必须是文件夹")
    return candidate


def normalize_root_dirs(raw_paths: object) -> list[Path]:
    if not isinstance(raw_paths, list):
        raise ValueError("扫描路径必须是数组")

    resolved_paths: list[Path] = []
    seen_paths: set[Path] = set()
    for raw_path in raw_paths:
        if not isinstance(raw_path, str) or not raw_path.strip():
            raise ValueError("扫描路径不能为空")
        resolved = normalize_root_dir(raw_path.strip())
        if resolved not in seen_paths:
            resolved_paths.append(resolved)
            seen_paths.add(resolved)
    return resolved_paths


def resolve_root_dirs() -> list[Path]:
    resolved_paths: list[Path] = []
    for raw_path in load_config()["root_dirs"]:
        try:
            resolved_paths.append(normalize_root_dir(raw_path))
        except ValueError:
            continue
    return resolved_paths


def classify_media(path: Path) -> str | None:
    # macOS writes AppleDouble metadata files to non-APFS volumes.
    if path.name.startswith("._"):
        return None
    return MEDIA_EXTENSIONS.get(path.suffix.lower())


def list_media_files(root_dir: Path) -> tuple[list[dict[str, object]], list[dict[str, str]]]:
    categories: list[dict[str, object]] = []
    all_items: list[MediaItem] = []
    source_name = root_dir.name or str(root_dir)

    root_files = sorted(
        [entry for entry in safe_iterdir(root_dir) if entry.is_file()],
        key=lambda entry: entry.name.casefold(),
    )
    root_category_items = build_category_items(root_dir, source_name, root_files)
    if root_category_items:
        categories.append(
            {
                "name": source_name,
                "path": ".",
                "items": [item.to_dict() for item in root_category_items],
            }
        )
        all_items.extend(root_category_items)

    child_dirs = sorted(
        [entry for entry in safe_iterdir(root_dir) if entry.is_dir()],
        key=lambda entry: entry.name.casefold(),
    )
    for child_dir in child_dirs:
        child_files = sorted(
            [entry for entry in safe_iterdir(child_dir) if entry.is_file()],
            key=lambda entry: entry.name.casefold(),
        )
        category_name = f"{source_name} / {child_dir.name}"
        items = build_category_items(root_dir, category_name, child_files)
        if not items:
            continue
        categories.append(
            {
                "name": category_name,
                "path": child_dir.name,
                "items": [item.to_dict() for item in items],
            }
        )
        all_items.extend(items)

    return categories, [item.to_dict() for item in all_items]


def safe_iterdir(path: Path) -> list[Path]:
    try:
        return list(path.iterdir())
    except PermissionError:
        return []


def build_category_items(root_dir: Path, category_name: str, files: list[Path]) -> list[MediaItem]:
    items: list[MediaItem] = []
    for file_path in files:
        kind = classify_media(file_path)
        if kind is None:
            continue
        rel_path = file_path.relative_to(root_dir).as_posix()
        items.append(
            MediaItem(
                id=f"{root_dir}:{rel_path}",
                title=file_path.stem,
                rel_path=rel_path,
                category=category_name,
                kind=kind,
                url=f"/media?root={quote(str(root_dir), safe='')}&path={quote(rel_path)}",
            )
        )
    return items


def build_library_payload() -> dict[str, object]:
    configured_root_dirs = load_config()["root_dirs"]
    categories: list[dict[str, object]] = []
    all_items: list[dict[str, str]] = []
    for root_dir in resolve_root_dirs():
        root_categories, root_items = list_media_files(root_dir)
        categories.extend(root_categories)
        all_items.extend(root_items)
    return {
        "root_dirs": configured_root_dirs,
        "configured": bool(configured_root_dirs),
        "categories": categories,
        "all_items": all_items,
    }


def resolve_media_path(raw_root_dir: str, raw_rel_path: str) -> Path:
    requested_root = Path(unquote(raw_root_dir)).expanduser().resolve()
    root_dir = next((path for path in resolve_root_dirs() if path == requested_root), None)
    if root_dir is None:
        raise FileNotFoundError("扫描路径不存在")
    requested = (root_dir / unquote(raw_rel_path)).resolve()
    if requested != root_dir and root_dir not in requested.parents:
        raise PermissionError("禁止访问")
    if not requested.is_file():
        raise FileNotFoundError("媒体文件不存在")
    if classify_media(requested) is None:
        raise PermissionError("不支持的媒体类型")
    return requested


def parse_range_header(range_header: str | None, file_size: int) -> tuple[int, int] | None:
    if not range_header:
        return None

    unit, _, raw_range = range_header.partition("=")
    if unit.strip().lower() != "bytes" or not raw_range.strip():
        raise ValueError("invalid range unit")

    if "," in raw_range:
        raise ValueError("multiple ranges are not supported")

    start_text, _, end_text = raw_range.strip().partition("-")
    if not start_text and not end_text:
        raise ValueError("empty range")

    if start_text:
        start = int(start_text)
        end = int(end_text) if end_text else file_size - 1
    else:
        suffix_length = int(end_text)
        if suffix_length <= 0:
            raise ValueError("invalid suffix range")
        start = max(file_size - suffix_length, 0)
        end = file_size - 1

    if start < 0 or end < start or start >= file_size:
        raise ValueError("range out of bounds")

    end = min(end, file_size - 1)
    return start, end


class MediaWebsiteHandler(BaseHTTPRequestHandler):
    server_version = "MediaWebsite/1.0"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/":
            self.serve_file(TEMPLATE_DIR / "index.html", "text/html; charset=utf-8")
            return

        if parsed.path.startswith("/static/"):
            self.serve_static(parsed.path.removeprefix("/static/"))
            return

        if parsed.path == "/api/config":
            self.send_json(load_config())
            return

        if parsed.path == "/api/library":
            self.send_json(build_library_payload())
            return

        if parsed.path == "/media":
            params = parse_qs(parsed.query)
            root_dir = params.get("root", [""])[0]
            media_path = params.get("path", [""])[0]
            self.serve_media(root_dir, media_path)
            return

        self.send_error(HTTPStatus.NOT_FOUND, "Not Found")

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path != "/api/config":
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return

        try:
            payload = self.read_json_body()
            resolved_roots = normalize_root_dirs(payload.get("root_dirs"))
            save_config([str(path) for path in resolved_roots])
        except ValueError as error:
            self.send_json({"error": str(error)}, status=HTTPStatus.BAD_REQUEST)
            return
        except json.JSONDecodeError:
            self.send_json({"error": "请求体必须是合法 JSON"}, status=HTTPStatus.BAD_REQUEST)
            return

        self.send_json({"ok": True, "root_dirs": [str(path) for path in resolved_roots]})

    def read_json_body(self) -> dict[str, object]:
        content_length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(content_length) if content_length > 0 else b"{}"
        return json.loads(body.decode("utf-8"))

    def serve_static(self, relative_path: str) -> None:
        target = (STATIC_DIR / relative_path).resolve()
        if STATIC_DIR.resolve() not in target.parents and target != STATIC_DIR.resolve():
            self.send_error(HTTPStatus.FORBIDDEN, "Forbidden")
            return
        self.serve_file(target, mimetypes.guess_type(target.name)[0] or "application/octet-stream")

    def serve_media(self, raw_root_dir: str, raw_rel_path: str) -> None:
        try:
            media_path = resolve_media_path(raw_root_dir, raw_rel_path)
        except FileNotFoundError:
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return
        except PermissionError:
            self.send_error(HTTPStatus.FORBIDDEN, "Forbidden")
            return

        mime_type, _ = mimetypes.guess_type(media_path.name)
        self.serve_file(media_path, mime_type or "application/octet-stream")

    def serve_file(self, path: Path, content_type: str) -> None:
        if not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return
        file_size = path.stat().st_size

        try:
            byte_range = parse_range_header(self.headers.get("Range"), file_size)
        except ValueError:
            self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            self.send_header("Content-Range", f"bytes */{file_size}")
            self.end_headers()
            return

        if byte_range is None:
            start = 0
            end = file_size - 1
            status = HTTPStatus.OK
        else:
            start, end = byte_range
            status = HTTPStatus.PARTIAL_CONTENT

        content_length = end - start + 1
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(content_length))
        if status == HTTPStatus.PARTIAL_CONTENT:
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        self.end_headers()
        self.stream_file(path, start, content_length)

    def stream_file(self, path: Path, start: int, length: int) -> None:
        remaining = length
        try:
            with path.open("rb") as file_obj:
                file_obj.seek(start)
                while remaining > 0:
                    chunk = file_obj.read(min(CHUNK_SIZE, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except BrokenPipeError:
            return

    def send_json(self, payload: object, status: HTTPStatus = HTTPStatus.OK) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except BrokenPipeError:
            return

    def log_message(self, format: str, *args: object) -> None:
        return


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), MediaWebsiteHandler)
    print(f"MediaWebsite running at http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
