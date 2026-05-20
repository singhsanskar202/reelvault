# ReelVault — Implementation Plan
**Date:** 2026-05-20
**Spec:** `2026-05-20-reelvault-design.md`

---

## Architecture Decision: No yt-dlp Needed

Groq Whisper accepts a `url` parameter directly (no file upload required).
Instagram webhook gives us a CDN URL for the reel.
Pipeline: `CDN URL → Groq Whisper (url param) → Groq Llama → Supabase → IG reply`
No binary, no ffmpeg, no bundle size issue. Pure serverless on Vercel.

---

## Allowed APIs (from doc discovery)

| API | Endpoint / Method | Source |
|-----|------------------|--------|
| Meta webhook verification | `GET /api/webhook?hub.challenge=...` | Meta webhook docs |
| Meta webhook receive | `POST /api/webhook` + `X-Hub-Signature-256` verify | Meta webhook docs |
| Instagram send reply | `POST https://graph.instagram.com/v25.0/{IG_ID}/messages` | IG Messaging API v25.0 |
| Groq Whisper | `POST https://api.groq.com/openai/v1/audio/transcriptions` with `url` field | Groq SDK docs |
| Groq Llama | `POST https://api.groq.com/openai/v1/chat/completions`, model `llama-3.3-70b-versatile` | Groq SDK docs |
| Supabase Instagram OAuth | `signInWithOAuth({ provider: 'custom:instagram' })` | Supabase custom OAuth docs |
| Supabase identity data | `auth.identities` table, `identity_data->>'sub'` = IG user ID | Supabase identity docs |

---

## Phase 0: Documentation Discovery ✅ COMPLETE

All APIs researched. Findings:
- Groq Whisper: `whisper-large-v3-turbo` model, supports `url` param (no file upload needed)
- Groq Llama: model ID `llama-3.3-70b-versatile`
- Instagram webhook payload: `entry[0].messaging[0].message.attachments[0].payload.url`
- Instagram reply: `POST /v25.0/{IG_ID}/messages` with `{ recipient: { id: IGSID }, message: { text } }`
- Supabase: Instagram NOT built-in — must use `custom:instagram` with `email_optional: true`
- PWA: Next.js 14+ has built-in support via `app/manifest.ts`, no extra package needed
- Reference: `groq-api-cookbook/tutorials/06-multimodal/instagram-reel-subtitler/captioner.py`

Anti-patterns to avoid:
- Do NOT use `provider: 'instagram'` in Supabase (does not exist — 404)
- Do NOT use old Meta scopes `instagram_basic` / `instagram_manage_messages` (deprecated Jan 27 2025)
- Do NOT attempt to cold-DM users (Instagram blocks it — must reply within 24h of user message)
- Do NOT upload audio file to Groq — use `url` field instead to avoid Vercel bundle issues

---

## Phase 1: Project Setup + Meta App + Vercel Deploy

**Goal:** Running Next.js app on Vercel with a working webhook URL that passes Meta's verification handshake.

### Tasks

**1.1 — Scaffold Next.js project**
```bash
npx create-next-app@latest reelvault --typescript --tailwind --app --src-dir
cd reelvault
npm i @supabase/supabase-js @supabase/auth-helpers-nextjs groq
```

**1.2 — Create Supabase project**
- Go to supabase.com → New project
- Copy `SUPABASE_URL` and `SUPABASE_ANON_KEY`
- Run this SQL in the Supabase SQL editor:

```sql
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  instagram_user_id text unique not null,
  instagram_username text,
  created_at timestamptz default now()
);

create table public.saved_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  reel_url text not null,
  thumbnail_url text,
  content_type text check (content_type in ('shayari','workout','recipe','motivation','other')),
  extracted_content jsonb,
  raw_transcript text,
  created_at timestamptz default now()
);

-- RLS: users can only see their own items
alter table public.saved_items enable row level security;
create policy "Users see own items" on public.saved_items
  for all using (auth.uid() = user_id);

alter table public.users enable row level security;
create policy "Users see own profile" on public.users
  for all using (auth.uid() = id);
```

