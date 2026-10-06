from app.parsers import revolut_statement_parser as parser

# All names, amounts and numbers below are synthetic.

CSV_HEADER = "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance"


class _FakePage:
    def __init__(self, text):
        self._text = text

    def extract_text(self):
        return self._text


class _FakePdf:
    def __init__(self, text):
        self.pages = [_FakePage(text)]

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False


def _use_pdf_text(monkeypatch, text):
    monkeypatch.setattr(parser.pdfplumber, "open", lambda _: _FakePdf(text))


def _parse_pdf(monkeypatch, text):
    _use_pdf_text(monkeypatch, text)
    return parser.parse(b"%PDF-1.4 fake")


def _csv(*rows):
    return ("\n".join([CSV_HEADER, *rows]) + "\n").encode("utf-8")


def _header(currency="SGD", holder="JOHN TAN"):
    lines = [
        f"{currency} Statement",
        "Generated on the 5 Feb 2025",
        "Revolut Technologies Singapore Pte. Ltd.",
    ]
    if holder:
        lines.append(holder)
    lines += [
        "1 Example Road",
        "Singapore 000000",
        "Account transactions from 1 January 2025 to 31 January 2025",
        "Date Description Money out Money in Balance",
    ]
    return lines


def _by_description(rows):
    return {row["description"]: row for row in rows}


# --- Bug 1: transfers from other people are not wallet funding ---------------


def test_extracts_account_holder_from_header():
    assert parser.extract_account_holder(_header(), anchor_pattern=r"^Generated on\b") == "JOHN TAN"
    assert parser.extract_account_holder(_header(holder=None), anchor_pattern=r"^Generated on\b") is None


def test_transfer_from_holder_is_topup_and_from_friend_is_incoming_transfer(monkeypatch):
    rows = _parse_pdf(
        monkeypatch,
        "\n".join(
            _header()
            + [
                "1 Jan 2025 Top-Up by *1234 S$100.00 S$100.00",
                "2 Jan 2025 Transfer from JOHN TAN S$50.00 S$150.00",
                "3 Jan 2025 Transfer from JANE LIM S$20.00 S$170.00",
                "4 Jan 2025 Payment from Ali Bin Abu S$10.00 S$180.00",
            ]
        ),
    )
    rows = _by_description(rows)

    assert rows["Top-Up by *1234"]["metadata"]["transactionType"] == "topup"

    own = rows["Transfer from JOHN TAN"]
    assert own["metadata"]["transactionType"] == "topup"
    assert own["metadata"]["transferKind"] == "own_account"
    assert own["amountIn"] == 50.00

    friend = rows["Transfer from JANE LIM"]
    assert friend["metadata"]["transactionType"] == "transfer"
    assert friend["metadata"]["transferKind"] == "third_party"
    assert friend["metadata"]["counterpartyName"] == "JANE LIM"
    assert friend["metadata"]["accountHolderName"] == "JOHN TAN"
    assert friend["amountIn"] == 20.00 and friend["amountOut"] is None
    assert not friend["metadata"].get("needsReview")

    payment = rows["Payment from Ali Bin Abu"]
    assert payment["amountIn"] == 10.00
    assert payment["metadata"]["transactionType"] == "transfer"


def test_holder_name_match_tolerates_case_order_and_middle_name():
    assert parser.same_person("john tan", "TAN JOHN")
    assert parser.same_person("JOHN WEI MING TAN", "John Tan")
    assert not parser.same_person("JANE TAN", "JOHN TAN")
    assert not parser.same_person("JOHN", "JOHN TAN")


def test_partial_name_overlap_is_transfer_but_flagged(monkeypatch):
    rows = _parse_pdf(
        monkeypatch,
        "\n".join(_header() + ["2 Jan 2025 Transfer from JOHN S$50.00 S$50.00"]),
    )
    metadata = rows[0]["metadata"]
    assert metadata["transactionType"] == "transfer"
    assert "counterparty_name_partial_match" in metadata["reviewReasons"]


