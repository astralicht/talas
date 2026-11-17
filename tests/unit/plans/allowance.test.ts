import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  allowanceUsage,
  refundLessonGeneration,
  reserveLessonGeneration,
  resetAllowanceForTests,
} from '@/lib/plans/allowance';

const USER = '507f1f77bcf86cd799439011';

beforeEach(() => {
  resetAllowanceForTests();
});

afterEach(() => {
  vi.useRealTimers();
  resetAllowanceForTests();
});

describe('daily generation allowance (memory store)', () => {
  it('reserves points until the daily limit is reached', async () => {
    const first = await reserveLessonGeneration(USER, 2);
    expect(first.reserved).toBe(true);
    expect(first.used).toBe(1);

    const second = await reserveLessonGeneration(USER, 2);
    expect(second.reserved).toBe(true);
    expect(second.used).toBe(2);

    const third = await reserveLessonGeneration(USER, 2);
    expect(third.reserved).toBe(false);
    expect(third.used).toBe(2);
  });

  it('reports the next UTC midnight as the reset time', async () => {
    const blocked = await reserveLessonGeneration(USER, 1);
    const second = await reserveLessonGeneration(USER, 1);
    expect(second.reserved).toBe(false);

    const resetIso = second.resetsAt.toISOString();
    expect(resetIso).toBe(blocked.resetsAt.toISOString());
    // resetsAt is the upcoming UTC midnight (00:00:00.000Z).
    expect(resetIso.endsWith('T00:00:00.000Z')).toBe(true);
    expect(second.resetsAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('refunds a reservation and floors at zero', async () => {
    await reserveLessonGeneration(USER, 1);
    await refundLessonGeneration(USER);
    const usage = await allowanceUsage(USER);
    expect(usage.used).toBe(0);

    // Refunding an empty counter is a no-op, never negative.
    await refundLessonGeneration(USER);
    expect((await allowanceUsage(USER)).used).toBe(0);

    // A refunded point is available again.
    const again = await reserveLessonGeneration(USER, 1);
    expect(again.reserved).toBe(true);
  });

  it('starts a fresh counter after the UTC day rolls over', async () => {
    await reserveLessonGeneration(USER, 1);
    const exhausted = await reserveLessonGeneration(USER, 1);
    expect(exhausted.reserved).toBe(false);

    // Simulate the clock crossing UTC midnight (fake Date only).
    const tomorrow = new Date(Date.now() + 26 * 60 * 60 * 1000);
    vi.useFakeTimers({ now: tomorrow, toFake: ['Date'] });

    const next = await reserveLessonGeneration(USER, 1);
    expect(next.reserved).toBe(true);
    expect(next.used).toBe(1);
  });

  it('isolates counters per user', async () => {
    await reserveLessonGeneration(USER, 1);
    const other = await reserveLessonGeneration('507f1f77bcf86cd799439012', 1);
    expect(other.reserved).toBe(true);
  });

  it('exposes the usage view for badges and the usage endpoint', async () => {
    expect((await allowanceUsage(USER)).used).toBe(0);
    await reserveLessonGeneration(USER, 5);
    expect((await allowanceUsage(USER)).used).toBe(1);
  });
});
