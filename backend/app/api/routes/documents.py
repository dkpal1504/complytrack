"""Document vault: upload, versioning, download, integrity and auditor share links."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile
from sqlalchemy import select

from app.api.common import (
    context_from,
    CurrentScope, CurrentUser, DbSession, bad_request, forbidden, not_found,
)
from app.core.config import settings
from app.core.deps import require, require_any
from app.core.rbac import Permission
from app.models.auth import User
from app.models.compliance import ComplianceItem
from app.models.documents import Document, ShareLink
from app.schemas.reminders import ShareLinkCreate
from app.services import documents as doc_service

router = APIRouter(prefix="/documents", tags=["Document vault"])


@router.get("", summary="Documents for an item or cycle")
def list_documents(
    db: DbSession,
    scope: CurrentScope,
    user: User = Depends(require_any(Permission.VIEW_ALL_ITEMS, Permission.VIEW_SCOPED_ITEMS)),
    item_id: str | None = None,
    instance_id: str | None = None,
    current_only: bool = False,
) -> list[dict]:
    if item_id:
        item = db.get(ComplianceItem, item_id)
        if item is None or item.is_deleted:
            raise not_found("Compliance item")
        if not scope.all_units and item.unit_id not in scope.unit_ids:
            raise forbidden("This item is outside your unit scope.")
    docs = doc_service.list_documents(
        db, item_id=item_id, instance_id=instance_id, current_only=current_only
    )
    return [_serialise(db, d) for d in docs]


@router.post("", status_code=201, summary="Upload a document (auto-versions by title and type)")
async def upload(
    request: Request,
    db: DbSession,
    scope: CurrentScope,
    title: str = Form(...),
    doc_type: str = Form("Other"),
    item_id: str | None = Form(None),
    instance_id: str | None = Form(None),
    reference_number: str | None = Form(None),
    issue_date: date | None = Form(None),
    expiry_date: date | None = Form(None),
    change_note: str | None = Form(None),
    file: UploadFile = File(...),
    user: User = Depends(require(Permission.UPDATE_ASSIGNED)),
) -> dict:
    if item_id:
        item = db.get(ComplianceItem, item_id)
        if item is None or item.is_deleted:
            raise not_found("Compliance item")
        if not scope.all_units and item.unit_id not in scope.unit_ids:
            raise forbidden("This item is outside your unit scope.")
        if not scope.all_departments and item.department_id != scope.department_id:
            raise forbidden("This item belongs to another department.")

    data = await file.read()
    if not data:
        raise bad_request("The uploaded file is empty.")
    if len(data) > settings.max_upload_bytes:
        raise bad_request(
            f"The file is larger than the {settings.max_upload_bytes // (1024 * 1024)} MB limit."
        )

    try:
        document = doc_service.upload_document(
            db, data=data, filename=file.filename or "upload.bin", title=title,
            doc_type=doc_type, item_id=item_id, instance_id=instance_id,
            reference_number=reference_number, issue_date=issue_date,
            expiry_date=expiry_date, change_note=change_note,
            actor=user, ctx=context_from(request, user),
        )
    except ValueError as exc:
        raise bad_request(str(exc)) from exc
    return _serialise(db, document)


@router.get("/{document_id}/versions", summary="Every version of this document family (DS-05)")
def versions(
    document_id: str, db: DbSession,
    user: User = Depends(require(Permission.DOWNLOAD_DOCS)),
) -> list[dict]:
    document = _get(db, document_id)
    return [_serialise(db, d) for d in doc_service.versions_of(db, document)]


@router.get("/{document_id}/download", summary="Download a document (counted and audited)")
def download(
    document_id: str, request: Request, db: DbSession,
    user: User = Depends(require(Permission.DOWNLOAD_DOCS)),
) -> Response:
    document = _get(db, document_id)
    data = doc_service.record_download(db, document, actor=user, ctx=context_from(request, user))
    return Response(
        content=data,
        media_type=document.mime or "application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{document.file_name}"',
            "X-Document-SHA256": document.sha256 or "",
        },
    )


@router.get("/{document_id}/verify", summary="Re-hash the stored file and compare (DS-09)")
def verify(
    document_id: str, db: DbSession,
    user: User = Depends(require(Permission.VIEW_AUDIT)),
) -> dict:
    document = _get(db, document_id)
    result = doc_service.verify_integrity(document)
    result["file_name"] = document.file_name
    return result


@router.delete("/{document_id}", summary="Soft-delete a document with a reason (DS-08)")
def delete_document(
    document_id: str, request: Request, db: DbSession,
    reason: str = Form(...),
    user: User = Depends(require(Permission.DELETE_ARCHIVE)),
) -> dict:
    document = _get(db, document_id)
    doc_service.soft_delete_document(
        db, document, reason=reason, actor=user, ctx=context_from(request, user)
    )
    return {"detail": f"{document.file_name} removed.", "ok": True}


# --------------------------------------------------------------------------- #
# Auditor share links (AC-07)
# --------------------------------------------------------------------------- #
@router.post("/share-links", status_code=201, summary="Create a time-limited auditor link")
def create_share_link(
    payload: ShareLinkCreate, request: Request, db: DbSession, scope: CurrentScope,
    user: User = Depends(require(Permission.CREATE_SHARE_LINK)),
) -> dict:
    if payload.scope_unit_id and not scope.all_units \
            and payload.scope_unit_id not in scope.unit_ids:
        raise forbidden("You cannot share a unit outside your scope.")
    link = doc_service.create_share_link(
        db, scope_item_id=payload.scope_item_id, scope_unit_id=payload.scope_unit_id,
        created_for=payload.created_for, expires_in_hours=payload.expires_in_hours,
        actor=user, ctx=context_from(request, user),
    )
    return {
        "id": link.id, "token": link.token, "url": doc_service.share_link_url(link),
        "expires_at": link.expires_at, "watermark": link.watermark,
        "scope_item_id": link.scope_item_id, "scope_unit_id": link.scope_unit_id,
        "created_for": link.created_for,
    }


@router.get("/share-links", summary="Active share links")
def list_share_links(
    db: DbSession, user: User = Depends(require(Permission.CREATE_SHARE_LINK))
) -> list[dict]:
    from app.db.types import utcnow

    links = db.execute(
        select(ShareLink).where(ShareLink.revoked.is_(False), ShareLink.expires_at > utcnow())
        .order_by(ShareLink.created_at.desc())
    ).scalars().all()
    return [
        {
            "id": l.id, "token": l.token, "url": doc_service.share_link_url(l),
            "scope_item_id": l.scope_item_id, "scope_unit_id": l.scope_unit_id,
            "created_for": l.created_for, "expires_at": l.expires_at,
            "access_count": l.access_count, "watermark": l.watermark,
        }
        for l in links
    ]


@router.delete("/share-links/{link_id}", summary="Revoke a share link")
def revoke_share_link(
    link_id: str, request: Request, db: DbSession,
    user: User = Depends(require(Permission.CREATE_SHARE_LINK)),
) -> dict:
    link = db.get(ShareLink, link_id)
    if link is None:
        raise not_found("Share link")
    doc_service.revoke_share_link(db, link, actor=user, ctx=context_from(request, user))
    return {"detail": "Share link revoked.", "ok": True}


def _get(db, document_id: str) -> Document:
    document = db.get(Document, document_id)
    if document is None or document.is_deleted:
        raise not_found("Document")
    return document


def _serialise(db, document: Document) -> dict:
    item = db.get(ComplianceItem, document.item_id) if document.item_id else None
    return {
        "id": document.id,
        "title": document.title,
        "file_name": document.file_name,
        "doc_type": document.doc_type,
        "mime_type": document.mime,
        "size_bytes": document.size,
        "version_no": document.version_no,
        "is_current": document.is_current,
        "sha256": document.sha256,
        "virus_scan_status": document.virus_scan_status,
        "item_id": document.item_id,
        "item_code": item.item_code if item else None,
        "instance_id": document.instance_id,
        "reference_number": document.reference_number,
        "issue_date": document.issue_date,
        "expiry_date": document.expiry_date,
        "change_note": document.change_note,
        "uploaded_by": document.created_by,
        "created_at": document.created_at,
        "download_count": document.download_count,
        "expires_in_days": (
            (document.expiry_date - date.today()).days if document.expiry_date else None
        ),
    }

