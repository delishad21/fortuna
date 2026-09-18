"""DBS PayLah! statement parser for the July 2026-and-later layout."""

import io
import re
from datetime import datetime

import pdfplumber
from dateutil import parser as date_parser


PARSER_ID = "dbs_paylah_statement_new"


def _format_transaction_date(
    date_str: str, statement_year: int, statement_month: int | None
) -> str:
    try:
        parsed_date = date_parser.parse(f"{date_str} {statement_year}")
        # January statements can contain rows from the previous December.
        if statement_month and parsed_date.month > statement_month:
            parsed_date = parsed_date.replace(year=parsed_date.year - 1)
        return parsed_date.strftime("%Y-%m-%d")
    except Exception:
        return date_str


def parse(content: bytes) -> list[dict]:
    """Parse the DBS PayLah! statement layout introduced after June 2026."""
    print("\n=== PayLah Statement Parser (July 2026 and later) ===")

    with pdfplumber.open(io.BytesIO(content)) as pdf:
        all_text = "\n".join(page.extract_text() or "" for page in pdf.pages)

    account_metadata = {}
    account_number = None
    header_match = re.search(
        r"(\d{1,2}\s+[A-Za-z]{3}\s+(\d{4}))\s+(\d{8,10})\s+(\d{16})",
        all_text,
    )
    if header_match:
        statement_date = header_match.group(1)
        account_number = header_match.group(4)
        account_metadata["statementDate"] = statement_date
        account_metadata["statementYear"] = int(header_match.group(2))
        try:
            account_metadata["statementMonth"] = date_parser.parse(statement_date).month
        except Exception:
            account_metadata["statementMonth"] = None
        print(f"Statement Date: {statement_date}")
        print(f"Wallet Account: {account_number}")

    statement_year = account_metadata.get("statementYear", datetime.now().year)
    statement_month = account_metadata.get("statementMonth")
    transactions = []
    transaction_pattern = re.compile(
        r"^(\d{1,2}\s+[A-Za-z]{3})\s+(.+?)\s+"
        r"((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})\s+(CR|DB)$"
    )

    for line in all_text.splitlines():
        line = line.strip()
        if line.startswith("Total Balance Carried Forward"):
            break

        match = transaction_pattern.match(line)
        if not match:
            continue

        date_str, description, amount_text, tx_type = match.groups()
        amount = float(amount_text.replace(",", ""))
        transaction = {
            "date": _format_transaction_date(
                date_str, statement_year, statement_month
            ),
            "description": description.strip(),
            "amountIn": amount if tx_type == "CR" else None,
            "amountOut": amount if tx_type == "DB" else None,
            "metadata": {
                "source": "pdf",
                "parserId": PARSER_ID,
                "bank": "DBS",
                "currency": "SGD",
                "transactionType": "credit" if tx_type == "CR" else "debit",
                **account_metadata,
            },
        }
        if account_number:
            transaction["accountNumber"] = account_number
            transaction["accountIdentifier"] = account_number
        transactions.append(transaction)

    print(f"\nTotal transactions found: {len(transactions)}")
    return transactions
