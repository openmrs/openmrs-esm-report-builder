import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SECTIONS,
  extractMonitorLayout,
  normalizeSpan,
  OTHER_SECTION_KEY,
  parseDashboardConfig,
  resolveDashboardLayout,
  synthesizeEtlDashboardConfig,
} from './dashboard-config.util';
import type { ETLMonitorDto } from '../../../types/etl-monitor';
import type { ReportDto } from '../../../resources/report/reports.api';

function monitor(overrides: Partial<ETLMonitorDto> = {}): ETLMonitorDto {
  return {
    uuid: 'm-uuid',
    name: 'Monitor',
    displayConfigJson: JSON.stringify({
      schemaVersion: 2,
      component: 'TABLE',
      layout: { section: 'history', span: { sm: 4, md: 8, lg: 16 }, priority: 1 },
      fields: [],
    }),
    ...overrides,
  } as ETLMonitorDto;
}

function report(overrides: Partial<ReportDto> = {}): ReportDto {
  return { uuid: 'r-uuid', name: 'Report', ...overrides };
}

describe('parseDashboardConfig', () => {
  it('parses a valid v1 config', () => {
    const config = { schemaVersion: 1 as const, sections: [], widgets: [] };
    const result = parseDashboardConfig(JSON.stringify(config));
    expect(result.version).toBe(1);
    expect(result.config).toEqual(config);
  });

  it('rejects unparsable JSON', () => {
    const result = parseDashboardConfig('{oops');
    expect(result.version).toBe('unknown');
    expect(result.config).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('rejects unknown schema versions', () => {
    const result = parseDashboardConfig(JSON.stringify({ schemaVersion: 99 }));
    expect(result.version).toBe('unknown');
    expect(result.config).toBeNull();
  });

  it('treats empty/missing config as unknown', () => {
    expect(parseDashboardConfig(undefined).version).toBe('unknown');
    expect(parseDashboardConfig('  ').version).toBe('unknown');
    expect(parseDashboardConfig(null).config).toBeNull();
  });
});

describe('normalizeSpan', () => {
  it('clamps to breakpoint maxima', () => {
    expect(normalizeSpan({ sm: 9, md: 20, lg: 32 })).toEqual({ sm: 4, md: 8, lg: 16 });
  });

  it('fills missing values down the breakpoint chain', () => {
    expect(normalizeSpan({ sm: 2 })).toEqual({ sm: 2, md: 4, lg: 8 });
  });

  it('rescues a fully hidden desktop widget', () => {
    expect(normalizeSpan({ sm: 0, md: 0, lg: 0 }).lg).toBeGreaterThan(0);
    expect(normalizeSpan({ lg: 0 }, { lg: 12 }).lg).toBe(12);
  });

  it('uses the default span when none is given', () => {
    expect(normalizeSpan(undefined)).toEqual({ sm: 4, md: 8, lg: 8 });
  });
});

describe('extractMonitorLayout', () => {
  it('reads layout from a v2 display config', () => {
    const layout = extractMonitorLayout(monitor());
    expect(layout.section).toBe('history');
    expect(layout.span.lg).toBe(16);
  });

  it('falls back to defaults for unparsable configs', () => {
    const layout = extractMonitorLayout(monitor({ displayConfigJson: '{bad' }));
    expect(layout.section).toBe('overview'); // SUMMARY_CARD default
  });

  it('adapts legacy v1 configs before falling back', () => {
    const layout = extractMonitorLayout(
      monitor({
        monitorType: 'DATA_TABLE' as any,
        displayConfigJson: JSON.stringify({ columns: [{ key: 'a', header: 'A', jsonPath: '$.a' }] }),
      }),
    );
    // DATA_TABLE adapts to TABLE → history / lg 16
    expect(layout.section).toBe('history');
    expect(layout.span.lg).toBe(16);
  });
});

describe('resolveDashboardLayout', () => {
  it('synthesizes an auto-include config for missing/invalid configs', () => {
    const resolved = resolveDashboardLayout(null, [monitor()], []);
    expect(resolved.flags.configSynthesized).toBe(true);
    expect(resolved.sections).toHaveLength(1); // only history has slots
    expect(resolved.sections[0].key).toBe('history');
    expect(resolved.etlMonitors).toHaveLength(1);
  });

  it('auto-includes monitors into their builder-defined sections with their spans', () => {
    const resolved = resolveDashboardLayout(
      {
        schemaVersion: 1,
        sections: DEFAULT_SECTIONS.map((s) => ({ ...s })),
        widgets: [],
        autoInclude: { etlMonitors: { enabled: true } },
      },
      [
        monitor(),
        monitor({
          uuid: 'm2',
          name: 'Status',
          displayConfigJson: JSON.stringify({ schemaVersion: 2, component: 'STATUS_CARD', fields: [] }),
        }),
      ],
      [],
    );
    const history = resolved.sections.find((s) => s.key === 'history');
    const overview = resolved.sections.find((s) => s.key === 'overview');
    expect(history?.slots).toHaveLength(1);
    expect(history?.slots[0].span.lg).toBe(16);
    expect(overview?.slots).toHaveLength(1);
    expect(overview?.slots[0].explicit).toBe(false);
  });

  it('explicit widgets win over auto-include (no duplicates, by uuid and by code)', () => {
    const config = {
      schemaVersion: 1 as const,
      sections: [
        { key: 'overview', label: 'Overview', order: 10 },
        { key: 'history', label: 'History', order: 20 },
      ],
      widgets: [{ widgetType: 'ETL_MONITOR' as const, refUuid: 'm-uuid', sectionKey: 'overview' }],
      autoInclude: { etlMonitors: { enabled: true } },
    };
    const resolved = resolveDashboardLayout(config, [monitor(), monitor({ uuid: 'm2', name: 'Other' })], []);
    const allEtl = resolved.sections.flatMap((s) => s.slots).filter((s) => s.kind === 'ETL');
    expect(allEtl.filter((s) => s.monitor?.uuid === 'm-uuid')).toHaveLength(1);
    expect(allEtl.find((s) => s.monitor?.uuid === 'm-uuid')?.explicit).toBe(true);
    expect(allEtl.find((s) => s.monitor?.uuid === 'm-uuid')?.sectionKey).toBe('overview');
  });

  it('dedupes an explicit refCode placement against auto-include', () => {
    const config = {
      schemaVersion: 1 as const,
      widgets: [{ widgetType: 'ETL_MONITOR' as const, refCode: 'mon-code', sectionKey: 'overview' }],
      autoInclude: { etlMonitors: { enabled: true } },
    };
    const resolved = resolveDashboardLayout(config, [monitor({ code: 'mon-code' })], []);
    const etl = resolved.sections.flatMap((s) => s.slots).filter((s) => s.kind === 'ETL');
    expect(etl).toHaveLength(1);
  });

  it('routes unknown section keys into the Other bucket, rendered last', () => {
    const config = {
      schemaVersion: 1 as const,
      sections: [{ key: 'overview', label: 'Overview', order: 10 }],
      widgets: [{ widgetType: 'ETL_MONITOR' as const, refUuid: 'm-uuid', sectionKey: 'nope' }],
    };
    const resolved = resolveDashboardLayout(config, [monitor()], []);
    expect(resolved.sections[resolved.sections.length - 1].key).toBe(OTHER_SECTION_KEY);
    expect(resolved.sections[resolved.sections.length - 1].slots).toHaveLength(1);
  });

  it('keeps grid geometry for missing refs (UNAVAILABLE slots)', () => {
    const config = {
      schemaVersion: 1 as const,
      sections: [{ key: 'history', label: 'History', order: 10 }],
      widgets: [{ widgetType: 'ETL_MONITOR' as const, refUuid: 'gone', sectionKey: 'history' }],
    };
    const resolved = resolveDashboardLayout(config, [], []);
    expect(resolved.sections[0].slots[0].status).toBe('UNAVAILABLE');
    expect(resolved.sections[0].slots[0].unavailableReason).toBe('monitor-missing');
    expect(resolved.etlMonitors).toHaveLength(0);
  });

  it('flags unsupported widget types and skips rendering them', () => {
    const config = {
      schemaVersion: 1 as const,
      sections: [{ key: 'overview', label: 'Overview', order: 10 }],
      widgets: [{ widgetType: 'TEXT' } as any],
    };
    const resolved = resolveDashboardLayout(config, [], []);
    expect(resolved.flags.hadUnknownWidgetTypes).toBe(true);
    expect(resolved.sections[0].slots[0].status).toBe('UNSUPPORTED');
  });

  it('prunes empty sections unless alwaysShow', () => {
    const config = {
      schemaVersion: 1 as const,
      sections: [
        { key: 'overview', label: 'Overview', order: 10 },
        { key: 'errors', label: 'Errors', order: 20, alwaysShow: true },
      ],
      widgets: [],
      autoInclude: { etlMonitors: { enabled: false } },
    };
    const resolved = resolveDashboardLayout(config, [], []);
    expect(resolved.sections.map((s) => s.key)).toEqual(['errors']);
  });

  it('orders slots explicit-first, then by order/priority/title', () => {
    const autoMonitor = monitor({
      uuid: 'auto',
      name: 'beta auto',
      displayConfigJson: JSON.stringify({
        schemaVersion: 2,
        component: 'STATUS_CARD',
        layout: { section: 'overview', span: {}, priority: 5 },
        fields: [],
      }),
    });
    const config = {
      schemaVersion: 1 as const,
      sections: [{ key: 'overview', label: 'Overview', order: 10 }],
      widgets: [
        {
          widgetType: 'ETL_MONITOR' as const,
          refUuid: 'm-uuid',
          sectionKey: 'overview',
          order: 200,
          titleOverride: 'second',
        },
        {
          widgetType: 'ETL_MONITOR' as const,
          refUuid: 'm2',
          sectionKey: 'overview',
          order: 100,
          titleOverride: 'first',
        },
      ],
      autoInclude: { etlMonitors: { enabled: true } },
    };
    const resolved = resolveDashboardLayout(config, [monitor(), monitor({ uuid: 'm2', name: 'M2' }), autoMonitor], []);
    const titles = resolved.sections[0].slots.map((s) => s.title);
    expect(titles).toEqual(['first', 'second', 'beta auto']);
  });

  it('computes minRefreshInterval from included ETL monitors, clamped >= 5', () => {
    const resolved = resolveDashboardLayout(
      { schemaVersion: 1, widgets: [], autoInclude: { etlMonitors: { enabled: true } } },
      [monitor({ refreshInterval: 3 }), monitor({ uuid: 'm2', name: 'B', refreshInterval: 60 })],
      [],
    );
    expect(resolved.minRefreshInterval).toBe(5);

    const empty = resolveDashboardLayout({ schemaVersion: 1, widgets: [] }, [], []);
    expect(empty.minRefreshInterval).toBe(30);
  });

  it('resolves REPORT widgets, including missing ones', () => {
    const config = {
      schemaVersion: 1 as const,
      sections: [{ key: 'overview', label: 'Overview', order: 10 }],
      widgets: [
        { widgetType: 'REPORT' as const, refUuid: 'r-uuid', sectionKey: 'overview' },
        { widgetType: 'REPORT' as const, refCode: 'gone', sectionKey: 'overview' },
      ],
    };
    const resolved = resolveDashboardLayout(config, [], [report()]);
    const slots = resolved.sections[0].slots;
    expect(slots[0].status).toBe('OK');
    expect(slots[0].report?.name).toBe('Report');
    expect(slots[1].status).toBe('UNAVAILABLE');
    expect(slots[1].unavailableReason).toBe('report-missing');
  });

  it('synthesizeEtlDashboardConfig auto-includes with no explicit widgets', () => {
    const config = synthesizeEtlDashboardConfig();
    expect(config.autoInclude?.etlMonitors?.enabled).toBe(true);
    expect(config.widgets).toHaveLength(0);
  });
});
