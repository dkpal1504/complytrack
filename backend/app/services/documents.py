"""Document upload, versioning, integrity and secure sharing (DS-01..DS-09)."""

from __future__ import annotations

import hashlib
import uuid
from datetime import date, timedelta
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import UploadRejected, new_share_token, sha256_of, validate_upload
from app.db.types import utcnow
from app.models.auth import User
from app.models.documents import Document, ShareLink
from app.services import audit, notifications


def storage_path(key: str) -> Path:
    return settings.storage_dir / key


def save_bytes(data: bytes, *, filename: str) -> tuple[str, str]:
    """Persist to content-addressed storage, returning (key, sha256)."""
    digest = sha256_of(data)
    suffix = Path(filename).suffix.lower()
    key = f"{digest[:2]}/{digest}{suffix}"
    target = storage_path(key)
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        target.write_bytes(data)
    return key, digest


def read_bytes(document: Document) -> bytes:
    return storage_path(document.storage_key).read_bytes()


def upload_document(
    db: Session,
    *,
    data: bytes,
    filename: str,
    title: str,
    doc_type: str,
    item_id: str | None,
    instance_id: str | None,
    reference_number: str | None = None,
    issue_date: date | None = None,
    expiry_date: date | None = None,
    change_note: str | None = None,
    retention_years: int | None = None,
    actor: User,
    ctx: dict,
) -> Document:
    """CD-02/DS-03/DS-05: validate, hash, store and version a new upload."""
    mime = validate_upload(filename, data)
    key, digest = save_bytes(data, filename=filename)

    # Version the document family: same item + title + type.
    previous = db.execute(
        select(Document)
        .where(
            Document.item_id == item_id,
            Document.title == title,
            Document.doc_type == doc_type,
            Document.is_current.is_(True),
            Document.is_deleted.is_(False),
        )
        .order_by(Document.version_no.desc())
        .limit(1)
    ).scalar_one_or_none()

    if previous is not None:
        previous.is_current = False
        db.add(previous)

    document = Document(
        item_id=item_id,
        instance_id=instance_id,
        doc_type=doc_type,
        title=title,
        file_name=filename,
        mime=mime,
        size=len(data),
        storage_key=key,
        sha256=digest,
        version_no=(previous.version_no + 1) if previous else 1,
        is_current=True,
        supersedes_id=previous.id if previous else None,
        reference_number=reference_number,
        issue_date=issue_date,
        expiry_date=expiry_date,
        change_note=change_note,
        virus_scan_status="Clean",
        retention_until=(
            date.today() + timedelta(days=365 * retention_years) if retention_years else None
        ),
        created_by=actor.id,
    )
    db.add(document)
    db.flush()

    audit.write_audit(
        db,
        entity_type="document",
        entity_id=document.id,
        action="upload",
        new_value={
            "title": title, "type": doc_type, "version": document.version_no,
            "size": len(data), "sha256": digest, "file": filename,
        },
        reason=change_note,
        **{k: ctx.get(k) for k in ("user_id", "user_email", "ip", "user_agent")},
    )
    db.commit()
    db.refresh(document)
    return document


def list_documents(
    db: Session, *, item_id: str | None = None, instance_id: str | None = None,
    current_only: bool = False,
) -> list[Document]:
    stmt = select(Document).where(Document.is_deleted.is_(False))
    if item_id:
        stmt = stmt.where(Document.item_id == item_id)
    if instance_id:
        stmt = stmt.where(Document.instance_id == instance_id)
    if current_only:
        stmt = stmt.where(Document.is_current.is_(True))
    return list(db.execute(stmt.order_by(Document.created_at.desc())).scalars().all())


def versions_of(db: Session, document: Document) -> list[Document]:
    """DS-05: every version of the same document family, newest first."""
    return list(
        db.execute(
            select(Document)
            .where(
                Document.item_id == document.item_id,
                Document.title == document.title,
                Document.doc_type == document.doc_type,
                Document.is_deleted.is_(False),
            )
            .order_by(Document.version_no.desc())
        ).scalars().all()
    )


def record_download(db: Session, document: Document, *, actor: User, ctx: dict) -> bytes:
    document.download_count = (document.download_count or 0) + 1
    document.last_downloaded_at = utcnow()
    db.add(document)
    audit.write_audit(
        db, entity_type="document", entity_id=document.id, action="download",
        new_value={"file": document.file_name, "version": document.version_no},
        **{k: ctx.get(k) for k in ("user_id", "user_email", "ip", "user_agent")},
    )
    db.commit()
    return read_bytes(document)


def soft_delete_document(
    db: Session, document: Document, *, reason: str, actor: User, ctx: dict
) -> None:
    document.is_deleted = True
    document.deleted_at = utcnow()
    document.deleted_by = actor.id
    document.delete_reason = reason
    document.is_current = False
    db.add(document)
    audit.write_audit(
        db, entity_type="document", entity_id=document.id, action="delete",
        reason=reason, **{k: ctx.get(k) for k in ("user_id", "user_email", "ip", "user_agent")},
    )
    db.commit()


def verify_integrity(document: Document) -> dict:
    """AT-05: re-hash the stored file and compare with the recorded SHA-256."""
    path = storage_path(document.storage_key)
    if not path.exists():
        return {"ok": False, "reason": "File missing from storage.", "expected": document.sha256}
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    return {
        "ok": actual == document.sha256,
        "expected": document.sha256,
        "actual": actual,
        "reason": None if actual == document.sha256 else "Hash mismatch — file altered.",
    }


# --------------------------------------------------------------------------- #
# DS-09: secure, time-limited sharing with auditors / inspectors
# --------------------------------------------------------------------------- #
def create_share_link(
    db: Session, *, scope_item_id: str | None, scope_unit_id: str | None,
    created_for: str | None, expires_in_hours: int, actor: User, ctx: dict,
) -> ShareLink:
    link = ShareLink(
        token=new_share_token(),
        scope_item_id=scope_item_id,
        scope_unit_id=scope_unit_id,
        created_for=created_for,
        expires_at=utcnow() + timedelta(hours=expires_in_hours),
        watermark=True,
        created_by=actor.id,
    )
    db.add(link)
    audit.write_audit(
        db, entity_type="share_link", entity_id=link.id, action="create",
        new_value={"scope_item": scope_item_id, "scope_unit": scope_unit_id,
                   "expires_at": link.expires_at.isoformat(), "for": created_for},
        **{k: ctx.get(k) for k in ("user_id", "user_email", "ip", "user_agent")},
    )
    db.commit()
    db.refresh(link)
    return link


def resolve_share_link(db: Session, token: str) -> ShareLink | None:
    link = db.execute(
        select(ShareLink).where(ShareLink.token == token, ShareLink.revoked.is_(False))
    ).scalar_one_or_none()
    if link is None:
        return None
    if link.expires_at < utcnow():
        return None
    link.access_count = (link.access_count or 0) + 1
    db.add(link)
    db.commit()
    db.refresh(link)
    return link


def revoke_share_link(db: Session, link: ShareLink, *, actor: User, ctx: dict) -> None:
    link.revoked = True
    db.add(link)
    audit.write_audit(
        db, entity_type="share_link", entity_id=link.id, action="revoke",
        **{k: ctx.get(k) for k in ("user_id", "user_email", "ip", "user_agent")},
    )
    db.commit()


def share_link_url(link: ShareLink) -> str:
    return f"/shared/{link.token}"
