/**
 * Agents & Workflows Service
 *
 * Agent Builder-style dynamic configuration for per-channel customization.
 *
 * Architecture:
 * - Base persona (MUTUMBOT_SYSTEM_PROMPT) stays in code (safety)
 * - Agents provide persona overlays (tone adjustments, extra instructions)
 * - Workflows define context policies (how many messages, use summary, etc.)
 * - Threads bind to workflows for per-channel behavior
 *
 * This allows adjusting the bot per channel/DM while keeping core safety rails.
 */

import { neon, neonConfig } from '@neondatabase/serverless';

neonConfig.fetchConnectionCache = true;

const DATABASE_URL = process.env.DATABASE_URL;
const sql = DATABASE_URL ? neon(DATABASE_URL) : null;

// ============ TYPES ============

export interface Agent {
  id: string;
  name: string;
  description: string | null;
  /**
   * Persona text - behavior depends on replaceBasePrompt:
   * - If replaceBasePrompt=false: added AFTER the base system prompt (overlay)
   * - If replaceBasePrompt=true: REPLACES the base system prompt entirely
   */
  systemPromptOverlay: string | null;
  /**
   * If true, systemPromptOverlay completely replaces the base persona.
   * If false (default), it's added as an overlay after the base persona.
   */
  replaceBasePrompt: boolean;
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
  temperature?: number;
  topP?: number;
  maxTokens?: number;
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
  /** Final system prompt = base + agent overlay + workflow instructions */
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
        system_prompt_overlay TEXT,
        replace_base_prompt BOOLEAN DEFAULT FALSE,
        model VARCHAR(100) DEFAULT 'google/gemini-2.5-flash-lite',
        params JSONB DEFAULT '{"temperature": 0.7}',
        is_default BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Add replace_base_prompt column if not exists (for existing tables)
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'agents' AND column_name = 'replace_base_prompt'
        ) THEN
          ALTER TABLE agents ADD COLUMN replace_base_prompt BOOLEAN DEFAULT FALSE;
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
    // Create default agent
    const result = await sql`
      INSERT INTO agents (name, description, system_prompt_overlay, model, params, is_default)
      VALUES (
        'Mutumbot Default',
        'The standard ancient tiki entity persona',
        NULL,
        ${DEFAULT_MODEL},
        ${JSON.stringify(DEFAULT_AGENT_PARAMS)},
        TRUE
      )
      RETURNING id
    `;
    defaultAgentId = result[0].id as string;
    console.log('[Agents] Created default agent:', defaultAgentId);
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
    SELECT id, name, description, system_prompt_overlay, replace_base_prompt,
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
    SELECT id, name, description, system_prompt_overlay, replace_base_prompt,
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
    SELECT id, name, description, system_prompt_overlay, replace_base_prompt,
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
    systemPromptOverlay?: string;
    /** If true, systemPromptOverlay replaces the base persona entirely */
    replaceBasePrompt?: boolean;
    model?: string;
    params?: AgentParams;
  } = {}
): Promise<Agent> {
  if (!sql) throw new Error('Database not available');

  const result = await sql`
    INSERT INTO agents (name, description, system_prompt_overlay, replace_base_prompt, model, params)
    VALUES (
      ${name},
      ${options.description || null},
      ${options.systemPromptOverlay || null},
      ${options.replaceBasePrompt || false},
      ${options.model || DEFAULT_MODEL},
      ${JSON.stringify(options.params || DEFAULT_AGENT_PARAMS)}
    )
    RETURNING id, name, description, system_prompt_overlay, replace_base_prompt,
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
    systemPromptOverlay?: string | null;
    /** If true, systemPromptOverlay replaces the base persona entirely */
    replaceBasePrompt?: boolean;
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
      system_prompt_overlay = CASE
        WHEN ${updates.systemPromptOverlay !== undefined} THEN ${updates.systemPromptOverlay ?? null}
        ELSE system_prompt_overlay
      END,
      replace_base_prompt = COALESCE(${updates.replaceBasePrompt ?? null}, replace_base_prompt),
      model = COALESCE(${updates.model ?? null}, model),
      params = CASE
        WHEN ${updates.params !== undefined} THEN ${JSON.stringify(updates.params)}::jsonb
        ELSE params
      END,
      is_active = COALESCE(${updates.isActive ?? null}, is_active),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id}::uuid
    RETURNING id, name, description, system_prompt_overlay, replace_base_prompt,
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
 * Resolve full configuration for a thread
 * Returns the agent, workflow, and composed system prompt
 */
export async function resolveThreadConfig(
  threadId: string,
  baseSystemPrompt: string
): Promise<ResolvedConfig | null> {
  const workflow = await getThreadWorkflow(threadId);
  if (!workflow) return null;

  const agent = await getAgent(workflow.agentId);
  if (!agent) return null;

  // Compose final system prompt based on agent's replaceBasePrompt setting
  let systemPrompt: string;

  if (agent.replaceBasePrompt && agent.systemPromptOverlay) {
    // Full replacement - agent's prompt IS the system prompt
    systemPrompt = agent.systemPromptOverlay;
  } else {
    // Overlay mode (default) - base + agent overlay
    systemPrompt = baseSystemPrompt;
    if (agent.systemPromptOverlay) {
      systemPrompt += `\n\n--- PERSONA ADJUSTMENTS ---\n${agent.systemPromptOverlay}`;
    }
  }

  // Add workflow instructions (always appended)
  if (workflow.contextPolicy.customInstructions) {
    systemPrompt += `\n\n--- WORKFLOW INSTRUCTIONS ---\n${workflow.contextPolicy.customInstructions}`;
  }

  return {
    agent,
    workflow,
    systemPrompt,
    contextPolicy: workflow.contextPolicy,
  };
}

/**
 * Get config with fallback to defaults
 */
export async function resolveConfigWithDefaults(
  threadId: string | null,
  baseSystemPrompt: string
): Promise<ResolvedConfig> {
  // Try thread-specific config first
  if (threadId) {
    const config = await resolveThreadConfig(threadId, baseSystemPrompt);
    if (config) return config;
  }

  // Fall back to defaults
  const agent = await getDefaultAgent();
  const workflow = await getDefaultWorkflow();

  // If no defaults exist, return hardcoded fallback
  if (!agent || !workflow) {
    return {
      agent: {
        id: 'fallback',
        name: 'Fallback Agent',
        description: null,
        systemPromptOverlay: null,
        replaceBasePrompt: false,
        model: DEFAULT_MODEL,
        params: DEFAULT_AGENT_PARAMS,
        isDefault: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      workflow: {
        id: 'fallback',
        name: 'Fallback Workflow',
        description: null,
        agentId: 'fallback',
        contextPolicy: DEFAULT_CONTEXT_POLICY,
        isDefault: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      systemPrompt: baseSystemPrompt,
      contextPolicy: DEFAULT_CONTEXT_POLICY,
    };
  }

  // Compose system prompt based on agent's replaceBasePrompt setting
  let systemPrompt: string;

  if (agent.replaceBasePrompt && agent.systemPromptOverlay) {
    // Full replacement - agent's prompt IS the system prompt
    systemPrompt = agent.systemPromptOverlay;
  } else {
    // Overlay mode (default) - base + agent overlay
    systemPrompt = baseSystemPrompt;
    if (agent.systemPromptOverlay) {
      systemPrompt += `\n\n--- PERSONA ADJUSTMENTS ---\n${agent.systemPromptOverlay}`;
    }
  }

  // Add workflow instructions (always appended)
  if (workflow.contextPolicy.customInstructions) {
    systemPrompt += `\n\n--- WORKFLOW INSTRUCTIONS ---\n${workflow.contextPolicy.customInstructions}`;
  }

  return {
    agent,
    workflow,
    systemPrompt,
    contextPolicy: workflow.contextPolicy,
  };
}

// ============ ROW CONVERTERS ============

function rowToAgent(row: Record<string, unknown>): Agent {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string | null,
    systemPromptOverlay: row.system_prompt_overlay as string | null,
    replaceBasePrompt: (row.replace_base_prompt as boolean) || false,
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

// ============ EXPORTS FOR EASY MANAGEMENT ============

export { DEFAULT_CONTEXT_POLICY, DEFAULT_AGENT_PARAMS, DEFAULT_MODEL };