def test_unknown_holder_keeps_topup_but_flags_review(monkeypatch):
    rows = _parse_pdf(
        monkeypatch,
        "\n".join(_header(holder=None) + ["2 Jan 2025 Transfer from JANE LIM S$20.00 S$20.00"]),
    )
    metadata = rows[0]["metadata"]
    assert metadata["transactionType"] == "topup"
    assert metadata["needsReview"] is True
    assert metadata["reviewReasons"] == ["account_holder_unknown"]
    assert metadata["counterpartyName"] == "JANE LIM"


def test_csv_only_transfer_from_is_flagged_without_holder():
    rows = parser.parse(
        _csv(
            "TRANSFER,Current,2025-01-02 10:00:00,2025-01-02 10:00:01,Transfer from JANE LIM,20.00,0.00,SGD,COMPLETED,20.00",
            "TOPUP,Current,2025-01-01 10:00:00,2025-01-01 10:00:01,Top-Up by *1234,100.00,0.00,SGD,COMPLETED,120.00",
        )
    )
    rows = _by_description(rows)
    transfer = rows["Transfer from JANE LIM"]["metadata"]
    assert transfer["transactionType"] == "transfer"
    assert transfer["needsReview"] is True
    assert "needsReview" not in rows["Top-Up by *1234"]["metadata"]


def test_pdf_holder_classifies_csv_rows_in_merge(monkeypatch):
    _use_pdf_text(
        monkeypatch,
        "\n".join(
            _header()
            + [
                "2 Jan 2025 Transfer from JOHN TAN S$50.00 S$50.00",
                "3 Jan 2025 Transfer from JANE LIM S$20.00 S$70.00",
            ]
        ),
    )
    rows = parser.parse_with_supplemental(
        b"%PDF-1.4 fake",
        _csv(
            "TRANSFER,Current,2025-01-02 10:00:00,2025-01-02 10:00:01,Transfer from JOHN TAN,50.00,0.00,SGD,COMPLETED,50.00",
            "TRANSFER,Current,2025-01-03 10:00:00,2025-01-03 10:00:01,Transfer from JANE LIM,20.00,0.00,SGD,COMPLETED,70.00",
        ),
    )
    assert len(rows) == 2
    rows = _by_description(rows)
    assert rows["Transfer from JOHN TAN"]["metadata"]["transactionType"] == "topup"
    assert rows["Transfer from JANE LIM"]["metadata"]["transactionType"] == "transfer"
    assert all(row["metadata"]["source"] == "pdf+csv" for row in rows.values())


# --- Bug 3: CSV State --------------------------------------------------------


def test_csv_drops_reverted_declined_failed_and_marks_pending():
    rows = parser.parse(
        _csv(
            "CARD_PAYMENT,Current,2025-01-01 10:00:00,2025-01-01 10:00:01,Cafe,-5.00,0.00,SGD,COMPLETED,95.00",
            "CARD_PAYMENT,Current,2025-01-02 10:00:00,,Hotel,-80.00,0.00,SGD,REVERTED,95.00",
            "CARD_PAYMENT,Current,2025-01-02 11:00:00,,Shop,-9.00,0.00,SGD,DECLINED,95.00",
            "CARD_PAYMENT,Current,2025-01-02 12:00:00,,Kiosk,-3.00,0.00,SGD,FAILED,95.00",
            "CARD_PAYMENT,Current,2025-01-03 10:00:00,,Taxi,-12.00,0.00,SGD,PENDING,83.00",
        )
    )

    assert [row["description"] for row in rows] == ["Cafe", "Taxi"]
    taxi = rows[1]["metadata"]
    assert taxi["isPending"] is True
    assert taxi["csvState"] == "PENDING"
    assert "pending" in taxi["reviewReasons"]
    assert rows[1]["amountOut"] == 12.00

    warnings = [w for row in rows for w in row["metadata"].get("parseWarnings", [])]
    assert sorted(w["state"] for w in warnings) == ["DECLINED", "FAILED", "REVERTED"]
    assert all(w["type"] == "skipped_state" for w in warnings)