**1.3 — Create Meta Developer App**
- Go to developers.facebook.com → Create App → Business type
- Add Instagram product
- Create Instagram Business Account (or convert existing personal to Professional)
- Under App Settings > Basic: copy App ID and App Secret
- Under Instagram > API Setup: note your Instagram Professional Account ID (this is `IG_ID`)

**1.4 — Create webhook endpoint**
```ts
// src/app/api/webhook/route.ts
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN!
const APP_SECRET = process.env.META_APP_SECRET!

// Meta verification handshake
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('hub.mode')
  const token = req.nextUrl.searchParams.get('hub.verify_token')
  const challenge = req.nextUrl.searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

// Incoming DM events
export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-hub-signature-256') ?? ''

  // Verify signature
  const expected = 'sha256=' + crypto
    .createHmac('sha256', APP_SECRET)
    .update(rawBody)
    .digest('hex')

  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const body = JSON.parse(rawBody)
  // Hand off to processing pipeline (Phase 2)
  // processWebhookEvent(body) — implement in Phase 2

  return new NextResponse('OK', { status: 200 })
}
```

**1.5 — Set environment variables**
```
GROQ_API_KEY=
META_APP_ID=
META_APP_SECRET=
META_VERIFY_TOKEN=reelvault_verify_2026   # any random string
META_IG_ID=                               # your Instagram Professional account ID
META_PAGE_ACCESS_TOKEN=                   # long-lived token for the bot account
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SITE_URL=https://reelvault.vercel.app
```

**1.6 — Deploy to Vercel**
```bash
npx vercel --prod
```
Get the deployment URL (e.g. `https://reelvault.vercel.app`).

**1.7 — Register webhook with Meta**
- In Meta App Dashboard → Webhooks → Subscribe to `instagram` object
- Callback URL: `https://reelvault.vercel.app/api/webhook`
- Verify token: value of `META_VERIFY_TOKEN`
- Subscribe to field: `messages`

**Verification checklist:**
- [ ] `GET /api/webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=12345` returns `12345`
- [ ] Meta dashboard shows webhook as "Verified"
- [ ] Supabase tables exist with RLS enabled
- [ ] Vercel env vars set

---

## Phase 2: Processing Pipeline

**Goal:** DM bot receives reel → transcribes → classifies → saves → replies.

### Tasks

**2.1 — Create Groq client utility**
```ts
// src/lib/groq.ts
import Groq from 'groq'

export const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

export async function transcribeUrl(audioUrl: string): Promise<string> {
  const result = await groq.audio.transcriptions.create({
    model: 'whisper-large-v3-turbo',
    url: audioUrl,
    response_format: 'json',
    language: 'hi',   // Hindi/Urdu — improves shayari accuracy; model auto-detects if wrong
  })
  return result.text
}

export async function classifyAndExtract(transcript: string): Promise<{
  content_type: 'shayari' | 'workout' | 'recipe' | 'motivation' | 'other'
  extracted_content: Record<string, unknown>
  reply_preview: string
}> {
  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a content extractor. Given a transcript from a social media reel, classify it and extract structured content. Return valid JSON only.

Types and what to extract:
- shayari: { type: "shayari", lines: ["line1", "line2"...], reply_preview: "first 2 lines..." }
- workout: { type: "workout", exercises: [{ name, sets, reps, rest }], reply_preview: "bullet list of 3 exercises" }
- recipe: { type: "recipe", ingredients: ["..."], steps: ["..."], reply_preview: "dish name + 2 ingredients" }
- motivation: { type: "motivation", quote: "the key quote", reply_preview: "the quote" }
- other: { type: "other", summary: "1 sentence summary", reply_preview: "summary" }`,
      },
      { role: 'user', content: transcript },
    ],
    temperature: 0.2,
    max_completion_tokens: 1024,
  })
  return JSON.parse(completion.choices[0].message.content!)
}
```

**2.2 — Create Instagram reply utility**
```ts
// src/lib/instagram.ts
const IG_ID = process.env.META_IG_ID!
const TOKEN = process.env.META_PAGE_ACCESS_TOKEN!

