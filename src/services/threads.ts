/**
 * Threads Service
 *
 * ChatKit-style thread management for conversation sessions.
 * Provides:
 * - Explicit thread_id format: discord:{guild_id}:{channel_id} or discord:dm:{channel_id}
 * - Thread state variables (permissions, workflow flags, etc.)
 * - Rolling summary for continuity beyond TTL
 * - First-class thread_items storage for full transcript logging
 */

import { sql } from '../db';

// ============ TYPES ============

export type ThreadItemType =
  | 'user_message'
  | 'assistant_message'
  | 'tool_call'
  | 'tool_result'
  | 'system_event';

export type ThreadItemRole = 'user' | 'assistant' | 'system';

export interface ThreadItem {
  id: string;
  threadId: string;
  createdAt: Date;
  type: ThreadItemType;
  role: ThreadItemRole | null;
  authorId: string | null;
  authorName: string | null;
  content: string;
  metadata: ThreadItemMetadata;
  sourceMessageId: string | null;
}

export interface ThreadItemMetadata {
  // Discord-specific
  discordMessageId?: string;
  discordChannelId?: string;
  discordGuildId?: string;
  attachments?: Array<{
    id: string;
    name: string;
    contentType: string | null;
    url: string;
    isImage: boolean;
  }>;
  replyToMessageId?: string;
  mentionsBot?: boolean;
  hasImage?: boolean;

  // AI/LLM specific
  model?: string;
  provider?: string;
  tokenCount?: number;
  finishReason?: string;

  // Run tracking
  runId?: string;

  // Tool calls
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;

  // General
  [key: string]: unknown;
}

export interface ThreadState {
  // Workflow/policy flags
  department?: string;
  tenant?: string;
  locale?: string;
  allowedTools?: string[];
  policyFlags?: Record<string, boolean>;

  // User context
  primaryUserId?: string;
  primaryUsername?: string;

  // Discord context
  guildId?: string | null;
  isDm?: boolean;

  // Custom state
  [key: string]: unknown;
}

