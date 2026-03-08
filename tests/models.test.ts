/**
 * Unit tests for src/models.ts
 *
 * Validates the integrity of the SUPPORTED_MODELS registry.
 * Pure data module — no DB or API access required.
 */

import { describe, it, expect } from 'vitest';
import { SUPPORTED_MODELS, supportsVision, formatPrice, formatTokenCount } from '../src/models';

describe('SUPPORTED_MODELS registry', () => {
  it('should have at least one model', () => {
    expect(SUPPORTED_MODELS.length).toBeGreaterThan(0);
  });

  it('every model should have all required fields with valid values', () => {
    for (const model of SUPPORTED_MODELS) {
      expect(model.id, `${model.id} missing id`).toBeTruthy();
      expect(model.name, `${model.id} missing name`).toBeTruthy();
      expect(model.provider, `${model.id} missing provider`).toBeTruthy();
      expect(model.description, `${model.id} missing description`).toBeTruthy();
      expect(model.maxInputTokens, `${model.id} invalid maxInputTokens`).toBeGreaterThan(0);
      expect(model.maxOutputTokens, `${model.id} invalid maxOutputTokens`).toBeGreaterThan(0);
      expect(model.inputPricePerM, `${model.id} invalid inputPricePerM`).toBeGreaterThanOrEqual(0);
      expect(model.outputPricePerM, `${model.id} invalid outputPricePerM`).toBeGreaterThanOrEqual(0);
      expect(model.inputModalities.length, `${model.id} has no inputModalities`).toBeGreaterThan(0);
      expect(model.inputModalities, `${model.id} missing text modality`).toContain('text');
      expect(Array.isArray(model.nativeTools), `${model.id} nativeTools is not an array`).toBe(true);
    }
  });

  it('should have unique model IDs', () => {
    const ids = SUPPORTED_MODELS.map(m => m.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('should include the default Mutumbot model (google/gemini-2.5-flash-lite)', () => {
    const defaultModel = SUPPORTED_MODELS.find(m => m.id === 'google/gemini-2.5-flash-lite');
    expect(defaultModel).toBeDefined();
  });

  it('the default model should support image input', () => {
    const defaultModel = SUPPORTED_MODELS.find(m => m.id === 'google/gemini-2.5-flash-lite');
    expect(defaultModel?.inputModalities).toContain('image');
  });

  it('should have at least one model with image input support', () => {
    const imageModels = SUPPORTED_MODELS.filter(m => m.inputModalities.includes('image'));
    expect(imageModels.length).toBeGreaterThan(0);
  });

  it('every model tier should be one of the valid tiers', () => {
    const validTiers = new Set(['free', 'low', 'medium', 'high']);
    for (const model of SUPPORTED_MODELS) {
      expect(validTiers.has(model.tier), `${model.id} has invalid tier: ${model.tier}`).toBe(true);
    }
  });

  it('every model speed should be one of the valid speeds', () => {
    const validSpeeds = new Set(['fast', 'medium', 'slow']);
    for (const model of SUPPORTED_MODELS) {
      expect(validSpeeds.has(model.speed), `${model.id} has invalid speed: ${model.speed}`).toBe(true);
    }
  });
});

describe('supportsVision', () => {
  it('should return true for models with image in inputModalities', () => {
    const model = SUPPORTED_MODELS.find(m => m.inputModalities.includes('image'))!;
    expect(supportsVision(model)).toBe(true);
  });

  it('should return false for models without image in inputModalities', () => {
    const model = SUPPORTED_MODELS.find(m => !m.inputModalities.includes('image'))!;
    if (model) {
      expect(supportsVision(model)).toBe(false);
    }
    // If all models support vision, skip rather than fail
  });
});

describe('formatPrice', () => {
  it('should return "Free" for zero-cost models', () => {
    expect(formatPrice(0)).toBe('Free');
  });

  it('should format typical prices with a dollar sign and two decimal places', () => {
    expect(formatPrice(1.25)).toBe('$1.25');
    expect(formatPrice(0.15)).toBe('$0.15');
  });

  it('should use three decimal places for sub-cent prices', () => {
    expect(formatPrice(0.001)).toBe('$0.001');
  });
});

describe('formatTokenCount', () => {
  it('should format million-scale counts as M', () => {
    expect(formatTokenCount(1_000_000)).toBe('1M');
    expect(formatTokenCount(1_048_576)).toContain('M');
  });

  it('should format thousand-scale counts as K', () => {
    expect(formatTokenCount(128_000)).toBe('128K');
    expect(formatTokenCount(16_384)).toBe('16K');
  });
});
