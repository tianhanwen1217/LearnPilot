export type QuestionType = "single" | "multiple" | "true_false" | "fill" | "short" | "unknown";

export interface QuestionOption {
  key: string;
  text: string;
  elementIndex?: number;
}

export interface ExtractedQuestion {
  id: string;
  type: QuestionType;
  stem: string;
  options: QuestionOption[];
  pageUrl: string;
  courseId: string;
  selectedText?: string;
}

export interface SourceLink {
  title: string;
  url?: string;
  snippet?: string;
  kind: "bank" | "web" | "model";
  score?: number;
}

export interface AnalysisResult {
  suggestedOptions: string[];
  answerText: string;
  confidence: number;
  explanation: string;
  warnings: string[];
  sources: SourceLink[];
  sourceKind: "bank_exact" | "bank_similar" | "web" | "model" | "mixed";
}

export interface BankEntry {
  id: string;
  question: string;
  options?: string[];
  answer: string;
  explanation?: string;
  source?: string;
}

export interface BankMatch {
  entry: BankEntry;
  score: number;
  exact: boolean;
}

export type ApiMode = "responses" | "chat_completions";
export type SearchMode = "responses_web" | "tavily" | "none";

export interface ExtensionSettings {
  apiBaseUrl: string;
  apiKey: string;
  apiKeyStorage: "local" | "session";
  apiMode: ApiMode;
  model: string;
  searchMode: SearchMode;
  tavilyApiKey: string;
  analysisMode: "concise" | "detailed";
  confidenceThreshold: number;
  autoNextDelayMs: number;
  maxSearchResults: number;
  requestTimeoutMs: number;
  darkMode: boolean;
}

export interface CourseSessionState {
  courseId: string;
  testMode: boolean;
  autoRunning: boolean;
  continuousPlayback: boolean;
  updatedAt: number;
}

export type RuntimeMessage =
  | { type: "ANALYZE_QUESTION"; question: ExtractedQuestion; bankMatch?: BankMatch }
  | { type: "TEST_CONNECTION"; settings: ExtensionSettings }
  | { type: "TOGGLE_PANEL" }
  | { type: "VIDEO_ENDED"; courseId: string }
  | { type: "ADVANCE_LESSON" }
  | { type: "GET_TAB_PLAYBACK" }
  | { type: "SET_TAB_PLAYBACK"; enabled: boolean }
  | { type: "PLAYBACK_STATE_CHANGED"; enabled: boolean }
  | { type: "GET_ACTIVE_STATUS" }
  | { type: "CLEAR_SESSION" };

export interface MessageResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
