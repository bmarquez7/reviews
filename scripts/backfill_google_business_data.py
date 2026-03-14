#!/usr/bin/env python3
import json
import math
import os
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path("/Users/marquezfamily/Documents/New project")
ENV_PATH = ROOT / "apps/api/.env"
REPORT_DIR = ROOT / "data"


def load_env(path: Path):
    env = {}
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        if "=" not in line or line.strip().startswith("#"):
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip()
    return env


env = load_env(ENV_PATH)

SUPABASE_URL = env.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = env.get("SUPABASE_SERVICE_ROLE_KEY", "")
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GOOGLE_PLACES_API_KEY", "")

BACKFILL_APPROVED = str(os.environ.get("GOOGLE_BACKFILL_APPROVED", "false")).lower() == "true"
MAX_BUDGET_USD = float(os.environ.get("GOOGLE_BACKFILL_MAX_USD", "160"))
PHOTOS_PER_BUSINESS = max(0, min(8, int(os.environ.get("GOOGLE_BACKFILL_PHOTOS_PER_BUSINESS", "4"))))
BUSINESS_LIMIT = int(os.environ.get("GOOGLE_BACKFILL_BUSINESS_LIMIT", "10000"))
GOOGLE_SLEEP_MS = int(os.environ.get("GOOGLE_BACKFILL_SLEEP_MS", "120"))
PHOTO_SLEEP_MS = int(os.environ.get("GOOGLE_BACKFILL_PHOTO_SLEEP_MS", "100"))
MAX_PHOTO_HEIGHT = int(os.environ.get("GOOGLE_BACKFILL_PHOTO_MAX_HEIGHT", "1200"))
PROGRESS_EVERY = max(1, int(os.environ.get("GOOGLE_BACKFILL_PROGRESS_EVERY", "25")))
DRY_RUN = str(os.environ.get("GOOGLE_BACKFILL_DRY_RUN", "0")) == "1" or "--dry-run" in os.sys.argv
HTTP_RETRIES = max(1, int(os.environ.get("GOOGLE_BACKFILL_HTTP_RETRIES", "4")))
HTTP_BACKOFF_MS = max(100, int(os.environ.get("GOOGLE_BACKFILL_HTTP_BACKOFF_MS", "800")))

SEARCH_COST_USD = 32 / 1000
DETAILS_COST_USD = 20 / 1000
PHOTO_COST_USD = 7 / 1000

REST_BASE = f"{SUPABASE_URL}/rest/v1"
STORAGE_BASE = f"{SUPABASE_URL}/storage/v1"

JSON_HEADERS = {
    "apikey": SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    "Content-Type": "application/json",
}

SEARCH_FIELD_MASK = ",".join(
    [
        "places.id",
        "places.name",
        "places.displayName",
        "places.formattedAddress",
        "places.location",
    ]
)

DETAILS_FIELD_MASK = ",".join(
    [
        "id",
        "name",
        "displayName",
        "formattedAddress",
        "location",
        "websiteUri",
        "internationalPhoneNumber",
        "rating",
        "userRatingCount",
        "regularOpeningHours.weekdayDescriptions",
        "photos",
    ]
)

WORD_SPLIT_RE = re.compile(r"[^a-z0-9]+")
NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


