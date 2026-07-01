// ── Compile ───────────────────────────────────────────────────────
export interface CompileError {
  line:    number;
  message: string;
}

// ── Git ──────────────────────────────────────────────────────────
export interface CommitInfo {
  hash:    string;
  date:    string;
  author:  string;
  message: string;
}

export interface GitContext {
  branch:        string;
  remote:        string;
  remoteType:    "GitHub" | "GitLab" | "Other" | "None";
  recentCommits: CommitInfo[];
  diff:          string;
  currentCommit: string;
}

// ── PR ───────────────────────────────────────────────────────────
export interface PRComment {
  author:    string;
  body:      string;
  createdAt: string;
}

export interface PRContext {
  number:     number;
  title:      string;
  body:       string;
  state:      string;
  author:     string;
  branch:     string;
  baseBranch: string;
  createdAt:  string;
  comments:   PRComment[];
  source:     "github" | "simulated";
}

// ── Style Config ─────────────────────────────────────────────────
export interface StyleConfig {
  naming?:   Record<string, string>;
  patterns?: Record<string, boolean | number>;
  forbidden?: string[];
  preferred?: string[];
}

// ── AST ──────────────────────────────────────────────────────────
export interface FunctionInfo {
  name:  string;
  start: number;
  end:   number;
}

// ── RAG ──────────────────────────────────────────────────────────
export interface TemplateMatch {
  name:        string;
  similarity:  number;
  code:        string;
}

export interface HistoryMatch {
  functionName: string;
  file:         string;
  similarity:   number;
  code:         string;
}

export interface VectorRow {
  id:           string;
  functionName: string;
  timestamp:    string;
  code:         string;
  file:         string;
  commit:       string;
  author:       string;
  vector:       number[];
}

export interface DnaMismatch {
  author:         string;
  similarity:     number;
  message:        string;
  isMatch:        boolean;
  coachingNotes?: string[];
}

export interface TokenUsage {
  provider:         string;
  model:            string;
  promptTokens:     number;
  completionTokens: number;
  totalTokens:      number;
}

export interface RateLimitEntry {
  provider:     string;
  agent:        string;
  retryAfterMs: number;  // 0 = unknown wait time
  hitAt:        number;  // Date.now() when the limit was hit
}

export interface DebateArgument {
  issue:     string;
  reasoning: string;
}

export interface DebateSide {
  verdict:         string;
  openingStatement: string;
  arguments:       DebateArgument[];
}

export interface DebateResult {
  triggered:          boolean;
  strictEngineer:     DebateSide;
  pragmaticDeveloper: DebateSide;
}

export interface DiffCategoryDiff {
  added:     string[];
  resolved:  string[];
  unchanged: number;
}

export interface DiffReview {
  hasPrevious:    boolean;
  previousScore:  number;
  currentScore:   number;
  scoreDelta:     number;
  totalAdded:     number;
  totalResolved:  number;
  totalUnchanged: number;
  byCategory:     Record<string, DiffCategoryDiff>;
}

export interface TemporalInfo {
  lastModifiedDate: string;
  lastReviewedDate: string | null;
  ageInDays:        number;
  daysSinceReview:  number | null;
  decayLevel:       "fresh" | "aging" | "stale" | "decayed";
  decayMessage:     string;
}

// ── Agent results ─────────────────────────────────────────────────
export interface QualityResult {
  score:               number;
  summary:             string;
  matchedTemplate:     string | null;
  prInsight:           string;
  issues:              any[];
  refactoredFunction:  string;
}

export interface StyleResult {
  styleScore:  number;
  violations:  any[];
  summary:     string;
}

export interface SecurityResult {
  securityScore:   number;
  vulnerabilities: any[];
  checkedItems?:   string[];
  summary:         string;
}

export interface TestsResult {
  testCode:            string;
  testCount:           number;
  edgeCasesCovered:    string[];
  summary:             string;
}

export interface DocsResult {
  jsdocBlock:              string;
  paramSuggestions:        any[];
  functionNameSuggestion:  string | null;
  hasAdequateDocs:         boolean;
  summary:                 string;
}

export interface ComplexityResult {
  complexityScore:      number;
  cyclomaticComplexity: number;
  cognitiveComplexity:  string;
  linesOfCode:          number;
  maxNestingDepth:      number;
  parameterCount:       number;
  issues:               any[];
  summary:              string;
}

export interface ErrorHandlingResult {
  errorHandlingScore: number;
  issues:             any[];
  summary:            string;
}

export interface DuplicationResult {
  duplicationScore:  number;
  isDuplicate:       boolean;
  similarityPercent: number;
  issues:            any[];
  summary:           string;
}

export interface DependenciesResult {
  dependencyScore: number;
  issues:          any[];
  summary:         string;
}

// ── Full analysis ─────────────────────────────────────────────────
export interface AnalysisResult {
  functionName:  string;
  overallScore:  number;
  quality:       QualityResult       | null;
  style:         StyleResult         | null;
  security:      SecurityResult      | null;
  tests:         TestsResult         | null;
  docs:          DocsResult          | null;
  complexity:    ComplexityResult    | null;
  errorHandling: ErrorHandlingResult | null;
  duplication:   DuplicationResult   | null;
  dependencies:  DependenciesResult  | null;
  compileErrors:  CompileError[];
  dnaMismatch:    DnaMismatch   | null;
  temporalDecay:  TemporalInfo  | null;
  debate?:        DebateResult  | null;
  diffReview?:    DiffReview    | null;
}

// ── Score history ─────────────────────────────────────────────────
export interface ScoreRecord {
  timestamp:    string;
  functionName: string;
  file:         string;
  score:        number;
}

// ── Page result (rendered per function) ───────────────────────────
export interface PageResult {
  fnInfo:   FunctionInfo;
  analysis: AnalysisResult;
  code:     string;
}