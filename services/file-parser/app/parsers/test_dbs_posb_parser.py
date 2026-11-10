from app.parsers import dbs_posb_parser as parser


def _words(top, values):
    return [
        {
            "top": top,
            "x0": x0,
            "x1": x0 + len(text) * 5,
            "text": text,
            "upright": True,
        }
        for x0, text in values
    ]


class _FakePage:
    def __init__(self, lines):
        self._words = [word for top, values in lines for word in _words(top, values)]

    def extract_words(self):
        return self._words


def test_column_parser_tracks_account_switches_mid_page():
    header = [
        (45, "Date"),
        (113, "Description"),
        (338, "Withdrawal"),
        (430, "Deposit"),
        (493, "Balance"),
    ]
    page_one = _FakePage(
        [
            (10, [(45, "First"), (80, "Account"), (446, "Account"), (485, "No."), (502, "111-222222-3")]),
            (20, header),
            (30, [(113, "Balance"), (150, "Brought"), (188, "Forward"), (515, "100.00")]),
            (40, [(45, "01/07/2026"), (113, "Purchase"), (377, "10.00"), (515, "90.00")]),
            (50, [(113, "Total"), (140, "Balance"), (180, "Carried"), (220, "Forward"), (515, "90.00")]),
            (60, [(45, "Second"), (85, "Account"), (446, "Account"), (485, "No."), (502, "444-555555-6")]),
            (70, header),
            (80, [(113, "Balance"), (150, "Brought"), (188, "Forward"), (515, "0.00")]),
            (90, [(45, "02/07/2026"), (113, "Deposit"), (434, "20.00"), (515, "20.00")]),
            (100, [(113, "Balance"), (150, "Carried"), (188, "Forward"), (515, "20.00")]),
        ]
    )
    page_two = _FakePage(
        [
            (10, [(45, "Second"), (85, "Account"), (446, "Account"), (485, "No."), (502, "444-555555-6")]),
            (20, header),
            (30, [(113, "Balance"), (150, "Brought"), (188, "Forward"), (515, "20.00")]),
            (40, [(45, "03/07/2026"), (113, "Purchase"), (377, "5.00"), (515, "15.00")]),
            (50, [(113, "Balance"), (150, "Carried"), (188, "Forward"), (515, "15.00")]),
        ]
    )

    rows = parser._parse_with_columns(
        type("Pdf", (), {"pages": [page_one, page_two]})(),
        {"statementDate": "31 Jul 2026"},
    )

    assert [row["accountNumber"] for row in rows] == [
        "1112222223",
        "4445555556",
        "4445555556",
    ]
    assert rows[1]["amountIn"] == 20.00
    assert rows[2]["amountOut"] == 5.00
    assert rows[0]["metadata"]["accountIdentifier"] == "1112222223"
    assert rows[2]["metadata"]["accountIdentifier"] == "4445555556"


def _right(x1, text, width=5.0):
    """A right-aligned number: DBS lines amounts up on their right edge."""
    return {"x0": x1 - len(text) * width, "x1": x1, "text": text}


class _LayoutPage:
    """Words placed like the consolidated statement: labels from the left,
    amounts right-aligned to each column."""

    def __init__(self, lines):
        self._words = []
        for top, words in lines:
            for word in words:
                if isinstance(word, tuple):
                    x0, text = word
                    word = {"x0": x0, "x1": x0 + len(text) * 5.0, "text": text}
                self._words.append({**word, "top": top, "upright": True})

    def extract_words(self):
        return self._words


def _layout_header(shift=0.0):
    return [
        (45.4 + shift, "Date"),
        (113.1 + shift, "Description"),
        {"x0": 337.9 + shift, "x1": 385.9 + shift, "text": "Withdrawal"},
        {"x0": 388.4 + shift, "x1": 397.4 + shift, "text": "(-)"},
        {"x0": 429.7 + shift, "x1": 462.8 + shift, "text": "Deposit"},
        {"x0": 465.3 + shift, "x1": 476.5 + shift, "text": "(+)"},
        {"x0": 515.4 + shift, "x1": 549.9 + shift, "text": "Balance"},
    ]


