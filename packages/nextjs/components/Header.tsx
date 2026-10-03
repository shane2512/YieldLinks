"use client";

import React, { useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bars3Icon, BugAntIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-hbar";
import { useOutsideClick } from "~~/hooks/scaffold-hbar";

type HeaderMenuLink = {
  label: string;
  href: string;
  icon?: React.ReactNode;
  /** Developer tools: shown in the mobile menu, but only on extra-wide screens in the desktop nav. */
  devTool?: boolean;
};

export const menuLinks: HeaderMenuLink[] = [
  {
    label: "Send a gift",
    href: "/",
  },
  {
    label: "My links",
    href: "/links",
  },
  {
    label: "Docs",
    href: "/docs",
  },
  {
    label: "Debug Contracts",
    href: "/debug",
    icon: <BugAntIcon className="h-4 w-4" />,
    devTool: true,
  },
  {
    label: "Block Explorer",
    href: "/blockexplorer",
    icon: <MagnifyingGlassIcon className="h-4 w-4" />,
    devTool: true,
  },
];

export const HeaderMenuLinks = ({ desktop = false }: { desktop?: boolean }) => {
  const pathname = usePathname();

  return (
    <>
      {menuLinks.map(({ label, href, icon, devTool }) => {
        const isActive = href === "/" ? pathname === href : pathname.startsWith(href);
        return (
          <li key={href} className={desktop && devTool ? "hidden xl:block" : undefined}>
            <Link
              href={href}
              passHref
              className={`${
                isActive ? "bg-primary/10 text-primary font-semibold" : "hover:bg-primary/5"
              } py-1.5 px-3 text-sm rounded-full gap-2 grid grid-flow-col transition-colors`}
            >
              {icon}
              <span>{label}</span>
            </Link>
          </li>
        );
      })}
    </>
  );
};

/**
 * Site header
 */
export const Header = () => {
  const burgerMenuRef = useRef<HTMLDetailsElement>(null);
  // Recipients opening a gift link have no wallet and should not see wallet or developer chrome.
  const isClaimPage = usePathname().startsWith("/claim");
  useOutsideClick(burgerMenuRef, () => {
    burgerMenuRef?.current?.removeAttribute("open");
  });

  return (
    <div className="sticky lg:static top-0 navbar bg-base-100 min-h-0 shrink-0 justify-between z-20 shadow-sm border-b border-base-300 px-0 sm:px-2">
      <div className="navbar-start w-auto min-w-0 flex-1">
        <details className={`dropdown ${isClaimPage ? "hidden" : ""}`} ref={burgerMenuRef}>
          <summary className="ml-1 btn btn-ghost lg:hidden hover:bg-transparent">
            <Bars3Icon className="h-1/2" />
          </summary>
          <ul
            className="menu menu-compact dropdown-content mt-3 p-2 shadow-sm bg-base-100 rounded-box w-52"
            onClick={() => {
              burgerMenuRef?.current?.removeAttribute("open");
            }}
          >
            <HeaderMenuLinks />
          </ul>
        </details>
        <Link
          href="/"
          passHref
          className={`${isClaimPage ? "flex" : "hidden lg:flex"} items-center gap-3 ml-4 mr-6 shrink-0`}
        >
          {/* Sprout mark: stem and leaves form a Y; the violet leaf is the yield. Source: design/assets/logo/mark.svg */}
          <svg aria-hidden="true" className="w-9 h-9 text-base-content" viewBox="0 0 64 64" fill="none">
            <path d="M32 60V35" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
            <path d="M32 36C17 36 7.5 26.5 7.5 11.5C22.5 11.5 32 21 32 36Z" fill="currentColor" />
            <path d="M32 36C32 17.5 42.5 5.5 58.5 5C58.5 22 48.5 36 32 36Z" fill="#8259EF" />
          </svg>
          <div className="flex flex-col">
            <span className="font-bold leading-tight text-base">YieldLinks</span>
            <span className="text-[10px] tracking-wider uppercase text-base-content/50 font-medium">
              Gifts that grow
            </span>
          </div>
        </Link>
        {!isClaimPage && (
          <ul className="hidden lg:flex lg:flex-nowrap menu menu-horizontal px-1 gap-2">
            <HeaderMenuLinks desktop />
          </ul>
        )}
      </div>
      {!isClaimPage && (
        <div className="navbar-end w-auto shrink-0 mr-4">
          <RainbowKitCustomConnectButton />
        </div>
      )}
    </div>
  );
};
