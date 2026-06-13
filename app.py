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


def load_config() -> dict[str, str]:
    if not CONFIG_PATH.is_file():
        return {"root_dir": DEFAULT_ROOT_DIR}
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"root_dir": DEFAULT_ROOT_DIR}
    root_dir = data.get("root_dir", "")
    if not isinstance(root_dir, str) or not root_dir.strip():
        return {"root_dir": DEFAULT_ROOT_DIR}
    return {"root_dir": root_dir}


def save_config(root_dir: str) -> None:
    CONFIG_PATH.write_text(
        json.dumps({"root_dir": root_dir}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def normalize_root_dir(raw_path: str) -> Path:
    candidate = Path(raw_path).expanduser().resolve()
    if not candidate.exists():
        raise ValueError("根目录不存在")
    if not candidate.is_dir():
        raise ValueError("根目录必须是文件夹")
    return candidate


def resolve_root_dir() -> Path | None:
    config = load_config()
    root_dir = config.get("root_dir", "").strip()
    if not root_dir:
        return None
    try:
        return normalize_root_dir(root_dir)
    except ValueError:
        return None


def classify_media(path: Path) -> str | None:
    return MEDIA_EXTENSIONS.get(path.suffix.lower())


def list_media_files(root_dir: Path) -> tuple[list[dict[str, object]], list[dict[str, str]]]:
    categories: list[dict[str, object]] = []
    all_items: list[MediaItem] = []

    root_files = sorted(
        [entry for entry in safe_iterdir(root_dir) if entry.is_file()],
        key=lambda entry: entry.name.casefold(),
    )
    root_category_items = build_category_items(root_dir, "Root", root_files)
    if root_category_items:
        categories.append(
            {
                "name": "Root",
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
        items = build_category_items(root_dir, child_dir.name, child_files)
        if not items:
            continue
        categories.append(
            {
                "name": child_dir.name,
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
                id=rel_path,
                title=file_path.stem,
                rel_path=rel_path,
                category=category_name,
                kind=kind,
                url=f"/media?path={quote(rel_path)}",
            )
        )
    return items


def build_library_payload() -> dict[str, object]:
    root_dir = resolve_root_dir()
    if root_dir is None:
        return {
            "root_dir": "",
            "configured": False,
            "categories": [],
            "all_items": [],
        }

    categories, all_items = list_media_files(root_dir)
    return {
        "root_dir": str(root_dir),
        "configured": True,
        "categories": categories,
        "all_items": all_items,
    }


def resolve_media_path(raw_rel_path: str) -> Path:
    root_dir = resolve_root_dir()
    if root_dir is None:
        raise FileNotFoundError("未配置根目录")
    requested = (root_dir / unquote(raw_rel_path)).resolve()
    if requested != root_dir and root_dir not in requested.parents:
        raise PermissionError("禁止访问")
    if not requested.is_file():
        raise FileNotFoundError("媒体文件不存在")
    if classify_media(requested) is None:
        raise PermissionError("不支持的媒体类型")
    return requested


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
            media_path = params.get("path", [""])[0]
            self.serve_media(media_path)
            return

        self.send_error(HTTPStatus.NOT_FOUND, "Not Found")

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path != "/api/config":
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return

        try:
            payload = self.read_json_body()
            raw_root = str(payload.get("root_dir", "")).strip()
            resolved = normalize_root_dir(raw_root)
            save_config(str(resolved))
        except ValueError as error:
            self.send_json({"error": str(error)}, status=HTTPStatus.BAD_REQUEST)
            return
        except json.JSONDecodeError:
            self.send_json({"error": "请求体必须是合法 JSON"}, status=HTTPStatus.BAD_REQUEST)
            return

        self.send_json({"ok": True, "root_dir": str(resolved)})

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

    def serve_media(self, raw_rel_path: str) -> None:
        try:
            media_path = resolve_media_path(raw_rel_path)
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
        data = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, payload: object, status: HTTPStatus = HTTPStatus.OK) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format: str, *args: object) -> None:
        return


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), MediaWebsiteHandler)
    print(f"MediaWebsite running at http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
