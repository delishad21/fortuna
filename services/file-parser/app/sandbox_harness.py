import base64
import contextlib
from datetime import date
import io
import json
import math
import sys

class _BoundedLog(io.TextIOBase):
    def __init__(self, limit=65_536):
        self.limit = limit
        self.parts = []
        self.size = 0

    def write(self, value):
        text = str(value)
        self.size += len(text.encode("utf-8", errors="replace"))
        if self.size > self.limit:
            raise RuntimeError("Candidate log output exceeded 64 KB")
        self.parts.append(text)
        return len(text)

    def text(self):
        return "".join(self.parts)


def _number(value, field, index):
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ValueError(f"Row {index}: {field} must be numeric")
    number = float(value)
    if not math.isfinite(number) or number < 0:
        raise ValueError(f"Row {index}: {field} must be a finite non-negative number")
    return number


def _normalize_transactions(value):
    if not isinstance(value, list):
        raise ValueError("parse must return a list of transactions")
    if len(value) > 10_000:
        raise ValueError("Candidate output exceeds 10,000 transactions")
    normalized = []
    for index, raw in enumerate(value, start=1):
        if not isinstance(raw, dict):
            raise ValueError(f"Row {index}: transaction must be an object")
        parsed_date = str(raw.get("date") or "").strip()
        try:
            date.fromisoformat(parsed_date)
        except ValueError as error:
            raise ValueError(f"Row {index}: date must be ISO YYYY-MM-DD") from error
        description = str(raw.get("description") or "").strip()
        if not description:
            raise ValueError(f"Row {index}: description is required")
        amount_in = _number(raw.get("amountIn"), "amountIn", index)
        amount_out = _number(raw.get("amountOut"), "amountOut", index)
        if (amount_in or 0) > 0 and (amount_out or 0) > 0:
            raise ValueError(f"Row {index}: amountIn and amountOut cannot both be positive")
        if (amount_in or 0) <= 0 and (amount_out or 0) <= 0:
            raise ValueError(
                f"Row {index}: set positive amountOut for an expense or positive amountIn for income"
            )
        balance = raw.get("balance")
        if balance is not None and balance != "":
            balance = float(balance)
            if not math.isfinite(balance):
                raise ValueError(f"Row {index}: balance must be finite")
        transaction = dict(raw)
        transaction.update(
            date=parsed_date,
            description=description,
            amountIn=amount_in,
            amountOut=amount_out,
            balance=balance,
            currency=str(raw.get("currency") or "SGD").strip().upper(),
        )
        json.dumps(transaction)
        normalized.append(transaction)
    return normalized


def _expectations(transactions, specification):
    validation = specification.get("validation") if isinstance(specification, dict) else None
    validation = validation if isinstance(validation, dict) else {}
    errors = []
    tolerance = float(validation.get("amountTolerance", 0.01))
    count = len(transactions)
    total_in = round(sum(row.get("amountIn") or 0 for row in transactions), 2)
    total_out = round(sum(row.get("amountOut") or 0 for row in transactions), 2)
    minimum = int(validation.get("minTransactions", 1))
    maximum = int(validation.get("maxTransactions", 10_000))
    if count < minimum or count > maximum:
        errors.append(f"Transaction count {count} is outside expected range {minimum}..{maximum}")
    if "expectedCount" in validation and count != int(validation["expectedCount"]):
        errors.append(f"Transaction count {count} does not match expected {validation['expectedCount']}")
    for key, actual in (("expectedTotalIn", total_in), ("expectedTotalOut", total_out)):
        if key in validation and abs(actual - float(validation[key])) > tolerance:
            errors.append(f"{key} mismatch: got {actual}, expected {validation[key]}")
    dates = [row["date"] for row in transactions]
    account_identifiers = sorted({
        str(row.get("accountIdentifier") or "").strip()
        for row in transactions
        if str(row.get("accountIdentifier") or "").strip()
    })
    missing_account_rows = sum(
        1 for row in transactions if not str(row.get("accountIdentifier") or "").strip()
    )
    if specification.get("mode") == "bank" and missing_account_rows:
        errors.append(
            f"{missing_account_rows} bank transaction(s) are missing accountIdentifier"
        )
    expected_accounts = sorted({
        str(value).strip()
        for value in validation.get("expectedAccountIdentifiers", [])
        if str(value).strip()
    })
    if expected_accounts and account_identifiers != expected_accounts:
        errors.append(
            f"accountIdentifier mismatch: got {account_identifiers}, expected {expected_accounts}"
        )
    return {
        "passed": not errors and bool(transactions),
        "transactionCount": count,
        "dateFrom": min(dates) if dates else None,
        "dateTo": max(dates) if dates else None,
        "totalIn": total_in,
        "totalOut": total_out,
        "accountIdentifiers": account_identifiers,
        "missingAccountIdentifierRows": missing_account_rows,
        "errors": errors,
        "warnings": [] if transactions else ["Candidate produced no transactions"],
    }


def main():
    payload = json.loads(sys.stdin.buffer.read())
    source = payload["sourceCode"]
    specification = payload.get("specification") or {}
    content = base64.b64decode(payload["contentBase64"], validate=True)
    namespace = {"__name__": "fortuna_candidate", "__file__": "candidate.py"}
    logs = _BoundedLog()
    with contextlib.redirect_stdout(logs), contextlib.redirect_stderr(logs):
        exec(compile(source, "candidate.py", "exec"), namespace, namespace)
        parser = namespace.get("parse")
        if not callable(parser):
            raise ValueError("Candidate parse function is unavailable")
        first = _normalize_transactions(parser(content, specification))
        second = _normalize_transactions(parser(content, specification))
    stable = first == second
    report = _expectations(first, specification)
    if not stable:
        report["errors"].append("Candidate output changed between identical runs")
        report["passed"] = False
    report.update(
        stableOutput=stable,
        staticValidationPassed=True,
        preview=first[:20],
        candidateLog=logs.text()[-4000:],
    )
    sys.stdout.write(json.dumps({"transactions": first, "report": report}, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        sys.stdout.write(json.dumps({"error": str(error), "report": {"passed": False}}, separators=(",", ":")))
        sys.exit(1)
