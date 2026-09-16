import { describe, expect, it } from 'vitest';
import {
  groupTablesBySource,
  tableNameMatchesPattern,
  quoteTableIdentifier,
  buildTablePreviewSql,
  escapeCsvCell,
  toCsv,
  summarizeColumns,
  OTHER_GROUP_ID,
} from './';
import type { SchemaTable } from '../../resources/theme/etl-schema.api';
import type { ETLSourceDto } from '../../resources/etl-source/etl-source.api';
import type { TableColumn } from '../../resources/theme/etl-table-meta.api';

function table(name: string, extra: Partial<SchemaTable> = {}): SchemaTable {
  return { name, ...extra };
}

function source(uuid: string, name: string, tablePatterns: string, extra: Partial<ETLSourceDto> = {}): ETLSourceDto {
  return { uuid, name, tablePatterns, ...extra } as ETLSourceDto;
}

describe('tableNameMatchesPattern', () => {
  it('matches prefixes case-insensitively', () => {
    expect(tableNameMatchesPattern('mamba_visits', 'mamba')).toBe(true);
    expect(tableNameMatchesPattern('Mamba_Visits', 'MAMBA')).toBe(true);
    expect(tableNameMatchesPattern('other_table', 'mamba')).toBe(false);
  });

  it('treats % and _ as live wildcards like the server LIKE', () => {
    expect(tableNameMatchesPattern('fact_encounter', 'fact_%')).toBe(true);
    expect(tableNameMatchesPattern('fact_x', 'fact_')).toBe(true);
    expect(tableNameMatchesPattern('fact', 'fact_')).toBe(false);
  });

  it('rejects empty patterns and names', () => {
    expect(tableNameMatchesPattern('mamba_visits', '   ')).toBe(false);
    expect(tableNameMatchesPattern('', 'mamba')).toBe(false);
  });
});

describe('groupTablesBySource', () => {
  const sources = [source('uuid-1', 'Mamba', 'mamba'), source('uuid-2', 'Analytics', 'analytics, etl_flattened')];

  it('groups tables under the first matching source', () => {
    const tables = [table('mamba_visits'), table('mamba_ops'), table('analytics_daily'), table('etl_flattened_x')];
    const { groups, other } = groupTablesBySource(tables, sources);

    expect(groups[0].tables.map((t) => t.name)).toEqual(['mamba_visits', 'mamba_ops']);
    expect(groups[1].tables.map((t) => t.name)).toEqual(['analytics_daily', 'etl_flattened_x']);
    expect(other.tables).toHaveLength(0);
  });

  it('ignores inactive or voided sources', () => {
    const sourcesWithInactive = [...sources, source('uuid-3', 'Retired', 'fact_', { active: false })];
    const { groups, other } = groupTablesBySource([table('fact_encounter')], sourcesWithInactive);

    expect(groups.find((g) => g.id === 'uuid-3')).toBeUndefined();
    expect(other.tables.map((t) => t.name)).toEqual(['fact_encounter']);
  });

  it('collects unmatched tables in Other', () => {
    const { other } = groupTablesBySource([table('misc_things'), table('mamba_visits')], sources);
    expect(other.id).toBe(OTHER_GROUP_ID);
    expect(other.tables.map((t) => t.name)).toEqual(['misc_things']);
  });

  it('keeps empty groups for sources that match nothing', () => {
    const { groups } = groupTablesBySource([table('misc_things')], sources);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.tables.length === 0)).toBe(true);
  });

  it('handles empty inputs', () => {
    expect(groupTablesBySource([], sources).other.tables).toHaveLength(0);
    const { groups, other } = groupTablesBySource([table('x')], []);
    expect(groups).toHaveLength(0);
    expect(other.tables).toHaveLength(1);
  });
});

describe('quoteTableIdentifier / buildTablePreviewSql', () => {
  it('backtick-quotes plain names', () => {
    expect(quoteTableIdentifier('fact_encounter')).toBe('`fact_encounter`');
    expect(buildTablePreviewSql('fact_encounter')).toBe('SELECT * FROM `fact_encounter`');
  });

  it('doubles embedded backticks', () => {
    expect(quoteTableIdentifier('we`ird')).toBe('`we``ird`');
  });

  it('throws on empty names', () => {
    expect(() => quoteTableIdentifier('')).toThrow();
    expect(() => quoteTableIdentifier('   ')).toThrow();
  });
});

describe('escapeCsvCell / toCsv', () => {
  it('passes plain cells through and renders null as empty', () => {
    expect(escapeCsvCell('plain')).toBe('plain');
    expect(escapeCsvCell(-15)).toBe('-15');
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
  });

  it('quotes cells with special characters and doubles quotes', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell('line\nbreak')).toBe('"line\nbreak"');
  });

  it('guards formula-injection prefixes but keeps negatives', () => {
    expect(escapeCsvCell('=cmd')).toBe("'=cmd");
    expect(escapeCsvCell('+2')).toBe("'+2");
    expect(escapeCsvCell('@risk')).toBe("'@risk");
  });

  it('serializes header plus rows', () => {
    expect(
      toCsv(
        ['a', 'b'],
        [
          [1, 'x,y'],
          [null, 'z'],
        ],
      ),
    ).toBe('a,b\n1,"x,y"\n,z');
  });
});

describe('summarizeColumns', () => {
  const columns: TableColumn[] = [
    { name: 'id', type: 'int' },
    { name: 'patient_id', type: 'int' },
    { name: 'name', type: 'varchar' },
    { name: 'note', type: 'text' },
    { name: 'flag' },
  ];

  it('counts totals and breaks down by type, sorted by count desc', () => {
    const summary = summarizeColumns(columns);
    expect(summary.total).toBe(5);
    expect(summary.byType[0]).toEqual({ type: 'int', count: 2 });
    expect(summary.byType.map((t) => t.type)).toEqual(['int', 'text', 'unknown', 'varchar']);
  });

  it('handles empty input', () => {
    expect(summarizeColumns([])).toEqual({ total: 0, byType: [] });
  });
});
