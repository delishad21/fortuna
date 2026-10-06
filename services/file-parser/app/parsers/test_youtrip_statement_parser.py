from app.parsers import youtrip_statement_parser as parser


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


def test_parse_money_preserves_leading_negative_sign():
    assert parser._parse_money("-$12.34") == -12.34


def test_parse_money_preserves_parenthetical_negative_notation():
    assert parser._parse_money("($12.34)") == -12.34


def test_known_incoming_markers_are_inflow(monkeypatch):
    rows = _parse_text(
        monkeypatch,
        "\n".join(
            [
                "My SGD Statement",
                "Transactions",
                "1 Jan 2024 Refund from merchant $12.34 $100.00",
                "2 Jan 2024 Top up $20.00 $120.00",
                "3 Jan 2024 Transfer in from Jane $30.00 $150.00",
            ]
        ),
    )

    assert [row["amountIn"] for row in rows] == [12.34, 20.00, 30.00]
    assert [row["amountOut"] for row in rows] == [None, None, None]
    # No holder name in this header: keep the old topup mapping but flag it.
    transfer = rows[2]["metadata"]
    assert transfer["transactionType"] == "topup"
    assert transfer["needsReview"] is True
    assert transfer["reviewReasons"] == ["account_holder_unknown"]


def test_normal_card_payment_is_outflow(monkeypatch):
    rows = _parse_text(
        monkeypatch,
        "\n".join(
            [
                "My SGD Statement",
                "Transactions",
                "1 Jan 2024 Grocery store $12.34 $100.00",
            ]
        ),
    )

    assert rows[0]["amountIn"] is None
    assert rows[0]["amountOut"] == 12.34


def test_signed_negative_amount_is_outflow_for_ambiguous_description(monkeypatch):
    rows = _parse_text(
        monkeypatch,
        "\n".join(
            [
                "My SGD Statement",
                "Transactions",
                "1 Jan 2024 Account adjustment -$12.34 $100.00",
            ]
        ),
    )

    assert rows[0]["amountIn"] is None
    assert rows[0]["amountOut"] == 12.34


def test_signed_positive_amount_with_plus_marker_is_inflow(monkeypatch):
    rows = _parse_text(
        monkeypatch,
        "\n".join(
            [
                "My SGD Statement",
                "Transactions",
                "1 Jan 2024 Account adjustment +$12.34 $100.00",
            ]
        ),
    )

    assert rows[0]["amountIn"] == 12.34
    assert rows[0]["amountOut"] is None


def test_conversion_metadata_parsing_is_preserved(monkeypatch):
    rows = _parse_text(
        monkeypatch,
        "\n".join(
            [
                "My SGD Statement",
                "Transactions",
                "1 Jan 2024 SmartExchange $12.34 $100.00",
                "$12.34 SGD to $9.10 USD",
                "FX rate: $1 SGD = $0.737 USD",
            ]
        ),
    )

    metadata = rows[0]["metadata"]
    assert metadata["fromAmount"] == 12.34
    assert metadata["fromCurrency"] == "SGD"
    assert metadata["toAmount"] == 9.10
    assert metadata["toCurrency"] == "USD"
    assert metadata["fxBaseCurrency"] == "SGD"
    assert metadata["fxRate"] == 0.737
    assert metadata["fxQuoteCurrency"] == "USD"


def _statement_with_holder(*rows):
    return "\n".join(
        [
            "JOHN TAN",
            "Y-1234567",
            "My SGD Statement",
            "Transactions",
            *rows,
        ]
    )


def test_transfer_in_from_other_person_is_incoming_transfer(monkeypatch):
    rows = _parse_text(
        monkeypatch,
        _statement_with_holder(
            "1 Jan 2024 Top up $50.00 $50.00",
            "2 Jan 2024 Transfer in from Jane Lim $30.00 $80.00",
            "3 Jan 2024 Transfer in from JOHN TAN $10.00 $90.00",
        ),
    )

    assert rows[0]["metadata"]["transactionType"] == "topup"

    friend = rows[1]
    assert friend["amountIn"] == 30.00 and friend["amountOut"] is None
    assert friend["metadata"]["transactionType"] == "transfer"
    assert friend["metadata"]["transferKind"] == "third_party"
    assert friend["metadata"]["counterpartyName"] == "Jane Lim"
    assert friend["metadata"]["accountHolderName"] == "JOHN TAN"
    assert not friend["metadata"].get("needsReview")

    own = rows[2]["metadata"]
    assert own["transactionType"] == "topup"
    assert own["transferKind"] == "own_account"


def test_transfer_out_is_outgoing_transfer(monkeypatch):
    rows = _parse_text(
        monkeypatch,
        _statement_with_holder("1 Jan 2024 Transfer out to Jane Lim -$15.00 $85.00"),
    )
    assert rows[0]["amountOut"] == 15.00
    assert rows[0]["metadata"]["transactionType"] == "transfer"


def test_incoming_fee_is_netted_not_emitted_as_amount_out(monkeypatch):
    rows = _parse_text(
        monkeypatch,
        _statement_with_holder(
            "1 Jan 2024 Top up $100.00 $100.00",
            "Fee: $1.50",
        ),
    )

    row = rows[0]
    assert row["amountIn"] == 100.00
    assert row["amountOut"] is None
    assert row["metadata"]["feeAmount"] == 1.50
    assert row["metadata"]["feeHandling"] == "netted"
    assert row["metadata"]["transactionType"] == "topup"


def test_incoming_fee_uses_balance_when_displayed_amount_is_gross(monkeypatch):
    rows = _parse_text(
        monkeypatch,
        _statement_with_holder(
            "1 Jan 2024 Top up $50.00 $50.00",
            "2 Jan 2024 Top up $100.00 $148.50",
            "Fee: $1.50",
        ),
    )

    # Balance moved by 98.50, so the displayed 100.00 included the fee.
    assert rows[1]["amountIn"] == 98.50
    assert rows[1]["amountOut"] is None


def test_outgoing_fee_stays_on_the_same_row(monkeypatch):
    rows = _parse_text(
        monkeypatch,
        _statement_with_holder(
            "1 Jan 2024 ATM withdrawal -$20.00 $80.00",
            "Fee: $2.00",
        ),
    )
    assert rows[0]["amountOut"] == 22.00
    assert rows[0]["amountIn"] is None


def test_every_row_has_exactly_one_positive_amount(monkeypatch):
    rows = _parse_text(
        monkeypatch,
        _statement_with_holder(
            "1 Jan 2024 Top up $100.00 $100.00",
            "Fee: $1.00",
            "2 Jan 2024 Refund from merchant $12.34 $112.34",
            "Fee: $0.34",
            "3 Jan 2024 Grocery store -$10.00 $102.00",
            "Fee: $0.34",
        ),
    )
    for row in rows:
        amounts = [value for value in (row["amountIn"], row["amountOut"]) if value]
        assert len(amounts) == 1, row