def normalize_spaces(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def canonical_name(value):
    text = normalize_spaces(value).lower()
    text = (
        text.replace("&", " and ")
        .replace("shpk", " ")
        .replace("llc", " ")
        .replace("ltd", " ")
        .replace("inc", " ")
        .replace("branch", " ")
        .replace("location", " ")
    )
    text = NON_ALNUM_RE.sub(" ", text)
    return normalize_spaces(text)


def tokenize(value):
    tokens = [token for token in WORD_SPLIT_RE.split(canonical_name(value)) if token]
    return [token for token in tokens if token not in {"rruga", "street", "road", "boulevard", "blvd", "near"}]


def score_candidate(business_name, city, address_line, result):
    result_name = result.get("displayName", {}).get("text") or result.get("display_name") or ""
    result_address = result.get("formattedAddress") or ""
    target_name = canonical_name(business_name)
    candidate_name = canonical_name(result_name)

    score = 0
    if target_name and candidate_name:
        if target_name == candidate_name:
            score += 10
        elif target_name in candidate_name or candidate_name in target_name:
            score += 7
        else:
            target_tokens = set(tokenize(target_name))
            candidate_tokens = set(tokenize(candidate_name))
            overlap = len(target_tokens & candidate_tokens)
            if overlap:
                score += min(6, overlap * 2)

    city_lower = str(city or "").strip().lower()
    if city_lower and city_lower in result_address.lower():
        score += 2

    addr_tokens = set(tokenize(address_line))
    result_addr_tokens = set(tokenize(result_address))
    overlap = len(addr_tokens & result_addr_tokens)
    if overlap >= 2:
        score += 3
    elif overlap == 1:
        score += 1

    return score


def choose_best_match(business_name, city, address_line, places):
    best = None
    best_score = -1
    for place in places:
        score = score_candidate(business_name, city, address_line, place)
        if score > best_score:
            best = place
            best_score = score
    return best, best_score


def rest(path, method="GET", body=None, headers=None):
    req_headers = dict(JSON_HEADERS)
    if headers:
        req_headers.update(headers)
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(f"{REST_BASE}{path}", method=method, data=data, headers=req_headers)
    return request_json(req, timeout=90)


def fetch_all(path_template, page_size=1000):
    rows = []
    offset = 0
    while True:
        payload = rest(path_template.format(limit=page_size, offset=offset))
        page = payload or []
        rows.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
    return rows


def storage_list(prefix, limit=20):
    req = urllib.request.Request(
        f"{STORAGE_BASE}/object/list/business-media",
        method="POST",
        data=json.dumps(
            {
                "prefix": prefix,
                "limit": limit,
                "sortBy": {"column": "name", "order": "asc"},
            }
        ).encode("utf-8"),
        headers=JSON_HEADERS,
    )
    return request_json(req, timeout=90) or []


def storage_upload(path, content, content_type):
    req = urllib.request.Request(
        f"{STORAGE_BASE}/object/business-media/{path}",
        method="POST",
        data=content,
        headers={
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": content_type,
            "x-upsert": "false",
        },
    )
    request_bytes(req, timeout=120)


def google_search(text_query):
    body = {
        "textQuery": text_query,
        "languageCode": "en",
        "regionCode": "AL",
        "pageSize": 5,
    }
    req = urllib.request.Request(
        "https://places.googleapis.com/v1/places:searchText",
        method="POST",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_API_KEY,
            "X-Goog-FieldMask": SEARCH_FIELD_MASK,
        },
    )
    return request_json(req, timeout=90)


def google_place_details(resource_name_or_id):
    if str(resource_name_or_id).startswith("places/"):
        url = f"https://places.googleapis.com/v1/{resource_name_or_id}"
    else:
        url = f"https://places.googleapis.com/v1/places/{resource_name_or_id}"

    req = urllib.request.Request(
        url,
        method="GET",
        headers={
            "X-Goog-Api-Key": GOOGLE_API_KEY,
            "X-Goog-FieldMask": DETAILS_FIELD_MASK,
        },
    )
    return request_json(req, timeout=90)


def google_photo_bytes(photo_name):
    url = (
        f"https://places.googleapis.com/v1/{photo_name}/media?"
        f"maxHeightPx={MAX_PHOTO_HEIGHT}&skipHttpRedirect=true&key={urllib.parse.quote(GOOGLE_API_KEY)}"
    )
    meta_req = urllib.request.Request(url, method="GET")
    payload = request_json(meta_req, timeout=90)
    photo_uri = payload.get("photoUri")
    if not photo_uri:
        return None, None
    photo_req = urllib.request.Request(photo_uri, method="GET")
    content, headers = request_bytes(photo_req, timeout=120, return_headers=True)
    content_type = headers.get("Content-Type", "image/jpeg")
    return content, content_type


def should_retry_http(exc):
    if isinstance(exc, urllib.error.HTTPError):
        return exc.code in {408, 409, 425, 429, 500, 502, 503, 504}
    return isinstance(exc, (urllib.error.URLError, socket.timeout, TimeoutError))


