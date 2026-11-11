"""MariBank credit card PDF statements.

Each transaction is three lines under TRANSACTION DETAILS, grouped under a
heading (Purchase, Repayment/Conversion, Cashback):

    GUARDIAN EASTPOINT MAL          description
    06 OCT 04 OCT -18.85            posted date, transaction date, signed amount
    Card Payment                    type

"+" amounts are credits to the card (repayments, refunds, cashback) and "-"
amounts are charges. An "OD" flag may follow the transaction date.

Cashback is booked from its "Cashback Credit" row, which the next statement
lists on the date it was credited. The "cashback earned this statement month"
figure in the reward details is not a transaction, so it is not a row (it
would count every cashback twice).

The statement summary's totals (repayments, refunds, purchases, cashback...)
are checked against the rows; a mismatch is flagged on every row.
"""

import io
import re
from datetime import date

import pdfplumber

MONTHS = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}

STATEMENT_DATE = re.compile(r"S/N\s+\S+\s+(\d{1,2})\s+([A-Z]{3})\s+(\d{4})")
ACCOUNT = re.compile(r"\b(\d{6}\*{4}\d{4})\b")
ROW = re.compile(
    r"^(\d{1,2}\s+[A-Z]{3})\s+(\d{1,2}\s+[A-Z]{3})(?:\s+OD)?\s+([+-])\s?([\d,]+\.\d{2})$"
)
# PREVIOUS OUTSTANDING (A), REPAYMENT/CONVERSION (B), WAIVER/REFUND (C), PURCHASE (D),
# LOANS (E), CASHBACK (F), BANK CHARGE (G), SPLIT BILL (H), OTHERS (I).
SUMMARY = re.compile(r"\(A\)\s+\(B\).*?\(I\)\s+((?:-?[\d,]+\.\d{2}\s+){8}-?[\d,]+\.\d{2})", re.S)
# Lines between rows that are neither a description nor a type.
NOT_DESCRIPTION = re.compile(
    r"^(TRANSACTION DETAILS|POSTED DATE\b|MARI CREDIT CARD STATEMENT|S/N\s|page \d+ of \d+"
    r"|\d{1,2}\s+[A-Z]{3}\s+\d{4}$)",
    re.I,
)

ENTRY_TYPES = {
    "card payment": "card_payment",
    "repayment": "repayment",
    "cashback": "cashback",
    "refund": "refund",
}


def _money(text):
    return float(text.replace(",", ""))


def _iso_date(value, statement_date):
    day_text, month_text = value.split()
    month_number = MONTHS[month_text]
    year = statement_date.year - 1 if month_number > statement_date.month else statement_date.year
    return date(year, month_number, int(day_text)).isoformat()


def parse(content):
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        text = "\n".join(page.extract_text() or "" for page in pdf.pages)

    statement_match = STATEMENT_DATE.search(text)
    if not statement_match:
        raise ValueError("Mari statement date not found")
    day_text, month_text, year_text = statement_match.groups()
    statement_date = date(int(year_text), MONTHS[month_text], int(day_text))

    account_match = ACCOUNT.search(text)
    if not account_match:
        raise ValueError("Mari masked card account identifier not found")
    account_identifier = account_match.group(1)

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    start = next((i for i, line in enumerate(lines) if line.upper() == "TRANSACTION DETAILS"), None)
    if start is None:
        raise ValueError("Mari transaction details not found")

    transactions = []
    for index in range(start + 1, len(lines)):
        match = ROW.match(lines[index])
        if not match:
            continue
        description = lines[index - 1]
        if NOT_DESCRIPTION.match(description) or ROW.match(description):
            raise ValueError(f"Mari row without a description: {lines[index]}")
        following = lines[index + 1] if index + 1 < len(lines) else ""
        # The type line is absent only if the next line already starts another row.
        next_is_row = index + 2 < len(lines) and ROW.match(lines[index + 2])
        transaction_type = "" if next_is_row or ROW.match(following) else following
        entry_type = ENTRY_TYPES.get(
            transaction_type.lower(),
            re.sub(r"[^a-z]+", "_", transaction_type.lower()).strip("_") or "unknown",
        )
        posted_text, transaction_text, sign, amount_text = match.groups()
        amount = _money(amount_text)
        if entry_type == "repayment":
            description = f"Repayment - {description}"
        transactions.append({
            "date": _iso_date(transaction_text, statement_date),
            "description": description,
            "amountIn": amount if sign == "+" else None,
            "amountOut": amount if sign == "-" else None,
            "currency": "SGD",
            "accountIdentifier": account_identifier,
            "metadata": {
                "postedDate": _iso_date(posted_text, statement_date),
                "entryType": entry_type,
                "statementDate": statement_date.isoformat(),
            },
        })

    if not transactions:
        raise ValueError("No Mari transactions found")

    warning = _summary_warning(text, transactions)
    if warning:
        for transaction in transactions:
            transaction["metadata"]["parseWarning"] = warning
    return transactions


def _summary_warning(text, transactions):
    summary = SUMMARY.search(text)
    if not summary:
        return "The statement summary wasn't found, so the rows couldn't be checked against its totals."
    _previous, repayment, refund, purchase, loans, cashback, charges, split, others = (
        _money(value) for value in summary.group(1).split()
    )
    expected_in = round(repayment + refund + cashback, 2)
    expected_out = round(purchase + loans + charges + split + others, 2)
    total_in = round(sum(t["amountIn"] or 0 for t in transactions), 2)
    total_out = round(sum(t["amountOut"] or 0 for t in transactions), 2)
    if total_in == expected_in and total_out == expected_out:
        return None
    return (
        f"The rows add up to {total_in:,.2f} in and {total_out:,.2f} out, but the statement "
        f"summary shows {expected_in:,.2f} in and {expected_out:,.2f} out. A row may be missing."
    )
