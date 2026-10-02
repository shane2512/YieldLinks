import type { NextPage } from "next";
import { CreateLinkForm } from "~~/components/yieldlinks/CreateLinkForm";

const steps = [
  {
    title: "Stake and share",
    body: "Pick an amount. It is staked in SaucerSwap's Infinity Pool and you get a link, a QR code and nothing to sign twice.",
  },
  {
    title: "It grows",
    body: "While the link sits unclaimed, the pool's swap-fee rewards accrue. You choose who keeps the yield.",
  },
  {
    title: "One tap to claim",
    body: "No wallet, no HBAR, no token setup. The claim creates a Hedera account if needed and delivers the token.",
  },
];

const underTheHood = [
  [
    "SaucerSwap Infinity Pool",
    "Escrow is staked as xSAUCE. Remove it and there is no yield and nowhere to hold the funds.",
  ],
  ["HIP-904 airdrop", "Payouts auto-create the recipient's account and associate the token in the same transaction."],
  [
    "EIP-712 claims",
    "The link key signs a claim bound to the recipient, chain and contract, so a mempool watcher cannot redirect it.",
  ],
  [
    "Permissionless refund",
    "After expiry anyone can return the gift to the sender. Nothing depends on a keeper or a schedule.",
  ],
] as const;

const Home: NextPage = () => (
  <div className="grow">
    <section className="px-5 pt-14 pb-10 text-center">
      <div className="mx-auto max-w-3xl">
        <p className="text-sm uppercase tracking-[0.25em] text-primary font-semibold mb-4">Gift links on Hedera</p>
        <h1 className="text-4xl sm:text-6xl font-bold tracking-tight">
          Gifts that <span className="text-primary">grow</span>.
        </h1>
        <p className="mt-5 text-lg text-base-content/70 max-w-2xl mx-auto">
          Send SAUCE to anyone with a link. It earns yield until they claim it, and they never need a wallet, HBAR or
          any setup. A relayer pays the network fee, about 1.3 HBAR per claim on testnet.
        </p>
      </div>
    </section>

    <section className="px-5">
      <div className="mx-auto max-w-xl rounded-3xl border border-base-300 bg-base-100 shadow-xl p-6 sm:p-10">
        <CreateLinkForm />
      </div>
      <p className="mx-auto max-w-xl mt-3 text-xs text-center text-base-content/50">
        Running on Hedera testnet. You need testnet SAUCE: swap testnet HBAR for it on SaucerSwap.
      </p>
    </section>

    <section className="px-5 py-16">
      <div className="mx-auto max-w-4xl">
        <h2 className="text-2xl font-bold text-center mb-8">How it works</h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {steps.map((step, i) => (
            <li key={step.title} className="rounded-2xl bg-base-200 p-5">
              <div className="text-primary font-mono text-sm mb-2">0{i + 1}</div>
              <h3 className="font-semibold mb-1">{step.title}</h3>
              <p className="text-sm text-base-content/70">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>

    <section className="px-5 pb-20">
      <div className="mx-auto max-w-4xl">
        <h2 className="text-2xl font-bold text-center mb-8">Under the hood</h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          {underTheHood.map(([term, description]) => (
            <div key={term} className="rounded-2xl border border-base-300 p-5">
              <dt className="font-semibold mb-1">{term}</dt>
              <dd className="text-sm text-base-content/70">{description}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  </div>
);

export default Home;
