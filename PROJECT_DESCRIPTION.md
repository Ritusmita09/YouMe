# YouMe Project Description and Upgrade Baseline

Last updated: 2026-03-15

## 1. Project Purpose

YouMe is a local-first productivity and media utility web application.

Primary goals:
- Provide a smooth localhost experience for focus workflows.
- Support YouTube metadata lookup and local downloads via yt-dlp.
- Offer a dashboard with Focus, Downloader, Library, Watchlist, Planner, Admin, and Settings.
- Keep the codebase ready for future upgrades while preserving a stable local build.

## 2. Current Build Strategy

This repository currently supports two tracks:

1. Offline local build (Flask + yt-dlp)
- Main app at repository root.
- Auth and user data in local SQLite.
- Local media download and file management.

2. Online build (Next.js)
- Located in online-nextjs.
- Intended for cloud hosting.
- No yt-dlp runtime download flow.

## 3. Current Feature Set (Implemented)

### Authentication and User Session
- Localhost sign-in flow (email + display name).
- Session handling with Flask-Login.
- Login/logout routes and auth checks for API endpoints.

### Focus Mode
- Pomodoro modes and timer ring UI.
- Ambient audio and searched YouTube tracks.
- Track playback controls with seek/timestamp UI.
- Local focus notepad with localStorage persistence.

### Downloader
- YouTube info fetch for video/playlist.
- Video/audio format selection and download execution.
- Progress polling with playlist item indexing and status text.

### Media Reliability Layer
- yt-dlp extraction integrated server-side.
- Audio stream proxy route for reliable track playback.
- Stream caching and range-support behavior for seek/play continuity.

### Library
- Downloaded file listing.
- Download/open and delete actions.

### Watchlist
- Video and playlist watchlist items.
- Playlist expansion with per-lecture checklist.
- Per-lecture thumbnail display inside expanded playlist.
- Completion percentage and watched count for playlists.
- Playlist/lecture deletion and total duration display.

### Planner
- Task logging and completion tracking.
- Lightweight visual score/graph behavior.

### Admin Panel (New)
- Profile info section (name, email, tier, member since, user id).
- Basic account stats (downloads, habits, streak values).
- Badges panel with Coming Soon placeholders.
- Backend endpoint for admin profile payload.

### Theming and Personalization
- Multiple visual themes.
- Theme-aware custom wallpaper upload + crop flow.

### Navigation and UX
- Scroll-based section flow (instead of strict single-tab hide/show).
- Nav highlighting linked to visible section.
- GSAP-based entrance animations for smoother interactions.
- Increased panel spacing and minimum section height to reduce visual clutter.

## 4. Architecture Snapshot

### Backend
- Framework: Flask
- ORM: Flask-SQLAlchemy
- Auth: Flask-Login
- Rate limiting: Flask-Limiter
- Media extraction/download: yt-dlp
- Data store: SQLite (youme.db)

### Frontend
- Server-rendered HTML template with modular section layout.
- Vanilla JavaScript for app logic and state.
- CSS theme tokens and responsive dashboard layout.
- GSAP for selected motion behaviors.

## 5. Core Local API Inventory

Main functional routes include:
- /
- /login
- /logout
- /auth/local
- /fetch_info
- /music_search
- /video_info
- /music_stream_url
- /music_proxy
- /music_download
- /download
- /progress/<task_id>
- /files
- /download_file/<filename>
- /delete_file
- /admin_profile

## 6. Security and Stability Notes

Implemented hardening already includes:
- Request size cap.
- Security headers and CSP policy.
- Input validation on key endpoints.
- Auth protection for private APIs.
- Download state locking and safer JSON parsing patterns.

Operational notes:
- Local workflows rely on active Python environment and dependencies.
- Browser cache busting is used via static asset version query strings.

## 7. Known Current Gaps

- Badge system is currently placeholder-only (Coming Soon state).
- Admin panel is informational only (no profile edit controls yet).
- Some dashboard areas still use inline style snippets and can be normalized.
- Test coverage is limited (most checks are smoke/manual runtime checks).

## 8. Upgrade Plan (Recommended Next Steps)

### Phase A: Account and Admin Maturity
1. Add editable profile fields in Admin panel.
2. Add avatar upload and persistence.
3. Add account activity timeline card.

### Phase B: Badge System
1. Define badge rules in backend.
2. Compute unlock state from user activity.
3. Show unlocked vs locked visuals and progress-to-unlock.

### Phase C: Data Durability and Sync
1. Move watchlist/planner localStorage data into backend models.
2. Add API routes for persistent cross-device state.
3. Add import/export tools for migration from localStorage.

### Phase D: UX and Motion Refinement
1. Add spacing density presets (compact, balanced, airy).
2. Add reduced-motion accessibility option.
3. Tune per-section animation intensity and duration.

### Phase E: Quality and Ops
1. Add route-level tests for critical flows.
2. Add frontend smoke checks for section rendering.
3. Add structured release notes and upgrade changelog.

## 9. Working Principles for Future Upgrades

- Preserve localhost-first reliability before adding cloud complexity.
- Keep security and validation updates in every feature phase.
- Prefer incremental changes with clear rollback points.
- Update this file after every major milestone.

## 10. Quick Developer Start (Local)

1. Create and activate Python virtual environment.
2. Install requirements from requirements.txt.
3. Run app.py.
4. Open the app at localhost and sign in through local auth.

This document is the baseline for all upcoming upgrades.