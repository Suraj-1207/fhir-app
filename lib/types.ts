// FHIR Resource Types
export interface FHIRResource {
  resourceType: string;
  id: string;
  [key: string]: unknown;
}

export interface FHIRPatient extends FHIRResource {
  resourceType: "Patient";
  name?: Array<{
    family?: string;
    given?: string[];
    use?: string;
    text?: string;
  }>;
  gender?: string;
  birthDate?: string;
  address?: Array<{
    city?: string;
    state?: string;
    country?: string;
  }>;
  maritalStatus?: { coding?: Array<{ code?: string; display?: string }> };
}

export interface FHIRCondition extends FHIRResource {
  resourceType: "Condition";
  subject?: { reference?: string };
  code?: {
    coding?: Array<{ system?: string; code?: string; display?: string }>;
    text?: string;
  };
  clinicalStatus?: {
    coding?: Array<{ code?: string }>;
  };
  onsetDateTime?: string;
  abatementDateTime?: string;
  recordedDate?: string;
}

export interface FHIRObservation extends FHIRResource {
  resourceType: "Observation";
  subject?: { reference?: string };
  code?: {
    coding?: Array<{ system?: string; code?: string; display?: string }>;
    text?: string;
  };
  valueQuantity?: { value?: number; unit?: string };
  valueCodeableConcept?: {
    coding?: Array<{ system?: string; code?: string; display?: string }>;
    text?: string;
  };
  component?: Array<{
    code?: {
      coding?: Array<{ system?: string; code?: string; display?: string }>;
    };
    valueQuantity?: { value?: number; unit?: string };
  }>;
  effectiveDateTime?: string;
  issued?: string;
  status?: string;
}

export interface FHIRProcedure extends FHIRResource {
  resourceType: "Procedure";
  subject?: { reference?: string };
  code?: {
    coding?: Array<{ system?: string; code?: string; display?: string }>;
    text?: string;
  };
  performedDateTime?: string;
  performedPeriod?: { start?: string; end?: string };
  status?: string;
}

// Internal Models
export interface PatientRecord {
  patient: FHIRPatient;
  conditions: FHIRCondition[];
  observations: FHIRObservation[];
  procedures: FHIRProcedure[];
}

export type EligibilityStatus = "eligible" | "not eligible" | "unknown";

export interface ChecklistItem {
  requirement: string;
  status: "met" | "not met" | "unknown";
  evidence: string[];
}

export interface EligibilityResult {
  patientId: string;
  status: EligibilityStatus;
  reasons: string[];
  checklist: ChecklistItem[];
}

export interface AIAssistResult {
  clinicalSummary: string;
  eligibilityAssessment: EligibilityStatus;
  checklist: ChecklistItem[];
  recommendedNextSteps: string[];
  aiAssistAvailable: boolean;
}

export interface BenchmarkResult {
  naiveMs: number;
  indexedMs: number;
  speedup: string;
  resourceCount: number;
  patientCount: number;
}

export interface CohortReport {
  totalPatients: number;
  eligible: { count: number; percentage: number };
  notEligible: { count: number; percentage: number };
  unknown: { count: number; percentage: number };
  topUnknownReasons: Array<{ reason: string; count: number }>;
}

export interface TimelineEntry {
  type: "observation" | "procedure";
  displayName: string;
  date: string;
  resourceId: string;
}
