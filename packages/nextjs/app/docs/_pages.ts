/** The docs table of contents. Section ids must match the `id` of each <Section> on the page. */
export type DocPage = { slug: string; title: string; minutes: number; sections: { id: string; title: string }[] };

export const DOC_PAGES: DocPage[] = [
  {
    slug: "",
    title: "Quickstart",
    minutes: 6,
    sections: [
      { id: "scaffold", title: "Scaffold it" },
      { id: "relayer", title: "Configure the relayer" },
      { id: "run", title: "Run the app" },
      { id: "sauce", title: "Get test SAUCE" },
      { id: "send", title: "Send a gift" },
      { id: "claim", title: "Claim it with no wallet" },
      { id: "proof", title: "Prove it on testnet" },
      { id: "commands", title: "Command reference" },
    ],
  },
  {
    slug: "links",
    title: "Create and claim",
    minutes: 7,
    sections: [
      { id: "anatomy", title: "Anatomy of a link" },
      { id: "create", title: "Creating a link" },
      { id: "policy", title: "Who keeps the yield" },
      { id: "receive", title: "Three ways to receive" },
      { id: "relay", title: "The relayer submits it" },
      { id: "refund", title: "Cancel and refund" },
      { id: "states", title: "Life of a link" },
    ],
  },
  {
    slug: "contract",
    title: "Contract reference",
    minutes: 8,
    sections: [
      { id: "constants", title: "Constants" },
      { id: "create-link", title: "createLink" },
      { id: "claim-fn", title: "claim" },
      { id: "refund-fn", title: "refund" },
      { id: "views", title: "Views and fees" },
      { id: "events", title: "Events" },
      { id: "errors", title: "Errors" },
      { id: "source", title: "The source" },
    ],
  },
  {
    slug: "fees",
    title: "Fees and guarantees",
    minutes: 5,
    sections: [
      { id: "rule", title: "The rule" },
      { id: "dust", title: "The rounding reserve" },
      { id: "prepaid", title: "The prepaid network fee" },
      { id: "measured", title: "What a claim costs" },
      { id: "units", title: "Tinybar and weibar" },
      { id: "stuck", title: "When a fee cannot be paid" },
    ],
  },
  {
    slug: "architecture",
    title: "Architecture",
    minutes: 6,
    sections: [
      { id: "split", title: "The split" },
      { id: "contracts", title: "The contracts" },
      { id: "accounting", title: "Pooled shares" },
      { id: "routes", title: "The relayer routes" },
      { id: "absent", title: "What is deliberately absent" },
    ],
  },
  {
    slug: "yield-sources",
    title: "Add a yield source",
    minutes: 6,
    sections: [
      { id: "interface", title: "The interface" },
      { id: "smallest", title: "The smallest source" },
      { id: "real", title: "A real venue" },
      { id: "steps", title: "Ship it" },
      { id: "bonzo", title: "Next candidate: Bonzo" },
    ],
  },
  {
    slug: "hedera-notes",
    title: "Hedera notes",
    minutes: 8,
    sections: [
      { id: "tooling", title: "Transactions and tooling" },
      { id: "hts", title: "HTS and HIP-904" },
      { id: "accounts", title: "Accounts and wallet apps" },
      { id: "saucerswap", title: "SaucerSwap addresses" },
      { id: "dead-ends", title: "Dead ends" },
    ],
  },
  {
    slug: "security",
    title: "Security",
    minutes: 6,
    sections: [
      { id: "bearer", title: "A link is bearer value" },
      { id: "trust", title: "Who can do what" },
      { id: "threats", title: "Threats and what stops them" },
      { id: "gaps", title: "Known gaps" },
    ],
  },
];

export const docHref = (slug: string) => (slug ? `/docs/${slug}` : "/docs");
