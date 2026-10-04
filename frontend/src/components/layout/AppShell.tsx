/**
 * The application shell.
 *
 * Three layouts in one component:
 *   phone   — a fixed bottom tab bar, content full width, no sidebar;
 *   tablet  — a collapsed icon rail plus the content;
 *   desktop — the full sidebar with group headings.
 *
 * The bottom bar is the important one: this app is used standing up, at a
 * dock or on a jetty, and the primary destinations have to sit under a thumb.
 */

import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { findNavItem, primaryItems, visibleGroups } from "@/app/navigation";
import { CountBadge } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { Topbar } from "@/components/layout/Topbar";
import { useAuth } from "@/features/auth/auth-context";
import { useMyWorkCounts } from "@/features/dashboard/useMyWorkCounts";
import { cn } from "@/lib/cn";

function Sidebar({ collapsed }: { collapsed: boolean }) {
  const { can } = useAuth();
  const groups = visibleGroups(can);

  return (
    <nav aria-label="Main navigation" className="flex h-full flex-col gap-5 overflow-y-auto px-3 py-4">
      {groups.map((group) => (
        <div key={group.id}>
          {!collapsed && (
            <p className="mb-1.5 px-2 text-2xs font-semibold tracking-wider text-ink-subtle uppercase">
              {group.label}
            </p>
          )}
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    cn(
                      "group flex items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 py-2 text-sm font-medium transition-colors",
                      collapsed && "justify-center px-0",
                      isActive
                        ? "bg-brand-600 text-white"
                        : "text-ink-muted hover:bg-surface-muted hover:text-ink",
                    )
                  }
                >
                  <Icon name={item.icon} size={18} className="shrink-0" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function MobileTabBar() {
  const { can } = useAuth();
  const items = primaryItems(can);
  const { counts } = useMyWorkCounts();

  return (
    <nav
      aria-label="Primary navigation"
      className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid grid-cols-4">
        {items.map((item) => {
          const badge =
            item.badge === "open" ? counts.open : item.badge === "overdue" ? counts.overdue : 0;
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "relative flex flex-col items-center gap-0.5 py-2 text-2xs font-medium transition-colors",
                    isActive ? "text-brand-600" : "text-ink-muted",
                  )
                }
              >
                <span className="relative">
                  <Icon name={item.icon} size={21} />
                  {badge > 0 && (
                    <span className="absolute -top-1.5 -right-2 flex min-w-4 items-center justify-center rounded-full bg-rag-red px-1 text-[10px] leading-4 font-bold text-white">
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </span>
                <span className="max-w-full truncate px-0.5">{item.label}</span>
              </NavLink>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={() =>
              document.dispatchEvent(new CustomEvent("complytrack:open-menu"))
            }
            className="flex w-full flex-col items-center gap-0.5 py-2 text-2xs font-medium text-ink-muted"
          >
            <Icon name="menu" size={21} />
            <span>More</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const { can } = useAuth();
  const current = findNavItem(pathname);

  // Close the mobile menu whenever the route changes.
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    const open = () => setMobileMenuOpen(true);
    document.addEventListener("complytrack:open-menu", open);
    return () => document.removeEventListener("complytrack:open-menu", open);
  }, []);

  // Remember the rail preference across visits.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("complytrack.sidebar");
      if (saved === "collapsed") setCollapsed(true);
    } catch {
      /* Storage unavailable — fall back to the expanded rail. */
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem("complytrack.sidebar", next ? "collapsed" : "expanded");
      } catch {
        /* Preference simply does not persist. */
      }
      return next;
    });
  };

  const groups = visibleGroups(can);

  return (
    <div className="min-h-dvh bg-canvas">
      <a
        href="#main"
        className="sr-only sr-only-focusable focus:not-sr-only"
      >
        Skip to main content
      </a>

      <Topbar
        title={current?.label}
        onToggleSidebar={toggleCollapsed}
        onOpenMobileMenu={() => setMobileMenuOpen(true)}
      />

      <div className="mx-auto flex w-full max-w-[1800px]">
        {/* Tablet and desktop sidebar */}
        <aside
          className={cn(
            "no-print sticky top-14 hidden h-[calc(100dvh-3.5rem)] shrink-0 border-r border-line bg-surface md:block",
            collapsed ? "w-[68px]" : "w-60",
          )}
        >
          <Sidebar collapsed={collapsed} />
        </aside>

        <main
          id="main"
          className="min-w-0 flex-1 pb-24 md:pb-8"
          tabIndex={-1}
        >
          <Outlet />
        </main>
      </div>

      <MobileTabBar />

      {/* Full navigation for the phone, behind "More". */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="All sections">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMobileMenuOpen(false)}
            className="absolute inset-0 bg-ink/50 backdrop-blur-[2px]"
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-[var(--shadow-overlay)]">
            <div className="sticky top-0 flex items-center justify-between border-b border-line bg-surface px-4 py-3">
              <p className="text-sm font-semibold text-ink">All sections</p>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close menu"
                className="rounded p-1.5 text-ink-subtle hover:bg-surface-muted"
              >
                <Icon name="x" size={18} />
              </button>
            </div>
            <div className="px-2 py-3">
              {groups.map((group) => (
                <div key={group.id} className="mb-4">
                  <p className="mb-1 px-2 text-2xs font-semibold tracking-wider text-ink-subtle uppercase">
                    {group.label}
                  </p>
                  <ul>
                    {group.items.map((item) => (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          className={({ isActive }) =>
                            cn(
                              "flex items-center gap-3 rounded-[var(--radius-control)] px-2.5 py-2.5 text-sm font-medium",
                              isActive ? "bg-brand-600 text-white" : "text-ink hover:bg-surface-muted",
                            )
                          }
                        >
                          <Icon name={item.icon} size={18} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{item.label}</span>
                            {item.description && (
                              <span className="block truncate text-2xs opacity-70">
                                {item.description}
                              </span>
                            )}
                          </span>
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Shown next to a heading when the user needs to know a count. */
export function NavCount({ value }: { value: number }) {
  return <CountBadge value={value} />;
}
