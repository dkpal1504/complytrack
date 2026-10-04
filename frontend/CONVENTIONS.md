# ComplyTrack frontend — conventions

Read this before writing any screen. The foundation is already in place; these
rules are what keep fifteen screens looking and behaving like one product.

## Stack

React 19 · TypeScript (strict) · Vite 6 · Tailwind CSS v4 · TanStack Query v5 ·
TanStack Table v8 (only where the declarative `DataTable` is not enough) ·
Recharts 3 · React Router 7 · date-fns 4 · lucide-react.

Path alias: `@/` → `src/`.

## Layout

```
src/
  app/            App.tsx (routes), guards.tsx, navigation.ts, NotFoundPage.tsx
  components/
    ui/           Button Card Chip Form Feedback Overlay Nav Page Table Icon
    layout/       AppShell Topbar NotificationMenu
  features/
    auth/         AuthProvider, auth-context (useAuth, PERM), LoginPage
    dashboard/    DashboardPage, WorklistPage, MyWorkPage, useMyWorkCounts
    register/     RegisterPage, ItemDetailPage (+ sub-features)
    calendar/     CalendarPage
    documents/    DocumentsPage
    reports/      ReportsPage, ReportViewPage
    notifications/NotificationsPage
    settings/     SettingsPage
    admin/        TemplatesPage MasterDataPage UsersPage RemindersPage AuditPage
    org/          useReference.ts (useMeta, useLookups, toOptions)
  lib/            api.ts format.ts status.ts query.ts hooks.ts cn.ts
  types/api.ts    every API shape
```

Each route is a **default export** of the file named in `src/app/App.tsx`. Do
not add routes; the table is fixed.

## Data access

- **Only** `api<T>(path, {query, json, method})` and `apiFile(...)` from
  `@/lib/api`. Never call `fetch` directly. `uploadFile()` exists for multipart.
- Query keys come from `qk` in `@/lib/query`. Never invent a key inline.
- After any mutation that changes the register, call
  `invalidateRegister(queryClient)`; for admin changes `invalidateAdmin(...)`.
- Errors are `ApiError` with `.detail`, `.fieldErrors`, `.byField`. Render an
  `ErrorState` for a failed query — it handles 403 and 404 in plain English.

```tsx
const { data, isPending, error, refetch } = useQuery({
  queryKey: qk.items.list(filters),
  queryFn: () => api<Paginated<ComplianceItemSummary>>("/items", { query: filters }),
});
if (error) return <ErrorState error={error} onRetry={refetch} />;
```

## Components — use these, do not reinvent them

`Button`, `ButtonLink`, `Card`/`CardHeader`/`CardBody`/`CardFooter`, `Section`,
`Chip`, `StatusChip`, `DerivedStatusChip`, `BucketChip`, `CriticalityChip`,
`RagDot`, `CountBadge`, `Field`/`Input`/`Select`/`Textarea`/`Checkbox`/`Switch`/
`SearchInput`/`DescriptionItem`, `Modal`/`Drawer`/`ConfirmDialog`, `ToastProvider`
+ `useToast`, `Spinner`/`Skeleton`/`SkeletonRows`/`SkeletonCards`/`EmptyState`/
`ErrorState`/`ProgressBar`/`Meter`/`PageSpinner`, `DataTable`+`Pagination`,
`Tabs`/`TabLinks`/`SegmentedControl`/`Breadcrumbs`, `PageHeader`/`StatTile`/
`Toolbar`/`ResultCount`/`Panel`/`DetailGrid`/`SectionTitle`, `Icon`.

Colour and status vocabulary lives in `@/lib/status` (`BUCKET_STYLES`,
`STATUS_STYLES`, `CHART_SERIES`, `indexRag`). Never hard-code a hex value — use
the CSS custom properties (`var(--color-rag-red)`, `bg-surface`, `text-ink-muted`,
`border-line`, `text-brand-700`, …) defined in `src/index.css`.

Formatting lives in `@/lib/format`: `formatDate`, `formatDateTime`,
`formatTimeIst`, `formatRelative`, `formatCountdown`, `formatMoney`,
`formatNumber`, `formatPercent`, `formatBytes`, `titleCase`, `truncate`,
`initials`. Never call `toLocaleString` or `new Date().toString()` directly.

## Required patterns

1. **Every page** starts with `<PageHeader title description actions? tabs? />`.
2. **Every list** uses `<DataTable>` with a `caption`; set `isTitle: true` on
   exactly one column so the mobile card gets a headline. It renders a table on
   `md+` and cards on a phone automatically — do not write two layouts.
3. **Every async region** renders `SkeletonRows`/`SkeletonCards` while pending,
   `ErrorState` on failure, `EmptyState` when genuinely empty. An empty state
   must say what to do next.
4. **Every filter** lives in the URL via `useUrlFilters` from `@/lib/hooks`, so
   views are shareable and Back works.
5. **Every mutation** shows a toast (success and failure) and refreshes the
   affected queries. Use `ConfirmDialog` for anything destructive.
