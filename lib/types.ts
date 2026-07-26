export type Verdict = "worth" | "selective" | "skip";
export type SegmentDecision = "watch" | "skip";

export interface AnalysisSegment {
  id: string;
  startSeconds: number;
  endSeconds: number;
  decision: SegmentDecision;
  title: string;
  value: string;
  evidence: string;
  tags: string[];
}

export interface KnowledgeItem {
  topic: string;
  evidence: string;
}

export interface XianjianAnalysisResult {
  schemaVersion: "xianjian.v1";
  verdict: Verdict;
  summary: string;
  evidence: string[];
  signals: {
    match: number;
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
