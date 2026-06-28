import {
  FHIRPatient,
  FHIRObservation,
  PatientRecord,
  TimelineEntry,
} from "./types";

function cleanNamePart(part: string): string {
  return part.replace(/\d+/g, "").trim();
}

export function getPatientName(patient: FHIRPatient): string {
  const name = patient.name?.[0];
  if (!name) return "Unknown Name";
  const given = name.given?.map(cleanNamePart).filter(Boolean).join(" ") ?? "";
  const family = cleanNamePart(name.family ?? "");
  return `${given} ${family}`.trim() || "Unknown Name";
}

export function getPatientAge(patient: FHIRPatient): string {
  if (!patient.birthDate) return "Unknown";
  const birth = new Date(patient.birthDate);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return `${age}`;
}

export function getActiveConditions(record: PatientRecord): string[] {
  return record.conditions
    .filter(
      (c) =>
        c.clinicalStatus?.coding?.some((s) => s.code === "active") ?? true
    )
    .map(
      (c) =>
        c.code?.coding?.[0]?.display ?? c.code?.text ?? "Unknown condition"
    );
}

const BMI_LOINC = "39156-5";
const BP_SYSTOLIC_LOINC = "8480-6";
const BP_DIASTOLIC_LOINC = "8462-4";
const BP_PANEL_LOINC = "85354-9";

export function getLatestBMI(
  observations: FHIRObservation[]
): { value: number; date: string; id: string } | null {
  const bmiObs = observations
    .filter(
      (o) =>
        o.code?.coding?.some((c) => c.code === BMI_LOINC) ||
        o.code?.text?.toLowerCase()?.includes("bmi") ||
        o.code?.coding?.some((c) =>
          c.display?.toLowerCase()?.includes("body mass index")
        )
    )
    .sort((a, b) => {
      const da = a.effectiveDateTime ?? "";
      const db = b.effectiveDateTime ?? "";
      return db.localeCompare(da);
    });

  if (bmiObs.length === 0) return null;
  const val = bmiObs[0].valueQuantity?.value;
  if (val == null) return null;

  return {
    value: Math.round(val * 10) / 10,
    date: bmiObs[0].effectiveDateTime ?? "Unknown date",
    id: bmiObs[0].id,
  };
}

export function getLatestBP(
  observations: FHIRObservation[]
): { systolic: number; diastolic: number; date: string; id: string } | null {
  // Try BP panel first
  const bpObs = observations
    .filter(
      (o) =>
        o.code?.coding?.some((c) => c.code === BP_PANEL_LOINC) ||
        o.code?.text?.toLowerCase()?.includes("blood pressure")
    )
    .sort((a, b) => {
      const da = a.effectiveDateTime ?? "";
      const db = b.effectiveDateTime ?? "";
      return db.localeCompare(da);
    });

  if (bpObs.length > 0) {
    const bp = bpObs[0];
    const sys = bp.component?.find((c) =>
      c.code?.coding?.some((cd) => cd.code === BP_SYSTOLIC_LOINC)
    )?.valueQuantity?.value;
    const dia = bp.component?.find((c) =>
      c.code?.coding?.some((cd) => cd.code === BP_DIASTOLIC_LOINC)
    )?.valueQuantity?.value;

    if (sys != null && dia != null) {
      return {
        systolic: sys,
        diastolic: dia,
        date: bp.effectiveDateTime ?? "Unknown date",
        id: bp.id,
      };
    }
  }

  return null;
}

export function getRecentProcedures(
  record: PatientRecord,
  limit = 5
): Array<{ name: string; date: string; id: string }> {
  return record.procedures
    .map((p) => ({
      name:
        p.code?.coding?.[0]?.display ?? p.code?.text ?? "Unknown procedure",
      date:
        p.performedDateTime ??
        p.performedPeriod?.start ??
        "Unknown date",
      id: p.id,
    }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

export function buildTimeline(record: PatientRecord): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const obs of record.observations) {
    entries.push({
      type: "observation",
      displayName:
        obs.code?.coding?.[0]?.display ??
        obs.code?.text ??
        "Unknown observation",
      date: obs.effectiveDateTime ?? obs.issued ?? "Unknown date",
      resourceId: `Observation/${obs.id}`,
    });
  }

  for (const proc of record.procedures) {
    entries.push({
      type: "procedure",
      displayName:
        proc.code?.coding?.[0]?.display ??
        proc.code?.text ??
        "Unknown procedure",
      date:
        proc.performedDateTime ??
        proc.performedPeriod?.start ??
        "Unknown date",
      resourceId: `Procedure/${proc.id}`,
    });
  }

  return entries.sort((a, b) => b.date.localeCompare(a.date));
}