def test_pdf_reverted_section_is_not_imported(monkeypatch):
    rows = _parse_pdf(
        monkeypatch,
        "\n".join(
            _header()
            + [
                "1 Jan 2025 Cafe S$5.00 S$95.00",
                "Reverted from 1 January 2025 to 31 January 2025",
                "Date Description Money out Money in",
                "2 Jan 2025 Hotel S$80.00",
                "Pending from 1 January 2025 to 31 January 2025",
                "3 Jan 2025 Taxi S$12.00",
            ]
        ),
    )
    assert [row["description"] for row in rows] == ["Cafe", "Taxi"]
    assert rows[1]["metadata"]["isPending"] is True
    warnings = rows[0]["metadata"]["parseWarnings"] + rows[1]["metadata"].get("parseWarnings", [])
    assert [w["type"] for w in warnings] == ["skipped_reverted"]


# --- Bug 4: amount formats + parse warnings ----------------------------------


def test_pdf_zero_decimal_currency_and_thousands_separators(monkeypatch):
    rows = _parse_pdf(
        monkeypatch,
        "\n".join(
            _header(currency="JPY")
            + [
                "1 Jan 2025 Top-Up by *1234 ¥10,000 ¥10,000",
                "2 Jan 2025 7-Eleven ¥500 ¥9,500",
                "3 Jan 2025 Lawson 24 ¥1,230 ¥8,270",
            ]
        ),
    )
    assert [(row["description"], row["amountIn"], row["amountOut"], row["balance"]) for row in rows] == [
        ("Top-Up by *1234", 10000.0, None, 10000.0),
        ("7-Eleven", None, 500.0, 9500.0),
        ("Lawson 24", None, 1230.0, 8270.0),
    ]
    assert all(row["currency"] == "JPY" for row in rows)


def test_pdf_thousands_separator_with_decimals(monkeypatch):
    rows = _parse_pdf(
        monkeypatch,
        "\n".join(_header() + ["1 Jan 2025 Top-Up by *1234 S$1,234.56 S$12,345.67"]),
    )
    assert rows[0]["amountIn"] == 1234.56
    assert rows[0]["balance"] == 12345.67


def test_split_trailing_money_ignores_bare_integers_for_two_decimal_currency():
    description, tokens = parser._split_trailing_money("Gate 7 S$5.00", "SGD")
    assert description == "Gate 7"
    assert [token["magnitude"] for token in tokens] == [5.0]
    description, tokens = parser._split_trailing_money("Ramen 1500 9500", "JPY")
    assert description == "Ramen"
    assert [token["magnitude"] for token in tokens] == [1500.0, 9500.0]


def test_unparseable_transaction_line_becomes_warning_not_silent(monkeypatch):
    rows = _parse_pdf(
        monkeypatch,
        "\n".join(
            _header()
            + [
                "1 Jan 2025 Cafe S$5.00 S$95.00",
                "2 Jan 2025 Something odd with no amount",
                "Fee: S$9.99",
                "3 Jan 2025 Bakery S$4.00 S$91.00",
            ]
        ),
    )
    assert [row["description"] for row in rows] == ["Cafe", "Bakery"]
    # The detail line under the broken row must not be glued onto "Cafe".
    assert "feeAmount" not in rows[0]["metadata"]
    warnings = [w for row in rows for w in row["metadata"].get("parseWarnings", [])]
    assert len(warnings) == 1
    assert warnings[0]["type"] == "unparsed_line"
    assert warnings[0]["line"] == "2 Jan 2025 Something odd with no amount"


# --- Bug 5: FX rate in any home currency -------------------------------------


def test_fx_rate_legacy_sgd_format(monkeypatch):
    rows = _parse_pdf(
        monkeypatch,
        "\n".join(
            _header()
            + [
                "1 Jan 2025 Top-Up by *1234 S$100.00 S$100.00",
                "2 Jan 2025 Ichiran S$10.00 S$90.00",
                "Revolut Rate S$1.00 = 110.52 JPY 1,105 JPY",
            ]
        ),
    )
    metadata = rows[1]["metadata"]
    assert metadata["fxRate"] == 110.52
    assert metadata["fxBaseCurrency"] == "SGD"
    assert metadata["fxQuoteCurrency"] == "JPY"
    assert metadata["merchantCurrency"] == "JPY"
    assert metadata["foreignAmount"] == 1105.0


