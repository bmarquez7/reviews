import fs from "fs";
import path from "path";
import Parser from "rss-parser";
import ical from "node-ical";
import "dotenv/config";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SOURCES_FILE = process.env.SOURCES_FILE || "../data/sources.txt";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const parser = new Parser();

async function insertEvents(events) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/events`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates"
    },
    body: JSON.stringify(events)
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("Insert failed", text);
  } else {
    console.log(`Inserted ${events.length} events`);
  }
}

function mapRssItem(item, sourceUrl) {
  const start = item.isoDate || item.pubDate || new Date().toISOString();
  return {
    status: "pending",
    title_en: item.title || "Untitled",
    description_en: item.contentSnippet || item.content || "",
    location_en: item.creator || item.author || "",
    event_type: "Community",
    area: "Skanderbeg Square",
    event_language: ["en"],
    date_start: start,
    date_end: null,
    price_type: "Paid",
    currency: "ALL",
    ticket_url: item.link || null,
    source_url: sourceUrl
  };
}

function mapIcsEvent(item, sourceUrl) {
  const start = item.start?.toISOString?.() || new Date().toISOString();
  return {
    status: "pending",
    title_en: item.summary || "Untitled",
    description_en: item.description || "",
    location_en: item.location || "",
    event_type: "Community",
    area: "Skanderbeg Square",
    event_language: ["en"],
    date_start: start,
    date_end: item.end?.toISOString?.() || null,
    price_type: "Paid",
    currency: "ALL",
    ticket_url: item.url || null,
    source_url: sourceUrl
  };
}

async function loadSources() {
  const resolved = path.resolve(process.cwd(), SOURCES_FILE);
  if (!fs.existsSync(resolved)) {
    console.error(`Sources file not found: ${resolved}`);
    process.exit(1);
  }
  return fs
    .readFileSync(resolved, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

async function main() {
  const sources = await loadSources();
  for (const url of sources) {
    if (url.endsWith(".ics")) {
      const data = await ical.async.fromURL(url);
      const events = Object.values(data)
        .filter((item) => item.type === "VEVENT")
        .map((item) => mapIcsEvent(item, url));
      if (events.length) await insertEvents(events);
    } else {
      const feed = await parser.parseURL(url);
      const events = (feed.items || []).map((item) => mapRssItem(item, url));
      if (events.length) await insertEvents(events);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
