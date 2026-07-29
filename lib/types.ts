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

export type SkillRelation = "new" | "reinforce" | "prerequisite" | "advanced";
export type SkillType = "concept" | "method" | "tool" | "practice";

export interface SkillPoint {
  key: string;
  category: string;
  domain: string;
  name: string;
  description: string;
  type: SkillType;
  relation: SkillRelation;
  prerequisites: string[];
  evidence: string[];
  learningOutcome: string;
  coverage: number;
  depth: number;
  relevance: number;
  userMasteryBefore: number;
  prerequisiteFit: number;
  confidence: number;
}

export interface SkillAssessment {
  protocolVersion: "peek.skill.v2";
  domainSummary: string;
  skills: SkillPoint[];
}

export interface PersonalizationScore {
  formulaVersion: "peek.match.v2";
  profileFingerprint: string;
  evaluatedAt: string;
  relevance: number;
  skillFit: number;
  knowledgeGain: number;
  difficultyFit: number;
  valueMultiplier: number;
  basis: string;
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
  skillAssessment?: SkillAssessment;
  personalization?: PersonalizationScore;
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
  skills?: Array<{
    key: string;
    name: string;
    category: string;
    domain: string;
    mastery: number;
    confidence: number;
  }>;
}
