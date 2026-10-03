import { Sidebar } from "./_Sidebar";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Docs",
  description:
    "Build with the YieldLinks scaffold-hbar template: quickstart, contract reference, fees, architecture and Hedera notes.",
  imageRelativePath: "/thumbnail-docs.jpg",
});

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="docs-shell">
      <Sidebar />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
