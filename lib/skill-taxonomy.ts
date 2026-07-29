import type { SkillPoint, XianjianAnalysisResult } from "./types";
import { skillKey } from "./personalization";

const GENERIC_NAMES = new Set([
  "数学史",
  "数学",
  "几何测度论",
  "调和分析",
  "偏微分方程",
  "背景介绍",
  "证明策略",
  "核心方法",
  "技术细节",
  "完整证明",
  "研究成果",
  "问题定义",
  "实际应用",
  "总结",
]);

export function canonicalSkillName(input: string) {
  let name = String(input || "")
    .normalize("NFKC")
    .replace(/^[+✓\s]+/, "")
    .replace(/^(理解|掌握|学习|运用|使用|介绍|讲解|关于)\s*/, "")
    .replace(/^.*中的(?=[\p{Script=Han}A-Za-z-]{2,18}$)/u, "")
    .replace(/^三维(?=挂谷猜想)/, "")
    .trim();
  if (name.includes("挂谷猜想")) name = "挂谷猜想";
  if (name.includes("粘性挂谷集")) name = "粘性挂谷集";
  const namedDimension = name.match(
    /(豪斯多夫维数|闵可夫斯基维数|Hausdorff\s*维数|Minkowski\s*维数|Assouad\s*维数)$/i
  );
  if (namedDimension) name = namedDimension[1].replace(/\s+/g, "");
  if (name.includes("：") || name.includes(":")) name = name.split(/[：:]/)[0].trim();
  if (
    !name ||
    name.length < 2 ||
    name.length > 20 ||
    /[，。；！？]/.test(name) ||
    GENERIC_NAMES.has(name) ||
    /(已被|获得|发表于|提供了|完成了|证明了|评价为|是谁|为什么|是否|将|任何|包含)/.test(name)
  ) {
    return "";
  }
  return name;
}

export function inferSkillTaxonomy(name: string) {
  if (
    /(数学|几何|代数|微积分|概率|统计|猜想|维数|集合|傅里叶|Assouad|拓扑|数论|证明|方程|矩阵|向量|归纳)/i.test(
      name
    )
  ) {
    const domain = /(挂谷|豪斯多夫|闵可夫斯基|几何测度|Assouad|粘性)/i.test(name)
      ? "几何测度论"
      : /(调和|傅里叶|多尺度)/i.test(name)
        ? "调和分析"
        : "数学";
    return { category: "数学", domain };
  }
  if (/(编程|算法|数据结构|数据库|网络|操作系统|机器学习|深度学习|神经网络|软件)/i.test(name)) {
    return { category: "计算机科学", domain: "计算机科学" };
  }
  if (/(经济|金融|会计|市场|商业|管理|投资)/i.test(name)) {
    return { category: "商业与经济", domain: "商业与经济" };
  }
  if (/(物理|力学|量子|电磁|热力学)/i.test(name)) {
    return { category: "自然科学", domain: "物理学" };
  }
  if (/(化学|分子|反应|有机化学)/i.test(name)) {
    return { category: "自然科学", domain: "化学" };
  }
  if (/(生物|细胞|基因|蛋白质|生态)/i.test(name)) {
    return { category: "自然科学", domain: "生物学" };
  }
  return { category: "未分类", domain: "未分类" };
}

function candidateTerms(result: XianjianAnalysisResult) {
  const terms = result.segments.flatMap((segment) => segment.tags || []);
  const text = JSON.stringify({
    summary: result.summary,
    evidence: result.evidence,
    segments: result.segments.map((segment) => ({
      title: segment.title,
      value: segment.value,
      evidence: segment.evidence,
    })),
  });
  const patterns = [
    /(?:豪斯多夫|闵可夫斯基|Assouad|Hausdorff|Minkowski)\s*维数/giu,
  ];
  for (const pattern of patterns) terms.push(...text.matchAll(pattern).map((match) => match[0]));
  return [...new Set(terms.map(canonicalSkillName).filter(Boolean))];
}

export function extractLegacySkillPoints(result: XianjianAnalysisResult): SkillPoint[] {
  return candidateTerms(result)
    .map((name, index) => {
      const related = result.segments.find(
        (segment) =>
          segment.tags.some((tag) => tag.includes(name) || name.includes(tag)) ||
          `${segment.title}${segment.value}${segment.evidence}`.includes(name)
      );
      const taxonomy = inferSkillTaxonomy(name);
      const description =
        related?.value ||
        related?.evidence ||
        `${name}在本内容中的定义、作用与相关推导。`;
      return {
        key: skillKey(`${taxonomy.category}/${taxonomy.domain}`, name) || `legacy-skill-${index + 1}`,
        category: taxonomy.category,
        domain: taxonomy.domain,
        name,
        description,
        type: "concept" as const,
        relation: "new" as const,
        prerequisites: [],
        evidence: related?.evidence ? [related.evidence] : result.evidence.slice(0, 1),
        learningOutcome: `能够解释${name}的定义、适用范围及其在内容中的作用。`,
        coverage: related ? 60 : 40,
        depth: result.signals.depth,
        relevance: result.signals.match,
        userMasteryBefore: 0,
        prerequisiteFit: 50,
        confidence: related ? 70 : 50,
      };
    })
    .filter((item) => item.category !== "未分类")
    .slice(0, 16);
}
