# ReelVault — Product Design Spec
**Date:** 2026-05-20
**Status:** Approved

---

## Problem

Users discover valuable content on Instagram reels (shayari, workouts, recipes, motivation) but have no frictionless way to save and retrieve it. Instagram's native save is a black hole — unsearchable, unorganized.

---

## Solution

Share any reel to `@reelvault_bot` on Instagram. AI extracts the content. It lands in your personal organized library — accessible via a PWA, searchable, categorized.

---

## End-to-End Flow

```
1. User shares reel → @reelvault_bot DM on Instagram
2. Meta webhook fires → Vercel serverless function receives event
3. yt-dlp downloads reel video/audio
4. Groq Whisper transcribes audio
5. Groq Llama 3 detects content type + extracts structured content
6. Saves to Supabase (user record + content record)
7. Bot replies in DM:
      "✅ Shayari saved!
       तू मिला तो लगा जिंदगी मिल गई...
       📖 View library → reelvault.app/library"
8. User taps link → Instagram OAuth (one tap) → full library
```

---

## Content Types (MVP)

| Type | What AI extracts |
|------|-----------------|
| Shayari / Poetry | Full transcribed text, formatted |
| Workout | Exercise name, sets, reps, rest time |
| Recipe | Ingredients list + step-by-step method |
| Motivation | Key quote pulled from audio/text overlay |
| Fallback | Raw transcript + thumbnail |

---

## Architecture

### 1. Webhook Server (Vercel Serverless)
- Receives Meta Graph API webhook events
- Verifies `X-Hub-Signature-256`
- Extracts reel URL from DM payload
- Queues processing job

### 2. Processing Pipeline
```
reel_url
  → yt-dlp (download mp4)
  → Groq Whisper (audio → transcript)
  → Groq Llama 3 (classify type + extract structured content)
  → Supabase insert
  → Instagram Graph API reply
```

### 3. Database (Supabase)
```sql
users
  id, instagram_user_id, instagram_username, created_at

saved_items
  id, user_id, reel_url, thumbnail_url,
  content_type, extracted_content (jsonb),
  raw_transcript, created_at
```

### 4. Frontend (Next.js PWA)
- `/` → landing page
- `/auth/instagram` → OAuth flow
- `/library` → main library view (categorized grid)
- `/item/:id` → single item detail

---

## Library UI

```
📚 My Library          [Search...]

[All] [Shayari] [Workouts] [Recipes] [Motivation]

┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ [thumbnail] │ │ [thumbnail] │ │ [thumbnail] │
│ 🖊️ Shayari  │ │ 💪 Workout  │ │ 🍳 Recipe   │
│ तू मिला तो │ │ • Squats 3x │ │ • 2 cups... │
│ 20 May      │ │ 19 May      │ │ 18 May      │
└─────────────┘ └─────────────┘ └─────────────┘
```

Add to Home Screen → feels native on both iOS and Android.

---

## Auth Flow

1. First DM to bot → bot replies with: "Welcome! Tap here to set up your library → [link]"
2. User taps → `/auth/instagram` → Instagram OAuth (one tap if already logged in)
3. Account linked → all future saves go to their library automatically

---

## Zero-Cost Stack

| Layer | Tool | Free Limit |
|-------|------|------------|
| Webhook hosting | Vercel | 100GB bandwidth/mo |
| Reel download | yt-dlp (self-hosted) | Unlimited |
| Transcription | Groq Whisper API | 28,800 min audio/day |
| AI extraction | Groq Llama 3.3 70B | 14,400 req/day |
| Database | Supabase | 500MB, 50K MAU |
| Auth | Supabase Auth + Instagram OAuth | Free |
| Frontend | Vercel + Next.js | Free |

---

## MVP Scope (excluded for now)

- Push notifications
- Export to other apps (Notion, Apple Notes)
- Sharing library with friends
- Browser extension
- Support for YouTube Shorts / TikTok

---

## Meta API Setup Requirements

- Meta Developer App (free, ~1-2 weeks approval)
- Instagram Business Account for the bot
- Webhook URL verified with Meta
- Permissions needed: `instagram_manage_messages`, `instagram_basic`

---

## Success Criteria (MVP)

- User shares reel → receives extracted content reply in < 30 seconds
- Library loads correctly on iPhone Safari and Android Chrome
- Shayari text accuracy > 85% (Groq Whisper is strong on Hindi/Urdu)
- Zero infra cost at < 100 daily active users
