"""Revolut statement parser for trip workflows.

Row contract (consumed by data-service ``importTripSpendings``):
    date, description, amountIn | amountOut (exactly one positive), balance,
    currency, metadata.transactionType (topup | conversion | transfer |
    cash_withdrawal | refund | card_payment), plus informational metadata.

Extra metadata written by this parser:
    needsReview / reviewReasons  -- the parser could not decide something safely
    parseWarnings                -- lines/rows that were skipped, attached to the
                                    nearest-dated emitted row (``/parse`` has no
                                    top-level warnings channel)
    counterpartyName / accountHolderName / transferKind  -- incoming transfers
    isPending                    -- Revolut State PENDING (CSV) or PDF pending section
    fxBaseCurrency / fxQuoteCurrency -- direction of ``fxRate``
    directionSource              -- PDF only: "balance" (running-balance delta) or "keyword"
    mergeStatus                  -- PDF+CSV only: "csv_only" | "pdf_only"
"""
import csv
import difflib
import io
import re
from datetime import date as date_cls
from typing import Optional

import pdfplumber
from dateutil import parser as date_parser


# ---------------------------------------------------------------------------
# Currency / money helpers
# ---------------------------------------------------------------------------

# Longest symbols first so the regex alternation prefers "S$" over "$".
_SYMBOL_CURRENCIES: list[tuple[str, Optional[str]]] = [
    ("US$", "USD"),
    ("S$", "SGD"),
    ("HK$", "HKD"),
    ("NZ$", "NZD"),
    ("NT$", "TWD"),
    ("CN¥", "CNY"),
    ("JP¥", "JPY"),
    ("A$", "AUD"),
    ("C$", "CAD"),
    ("R$", "BRL"),
    ("Rp", "IDR"),
    ("RM", "MYR"),
    ("zł", "PLN"),
    ("€", "EUR"),
    ("£", "GBP"),
    ("₩", "KRW"),
    ("₫", "VND"),
    ("₹", "INR"),
    ("฿", "THB"),
    ("₱", "PHP"),
    ("¥", None),  # JPY or CNY, resolved against the statement currency
    ("$", None),  # resolved against the statement currency
]
_SYMBOL_TO_CURRENCY = dict(_SYMBOL_CURRENCIES)

_KNOWN_CURRENCY_CODES = {
    "AED", "ARS", "AUD", "BGN", "BND", "BRL", "CAD", "CHF", "CLP", "CNY",
    "COP", "CZK", "DKK", "EGP", "EUR", "GBP", "HKD", "HUF", "IDR", "ILS",
    "INR", "ISK", "JPY", "KES", "KHR", "KRW", "LAK", "LKR", "MAD", "MMK",
    "MOP", "MXN", "MYR", "NOK", "NPR", "NZD", "PEN", "PHP", "PLN", "QAR",
    "RON", "RSD", "SAR", "SEK", "SGD", "THB", "TRY", "TWD", "UAH", "USD",
    "VND", "ZAR",
}

# Currencies Revolut commonly prints without minor units.
_ZERO_DECIMAL_CURRENCIES = {
    "JPY", "KRW", "VND", "IDR", "CLP", "ISK", "PYG", "UGX", "XAF", "XOF",
}
_DOLLAR_CURRENCIES = {"USD", "SGD", "HKD", "AUD", "CAD", "NZD", "TWD"}

_SYMBOL_RE = "|".join(re.escape(symbol) for symbol, _ in _SYMBOL_CURRENCIES)
_CODE_RE = "|".join(sorted(_KNOWN_CURRENCY_CODES))
_NUMBER_RE = r"\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?"

# One money token at the very end of a string, e.g. "S$1,234.56", "¥1,500",
# "SGD 12.00", "12.00 SGD", "-€3.20". A currency code and a symbol are never
# combined so a trailing word such as "JPY" in "Exchanged to JPY" stays in
# the description.
_MONEY_TAIL_RE = re.compile(
    rf"(?:^|(?<=\s))(?P<token>"
    rf"(?P<neg>-)?"
    rf"(?:(?P<code>{_CODE_RE})\s?|(?P<sym>{_SYMBOL_RE})\s?)?"
    rf"(?P<neg2>-)?"
    rf"(?P<num>{_NUMBER_RE})"
    rf"(?:\s?(?P<scode>{_CODE_RE})(?![A-Za-z])|(?P<ssym>₫|€|zł))?"
    rf")\s*$"
)


def _resolve_symbol(symbol: Optional[str], statement_currency: str) -> Optional[str]:
    if not symbol:
        return None
    resolved = _SYMBOL_TO_CURRENCY.get(symbol)
    if resolved:
        return resolved
    if symbol == "$":
        return statement_currency if statement_currency in _DOLLAR_CURRENCIES else "USD"
    if symbol == "¥":
        return statement_currency if statement_currency in {"JPY", "CNY"} else "JPY"
    return None


