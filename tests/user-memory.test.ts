/**
 * Unit tests for src/services/userMemory.ts
 *
 * Tests only the pure formatting functions. No DB or API access required.
 */

import { describe, it, expect } from 'vitest';
import {
  formatUserMemoryForContext,
  formatAllUserMemoriesForContext,
  UserMemory,
} from '../src/services/userMemory';

// ============ TEST FIXTURES ============

function makeMemory(overrides: Partial<UserMemory> = {}): UserMemory {
  return {
    userId: 'user-1',
    channelId: 'channel-1',
    guildId: 'guild-1',
    summary: 'Alice often asks about cocktails and loves tiki culture.',
    messageCount: 42,
    lastUpdatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ============ formatUserMemoryForContext ============

describe('formatUserMemoryForContext', () => {
  it('returns a string', () => {
    const result = formatUserMemoryForContext(makeMemory(), 'Alice');
    expect(typeof result).toBe('string');
  });

  it('includes the username in the output', () => {
    const result = formatUserMemoryForContext(makeMemory(), 'Alice');
    expect(result.toUpperCase()).toContain('ALICE');
  });

  it('includes the memory summary text', () => {
    const memory = makeMemory({ summary: 'Bob is a night owl who drinks espresso.' });
    const result = formatUserMemoryForContext(memory, 'Bob');
    expect(result).toContain('Bob is a night owl who drinks espresso.');
  });

  it('wraps the content with opening and closing markers', () => {
    const result = formatUserMemoryForContext(makeMemory(), 'Alice');
    expect(result).toContain('[MEMORY OF');
    expect(result).toContain('[END MEMORY]');
  });
});

// ============ formatAllUserMemoriesForContext ============

describe('formatAllUserMemoriesForContext', () => {
  it('returns empty string for an empty array', () => {
    const result = formatAllUserMemoriesForContext([], 'Alice');
    expect(result).toBe('');
  });

  it('formats a single memory the same as formatUserMemoryForContext', () => {
    const memory = makeMemory();
    const single = formatAllUserMemoriesForContext([memory], 'Alice');
    const direct = formatUserMemoryForContext(memory, 'Alice');
    expect(single).toBe(direct);
  });

  it('combines multiple memories into one block', () => {
    const memories = [
      makeMemory({ channelId: 'ch-1', summary: 'Summary from channel 1.' }),
      makeMemory({ channelId: 'ch-2', summary: 'Summary from channel 2.' }),
    ];
    const result = formatAllUserMemoriesForContext(memories, 'Alice');
    expect(result).toContain('Summary from channel 1.');
    expect(result).toContain('Summary from channel 2.');
  });

  it('includes the channel count in the header for multiple memories', () => {
    const memories = [
      makeMemory({ channelId: 'ch-1' }),
      makeMemory({ channelId: 'ch-2' }),
      makeMemory({ channelId: 'ch-3' }),
    ];
    const result = formatAllUserMemoriesForContext(memories, 'Alice');
    expect(result).toContain('3 channels');
  });

  it('truncates combined content when it exceeds the 3000 character limit', () => {
    const longSummary = 'x'.repeat(2000);
    const memories = [
      makeMemory({ channelId: 'ch-1', summary: longSummary }),
      makeMemory({ channelId: 'ch-2', summary: longSummary }),
    ];
    const result = formatAllUserMemoriesForContext(memories, 'Alice');
    // The combined body should be capped — the total result may be slightly over 3000
    // due to header/footer but the summary portion must be truncated
    expect(result).toContain('...');
  });

  it('wraps the combined output with memory markers', () => {
    const memories = [makeMemory({ channelId: 'ch-1' }), makeMemory({ channelId: 'ch-2' })];
    const result = formatAllUserMemoriesForContext(memories, 'Alice');
    expect(result).toContain('[MEMORY OF');
    expect(result).toContain('[END MEMORY]');
  });
});
