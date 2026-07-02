from app.parsers import dbs_paylah_parser as parser


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


def _parse_text(monkeypatch, text):
    monkeypatch.setattr(parser.pdfplumber, "open", lambda _: _FakePdf(text))
    return parser.parse(b"fake pdf bytes")


def test_parse_amounts_with_thousands_separator(monkeypatch):
    rows = _parse_text(
        monkeypatch,
        "\n".join(
            [
                "22 Jan 2025 6596317826 8888880012044058",
                "NEW TRANSACTIONS JOHAN SOO",
                "08 Jan TOP UP WALLET FROM MY ACCOUNT 1,094.70 CR",
                "08 Jan PAYNOW SCOOT PTE.... F84R2M 1,094.70 DB",
                "Total : 0.00",
            ]
        ),
    )

    assert len(rows) == 2
    assert rows[0]["date"] == "2025-01-08"
    assert rows[0]["amountIn"] == 1094.70
    assert rows[0]["amountOut"] is None
    assert rows[1]["amountIn"] is None
    assert rows[1]["amountOut"] == 1094.70
