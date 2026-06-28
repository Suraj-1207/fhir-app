import { NextResponse } from "next/server";
import { getPatientRecords } from "@/lib/data-loader";
import { getPatientName } from "@/lib/clinical-helpers";
import { assessEligibility } from "@/lib/eligibility";

export async function GET() {
  const records = getPatientRecords();

  const patients = Array.from(records.entries()).map(([id, record]) => {
    const eligibility = assessEligibility(record);
    return {
      id,
      name: getPatientName(record.patient),
      gender: record.patient.gender ?? "Unknown",
      birthDate: record.patient.birthDate ?? null,
      conditionCount: record.conditions.length,
      observationCount: record.observations.length,
      procedureCount: record.procedures.length,
      eligibility,
    };
  });

  return NextResponse.json({ patients });
}
