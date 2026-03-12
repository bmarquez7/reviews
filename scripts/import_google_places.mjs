import crypto from "crypto";
import fs from "fs";
import path from "path";
import process from "process";
import dotenv from "dotenv";

const ROOT = path.resolve(process.cwd(), "..");
const GOOGLE_FALLBACK_MANIFEST = path.resolve(ROOT, "data/google_place_fallbacks.json");
const DEFAULT_ENV_PATHS = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(ROOT, "apps/api/.env"),
  path.resolve(ROOT, ".env")
];

for (const envPath of DEFAULT_ENV_PATHS) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || process.env.GOOGLE_PLACES_API_KEY || "";
const GOOGLE_IMPORT_APPROVED = String(process.env.GOOGLE_IMPORT_APPROVED || "false").toLowerCase() === "true";
const DRY_RUN = process.argv.includes("--dry-run") || String(process.env.GOOGLE_IMPORT_DRY_RUN || "0") === "1";

const BUSINESS_TARGET = Number(process.env.GOOGLE_IMPORT_BUSINESS_TARGET || process.env.GOOGLE_IMPORT_TARGET || "2000");
const MAX_QUERIES = Number(process.env.GOOGLE_IMPORT_MAX_QUERIES || "150");
const QUERY_OFFSET = Number(process.env.GOOGLE_IMPORT_QUERY_OFFSET || "0");
const MAX_PAGES = Number(process.env.GOOGLE_IMPORT_MAX_PAGES || "3");
const PAGE_SIZE = 20;
const WRITE_DELAY_MS = Number(process.env.GOOGLE_IMPORT_WRITE_DELAY_MS || "15");
const GOOGLE_DELAY_MS = Number(process.env.GOOGLE_IMPORT_GOOGLE_DELAY_MS || "120");
const NEXT_PAGE_DELAY_MS = Number(process.env.GOOGLE_IMPORT_NEXT_PAGE_DELAY_MS || "1200");

const DEFAULT_CITIES = [
  "Tirana",
  "Durres",
  "Vlore",
  "Shkoder",
  "Elbasan",
  "Korce",
  "Fier",
  "Berat",
  "Sarande",
  "Gjirokaster"
];

const IMPORT_CITIES = (process.env.GOOGLE_IMPORT_CITIES || DEFAULT_CITIES.join(","))
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

const TIRANA_AREAS = [
  "Blloku",
  "Komuna e Parisit",
  "Myslym Shyri",
  "Pazari i Ri",
  "21 Dhjetori",
  "Ali Demi",
  "Laprake",
  "Don Bosko",
  "Astir",
  "Sauk",
  "Selite",
  "Rruga e Kavajes",
  "Qender",
  "Rruga Barrikadave"
];

const CATEGORY_QUERIES = [
  "restaurants",
  "cafes",
  "coffee shops",
  "bars",
  "clubs",
  "movie theaters",
  "playhouses",
  "repair shops",
  "car repair shops",
  "phone repair shops",
  "hotels",
  "hostels",
  "guesthouses",
  "bakeries",
  "small businesses",
  "beauty salons",
  "barbers",
  "spas",
  "gyms",
  "retail stores"
];

const QUERY_MODIFIERS = ["most popular", "most reviewed", "top rated", "best"];

const GOOGLE_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const GOOGLE_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.primaryType",
  "places.types",
  "places.rating",
  "places.userRatingCount",
  "places.websiteUri",
  "places.internationalPhoneNumber",
  "places.regularOpeningHours.weekdayDescriptions",
  "nextPageToken"
].join(",");

const CATEGORY_SEED = [
  { slug: "cafe", label_i18n_key: "categories.cafe" },
  { slug: "restaurant", label_i18n_key: "categories.restaurant" },
  { slug: "hotel", label_i18n_key: "categories.hotel" },
  { slug: "clinic", label_i18n_key: "categories.clinic" },
  { slug: "retail", label_i18n_key: "categories.retail" }
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeSpaces = (value) => String(value || "").replace(/\s+/g, " ").trim();

const canonicalBusinessName = (value) =>
  normalizeSpaces(
    String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[&]/g, " and ")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\b(shpk|llc|ltd|inc|branch|location)\b/g, " ")
      .replace(/\s+/g, " ")
  );

const canonicalAddress = (address, city, country) =>
  normalizeSpaces(
    `${address || ""} ${city || ""} ${country || ""}`
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
  );

