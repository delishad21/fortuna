import pytest

from app.parsers import PARSER_MAP
from app.parsers import mari_credit_card_parser as parser


class _FakePage:
    def __init__(self, text):
        self._text = text

    def extract_text(self):
        return self._text


class _FakePdf:
    def __init__(self, pages):
        self.pages = [_FakePage(text) for text in pages]

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False


def _parse_pages(monkeypatch, pages):
    monkeypatch.setattr(parser.pdfplumber, "open", lambda _: _FakePdf(pages))
    return parser.parse(b"fake pdf bytes")


def _header(statement_date):
    return f"MARI CREDIT CARD STATEMENT\nS/N S04-000000TESTFIXT\n{statement_date}\n"


def _summary_page(statement_date, values, cashback_this_month="3.01"):
    return _header(statement_date) + "\n".join([
        "ACCOUNT: 532392****2124",
        "REWARD DETAILS",
        "CUMULATIVE CASHBACK EARNED TO DATE (SGD) TOTAL CASHBACK EARNED THIS STATEMENT MONTH (SGD)",
        f"40.00 {cashback_this_month}",
        "STATEMENT SUMMARY",
        "PREVIOUS REPAYMENT/ WAIVER/ PURCHASE LOANS CASHBACK BANK SPLIT BILL/ OTHERS",
        "OUTSTANDING CONVERSION REFUND CHARGE SPLIT PAYMENT",
        "(A) (B) (C) (D) (E) (F) (G) (H) (I)",
        values,
        "CURRENT OUTSTANDING (A-B-C+D+E-F+G+H+I) 0.00",
        "page 1 of 3",
    ])


# The layout of the October 2026 statement (repayment, purchases over a page
# break, then the previous month's cashback credit), with made-up rows.
OCTOBER = [
    _summary_page("21 OCT 2026", "1,000.00 1,000.00 0.00 1,312.50 0.00 12.34 0.00 0.00 0.00"),
    _header("21 OCT 2026") + "\n".join([
        "TRANSACTION DETAILS",
        "POSTED DATE TRANSACTION DATE DESCRIPTION AMOUNT (SGD)",
        "Repayment/Conversion",
        "ALEX TAN",
        "30 SEP 30 SEP +1,000.00",
        "Repayment",
        "Purchase",
        "CORNER BAKERY",
        "06 OCT 04 OCT -12.50",
        "Card Payment",
        "page 2 of 3",
    ]),
    _header("21 OCT 2026") + "\n".join([
        "POSTED DATE TRANSACTION DATE DESCRIPTION AMOUNT (SGD)",
        "INSURER PTE LTD",
        "29 SEP 27 SEP -1,300.00",
        "Card Payment",
        "Cashback",
        "Cashback Credit",
        "21 SEP 21 SEP +12.34",
        "Cashback",
        "General",
        "This statement services as TAX INVOICE if GST is charged.",
        "page 3 of 3",
    ]),
]


def test_parser_is_registered_as_built_in():
    assert PARSER_MAP["mari_credit_card_pdf"] is parser.parse


def test_keeps_repayment_and_cashback_credits(monkeypatch):
    rows = _parse_pages(monkeypatch, OCTOBER)

    assert [(r["date"], r["description"], r["amountIn"], r["amountOut"]) for r in rows] == [
        ("2026-09-30", "Repayment - ALEX TAN", 1000.00, None),
        ("2026-10-04", "CORNER BAKERY", None, 12.50),
        ("2026-09-27", "INSURER PTE LTD", None, 1300.00),
        ("2026-09-21", "Cashback Credit", 12.34, None),
    ]
    assert [r["metadata"]["entryType"] for r in rows] == [
        "repayment", "card_payment", "card_payment", "cashback",
    ]
    assert rows[1]["metadata"]["postedDate"] == "2026-10-06"
    assert all(r["accountIdentifier"] == "532392****2124" for r in rows)
    assert all(r["currency"] == "SGD" for r in rows)
    # The rows match the statement summary, so nothing is flagged.
    assert all("parseWarning" not in r["metadata"] for r in rows)


def test_cashback_earned_this_month_is_not_a_row(monkeypatch):
    rows = _parse_pages(monkeypatch, OCTOBER)

    # This month's 3.01 is credited on the next statement, as a Cashback Credit row.
    assert all(r["amountIn"] != 3.01 for r in rows)
    assert not any("earned" in r["description"].lower() for r in rows)


def test_rows_that_miss_the_summary_totals_are_flagged(monkeypatch):
    pages = list(OCTOBER)
    pages[2] = pages[2].replace("Cashback Credit\n21 SEP 21 SEP +12.34\nCashback\n", "")
    rows = _parse_pages(monkeypatch, pages)

    assert len(rows) == 3
    warning = rows[0]["metadata"]["parseWarning"]
    assert "1,000.00 in" in warning and "1,012.34 in" in warning
    assert all(r["metadata"]["parseWarning"] == warning for r in rows)


def test_overseas_flag_and_rows_from_last_year(monkeypatch):
    rows = _parse_pages(monkeypatch, [
        _summary_page("21 JAN 2027", "0.00 0.00 0.00 56.11 0.00 0.00 0.00 0.00 0.00"),
        _header("21 JAN 2027") + "\n".join([
            "TRANSACTION DETAILS",
            "Purchase",
            "WWW.SHOP.S*",
            "02 JAN 31 DEC OD -56.11",
            "Card Payment",
        ]),
    ])

    assert rows[0]["date"] == "2026-12-31"
    assert rows[0]["metadata"]["postedDate"] == "2027-01-02"
    assert rows[0]["amountOut"] == 56.11


def test_statement_without_a_date_is_rejected(monkeypatch):
    with pytest.raises(ValueError, match="statement date"):
        _parse_pages(monkeypatch, ["MARI CREDIT CARD STATEMENT\nACCOUNT: 532392****2124"])
