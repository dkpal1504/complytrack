/**
 * A tiny named-icon layer over lucide-react.
 *
 * Screens refer to icons by role ("alert", "check") rather than by glyph name,
 * so the status mapping in `lib/status.ts` can stay declarative and a change of
 * icon set is a change to this file.
 */

import {
  AlertTriangle,
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Bell,
  BellRing,
  Building2,
  Calendar,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Circle,
  CircleDot,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Columns3,
  Copy,
  Download,
  FileBarChart,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  Filter,
  Gauge,
  History,
  Home,
  Info,
  Infinity as InfinityIcon,
  LayoutDashboard,
  Link2,
  ListChecks,
  Lock,
  LogOut,
  Mail,
  MailCheck,
  MapPin,
  Menu,
  Minus,
  Moon,
  MoreHorizontal,
  Pause,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  ScrollText,
  Search,
  Send,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Upload,
  User,
  UserCog,
  UserPlus,
  Users,
  X,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  alert: TriangleAlert,
  "alert-circle": AlertTriangle,
  "arrow-down-up": ArrowDownUp,
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  "arrow-up-right": ArrowUpRight,
  audit: ScrollText,
  bell: Bell,
  "bell-ring": BellRing,
  building: Building2,
  calendar: Calendar,
  "calendar-clock": CalendarClock,
  "calendar-days": CalendarDays,
  check: Check,
  "check-circle": CheckCircle2,
  "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "chevrons-up-down": ChevronsUpDown,
  circle: Circle,
  "circle-dot": CircleDot,
  clipboard: ClipboardList,
  "clipboard-check": ClipboardCheck,
  clock: Clock,
  columns: Columns3,
  copy: Copy,
  dashboard: LayoutDashboard,
  download: Download,
  edit: Pencil,
  filter: Filter,
  gauge: Gauge,
  history: History,
  home: Home,
  info: Info,
  infinity: InfinityIcon,
  link: Link2,
  list: ListChecks,
  lock: Lock,
  logout: LogOut,
  mail: Mail,
  "mail-check": MailCheck,
  map: MapPin,
  menu: Menu,
  minus: Minus,
  moon: Moon,
  more: MoreHorizontal,
  notifications: BellRing,
  pause: Pause,
  plus: Plus,
  print: Printer,
  progress: CircleDot,
  refresh: RefreshCw,
  report: FileBarChart,
  "report-check": FileCheck2,
  restore: RotateCcw,
  save: Save,
  search: Search,
  send: Send,
  settings: Settings,
  shield: Shield,
  "shield-alert": ShieldAlert,
  "shield-check": ShieldCheck,
  sliders: SlidersHorizontal,
  sort: ArrowDownUp,
  sparkles: Sparkles,
  spreadsheet: FileSpreadsheet,
  sun: Sun,
  trash: Trash2,
  "trend-down": TrendingDown,
  "trend-up": TrendingUp,
  upload: Upload,
  user: User,
  "user-cog": UserCog,
  "user-plus": UserPlus,
  users: Users,
  verified: BadgeCheck,
  x: X,
  "x-circle": XCircle,
  document: FileText,
};

export type IconName = keyof typeof ICONS | string;

export interface IconProps extends Omit<React.SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number | string;
  /** Set for icons that carry meaning on their own; decorative ones stay hidden. */
  label?: string;
}

export function Icon({ name, size = 18, label, className, ...rest }: IconProps) {
  const Glyph = ICONS[name] ?? Circle;
  return (
    <Glyph
      width={size}
      height={size}
      className={className}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      focusable={false}
      {...rest}
    />
  );
}
