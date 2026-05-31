# 🎬 Htut Movie Recap & Dubbing Studio — Premium AI Suite v3

A premium AI-powered **Myanmar Movie Recap & Dubbing Production Suite** built with Next.js, Tailwind CSS, and the Google Gemini 2.5 Flash API.

## ✨ Features

### Hub 1 — Interactive Subtitle Studio & Timeline
- Real-time subtitle visualization synced to video playback
- Click-to-edit individual Myanmar translation segments
- Per-segment TTS synthesis with auto speed-fit dubbing
- Active segment highlighting during playback

### Hub 2 — AI Burmese Movie Recap Script Generator
- Analyzes compiled translations to compose social-media-style recap scripts
- Dramatic storytelling format: Introduction → Story Arc → Cliffhanger
- Myanmar language (ဇာတ်လမ်းပြောပြသူ) narrative style
- Full long-form audio narration synthesis

### Hub 3 — 30-Second Micro-Chunk Scheduler
- Safely splits audio into parallelized 30s slices
- Visual RPM budget meter for Free Tier (15 RPM) threshold monitoring
- Prevents client/serverless timeouts on long-form video
- Per-chunk progress tracking with real-time status updates

### Hub 4 — Myanmar Simultaneous TTS Console
- Dual-speaker A/B dialogue testing
- Configurable voices: Kore, Fenrir, Leda, Zephyr, Aoede, Puck
- 5 emotional registers: Excited, Calm, Cheerful, Whisper, Dramatic
- Concurrent or sequential playback modes with variable speed

---

## 🚀 Deploy to Vercel

### Option 1: One-Click via GitHub

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit: Htut Dubber Studio v3"
   git remote add origin https://github.com/YOUR_USERNAME/htut-dubber-studio.git
   git push -u origin main
   ```

2. **Deploy on Vercel**
   - Go to [vercel.com](https://vercel.com) → **New Project**
   - Import your GitHub repository
   - Framework will auto-detect as **Next.js**
   - Click **Deploy** — no environment variables needed (API key entered in-app)

### Option 2: Vercel CLI

```bash
npm install -g vercel
vercel login
vercel --prod
```

---

## 🛠 Local Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Open in browser
open http://localhost:3000
```

---

## 🔑 API Key Setup

The app requires a **Google Gemini API Key** for live production mode.

1. Get your key at [aistudio.google.com](https://aistudio.google.com)
2. In the app header, click **Live API** mode
3. Paste your key into the API Key field (stored in browser session only — never sent to a server)

> **Demo Mode** works without any API key using simulated data and browser TTS.

---

## 📁 Project Structure

```
htut-dubber-studio/
├── src/
│   ├── pages/
│   │   ├── _app.js         # App wrapper + global CSS
│   │   ├── _document.js    # HTML template + Google Fonts
│   │   └── index.js        # Main application (all 4 Hubs)
│   ├── styles/
│   │   └── globals.css     # Premium design tokens + Tailwind
│   └── lib/
│       └── audio.js        # Audio utilities, Gemini API, constants
├── next.config.js
├── tailwind.config.js
├── postcss.config.js
├── vercel.json
└── package.json
```

---

## 🎨 Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 |
| Styling | Tailwind CSS + Custom CSS variables |
| Fonts | Syne (display) + JetBrains Mono + Noto Sans Myanmar |
| AI | Google Gemini 2.5 Flash (translation + TTS) |
| Audio | Web Audio API, PCM→WAV conversion |
| Deployment | Vercel |

---

## 📋 Gemini API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `gemini-2.5-flash:generateContent` | Translation & Recap Script Generation |
| `gemini-2.5-flash-preview-tts:generateContent` | Myanmar Text-to-Speech |

---

## ⚡ Free Tier Optimization

The 30-second chunk scheduler is designed specifically for Gemini's **Free Tier (15 RPM)**:

- Each video is split into ≤30s chunks
- Chunks are processed with exponential backoff on 429 errors
- RPM budget gauge shows real-time throughput against the 15 RPM cap
- Parallel execution with `Promise.all` for maximum throughput within limits

---

## 🌐 Myanmar Language Support

The app uses **Noto Sans Myanmar** font loaded from Google Fonts for proper rendering of all Myanmar/Burmese script characters (U+1000–U+109F).

---

*Built for Htut Production — Myanmar Movie Recap Content Creators*