const mapCategorySlug = (types = [], primaryType = "") => {
  const t = new Set([primaryType, ...types].filter(Boolean));
  if (t.has("cafe") || t.has("coffee_shop") || t.has("bakery") || t.has("tea_house")) return "cafe";
  if (t.has("restaurant") || t.has("bar") || t.has("night_club") || t.has("fast_food_restaurant") || t.has("pub") || t.has("food_court")) return "restaurant";
  if (t.has("hotel") || t.has("hostel") || t.has("lodging") || t.has("guest_house")) return "hotel";
  if (t.has("pharmacy") || t.has("hospital") || t.has("doctor") || t.has("medical_clinic") || t.has("dentist")) return "clinic";
  return "retail";
};

const parseCacheFile = (raw) => {
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }

  const rows = Array.isArray(json) ? json : Array.isArray(json?.places) ? json.places : [];
  return rows
    .map((row) => {
      const placeId = row.placeId || row.id || row.google_place_id || row.googlePlaceId;
      const name = row.name || row.displayName?.text || row.display_name;
      if (!placeId || !name) return null;
      const formattedAddress = row.formattedAddress || row.address || row.address_line || "Address not listed";
      const city = row.city || (formattedAddress.includes("Tirana") ? "Tirana" : IMPORT_CITIES[0] || "Tirana");
      const country = row.country || "Albania";
      return {
        placeId: String(placeId),
        name: normalizeSpaces(name),
        addressLine: normalizeSpaces(formattedAddress),
        city: normalizeSpaces(city),
        region: row.region || "Tirane",
        country: normalizeSpaces(country),
        latitude: Number(row.latitude ?? row.location?.latitude ?? 0) || null,
        longitude: Number(row.longitude ?? row.location?.longitude ?? 0) || null,
        rating: Number(row.rating || 0),
        userRatingCount: Number(row.userRatingCount || row.user_ratings_total || 0),
        categorySlug: mapCategorySlug(row.types || [], row.primaryType || row.primary_type || ""),
        websiteUri: row.websiteUri || row.website_url || null,
        internationalPhoneNumber: row.internationalPhoneNumber || row.phone || row.primary_phone || null,
        weekdayDescriptions: row.regularOpeningHours?.weekdayDescriptions || row.weekdayDescriptions || row.weekday_text || []
      };
    })
    .filter(Boolean);
};

const loadCachedPlaces = () => {
  const configured = (process.env.GOOGLE_IMPORT_CACHE_FILES || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map((p) => path.resolve(process.cwd(), p));

  const defaults = [
    path.resolve(ROOT, "exports/google_places_tirana.json"),
    path.resolve(ROOT, "exports/google_places_albania.json"),
    path.resolve(ROOT, "data/google_places_cache.json")
  ];

  const files = [...configured, ...defaults].filter((file, idx, arr) => arr.indexOf(file) === idx);
  const loaded = [];

  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const parsed = parseCacheFile(fs.readFileSync(file, "utf8"));
    if (parsed.length) {
      loaded.push(...parsed);
      console.log(`Loaded ${parsed.length} cached rows from ${file}`);
    }
  }

  return loaded;
};

const buildQueries = () => {
  const queries = [];
  for (const city of IMPORT_CITIES) {
    for (const category of CATEGORY_QUERIES) {
      for (const mod of QUERY_MODIFIERS) queries.push(`${mod} ${category} in ${city} Albania`);
      queries.push(`${category} near city center ${city} Albania`);
    }
  }

  for (const area of TIRANA_AREAS) {
    for (const category of CATEGORY_QUERIES.slice(0, 12)) {
      queries.push(`popular ${category} in ${area} Tirana Albania`);
      queries.push(`most reviewed ${category} in ${area} Tirana Albania`);
    }
  }

  const unique = [];
  const seen = new Set();
  for (const q of queries) {
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(q);
  }
  return unique.slice(QUERY_OFFSET, QUERY_OFFSET + MAX_QUERIES);
};

