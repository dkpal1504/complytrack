"""Password hashing, JWT issuing/verification, TOTP and upload safety."""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
import pyotp

from app.core.config import settings

ALGORITHM = "HS256"


# --------------------------------------------------------------------------- #
# Passwords
# --------------------------------------------------------------------------- #
def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(plain: str, hashed: str | None) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


class WeakPasswordError(ValueError):
    pass


def validate_password_policy(plain: str) -> None:
    """AC-03: strong password policy for the local-login fallback."""
    problems: list[str] = []
    if len(plain) < settings.password_min_length:
        problems.append(f"at least {settings.password_min_length} characters")
    if not re.search(r"[A-Z]", plain):
        problems.append("an uppercase letter")
    if not re.search(r"[a-z]", plain):
        problems.append("a lowercase letter")
    if not re.search(r"\d", plain):
        problems.append("a digit")
    if not re.search(r"[^A-Za-z0-9]", plain):
        problems.append("a symbol")
    if problems:
        raise WeakPasswordError("Password must contain " + ", ".join(problems) + ".")


def generate_temporary_password(length: int = 16) -> str:
    alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*"
    return "".join(secrets.choice(alphabet) for _ in range(length))


# --------------------------------------------------------------------------- #
# Tokens
# --------------------------------------------------------------------------- #
def create_access_token(
    *, user_id: str, email: str, roles: list[str], extra: dict | None = None
) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "email": email,
        "roles": roles,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.access_token_ttl_minutes)).timestamp()),
        "type": "access",
        **(extra or {}),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def create_refresh_token_value() -> str:
    return secrets.token_urlsafe(48)


def hash_token(value: str) -> str:
    """Refresh tokens are stored hashed — a DB leak must not yield sessions."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError as exc:
        raise ValueError("Session expired. Please sign in again.") from exc
    except jwt.InvalidTokenError as exc:
        raise ValueError("Invalid session token.") from exc


# --------------------------------------------------------------------------- #
# TOTP MFA
# --------------------------------------------------------------------------- #
def new_totp_secret() -> str:
    return pyotp.random_base32()


def totp_provisioning_uri(secret: str, email: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=settings.app_name)


def verify_totp(secret: str | None, code: str) -> bool:
    if not secret or not code:
        return False
    # valid_window=1 tolerates one 30-second step of clock drift.
    return pyotp.TOTP(secret).verify(code.strip(), valid_window=1)


# --------------------------------------------------------------------------- #
# File integrity and safety
# --------------------------------------------------------------------------- #
def sha256_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# Magic-number prefixes for the types we accept (CD-02).
_MAGIC = {
    b"%PDF-": "application/pdf",
    b"\xff\xd8\xff": "image/jpeg",
    b"\x89PNG\r\n\x1a\n": "image/png",
    b"PK\x03\x04": "application/zip",          # docx / xlsx are zip containers
    b"\xd0\xcf\x11\xe0": "application/x-ole-storage",  # legacy doc / xls
}


def sniff_mime(data: bytes) -> str | None:
    for prefix, mime in _MAGIC.items():
        if data.startswith(prefix):
            return mime
    return None


class UploadRejected(ValueError):
    pass


def validate_upload(filename: str, data: bytes) -> str:
    """Extension + magic-number + size check. Returns the detected MIME type.

    This is the AV hook point: a ClamAV sidecar would be called here in
    production, and the verdict written to ``document.virus_scan_status``.
    """
    import os

    ext = os.path.splitext(filename or "")[1].lower()
    if ext not in settings.allowed_upload_extensions:
        raise UploadRejected(
            f"File type '{ext or 'unknown'}' is not allowed. "
            f"Permitted: {', '.join(settings.allowed_upload_extensions)}."
        )
    if len(data) == 0:
        raise UploadRejected("The file is empty.")
    if len(data) > settings.max_upload_bytes:
        raise UploadRejected(
            f"File is larger than {settings.max_upload_mb} MB."
        )
    detected = sniff_mime(data)
    if detected is None:
        raise UploadRejected(
            "File contents do not match a recognised document format."
        )
    return detected


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a, b)


def new_share_token() -> str:
    return secrets.token_urlsafe(32)
