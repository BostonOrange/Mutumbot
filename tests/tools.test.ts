/**
 * Unit tests for getToolsForCapabilities in src/services/tools.ts
 *
 * Tests the pure capability-gating logic. The tools module imports from
 * agents.ts which imports from db.ts; db.ts is safe to import without a
 * DATABASE_URL (it logs an error but does not throw).
 */

import { describe, it, expect } from 'vitest';
import { getToolsForCapabilities } from '../src/services/tools';
import { parseCapabilities } from '../src/services/agents';

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

  describe('DM context (isDM option)', () => {
    it('should exclude list_channels in DM context', () => {
      const tools = getToolsForCapabilities([], { isDM: true });
      const names = tools.map(t => t.function.name);
      expect(names).not.toContain('list_channels');
    });

    it('should still include knowledge tools in DM context', () => {
      const tools = getToolsForCapabilities(['knowledge'], { isDM: true });
      const names = tools.map(t => t.function.name);
      expect(names).toContain('remember_fact');
      expect(names).toContain('recall_facts');
    });

    it('should still include scheduling tools in DM context', () => {
      const tools = getToolsForCapabilities(['scheduled_messages'], { isDM: true });
      const names = tools.map(t => t.function.name);
      expect(names).toContain('create_scheduled_event');
    });

    it('should return no tools when DM with no capabilities', () => {
      const tools = getToolsForCapabilities([], { isDM: true });
      expect(tools.length).toBe(0);
    });

    it('should include list_channels when isDM is false', () => {
      const tools = getToolsForCapabilities([], { isDM: false });
      const names = tools.map(t => t.function.name);
      expect(names).toContain('list_channels');
    });
  });
});

describe('parseCapabilities', () => {
  it('should parse a normal string array', () => {
    expect(parseCapabilities(['image_analysis', 'knowledge'])).toEqual(['image_analysis', 'knowledge']);
  });

  it('should flatten a double-serialized JSON array element', () => {
    // This is the corruption case: JSON.stringify produced a string element
    const corrupted = ['["image_analysis","scheduled_messages","knowledge"]', 'tribute_tracking'];
    const result = parseCapabilities(corrupted);
    expect(result).toContain('image_analysis');
    expect(result).toContain('scheduled_messages');
    expect(result).toContain('knowledge');
    expect(result).toContain('tribute_tracking');
  });

  it('should deduplicate after flattening', () => {
    // knowledge appears both inside the stringified array and as a separate element
    const corrupted = ['["image_analysis","knowledge"]', 'knowledge', 'web_search'];
    const result = parseCapabilities(corrupted);
    const knowledgeCount = result.filter(c => c === 'knowledge').length;
    expect(knowledgeCount).toBe(1);
    expect(result).toContain('image_analysis');
    expect(result).toContain('web_search');
  });

  it('should return empty array for null/undefined', () => {
    expect(parseCapabilities(null)).toEqual([]);
    expect(parseCapabilities(undefined)).toEqual([]);
  });

  it('should return empty array for non-array values', () => {
    expect(parseCapabilities('string')).toEqual([]);
    expect(parseCapabilities(42)).toEqual([]);
    expect(parseCapabilities({})).toEqual([]);
  });

  it('should skip non-string elements', () => {
    expect(parseCapabilities([123, null, 'knowledge'])).toEqual(['knowledge']);
  });

  it('should not treat regular strings starting with [ as JSON', () => {
    // A string like "[broken" is not valid JSON — should be kept as-is
    expect(parseCapabilities(['[broken', 'knowledge'])).toEqual(['[broken', 'knowledge']);
  });
});
