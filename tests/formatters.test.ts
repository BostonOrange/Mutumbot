/**
 * Unit tests for src/formatters.ts
 *
 * formatters.ts imports a type (LeaderboardEntry) from src/db.ts.
 * db.ts creates a postgres client at module load time but does so
 * inside a try/catch and only logs (never throws) when DATABASE_URL
 * is absent, so the import is safe without a real database.
 */

import { describe, it, expect } from 'vitest';
import { formatPersonalStats, formatLeaderboard, type StatsData } from '../src/formatters';
import type { LeaderboardEntry } from '../src/db';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeStats(overrides: Partial<StatsData> = {}): StatsData {
  return {
    allTime: { score: 0, count: 0 },
    daily: { score: 0, count: 0 },
    friday: { score: 0, count: 0 },
    private: { score: 0, count: 0 },
    ...overrides,
  };
}

function makeEntry(username: string, score: number, count: number): LeaderboardEntry {
  return { userId: String(Math.random()), username, score, count };
}

// ─── formatPersonalStats ────────────────────────────────────────────────────

describe('formatPersonalStats', () => {
  it('should include the username in the output', () => {
    const result = formatPersonalStats('TestUser', makeStats(), '');
    expect(result).toContain('TestUser');
  });

  it('should combine public and private scores for the all-time total', () => {
    const stats = makeStats({
      allTime: { score: 100, count: 10 },
      private: { score: 20, count: 2 },
    });
    const result = formatPersonalStats('TestUser', stats, '#1');
    expect(result).toContain('120');
    expect(result).toContain('12');
  });

  it('should include the rank text when provided', () => {
    const stats = makeStats({ allTime: { score: 100, count: 10 } });
    const result = formatPersonalStats('TestUser', stats, '#3 of 10');
    expect(result).toContain('#3 of 10');
  });

  it('should not include a rank section when rank text is empty', () => {
    const stats = makeStats({ allTime: { score: 100, count: 10 } });
    const result = formatPersonalStats('TestUser', stats, '');
    // An empty rank string should not inject a stray dash
    expect(result).not.toMatch(/- $/m);
  });

  it('should handle zero stats gracefully', () => {
    const result = formatPersonalStats('NewUser', makeStats(), '');
    expect(result).toContain('NewUser');
    expect(result).toContain('0');
  });

  it('should include the scoring legend', () => {
    const result = formatPersonalStats('AnyUser', makeStats(), '');
    expect(result).toContain('Tiki=10pts');
  });

  it('should include Friday stats', () => {
    const stats = makeStats({ friday: { score: 50, count: 5 } });
    const result = formatPersonalStats('TestUser', stats, '');
    expect(result).toContain('50');
    expect(result).toContain('5');
  });

  it('should return a string', () => {
    const result = formatPersonalStats('TestUser', makeStats(), '');
    expect(typeof result).toBe('string');
  });
});

// ─── formatLeaderboard ──────────────────────────────────────────────────────

describe('formatLeaderboard', () => {
  it('should return a string', () => {
    expect(typeof formatLeaderboard([], [], [])).toBe('string');
  });

  it('should handle all-empty leaderboards without throwing', () => {
    const result = formatLeaderboard([], [], []);
    expect(result.length).toBeGreaterThan(0);
  });

  it('should show a hunger message when the all-time list is empty', () => {
    const result = formatLeaderboard([], [], []);
    expect(result.toLowerCase()).toContain('hunger');
  });

  it('should include userId mentions from the all-time leaderboard', () => {
    // formatLeaderboard renders entries as <@userId> Discord mentions, not plain usernames
    const entry1 = { userId: 'uid-111', username: 'User1', score: 100, count: 10 };
    const entry2 = { userId: 'uid-222', username: 'User2', score: 50, count: 5 };
    const result = formatLeaderboard([entry1, entry2], [], []);
    expect(result).toContain('<@uid-111>');
    expect(result).toContain('<@uid-222>');
  });

  it('should include scores from the all-time leaderboard', () => {
    const allTime = [makeEntry('TopUser', 999, 99)];
    const result = formatLeaderboard(allTime, [], []);
    expect(result).toContain('999');
  });

  it('should include daily entries (as userId mentions) when provided', () => {
    const daily = [{ userId: 'daily-uid', username: 'DailyChamp', score: 30, count: 3 }];
    const result = formatLeaderboard([], daily, []);
    expect(result).toContain('<@daily-uid>');
  });

  it('should include friday entries (as userId mentions) when provided', () => {
    const friday = [{ userId: 'fri-uid', username: 'FridayLegend', score: 80, count: 8 }];
    const result = formatLeaderboard([], [], friday);
    expect(result).toContain('<@fri-uid>');
  });

  it('should not show daily section when daily list is empty', () => {
    const allTime = [makeEntry('User1', 100, 10)];
    const result = formatLeaderboard(allTime, [], []);
    expect(result).not.toContain("Today's Devoted");
  });

  it('should not show friday section when friday list is empty', () => {
    const result = formatLeaderboard([], [], []);
    expect(result).not.toContain('Friday Champions');
  });
});
