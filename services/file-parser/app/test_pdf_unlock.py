import io

import pdfplumber
import pikepdf

from app import main
from app.pdf_unlock import (
    NOT_LOCKED,
    PASSWORD_INCORRECT,
    PASSWORD_REQUIRED,
    UNLOCKED,
    UNREADABLE,
    unlock_pdf,
)

HEADERS = {"X-Internal-Service-Token": "unlock-test"}


def _pdf(user_password=None, owner_password="owner-secret"):
    pdf = pikepdf.new()
    pdf.add_blank_page()
    out = io.BytesIO()
    if user_password is None:
        pdf.save(out)
    else:
        pdf.save(out, encryption=pikepdf.Encryption(user=user_password, owner=owner_password, R=6))
    return out.getvalue()


def test_locked_pdf_needs_its_password():
    locked = _pdf("s3cret")
    assert unlock_pdf(locked) == (PASSWORD_REQUIRED, None)
    assert unlock_pdf(locked, "wrong") == (PASSWORD_INCORRECT, None)
    status, unlocked = unlock_pdf(locked, "s3cret")
    assert status == UNLOCKED
    with pikepdf.open(io.BytesIO(unlocked)) as pdf:
        assert not pdf.is_encrypted
    with pdfplumber.open(io.BytesIO(unlocked)) as pdf:
        assert len(pdf.pages) == 1
    # The same upload unlocks to the same bytes, so duplicates are still caught.
    assert unlock_pdf(locked, "s3cret")[1] == unlocked


def test_open_pdfs_and_other_files_are_left_alone():
    assert unlock_pdf(_pdf()) == (NOT_LOCKED, None)
    # Owner restrictions only: it opens without a password and stays as uploaded.
    assert unlock_pdf(_pdf(""), "anything") == (NOT_LOCKED, None)
    assert unlock_pdf(b"Date,Amount\n2026-12-01,4.50\n") == (UNREADABLE, None)


def test_unlock_route(monkeypatch):
    monkeypatch.setenv("INTERNAL_SERVICE_TOKEN", "unlock-test")
    client = main.app.test_client()
    locked = _pdf("s3cret")

    def post(password=None, headers=HEADERS):
        data = {"file": (io.BytesIO(locked), "statement.pdf")}
        if password is not None:
            data["password"] = password
        return client.post("/pdf/unlock", data=data, headers=headers)

    assert post(headers={}).status_code == 401
    assert post().get_json() == {"status": PASSWORD_REQUIRED}
    wrong = post("wrong")
    assert wrong.get_json() == {"status": PASSWORD_INCORRECT}
    assert b"wrong" not in wrong.data
    ok = post("s3cret")
    assert ok.status_code == 200
    assert ok.headers["X-Pdf-Status"] == UNLOCKED
    assert ok.mimetype == "application/pdf"
    assert ok.data.startswith(b"%PDF")
