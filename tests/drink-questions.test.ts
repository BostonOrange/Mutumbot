/**
 * Unit tests for pure exports in src/drink-questions.ts
 *
 * Only tests the module-level constants (TRIBUTE_SCORES) and the
 * synchronous pure function (handleDrinkList). All async functions
 * that require DB or AI API access are excluded here.
 *
 * The module imports db-dependent services, but none of them throw
 * at import time when DATABASE_URL is absent — they log and continue.
 */

import { describe, it, expect } from 'vitest';
import { TRIBUTE_SCORES, handleDrinkList } from '../src/drink-questions';

describe('TRIBUTE_SCORES', () => {
  it('should define the correct point value for TIKI drinks', () => {
    expect(TRIBUTE_SCORES.TIKI).toBe(10);
  });

  it('should define the correct point value for COCKTAIL drinks', () => {
    expect(TRIBUTE_SCORES.COCKTAIL).toBe(5);
  });

  it('should define the correct point value for BEER_WINE drinks', () => {
    expect(TRIBUTE_SCORES.BEER_WINE).toBe(2);
  });

  it('should define the correct point value for OTHER drinks', () => {
    expect(TRIBUTE_SCORES.OTHER).toBe(1);
  });

  it('should maintain descending point order: TIKI > COCKTAIL > BEER_WINE > OTHER', () => {
    expect(TRIBUTE_SCORES.TIKI).toBeGreaterThan(TRIBUTE_SCORES.COCKTAIL);
    expect(TRIBUTE_SCORES.COCKTAIL).toBeGreaterThan(TRIBUTE_SCORES.BEER_WINE);
    expect(TRIBUTE_SCORES.BEER_WINE).toBeGreaterThan(TRIBUTE_SCORES.OTHER);
  });

  it('should have all positive point values', () => {
    for (const value of Object.values(TRIBUTE_SCORES)) {
      expect(value).toBeGreaterThan(0);
    }
  });
});

describe('handleDrinkList', () => {
  it('should return an object with a content property', () => {
    const result = handleDrinkList();
    expect(result).toHaveProperty('content');
  });

  it('should return a non-empty content string', () => {
    const result = handleDrinkList();
    expect(typeof result.content).toBe('string');
    expect(result.content.trim().length).toBeGreaterThan(0);
  });

  it('should mention tiki drinks in the content', () => {
    const result = handleDrinkList();
    expect(result.content.toLowerCase()).toContain('tiki');
  });

  it('should mention rum in the content', () => {
    const result = handleDrinkList();
    expect(result.content.toLowerCase()).toContain('rum');
  });

  it('should mention the /ask command so users know how to interact', () => {
    const result = handleDrinkList();
    expect(result.content).toContain('/ask');
  });

  it('should be a deterministic pure function (same output on every call)', () => {
    const first = handleDrinkList();
    const second = handleDrinkList();
    expect(first.content).toBe(second.content);
  });
});