def _parse_money(value: str) -> Optional[float]:
    cleaned = re.sub(r"[^0-9.]", "", value or "")
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _parse_signed_money(value: str) -> Optional[float]:
    cleaned = re.sub(r"[^0-9.\-]", "", value or "")
    if not cleaned or cleaned in {"-", ".", "-."}:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _split_trailing_money(text: str, statement_currency: str) -> tuple[str, list[dict]]:
    """Peel up to two money tokens ("amount [balance]") off the end of a row.

    A bare integer ("1500") is only accepted for zero-decimal statement
    currencies, and both tokens must agree on carrying a currency marker, so a
    number at the end of a description ("7-Eleven", "Gate 7") is not mistaken
    for the amount.
    """
    tokens: list[dict] = []
    rest = text
    for _ in range(2):
        match = _MONEY_TAIL_RE.search(rest)
        if not match:
            break
        number = match.group("num")
        marker_currency = (
            match.group("code")
            or match.group("scode")
            or _resolve_symbol(match.group("sym") or match.group("ssym"), statement_currency)
        )
        has_marker = bool(
            match.group("code") or match.group("scode") or match.group("sym") or match.group("ssym")
        )
        is_strong = has_marker or "." in number or "," in number
        if not is_strong and statement_currency not in _ZERO_DECIMAL_CURRENCIES:
            break
        if tokens and tokens[0]["hasMarker"] != has_marker:
            break
        magnitude = _parse_money(number)
        if magnitude is None:
            break
        negative = bool(match.group("neg") or match.group("neg2"))
        tokens.insert(
            0,
            {
                "value": -magnitude if negative else magnitude,
                "magnitude": magnitude,
                "currency": marker_currency,
                "hasMarker": has_marker,
            },
        )
        rest = rest[: match.start("token")].rstrip()
    return rest, tokens


# ---------------------------------------------------------------------------
# Classification helpers (also used by the YouTrip parser)
# ---------------------------------------------------------------------------

_INCOMING_TRANSFER_RE = re.compile(
    r"^(?:transfer(?:\s+in)?|payment|money\s+received)\s+from\s+(?P<name>.+?)\s*$",
    re.I,
)
_NAME_STOP_WORDS = {
    "revolut", "youtrip", "ltd", "limited", "pte", "uab", "bank", "plc", "inc",
    "statement", "generated", "account", "accounts", "balance", "summary",
    "transactions", "transaction", "date", "description", "money", "iban", "bic",
    "swift", "page", "issued", "period", "wallet", "card", "number", "opening",
    "closing", "total", "report", "help", "united", "kingdom", "states",
    "singapore", "malaysia", "road", "street", "avenue", "drive", "lane",
    "tower", "building", "floor", "level", "unit", "my", "from", "to", "the",
}
_HONORIFICS = {"mr", "mrs", "ms", "miss", "mdm", "dr"}
_OWN_FUNDS_HINTS = {"vault", "pocket", "savings", "account", "wallet", "revolut", "main"}


def _review(metadata: dict, reason: str) -> None:
    metadata["needsReview"] = True
    reasons = metadata.setdefault("reviewReasons", [])
    if reason not in reasons:
        reasons.append(reason)


def _name_tokens(value: str) -> list[str]:
    tokens = [re.sub(r"[^\w]", "", part).casefold() for part in (value or "").split()]
    return [token for token in tokens if token and not token.isdigit() and token not in _HONORIFICS]


def looks_like_person_name(value: str) -> bool:
    words = (value or "").split()
    if not 2 <= len(words) <= 6:
        return False
    for word in words:
        if not re.fullmatch(r"[^\W\d_][^\W\d_'’.\-]*[.]?|[^\W\d_]+(?:['’\-][^\W\d_]+)+", word):
            return False
        if word.strip(".").casefold() in _NAME_STOP_WORDS:
            return False
    return True


def same_person(left: str, right: str) -> bool:
    """True when two names refer to the same person (order/case/middle names tolerated)."""
    left_tokens = set(_name_tokens(left))
    right_tokens = set(_name_tokens(right))
    if not left_tokens or not right_tokens:
        return False
    if left_tokens == right_tokens:
        return True
    smaller, larger = sorted([left_tokens, right_tokens], key=len)
    return len(smaller) >= 2 and smaller <= larger


def incoming_transfer_counterparty(description: str, from_detail: str = "") -> Optional[str]:
    """Return the sender for "Transfer from X" / "Payment from X" style rows."""
    match = _INCOMING_TRANSFER_RE.match((description or "").strip())
    if not match:
        return None
    name = match.group("name")
    if from_detail:
        # PDF "From: NAME, account" detail line is more precise than the description.
        detail_name = from_detail.split(",")[0].strip()
        if detail_name and not re.search(r"\d", detail_name):
            name = detail_name
    # Drop trailing account/card references such as ", 1234" or "*1234".
    name = re.split(r",|\s\*|\s\(|\s\d", name, maxsplit=1)[0].strip()
    return name or None


