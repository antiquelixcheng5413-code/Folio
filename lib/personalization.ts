import type {
  PersonalizationScore,
  SkillPoint,
  XianjianAnalysisResult,
} from "./types";

export type StoredProfileSkill = {
  meetingId?: string;
  key: string;
  name: string;
  domain: string;
  mastery: number;
  confidence: number;
};

function clamp(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

export function skillKey(domain: string, name: string) {
  return `${domain}:${name}`
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
}

export function profileFingerprint(skills: StoredProfileSkill[]) {
  const source = skills
    .map((item) => `${item.key}:${clamp(item.mastery)}:${clamp(item.confidence)}`)
    .sort()
    .join("|");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `p2-${(hash >>> 0).toString(16).padStart(8, "0")}-${skills.length}`;
}

function legacySkills(result: XianjianAnalysisResult): SkillPoint[] {
  const convert = (
    item: XianjianAnalysisResult["newKnowledge"][number],
    relation: SkillPoint["relation"],
    index: number
  ): SkillPoint => ({
    key: skillKey("未分类", item.topic) || `legacy-${index}`,
    domain: "未分类",
    name: item.topic,
    description: item.evidence,
    type: "concept",
    relation,
    prerequisites: [],
    evidence: item.evidence ? [item.evidence] : [],
    learningOutcome: item.evidence,
    coverage: 55,
    depth: clamp(result.signals.depth),
    relevance: clamp(result.signals.match || 50),
    userMasteryBefore: relation === "reinforce" ? 65 : 10,
    prerequisiteFit: 55,
    confidence: 45,
  });
  return [
    ...result.newKnowledge.map((item, index) => convert(item, "new", index)),
    ...result.repeatedKnowledge.map((item, index) =>
      convert(item, "reinforce", result.newKnowledge.length + index)
    ),
  ].slice(0, 12);
}

function relationshipScore(skill: SkillPoint, profile: StoredProfileSkill[]) {
  if (!profile.length) return 50;
  const exact = profile.some((item) => item.key === skill.key);
  if (exact) return 96;
  const sameDomain = profile.some(
    (item) => item.domain && item.domain.toLowerCase() === skill.domain.toLowerCase()
  );
  const prerequisite = profile.some((item) =>
    skill.prerequisites.some((required) => {
      const needle = required.toLowerCase();
      return item.name.toLowerCase().includes(needle) || needle.includes(item.name.toLowerCase());
    })
  );
  if (prerequisite) return 84;
  if (sameDomain) return 72;
  return 18;
}

function currentMastery(skill: SkillPoint, profile: StoredProfileSkill[]) {
  const exact = profile.filter((item) => item.key === skill.key);
  if (exact.length) return Math.max(...exact.map((item) => clamp(item.mastery)));
  const sameDomain = profile.filter(
    (item) => item.domain && item.domain.toLowerCase() === skill.domain.toLowerCase()
  );
  if (sameDomain.length) {
    return Math.round(Math.max(...sameDomain.map((item) => clamp(item.mastery))) * 0.35);
  }
  return 0;
}

function contentValue(result: XianjianAnalysisResult) {
  return clamp(
    Number.isFinite(result.signals.value)
      ? result.signals.value
      : result.signals.depth * 0.35 +
          result.signals.sourceReliability * 0.35 +
          (100 - result.signals.promotion) * 0.15 +
          (100 - result.signals.repetition) * 0.15
  );
}

export function recalculatePersonalMatch(
  result: XianjianAnalysisResult,
  profile: StoredProfileSkill[]
) {
  const sourceSkills = result.skillAssessment
    ? result.skillAssessment.skills
    : legacySkills(result);
  const skills = sourceSkills.map((skill) => {
    const mastery = currentMastery(skill, profile);
    return { ...skill, userMasteryBefore: mastery };
  });
  const weighted = skills.map((skill) => {
    const weight = Math.max(1, skill.coverage) * Math.max(0.25, skill.confidence / 100);
    const relationship = relationshipScore(skill, profile);
    const relevance = clamp(skill.relevance * 0.35 + relationship * 0.65);
    const gain = clamp((100 - skill.userMasteryBefore) * (skill.coverage / 100));
    const levelFit = clamp(100 - Math.abs(skill.depth - Math.min(100, skill.userMasteryBefore + 25)));
    const difficultyFit = clamp(levelFit * 0.6 + skill.prerequisiteFit * 0.4);
    return { weight, relevance, gain, difficultyFit };
  });
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0) || 1;
  const average = (field: "relevance" | "gain" | "difficultyFit") =>
    clamp(weighted.reduce((sum, item) => sum + item[field] * item.weight, 0) / totalWeight);
  const relevance = average("relevance");
  const knowledgeGain = average("gain");
  const difficultyFit = average("difficultyFit");
  const skillFit = clamp(relevance * 0.5 + knowledgeGain * 0.3 + difficultyFit * 0.2);
  const value = contentValue(result);
  // A low-value item cannot obtain a high final match merely by sharing the same topic.
  const valueMultiplier = Math.round((0.15 + 0.85 * (value / 100)) * 100) / 100;
  const match = clamp(skillFit * valueMultiplier);
  const fingerprint = profileFingerprint(profile);
  const basis = `技能关联 ${relevance}% × 知识增益 ${knowledgeGain}% × 难度适配 ${difficultyFit}%，再乘内容含金量系数 ${valueMultiplier.toFixed(2)}`;
  const personalization: PersonalizationScore = {
    formulaVersion: "peek.match.v2",
    profileFingerprint: fingerprint,
    evaluatedAt: new Date().toISOString(),
    relevance,
    skillFit,
    knowledgeGain,
    difficultyFit,
    valueMultiplier,
    basis,
  };
  const verdict =
    value < 35 || match < 25
      ? "skip"
      : value >= 65 && match >= 70
        ? "worth"
        : "selective";
  return {
    ...result,
    verdict,
    signals: {
      ...result.signals,
      match,
      matchReason: `${basis}，最终匹配度 ${match}%。`,
    },
    skillAssessment: {
      protocolVersion: "peek.skill.v2",
      domainSummary:
        result.skillAssessment?.domainSummary ||
        [...new Set(skills.map((skill) => skill.domain).filter(Boolean))].join("、") ||
        "尚未形成专业领域归类",
      skills,
    },
    personalization,
  } satisfies XianjianAnalysisResult;
}
