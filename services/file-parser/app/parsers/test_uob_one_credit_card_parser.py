import pytest

from app.parsers import PARSER_MAP, PARSER_VERSIONS
from app.parsers import uob_one_credit_card_parser as parser


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


SUMMARY_PAGE = "\n".join([
    "Statement Summary",
    "Statement Date 06 NOV 2026",
    "MR TEST PERSON Total Credit Limit SGD 6,000",
])


def _card_page(rows, previous="500.00", total="420.50"):
    return "\n".join([
        "UOB ONE CARD",
        "4265-8800-0000-4591 TEST PERSON",
        "Post Trans Description of Transaction Transaction Amount",
        "Date Date SGD",
        f"PREVIOUS BALANCE {previous}",
        *rows,
        "SUB TOTAL 420.50",
        f"TOTAL BALANCE FOR UOB ONE CARD {total}",
    ])


# The layout of the November 2026 statement (an AXS payment, purchases, a
# foreign purchase and three UOB credits), with made-up rows.
NOVEMBER_ROWS = [
    "08 OCT 07 OCT PAYMENT - AXS 500.00 CR",
    "Ref No. : 74541836281004567890123",
    "10 OCT 08 OCT SHOPEE SINGAPORE MP SINGAPORE 123.40",
    "Ref No. : 74541836281004567890124",
    "15 OCT 13 OCT NETFLIX.COM LOS GATOS 15.00",
    "USD 10.80",
    "20 OCT 18 OCT GRAB* A-8ABCDEF SINGAPORE 330.10",
    "05 NOV 05 NOV UOB ONE CASH REBATE 30.00 CR",
    "05 NOV 05 NOV UOB ONE ADDITIONAL REBATE 15.00 CR",
    "06 NOV 06 NOV UNI$ REDEMPTION - STATEMENT CREDIT 3.00 CR",
]


def test_registered_with_a_source_version():
    assert PARSER_MAP["uob_one_credit_card_pdf"] is parser.parse
    assert PARSER_VERSIONS["uob_one_credit_card_pdf"].startswith("builtin-")


def test_keeps_payments_and_credits_as_money_in(monkeypatch):
    rows = _parse_pages(monkeypatch, [SUMMARY_PAGE, _card_page(NOVEMBER_ROWS)])

    assert [(r["description"], r["amountIn"], r["amountOut"]) for r in rows] == [
        ("PAYMENT - AXS", 500.0, None),
        ("SHOPEE SINGAPORE MP SINGAPORE", None, 123.4),
        ("NETFLIX.COM LOS GATOS", None, 15.0),
        ("GRAB* A-8ABCDEF SINGAPORE", None, 330.1),
        ("UOB ONE CASH REBATE", 30.0, None),
        ("UOB ONE ADDITIONAL REBATE", 15.0, None),
        ("UNI$ REDEMPTION - STATEMENT CREDIT", 3.0, None),
    ]
    assert [r["metadata"]["entryType"] for r in rows] == [
        "payment", "charge", "charge", "charge", "rebate", "rebate", "redemption",
    ]
    assert {r["accountIdentifier"] for r in rows} == {"4265-****-****-4591"}
    assert rows[0]["date"] == "2026-10-07"
    assert rows[0]["metadata"]["postDate"] == "2026-10-08"
    assert rows[0]["metadata"]["statementDate"] == "2026-11-06"
    # 500.00 previous + 468.50 charges - 548.00 credits = 420.50.
    assert not any("parseWarning" in r["metadata"] for r in rows)


def test_flags_rows_that_do_not_match_the_balances(monkeypatch):
    # Without the AXS payment the rows no longer reach the total balance.
    rows = _parse_pages(monkeypatch, [SUMMARY_PAGE, _card_page(NOVEMBER_ROWS[1:])])

    assert len(rows) == 6
    warning = rows[0]["metadata"]["parseWarning"]
    assert "A row may be missing" in warning
    assert all(r["metadata"]["parseWarning"] == warning for r in rows)


def test_credit_balances_and_december_rows_on_a_january_statement(monkeypatch):
    pages = [
        SUMMARY_PAGE.replace("06 NOV 2026", "06 JAN 2027"),
        _card_page(
            [
                "30 DEC 28 DEC PAYMENT - AXS 100.00 CR",
                "03 JAN 02 JAN KOPITIAM SINGAPORE 4.50",
            ],
            previous="10.00 CR",
            total="105.50 CR",
        ),
    ]
    rows = _parse_pages(monkeypatch, pages)

    assert [r["date"] for r in rows] == ["2026-12-28", "2027-01-02"]
    # -10.00 previous + 4.50 - 100.00 = -105.50 (a credit balance).
    assert not any("parseWarning" in r["metadata"] for r in rows)


def test_missing_statement_date_is_an_error(monkeypatch):
    with pytest.raises(ValueError, match="statement date"):
        _parse_pages(monkeypatch, [_card_page(NOVEMBER_ROWS)])
