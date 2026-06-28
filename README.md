# Prior Authorization Review Tool

A clinician-facing tool for reviewing bariatric surgery prior authorization eligibility using FHIR bulk data.

## Quick Start

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Data

Place FHIR NDJSON bulk export files in the `data/` directory. The app loads `Patient`, `Condition`, `Observation`, and `Procedure` resources; other resource types are skipped to keep memory usage manageable on large datasets.

### AI Assist (Local — no API key required)

The AI Assist feature uses [Ollama](https://ollama.com) by default:

```bash
# Install Ollama, then:
ollama pull llama3.1:8b
```

To use Anthropic Claude instead, set `ANTHROPIC_API_KEY` in `.env.local`. If neither is available the system degrades to a deterministic summary.

---

## Architecture

Single Next.js application with server-side API routes. No separate backend or database.

```
lib/
  types.ts            — FHIR resource types and internal models
  fhir-parser.ts      — NDJSON parsing, reference resolution, patient grouping, benchmark
  clinical-helpers.ts — Age, BMI, BP, timeline, display name utilities
  eligibility.ts      — Deterministic eligibility logic and cohort report generation
  data-loader.ts      — File I/O, resource filtering, and in-memory caching

app/
  page.tsx                    — Full UI: patient selector, snapshot, timeline, eligibility, cohort, benchmark
  api/patients/               — List all patients with summary eligibility results
  api/patients/[id]/          — Full patient detail: active conditions, all sorted procedures, observations
  api/cohort/                 — Cohort-level eligibility report across all patients
  api/benchmark/              — Naive O(n²) vs indexed O(n) performance comparison
  api/ai-assist/              — AI-assisted review (POST {patientId})
```

---

## Part A: Data Ingestion & Performance Optimization

**Bottleneck identified:** Reference resolution — linking Conditions, Observations, and Procedures to their Patient.

**Naive approach (O(n × p)):** For each patient, iterate all resources to find those belonging to that patient. Time grows proportionally to both resource count and patient count.

**Optimized approach (O(n)):** Single-pass scan builds a HashMap keyed by patient ID. Assembly phase does O(1) lookups — total time is linear in resource count regardless of patient count.

**Why this is the right thing to optimize first:** Reference resolution is the foundational operation. Every downstream feature — clinical snapshot, eligibility logic, timeline, AI assist — depends on correctly grouped patient records. Optimizing JSON parsing or file I/O would yield smaller gains and wouldn't scale as well as the dataset grows.

**Results:** Live in the app under the **Performance** tab. Benchmark runs on a 5,000-resource sample (the naive algorithm on the full dataset would take several minutes, making the benchmark impractical at that scale; the sample demonstrates the same asymptotic difference).

---

## Part B: Frontend

**Patient Selector** — search by name or patient ID; filter by eligibility status (eligible / unknown / not eligible). Switching patients updates all views.

**Clinical Snapshot** — age, sex, active conditions only, 5 most recent procedures sorted by date, latest BMI and blood pressure (both resolved to the most recent observation by date).

**Timeline** — all observations and procedures in reverse chronological order, capped at 100 visible entries. Each entry shows display name, formatted date, and source FHIR resource ID. Filterable by type.

**Missing data:** displayed explicitly throughout ("Not recorded", "No conditions recorded", "No evidence found in record") — never silently omitted.

---

## Part C: Eligibility Logic

Per the simplified bariatric surgery policy:

| Status | Condition |
|---|---|
| **eligible** | BMI ≥ 40 (or ≥ 35 + qualifying comorbidity), AND prior weight-loss attempts documented, AND psychological evaluation documented |
| **not eligible** | BMI < 35, or BMI 35–39.9 without a qualifying comorbidity |
| **unknown** | Missing BMI observation, or BMI criteria met but required documentation not found in record |

**Comorbidities recognized:** hypertension, type 2 diabetes, prediabetes, obstructive sleep apnea, hyperlipidemia, coronary/ischemic heart disease, osteoarthritis, GERD, COPD, metabolic syndrome, hyperglycemia, dyslipidemia.

**Documentation evidence:** matched by keyword across Procedures, Conditions, and Observations. Psych eval evidence includes PHQ/GAD/AUDIT/DAST screening instruments. Weight-loss evidence includes diet counseling, nutrition programs, bariatric-related conditions, and exercise therapy records.

**Cohort report** shows total patients, count and percentage per eligibility category, and a breakdown of the top reasons for unknown status.

---

## Part D: AI-Assisted Review

**Design principle:** The AI explains; it never decides. Eligibility status and the full checklist always come from the deterministic logic in Part C. The AI's sole job is to write a concise clinical narrative grounded in the extracted patient facts.

**Grounding:** Before calling the AI, the system deterministically extracts:
- Patient age and sex (from Patient resource)
- Latest BMI value and its `Observation/ID`
- Active conditions with their `Condition/ID`s
- Eligibility reasons (from Part C)

These extracted facts — not raw FHIR JSON — are what the model receives. The model cannot invent facts it was not given.

**Validation:** AI responses are rejected and the deterministic fallback is used if the response:
- Contains bracket placeholders (`[age]`, `[BMI]`, etc.)
- Contains hedging or inference language ("likely", "probably", "implies", "urgent", "complex decision", etc.)
- Does not reference the patient's actual age or BMI value
- Is outside the expected length range

**Failure handling:**
1. AI response fails validation → deterministic grounded summary shown, `aiAssistAvailable: false`
2. LLM call throws (model down, timeout) → same deterministic fallback
3. Entire route crashes → re-runs Part C, returns deterministic result with 200
4. Complete failure → 500 with `aiAssistAvailable: false`

**Model:** Ollama `llama3.1:8b` (local, default) or Anthropic Claude (if `ANTHROPIC_API_KEY` is set).
