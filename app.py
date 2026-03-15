import os
import json
import threading
import uuid
import sys
import webbrowser
from urllib.parse import urlparse
from datetime import datetime, timezone, timedelta, date
from functools import wraps
from flask import Flask, render_template, request, jsonify, send_from_directory, redirect, url_for
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, current_user, login_user, logout_user
from authlib.integrations.flask_client import OAuth
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import yt_dlp


def get_resource_dir():
    """Directory where bundled resources (templates/static/ffmpeg) are available."""
    if getattr(sys, "frozen", False):
        return getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


def get_runtime_dir():
    """Directory where user-writable files (downloads) should be stored."""
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


RESOURCE_DIR = get_resource_dir()
RUNTIME_DIR = get_runtime_dir()

app = Flask(
    __name__,
    template_folder=os.path.join(RESOURCE_DIR, "templates"),
    static_folder=os.path.join(RESOURCE_DIR, "static"),
)
app.config['TEMPLATES_AUTO_RELOAD'] = True
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
app.config['MAX_CONTENT_LENGTH'] = 1024 * 1024  # 1 MB request body cap

database_url = os.getenv("DATABASE_URL", f"sqlite:///{os.path.join(RUNTIME_DIR, 'youme.db')}")
if database_url.startswith("postgres://"):
    database_url = database_url.replace("postgres://", "postgresql://", 1)

app.config.update(
    SECRET_KEY=os.getenv("SECRET_KEY", "dev-insecure-change-me"),
    SQLALCHEMY_DATABASE_URI=database_url,
    SQLALCHEMY_TRACK_MODIFICATIONS=False,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.getenv("SESSION_COOKIE_SECURE", "0") == "1",
)

AUTH_REQUIRED = os.getenv("AUTH_REQUIRED", "0") == "1"
INVITE_ONLY = os.getenv("INVITE_ONLY", "1") == "1"

db = SQLAlchemy(app)
login_manager = LoginManager(app)
oauth = OAuth(app)
limiter = Limiter(
    key_func=get_remote_address,
    app=app,
    storage_uri=os.getenv("RATELIMIT_STORAGE_URI", "memory://"),
    default_limits=[],
)

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")

google_oauth = None
if GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET:
    google_oauth = oauth.register(
        name="google",
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )

print(f"TEMPLATES: {app.template_folder}")
print(f"STATIC: {app.static_folder}")


@app.after_request
def add_no_cache_headers(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    # Basic hardening headers
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://esm.sh; "
        "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com data:; "
        "img-src 'self' data: https: blob:; "
        "media-src 'self' data: https: blob:; "
        "connect-src 'self' https:; "
        "frame-ancestors 'none'; "
        "base-uri 'self'"
    )
    return response



DOWNLOAD_FOLDER = os.path.join(RUNTIME_DIR, "downloads")
os.makedirs(DOWNLOAD_FOLDER, exist_ok=True)

# Point yt-dlp at a local ffmpeg.exe from bundled resources or runtime folder.
_resource_ffmpeg = os.path.join(RESOURCE_DIR, "ffmpeg.exe")
_runtime_ffmpeg = os.path.join(RUNTIME_DIR, "ffmpeg.exe")
FFMPEG_BINARY = _resource_ffmpeg if os.path.isfile(_resource_ffmpeg) else _runtime_ffmpeg
FFMPEG_LOCATION = os.path.dirname(FFMPEG_BINARY) if os.path.isfile(FFMPEG_BINARY) else None

# Track download progress per task ID
download_tasks = {}
download_tasks_lock = threading.Lock()


class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    google_sub = db.Column(db.String(128), unique=True, nullable=False)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    display_name = db.Column(db.String(255), nullable=True)
    avatar_url = db.Column(db.String(512), nullable=True)
    subscription_tier = db.Column(db.String(32), nullable=False, default="free")
    is_active_user = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class Invite(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))


class PomodoroStreak(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    current_streak = db.Column(db.Integer, nullable=False, default=0)
    best_streak = db.Column(db.Integer, nullable=False, default=0)
    updated_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class Habit(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    name = db.Column(db.String(120), nullable=False)
    is_completed = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))