def test_fx_rate_other_home_currency_and_symbols(monkeypatch):
    rows = _parse_pdf(
        monkeypatch,
        "\n".join(
            _header(currency="EUR")
            + [
                "1 Jan 2025 Top-Up by *1234 €100.00 €100.00",
                "2 Jan 2025 Sushi Bar €10.00 €90.00",
                "Revolut Rate €1.00 = ¥160.25 (ECB rate* €1.00 = ¥161.00) ¥1,602",
                "3 Jan 2025 Pub €5.00 €85.00",
                "Revolut Rate €1.00 = 0.8600 GBP",
            ]
        ),
    )
    sushi = rows[1]["metadata"]
    assert sushi["fxRate"] == 160.25
    assert sushi["fxBaseCurrency"] == "EUR"
    assert sushi["fxQuoteCurrency"] == "JPY"
    assert sushi["foreignAmount"] == 1602.0

    pub = rows[2]["metadata"]
    assert pub["fxRate"] == 0.86
    assert pub["fxBaseCurrency"] == "EUR"
    assert pub["fxQuoteCurrency"] == "GBP"
    # A rate-only line must not be mistaken for the foreign amount.
    assert "foreignAmount" not in pub


def test_conversion_legs_follow_direction(monkeypatch):
    rows = _parse_pdf(
        monkeypatch,
        "\n".join(
            _header()
            + [
                "1 Jan 2025 Top-Up by *1234 S$200.00 S$200.00",
                "2 Jan 2025 Exchanged to JPY S$100.00 S$100.00",
                "Revolut Rate S$1.00 = 110.00 JPY 11,000 JPY",
            ]
        ),
    )
    metadata = rows[1]["metadata"]
    assert rows[1]["amountOut"] == 100.00
    assert (metadata["fromAmount"], metadata["fromCurrency"]) == (100.00, "SGD")
    assert (metadata["toAmount"], metadata["toCurrency"]) == (11000.0, "JPY")


# --- Bug 6: PDF direction + PDF/CSV merge ------------------------------------


def test_pdf_direction_uses_running_balance(monkeypatch):
    rows = _parse_pdf(
        monkeypatch,
        "\n".join(
            _header()
            + [
                "1 Jan 2025 Top-Up by *1234 S$100.00 S$100.00",
                "2 Jan 2025 Merchant credit S$10.00 S$110.00",
                "3 Jan 2025 Shop S$5.00 S$105.00",
            ]
        ),
    )
    credit = rows[1]
    assert credit["amountIn"] == 10.00 and credit["amountOut"] is None
    assert credit["metadata"]["directionSource"] == "balance"
    assert rows[2]["amountOut"] == 5.00


def test_pdf_direction_handles_reverse_chronological_listing(monkeypatch):
    rows = _parse_pdf(
        monkeypatch,
        "\n".join(
            _header()
            + [
                "3 Jan 2025 Shop S$5.00 S$105.00",
                "2 Jan 2025 Merchant credit S$10.00 S$110.00",
                "1 Jan 2025 Top-Up by *1234 S$100.00 S$100.00",
            ]
        ),
    )
    rows = _by_description(rows)
    assert rows["Merchant credit"]["amountIn"] == 10.00
    assert rows["Shop"]["amountOut"] == 5.00


def test_merge_uses_csv_direction_and_does_not_duplicate(monkeypatch):
    # Single PDF row with no previous balance -> keyword guess "out", which is wrong.
    _use_pdf_text(
        monkeypatch,
        "\n".join(
            _header()
            + [
                "2 Jan 2025 Amazon Marketplace S$12.00 S$112.00",
                "Revolut Rate S$1.00 = 0.7400 USD 8.88 USD",
                "Reference: order 42",
            ]
        ),
    )
    rows = parser.parse_with_supplemental(
        b"%PDF-1.4 fake",
        _csv(
            "CARD_REFUND,Current,2025-01-02 09:00:00,2025-01-02 09:00:05,Amazon,12.00,0.00,SGD,COMPLETED,112.00",
        ),
    )
    assert len(rows) == 1
    row = rows[0]
    assert row["amountIn"] == 12.00 and row["amountOut"] is None
    assert row["metadata"]["source"] == "pdf+csv"
    assert row["metadata"]["transactionType"] == "refund"
    assert row["metadata"]["fxRate"] == 0.74
    assert row["metadata"]["fxQuoteCurrency"] == "USD"
    assert row["metadata"]["reference"] == "order 42"


