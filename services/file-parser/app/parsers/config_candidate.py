import csv
import io
from datetime import datetime
from decimal import Decimal, InvalidOperation


ALLOWED_FIELDS = {
    "date",
    "description",
    "debit",
    "credit",
    "amount",
    "direction",
    "balance",
    "currency",
    "accountIdentifier",
}


def validate_spec(spec):
    if not isinstance(spec, dict):
        raise ValueError("Parser specification must be an object")
    if spec.get("documentType") != "csv":
        raise ValueError("Configuration candidates currently support CSV only")
    columns = spec.get("columns")
    if not isinstance(columns, dict):
        raise ValueError("columns must be an object")
    unknown = set(columns) - ALLOWED_FIELDS
    if unknown:
        raise ValueError(f"Unsupported configured fields: {', '.join(sorted(unknown))}")
    for required in ("date", "description"):
        if required not in columns:
            raise ValueError(f"columns.{required} is required")
    if not ({"debit", "credit"} <= set(columns) or "amount" in columns):
        raise ValueError("Configure debit+credit columns or an amount column")
    delimiter = spec.get("delimiter", ",")
    if delimiter not in {",", ";", "\t", "|"}:
        raise ValueError("Unsupported delimiter")
    return spec


def _cell(row, selector):
    if isinstance(selector, int):
        values = list(row.values())
        return values[selector] if 0 <= selector < len(values) else ""
    return row.get(str(selector), "")


def _money(value):
    cleaned = str(value or "").strip().replace(",", "").replace("$", "")
    if not cleaned:
        return None
    negative = cleaned.startswith("(") and cleaned.endswith(")")
    cleaned = cleaned.strip("()")
    try:
        amount = Decimal(cleaned)
    except InvalidOperation as error:
        raise ValueError(f"Invalid amount: {value}") from error
    return float(-amount if negative else amount)


def parse_config_csv(content, spec):
    validate_spec(spec)
    text = content.decode(spec.get("encoding", "utf-8-sig"))
    reader = csv.DictReader(io.StringIO(text), delimiter=spec.get("delimiter", ","))
    columns = spec["columns"]
    date_format = spec.get("dateFormat", "%Y-%m-%d")
    default_currency = str(spec.get("currency", "SGD")).upper()
    rows = []
    for index, row in enumerate(reader):
        if index >= 10000:
            raise ValueError("Candidate output exceeds 10,000 rows")
        raw_date = str(_cell(row, columns["date"])).strip()
        description = str(_cell(row, columns["description"])).strip()
        if not raw_date and not description:
            continue
        parsed_date = datetime.strptime(raw_date, date_format).date().isoformat()
        debit = _money(_cell(row, columns.get("debit"))) if "debit" in columns else None
        credit = _money(_cell(row, columns.get("credit"))) if "credit" in columns else None
        if "amount" in columns:
            amount = _money(_cell(row, columns["amount"])) or 0
            marker = str(_cell(row, columns.get("direction"))).strip().lower() if "direction" in columns else ""
            credit_markers = {str(item).lower() for item in spec.get("creditMarkers", ["credit", "cr", "in"])}
            if marker in credit_markers or amount > 0 and spec.get("positiveMeansCredit", True):
                credit, debit = abs(amount), None
            else:
                debit, credit = abs(amount), None
        if not description or not ((debit or 0) > 0 or (credit or 0) > 0):
            raise ValueError(f"Row {index + 2} is missing description or positive amount")
        result = {
            "date": parsed_date,
            "description": description,
            "amountIn": credit,
            "amountOut": debit,
            "balance": _money(_cell(row, columns.get("balance"))) if "balance" in columns else None,
            "currency": str(_cell(row, columns.get("currency")) or default_currency).strip().upper(),
            "accountIdentifier": str(_cell(row, columns.get("accountIdentifier"))).strip() or None if "accountIdentifier" in columns else None,
            "metadata": {"candidateConfigParser": True, "sourceRow": index + 2},
        }
        rows.append(result)
    return rows


def evaluate_candidate(content, spec):
    first = parse_config_csv(content, spec)
    second = parse_config_csv(content, spec)
    stable = first == second
    dates = [row["date"] for row in first]
    account_identifiers = sorted({
        str(row.get("accountIdentifier") or "").strip()
        for row in first
        if str(row.get("accountIdentifier") or "").strip()
    })
    missing_account_rows = sum(
        1 for row in first if not str(row.get("accountIdentifier") or "").strip()
    )
    validation = spec.get("validation") if isinstance(spec.get("validation"), dict) else {}
    expected_accounts = sorted({
        str(value).strip()
        for value in validation.get("expectedAccountIdentifiers", [])
        if str(value).strip()
    })
    errors = []
    if spec.get("mode") == "bank" and missing_account_rows:
        errors.append(f"{missing_account_rows} bank transaction(s) are missing accountIdentifier")
    if expected_accounts and account_identifiers != expected_accounts:
        errors.append(
            f"accountIdentifier mismatch: got {account_identifiers}, expected {expected_accounts}"
        )
    return {
        "passed": bool(first) and stable and not errors,
        "stableOutput": stable,
        "transactionCount": len(first),
        "dateFrom": min(dates) if dates else None,
        "dateTo": max(dates) if dates else None,
        "totalIn": round(sum(row["amountIn"] or 0 for row in first), 2),
        "totalOut": round(sum(row["amountOut"] or 0 for row in first), 2),
        "accountIdentifiers": account_identifiers,
        "missingAccountIdentifierRows": missing_account_rows,
        "errors": errors,
        "warnings": [] if first else ["Candidate produced no transactions"],
        "preview": first[:20],
    }
