from app.parsers import dbs_paylah_new_parser as parser


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


def test_parse_current_layout_across_pages(monkeypatch):
    pages = [
        "\n".join(
            [
                "STATEMENT DATE MOBILE NUMBER WALLET ACCOUNT",
                "22 Jul 2026 6596317826 8888880012044058",
                "PayLah! Wallet 8888880012044058 0.00",
                "23 Jun TOP UP WALLET FROM MY ACCOUNT 1,094.70 CR",
                "REF NO:. TF716201782186757013",
            ]
        ),
        "\n".join(
            [
                "DATE DESCRIPTION AMOUNT",
                "01 Jul PAYNOW EXAMPLE 4.50 DB",
                "REF NO:. IPS123",
                "Total Balance Carried Forward: 0.00",
            ]
        ),
    ]
    monkeypatch.setattr(parser.pdfplumber, "open", lambda _: _FakePdf(pages))

    rows = parser.parse(b"fake pdf bytes")

    assert len(rows) == 2
    assert rows[0]["date"] == "2026-06-23"
    assert rows[0]["amountIn"] == 1094.70
    assert rows[1]["date"] == "2026-07-01"
    assert rows[1]["amountOut"] == 4.50
    assert rows[1]["accountIdentifier"] == "8888880012044058"
    assert rows[1]["metadata"]["parserId"] == "dbs_paylah_statement_new"
