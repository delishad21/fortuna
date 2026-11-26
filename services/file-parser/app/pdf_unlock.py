"""Opens password-protected statement PDFs so they can be stored and parsed.

The password is used once, in memory, and is never logged or returned. A PDF
that opens without a password (no encryption, or owner restrictions only) is
left exactly as uploaded.
"""

import io

import pikepdf

NOT_LOCKED = "not_locked"
UNREADABLE = "unreadable"
PASSWORD_REQUIRED = "password_required"
PASSWORD_INCORRECT = "password_incorrect"
UNLOCKED = "unlocked"


def unlock_pdf(content, password=None):
    """Returns (status, decrypted bytes or None)."""
    try:
        with pikepdf.open(io.BytesIO(content)):
            return NOT_LOCKED, None
    except pikepdf.PasswordError:
        pass
    except pikepdf.PdfError:
        return UNREADABLE, None
    if not password:
        return PASSWORD_REQUIRED, None
    try:
        with pikepdf.open(io.BytesIO(content), password=password) as pdf:
            out = io.BytesIO()
            # A content-derived /ID keeps the output identical for the same upload,
            # so uploading one statement twice is still recognised as a duplicate.
            pdf.save(out, encryption=False, deterministic_id=True)
            return UNLOCKED, out.getvalue()
    except pikepdf.PasswordError:
        return PASSWORD_INCORRECT, None
    except pikepdf.PdfError:
        return UNREADABLE, None
