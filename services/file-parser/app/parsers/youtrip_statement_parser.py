"""YouTrip statement parser for trip workflows."""
import io
import re
from typing import Optional

import pdfplumber
from dateutil import parser as date_parser

from .revolut_statement_parser import classify_incoming_transfer, extract_account_holder


def _parse_money(value: str) -> Optional[float]:
    raw_value = (value or "").strip()
    is_negative = bool(re.match(r"^-", raw_value)) or bool(re.match(r"^\(.*\)$", raw_value))
    cleaned = re.sub(r"[^0-9.]", "", raw_value)
    if not cleaned:
        return None
    try:
        amount = float(cleaned)
        return -amount if is_negative else amount
    except ValueError:
        return None


def _try_parse_date(value: str) -> str:
    try:
        return date_parser.parse(value).strftime("%Y-%m-%d")
    except Exception:
        return value


def _infer_direction(description: str, amount: Optional[float] = None, raw_text: str = "") -> str:
    if amount is not None and amount < 0:
        return "out"

    raw_lower = raw_text.lower()
    if amount is not None and amount > 0 and re.search(r"(^|\s)\+|\b(?:credit|cr)\b", raw_lower):
        return "in"

    desc = description.lower()
    incoming_markers = ["smartexchange", "refund", "top up", "transfer in"]
    if any(marker in desc for marker in incoming_markers):
        return "in"
    return "out"


def _transaction_type(description: str) -> str:
    desc = description.lower()
    if "smartexchange" in desc:
        return "conversion"
    if "top up" in desc or "transfer in" in desc:
        # "Transfer in from <name>" is refined against the account holder in parse().
        return "topup"
    if "transfer out" in desc:
        return "transfer"
    if "metro" in desc or "transport" in desc:
        return "transport"
    return "card_payment"


def _apply_embedded_fee_amount(
    transaction: dict, neighbour_balances: Optional[list[Optional[float]]] = None
) -> dict:
    """Fold the fee into the row so exactly one of amountIn/amountOut is positive.

    * Outgoing: the fee is extra outflow -> amountOut = amount + fee.
    * Incoming: the fee is netted, not emitted as amountOut. amountIn is what
      the wallet actually received and the fee stays in metadata.feeAmount;
      the importer's topup path then books destination = amountIn and
      source = amountIn + fee, and a reimbursement books amountIn. The
      displayed amount is normally the net credit; if the running balance
      shows it was the gross amount instead, the fee is subtracted.
    """
    metadata_raw = transaction.get("metadata")
    metadata = metadata_raw if isinstance(metadata_raw, dict) else {}
    if metadata.get("feeEmbeddedApplied"):
        return transaction

    fee_amount = _parse_money(str(metadata.get("feeAmount") or ""))
    amount_in = _parse_money(str(transaction.get("amountIn") or ""))
    amount_out = _parse_money(str(transaction.get("amountOut") or ""))
    if not (fee_amount and fee_amount > 0):
        return transaction

    if amount_out and amount_out > 0:
        transaction["amountOut"] = round(amount_out + fee_amount, 4)
    elif amount_in and amount_in > 0:
        balance = transaction.get("balance")
        displayed_is_gross = False
        if balance is not None:
            for neighbour in neighbour_balances or []:
                if neighbour is None:
                    continue
                delta = balance - neighbour
                if abs(delta - amount_in) <= 0.005:
                    break
                if abs(delta - (amount_in - fee_amount)) <= 0.005:
                    displayed_is_gross = True
                    break
        if displayed_is_gross:
            transaction["amountIn"] = round(amount_in - fee_amount, 4)
        transaction["amountOut"] = None
        metadata["feeHandling"] = "netted"
    metadata["feeEmbeddedApplied"] = True
    transaction["metadata"] = metadata
    return transaction