def _layout_statement(page_two_shift=0.0, interest="0.93", closing="12,345.03"):
    withdrawal, deposit, balance = 394.9, 474.0, 547.8
    s = page_two_shift
    page_one = _LayoutPage(
        [
            (150, [(45.4, "Sample"), (90, "Savings"), (441.2, "Account"), (479.7, "No."), (496.7, "123-456789-0")]),
            (170, _layout_header()),
            (200, [(113.1, "Balance"), (150.1, "Brought"), (187.6, "Forward"), (485.7, "SGD"), _right(balance, "12,346.37")]),
            (220, [(45.4, "01/10/2026"), (113.1, "Advice"), (142.6, "Funds"), (170.1, "Transfer"), _right(withdrawal, "1.50"), _right(balance, "12,344.87")]),
            (230, [(113.1, "TOP-UP"), (149.6, "TO"), (164.6, "WALLET"), (205.1, ":")]),
            (240, [(113.1, "55550000")]),
            (250, [(113.1, "VALUE"), (145.1, "DATE"), (171.6, ":"), (176.6, "01/10/2026")]),
            (270, [(45.4, "02/10/2026"), (113.1, "Debit"), (136.6, "Card"), (158.6, "Transaction"), _right(deposit, "7.55"), _right(balance, "12,352.42")]),
            (280, [(113.1, "CASHBACK"), (170.0, "REFUND"), (210.0, "2.50")]),
            (300, [(113.1, "Balance"), (150.1, "Carried"), (184.1, "Forward"), (485.7, "SGD"), _right(balance, "12,352.42")]),
        ]
    )
    page_two = _LayoutPage(
        [
            (80, [(45.4 + s, "Sample"), (90 + s, "Savings"), (441.2 + s, "Account"), (479.7 + s, "No."), (496.7 + s, "123-456789-0")]),
            (100, _layout_header(s)),
            (130, [(113.1 + s, "Balance"), (150.1 + s, "Brought"), (187.6 + s, "Forward"), (485.7 + s, "SGD"), _right(balance + s, "12,352.42")]),
            (150, [(45.4 + s, "31/10/2026"), (113.1 + s, "Advice"), (142.6 + s, "Funds"), (170.1 + s, "Transfer"), _right(withdrawal + s, "8.32"), _right(balance + s, "12,344.10")]),
            (160, [(113.1 + s, "TOP-UP"), (149.6 + s, "TO"), (164.6 + s, "WALLET")]),
            (180, [(45.4 + s, "31/10/2026"), (113.1 + s, "Interest"), (155.0 + s, "Earned"), _right(deposit + s, interest), _right(balance + s, closing)]),
            (200, [(113.1 + s, "Total"), (137.1 + s, "Balance"), (174.1 + s, "Carried"), (208.1 + s, "Forward"), _right(withdrawal + s, "9.82"), _right(deposit + s, "8.48"), _right(balance + s, closing)]),
        ]
    )
    return type("Pdf", (), {"pages": [page_one, page_two]})()


def _amounts(rows):
    return [(row["amountOut"], row["amountIn"], row["balance"]) for row in rows]


def test_right_aligned_amounts_land_in_their_columns():
    pdf = _layout_statement()
    # The trap: a five-digit balance starts left of the 'Balance' label.
    assert _right(547.8, "12,345.03")["x0"] < 515.4

    rows = parser._parse_with_columns(pdf, {}, parser._find_column_positions(pdf))

    assert _amounts(rows) == [
        (1.50, None, 12344.87),
        (None, 7.55, 12352.42),
        (8.32, None, 12344.10),
        (None, 0.93, 12345.03),
    ]
    assert [row["description"] for row in rows] == [
        "Advice Funds Transfer TOP-UP TO WALLET : 55550000 VALUE DATE : 01/10/2026",
        "Debit Card Transaction CASHBACK REFUND 2.50",
        "Advice Funds Transfer TOP-UP TO WALLET",
        "Interest Earned",
    ]
    assert all("parseWarning" not in row["metadata"] for row in rows)
    assert all(row["accountIdentifier"] == "1234567890" for row in rows)


def test_header_is_read_again_on_each_page():
    pdf = _layout_statement(page_two_shift=-40)

    rows = parser._parse_with_columns(pdf, {}, parser._find_column_positions(pdf))

    assert _amounts(rows)[2:] == [(8.32, None, 12344.10), (None, 0.93, 12345.03)]
    assert all("parseWarning" not in row["metadata"] for row in rows)