def request_bytes(req, timeout=90, return_headers=False):
    last_exc = None
    for attempt in range(1, HTTP_RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read()
                if return_headers:
                    return body, resp.headers
                return body
        except Exception as exc:
            last_exc = exc
            if not should_retry_http(exc) or attempt >= HTTP_RETRIES:
                raise
            time.sleep((HTTP_BACKOFF_MS * attempt) / 1000.0)
    raise last_exc


def request_json(req, timeout=90):
    payload = request_bytes(req, timeout=timeout)
    if not payload:
        return None
    return json.loads(payload.decode("utf-8"))


def build_queries(business, location):
    parts = [business["name"], location.get("address_line"), location.get("city"), "Albania"]
    query1 = ", ".join([normalize_spaces(p) for p in parts if normalize_spaces(p)])
    query2 = ", ".join([normalize_spaces(p) for p in [business["name"], location.get("city"), "Albania"] if normalize_spaces(p)])
    if query2 == query1:
        return [query1]
    return [query1, query2]


def build_hours_payload(weekday_descriptions):
    if not weekday_descriptions:
        return None
    return {"weekday_text": weekday_descriptions}


def should_update_business(business, details):
    patch = {}
    website = details.get("websiteUri")
    phone = details.get("internationalPhoneNumber")
    if not normalize_spaces(business.get("website_url")) and website:
        patch["website_url"] = website
    if not normalize_spaces(business.get("primary_phone")) and phone:
        patch["primary_phone"] = phone
    return patch


def should_update_location(location, details):
    patch = {}
    hours_payload = build_hours_payload(details.get("regularOpeningHours", {}).get("weekdayDescriptions", []))
    if not location.get("location_phone") and details.get("internationalPhoneNumber"):
        patch["location_phone"] = details.get("internationalPhoneNumber")
    if (location.get("location_hours") in (None, {}, [])) and hours_payload:
        patch["location_hours"] = hours_payload
    return patch


def patch_business(business_id, patch):
    if not patch:
        return
    rest(f"/businesses?id=eq.{business_id}", method="PATCH", body=patch, headers={"Prefer": "return=minimal"})


def patch_location(location_id, patch):
    if not patch:
        return
    rest(f"/business_locations?id=eq.{location_id}", method="PATCH", body=patch, headers={"Prefer": "return=minimal"})


def fetch_businesses():
    businesses = fetch_all(
        "/businesses?select=id,name,website_url,primary_phone,status&status=eq.active&order=name.asc&limit={limit}&offset={offset}",
        page_size=1000,
    )
    return businesses[:BUSINESS_LIMIT]


def fetch_locations():
    return fetch_all(
        "/business_locations?select=id,business_id,location_name,address_line,city,region,country,location_phone,location_hours,status&status=eq.active&order=business_id.asc&limit={limit}&offset={offset}",
        page_size=1000,
    )


def sort_locations(rows):
    def key_fn(row):
        name = str(row.get("location_name") or "")
        is_main = "(main)" in name.lower()
        return (0 if is_main else 1, name.lower(), str(row.get("address_line") or "").lower())

    return sorted(rows, key=key_fn)


def safe_photo_object_path(business_id, photo_name, index):
    tail = str(photo_name).split("/")[-1]
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", tail).strip("-") or f"photo-{index + 1}"
    return f"business/{business_id}/google-{index + 1}-{slug}.jpg"


def ensure_budget_or_die(total_locations, total_businesses):
    projected = (total_locations * SEARCH_COST_USD) + (total_locations * DETAILS_COST_USD) + (total_businesses * PHOTOS_PER_BUSINESS * PHOTO_COST_USD)
    projected = round(projected + 1e-9, 2)
    if projected > MAX_BUDGET_USD:
        raise SystemExit(
            f"Projected worst-case Google cost ${projected:.2f} exceeds approved cap ${MAX_BUDGET_USD:.2f}. "
            "Reduce businesses, locations, or photos per business."
        )
    return projected


def write_report(report):
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    path = REPORT_DIR / f"google_backfill_report_{stamp}.json"
    path.write_text(json.dumps(report, indent=2))
    return path


def main():
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise SystemExit("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    if not GOOGLE_API_KEY and not DRY_RUN:
        raise SystemExit("Missing GOOGLE_API_KEY")
    if not BACKFILL_APPROVED and not DRY_RUN:
        raise SystemExit("GOOGLE_BACKFILL_APPROVED=true required before paid run")

    businesses = fetch_businesses()
    locations = fetch_locations()
    business_map = {row["id"]: row for row in businesses}
    locations_by_business = defaultdict(list)
    for row in locations:
        if row.get("business_id") in business_map:
            locations_by_business[row["business_id"]].append(row)

    total_businesses = len(businesses)
    total_locations = sum(len(locations_by_business[row["id"]]) for row in businesses)
    projected_full_cost = ensure_budget_or_die(total_locations, total_businesses)

    preview = {
        "mode": "dry-run" if DRY_RUN else "backfill",
        "businesses": total_businesses,
        "locations": total_locations,
        "photos_per_business": PHOTOS_PER_BUSINESS,
        "projected_worst_case_google_cost_usd": projected_full_cost,
        "approved_budget_usd": MAX_BUDGET_USD,
    }
    print(json.dumps(preview, indent=2))
    if DRY_RUN:
        return

    stats = {
        "businesses_seen": 0,
        "locations_seen": 0,
        "search_calls": 0,
        "details_calls": 0,
        "photo_calls": 0,
        "locations_matched": 0,
        "locations_unmatched": 0,
        "businesses_updated": 0,
        "locations_updated": 0,
        "photos_uploaded": 0,
        "photo_upload_failures": 0,
        "search_failures": 0,
        "details_failures": 0,
        "match_retries_used": 0,
    }

    unmatched = []
    processed_business_for_photos = set()

    for business in businesses:
        stats["businesses_seen"] += 1
        business_id = business["id"]
        business_locations = sort_locations(locations_by_business.get(business_id, []))
        if not business_locations:
            continue

        existing_media = storage_list(f"business/{business_id}/", limit=max(PHOTOS_PER_BUSINESS + 4, 20))
        existing_media_count = len(existing_media or [])
        photos_needed = max(0, PHOTOS_PER_BUSINESS - existing_media_count)
        business_contact_needed = not normalize_spaces(business.get("website_url")) or not normalize_spaces(business.get("primary_phone"))

        business_got_photo_match = False

        for location in business_locations:
            location_contact_needed = not normalize_spaces(location.get("location_phone"))
            location_hours_needed = location.get("location_hours") in (None, {}, [])
            if not business_contact_needed and not location_contact_needed and not location_hours_needed and photos_needed <= 0:
                continue

            stats["locations_seen"] += 1
            best = None
            best_score = -1

            for idx, query in enumerate(build_queries(business, location)):
                try:
                    search_res = google_search(query)
                    stats["search_calls"] += 1
                except Exception:
                    stats["search_failures"] += 1
                    continue

                places = search_res.get("places", [])
                candidate, candidate_score = choose_best_match(
                    business["name"],
                    location.get("city"),
                    location.get("address_line"),
                    places,
                )
                if candidate and candidate_score > best_score:
                    best = candidate
                    best_score = candidate_score
                if candidate and candidate_score >= 7:
                    if idx > 0:
                        stats["match_retries_used"] += 1
                    break
                if idx > 0:
                    stats["match_retries_used"] += 1
                time.sleep(GOOGLE_SLEEP_MS / 1000.0)

            if not best or best_score < 5:
                stats["locations_unmatched"] += 1
                unmatched.append(
                    {
                        "business_id": business_id,
                        "business_name": business["name"],
                        "location_id": location["id"],
                        "address_line": location.get("address_line"),
                        "city": location.get("city"),
                        "best_score": best_score,
                    }
                )
                continue

            try:
                details = google_place_details(best.get("name") or best.get("id"))
                stats["details_calls"] += 1
            except Exception:
                stats["details_failures"] += 1
                continue

            stats["locations_matched"] += 1

            business_patch = should_update_business(business, details)
            if business_patch:
                patch_business(business_id, business_patch)
                business.update(business_patch)
                stats["businesses_updated"] += 1
                business_contact_needed = not normalize_spaces(business.get("website_url")) or not normalize_spaces(business.get("primary_phone"))

            location_patch = should_update_location(location, details)
            if location_patch:
                patch_location(location["id"], location_patch)
                location.update(location_patch)
                stats["locations_updated"] += 1

            if photos_needed > 0 and not business_got_photo_match and business_id not in processed_business_for_photos:
                photos = details.get("photos") or []
                for index, photo in enumerate(photos[:photos_needed]):
                    photo_name = photo.get("name")
                    if not photo_name:
                        continue
                    object_path = safe_photo_object_path(business_id, photo_name, index)
                    try:
                        content, content_type = google_photo_bytes(photo_name)
                        stats["photo_calls"] += 1
                        if not content:
                            stats["photo_upload_failures"] += 1
                            continue
                        storage_upload(object_path, content, content_type)
                        stats["photos_uploaded"] += 1
                        time.sleep(PHOTO_SLEEP_MS / 1000.0)
                    except Exception:
                        stats["photo_upload_failures"] += 1
                business_got_photo_match = True
                processed_business_for_photos.add(business_id)
                photos_needed = 0

            time.sleep(GOOGLE_SLEEP_MS / 1000.0)

        if stats["businesses_seen"] % PROGRESS_EVERY == 0:
            print(
                json.dumps(
                    {
                        "progress": {
                            "businesses_seen": stats["businesses_seen"],
                            "locations_seen": stats["locations_seen"],
                            "locations_matched": stats["locations_matched"],
                            "locations_unmatched": stats["locations_unmatched"],
                            "photos_uploaded": stats["photos_uploaded"],
                            "projected_run_cost_usd_without_free_tier": round(
                                (stats["search_calls"] * SEARCH_COST_USD)
                                + (stats["details_calls"] * DETAILS_COST_USD)
                                + (stats["photo_calls"] * PHOTO_COST_USD),
                                2,
                            ),
                        }
                    }
                )
            )

    projected_cost = round(
        (stats["search_calls"] * SEARCH_COST_USD)
        + (stats["details_calls"] * DETAILS_COST_USD)
        + (stats["photo_calls"] * PHOTO_COST_USD),
        2,
    )

    report = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "approved_budget_usd": MAX_BUDGET_USD,
        "photos_per_business_target": PHOTOS_PER_BUSINESS,
        "projected_worst_case_google_cost_usd": projected_full_cost,
        "projected_run_cost_usd_without_free_tier": projected_cost,
        "stats": stats,
        "unmatched_sample": unmatched[:100],
    }
    report_path = write_report(report)
    print(json.dumps({"report_path": str(report_path), **report}, indent=2))


if __name__ == "__main__":
    main()
