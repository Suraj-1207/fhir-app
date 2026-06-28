import { NextResponse } from "next/server";
import { getPatientRecords } from "@/lib/data-loader";
import { assessEligibility } from "@/lib/eligibility";
import { getPatientAge, getLatestBMI } from "@/lib/clinical-helpers";
import { AIAssistResult, PatientRecord } from "@/lib/types";

interface GroundedFact {
  display: string;
  resourceId: string;
}

interface PatientFacts {
  age: string;
  sex: string;
  bmi: { value: number; resourceId: string } | null;
  activeConditions: GroundedFact[];
}

// Phrases indicating unsupported inference or editorial opinion — responses containing these are rejected
const DISALLOWED_PHRASES = [
  "likely", "probably", "implied", "presumably",
  "appears to", "seems to", "may have", "might have",
  "suggest", "could indicate",
  "warrant further", "warrants further", "further evaluation",
  "complex decision", "difficult decision",
  "immediate attention", "urgent", "urgently",
  "requiring attention", "requires attention",
  "should be", "must be", "needs to be",
  "assess candidacy",
];

function extractFacts(record: PatientRecord): PatientFacts {
  const bmi = getLatestBMI(record.observations);

  const activeConditions: GroundedFact[] = record.conditions
    .filter((c) => c.clinicalStatus?.coding?.some((s) => s.code === "active") ?? true)
    .map((c) => ({
      display: c.code?.coding?.[0]?.display ?? c.code?.text ?? "Unknown condition",
      resourceId: `Condition/${c.id}`,
    }));

  return {
    age: getPatientAge(record.patient),
    sex: record.patient.gender ?? "unknown",
    bmi: bmi ? { value: bmi.value, resourceId: `Observation/${bmi.id}` } : null,
    activeConditions,
  };
}

// Always-grounded summary built from real FHIR values — used when AI is unavailable or invalid
function buildDeterministicSummary(facts: PatientFacts, status: string): string {
  const bmiPart = facts.bmi
    ? `BMI ${facts.bmi.value} (${facts.bmi.resourceId})`
    : "BMI not recorded";

  const condPart =
    facts.activeConditions.length > 0
      ? `Active conditions: ${facts.activeConditions
          .map((c) => `${c.display} (${c.resourceId})`)
          .join(", ")}.`
      : "No active conditions recorded.";

  return `${facts.age}-year-old ${facts.sex}. ${bmiPart}. ${condPart} Eligibility status: ${status}.`;
}

function buildPrompt(facts: PatientFacts, status: string, reasons: string[]): string {
  const bmiLine = facts.bmi ? `${facts.bmi.value}` : "not recorded";
  const condLine =
    facts.activeConditions.length > 0
      ? facts.activeConditions.map((c) => c.display).join(", ")
      : "none recorded";
  const missingLine = reasons.length > 0 ? reasons.join("; ") : "all criteria met";

  // Sentence-by-sentence structure prevents the model from stopping after one sentence.
  // The example is fully grounded — only facts present in the example data appear in the output.
  return `You are writing a structured 3-sentence clinical summary for a bariatric surgery prior authorization record.

Each sentence has a fixed role:
  Sentence 1 — Demographics and conditions: State the patient's age, sex, BMI, and active conditions. Nothing else.
  Sentence 2 — Eligibility criteria: State which criteria are met and which are not, using the data provided.
  Sentence 3 — Missing documentation: State exactly what is missing from the record, or confirm all criteria are met.

Rules: Use only the values below. Do not add clinical opinions, urgency, or anything not listed.

PATIENT DATA:
  Age: ${facts.age} years old
  Sex: ${facts.sex}
  BMI: ${bmiLine}
  Active conditions: ${condLine}
  Eligibility status: ${status}
  Unmet criteria: ${missingLine}

EXAMPLE — follow this structure exactly (different patient, do not copy values):
Patient data: Age 61 | Sex female | BMI 42.7 | Conditions: hypertension, type 2 diabetes | Eligibility: unknown | Unmet criteria: No evidence of prior weight-loss attempts
Output: {"clinicalSummary": "A 61-year-old female with a BMI of 42.7 and active diagnoses of hypertension and type 2 diabetes. The BMI threshold criterion (≥40) is met; comorbidities are present as supporting evidence. Documentation of prior weight-loss attempts was not found in the record."}

Now write the 3-sentence summary for the PATIENT DATA above.
Output:`;
}

