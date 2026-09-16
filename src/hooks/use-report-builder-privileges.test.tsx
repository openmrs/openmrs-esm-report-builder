import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useSession } from '@openmrs/esm-framework';
import { describe, expect, it, vi } from 'vitest';
import { useReportBuilderPrivileges } from './use-report-builder-privileges';
import { RB } from '../constants/privileges';

const mockUseSession = vi.mocked(useSession);

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const priv = (name: string) => ({ uuid: name, name, display: name });

function renderHook<T>(hook: () => T): { current: T | undefined; rerender: () => void; unmount: () => void } {
  const container = document.createElement('div');
  const root = createRoot(container);
  let current: T | undefined;
  const Probe = () => {
    current = hook();
    return null;
  };
  const render = () =>
    act(() => {
      root.render(React.createElement(Probe));
    });
  render();
  return {
    get current() {
      return current;
    },
    rerender: render,
    unmount: () => act(() => root.unmount()),
  };
}

function sessionWith(privileges: string[], roles: string[] = [], authenticated = true) {
  return {
    authenticated,
    user: {
      uuid: 'u-1',
      display: 'User',
      privileges: privileges.map(priv),
      roles: roles.map((r) => ({ uuid: r, display: r })),
    },
  } as any;
}

describe('useReportBuilderPrivileges', () => {
  it('matches held privileges by name', () => {
    mockUseSession.mockReturnValue(sessionWith([RB.REPORT_VIEW]));
    const { current, unmount } = renderHook(() => useReportBuilderPrivileges());
    expect(current!.has(RB.REPORT_VIEW)).toBe(true);
    expect(current!.has(RB.REPORT_EDIT)).toBe(false);
    expect(current!.isAuthenticated).toBe(true);
    unmount();
  });

  it('uses OR semantics like the backend @Authorized({a, b})', () => {
    mockUseSession.mockReturnValue(sessionWith([RB.REPORT_ADD]));
    const { current, unmount } = renderHook(() => useReportBuilderPrivileges());
    expect(current!.has(RB.REPORT_ADD, RB.REPORT_EDIT)).toBe(true);
    expect(current!.hasAll(RB.REPORT_ADD, RB.REPORT_EDIT)).toBe(false);
    unmount();
  });

  it('treats the System Developer role as superuser', () => {
    mockUseSession.mockReturnValue(sessionWith([], ['System Developer']));
    const { current, unmount } = renderHook(() => useReportBuilderPrivileges());
    expect(current!.isSuperUser).toBe(true);
    expect(current!.has(RB.ETLMONITOR_PURGE)).toBe(true);
    expect(current!.hasAll(RB.PACKAGE_IMPORT, RB.PACKAGE_EXPORT)).toBe(true);
    unmount();
  });

  it('exposes convenience flags', () => {
    mockUseSession.mockReturnValue(sessionWith([RB.REPORT_VIEW, RB.REPORT_RUN, RB.PACKAGE_EXPORT]));
    const { current, unmount } = renderHook(() => useReportBuilderPrivileges());
    expect(current!.canAuthor).toBe(false);
    expect(current!.canRun).toBe(true);
    expect(current!.canPublish).toBe(true);
    expect(current!.canManageEtl).toBe(false);
    unmount();
  });

  it('is false on everything for an unauthenticated session', () => {
    mockUseSession.mockReturnValue({ authenticated: false, user: undefined, sessionId: '' });
    const { current, unmount } = renderHook(() => useReportBuilderPrivileges());
    expect(current!.isAuthenticated).toBe(false);
    expect(current!.has(RB.REPORT_VIEW)).toBe(false);
    unmount();
  });
});
