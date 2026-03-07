/**
 * Agent Knowledge Service
 *
 * Persistent fact storage per agent. Agents with the 'knowledge' capability
 * can save and recall facts across conversations. Facts follow the agent,
 * not the channel.
 */

import { sql } from '../db';

// ============ TYPES ============

export interface AgentFact {
  id: string;
  agentId: string;
  fact: string;
  category: string | null;
  subject: string | null;
  sourceThreadId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Max chars for auto-recalled facts injected into system prompt
const MAX_AUTO_RECALL_CHARS = 10000;
// Number of most recent facts to auto-load
const AUTO_RECALL_LIMIT = 20;

// ============ DATABASE INITIALIZATION ============

export async function initializeAgentKnowledgeTable(): Promise<void> {
  if (!sql) return;

  await sql`
    CREATE TABLE IF NOT EXISTS agent_knowledge (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      fact TEXT NOT NULL,
      category VARCHAR(50),
      subject VARCHAR(255),
      source_thread_id VARCHAR(255),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_agent_knowledge_agent ON agent_knowledge(agent_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_agent_knowledge_subject ON agent_knowledge(agent_id, subject)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_agent_knowledge_category ON agent_knowledge(agent_id, category)`;

  console.log('[AgentKnowledge] Table initialized');
}

// ============ CRUD ============

/**
 * Save a fact for an agent. If a fact with the same subject+category exists, update it.
 */
export async function rememberFact(
  agentId: string,
  fact: string,
  options: {
    category?: string;
    subject?: string;
    sourceThreadId?: string;
  } = {}
): Promise<AgentFact> {
  if (!sql) throw new Error('Database not available');

  // If subject and category match an existing fact, update it
  if (options.subject && options.category) {
    const existing = await sql`
      SELECT id FROM agent_knowledge
      WHERE agent_id = ${agentId}::uuid
        AND subject = ${options.subject}
        AND category = ${options.category}
      LIMIT 1
    `;

    if (existing.length > 0) {
      const result = await sql`
        UPDATE agent_knowledge SET
          fact = ${fact},
          source_thread_id = COALESCE(${options.sourceThreadId ?? null}, source_thread_id),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ${existing[0].id}::uuid
        RETURNING id, agent_id, fact, category, subject, source_thread_id, created_at, updated_at
      `;
      return rowToFact(result[0]);
    }
  }

  const result = await sql`
    INSERT INTO agent_knowledge (agent_id, fact, category, subject, source_thread_id)
    VALUES (
      ${agentId}::uuid,
      ${fact},
      ${options.category ?? null},
      ${options.subject ?? null},
      ${options.sourceThreadId ?? null}
    )
    RETURNING id, agent_id, fact, category, subject, source_thread_id, created_at, updated_at
  `;

  return rowToFact(result[0]);
}

/**
 * Search facts for an agent by subject and/or category
 */
export async function recallFacts(
  agentId: string,
  options: {
    subject?: string;
    category?: string;
    searchText?: string;
    limit?: number;
  } = {}
): Promise<AgentFact[]> {
  if (!sql) return [];

  const limit = options.limit || 20;

  // Build query based on provided filters
  if (options.searchText) {
    const pattern = `%${options.searchText}%`;
    const result = await sql`
      SELECT id, agent_id, fact, category, subject, source_thread_id, created_at, updated_at
      FROM agent_knowledge
      WHERE agent_id = ${agentId}::uuid
        AND (fact ILIKE ${pattern} OR subject ILIKE ${pattern} OR category ILIKE ${pattern})
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `;
    return result.map(rowToFact);
  }

  if (options.subject && options.category) {
    const result = await sql`
      SELECT id, agent_id, fact, category, subject, source_thread_id, created_at, updated_at
      FROM agent_knowledge
      WHERE agent_id = ${agentId}::uuid
        AND subject = ${options.subject}
        AND category = ${options.category}
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `;
    return result.map(rowToFact);
  }

  if (options.subject) {
    const result = await sql`
      SELECT id, agent_id, fact, category, subject, source_thread_id, created_at, updated_at
      FROM agent_knowledge
      WHERE agent_id = ${agentId}::uuid AND subject = ${options.subject}
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `;
    return result.map(rowToFact);
  }

  if (options.category) {
    const result = await sql`
      SELECT id, agent_id, fact, category, subject, source_thread_id, created_at, updated_at
      FROM agent_knowledge
      WHERE agent_id = ${agentId}::uuid AND category = ${options.category}
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `;
    return result.map(rowToFact);
  }

  // No filters — return most recent
  const result = await sql`
    SELECT id, agent_id, fact, category, subject, source_thread_id, created_at, updated_at
    FROM agent_knowledge
    WHERE agent_id = ${agentId}::uuid
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `;
  return result.map(rowToFact);
}

/**
 * Get recent facts for auto-recall (injected into system prompt)
 */
export async function getAutoRecallFacts(agentId: string): Promise<string> {
  if (!sql) return '';

  const facts = await recallFacts(agentId, { limit: AUTO_RECALL_LIMIT });
  if (facts.length === 0) return '';

  let result = '';
  for (const fact of facts) {
    const line = formatFactLine(fact);
    if (result.length + line.length > MAX_AUTO_RECALL_CHARS) break;
    result += line + '\n';
  }

  return result.trim();
}

/**
 * Delete a fact
 */
export async function deleteFact(factId: string): Promise<boolean> {
  if (!sql) return false;

  const result = await sql`
    DELETE FROM agent_knowledge WHERE id = ${factId}::uuid RETURNING id
  `;
  return result.length > 0;
}

// ============ FORMATTING ============

function formatFactLine(fact: AgentFact): string {
  const parts: string[] = [];
  if (fact.category) parts.push(`[${fact.category}]`);
  if (fact.subject) parts.push(`(${fact.subject})`);
  parts.push(fact.fact);
  return parts.join(' ');
}

export function formatFactsForContext(facts: AgentFact[]): string {
  if (facts.length === 0) return '';
  return facts.map(formatFactLine).join('\n');
}

// ============ HELPERS ============

function rowToFact(row: Record<string, unknown>): AgentFact {
  return {
    id: row.id as string,
    agentId: row.agent_id as string,
    fact: row.fact as string,
    category: row.category as string | null,
    subject: row.subject as string | null,
    sourceThreadId: row.source_thread_id as string | null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}
