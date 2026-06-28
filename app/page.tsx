"use client";

import { useState, useEffect } from "react";

interface ChecklistItem {
  requirement: string;
  status: "met" | "not met" | "unknown";
  evidence: string[];
}

interface EligibilityResult {
  patientId: string;
  status: "eligible" | "not eligible" | "unknown";
  reasons: string[];
  checklist: ChecklistItem[];
}

interface PatientSummary {
  id: string;
  name: string;
  gender: string;
  birthDate: string | null;
  conditionCount: number;
  observationCount: number;
  procedureCount: number;
  eligibility: EligibilityResult;
}

interface PatientData extends PatientSummary {
  patient: Record<string, unknown>;
  conditions: Array<Record<string, unknown>>;
  observations: Array<Record<string, unknown>>;
  procedures: Array<Record<string, unknown>>;
}

interface CohortReport {
  totalPatients: number;
  eligible: { count: number; percentage: number };
  notEligible: { count: number; percentage: number };
  unknown: { count: number; percentage: number };
  topUnknownReasons: Array<{ reason: string; count: number }>;
}

interface AIResult {
  clinicalSummary: string;
  eligibilityAssessment: string;
  checklist: ChecklistItem[];
  recommendedNextSteps: string[];
  aiAssistAvailable: boolean;
}

interface BenchmarkResult {
  naiveMs: number;
  indexedMs: number;
  speedup: string;
  resourceCount: number;
  patientCount: number;
}