6. **Permissions**: `const { can, canAny, hasRole } = useAuth()`. Hide actions
   the role cannot perform using `PERM.*` from
   `@/features/auth/auth-context`. The route guard is a courtesy; the server
   always re-checks, so never rely on the client for security.
7. **Never** show a raw number where a phrase is clearer: use `formatCountdown`
   for days left, `formatMoney` for fees, `formatDateTime` for timestamps.

## Responsive and fluid

Mobile-first. Breakpoints: base = phone, `sm:` 640, `md:` 768 (tablet — the
sidebar appears here), `lg:` 1024, `xl:` 1280. The shell already handles the
sidebar, the bottom tab bar and the safe-area insets.

- Grids: `grid gap-4 sm:grid-cols-2 xl:grid-cols-4`.
- Never let a page scroll sideways at 360 px width.
- Touch targets ≥ 44 px on a phone (`h-11` on controls at base, `sm:h-10` up).
- Charts: wrap in `ResponsiveContainer` with a fixed-height parent
  (`className="h-64"`), and give every chart a text summary for screen readers.
- Long tables: let `DataTable` do the work; do not add horizontal scroll.

## Accessibility (WCAG 2.1 AA — a hard requirement, PRD §13)

- Colour is never the only signal: pair it with an icon and a word.
- Every icon-only button needs `aria-label`.
- Every input is wrapped in `<Field label=… error=…>` so label and error are
  wired with `htmlFor`/`aria-describedby`.
- Announce async outcomes: `role="status"` for counts, `role="alert"` for errors.
- Keep the focus ring. Keyboard: Tab reaches everything, Escape closes overlays,
  arrow keys move between tabs.
- Body text contrast ≥ 4.5:1; use the token pairs (`text-ink` on `bg-surface`,
  `text-ink-muted` on `bg-surface`), which are already checked.

## Copy

Plain English for a compliance officer, not a developer. "Renewal", not
"instance". "Obligation", not "entity". Sentence case for labels and buttons.
Explain what an action will do before it does it.

## Seed accounts (dev/E2E)

Password for every account: `Comply@2026!`

| Role | Email |
|---|---|
| Administrator | `admin@complytrack.local` |
| Compliance Team | `compliance@complytrack.local` |
| Department User | `safety.owner@complytrack.local` |
| Management View | `unit.head@complytrack.local` |
| Auditor | `auditor@complytrack.local` |

## API quick reference

Everything is under `/api/v1` (the `api()` helper already prefixes it).

- Auth: `POST /auth/login|logout|refresh`, `GET /auth/me`,
  `POST /auth/mfa/setup|verify|disable`, `POST /auth/password`
- Register: `GET|POST /items`, `GET|PATCH /items/{id}`, `POST /items/{id}/archive|restore`,
  `POST /items/bulk/reassign|bulk/edit`, `POST /items/import/preview|commit`,
  `GET /items/export/template|export/register`, `GET /items/saved-views|status-options`
- Workflow: `GET /instances/{id}`, `POST /instances/{id}/transition|verify|roll-forward`,
  `PATCH /instances/{id}/checklist/{checklist_id}`, `POST /instances/{id}/comments`,
  `GET /instances/{id}/timeline`
- Documents: `GET|POST /documents`, `GET /documents/{id}/download|verify|versions`,
  `DELETE /documents/{id}`, `GET|POST /documents/share-links`,
  `DELETE /documents/share-links/{id}`
- Dashboards: `GET /dashboards/management|officer|my-work|filters|calendar`,
  `GET /dashboards/export/ical`, `GET /dashboards/criticality-weights`
- Reports: `GET /reports` (catalogue), `GET /reports/{code}`,
  `GET /reports/{code}/export?format=csv|xlsx|pdf`, `GET /reports/{code}/ical`,
  `GET|POST /reports/schedules`, `DELETE /reports/schedules/{id}`
- Notifications: `GET /notifications`, `POST /notifications/{id}/read|read-all`,
  `POST /notifications/push/subscribe|unsubscribe`
- Admin: `GET|POST /templates`, `GET|PATCH /templates/{id}`, `POST /templates/apply`,
  `GET /templates/categories/tree`; `GET|POST|PATCH /org/units|departments|categories|authorities`,
  `GET|POST|DELETE /org/holidays`, `GET|POST /org/legal-references`,
  `GET /org/lookups|settings`, `PUT /org/settings/{key}`;
  `GET|POST /users`, `PATCH /users/{id}`, `POST /users/{id}/reset-password`,
  `GET /users/access-review|orphans`;
  `GET|POST /reminders/profiles`, `PATCH /reminders/profiles/{id}`,
  `GET /reminders/escalation-matrix|log|escalation-log|jobs|templates|outbox`,
  `POST /reminders/run|retry-failed`, `POST /reminders/escalations/{id}/acknowledge`;
  `GET /audit`, `GET /audit/facets|verify|export`,
  `GET /api/v1/meta`
- Exports that need the auth header must go through `apiFile()` + `saveBlob()`,
  never a plain `<a href>`.

## Commands

```
npm run dev        # vite dev server on :5173, proxies /api to :8000
npm run build      # tsc --noEmit && vite build
npm run typecheck
npm run test       # vitest
npm run e2e        # playwright
```
