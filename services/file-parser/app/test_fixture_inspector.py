import unittest

from .fixture_inspector import MAX_PAGES, MAX_PREVIEW_CHARS, inspect_fixture


def make_pdf(page_count):
    """A minimal multi-page PDF with one line of text per page."""
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>"]
    kids = " ".join(f"{3 + i * 2} 0 R" for i in range(page_count))
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {page_count} >>".encode())
    font = 3 + page_count * 2
    for i in range(page_count):
        stream = f"BT /F1 12 Tf 72 720 Td (Journey page {i + 1}) Tj ET".encode()
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {4 + i * 2} 0 R "
            f"/Resources << /Font << /F1 {font} 0 R >> >> >>".encode()
        )
        objects.append(b"<< /Length %d >>stream\n" % len(stream) + stream + b"\nendstream")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode()
    return bytes(out)


class FixtureInspectorTests(unittest.TestCase):
    def test_returns_text_fixture_metadata_and_content(self):
        result = inspect_fixture(b"Date,Description,Amount\n2026-01-01,Coffee,-4.50\n", "sample.csv")
        self.assertEqual(result["documentType"], "text")
        self.assertIn("Coffee", result["text"])
        self.assertEqual(len(result["sha256"]), 64)
        self.assertFalse(result["truncated"])

    def test_bounds_text_preview(self):
        result = inspect_fixture(b"x" * (MAX_PREVIEW_CHARS + 1), "sample.txt")
        self.assertEqual(len(result["text"]), MAX_PREVIEW_CHARS)
        self.assertTrue(result["truncated"])

    def test_pdf_pages_can_be_read_in_ranges(self):
        pdf = make_pdf(MAX_PAGES + 3)
        first = inspect_fixture(pdf, "long.pdf")
        self.assertEqual(first["pageCount"], MAX_PAGES + 3)
        self.assertEqual(len(first["pages"]), MAX_PAGES)
        self.assertIn("Journey page 1", first["pages"][0]["text"])
        self.assertEqual(first["nextPage"], MAX_PAGES + 1)
        rest = inspect_fixture(pdf, "long.pdf", first["nextPage"])
        self.assertEqual([p["page"] for p in rest["pages"]], [MAX_PAGES + 1, MAX_PAGES + 2, MAX_PAGES + 3])
        self.assertIn("Journey page 15", rest["pages"][-1]["text"])
        self.assertIsNone(rest["nextPage"])
        self.assertFalse(rest["truncated"])
        with self.assertRaises(ValueError):
            inspect_fixture(pdf, "long.pdf", MAX_PAGES + 10)


if __name__ == "__main__":
    unittest.main()
