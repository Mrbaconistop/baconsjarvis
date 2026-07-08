# JARVIS Upgrade: Memory + Router + Proactive Agent

Building three tightly-integrated systems. Default provider is **DeepSeek** (your paid key). Groq and Lovable AI are optional fallbacks.

## 1. Permanent Keyword Memory

Store every message forever with Postgres full-text search on top so JARVIS can pull relevant past context on demand.

- Add a `tsvector` column + GIN index to `chat_messages`, auto-populated by a trigger.
- New table `user_facts_kv` — durable extracted facts ("owns Trident server", "watches TSLA at $420"). JARVIS writes here via a `remember` tool.
- New server fn `recallMemory({ query, limit })` — full-text search over all past messages + facts, scoped to the user.
- On every chat turn: extract top ~5 keywords from the current message, run `recallMemory`, inject results into the system prompt under a `## Relevant memory` section.
- Cross-session pattern detection is emergent from this: mention "Minecraft" in week 1, mention "base" + "Minecraft" in week 4 → week-4 recall pulls week-1 context automatically.

## 2. Smart Model Router (DeepSeek-first)

Server-side classifier picks a model per turn. Fully overridable from Settings.

Routing table (default):

```text
Intent                → Provider / Model
──────────────────────────────────────────────
casual chat, quick    → DeepSeek deepseek-chat
code / debugging      → DeepSeek deepseek-chat
math / hard reasoning → DeepSeek deepseek-reasoner
vision / image input  → Lovable google/gemini-3-flash-preview (only when image attached)
fallback chain        → DeepSeek → Groq (if key present) → Lovable Gemini
```

Groq stays wired but OFF by default. A Settings toggle ("Prefer Groq for casual chat — faster, free") flips the default for quick turns only. If `GROQ_API_KEY` is missing, that toggle is hidden.

Router in `src/lib/model-router.server.ts`:
- `classifyIntent(message, history)` — cheap regex/keyword heuristic, zero LLM cost.
- `pickModel(intent, prefs)` — returns `{ provider, model, baseUrl, apiKey }`.
- `callWithFallback(...)` — try primary; on 429/5xx/network, fall through the chain.
- Logs `provider|model|intent|latency|tokens` per call.

`chat.ts` calls the router instead of hardcoding one provider.

## 3. Proactive Agent (5-minute watcher)

`pg_cron` hits a new public endpoint every 5 min. Endpoint runs cheap checks and writes to `notifications` when thresholds trip.

Watchers (v1):
- **Stocks** — reuse Finnhub key; for each `stock_holdings` row with an `alert_threshold`, compare current price and push a notification on crossing.
- **Weather** — for the user's saved location, notify on state changes (rain starting, temp swing > 15°F, severe alerts).
- **Discord** — new mentions/DMs since last check via existing `discord_webhooks`.

Endpoint: `src/routes/api/public/hooks/watcher-tick.ts` — verified via existing `CRON_SECRET`.

Each watcher is a small pure fn in `src/lib/watchers/*.server.ts` — easy to add Roblox/Steam/crypto later in the same shape.

## Files touched

New:
- `src/lib/model-router.server.ts`
- `src/lib/memory-recall.functions.ts`
- `src/lib/watchers/{stocks,weather,discord}.server.ts`
- `src/routes/api/public/hooks/watcher-tick.ts`

Modified:
- `src/routes/api/chat.ts` — use router + inject recalled memory into system prompt
- `src/routes/_authenticated/settings.tsx` — add "Prefer Groq for casual" toggle (hidden if no key)
- Migrations: `tsvector` + trigger on `chat_messages`, create `user_facts_kv`, seed pg_cron job

## Cost profile

- Chat: DeepSeek (your paid key) → $0 Lovable credits.
- Memory recall: Postgres FTS → $0.
- Watchers: Postgres + Finnhub/Discord/weather APIs → $0.
- Lovable credits used only when: image attached (vision), or every provider in the chain fails and it falls back to Gemini.

## Out of scope this round

Sandbox (P3), custom function registry (P5), full vision UI (P7), Roblox/Steam connectors — queued for next round once these three are stable.

Approve and I'll ship it.