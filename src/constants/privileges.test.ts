import { describe, expect, it } from 'vitest';
import { RB, RB_PREFIX, ROUTE_PRIVILEGES, rbDisplay } from './privileges';

describe('privilege catalog', () => {
  it('declares exactly the 46 backend privileges', () => {
    expect(Object.keys(RB)).toHaveLength(46);
  });

  it('builds every privilege from the canonical prefix', () => {
    for (const value of Object.values(RB)) {
      expect(value.startsWith(RB_PREFIX)).toBe(true);
      // Backend suffixes are lowercase dotted domains/actions
      expect(value).toMatch(/^Task: reportbuilder\.[a-z.]+$/);
    }
  });

  it('keeps report.view matching the backend contract verbatim', () => {
    expect(RB.REPORT_VIEW).toBe('Task: reportbuilder.report.view');
    expect(RB.REPORT_EDIT).toBe('Task: reportbuilder.report.edit');
    expect(RB.SQL_EXECUTE).toBe('Task: reportbuilder.sql.execute');
    expect(RB.PACKAGE_IMPORT).toBe('Task: reportbuilder.package.import');
  });

  it('strips the prefix for display', () => {
    expect(rbDisplay(RB.REPORT_EDIT)).toBe('report.edit');
  });
});

describe('route privilege map', () => {
  it('always requires at least one privilege per guarded route', () => {
    for (const [route, required] of Object.entries(ROUTE_PRIVILEGES)) {
      expect(required.length).toBeGreaterThan(0);
      for (const privilege of required) {
        expect(Object.values(RB)).toContain(privilege);
      }
      expect(route).toMatch(/^\//);
    }
  });

  it('covers the landing, run, and admin landing routes', () => {
    expect(ROUTE_PRIVILEGES['/']).toEqual([RB.REPORT_VIEW]);
    expect(ROUTE_PRIVILEGES['/run']).toEqual([RB.REPORT_RUN]);
    expect(ROUTE_PRIVILEGES['/admin']).toEqual([RB.REPORT_VIEW]);
  });

  it('gives import-export OR semantics (either package privilege)', () => {
    expect(ROUTE_PRIVILEGES['/import-export']).toEqual([RB.PACKAGE_IMPORT, RB.PACKAGE_EXPORT]);
  });

  it('does not guard redirect-only routes', () => {
    expect(ROUTE_PRIVILEGES['/themes']).toBeUndefined();
    expect(ROUTE_PRIVILEGES['*']).toBeUndefined();
  });
});
