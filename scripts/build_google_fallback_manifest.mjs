import fs from "fs";
import path from "path";
import process from "process";
import dotenv from "dotenv";

const ROOT = path.resolve(process.cwd(), "..");
const ENV_PATHS = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(ROOT, "apps/api/.env"),
  path.resolve(ROOT, ".env")
];

for (const envPath of ENV_PATHS) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const OUTPUT_PATH = path.resolve(ROOT, "data/google_place_fallbacks.json");

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

const parseImportedGoogleScore = (description = "") => {
  const match = String(description).match(/rating\s+([0-5](?:\.\d+)?)\s+with\s+(\d+)\s+reviews?/i);
  if (!match) return null;
  const rating = Number(match[1]);
  const count = Number(match[2]);
  if (!Number.isFinite(rating) || !Number.isFinite(count)) return null;
  return {
    rating: Math.max(0, Math.min(5, rating)),
    rating_count: Math.max(0, Math.round(count))
  };
};

const supabaseRequest = async (route) => {
  const response = await fetch(`${SUPABASE_URL}/rest/v1${route}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  });

  const payload = await response.json().catch(() => []);
  if (!response.ok) {
    throw new Error(`Supabase GET ${route} failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
};

const fetchImportedBusinesses = async () => {
  const pageSize = 1000;
  const rows = [];
  let offset = 0;

  while (true) {
    const page = await supabaseRequest(
      `/businesses?select=id,name,owner_name,description,status&owner_name=eq.Imported%20Listing&status=eq.active&limit=${pageSize}&offset=${offset}`
    );
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  return rows;
};

const main = async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const businesses = await fetchImportedBusinesses();
  const items = businesses
    .map((business) => {
      const parsed = parseImportedGoogleScore(business.description || "");
      const canonical_name = canonicalBusinessName(business.name || "");
      if (!parsed || !canonical_name) return null;
      return {
        canonical_name,
        display_name: business.name,
        rating: parsed.rating,
        rating_count: parsed.rating_count
      };
    })
    .filter(Boolean);

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        items
      },
      null,
      2
    )
  );

  console.log(`Wrote ${items.length} fallback records to ${OUTPUT_PATH}`);
};

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
