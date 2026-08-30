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

export interface QuestionPageItem {
  id?: string;
  index: number;
  type: QuestionType;
  answered: boolean;
  current: boolean;
}

export interface QuestionPageSummary {
  total: number;
  answered: number;
  currentIndex: number;
  items: QuestionPageItem[];
  encryptedText: boolean;
}

export interface AnswerSkipRecord {
  questionId: string;
  index?: number;
  reason: string;
}

export interface AnswerRunStats {
  answered: number;
  skipped: number;
  processed: number;
  failures: AnswerSkipRecord[];
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
  playbackRate: number;
  darkMode: boolean;
}

export interface CourseSessionState {
  courseId: string;
  testMode: boolean;
  autoRunning: boolean;
  continuousPlayback: boolean;
  completedLessons: number;
  updatedAt: number;
}

export interface VideoProgress {
  title: string;
  currentTime: number;
  duration: number;
  playbackRate: number;
  paused: boolean;
}

export type DetectedTaskState = "blocked" | "question" | "video_playing" | "video_paused" | "video_complete" | "completed" | "text" | "idle";

export interface TabAutomationState {
  autoAnswer: boolean;
  paused: boolean;
}

export type RuntimeMessage =
  | { type: "ANALYZE_QUESTION"; question: ExtractedQuestion; bankMatch?: BankMatch }
  | { type: "TEST_CONNECTION"; settings: ExtensionSettings }
  | { type: "TOGGLE_PANEL" }
  | { type: "VIDEO_ENDED"; courseId: string }
  | { type: "VIDEO_PROGRESS"; progress: VideoProgress }
  | { type: "PLAYBACK_PROGRESS"; progress: VideoProgress }
  | { type: "LESSON_COMPLETED"; count: number }
  | { type: "ADVANCE_LESSON" }
  | { type: "GET_TAB_PLAYBACK" }
  | { type: "SET_TAB_PLAYBACK"; enabled: boolean }
  | { type: "PLAYBACK_STATE_CHANGED"; enabled: boolean }
  | { type: "SET_PLAYBACK_RATE"; rate: number }
  | { type: "PLAYBACK_RATE_CHANGED"; rate: number }
  | { type: "SET_ACTIVE_PLAYBACK"; enabled: boolean }
  | { type: "SET_ACTIVE_PLAYBACK_RATE"; rate: number }
  | { type: "SET_ACTIVE_TEST_ASSIST"; enabled: boolean }
  | { type: "SET_TEST_ASSIST"; enabled: boolean }
  | { type: "GET_TAB_AUTOMATION" }
  | { type: "SET_TAB_AUTOMATION"; state: TabAutomationState }
  | { type: "AUTOMATION_STATE_CHANGED"; state: TabAutomationState }
  | { type: "FRAME_TASK_STATE"; state: DetectedTaskState; message: string; questionSummary?: QuestionPageSummary; answerStats?: AnswerRunStats }
  | { type: "PAGE_TASK_STATE"; state: DetectedTaskState; message: string; frameId: number; questionSummary?: QuestionPageSummary; answerStats?: AnswerRunStats }
  | { type: "FRAME_AUTO_STOPPED"; reason: string; answerStats?: AnswerRunStats }
  | { type: "PAGE_AUTO_STOPPED"; reason: string; answerStats?: AnswerRunStats }
  | { type: "GET_PAGE_ASSIST_STATUS" }
  | { type: "GET_ACTIVE_STATUS" }
  | { type: "CLEAR_SESSION" };

export interface MessageResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
