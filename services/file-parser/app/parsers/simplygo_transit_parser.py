"""SimplyGo monthly transit statements.

Each journey is a heading line with its date, route and charge, the weekday
under the date, then one line per leg with its times, mode, route and fare:

    31 Oct 2026 Paya Lebar CCL - Simei $ 1.82
    (Sat)
    07:55 PM - 08:13 PM Train Paya Lebar CCL - Simei $ 1.82

A long leg wraps over two or three lines, and the fare can land on any of
them (or the weekday can share a line with the wrapped text), e.g.

    08:02 PM - 08:31 PM Bus 9 Opp Blk 233 -
    (Sat) Bedok Int $ 0.99

so a leg is everything from its start time to the next leg or journey, and its
fare is the "$" amount found in it.

Each journey becomes one row. Its legs' fares must add up to the journey's
charge, and the journeys to the statement's total where it prints one; a
mismatch is flagged as a parse warning (on the journey, or on every row for the
total).
"""

import io
import re
from datetime import datetime
from decimal import Decimal

import pdfplumber

MONEY = r"\$\s*([\d,]+\.\d{2})"
JOURNEY = re.compile(r"^(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})\s+(.+?)\s+" + MONEY + r"$")
LEG_START = re.compile(r"^\d{1,2}:\d{2}\s*[AP]M\b", re.I)
WEEKDAY = re.compile(r"^\((Mon|Tue|Wed|Thu|Fri|Sat|Sun)\)\s*", re.I)
FARE = re.compile(MONEY)
COLUMN_HEADINGS = re.compile(r"^Date\s+Journey\s+Charges$", re.I)
TOTAL = re.compile(r"^Total(?:\s+[A-Za-z]+)*\s+" + MONEY + r"$", re.I)
# Page furniture that can sit between a page's last leg and the next journey.
FURNITURE = re.compile(
    r"^(Date\s+Journey\s+Charges|STATEMENT GENERATED ON|Page\s+\d+(\s+of\s+\d+)?"
    r"|\d{1,2}\s+[A-Za-z]{3}\s+\d{4}(\s+-\s+\d{1,2}\s+[A-Za-z]{3}\s+\d{4})?"
    r"|[A-Za-z]+\s+\d{4}\s+Transit Statement)$",
    re.I,
)
ACCOUNT = "SimplyGo"


def _money(text):
    return Decimal(text.replace(",", ""))


def _leg(parts):
    text = " ".join(parts)
    fares = FARE.findall(text)
    detail = " ".join(FARE.sub(" ", text).split())
    fare = _money(fares[-1]) if fares else None
    return {"detail": detail, "fare": fare}


def parse(content):
    journeys = []
    totals = []
    current = None
    leg_parts = None

    def end_leg():
        nonlocal leg_parts
        if current is not None and leg_parts:
            current["legs"].append(_leg(leg_parts))
        leg_parts = None

    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            # A leg doesn't run over a page break, and what's above the column
            # headings is the page's letterhead (name, card), not a leg.
            end_leg()
            lines = [" ".join(raw.split()) for raw in (page.extract_text() or "").splitlines()]
            heading = next((i for i, line in enumerate(lines) if COLUMN_HEADINGS.match(line)), -1)
            for line in lines[heading + 1:]:
                if not line:
                    continue
                total = TOTAL.match(line)
                if total:
                    end_leg()
                    totals.append(_money(total.group(1)))
                    current = None
                    continue
                journey = JOURNEY.match(line)
                if journey:
                    try:
                        journey_date = datetime.strptime(journey.group(1), "%d %b %Y").date()
                    except ValueError:
                        journey = None
                if journey:
                    end_leg()
                    current = {
                        "date": journey_date.isoformat(),
                        "route": journey.group(2).strip(),
                        "amount": _money(journey.group(3)),
                        "legs": [],
                        "sourcePage": page_number,
                    }
                    journeys.append(current)
                    continue
                if current is None or FURNITURE.match(line):
                    continue
                line = WEEKDAY.sub("", line)
                if not line:
                    continue
                if LEG_START.match(line):
                    # "07:55 PM -" wrapped before its end time is still the same leg.
                    if leg_parts and not FARE.search(" ".join(leg_parts)) and leg_parts[-1].endswith("-"):
                        leg_parts.append(line)
                    else:
                        end_leg()
                        leg_parts = [line]
                elif leg_parts is not None:
                    leg_parts.append(line)
                elif not current["legs"]:
                    # The journey's route wrapped onto the weekday line.
                    current["route"] = f"{current['route']} {line}"
    end_leg()

    if not journeys:
        raise ValueError("No SimplyGo journeys found")

    transactions = [_transaction(journey) for journey in journeys]
    warning = _total_warning(journeys, totals)
    if warning:
        for transaction in transactions:
            metadata = transaction["metadata"]
            metadata["parseWarning"] = " ".join(filter(None, [metadata.get("parseWarning"), warning]))
    return transactions


def _transaction(journey):
    legs = journey["legs"]
    metadata = {
        "route": journey["route"],
        "legs": [
            leg["detail"] + ("" if leg["fare"] is None else f"; ${leg['fare']:.2f}") for leg in legs
        ],
        "sourcePage": journey["sourcePage"],
        "statement": "SimplyGo Transit Statement",
    }
    fares = [leg["fare"] for leg in legs]
    if not legs:
        metadata["parseWarning"] = "This journey's legs weren't found on the statement."
    elif None not in fares and sum(fares) != journey["amount"]:
        metadata["parseWarning"] = (
            f"This journey's legs add up to ${sum(fares):.2f}, but its charge is "
            f"${journey['amount']:.2f}. A leg may be missing."
        )
    return {
        "date": journey["date"],
        "description": "SimplyGo: " + journey["route"],
        "amountIn": None,
        "amountOut": float(journey["amount"]),
        "currency": "SGD",
        "accountIdentifier": ACCOUNT,
        "metadata": metadata,
    }


def _total_warning(journeys, totals):
    if not totals:
        return None
    charged = sum(journey["amount"] for journey in journeys)
    if charged == totals[-1]:
        return None
    return (
        f"The journeys add up to ${charged:.2f}, but the statement's total is "
        f"${totals[-1]:.2f}. A journey may be missing."
    )
