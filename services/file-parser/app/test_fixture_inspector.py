import unittest

from .fixture_inspector import MAX_PREVIEW_CHARS, inspect_fixture


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


if __name__ == "__main__":
    unittest.main()
