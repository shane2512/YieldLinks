// One-command proof of the whole flow on Hedera testnet: stake, claim to an address that does not exist yet, cancel.
//
//   yarn foundry:demo
//
// Needs: a deployed YieldLinks (yarn foundry:deploy --network hedera_testnet), DEPLOYER_PRIVATE_KEY in
// packages/foundry/.env with a few HBAR, and at least 4 testnet SAUCE in that account.
import { config } from "dotenv";
import { ethers } from "ethers";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const RPC_URL = process.env.HEDERA_RPC_URL || "https://testnet.hashio.io/api";
const MIRROR = "https://testnet.mirrornode.hedera.com";
const CHAIN_ID = 296;
const GAS_LIMIT = 3_000_000;
const AMOUNT = ethers.utils.parseUnits("2", 6); // 2 SAUCE per link

const linksAbi = [
  "function createLink(address linkKey, address token, uint256 amount, uint64 expiry, uint8 policy) returns (uint256)",
  "function claim(address linkKey, address recipient, bytes signature)",
  "function refund(address linkKey)",
  "function claimable(address linkKey) view returns (uint256 assets, uint256 principal)",
];
const sourceAbi = ["function SAUCE() view returns (address)"];
const erc20Abi = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

const hashscan = (path) => `https://hashscan.io/testnet/${path}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fmt = (value) => ethers.utils.formatUnits(value, 6);

const fail = (message) => {
  console.error(`\n${message}\n`);
  process.exit(1);
};

// Addresses come from this machine's own deployment if there is one, otherwise from the testnet deployment
// committed in the frontend's deployedContracts.ts, so the demo works straight after scaffolding.
const loadDeployment = () => {
  const local = join(__dirname, "..", "deployments", `${CHAIN_ID}.json`);
  if (existsSync(local)) {
    const entries = JSON.parse(readFileSync(local, "utf8"));
    const find = (name) =>
      Object.keys(entries).find((address) => entries[address] === name);
    if (find("YieldLinks") && find("YieldSource"))
      return { links: find("YieldLinks"), source: find("YieldSource") };
  }
  const generated = join(
    __dirname,
    "..",
    "..",
    "nextjs",
    "contracts",
    "deployedContracts.ts"
  );
  if (!existsSync(generated))
    fail(
      "No deployment found. Run: yarn foundry:deploy --network hedera_testnet"
    );
  const text = readFileSync(generated, "utf8");
  const pick = (name) =>
    text.match(
      new RegExp(name + String.raw`: \{\s*address: "(0x[0-9a-fA-F]{40})"`)
    )?.[1];
  const links = pick("YieldLinks");
  const source = pick("SauceStakingSource");
  if (!links || !source)
    fail(
      "deployedContracts.ts has no testnet deployment. Run: yarn foundry:deploy --network hedera_testnet"
    );
  return { links, source };
};

// Hashio can report a stale nonce after failed transactions (WRONG_NONCE); the mirror node is authoritative.
const mirrorNonce = async (address) => {
  const res = await fetch(`${MIRROR}/api/v1/accounts/${address}`);
  return (await res.json()).ethereum_nonce;
};

const main = async () => {
  if (!process.env.DEPLOYER_PRIVATE_KEY)
    fail("Set DEPLOYER_PRIVATE_KEY in packages/foundry/.env");

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL, CHAIN_ID);
  const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  const deployment = loadDeployment();
  const links = new ethers.Contract(deployment.links, linksAbi, wallet);
  const source = new ethers.Contract(deployment.source, sourceAbi, provider);
  const sauceAddress = await source.SAUCE();
  const sauce = new ethers.Contract(sauceAddress, erc20Abi, wallet);

  const balance = await sauce.balanceOf(wallet.address);
  if (balance.lt(AMOUNT.mul(2))) {
    fail(
      `Need at least 4 SAUCE in ${wallet.address} (has ${fmt(balance)}).\n` +
        "Swap testnet HBAR for SAUCE on SaucerSwap, then re-run."
    );
  }

  const send = async (label, call) => {
    await sleep(5000);
    const nonce = await mirrorNonce(wallet.address);
    // Legacy transactions with the node's own gas price: ethers' EIP-1559 fee guess can fall below Hedera's minimum.
    const tx = await call({
      nonce,
      gasLimit: GAS_LIMIT,
      type: 0,
      gasPrice: await provider.getGasPrice(),
    });
    const receipt = await tx.wait();
    console.log(
      `  ${label.padEnd(34)} ${hashscan(
        `transaction/${receipt.transactionHash}`
      )}`
    );
    return receipt;
  };

  console.log(
    `\nYieldLinks on Hedera testnet\n  contract ${deployment.links}\n  relayer  ${wallet.address}\n`
  );

  // 1. Create a link: the SAUCE is staked in SaucerSwap's Infinity Pool.
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const link = ethers.Wallet.createRandom();
  console.log("1. Create a gift link (stakes SAUCE in SaucerSwap)");
  if (
    (await sauce.allowance(wallet.address, deployment.source)).lt(AMOUNT.mul(2))
  ) {
    await send("approve SAUCE", (o) =>
      sauce.approve(deployment.source, AMOUNT.mul(2), o)
    );
  }
  await send("createLink", (o) =>
    links.createLink(link.address, sauceAddress, AMOUNT, expiry, 0, o)
  );
  await sleep(5000);
  const [assets, principal] = await links.claimable(link.address);
  console.log(`  value ${fmt(assets)} SAUCE from ${fmt(principal)}\n`);

  // 2. Claim to an address Hedera has never seen. No wallet, no HBAR, no association on the recipient's side.
  const recipient = ethers.Wallet.createRandom().address;
  const before = await fetch(`${MIRROR}/api/v1/accounts/${recipient}`);
  console.log(`2. Claim to a brand-new address ${recipient}`);
  console.log(`  account exists before the claim: ${before.status === 200}`);
  const domain = {
    name: "YieldLinks",
    version: "1",
    chainId: CHAIN_ID,
    verifyingContract: deployment.links,
  };
  const types = {
    Claim: [
      { name: "linkKey", type: "address" },
      { name: "recipient", type: "address" },
    ],
  };
  const signature = await link._signTypedData(domain, types, {
    linkKey: link.address,
    recipient,
  });
  await send("claim (submitted by the relayer)", (o) =>
    links.claim(link.address, recipient, signature, o)
  );
  await sleep(6000);
  const received = await sauce.balanceOf(recipient);
  const after = await (
    await fetch(`${MIRROR}/api/v1/accounts/${recipient}`)
  ).json();
  console.log(`  recipient received ${fmt(received)} SAUCE`);
  console.log(
    `  account created: ${hashscan(`account/${after.account}`)} (${
      after.account
    })\n`
  );

  // 3. Cancel: the sender can take an unclaimed link back at any time.
  const second = ethers.Wallet.createRandom();
  console.log("3. Create a second link and cancel it");
  await send("createLink", (o) =>
    links.createLink(second.address, sauceAddress, AMOUNT, expiry, 0, o)
  );
  await send("refund (sender cancels)", (o) => links.refund(second.address, o));

  console.log(
    "\nDone. Every step above is a real Hedera testnet transaction.\n"
  );
};

main().catch((error) =>
  fail(error?.error?.message || error?.message || String(error))
);