def test_row_that_does_not_reconcile_is_kept_and_flagged():
    # The statement says 0.95 was earned but the balance only moved by 0.93.
    pdf = _layout_statement(interest="0.95")

    rows = parser._parse_with_columns(pdf, {}, parser._find_column_positions(pdf))

    assert len(rows) == 4
    assert rows[3]["amountIn"] == 0.95 and rows[3]["amountOut"] is None
    assert "12,344.10" in rows[3]["metadata"]["parseWarning"]
    assert "12,345.03" in rows[3]["metadata"]["parseWarning"]
    assert all("parseWarning" not in row["metadata"] for row in rows[:3])


def test_reconcile_moves_an_amount_read_into_the_wrong_column():
    pending = {"amountOut": None, "amountIn": 1.50, "balance": 98.50}
    assert parser._reconcile(pending, 100.00) == (1.50, None, None)


def test_reconcile_never_returns_both_amounts():
    # The old bug: the balance read as a deposit next to the real withdrawal.
    pending = {"amountOut": 1.50, "amountIn": 22455.54, "balance": 22455.54}
    assert parser._reconcile(pending, 22457.04) == (1.50, None, None)

    out, inn, warning = parser._reconcile(
        {"amountOut": 1.50, "amountIn": 3.00, "balance": 90.00}, 100.00
    )
    assert (out, inn) == (3.00, None)
    assert "doesn't reconcile" in warning

    out, inn, warning = parser._reconcile(
        {"amountOut": 1.50, "amountIn": 3.00, "balance": None}, None
    )
    assert (out, inn) == (1.50, None)
    assert warning


def test_reconcile_checks_to_the_cent():
    assert parser._reconcile({"amountOut": 0.1, "amountIn": None, "balance": 0.2}, 0.3)[2] is None
    assert parser._reconcile({"amountOut": 0.1, "amountIn": None, "balance": 0.21}, 0.3)[2]


def _kids_header(top):
    """The ePOSBkids header: 'Balance (SGD)', further left, with '(SGD)' set
    two points lower than the other labels."""
    return [
        (top, [
            (45.4, "Date"),
            (113.1, "Description"),
            {"x0": 337.9, "x1": 385.9, "text": "Withdrawal"},
            {"x0": 388.4, "x1": 397.4, "text": "(-)"},
            {"x0": 429.7, "x1": 462.8, "text": "Deposit"},
            {"x0": 465.3, "x1": 476.5, "text": "(+)"},
            {"x0": 493.1, "x1": 527.6, "text": "Balance"},
        ]),
        (top + 2, [{"x0": 530.1, "x1": 549.9, "text": "(SGD)"}]),
    ]


