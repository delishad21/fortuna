"""DBS/POSB legacy consolidated statement parser.

Handles DBS/POSB consolidated statement PDFs using the Jan 2021-and-earlier
layout where transaction dates appear as "03 Jan" instead of DD/MM/YYYY.
"""
import io
import re
from typing import Optional

import pdfplumber


PARSER_ID = "dbs_posb_consolidated_legacy"
MONTHS = {
    "jan": "01",
    "feb": "02",
    "mar": "03",
    "apr": "04",
    "may": "05",
    "jun": "06",
    "jul": "07",
    "aug": "08",
    "sep": "09",
    "oct": "10",
    "nov": "11",
    "dec": "12",
}


def parse(content: bytes) -> list[dict]:
    """Parse a legacy DBS/POSB consolidated statement PDF."""
    print("\n=== DBS/POSB Legacy Consolidated Statement Parser ===")

    with pdfplumber.open(io.BytesIO(content)) as pdf:
        all_text = "\n".join(page.extract_text() or "" for page in pdf.pages)
        account_metadata = _extract_metadata(all_text)
        account_number = account_metadata.get("accountNumber")

        header_positions = _find_column_positions(pdf)
        if header_positions:
            transactions = _parse_with_columns(
                pdf,
                account_metadata,
                header_positions,
                account_number,
            )
        else:
            transactions = _parse_text_fallback(all_text, account_metadata, account_number)

        print(f"\nTotal legacy DBS/POSB transactions found: {len(transactions)}")
        return transactions


def _extract_metadata(text: str) -> dict:
    metadata = {}

    account_match = re.search(
        r"Account\s+No\.\s*([0-9][0-9\-\s]{5,})",
        text,
        re.I,
    )
    if account_match:
        account_number = re.sub(r"[^\d]", "", account_match.group(1))
        metadata["accountNumber"] = account_number
        metadata["accountIdentifier"] = account_number
        print(f"Account Number: {account_number}")

    statement_match = re.search(r"As at\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})", text, re.I)
    if statement_match:
        metadata["statementDate"] = statement_match.group(1)
        metadata["statementYear"] = statement_match.group(1).split()[-1]
        print(f"Statement Date: {statement_match.group(1)}")

    return metadata


def _find_column_positions(pdf) -> Optional[dict]:
    for page in pdf.pages:
        lines = _group_words_by_line(page.extract_words() or [])
        for line_words in lines:
            text = " ".join(word["text"] for word in line_words).lower()
            if "withdrawal" not in text or "deposit" not in text or "balance" not in text:
                continue

            positions = {}
            for word in line_words:
                word_text = word["text"].lower()
                if word_text == "date":
                    positions["date_x"] = word["x0"]
                elif word_text == "description":
                    positions["description_x"] = word["x0"]
                elif word_text == "withdrawal":
                    positions["withdrawal_x"] = word["x0"]
                elif word_text == "deposit":
                    positions["deposit_x"] = word["x0"]
                elif word_text == "balance":
                    positions["balance_x"] = word["x0"]

            if all(key in positions for key in ("withdrawal_x", "deposit_x", "balance_x")):
                print(
                    "Column positions - Withdrawal: "
                    f"{positions['withdrawal_x']}, Deposit: {positions['deposit_x']}, "
                    f"Balance: {positions['balance_x']}"
                )
                return positions

    return None


