/**
 * The top bar: identity on the left, global actions on the right.
 *
 * It is deliberately short. On a phone it holds only the menu button, the
 * title and the notification bell — everything else moves into the sheet.
 */

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Icon } from "@/components/ui/Icon";
import { useAuth } from "@/features/auth/auth-context";
import { NotificationMenu } from "@/components/layout/NotificationMenu";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";

export function Topbar({
  title,
  onToggleSidebar,
  onOpenMobileMenu,
}: {
  title?: string;
  onToggleSidebar: () => void;
  onOpenMobileMenu: () => void;
}) {
  const { user, signOut } = useAuth();
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
      ? "dark"
      : "light",
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement>(null);

  // A click anywhere else, or Escape, closes the account menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("complytrack.theme", next);
    } catch {
      /* Preference simply does not persist. */
    }
  };

  return (
    <header className="no-print sticky top-0 z-30 h-14 border-b border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
      <div className="mx-auto flex h-full w-full max-w-[1800px] items-center gap-2 px-3 sm:px-4">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="Collapse or expand the sidebar"
          className="hidden size-9 items-center justify-center rounded-[var(--radius-control)] text-ink-muted hover:bg-surface-muted hover:text-ink md:inline-flex"
        >
          <Icon name="menu" size={19} />
        </button>
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Open the navigation menu"
          className="inline-flex size-9 items-center justify-center rounded-[var(--radius-control)] text-ink-muted hover:bg-surface-muted hover:text-ink md:hidden"
        >
          <Icon name="menu" size={19} />
        </button>

        <Link to="/" className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Icon name="shield-check" size={18} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm leading-tight font-semibold text-ink">
              ComplyTrack
            </span>
            {title && (
              <span className="hidden truncate text-2xs leading-tight text-ink-subtle sm:block">
                {title}
              </span>
            )}
          </span>
        </Link>

        <div className="flex-1" />

        <button
          type="button"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          className="inline-flex size-9 items-center justify-center rounded-[var(--radius-control)] text-ink-muted hover:bg-surface-muted hover:text-ink"
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} size={18} />
        </button>

        <NotificationMenu />

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            // On a narrow screen the name and role are hidden visually, so the
            // button would otherwise be announced as its initials alone.
            aria-label={user ? `Account menu for ${user.name}` : "Account menu"}
            className="flex items-center gap-2 rounded-[var(--radius-control)] py-1 pr-2 pl-1 hover:bg-surface-muted"
          >
            <span className="flex size-7 items-center justify-center rounded-full bg-brand-100 text-2xs font-bold text-brand-700">
              {user ? initials(user.name) : "?"}
            </span>
            <span className="hidden min-w-0 text-left sm:block">
              <span className="block max-w-32 truncate text-xs leading-tight font-semibold text-ink">
                {user?.name}
              </span>
              <span className="block max-w-32 truncate text-2xs leading-tight text-ink-subtle">
                {user?.role}
              </span>
            </span>
            <Icon name="chevron-down" size={14} className="text-ink-subtle" />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-40 mt-1 w-64 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-overlay)]"
            >
              <div className="border-b border-line px-3.5 py-3">
                <p className="truncate text-sm font-semibold text-ink">{user?.name}</p>
                <p className="truncate text-xs text-ink-muted">{user?.email}</p>
                <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-2xs font-medium text-brand-700">
                  <Icon name="shield" size={11} />
                  {user?.role}
                </p>
              </div>
              <div className="py-1">
                <MenuLink to="/settings" icon="user" onClick={() => setMenuOpen(false)}>
                  Your profile
                </MenuLink>
                <MenuLink to="/settings#security" icon="lock" onClick={() => setMenuOpen(false)}>
                  Password &amp; second factor
                </MenuLink>
                <MenuLink to="/notifications" icon="bell" onClick={() => setMenuOpen(false)}>
                  Notifications
                </MenuLink>
              </div>
              <div className="border-t border-line py-1">
                <button
                  type="button"
                  role="menuitem"
                  onClick={async () => {
                    setMenuOpen(false);
                    await signOut();
                    navigate("/login", { replace: true });
                  }}
                  className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-rag-red hover:bg-surface-muted"
                >
                  <Icon name="logout" size={16} />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function MenuLink({
  to,
  icon,
  children,
  onClick,
}: {
  to: string;
  icon: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <Link
      to={to}
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2.5 px-3.5 py-2 text-sm text-ink-muted hover:bg-surface-muted hover:text-ink",
      )}
    >
      <Icon name={icon} size={16} />
      {children}
    </Link>
  );
}
