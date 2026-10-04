/**
 * The document vault's view of the API.
 *
 * The serialiser in `app/api/routes/documents.py` names things differently
 * from `DocumentRecord` in the shared types (`doc_type`/`mime_type`/
 * `version_no`/`size_bytes`/`created_at`), so the shapes are declared here
 * rather than reusing the shared one. Every field below is one the live route
 * actually returns.
 */

export interface DocumentRow {
  id: string;
  title: string;
  file_name: string;
  doc_type: string;
  mime_type: string | null;
  size_bytes: number;
  version_no: number;
  is_current: boolean;
  sha256: string;
  virus_scan_status: string | null;
  item_id: string | null;
  item_code: string | null;
  instance_id: string | null;
  reference_number: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  change_note: string | null;
  uploaded_by: string | null;
  created_at: string;
  download_count: number;
  expires_in_days: number | null;
}

/** GET /documents/{id}/verify — re-hashed on the server (AT-05). */
export interface VerifyResult {
  ok: boolean;
  expected: string;
  actual?: string;
  reason: string | null;
  file_name: string;
}

/**
 * A time-limited auditor link. The API scopes a link to an item or a whole
 * unit — not to an individual document — so the dialog makes that explicit.
 */
export interface ShareLinkRow {
  id: string;
  token: string;
  url: string;
  scope_item_id: string | null;
  scope_unit_id: string | null;
  created_for: string | null;
  expires_at: string;
  access_count: number;
  watermark: boolean;
}