export async function sendReply(recipientId: string, text: string) {
  const res = await fetch(
    `https://graph.instagram.com/v25.0/${IG_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
      }),
    }
  )
  if (!res.ok) throw new Error(`IG reply failed: ${await res.text()}`)
}
```

**2.3 — Create Supabase server client**
```ts
// src/lib/supabase-server.ts
import { createClient } from '@supabase/supabase-js'

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!  // service role bypasses RLS for bot writes
)
```

**2.4 — Build processWebhookEvent function**
```ts
// src/lib/process-event.ts
import { transcribeUrl, classifyAndExtract } from './groq'
import { sendReply } from './instagram'
import { supabaseAdmin } from './supabase-server'

const TYPE_EMOJI: Record<string, string> = {
  shayari: '🖊️',
  workout: '💪',
  recipe: '🍳',
  motivation: '✨',
  other: '📌',
}

export async function processWebhookEvent(body: unknown) {
  const entry = (body as any).entry?.[0]
  const messaging = entry?.messaging?.[0]
  if (!messaging) return

  const senderId: string = messaging.sender.id
  const attachment = messaging.message?.attachments?.[0]

  // Only handle reel/media shares
  if (!attachment || !['ig_reel', 'reel', 'share', 'video'].includes(attachment.type)) {
    // First-time user — send onboarding message
    if (messaging.message?.text) {
      await sendReply(senderId, 
        'Hi! Share any Instagram reel to me and I\'ll save it to your personal library 📚\n\nTap here to set up your library 👉 ' +
        process.env.NEXT_PUBLIC_SITE_URL + '/auth/instagram'
      )
    }
    return
  }

  const reelUrl: string = attachment.payload?.url
  if (!reelUrl) return

  // Transcribe
  let transcript: string
  try {
    transcript = await transcribeUrl(reelUrl)
  } catch {
    await sendReply(senderId, "Couldn't process that reel. Try sharing another one!")
    return
  }

  // Classify + extract
  const { content_type, extracted_content, reply_preview } = await classifyAndExtract(transcript)

  // Find or create user in public.users
  const { data: user } = await supabaseAdmin
    .from('users')
    .upsert({ instagram_user_id: senderId }, { onConflict: 'instagram_user_id' })
    .select('id')
    .single()

  // Save item
  await supabaseAdmin.from('saved_items').insert({
    user_id: user!.id,
    reel_url: reelUrl,
    content_type,
    extracted_content,
    raw_transcript: transcript,
  })

  // Reply in DM
  const emoji = TYPE_EMOJI[content_type]
  await sendReply(
    senderId,
    `${emoji} ${content_type.charAt(0).toUpperCase() + content_type.slice(1)} saved!\n\n${reply_preview}\n\n📖 View library → ${process.env.NEXT_PUBLIC_SITE_URL}/library`
  )
}
```

**2.5 — Wire processWebhookEvent into webhook route**

In `src/app/api/webhook/route.ts` POST handler, add after signature verification:
```ts
import { processWebhookEvent } from '@/lib/process-event'

// After signature check:
const body = JSON.parse(rawBody)
// Fire and forget — respond 200 immediately, process async
processWebhookEvent(body).catch(console.error)
return new NextResponse('OK', { status: 200 })
```

**Verification checklist:**
- [ ] Send a test reel to the bot account
- [ ] Webhook logs in Vercel show the event received
- [ ] Signature verification passes
- [ ] Groq transcription returns text
- [ ] Bot replies in DM with extracted content + library link
- [ ] Row appears in `saved_items` table in Supabase
- [ ] Test with shayari reel — Hindi text preserved correctly

---

## Phase 3: User Auth + Library Frontend

**Goal:** User taps library link from DM → Instagram OAuth → sees their saved reels organized.

### Tasks

**3.1 — Configure Instagram as Custom OAuth in Supabase**
- Go to Supabase Dashboard → Authentication → Providers → Add Custom Provider
- Or use admin API:
```ts
// Run once as a setup script
const { error } = await supabaseAdmin.auth.admin.customProviders.createProvider({
  provider_type: 'oauth2',
  identifier: 'custom:instagram',
  name: 'Instagram',
  client_id: process.env.META_APP_ID!,
  client_secret: process.env.META_APP_SECRET!,
  authorization_url: 'https://www.instagram.com/oauth/authorize',
  token_url: 'https://api.instagram.com/oauth/access_token',
  userinfo_url: 'https://graph.instagram.com/me?fields=id,username',
  scopes: ['instagram_business_basic'],
  email_optional: true,   // Instagram does NOT return email
  attribute_mapping: {
    sub: 'id',
    preferred_username: 'username',
  },
})
```
- Add redirect URI in Meta App Dashboard: `https://<project>.supabase.co/auth/v1/callback`

**3.2 — Auth routes**
```ts
// src/app/auth/instagram/route.ts
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = createRouteHandlerClient({ cookies })
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'custom:instagram' as any,
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
      scopes: 'instagram_business_basic',
    },
  })
  if (error || !data.url) return NextResponse.json({ error }, { status: 400 })
  return NextResponse.redirect(data.url)
}
```

```ts
// src/app/auth/callback/route.ts
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse, NextRequest } from 'next/server'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  if (code) {
    const supabase = createRouteHandlerClient({ cookies })
    await supabase.auth.exchangeCodeForSession(code)
  }
  return NextResponse.redirect(new URL('/library', req.url))
}
```

**3.3 — PWA manifest (Next.js built-in, no extra package)**
```ts
// src/app/manifest.ts
import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ReelVault',
    short_name: 'ReelVault',
    description: 'Your personal reel library',
    start_url: '/library',
    display: 'standalone',
    background_color: '#0a0a0a',
    theme_color: '#7c3aed',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
```

**3.4 — Library API route**
```ts
// src/app/api/library/route.ts
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const type = req.nextUrl.searchParams.get('type')   // filter by content_type
  const q = req.nextUrl.searchParams.get('q')          // search query

  let query = supabase
    .from('saved_items')
    .select('id, reel_url, thumbnail_url, content_type, extracted_content, created_at')
    .order('created_at', { ascending: false })

  if (type && type !== 'all') query = query.eq('content_type', type)
  if (q) query = query.textSearch('raw_transcript', q)

  const { data, error } = await query
  return NextResponse.json({ data, error })
}
```

**3.5 — Library page**
```tsx
// src/app/library/page.tsx
'use client'
import { useEffect, useState } from 'react'

const TABS = ['all', 'shayari', 'workout', 'recipe', 'motivation']
const TAB_EMOJI: Record<string, string> = {
  all: '📚', shayari: '🖊️', workout: '💪', recipe: '🍳', motivation: '✨'
}

export default function LibraryPage() {
  const [items, setItems] = useState([])
  const [activeTab, setActiveTab] = useState('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    const params = new URLSearchParams()
    if (activeTab !== 'all') params.set('type', activeTab)
    if (search) params.set('q', search)
    fetch(`/api/library?${params}`).then(r => r.json()).then(d => setItems(d.data ?? []))
  }, [activeTab, search])

  return (
    <main className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-4">My Library</h1>

      <input
        className="w-full border rounded-lg px-3 py-2 mb-4"
        placeholder="Search..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      <div className="flex gap-2 mb-6 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1 rounded-full text-sm whitespace-nowrap
              ${activeTab === tab ? 'bg-purple-600 text-white' : 'bg-gray-100'}`}
          >
            {TAB_EMOJI[tab]} {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {items.map((item: any) => (
          <a key={item.id} href={`/item/${item.id}`}
            className="border rounded-xl p-3 hover:shadow-md transition">
            {item.thumbnail_url && (
              <img src={item.thumbnail_url} className="rounded-lg w-full aspect-square object-cover mb-2" />
            )}
            <span className="text-xs text-gray-500 uppercase">{TAB_EMOJI[item.content_type]} {item.content_type}</span>
            <p className="text-sm mt-1 line-clamp-2">
              {item.content_type === 'shayari'
                ? item.extracted_content?.lines?.[0]
                : item.extracted_content?.reply_preview}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {new Date(item.created_at).toLocaleDateString('en-IN')}
            </p>
          </a>
        ))}
      </div>

      {items.length === 0 && (
        <p className="text-center text-gray-400 mt-10">
          No saves yet. Share a reel to @reelvault_bot on Instagram!
        </p>
      )}
    </main>
  )
}
```

**3.6 — Item detail page**
```tsx
// src/app/item/[id]/page.tsx
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'

