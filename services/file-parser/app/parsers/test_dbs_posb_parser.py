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
        {"withdrawal_x": 338, "deposit_x": 430, "balance_x": 493},
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
