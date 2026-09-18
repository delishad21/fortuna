import unittest

from .config_candidate import evaluate_candidate, parse_config_csv, validate_spec


class ConfigCandidateTests(unittest.TestCase):
    def test_parses_header_mapped_csv_stably(self):
        content = b"Date,Details,Debit,Credit\n2026-08-01,Coffee,4.50,\n2026-08-02,Refund,,2.00\n"
        spec = {
            "documentType": "csv",
            "columns": {"date": "Date", "description": "Details", "debit": "Debit", "credit": "Credit"},
            "dateFormat": "%Y-%m-%d",
            "currency": "SGD",
        }
        rows = parse_config_csv(content, spec)
        self.assertEqual(rows[0]["amountOut"], 4.5)
        self.assertEqual(rows[1]["amountIn"], 2.0)
        self.assertTrue(evaluate_candidate(content, spec)["passed"])

    def test_rejects_executable_or_incomplete_specs(self):
        with self.assertRaises(ValueError):
            validate_spec({"documentType": "python", "columns": {}})
        with self.assertRaises(ValueError):
            validate_spec({"documentType": "csv", "columns": {"date": "Date", "description": "Details"}})

    def test_bank_candidate_requires_account_identifier(self):
        content = b"Date,Details,Debit,Credit\n2026-08-01,Coffee,4.50,\n"
        spec = {
            "documentType": "csv",
            "mode": "bank",
            "columns": {"date": "Date", "description": "Details", "debit": "Debit", "credit": "Credit"},
            "dateFormat": "%Y-%m-%d",
        }
        report = evaluate_candidate(content, spec)
        self.assertFalse(report["passed"])
        self.assertEqual(report["missingAccountIdentifierRows"], 1)


if __name__ == "__main__":
    unittest.main()
