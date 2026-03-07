# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mutumbot is a Discord bot for "Tiki Room Stockholm" — an ancient tiki entity persona that tracks drink tributes, answers beverage questions via AI, and manages scheduled events. It runs across **two separate deployment environments**:

- **Vercel** (Next.js): Slash command handler at `app/api/interactions/route.ts` + admin dashboard at `/admin/*`
- **Railway** (persistent process): Gateway bot at `src/gateway/index.ts` handling @mentions, DMs, cron jobs, and message ingestion

## Commands

```bash
npm run dev              # Next.js dev server (dashboard + slash commands)
npm run build            # Next.js production build
npm run start            # Next.js production server
npm run gateway          # Run gateway bot via ts-node (dev)
npm run gateway:build    # Compile gateway to dist/ (tsc --project tsconfig.gateway.json)
npm run gateway:start    # Run compiled gateway (production)
npm run register         # Register slash commands with Discord API
npm run lint             # ESLint
```

There is no test framework configured. No test files exist.

## Architecture

```
app/api/interactions/route.ts  Vercel entry: slash command router + Ed25519 verification
app/api/admin/*/route.ts       Admin dashboard API routes (agents, workflows, channels, etc.)
app/admin/*                    Admin dashboard pages (Next.js App Router)
lib/auth.ts                    NextAuth Discord OAuth config (admin gating via ADMIN_USER_IDS)
src/gateway/index.ts           Railway entry: discord.js client, event wiring, cron startup
src/gateway/mentionHandler.ts  Routes @mentions: image→tribute, keywords→status, else→AI
src/gateway/fridayCron.ts      Friday auto-tribute cron (random 15:00-18:00 Stockholm time)
src/gateway/eventScheduler.ts  Cron manager for DB-configured scheduled events
src/gateway/retentionJob.ts    Periodic DB cleanup (purge old messages, thread items, runs)
src/drink-questions.ts       Core AI handler: OpenRouter calls, tool-call loop, image analysis
src/db.ts                    All raw SQL queries (Railway Postgres via postgresjs, no ORM)
src/personality.ts           Persona phrases, SAFETY_GUARDRAILS, emoji constants
src/tribute-tracker.ts       Thin facade over db.ts for tribute formatting
```

### Services (`src/services/`)

| File | Purpose |
|---|---|
| `agents.ts` | DB-driven per-channel AI persona config (agents + workflows tables) |
| `threads.ts` | ChatKit-style thread/run/thread_items management |
| `contextBuilder.ts` | "Best 15" message selection algorithm for LLM context |
| `summarizer.ts` | Rolling summarization of old thread items via AI |
| `messageIngestor.ts` | Writes all Discord messages to DB for context building |
| `conversationContext.ts` | Legacy in-memory context cache (20 msgs, 30min TTL) |
| `eventExecutor.ts` | Executes scheduled event types (tribute_reminder, ai_prompt, etc.) |
| `tools.ts` | OpenAI-compatible tool definitions for AI function calling |
| `agentKnowledge.ts` | Persistent fact storage per agent (remember/recall) |
| `userMemory.ts` | Per-user conversation memory summaries |

### Data Flow

```
Discord Event → Gateway/Vercel Handler → Service Layer → OpenRouter AI → Discord Response
                                                ↕
                                          Railway Postgres (db.ts)
```

## Key Patterns

- **Dual entry points**: Slash commands via Vercel HTTP webhook; @mentions/DMs via Railway discord.js Gateway. They share the same service layer but run independently.
- **AI Provider**: OpenRouter only (`openai` npm package pointed at `https://openrouter.ai/api/v1`). Default model: `google/gemini-2.5-flash-lite`.
- **Database**: Railway Postgres via `postgresjs` with raw SQL tagged template literals (`sql\`...\``). No ORM. Tables auto-created in `initializeDatabase()`.
- **Safety guardrails**: `SAFETY_GUARDRAILS` in `personality.ts` is always prepended to every AI system prompt — never overridden by DB agent config. Enforced in `agents.ts:composeSystemPrompt()`.
- **Idempotency**: Message ingestion uses `ON CONFLICT DO NOTHING/UPDATE`; `hasProcessedTrigger()` prevents duplicate AI runs; thread items check `source_message_id`.
- **Thread IDs**: Format is `discord:{guildId}:{channelId}` for guild channels, `discord:dm:{channelId}` for DMs.
- **Context building**: Two systems — newer ChatKit-style (thread_items + rolling summary) is primary; legacy in-memory conversationContext is fallback.
- **Tool calling**: AI can call tools (channel lookup, event scheduling) via an OpenAI-compatible tool-call loop with max 5 iterations.

## Admin Dashboard

Web dashboard at `/admin` for managing agents, workflows, channel assignments, knowledge, and user memories. Protected by Discord OAuth — only users in `ADMIN_USER_IDS` can access.

| Route | Purpose |
|---|---|
| `/admin` | Overview stats |
| `/admin/agents` | Create/edit AI agent personas |
| `/admin/workflows` | Create/edit workflows (agent + context policy) |
| `/admin/channels` | Assign workflows to Discord channels |
| `/admin/knowledge` | Browse/search/delete agent knowledge facts |
| `/admin/memories` | Browse user memory summaries |

## Environment Variables

Required: `DISCORD_APP_ID`, `DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY`, `OPENROUTER_API_KEY`, `DATABASE_URL`
Dashboard: `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `ADMIN_USER_IDS`
Optional: `DISCORD_GUILD_ID` (dev), `PARTY_CHANNEL_ID` (Friday cron target), `POST_DEMAND_ON_STARTUP`

See `.env.example` for full reference.

## TypeScript Configuration

- `tsconfig.json`: Next.js config (module: esnext, moduleResolution: bundler, jsx: preserve). Includes app/, src/, lib/, scripts/
- `tsconfig.gateway.json`: Gateway-only build (overrides to commonjs/node, outputs to dist/). Used by Railway
- Target: ES2020, strict mode, Node >= 18.0.0 required
