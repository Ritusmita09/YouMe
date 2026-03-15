YouMe Monorepo

This repository now contains two builds:

1. Offline Build (Flask + yt-dlp)
- Purpose: localhost use, personal downloading workflows.
- Location: repository root.
- Includes YouTube URL parsing, metadata, and download flows.

2. Online Build (Next.js)
- Purpose: cloud deployment on Vercel.
- Location: online-nextjs.
- No YouTube download and no yt-dlp in runtime.

--------------------------------------------------
Offline Build (Flask)
--------------------------------------------------

Requirements
- Python 3.10+
- Optional: ffmpeg.exe in project root for best conversion reliability.

Quick start on Windows
1. Clone or download this repository.
2. Open terminal at repository root.
3. Run start.bat
4. Open http://127.0.0.1:5000

Manual setup
1. python -m venv .venv
2. .venv\Scripts\activate
3. python -m pip install --upgrade pip
4. pip install -r requirements.txt
5. python app.py

Why this helps localhost users
- Everything needed for offline mode stays in this build.
- yt-dlp remains part of local Python dependencies.
- Users can run locally after clone/download without cloud restrictions.

--------------------------------------------------
Online Build (Next.js for Vercel)
--------------------------------------------------

Folder
- online-nextjs

Local run
1. cd online-nextjs
2. npm install
3. npm run dev
4. Open http://localhost:3000

Vercel deployment
1. Push this repository to GitHub.
2. Import repo in Vercel.
3. Set Root Directory to online-nextjs.
4. Deploy.

Online build policy
- No YouTube download endpoints.
- No yt-dlp execution in the Next.js app.
- Designed for lightweight, cloud-friendly usage.

--------------------------------------------------
Repository layout
--------------------------------------------------

- app.py, templates/, static/, requirements.txt -> Offline Flask build
- online-nextjs/ -> Online Next.js build

License
- Licensed under LICENSE.
