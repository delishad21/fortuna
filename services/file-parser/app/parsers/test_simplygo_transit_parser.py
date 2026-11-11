import pytest

from app.parsers import PARSER_MAP, PARSER_VERSIONS
from app.parsers import simplygo_transit_parser as parser


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


HEADER = "\n".join([
    "STATEMENT GENERATED ON",
    "10 Nov 2026",
    "Test",
    "UOB ONE",
    "4265 88** **** 0000",
    "October 2026 Transit Statement",
    "01 Oct 2026 - 31 Oct 2026",
    "Date Journey Charges",
])

# The layout of the October 2026 statement, with made-up journeys: one-line
# legs, and legs wrapped in each of the ways the PDF wraps them.
PAGE_1 = HEADER + "\n" + "\n".join([
    "31 Oct 2026 Paya Lebar CCL - Simei $ 1.82",
    "(Sat)",
    "07:55 PM - 08:13 PM Train Paya Lebar CCL - Simei $ 1.82",
    # Fare on the wrapped line, which shares a line with the weekday.
    "30 Oct 2026 Opp Blk 233 - Bedok Int $ 0.99",
    "08:02 PM - 08:31 PM Bus 9 Opp Blk 233 -",
    "(Fri) Bedok Int $ 0.99",
    # Fare on the first line, the stop name finishing on the next.
    "29 Oct 2026 Tampines - Bedok Reservoir Rd Blk 101 $ 1.40",
    "(Thu)",
    "09:10 AM - 09:20 AM Train Tampines - Bedok $ 0.80",
    "09:24 AM - 09:31 AM Bus 222 Bedok Int - Bedok $ 0.60",
    "Reservoir Rd Blk 101",
    # The time range itself wraps.
    "28 Oct 2026 Simei - Changi Airport $ 1.19",
    "(Wed)",
    "06:01 AM -",
    "06:15 AM Train Simei - Changi Airport $ 1.19",
    "PAGE 1 OF 2",
])
PAGE_2 = "STATEMENT GENERATED ON\n10 Nov 2026\n" + "\n".join([
    # The journey's own route wraps onto the weekday line.
    "27 Oct 2026 Bedok Int - Changi Business Park Ave 1 Opp $ 1.09",
    "(Tue) Changi City Pt",
    "08:40 AM - 09:05 AM Bus 20 Bedok Int - Changi Business Park $ 1.09",
    "Ave 1 Opp Changi City Pt",
    # As on the October 2026 statement: the leg's route starts, with its fare,
    # on the line above its time line, which keeps the mode and the route's end.
    "26 Oct 2026 Simei - Bef Sample Ave 10 $ 1.61",
    "(Mon)",
    "07:16 AM - 07:44 AM Train Simei - Serangoon CCL $ 1.48",
    "Opp Sample Stn Exit F - Bef Sample Ave $ 0.13",
    "07:47 AM - 07:57 AM Bus 58 10",
    "Total Charges $ 8.10",
    "Page 2 of 2",
])


def test_registered_with_a_source_version():
    assert PARSER_MAP["simplygo_transit_statement"] is parser.parse
    assert PARSER_VERSIONS["simplygo_transit_statement"].startswith("builtin-")


def test_reads_wrapped_legs(monkeypatch):
    rows = _parse_pages(monkeypatch, [PAGE_1, PAGE_2])

    assert [(r["date"], r["description"], r["amountOut"]) for r in rows] == [
        ("2026-10-31", "SimplyGo: Paya Lebar CCL - Simei", 1.82),
        ("2026-10-30", "SimplyGo: Opp Blk 233 - Bedok Int", 0.99),
        ("2026-10-29", "SimplyGo: Tampines - Bedok Reservoir Rd Blk 101", 1.40),
        ("2026-10-28", "SimplyGo: Simei - Changi Airport", 1.19),
        ("2026-10-27", "SimplyGo: Bedok Int - Changi Business Park Ave 1 Opp Changi City Pt", 1.09),
        ("2026-10-26", "SimplyGo: Simei - Bef Sample Ave 10", 1.61),
    ]
    assert [r["metadata"]["legs"] for r in rows] == [
        ["07:55 PM - 08:13 PM Train Paya Lebar CCL - Simei; $1.82"],
        ["08:02 PM - 08:31 PM Bus 9 Opp Blk 233 - Bedok Int; $0.99"],
        [
            "09:10 AM - 09:20 AM Train Tampines - Bedok; $0.80",
            "09:24 AM - 09:31 AM Bus 222 Bedok Int - Bedok Reservoir Rd Blk 101; $0.60",
        ],
        ["06:01 AM - 06:15 AM Train Simei - Changi Airport; $1.19"],
        ["08:40 AM - 09:05 AM Bus 20 Bedok Int - Changi Business Park Ave 1 Opp Changi City Pt; $1.09"],
        [
            "07:16 AM - 07:44 AM Train Simei - Serangoon CCL; $1.48",
            "07:47 AM - 07:57 AM Bus 58 Opp Sample Stn Exit F - Bef Sample Ave 10; $0.13",
        ],
    ]
    assert [r["metadata"]["sourcePage"] for r in rows] == [1, 1, 1, 1, 2, 2]
    assert {r["accountIdentifier"] for r in rows} == {"SimplyGo"}
    assert not any("parseWarning" in r["metadata"] for r in rows)


def test_flags_legs_that_do_not_add_up(monkeypatch):
    page = PAGE_1.replace("09:24 AM - 09:31 AM Bus 222 Bedok Int - Bedok $ 0.60", "")
    rows = _parse_pages(monkeypatch, [page])

    assert "A leg may be missing" in rows[2]["metadata"]["parseWarning"]
    assert "parseWarning" not in rows[0]["metadata"]


def test_flags_journeys_that_do_not_reach_the_total(monkeypatch):
    rows = _parse_pages(monkeypatch, [PAGE_1, PAGE_2.replace("$ 8.10", "$ 9.10")])

    assert all("A journey may be missing" in r["metadata"]["parseWarning"] for r in rows)


def test_no_journeys_is_an_error(monkeypatch):
    with pytest.raises(ValueError, match="No SimplyGo journeys"):
        _parse_pages(monkeypatch, [HEADER])