def test_merge_keeps_csv_only_rows_and_flags_unmatched_pdf_rows(monkeypatch):
    _use_pdf_text(
        monkeypatch,
        "\n".join(
            _header()
            + [
                "1 Jan 2025 Cafe S$5.00 S$95.00",
                "2 Jan 2025 Mystery Vendor S$7.00 S$88.00",
                "20 Jan 2025 Late Dinner S$30.00 S$58.00",
            ]
        ),
    )
    rows = parser.parse_with_supplemental(
        b"%PDF-1.4 fake",
        _csv(
            "CARD_PAYMENT,Current,2025-01-01 10:00:00,2025-01-01 10:00:01,Cafe,-5.00,0.00,SGD,COMPLETED,95.00",
            "CARD_PAYMENT,Current,2025-01-03 10:00:00,2025-01-03 10:00:01,Bookshop,-15.00,0.00,SGD,COMPLETED,73.00",
        ),
    )
    rows = _by_description(rows)
    assert set(rows) == {"Cafe", "Mystery Vendor", "Late Dinner", "Bookshop"}
    assert rows["Cafe"]["metadata"]["source"] == "pdf+csv"
    assert rows["Bookshop"]["metadata"]["mergeStatus"] == "csv_only"
    # Inside the CSV's date range but missing from it -> keep, but ask for review.
    assert rows["Mystery Vendor"]["metadata"]["mergeStatus"] == "pdf_only"
    assert "pdf_row_not_in_csv" in rows["Mystery Vendor"]["metadata"]["reviewReasons"]
    # Outside the CSV's date range -> PDF is the only source; no review needed.
    assert rows["Late Dinner"]["metadata"]["mergeStatus"] == "pdf_only"
    assert not rows["Late Dinner"]["metadata"].get("needsReview")


def test_merge_drops_pdf_row_matching_reverted_csv_row(monkeypatch):
    _use_pdf_text(
        monkeypatch,
        "\n".join(
            _header()
            + [
                "1 Jan 2025 Cafe S$5.00 S$95.00",
                "2 Jan 2025 Hotel S$80.00 S$15.00",
            ]
        ),
    )
    rows = parser.parse_with_supplemental(
        b"%PDF-1.4 fake",
        _csv(
            "CARD_PAYMENT,Current,2025-01-01 10:00:00,2025-01-01 10:00:01,Cafe,-5.00,0.00,SGD,COMPLETED,95.00",
            "CARD_PAYMENT,Current,2025-01-02 10:00:00,,Hotel,-80.00,0.00,SGD,REVERTED,95.00",
        ),
    )
    assert [row["description"] for row in rows] == ["Cafe"]
    assert rows[0]["metadata"]["parseWarnings"][0]["state"] == "REVERTED"


def test_merge_conversion_legs_use_csv_direction(monkeypatch):
    _use_pdf_text(
        monkeypatch,
        "\n".join(
            _header()
            + [
                "2 Jan 2025 Exchanged from JPY S$50.00 S$150.00",
                "Revolut Rate S$1.00 = 110.00 JPY 5,500 JPY",
            ]
        ),
    )
    rows = parser.parse_with_supplemental(
        b"%PDF-1.4 fake",
        _csv(
            "EXCHANGE,Current,2025-01-02 10:00:00,2025-01-02 10:00:01,Exchanged from JPY,50.00,0.00,SGD,COMPLETED,150.00",
        ),
    )
    metadata = rows[0]["metadata"]
    assert rows[0]["amountIn"] == 50.00
    assert (metadata["fromAmount"], metadata["fromCurrency"]) == (5500.0, "JPY")
    assert (metadata["toAmount"], metadata["toCurrency"]) == (50.00, "SGD")


def test_every_row_has_exactly_one_positive_amount(monkeypatch):
    rows = _parse_pdf(
        monkeypatch,
        "\n".join(
            _header()
            + [
                "1 Jan 2025 Top-Up by *1234 S$100.00 S$99.00",
                "Fee: S$1.00",
                "2 Jan 2025 Transfer from JANE LIM S$20.00 S$119.00",
                "3 Jan 2025 Shop S$5.00 S$114.00",
            ]
        ),
    )
    for row in rows:
        amounts = [value for value in (row["amountIn"], row["amountOut"]) if value]
        assert len(amounts) == 1, row
