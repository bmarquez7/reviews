import fs from "fs";
import path from "path";
import process from "process";
import dotenv from "dotenv";

const ROOT = path.resolve(process.cwd(), "..");
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

const DIRECTORY_API_BASE = (process.env.DIRECTORY_API_BASE || process.env.DIRECTORY_API_URL || "https://grow-albania-directory-api.onrender.com/v1").replace(/\/$/, "");
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || process.env.GOOGLE_PLACES_API_KEY || "";
const GOOGLE_IMPORT_APPROVED = String(process.env.GOOGLE_IMPORT_APPROVED || "false").toLowerCase() === "true";
const DRY_RUN = process.argv.includes("--dry-run") || String(process.env.GOOGLE_IMPORT_DRY_RUN || "0") === "1";

const BUSINESS_TARGET = Number(process.env.GOOGLE_IMPORT_BUSINESS_TARGET || process.env.GOOGLE_IMPORT_TARGET || "2000");
const MAX_QUERIES = Number(process.env.GOOGLE_IMPORT_MAX_QUERIES || "320");
const MAX_PAGES = Number(process.env.GOOGLE_IMPORT_MAX_PAGES || "3");
const PAGE_SIZE = 20;
const API_DELAY_MS = Number(process.env.DIRECTORY_IMPORT_API_DELAY_MS || "40");

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
  "nextPageToken"
].join(",");

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
        categorySlug: mapCategorySlug(row.types || [], row.primaryType || row.primary_type || "")
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
      for (const mod of QUERY_MODIFIERS) {
        queries.push(`${mod} ${category} in ${city} Albania`);
      }
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
    if (unique.length >= MAX_QUERIES) break;
  }

  return unique;
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
  if (!response.ok) {
    throw new Error(`Google API failed (${response.status}): ${JSON.stringify(json)}`);
  }

  return json;
};

