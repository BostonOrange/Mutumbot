# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mutumbot is a Discord bot for "Tiki Room Stockholm" — an ancient tiki entity persona that tracks drink tributes, answers beverage questions via AI, and manages scheduled events. It runs across **two separate deployment environments**:

- **Vercel** (serverless): Slash command handler at `api/interactions.ts`
- **Railway** (persistent process): Gateway bot at `src/gateway/index.ts` handling @mentions, DMs, cron jobs, and message ingestion

## Commands

```bash
npm run dev              # Local Vercel dev server (slash commands)
npm run gateway          # Run gateway bot via ts-node (dev)
npm run gateway:build    # Compile gateway to dist/ (tsc --project tsconfig.gateway.json)
npm run gateway:start    # Run compiled gateway (production)
npm run register         # Register slash commands with Discord API
npm run lint             # ESLint (eslint . --ext .ts)
```

There is no test framework configured. No test files exist.

## Architecture

```
api/interactions.ts          Vercel entry: slash command router + Ed25519 verification
src/gateway/index.ts         Railway entry: discord.js client, event wiring, cron startup
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

## Environment Variables

Required: `DISCORD_APP_ID`, `DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY`, `OPENROUTER_API_KEY`, `DATABASE_URL`
Optional: `DISCORD_GUILD_ID` (dev), `PARTY_CHANNEL_ID` (Friday cron target), `POST_DEMAND_ON_STARTUP`

See `.env.example` for full reference.

## TypeScript Configuration

- Two tsconfig files: `tsconfig.json` (main, includes api/ + src/ + scripts/) and `tsconfig.gateway.json` (gateway-only, outputs to dist/)
- Target: ES2020, CommonJS modules, strict mode
- Node >= 18.0.0 required
