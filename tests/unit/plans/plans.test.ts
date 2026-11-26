import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAN, PLAN_FAILURE_CODES, PLAN_IDS, PLANS, planLimitsFor } from '@/lib/plans';

describe('plan configuration', () => {
  it('declares the free and plus tiers', () => {
    expect([...PLAN_IDS]).toEqual(['free', 'plus']);
    expect(Object.keys(PLANS).sort()).toEqual(['free', 'plus']);
  });

  it('uses positive limits everywhere', () => {
    for (const [id, limits] of Object.entries(PLANS)) {
      expect(limits.storageBytes, id).toBeGreaterThan(0);
      expect(limits.lessons, id).toBeGreaterThan(0);
      expect(limits.maxMaterialChars, id).toBeGreaterThan(0);
      expect(limits.dailyLessonGenerations, id).toBeGreaterThan(0);
    }
  });

  it('derives the daily generation allowance from the lesson storage quota', () => {
    // The pinned rule (Step 9): the daily allowance equals the tier's maximum
    // lesson quota unless a tier overrides it explicitly.
    for (const limits of Object.values(PLANS)) {
      expect(limits.dailyLessonGenerations).toBe(limits.lessons);
    }
    expect(PLANS.free.storageBytes).toBeLessThan(PLANS.plus.storageBytes);
    expect(PLANS.free.lessons).toBeLessThan(PLANS.plus.lessons);
  });

  it('applies the same storage conditions to every tier', () => {
    const charLimits = new Set(Object.values(PLANS).map((limits) => limits.maxMaterialChars));
    expect(charLimits.size).toBe(1);
  });

  it('falls back to the default plan for unknown or missing values', () => {
    expect(planLimitsFor('enterprise')).toBe(PLANS[DEFAULT_PLAN]);
    expect(planLimitsFor(null)).toBe(PLANS[DEFAULT_PLAN]);
    expect(planLimitsFor(undefined)).toBe(PLANS[DEFAULT_PLAN]);
    expect(planLimitsFor('plus')).toBe(PLANS.plus);
    expect(planLimitsFor('free')).toBe(PLANS.free);
  });

  it('declares distinct machine-readable failure codes', () => {
    const codes = Object.values(PLAN_FAILURE_CODES);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code).toMatch(/^plan_[a-z_]+$/);
    }
  });

  it('caps quizzes and their source lessons per tier (TODO step 14)', () => {
    expect(PLANS.free.quizzes).toBe(3);
    expect(PLANS.plus.quizzes).toBe(5);
    expect(PLANS.free.quizzes).toBeLessThan(PLANS.plus.quizzes);
    expect(PLANS.free.maxQuizSources).toBe(3);
    expect(PLANS.plus.maxQuizSources).toBe(7);
    expect(PLANS.free.maxQuizSources).toBeLessThan(PLANS.plus.maxQuizSources);
  });
});
