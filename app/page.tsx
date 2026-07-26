import type { Metadata } from "next";
import XianjianApp from "./xianjian-app";

export const metadata: Metadata = {
  title: "先鉴｜个性化会议价值判断",
  description:
    "不必看完整场会议。先鉴会根据你的项目和知识背景，只留下真正值得看的时间码。",
};

export default function Home() {
  return <XianjianApp />;
}
