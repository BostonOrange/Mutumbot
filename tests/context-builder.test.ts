/**
 * Unit tests for src/services/contextBuilder.ts
 *
 * Tests pure helper functions only. No DB or API access required.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeMessage,
  selectBestMessages,
  formatTranscript,
  applyLengthBudget,
  formatTime,
  ContextMessage,
} from '../src/services/contextBuilder';

// ============ TEST FIXTURES ============

function makeMessage(overrides: Partial<ContextMessage> = {}): ContextMessage {
  return {
    messageId: 'msg-1',
    authorId: 'user-1',
    authorName: 'Alice',
    isBot: false,
    createdAt: new Date('2024-01-01T12:00:00Z'),
    content: 'Hello world',
    mentionsBot: false,
    replyToMessageId: null,
    hasImage: false,
    hasAttachments: false,
    isDeleted: false,
    ...overrides,
  };
}

// ============ normalizeMessage ============

describe('normalizeMessage', () => {
  it('returns unchanged content for plain text', () => {
    const msg = makeMessage({ content: 'Just a normal message.' });
    const result = normalizeMessage(msg);
    expect(result.content).toBe('Just a normal message.');
  });

  it('replaces user mentions with @user', () => {
    const msg = makeMessage({ content: 'Hey <@123456789> what is up?' });
    const result = normalizeMessage(msg);
    expect(result.content).toContain('@user');
    expect(result.content).not.toContain('<@123456789>');
  });

  it('replaces user mentions with exclamation mark format', () => {
    const msg = makeMessage({ content: 'Hello <@!987654321>' });
    const result = normalizeMessage(msg);
    expect(result.content).toContain('@user');
    expect(result.content).not.toContain('<@!987654321>');
  });

  it('replaces channel mentions with #channel', () => {
    const msg = makeMessage({ content: 'Check out <#111222333>' });
    const result = normalizeMessage(msg);
    expect(result.content).toContain('#channel');
    expect(result.content).not.toContain('<#111222333>');
  });

  it('collapses URLs to (link: domain)', () => {
    const msg = makeMessage({ content: 'Visit https://example.com/some/long/path?query=true' });
    const result = normalizeMessage(msg);
    expect(result.content).toContain('(link: example.com)');
    expect(result.content).not.toContain('https://example.com');
  });

  it('marks image-only messages when content is empty and hasImage is true', () => {
    const msg = makeMessage({ content: '', hasImage: true });
    const result = normalizeMessage(msg);
    expect(result.content).toBe('(image only)');
  });

  it('marks attachment-only messages when content is empty and hasAttachments is true', () => {
    const msg = makeMessage({ content: '', hasAttachments: true });
    const result = normalizeMessage(msg);
    expect(result.content).toBe('(attachment)');
  });

  it('truncates content longer than 400 characters', () => {
    const longContent = 'x'.repeat(500);
    const msg = makeMessage({ content: longContent });
    const result = normalizeMessage(msg);
    expect(result.content.length).toBeLessThanOrEqual(403); // 400 + '...'
    expect(result.content.endsWith('...')).toBe(true);
  });

  it('preserves non-truncated content under the limit', () => {
    const shortContent = 'Short message.';
    const msg = makeMessage({ content: shortContent });
    const result = normalizeMessage(msg);
    expect(result.content).toBe(shortContent);
  });

  it('preserves all other message fields unchanged', () => {
    const msg = makeMessage({ messageId: 'xyz', authorName: 'Bob', isBot: true });
    const result = normalizeMessage(msg);
    expect(result.messageId).toBe('xyz');
    expect(result.authorName).toBe('Bob');
    expect(result.isBot).toBe(true);
  });
});

// ============ selectBestMessages ============

describe('selectBestMessages', () => {
  it('returns empty array when candidates is empty', () => {
    const result = selectBestMessages([], 'msg-1');
    expect(result).toEqual([]);
  });

  it('always includes the trigger message', () => {
    const trigger = makeMessage({ messageId: 'trigger' });
    const others = [
      makeMessage({ messageId: 'a' }),
      makeMessage({ messageId: 'b' }),
    ];
    const result = selectBestMessages([trigger, ...others], 'trigger', 5);
    const ids = result.map(m => m.messageId);
    expect(ids).toContain('trigger');
  });

  it('includes the reply target when the trigger is a reply', () => {
    const replyTarget = makeMessage({ messageId: 'parent' });
    const trigger = makeMessage({ messageId: 'trigger', replyToMessageId: 'parent' });
    const unrelated = makeMessage({ messageId: 'other' });
    const result = selectBestMessages([trigger, replyTarget, unrelated], 'trigger', 5);
    const ids = result.map(m => m.messageId);
    expect(ids).toContain('parent');
  });

  it('fills remaining slots with most recent messages', () => {
    const messages = Array.from({ length: 10 }, (_, i) =>
      makeMessage({ messageId: `msg-${i}`, createdAt: new Date(Date.now() + i * 1000) })
    );
    const trigger = messages[5];
    const result = selectBestMessages(messages, trigger.messageId, 4);
    expect(result.length).toBeLessThanOrEqual(4);
  });

  it('handles fewer candidates than targetCount', () => {
    const messages = [
      makeMessage({ messageId: 'a' }),
      makeMessage({ messageId: 'b' }),
    ];
    const result = selectBestMessages(messages, 'a', 20);
    expect(result.length).toBe(2);
  });

  it('returns only the trigger when it is the sole candidate', () => {
    const trigger = makeMessage({ messageId: 'solo' });
    const result = selectBestMessages([trigger], 'solo', 5);
    expect(result.length).toBe(1);
    expect(result[0].messageId).toBe('solo');
  });

  it('does not exceed targetCount', () => {
    const messages = Array.from({ length: 30 }, (_, i) =>
      makeMessage({ messageId: `msg-${i}` })
    );
    const result = selectBestMessages(messages, 'msg-0', 10);
    expect(result.length).toBeLessThanOrEqual(10);
  });
});

// ============ formatTranscript ============

describe('formatTranscript', () => {
  it('returns empty string for empty message array', () => {
    expect(formatTranscript([])).toBe('');
  });

  it('formats a single message with author name and content', () => {
    const msg = makeMessage({ authorName: 'Alice', content: 'Hi there' });
    const result = formatTranscript([msg]);
    expect(result).toContain('Alice');
    expect(result).toContain('Hi there');
  });

  it('includes a time bracket in each line', () => {
    const msg = makeMessage();
    const result = formatTranscript([msg]);
    expect(result).toMatch(/\[\d{2}:\d{2}\]/);
  });

  it('marks bot messages with (bot) indicator', () => {
    const botMsg = makeMessage({ isBot: true, authorName: 'Mutumbot', content: 'I respond.' });
    const result = formatTranscript([botMsg]);
    expect(result).toContain('(bot)');
  });

  it('marks messages that mention the bot', () => {
    const msg = makeMessage({ mentionsBot: true, content: 'Hey bot!' });
    const result = formatTranscript([msg]);
    expect(result).toContain('(mentions bot)');
  });

  it('formats multiple messages as separate lines', () => {
    const msgs = [
      makeMessage({ messageId: 'a', content: 'First' }),
      makeMessage({ messageId: 'b', content: 'Second' }),
    ];
    const result = formatTranscript(msgs);
    const lines = result.split('\n');
    expect(lines.length).toBe(2);
  });
});

// ============ applyLengthBudget ============

describe('applyLengthBudget', () => {
  it('returns transcript unchanged when under budget', () => {
    const transcript = 'Short transcript.';
    const result = applyLengthBudget(transcript, 10000);
    expect(result).toBe(transcript);
  });

  it('returns transcript unchanged when exactly at budget', () => {
    const transcript = 'x'.repeat(100);
    const result = applyLengthBudget(transcript, 100);
    expect(result).toBe(transcript);
  });

  it('truncates transcript from the beginning when over budget', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `Line ${i}: ${'x'.repeat(50)}`);
    const transcript = lines.join('\n');
    const maxChars = 200;
    const result = applyLengthBudget(transcript, maxChars);
    expect(result.length).toBeLessThanOrEqual(maxChars);
  });

  it('keeps the most recent (last) lines when truncating', () => {
    const lines = ['old line one', 'old line two', 'recent line three', 'recent line four'];
    const transcript = lines.join('\n');
    // Budget large enough for two lines but not all four
    const maxChars = ('recent line three\nrecent line four').length;
    const result = applyLengthBudget(transcript, maxChars);
    expect(result).toContain('recent line four');
    expect(result).not.toContain('old line one');
  });
});

// ============ formatTime ============

describe('formatTime', () => {
  it('returns a string in HH:MM format', () => {
    const date = new Date('2024-06-15T09:05:00Z');
    const result = formatTime(date);
    // HH:MM — exactly 5 characters with a colon in position 2
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it('returns a string for midnight', () => {
    const date = new Date('2024-01-01T00:00:00Z');
    const result = formatTime(date);
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it('returns a string for end of day', () => {
    const date = new Date('2024-01-01T23:59:59Z');
    const result = formatTime(date);
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });
});
