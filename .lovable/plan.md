## Reality check on "all integrations"

I can't honestly ship working Twitter/X, LinkedIn, Instagram, and Facebook Pages OAuth in one pass. Each requires:
- You creating a developer app on the platform
- Platform-specific app review (Instagram Graph + FB Pages = weeks; LinkedIn marketing scopes = approval-gated; X API now $200/mo for write access)
- Per-user OAuth callback URLs registered in their dashboards

What I **can** ship working end-to-end today:
- **Google Calendar** + **Gmail** via Lovable connectors (zero credential setup, OAuth handled)
- **Lovable AI** (GPT-5 / Claude / Gemini) for the JARVIS brain, sentiment, summaries, drafts
- **Lovable Cloud** for auth, full DB schema, realtime (Postgres changes = your SSE substitute)

For Twitter/LinkedIn/Instagram/Facebook I'll build the full data model, UI, action buttons, and a clean integration seam (`SocialProvider` interface + per-platform stub), seeded with realistic mock feed data so the dashboard is fully alive. Swapping each stub for a real API later is a localized change once you provide credentials.

## Plan

### 1. Foundation
- Enable Lovable Cloud (auth + Postgres + realtime)
- Enable Lovable AI Gateway
- Connect Google Calendar + Gmail connectors

### 2. Database schema (migration)
Tables exactly as you specified, with RLS on all (`auth.uid() = user_id`):
- `profiles` (id→auth.users, name, timezone, preferred_briefing_time, address_as default 'Sir')
- `connected_accounts` (platform, profile_pic_url, status — tokens stay in connector vault, not this table)
- `reminders` (title, description, datetime, priority enum, is_completed, source_email_id, source_type)
- `social_feeds` (platform, author_name, author_handle, author_avatar, content, url, sentiment_score, sentiment_label, is_actionable, parent_post_id, received_at)
- `notifications` (type, title, message, priority, read_status, action_payload jsonb, source_table, source_id)
- `engagement_stats` (date, platform, impressions, engagements — for Weekly Pulse)
- `user_roles` + `app_role` enum + `has_role()` security definer (per platform rules)

### 3. Design system — "Holographic"
`src/styles.css` overhaul:
- Deep navy/black base `oklch(0.12 0.04 250)` with cyan-arc accent `oklch(0.78 0.18 220)` and amber alert `oklch(0.78 0.18 60)`
- Glass tokens: `--glass-bg`, `--glass-border`, `backdrop-filter: blur(24px) saturate(160%)` (standard property only, per backdrop-filter rules)
- HUD-style border treatments, corner brackets, subtle scanline overlay
- Animated SVG grid + drifting particle layer (CSS-only, GPU-cheap)
- Fonts: `@fontsource/space-grotesk` (display, HUD), `@fontsource/jetbrains-mono` (data/timestamps), `@fontsource/inter` (body) — installed via bun
- Button variants: `hud`, `hud-critical`, `hud-ghost`; Card variant: `glass`, `glass-critical`

### 4. Routes (TanStack Start)
- `/` — public landing teaser with sign-in CTA
- `/auth` — email/password + Google sign-in
- `/_authenticated/dashboard` — Priority Hub (categorized feed) + Quick-Action Bar + live ticker
- `/_authenticated/time` — Reminders + calendar agenda
- `/_authenticated/world` — Social Command Center with per-platform columns + sentiment filters
- `/_authenticated/pulse` — Weekly Pulse charts (recharts: engagement vs. calendar density heatmap, best-time-to-post recommendation)
- `/_authenticated/settings` — connected accounts, briefing time, address-as preference
- `/api/public/cron/morning-briefing` — server route hit by external cron (Lovable Cloud pg_cron or external) that generates daily briefing per user

### 5. Server functions (`src/lib/*.functions.ts`)
- `jarvis.functions.ts` — `runCommand(text)`: NLP parse intent (reminder vs. summary vs. query), `draftReply(context)`, `summarizeMentions(platform, since)`, `morningBriefing()`. All use Lovable AI Gateway with the butler system prompt: *"You are JARVIS. Address the user as 'Sir' (or their configured form). Be efficient, anticipatory, warm. Reference upcoming calendar events when relevant. Keep responses under 60 words unless drafting content."*
- `calendar.functions.ts` — pull next 7 days via Google Calendar connector, parse to reminders
- `gmail.functions.ts` — scan recent threads, extract flight/booking/meeting cues → reminders
- `reminders.functions.ts` — CRUD + natural-language create (`"call David at 3pm"` → parsed datetime)
- `social.functions.ts` — `SocialProvider` interface + Twitter/LinkedIn/IG/FB stub implementations returning mock data; sentiment runs through Lovable AI for each new item; classified items inserted to `social_feeds`
- `notifications.functions.ts` — generates action_payload buttons per source type
- `pulse.functions.ts` — aggregates `engagement_stats` × `calendar_busyness` → recommends top 3 posting windows

### 6. Real-time
Browser subscribes to Postgres changes on `notifications` + `social_feeds` via Supabase realtime — replaces SSE/WebSocket requirement with zero extra infra.

### 7. Voice-to-text
Quick-Action Bar uses browser `SpeechRecognition` API (no key). Falls back to text input where unsupported.

### 8. Actionable notifications
Each notification renders buttons from `action_payload`:
- `{type:'reply_ai', context:{...}}` → opens drawer with AI-drafted reply, [Send] [Edit] [Discard]
- `{type:'snooze', minutes:120}` → updates row
- `{type:'accept_connection'}` → calls platform stub
- Anticipatory wrapper: if next calendar event is within 30 min, message prepends *"Sir, you have an incoming X, but I advise focusing on your [event] in [N] minutes."*

### 9. SEO / shell
- `sitemap.xml`, `robots.txt` (disallow `/_authenticated/*`), `llms.txt`
- Root `head()` with proper OG metadata

## What you'll need to do after I ship
1. Approve enabling Cloud + connecting Google Calendar + Gmail (one-click each)
2. Sign up in-app — Google sign-in works immediately
3. For Twitter/LinkedIn/IG/FB: create developer apps, share client IDs + secrets, and I'll wire each one (one follow-up turn per platform). Until then those columns show realistic mock data clearly labeled "Demo data — connect [platform]".

## Technical notes
- TanStack Start (not Edge Functions) for all server logic
- `requireSupabaseAuth` middleware on all user-scoped server fns
- `attachSupabaseAuth` added to `src/start.ts` middleware
- All AI calls server-side via `@ai-sdk/openai-compatible` + Lovable AI Gateway helper
- Mock seed data inserted via migration so the dashboard looks alive from first login

Ready to build? This will take several large edits — I'll execute in order: Cloud + schema → design system → auth + layout → dashboard + JARVIS brain → time module → world module → pulse + settings → connectors + briefing cron.