import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


DATA_SERVICE_URL = os.getenv("DATA_SERVICE_URL", "http://data-service:4001").rstrip("/")
FORWARDED_HEADERS = (
    "Authorization",
    "X-Internal-Service-Token",
    "X-Authenticated-User-Id",
)


def _headers(incoming_headers):
    headers = {"Accept": "application/json"}
    for name in FORWARDED_HEADERS:
        value = incoming_headers.get(name)
        if value:
            headers[name] = value
    return headers


def _get(path, incoming_headers):
    request = Request(f"{DATA_SERVICE_URL}{path}", headers=_headers(incoming_headers))
    try:
        with urlopen(request, timeout=5) as response:
            return json.loads(response.read())
    except HTTPError as error:
        try:
            body = json.loads(error.read())
            message = body.get("error") or f"Registry returned {error.code}"
        except Exception:
            message = f"Registry returned {error.code}"
        raise RuntimeError(message) from error
    except URLError as error:
        raise RuntimeError("Dynamic parser registry is unavailable") from error


def list_dynamic_parsers(mode, incoming_headers):
    query = urlencode({"mode": mode})
    return _get(f"/api/parser-runtime/definitions?{query}", incoming_headers).get("parsers", [])


def get_dynamic_parser(parser_id, incoming_headers):
    return _get(f"/api/parser-runtime/definitions/{quote(parser_id, safe='')}", incoming_headers)["parser"]
