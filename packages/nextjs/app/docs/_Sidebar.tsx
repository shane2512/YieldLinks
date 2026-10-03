"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOC_PAGES, docHref } from "./_pages";

const Nav = () => {
  const pathname = usePathname();
  return (
    <nav aria-label="Docs pages">
      <p className="docs-side-label">Pages</p>
      <ol className="docs-side">
        {DOC_PAGES.map((page, i) => {
          const href = docHref(page.slug);
          const active = pathname === href;
          return (
            <li key={href}>
              <Link href={href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
                <span className="docs-num">{String(i + 1).padStart(2, "0")}</span>
                {page.title}
              </Link>
              {active && (
                <ol className="docs-side-sections">
                  {page.sections.map((s, j) => (
                    <li key={s.id}>
                      <a href={`#${s.id}`}>
                        <span className="docs-num">{String(j + 1).padStart(2, "0")}</span>
                        {s.title}
                      </a>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

export const Sidebar = () => (
  <>
    <details className="docs-side-mobile lg:hidden">
      <summary>Docs menu</summary>
      <Nav />
    </details>
    <aside className="docs-side-desktop hidden lg:block">
      <Nav />
    </aside>
  </>
);
