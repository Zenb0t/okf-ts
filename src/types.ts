export type OkfStatus = "draft" | "stable" | "deprecated";

export type TrustTier =
  | "unverified"
  | "machine-confirmed"
  | "human-reviewed";

export interface OkfDateRange {
  from: string;
  to: string;
}

export interface OkfSource extends Record<string, unknown> {
  resource: string;
  id?: string;
  title?: string;
  author?: string;
  usage_count?: number;
  last_modified?: string;
  usage_window?: OkfDateRange;
}

export interface OkfGeneration extends Record<string, unknown> {
  by: string;
  at?: string;
}

export interface OkfVerification extends Record<string, unknown> {
  by: string;
  at: string;
}

export interface OkfParameter extends Record<string, unknown> {
  name: string;
  type: string;
  required: boolean;
}

export interface OkfExecutor extends Record<string, unknown> {
  resource?: string;
  receipt?: string[];
}

export interface OkfAttester extends Record<string, unknown> {
  resource?: string;
}

export interface OkfMetadata extends Record<string, unknown> {
  type?: string;
  title?: string;
  description?: string;
  resource?: string;
  tags?: string[];
  sources?: OkfSource[];
  usage_window?: OkfDateRange;
  generated?: OkfGeneration;
  verified?: OkfVerification | OkfVerification[];
  status?: OkfStatus;
  stale_after?: string;
  runtime?: string;
  parameters?: OkfParameter[];
  computation?: string;
  executor?: OkfExecutor;
  attester?: OkfAttester;
}

export interface OkfConcept {
  id?: string;
  path?: string;
  metadata: OkfMetadata;
  body: string;
}

export interface ParseConceptOptions {
  id?: string;
  path?: string;
}

export type OkfIssueSeverity = "error" | "warning";

export interface OkfIssue {
  severity: OkfIssueSeverity;
  code: string;
  message: string;
  path?: string;
  field?: string;
}

export type ReservedDocumentKind = "index" | "log";

export interface OkfReservedDocument {
  kind: ReservedDocumentKind;
  path: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export interface OkfBundle {
  root: string;
  version?: string;
  concepts: OkfConcept[];
  indexes: OkfReservedDocument[];
  logs: OkfReservedDocument[];
  issues: OkfIssue[];
}

export type OkfGraphEdgeKind = "link" | "source";

export interface OkfGraphNode {
  id: string;
  concept: OkfConcept;
}

export interface OkfGraphEdge {
  from: string;
  to: string;
  kind: OkfGraphEdgeKind;
  target: string;
  exists: boolean;
}

export interface OkfGraph {
  nodes: OkfGraphNode[];
  edges: OkfGraphEdge[];
}
