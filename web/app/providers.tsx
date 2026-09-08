"use client";

import { WagmiProvider, createConfig, http } from "wagmi";
import { base } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

/**
 * Wallet wiring.
 *
 * `injected()` only, no WalletConnect. A project id would be a runtime dependency on a
 * third-party relay, and this app is a static export with no server and no secrets -- a
 * connector that phones home would break the property the whole build is arranged around.
 * Anyone demoing this has MetaMask or Rabby.
 *
 * The RPC honours a query parameter so the entire product can be demonstrated against a
 * local Anvil fork of Base. The 1inch track states plainly that on-chain execution "should
 * be presented during the final demo (local forks are ok)", and a fork runs the real Aqua
 * at the real address for nothing -- unlike a testnet, where Aqua is not deployed at all.
 */
function rpcUrl() {
  if (typeof window === "undefined") return "https://mainnet.base.org";
  const override = new URLSearchParams(window.location.search).get("rpc");
  return override ?? "https://mainnet.base.org";
}

export function Providers({ children }: { children: ReactNode }) {
  // Built once per mount rather than at module scope: at module scope it would be
  // evaluated during the static export, where `window` does not exist and the override
  // would silently never apply.
  const [config] = useState(() =>
    createConfig({
      chains: [base],
      connectors: [injected()],
      transports: { [base.id]: http(rpcUrl()) },
      ssr: true,
    }),
  );
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
