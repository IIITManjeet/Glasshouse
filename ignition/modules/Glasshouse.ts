import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Deploys the two Glasshouse contracts.
 *
 *   GlasshouseBook   - the auction book. No constructor arguments, and deliberately
 *                      no owner, no admin and no upgrade path: once deployed, nothing
 *                      can change what `outcome()` returns.
 *
 *   GlasshouseRouter - AquaSwapVMRouter plus opcode 0x2e and a re-added
 *                      WhitelistSequential. Same constructor as every upstream router:
 *                      (aqua, weth, owner, name, version).
 *
 * The two are independent: the Book is referenced by ADDRESS inside a maker's program,
 * not by the router, so there is no deployment ordering constraint between them. They
 * are in one module so a single run produces both and Ignition records both addresses.
 *
 * Every parameter is required. A missing one fails Ignition's validation before any
 * transaction is sent, which is the behaviour we want when the target is mainnet.
 *
 * `owner` on the router only governs `rescueFunds`. The router holds no user balances
 * in normal operation - Aqua keeps maker tokens in the maker's own wallet - so this is
 * a recovery path for stuck tokens, not custody.
 */
export default buildModule("Glasshouse", (m) => {
  const aqua = m.getParameter("aqua");
  const weth = m.getParameter("weth");
  const owner = m.getParameter("owner");
  const name = m.getParameter("name");
  const version = m.getParameter("version");

  const book = m.contract("GlasshouseBook", []);
  const router = m.contract("GlasshouseRouter", [aqua, weth, owner, name, version]);

  return { book, router };
});