def parse(content: bytes) -> list[dict]:
    """Parse YouTrip statement into normalized transaction rows."""
    transactions = []
    lines: list[str] = []

    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            lines.extend([line.strip() for line in text.split("\n") if line.strip()])

    all_text = "\n".join(lines)
    account_identifier = None
    statement_currency = "SGD"

    account_match = re.search(r"\b(Y-\d+)\b", all_text)
    if account_match:
        account_identifier = account_match.group(1)

    currency_match = re.search(r"My\s+([A-Z]{3})\s+Statement", all_text)
    if currency_match:
        statement_currency = currency_match.group(1)

    holder = extract_account_holder(lines, window=15)

    money_pattern = r"((?:[-+]?\s*\$[\d,]*\.\d{2})|(?:\(\$[\d,]*\.\d{2}\)))"
    tx_pattern_with_desc = re.compile(
        rf"^(\d{{1,2}}\s+[A-Za-z]{{3,9}}\s+\d{{4}})\s+(.+?)\s+{money_pattern}\s+{money_pattern}$"
    )
    tx_pattern_without_desc = re.compile(
        rf"^(\d{{1,2}}\s+[A-Za-z]{{3,9}}\s+\d{{4}})\s+{money_pattern}\s+{money_pattern}$"
    )
    date_line_pattern = re.compile(r"^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\b")

    skip_prefixes = (
        "Transactions",
        "Completed Date",
        "(in SGT)",
        "Remarks:",
        "page ",
        "My ",
        "Issued on ",
    )

    current_tx = None
    previous_line = ""

    def finalize_current():
        if current_tx:
            transactions.append(current_tx.copy())

    for line in lines:
        if not line or line.startswith(skip_prefixes):
            previous_line = line
            continue
        if " to " in line and re.match(r"^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\s+to\s+\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}$", line):
            previous_line = line
            continue

        match = tx_pattern_with_desc.match(line)
        if match:
            finalize_current()
            date_text = match.group(1)
            description = match.group(2).strip()
            amount = _parse_money(match.group(3)) or 0
            balance = _parse_money(match.group(4))
            direction = _infer_direction(description, amount, line)
            amount_magnitude = abs(amount)

            metadata = {
                "source": "pdf",
                "parserId": "youtrip_statement",
                "provider": "YouTrip",
                "currency": statement_currency,
                "transactionType": _transaction_type(description),
            }
            if account_identifier:
                metadata["accountIdentifier"] = account_identifier

            current_tx = {
                "date": _try_parse_date(date_text),
                "description": description,
                "amountIn": amount_magnitude if direction == "in" else None,
                "amountOut": amount_magnitude if direction == "out" else None,
                "balance": balance,
                "metadata": metadata,
            }
            if account_identifier:
                current_tx["accountIdentifier"] = account_identifier
                current_tx["accountNumber"] = account_identifier

            previous_line = line
            continue

        match = tx_pattern_without_desc.match(line)
        if match:
            finalize_current()
            date_text = match.group(1)
            amount = _parse_money(match.group(2)) or 0
            balance = _parse_money(match.group(3))
            description = previous_line if previous_line else "YouTrip Transaction"
            direction = _infer_direction(description, amount, line)
            amount_magnitude = abs(amount)

            metadata = {
                "source": "pdf",
                "parserId": "youtrip_statement",
                "provider": "YouTrip",
                "currency": statement_currency,
                "transactionType": _transaction_type(description),
            }
            if account_identifier:
                metadata["accountIdentifier"] = account_identifier

            current_tx = {
                "date": _try_parse_date(date_text),
                "description": description,
                "amountIn": amount_magnitude if direction == "in" else None,
                "amountOut": amount_magnitude if direction == "out" else None,
                "balance": balance,
                "metadata": metadata,
            }
            if account_identifier:
                current_tx["accountIdentifier"] = account_identifier
                current_tx["accountNumber"] = account_identifier

            previous_line = line
            continue

        if not current_tx:
            previous_line = line
            continue

        fee_match = re.search(
            r"\bfee\b[^0-9A-Z]*(?:¥|\$)?\s*([\d,]*\.\d{2})(?:\s*([A-Z]{3}))?",
            line,
            re.I,
        )
        if fee_match:
            current_tx["metadata"]["feeAmount"] = _parse_money(fee_match.group(1))
            current_tx["metadata"]["feeCurrency"] = (
                fee_match.group(2).upper() if fee_match.group(2) else statement_currency
            )
            previous_line = line
            continue

        if date_line_pattern.match(line):
            finalize_current()
            current_tx = None
            previous_line = line
            continue

        conversion_match = re.search(
            r"\$([\d,]*\.\d{2})\s+([A-Z]{3})\s+to\s+\$([\d,]*\.\d{2})\s+([A-Z]{3})",
            line,
            re.I,
        )
        if conversion_match:
            current_tx["metadata"]["fromAmount"] = _parse_money(conversion_match.group(1))
            current_tx["metadata"]["fromCurrency"] = conversion_match.group(2).upper()
            current_tx["metadata"]["toAmount"] = _parse_money(conversion_match.group(3))
            current_tx["metadata"]["toCurrency"] = conversion_match.group(4).upper()
            previous_line = line
            continue

        parenthetical_match = re.search(
            r"\((?:¥|\$)?([\d,]*\.\d{2})\s*([A-Z]{3})\)",
            line,
            re.I,
        )
        if parenthetical_match:
            current_tx["metadata"]["foreignAmount"] = _parse_money(parenthetical_match.group(1))
            current_tx["metadata"]["foreignCurrency"] = parenthetical_match.group(2).upper()
            previous_line = line
            continue

        fx_match_a = re.search(
            r"FX rate:\s*\$1\s+([A-Z]{3})\s*=\s*\$([\d,]*\.\d+)\s*([A-Z]{3})",
            line,
            re.I,
        )
        fx_match_b = re.search(
            r"FX rate:\s*\$1\s+([A-Z]{3})\s*=\s*(?:¥|\$)?([\d,]*\.\d+)\s*([A-Z]{3})",
            line,
            re.I,
        )
        fx_match = fx_match_a or fx_match_b
        if fx_match:
            current_tx["metadata"]["fxBaseCurrency"] = fx_match.group(1).upper()
            current_tx["metadata"]["fxRate"] = _parse_money(fx_match.group(2))
            current_tx["metadata"]["fxQuoteCurrency"] = fx_match.group(3).upper()
            previous_line = line
            continue

        previous_line = line

    finalize_current()
    for index, transaction in enumerate(transactions):
        neighbours = [
            transactions[i].get("balance")
            for i in (index - 1, index + 1)
            if 0 <= i < len(transactions)
        ]
        _apply_embedded_fee_amount(transaction, neighbours)
        classify_incoming_transfer(
            transaction, holder, transaction["metadata"].get("transactionType")
        )
    return transactions
