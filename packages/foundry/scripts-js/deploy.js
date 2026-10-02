import { spawnSync } from "child_process";
import { existsSync, mkdirSync, rmSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// Cross-platform replacement for the old Makefile deploy targets, so deploying needs Foundry and Node only.

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Public development key (Anvil / Hedera local node prefunded account #9). Never holds real funds.
const LOCAL_DEV_KEY =
  "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6";
const LOCAL_KEYSTORE = "scaffold-hbar-default";

const HEDERA_RPC = {
  hedera_testnet: "https://testnet.hashio.io/api",
  hedera_mainnet: "https://mainnet.hashio.io/api",
};

// A script that deploys several contracts is simulated in one call, which exceeds the default gas limit.
const HEDERA_SIMULATION_GAS_LIMIT = "14000000";

const run = (command, args) =>
  spawnSync(command, args, { stdio: "inherit", cwd: packageRoot }).status ?? 1;

const setupLocalDeployer = () => {
  rmSync(join(homedir(), ".foundry", "keystores", LOCAL_KEYSTORE), {
    force: true,
  });
  rmSync(join(packageRoot, "broadcast", "Deploy.s.sol", "31337"), {
    recursive: true,
    force: true,
  });
  return run("cast", [
    "wallet",
    "import",
    "--private-key",
    LOCAL_DEV_KEY,
    "--unsafe-password",
    "localhost",
    LOCAL_KEYSTORE,
  ]);
};

export const forgeScriptArgs = ({ script, network, keystore }) => {
  const args = ["script", script, "--broadcast", "--ffi"];

  if (network === "localhost") {
    // The default local keystore is created by setupLocalDeployer with a known password.
    const signer = ["--account", keystore];
    if (keystore === LOCAL_KEYSTORE) signer.push("--password", "localhost");
    return [...args, "--rpc-url", "localhost", ...signer];
  }

  const hederaRpc = HEDERA_RPC[network];
  args.push("--rpc-url", hederaRpc ?? network, "--account", keystore, "--slow");
  // Non-interactive deploys (CI) can supply the keystore password; otherwise Forge prompts for it.
  if (process.env.DEPLOY_KEYSTORE_PASSWORD)
    args.push("--password", process.env.DEPLOY_KEYSTORE_PASSWORD);
  if (hederaRpc)
    args.push("--legacy", "--gas-limit", HEDERA_SIMULATION_GAS_LIMIT);
  return args;
};

/** Deploys with a Forge script, then regenerates the frontend's deployedContracts.ts. Returns an exit code. */
export const deploy = ({ script, network, keystore }) => {
  if (!existsSync(join(packageRoot, script))) {
    console.error(`Error: deploy script '${script}' not found`);
    return 1;
  }
  mkdirSync(join(packageRoot, "deployments"), { recursive: true });

  if (network === "localhost" && setupLocalDeployer() !== 0) return 1;

  const status = run("forge", forgeScriptArgs({ script, network, keystore }));
  if (status !== 0) return status;
  return run("node", ["scripts-js/generateTsAbis.js"]);
};
