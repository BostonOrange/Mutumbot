/**
 * Unit tests for keyword routing functions in src/gateway/mentionHandler.ts
 *
 * Tests only the pure classification helpers. No Discord client, DB, or API
 * access required — these functions take a string and return a boolean.
 */

import { describe, it, expect } from 'vitest';
import {
  isStatusQuery,
  isPersonalStatsQuery,
  isLeaderboardQuery,
  needsTributeContext,
} from '../src/gateway/mentionHandler';

// ============ isStatusQuery ============

describe('isStatusQuery', () => {
  it('matches "tribute status"', () => {
    expect(isStatusQuery('tribute status')).toBe(true);
  });

  it('matches "friday status"', () => {
    expect(isStatusQuery('friday status')).toBe(true);
  });

  it('matches "who has offered"', () => {
    expect(isStatusQuery('who has offered')).toBe(true);
  });

  it('matches "any tributes"', () => {
    expect(isStatusQuery('any tributes today?')).toBe(true);
  });

  it('matches "offerings today"', () => {
    expect(isStatusQuery('any offerings today?')).toBe(true);
  });

  it('returns false for generic greeting', () => {
    expect(isStatusQuery('hello there')).toBe(false);
  });

  it('returns false for drink question', () => {
    expect(isStatusQuery('what is a mai tai')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isStatusQuery('')).toBe(false);
  });
});

// ============ isPersonalStatsQuery ============

describe('isPersonalStatsQuery', () => {
  it('matches "my stats"', () => {
    expect(isPersonalStatsQuery('my stats please')).toBe(true);
  });

  it('matches "my score"', () => {
    expect(isPersonalStatsQuery('what is my score')).toBe(true);
  });

  it('matches "how many tributes"', () => {
    expect(isPersonalStatsQuery('how many tributes have i done')).toBe(true);
  });

  it('matches "my devotion"', () => {
    expect(isPersonalStatsQuery('show my devotion')).toBe(true);
  });

  it('returns false for "the stats" (not personal)', () => {
    expect(isPersonalStatsQuery('show the stats')).toBe(false);
  });

  it('returns false for "your score" (not personal)', () => {
    expect(isPersonalStatsQuery('what is your score')).toBe(false);
  });

  it('returns false for unrelated message', () => {
    expect(isPersonalStatsQuery('make me a cocktail')).toBe(false);
  });
});

// ============ isLeaderboardQuery ============

describe('isLeaderboardQuery', () => {
  it('matches "leaderboard"', () => {
    expect(isLeaderboardQuery('show the leaderboard')).toBe(true);
  });

  it('matches "rankings"', () => {
    expect(isLeaderboardQuery('show rankings')).toBe(true);
  });

  it('matches "who is winning"', () => {
    expect(isLeaderboardQuery('who is winning')).toBe(true);
  });

  it('matches "most devoted"', () => {
    expect(isLeaderboardQuery('who is most devoted')).toBe(true);
  });

  it('matches "the tally"', () => {
    expect(isLeaderboardQuery('show the tally')).toBe(true);
  });

  it('returns false for generic greeting', () => {
    expect(isLeaderboardQuery('hello')).toBe(false);
  });

  it('returns false for drink question', () => {
    expect(isLeaderboardQuery('what drink should i make')).toBe(false);
  });
});

// ============ needsTributeContext ============

describe('needsTributeContext', () => {
  it('matches "tribute"', () => {
    expect(needsTributeContext('tribute time')).toBe(true);
  });

  it('matches "score"', () => {
    expect(needsTributeContext('what is my score')).toBe(true);
  });

  it('matches "points"', () => {
    expect(needsTributeContext('how many points')).toBe(true);
  });

  it('matches "friday"', () => {
    expect(needsTributeContext('what happens on friday')).toBe(true);
  });

  it('matches "devotion"', () => {
    expect(needsTributeContext('tell me about devotion')).toBe(true);
  });

  it('matches "ranking"', () => {
    expect(needsTributeContext('what is my ranking')).toBe(true);
  });

  it('returns false for generic greeting', () => {
    expect(needsTributeContext('hello')).toBe(false);
  });

  it('returns false for cocktail recipe question', () => {
    expect(needsTributeContext('what is a cocktail')).toBe(false);
  });

  it('returns false for help request', () => {
    expect(needsTributeContext('help me')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(needsTributeContext('')).toBe(false);
  });
});