function getAge(birthDate: string | null): string {
  if (!birthDate) return "Unknown";
  const birth = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return `${age}`;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    eligible: "bg-green-50 text-green-700 border-green-200",
    "not eligible": "bg-red-50 text-red-700 border-red-200",
    unknown: "bg-purple-50 text-purple-700 border-purple-200",
    met: "bg-green-50 text-green-700 border-green-200",
    "not met": "bg-red-50 text-red-700 border-red-200",
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 text-xs font-medium rounded border ${styles[status] ?? "bg-gray-50 text-gray-700 border-gray-200"}`}
    >
      {status}
    </span>
  );
}

function getObsDisplay(obs: Record<string, unknown>) {
  const code = obs.code as { coding?: Array<{ display?: string }>; text?: string } | undefined;
  return code?.coding?.[0]?.display ?? code?.text ?? "Unknown observation";
}

function getObsValue(obs: Record<string, unknown>): string {
  const vq = obs.valueQuantity as { value?: number; unit?: string } | undefined;
  if (vq?.value != null) return `${vq.value} ${vq.unit ?? ""}`.trim();
  const vc = obs.valueCodeableConcept as { text?: string; coding?: Array<{ display?: string }> } | undefined;
  if (vc) return vc.text ?? vc.coding?.[0]?.display ?? "";
  // Blood pressure panel — format as systolic/diastolic mmHg (clinical notation)
  const components = obs.component as Array<{
    code?: { coding?: Array<{ display?: string; code?: string }> };
    valueQuantity?: { value?: number; unit?: string };
  }> | undefined;
  if (components?.length) {
    const systolic = components.find((c) =>
      c.code?.coding?.some((cd) => cd.code === "8480-6" || cd.display?.toLowerCase().includes("systolic"))
    );
    const diastolic = components.find((c) =>
      c.code?.coding?.some((cd) => cd.code === "8462-4" || cd.display?.toLowerCase().includes("diastolic"))
    );
    if (systolic?.valueQuantity?.value != null && diastolic?.valueQuantity?.value != null) {
      return `${systolic.valueQuantity.value}/${diastolic.valueQuantity.value} mmHg`;
    }
  }
  return "No value recorded";
}

// Strip SNOMED display qualifiers from any resource display name
function cleanDisplayName(name: string): string {
  return name.replace(/\s*\((finding|disorder|situation|observable entity|procedure|regime\/therapy|context-dependent category)\)\s*$/i, "").trim();
}

function formatDate(raw: string | undefined): string {
  if (!raw || raw === "Unknown date") return "Unknown date";
  try { return new Date(raw).toLocaleDateString(); } catch { return raw; }
}

function getProcDisplay(proc: Record<string, unknown>) {
  const code = proc.code as { coding?: Array<{ display?: string }>; text?: string } | undefined;
  return code?.coding?.[0]?.display ?? code?.text ?? "Unknown procedure";
}

function getCondDisplay(cond: Record<string, unknown>) {
  const code = cond.code as { coding?: Array<{ display?: string }>; text?: string } | undefined;
  return code?.coding?.[0]?.display ?? code?.text ?? "Unknown condition";
}

function getCondStatus(cond: Record<string, unknown>): string {
  const cs = cond.clinicalStatus as { coding?: Array<{ code?: string }> } | undefined;
  return cs?.coding?.[0]?.code ?? "unknown";
}

type Tab = "snapshot" | "timeline" | "eligibility" | "cohort" | "benchmark";

export default function Home() {
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<PatientData | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("snapshot");
  const [cohort, setCohort] = useState<CohortReport | null>(null);
  const [aiResult, setAiResult] = useState<AIResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [benchmarkData, setBenchmarkData] = useState<BenchmarkResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "eligible" | "not eligible" | "unknown">("all");
  const [timelineFilter, setTimelineFilter] = useState<"all" | "observation" | "procedure">("all");

  useEffect(() => {
    fetch("/api/patients")
      .then((r) => r.json())
      .then((data) => {
        setPatients(data.patients ?? []);
        if (data.patients?.length > 0) setSelectedId(data.patients[0].id);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setDetailLoading(true);
    fetch(`/api/patients/${selectedId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setSelectedPatient(data);
        setDetailLoading(false);
      })
      .catch(() => setDetailLoading(false));
  }, [selectedId]);

  useEffect(() => {
    if (activeTab === "cohort" && !cohort) {
      fetch("/api/cohort")
        .then((r) => r.json())
        .then(setCohort);
    }
    if (activeTab === "benchmark" && !benchmarkData) {
      fetch("/api/benchmark")
        .then((r) => r.json())
        .then(setBenchmarkData);
    }
  }, [activeTab, cohort, benchmarkData]);

  const selected = patients.find((p) => p.id === selectedId) ?? selectedPatient;

  const filteredPatients = patients.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || p.eligibility.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  async function runAiAssist() {
    if (!selectedId) return;
    setAiLoading(true);
    setAiResult(null);
    try {
      const res = await fetch("/api/ai-assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: selectedId }),
      });
      const data = await res.json();
      setAiResult(data);
    } catch {
      setAiResult({
        clinicalSummary: "AI assist request failed.",
        eligibilityAssessment: selected?.eligibility.status ?? "unknown",
        checklist: selected?.eligibility.checklist ?? [],
        recommendedNextSteps: ["Retry AI assist or review deterministic results"],
        aiAssistAvailable: false,
      });
    }
    setAiLoading(false);
  }

  // Reset AI result when patient changes
  useEffect(() => {
    setAiResult(null);
  }, [selectedId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">Loading FHIR data...</p>
      </div>
    );
  }

  if (patients.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-xl font-semibold mb-2">No Data Found</h1>
          <p className="text-gray-500">
            Place FHIR NDJSON or Bundle JSON files in the <code className="bg-gray-100 px-1 rounded">data/</code> directory and restart.
          </p>
        </div>
      </div>
    );
  }

  // Build timeline
  const timelineEntries: Array<{ type: string; name: string; date: string; resourceId: string }> = [];
  if (selectedPatient) {
    for (const obs of selectedPatient.observations) {
      timelineEntries.push({
        type: "observation",
        name: getObsDisplay(obs),
        date: (obs.effectiveDateTime as string) ?? (obs.issued as string) ?? "Unknown date",
        resourceId: `Observation/${obs.id}`,
      });
    }
    for (const proc of selectedPatient.procedures) {
      timelineEntries.push({
        type: "procedure",
        name: getProcDisplay(proc),
        date: (proc.performedDateTime as string) ?? ((proc.performedPeriod as { start?: string })?.start) ?? "Unknown date",
        resourceId: `Procedure/${proc.id}`,
      });
    }
    timelineEntries.sort((a, b) => b.date.localeCompare(a.date));
  }

  // Key observations (BMI, BP) — sorted descending to match getLatestBMI() in clinical-helpers
  const bmiObs = selectedPatient?.observations
    .filter((o) => {
      const code = o.code as { coding?: Array<{ code?: string; display?: string }> } | undefined;
      return code?.coding?.some((c) => c.code === "39156-5") || code?.coding?.some((c) => c.display?.toLowerCase()?.includes("body mass index"));
    })
    .sort((a, b) => {
      const da = (a as { effectiveDateTime?: string }).effectiveDateTime ?? "";
      const db = (b as { effectiveDateTime?: string }).effectiveDateTime ?? "";
      return db.localeCompare(da);
    })[0];
  const bpObs = selectedPatient?.observations
    .filter((o) => {
      const code = o.code as { coding?: Array<{ code?: string; display?: string }> } | undefined;
      return code?.coding?.some((c) => c.code === "85354-9") || code?.coding?.some((c) => c.display?.toLowerCase()?.includes("blood pressure"));
    })
    .sort((a, b) => {
      const da = (a as { effectiveDateTime?: string }).effectiveDateTime ?? "";
      const db = (b as { effectiveDateTime?: string }).effectiveDateTime ?? "";
      return db.localeCompare(da);
    })[0];

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "snapshot", label: "Clinical Snapshot" },
    { id: "timeline", label: "Timeline" },
    { id: "eligibility", label: "Eligibility" },
    { id: "cohort", label: "Cohort Report" },
    { id: "benchmark", label: "Performance" },
  ];

  return (
    <div className="min-h-screen flex">
      {/* Sidebar - Patient Selector */}
      <div className="w-72 border-r border-gray-200 bg-white flex flex-col h-screen sticky top-0">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-sm font-semibold text-gray-800 mb-3">Prior Auth Review</h1>
          <input
            type="text"
            placeholder="Search patients..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 mb-2"
          />
          <div className="flex gap-1 flex-wrap">
            {(["all", "eligible", "unknown", "not eligible"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                  statusFilter === s
                    ? s === "eligible" ? "bg-green-100 border-green-300 text-green-700"
                      : s === "unknown" ? "bg-purple-100 border-purple-300 text-purple-700"
                      : s === "not eligible" ? "bg-red-100 border-red-300 text-red-700"
                      : "bg-gray-200 border-gray-300 text-gray-700"
                    : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
                }`}
              >
                {s === "all" ? `All (${patients.length})` : s}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-y-auto flex-1">
          {filteredPatients.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${p.id === selectedId ? "bg-blue-50 border-l-2 border-l-blue-500" : ""}`}
            >
              <div className="text-sm font-medium">{p.name}</div>
              <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2">
                <span>{p.id.substring(0, 8)}...</span>
                <StatusBadge status={p.eligibility.status} />
              </div>
            </button>
          ))}
        </div>
        <div className="p-3 border-t border-gray-200 text-xs text-gray-400">
          {filteredPatients.length === patients.length
            ? `${patients.length} patients loaded`
            : `${filteredPatients.length} of ${patients.length} patients`}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-h-screen">
        {/* Tabs */}
        <div className="border-b border-gray-200 bg-white sticky top-0 z-10">
          <div className="flex px-6">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-6 max-w-4xl">
          {/* Clinical Snapshot */}
          {activeTab === "snapshot" && selected && (
            <div className="space-y-6">
              {/* Demographics */}
              <div className="bg-white rounded-lg border border-gray-200 p-5">
                <div className="flex items-start justify-between mb-3">
                  <h2 className="text-base font-semibold">{selected.name}</h2>
                  <StatusBadge status={selected.eligibility.status} />
                </div>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">Age</span>
                    <p className="font-medium">{getAge(selected.birthDate)} yrs</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Sex</span>
                    <p className="font-medium capitalize">{selected.gender}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Patient ID</span>
                    <p className="font-medium text-xs font-mono">{selected.id}</p>
                  </div>
                </div>
              </div>

              {/* Key Observations */}
              <div className="bg-white rounded-lg border border-gray-200 p-5">
                <h3 className="text-sm font-semibold mb-3 text-gray-700">Key Observations</h3>
                {detailLoading ? (
                  <p className="text-sm text-gray-400 italic">Loading...</p>
                ) : (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="p-3 bg-gray-50 rounded">
                      <span className="text-gray-500 text-xs">BMI</span>
                      {bmiObs ? (
                        <p className="font-semibold text-lg">{getObsValue(bmiObs)}</p>
                      ) : (
                        <p className="text-gray-400 italic">Not recorded</p>
                      )}
                    </div>
                    <div className="p-3 bg-gray-50 rounded">
                      <span className="text-gray-500 text-xs">Blood Pressure</span>
                      {bpObs ? (
                        <p className="font-semibold text-lg">{getObsValue(bpObs)}</p>
                      ) : (
                        <p className="text-gray-400 italic">Not recorded</p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Active Conditions */}
              <div className="bg-white rounded-lg border border-gray-200 p-5">
                <h3 className="text-sm font-semibold mb-3 text-gray-700">Active Conditions</h3>
                {detailLoading ? (
                  <p className="text-sm text-gray-400 italic">Loading...</p>
                ) : !selectedPatient || selectedPatient.conditions.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No conditions recorded</p>
                ) : (
                  <ul className="space-y-2">
                    {selectedPatient.conditions.map((c, i) => (
                      <li key={i} className="flex items-center justify-between text-sm py-1 border-b border-gray-50 last:border-0">
                        <span>{cleanDisplayName(getCondDisplay(c))}</span>
                        <span className="text-xs text-gray-400">{getCondStatus(c)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Recent Procedures */}
              <div className="bg-white rounded-lg border border-gray-200 p-5">
                <h3 className="text-sm font-semibold mb-3 text-gray-700">Recent Procedures</h3>
                {detailLoading ? (
                  <p className="text-sm text-gray-400 italic">Loading...</p>
                ) : !selectedPatient || selectedPatient.procedures.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No procedures recorded</p>
                ) : (
                  <ul className="space-y-2">
                    {selectedPatient.procedures.slice(0, 5).map((p, i) => (
                      <li key={i} className="text-sm py-1 border-b border-gray-50 last:border-0">
                        <span>{cleanDisplayName(getProcDisplay(p))}</span>
                        <span className="text-xs text-gray-400 ml-2">
                          {formatDate((p.performedDateTime as string) ?? (p.performedPeriod as { start?: string })?.start)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* Timeline */}
          {activeTab === "timeline" && selected && (
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold">Timeline — {selected.name}</h2>
                <div className="flex gap-1">
                  {(["all", "observation", "procedure"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setTimelineFilter(f)}
                      className={`text-xs px-2 py-1 rounded border transition-colors ${
                        timelineFilter === f
                          ? f === "observation" ? "bg-blue-100 border-blue-300 text-blue-700"
                            : f === "procedure" ? "bg-amber-100 border-amber-300 text-amber-700"
                            : "bg-gray-200 border-gray-300 text-gray-700"
                          : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
                      }`}
                    >
                      {f === "all" ? "All" : f === "observation" ? "● Observations" : "● Procedures"}
                    </button>
                  ))}
                </div>
              </div>
              {(() => {
                const visible = timelineEntries.filter(
                  (e) => timelineFilter === "all" || e.type === timelineFilter
                );
                return visible.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No entries for selected filter</p>
                ) : (
                  <>
                    {visible.length > 100 && (
                      <p className="text-xs text-gray-400 mb-3 italic">
                        Showing 100 of {visible.length} entries (most recent first)
                      </p>
                    )}
                    <div className="space-y-1">
                      {visible.slice(0, 100).map((e, i) => (
                      <div key={i} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0 text-sm">
                        <span
                          className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
                            e.type === "observation" ? "bg-blue-400" : "bg-amber-400"
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">{cleanDisplayName(e.name)}</div>
                          <div className="text-xs text-gray-400 font-mono">{e.resourceId}</div>
                        </div>
                        <span className="text-xs text-gray-400 shrink-0">
                          {e.date !== "Unknown date" ? new Date(e.date).toLocaleDateString() : "Unknown date"}
                        </span>
                      </div>
                    ))}
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* Eligibility */}
          {activeTab === "eligibility" && selected && (
            <div className="space-y-6">
              <div className="bg-white rounded-lg border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-semibold">Eligibility — {selected.name}</h2>
                  <StatusBadge status={selected.eligibility.status} />
                </div>

                {/* Checklist */}
                <div className="space-y-3 mb-6">
                  {selected.eligibility.checklist.map((item, i) => {
                    const isBMI = item.requirement.toLowerCase().startsWith("bmi");
                    const bmiValue = isBMI && bmiObs
                      ? (bmiObs.valueQuantity as { value?: number })?.value
                      : null;
                    return (
                    <div key={i} className="flex items-start gap-3 p-3 bg-gray-50 rounded">
                      <span className={`mt-0.5 text-base font-bold shrink-0 ${item.status === "met" ? "text-green-600" : item.status === "not met" ? "text-red-500" : "text-purple-500"}`}>
                        {item.status === "met" ? "✓" : item.status === "not met" ? "✗" : "?"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{item.requirement}</span>
                          {bmiValue != null && (
                            <span className="text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded">
                              BMI {Math.round(bmiValue * 10) / 10}
                            </span>
                          )}
                        </div>
                        {item.evidence.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {item.evidence.slice(0, 3).map((ev, j) => {
                              const [type, ...rest] = ev.split("/");
                              const shortId = rest.join("/").substring(0, 8);
                              return (
                                <span key={j} className="inline-flex items-center gap-1 text-xs bg-white border border-gray-200 rounded px-1.5 py-0.5 font-mono text-gray-500">
                                  <span className="text-gray-400">{type}/</span>{shortId}…
                                </span>
                              );
                            })}
                            {item.evidence.length > 3 && (
                              <span className="text-xs text-gray-400 px-1.5 py-0.5">
                                +{item.evidence.length - 3} more
                              </span>
                            )}
                          </div>
                        )}
                        {item.evidence.length === 0 && item.status === "unknown" && (
                          <div className="text-xs text-purple-500 mt-1 italic">No supporting evidence found in record</div>
                        )}
                        {item.evidence.length === 0 && item.status === "not met" && (
                          <div className="text-xs text-red-400 mt-1 italic">Criterion not met</div>
                        )}
                      </div>
                      <StatusBadge status={item.status} />
                    </div>
                    );
                  })}
                </div>

                {/* Reasons — shown for all non-eligible statuses */}
                {selected.eligibility.reasons.length > 0 && (
                  <div className="mb-6">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">
                      {selected.eligibility.status === "not eligible" ? "Reasons — Not Eligible" : "Reasons — Incomplete Documentation"}
                    </h4>
                    {selected.eligibility.reasons.map((r, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm text-gray-600 py-1">
                        <span className="text-gray-400 mt-0.5">›</span>
                        <span>{r}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* AI Assist Button */}
                <div className="border-t border-gray-200 pt-4">
                  <button
                    onClick={runAiAssist}
                    disabled={aiLoading}
                    className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {aiLoading ? "Running AI Assist..." : "Run AI Assist"}
                  </button>
                </div>
              </div>

              {/* AI Result */}
              {aiResult && (
                <div className={`rounded-lg border p-5 ${aiResult.aiAssistAvailable ? "bg-blue-50 border-blue-200" : "bg-yellow-50 border-yellow-200"}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold">
                        {aiResult.aiAssistAvailable ? "AI-Assisted Review" : "Deterministic Fallback"}
                      </h3>
                      {!aiResult.aiAssistAvailable && (
                        <span className="text-xs text-yellow-600 bg-yellow-100 px-2 py-0.5 rounded border border-yellow-200">AI unavailable</span>
                      )}
                    </div>
                    <StatusBadge status={aiResult.eligibilityAssessment} />
                  </div>

                  {/* Clinical summary — hero section */}
                  <div className={`rounded p-3 mb-4 ${aiResult.aiAssistAvailable ? "bg-white border border-blue-100" : "bg-white border border-yellow-100"}`}>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Clinical Summary</p>
                    <p className="text-sm text-gray-800 leading-relaxed">{aiResult.clinicalSummary}</p>
                  </div>

                  {/* Checklist */}
                  <div className="space-y-2 mb-4">
                    <p className="text-xs font-semibold text-gray-500 uppercase">Criteria Review</p>
                    {aiResult.checklist.map((item, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm bg-white rounded p-2 border border-gray-100">
                        <span className={`font-bold shrink-0 ${item.status === "met" ? "text-green-600" : item.status === "not met" ? "text-red-500" : "text-purple-500"}`}>
                          {item.status === "met" ? "✓" : item.status === "not met" ? "✗" : "?"}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="font-medium">{item.requirement}</span>
                          {item.evidence.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {item.evidence.slice(0, 2).map((ev, j) => {
                                const [type, ...rest] = ev.split("/");
                                return (
                                  <span key={j} className="text-xs font-mono text-gray-400 bg-gray-50 px-1 rounded">
                                    {type}/{rest.join("/").substring(0, 8)}…
                                  </span>
                                );
                              })}
                              {item.evidence.length > 2 && <span className="text-xs text-gray-400">+{item.evidence.length - 2} more</span>}
                            </div>
                          )}
                          {item.evidence.length === 0 && (
                            <p className="text-xs text-gray-400 mt-0.5 italic">No evidence found in record</p>
                          )}
                        </div>
                        <StatusBadge status={item.status} />
                      </div>
                    ))}
                  </div>

                  {/* Next Steps */}
                  {aiResult.recommendedNextSteps.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Recommended Next Steps</p>
                      <div className="space-y-1">
                        {aiResult.recommendedNextSteps.map((s, i) => (
                          <div key={i} className="flex items-start gap-2 text-sm text-gray-700 bg-white rounded p-2 border border-gray-100">
                            <span className="text-blue-400 shrink-0">→</span>
                            <span>{s}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Cohort Report */}
          {activeTab === "cohort" && (
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <div className="flex items-start justify-between mb-4">
                <h2 className="text-base font-semibold">Cohort Eligibility Report</h2>
                <span className="text-xs text-gray-400 max-w-xs text-right">Criteria: bariatric surgery prior authorization (BMI ≥40, or ≥35 + comorbidity, with documented weight-loss attempts and psych evaluation)</span>
              </div>
              {!cohort ? (
                <p className="text-sm text-gray-400">Loading...</p>
              ) : (
                <div className="space-y-6">
                  <div className="grid grid-cols-4 gap-4">
                    <div className="p-4 bg-gray-50 rounded text-center">
                      <div className="text-2xl font-bold">{cohort.totalPatients}</div>
                      <div className="text-xs text-gray-500">Total Patients</div>
                    </div>
                    <div className="p-4 bg-green-50 rounded text-center">
                      <div className="text-2xl font-bold text-green-700">{cohort.eligible.count}</div>
                      <div className="text-xs text-gray-500">{cohort.eligible.percentage}% Eligible</div>
                    </div>
                    <div className="p-4 bg-red-50 rounded text-center">
                      <div className="text-2xl font-bold text-red-700">{cohort.notEligible.count}</div>
                      <div className="text-xs text-gray-500">{cohort.notEligible.percentage}% Not Eligible</div>
                    </div>
                    <div className="p-4 bg-purple-50 rounded text-center">
                      <div className="text-2xl font-bold text-purple-700">{cohort.unknown.count}</div>
                      <div className="text-xs text-gray-500">{cohort.unknown.percentage}% Unknown</div>
                    </div>
                  </div>

                  {cohort.topUnknownReasons.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">Top Reasons for Unknown Status</h3>
                      <div className="space-y-2">
                        {cohort.topUnknownReasons.map((r, i) => (
                          <div key={i} className="flex items-center justify-between text-sm py-2 border-b border-gray-50">
                            <span>{r.reason}</span>
                            <span className="text-gray-500 font-medium">{r.count} patients</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Benchmark */}
          {activeTab === "benchmark" && (
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="text-base font-semibold mb-4">Performance Benchmark</h2>
              {!benchmarkData ? (
                <p className="text-sm text-gray-400">Loading...</p>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-gray-50 rounded">
                      <div className="text-xs text-gray-500">Total Resources (full dataset)</div>
                      <div className="text-xl font-bold">{benchmarkData.resourceCount.toLocaleString()}</div>
                    </div>
                    <div className="p-4 bg-gray-50 rounded">
                      <div className="text-xs text-gray-500">Patients</div>
                      <div className="text-xl font-bold">{benchmarkData.patientCount.toLocaleString()}</div>
                    </div>
                  </div>
                  <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                    Timing measured on a 20,000-resource sample (all {benchmarkData.patientCount.toLocaleString()} patients + proportional non-patient resources). The naive O(n²) algorithm on the full {benchmarkData.resourceCount.toLocaleString()}-resource dataset would take hours — the sample demonstrates the same complexity difference at measurable scale.
                  </div>
                  <div className="p-4 bg-red-50 rounded">
                    <div className="text-xs text-gray-500">Naive O(n × p) — scan all resources per patient</div>
                    <div className="text-xl font-bold text-red-600">{benchmarkData.naiveMs} ms</div>
                  </div>
                  <div className="p-4 bg-green-50 rounded">
                    <div className="text-xs text-gray-500">Indexed O(n) — single-pass grouping</div>
                    <div className="text-xl font-bold text-green-600">{benchmarkData.indexedMs} ms</div>
                  </div>
                  <div className="p-4 bg-blue-50 rounded text-center">
                    <div className="text-xs text-gray-500">Speedup</div>
                    <div className="text-2xl font-bold text-blue-600">{benchmarkData.speedup}</div>
                  </div>
                  <div className="text-sm text-gray-600 p-4 bg-gray-50 rounded">
                    <p className="font-medium mb-1">Optimization rationale</p>
                    <p>
                      The naive approach scans all resources for every patient (O(n × p) where n = resources, p = patients).
                      The indexed approach builds a HashMap in a single pass, then assembles patient records via O(1) lookups,
                      yielding O(n) total. This is the right bottleneck to optimize first because reference resolution dominates
                      ingestion time and scales poorly as dataset size grows.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
