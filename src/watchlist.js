import fs from "fs";
import { CAR_WATCHLIST_FILE } from "./paths.js";
import { inferTargetType } from "./target-utils.js";

export const DEFAULT_WATCHLIST = [
  {
    id: "honda-civic-2016-2021",
    label: "Honda Civic 2016-2021",
    group: "Reliable Sedans",
    enabled: true,
    make: "Honda",
    model: "Civic",
    aliases: ["honda civic", "civic sport", "civic touring", "civic ex"],
    query: "Honda Civic",
    yearStart: 2016,
    yearEnd: 2021,
    retailBase: 14500,
    baselineYear: 2019,
    yearlyAdjustment: 900,
    baselineMiles: 85000,
    mileagePenaltyPer10k: 450,
    mileageBonusPer10k: 225,
    maxMileage: 145000,
    feesReserve: 650,
    reconBase: 900,
    marginFloor: 2200,
    customPrompt: "Prefer clean-title commuter trims with strong retail demand and straightforward resale.",
    mustInclude: [],
    trimBoostKeywords: ["touring", "sport touring", "si"],
    avoidKeywords: ["salvage", "rebuilt", "mechanic special", "flood", "frame damage", "parts only"],
  },
  {
    id: "toyota-camry-2015-2021",
    label: "Toyota Camry 2015-2021",
    group: "Reliable Sedans",
    enabled: true,
    make: "Toyota",
    model: "Camry",
    aliases: ["toyota camry", "camry se", "camry xse", "camry xle"],
    query: "Toyota Camry",
    yearStart: 2015,
    yearEnd: 2021,
    retailBase: 17250,
    baselineYear: 2019,
    yearlyAdjustment: 950,
    baselineMiles: 90000,
    mileagePenaltyPer10k: 425,
    mileageBonusPer10k: 200,
    maxMileage: 155000,
    feesReserve: 700,
    reconBase: 950,
    marginFloor: 2500,
    customPrompt: "Focus on clean-title Camrys with strong family-car demand and low cosmetic risk.",
    mustInclude: [],
    trimBoostKeywords: ["xse", "xle", "trd"],
    avoidKeywords: ["salvage", "rebuilt", "engine knock", "transmission slip", "flood", "parts only"],
  }
];

function normalizeWatchlistEntry(entry) {
  const targetType = inferTargetType(entry);
  const mustAvoid = Array.isArray(entry?.mustAvoid)
    ? entry.mustAvoid
    : Array.isArray(entry?.avoidKeywords)
    ? entry.avoidKeywords
    : [];
  const yearStart = normalizeYear(entry?.yearStart);
  const yearEnd = normalizeYear(entry?.yearEnd);
  const baselineYear = normalizeYear(entry?.baselineYear);

  const normalized = {
    group: "General",
    enabled: true,
    targetType,
    aliases: [],
    mustInclude: [],
    mustAvoid,
    customPrompt: "",
    notes: "",
    ...entry,
    targetType: inferTargetType({ targetType, ...entry }),
    aliases: Array.isArray(entry?.aliases) ? entry.aliases.filter(Boolean) : [],
    mustInclude: Array.isArray(entry?.mustInclude) ? entry.mustInclude.filter(Boolean) : [],
    mustAvoid,
  };

  if (targetType === "vehicle") {
    if (yearStart) normalized.yearStart = yearStart;
    else delete normalized.yearStart;
    if (yearEnd) normalized.yearEnd = yearEnd;
    else delete normalized.yearEnd;
    if (baselineYear) normalized.baselineYear = baselineYear;
    else if (yearStart) normalized.baselineYear = yearStart;
    else delete normalized.baselineYear;
  } else {
    delete normalized.yearStart;
    delete normalized.yearEnd;
    delete normalized.baselineYear;
    normalized.baselineMiles = 0;
    normalized.mileagePenaltyPer10k = 0;
    normalized.mileageBonusPer10k = 0;
    normalized.maxMileage = 0;
  }

  return normalized;
}

function normalizeYear(value) {
  const year = Number(value);
  if (!Number.isFinite(year)) return null;
  if (year < 1990 || year > 2055) return null;
  return Math.round(year);
}

export function ensureWatchlistFile() {
  if (!fs.existsSync(CAR_WATCHLIST_FILE)) {
    fs.writeFileSync(CAR_WATCHLIST_FILE, JSON.stringify(DEFAULT_WATCHLIST, null, 2), "utf8");
  }
}

export function loadWatchlist() {
  ensureWatchlistFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(CAR_WATCHLIST_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed.map(normalizeWatchlistEntry) : DEFAULT_WATCHLIST.map(normalizeWatchlistEntry);
  } catch {
    return DEFAULT_WATCHLIST.map(normalizeWatchlistEntry);
  }
}