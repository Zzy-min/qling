export type RepoEdgeKind =
  | "imports"
  | "defines"
  | "references"
  | "tests"
  | "builds"
  | "configures";

export interface RepoFileRecord {
  path: string;
  bytes: number;
  contentHash: string;
  language?: string;
  rank: number;
}

export interface SymbolRecord {
  id: string;
  file: string;
  name: string;
  kind: string;
  line: number;
  signature: string;
}

export interface RepoEdge {
  from: string;
  to: string;
  kind: RepoEdgeKind;
  weight: number;
}

export interface RepoIndexSnapshot {
  repositoryId: string;
  revision: string;
  dirtyFingerprint: string;
  parserVersion: string;
  files: RepoFileRecord[];
  symbols: SymbolRecord[];
  edges: RepoEdge[];
  generatedAt: number;
}

export interface RepoMapResult {
  text: string;
  estimatedTokens: number;
  truncated: boolean;
  snapshot: RepoIndexSnapshot;
}