def extract_account_holder(
    lines: list[str], anchor_pattern: Optional[str] = None, window: int = 8
) -> Optional[str]:
    """Best-effort account holder name from a statement header.

    Prefers an explicit "Account holder:/Name:" label, otherwise the first
    person-looking line after ``anchor_pattern`` (or the top of the document),
    stopping at the first transaction row. Returns None rather than guessing.
    """
    header = lines[:80]
    for line in header:
        match = re.match(r"^(?:account\s+holder|account\s+name|name)\s*[:\-]\s*(.+)$", line, re.I)
        if match and looks_like_person_name(match.group(1).strip()):
            return match.group(1).strip()

    start = 0
    if anchor_pattern:
        for index, line in enumerate(header):
            if re.search(anchor_pattern, line, re.I):
                start = index + 1
                break
        else:
            return None
    for line in header[start : start + window]:
        if re.match(r"^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\b", line):
            break
        if re.match(r"^(?:date\s+description|balance\s+summary|account\s+transactions|transactions\b)", line, re.I):
            break
        if looks_like_person_name(line):
            return line.strip()
    return None


def classify_incoming_transfer(
    transaction: dict,
    holder: Optional[str],
    unknown_holder_type: Optional[str] = None,
) -> None:
    """Split incoming "transfer from <name>" rows into own funding vs. third-party money.

    * sender == account holder -> transactionType "topup" (wallet funding)
    * sender != account holder -> transactionType "transfer" (incoming; the
      importer books non-topup inflows as reimbursements)
    * holder unknown           -> keep ``unknown_holder_type`` (current behaviour)
      and flag the row for review
    """
    amount_in = _parse_money(str(transaction.get("amountIn") or ""))
    if not (amount_in and amount_in > 0):
        return
    metadata = transaction.setdefault("metadata", {})
    counterparty = incoming_transfer_counterparty(
        str(transaction.get("description") or ""), str(metadata.get("from") or "")
    )
    if not counterparty:
        return
    metadata["counterpartyName"] = counterparty
    if not holder:
        if unknown_holder_type:
            metadata["transactionType"] = unknown_holder_type
        _review(metadata, "account_holder_unknown")
        return
    metadata["accountHolderName"] = holder
    if same_person(counterparty, holder):
        metadata["transactionType"] = "topup"
        metadata["transferKind"] = "own_account"
        return
    if set(_name_tokens(counterparty)) & _OWN_FUNDS_HINTS:
        # "Transfer from Savings vault" etc. is the holder's own money, not a person.
        if unknown_holder_type:
            metadata["transactionType"] = unknown_holder_type
        _review(metadata, "counterparty_unclear")
        return
    metadata["transactionType"] = "transfer"
    metadata["transferKind"] = "third_party"
    if set(_name_tokens(counterparty)) & set(_name_tokens(holder)):
        # e.g. holder "JANE DOE", sender "JANE": probably someone else, but check.
        _review(metadata, "counterparty_name_partial_match")


def attach_parse_warnings(transactions: list[dict], warnings: list[dict]) -> None:
    """Attach skipped-line warnings to the nearest-dated row (no top-level channel exists)."""
    if not warnings or not transactions:
        return
    dated = [(index, _to_date(tx.get("date"))) for index, tx in enumerate(transactions)]
    for warning in warnings:
        target_index = 0
        warning_date = _to_date(warning.get("date"))
        if warning_date:
            candidates = [(abs((d - warning_date).days), i) for i, d in dated if d]
            if candidates:
                target_index = min(candidates)[1]
        metadata = transactions[target_index].setdefault("metadata", {})
        metadata.setdefault("parseWarnings", []).append(warning)


# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------


def _infer_direction(description: str) -> str:
    desc = description.lower()
    incoming_markers = [
        "top-up by",
        "google pay top-up by",
        "apple pay top-up by",
        "transfer from",
        "payment from",
        "money received from",
        "exchanged from",
        "refund",
        "cashback",
    ]
    outgoing_markers = [
        "transfer to",
        "cash withdrawal",
    ]
    if any(marker in desc for marker in incoming_markers):
        return "in"
    if any(marker in desc for marker in outgoing_markers):
        return "out"
    return "out"


def _transaction_type(description: str) -> str:
    desc = description.lower()
    if "top-up" in desc or "transfer from" in desc:
        # "transfer from <name>" is refined by classify_incoming_transfer().
        return "topup"
    if "exchange" in desc:
        return "conversion"
    if "transfer to" in desc:
        return "transfer"
    if "cash withdrawal" in desc:
        return "cash_withdrawal"
    if "payment from" in desc or "money received from" in desc:
        return "transfer"
    if "refund" in desc:
        return "refund"
    return "card_payment"


def _transaction_type_from_csv_type(csv_type: str, description: str) -> str:
    value = (csv_type or "").strip().lower()
    if "topup" in value:
        return "topup"
    if "refund" in value:
        return "refund"
    if "exchange" in value or "conversion" in value:
        return "conversion"
    if "transfer" in value:
        return "transfer"
    if "withdraw" in value or value == "atm":
        return "cash_withdrawal"
    if "card payment" in value or "card_payment" in value:
        return "card_payment"
    return _transaction_type(description)


def _try_parse_date(value: str) -> str:
    try:
        return date_parser.parse(value).strftime("%Y-%m-%d")
    except Exception:
        return value


def _normalize_ymd(value: str) -> Optional[str]:
    if not value:
        return None
    try:
        return date_parser.parse(value).strftime("%Y-%m-%d")
    except Exception:
        return None


def _to_date(value) -> Optional[date_cls]:
    normalized = _normalize_ymd(str(value or ""))
    if not normalized:
        return None
    year, month, day = normalized.split("-")
    return date_cls(int(year), int(month), int(day))


