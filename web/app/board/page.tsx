"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * /board MOVED TO /.
 *
 * Everything that was in this file -- the countdown, the phase track, the bid cards, the
 * stats, the replay check and the bidding panel -- is now the front page, because the
 * product IS the instrument and a front page that links to the product is a brochure. The
 * argument that used to occupy / is at /faq.
 *
 * THIS FILE STAYS, AND IS NOT A COURTESY. /board is the URL in every link shared while the
 * instrument lived here -- in the README, in the demo script, in a judge's notes. A dead URL
 * on the day is a dead demo, so this forwards.
 *
 * It forwards CLIENT-SIDE on purpose. `output: "export"` in next.config.mjs means there is
 * no server here to answer with a 308, so a real redirect has to come from the host
 * (vercel.json) and this page is what makes the path work when it is served as a static
 * file -- opened from disk, from a preview build, or under `next dev`. The link below is
 * for the case where JavaScript never runs; a forward that only works with JS enabled and
 * says nothing when it does not is the worse of the two failures.
 */
export default function BoardMoved() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/");
  }, [router]);

  return (
    <main>
      <h1 className="text-[1.5rem] leading-[1.25] font-semibold text-ink">The board moved to the front page.</h1>
      <p className="lede mt-3 max-w-xl text-ink-soft">
        The live round, its phases and the panel to bid in it are now at the site root.
      </p>
      <Link href="/" className="btn btn-secondary mt-4">
        Open the instrument
      </Link>
    </main>
  );
}
