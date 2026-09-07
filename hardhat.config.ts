import { defineConfig, configVariable } from "hardhat/config";
import hardhatIgnition from "@nomicfoundation/hardhat-ignition";
import hardhatKeystore from "@nomicfoundation/hardhat-keystore";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import hardhatNodeTestRunner from "@nomicfoundation/hardhat-node-test-runner";
import hardhatIgnoreWarnings from "hardhat-ignore-warnings";

// Matches 1inch/swap-vm exactly (solc 0.8.30, optimizer runs 700, viaIR).
// Diverging here would make our bytecode-size measurements incomparable to F-108.
const swapVmCompiler = {
  version: "0.8.30",
  settings: {
    optimizer: {
      enabled: true,
      runs: 700,
    },
    viaIR: true,
  },
  isolated: true,
};

export default defineConfig({
  plugins: [
    hardhatIgnoreWarnings,
    hardhatIgnition,
    hardhatKeystore,
    hardhatVerify,
    hardhatNodeTestRunner,
  ],
  solidity: {
    splitTestsCompilation: true,
    profiles: {
      default: { compilers: [swapVmCompiler] },
      production: { compilers: [swapVmCompiler] },
    },
  },
  paths: {
    sources: "./src",
  },
  networks: {
    localhost: {
      type: "http",
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    // F-126: swap-vm's own config ships ONLY localhost. Base is where the real
    // Aqua lives (F-74), so we add it here on day 1 rather than discovering it
    // on deploy day.
    base: {
      type: "http",
      // Public endpoint by default. An RPC URL is not a secret, and requiring it as a
      // config variable meant a deploy could fail on shell quoting before sending
      // anything. Override with BASE_RPC_URL for a private endpoint.
      url: process.env.BASE_RPC_URL ?? "https://mainnet.base.org",
      chainId: 8453,
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
    // The dry run: a local Anvil fork of Base mainnet. Same chainId, so every address
    // in the scripts resolves to the real deployed contract and the order hash is
    // unchanged -- but the money is not real. No `accounts`, because the maker is
    // impersonated on the fork rather than signed for; the keystore is never touched.
    //
    //   anvil --fork-url https://mainnet.base.org --chain-id 8453
    //   BASE_RPC_URL=http://127.0.0.1:8545 npx hardhat run scripts/run-live-fill.ts --network baseFork
    baseFork: {
      type: "http",
      url: process.env.FORK_RPC_URL ?? "http://127.0.0.1:8545",
      chainId: 8453,
    },
    baseSepolia: {
      type: "http",
      url: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
      chainId: 84532,
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
  },
  verify: {
    etherscan: {
      apiKey: configVariable("ETHERSCAN_API_KEY"),
    },
  },
  warnings: {
    // The comparison test deploys the full-opcode router (29,159 B). The test EVM
    // does not enforce EIP-170 (F-125), so this warning is expected and is not a
    // signal about our *deployable* router.
    "test/**/*": {
      "initcode-size": "off",
      "code-size": "off",
    },
    "npm/@1inch/solidity-utils@*/**/*": {
      "transient-storage": "off",
    },
  },
});
