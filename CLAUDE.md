# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mutumbot is a Discord bot for "Tiki Room Stockholm" — a multi-persona AI entity that tracks drink tributes, answers questions via AI, manages scheduled events, and learns about users over time. **Everything runs on Railway** — both the Next.js app (admin dashboard + slash commands) and the persistent gateway bot.

### Deployment (Railway)

Two Railway services from the same repo:

- **Next.js service**: Admin dashboard at `/admin/*` + Discord slash command webhook at `app/api/interactions/route.ts`. Built with `npm run build`, started with `npm run start`.
- **Gateway service**: Persistent discord.js bot at `src/gateway/index.ts` handling @mentions, DMs, cron jobs, and message ingestion. Built with `npm run gateway:build`, started with `npm run gateway:start`.

Both services share the same Railway Postgres database.

## Commands

```bash
npm run dev              # Next.js dev server (dashboard + slash commands)
npm run build            # Next.js production build
npm run start            # Next.js production server
npm run gateway          # Run gateway bot via ts-node (dev)
npm run gateway:build    # Compile gateway to dist/ (tsc --project tsconfig.gateway.json)
npm run gateway:start    # Run compiled gateway (production)
npm run register         # Register slash commands with Discord API
npm run test             # Run unit tests (vitest)
npm run test:watch       # Run tests in watch mode
npm run lint             # ESLint
```

## Architecture

```
app/api/interactions/route.ts  Slash command router + Ed25519 verification
app/api/admin/*/route.ts       Admin dashboard API routes
app/admin/*                    Admin dashboard pages (Next.js App Router)
lib/auth.ts                    NextAuth Discord OAuth (admin gating via ADMIN_USER_IDS)
src/gateway/index.ts           Gateway entry: discord.js client, event wiring, cron startup
src/gateway/mentionHandler.ts  Routes @mentions: image→tribute, keywords→status, else→AI
src/gateway/adminHandler.ts    Discord admin commands (!agent, !workflow, !assign)
src/gateway/fridayCron.ts      Friday auto-tribute cron (random 15:00-18:00 Stockholm time)
src/gateway/eventScheduler.ts  Cron manager for DB-configured scheduled events
src/gateway/retentionJob.ts    Hourly DB cleanup (purge old messages, thread items, runs)
src/drink-questions.ts         Core AI handler: OpenRouter calls, tool-call loop, image analysis
src/db.ts                      All raw SQL queries (PostgreSQL via postgresjs, no ORM)
src/personality.ts             Persona definitions, SAFETY_GUARDRAILS, emoji constants
src/tribute-tracker.ts         Facade over db.ts for tribute formatting/leaderboards
src/formatters.ts              Personal stats and leaderboard rendering
src/models.ts                  AI model registry (50+ models with pricing & capabilities)
src/types.ts                   Discord interaction types
```

### Services (`src/services/`)

| File | Purpose |
|---|---|
| `agents.ts` | Multi-agent system: DB-driven per-channel AI persona config (agents + workflows + thread binding). Composes system prompts with layered guardrails. |
| `threads.ts` | ChatKit-style thread/run/thread_items management for conversation persistence |
| `contextBuilder.ts` | "Best N" message selection algorithm for LLM context windows |
| `summarizer.ts` | Rolling AI-based summarization of old thread items |
| `messageIngestor.ts` | Writes all Discord messages to DB for context building |
| `conversationContext.ts` | Legacy in-memory context cache (fallback to ChatKit threads) |
| `eventExecutor.ts` | Executes scheduled event types (tribute_reminder, ai_prompt, status_report, custom_message, channel_summary) |
| `tools.ts` | OpenAI-compatible tool definitions with capability-gated access per agent |
| `agentKnowledge.ts` | Persistent fact storage per agent — AI can remember/recall facts across conversations |
| `userMemory.ts` | Per-user conversation memory summaries — auto-updated every 5 messages, injected into prompts |

### Multi-Agent System

The core architecture is **Agent → Workflow → Thread**:

- **Agent**: Persona definition (system prompt, model, temperature, capabilities)
- **Workflow**: Links an agent to a context policy (how many messages, summary usage, etc.)
- **Thread**: Bound to a workflow, represents a Discord channel's conversation state

`resolveConfigWithDefaults(threadId)` resolves the full config per channel with fallback chain: thread-specific → default workflow → hardcoded safety-only.

`composeSystemPrompt()` builds prompts in layers:
```
SAFETY_GUARDRAILS (hardcoded, always first — never overridden)
  + agent.systemPrompt (full persona from DB)
  + agent.customInstructions (agent-level tweaks)
  + workflow.contextPolicy.customInstructions (channel-level tweaks)
```

### Capability Gating

Each agent has a `capabilities` JSONB array that gates which tools and features it can use:

| Capability | What it gates |
|---|---|
| `image_analysis` | Image → tribute scoring, AI image descriptions |
| `tribute_tracking` | `/tribute`, `/tally`, `/demand` slash commands, @mention scoring |
| `web_search` | OpenRouter `:online` model suffix for real-time web access |
| `scheduled_messages` | CRUD tools for scheduled events |
| `knowledge` | `remember_fact` / `recall_facts` AI tools |
| `random_facts` | `/drink random` slash command |

### Memory Systems

1. **Thread Items + Rolling Summary** (primary): Recent messages stored as `thread_items`, older ones compressed into `thread.summary` via AI summarization. Configurable per workflow via `contextPolicy`.
2. **User Memory** (`user_memories` table): Per-user, per-channel AI-generated personality summaries. Auto-updates every 5 new messages. Injected into system prompt with prompt-injection guardrails.
3. **Agent Knowledge** (`agent_knowledge` table): Persistent facts per agent. Agents with `knowledge` capability can remember/recall facts. Up to 20 recent facts auto-injected into context.
4. **Message Ingestion** (`discord_messages_recent` table): All Discord messages written for context building. Cleaned up by retention job.

