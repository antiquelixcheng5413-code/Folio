import { getSession, json } from "../../../lib/db";

const transcript = `WEBVTT

00:00:00.000 --> 00:01:20.000
主持人：今天不讨论“再做一个聊天框”，我们复盘团队怎样把长任务 Agent 从演示推进到真实产品。

00:01:20.000 --> 00:03:10.000
讲者：第一个误区是把 Memory 当成无限存储。我们先定义遗忘策略：过期、冲突、低置信度三类记忆必须主动降权。

00:03:10.000 --> 00:05:40.000
讲者：在一轮用户研究里，我们发现用户真正害怕的不是等待，而是不知道系统是否还在工作。于是进度只展示可验证的阶段，不伪造百分比。

00:05:40.000 --> 00:08:30.000
工程负责人：生产事故来自工具调用重试。支付工具超时后被重复执行。修复方案是外部副作用先写幂等键，恢复时先查询，再决定是否重试。

00:08:30.000 --> 00:10:10.000
讲者：接下来两分钟介绍我们的合作伙伴和课程优惠，这部分不包含工程细节。

00:10:10.000 --> 00:13:40.000
评估负责人：评估不应只有成功率。我们把错误分成理解错误、计划错误、工具错误和恢复错误，并把每类错误映射回界面提示与人工接管点。

00:13:40.000 --> 00:16:20.000
产品设计师：结果页必须同时给结论、证据和下一步。用户可以沿时间码回到原始材料，才能建立对 Agent 的校准信任。

00:16:20.000 --> 00:18:00.000
主持人：总结三点：记忆要会忘、外部写入要幂等、长任务的进度和结果必须可核验。`;

export async function GET(request: Request) {
  const session = await getSession(request);
  return json(
    {
      demo: {
        title: "从 Demo 到可靠产品：长任务 Agent 的四个真实复盘",
        source: "先鉴 Peek 原创模拟会议 · Agent Systems Forum 2026",
        transcript,
      },
      profiles: [
        {
          id: "product",
          name: "Agent 产品新人",
          profile: {
            direction: "Agent 产品与交互设计",
            level: "入门",
            project: "设计一个可解释的长任务产品体验",
            knownTopics: "Prompt 基础、用户研究",
            preferences: "优先真实案例；保留产品方法；跳过深度基础设施细节",
          },
        },
        {
          id: "engineer",
          name: "资深 Agent 工程师",
          profile: {
            direction: "可靠 Agent 系统工程",
            level: "资深",
            project: "建设可恢复、可观测的生产级 Agent 平台",
            knownTopics: "Prompt、RAG、工具调用、Memory 基础、Agent 评估",
            preferences: "只保留新颖工程细节和事故复盘；跳过基础概念与推广",
          },
        },
      ],
    },
    {},
    session.cookie
  );
}