class HabitCyclePreference(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    habit_id = db.Column(db.Integer, db.ForeignKey("habit.id"), nullable=False, unique=True, index=True)
    cycle_days = db.Column(db.Integer, nullable=False, default=7)
    created_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))


class HabitCheckin(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    habit_id = db.Column(db.Integer, db.ForeignKey("habit.id"), nullable=False, index=True)
    entry_date = db.Column(db.Date, nullable=False, index=True)
    completed = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    __table_args__ = (
        db.UniqueConstraint("habit_id", "entry_date", name="uq_habit_checkin_habit_date"),
    )


with app.app_context():
    db.create_all()


@login_manager.user_loader
def load_user(user_id):
    try:
        return db.session.get(User, int(user_id))
    except Exception:
        return None


def api_auth_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if AUTH_REQUIRED and not current_user.is_authenticated:
            return jsonify({"error": "Authentication required"}), 401
        return f(*args, **kwargs)
    return wrapper


def paid_tier_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if AUTH_REQUIRED and not current_user.is_authenticated:
            return jsonify({"error": "Authentication required"}), 401
        if current_user.is_authenticated and not has_premium_access(current_user):
                return jsonify({"error": "Paid subscription required"}), 403
        return f(*args, **kwargs)
    return wrapper


def is_invited(email):
    if not INVITE_ONLY:
        return True
    invite = Invite.query.filter_by(email=email.lower(), is_active=True).first()
    return invite is not None


def has_premium_access(user):
    if not user or not getattr(user, "is_authenticated", False):
        return False
    tier = (user.subscription_tier or "free").lower()
    if tier in {"pro", "paid", "premium"}:
        return True
    return is_invited(user.email)


def parse_checkin_date(raw_value):
    if not raw_value:
        return datetime.now(timezone.utc).date()
    try:
        return date.fromisoformat(str(raw_value))
    except ValueError:
        return None


def habit_consistency(habit_id, window_days):
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=window_days - 1)
    completed_days = (
        db.session.query(HabitCheckin.entry_date)
        .filter(
            HabitCheckin.habit_id == habit_id,
            HabitCheckin.completed.is_(True),
            HabitCheckin.entry_date >= start,
            HabitCheckin.entry_date <= today,
        )
        .distinct()
        .count()
    )
    return {
        "window_days": window_days,
        "completed_days": completed_days,
        "consistency_percent": round((completed_days / window_days) * 100, 1),
    }


@app.route("/healthz")
def healthz():
    return jsonify({"ok": True})


@app.route("/login")
def login():
    if not AUTH_REQUIRED:
        return redirect(url_for("index"))
    if current_user.is_authenticated:
        return redirect(url_for("index"))
    if google_oauth is None:
        return (
            "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
            503,
        )
    return render_template("login.html")


@app.route("/logout")
def logout():
    logout_user()
    return redirect(url_for("login" if AUTH_REQUIRED else "index"))


@app.route("/auth/google")
def auth_google():
    if google_oauth is None:
        return jsonify({"error": "Google OAuth not configured"}), 503
    redirect_uri = url_for("auth_google_callback", _external=True)
    return google_oauth.authorize_redirect(redirect_uri)


@app.route("/auth/google/callback")
def auth_google_callback():
    if google_oauth is None:
        return jsonify({"error": "Google OAuth not configured"}), 503

    token = google_oauth.authorize_access_token()
    userinfo = token.get("userinfo")
    if not userinfo:
        userinfo = google_oauth.parse_id_token(token)

    email = (userinfo.get("email") or "").strip().lower()
    sub = (userinfo.get("sub") or "").strip()
    if not email or not sub:
        return jsonify({"error": "Failed to read Google account details"}), 400

    invited = is_invited(email)

    user = User.query.filter_by(email=email).first()
    if not user:
        user = User(
            google_sub=sub,
            email=email,
            display_name=userinfo.get("name", ""),
            avatar_url=userinfo.get("picture", ""),
            subscription_tier="premium" if invited else "free",
            is_active_user=True,
        )
        db.session.add(user)
    else:
        user.google_sub = sub
        user.display_name = userinfo.get("name", user.display_name)
        user.avatar_url = userinfo.get("picture", user.avatar_url)
        if invited and (user.subscription_tier or "free").lower() == "free":
            user.subscription_tier = "premium"
        if not user.subscription_tier:
            user.subscription_tier = "free"
        user.updated_at = datetime.now(timezone.utc)

    db.session.commit()
    login_user(user)
    return redirect(url_for("index"))


