import React, { useEffect } from 'react';

import { useReportBuilderPrivileges } from '../../hooks/use-report-builder-privileges';
import { redirectToLogin } from '../../utils/api-error.utils';
import AccessDeniedPage from './access-denied-page.component';

interface PrivilegeRouteProps {
  /** Privileges granting access; any-of semantics, matching the backend's @Authorized. */
  required: string[];
  children: React.ReactNode;
}

/**
 * Route guard: renders children only when the signed-in user holds at least one
 * of the required privileges; otherwise renders the friendly access denied page.
 * Unauthenticated visitors are sent to the login page instead (401 vs 403).
 * This is UX only — the backend remains the security boundary.
 */
const PrivilegeRoute: React.FC<PrivilegeRouteProps> = ({ required, children }) => {
    const { has, isAuthenticated } = useReportBuilderPrivileges();

    useEffect(() => {
        if (!isAuthenticated) {
            redirectToLogin();
        }
    }, [isAuthenticated]);

    if (!isAuthenticated) {
        return null;
    }

    if (!has(...required)) {
        return <AccessDeniedPage requiredPrivileges={required} />;
    }

    return <>{children}</>;
};

export default PrivilegeRoute;
