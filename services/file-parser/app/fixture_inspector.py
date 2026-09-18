import hashlib
import io

import pdfplumber


MAX_PREVIEW_CHARS = 60_000
MAX_PAGES = 12


def inspect_fixture(content, filename="statement"):
    if not isinstance(content, bytes) or not content:
        raise ValueError("Fixture content is required")

    base = {
        "filename": filename,
        "sizeBytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
        "truncated": False,
    }
    if content.startswith(b"%PDF-") or filename.lower().endswith(".pdf"):
        pages = []
        total_chars = 0
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            for page_number, page in enumerate(pdf.pages[:MAX_PAGES], start=1):
                text = page.extract_text() or ""
                remaining = MAX_PREVIEW_CHARS - total_chars
                if remaining <= 0:
                    base["truncated"] = True
                    break
                if len(text) > remaining:
                    text = text[:remaining]
                    base["truncated"] = True
                pages.append({"page": page_number, "text": text})
                total_chars += len(text)
            if len(pdf.pages) > MAX_PAGES:
                base["truncated"] = True
            base.update(documentType="pdf", pageCount=len(pdf.pages), pages=pages)
        return base

    text = content.decode("utf-8-sig", errors="replace")
    if len(text) > MAX_PREVIEW_CHARS:
        text = text[:MAX_PREVIEW_CHARS]
        base["truncated"] = True
    base.update(documentType="text", text=text)
    return base