ALLOWED_VIDEO_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "www.youtu.be",
    "youtube-nocookie.com",
    "www.youtube-nocookie.com",
}


def is_supported_media_url(raw_url):
    try:
        parsed = urlparse(raw_url)
        if parsed.scheme not in {"http", "https"}:
            return False
        host = (parsed.hostname or "").lower()
        return host in ALLOWED_VIDEO_HOSTS
    except Exception:
        return False


def sanitize_task_id(task_id):
    """Validate task_id is a valid UUID to prevent path traversal."""
    try:
        uuid.UUID(str(task_id))
        return str(uuid.UUID(str(task_id)))
    except ValueError:
        return None


@app.route("/")
def index():
    if AUTH_REQUIRED and not current_user.is_authenticated:
        return redirect(url_for("login"))
    return render_template("index.html")



@app.route("/fetch_info", methods=["POST"])
@api_auth_required
@limiter.limit("40/minute")
def fetch_info():
    data = request.get_json(silent=True) or {}

    url = data.get("url", "").strip()
    if not url:
        return jsonify({"error": "No URL provided"}), 400
    if not is_supported_media_url(url):
        return jsonify({"error": "Unsupported URL. Only YouTube links are allowed."}), 400

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": False,
        **(({"ffmpeg_location": FFMPEG_LOCATION}) if FFMPEG_LOCATION else {}),
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if info is None:
                return jsonify({"error": "Could not retrieve video info"}), 400

        if "entries" in info:
            # Playlist
            entries = []
            for entry in info.get("entries", []):
                if entry:
                    entries.append({
                        "id": entry.get("id", ""),
                        "title": entry.get("title", "Unknown"),
                        "duration": entry.get("duration", 0),
                        "thumbnail": entry.get("thumbnail", ""),
                        "url": entry.get("webpage_url", entry.get("url", "")),
                    })
            return jsonify({
                "type": "playlist",
                "title": info.get("title", "Playlist"),
                "count": len(entries),
                "entries": entries,
            })
        else:
            # Single video — collect unique resolutions
            formats = info.get("formats", [])
            resolutions = {}
            for f in formats:
                if f.get("vcodec") != "none" and f.get("height"):
                    height = f["height"]
                    label = f"{height}p"
                    if label not in resolutions:
                        resolutions[label] = height
            sorted_res = sorted(resolutions.keys(), key=lambda x: int(x[:-1]), reverse=True)

            return jsonify({
                "type": "video",
                "title": info.get("title", "Video"),
                "duration": info.get("duration", 0),
                "thumbnail": info.get("thumbnail", ""),
                "channel": info.get("uploader", ""),
                "view_count": info.get("view_count", 0),
                "resolutions": sorted_res,
            })
    except yt_dlp.utils.DownloadError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"Unexpected error: {str(e)}"}), 500


@app.route("/music_search", methods=["POST"])
@api_auth_required
@limiter.limit("30/minute")
def music_search():
    data = request.get_json() or {}
    query = data.get("query", "").strip()
    limit = int(data.get("limit", 10) or 10)
    limit = max(1, min(limit, 25))
    if not query:
        return jsonify({"error": "No query provided"}), 400

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        "skip_download": True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)

        tracks = []
        for entry in (info or {}).get("entries", []):
            if not entry:
                continue
            track_url = entry.get("webpage_url")
            if not track_url and entry.get("id"):
                track_url = f"https://www.youtube.com/watch?v={entry.get('id')}"
            tracks.append({
                "title": entry.get("title", "Unknown"),
                "duration": entry.get("duration", 0),
                "uploader": entry.get("uploader", ""),
                "thumbnail": entry.get("thumbnail", ""),
                "url": track_url or "",
            })

        return jsonify({"query": query, "count": len(tracks), "tracks": tracks})
    except Exception as e:
        return jsonify({"error": f"Search failed: {str(e)}"}), 500


