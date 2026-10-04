"""HTTP tests for the document vault: upload, versioning, download, integrity.

Uploads write into the storage directory the ``client`` fixture has pointed at
``tmp_path``, so nothing lands in ``backend/storage``.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import settings
from app.models.audit import AuditLog
from app.models.compliance import ComplianceInstance
from app.services.documents import storage_path
from tests.conftest import login

ADMIN = "admin@complytrack.local"
COMPLIANCE = "compliance@complytrack.local"
DEPARTMENT = "safety.owner@complytrack.local"

PDF = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF\n"


def _instance(db) -> ComplianceInstance:
    return db.execute(select(ComplianceInstance).limit(1)).scalar_one()


def _upload(client: TestClient, headers, instance, **overrides):
    form = {
        "title": "Fire NOC",
        "doc_type": "Certificate",
        "item_id": instance.item_id,
        "instance_id": instance.id,
        "change_note": "First upload.",
        **overrides,
    }
    filename = form.pop("filename", "certificate.pdf")
    body = form.pop("body", PDF)
    content_type = form.pop("content_type", "application/pdf")
    return client.post(
        "/api/v1/documents",
        headers=headers,
        data=form,
        files={"file": (filename, body, content_type)},
    )


# --------------------------------------------------------------------------- #
# Upload
# --------------------------------------------------------------------------- #
def test_uploading_a_document_records_its_hash_and_size(demo, client: TestClient) -> None:
    instance = _instance(demo)
    response = _upload(client, login(client, ADMIN), instance)

    assert response.status_code == 201
    payload = response.json()
    assert payload["file_name"] == "certificate.pdf"
    assert payload["doc_type"] == "Certificate"
    assert payload["mime_type"] == "application/pdf"
    assert payload["size_bytes"] == len(PDF)
    assert payload["sha256"] == hashlib.sha256(PDF).hexdigest()
    assert payload["version_no"] == 1
    assert payload["is_current"] is True
    assert payload["virus_scan_status"] == "Clean"
    assert payload["item_id"] == instance.item_id
    assert payload["instance_id"] == instance.id


def test_uploading_is_audited(demo, client: TestClient) -> None:
    instance = _instance(demo)
    document_id = _upload(client, login(client, ADMIN), instance).json()["id"]

    entry = demo.execute(
        select(AuditLog).where(
            AuditLog.entity_type == "document",
            AuditLog.entity_id == document_id,
            AuditLog.action == "upload",
        )
    ).scalars().first()
    assert entry is not None
    assert entry.user_email == ADMIN


def test_an_empty_upload_is_rejected(demo, client: TestClient) -> None:
    response = _upload(client, login(client, ADMIN), _instance(demo), body=b"")
    assert response.status_code == 400
    assert "empty" in response.json()["detail"].lower()


def test_a_disallowed_extension_is_rejected(demo, client: TestClient) -> None:
    response = _upload(
        client, login(client, ADMIN), _instance(demo),
        filename="payload.exe", body=b"MZ\x90\x00", content_type="application/octet-stream",
    )
    assert response.status_code == 400
    assert "not allowed" in response.json()["detail"]


def test_content_that_is_not_a_real_document_is_rejected(demo, client: TestClient) -> None:
    response = _upload(
        client, login(client, ADMIN), _instance(demo),
        filename="fake.pdf", body=b"just some text, not a PDF at all",
    )
    assert response.status_code == 400
    assert "recognised document format" in response.json()["detail"]


def test_uploading_to_an_unknown_item_is_a_404(demo, client: TestClient) -> None:
    instance = _instance(demo)
    response = _upload(
        client, login(client, ADMIN), instance, item_id="no-such-item", instance_id=instance.id
    )
    assert response.status_code == 404


def test_a_department_user_cannot_upload_to_another_departments_item(demo, client: TestClient) -> None:
    instance = _instance(demo)
    response = _upload(client, login(client, DEPARTMENT), instance)
    assert response.status_code == 403
    assert "another department" in response.json()["detail"]


# --------------------------------------------------------------------------- #
# Versioning (DS-05)
# --------------------------------------------------------------------------- #
def test_re_uploading_the_same_title_and_type_creates_a_new_version(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    instance = _instance(demo)
    first = _upload(client, headers, instance).json()

    second = _upload(
        client, headers, instance,
        body=PDF + b"second revision\n", change_note="Corrected the annexure.",
    ).json()
    assert second["version_no"] == 2
    assert second["is_current"] is True

    demo.expire_all()
    listed = client.get(
        "/api/v1/documents", headers=headers,
        params={"item_id": instance.item_id, "current_only": True},
    ).json()
    assert [row["id"] for row in listed] == [second["id"]]

    versions = client.get(f"/api/v1/documents/{second['id']}/versions", headers=headers).json()
    assert [row["version_no"] for row in versions] == [2, 1]
    assert versions[1]["id"] == first["id"]
    assert versions[1]["is_current"] is False


def test_the_document_list_can_be_filtered_by_cycle(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    instance = _instance(demo)
    created = _upload(client, headers, instance).json()

    listed = client.get(
        "/api/v1/documents", headers=headers, params={"instance_id": instance.id}
    ).json()
    assert created["id"] in {row["id"] for row in listed}

    assert client.get(
        "/api/v1/documents", headers=headers, params={"item_id": "no-such-item"}
    ).status_code == 404


# --------------------------------------------------------------------------- #
# Download (DS-04)
# --------------------------------------------------------------------------- #
def test_download_returns_the_uploaded_bytes_and_their_hash(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    created = _upload(client, headers, _instance(demo)).json()

    response = client.get(f"/api/v1/documents/{created['id']}/download", headers=headers)
    assert response.status_code == 200
    assert response.content == PDF
    assert response.headers["X-Document-SHA256"] == hashlib.sha256(PDF).hexdigest()
    assert response.headers["X-Document-SHA256"] == created["sha256"]
    assert response.headers["content-type"].startswith("application/pdf")
    assert response.headers["content-disposition"] == 'attachment; filename="certificate.pdf"'


def test_downloading_is_counted_and_audited(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    created = _upload(client, headers, _instance(demo)).json()
    client.get(f"/api/v1/documents/{created['id']}/download", headers=headers)

    demo.expire_all()
    listed = client.get(
        "/api/v1/documents", headers=headers, params={"item_id": created["item_id"]}
    ).json()
    assert listed[0]["download_count"] == 1

    assert demo.execute(
        select(AuditLog).where(
            AuditLog.entity_id == created["id"], AuditLog.action == "download"
        )
    ).scalars().first() is not None


def test_downloading_an_unknown_document_is_a_404(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    assert client.get("/api/v1/documents/nope/download", headers=headers).status_code == 404
    assert client.get("/api/v1/documents/nope/versions", headers=headers).status_code == 404
    assert client.get("/api/v1/documents/nope/verify", headers=headers).status_code == 404
    assert client.request(
        "DELETE", "/api/v1/documents/nope", headers=headers, data={"reason": "No such file."}
    ).status_code == 404


# --------------------------------------------------------------------------- #
# Integrity (AT-05 / DS-09)
# --------------------------------------------------------------------------- #
def test_integrity_check_confirms_an_untouched_file(demo, client: TestClient) -> None:
    headers = login(client, COMPLIANCE)
    created = _upload(client, login(client, ADMIN), _instance(demo)).json()

    response = client.get(f"/api/v1/documents/{created['id']}/verify", headers=headers)
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["expected"] == payload["actual"] == created["sha256"]
    assert payload["reason"] is None
    assert payload["file_name"] == "certificate.pdf"


def test_integrity_check_notices_a_tampered_file(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    created = _upload(client, headers, _instance(demo)).json()

    stored: Path = storage_path(created["sha256"][:2] + "/" + created["sha256"] + ".pdf")
    assert stored.exists(), f"upload did not land in {settings.storage_dir}"
    stored.write_bytes(b"%PDF-1.4 tampered with\n")

    payload = client.get(f"/api/v1/documents/{created['id']}/verify", headers=headers).json()
    assert payload["ok"] is False
    assert payload["reason"] == "Hash mismatch — file altered."


# --------------------------------------------------------------------------- #
# Delete (DS-08)
# --------------------------------------------------------------------------- #
def test_deleting_a_document_needs_a_reason(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    created = _upload(client, headers, _instance(demo)).json()

    assert client.delete(f"/api/v1/documents/{created['id']}", headers=headers).status_code == 422

    removed = client.request(
        "DELETE",
        f"/api/v1/documents/{created['id']}",
        headers=headers,
        data={"reason": "Superseded by the corrected scan."},
    )
    assert removed.status_code == 200
    assert removed.json()["ok"] is True

    assert client.get(f"/api/v1/documents/{created['id']}/download", headers=headers).status_code == 404
    listed = client.get(
        "/api/v1/documents", headers=headers, params={"item_id": created["item_id"]}
    ).json()
    assert created["id"] not in {row["id"] for row in listed}


# --------------------------------------------------------------------------- #
# Auditor share links (AC-07)
# --------------------------------------------------------------------------- #
def test_a_share_link_can_be_created_and_revoked(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    instance = _instance(demo)

    created = client.post(
        "/api/v1/documents/share-links",
        headers=headers,
        json={
            "scope_item_id": instance.item_id,
            "created_for": "Statutory auditor",
            "expires_in_hours": 24,
        },
    )
    assert created.status_code == 201
    payload = created.json()
    assert payload["token"]
    assert payload["url"].startswith("/shared/")
    assert payload["watermark"] is True

    listed = client.get("/api/v1/documents/share-links", headers=headers).json()
    assert payload["id"] in {link["id"] for link in listed}

    revoked = client.delete(f"/api/v1/documents/share-links/{payload['id']}", headers=headers)
    assert revoked.status_code == 200
    assert client.get("/api/v1/documents/share-links", headers=headers).json() == []


def test_a_share_link_must_stay_inside_the_scope(demo, client: TestClient) -> None:
    response = client.post(
        "/api/v1/documents/share-links",
        headers=login(client, DEPARTMENT),
        json={"scope_unit_id": "some-other-unit", "expires_in_hours": 24},
    )
    assert response.status_code in (403, 404)
