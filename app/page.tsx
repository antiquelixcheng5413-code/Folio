import type { Metadata } from "next";
import PeekApp from "./peek-app";

export const metadata: Metadata = {
  title: "先鉴 Peek｜先判断值不值得看",
  description:
    "不必看完整场内容。先鉴 Peek 会判断内容含金量和与你的匹配度，只留下真正值得投入的部分。",
};

export default function Home() {
  return <PeekApp />;
}
