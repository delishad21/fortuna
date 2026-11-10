"""DBS/POSB Consolidated Statement Parser"""
import re
import pdfplumber
import io
from typing import Optional


def _normalize_account_number(value: str) -> str:
    return re.sub(r"[^\d]", "", value)


def _extract_account_number(text: str) -> Optional[str]:
    patterns = [
        r"Account\s*(?:No|Number|#|ID)\.?\s*[:\-]?\s*([0-9][0-9\-\s]{5,})",
        r"A\/C\s*No\.?\s*[:\-]?\s*([0-9][0-9\-\s]{5,})",
        r"Acc(?:ount)?\s*No\.?\s*[:\-]?\s*([0-9][0-9\-\s]{5,})",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            normalized = _normalize_account_number(match.group(1))
            if normalized:
                return normalized
    return None


def parse(content: bytes) -> list[dict]:
    """Parse DBS/POSB consolidated statement using pdfplumber."""
    print("\n=== POSB Statement Parser ===")

    with pdfplumber.open(io.BytesIO(content)) as pdf:
        all_text = ""
        for page in pdf.pages:
            all_text += page.extract_text() or ""
            all_text += "\n"

        transactions = []
        lines = all_text.split("\n")

        # Extract metadata
        account_metadata = {}
        account_number = None

        account_number = _extract_account_number(all_text)
        if account_number:
            account_metadata["accountNumber"] = account_number
            account_metadata["accountIdentifier"] = account_number
            print(f"Account Number: {account_number}")

        match = re.search(r"as at (\d{1,2}\s+\w+\s+\d{4})", all_text, re.I)
        if match:
            account_metadata["statementDate"] = match.group(1)
            print(f"Statement Date: {match.group(1)}")

        in_section = False
        pending_transaction = None
        previous_balance = None

        # Prefer column-based parsing when headers exist (more reliable for deposit/withdrawal)
        header_positions = _find_column_positions(pdf)
        if header_positions:
            print(f"Column positions: {header_positions}")
            return _parse_with_columns(pdf, account_metadata, header_positions, account_number)

        for i, line in enumerate(lines):
            line = line.strip()

            # Start of transaction section
            if "Balance Brought Forward" in line or "Balance B/F" in line:
                in_section = True
                pending_transaction = None
                bf_match = re.search(r"Balance Brought Forward(?:\s+SGD)?\s+([\d,]+\.\d{2})", line, re.I)
                if bf_match:
                    previous_balance = float(bf_match.group(1).replace(",", ""))
                print(f"Found transactions section at line {i}")
                continue

            # Section breaks/page boundaries
            if in_section and (
                "Balance Carried Forward" in line
                or "Total Balance Carried Forward" in line
                or "Balance C/F" in line
                or "Total Balance" in line
                or line.startswith("Messages For")
                or line.startswith("Transaction Details as of")
                or "Page " in line
            ):
                # Process pending transaction if exists
                if pending_transaction and pending_transaction.get("amounts"):
                    tx, previous_balance = _finalize_transaction(
                        pending_transaction,
                        account_metadata,
                        previous_balance,
                        account_number,
                    )
                    transactions.append(tx)
                elif pending_transaction:
                    print(
                        f"Pending at page break (incomplete): "
                        f"{pending_transaction.get('description', 'N/A')}"
                    )
                in_section = False
                pending_transaction = None
                continue

            if not in_section:
                continue

            # Skip header lines
            if not line or "DateDescription" in line or line.startswith("Withdrawal") or line.startswith("Deposit"):
                continue

            # Pattern 1: Full transaction on one line
            full_tx_match = re.match(
                r"^(\d{2}/\d{2}/\d{4})\s+(.+?)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})$",
                line
            )
            if full_tx_match:
                # Save pending if exists
                if pending_transaction and pending_transaction.get("amounts"):
                    tx, previous_balance = _finalize_transaction(
                        pending_transaction, account_metadata, previous_balance, account_number
                    )
                    transactions.append(tx)
                    pending_transaction = None

                date_str = full_tx_match.group(1)
                description = full_tx_match.group(2).strip()
                amt = float(full_tx_match.group(3).replace(",", ""))
                balance = float(full_tx_match.group(4).replace(",", ""))

                date_parts = date_str.split("/")
                date_formatted = f"{date_parts[2]}-{date_parts[1]}-{date_parts[0]}"

                is_deposit = previous_balance is not None and balance > previous_balance

                transaction = {
                    "date": date_formatted,
                    "description": description,
                    "amountOut": None if is_deposit else amt,
                    "amountIn": amt if is_deposit else None,
                    "balance": balance,
                    "metadata": {
                        "source": "pdf",
                        "parserId": "dbs_posb_consolidated",
                        "bank": "DBS/POSB",
                        "currency": "SGD",
                        **account_metadata,
                    },
                }
                if account_number:
                    transaction["accountNumber"] = account_number
                    transaction["accountIdentifier"] = account_number
                print(
                    f"Found: {date_str} | {description} | "
                    f"{'In' if is_deposit else 'Out'}: {amt} | Bal: {balance}"
                )
                transactions.append(transaction)
                previous_balance = balance
                continue

            # Pattern 2: Date followed by description (start of multi-line)
            date_desc_match = re.match(r"^(\d{2}/\d{2}/\d{4})\s*(.*)$", line)
            if date_desc_match:
                remainder = (date_desc_match.group(2) or "").strip()
                if not remainder or re.match(r"^[\d,]+\.\d{2}$", remainder):
                    continue
                # Save pending transaction if exists
                if pending_transaction and pending_transaction.get("amounts"):
                    tx, previous_balance = _finalize_transaction(
                        pending_transaction, account_metadata, previous_balance, account_number
                    )
                    transactions.append(tx)

                pending_transaction = {
                    "date": date_desc_match.group(1),
                    "description": remainder,
                    "amounts": None,
                }
                print(f"Started: {pending_transaction['date']} - {pending_transaction['description']}")
                continue

            # Pattern 3: Just amounts (completion of multi-line)
            amount_match = re.match(r"^([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$", line)
            single_amount_match = re.match(r"^([\d,]+\.\d{2})\s*$", line)

            if (amount_match or single_amount_match) and pending_transaction:
                if amount_match:
                    pending_transaction["amounts"] = (
                        float(amount_match.group(1).replace(",", "")),
                        float(amount_match.group(2).replace(",", ""))
                    )
                else:
                    pending_transaction["amounts"] = (
                        None,
                        float(single_amount_match.group(1).replace(",", ""))
                    )
                print(f"  Amounts: {pending_transaction['amounts']}")

                # Finalize transaction
                tx, previous_balance = _finalize_transaction(
                    pending_transaction, account_metadata, previous_balance, account_number
                )
                transactions.append(tx)
                pending_transaction = None
                continue

            # Pattern 4: Description continuation
            if pending_transaction and line and not re.match(r"^\d", line):
                if pending_transaction["description"]:
                    pending_transaction["description"] += " " + line
                else:
                    pending_transaction["description"] = line
                print(f"  Appended: {line}")

        # Handle any remaining pending transaction
        if pending_transaction and pending_transaction.get("amounts"):
            tx, previous_balance = _finalize_transaction(
                pending_transaction, account_metadata, previous_balance, account_number
            )
            transactions.append(tx)

        print(f"\nTotal transactions found: {len(transactions)}")
        return transactions


def _finalize_transaction(
    pending: dict,
    account_metadata: dict,
    previous_balance: Optional[float],
    account_number: Optional[str] = None,
) -> tuple[dict, Optional[float]]:
    """Convert pending POSB transaction to final format."""
    date_str = pending["date"]
    date_parts = date_str.split("/")
    date_formatted = f"{date_parts[2]}-{date_parts[1]}-{date_parts[0]}"

    amounts = pending.get("amounts", (None, None))
    amount = amounts[0] if amounts else None
    balance = amounts[1] if amounts else None

    is_deposit = False
    if previous_balance is not None and balance is not None:
        is_deposit = balance > previous_balance

    transaction = {
        "date": date_formatted,
        "description": pending["description"],
        "amountOut": None if is_deposit else amount,
        "amountIn": amount if is_deposit else None,
        "balance": balance,
        "metadata": {
            "source": "pdf",
            "parserId": "dbs_posb_consolidated",
            "bank": "DBS/POSB",
            "currency": "SGD",
            **account_metadata,
        },
    }
    if account_number:
        transaction["accountNumber"] = account_number
        transaction["accountIdentifier"] = account_number
        transaction["metadata"]["accountNumber"] = account_number
        transaction["metadata"]["accountIdentifier"] = account_number
    return transaction, balance if balance is not None else previous_balance


# DBS prints an overdrawn balance with a trailing minus: "0.80-".
_AMOUNT_RE = re.compile(r"^[\d,]+\.\d{2}-?$")
_COLUMNS = ("withdrawal", "deposit", "balance")
_LINE_TOLERANCE = 3.0


def _to_amount(text: str) -> float:
    value = float(text.rstrip("-").replace(",", ""))
    return -value if text.endswith("-") else value


def _cents(value: float) -> int:
    return int(round(value * 100))


def _header_columns(line_words: list[dict]) -> Optional[dict]:
    """Column edges from a 'Withdrawal (-) Deposit (+) Balance' header line.

    Each column spans its label plus any marker after it ('(-)', '(+)'), so
    `right` is where the column's right-aligned amounts end.
    """
    starts = {}
    for index, word in enumerate(line_words):
        text = word["text"].lower()
        if text in _COLUMNS and text not in starts:
            starts[text] = index
    if len(starts) < len(_COLUMNS):
        return None
    order = sorted(starts.values())
    columns = {}
    for name, start in starts.items():
        later = [index for index in order if index > start]
        end = later[0] if later else len(line_words)
        columns[name] = {
            "left": line_words[start]["x0"],
            "right": max(w["x1"] for w in line_words[start:end]),
        }
    if not (columns["withdrawal"]["left"] < columns["deposit"]["left"] < columns["balance"]["left"]):
        return None
    return columns


def _page_lines(page) -> list[list[dict]]:
    # Ignore rotated/margin artefacts that often appear as random characters.
    words = [w for w in page.extract_words() if w.get("upright", True)]
    # Words a couple of points apart share a line: some headers set "(SGD)"
    # slightly below "Balance". Statement rows are about 10 pt apart.
    lines: list[list[dict]] = []
    line_top = None
    for word in sorted(words, key=lambda w: w["top"]):
        if line_top is None or word["top"] - line_top > _LINE_TOLERANCE:
            lines.append([])
            line_top = word["top"]
        lines[-1].append(word)
    return [sorted(line, key=lambda w: w["x0"]) for line in lines]


def _find_column_positions(pdf) -> Optional[dict]:
    """Find withdrawal/deposit/balance column edges from the first header row."""
    for page in pdf.pages:
        for line_words in _page_lines(page):
            columns = _header_columns(line_words)
            if columns:
                return columns
    return None


def _amount_column(word: dict, columns: dict) -> Optional[str]:
    """DBS right-aligns amounts, so match a number to the column whose right
    edge is nearest its own. Numbers ending left of the withdrawal column are
    part of the description."""
    if word["x1"] <= columns["withdrawal"]["left"]:
        return None
    return min(_COLUMNS, key=lambda name: abs(word["x1"] - columns[name]["right"]))


def _format_amount(value: float) -> str:
    return f"{value:,.2f}"


def _reconcile(pending: dict, previous_balance: Optional[float]) -> tuple[Optional[float], Optional[float], Optional[str]]:
    """Check a row against the running balance and return (amountOut, amountIn, warning).

    previous balance - withdrawal + deposit must give the row's balance to the
    cent. When the amount was read into the wrong column, the other column is
    tried; a row that still doesn't reconcile keeps its amounts and a warning.
    A row never comes back with both a withdrawal and a deposit.
    """
    amount_out = pending.get("amountOut")
    amount_in = pending.get("amountIn")
    balance = pending.get("balance")
    both = amount_out is not None and amount_in is not None

    if balance is None or previous_balance is None:
        if both:
            return amount_out, None, (
                f"Read both a withdrawal ({_format_amount(amount_out)}) and a deposit "
                f"({_format_amount(amount_in)}) with no balance to check against; kept the withdrawal."
            )
        return amount_out, amount_in, None

    candidates = [] if both else [(amount_out, amount_in)]
    for amount in (amount_out, amount_in):
        if amount is not None:
            candidates += [(amount, None), (None, amount)]
    for out, inn in candidates:
        if _cents(previous_balance) - _cents(out or 0) + _cents(inn or 0) == _cents(balance):
            return out, inn, None

    if both:
        delta = balance - previous_balance
        amount = min((amount_out, amount_in), key=lambda value: abs(abs(delta) - value))
        amount_out, amount_in = (amount, None) if delta < 0 else (None, amount)
    expected = previous_balance - (amount_out or 0) + (amount_in or 0)
    read = (
        f"withdrawal {_format_amount(amount_out)}" if amount_out is not None
        else f"deposit {_format_amount(amount_in)}" if amount_in is not None
        else "no amount"
    )
    return amount_out, amount_in, (
        f"Running balance doesn't reconcile: previous balance {_format_amount(previous_balance)} "
        f"with {read} gives {_format_amount(expected)}, but the statement shows "
        f"{_format_amount(balance)}. Check this row's amount against the statement."
    )


def _parse_with_columns(
    pdf, account_metadata: dict, header_positions: Optional[dict] = None, account_number: Optional[str] = None
) -> list[dict]:
    """Parse POSB statement using word positions to map amounts to columns."""
    transactions = []
    statement_metadata = dict(account_metadata)
    statement_metadata.pop("accountNumber", None)
    statement_metadata.pop("accountIdentifier", None)
    columns = header_positions

    in_section = False
    previous_balance = None
    pending_tx = None
    current_account_number = account_number

    def _flush() -> None:
        nonlocal previous_balance
        if not pending_tx or (pending_tx.get("amountOut") is None and pending_tx.get("amountIn") is None):
            return
        amount_out, amount_in, warning = _reconcile(pending_tx, previous_balance)
        pending_tx["amountOut"] = amount_out
        pending_tx["amountIn"] = amount_in
        tx = _build_transaction(pending_tx, statement_metadata, current_account_number)
        if warning:
            tx["metadata"]["parseWarning"] = warning
            print(f"Warning: {pending_tx['date']} {pending_tx['description']}: {warning}")
        transactions.append(tx)
        if pending_tx.get("balance") is not None:
            previous_balance = pending_tx["balance"]
        elif previous_balance is not None:
            previous_balance = previous_balance - (amount_out or 0) + (amount_in or 0)

    for page in pdf.pages:
        for line_words in _page_lines(page):
            line_text = " ".join(w["text"] for w in line_words).strip()

            if not line_text:
                continue

            # The header repeats on every page; take each page's own positions.
            page_columns = _header_columns(line_words)
            if page_columns:
                columns = page_columns
                continue

            # An account header can appear at the top of a page or midway
            # through one. Keep it as parser state until the next header.
            detected_account_number = _extract_account_number(line_text)
            if detected_account_number:
                current_account_number = detected_account_number
                previous_balance = None
                print(f"Account Number: {current_account_number}")

            # Section starts
            if "Balance Brought Forward" in line_text or "Balance B/F" in line_text:
                in_section = True
                pending_tx = None
                bf_match = re.search(
                    r"Balance Brought Forward(?:\s+SGD)?\s+([\d,]+\.\d{2}-?)",
                    line_text,
                    re.I,
                )
                if bf_match:
                    previous_balance = _to_amount(bf_match.group(1))
                continue

            # Section ends
            if in_section and (
                "Balance Carried Forward" in line_text
                or "Total Balance Carried Forward" in line_text
                or "Balance C/F" in line_text
                or "Total Balance" in line_text
                or line_text.startswith("Messages For")
                or line_text.startswith("Transaction Details as of")
            ):
                _flush()
                in_section = False
                pending_tx = None
                continue

            if not in_section or not columns:
                continue

            # Detect new transaction line by date token at start
            date_match = re.match(r"^(\d{2}/\d{2}/\d{4})\b", line_text)
            if date_match:
                _flush()
                pending_tx = {
                    "date": date_match.group(1),
                    "description": "",
                    "amountOut": None,
                    "amountIn": None,
                    "balance": None,
                }

            if not pending_tx:
                continue

            desc_words = []
            for index, w in enumerate(line_words):
                if date_match and index == 0:
                    continue
                column = _amount_column(w, columns) if _AMOUNT_RE.match(w["text"]) else None
                if column is None:
                    if w["x0"] < columns["withdrawal"]["left"] - 5:
                        desc_words.append(w["text"])
                    continue
                # Amounts sit on the row's first line; later lines only add description.
                if not date_match:
                    continue
                amount = _to_amount(w["text"])
                if column == "withdrawal":
                    pending_tx["amountOut"] = amount
                elif column == "deposit":
                    pending_tx["amountIn"] = amount
                else:
                    pending_tx["balance"] = amount
            if desc_words:
                pending_tx["description"] = (
                    pending_tx["description"] + " " + " ".join(desc_words)
                ).strip()

        if in_section:
            _flush()
            pending_tx = None

    return transactions


def _build_transaction(pending: dict, account_metadata: dict, account_number: Optional[str] = None) -> dict:
    """Build transaction from pending data."""
    date_parts = pending["date"].split("/")
    date_formatted = f"{date_parts[2]}-{date_parts[1]}-{date_parts[0]}"
    transaction = {
        "date": date_formatted,
        "description": pending["description"],
        "amountOut": pending.get("amountOut"),
        "amountIn": pending.get("amountIn"),
        "balance": pending.get("balance"),
        "metadata": {
            "source": "pdf",
            "parserId": "dbs_posb_consolidated",
            "bank": "DBS/POSB",
            "currency": "SGD",
            **account_metadata,
        },
    }
    if account_number:
        transaction["accountNumber"] = account_number
        transaction["accountIdentifier"] = account_number
        transaction["metadata"]["accountNumber"] = account_number
        transaction["metadata"]["accountIdentifier"] = account_number
    return transaction