export default async function ItemPage({ params }: { params: { id: string } }) {
  const supabase = createServerComponentClient({ cookies })
  const { data: item } = await supabase
    .from('saved_items')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!item) notFound()

  return (
    <main className="max-w-2xl mx-auto px-4 py-6">
      <a href="/library" className="text-purple-600 text-sm mb-4 block">← Back to library</a>
      <h2 className="text-xl font-semibold capitalize mb-4">{item.content_type}</h2>
      <pre className="bg-gray-50 rounded-xl p-4 whitespace-pre-wrap text-sm">
        {JSON.stringify(item.extracted_content, null, 2)}
      </pre>
      <p className="text-xs text-gray-400 mt-4">Saved {new Date(item.created_at).toLocaleString('en-IN')}</p>
    </main>
  )
}
```

**Verification checklist:**
- [ ] `GET /auth/instagram` redirects to Instagram OAuth
- [ ] After OAuth, user lands on `/library`
- [ ] Library shows items saved via bot (matched by instagram_user_id)
- [ ] Tab filter works — shayari tab shows only shayari
- [ ] Search returns relevant results
- [ ] Page installable as PWA on iPhone (Add to Home Screen)
- [ ] Page installable as PWA on Android Chrome

---

## Phase 4: Token Management + Production Hardening

**Goal:** Bot stays alive beyond 60 days. Basic error handling.

### Tasks

**4.1 — Long-lived token refresh (run via cron or manually)**
```ts
// src/app/api/refresh-token/route.ts  (protect with secret header)
export async function GET(req: Request) {
  if (req.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }
  const res = await fetch(
    `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${process.env.META_PAGE_ACCESS_TOKEN}`
  )
  const { access_token } = await res.json()
  // Update env var in Vercel via Vercel API, or log it and update manually
  console.log('New token:', access_token)
  return new Response('OK')
}
```
Set a Vercel cron job (free tier: `vercel.json`) to call this every 30 days.

**4.2 — Vercel cron config**
```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/refresh-token",
      "schedule": "0 9 1 * *"
    }
  ]
}
```

**4.3 — Rate limit guard**

Groq free tier: ~20 req/min for Whisper, 30 req/min for Llama. For MVP (<100 DAU) this is fine.
Add a simple per-sender cooldown in Supabase if needed:
```sql
-- Check if sender sent another reel in last 10 seconds
select count(*) from saved_items
where user_id = $1 and created_at > now() - interval '10 seconds'
```

**Verification checklist:**
- [ ] Token refresh endpoint returns new token
- [ ] Cron job scheduled in Vercel
- [ ] Bot still replies after sending 20 reels in quick succession (rate limit not hit at MVP scale)

---

## Environment Variables Reference

```
# Groq
GROQ_API_KEY=