const estimateCosts = (queryCount) => {
  const maxGoogleCalls = queryCount * MAX_PAGES;

  // Google Places Text Search (New) pricing varies by SKU/fields.
  // We keep a conservative range and require explicit approval before paid runs.
  const lowPer1k = 5;
  const highPer1k = 32;
  const low = (maxGoogleCalls / 1000) * lowPer1k;
  const high = (maxGoogleCalls / 1000) * highPer1k;

  return {
    maxGoogleCalls,
    estimatedUsdLow: Number(low.toFixed(2)),
    estimatedUsdHigh: Number(high.toFixed(2))
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
    return {
      rows: Array.from(byId.values()),
      googleCalls: 0,
      queriesExecuted: 0
    };
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
            const fromAddress = String(place.formattedAddress || "");
            for (const cityName of IMPORT_CITIES) {
              if (fromAddress.toLowerCase().includes(cityName.toLowerCase())) return cityName;
            }
            return IMPORT_CITIES[0] || "Tirana";
          })(),
          region: "Tirane",
          country: "Albania",
          latitude: place.location?.latitude ?? null,
          longitude: place.location?.longitude ?? null,
          rating: Number(place.rating || 0),
          userRatingCount: Number(place.userRatingCount || 0),
          categorySlug: mapCategorySlug(place.types || [], place.primaryType || "")
        });
      }

      pageToken = data.nextPageToken || "";
      if (!pageToken) break;
      await sleep(1200);
    }

    await sleep(160);
  }

  return {
    rows: Array.from(byId.values()),
    googleCalls,
    queriesExecuted
  };
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
        locations: []
      });
    }

    const group = groups.get(key);
    if (row.userRatingCount > group.topRatingCount || (row.userRatingCount === group.topRatingCount && row.rating > group.topRating)) {
      group.displayName = row.name;
      group.topRatingCount = row.userRatingCount;
      group.topRating = row.rating;
      group.categorySlug = row.categorySlug;
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
        userRatingCount: row.userRatingCount
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

const apiRequest = async (pathName, { method = "GET", token, body } = {}) => {
  const response = await fetch(`${DIRECTORY_API_BASE}${pathName}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const msg = payload?.error?.message || text || `HTTP ${response.status}`;
    throw new Error(`${method} ${pathName} failed: ${msg}`);
  }

  return payload;
};

const loginOrSignup = async () => {
  const email = process.env.DIRECTORY_IMPORT_EMAIL || process.env.IMPORT_EMAIL || "";
  const password = process.env.DIRECTORY_IMPORT_PASSWORD || process.env.IMPORT_PASSWORD || "";

  if (!email || !password) {
    throw new Error("Missing DIRECTORY_IMPORT_EMAIL and DIRECTORY_IMPORT_PASSWORD for API import");
  }

  try {
    const login = await apiRequest("/auth/login", {
      method: "POST",
      body: { email, password }
    });

    return login.data;
  } catch (err) {
    if (String(process.env.DIRECTORY_IMPORT_AUTO_SIGNUP || "0") !== "1") {
      throw err;
    }

    await apiRequest("/auth/signup", {
      method: "POST",
      body: {
        email,
        password,
        first_name: process.env.DIRECTORY_IMPORT_FIRST_NAME || "Import",
        last_name: process.env.DIRECTORY_IMPORT_LAST_NAME || "Operator",
        country_of_origin: "Albania",
        age: Number(process.env.DIRECTORY_IMPORT_AGE || "30"),
        screen_name: process.env.DIRECTORY_IMPORT_SCREEN_NAME || "Directory Import"
      }
    });

    const login = await apiRequest("/auth/login", {
      method: "POST",
      body: { email, password }
    });

    return login.data;
  }
};

const ensurePoliciesAccepted = async (loginData) => {
  if (loginData?.user?.policies?.accepted) return;

  const version = loginData?.user?.policies?.current_version;
  if (!version) throw new Error("Missing current policy version in login response");

  await apiRequest("/users/me/policies/accept", {
    method: "POST",
    token: loginData.access_token,
    body: {
      policies_version: version,
      accepted_via: "business_onboarding",
      checkboxes: {
        firsthand_only: true,
        professional_no_hate: true,
        moderation_understood: true
      }
    }
  });
};

const fetchAllBusinesses = async () => {
  let page = 1;
  const pageSize = 100;
  const items = [];

  while (true) {
    const data = await apiRequest(`/businesses?page=${page}&page_size=${pageSize}&sort=name`);
    const batch = data?.data?.items || [];
    items.push(...batch);

    const total = Number(data?.data?.total || 0);
    if (items.length >= total || batch.length === 0) break;
    page += 1;
  }

  return items;
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
        estimated_google_cost_usd: {
          low: cost.estimatedUsdLow,
          high: cost.estimatedUsdHigh
        },
        cached_rows_found: cached.length,
        approval_required: !DRY_RUN && !GOOGLE_IMPORT_APPROVED
      },
      null,
      2
    )
  );

  if (DRY_RUN) return;
  if (!GOOGLE_IMPORT_APPROVED) {
    throw new Error("GOOGLE_IMPORT_APPROVED=true required before paid run");
  }

  if (!GOOGLE_API_KEY && cached.length === 0) {
    throw new Error("No GOOGLE_API_KEY set and no cached dataset found");
  }

  const collected = await collectPlaces(queries, cached);
  const grouped = groupBusinesses(collected.rows);

  if (grouped.length === 0) {
    throw new Error("No businesses collected from cache or Google");
  }

  const login = await loginOrSignup();
  await ensurePoliciesAccepted(login);

  const categories = await apiRequest("/categories");
  const categoryBySlug = new Map((categories?.data || []).map((c) => [c.slug, c.id]));

  const existingBusinesses = await fetchAllBusinesses();
  const existingByCanonical = new Map();
  for (const b of existingBusinesses) {
    const key = canonicalBusinessName(b.name);
    if (!key || existingByCanonical.has(key)) continue;
    existingByCanonical.set(key, b.id);
  }

  const existingTotal = existingBusinesses.length;
  const createNeeded = Math.max(0, BUSINESS_TARGET - existingTotal);

  let createdBusinesses = 0;
  let createdLocations = 0;
  let reusedBusinesses = 0;

  const locationKeysByBusiness = new Map();

  const getLocationKeySet = async (businessId) => {
    if (locationKeysByBusiness.has(businessId)) return locationKeysByBusiness.get(businessId);

    const detail = await apiRequest(`/businesses/${businessId}`);
    const set = new Set(
      (detail?.data?.locations || []).map((loc) => canonicalAddress(loc.address_line, loc.city, loc.country))
    );
    locationKeysByBusiness.set(businessId, set);
    return set;
  };

  const groupedLimited = grouped.slice(0, Math.max(BUSINESS_TARGET * 2, 3000));

  for (const group of groupedLimited) {
    let businessId = existingByCanonical.get(group.canonicalName);

    if (!businessId) {
      if (createdBusinesses >= createNeeded) continue;

      const categoryId = categoryBySlug.get(group.categorySlug);
      const created = await apiRequest("/businesses", {
        method: "POST",
        token: login.access_token,
        body: {
          name: group.displayName,
          owner_name: "Imported Listing",
          description: `Imported from Google Places. Rating ${group.topRating || 0} with ${group.topRatingCount || 0} reviews.`,
          category_ids: categoryId ? [categoryId] : []
        }
      });

      businessId = created?.data?.id;
      if (!businessId) continue;

      existingByCanonical.set(group.canonicalName, businessId);
      createdBusinesses += 1;
      await sleep(API_DELAY_MS);
    } else {
      reusedBusinesses += 1;
    }

    const existingLocationKeys = await getLocationKeySet(businessId);
    const hasNoLocationsYet = existingLocationKeys.size === 0;

    for (let i = 0; i < group.locations.length; i += 1) {
      const loc = group.locations[i];
      if (existingLocationKeys.has(loc.locationKey)) continue;

      const isMain = hasNoLocationsYet && i === 0;
      const locationName = isMain
        ? `${group.displayName} (Main)`
        : `${group.displayName} - ${loc.city || "Alternate"}`;

      await apiRequest(`/businesses/${businessId}/locations`, {
        method: "POST",
        token: login.access_token,
        body: {
          location_name: locationName,
          address_line: loc.addressLine,
          city: loc.city || "Tirana",
          region: loc.region || "Tirane",
          country: loc.country || "Albania"
        }
      });

      existingLocationKeys.add(loc.locationKey);
      createdLocations += 1;
      await sleep(API_DELAY_MS);
    }

    if (existingByCanonical.size >= BUSINESS_TARGET) {
      break;
    }
  }

  const finalBusinesses = await fetchAllBusinesses();
  console.log(
    JSON.stringify(
      {
        google_calls: collected.googleCalls,
        queries_executed: collected.queriesExecuted,
        unique_places_collected: collected.rows.length,
        grouped_businesses_available: grouped.length,
        existing_businesses_before: existingTotal,
        businesses_created: createdBusinesses,
        businesses_reused: reusedBusinesses,
        locations_created: createdLocations,
        businesses_total_after: finalBusinesses.length,
        target: BUSINESS_TARGET,
        target_reached: finalBusinesses.length >= BUSINESS_TARGET
      },
      null,
      2
    )
  );
};

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