@app.route("/video_info", methods=["POST"])
@api_auth_required
@limiter.limit("40/minute")
def video_info():
    data = request.get_json() or {}
    url = data.get("url", "").strip()
    if not url:
        return jsonify({"error": "No URL provided"}), 400
    if not is_supported_media_url(url):
        return jsonify({"error": "Unsupported URL. Only YouTube links are allowed."}), 400

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        "skip_download": True,
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if not info:
                return jsonify({"error": "Could not retrieve info"}), 400
            title = info.get("title", "Unknown")
            thumbnail = info.get("thumbnail", "")
            if not thumbnail and info.get("thumbnails"):
                thumbnail = info["thumbnails"][-1].get("url", "")
            return jsonify({
                "title": title,
                "thumbnail": thumbnail
            })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/music_stream_url", methods=["POST"])
@api_auth_required
@limiter.limit("30/minute")
def music_stream_url():
    return jsonify({
        "error": "Server-side music stream extraction is disabled. Resolve stream URLs in the browser.",
        "mode": "client-side-extractor-required",
    }), 410


@app.route("/music_download", methods=["POST"])
@api_auth_required
@limiter.limit("10/minute")
def music_download():
    data = request.get_json() or {}
    url = data.get("url", "").strip()
    if not url:
        return jsonify({"error": "No URL provided"}), 400
    if not is_supported_media_url(url):
        return jsonify({"error": "Unsupported URL. Only YouTube links are allowed."}), 400

    task_id = str(uuid.uuid4())
    with download_tasks_lock:
        download_tasks[task_id] = {
            "status": "starting",
            "percent": 0,
            "speed": "",
            "is_playlist": False,
        }

    thread = threading.Thread(
        target=run_download,
        args=(task_id, url, "best", True, None),
        daemon=True,
    )
    thread.start()

    return jsonify({"task_id": task_id})


def progress_hook(task_id):
    def hook(d):
        with download_tasks_lock:
            task = dict(download_tasks.get(task_id, {}))
        info = d.get("info_dict") or {}
        playlist_index = info.get("playlist_index")
        playlist_count = info.get("n_entries") or info.get("playlist_count")
        current_title = info.get("title")

        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate", 0)
            downloaded = d.get("downloaded_bytes", 0)
            percent = (downloaded / total * 100) if total else 0
            speed = d.get("speed", 0)
            speed_str = ""
            if speed:
                if speed > 1_048_576:
                    speed_str = f"{speed / 1_048_576:.1f} MB/s"
                else:
                    speed_str = f"{speed / 1024:.1f} KB/s"
            task.update({
                "status": "downloading",
                "percent": round(percent, 1),
                "speed": speed_str,
                "filename": d.get("filename", ""),
                "playlist_index": playlist_index,
                "playlist_count": playlist_count,
                "current_title": current_title,
            })
        elif d["status"] == "finished":
            task.update({
                "status": "processing",
                "percent": 99,
                "playlist_index": playlist_index,
                "playlist_count": playlist_count,
                "current_title": current_title,
            })
        elif d["status"] == "error":
            task.update({"status": "error", "error": str(d.get("error", "Unknown error"))})
        with download_tasks_lock:
            download_tasks[task_id] = task
    return hook


def run_download(task_id, url, fmt_option, audio_only, playlist_items=None):
    """Run yt-dlp download in a background thread."""
    if audio_only:
        ydl_format = "bestaudio/best"
        postprocessors = [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "320",
        }]
        outtmpl = os.path.join(DOWNLOAD_FOLDER, "%(title)s.%(ext)s")
    else:
        if fmt_option == "best":
            # Try merged best; fall back to best single-file format if no ffmpeg
            ydl_format = "bestvideo+bestaudio/bestvideo*+bestaudio/best"
        else:
            height = fmt_option.replace("p", "")
            ydl_format = (
                f"bestvideo[height<={height}][ext=mp4]+bestaudio[ext=m4a]"
                f"/bestvideo[height<={height}]+bestaudio"
                f"/best[height<={height}]"
            )
        postprocessors = [{
            "key": "FFmpegVideoConvertor",
            "preferedformat": "mp4",
        }]
        outtmpl = os.path.join(DOWNLOAD_FOLDER, "%(title)s.%(ext)s")

    ydl_opts = {
        "format": ydl_format,
        "outtmpl": outtmpl,
        "quiet": True,
        "no_warnings": True,
        "progress_hooks": [progress_hook(task_id)],
        "postprocessors": postprocessors,
        "merge_output_format": "mp4",
        "noplaylist": playlist_items is None,
        **(({"ffmpeg_location": FFMPEG_LOCATION}) if FFMPEG_LOCATION else {}),
    }
    if playlist_items is not None:
        ydl_opts["noplaylist"] = False

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        with download_tasks_lock:
            if task_id in download_tasks:
                download_tasks[task_id]["status"] = "done"
                download_tasks[task_id]["percent"] = 100
    except Exception as e:
        with download_tasks_lock:
            if task_id in download_tasks:
                download_tasks[task_id]["status"] = "error"
                download_tasks[task_id]["error"] = str(e)


