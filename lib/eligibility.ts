import {
  PatientRecord,
  EligibilityResult,
  EligibilityStatus,
  ChecklistItem,
  CohortReport,
} from "./types";
import { getLatestBMI } from "./clinical-helpers";

// Comorbidity terms — must match the SNOMED display names used in this dataset
const COMORBIDITY_TERMS = [
  "hypertension",
  "type 2 diabetes",
  "diabetes mellitus",
  "prediabetes",
  "obstructive sleep apnea",
  "sleep apnea",
  "hyperlipidemia",
  "coronary artery disease",
  "ischemic heart disease",
  "heart disease",
  "osteoarthritis",
  "gastroesophageal reflux",
  "gerd",
  "chronic obstructive",   // COPD
  "metabolic syndrome",
  "hyperglycemia",
  "dyslipidemia",
];

// Keywords for required documentation
const WEIGHT_LOSS_TERMS = [
  "weight loss",
  "weight management",
  "diet",
  "nutrition counseling",
  "bariatric",
  "obesity management",
  "weight reduction",
  "lifestyle modification",
  "obes",            // matches "obese", "obesity", "severely obese" — clinically addressed weight
  "overweight",
  "physical activity",
  "exercise therapy",
  "movement therapy",
  "caloric",
];

const PSYCH_EVAL_TERMS = [
  "psychological evaluation",
  "psych evaluation",
  "psychiatric evaluation",
  "mental health assessment",
  "psychological assessment",
  "behavioral health",
  "psychiatric assessment",
  "psycholog",
  // Validated screening instruments count as psychological evaluations
  "phq",            // PHQ-2, PHQ-9 depression screens
  "gad",            // GAD-7 anxiety screen
  "depression screening",
  "assessment of anxiety",
  "mental health",
  "behavioral health",
  "substance use",  // substance use assessment is part of psych eval
  "audit",          // AUDIT alcohol screening
  "dast",           // DAST drug screening
];


function hasComorbidity(
  record: PatientRecord
): { found: boolean; evidence: string[] } {
  const evidence: string[] = [];

  for (const cond of record.conditions) {
    const isActive = cond.clinicalStatus?.coding?.some(
      (c) => c.code === "active"
    ) ?? true; // if no status, assume active conservatively

    const displayTexts = [
      cond.code?.text ?? "",
      ...(cond.code?.coding?.map((c) => c.display ?? "") ?? []),
    ]
      .join(" ")
      .toLowerCase();

    if (COMORBIDITY_TERMS.some((term) => displayTexts.includes(term)) && isActive) {
      evidence.push(`Condition/${cond.id}`);
    }
  }

  return { found: evidence.length > 0, evidence };
}

function hasDocumentation(
  record: PatientRecord,
  terms: string[]
): { found: boolean; evidence: string[] } {
  const evidence: string[] = [];

  // Check procedures
  for (const proc of record.procedures) {
    const text = [
      proc.code?.text ?? "",
      ...(proc.code?.coding?.map((c) => c.display ?? "") ?? []),
    ]
      .join(" ")
      .toLowerCase();

    if (terms.some((t) => text.includes(t))) {
      evidence.push(`Procedure/${proc.id}`);
    }
  }

  // Check conditions for psych eval evidence
  for (const cond of record.conditions) {
    const text = [
      cond.code?.text ?? "",
      ...(cond.code?.coding?.map((c) => c.display ?? "") ?? []),
    ]
      .join(" ")
      .toLowerCase();

    if (terms.some((t) => text.includes(t))) {
      evidence.push(`Condition/${cond.id}`);
    }
  }

  // Check observations
  for (const obs of record.observations) {
    const text = [
      obs.code?.text ?? "",
      ...(obs.code?.coding?.map((c) => c.display ?? "") ?? []),
    ]
      .join(" ")
      .toLowerCase();

    if (terms.some((t) => text.includes(t))) {
      evidence.push(`Observation/${obs.id}`);
    }
  }

  return { found: evidence.length > 0, evidence };
}

