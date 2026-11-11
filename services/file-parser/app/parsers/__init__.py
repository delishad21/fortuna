import hashlib
from pathlib import Path

from . import csv_parser
from . import dbs_paylah_parser
from . import dbs_paylah_new_parser
from . import dbs_posb_legacy_parser
from . import dbs_posb_parser
from . import mari_credit_card_parser
from . import ocbc_frank_parser
from . import revolut_statement_parser
from . import simplygo_transit_parser
from . import uob_one_credit_card_parser
from . import youtrip_statement_parser

# Map parser IDs to their respective modules
PARSER_MAP = {
    "generic_csv": csv_parser.parse,
    "dbs_paylah_statement": dbs_paylah_parser.parse,
    "dbs_paylah_statement_new": dbs_paylah_new_parser.parse,
    "dbs_posb_consolidated": dbs_posb_parser.parse,
    "dbs_posb_consolidated_legacy": dbs_posb_legacy_parser.parse,
    "mari_credit_card_pdf": mari_credit_card_parser.parse,
    "ocbc_frank_statement": ocbc_frank_parser.parse,
    "revolut_statement": revolut_statement_parser.parse,
    "simplygo_transit_statement": simplygo_transit_parser.parse,
    "uob_one_credit_card_pdf": uob_one_credit_card_parser.parse,
    "youtrip_statement": youtrip_statement_parser.parse,
}


def _source_version(parse):
    source = Path(parse.__code__.co_filename).read_bytes()
    return "builtin-" + hashlib.sha256(source).hexdigest()[:12]


# Changes whenever a parser's source does, so a draft can tell it was staged by an older one.
PARSER_VERSIONS = {parser_id: _source_version(parse) for parser_id, parse in PARSER_MAP.items()}

__all__ = [
    "PARSER_MAP",
    "PARSER_VERSIONS",
    "csv_parser",
    "dbs_paylah_parser",
    "dbs_paylah_new_parser",
    "dbs_posb_legacy_parser",
    "dbs_posb_parser",
    "mari_credit_card_parser",
    "ocbc_frank_parser",
    "revolut_statement_parser",
    "simplygo_transit_parser",
    "uob_one_credit_card_parser",
    "youtrip_statement_parser",
]