@app.route("/download", methods=["POST"])
@api_auth_required
@limiter.limit("10/minute")
def start_download():
    data = request.get_json(silent=True) or {}
    url = data.get("url", "").strip()
    resolution = data.get("resolution", "best")
    audio_only = data.get("audio_only", False)
    is_playlist = data.get("is_playlist", False)

    if not url:
        return jsonify({"error": "No URL provided"}), 400
    if not is_supported_media_url(url):
        return jsonify({"error": "Unsupported URL. Only YouTube links are allowed."}), 400

    task_id = str(uuid.uuid4())
    with download_tasks_lock:
        download_tasks[task_id] = {
            "status": "starting",
            "percent": 0,
            "speed": "",
            "is_playlist": bool(is_playlist),
        }

    thread = threading.Thread(
        target=run_download,
        args=(task_id, url, resolution, audio_only, True if is_playlist else None),
        daemon=True,
    )
    thread.start()

    return jsonify({"task_id": task_id})


@app.route("/progress/<task_id>")
@api_auth_required
def get_progress(task_id):
    safe_id = sanitize_task_id(task_id)
    if not safe_id:
        return jsonify({"error": "Invalid task ID"}), 400
    with download_tasks_lock:
        task = dict(download_tasks.get(safe_id, {"status": "not_found"}))
    return jsonify(task)


@app.route("/files")
@api_auth_required
def list_files():
    """List downloaded files."""
    files = []
    for f in os.listdir(DOWNLOAD_FOLDER):
        fpath = os.path.join(DOWNLOAD_FOLDER, f)
        if os.path.isfile(fpath):
            size = os.path.getsize(fpath)
            files.append({
                "name": f,
                "size": size,
                "size_str": format_size(size),
            })
    files.sort(key=lambda x: x["name"].lower())
    return jsonify(files)


@app.route("/download_file/<path:filename>")
@api_auth_required
def download_file(filename):
    """Serve a downloaded file safely."""
    # Prevent path traversal
    safe_name = os.path.basename(filename)
    return send_from_directory(DOWNLOAD_FOLDER, safe_name, as_attachment=True)


@app.route("/delete_file", methods=["POST"])
@api_auth_required
def delete_file():
    data = request.get_json(silent=True) or {}
    filename = os.path.basename(data.get("filename", ""))
    if not filename:
        return jsonify({"error": "No filename"}), 400
    fpath = os.path.join(DOWNLOAD_FOLDER, filename)
    if os.path.isfile(fpath):
        os.remove(fpath)
        return jsonify({"success": True})
    return jsonify({"error": "File not found"}), 404


def format_size(size):
    if size >= 1_073_741_824:
        return f"{size / 1_073_741_824:.2f} GB"
    elif size >= 1_048_576:
        return f"{size / 1_048_576:.2f} MB"
    elif size >= 1024:
        return f"{size / 1024:.2f} KB"
    return f"{size} B"


@app.route("/api/me", methods=["GET"])
@api_auth_required
def api_me():
    if not current_user.is_authenticated:
        return jsonify({"authenticated": False, "tier": "free"})
    return jsonify({
        "authenticated": True,
        "email": current_user.email,
        "display_name": current_user.display_name,
        "subscription_tier": current_user.subscription_tier,
        "premium_access": has_premium_access(current_user),
        "invited": is_invited(current_user.email),
    })


