export type Role = 'owner' | 'editor' | 'viewer';
export type Mode = 'trueforge' | 'deterministic';
export type Variant = 'broken' | 'corrected';
export type RunStatus = 'queued' | 'running' | 'reproducing' | 'completed' | 'failed' | 'inconclusive' | 'cancelled' | 'blocked';
export type FindingStatus = 'Suspected' | 'Reproducing' | 'Confirmed' | 'Not reproduced' | 'Inconclusive';
export type Phase = 'preconditions' | 'share' | 'open' | 'revoke' | 'check' | 'assess' | 'reproduce' | 'verify' | 'complete';
export interface Scenario { id: 'revoked-access' | 'signup-surface' | 'full-audit'; name: string; roles: Role[]; expectationSource: string; phases: Phase[]; }
export interface Actor { id: string; role: Role; name: string; email: string; status: string; sessionId?: string; screenshotId?: string; currentAction?: string; }
export interface ActionEvent { id: string; runId: string; timestamp: string; actor?: Role; actorId?: string; sessionId?: string; type: string; phase: Phase; message: string; details?: unknown; artifactIds: string[]; }
export interface EvidenceArtifact { id: string; runId: string; actor?: Role; actorId?: string; kind: 'screenshot' | 'network' | 'assertion' | 'test' | 'log' | 'trace'; label: string; timestamp: string; url: string; }
export interface Finding { id: string; runId: string; title: string; scenario: string; expected: string; expectationSource: string; actual: string; actors: Role[]; actorIds?: string[]; category?: 'functional' | 'security' | 'usability' | 'accessibility'; preconditions: string[]; steps: string[]; evidenceIds: string[]; status: FindingStatus; severity: 'High' | 'Medium' | 'Low'; rationale: string; regressionTest?: string; auditAssertion?: AuditAssertion; }
export interface VerificationRun { id: string; variant: Variant; status: 'passed' | 'failed' | 'error'; startedAt: string; durationMs: number; artifactIds: string[]; testPath: string; testHash: string; exitCode: number | null; }
export interface SurfaceCheck { name: string; status: 'passed' | 'failed' | 'inconclusive'; observed: string; }
export interface Run { id: string; name: string; goal: string; targetUrl: string; scenario: Scenario['id']; mode: Mode; variant?: Variant; status: RunStatus; phase: Phase; startedAt: string; finishedAt?: string; actors: Actor[]; events: ActionEvent[]; eventCount?: number; artifacts: EvidenceArtifact[]; findings: Finding[]; verifications: VerificationRun[]; error?: string; tokens?: { input: number; output: number }; cost: null; checks?: SurfaceCheck[]; limitations?: string[]; audit?: AuditState; }
export interface Health { trueforge: { reachable: boolean; ready: boolean; baseUrl: string; model: string; reason?: string; verified?: boolean }; demoUrl: string; version: string; }
export interface NewRunInput { mode: Mode; variant: Variant; goal: string; targetUrl: string; scenario: 'revoked-access'; }

export type AuditAgentStatus = 'queued' | 'signing-up' | 'running' | 'reviewing' | 'completed' | 'blocked' | 'failed' | 'cancelled' | 'budget-exhausted';
export interface AuditAssignment { id: string; name: string; focus: string; objective: string; routes: string[]; viewport: 'desktop' | 'mobile'; }
export interface AuditAgent extends AuditAssignment { status: AuditAgentStatus; signup: 'pending' | 'verified' | 'failed' | 'verification-required' | 'local-only'; stepCount: number; productActions?: number; workPhase?: 'signup' | 'testing' | 'rechecking' | 'done'; sessionId?: string; screenshotId?: string; currentAction?: string; email?: string; startedAt?: string; finishedAt?: string; visitedUrls: string[]; coverage: string[]; summary?: string; error?: string; tokens?: { input: number; output: number }; }
export interface AuditAssertion { kind: 'http_error' | 'visible_text' | 'layout_overflow' | 'uncaught_exception' | 'unauthorized_read' | 'observation'; url: string; text?: string; status?: number; }
export interface AuditReproduction { id: string; findingId: string; agentId: string; sessionId?: string; status: 'queued' | 'running' | 'confirmed' | 'not-reproduced' | 'inconclusive'; evidenceIds: string[]; details?: string; }
export interface AuditState { model: string; requestedAgents: number; concurrency: number; maxStepsPerAgent: number; deadlineMinutes: number; maxTotalTokens: number; stage: 'registration' | 'exploration' | 'verification' | 'complete'; agents: AuditAgent[]; reproductions: AuditReproduction[]; accountCount: number; }
export interface AuditInput { targetUrl: 'http://localhost:3000/signup'; agentCount: number; concurrency: number; maxStepsPerAgent: number; deadlineMinutes: number; maxTotalTokens: number; goal: string; }
