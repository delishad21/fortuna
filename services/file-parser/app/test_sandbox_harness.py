import base64
import json
import subprocess
import sys
import unittest


GOOD_SOURCE = """
import csv
import io
from datetime import datetime

def parse(content, specification):
    rows = []
    for row in csv.DictReader(io.StringIO(content.decode('utf-8'))):
        rows.append({
            'date': datetime.strptime(row['Date'], '%Y-%m-%d').date().isoformat(),
            'description': row['Description'],
            'amountIn': float(row['Credit']) if row['Credit'] else None,
            'amountOut': float(row['Debit']) if row['Debit'] else None,
            'currency': 'SGD',
        })
    return rows
"""


class SandboxHarnessTests(unittest.TestCase):
    def _run(self, source=GOOD_SOURCE, specification=None):
        payload = {
            "sourceCode": source,
            "contentBase64": base64.b64encode(
                b"Date,Description,Debit,Credit\n2026-01-02,Coffee,4.50,\n2026-01-03,Refund,,2.00\n"
            ).decode("ascii"),
            "specification": specification or {},
        }
        completed = subprocess.run(
            [sys.executable, "-m", "app.sandbox_harness"],
            input=json.dumps(payload).encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        return completed.returncode, json.loads(completed.stdout)

    def test_runs_twice_and_reconciles_output(self):
        code, result = self._run(
            specification={"validation": {"expectedCount": 2, "expectedTotalIn": 2, "expectedTotalOut": 4.5}}
        )
        self.assertEqual(code, 0)
        self.assertTrue(result["report"]["passed"])
        self.assertTrue(result["report"]["stableOutput"])
        self.assertEqual(len(result["transactions"]), 2)

    def test_fails_reconciliation_mismatch(self):
        code, result = self._run(specification={"validation": {"expectedCount": 3}})
        self.assertEqual(code, 0)
        self.assertFalse(result["report"]["passed"])

    def test_requires_and_reconciles_bank_account_identifier(self):
        code, result = self._run(
            specification={"mode": "bank", "validation": {"expectedAccountIdentifiers": ["532392****2124"]}}
        )
        self.assertEqual(code, 0)
        self.assertFalse(result["report"]["passed"])
        self.assertEqual(result["report"]["missingAccountIdentifierRows"], 2)

        source = GOOD_SOURCE.replace("'currency': 'SGD',", "'currency': 'SGD',\n            'accountIdentifier': '532392****2124',")
        code, result = self._run(
            source=source,
            specification={"mode": "bank", "validation": {"expectedAccountIdentifiers": ["532392****2124"]}},
        )
        self.assertEqual(code, 0)
        self.assertTrue(result["report"]["passed"])

    def test_rejects_invalid_transaction_contract(self):
        code, result = self._run(
            source="def parse(content, specification):\n    return [{'date':'bad','description':'x','amountOut':1}]\n"
        )
        self.assertNotEqual(code, 0)
        self.assertIn("date must be ISO", result["error"])


if __name__ == "__main__":
    unittest.main()
