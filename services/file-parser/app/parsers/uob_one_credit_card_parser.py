"""UOB One credit card PDF statements.

Each transaction is one line under the card's heading, with the posting date,
the transaction date, the description and the amount in SGD:

    PREVIOUS BALANCE 1,234.56
    08 OCT 07 OCT SHOPEE SINGAPORE MP SINGAPORE 23.40
    Ref No. : 74541836281004567890123
    09 OCT 08 OCT PAYMENT AT AXS (12345678) 1,234.56CR
    06 NOV 05 NOV ONE CARD ENHANCED REBATE 30.00CR
    SUB TOTAL 3,333.33
    TOTAL BALANCE FOR UOB ONE CARD 3,333.33

A "CR" after the amount (with or without a space) is a credit to the card (payments, rebates, refunds,
redemptions): money in. Everything else is a charge: money out. A foreign
currency purchase can repeat its original amount ("USD 10.80"), which is not
a transaction. A card's rows run over several pages, each restarting with the
card heading "(continued)".

The rows are checked against the statement's own balances: the previous
balance plus charges less credits must equal the total balance. A mismatch, or
balances that can't be found, is flagged on every row as a parse warning.
"""

import io
import re
from datetime import date

import pdfplumber

MONTHS = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}
AMOUNT = r"([\d,]+\.\d{2})(\s*CR)?"
STATEMENT_DATE = re.compile(r"Statement\s+Date\s+(\d{1,2})\s+([A-Z]{3})\s+(\d{4})", re.I)
CARD_NUMBER = re.compile(r"\b(\d{4})[- ](?:\d{4}|\d{2}\*\*|\*{4})[- ](?:\d{4}|\*{4})[- ](\d{4})\b")
ROW = re.compile(
    r"^(\d{1,2}\s+[A-Z]{3})\s+(\d{1,2}\s+[A-Z]{3})\s+(.+?)\s+" + AMOUNT + r"$", re.I
)
PREVIOUS_BALANCE = re.compile(r"^PREVIOUS\s+BALANCE\s+" + AMOUNT + r"$", re.I)
TOTAL_BALANCE = re.compile(r"^TOTAL\s+BALANCE\s+FOR\s+.+?\s+" + AMOUNT + r"$", re.I)
# Lines that look like rows but only repeat a figure: the original foreign amount.
FOREIGN_AMOUNT = re.compile(r"^[A-Z]{3}\s+[\d,]+\.\d{2}$")
NOT_TRANSACTIONS = re.compile(r"^(PREVIOUS BALANCE|SUB TOTAL|TOTAL BALANCE|REF NO)", re.I)


def _money(text, credit=None):
    value = float(text.replace(",", ""))
    return -value if credit else value


def _iso_date(value, statement_date):
    day_text, month_text = value.split()
    month_number = MONTHS[month_text.upper()]
    # A January statement lists December transactions of the year before.
    year = statement_date.year - 1 if month_number > statement_date.month else statement_date.year
    return date(year, month_number, int(day_text)).isoformat()


def _entry_type(description, credit):
    if not credit:
        return "charge"
    upper = description.upper()
    if "PAYMENT" in upper:
        return "payment"
    if "REBATE" in upper or "CASHBACK" in upper:
        return "rebate"
    if "REDEMPTION" in upper or "REDEEM" in upper:
        return "redemption"
    if "REFUND" in upper or "REVERSAL" in upper:
        return "refund"
    return "credit"


def parse(content):
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        text = "\n".join(page.extract_text() or "" for page in pdf.pages)

    statement_match = STATEMENT_DATE.search(text)
    if not statement_match:
        raise ValueError("UOB statement date not found")
    day_text, month_text, year_text = statement_match.groups()
    statement_date = date(int(year_text), MONTHS[month_text.upper()], int(day_text))

    card_match = CARD_NUMBER.search(text)
    if not card_match:
        raise ValueError("UOB card number not found")
    account_identifier = f"{card_match.group(1)}-****-****-{card_match.group(2)}"

    transactions = []
    previous_balances = []
    total_balances = []
    for raw_line in text.splitlines():
        line = " ".join(raw_line.split())
        previous = PREVIOUS_BALANCE.match(line)
        if previous:
            previous_balances.append(_money(*previous.groups()))
            continue
        total = TOTAL_BALANCE.match(line)
        if total:
            total_balances.append(_money(*total.groups()))
            continue
        match = ROW.match(line)
        if not match:
            continue
        posted_text, transaction_text, description, amount_text, credit = match.groups()
        description = description.strip()
        if NOT_TRANSACTIONS.match(description) or FOREIGN_AMOUNT.match(description):
            continue
        amount = _money(amount_text)
        transactions.append({
            "date": _iso_date(transaction_text, statement_date),
            "description": description,
            "amountIn": amount if credit else None,
            "amountOut": None if credit else amount,
            "currency": "SGD",
            "accountIdentifier": account_identifier,
            "metadata": {
                "bank": "UOB",
                "cardName": "UOB ONE CARD",
                "entryType": _entry_type(description, credit),
                "postDate": _iso_date(posted_text, statement_date),
                "statementDate": statement_date.isoformat(),
            },
        })

    if not transactions:
        raise ValueError("No UOB credit card transactions found")

    warning = _balance_warning(previous_balances, total_balances, transactions)
    if warning:
        for transaction in transactions:
            transaction["metadata"]["parseWarning"] = warning
    return transactions


def _balance_warning(previous_balances, total_balances, transactions):
    if len(total_balances) != 1:
        return "The statement's total balance wasn't found once, so the rows couldn't be checked against it."
    previous = previous_balances[0] if len(previous_balances) == 1 else 0.0
    total_in = round(sum(t["amountIn"] or 0 for t in transactions), 2)
    total_out = round(sum(t["amountOut"] or 0 for t in transactions), 2)
    expected = round(total_balances[0] - previous, 2)
    if abs(round(total_out - total_in, 2) - expected) < 0.005:
        return None
    return (
        f"The rows add up to {total_out:,.2f} in charges and {total_in:,.2f} in credits, but the "
        f"statement's balances (previous {previous:,.2f}, total {total_balances[0]:,.2f}) need "
        f"{expected:,.2f} net. A row may be missing."
    )
