"""Dashboard and report schemas."""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field


class KpiCard(BaseModel):
    key: str
    label: str
    value: float
    suffix: str = ""
    severity: str = "neutral"     # neutral | good | warn | danger
    drill: str | None = None
    delta: float | None = None


class SeriesPoint(BaseModel):
    label: str
    value: float
    key: str | None = None


class StackedSeries(BaseModel):
    category: str
    values: dict[str, float]


class RiskRow(BaseModel):
    item_id: str
    item_code: str
    name: str
    unit: str | None = None
    owner: str | None = None
    criticality: str
    status: str
    days_overdue: int | None = None
    days_left: int | None = None
    expiry_date: date | None = None
    exposure: float | None = None


class EscalationRow(BaseModel):
    instance_id: str
    item_name: str
    level: int
    label: str
    since: datetime
    owner: str | None = None
    unit: str | None = None


class OwnerBacklogRow(BaseModel):
    owner_id: str | None = None
    owner_name: str
    open_items: int
    overdue: int
    expired: int
    oldest_days: int


class DashboardFilters(BaseModel):
    unit_id: str | None = None
    department_id: str | None = None
    category_id: str | None = None
    criticality: str | None = None
    owner_id: str | None = None
    status: str | None = None
    search: str | None = None
    period_from: date | None = None
    period_to: date | None = None


class ManagementDashboard(BaseModel):
    generated_at: datetime
    filters: dict
    kpis: list[KpiCard]
    status_split: list[SeriesPoint]
    department_status: list[StackedSeries]
    unit_status: list[StackedSeries]
    category_status: list[SeriesPoint]
    renewal_timeline: list[StackedSeries]
    index_trend: list[SeriesPoint]
    top_risks: list[RiskRow]
    escalations: list[EscalationRow]
    owner_backlog: list[OwnerBacklogRow]
    fees_next_quarter: float


class OfficerDashboard(BaseModel):
    generated_at: datetime
    tabs: dict[str, list[RiskRow]]
    today_actions: list[RiskRow]
    calendar: list[dict]
    counts: dict[str, int]


class MyWorkDashboard(BaseModel):
    generated_at: datetime
    open_items: list[RiskRow]
    upcoming_90: list[RiskRow]
    awaiting_upload: list[RiskRow]
    delegated: list[RiskRow]
    overdue: list[RiskRow]
    counts: dict[str, int]


class CalendarDay(BaseModel):
    date: date
    items: list[RiskRow]
    count: int


class CalendarMonth(BaseModel):
    year: int
    month: int
    label: str
    days: list[CalendarDay]
    total: int


class ReportDefinition(BaseModel):
    code: str
    name: str
    description: str
    columns: list[str]
    group: str = "Standard"


class ReportResult(BaseModel):
    code: str
    name: str
    generated_at: datetime
    columns: list[dict]
    rows: list[dict]
    totals: dict = Field(default_factory=dict)
    summary: dict = Field(default_factory=dict)


class ScheduleReportRequest(BaseModel):
    report_code: str
    name: str
    filters: dict = Field(default_factory=dict)
    frequency: str = "weekly"
    recipients: list[str]
    format: str = "pdf"


class ImportIssue(BaseModel):
    row: int
    column: str | None = None
    severity: str = "error"
    message: str


class ImportPreview(BaseModel):
    total_rows: int
    valid_rows: int
    errors: list[ImportIssue]
    warnings: list[ImportIssue]
    preview: list[dict]
    columns_detected: list[str]


class ImportResult(BaseModel):
    created: int
    updated: int
    skipped: int
    errors: list[ImportIssue]
    item_ids: list[str] = Field(default_factory=list)
