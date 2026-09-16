import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { useSession, type Session } from '@openmrs/esm-framework';
import { RB } from '../../constants/privileges';
import PrivilegeRoute from './privilege-route.component';

const mockUseSession = vi.mocked(useSession);

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function sessionWith(privileges: string[], authenticated = true) {
  return {
    authenticated,
    user: {
      uuid: 'u-1',
      display: 'User',
      privileges: privileges.map((name) => ({ uuid: name, name, display: name })),
      roles: [],
    },
  } as Session;
}

function renderAt(route: string, ui: React.ReactElement): { text: () => string; unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>);
  });
  return {
    text: () => container.textContent ?? '',
    unmount: () => act(() => root.unmount()),
  };
}

describe('PrivilegeRoute', () => {
  it('renders children when a required privilege is held (any-of)', () => {
    mockUseSession.mockReturnValue(sessionWith([RB.PACKAGE_EXPORT]));
    const view = renderAt(
      '/import-export',
      <PrivilegeRoute required={[RB.PACKAGE_IMPORT, RB.PACKAGE_EXPORT]}>
        <div>secret content</div>
      </PrivilegeRoute>,
    );
    expect(view.text()).toContain('secret content');
    view.unmount();
  });

  it('renders the access denied page naming the privilege when unauthorised', () => {
    mockUseSession.mockReturnValue(sessionWith([RB.REPORT_VIEW]));
    const view = renderAt(
      '/run',
      <PrivilegeRoute required={[RB.REPORT_RUN]}>
        <div>secret content</div>
      </PrivilegeRoute>,
    );
    expect(view.text()).not.toContain('secret content');
    expect(view.text()).toContain('Access denied');
    expect(view.text()).toContain('report.run');
    view.unmount();
  });

  it('renders nothing and does not crash for an unauthenticated visitor', () => {
    mockUseSession.mockReturnValue(undefined);
    const view = renderAt(
      '/',
      <PrivilegeRoute required={[RB.REPORT_VIEW]}>
        <div>secret content</div>
      </PrivilegeRoute>,
    );
    expect(view.text()).toBe('');
    view.unmount();
  });
});