const googleSearch = async (textQuery, pageToken = "") => {
  const body = {
    textQuery,
    languageCode: "en",
    regionCode: "AL",
    pageSize: PAGE_SIZE
  };
  if (pageToken) body.pageToken = pageToken;

  const response = await fetch(GOOGLE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_API_KEY,
      "X-Goog-FieldMask": GOOGLE_FIELD_MASK
    },
    body: JSON.stringify(body)
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Google API failed (${response.status}): ${JSON.stringify(json)}`);
  return json;
};

const estimateCosts = (queryCount) => {
  const maxGoogleCalls = queryCount * MAX_PAGES;
  const lowPer1k = 5;
  const highPer1k = 32;
  return {
    maxGoogleCalls,
    estimatedUsdLow: Number(((maxGoogleCalls / 1000) * lowPer1k).toFixed(2)),
    estimatedUsdHigh: Number(((maxGoogleCalls / 1000) * highPer1k).toFixed(2))
  };
};

const addCandidate = (byId, row) => {
  const existing = byId.get(row.placeId);
  if (!existing) {
    byId.set(row.placeId, row);
    return;
  }
  if (row.userRatingCount > existing.userRatingCount) {
    byId.set(row.placeId, row);
    return;
  }
  if (row.userRatingCount === existing.userRatingCount && row.rating > existing.rating) {
    byId.set(row.placeId, row);
  }
};

const collectPlaces = async (queries, cached) => {
  const byId = new Map();
  for (const row of cached) addCandidate(byId, row);

  if (!GOOGLE_API_KEY) {
    return { rows: Array.from(byId.values()), googleCalls: 0, queriesExecuted: 0 };
  }

  let googleCalls = 0;
  let queriesExecuted = 0;

  for (const query of queries) {
    queriesExecuted += 1;
    let pageToken = "";

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const data = await googleSearch(query, pageToken);
      googleCalls += 1;

      for (const place of data.places || []) {
        if (!place?.id || !place?.displayName?.text) continue;

        addCandidate(byId, {
          placeId: place.id,
          name: normalizeSpaces(place.displayName.text),
          addressLine: normalizeSpaces(place.formattedAddress || "Address not listed"),
          city: (() => {
            const fromAddress = String(place.formattedAddress || "").toLowerCase();
            for (const cityName of IMPORT_CITIES) {
              if (fromAddress.includes(cityName.toLowerCase())) return cityName;
            }
            return IMPORT_CITIES[0] || "Tirana";
          })(),
          region: "Tirane",
          country: "Albania",
          latitude: place.location?.latitude ?? null,
          longitude: place.location?.longitude ?? null,
          rating: Number(place.rating || 0),
          userRatingCount: Number(place.userRatingCount || 0),
          categorySlug: mapCategorySlug(place.types || [], place.primaryType || ""),
          websiteUri: place.websiteUri || null,
          internationalPhoneNumber: place.internationalPhoneNumber || null,
          weekdayDescriptions: place.regularOpeningHours?.weekdayDescriptions || []
        });
      }

      pageToken = data.nextPageToken || "";
      if (!pageToken) break;
      await sleep(NEXT_PAGE_DELAY_MS);
    }

    await sleep(GOOGLE_DELAY_MS);
  }

  return { rows: Array.from(byId.values()), googleCalls, queriesExecuted };
};

const groupBusinesses = (places) => {
  const groups = new Map();

  for (const row of places) {
    const key = canonicalBusinessName(row.name);
    if (!key) continue;

    if (!groups.has(key)) {
      groups.set(key, {
        canonicalName: key,
        displayName: row.name,
        topRatingCount: row.userRatingCount,
        topRating: row.rating,
        categorySlug: row.categorySlug,
        websiteUri: row.websiteUri || null,
        primaryPhone: row.internationalPhoneNumber || null,
        locations: []
      });
    }

    const group = groups.get(key);
    if (row.userRatingCount > group.topRatingCount || (row.userRatingCount === group.topRatingCount && row.rating > group.topRating)) {
      group.displayName = row.name;
      group.topRatingCount = row.userRatingCount;
      group.topRating = row.rating;
      group.categorySlug = row.categorySlug;
      group.websiteUri = row.websiteUri || group.websiteUri || null;
      group.primaryPhone = row.internationalPhoneNumber || group.primaryPhone || null;
    }

    const locationKey = canonicalAddress(row.addressLine, row.city, row.country);
    if (!group.locations.some((loc) => loc.locationKey === locationKey)) {
      group.locations.push({
        locationKey,
        placeId: row.placeId,
        addressLine: row.addressLine,
        city: row.city,
        region: row.region,
        country: row.country,
        latitude: row.latitude,
        longitude: row.longitude,
        rating: row.rating,
        userRatingCount: row.userRatingCount,
        locationPhone: row.internationalPhoneNumber || null,
        weekdayDescriptions: Array.isArray(row.weekdayDescriptions) ? row.weekdayDescriptions : []
      });
    }
  }

  const arr = Array.from(groups.values());
  for (const group of arr) {
    group.locations.sort((a, b) => {
      if (b.userRatingCount !== a.userRatingCount) return b.userRatingCount - a.userRatingCount;
      if (b.rating !== a.rating) return b.rating - a.rating;
      return a.addressLine.localeCompare(b.addressLine);
    });
  }

  return arr.sort((a, b) => {
    if (b.topRatingCount !== a.topRatingCount) return b.topRatingCount - a.topRatingCount;
    if (b.topRating !== a.topRating) return b.topRating - a.topRating;
    return a.displayName.localeCompare(b.displayName);
  });
};

const supabaseRequest = async (route, { method = "GET", body, headers = {} } = {}) => {
  const response = await fetch(`${SUPABASE_URL}/rest/v1${route}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    throw new Error(`Supabase ${method} ${route} failed (${response.status}): ${typeof payload === "string" ? payload : JSON.stringify(payload)}`);
  }

  return { data: payload, headers: response.headers };
};

