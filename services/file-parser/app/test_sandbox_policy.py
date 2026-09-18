import unittest

from .sandbox_policy import CandidatePolicyError, validate_candidate_source


class SandboxPolicyTests(unittest.TestCase):
    def test_accepts_a_normal_statement_parser(self):
        validate_candidate_source(
            "import io\nimport pdfplumber\ndef parse(content, specification):\n    return []\n"
        )

    def test_rejects_process_network_and_filesystem_imports(self):
        for module in ("os", "socket", "subprocess", "pathlib", "requests"):
            with self.subTest(module=module), self.assertRaises(CandidatePolicyError):
                validate_candidate_source(f"import {module}\ndef parse(content, specification):\n    return []\n")

    def test_rejects_dynamic_execution_and_dunder_access(self):
        for body in ("eval('1')", "content.__class__", "getattr(content, 'x')"):
            with self.subTest(body=body), self.assertRaises(CandidatePolicyError):
                validate_candidate_source(f"def parse(content, specification):\n    {body}\n    return []\n")

    def test_requires_the_parser_contract(self):
        with self.assertRaises(CandidatePolicyError):
            validate_candidate_source("def other(content, specification):\n    return []\n")


if __name__ == "__main__":
    unittest.main()
