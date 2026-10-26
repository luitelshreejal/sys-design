"""Pure logic for the NPI Registry lookup in Example D4.

This file holds the parts of the Snowflake Python UDF that do not need the
network: validating an NPI before anything leaves Snowflake, building the
request URL, and reducing the NPPES NPI Registry response to a small, fixed
set of public fields. The block between the "shared core" markers is copied
verbatim into 02_npi_lookup_function.sql, and test_npi_lookup_core.py checks
that the two copies are identical, so what is tested here is what runs there.

Standard library only. Python 3.9 or later.
"""

# --- begin shared core ---
import re
from urllib.parse import urlencode

NPPES_BASE_URL = "https://npiregistry.cms.hhs.gov/api/"
NPPES_API_VERSION = "2.1"
NPI_PATTERN = re.compile(r"^[0-9]{10}$")

# The only fields the function returns. Everything else in the NPPES response
# (addresses, phone numbers, license numbers, endpoints) is dropped, so the
# output contract stays small and stable.
OUTPUT_FIELDS = (
    "npi", "lookup_status", "enumeration_type", "name", "credential",
    "npi_status", "primary_taxonomy_code", "primary_taxonomy_desc",
    "primary_taxonomy_state", "last_updated",
)


def is_valid_npi(npi):
    """Return True if npi is 10 digits with a correct check digit.

    The NPI check digit uses the Luhn algorithm over the constant prefix
    80840 followed by the first nine digits (CMS NPI standard). Checking
    before calling the API means a malformed or arbitrary string is never
    sent outside Snowflake.
    """
    if not isinstance(npi, str) or not NPI_PATTERN.match(npi):
        return False
    digits = [int(c) for c in "80840" + npi[:9]]
    total = 0
    # Double every second digit from the right of the 14-digit payload.
    for position, digit in enumerate(reversed(digits)):
        if position % 2 == 0:
            digit *= 2
            if digit > 9:
                digit -= 9
        total += digit
    check_digit = (10 - (total % 10)) % 10
    return check_digit == int(npi[9])


def build_request_url(npi):
    """Return the NPPES API URL for one NPI (version 2.1 is required)."""
    return NPPES_BASE_URL + "?" + urlencode({"version": NPPES_API_VERSION, "number": npi})


def empty_result(npi, status):
    result = dict.fromkeys(OUTPUT_FIELDS)
    result["npi"] = npi
    result["lookup_status"] = status
    return result


def parse_nppes_response(npi, payload):
    """Reduce an NPPES API JSON payload to the fixed OUTPUT_FIELDS shape.

    lookup_status is one of: FOUND, NOT_FOUND, API_ERROR.
    """
    if not isinstance(payload, dict) or payload.get("Errors"):
        return empty_result(npi, "API_ERROR")
    results = payload.get("results") or []
    if not results:
        return empty_result(npi, "NOT_FOUND")
    record = results[0]
    basic = record.get("basic") or {}
    taxonomies = record.get("taxonomies") or []
    primary = next((t for t in taxonomies if t.get("primary") is True), None)
    if primary is None and taxonomies:
        primary = taxonomies[0]
    primary = primary or {}
    if record.get("enumeration_type") == "NPI-2":
        name = basic.get("organization_name")
    else:
        parts = [basic.get("first_name"), basic.get("last_name")]
        name = " ".join(p for p in parts if p) or None
    result = empty_result(npi, "FOUND")
    result.update({
        "enumeration_type": record.get("enumeration_type"),
        "name": name,
        "credential": basic.get("credential"),
        "npi_status": basic.get("status"),
        "primary_taxonomy_code": primary.get("code"),
        "primary_taxonomy_desc": primary.get("desc"),
        "primary_taxonomy_state": primary.get("state"),
        "last_updated": basic.get("last_updated"),
    })
    return result
# --- end shared core ---