export interface Thread {
  threadId: string;
  state: ThreadState;
  summary: string | null;
  summaryUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RunStatus {
  runId: string;
  threadId: string;
  triggerItemId: string | null;
  status: 'started' | 'succeeded' | 'failed';
  provider: string | null;
  model: string | null;
  requestPayload: unknown | null;
  responsePayload: unknown | null;
  error: string | null;
  selectedItemIds: string[] | null;
  tokenEstimate: number | null;
  createdAt: Date;
  completedAt: Date | null;
}

// ============ THREAD ID GENERATION ============

/**
 * Generate a ChatKit-style thread ID from Discord context
 *
 * Format:
 * - Server channels: discord:{guild_id}:{channel_id}
 * - DMs: discord:dm:{channel_id}
 */
export function generateThreadId(channelId: string, guildId: string | null): string {
  if (guildId) {
    return `discord:${guildId}:${channelId}`;
  }
  return `discord:dm:${channelId}`;
}

/**
 * Parse a thread ID back into its components
 */
export function parseThreadId(threadId: string): {
  platform: string;
  guildId: string | null;
  channelId: string;
  isDm: boolean;
} {
  const parts = threadId.split(':');
  if (parts.length < 3) {
    throw new Error(`Invalid thread ID format: ${threadId}`);
  }

  const platform = parts[0];

  if (parts[1] === 'dm') {
    return {
      platform,
      guildId: null,
      channelId: parts[2],
      isDm: true,
    };
  }

  return {
    platform,
    guildId: parts[1],
    channelId: parts[2],
    isDm: false,
  };
}

// ============ DATABASE INITIALIZATION ============

/**
 * Initialize ChatKit-style tables
 */
export async function initializeThreadTables(): Promise<void> {
  if (!sql) {
    console.error('[Threads] Database not available');
    return;
  }

  try {
    // Create threads table with state and summary
    await sql`
      CREATE TABLE IF NOT EXISTS threads (
        thread_id VARCHAR(255) PRIMARY KEY,
        state JSONB DEFAULT '{}',
        summary TEXT,
        summary_updated_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create thread_items table for first-class transcript storage
    await sql`
      CREATE TABLE IF NOT EXISTS thread_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        thread_id VARCHAR(255) NOT NULL REFERENCES threads(thread_id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        type VARCHAR(50) NOT NULL,
        role VARCHAR(20),
        author_id VARCHAR(255),
        author_name VARCHAR(255),
        content TEXT NOT NULL,
        metadata JSONB DEFAULT '{}',
        source_message_id VARCHAR(255),
        CONSTRAINT valid_type CHECK (type IN ('user_message', 'assistant_message', 'tool_call', 'tool_result', 'system_event'))
      )
    `;

    // Create runs table for idempotency and debugging
    await sql`
      CREATE TABLE IF NOT EXISTS runs (
        run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        thread_id VARCHAR(255) NOT NULL REFERENCES threads(thread_id) ON DELETE CASCADE,
        trigger_item_id UUID REFERENCES thread_items(id),
        status VARCHAR(20) NOT NULL DEFAULT 'started',
        provider VARCHAR(50),
        model VARCHAR(100),
        request_payload JSONB,
        response_payload JSONB,
        error TEXT,
        selected_item_ids UUID[],
        token_estimate INTEGER,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP WITH TIME ZONE,
        CONSTRAINT valid_status CHECK (status IN ('started', 'succeeded', 'failed'))
      )
    `;

    // Create indexes for efficient queries
    // Thread items: fetch by thread ordered by time
    await sql`CREATE INDEX IF NOT EXISTS idx_thread_items_thread_time ON thread_items(thread_id, created_at DESC)`;
    // Thread items: idempotency check by source message ID
    await sql`CREATE INDEX IF NOT EXISTS idx_thread_items_source ON thread_items(source_message_id) WHERE source_message_id IS NOT NULL`;
    // Thread items: filter by type
    await sql`CREATE INDEX IF NOT EXISTS idx_thread_items_type ON thread_items(thread_id, type)`;
    // Runs: by thread
    await sql`CREATE INDEX IF NOT EXISTS idx_runs_thread ON runs(thread_id, created_at DESC)`;
    // Runs: find pending runs
    await sql`CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status) WHERE status = 'started'`;

    console.log('[Threads] Tables initialized successfully');
  } catch (error) {
    console.error('[Threads] Failed to initialize tables:', error);
    throw error;
  }
}

// ============ THREAD OPERATIONS ============

/**
 * Get or create a thread
 */
export async function getOrCreateThread(
  channelId: string,
  guildId: string | null,
  initialState?: Partial<ThreadState>
): Promise<Thread> {
  if (!sql) {
    throw new Error('Database not available');
  }

  const threadId = generateThreadId(channelId, guildId);

  const defaultState: ThreadState = {
    guildId,
    isDm: !guildId,
    ...initialState,
  };

  const result = await sql`
    INSERT INTO threads (thread_id, state)
    VALUES (${threadId}, ${JSON.stringify(defaultState)})
    ON CONFLICT (thread_id) DO UPDATE SET
      updated_at = CURRENT_TIMESTAMP
    RETURNING thread_id, state, summary, summary_updated_at, created_at, updated_at
  `;

  const row = result[0];
  return {
    threadId: row.thread_id as string,
    state: row.state as ThreadState,
    summary: row.summary as string | null,
    summaryUpdatedAt: row.summary_updated_at ? new Date(row.summary_updated_at as string) : null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

/**
 * Get a thread by ID
 */
export async function getThread(threadId: string): Promise<Thread | null> {
  if (!sql) return null;

  const result = await sql`
    SELECT thread_id, state, summary, summary_updated_at, created_at, updated_at
    FROM threads
    WHERE thread_id = ${threadId}
  `;

  if (result.length === 0) return null;

  const row = result[0];
  return {
    threadId: row.thread_id as string,
    state: row.state as ThreadState,
    summary: row.summary as string | null,
    summaryUpdatedAt: row.summary_updated_at ? new Date(row.summary_updated_at as string) : null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

/**
 * Update thread state
 */
export async function updateThreadState(
  threadId: string,
  stateUpdates: Partial<ThreadState>
): Promise<Thread | null> {
  if (!sql) return null;

  const result = await sql`
    UPDATE threads
    SET
      state = state || ${JSON.stringify(stateUpdates)}::jsonb,
      updated_at = CURRENT_TIMESTAMP
    WHERE thread_id = ${threadId}
    RETURNING thread_id, state, summary, summary_updated_at, created_at, updated_at
  `;

  if (result.length === 0) return null;

  const row = result[0];
  return {
    threadId: row.thread_id as string,
    state: row.state as ThreadState,
    summary: row.summary as string | null,
    summaryUpdatedAt: row.summary_updated_at ? new Date(row.summary_updated_at as string) : null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

/**
 * Update thread summary (for rolling summarization)
 */
export async function updateThreadSummary(
  threadId: string,
  summary: string
): Promise<void> {
  if (!sql) return;

  await sql`
    UPDATE threads
    SET
      summary = ${summary},
      summary_updated_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    WHERE thread_id = ${threadId}
  `;
}

// ============ THREAD ITEM OPERATIONS ============

/**
 * Add a thread item (idempotent via source_message_id)
 */
export async function addThreadItem(
  threadId: string,
  item: {
    type: ThreadItemType;
    role?: ThreadItemRole;
    authorId?: string;
    authorName?: string;
    content: string;
    metadata?: ThreadItemMetadata;
    sourceMessageId?: string;
  }
): Promise<ThreadItem> {
  if (!sql) {
    throw new Error('Database not available');
  }

  // Idempotency check: if sourceMessageId exists and we already have it, return existing
  if (item.sourceMessageId) {
    const existing = await sql`
      SELECT id, thread_id, created_at, type, role, author_id, author_name, content, metadata, source_message_id
      FROM thread_items
      WHERE source_message_id = ${item.sourceMessageId}
    `;

    if (existing.length > 0) {
      const row = existing[0];
      return {
        id: row.id as string,
        threadId: row.thread_id as string,
        createdAt: new Date(row.created_at as string),
        type: row.type as ThreadItemType,
        role: row.role as ThreadItemRole | null,
        authorId: row.author_id as string | null,
        authorName: row.author_name as string | null,
        content: row.content as string,
        metadata: row.metadata as ThreadItemMetadata,
        sourceMessageId: row.source_message_id as string | null,
      };
    }
  }

  const result = await sql`
    INSERT INTO thread_items (
      thread_id, type, role, author_id, author_name, content, metadata, source_message_id
    )
    VALUES (
      ${threadId},
      ${item.type},
      ${item.role || null},
      ${item.authorId || null},
      ${item.authorName || null},
      ${item.content},
      ${JSON.stringify(item.metadata || {})},
      ${item.sourceMessageId || null}
    )
    RETURNING id, thread_id, created_at, type, role, author_id, author_name, content, metadata, source_message_id
  `;

  const row = result[0];
  return {
    id: row.id as string,
    threadId: row.thread_id as string,
    createdAt: new Date(row.created_at as string),
    type: row.type as ThreadItemType,
    role: row.role as ThreadItemRole | null,
    authorId: row.author_id as string | null,
    authorName: row.author_name as string | null,
    content: row.content as string,
    metadata: row.metadata as ThreadItemMetadata,
    sourceMessageId: row.source_message_id as string | null,
  };
}

/**
 * Get recent thread items
 */
export async function getThreadItems(
  threadId: string,
  options: {
    limit?: number;
    types?: ThreadItemType[];
    afterId?: string;
  } = {}
): Promise<ThreadItem[]> {
  if (!sql) return [];

  const limit = options.limit || 50;

  let result;
  if (options.types && options.types.length > 0) {
    result = await sql`
      SELECT id, thread_id, created_at, type, role, author_id, author_name, content, metadata, source_message_id
      FROM thread_items
      WHERE thread_id = ${threadId}
        AND type = ANY(${options.types})
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  } else {
    result = await sql`
      SELECT id, thread_id, created_at, type, role, author_id, author_name, content, metadata, source_message_id
      FROM thread_items
      WHERE thread_id = ${threadId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  }

  return result.map(row => ({
    id: row.id as string,
    threadId: row.thread_id as string,
    createdAt: new Date(row.created_at as string),
    type: row.type as ThreadItemType,
    role: row.role as ThreadItemRole | null,
    authorId: row.author_id as string | null,
    authorName: row.author_name as string | null,
    content: row.content as string,
    metadata: row.metadata as ThreadItemMetadata,
    sourceMessageId: row.source_message_id as string | null,
  }));
}

/**
 * Get thread item count
 */
export async function getThreadItemCount(threadId: string): Promise<number> {
  if (!sql) return 0;

  const result = await sql`
    SELECT COUNT(*) as count FROM thread_items WHERE thread_id = ${threadId}
  `;

  return Number(result[0]?.count || 0);
}

/**
 * Check if a source message has already been processed
 */
export async function hasSourceMessage(sourceMessageId: string): Promise<boolean> {
  if (!sql) return false;

  const result = await sql`
    SELECT 1 FROM thread_items WHERE source_message_id = ${sourceMessageId} LIMIT 1
  `;

  return result.length > 0;
}

// ============ RUN OPERATIONS ============

/**
 * Start a new run (for idempotency and debugging)
 */
export async function startRun(
  threadId: string,
  options: {
    triggerItemId?: string;
    provider?: string;
    model?: string;
    selectedItemIds?: string[];
    tokenEstimate?: number;
  } = {}
): Promise<string> {
  if (!sql) {
    throw new Error('Database not available');
  }

  const result = await sql`
    INSERT INTO runs (
      thread_id, trigger_item_id, status, provider, model, selected_item_ids, token_estimate
    )
    VALUES (
      ${threadId},
      ${options.triggerItemId || null},
      'started',
      ${options.provider || null},
      ${options.model || null},
      ${options.selectedItemIds || null},
      ${options.tokenEstimate || null}
    )
    RETURNING run_id
  `;

  return result[0].run_id as string;
}

/**
 * Complete a run successfully
 */
export async function completeRun(
  runId: string,
  responsePayload?: unknown
): Promise<void> {
  if (!sql) return;

  await sql`
    UPDATE runs
    SET
      status = 'succeeded',
      response_payload = ${responsePayload ? JSON.stringify(responsePayload) : null},
      completed_at = CURRENT_TIMESTAMP
    WHERE run_id = ${runId}::uuid
  `;
}

/**
 * Mark a run as failed
 */
export async function failRun(
  runId: string,
  error: string
): Promise<void> {
  if (!sql) return;

  await sql`
    UPDATE runs
    SET
      status = 'failed',
      error = ${error},
      completed_at = CURRENT_TIMESTAMP
    WHERE run_id = ${runId}::uuid
  `;
}

/**
 * Get run by ID
 */
export async function getRun(runId: string): Promise<RunStatus | null> {
  if (!sql) return null;

  const result = await sql`
    SELECT run_id, thread_id, trigger_item_id, status, provider, model,
           request_payload, response_payload, error, selected_item_ids,
           token_estimate, created_at, completed_at
    FROM runs
    WHERE run_id = ${runId}::uuid
  `;

  if (result.length === 0) return null;

  const row = result[0];
  return {
    runId: row.run_id as string,
    threadId: row.thread_id as string,
    triggerItemId: row.trigger_item_id as string | null,
    status: row.status as 'started' | 'succeeded' | 'failed',
    provider: row.provider as string | null,
    model: row.model as string | null,
    requestPayload: row.request_payload,
    responsePayload: row.response_payload,
    error: row.error as string | null,
    selectedItemIds: row.selected_item_ids as string[] | null,
    tokenEstimate: row.token_estimate as number | null,
    createdAt: new Date(row.created_at as string),
    completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
  };
}

/**
 * Check if a trigger has already been processed (idempotency)
 */
export async function hasProcessedTrigger(sourceMessageId: string): Promise<boolean> {
  if (!sql) return false;

  // Check if we have a successful run for this trigger
  const result = await sql`
    SELECT 1 FROM runs r
    JOIN thread_items ti ON r.trigger_item_id = ti.id
    WHERE ti.source_message_id = ${sourceMessageId}
      AND r.status = 'succeeded'
    LIMIT 1
  `;

  return result.length > 0;
}

// ============ CLEANUP ============

/**
 * Purge old thread items (keep summary for continuity)
 */
export async function purgeOldThreadItems(ttlHours: number = 4): Promise<number> {
  if (!sql) return 0;

  const cutoff = new Date(Date.now() - ttlHours * 60 * 60 * 1000);

  const result = await sql`
    DELETE FROM thread_items
    WHERE created_at < ${cutoff.toISOString()}
    RETURNING id
  `;

  console.log(`[Threads] Purged ${result.length} thread items older than ${ttlHours}h`);
  return result.length;
}

/**
 * Purge old runs (keep for debugging)
 */
export async function purgeOldRuns(ttlHours: number = 24): Promise<number> {
  if (!sql) return 0;

  const cutoff = new Date(Date.now() - ttlHours * 60 * 60 * 1000);

  const result = await sql`
    DELETE FROM runs
    WHERE created_at < ${cutoff.toISOString()}
    RETURNING run_id
  `;

  console.log(`[Threads] Purged ${result.length} runs older than ${ttlHours}h`);
  return result.length;
}
