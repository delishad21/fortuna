import os
import hmac
from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.utils import secure_filename

from .parsers import PARSER_MAP, revolut_statement_parser
from .parsers.config_candidate import evaluate_candidate
from .parsers.config_candidate import parse_config_csv
from .fixture_inspector import inspect_fixture
from .runtime_registry import get_dynamic_parser, list_dynamic_parsers
from .sandbox_queue import SandboxExecutionError, submit_python_job
import json

app = Flask(__name__)

# CORS configuration
frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
CORS(app, origins=[frontend_url], supports_credentials=True)


def _internal_request_allowed():
    expected = os.getenv("INTERNAL_SERVICE_TOKEN", "")
    supplied = request.headers.get("X-Internal-Service-Token", "")
    return bool(expected and supplied and hmac.compare_digest(expected, supplied))


@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint"""
    return jsonify({
        "status": "ok",
        "service": "file-parser"
    })


@app.route("/parse", methods=["POST"])
def parse_file():
    """Parse uploaded file"""
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    supplemental_file = request.files.get("supplementalFile")
    parser_id = request.form.get("parserId")

    if not file or not file.filename:
        return jsonify({"error": "No file provided"}), 400

    if not parser_id:
        return jsonify({"error": "No parserId provided"}), 400

    # Get file extension
    filename = secure_filename(file.filename)

    # Read file content
    content = file.read()
    supplemental_content = None
    if supplemental_file and supplemental_file.filename:
        supplemental_content = supplemental_file.read()

    try:
        # Get the parser function from the map
        parser_func = PARSER_MAP.get(parser_id)
        parser_version = "builtin"
        if parser_id == "revolut_statement" and supplemental_content:
            transactions = revolut_statement_parser.parse_with_supplemental(
                content, supplemental_content
            )
        elif parser_func:
            # All parsers now use the same interface
            transactions = parser_func(content)
        else:
            dynamic = get_dynamic_parser(parser_id, request.headers)
            version = dynamic["activeVersion"]
            parser_version = f"dynamic-v{version['version']}"
            if version["parserType"] == "python":
                result = submit_python_job(
                    version["sourceCode"], content, version["specification"]
                )
                transactions = result["transactions"]
            elif version["parserType"] == "config":
                transactions = parse_config_csv(content, version["specification"])
            else:
                raise ValueError("Unsupported dynamic parser type")

        return jsonify({
            "success": True,
            "filename": filename,
            "parserId": parser_id,
            "transactions": transactions,
            "count": len(transactions),
            "parserVersion": parser_version,
        })
    except Exception as e:
        print(f"Parse error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Failed to parse file: {str(e)}"}), 500


@app.route("/parsers", methods=["GET"])
def get_parsers():
    """Get list of available parsers"""
    mode = (request.args.get("mode") or "bank").strip().lower()
    parser_items = [
        {
            "id": "generic_csv",
            "name": "Generic CSV",
            "fileType": "csv",
            "description": "Generic CSV parser with customizable column mapping",
            "mode": "bank",
        },
        {
            "id": "dbs_paylah_statement",
            "name": "DBS PayLah! Statement (June 2026 and earlier)",
            "fileType": "pdf",
            "description": "Parser for the legacy DBS PayLah! wallet statement layout",
            "mode": "bank",
        },
        {
            "id": "dbs_paylah_statement_new",
            "name": "DBS PayLah! Statement (July 2026 and later)",
            "fileType": "pdf",
            "description": "Parser for the current DBS PayLah! wallet statement layout",
            "mode": "bank",
        },
        {
            "id": "dbs_posb_consolidated",
            "name": "DBS/POSB Consolidated Statement",
            "fileType": "pdf",
            "description": "Parser for DBS/POSB monthly statements",
            "mode": "bank",
        },
        {
            "id": "dbs_posb_consolidated_legacy",
            "name": "DBS/POSB Consolidated Statement (Jan 2021 and earlier)",
            "fileType": "pdf",
            "description": "Parser for the legacy DBS/POSB consolidated statement layout",
            "mode": "bank",
        },
        {
            "id": "ocbc_frank_statement",
            "name": "OCBC FRANK Account Statement",
            "fileType": "pdf",
            "description": "Parser for OCBC FRANK account statements",
            "mode": "bank",
        },
        {
            "id": "revolut_statement",
            "name": "Revolut Statement",
            "fileType": "pdf/csv",
            "description": "Trip parser for Revolut statements (PDF, CSV, or merged PDF+CSV)",
            "mode": "trip",
        },
        {
            "id": "youtrip_statement",
            "name": "YouTrip Statement",
            "fileType": "pdf",
            "description": "Trip parser for YouTrip statements",
            "mode": "trip",
        },
    ]

    if mode in {"bank", "trip"}:
        parser_items = [item for item in parser_items if item["mode"] == mode]

    try:
        parser_items.extend(list_dynamic_parsers(mode, request.headers))
    except RuntimeError as error:
        app.logger.warning("Dynamic parser registry unavailable: %s", error)

    return jsonify({
        "parsers": parser_items
    })


@app.route("/candidate/test", methods=["POST"])
def test_config_candidate():
    if not _internal_request_allowed():
        return jsonify({"error": "Internal service authentication required"}), 401
    if "file" not in request.files:
        return jsonify({"error": "No fixture file provided"}), 400
    try:
        spec = json.loads(request.form.get("specification") or "{}")
        report = evaluate_candidate(request.files["file"].read(), spec)
        return jsonify({"report": report})
    except Exception as error:
        return jsonify({"error": str(error), "report": {"passed": False}}), 400


@app.route("/candidate/inspect", methods=["POST"])
def inspect_candidate_fixture():
    if not _internal_request_allowed():
        return jsonify({"error": "Internal service authentication required"}), 401
    if "file" not in request.files:
        return jsonify({"error": "No fixture file provided"}), 400
    try:
        fixture = request.files["file"]
        return jsonify({"fixture": inspect_fixture(fixture.read(), fixture.filename or "statement")})
    except Exception as error:
        return jsonify({"error": str(error)}), 400


@app.route("/candidate/python/test", methods=["POST"])
def test_python_candidate():
    if not _internal_request_allowed():
        return jsonify({"error": "Internal service authentication required"}), 401
    if "file" not in request.files:
        return jsonify({"error": "No fixture file provided"}), 400
    try:
        source_code = request.form.get("sourceCode") or ""
        specification = json.loads(request.form.get("specification") or "{}")
        result = submit_python_job(
            source_code, request.files["file"].read(), specification
        )
        return jsonify({"report": result["report"]})
    except (SandboxExecutionError, ValueError) as error:
        return jsonify({"error": str(error), "report": {"passed": False}}), 400


if __name__ == "__main__":
    port = int(os.getenv("PORT", 4000))
    app.run(host="0.0.0.0", port=port, debug=True)
