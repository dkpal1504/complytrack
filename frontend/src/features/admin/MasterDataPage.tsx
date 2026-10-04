/**
 * Master data (EX-01…EX-06).
 *
 * Everything the register is built from lives here: the units obligations
 * belong to, the departments that own them, the categories that group them, the
 * authorities that issue them, the legal references behind them, the holiday
 * calendar the countdown uses, and the configuration settings themselves.
 *
 * The whole screen requires MANAGE_ORG; settings additionally require
 * MANAGE_SETTINGS, so that tab is not offered to an organisation administrator
 * who cannot read it.
 */

import { Tabs } from "@/components/ui/Nav";
import { EmptyState } from "@/components/ui/Feedback";
import { PageHeader } from "@/components/ui/Page";
import { useUrlFilters } from "@/lib/hooks";
import { PERM, useAuth } from "@/features/auth/auth-context";
import { UnitsTab } from "@/features/admin/UnitsTab";
import { DepartmentsTab } from "@/features/admin/DepartmentsTab";
import { CategoriesTab } from "@/features/admin/CategoriesTab";
import { AuthoritiesTab } from "@/features/admin/AuthoritiesTab";
import { LegalReferencesTab } from "@/features/admin/LegalReferencesTab";
import { HolidaysTab } from "@/features/admin/HolidaysTab";
import { SettingsTab } from "@/features/admin/SettingsTab";

export default function MasterDataPage() {
  const { can } = useAuth();
  const canManageOrg = can(PERM.MANAGE_ORG);
  const canManageSettings = can(PERM.MANAGE_SETTINGS);

  const { filters, setFilter } = useUrlFilters({ tab: "units" });
  const tab = String(filters.tab ?? "units");

  const tabs = [
    { id: "units", label: "Units", icon: "building" as const },
    { id: "departments", label: "Departments", icon: "users" as const },
    { id: "categories", label: "Categories", icon: "columns" as const },
    { id: "authorities", label: "Authorities", icon: "shield" as const },
    { id: "legal", label: "Legal references", icon: "document" as const },
    { id: "holidays", label: "Holidays", icon: "calendar" as const },
    ...(canManageSettings ? [{ id: "settings", label: "Settings", icon: "settings" as const }] : []),
  ];

  // The route already guards this; the check keeps the message honest if the
  // permission is revoked while the screen is open.
  if (!canManageOrg) {
    return (
      <div>
        <PageHeader
          title="Master data"
          description="The organisation structure the register is built from."
        />
        <EmptyState
          icon="lock"
          title="You do not have access to master data"
          description="Changing units, departments, categories, authorities or the holiday calendar needs the organisation-administrator permission."
        />
      </div>
    );
  }

  const panels: Record<string, React.ReactNode> = {
    units: <UnitsTab />,
    departments: <DepartmentsTab />,
    categories: <CategoriesTab />,
    authorities: <AuthoritiesTab />,
    legal: <LegalReferencesTab />,
    holidays: <HolidaysTab />,
    settings: canManageSettings ? <SettingsTab /> : null,
  };

  return (
    <div className="pb-10">
      <PageHeader
        title="Master data"
        description="The units, departments, categories, authorities, legal references and holiday calendar the register is built from."
        tabs={
          <Tabs
            items={tabs}
            value={tabs.some((item) => item.id === tab) ? tab : "units"}
            onChange={(id) => setFilter("tab", id)}
            className="px-4 sm:px-6"
          />
        }
      />
      <div className="p-4 sm:p-6">
        {panels[tabs.some((item) => item.id === tab) ? tab : "units"]}
      </div>
    </div>
  );
}
