"use client";

import { WagmiProvider, createConfig, http } from "wagmi";
import { base, mainnet } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardProvider } from "@/components/BoardProvider";
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
 *
 * ETHEREUM MAINNET IS HERE ONLY FOR ENS, and never for a transaction. The registry and the
 * resolvers live on L1, so an address on Base has no name that Base itself can answer for,
 * and without a mainnet transport every profile shows a truncated hex string and nothing
 * else.
 *
 * It has to be in `chains` as well as in `transports` -- wagmi types the transport map
 * against the declared chains, so a transport for a chain that is not declared does not
 * compile. That is wagmi telling the truth about what it will do, so the honest response is
 * to declare it rather than to cast the type away.
 *
 * WHAT THAT DOES NOT MEAN: nothing here writes to mainnet, reads a balance from it, or asks
 * a wallet to switch to it. `placeBid`/`revealBid` call `ensureBaseChain()` before signing
 * (web/lib/bid.js), so every transaction this app produces is a Base transaction whatever
 * the wallet happens to be pointed at. Mainnet is a read-only resolver lookup.
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
      // base is FIRST and is the app's chain. mainnet is declared only so the ENS
      // transport below type-checks; see the note above.
      chains: [base, mainnet],
      connectors: [injected()],
      transports: {
        [base.id]: http(rpcUrl()),
        // Read-only, and deliberately not in `chains`: a resolver lookup, never a tx.
        [mainnet.id]: http("https://ethereum-rpc.publicnode.com"),
      },
      ssr: true,
    }),
  );
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {/* Inside the query client, because the board's ENS lookups and wagmi hooks need
            it. One board for the whole tree: see components/BoardProvider.tsx. */}
        <BoardProvider>{children}</BoardProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