def _parse_with_columns(
    pdf,
    account_metadata: dict,
    header_positions: dict,
    account_number: Optional[str],
) -> list[dict]:
    transactions = []
    pending_tx = None
    in_section = False
    statement_year = account_metadata.get("statementYear")

    for page in pdf.pages:
        lines = _group_words_by_line(page.extract_words() or [])
        for line_words in lines:
            line_text = " ".join(word["text"] for word in line_words).strip()
            if not line_text:
                continue

            if "Balance Brought Forward" in line_text:
                in_section = True
                pending_tx = None
                continue

            if _is_section_end(line_text):
                if _has_amount(pending_tx):
                    transactions.append(_build_transaction(pending_tx, account_metadata, account_number))
                pending_tx = None
                in_section = False
                continue

            if not in_section or _is_noise_line(line_text):
                continue

            date_match = re.match(r"^(\d{1,2}\s+[A-Za-z]{3})\b", line_text)
            if date_match:
                if _has_amount(pending_tx):
                    transactions.append(_build_transaction(pending_tx, account_metadata, account_number))

                pending_tx = {
                    "date": _format_date(date_match.group(1), statement_year),
                    "description": _extract_description(line_words, header_positions, date_match.group(1)),
                    "amountOut": None,
                    "amountIn": None,
                    "balance": None,
                }
                _apply_amounts_from_words(pending_tx, line_words, header_positions)
                continue

            if pending_tx:
                _append_description(pending_tx, line_words, header_positions)
                _apply_amounts_from_words(pending_tx, line_words, header_positions)

        if in_section and _has_amount(pending_tx):
            transactions.append(_build_transaction(pending_tx, account_metadata, account_number))
            pending_tx = None

    return transactions


def _parse_text_fallback(
    text: str,
    account_metadata: dict,
    account_number: Optional[str],
) -> list[dict]:
    transactions = []
    pending_tx = None
    in_section = False
    statement_year = account_metadata.get("statementYear")
    running_balance = None

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        if "Balance Brought Forward" in line:
            in_section = True
            pending_tx = None
            amounts = _parse_amount_tokens(line)
            if amounts:
                running_balance = amounts[-1]
            continue

        if _is_section_end(line):
            if _has_amount(pending_tx):
                transactions.append(_build_transaction(pending_tx, account_metadata, account_number))
                running_balance = pending_tx.get("balance") or running_balance
            pending_tx = None
            in_section = False
            continue

        if not in_section or _is_noise_line(line):
            continue

        date_match = re.match(r"^(\d{1,2}\s+[A-Za-z]{3})\s*(.*)$", line)
        if date_match:
            if _has_amount(pending_tx):
                transactions.append(_build_transaction(pending_tx, account_metadata, account_number))
                running_balance = pending_tx.get("balance") or running_balance

            pending_tx = {
                "date": _format_date(date_match.group(1), statement_year),
                "description": _strip_trailing_amounts(date_match.group(2).strip()),
                "amountOut": None,
                "amountIn": None,
                "balance": None,
            }
            amounts = _parse_amount_tokens(date_match.group(2))
            if amounts and _line_ends_with_amounts(date_match.group(2)):
                _apply_text_amounts(pending_tx, amounts, running_balance)
            continue

        if not pending_tx:
            continue

        amounts = _parse_amount_tokens(line)
        if amounts and len(amounts) <= 2 and re.fullmatch(r"[\d,.\s]+", line):
            _apply_text_amounts(pending_tx, amounts, running_balance)
            continue

        pending_tx["description"] = f"{pending_tx['description']} {line}".strip()

    if _has_amount(pending_tx):
        transactions.append(_build_transaction(pending_tx, account_metadata, account_number))

    return transactions


def _group_words_by_line(words: list[dict]) -> list[list[dict]]:
    lines = {}
    for word in words:
        if not word.get("upright", True):
            continue
        top_key = round(word["top"], 1)
        lines.setdefault(top_key, []).append(word)
    return [sorted(lines[top], key=lambda word: word["x0"]) for top in sorted(lines.keys())]


def _extract_description(line_words: list[dict], positions: dict, date_text: str) -> str:
    withdrawal_x = positions["withdrawal_x"]
    parts = []
    date_parts_to_skip = date_text.split()
    skipped = 0

    for word in line_words:
        text = word["text"]
        if skipped < len(date_parts_to_skip) and text == date_parts_to_skip[skipped]:
            skipped += 1
            continue
        if word["x0"] < withdrawal_x - 5 and not _is_amount_token(text):
            parts.append(text)

    return " ".join(parts).strip()


def _append_description(pending_tx: dict, line_words: list[dict], positions: dict) -> None:
    if any(_is_amount_token(word["text"]) for word in line_words):
        return

    withdrawal_x = positions["withdrawal_x"]
    parts = [word["text"] for word in line_words if word["x0"] < withdrawal_x - 5]
    if parts:
        pending_tx["description"] = f"{pending_tx['description']} {' '.join(parts)}".strip()


