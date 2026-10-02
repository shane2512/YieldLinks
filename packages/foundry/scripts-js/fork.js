import { spawnSync } from "child_process";
import { config } from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// Anvil forked from Hedera with chain id 296, so HTS and SaucerSwap behave as on the network.

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(packageRoot, ".env") });

const forkUrl =
  process.env.FORK_URL ||
  process.env.HEDERA_RPC_URL ||
  "https://testnet.hashio.io/api";
console.log(`Starting Anvil fork against ${forkUrl} with chain-id 296...`);

const result = spawnSync(
  "anvil",
  ["--fork-url", forkUrl, "--chain-id", "296"],
  {
    stdio: "inherit",
    cwd: packageRoot,
  }
);
process.exit(result.status ?? 1);
