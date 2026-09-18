from . import csv_parser
from . import dbs_paylah_parser
from . import dbs_paylah_new_parser
from . import dbs_posb_legacy_parser
from . import dbs_posb_parser
from . import ocbc_frank_parser
from . import revolut_statement_parser
from . import youtrip_statement_parser

# Map parser IDs to their respective modules
PARSER_MAP = {
    "generic_csv": csv_parser.parse,
    "dbs_paylah_statement": dbs_paylah_parser.parse,
    "dbs_paylah_statement_new": dbs_paylah_new_parser.parse,
    "dbs_posb_consolidated": dbs_posb_parser.parse,
    "dbs_posb_consolidated_legacy": dbs_posb_legacy_parser.parse,
    "ocbc_frank_statement": ocbc_frank_parser.parse,
    "revolut_statement": revolut_statement_parser.parse,
    "youtrip_statement": youtrip_statement_parser.parse,
}

__all__ = [
    "PARSER_MAP",
    "csv_parser",
    "dbs_paylah_parser",
    "dbs_paylah_new_parser",
    "dbs_posb_legacy_parser",
    "dbs_posb_parser",
    "ocbc_frank_parser",
    "revolut_statement_parser",
    "youtrip_statement_parser",
]
