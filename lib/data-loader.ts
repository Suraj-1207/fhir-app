import fs from "fs";
import path from "path";
import {
  FHIRResource,
  PatientRecord,
  CohortReport,
  BenchmarkResult,
} from "./types";
import {
  parseNDJSON,
  groupByPatientIndexed,
  benchmark,
} from "./fhir-parser";
import { generateCohortReport } from "./eligibility";
// re-export BenchmarkResult from types
export type { BenchmarkResult } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");

// Only resource types needed for eligibility logic — skip the rest to avoid
// loading 1.6 GB of data we never use (DiagnosticReport, Encounter, etc.)
const RELEVANT_PREFIXES = ["Patient", "Condition", "Observation", "Procedure"];

let cachedRecords: Map<string, PatientRecord> | null = null;
let cachedBenchmark: BenchmarkResult | null = null;

function loadAllResources(): FHIRResource[] {
  const allResources: FHIRResource[] = [];

  if (!fs.existsSync(DATA_DIR)) {
    console.warn(`Data directory not found: ${DATA_DIR}`);
    return allResources;
  }

  const files = fs.readdirSync(DATA_DIR).filter(
    (f) =>
      (f.endsWith(".ndjson") || f.endsWith(".json")) &&
      RELEVANT_PREFIXES.some((prefix) => f.startsWith(prefix))
  );

  for (const file of files) {
    const filePath = path.join(DATA_DIR, file);
    const raw = fs.readFileSync(filePath, "utf-8");

    if (file.endsWith(".ndjson")) {
      allResources.push(...parseNDJSON(raw));
    } else {
      // Might be a Bundle JSON
      try {
        const parsed = JSON.parse(raw);
        if (parsed.resourceType === "Bundle" && Array.isArray(parsed.entry)) {
          for (const entry of parsed.entry) {
            if (entry.resource) {
              allResources.push(entry.resource as FHIRResource);
            }
          }
        } else if (parsed.resourceType) {
          allResources.push(parsed as FHIRResource);
        }
      } catch {
        console.warn(`Could not parse ${file}`);
      }
    }
  }

  return allResources;
}

export function getPatientRecords(): Map<string, PatientRecord> {
  if (cachedRecords) return cachedRecords;

  const resources = loadAllResources();
  cachedRecords = groupByPatientIndexed(resources);
  return cachedRecords;
}

export function getBenchmark(): BenchmarkResult {
  if (cachedBenchmark) return cachedBenchmark;

  const allResources = loadAllResources();

  // Files load alphabetically (Condition → Observation → Patient → Procedure),
  // so a head-slice would contain zero Patient resources, making the naive
  // algorithm do nothing and defeating the benchmark. Instead, build a sample
  // that always includes all patients plus a proportional slice of other
  // resources — large enough that O(n²) complexity is clearly visible.
  const SAMPLE_SIZE = 20_000;
  const patients = allResources.filter((r) => r.resourceType === "Patient");
  const others = allResources.filter((r) => r.resourceType !== "Patient");
  const sample = [...patients, ...others].slice(0, SAMPLE_SIZE);

  cachedBenchmark = benchmark(sample);
  cachedBenchmark.resourceCount = allResources.length;
  return cachedBenchmark;
}

export function getCohortReport(): CohortReport {
  const records = getPatientRecords();
  return generateCohortReport(records);
}

// Clear cache (useful for hot-reload in dev)
export function clearCache() {
  cachedRecords = null;
  cachedBenchmark = null;
}
