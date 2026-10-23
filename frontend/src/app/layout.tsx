import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/inter";
import "@fontsource-variable/noto-sans-sc";
import "./globals.css";

export const metadata: Metadata = {
  title: "Horus · 研发进程，尽在掌握",
  description: "以里程碑为核心的研发掌控工作台。汇总全部在途需求，标记本周新建、卡点与逾期，让每一个关键节点都清晰可见。",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