const ensureCategories = async () => {
  const existing = await supabaseRequest("/categories?select=id,slug&limit=5000");
  const bySlug = new Map((existing.data || []).map((r) => [r.slug, r.id]));

  const missing = CATEGORY_SEED.filter((c) => !bySlug.has(c.slug));
  if (missing.length) {
    const inserted = await supabaseRequest("/categories?on_conflict=slug", {
      method: "POST",
      body: missing,
      headers: { Prefer: "resolution=merge-duplicates,return=representation" }
    });

    for (const row of inserted.data || []) bySlug.set(row.slug, row.id);
  }

  // Re-read to ensure IDs are complete.
  const refreshed = await supabaseRequest("/categories?select=id,slug&limit=5000");
  return new Map((refreshed.data || []).map((r) => [r.slug, r.id]));
};

const ensureOwnerUser = async () => {
  const existing = await supabaseRequest("/users?select=id,email,role,status&status=eq.active&role=in.(admin,business_owner)&limit=1");
  if ((existing.data || []).length > 0) return existing.data[0].id;

  const id = crypto.randomUUID();
  const email = `importer+${Date.now()}@grow-albania.local`;
  await supabaseRequest("/users", {
    method: "POST",
    body: [{
      id,
      email,
      role: "business_owner",
      status: "active",
      language_preference: "en",
      email_verified_at: new Date().toISOString()
    }],
    headers: { Prefer: "return=minimal" }
  });

  return id;
};

