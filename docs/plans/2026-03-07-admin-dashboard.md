# Admin Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a web admin dashboard for managing Mutumbot agents, workflows, channel assignments, knowledge, and user memories.

**Architecture:** Convert the existing Vercel serverless project to Next.js App Router. The Discord webhook migrates to `app/api/interactions/route.ts`. Dashboard pages live under `app/admin/` with API routes under `app/api/admin/`. Auth via NextAuth.js + Discord OAuth, gated by `ADMIN_USER_IDS`. Gateway bot code in `src/` is untouched — Railway still builds with `tsconfig.gateway.json`.

**Tech Stack:** Next.js 15, React 19, Tailwind CSS 4, NextAuth.js 5, existing postgresjs + service layer.

---

### Task 1: Install Dependencies & Configure Next.js

**Files:**
- Modify: `package.json`
- Create: `next.config.js`
- Create: `postcss.config.js`
- Create: `tailwind.config.ts`
- Modify: `tsconfig.json`
- Create: `tsconfig.gateway.json` (update rootDir)
- Modify: `vercel.json`
- Modify: `.gitignore`
- Modify: `.env.example`

**Step 1: Install Next.js, React, Tailwind, NextAuth**

```bash
npm install next react react-dom next-auth@beta @auth/core
npm install -D tailwindcss @tailwindcss/postcss postcss autoprefixer
```

**Step 2: Create `next.config.js`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Exclude gateway code from Next.js build
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push('discord.js');
    }
    return config;
  },
  // Keep the existing serverless function behavior
  experimental: {
    serverComponentsExternalPackages: ['postgres'],
  },
};

module.exports = nextConfig;
```

**Step 3: Create `postcss.config.js`**

```js
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
```

**Step 4: Create `tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};

export default config;
```

**Step 5: Update `tsconfig.json` for Next.js**

Add Next.js-required settings while keeping compatibility with the existing service layer. The gateway tsconfig extends this so it stays isolated.

Key changes:
- Add `"jsx": "preserve"`
- Add `"lib": ["ES2020", "DOM", "DOM.Iterable"]`
- Add `"plugins": [{ "name": "next" }]`
- Add `"paths": { "@/*": ["./*"] }`
- Add `"app/**/*"` to include
- Set `"module": "esnext"` and `"moduleResolution": "bundler"` (Next.js requirement)

The gateway tsconfig already overrides `module` to `commonjs` via `extends`, so this doesn't break Railway.

**Step 6: Update `tsconfig.gateway.json`**

Override the module settings back to CommonJS for the gateway build:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "commonjs",
    "moduleResolution": "node",
    "jsx": "react",
    "plugins": []
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "api", "scripts", "app"]
}
```

**Step 7: Update `vercel.json`**

Replace with Next.js framework detection (remove version 2 config):

```json
{
  "framework": "nextjs"
}
```

**Step 8: Update `.gitignore`**

Add: `.next/`

**Step 9: Update `.env.example`**

Add new env vars:
```
# Admin Dashboard (NextAuth Discord OAuth)
NEXTAUTH_SECRET=
NEXTAUTH_URL=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
ADMIN_USER_IDS=
```

