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
            print(
                "Column positions - Withdrawal: "
                f"{header_positions['withdrawal_x']}, "
                f"Deposit: {header_positions['deposit_x']}, "
                f"Balance: {header_positions['balance_x']}"
            )
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


def _find_column_positions(pdf) -> Optional[dict]:
    """Find withdrawal/deposit/balance column x positions from header row."""
    for page in pdf.pages:
        # Ignore rotated/margin artefacts that often appear as random characters.
        words = [w for w in page.extract_words() if w.get("upright", True)]
        lines = {}
        for word in words:
            top_key = round(word["top"], 1)
            lines.setdefault(top_key, []).append(word)

        for top in sorted(lines.keys()):
            line_words = sorted(lines[top], key=lambda w: w["x0"])
            line_text = " ".join(w["text"] for w in line_words).lower()
            if "withdrawal" in line_text and "deposit" in line_text and "balance" in line_text:
                withdrawal_x = None
                deposit_x = None
                balance_x = None
                for word in line_words:
                    text_lower = word["text"].lower()
                    if text_lower == "withdrawal":
                        withdrawal_x = word["x0"]
                    elif text_lower == "deposit":
                        deposit_x = word["x0"]
                    elif text_lower == "balance":
                        balance_x = word["x0"]
                if withdrawal_x is not None and deposit_x is not None and balance_x is not None:
                    return {
                        "withdrawal_x": withdrawal_x,
                        "deposit_x": deposit_x,
                        "balance_x": balance_x,
                    }
    return None


def _parse_with_columns(
    pdf, account_metadata: dict, header_positions: dict, account_number: Optional[str] = None
) -> list[dict]:
    """Parse POSB statement using word positions to map amounts to columns."""
    transactions = []
    statement_metadata = dict(account_metadata)
    statement_metadata.pop("accountNumber", None)
    statement_metadata.pop("accountIdentifier", None)
    withdrawal_x = header_positions["withdrawal_x"]
    deposit_x = header_positions["deposit_x"]
    balance_x = header_positions["balance_x"]

    in_section = False
    previous_balance = None
    pending_tx = None
    current_account_number = account_number

    def _has_meaningful_pending(tx: Optional[dict]) -> bool:
        if not tx:
            return False
        if tx.get("amountOut") is not None:
            return True
        if tx.get("amountIn") is not None:
            return True
        return False

    for page in pdf.pages:
        # Ignore rotated/margin artefacts that often appear as random characters.
        words = [w for w in page.extract_words() if w.get("upright", True)]
        # Group words by line using top coordinate
        lines = {}
        for word in words:
            top_key = round(word["top"], 1)
            lines.setdefault(top_key, []).append(word)

        for top in sorted(lines.keys()):
            line_words = sorted(lines[top], key=lambda w: w["x0"])
            line_text = " ".join(w["text"] for w in line_words).strip()

            if not line_text:
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
                    r"Balance Brought Forward(?:\s+SGD)?\s+([\d,]+\.\d{2})",
                    line_text,
                    re.I,
                )
                if bf_match:
                    previous_balance = float(bf_match.group(1).replace(",", ""))
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
                if _has_meaningful_pending(pending_tx):
                    tx = _build_transaction(
                        pending_tx, statement_metadata, current_account_number
                    )
                    transactions.append(tx)
                    previous_balance = pending_tx.get("balance")
                in_section = False
                pending_tx = None
                continue

            if not in_section:
                continue

            # Detect new transaction line by date token at start
            date_match = re.match(r"^(\d{2}/\d{2}/\d{4})\b", line_text)
            if date_match:
                if _has_meaningful_pending(pending_tx):
                    tx = _build_transaction(
                        pending_tx, statement_metadata, current_account_number
                    )
                    transactions.append(tx)
                    previous_balance = pending_tx.get("balance")

                pending_tx = {
                    "date": date_match.group(1),
                    "description": "",
                    "amountOut": None,
                    "amountIn": None,
                    "balance": None,
                }

                # Build description from words left of withdrawal column
                desc_words = []
                for w in line_words:
                    if w["text"] == date_match.group(1):
                        continue
                    if w["x0"] < withdrawal_x - 5 and not re.match(r"^[\d,]+\.\d{2}$", w["text"]):
                        desc_words.append(w["text"])
                pending_tx["description"] = " ".join(desc_words).strip()

                # Map numeric words to columns
                for w in line_words:
                    if not re.match(r"^[\d,]+\.\d{2}$", w["text"]):
                        continue
                    amount = float(w["text"].replace(",", ""))
                    if withdrawal_x - 5 <= w["x0"] < deposit_x - 5:
                        pending_tx["amountOut"] = amount
                    elif deposit_x - 5 <= w["x0"] < balance_x - 5:
                        pending_tx["amountIn"] = amount
                    elif w["x0"] >= balance_x - 5:
                        pending_tx["balance"] = amount
                continue

            # Description continuation lines (no date, no amounts)
            if pending_tx:
                has_amount = any(re.match(r"^[\d,]+\.\d{2}$", w["text"]) for w in line_words)
                if not has_amount:
                    extra_desc = [
                        w["text"] for w in line_words if w["x0"] < withdrawal_x - 5
                    ]
                    if extra_desc:
                        pending_tx["description"] = (
                            (pending_tx["description"] + " " + " ".join(extra_desc)).strip()
                        )

        if in_section and _has_meaningful_pending(pending_tx):
            tx = _build_transaction(
                pending_tx, statement_metadata, current_account_number
            )
            transactions.append(tx)
            previous_balance = pending_tx.get("balance")
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
