/**
 * Route guards.
 *
 * The server is the real authority — every endpoint re-checks the permission.
 * These guards exist so a user never lands on a screen that will only fail:
 * hiding the link is a courtesy, not the security boundary.
 */

import { Navigate, Outlet, useLocation } from "react-router-dom";

import { EmptyState, PageSpinner } from "@/components/ui/Feedback";
import { ButtonLink } from "@/components/ui/Button";
import { useAuth } from "@/features/auth/auth-context";

/** Everything inside requires a session; anything else goes to sign-in. */
export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <PageSpinner label="Restoring your session" />;
  if (!user) {
    // Remember where they were headed so sign-in can return them there.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <Outlet />;
}

/** A screen that needs a specific permission. */
export function RequirePermission({
  permission,
  anyOf,
  children,
}: {
  permission?: string;
  anyOf?: string[];
  children: React.ReactNode;
}) {
  const { can, canAny } = useAuth();
  const allowed = anyOf?.length ? canAny(...anyOf) : permission ? can(permission) : true;

  if (!allowed) {
    return (
      <EmptyState
        icon="lock"
        title="This section is not part of your role"
        description="Your account does not have access to this screen. If your work now includes it, ask an administrator to update your role."
        action={<ButtonLink to="/" variant="primary" icon="home">Back to My Work</ButtonLink>}
        className="py-24"
      />
    );
  }
  return <>{children}</>;
}

/** The landing screen for a role: management sees the dashboard, others their work. */
export function RoleHome() {
  const { can, loading } = useAuth();
  if (loading) return <PageSpinner />;
  if (can("view_dashboard_all")) return <Navigate to="/dashboard" replace />;
  return <Navigate to="/my-work" replace />;
}
