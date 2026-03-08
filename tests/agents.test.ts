/**
 * Unit tests for src/services/agents.ts
 *
 * Tests pure functions and exported constants only.
 * No DB or API access required.
 */

import { describe, it, expect } from 'vitest';
import {
  composeSystemPrompt,
  AVAILABLE_CAPABILITIES,
  EVENT_TYPES,
  DEFAULT_CONTEXT_POLICY,
  Agent,
  Workflow,
  ContextPolicy,
} from '../src/services/agents';
import { SAFETY_GUARDRAILS } from '../src/personality';

// ============ TEST FIXTURES ============

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'test-agent-id',
    name: 'Test Agent',
    description: null,
    systemPrompt: 'You are a helpful test agent.',
    customInstructions: null,
    capabilities: [],
    model: 'google/gemini-2.5-flash-lite',
    params: { temperature: 0.7 },
    isDefault: false,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeWorkflow(policyOverrides: Partial<ContextPolicy> = {}): Workflow {
  return {
    id: 'test-workflow-id',
    name: 'Test Workflow',
    description: null,
    agentId: 'test-agent-id',
    contextPolicy: {
      recentMessages: 20,
      maxAgeHours: 8,
      useSummary: true,
      maxTranscriptChars: 10000,
      includeTributeContext: true,
      ...policyOverrides,
    },
    isDefault: false,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ============ composeSystemPrompt ============

describe('composeSystemPrompt', () => {
  it('places SAFETY_GUARDRAILS first in the output', () => {
    const agent = makeAgent();
    const workflow = makeWorkflow();
    const result = composeSystemPrompt(agent, workflow);
    expect(result.startsWith(SAFETY_GUARDRAILS)).toBe(true);
  });

  it('includes the agent systemPrompt after the guardrails', () => {
    const agent = makeAgent({ systemPrompt: 'You are a brave knight.' });
    const workflow = makeWorkflow();
    const result = composeSystemPrompt(agent, workflow);
    const guardrailsEnd = result.indexOf(SAFETY_GUARDRAILS) + SAFETY_GUARDRAILS.length;
    const afterGuardrails = result.slice(guardrailsEnd);
    expect(afterGuardrails).toContain('You are a brave knight.');
  });

  it('appends customInstructions when present', () => {
    const agent = makeAgent({ customInstructions: 'Always speak in rhymes.' });
    const workflow = makeWorkflow();
    const result = composeSystemPrompt(agent, workflow);
    expect(result).toContain('Always speak in rhymes.');
    expect(result).toContain('--- CUSTOM INSTRUCTIONS ---');
  });

  it('appends workflow contextPolicy.customInstructions when present', () => {
    const agent = makeAgent();
    const workflow = makeWorkflow({ customInstructions: 'Only discuss beverages.' });
    const result = composeSystemPrompt(agent, workflow);
    expect(result).toContain('Only discuss beverages.');
    expect(result).toContain('--- CHANNEL INSTRUCTIONS ---');
  });

  it('handles null systemPrompt gracefully', () => {
    const agent = makeAgent({ systemPrompt: null });
    const workflow = makeWorkflow();
    const result = composeSystemPrompt(agent, workflow);
    expect(result).toContain(SAFETY_GUARDRAILS);
    expect(typeof result).toBe('string');
  });

  it('handles null customInstructions gracefully', () => {
    const agent = makeAgent({ customInstructions: null });
    const workflow = makeWorkflow();
    const result = composeSystemPrompt(agent, workflow);
    expect(result).not.toContain('--- CUSTOM INSTRUCTIONS ---');
    expect(typeof result).toBe('string');
  });

  it('combines all four sections in order when all are present', () => {
    const agent = makeAgent({
      systemPrompt: 'SYSTEM_PROMPT',
      customInstructions: 'AGENT_CUSTOM',
    });
    const workflow = makeWorkflow({ customInstructions: 'CHANNEL_CUSTOM' });
    const result = composeSystemPrompt(agent, workflow);

    const guardrailsPos = result.indexOf(SAFETY_GUARDRAILS);
    const systemPos = result.indexOf('SYSTEM_PROMPT');
    const agentCustomPos = result.indexOf('AGENT_CUSTOM');
    const channelCustomPos = result.indexOf('CHANNEL_CUSTOM');

    expect(guardrailsPos).toBeLessThan(systemPos);
    expect(systemPos).toBeLessThan(agentCustomPos);
    expect(agentCustomPos).toBeLessThan(channelCustomPos);
  });
});

// ============ AVAILABLE_CAPABILITIES ============

describe('AVAILABLE_CAPABILITIES', () => {
  it('has all expected capability keys', () => {
    expect(AVAILABLE_CAPABILITIES).toHaveProperty('IMAGE_ANALYSIS');
    expect(AVAILABLE_CAPABILITIES).toHaveProperty('TRIBUTE_TRACKING');
    expect(AVAILABLE_CAPABILITIES).toHaveProperty('WEB_SEARCH');
    expect(AVAILABLE_CAPABILITIES).toHaveProperty('SCHEDULED_MESSAGES');
    expect(AVAILABLE_CAPABILITIES).toHaveProperty('RANDOM_FACTS');
    expect(AVAILABLE_CAPABILITIES).toHaveProperty('KNOWLEDGE');
  });

  it('has string values for every key', () => {
    for (const value of Object.values(AVAILABLE_CAPABILITIES)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });
});

// ============ EVENT_TYPES ============

describe('EVENT_TYPES', () => {
  it('has all expected event type values', () => {
    expect(Object.values(EVENT_TYPES)).toContain('tribute_reminder');
    expect(Object.values(EVENT_TYPES)).toContain('custom_message');
    expect(Object.values(EVENT_TYPES)).toContain('status_report');
    expect(Object.values(EVENT_TYPES)).toContain('ai_prompt');
    expect(Object.values(EVENT_TYPES)).toContain('channel_summary');
  });

  it('has string values for every key', () => {
    for (const value of Object.values(EVENT_TYPES)) {
      expect(typeof value).toBe('string');
    }
  });
});

// ============ DEFAULT_CONTEXT_POLICY ============

describe('DEFAULT_CONTEXT_POLICY', () => {
  it('has a recentMessages field that is a positive number', () => {
    expect(typeof DEFAULT_CONTEXT_POLICY.recentMessages).toBe('number');
    expect(DEFAULT_CONTEXT_POLICY.recentMessages).toBeGreaterThan(0);
  });

  it('has a maxAgeHours field that is a positive number', () => {
    expect(typeof DEFAULT_CONTEXT_POLICY.maxAgeHours).toBe('number');
    expect(DEFAULT_CONTEXT_POLICY.maxAgeHours).toBeGreaterThan(0);
  });

  it('has a useSummary boolean field', () => {
    expect(typeof DEFAULT_CONTEXT_POLICY.useSummary).toBe('boolean');
  });

  it('has a maxTranscriptChars field that is a positive number', () => {
    expect(typeof DEFAULT_CONTEXT_POLICY.maxTranscriptChars).toBe('number');
    expect(DEFAULT_CONTEXT_POLICY.maxTranscriptChars).toBeGreaterThan(0);
  });

  it('has an includeTributeContext boolean field', () => {
    expect(typeof DEFAULT_CONTEXT_POLICY.includeTributeContext).toBe('boolean');
  });
});
