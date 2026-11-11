from app import main


def test_parsers_report_their_versions(monkeypatch):
    calls = []

    def dynamic(mode, headers):
        calls.append(mode)
        return [
            {"id": "my_bank_pdf", "mode": mode, "version": 3},
            # A built-in parser replaces the user's parser with the same ID.
            {"id": "uob_one_credit_card_pdf", "mode": mode, "version": 1},
        ] if mode == "bank" else []

    monkeypatch.setattr(main, "list_dynamic_parsers", dynamic)
    parsers = main.app.test_client().get("/parsers?mode=all").get_json()["parsers"]

    assert calls == ["bank", "trip"]
    versions = {p["id"]: p["parserVersion"] for p in parsers}
    assert versions["my_bank_pdf"] == "dynamic-v3"
    assert versions["uob_one_credit_card_pdf"].startswith("builtin-")
    assert versions["simplygo_transit_statement"].startswith("builtin-")
    assert "revolut_statement" in versions
    assert [p["id"] for p in parsers].count("uob_one_credit_card_pdf") == 1
