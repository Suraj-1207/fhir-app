import {
  FHIRResource,
  FHIRPatient,
  FHIRCondition,
  FHIRObservation,
  FHIRProcedure,
  PatientRecord,
  BenchmarkResult,
} from "./types";

/**
 * Parse NDJSON string into array of FHIR resources.
 * Safely handles blank lines and malformed JSON.
 */
export function parseNDJSON(raw: string): FHIRResource[] {
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line, i) => {
      try {
        return JSON.parse(line) as FHIRResource;
      } catch {
        console.warn(`Skipping malformed NDJSON line ${i}`);
        return null;
      }
    })
    .filter((r): r is FHIRResource => r !== null);
}

/**
 * Extract patient ID from a FHIR reference string like "Patient/123"
 */
function resolvePatientRef(ref?: string | null): string | null {
  if (!ref) return null;
  // Handle "Patient/abc-123" or "urn:uuid:abc-123" patterns
  if (ref.startsWith("Patient/")) return ref.replace("Patient/", "");
  if (ref.startsWith("urn:uuid:")) return ref.replace("urn:uuid:", "");
  return ref;
}

function getSubjectRef(resource: FHIRResource): string | null {
  const subj =
    (resource as FHIRCondition).subject?.reference ??
    (resource as FHIRObservation).subject?.reference ??
    (resource as FHIRProcedure).subject?.reference ??
    null;
  return resolvePatientRef(subj);
}

// ─── Naive O(n²) approach (for benchmarking only) ───

export function groupByPatientNaive(
  resources: FHIRResource[]
): Map<string, PatientRecord> {
  const patients = resources.filter(
    (r) => r.resourceType === "Patient"
  ) as FHIRPatient[];
  const result = new Map<string, PatientRecord>();

  for (const p of patients) {
    // For each patient, scan ALL resources to find matches
    const conditions = resources.filter(
      (r) =>
        r.resourceType === "Condition" && getSubjectRef(r) === p.id
    ) as FHIRCondition[];

    const observations = resources.filter(
      (r) =>
        r.resourceType === "Observation" && getSubjectRef(r) === p.id
    ) as FHIRObservation[];

    const procedures = resources.filter(
      (r) =>
        r.resourceType === "Procedure" && getSubjectRef(r) === p.id
    ) as FHIRProcedure[];

    result.set(p.id, { patient: p, conditions, observations, procedures });
  }

  return result;
}

// ─── Optimized O(n) indexed approach ───

export function groupByPatientIndexed(
  resources: FHIRResource[]
): Map<string, PatientRecord> {
  // Single pass: build index by patient ID
  const patients = new Map<string, FHIRPatient>();
  const conditionsByPatient = new Map<string, FHIRCondition[]>();
  const observationsByPatient = new Map<string, FHIRObservation[]>();
  const proceduresByPatient = new Map<string, FHIRProcedure[]>();

  for (const resource of resources) {
    switch (resource.resourceType) {
      case "Patient": {
        const p = resource as FHIRPatient;
        patients.set(p.id, p);
        break;
      }
      case "Condition": {
        const c = resource as FHIRCondition;
        const pid = getSubjectRef(c);
        if (pid) {
          if (!conditionsByPatient.has(pid)) conditionsByPatient.set(pid, []);
          conditionsByPatient.get(pid)!.push(c);
        }
        break;
      }
      case "Observation": {
        const o = resource as FHIRObservation;
        const pid = getSubjectRef(o);
        if (pid) {
          if (!observationsByPatient.has(pid))
            observationsByPatient.set(pid, []);
          observationsByPatient.get(pid)!.push(o);
        }
        break;
      }
      case "Procedure": {
        const pr = resource as FHIRProcedure;
        const pid = getSubjectRef(pr);
        if (pid) {
          if (!proceduresByPatient.has(pid))
            proceduresByPatient.set(pid, []);
          proceduresByPatient.get(pid)!.push(pr);
        }
        break;
      }
    }
  }

  // Assemble patient records via O(1) lookups
  const result = new Map<string, PatientRecord>();
  for (const [id, patient] of patients) {
    result.set(id, {
      patient,
      conditions: conditionsByPatient.get(id) ?? [],
      observations: observationsByPatient.get(id) ?? [],
      procedures: proceduresByPatient.get(id) ?? [],
    });
  }

  return result;
}

// ─── Benchmark helper ───

export function benchmark(resources: FHIRResource[]): BenchmarkResult {
  const t0 = performance.now();
  const naiveResult = groupByPatientNaive(resources);
  const t1 = performance.now();
  const indexedResult = groupByPatientIndexed(resources);
  const t2 = performance.now();

  const naiveMs = Math.round((t1 - t0) * 100) / 100;
  const indexedMs = Math.round((t2 - t1) * 100) / 100;
  const speedup =
    indexedMs > 0 ? `${(naiveMs / indexedMs).toFixed(1)}x` : "N/A";

  console.log(`[Benchmark] ${resources.length} resources, ${naiveResult.size} patients`);
  console.log(`  Naive:   ${naiveMs}ms`);
  console.log(`  Indexed: ${indexedMs}ms`);
  console.log(`  Speedup: ${speedup}`);

  return {
    naiveMs,
    indexedMs,
    speedup,
    resourceCount: resources.length,
    patientCount: indexedResult.size,
  };
}
