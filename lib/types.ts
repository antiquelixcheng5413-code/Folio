export type Verdict = "worth" | "selective" | "skip";
export type SegmentDecision = "watch" | "skip";
export type ContentType = "video" | "article" | "paper";

export interface ContentLocator {
  heading?: string;
  quote?: string;
  pageNumber?: number;
}

export interface AnalysisSegment {
  id: string;
  startSeconds: number;
  endSeconds: number;
  decision: SegmentDecision;
  title: string;
  value: string;
  evidence: string;
  tags: string[];
  locator?: ContentLocator;
}

export interface KnowledgeItem {
  topic: string;
  evidence: string;
}

export interface XianjianAnalysisResult {
  schemaVersion: "xianjian.v1";
  contentTitle?: string;
  verdict: Verdict;
  summary: string;
  evidence: string[];
  signals: {
    match: number;
    matchReason: string;
    value: number;
    valueReason: string;
    depth: number;
    promotion: number;
    repetition: number;
    sourceReliability: number;
  };
  segments: AnalysisSegment[];
  newKnowledge: KnowledgeItem[];
  repeatedKnowledge: KnowledgeItem[];
  totalDurationSeconds: number;
  recommendedSeconds: number;
  savedSeconds: number;
}

export interface LearningProfile {
  direction: string;
  level: string;
  project: string;
  knownTopics: string;
  preferences: string;
}
