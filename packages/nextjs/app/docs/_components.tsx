"use client";

import { useState } from "react";
import Link from "next/link";
import { DOC_PAGES, docHref } from "./_pages";

/** Numbered section heading with a copyable anchor, matching the sidebar's section list. */
export const Section = ({
  id,
  n,
  title,
  children,
}: {
  id: string;
  n?: number;
  title: string;
  children: React.ReactNode;
}) => (
  <section id={id} className="scroll-mt-24">
    <h2 className="group">
      {n !== undefined && <span className="docs-num">{String(n).padStart(2, "0")}</span>}
      {title}
      <a href={`#${id}`} className="docs-anchor" aria-label={`Link to ${title}`}>
        #
      </a>
    </h2>
    {children}
  </section>
);

export const Code = ({ lang = "Shell", children }: { lang?: string; children: string }) => {
  const [copied, setCopied] = useState(false);
  const text = children.replace(/^\n/, "").replace(/\n\s*$/, "");
  return (
    <div className="docs-code">
      <div className="docs-code-bar">
        <span>{lang}</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(text).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              },
              () => undefined,
            );
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{text}</code>
      </pre>
    </div>
  );
};

export const Note = ({ tone = "info", children }: { tone?: "info" | "warn"; children: React.ReactNode }) => (
  <div className={`docs-note ${tone === "warn" ? "docs-note-warn" : ""}`}>{children}</div>
);

export const Table = ({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) => (
  <div className="docs-table">
    <table>
      <thead>
        <tr>
          {head.map(h => (
            <th key={h}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/** Page title block plus the "next page" card at the bottom. */
export const DocPageShell = ({
  slug,
  lead,
  children,
}: {
  slug: string;
  lead: React.ReactNode;
  children: React.ReactNode;
}) => {
  const index = DOC_PAGES.findIndex(p => p.slug === slug);
  const page = DOC_PAGES[index];
  const next = DOC_PAGES[index + 1];
  return (
    <article className="docs-article">
      <p className="docs-eyebrow">
        {String(index + 1).padStart(2, "0")} · {page.minutes} min read
      </p>
      <h1>{page.title}</h1>
      <div className="docs-lead">{lead}</div>
      {children}
      {next && (
        <Link href={docHref(next.slug)} className="docs-next">
          <span>
            Next · {next.minutes} min
            <strong>{next.title}</strong>
          </span>
          <span aria-hidden>→</span>
        </Link>
      )}
    </article>
  );
};
