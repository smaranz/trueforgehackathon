export interface PageElement {
  selector: string; tag: string; text: string;
  rect: { x: number; y: number; width: number; height: number };
}
export interface Diagnostic {
  id: string; rule: string; title: string; severity: 'High' | 'Medium' | 'Low';
  category: 'functional' | 'security' | 'accessibility' | 'performance';
  url: string; selector?: string; expected: string; actual: string; suggestion: string;
  status: 'Observed' | 'Suspected' | 'Confirmed'; evidence: string[];
  feedback?: { verdict: 'false-positive' | 'accepted'; reason: string; memoryId?: string };
}
export interface AgentMemory {
  id: string; origin: string; path: string; rule: string; selector: string;
  observation?: string;
  verdict: 'false-positive' | 'accepted'; reason: string; createdAt: string;
}
export interface StressResult {
  requested: number; completed: number; concurrency: number; requestsPerSecond: number;
  durationMs: number; throughput: number; p50Ms: number; p95Ms: number; maxMs: number;
  errors: number; rateLimited: number; statuses: Record<string, number>; stoppedEarly: boolean;
}
export interface RepairProposal {
  findingId: string; summary: string; files: { path: string; beforeHash: string; content: string }[];
  diff: string; baseCommit: string; createdAt: string;
}
export interface WorkbenchJob {
  id: string; kind: 'scan' | 'investigate' | 'stress' | 'propose' | 'build'; targetUrl: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled'; startedAt: string; finishedAt?: string;
  stage: string; error?: string; prompt?: string; parentId?: string;
  point?: { x: number; y: number }; selectedElement?: PageElement;
  screenshotUrl?: string; elements?: PageElement[]; findings: Diagnostic[];
  notes: string[]; stress?: StressResult; proposal?: RepairProposal;
  build?: { applied: boolean; log: string; changedFiles: string[]; verification: string };
}
export interface WorkbenchConfig {
  targetUrl: string; allowedOrigins: string[]; sourceConnected: boolean; sourceLabel?: string;
  buildConfigured: boolean; model: string; activeJobId?: string;
}
