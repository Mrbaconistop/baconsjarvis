## Cash App spending tracker

**Note on scope:** Cash App has no public API for personal account history, so this works by (1) you telling JARVIS about purchases in chat and (2) JARVIS auto-scanning Cash App receipt emails in your connected Gmail. Both feed the same ledger.

### 1. Database — `transactions` table
New table `public.transactions` with: `amount_cents`, `currency`, `merchant`, `category`, `note`, `source` (`chat` | `gmail` | `manual`), `external_id` (Gmail message id, for dedupe), `occurred_at`. Standard per-user RLS scoped to `auth.uid()`, same pattern as reminders/vault.

### 2. Chat tools (added to `src/routes/api/chat.ts`)
- `log_transaction` — JARVIS calls this when you say things like "spent $12 on lunch via Cash App". Auto-categorizes (food, transport, entertainment, bills, transfer, other).
- `list_transactions` — filter by date range / category.
- `spending_summary` — totals by category for "this week", "this month", or a custom range. JARVIS will use this to answer "how much did I spend on food this month?".
- `delete_transaction` — fix mistakes.

System prompt updated so JARVIS automatically logs amounts you mention in chat and confirms after.

### 3. Gmail auto-ingest (uses your existing Gmail connector)
- New server route `src/routes/api/public/hooks/ingest-cashapp.ts` — pulls recent unread mail from `cash@square.com` / `cash@cashapp.com` via the Gmail connector gateway, parses amount + merchant + date out of the receipt body, inserts into `transactions` with `source='gmail'` and `external_id=<gmail msg id>` (unique constraint prevents duplicates), then marks the message read.
- `pg_cron` job runs the route every hour. Auth via `apikey` header with the publishable key (standard pattern for `/api/public/*`).
- Manual "Sync Cash App now" button on the new Spending page that hits the same route on demand.

### 4. Spending page — `src/routes/_authenticated/spending.tsx`
- Stat cards: This week / This month / Last 30 days totals.
- Category breakdown (simple bar list, no chart lib).
- Recent transactions table with inline delete.
- "Sync Cash App emails" button.
- Sidebar nav entry added in `AppShell`.

### Technical notes
- Amounts stored as integer cents to avoid float drift.
- Gmail parser is regex-based (Cash App receipts have stable `$X.XX to <name>` / `Payment to <name> $X.XX` formats); unparseable emails get logged but skipped so the cron never crashes.
- Categorization is a small keyword map server-side; user can override by replying "categorize that as transport" and JARVIS uses `log_transaction` update path.
- No new secrets needed — uses existing `GOOGLE_MAIL_API_KEY` connector and `LOVABLE_API_KEY`.

### Limitations to call out
- Only catches transactions Cash App emails you a receipt for (the default). If you've disabled email receipts in Cash App, the Gmail path won't see them — chat logging still works.
- Refunds/reversals from Cash App emails aren't auto-reconciled in v1; you'd tell JARVIS and he'd log a negative entry.