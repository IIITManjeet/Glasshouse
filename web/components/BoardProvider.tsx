"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useAuctions, type Board } from "@/lib/useAuctions";

/**
 * ONE BOARD, READ BY EVERYTHING.
 *
 * `useAuctions()` is not a subscription to shared state -- it is a hook that mounts its own
 * polling effect. Every component that calls it starts an independent timer hitting Base's
 * public RPC, which rate-limits (-32016) and has already cost this project a day once.
 *
 * That was survivable while exactly one component per page called it. The persistent status
 * bar breaks that: it lives in the layout and needs the head block and the source, while the
 * page below it needs the auctions. Two callers, two pollers, on every route. The earlier
 * `useDemoMode()` split was the same problem solved narrowly -- it exists so the nav toggle
 * could read the rehearsal flag WITHOUT subscribing to the board.
 *
 * So the poll is hoisted to one place. The provider calls the hook exactly once, and every
 * consumer -- status bar, landing card, board, evidence, profile -- reads the same result
 * out of context. It also means every surface is describing the SAME head block at the same
 * instant, which the provenance rule cares about: two panels on one screen citing two
 * different heads would each be honest and together be wrong.
 */
const BoardContext = createContext<Board | null>(null);

export function BoardProvider({ children }: { children: ReactNode }) {
  const board = useAuctions();
  return <BoardContext.Provider value={board}>{children}</BoardContext.Provider>;
}

/**
 * The board, from context.
 *
 * Throws rather than falling back to its own `useAuctions()` call. A silent fallback would
 * work perfectly in development and quietly restore the second poller the moment somebody
 * rendered a consumer outside the provider -- the exact bug this file exists to remove, in
 * the one form nobody would notice.
 */
export function useBoard(): Board {
  const board = useContext(BoardContext);
  if (!board) {
    throw new Error(
      "useBoard() outside <BoardProvider>. Wrap the tree in app/providers.tsx rather than " +
        "calling useAuctions() directly -- a direct call mounts a second RPC poller.",
    );
  }
  return board;
}
