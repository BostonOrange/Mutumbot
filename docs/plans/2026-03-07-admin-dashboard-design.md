# Admin Dashboard Design

## Overview

Web dashboard for managing Mutumbot agents, workflows, channel assignments, knowledge, and user memories. Lives on the existing Vercel deployment, converting the project to Next.js.

## Stack

- **Framework:** Next.js App Router
- **UI:** React + Tailwind CSS
- **Auth:** NextAuth.js with Discord OAuth, gated by ADMIN_USER_IDS
- **Data:** Existing service layer (agents.ts, threads.ts, agentKnowledge.ts, userMemory.ts)
- **Deployment:** Same Vercel project (auto-deploys on push)

## Architecture

```
app/
  api/
    interactions/route.ts    — Discord webhook (migrated from api/interactions.ts)
    auth/[...nextauth]/route.ts — NextAuth Discord OAuth
    admin/
      agents/route.ts        — CRUD for agents
      workflows/route.ts     — CRUD for workflows
      channels/route.ts      — Channel assignment management
      knowledge/route.ts     — Agent knowledge facts
      memories/route.ts      — User memory summaries
  admin/
    page.tsx                 — Dashboard overview
    agents/page.tsx          — Agent list + edit
    workflows/page.tsx       — Workflow list + edit
    channels/page.tsx        — Channel assignments
    knowledge/page.tsx       — Fact browser
    memories/page.tsx        — User memory browser
    layout.tsx               — Sidebar nav, auth guard
  layout.tsx                 — Root layout
  middleware.ts              — Auth check for /admin/* routes
src/                         — Unchanged (gateway bot, service layer)
```

## Pages

| Route | Purpose | Data Source |
|-------|---------|-------------|
| /admin | Overview stats | agents, workflows, threads, agent_knowledge counts |
| /admin/agents | List/create/edit agents | getAgents(), createAgent(), updateAgent() |
| /admin/workflows | List/create/edit workflows | getWorkflows(), createWorkflow(), updateWorkflow() |
| /admin/channels | View/assign channel workflows | threads + workflows tables, assignWorkflowToThread() |
| /admin/knowledge | Browse/search/delete facts | recallFacts(), deleteFact() |
| /admin/memories | Browse user memories | user_memories table |

## Auth Flow

1. User visits /admin → middleware redirects to Discord OAuth
2. NextAuth exchanges code for Discord user info
3. Middleware checks user ID against ADMIN_USER_IDS env var
4. Non-admins see 403, admins proceed

## What Changes

- Project converts from bare Vercel functions to Next.js
- Discord webhook moves from `api/interactions.ts` to `app/api/interactions/route.ts`
- New dependencies: next, react, react-dom, tailwindcss, next-auth
- `tsconfig.json` updated for Next.js (gateway tsconfig stays separate)
- New env vars: NEXTAUTH_SECRET, NEXTAUTH_URL, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET

## What Doesn't Change

- Gateway bot (src/gateway/) — Railway deployment untouched
- Service layer (src/services/) — shared by both dashboard and gateway
- Database schema — no new tables needed
