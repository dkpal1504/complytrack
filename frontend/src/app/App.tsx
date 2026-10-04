/**
 * The route table.
 *
 * Screens are lazy-loaded so a phone on a slow connection downloads the
 * register first and the charting library only when a dashboard is opened.
 * Every guarded screen declares the permission it needs in one place.
 */

import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { RequireAuth, RequirePermission, RoleHome } from "@/app/guards";
import { PageSpinner } from "@/components/ui/Feedback";
import { AppShell } from "@/components/layout/AppShell";
import { PERM } from "@/features/auth/auth-context";

/* --- Daily work --- */
const LoginPage = lazy(() => import("@/features/auth/LoginPage"));
const MyWorkPage = lazy(() => import("@/features/dashboard/MyWorkPage"));
const RegisterPage = lazy(() => import("@/features/register/RegisterPage"));
const ItemDetailPage = lazy(() => import("@/features/register/ItemDetailPage"));
const CalendarPage = lazy(() => import("@/features/calendar/CalendarPage"));
const DocumentsPage = lazy(() => import("@/features/documents/DocumentsPage"));

/* --- Insight --- */
const DashboardPage = lazy(() => import("@/features/dashboard/DashboardPage"));
const WorklistPage = lazy(() => import("@/features/dashboard/WorklistPage"));
const ReportsPage = lazy(() => import("@/features/reports/ReportsPage"));
const ReportViewPage = lazy(() => import("@/features/reports/ReportViewPage"));

/* --- Administration --- */
const TemplatesPage = lazy(() => import("@/features/admin/TemplatesPage"));
const MasterDataPage = lazy(() => import("@/features/admin/MasterDataPage"));
const UsersPage = lazy(() => import("@/features/admin/UsersPage"));
const RemindersPage = lazy(() => import("@/features/admin/RemindersPage"));
const AuditPage = lazy(() => import("@/features/admin/AuditPage"));

/* --- Personal --- */
const NotificationsPage = lazy(() => import("@/features/notifications/NotificationsPage"));
const SettingsPage = lazy(() => import("@/features/settings/SettingsPage"));
const NotFoundPage = lazy(() => import("@/app/NotFoundPage"));

export function App() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<RoleHome />} />

            <Route path="my-work" element={<MyWorkPage />} />
            <Route
              path="register"
              element={
                <RequirePermission anyOf={[PERM.VIEW_ALL_ITEMS, PERM.VIEW_SCOPED_ITEMS]}>
                  <RegisterPage />
                </RequirePermission>
              }
            />
            <Route
              path="items/:itemId"
              element={
                <RequirePermission anyOf={[PERM.VIEW_ALL_ITEMS, PERM.VIEW_SCOPED_ITEMS]}>
                  <ItemDetailPage />
                </RequirePermission>
              }
            />
            <Route
              path="calendar"
              element={
                <RequirePermission anyOf={[PERM.VIEW_ALL_ITEMS, PERM.VIEW_SCOPED_ITEMS]}>
                  <CalendarPage />
                </RequirePermission>
              }
            />
            <Route
              path="documents"
              element={
                <RequirePermission permission={PERM.DOWNLOAD_DOCS}>
                  <DocumentsPage />
                </RequirePermission>
              }
            />

            <Route
              path="dashboard"
              element={
                <RequirePermission anyOf={[PERM.VIEW_DASHBOARD_ALL, PERM.VIEW_DASHBOARD_SCOPED]}>
                  <DashboardPage />
                </RequirePermission>
              }
            />
            <Route
              path="worklist"
              element={
                <RequirePermission anyOf={[PERM.VIEW_ALL_ITEMS, PERM.VIEW_SCOPED_ITEMS]}>
                  <WorklistPage />
                </RequirePermission>
              }
            />
            <Route
              path="reports"
              element={
                <RequirePermission anyOf={[PERM.RUN_REPORTS_ALL, PERM.RUN_REPORTS_SCOPED]}>
                  <ReportsPage />
                </RequirePermission>
              }
            />
            <Route
              path="reports/:code"
              element={
                <RequirePermission anyOf={[PERM.RUN_REPORTS_ALL, PERM.RUN_REPORTS_SCOPED]}>
                  <ReportViewPage />
                </RequirePermission>
              }
            />

            <Route
              path="admin/templates"
              element={
                <RequirePermission anyOf={[PERM.MANAGE_TEMPLATES, PERM.MANAGE_ITEMS]}>
                  <TemplatesPage />
                </RequirePermission>
              }
            />
            <Route
              path="admin/master-data"
              element={
                <RequirePermission permission={PERM.MANAGE_ORG}>
                  <MasterDataPage />
                </RequirePermission>
              }
            />
            <Route
              path="admin/users"
              element={
                <RequirePermission permission={PERM.MANAGE_ORG}>
                  <UsersPage />
                </RequirePermission>
              }
            />
            <Route
              path="admin/reminders"
              element={
                <RequirePermission permission={PERM.CONFIGURE_ENGINE}>
                  <RemindersPage />
                </RequirePermission>
              }
            />
            <Route
              path="admin/audit"
              element={
                <RequirePermission permission={PERM.VIEW_AUDIT}>
                  <AuditPage />
                </RequirePermission>
              }
            />

            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="settings" element={<SettingsPage />} />

            <Route path="404" element={<NotFoundPage />} />
            <Route path="*" element={<Navigate to="/404" replace />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
