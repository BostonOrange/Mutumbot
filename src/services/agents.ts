/**
 * Agents & Workflows Service
 *
 * Agent Builder-style dynamic configuration for per-channel customization.
 *
 * Architecture:
 * - SAFETY_GUARDRAILS always prepended (hardcoded, cannot be overridden)
 * - Agents define full system prompts (persona, behavior, instructions)
 * - Agents define allowed capabilities (what features the bot can use)
 * - Workflows define context policies (how many messages, use summary, etc.)
 * - Threads bind to workflows for per-channel behavior
 *
 * Everything except safety rules is configurable via the database.
 */

import { neon, neonConfig } from '@neondatabase/serverless';
import { SAFETY_GUARDRAILS, DEFAULT_MUTUMBOT_PERSONA } from '../personality';

neonConfig.fetchConnectionCache = true;

const DATABASE_URL = process.env.DATABASE_URL;
const sql = DATABASE_URL ? neon(DATABASE_URL) : null;

// ============ TYPES ============

export interface Agent {
  id: string;
  name: string;
  description: string | null;
  /**
   * Full system prompt for this agent (persona, behavior, instructions).
   * SAFETY_GUARDRAILS are always prepended automatically.
   */
  systemPrompt: string | null;
  /**
   * Custom instructions added after the system prompt.
   * Use for channel-specific tweaks without rewriting the whole persona.
   */
  customInstructions: string | null;
  /**
   * Capabilities this agent is allowed to use.
   * Examples: 'image_analysis', 'web_search', 'tribute_tracking'
   */
  capabilities: string[];
  /** Model to use (e.g., 'google/gemini-2.5-flash-lite') */
  model: string;
  /** Model parameters */
  params: AgentParams;
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentParams {
  /** Creativity/randomness (0-2, default 0.7) */
  temperature?: number;
  /** Nucleus sampling threshold (0-1, default 0.9) */
  topP?: number;
  /** Maximum response tokens */
  maxTokens?: number;
  /** Penalize repeated tokens (-2 to 2) */
  frequencyPenalty?: number;
  /** Penalize tokens already in context (-2 to 2) */
  presencePenalty?: number;
  /** Stop sequences - response ends when these are generated */
  stop?: string[];
  /** Allow extensibility */
  [key: string]: unknown;
}

/**
 * Available capabilities that can be assigned to agents.
 * These control what features the agent is allowed to use.
 */
export const AVAILABLE_CAPABILITIES = {
  // Core capabilities
  IMAGE_ANALYSIS: 'image_analysis',       // Analyze images (tributes, etc.)
  TRIBUTE_TRACKING: 'tribute_tracking',   // Track and score tributes
  WEB_SEARCH: 'web_search',               // Search the web (future)

  // Content generation
  SCHEDULED_MESSAGES: 'scheduled_messages', // Can be triggered by cron jobs
  RANDOM_FACTS: 'random_facts',           // Generate random facts

  // Moderation
  CONTENT_MODERATION: 'content_moderation', // Flag inappropriate content

  // Integration
  EXTERNAL_API: 'external_api',           // Call external APIs (future)
} as const;

export type Capability = typeof AVAILABLE_CAPABILITIES[keyof typeof AVAILABLE_CAPABILITIES];

// ============ SCHEDULED EVENTS ============

/**
 * Event types that can be scheduled
 */
export const EVENT_TYPES = {
  TRIBUTE_REMINDER: 'tribute_reminder',     // Remind about Friday tributes
  CUSTOM_MESSAGE: 'custom_message',         // Send a custom message using agent persona
  STATUS_REPORT: 'status_report',           // Post stats/leaderboard
  AI_PROMPT: 'ai_prompt',                   // Ask AI to generate and post something
  CHANNEL_SUMMARY: 'channel_summary',       // Summarize recent channel activity
} as const;

export type EventType = typeof EVENT_TYPES[keyof typeof EVENT_TYPES];

/**
 * Scheduled event - cron job tied to a specific channel
 */
export interface ScheduledEvent {
  id: string;
  name: string;
  description: string | null;
  /** Target thread/channel (discord:guild:channel format) */
  threadId: string;
  /** Cron expression (e.g., "0 17 * * 5" for Friday 5pm) */
  cronExpression: string;
  /** Type of event to trigger */
  eventType: EventType;
  /** Event-specific payload */
  payload: ScheduledEventPayload;
  /** Whether this event is active */
  isActive: boolean;
  /** Timezone for cron (default: UTC) */
  timezone: string;
  /** Last successful run */
  lastRunAt: Date | null;
  /** Last run status */
  lastRunStatus: 'success' | 'failed' | null;
  /** Error message from last failure */
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Payload types for different event types
 */
export interface ScheduledEventPayload {
  /** For CUSTOM_MESSAGE: the message template */
  message?: string;
  /** For AI_PROMPT: the prompt to send to AI */
  prompt?: string;
  /** For STATUS_REPORT: what stats to include */
  includeLeaderboard?: boolean;
  includeTributeCount?: boolean;
  /** Whether to mention @everyone or a role */
  mentionRole?: string;
  /** Any additional data */
  [key: string]: unknown;
}

export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  agentId: string;
  /** Context building policy */
  contextPolicy: ContextPolicy;
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContextPolicy {
  /** Number of recent messages to include verbatim */
  recentMessages: number;
  /** Maximum age of messages to consider (hours) */
  maxAgeHours: number;
  /** Whether to include rolling summary */
  useSummary: boolean;
  /** Maximum transcript characters */
  maxTranscriptChars: number;
  /** Whether to include tribute/stats context */
  includeTributeContext: boolean;
  /** Custom instructions for this workflow */
  customInstructions?: string;
}

export interface ResolvedConfig {
  agent: Agent;
  workflow: Workflow;
  /** Final system prompt = SAFETY_GUARDRAILS + agent.systemPrompt + customInstructions */
  systemPrompt: string;
  contextPolicy: ContextPolicy;
}

// ============ DEFAULT VALUES ============

const DEFAULT_AGENT_PARAMS: AgentParams = {
  temperature: 0.7,
  topP: 0.9,
};

const DEFAULT_CONTEXT_POLICY: ContextPolicy = {
  recentMessages: 15,
  maxAgeHours: 4,
  useSummary: true,
  maxTranscriptChars: 8000,
  includeTributeContext: true,
};

const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';

// ============ DATABASE INITIALIZATION ============

/**
 * Initialize agents and workflows tables
 */
export async function initializeAgentTables(): Promise<void> {
  if (!sql) {
    console.error('[Agents] Database not available');
    return;
  }

  try {
    // Create agents table
    await sql`
      CREATE TABLE IF NOT EXISTS agents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        description TEXT,
        system_prompt TEXT,
        custom_instructions TEXT,
        capabilities JSONB DEFAULT '[]',
        model VARCHAR(100) DEFAULT 'google/gemini-2.5-flash-lite',
        params JSONB DEFAULT '{"temperature": 0.7}',
        is_default BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Migration: Add new columns if they don't exist (for existing tables)
    await sql`
      DO $$
      BEGIN
        -- Add system_prompt if not exists
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'agents' AND column_name = 'system_prompt'
        ) THEN
          ALTER TABLE agents ADD COLUMN system_prompt TEXT;
          -- Migrate data from old column if it exists
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'agents' AND column_name = 'system_prompt_overlay'
          ) THEN
            UPDATE agents SET system_prompt = system_prompt_overlay;
          END IF;
        END IF;

