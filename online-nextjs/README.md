YouMe Online (Next.js)

Purpose
- Cloud-friendly build for Vercel.
- No YouTube download or yt-dlp usage.

Local development
1. Install Node.js 20+.
2. From this folder run:
   npm install
   npm run dev
3. Open http://localhost:3000

Deploy to Vercel
1. Push repository to GitHub.
2. In Vercel, import the GitHub repository.
3. Set Root Directory to online-nextjs.
4. Build command: npm run build
5. Output defaults to Next.js standard output.

Notes
- This app is intentionally lightweight and browser-first.
- It currently focuses on Pomodoro and habit tracking.
