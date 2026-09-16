import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeNextRun,
  countStatusEntries,
  extractDurationFromMonitorData,
  findMonitorByRef,
  formatLastRun,
  formatNextRun,
  formatRepeatInterval,
  parseLenientDate,
  resolveProgressMonitors,
  sumStatusCounts,
} from './etl-task-card.util';
import type { ETLMonitorDto } from '../../types/etl-monitor';

const NOW = new Date('2026-09-04T12:00:00');

function monitor(uuid: string, code?: string): ETLMonitorDto {
  return { uuid, name: uuid, monitorType: 'STATUS_CARD', code } as ETLMonitorDto;
}

const monitors = [monitor('uuid-1', 'alpha-monitor'), monitor('uuid-2', 'Beta Monitor')];

describe('etl-task-card.util', () => {
  beforeEach(() => {
    vi.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('parseLenientDate', () => {
    it('parses colon-less UTC offsets (OpenMRS serialization)', () => {
      expect(parseLenientDate('2026-09-04T09:12:00+0300')).not.toBeNull();
    });

    it('returns null for unusable values', () => {
      expect(parseLenientDate(null)).toBeNull();
      expect(parseLenientDate('')).toBeNull();
      expect(parseLenientDate('not-a-date')).toBeNull();
    });
  });

  describe('formatLastRun', () => {
    it('renders a dash for empty values', () => {
      expect(formatLastRun(null)).toBe('—');
      expect(formatLastRun(undefined)).toBe('—');
      expect(formatLastRun('')).toBe('—');
    });

    it('labels today and yesterday', () => {
      expect(formatLastRun('2026-09-04T09:12:00')).toBe('Today, 09:12');
      expect(formatLastRun('2026-09-03T23:05:00')).toBe('Yesterday, 23:05');
    });

    it('formats older dates with day and month', () => {
      expect(formatLastRun('2026-08-12T09:12:00')).toBe('12 Aug, 09:12');
    });

    it('passes garbage through as its string value', () => {
      expect(formatLastRun('not-a-date')).toBe('not-a-date');
    });
  });

  describe('computeNextRun', () => {
    it('adds the repeat interval to the last execution time', () => {
      expect(computeNextRun('2026-09-04T09:00:00', 1800)).toEqual(new Date('2026-09-04T09:30:00'));
      expect(computeNextRun('2026-09-04T09:00:00', 21600)).toEqual(new Date('2026-09-04T15:00:00'));
    });

    it('returns null for one-shot or invalid intervals', () => {
      expect(computeNextRun('2026-09-04T09:00:00', 0)).toBeNull();
      expect(computeNextRun('2026-09-04T09:00:00', -5)).toBeNull();
      expect(computeNextRun('2026-09-04T09:00:00', NaN)).toBeNull();
      expect(computeNextRun('2026-09-04T09:00:00', undefined)).toBeNull();
    });

    it('returns null without a last execution time', () => {
      expect(computeNextRun(null, 1800)).toBeNull();
      expect(computeNextRun('not-a-date', 1800)).toBeNull();
    });
  });

  describe('formatNextRun', () => {
    it('reports unscheduled tasks', () => {
      expect(formatNextRun(null)).toBe('Not scheduled');
    });

    it('formats a computed next run', () => {
      expect(formatNextRun(new Date('2026-09-04T13:00:00'))).toBe('Today, 13:00');
    });
  });

  describe('formatRepeatInterval', () => {
    it('renders a dash for absent or one-shot intervals', () => {
      expect(formatRepeatInterval(undefined)).toBe('—');
      expect(formatRepeatInterval(null)).toBe('—');
      expect(formatRepeatInterval(0)).toBe('—');
    });

    it('humanizes intervals', () => {
      expect(formatRepeatInterval(30)).toBe('Every 30 s');
      expect(formatRepeatInterval(1800)).toBe('Every 30 min');
      expect(formatRepeatInterval(21600)).toBe('Every 6 h');
      expect(formatRepeatInterval(172800)).toBe('Every 2 d');
      expect(formatRepeatInterval(5400)).toBe('Every 1.5 h');
    });
  });

  describe('findMonitorByRef', () => {
    it('returns undefined for empty or invalid references', () => {
      expect(findMonitorByRef(monitors, '')).toBeUndefined();
      expect(findMonitorByRef(monitors, '   ')).toBeUndefined();
      expect(findMonitorByRef(monitors, 5 as unknown as string)).toBeUndefined();
      expect(findMonitorByRef(monitors, undefined)).toBeUndefined();
    });

    it('is null-safe', () => {
      expect(findMonitorByRef(null, 'uuid-1')).toBeUndefined();
      expect(findMonitorByRef([], 'uuid-1')).toBeUndefined();
    });

    it('matches by uuid exactly and case-insensitively', () => {
      expect(findMonitorByRef(monitors, 'uuid-1')?.uuid).toBe('uuid-1');
      expect(findMonitorByRef(monitors, 'UUID-1')?.uuid).toBe('uuid-1');
    });

    it('matches by code case-insensitively', () => {
      expect(findMonitorByRef(monitors, 'beta monitor')?.uuid).toBe('uuid-2');
    });

    it('prefers uuid over code when both could match', () => {
      const both = [...monitors, monitor('uuid-3', 'uuid-2')];
      expect(findMonitorByRef(both, 'uuid-2')?.uuid).toBe('uuid-2');
    });
  });

  describe('resolveProgressMonitors', () => {
    it('returns an empty list for missing or empty refs', () => {
      expect(resolveProgressMonitors(monitors, undefined)).toEqual([]);
      expect(resolveProgressMonitors(monitors, [])).toEqual([]);
      expect(resolveProgressMonitors(monitors, ['   ', ''])).toEqual([]);
    });

    it('resolves refs in config order', () => {
      const resolved = resolveProgressMonitors(monitors, ['beta monitor', 'uuid-1']);
      expect(resolved.map((entry) => entry.monitor?.uuid)).toEqual(['uuid-2', 'uuid-1']);
    });

    it('deduplicates refs that resolve to the same monitor', () => {
      const resolved = resolveProgressMonitors(monitors, ['uuid-1', 'alpha-monitor']);
      expect(resolved).toHaveLength(1);
      expect(resolved[0].monitor?.uuid).toBe('uuid-1');
    });

    it('keeps unresolved refs visible for typos', () => {
      const resolved = resolveProgressMonitors(monitors, ['uuid-1', 'nope-monitor']);
      expect(resolved).toHaveLength(2);
      expect(resolved[1].monitor).toBeUndefined();
      expect(resolved[1].ref).toBe('nope-monitor');
    });
  });

  describe('extractDurationFromMonitorData', () => {
    it('returns null when nothing usable is found', () => {
      expect(extractDurationFromMonitorData(null)).toBeNull();
      expect(extractDurationFromMonitorData('string')).toBeNull();
      expect(extractDurationFromMonitorData({})).toBeNull();
      expect(extractDurationFromMonitorData({ status: 'ok', rows: 5 })).toBeNull();
    });

    it('formats top-level and nested durations as milliseconds', () => {
      expect(extractDurationFromMonitorData({ duration: 48000 })).toBe('48s');
      expect(extractDurationFromMonitorData({ summary: { durationMs: 48000 } })).toBe('48s');
      expect(extractDurationFromMonitorData({ totalDurationMillis: 134000 })).toBe('2m 14s');
    });

    it('scales seconds-named fields', () => {
      expect(extractDurationFromMonitorData({ durationSeconds: 48 })).toBe('48s');
    });

    it('passes pre-formatted strings through and parses numeric strings', () => {
      expect(extractDurationFromMonitorData({ duration: '2m 14s' })).toBe('2m 14s');
      expect(extractDurationFromMonitorData({ runtime: '48' })).toBe('48s');
    });

    it('skips null values and searches arrays', () => {
      expect(extractDurationFromMonitorData({ duration: null, elapsedMs: 61000 })).toBe('1m 1s');
      expect(extractDurationFromMonitorData([{ runtime: 65000 }])).toBe('1m 5s');
    });

    it('terminates on cyclic structures', () => {
      const cyclic: Record<string, unknown> = { status: 'running' };
      cyclic['self'] = cyclic;
      expect(extractDurationFromMonitorData(cyclic)).toBeNull();
    });
  });

  describe('countStatusEntries', () => {
    const RUNNING = /running|in.?progress|processing/i;
    const FAILED = /fail|error/i;

    it('counts status entries in arrays of job objects', () => {
      const raw = { jobs: [{ status: 'RUNNING' }, { status: 'COMPLETED' }, { status: 'Running' }] };
      expect(countStatusEntries(raw, RUNNING)).toBe(2);
      expect(countStatusEntries(raw, FAILED)).toBeUndefined();
    });

    it('reads numeric count fields keyed by the pattern', () => {
      expect(countStatusEntries({ runningCount: 3 }, RUNNING)).toBe(3);
      expect(countStatusEntries({ data: { failedCount: 2 } }, FAILED)).toBe(2);
    });

    it('returns undefined for empty or non-matching payloads', () => {
      expect(countStatusEntries(null, RUNNING)).toBeUndefined();
      expect(countStatusEntries('string', RUNNING)).toBeUndefined();
      expect(countStatusEntries({ status: 'ok' }, RUNNING)).toBeUndefined();
      expect(countStatusEntries({}, RUNNING)).toBeUndefined();
    });

    it('is cycle-safe', () => {
      const cyclic: Record<string, unknown> = { status: 'RUNNING' };
      cyclic['self'] = cyclic;
      expect(countStatusEntries(cyclic, RUNNING)).toBe(1);
    });
  });

  describe('sumStatusCounts', () => {
    it('sums across responses and skips signal-less ones', () => {
      const raws = [{ runningCount: 2 }, { jobs: [{ status: 'RUNNING' }] }, { nothing: 'here' }, null];
      expect(sumStatusCounts(raws, /running/i)).toBe(3);
    });

    it('returns undefined when no response yields a signal', () => {
      expect(sumStatusCounts([null, {}, 'x'], /running/i)).toBeUndefined();
      expect(sumStatusCounts([], /running/i)).toBeUndefined();
    });
  });
});