# Meta / Instagram
META_APP_ID=
META_APP_SECRET=
META_VERIFY_TOKEN=reelvault_verify_2026
META_IG_ID=                        # Bot's Instagram Professional account ID
META_PAGE_ACCESS_TOKEN=            # Long-lived token for bot account (refresh every 60d)

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=         # Server-side only, never expose to client

# App
NEXT_PUBLIC_SITE_URL=https://reelvault.vercel.app
CRON_SECRET=                       # Any random string for cron endpoint auth
```

---

## Known Constraints

| Constraint | Detail |
|-----------|--------|
| Meta App Review | Advanced Access required to serve accounts you don't own. Without it, webhook only fires for test users added in the app dashboard. For personal MVP testing this is fine — submit for review when ready to launch publicly. |
| 24-hour reply window | Bot can only reply within 24h of user's message. No cold outreach. |
| Instagram CDN URL expiry | Process reel immediately on webhook receipt — CDN URLs may expire in hours. |
| Groq free tier | 7,200s audio/hour (Whisper), 14,400 req/day (Llama). Sufficient for MVP (<100 DAU). |
| Supabase free tier | 500MB DB, 50K MAU. Sufficient for MVP. |
| Token refresh | `META_PAGE_ACCESS_TOKEN` expires every 60 days — must refresh before expiry. |
