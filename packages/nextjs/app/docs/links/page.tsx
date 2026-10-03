import { Code, DocPageShell, Note, Section, Table } from "../_components";

export const metadata = { title: "Create and claim" };

export default function LinksPage() {
  return (
    <DocPageShell
      slug="links"
      lead={
        <p>
          What happens between a sender clicking <strong>Create gift link</strong> and a recipient holding the tokens:
          the link itself, the two transactions that create it, the three ways to receive, and how an unclaimed link
          comes home.
        </p>
      }
    >
      <Section id="anatomy" n={1} title="Anatomy of a link">
        <Code lang="URL">{`https://yield-links-hedera.vercel.app/claim#k=0x<64 hex characters>&c=296`}</Code>
        <Table
          head={["Part", "Meaning"]}
          rows={[
            [
              <code key="k">k</code>,
              "The private half of a throwaway key made in the sender's browser. Its address is the link's linkKey on chain.",
            ],
            [<code key="c">c</code>, "The chain id: 296 is Hedera testnet, 295 is mainnet."],
            [
              <code key="h">#</code>,
              "Everything after it is the fragment. Browsers never send the fragment to a server, so the key never reaches the app, the relayer or a log.",
            ],
          ]}
        />
        <p>
          The key is single use, forever. Links are never deleted, only moved to <code>Claimed</code> or{" "}
          <code>Refunded</code>, so an old signature can never be replayed against a new link that reuses a key.
        </p>
        <Note tone="warn">
          A link is bearer value. Whoever has it can claim it to any address. Share it like cash, and keep expiries
          short.
        </Note>
      </Section>

      <Section id="create" n={2} title="Creating a link">
        <p>The sender signs two transactions:</p>
        <ol className="steps">
          <li>
            <strong>Approve the source</strong>, not <code>YieldLinks</code>, for <code>amount + ROUNDING_DUST</code>.
            The source pulls the tokens, because it is the only contract that ever holds them.
          </li>
          <li>
            <strong>
              <code>createLink(linkKey, token, amount, expiry, policy)</code>
            </strong>{" "}
            with 1.5 HBAR attached as the prepaid network fee.
          </li>
        </ol>
        <Code lang="TypeScript">{`import { newKeypair, buildClaimUrl } from "~~/utils/yieldlinks";

const { privateKey, address: linkKey } = newKeypair();
// approve(source, amount + 10n), then:
await writeLinks({
  functionName: "createLink",
  args: [linkKey, SAUCE, amount, expiry, policy],
  value: parseEther("1.5"),
});
const url = buildClaimUrl(window.location.origin, privateKey, chainId);`}</Code>
        <p>
          Inside the call the source stakes the SAUCE in SaucerSwap&apos;s Infinity Pool (<code>enter</code>, SAUCE to
          xSAUCE) and <code>YieldLinks</code> mints the link its shares of the pool. Expiry must be in the future and at
          most 365 days away; the UI offers 1, 7 or 30 days.
        </p>
      </Section>

      <Section id="policy" n={3} title="Who keeps the yield">
        <p>Chosen per link, and fixed once it is created.</p>
        <Table
          head={["Policy", "Recipient gets", "Yield goes to"]}
          rows={[
            [<code key="r">Recipient</code>, "Principal plus yield", "The recipient. The gift grows for them."],
            [<code key="s">Sender</code>, "The principal", "The sender, paid out in the same claim"],
            [
              <code key="c">Charity</code>,
              "The principal",
              "The CHARITY address set at deploy (CHARITY_ADDRESS, defaults to the deployer)",
            ],
          ]}
        />
      </Section>

      <Section id="receive" n={4} title="Three ways to receive">
        <Table
          head={["Option", "For", "What happens"]}
          rows={[
            [
              <strong key="n">New wallet</strong>,
              "Someone with nothing",
              "The browser generates an ED25519 key. The relayer creates the account for it (0.1 HBAR welcome balance, unlimited token auto-association), then the claim pays it.",
            ],
            [
              <strong key="m">My wallet</strong>,
              "Anyone with a wallet, including MetaMask",
              "Connect, and the claim pays the connected address.",
            ],
            [
              <strong key="a">Address</strong>,
              "Paying someone else",
              "Paste any EVM address. It need not exist on Hedera yet: the HIP-904 airdrop creates it.",
            ],
          ]}
        />
        <p>
          A generated wallet is shown once, in two forms: the 96-character DER key (<code>302e…</code>) that HashPack
          imports, and the 64-character raw key. It works in HashPack, Blade and Hedera tools, but not MetaMask, which
          only takes ECDSA keys. Anyone who wants MetaMask should choose <strong>My wallet</strong>.
        </p>
      </Section>

      <Section id="relay" n={5} title="The relayer submits it">
        <p>The claim page never sends the private key anywhere. It signs a claim and posts the signature:</p>
        <Code lang="TypeScript">{`// EIP-712, domain { name: "YieldLinks", version: "1", chainId, verifyingContract }
// type Claim(address linkKey, address recipient)
const signature = await signClaim(privateKey, contract, chainId, recipient);
await fetch("/api/claim", {
  method: "POST",
  body: JSON.stringify({ chainId, linkKey, recipient, signature }),
});`}</Code>
        <p>
          <code>/api/claim</code> checks the link prepaid at least 1.35 HBAR, simulates the call, and only then sends{" "}
          <code>claim</code>. A bad claim costs the relayer nothing. On chain the contract recovers the signer, which
          must equal <code>linkKey</code>, so a watcher who swaps in their own recipient breaks the signature.
        </p>
        <p>
          The claim prices the link&apos;s shares, unstakes from SaucerSwap, and pays through a HIP-904 airdrop, which
          creates and associates the recipient&apos;s account if needed. The prepaid fee goes to whoever submitted it.
        </p>
      </Section>

      <Section id="refund" n={6} title="Cancel and refund">
        <Table
          head={["When", "Who may call refund", "Where it goes"]}
          rows={[
            ["Before expiry", "Only the sender", "Principal, yield and the prepaid fee, back to the sender"],
            ["After expiry", "Anyone", "Still only the sender"],
          ]}
        />
        <p>
          Nothing needs a keeper or a schedule: an expired link just waits until someone calls <code>refund</code>. The
          sender cancels from <strong>My links</strong>.
        </p>
      </Section>

      <Section id="states" n={7} title="Life of a link">
        <Code lang="State">{`None ──createLink──▶ Open ──claim (valid signature, before expiry)──▶ Claimed
                       │
                       └──refund (sender any time, anyone after expiry)──▶ Refunded`}</Code>
        <p>
          <code>Claimed</code> and <code>Refunded</code> are final. The link&apos;s shares are burned and its fee is
          zeroed in the same step, before any tokens move.
        </p>
      </Section>
    </DocPageShell>
  );
}