        -- Add custom_instructions if not exists
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'agents' AND column_name = 'custom_instructions'
        ) THEN
          ALTER TABLE agents ADD COLUMN custom_instructions TEXT;
        END IF;

        -- Add capabilities if not exists
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'agents' AND column_name = 'capabilities'
        ) THEN
          ALTER TABLE agents ADD COLUMN capabilities JSONB DEFAULT '[]';
        END IF;
      END $$;
    `;

    // Create workflows table
    await sql`
      CREATE TABLE IF NOT EXISTS workflows (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        description TEXT,
        agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
        context_policy JSONB DEFAULT '${JSON.stringify(DEFAULT_CONTEXT_POLICY)}',
        is_default BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Add workflow_id to threads table if not exists
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'threads' AND column_name = 'workflow_id'
        ) THEN
          ALTER TABLE threads ADD COLUMN workflow_id UUID REFERENCES workflows(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `;

    // Create indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_agents_default ON agents(is_default) WHERE is_default = TRUE`;
    await sql`CREATE INDEX IF NOT EXISTS idx_workflows_default ON workflows(is_default) WHERE is_default = TRUE`;
    await sql`CREATE INDEX IF NOT EXISTS idx_workflows_agent ON workflows(agent_id)`;

    // Create scheduled_events table for channel-specific cron jobs
    await sql`
      CREATE TABLE IF NOT EXISTS scheduled_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        description TEXT,
        thread_id VARCHAR(200) NOT NULL,
        cron_expression VARCHAR(100) NOT NULL,
        event_type VARCHAR(50) NOT NULL,
        payload JSONB DEFAULT '{}',
        timezone VARCHAR(50) DEFAULT 'UTC',
        is_active BOOLEAN DEFAULT TRUE,
        last_run_at TIMESTAMP WITH TIME ZONE,
        last_run_status VARCHAR(20),
        last_error TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create indexes for scheduled_events
    await sql`CREATE INDEX IF NOT EXISTS idx_scheduled_events_active ON scheduled_events(is_active) WHERE is_active = TRUE`;
    await sql`CREATE INDEX IF NOT EXISTS idx_scheduled_events_thread ON scheduled_events(thread_id)`;

    console.log('[Agents] Tables initialized successfully');

    // Ensure default agent and workflow exist
    await ensureDefaults();
  } catch (error) {
    console.error('[Agents] Failed to initialize tables:', error);
    throw error;
  }
}

/**
 * Ensure default agent and workflow exist
 */
async function ensureDefaults(): Promise<void> {
  if (!sql) return;

  // Check if default agent exists
  const existingAgent = await sql`
    SELECT id FROM agents WHERE is_default = TRUE LIMIT 1
  `;

  let defaultAgentId: string;

  if (existingAgent.length === 0) {
    // Create default agent with the tiki persona (stored in DB, not hardcoded)
    const defaultCapabilities = ['image_analysis', 'tribute_tracking', 'scheduled_messages'];
    const result = await sql`
      INSERT INTO agents (name, description, system_prompt, custom_instructions, capabilities, model, params, is_default)
      VALUES (
        'Mutumbot Default',
        'The ancient tiki entity persona - can be replaced by creating a new default agent',
        ${DEFAULT_MUTUMBOT_PERSONA},
        NULL,
        ${JSON.stringify(defaultCapabilities)},
        ${DEFAULT_MODEL},
        ${JSON.stringify(DEFAULT_AGENT_PARAMS)},
        TRUE
      )
      RETURNING id
    `;
    defaultAgentId = result[0].id as string;
    console.log('[Agents] Created default agent with tiki persona:', defaultAgentId);
  } else {
    defaultAgentId = existingAgent[0].id as string;
  }

  // Check if default workflow exists
  const existingWorkflow = await sql`
    SELECT id FROM workflows WHERE is_default = TRUE LIMIT 1
  `;

  if (existingWorkflow.length === 0) {
    // Create default workflow
    const result = await sql`
      INSERT INTO workflows (name, description, agent_id, context_policy, is_default)
      VALUES (
        'Default Workflow',
        'Standard conversation handling with context and summaries',
        ${defaultAgentId},
        ${JSON.stringify(DEFAULT_CONTEXT_POLICY)},
        TRUE
      )
      RETURNING id
    `;
    console.log('[Agents] Created default workflow:', result[0].id);
  }
}

// ============ AGENT OPERATIONS ============

/**
 * Get all agents
 */
export async function getAgents(): Promise<Agent[]> {
  if (!sql) return [];

  const result = await sql`
    SELECT id, name, description, system_prompt, custom_instructions, capabilities,
           model, params, is_default, is_active, created_at, updated_at
    FROM agents
    WHERE is_active = TRUE
    ORDER BY is_default DESC, name ASC
  `;

  return result.map(rowToAgent);
}

/**
 * Get agent by ID
 */
export async function getAgent(id: string): Promise<Agent | null> {
  if (!sql) return null;

  const result = await sql`
    SELECT id, name, description, system_prompt, custom_instructions, capabilities,
           model, params, is_default, is_active, created_at, updated_at
    FROM agents WHERE id = ${id}::uuid
  `;

  if (result.length === 0) return null;
  return rowToAgent(result[0]);
}

/**
 * Get default agent
 */
export async function getDefaultAgent(): Promise<Agent | null> {
  if (!sql) return null;

  const result = await sql`
    SELECT id, name, description, system_prompt, custom_instructions, capabilities,
           model, params, is_default, is_active, created_at, updated_at
    FROM agents WHERE is_default = TRUE LIMIT 1
  `;

  if (result.length === 0) return null;
  return rowToAgent(result[0]);
}

/**
 * Create a new agent
 */
export async function createAgent(
  name: string,
  options: {
    description?: string;
    /** Full system prompt for the agent's persona and behavior */
    systemPrompt?: string;
    /** Additional instructions (added after system prompt) */
    customInstructions?: string;
    /** Allowed capabilities: 'image_analysis', 'web_search', 'tribute_tracking', etc. */
    capabilities?: string[];
    model?: string;
    params?: AgentParams;
  } = {}
): Promise<Agent> {
  if (!sql) throw new Error('Database not available');

  const result = await sql`
    INSERT INTO agents (name, description, system_prompt, custom_instructions, capabilities, model, params)
    VALUES (
      ${name},
      ${options.description || null},
      ${options.systemPrompt || null},
      ${options.customInstructions || null},
      ${JSON.stringify(options.capabilities || [])},
      ${options.model || DEFAULT_MODEL},
      ${JSON.stringify(options.params || DEFAULT_AGENT_PARAMS)}
    )
    RETURNING id, name, description, system_prompt, custom_instructions, capabilities,
              model, params, is_default, is_active, created_at, updated_at
  `;

  return rowToAgent(result[0]);
}

/**
 * Update an agent
 */
export async function updateAgent(
  id: string,
  updates: {
    name?: string;
    description?: string;
    systemPrompt?: string | null;
    customInstructions?: string | null;
    capabilities?: string[];
    model?: string;
    params?: AgentParams;
    isActive?: boolean;
  }
): Promise<Agent | null> {
  if (!sql) return null;

  const result = await sql`
    UPDATE agents SET
      name = COALESCE(${updates.name ?? null}, name),
      description = COALESCE(${updates.description ?? null}, description),
      system_prompt = CASE
        WHEN ${updates.systemPrompt !== undefined} THEN ${updates.systemPrompt ?? null}
        ELSE system_prompt
      END,
      custom_instructions = CASE
        WHEN ${updates.customInstructions !== undefined} THEN ${updates.customInstructions ?? null}
        ELSE custom_instructions
      END,
      capabilities = CASE
        WHEN ${updates.capabilities !== undefined} THEN ${JSON.stringify(updates.capabilities)}::jsonb
        ELSE capabilities
      END,
      model = COALESCE(${updates.model ?? null}, model),
      params = CASE
        WHEN ${updates.params !== undefined} THEN ${JSON.stringify(updates.params)}::jsonb
        ELSE params
      END,
      is_active = COALESCE(${updates.isActive ?? null}, is_active),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id}::uuid
    RETURNING id, name, description, system_prompt, custom_instructions, capabilities,
              model, params, is_default, is_active, created_at, updated_at
  `;

  if (result.length === 0) return null;
  return rowToAgent(result[0]);
}

// ============ WORKFLOW OPERATIONS ============

/**
 * Get all workflows
 */
export async function getWorkflows(): Promise<Workflow[]> {
  if (!sql) return [];

  const result = await sql`
    SELECT id, name, description, agent_id, context_policy,
           is_default, is_active, created_at, updated_at
    FROM workflows
    WHERE is_active = TRUE
    ORDER BY is_default DESC, name ASC
  `;

  return result.map(rowToWorkflow);
}

/**
 * Get workflow by ID
 */
export async function getWorkflow(id: string): Promise<Workflow | null> {
  if (!sql) return null;

  const result = await sql`
    SELECT id, name, description, agent_id, context_policy,
           is_default, is_active, created_at, updated_at
    FROM workflows WHERE id = ${id}::uuid
  `;

  if (result.length === 0) return null;
  return rowToWorkflow(result[0]);
}

/**
 * Get default workflow
 */
export async function getDefaultWorkflow(): Promise<Workflow | null> {
  if (!sql) return null;

  const result = await sql`
    SELECT id, name, description, agent_id, context_policy,
           is_default, is_active, created_at, updated_at
    FROM workflows WHERE is_default = TRUE LIMIT 1
  `;

  if (result.length === 0) return null;
  return rowToWorkflow(result[0]);
}

/**
 * Create a new workflow
 */
export async function createWorkflow(
  name: string,
  agentId: string,
  options: {
    description?: string;
    contextPolicy?: Partial<ContextPolicy>;
  } = {}
): Promise<Workflow> {
  if (!sql) throw new Error('Database not available');

  const policy = { ...DEFAULT_CONTEXT_POLICY, ...options.contextPolicy };

  const result = await sql`
    INSERT INTO workflows (name, description, agent_id, context_policy)
    VALUES (
      ${name},
      ${options.description || null},
      ${agentId}::uuid,
      ${JSON.stringify(policy)}
    )
    RETURNING id, name, description, agent_id, context_policy,
              is_default, is_active, created_at, updated_at
  `;

  return rowToWorkflow(result[0]);
}

/**
 * Update a workflow
 */
export async function updateWorkflow(
  id: string,
  updates: {
    name?: string;
    description?: string;
    agentId?: string;
    contextPolicy?: Partial<ContextPolicy>;
    isActive?: boolean;
  }
): Promise<Workflow | null> {
  if (!sql) return null;

  // If updating context policy, merge with existing
  let policyUpdate = null;
  if (updates.contextPolicy) {
    const existing = await getWorkflow(id);
    if (existing) {
      policyUpdate = JSON.stringify({
        ...existing.contextPolicy,
        ...updates.contextPolicy,
      });
    }
  }

  const result = await sql`
    UPDATE workflows SET
      name = COALESCE(${updates.name ?? null}, name),
      description = COALESCE(${updates.description ?? null}, description),
      agent_id = COALESCE(${updates.agentId ?? null}::uuid, agent_id),
      context_policy = COALESCE(${policyUpdate}::jsonb, context_policy),
      is_active = COALESCE(${updates.isActive ?? null}, is_active),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id}::uuid
    RETURNING id, name, description, agent_id, context_policy,
              is_default, is_active, created_at, updated_at
  `;

  if (result.length === 0) return null;
  return rowToWorkflow(result[0]);
}

// ============ THREAD WORKFLOW BINDING ============

/**
 * Assign a workflow to a thread
 */
export async function assignWorkflowToThread(
  threadId: string,
  workflowId: string
): Promise<void> {
  if (!sql) return;

  await sql`
    UPDATE threads
    SET workflow_id = ${workflowId}::uuid, updated_at = CURRENT_TIMESTAMP
    WHERE thread_id = ${threadId}
  `;
}

/**
 * Get workflow for a thread (or default)
 */
export async function getThreadWorkflow(threadId: string): Promise<Workflow | null> {
  if (!sql) return getDefaultWorkflow();

  const result = await sql`
    SELECT w.id, w.name, w.description, w.agent_id, w.context_policy,
           w.is_default, w.is_active, w.created_at, w.updated_at
    FROM threads t
    JOIN workflows w ON t.workflow_id = w.id
    WHERE t.thread_id = ${threadId} AND w.is_active = TRUE
  `;

  if (result.length === 0) {
    return getDefaultWorkflow();
  }

  return rowToWorkflow(result[0]);
}

// ============ CONFIG RESOLUTION ============

/**
 * Compose the final system prompt from safety guardrails + agent config
 */
function composeSystemPrompt(agent: Agent, workflow: Workflow): string {
  const parts: string[] = [];

  // 1. SAFETY_GUARDRAILS - always first, cannot be overridden
  parts.push(SAFETY_GUARDRAILS);

  // 2. Agent's system prompt (persona, behavior)
  if (agent.systemPrompt) {
    parts.push(agent.systemPrompt);
  }

  // 3. Agent's custom instructions
  if (agent.customInstructions) {
    parts.push(`--- CUSTOM INSTRUCTIONS ---\n${agent.customInstructions}`);
  }

  // 4. Workflow-specific instructions (channel-level tweaks)
  if (workflow.contextPolicy.customInstructions) {
    parts.push(`--- CHANNEL INSTRUCTIONS ---\n${workflow.contextPolicy.customInstructions}`);
  }

  return parts.join('\n\n');
}

/**
 * Resolve full configuration for a thread
 * Returns the agent, workflow, and composed system prompt
 */
export async function resolveThreadConfig(
  threadId: string
): Promise<ResolvedConfig | null> {
  const workflow = await getThreadWorkflow(threadId);
  if (!workflow) return null;

  const agent = await getAgent(workflow.agentId);
  if (!agent) return null;

  return {
    agent,
    workflow,
    systemPrompt: composeSystemPrompt(agent, workflow),
    contextPolicy: workflow.contextPolicy,
  };
}

/**
 * Get config with fallback to defaults
 * No longer requires a base system prompt - everything comes from DB
 */
export async function resolveConfigWithDefaults(
  threadId: string | null
): Promise<ResolvedConfig> {
  // Try thread-specific config first
  if (threadId) {
    const config = await resolveThreadConfig(threadId);
    if (config) return config;
  }

  // Fall back to defaults
  const agent = await getDefaultAgent();
  const workflow = await getDefaultWorkflow();

  // If no defaults exist, return hardcoded fallback (safety only)
  if (!agent || !workflow) {
    const fallbackAgent: Agent = {
      id: 'fallback',
      name: 'Fallback Agent',
      description: null,
      systemPrompt: null,
      customInstructions: null,
      capabilities: [],
      model: DEFAULT_MODEL,
      params: DEFAULT_AGENT_PARAMS,
      isDefault: true,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const fallbackWorkflow: Workflow = {
      id: 'fallback',
      name: 'Fallback Workflow',
      description: null,
      agentId: 'fallback',
      contextPolicy: DEFAULT_CONTEXT_POLICY,
      isDefault: true,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return {
      agent: fallbackAgent,
      workflow: fallbackWorkflow,
      systemPrompt: SAFETY_GUARDRAILS, // Only safety when no agent configured
      contextPolicy: DEFAULT_CONTEXT_POLICY,
    };
  }

  return {
    agent,
    workflow,
    systemPrompt: composeSystemPrompt(agent, workflow),
    contextPolicy: workflow.contextPolicy,
  };
}

// ============ ROW CONVERTERS ============

function rowToAgent(row: Record<string, unknown>): Agent {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string | null,
    systemPrompt: row.system_prompt as string | null,
    customInstructions: row.custom_instructions as string | null,
    capabilities: (row.capabilities as string[]) || [],
    model: row.model as string,
    params: row.params as AgentParams,
    isDefault: row.is_default as boolean,
    isActive: row.is_active as boolean,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function rowToWorkflow(row: Record<string, unknown>): Workflow {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string | null,
    agentId: row.agent_id as string,
    contextPolicy: row.context_policy as ContextPolicy,
    isDefault: row.is_default as boolean,
    isActive: row.is_active as boolean,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function rowToScheduledEvent(row: Record<string, unknown>): ScheduledEvent {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string | null,
    threadId: row.thread_id as string,
    cronExpression: row.cron_expression as string,
    eventType: row.event_type as EventType,
    payload: (row.payload as ScheduledEventPayload) || {},
    timezone: (row.timezone as string) || 'UTC',
    isActive: row.is_active as boolean,
    lastRunAt: row.last_run_at ? new Date(row.last_run_at as string) : null,
    lastRunStatus: row.last_run_status as 'success' | 'failed' | null,
    lastError: row.last_error as string | null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

// ============ SCHEDULED EVENTS OPERATIONS ============

/**
 * Get all scheduled events
 */
export async function getScheduledEvents(options?: {
  activeOnly?: boolean;
  threadId?: string;
}): Promise<ScheduledEvent[]> {
  if (!sql) return [];

  let result;
  if (options?.threadId) {
    result = await sql`
      SELECT * FROM scheduled_events
      WHERE thread_id = ${options.threadId}
      ${options?.activeOnly ? sql`AND is_active = TRUE` : sql``}
      ORDER BY name ASC
    `;
  } else if (options?.activeOnly) {
    result = await sql`
      SELECT * FROM scheduled_events
      WHERE is_active = TRUE
      ORDER BY name ASC
    `;
  } else {
    result = await sql`
      SELECT * FROM scheduled_events
      ORDER BY name ASC
    `;
  }

  return result.map(rowToScheduledEvent);
}

/**
 * Get a scheduled event by ID
 */
export async function getScheduledEvent(id: string): Promise<ScheduledEvent | null> {
  if (!sql) return null;

  const result = await sql`
    SELECT * FROM scheduled_events WHERE id = ${id}::uuid
  `;

  if (result.length === 0) return null;
  return rowToScheduledEvent(result[0]);
}

/**
 * Create a new scheduled event
 */
export async function createScheduledEvent(
  name: string,
  threadId: string,
  cronExpression: string,
  eventType: EventType,
  options: {
    description?: string;
    payload?: ScheduledEventPayload;
    timezone?: string;
  } = {}
): Promise<ScheduledEvent> {
  if (!sql) throw new Error('Database not available');

  const result = await sql`
    INSERT INTO scheduled_events (name, description, thread_id, cron_expression, event_type, payload, timezone)
    VALUES (
      ${name},
      ${options.description || null},
      ${threadId},
      ${cronExpression},
      ${eventType},
      ${JSON.stringify(options.payload || {})},
      ${options.timezone || 'UTC'}
    )
    RETURNING *
  `;

  return rowToScheduledEvent(result[0]);
}

/**
 * Update a scheduled event
 */
export async function updateScheduledEvent(
  id: string,
  updates: {
    name?: string;
    description?: string | null;
    cronExpression?: string;
    eventType?: EventType;
    payload?: ScheduledEventPayload;
    timezone?: string;
    isActive?: boolean;
  }
): Promise<ScheduledEvent | null> {
  if (!sql) return null;

  const result = await sql`
    UPDATE scheduled_events SET
      name = COALESCE(${updates.name ?? null}, name),
      description = COALESCE(${updates.description ?? null}, description),
      cron_expression = COALESCE(${updates.cronExpression ?? null}, cron_expression),
      event_type = COALESCE(${updates.eventType ?? null}, event_type),
      payload = CASE
        WHEN ${updates.payload !== undefined} THEN ${JSON.stringify(updates.payload)}::jsonb
        ELSE payload
      END,
      timezone = COALESCE(${updates.timezone ?? null}, timezone),
      is_active = COALESCE(${updates.isActive ?? null}, is_active),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id}::uuid
    RETURNING *
  `;

  if (result.length === 0) return null;
  return rowToScheduledEvent(result[0]);
}

/**
 * Delete a scheduled event
 */
export async function deleteScheduledEvent(id: string): Promise<boolean> {
  if (!sql) return false;

  const result = await sql`
    DELETE FROM scheduled_events WHERE id = ${id}::uuid
    RETURNING id
  `;

  return result.length > 0;
}

/**
 * Record run result for a scheduled event
 */
export async function recordEventRun(
  id: string,
  status: 'success' | 'failed',
  error?: string
): Promise<void> {
  if (!sql) return;

  await sql`
    UPDATE scheduled_events SET
      last_run_at = CURRENT_TIMESTAMP,
      last_run_status = ${status},
      last_error = ${error || null},
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id}::uuid
  `;
}

// ============ EXPORTS FOR EASY MANAGEMENT ============

export { DEFAULT_CONTEXT_POLICY, DEFAULT_AGENT_PARAMS, DEFAULT_MODEL };