export function assessEligibility(record: PatientRecord): EligibilityResult {
  const checklist: ChecklistItem[] = [];
  const reasons: string[] = [];

  // 1. BMI check
  const bmi = getLatestBMI(record.observations);
  if (!bmi) {
    checklist.push({
      requirement: "BMI threshold",
      status: "unknown",
      evidence: [],
    });
    reasons.push("No BMI observation found");
  } else if (bmi.value >= 40) {
    checklist.push({
      requirement: "BMI threshold (≥40)",
      status: "met",
      evidence: [`Observation/${bmi.id}`],
    });
  } else if (bmi.value >= 35) {
    checklist.push({
      requirement: "BMI threshold (≥35 with comorbidity)",
      status: "met",
      evidence: [`Observation/${bmi.id}`],
    });
  } else {
    checklist.push({
      requirement: "BMI threshold",
      status: "not met",
      evidence: [`Observation/${bmi.id}`],
    });
  }

  // 2. Comorbidity check (only relevant for BMI 35-39.9)
  const comorbidity = hasComorbidity(record);
  if (bmi && bmi.value >= 35 && bmi.value < 40) {
    checklist.push({
      requirement: "Comorbidity present (required for BMI 35-39.9)",
      status: comorbidity.found ? "met" : "not met",
      evidence: comorbidity.evidence,
    });
    if (!comorbidity.found) {
      reasons.push("BMI between 35-40 but no qualifying comorbidity found");
    }
  } else if (bmi && bmi.value >= 40 && comorbidity.found) {
    // BMI ≥40 doesn't require comorbidity but show it as supporting context
    checklist.push({
      requirement: "Comorbidity present (additional supporting evidence)",
      status: "met",
      evidence: comorbidity.evidence,
    });
  }

  // 3. Prior weight-loss attempts
  const weightLoss = hasDocumentation(record, WEIGHT_LOSS_TERMS);
  checklist.push({
    requirement: "Prior weight-loss attempts documented",
    status: weightLoss.found ? "met" : "unknown",
    evidence: weightLoss.evidence,
  });
  if (!weightLoss.found) {
    reasons.push("No evidence of prior weight-loss attempts");
  }

  // 4. Psychological evaluation
  const psychEval = hasDocumentation(record, PSYCH_EVAL_TERMS);
  checklist.push({
    requirement: "Psychological evaluation",
    status: psychEval.found ? "met" : "unknown",
    evidence: psychEval.evidence,
  });
  if (!psychEval.found) {
    reasons.push("No evidence of psychological evaluation");
  }

  // Determine final status
  let status: EligibilityStatus;

  const bmiMet =
    bmi !== null &&
    (bmi.value >= 40 || (bmi.value >= 35 && comorbidity.found));
  const docsMet = weightLoss.found && psychEval.found;

  if (!bmi) {
    status = "unknown";
  } else if (bmi.value < 35) {
    status = "not eligible";
  } else if (!bmiMet) {
    // BMI 35-40 without comorbidity
    status = "not eligible";
  } else if (!docsMet) {
    // BMI criteria met but docs missing
    status = "unknown";
  } else {
    status = "eligible";
  }

  return {
    patientId: record.patient.id,
    status,
    reasons,
    checklist,
  };
}

export function generateCohortReport(
  records: Map<string, PatientRecord>
): CohortReport {
  const results: EligibilityResult[] = [];

  for (const record of records.values()) {
    results.push(assessEligibility(record));
  }

  const total = results.length;
  const eligibleCount = results.filter((r) => r.status === "eligible").length;
  const notEligibleCount = results.filter(
    (r) => r.status === "not eligible"
  ).length;
  const unknownCount = results.filter((r) => r.status === "unknown").length;

  // Tally unknown reasons
  const reasonCounts = new Map<string, number>();
  for (const r of results) {
    if (r.status === "unknown") {
      for (const reason of r.reasons) {
        reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
      }
    }
  }

  const topUnknownReasons = Array.from(reasonCounts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  const pct = (n: number) => Math.round((n / total) * 1000) / 10;

  return {
    totalPatients: total,
    eligible: { count: eligibleCount, percentage: pct(eligibleCount) },
    notEligible: { count: notEligibleCount, percentage: pct(notEligibleCount) },
    unknown: { count: unknownCount, percentage: pct(unknownCount) },
    topUnknownReasons,
  };
}
