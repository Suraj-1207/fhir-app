import { NextResponse } from "next/server";
import { getPatientRecords } from "@/lib/data-loader";
import { getPatientName } from "@/lib/clinical-helpers";
import { assessEligibility } from "@/lib/eligibility";
import { FHIRCondition, FHIRProcedure } from "@/lib/types";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const records = getPatientRecords();
  const record = records.get(id);

  if (!record) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const eligibility = assessEligibility(record);

  // Filter conditions to active only for the clinical snapshot
  const activeConditions = record.conditions.filter(
    (c: FHIRCondition) => c.clinicalStatus?.coding?.some((s) => s.code === "active") ?? true
  );

  // Sort all procedures by date descending — snapshot slices to 5, timeline uses all
  const sortedProcedures = [...record.procedures]
    .sort((a: FHIRProcedure, b: FHIRProcedure) => {
      const da = a.performedDateTime ?? a.performedPeriod?.start ?? "";
      const db = b.performedDateTime ?? b.performedPeriod?.start ?? "";
      return db.localeCompare(da);
    });

  return NextResponse.json({
    id,
    name: getPatientName(record.patient),
    gender: record.patient.gender ?? "Unknown",
    birthDate: record.patient.birthDate ?? null,
    conditionCount: record.conditions.length,
    observationCount: record.observations.length,
    procedureCount: record.procedures.length,
    eligibility,
    patient: record.patient,
    conditions: activeConditions,
    observations: record.observations,
    procedures: sortedProcedures,
  });
}
