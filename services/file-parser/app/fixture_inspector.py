import hashlib
import io

import pdfplumber


MAX_PREVIEW_CHARS = 60_000
MAX_PAGES = 12


def inspect_fixture(content, filename="statement", start_page=1, end_page=None):
    """Extract text for reading. PDFs return up to MAX_PAGES pages from start_page (through end_page when given), with nextPage when more remain."""
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
        start = max(1, int(start_page or 1))
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            if start > max(len(pdf.pages), 1):
                raise ValueError(f"Document has {len(pdf.pages)} pages")
            stop = start - 1 + MAX_PAGES
            if end_page:
                if int(end_page) < start:
                    raise ValueError("endPage must not be before startPage")
                stop = min(stop, int(end_page))
            next_page = None
            for page_number, page in enumerate(pdf.pages[start - 1 : stop], start=start):
                text = page.extract_text() or ""
                remaining = MAX_PREVIEW_CHARS - total_chars
                if remaining <= 0:
                    base["truncated"] = True
                    next_page = page_number
                    break
                if len(text) > remaining:
                    text = text[:remaining]
                    base["truncated"] = True
                pages.append({"page": page_number, "text": text})
                total_chars += len(text)
            last = pages[-1]["page"] if pages else start - 1
            if next_page is None and last < len(pdf.pages):
                next_page = last + 1
            # Pages after an explicit endPage were not asked for: not a truncation.
            if next_page is not None and end_page and next_page > int(end_page):
                next_page = None
            if next_page is not None:
                base["truncated"] = True
            base.update(
                documentType="pdf",
                pageCount=len(pdf.pages),
                pages=pages,
                nextPage=next_page,
            )
        return base

    text = content.decode("utf-8-sig", errors="replace")
    if len(text) > MAX_PREVIEW_CHARS:
        text = text[:MAX_PREVIEW_CHARS]
        base["truncated"] = True
    base.update(documentType="text", text=text)
    return base
