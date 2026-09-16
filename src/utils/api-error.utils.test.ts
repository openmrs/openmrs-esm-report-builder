import { describe, expect, it, vi } from 'vitest';
import { RB } from '../constants/privileges';
import { guardRejection, normalizeApiError, PrivilegeError } from './api-error.utils';

/** Axios-shaped error factory. */
function axiosError(status: number, data: unknown, message = 'Request failed with status code ' + status) {
  return {
    message,
    response: { status, data },
  };
}

const stubLocation = (partial: Record<string, unknown> = {}) => {
  // jsdom's location is deletable in the test environment; fall back silently if not.
  const w = window as any;
  try {
    delete w.location;
    w.location = {
      href: '',
      pathname: '/openmrs/spa/report-builder/reports',
      search: '',
      ...partial,
    };
    // getOpenmrsSpaBase is a window global set by the SPA shell.
    w.getOpenmrsSpaBase = () => '/openmrs/spa/';
    w.spaBase = '/openmrs/spa';
  } catch {
    /* navigation stays a jsdom no-op log */
  }
};

describe('normalizeApiError', () => {
  it('passes AbortError through untouched', () => {
    const abort = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
    expect(normalizeApiError(abort)).toBe(abort);
  });

  it('is idempotent for PrivilegeError', () => {
    const already = new PrivilegeError({ status: 403, message: 'x' });
    expect(normalizeApiError(already)).toBe(already);
  });

  describe('403 with a reportbuilder privilege in the message', () => {
    it('builds a friendly message and parses the privilege', () => {
      const error = normalizeApiError(
        axiosError(403, {
          error: { message: `Privilege required: ${RB.REPORT_EDIT}` },
        }),
      ) as PrivilegeError;

      expect(error).toBeInstanceOf(PrivilegeError);
      expect(error.status).toBe(403);
      expect(error.requiredPrivileges).toEqual([RB.REPORT_EDIT]);
      expect(error.message).toContain('permission');
      expect(error.message).toContain('report.edit');
      expect(error.message).not.toContain('Task:');
    });

    it('deduplicates repeated privileges and preserves the axios response', () => {
      const original = axiosError(403, {
        message: `Privilege required: ${RB.REPORT_ADD} or ${RB.REPORT_ADD}`,
      });
      const error = normalizeApiError(original) as PrivilegeError;
      expect(error.requiredPrivileges).toEqual([RB.REPORT_ADD]);
      expect(error.response).toEqual(original.response);
    });
  });

  describe('403 from non-reportbuilder endpoints', () => {
    it('keeps the server wording verbatim (e.g. core task scheduler)', () => {
      const error = normalizeApiError(
        axiosError(403, { error: { message: 'Privilege required: Manage Scheduler' } }),
      ) as PrivilegeError;

      expect(error).toBeInstanceOf(PrivilegeError);
      expect(error.status).toBe(403);
      expect(error.requiredPrivileges).toBeUndefined();
      expect(error.message).toBe('Privilege required: Manage Scheduler');
    });

    it('falls back to a generic message when nothing readable is present', () => {
      const error = normalizeApiError({ message: '', response: { status: 403, data: null } }) as PrivilegeError;
      expect(error).toBeInstanceOf(PrivilegeError);
      expect(error.message).toContain('permission');
    });

    it('keeps the axios message when there is no body', () => {
      const error = normalizeApiError(axiosError(403, null)) as PrivilegeError;
      expect(error.message).toBe('Request failed with status code 403');
    });
  });

  describe('401 (expired session)', () => {
    it('marks the error as an auth error and redirects to the SPA login page', () => {
      stubLocation();
      const error = normalizeApiError(axiosError(401, { error: { message: 'Session has expired' } })) as PrivilegeError;

      expect(error).toBeInstanceOf(PrivilegeError);
      expect(error.isAuthError).toBe(true);
      expect(error.status).toBe(401);
      expect(error.message).toMatch(/session/i);
      expect(window.location.href).toContain('/openmrs/spa/login');
      expect(window.location.href).toContain('returnTo=');
    });

    it('does not redirect when already on the login page', () => {
      stubLocation({ pathname: '/openmrs/spa/login', href: 'about-to-stay' });
      normalizeApiError(axiosError(401, null));
      expect(window.location.href).toBe('about-to-stay');
    });
  });

  it('maps other statuses to a generic error carrying the server message', () => {
    const error = normalizeApiError(axiosError(500, { error: { message: 'Boom' } })) as Error & { status?: number };
    expect(error).not.toBeInstanceOf(PrivilegeError);
    expect(error.message).toBe('Boom');
    expect(error.status).toBe(500);
  });
});

describe('guardRejection', () => {
  it('returns the resolved value', async () => {
    await expect(guardRejection(Promise.resolve({ data: 42 }))).resolves.toEqual({ data: 42 });
  });

  it('normalizes rejections', async () => {
    await expect(
      guardRejection(Promise.reject(axiosError(403, { error: { message: `Privilege required: ${RB.REPORT_RUN}` } }))),
    ).rejects.toBeInstanceOf(PrivilegeError);
  });
});

describe('redirectToLogin loop guard', () => {
  it('navigates at most once across repeated calls (module-level latch)', async () => {
    vi.resetModules();
    const fresh = await import('./api-error.utils');

    stubLocation();

    fresh.redirectToLogin();
    expect(window.location.href).toContain('/login');
    // The latch makes further calls no-ops even with a fresh path.
    stubLocation({ pathname: '/openmrs/spa/report-builder/admin', href: 'unchanged' });
    fresh.redirectToLogin();
    expect(window.location.href).toBe('unchanged');
  });
});