const fetchAllBusinesses = async () => {
  const out = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const res = await supabaseRequest(`/businesses?select=id,name&status=eq.active&order=name.asc&limit=${pageSize}&offset=${offset}`);
    const rows = res.data || [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return out;
};

const fetchAllLocations = async () => {
  const pageSize = 2000;
  let offset = 0;
  const map = new Map();

  while (true) {
    const res = await supabaseRequest(`/business_locations?select=business_id,address_line,city,country,status&limit=${pageSize}&offset=${offset}`);
    const rows = res.data || [];
    for (const row of rows) {
      if (row.status !== "active") continue;
      const key = canonicalAddress(row.address_line, row.city, row.country);
      const set = map.get(row.business_id) || new Set();
      set.add(key);
      map.set(row.business_id, set);
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return map;
};

const createBusiness = async ({ ownerUserId, group, categoryId }) => {
  const created = await supabaseRequest("/businesses", {
    method: "POST",
    body: [{
      owner_user_id: ownerUserId,
      name: group.displayName,
      owner_name: "Imported Listing",
      description: "Imported from Google Places.",
      website_url: group.websiteUri || null,
      primary_phone: group.primaryPhone || null,
      status: "active",
      is_claimed: false
    }],
    headers: { Prefer: "return=representation" }
  });

  const businessId = created?.data?.[0]?.id;
  if (!businessId) throw new Error(`Business create returned no id for ${group.displayName}`);

  if (categoryId) {
    await supabaseRequest("/business_category_assignments?on_conflict=business_id,category_id", {
      method: "POST",
      body: [{ business_id: businessId, category_id: categoryId }],
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" }
    });
  }

  return businessId;
};

const createLocation = async (businessId, group, loc, isMain) => {
  await supabaseRequest("/business_locations", {
    method: "POST",
    body: [{
      business_id: businessId,
      location_name: isMain ? `${group.displayName} (Main)` : `${group.displayName} - ${loc.city || "Alternate"}`,
      address_line: loc.addressLine,
      city: loc.city || "Tirana",
      region: loc.region || "Tirane",
      country: loc.country || "Albania",
      location_phone: loc.locationPhone || null,
      location_hours: Array.isArray(loc.weekdayDescriptions) && loc.weekdayDescriptions.length
        ? { weekday_text: loc.weekdayDescriptions }
        : null,
      latitude: loc.latitude,
      longitude: loc.longitude,
      status: "active"
    }],
    headers: { Prefer: "return=minimal" }
  });
};

const writeFallbackManifest = (grouped) => {
  const payload = {
    generated_at: new Date().toISOString(),
    items: grouped.map((group) => ({
      canonical_name: group.canonicalName,
      display_name: group.displayName,
      rating: Number(group.topRating || 0),
      rating_count: Number(group.topRatingCount || 0)
    }))
  };

  fs.mkdirSync(path.dirname(GOOGLE_FALLBACK_MANIFEST), { recursive: true });
  fs.writeFileSync(GOOGLE_FALLBACK_MANIFEST, JSON.stringify(payload, null, 2));
  console.log(`Wrote Google fallback manifest to ${GOOGLE_FALLBACK_MANIFEST}`);
};

const runSupabaseImport = async (grouped, collected) => {
  const categoryBySlug = await ensureCategories();
  const ownerUserId = await ensureOwnerUser();

  const existingBusinesses = await fetchAllBusinesses();
  const existingByCanonical = new Map();
  for (const b of existingBusinesses) {
    const key = canonicalBusinessName(b.name);
    if (!key || existingByCanonical.has(key)) continue;
    existingByCanonical.set(key, b.id);
  }

  const locationKeysByBusiness = await fetchAllLocations();
  const existingTotal = existingBusinesses.length;
  const toCreate = Math.max(0, BUSINESS_TARGET - existingTotal);

  let createdBusinesses = 0;
  let reusedBusinesses = 0;
  let createdLocations = 0;

  const groupedLimited = grouped.slice(0, Math.max(BUSINESS_TARGET * 2, 4500));

  for (const group of groupedLimited) {
    let businessId = existingByCanonical.get(group.canonicalName);

    if (!businessId) {
      if (createdBusinesses >= toCreate) continue;
      const categoryId = categoryBySlug.get(group.categorySlug);
      businessId = await createBusiness({ ownerUserId, group, categoryId });
      existingByCanonical.set(group.canonicalName, businessId);
      createdBusinesses += 1;
      await sleep(WRITE_DELAY_MS);
    } else {
      reusedBusinesses += 1;
    }

    const existingLocSet = locationKeysByBusiness.get(businessId) || new Set();
    const hadNoLocations = existingLocSet.size === 0;

    for (let i = 0; i < group.locations.length; i += 1) {
      const loc = group.locations[i];
      if (existingLocSet.has(loc.locationKey)) continue;

      const isMain = hadNoLocations && i === 0;
      await createLocation(businessId, group, loc, isMain);
      existingLocSet.add(loc.locationKey);
      createdLocations += 1;
      await sleep(WRITE_DELAY_MS);
    }

    locationKeysByBusiness.set(businessId, existingLocSet);

    if (existingByCanonical.size >= BUSINESS_TARGET) break;
  }

  const finalTotal = (await fetchAllBusinesses()).length;

  console.log(
    JSON.stringify(
      {
        mode: "supabase_direct",
        google_calls: collected.googleCalls,
        queries_executed: collected.queriesExecuted,
        unique_places_collected: collected.rows.length,
        grouped_businesses_available: grouped.length,
        existing_businesses_before: existingTotal,
        businesses_created: createdBusinesses,
        businesses_reused: reusedBusinesses,
        locations_created: createdLocations,
        businesses_total_after: finalTotal,
        target: BUSINESS_TARGET,
        target_reached: finalTotal >= BUSINESS_TARGET
      },
      null,
      2
    )
  );
};

const main = async () => {
  const queries = buildQueries();
  const cost = estimateCosts(queries.length);
  const cached = loadCachedPlaces();

  console.log(
    JSON.stringify(
      {
        mode: DRY_RUN ? "dry-run" : "import",
        business_target: BUSINESS_TARGET,
        query_count: queries.length,
        max_pages_per_query: MAX_PAGES,
        max_google_calls: cost.maxGoogleCalls,
        estimated_google_cost_usd: { low: cost.estimatedUsdLow, high: cost.estimatedUsdHigh },
        cached_rows_found: cached.length,
        supabase_direct: Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY),
        approval_required: !DRY_RUN && !GOOGLE_IMPORT_APPROVED
      },
      null,
      2
    )
  );

  if (DRY_RUN) return;

  if (!GOOGLE_IMPORT_APPROVED) throw new Error("GOOGLE_IMPORT_APPROVED=true required before paid run");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  if (!GOOGLE_API_KEY && cached.length === 0) throw new Error("No GOOGLE_API_KEY set and no cached dataset found");

  const collected = await collectPlaces(queries, cached);
  const grouped = groupBusinesses(collected.rows);

  if (grouped.length === 0) throw new Error("No businesses collected from cache or Google");

  writeFallbackManifest(grouped);
  await runSupabaseImport(grouped, collected);
};

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