// Reject AI responses that don't meet grounding requirements
function validateAISummary(summary: string, facts: PatientFacts): boolean {
  if (!summary || typeof summary !== "string") return false;
  if (summary.length < 40 || summary.length > 600) return false;
  if (summary.includes("[")) return false; // unfilled placeholders

  const lower = summary.toLowerCase();
  if (DISALLOWED_PHRASES.some((w) => lower.includes(w))) return false;

  // Must reference at least one concrete patient-specific value
  const hasAge = facts.age !== "Unknown" && summary.includes(facts.age);
  const hasBMI = facts.bmi != null && summary.includes(String(facts.bmi.value));
  return hasAge || hasBMI;
}

async function callOllama(prompt: string): Promise<string> {
  const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
  const ollamaModel = process.env.OLLAMA_MODEL || "llama3.1:8b";

  const res = await fetch(`${ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ollamaModel,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      format: "json",
    }),
  });

  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  const data = await res.json();
  return data.message?.content ?? "";
}

async function callAnthropic(prompt: string, apiKey: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
  const data = await res.json();
  return (
    data.content
      ?.map((block: { type: string; text?: string }) =>
        block.type === "text" ? block.text : ""
      )
      .join("")
      .trim() ?? ""
  );
}

function buildNextSteps(reasons: string[]): string[] {
  if (reasons.length === 0) return ["No additional documentation required — all criteria met."];
  return reasons.map((r) => {
    if (r.includes("BMI")) return "Obtain a documented BMI measurement.";
    if (r.includes("weight-loss")) return "Obtain documentation of prior weight-loss attempts or supervised diet programs.";
    if (r.includes("psychological")) return "Obtain documentation of a psychological or behavioral health evaluation.";
    if (r.includes("comorbidity")) return "Obtain documentation of a qualifying comorbidity (e.g., hypertension, type 2 diabetes, sleep apnea).";
    return r;
  });
}

export async function POST(request: Request) {
  let patientId: string | undefined;

  try {
    ({ patientId } = await request.json());
    if (!patientId) {
      return NextResponse.json({ error: "patientId is required" }, { status: 400 });
    }

    const records = getPatientRecords();
    const record = records.get(patientId);
    if (!record) {
      return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    }

    // Part C — always authoritative, AI cannot change this
    const deterministicResult = assessEligibility(record);
    const facts = extractFacts(record);

    const deterministicSummary = buildDeterministicSummary(facts, deterministicResult.status);
    const prompt = buildPrompt(facts, deterministicResult.status, deterministicResult.reasons);

    // Start with deterministic summary; upgrade to AI only if the response passes validation
    let clinicalSummary = deterministicSummary;
    let aiAssistAvailable = false;

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    try {
      const rawText = anthropicKey
        ? await callAnthropic(prompt, anthropicKey)
        : await callOllama(prompt);

      if (rawText) {
        const cleaned = rawText.replace(/```json[\s\S]*?```|```/g, "").trim();
        const parsed = JSON.parse(cleaned);
        const candidate: unknown = parsed?.clinicalSummary;
        if (typeof candidate === "string" && validateAISummary(candidate, facts)) {
          clinicalSummary = candidate;
          aiAssistAvailable = true;
        } else {
          console.warn("AI summary failed validation — using deterministic fallback");
        }
      }
    } catch (llmError) {
      console.error("LLM call failed, using deterministic summary:", llmError);
    }

    const result: AIAssistResult = {
      clinicalSummary,
      eligibilityAssessment: deterministicResult.status,
      checklist: deterministicResult.checklist,
      recommendedNextSteps: buildNextSteps(deterministicResult.reasons),
      aiAssistAvailable,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("AI Assist error:", error);

    // Safe degradation — return deterministic results without AI
    if (patientId) {
      try {
        const records = getPatientRecords();
        const record = records.get(patientId);
        if (record) {
          const det = assessEligibility(record);
          const facts = extractFacts(record);
          const fallback: AIAssistResult = {
            clinicalSummary: buildDeterministicSummary(facts, det.status),
            eligibilityAssessment: det.status,
            checklist: det.checklist,
            recommendedNextSteps: buildNextSteps(det.reasons),
            aiAssistAvailable: false,
          };
          return NextResponse.json(fallback);
        }
      } catch { /* ignore */ }
    }

    return NextResponse.json({ error: "AI assist failed", aiAssistAvailable: false }, { status: 500 });
  }
}