### Data Flow

```
Discord Event → Gateway/Next.js Handler → Service Layer → OpenRouter AI → Discord Response
                                                ↕
                                          Railway Postgres (db.ts)
```

## Key Patterns

- **Dual entry points**: Slash commands via Next.js HTTP webhook; @mentions/DMs via discord.js Gateway. They share the same service layer but run independently.
- **AI Provider**: OpenRouter only (`openai` npm package pointed at `https://openrouter.ai/api/v1`). Default model: `google/gemini-2.5-flash-lite`.
- **Database**: Railway Postgres via `postgresjs` with raw SQL tagged template literals (`sql\`...\``). No ORM. Tables auto-created in `initializeDatabase()`. For JSONB columns, always use `sql.json()` (via the `jsonb()` helper) — never `JSON.stringify() + ::jsonb` cast (causes double-serialization).
- **Safety guardrails**: `SAFETY_GUARDRAILS` in `personality.ts` is always prepended to every AI system prompt — never overridden by DB agent config. Enforced in `agents.ts:composeSystemPrompt()`.
- **Idempotency**: Message ingestion uses `ON CONFLICT DO NOTHING/UPDATE`; `hasProcessedTrigger()` prevents duplicate AI runs; thread items check `source_message_id`.
- **Thread IDs**: Format is `discord:{guildId}:{channelId}` for guild channels, `discord:dm:{channelId}` for DMs.
- **Tool calling**: AI can call tools (channel lookup, event scheduling, knowledge CRUD) via an OpenAI-compatible tool-call loop with max 5 iterations.
- **Tribute scoring**: TIKI=10, COCKTAIL=5, BEER_WINE=2, OTHER=1 (categorized by AI image analysis).

## Admin Dashboard

Web dashboard at `/admin` for managing the bot. Protected by Discord OAuth — only users in `ADMIN_USER_IDS` can access.

| Route | Purpose |
|---|---|
| `/admin` | Overview stats (agents, channels, tributes, events) |
| `/admin/agents` | Create/edit AI agent personas (model, prompt, capabilities) |
| `/admin/workflows` | Create/edit workflows (agent + context policy) |
| `/admin/channels` | Assign workflows to Discord channels |
| `/admin/knowledge` | Browse/search/delete agent knowledge facts |
| `/admin/memories` | Browse user memory summaries |
| `/admin/conversations` | Browse conversation history, thread summaries, recent messages |
| `/admin/events` | Manage scheduled cron events (create/edit/pause/delete) |
| `/admin/diagnostics` | Run system health checks and end-to-end AI feature tests |

### Admin API Routes (`app/api/admin/`)

`agents`, `agents/[id]`, `workflows`, `workflows/[id]`, `channels`, `channels/[threadId]`, `events`, `knowledge`, `memories`, `diagnostics`, `models`, `stats`, `auth/[...nextauth]`

## Testing

### Unit Tests (Vitest)

178 unit tests across 9 files in `tests/`, covering pure functions that don't need DB/API:

| File | What it covers |
|---|---|
| `agents.test.ts` | System prompt composition, capability constants, context policy defaults |
| `context-builder.test.ts` | Message normalization, selection algorithm, transcript formatting, length budgeting |
| `drink-questions.test.ts` | Tribute scores, drink list output |
| `formatters.test.ts` | Personal stats and leaderboard rendering |
| `mention-handler.test.ts` | Mention routing logic |
| `models.test.ts` | Model registry integrity, required fields, unique IDs |
| `personality.test.ts` | Safety guardrails text, emoji format, phrase helpers |
| `tools.test.ts` | Capability gating: correct tools for each capability set |
| `user-memory.test.ts` | User memory functionality |

Run with `npm test`. The DB warning (`DATABASE_URL not set`) in stderr is expected and harmless.

**When adding new features**: Add tests for any new pure functions or capability gating changes.

### Diagnostics (Admin Dashboard)

Live end-to-end testing at `/admin/diagnostics`. Runs against real services (DB, Discord, OpenRouter). Tests system health, agent resolution, AI responses, tool calling, web search, image analysis, knowledge CRUD, event CRUD, message ingestion stats, user memory stats, and capability gating.

## Database Schema

**Core**: `tributes`, `discord_messages_recent` (4h TTL)
**ChatKit**: `threads`, `thread_items`, `runs`
**Config**: `agents`, `workflows`, `scheduled_events`
**Memory**: `user_memories`, `agent_knowledge`

All tables auto-created by `initializeDatabase()` in `db.ts`.

## Environment Variables

Required: `DISCORD_APP_ID`, `DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY`, `OPENROUTER_API_KEY`, `DATABASE_URL`
Dashboard: `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `ADMIN_USER_IDS`
Optional: `DISCORD_GUILD_ID` (dev), `PARTY_CHANNEL_ID` (Friday cron target), `POST_DEMAND_ON_STARTUP`

See `.env.example` for full reference.

## TypeScript Configuration

- `tsconfig.json`: Next.js config (module: esnext, moduleResolution: bundler, jsx: preserve). Includes app/, src/, lib/, scripts/
- `tsconfig.gateway.json`: Gateway-only build (overrides to commonjs/node, outputs to dist/). Used by Railway
- Target: ES2020, strict mode, Node >= 20.9.0 required
