/**
 * The reminder engine (RM-01…RM-11, EX-01…EX-08, OW-04).
 *
 * Seven views of one engine: the schedules it follows, the ladder it escalates
 * by, what it sent, what it escalated, when it last ran, the words it uses, and
 * what it could not deliver.
 *
 * The screen itself requires CONFIGURE_ENGINE. Three of its tabs read data that
 * needs a different permission on the server — job history needs the audit
 * permission, message templates need the template permission, and the outbox
 * needs the settings permission — so those tabs are only offered when the
 * signed-in user can actually open them.
 */

import { Tabs } from "@/components/ui/Nav";
import { EmptyState } from "@/components/ui/Feedback";
import { PageHeader } from "@/components/ui/Page";
import { useUrlFilters } from "@/lib/hooks";
import { PERM, useAuth } from "@/features/auth/auth-context";
import { ReminderProfilesTab } from "@/features/admin/ReminderProfilesTab";
import { EscalationLadderTab } from "@/features/admin/EscalationLadderTab";
import { DeliveryLogTab } from "@/features/admin/DeliveryLogTab";
import { EscalationsTab } from "@/features/admin/EscalationsTab";
import { JobsTab } from "@/features/admin/JobsTab";
import { EmailTemplatesTab } from "@/features/admin/EmailTemplatesTab";
import { OutboxTab } from "@/features/admin/OutboxTab";

export default function RemindersPage() {
  const { can } = useAuth();
  const canConfigure = can(PERM.CONFIGURE_ENGINE);
  const canViewAudit = can(PERM.VIEW_AUDIT);
  const canManageTemplates = can(PERM.MANAGE_TEMPLATES);
  const canManageSettings = can(PERM.MANAGE_SETTINGS);

  const { filters, setFilter } = useUrlFilters({ tab: "profiles" });
  const tab = String(filters.tab ?? "profiles");

  const tabs = [
    { id: "profiles", label: "Profiles", icon: "sliders" as const },
    { id: "ladder", label: "Escalation ladder", icon: "bell-ring" as const },
    { id: "delivery", label: "Delivery log", icon: "send" as const },
    { id: "escalations", label: "Escalations", icon: "alert" as const },
    ...(canViewAudit ? [{ id: "jobs", label: "Jobs", icon: "history" as const }] : []),
    ...(canManageTemplates ? [{ id: "templates", label: "Templates", icon: "mail" as const }] : []),
    ...(canManageSettings ? [{ id: "outbox", label: "Outbox", icon: "archive" as const }] : []),
  ];

  const activeTab = tabs.some((item) => item.id === tab) ? tab : "profiles";

  // The route already guards this; the check keeps the message honest if the
  // permission is revoked while the screen is open.
  if (!canConfigure) {
    return (
      <div>
        <PageHeader
          title="Reminder engine"
          description="How the register warns people before a deadline, and escalates when it passes."
        />
        <EmptyState
          icon="lock"
          title="You do not have access to the reminder engine"
          description="Changing reminder schedules, escalation rules or seeing what the engine sent needs the engine-configuration permission."
        />
      </div>
    );
  }

  const panels: Record<string, React.ReactNode> = {
    profiles: <ReminderProfilesTab />,
    ladder: <EscalationLadderTab />,
    delivery: <DeliveryLogTab />,
    escalations: <EscalationsTab />,
    jobs: canViewAudit ? <JobsTab /> : null,
    templates: canManageTemplates ? <EmailTemplatesTab /> : null,
    outbox: canManageSettings ? <OutboxTab /> : null,
  };

  return (
    <div className="pb-10">
      <PageHeader
        title="Reminder engine"
        description="The schedules that warn people before a deadline, the ladder that escalates when it passes, and the record of everything the engine did."
        tabs={
          <Tabs
            items={tabs}
            value={activeTab}
            onChange={(id) => setFilter("tab", id)}
            className="px-4 sm:px-6"
          />
        }
      />
      <div className="p-4 sm:p-6">{panels[activeTab]}</div>
    </div>
  );
}