def test_each_table_uses_its_own_header():
    # A kids account with 'Balance (SGD)' first, then the Multiplier account
    # with plain 'Balance' further down the same page. Its five-digit balances
    # start left of the kids 'Balance' label too.
    kids_balance, balance = 550.3, 547.8
    page = _LayoutPage(
        [
            (150, [(45.4, "Kids"), (90, "Account"), (446.2, "Account"), (484.7, "No."), (501.7, "111-22222-3")]),
            *_kids_header(170),
            (200, [(113.1, "Balance"), (150.1, "Brought"), (187.6, "Forward"), _right(kids_balance, "5,000.00")]),
            (220, [(45.4, "01/07/2026"), (113.1, "Bus"), _right(394.9, "4.18"), _right(kids_balance, "4,995.82")]),
            (240, [(45.4, "02/07/2026"), (113.1, "Transfer"), (160, "out"), _right(394.9, "4,995.82"), _right(552.8, "0.00")]),
            (260, [(45.4, "31/07/2026"), (113.1, "Card"), (140, "fee"), _right(394.9, "0.80"), _right(552.8, "0.80-")]),
            (280, [(113.1, "Total"), (137.1, "Balance"), (174.1, "Carried"), (208.1, "Forward"), _right(552.8, "0.80-")]),
            (320, [(45.4, "Sample"), (90, "Savings"), (441.2, "Account"), (479.7, "No."), (496.7, "123-456789-0")]),
            (340, _layout_header()),
            (370, [(113.1, "Balance"), (150.1, "Brought"), (187.6, "Forward"), (485.7, "SGD"), _right(balance, "0.00")]),
            (390, [(45.4, "22/07/2026"), (113.1, "Incoming"), (160, "PayNow"), _right(474.0, "16,330.00"), _right(balance, "16,330.00")]),
            (400, [(113.1, "FROM"), (142.1, "SAMPLE")]),
            (420, [(45.4, "31/07/2026"), (113.1, "Interest"), (155.0, "Earned"), _right(474.0, "0.93"), _right(balance, "16,330.93")]),
            (440, [(113.1, "Balance"), (150.1, "Carried"), (184.1, "Forward"), (485.7, "SGD"), _right(balance, "16,330.93")]),
        ]
    )
    pdf = type("Pdf", (), {"pages": [page]})()

    rows = parser._parse_with_columns(pdf, {}, parser._find_column_positions(pdf))

    assert [(row["accountIdentifier"], *amounts) for row, amounts in zip(rows, _amounts(rows))] == [
        ("111222223", 4.18, None, 4995.82),
        ("111222223", 4995.82, None, 0.00),
        ("111222223", 0.80, None, -0.80),
        ("1234567890", None, 16330.00, 16330.00),
        ("1234567890", None, 0.93, 16330.93),
    ]
    assert rows[3]["description"] == "Incoming PayNow FROM SAMPLE"
    assert all("parseWarning" not in row["metadata"] for row in rows)


def test_kids_header_includes_sgd_in_the_balance_column():
    pdf = type("Pdf", (), {"pages": [_LayoutPage(_kids_header(170))]})()
    columns = parser._find_column_positions(pdf)
    assert columns["balance"] == {"left": 493.1, "right": 549.9}
    assert columns["deposit"]["right"] == 476.5


def test_statement_with_only_the_multiplier_account():
    # October: the kids account is closed, so the first and only header is
    # the Multiplier's plain 'Balance'.
    pdf = _layout_statement()
    columns = parser._find_column_positions(pdf)
    assert columns["balance"] == {"left": 515.4, "right": 549.9}

    rows = parser._parse_with_columns(pdf, {}, columns)

    assert all(row["amountIn"] is None or row["amountOut"] is None for row in rows)
    assert sum(row["amountOut"] or 0 for row in rows) == 9.82
    assert round(sum(row["amountIn"] or 0 for row in rows), 2) == 8.48
    assert rows[-1]["balance"] == 12345.03


def test_header_is_read_again_for_a_second_table_on_the_same_page():
    s = -40  # a second table laid out further left than the first
    page = _LayoutPage(
        [
            *_kids_header(170),
            (200, [(113.1, "Balance"), (150.1, "Brought"), (187.6, "Forward"), _right(550.3, "100.00")]),
            (220, [(45.4, "01/07/2026"), (113.1, "Bus"), _right(394.9, "4.18"), _right(550.3, "95.82")]),
            (240, [(113.1, "Balance"), (150.1, "Carried"), (184.1, "Forward"), _right(550.3, "95.82")]),
            (320, [(45.4, "Sample"), (90, "Savings"), (441.2, "Account"), (479.7, "No."), (496.7, "123-456789-0")]),
            (340, _layout_header(s)),
            (370, [(113.1 + s, "Balance"), (150.1 + s, "Brought"), (187.6 + s, "Forward"), _right(547.8 + s, "10,000.00")]),
            (390, [(45.4 + s, "02/07/2026"), (113.1 + s, "Interest"), _right(474.0 + s, "0.93"), _right(547.8 + s, "10,000.93")]),
            (410, [(113.1 + s, "Balance"), (150.1 + s, "Carried"), (184.1 + s, "Forward"), _right(547.8 + s, "10,000.93")]),
        ]
    )
    pdf = type("Pdf", (), {"pages": [page]})()

    rows = parser._parse_with_columns(pdf, {}, parser._find_column_positions(pdf))

    assert _amounts(rows) == [(4.18, None, 95.82), (None, 0.93, 10000.93)]
    assert all("parseWarning" not in row["metadata"] for row in rows)