@app.route("/api/pomodoro/streak", methods=["GET", "POST"])
@api_auth_required
def api_pomodoro_streak():
    if not current_user.is_authenticated:
        return jsonify({"error": "Authentication required"}), 401

    row = PomodoroStreak.query.filter_by(user_id=current_user.id).first()
    if row is None:
        row = PomodoroStreak(user_id=current_user.id, current_streak=0, best_streak=0)
        db.session.add(row)
        db.session.commit()

    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        current = int(data.get("current_streak", row.current_streak) or 0)
        best = int(data.get("best_streak", max(row.best_streak, current)) or 0)
        row.current_streak = max(0, current)
        row.best_streak = max(best, row.current_streak)
        row.updated_at = datetime.now(timezone.utc)
        db.session.commit()

    return jsonify({
        "current_streak": row.current_streak,
        "best_streak": row.best_streak,
        "updated_at": row.updated_at.isoformat(),
    })


@app.route("/api/habits", methods=["GET", "POST"])
@api_auth_required
def api_habits():
    if not current_user.is_authenticated:
        return jsonify({"error": "Authentication required"}), 401

    if request.method == "POST":
        if not has_premium_access(current_user):
            return jsonify({"error": "Invite approval or premium subscription required for habit writes"}), 403

        data = request.get_json(silent=True) or {}
        action = (data.get("action") or "create").strip().lower()

        if action == "create":
            name = (data.get("name") or "").strip()
            if not name:
                return jsonify({"error": "Habit name is required"}), 400

            cycle_days = int(data.get("cycle_days", 7) or 7)
            if cycle_days not in {7, 28}:
                return jsonify({"error": "cycle_days must be 7 or 28"}), 400

            habit = Habit(user_id=current_user.id, name=name, is_completed=False)
            db.session.add(habit)
            db.session.flush()

            pref = HabitCyclePreference(habit_id=habit.id, cycle_days=cycle_days)
            db.session.add(pref)

            if bool(data.get("initial_checkin", False)):
                today = datetime.now(timezone.utc).date()
                db.session.add(
                    HabitCheckin(
                        user_id=current_user.id,
                        habit_id=habit.id,
                        entry_date=today,
                        completed=True,
                    )
                )
                habit.is_completed = True

            db.session.commit()

        elif action == "checkin":
            habit_id = int(data.get("habit_id", 0) or 0)
            if habit_id <= 0:
                return jsonify({"error": "habit_id is required"}), 400

            habit = Habit.query.filter_by(id=habit_id, user_id=current_user.id).first()
            if habit is None:
                return jsonify({"error": "Habit not found"}), 404

            checkin_date = parse_checkin_date(data.get("date"))
            if checkin_date is None:
                return jsonify({"error": "date must be in YYYY-MM-DD format"}), 400

            completed = bool(data.get("completed", True))
            checkin = HabitCheckin.query.filter_by(habit_id=habit.id, entry_date=checkin_date).first()
            if checkin is None:
                checkin = HabitCheckin(
                    user_id=current_user.id,
                    habit_id=habit.id,
                    entry_date=checkin_date,
                    completed=completed,
                )
                db.session.add(checkin)
            else:
                checkin.completed = completed

            if checkin_date == datetime.now(timezone.utc).date():
                habit.is_completed = completed

            db.session.commit()
        else:
            return jsonify({"error": "Unsupported action. Use create or checkin"}), 400

    habits = Habit.query.filter_by(user_id=current_user.id).order_by(Habit.created_at.desc()).all()
    habit_ids = [h.id for h in habits]
    pref_rows = HabitCyclePreference.query.filter(HabitCyclePreference.habit_id.in_(habit_ids)).all() if habit_ids else []
    cycle_by_habit = {p.habit_id: p.cycle_days for p in pref_rows}

    return jsonify([
        {
            "id": h.id,
            "name": h.name,
            "is_completed": h.is_completed,
            "cycle_days": cycle_by_habit.get(h.id, 7),
            "consistency_7_day": habit_consistency(h.id, 7),
            "consistency_28_day": habit_consistency(h.id, 28),
            "created_at": h.created_at.isoformat(),
        }
        for h in habits
    ])


if __name__ == "__main__":
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "5000"))
    debug = os.getenv("FLASK_DEBUG", "0") == "1"
    url = f"http://{host}:{port}"
    print(f"\nYouMe Downloader running at: {url}\n")

    if os.getenv("OPEN_BROWSER", "1") == "1":
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()

    app.run(debug=debug, host=host, port=port, threaded=True)
