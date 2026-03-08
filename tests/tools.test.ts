/**
 * Unit tests for getToolsForCapabilities in src/services/tools.ts
 *
 * Tests the pure capability-gating logic. The tools module imports from
 * agents.ts which imports from db.ts; db.ts is safe to import without a
 * DATABASE_URL (it logs an error but does not throw).
 */

import { describe, it, expect } from 'vitest';
import { getToolsForCapabilities } from '../src/services/tools';

describe('getToolsForCapabilities', () => {
  it('should always include Discord tools (list_channels)', () => {
    const tools = getToolsForCapabilities([]);
    const names = tools.map(t => t.function.name);
    expect(names).toContain('list_channels');
  });

  it('should add scheduling tools when scheduled_messages is enabled', () => {
    const tools = getToolsForCapabilities(['scheduled_messages']);
    const names = tools.map(t => t.function.name);
    expect(names).toContain('create_scheduled_event');
    expect(names).toContain('list_scheduled_events');
    expect(names).toContain('update_scheduled_event');
    expect(names).toContain('delete_scheduled_event');
  });

  it('should add knowledge tools when knowledge is enabled', () => {
    const tools = getToolsForCapabilities(['knowledge']);
    const names = tools.map(t => t.function.name);
    expect(names).toContain('remember_fact');
    expect(names).toContain('recall_facts');
  });

  it('should NOT add web_search as a custom tool (handled by :online plugin)', () => {
    const baseTools = getToolsForCapabilities([]);
    const webTools = getToolsForCapabilities(['web_search']);
    // web_search capability is handled by OpenRouter's :online suffix, not a custom tool
    expect(webTools.length).toBe(baseTools.length);
  });

  it('should not add scheduling tools without the scheduled_messages capability', () => {
    const tools = getToolsForCapabilities(['knowledge']);
    const names = tools.map(t => t.function.name);
    expect(names).not.toContain('create_scheduled_event');
  });

  it('should not add knowledge tools without the knowledge capability', () => {
    const tools = getToolsForCapabilities(['scheduled_messages']);
    const names = tools.map(t => t.function.name);
    expect(names).not.toContain('remember_fact');
  });

  it('should combine all capabilities correctly', () => {
    const tools = getToolsForCapabilities(['scheduled_messages', 'knowledge']);
    const names = tools.map(t => t.function.name);
    expect(names).toContain('list_channels');
    expect(names).toContain('create_scheduled_event');
    expect(names).toContain('remember_fact');
  });

  it('should handle unknown capabilities gracefully (returns base tools)', () => {
    const tools = getToolsForCapabilities(['nonexistent_capability']);
    const names = tools.map(t => t.function.name);
    expect(names).toContain('list_channels');
  });

  it('should return ToolDefinition objects with the correct shape', () => {
    const tools = getToolsForCapabilities(['scheduled_messages', 'knowledge']);
    for (const tool of tools) {
      expect(tool.type).toBe('function');
      expect(typeof tool.function.name).toBe('string');
      expect(typeof tool.function.description).toBe('string');
      expect(tool.function.parameters.type).toBe('object');
      expect(Array.isArray(tool.function.parameters.required)).toBe(true);
    }
  });

  it('should return an empty capabilities array and still have at least one tool', () => {
    const tools = getToolsForCapabilities([]);
    expect(tools.length).toBeGreaterThan(0);
  });
});