def _apply_amounts_from_words(pending_tx: dict, line_words: list[dict], positions: dict) -> None:
    withdrawal_x = positions["withdrawal_x"]
    deposit_x = positions["deposit_x"]
    balance_x = positions["balance_x"]

    for word in line_words:
        text = word["text"]
        if not _is_amount_token(text):
            continue

        amount = _to_amount(text)
        x0 = word["x0"]
        if withdrawal_x - 5 <= x0 < deposit_x - 5:
            pending_tx["amountOut"] = amount
        elif deposit_x - 5 <= x0 < balance_x - 5:
            pending_tx["amountIn"] = amount
        elif x0 >= balance_x - 5:
            pending_tx["balance"] = amount


def _apply_text_amounts(
    pending_tx: dict,
    amounts: list[float],
    running_balance: Optional[float],
) -> None:
    amount = amounts[0]
    balance = amounts[1] if len(amounts) > 1 else None
    pending_tx["balance"] = balance

    if _looks_like_deposit(pending_tx["description"]):
        pending_tx["amountIn"] = amount
        return
    if balance is not None and running_balance is not None and balance > running_balance:
        pending_tx["amountIn"] = amount
        return
    pending_tx["amountOut"] = amount


def _build_transaction(
    pending: dict,
    account_metadata: dict,
    account_number: Optional[str],
) -> dict:
    transaction = {
        "date": pending["date"],
        "description": pending["description"],
        "amountOut": pending.get("amountOut"),
        "amountIn": pending.get("amountIn"),
        "balance": pending.get("balance"),
        "metadata": {
            "source": "pdf",
            "parserId": PARSER_ID,
            "bank": "DBS/POSB",
            "currency": "SGD",
            **account_metadata,
        },
    }
    if account_number:
        transaction["accountNumber"] = account_number
        transaction["accountIdentifier"] = account_number
    return transaction


def _format_date(date_text: str, statement_year: Optional[str]) -> str:
    day_text, month_text = date_text.split()[:2]
    month = MONTHS[month_text[:3].lower()]
    return f"{statement_year or '2021'}-{month}-{int(day_text):02d}"


def _is_amount_token(value: str) -> bool:
    return bool(re.fullmatch(r"[\d,]+\.\d{2}", value))


def _to_amount(value: str) -> float:
    return float(value.replace(",", ""))


def _parse_amount_tokens(line: str) -> list[float]:
    return [_to_amount(match) for match in re.findall(r"[\d,]+\.\d{2}", line)]


def _line_ends_with_amounts(line: str) -> bool:
    return re.search(r"(?:^|\s)[\d,]+\.\d{2}(?:\s+[\d,]+\.\d{2})?\s*$", line) is not None


def _strip_trailing_amounts(line: str) -> str:
    return re.sub(r"\s+[\d,]+\.\d{2}(?:\s+[\d,]+\.\d{2})?\s*$", "", line).strip()


def _has_amount(tx: Optional[dict]) -> bool:
    if not tx:
        return False
    return tx.get("amountOut") is not None or tx.get("amountIn") is not None


def _is_noise_line(line: str) -> bool:
    return (
        line.startswith("Date ")
        or line == "DEPOSITS"
        or line.startswith("ePOSB")
        or line.startswith("ACCOUNT DETAILS")
        or line.startswith("S/N:")
        or line.startswith("Page ")
        or line.startswith("PDS1.")
    )


def _is_section_end(line: str) -> bool:
    return (
        "Balance Carried Forward" in line
        or re.match(r"^Total\s+[\d,]+\.\d{2}", line) is not None
        or line.startswith("MESSAGE FOR YOU")
        or line.startswith("FOR YOUR INFORMATION")
    )


def _looks_like_deposit(description: str) -> bool:
    normalized = description.lower()
    return any(
        keyword in normalized
        for keyword in (
            "incoming",
            "interest earned",
            "salary",
            "cashback",
            "refund",
            "deposit",
        )
    )