**Step 10: Update `package.json` scripts**

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "register": "ts-node --compiler-options '{\"module\":\"CommonJS\"}' scripts/register-commands.ts",
  "gateway": "npx ts-node src/gateway/index.ts",
  "gateway:build": "tsc --project tsconfig.gateway.json",
  "gateway:start": "node dist/gateway/index.js",
  "lint": "eslint ."
}
```

**Step 11: Verify gateway build still works**

```bash
npm run gateway:build
```

Expected: Compiles with no errors.

**Step 12: Commit**

```bash
git add -A
git commit -m "Configure Next.js, Tailwind, and NextAuth for admin dashboard"
```

---

### Task 2: Migrate Discord Webhook to Next.js Route

**Files:**
- Create: `app/api/interactions/route.ts`
- Delete: `api/interactions.ts` (after migration)

**Step 1: Create the Next.js route handler**

Migrate `api/interactions.ts` to `app/api/interactions/route.ts`. The logic is identical — only the handler signature changes from Vercel's `(req: VercelRequest, res: VercelResponse)` to Next.js `(request: NextRequest) => NextResponse`.

Key changes:
- Import `NextRequest`, `NextResponse` from `next/server`
- Remove `@vercel/node` types
- Export `POST` function instead of `default`
- Use `request.json()` instead of `req.body`
- Use `request.headers.get()` instead of `req.headers[]`
- Return `NextResponse.json()` instead of `res.json()`
- Keep the deferred response pattern (webhook edit via fetch)

**Step 2: Delete old `api/interactions.ts`**

Remove the file — Next.js uses `app/api/` now.

**Step 3: Verify locally**

```bash
npm run build
```

Expected: Builds successfully, `/api/interactions` route is registered.

**Step 4: Commit**

```bash
git add -A
git commit -m "Migrate Discord webhook to Next.js App Router"
```

---

### Task 3: Set Up NextAuth + Discord OAuth

**Files:**
- Create: `app/api/auth/[...nextauth]/route.ts`
- Create: `lib/auth.ts`
- Create: `middleware.ts`

**Step 1: Create `lib/auth.ts`**

NextAuth config with Discord provider. Checks `ADMIN_USER_IDS` in the `signIn` callback — rejects non-admins. Stores Discord user ID in the session JWT.

**Step 2: Create `app/api/auth/[...nextauth]/route.ts`**

Thin re-export of the NextAuth handler from `lib/auth.ts`.

**Step 3: Create `middleware.ts`**

Protect all `/admin/*` routes. Redirect unauthenticated users to the sign-in page. Uses NextAuth's `auth()` middleware helper.

**Step 4: Verify locally**

```bash
npm run dev
# Visit http://localhost:3000/admin — should redirect to Discord OAuth
```

**Step 5: Commit**

```bash
git add -A
git commit -m "Add NextAuth Discord OAuth with admin gating"
```

---

### Task 4: Dashboard Layout & Overview Page

**Files:**
- Create: `app/globals.css`
- Create: `app/layout.tsx`
- Create: `app/admin/layout.tsx`
- Create: `app/admin/page.tsx`
- Create: `app/admin/components/Sidebar.tsx`
- Create: `app/admin/components/StatCard.tsx`

**Step 1: Create `app/globals.css`**

```css
@import "tailwindcss";
```

**Step 2: Create `app/layout.tsx`**

Root layout with html/body tags, global CSS import.

**Step 3: Create `app/admin/layout.tsx`**

Admin shell with sidebar navigation. Links to: Overview, Agents, Workflows, Channels, Knowledge, Memories. Shows logged-in user and sign-out button.

**Step 4: Create `app/admin/components/Sidebar.tsx`**

Client component for nav with active state highlighting.

**Step 5: Create `app/admin/components/StatCard.tsx`**

Reusable stat display card (title + number + optional subtitle).

**Step 6: Create `app/admin/page.tsx`**

Overview page — server component that queries DB for counts:
- Total agents (active)
- Total workflows
- Total channel assignments (threads with workflow_id set)
- Total knowledge facts
- Total user memories

Uses `sql` directly from `src/db.ts`.

**Step 7: Verify locally**

```bash
npm run dev
# Visit http://localhost:3000/admin — should show dashboard with stats
```

**Step 8: Commit**

```bash
git add -A
git commit -m "Add admin dashboard layout and overview page"
```

---

### Task 5: Admin API Routes

**Files:**
- Create: `app/api/admin/agents/route.ts` (GET, POST)
- Create: `app/api/admin/agents/[id]/route.ts` (GET, PUT, DELETE)
- Create: `app/api/admin/workflows/route.ts` (GET, POST)
- Create: `app/api/admin/workflows/[id]/route.ts` (GET, PUT)
- Create: `app/api/admin/channels/route.ts` (GET, POST)
- Create: `app/api/admin/knowledge/route.ts` (GET, DELETE)
- Create: `app/api/admin/memories/route.ts` (GET)
- Create: `app/api/admin/stats/route.ts` (GET)

Each route:
- Checks auth via NextAuth `getServerSession()`
- Delegates to existing service layer functions
- Returns JSON responses

**Agents API:**
- `GET /api/admin/agents` → `getAgents()`
- `POST /api/admin/agents` → `createAgent(name, options)`
- `GET /api/admin/agents/[id]` → `getAgent(id)`
- `PUT /api/admin/agents/[id]` → `updateAgent(id, updates)`

**Workflows API:**
- `GET /api/admin/workflows` → `getWorkflows()`
- `POST /api/admin/workflows` → `createWorkflow(name, agentId, options)`
- `GET /api/admin/workflows/[id]` → `getWorkflow(id)`
- `PUT /api/admin/workflows/[id]` → `updateWorkflow(id, updates)`

**Channels API:**
- `GET /api/admin/channels` → query `threads` table where `workflow_id IS NOT NULL`
- `POST /api/admin/channels` → `assignWorkflowToThread(threadId, workflowId, { resetHistory })`

**Knowledge API:**
- `GET /api/admin/knowledge?agentId=&subject=&category=&search=` → `recallFacts(agentId, options)`
- `DELETE /api/admin/knowledge?id=` → `deleteFact(id)`

**Memories API:**
- `GET /api/admin/memories?userId=` → query `user_memories` table

**Stats API:**
- `GET /api/admin/stats` → aggregate counts for overview

**Step 1: Implement all API routes**

Each is a thin auth-checked wrapper around existing service functions.

**Step 2: Verify**

```bash
npm run build
```

**Step 3: Commit**

```bash
git add -A
git commit -m "Add admin API routes for agents, workflows, channels, knowledge, memories"
```

---

### Task 6: Agents Management Page

**Files:**
- Create: `app/admin/agents/page.tsx`
- Create: `app/admin/agents/[id]/page.tsx`
- Create: `app/admin/components/AgentForm.tsx`

**Features:**
- List all agents with name, model, capabilities, default badge
- Click agent to edit: system prompt (textarea), model (input), temperature (slider), capabilities (checkboxes), custom instructions (textarea)
- "Create Agent" button opens form
- Save/delete buttons

**Commit:**

```bash
git add -A
git commit -m "Add agents management page"
```

---

### Task 7: Workflows Management Page

**Files:**
- Create: `app/admin/workflows/page.tsx`
- Create: `app/admin/workflows/[id]/page.tsx`
- Create: `app/admin/components/WorkflowForm.tsx`

**Features:**
- List workflows with name, linked agent, context policy summary
- Click to edit: name, agent (dropdown), context policy fields (recentMessages, maxAgeHours, useSummary, maxTranscriptChars, includeTributeContext, customInstructions)
- "Create Workflow" button

**Commit:**

```bash
git add -A
git commit -m "Add workflows management page"
```

---

### Task 8: Channel Assignments Page

**Files:**
- Create: `app/admin/channels/page.tsx`
- Create: `app/admin/components/ChannelAssignForm.tsx`

**Features:**
- List channels that have workflow assignments (thread_id, workflow name, agent name)
- For each: dropdown to change workflow, "Reset History" checkbox, Save button
- "Assign Channel" form: thread ID input, workflow dropdown

**Commit:**

```bash
git add -A
git commit -m "Add channel assignments page"
```

---

### Task 9: Knowledge Browser Page

**Files:**
- Create: `app/admin/knowledge/page.tsx`

**Features:**
- Dropdown to select agent
- Search box (free text)
- Filter by category
- Table of facts: subject, category, fact text, date, delete button
- Pagination or "load more"

**Commit:**

```bash
git add -A
git commit -m "Add knowledge browser page"
```

---

### Task 10: User Memories Page

**Files:**
- Create: `app/admin/memories/page.tsx`

**Features:**
- List all user memories: user ID, channel ID, summary preview, message count, last updated
- Click to expand full summary
- Search by user ID

**Commit:**

```bash
git add -A
git commit -m "Add user memories page"
```

---

### Task 11: Final Verification & Deploy

**Step 1: Full build**

```bash
npm run gateway:build  # Gateway still compiles
npm run build          # Next.js builds
npm run lint           # No new errors
```

**Step 2: Test Discord webhook still works**

The `/api/interactions` endpoint must still respond to Discord's verification ping.

**Step 3: Update CLAUDE.md**

Add dashboard section documenting the new pages and env vars.

**Step 4: Push to deploy**

```bash
git push
```

Vercel auto-deploys the Next.js dashboard. Railway auto-deploys the gateway (unaffected).

**Step 5: Configure env vars**

In Vercel dashboard, add:
- `NEXTAUTH_SECRET` (generate with `openssl rand -base64 32`)
- `NEXTAUTH_URL` (e.g., `https://mutumbot.vercel.app`)
- `DISCORD_CLIENT_ID` (from Discord Developer Portal → OAuth2)
- `DISCORD_CLIENT_SECRET` (from Discord Developer Portal → OAuth2)
- `ADMIN_USER_IDS` (same as Railway)

In Discord Developer Portal → OAuth2 → Redirects, add:
- `https://mutumbot.vercel.app/api/auth/callback/discord`

**Step 6: Final commit**

```bash
git add -A
git commit -m "Admin dashboard complete: agents, workflows, channels, knowledge, memories"
```