def _normalize_description(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip().lower()


def _description_similarity(left: str, right: str) -> float:
    a = _normalize_description(left)
    b = _normalize_description(right)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    if a in b or b in a:
        return 0.9
    return difflib.SequenceMatcher(None, a, b).ratio()


def _statement_direction_amount(transaction: dict) -> Optional[tuple[str, float]]:
    amount_in = _parse_money(str(transaction.get("amountIn") or ""))
    amount_out = _parse_money(str(transaction.get("amountOut") or ""))
    if amount_in and amount_in > 0:
        return ("in", round(amount_in, 2))
    if amount_out and amount_out > 0:
        return ("out", round(amount_out, 2))
    return None


def _apply_embedded_fee_amount(transaction: dict) -> dict:
    metadata_raw = transaction.get("metadata")
    metadata = metadata_raw if isinstance(metadata_raw, dict) else {}
    if metadata.get("feeEmbeddedApplied"):
        return transaction

    fee_amount = _parse_money(str(metadata.get("feeAmount") or ""))
    source_tag = str(metadata.get("source") or "").lower()
    amount_in = _parse_money(str(transaction.get("amountIn") or ""))
    amount_out = _parse_money(str(transaction.get("amountOut") or ""))
    if not (fee_amount and fee_amount > 0):
        return transaction

    # Fee embedding rules requested for Revolut:
    # - PDF rows already have fee applied in displayed amounts: no numeric mutation.
    # - CSV rows do not:
    #   * outgoing rows: fee is additional outflow => add fee to amountOut
    #   * incoming/topup rows: fee reduces credited value => subtract fee from amountIn
    if source_tag == "csv":
        if amount_out and amount_out > 0:
            transaction["amountOut"] = round(amount_out + fee_amount, 4)
        if amount_in and amount_in > 0:
            transaction["amountIn"] = round(max(amount_in - fee_amount, 0), 4)

    metadata["feeEmbeddedApplied"] = True
    transaction["metadata"] = metadata
    return transaction


def _set_direction(transaction: dict, direction: str, amount: float) -> None:
    transaction["amountIn"] = amount if direction == "in" else None
    transaction["amountOut"] = amount if direction == "out" else None


def _apply_conversion_legs(transaction: dict) -> None:
    """Normalise exchange rows into from/to legs for the wallet-transfer importer."""
    metadata = transaction.get("metadata") or {}
    if metadata.get("transactionType") != "conversion":
        return
    direction_amount = _statement_direction_amount(transaction)
    foreign_amount = _parse_money(str(metadata.get("foreignAmount") or "")) or 0
    foreign_currency = metadata.get("foreignCurrency")
    statement_currency = metadata.get("currency") or transaction.get("currency")
    if not direction_amount or not (foreign_amount > 0) or not foreign_currency:
        return
    direction, _ = direction_amount
    statement_amount = (
        _parse_money(str(metadata.get("statementAmount") or "")) or direction_amount[1]
    )
    if direction == "out":
        metadata["fromAmount"] = statement_amount
        metadata["fromCurrency"] = statement_currency
        metadata["toAmount"] = foreign_amount
        metadata["toCurrency"] = foreign_currency
    else:
        metadata["fromAmount"] = foreign_amount
        metadata["fromCurrency"] = foreign_currency
        metadata["toAmount"] = statement_amount
        metadata["toCurrency"] = statement_currency


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------

_DATE_PREFIX_RE = re.compile(r"^(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\s+(.+)$")
_DATE_ONLY_RE = re.compile(r"^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}$")
_DATE_RANGE_RE = re.compile(r"^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\s+(?:to|-)\s+\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}$", re.I)
_SECTION_RE = re.compile(
    r"^(?P<name>[A-Za-z][A-Za-z ()]*?)\s+from\s+\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\s+to\s+\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}$",
    re.I,
)
_FOOTER_RE = re.compile(
    r"^(Report lost|Get help directly|Scan the QR code|©\s+\d{4}\s+Revolut)",
    re.I,
)
_RATE_RE = re.compile(
    rf"Revolut Rate\s+(?:(?P<bcode>{_CODE_RE})\s?|(?P<bsym>{_SYMBOL_RE})\s?)?"
    rf"1(?:\.0+)?\s*(?P<bcode2>{_CODE_RE})?\s*=\s*"
    rf"(?:(?P<qcode>{_CODE_RE})\s?|(?P<qsym>{_SYMBOL_RE})\s?)?"
    rf"(?P<rate>\d[\d,]*(?:\.\d+)?)\s*(?P<qcode2>{_CODE_RE})?(?![A-Za-z])"
)
_FOREIGN_TAIL_CODE_RE = re.compile(r"(\d[\d,]*(?:\.\d+)?)\s*([A-Z]{3})\s*$")
_FOREIGN_TAIL_SYMBOL_RE = re.compile(rf"(?:^|\s)({_SYMBOL_RE})\s?(\d[\d,]*(?:\.\d+)?)\s*$")


def _fee_pattern(statement_currency: str) -> re.Pattern:
    number = r"\d[\d,]*(?:\.\d{1,2})?" if statement_currency in _ZERO_DECIMAL_CURRENCIES else r"[\d,]*\.\d{2}"
    return re.compile(
        rf"\bfee\b[^0-9A-Z]*(?:{_SYMBOL_RE})?\s*({number})(?:\s*([A-Z]{{3}}))?",
        re.I,
    )


def _section_kind(name: str) -> str:
    lowered = name.lower()
    if "revert" in lowered:
        return "reverted"
    if "pending" in lowered:
        return "pending"
    return "completed"


def _resolve_pdf_directions(rows: list[dict]) -> None:
    """Pick in/out from the running balance; fall back to description keywords.

    Works for either chronological or reverse-chronological listings by
    choosing whichever neighbour comparison explains more rows.
    """
    by_section: dict[int, list[dict]] = {}
    for row in rows:
        by_section.setdefault(row["section"], []).append(row)

    for section_rows in by_section.values():
        def matches(prev_row, row):
            amount = row["amount"]
            if prev_row is None or not (amount > 0):
                return None
            if prev_row["balance"] is None or row["balance"] is None:
                return None
            delta = row["balance"] - prev_row["balance"]
            if abs(delta - amount) <= 0.005:
                return "in"
            if abs(delta + amount) <= 0.005:
                return "out"
            return None

        forward = [matches(section_rows[i - 1] if i else None, row) for i, row in enumerate(section_rows)]
        backward = [
            matches(section_rows[i + 1] if i + 1 < len(section_rows) else None, row)
            for i, row in enumerate(section_rows)
        ]
        chosen = forward if sum(bool(d) for d in forward) >= sum(bool(d) for d in backward) else backward
        for row, direction in zip(section_rows, chosen):
            tx = row["tx"]
            if direction:
                tx["metadata"]["directionSource"] = "balance"
            else:
                direction = _infer_direction(tx["description"])
                tx["metadata"]["directionSource"] = "keyword"
            _set_direction(tx, direction, row["amount"])


def _parse_pdf_document(content: bytes) -> dict:
    """Parse a Revolut PDF statement.

    Returns {"transactions", "warnings", "holder"}; transactions are not yet
    classified against the account holder.
    """
    lines: list[str] = []
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            lines.extend([line.strip() for line in text.split("\n") if line.strip()])

    all_text = "\n".join(lines)
    account_identifier = None
    currency = "SGD"

    account_match = re.search(r"Account Number\s+(\d{10,})", all_text, re.I)
    if account_match:
        account_identifier = account_match.group(1)

    currency_match = re.search(r"\b([A-Z]{3})\s+Statement\b", all_text)
    if currency_match:
        currency = currency_match.group(1)

    holder = extract_account_holder(lines, anchor_pattern=r"^Generated on\b")
    fee_pattern = _fee_pattern(currency)

    rows: list[dict] = []
    warnings: list[dict] = []
    current_tx: Optional[dict] = None
    section_index = 0
    section_kind = "completed"

    for line in lines:
        if _FOOTER_RE.match(line):
            continue
        if re.match(r"^Date\s+Description\b", line, re.I):
            continue
        section_match = _SECTION_RE.match(line)
        if section_match:
            current_tx = None
            section_index += 1
            section_kind = _section_kind(section_match.group("name"))
            continue

        tx_match = _DATE_PREFIX_RE.match(line)
        if tx_match and not _DATE_RANGE_RE.match(line):
            current_tx = None
            date_text = tx_match.group(1)
            description, tokens = _split_trailing_money(tx_match.group(2).strip(), currency)
            description = description.strip()
            if not tokens or not description:
                warnings.append(
                    {
                        "type": "unparsed_line",
                        "date": _try_parse_date(date_text),
                        "line": line,
                        "reason": "no amount found" if not tokens else "no description found",
                    }
                )
                continue

            amount_token = tokens[0]
            balance_token = tokens[1] if len(tokens) > 1 else None
            amount = amount_token["magnitude"]
            balance = balance_token["value"] if balance_token else None

            if section_kind == "reverted":
                warnings.append(
                    {
                        "type": "skipped_reverted",
                        "date": _try_parse_date(date_text),
                        "line": line,
                        "reason": "listed in the statement's reverted section",
                    }
                )
                continue

            metadata = {
                "source": "pdf",
                "parserId": "revolut_statement",
                "provider": "Revolut",
                "currency": currency,
                "transactionType": _transaction_type(description),
                "statementAmount": amount,
                "completedDate": _try_parse_date(date_text),
            }
            if account_identifier:
                metadata["accountIdentifier"] = account_identifier
            if section_kind == "pending":
                metadata["isPending"] = True
                _review(metadata, "pending")

            current_tx = {
                "date": _try_parse_date(date_text),
                "description": description,
                "amountIn": None,
                "amountOut": None,
                "balance": balance,
                "currency": currency,
                "metadata": metadata,
            }
            if account_identifier:
                current_tx["accountIdentifier"] = account_identifier
                current_tx["accountNumber"] = account_identifier
            rows.append(
                {"tx": current_tx, "amount": amount, "balance": balance, "section": section_index}
            )
            continue

        if tx_match is None and _DATE_ONLY_RE.match(line):
            current_tx = None
            warnings.append(
                {
                    "type": "unparsed_line",
                    "date": _try_parse_date(line),
                    "line": line,
                    "reason": "date without description or amount",
                }
            )
            continue

        if not current_tx:
            continue

        fee_match = fee_pattern.search(line)
        if fee_match:
            current_tx["metadata"]["feeAmount"] = _parse_money(fee_match.group(1))
            current_tx["metadata"]["feeCurrency"] = (
                fee_match.group(2).upper() if fee_match.group(2) else currency
            )
            continue

        if line.startswith("Revolut Rate"):
            metadata = current_tx["metadata"]
            is_conversion = metadata.get("transactionType") == "conversion"
            rate_match = _RATE_RE.search(line)
            rate_end = 0
            if rate_match:
                rate_end = rate_match.end()
                base_currency = (
                    rate_match.group("bcode")
                    or rate_match.group("bcode2")
                    or _resolve_symbol(rate_match.group("bsym"), currency)
                    or currency
                )
                quote_currency = (
                    rate_match.group("qcode")
                    or rate_match.group("qcode2")
                    or _resolve_symbol(rate_match.group("qsym"), currency)
                )
                metadata["fxRate"] = _parse_money(rate_match.group("rate"))
                metadata["fxBaseCurrency"] = base_currency
                if quote_currency:
                    metadata["fxQuoteCurrency"] = quote_currency
                    metadata["foreignCurrency" if is_conversion else "merchantCurrency"] = quote_currency

            foreign_amount = None
            foreign_currency = None
            code_match = _FOREIGN_TAIL_CODE_RE.search(line)
            symbol_match = _FOREIGN_TAIL_SYMBOL_RE.search(line)
            if code_match and code_match.start() >= rate_end:
                foreign_amount = _parse_money(code_match.group(1))
                foreign_currency = code_match.group(2)
            elif symbol_match and symbol_match.start(1) >= rate_end:
                foreign_amount = _parse_money(symbol_match.group(2))
                foreign_currency = _resolve_symbol(symbol_match.group(1), currency)
            if foreign_amount is not None:
                metadata["foreignAmount"] = foreign_amount
                if foreign_currency:
                    # Conversion rows use foreignCurrency for wallet transfer logic; other rows
                    # keep merchant currency separate so the statement currency stays authoritative.
                    metadata["foreignCurrency" if is_conversion else "merchantCurrency"] = foreign_currency
            continue

        if line.startswith("From:"):
            current_tx["metadata"]["from"] = line.replace("From:", "", 1).strip()
            continue

        if line.startswith("To:"):
            current_tx["metadata"]["to"] = line.replace("To:", "", 1).strip()
            continue

        if line.startswith("Reference:"):
            current_tx["metadata"]["reference"] = line.replace("Reference:", "", 1).strip()
            continue

    _resolve_pdf_directions(rows)
    transactions = [row["tx"] for row in rows]
    for transaction in transactions:
        _apply_conversion_legs(transaction)
    transactions = [_apply_embedded_fee_amount(transaction) for transaction in transactions]
    return {"transactions": transactions, "warnings": warnings, "holder": holder}


# ---------------------------------------------------------------------------
# CSV
# ---------------------------------------------------------------------------

_DROPPED_CSV_STATES = {"REVERTED", "DECLINED", "FAILED"}


def _parse_csv_document(content: bytes) -> dict:
    """Parse a Revolut CSV export.

    Returns {"transactions", "dropped", "warnings"}. Rows whose State is
    REVERTED/DECLINED/FAILED are moved to "dropped" (kept only so the PDF
    merge can recognise and discard their PDF counterparts).
    """
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    transactions: list[dict] = []
    dropped: list[dict] = []
    warnings: list[dict] = []

    for row in reader:
        description = (row.get("Description") or "").strip() or "Revolut Transaction"
        currency = (row.get("Currency") or "SGD").strip().upper() or "SGD"
        amount_signed = _parse_signed_money(str(row.get("Amount") or ""))
        if amount_signed is None:
            continue

        amount_abs = abs(amount_signed)
        amount_in = amount_abs if amount_signed > 0 else None
        amount_out = amount_abs if amount_signed < 0 else None

        started_date_raw = str(row.get("Started Date") or "").strip()
        completed_date_raw = str(row.get("Completed Date") or "").strip()
        balance = _parse_signed_money(str(row.get("Balance") or ""))
        fee_amount = _parse_signed_money(str(row.get("Fee") or ""))
        csv_type = str(row.get("Type") or "").strip()
        csv_state = str(row.get("State") or "").strip()
        transaction_date = _try_parse_date(started_date_raw or completed_date_raw)

        metadata = {
            "source": "csv",
            "parserId": "revolut_statement",
            "provider": "Revolut",
            "currency": currency,
            "transactionType": _transaction_type_from_csv_type(csv_type, description),
            "csvType": csv_type,
            "csvState": csv_state,
            "csvAmount": amount_abs,
            "startedDate": started_date_raw,
            "completedDate": completed_date_raw,
        }
        if fee_amount is not None:
            metadata["feeAmount"] = abs(fee_amount)
            metadata["feeCurrency"] = currency

        transaction = _apply_embedded_fee_amount(
            {
                "date": transaction_date,
                "description": description,
                "amountIn": amount_in,
                "amountOut": amount_out,
                "balance": balance,
                "currency": currency,
                "metadata": metadata,
            }
        )

        state = csv_state.upper()
        if state in _DROPPED_CSV_STATES:
            dropped.append(transaction)
            warnings.append(
                {
                    "type": "skipped_state",
                    "date": transaction_date,
                    "state": state,
                    "description": description,
                    "amount": amount_signed,
                    "currency": currency,
                    "reason": f"Revolut state {state}: not imported",
                }
            )
            continue
        if state == "PENDING":
            metadata["isPending"] = True
            _review(metadata, "pending")

        transactions.append(transaction)

    return {"transactions": transactions, "dropped": dropped, "warnings": warnings}


# ---------------------------------------------------------------------------
# PDF + CSV merge
# ---------------------------------------------------------------------------

_PDF_ENRICH_FIELDS = (
    "fxRate",
    "fxBaseCurrency",
    "fxQuoteCurrency",
    "foreignAmount",
    "foreignCurrency",
    "merchantCurrency",
    "from",
    "to",
    "reference",
    "accountIdentifier",
    "statementAmount",
)


def _csv_amount_candidates(csv_tx: dict) -> set[float]:
    amounts = set()
    direction_amount = _statement_direction_amount(csv_tx)
    if direction_amount:
        amounts.add(direction_amount[1])
    raw = _parse_money(str((csv_tx.get("metadata") or {}).get("csvAmount") or ""))
    if raw:
        amounts.add(round(raw, 2))
    return amounts


def _csv_dates(csv_tx: dict) -> list[date_cls]:
    metadata = csv_tx.get("metadata") or {}
    dates = [_to_date(metadata.get("completedDate")), _to_date(metadata.get("startedDate")), _to_date(csv_tx.get("date"))]
    return [value for value in dates if value]


def _match_score(pdf_tx: dict, csv_tx: dict) -> Optional[float]:
    """Score how likely a PDF row and a CSV row are the same transaction.

    Direction is deliberately ignored for eligibility (PDF direction can be a
    keyword guess): same amount, date within a day, similar description.
    """
    pdf_amount = _parse_money(str((pdf_tx.get("metadata") or {}).get("statementAmount") or ""))
    if pdf_amount is None:
        direction_amount = _statement_direction_amount(pdf_tx)
        pdf_amount = direction_amount[1] if direction_amount else None
    if pdf_amount is None:
        return None
    if not any(abs(pdf_amount - amount) <= 0.01 for amount in _csv_amount_candidates(csv_tx)):
        return None
    pdf_date = _to_date(pdf_tx.get("date"))
    csv_dates = _csv_dates(csv_tx)
    if not pdf_date or not csv_dates:
        return None
    day_gap = min(abs((pdf_date - value).days) for value in csv_dates)
    if day_gap > 1:
        return None
    similarity = _description_similarity(
        str(pdf_tx.get("description") or ""), str(csv_tx.get("description") or "")
    )
    if similarity < 0.6:
        return None
    score = similarity + (0.5 if day_gap == 0 else 0.0)
    pdf_direction = _statement_direction_amount(pdf_tx)
    csv_direction = _statement_direction_amount(csv_tx)
    if pdf_direction and csv_direction and pdf_direction[0] == csv_direction[0]:
        score += 0.25
    return score


def _merge_pdf_and_csv_transactions(
    pdf_transactions: list[dict],
    csv_transactions: list[dict],
    dropped_csv_transactions: Optional[list[dict]] = None,
    warnings: Optional[list[dict]] = None,
) -> list[dict]:
    """Merge Revolut PDF + CSV rows with the CSV as the source of truth.

    * CSV rows are always emitted, with their own direction/amount/type.
    * A PDF row that matches a CSV row (same amount, date +/- 1 day, similar
      description, any direction) only enriches it (FX rate, foreign amount,
      From/To/Reference, account number, balance when missing).
    * A PDF row matching a REVERTED/DECLINED/FAILED CSV row is discarded.
    * Unmatched PDF rows outside the CSV's date range are appended
      (mergeStatus "pdf_only"); inside the range they are appended but flagged
      for review, since the CSV should have contained them.
    """
    dropped_csv_transactions = dropped_csv_transactions or []
    warnings = warnings if warnings is not None else []
    candidates = [("kept", index, tx) for index, tx in enumerate(csv_transactions)] + [
        ("dropped", index, tx) for index, tx in enumerate(dropped_csv_transactions)
    ]
    used: set[tuple[str, int]] = set()
    pdf_by_csv_index: dict[int, dict] = {}
    unmatched_pdf: list[dict] = []

    for pdf_tx in pdf_transactions:
        best = None
        for kind, index, csv_tx in candidates:
            if (kind, index) in used:
                continue
            score = _match_score(pdf_tx, csv_tx)
            if score is not None and (best is None or score > best[0]):
                best = (score, kind, index)
        if best is None:
            unmatched_pdf.append(pdf_tx)
            continue
        _, kind, index = best
        used.add((kind, index))
        if kind == "kept":
            pdf_by_csv_index[index] = pdf_tx

    all_csv_dates = [d for _, _, tx in candidates for d in _csv_dates(tx)]
    csv_range = (min(all_csv_dates), max(all_csv_dates)) if all_csv_dates else None

    merged_transactions: list[dict] = []
    for index, csv_tx in enumerate(csv_transactions):
        pdf_tx = pdf_by_csv_index.get(index)
        if pdf_tx is None:
            csv_tx.setdefault("metadata", {})["mergeStatus"] = "csv_only"
            merged_transactions.append(csv_tx)
            continue

        merged_tx = dict(csv_tx)
        merged_metadata = dict(csv_tx.get("metadata") or {})
        pdf_metadata = pdf_tx.get("metadata") or {}
        for field in _PDF_ENRICH_FIELDS:
            value = pdf_metadata.get(field)
            if value not in (None, "") and merged_metadata.get(field) in (None, ""):
                merged_metadata[field] = value
        if merged_metadata.get("transactionType") == "conversion" and pdf_metadata.get(
            "merchantCurrency"
        ) and not merged_metadata.get("foreignCurrency"):
            merged_metadata["foreignCurrency"] = pdf_metadata["merchantCurrency"]
        if pdf_metadata.get("isPending"):
            merged_metadata["isPending"] = True
            _review(merged_metadata, "pending")
        merged_metadata["source"] = "pdf+csv"

        # Keep the PDF wording (what the user sees on the statement) and the
        # CSV started date / amounts / direction.
        merged_tx["description"] = pdf_tx.get("description") or csv_tx.get("description")
        if merged_tx.get("balance") is None and pdf_tx.get("balance") is not None:
            merged_tx["balance"] = pdf_tx.get("balance")
        if not merged_tx.get("currency") and pdf_tx.get("currency"):
            merged_tx["currency"] = pdf_tx.get("currency")
        for key in ("accountIdentifier", "accountNumber"):
            if pdf_tx.get(key) and not merged_tx.get(key):
                merged_tx[key] = pdf_tx[key]
        merged_tx["metadata"] = merged_metadata
        _apply_conversion_legs(merged_tx)
        merged_transactions.append(merged_tx)

    for pdf_tx in unmatched_pdf:
        metadata = pdf_tx.setdefault("metadata", {})
        metadata["mergeStatus"] = "pdf_only"
        pdf_date = _to_date(pdf_tx.get("date"))
        if csv_range and pdf_date and csv_range[0] <= pdf_date <= csv_range[1]:
            _review(metadata, "pdf_row_not_in_csv")
        merged_transactions.append(pdf_tx)

    return merged_transactions


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def _detect_format(content: bytes) -> str:
    if content.lstrip().startswith(b"%PDF"):
        return "pdf"
    return "csv"


def _sort_transactions_by_date(transactions: list[dict]) -> list[dict]:
    decorated: list[tuple[tuple[int, int, int], int, dict]] = []
    for index, transaction in enumerate(transactions):
        normalized_date = _normalize_ymd(str(transaction.get("date") or ""))
        if normalized_date:
            year, month, day = normalized_date.split("-")
            sort_key = (0, int(year), int(month), int(day))
        else:
            sort_key = (1, 0, 0, 0)
        decorated.append((sort_key, index, transaction))

    decorated.sort(key=lambda item: (item[0], item[1]))
    return [item[2] for item in decorated]


def _parse_document(content: bytes) -> dict:
    if _detect_format(content) == "pdf":
        result = _parse_pdf_document(content)
        result["dropped"] = []
        result["format"] = "pdf"
        return result
    result = _parse_csv_document(content)
    result["holder"] = None
    result["format"] = "csv"
    return result


def _finalize(transactions: list[dict], warnings: list[dict], holder: Optional[str]) -> list[dict]:
    for transaction in transactions:
        metadata = transaction.get("metadata") or {}
        # Without a holder name keep the previous mapping (PDF: topup, CSV: by Type).
        classify_incoming_transfer(transaction, holder, metadata.get("transactionType"))
    attach_parse_warnings(transactions, warnings)
    return transactions


def parse(content: bytes) -> list[dict]:
    """Parse single Revolut statement file (PDF or CSV)."""
    result = _parse_document(content)
    return _finalize(result["transactions"], result["warnings"], result["holder"])


def parse_with_supplemental(primary_content: bytes, supplemental_content: bytes) -> list[dict]:
    """Parse Revolut primary + supplemental files; CSV wins over PDF when both are given."""
    documents = [_parse_document(primary_content), _parse_document(supplemental_content)]
    holder = next((doc["holder"] for doc in documents if doc.get("holder")), None)
    warnings = [warning for doc in documents for warning in doc["warnings"]]

    pdf_transactions = [tx for doc in documents if doc["format"] == "pdf" for tx in doc["transactions"]]
    csv_transactions = [tx for doc in documents if doc["format"] == "csv" for tx in doc["transactions"]]
    dropped_csv = [tx for doc in documents if doc["format"] == "csv" for tx in doc["dropped"]]

    if pdf_transactions and (csv_transactions or dropped_csv):
        transactions = _merge_pdf_and_csv_transactions(
            pdf_transactions, csv_transactions, dropped_csv, warnings
        )
    else:
        transactions = [*pdf_transactions, *csv_transactions]

    return _finalize(_sort_transactions_by_date(transactions), warnings, holder)
