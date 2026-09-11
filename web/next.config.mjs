/** @type {import('next').NextConfig} */
// Static export, deliberately. The whole point of the earlier static page was that it
// cannot fail at 3am on submission day, and a Next app that needs a running server gives
// that property up. `output: 'export'` keeps it: the build produces plain files that any
// host serves, and there is no runtime to fall over.
//
// It also forces an honest architecture. With no server there is nowhere to hide a secret,
// so every read is a client-side call the visitor could make themselves -- which is the
// same claim the rest of the project makes about verifiability.
const nextConfig = {
  output: "export",
  // Without this the export writes rounds.html and account.html, and a plain static
  // host (S3, nginx, GitHub Pages) 404s on /rounds. trailingSlash makes it
  // rounds/index.html, which every static host resolves. A review caught this; it would
  // have surfaced only after deploying.
  trailingSlash: true,
  images: { unoptimized: true },
  // Pinned because the repo root also has a lockfile and Next would otherwise infer the
  // wrong workspace root, quietly resolving modules from the contracts project.
  turbopack: { root: import.meta.dirname },
  // DEV PARITY ONLY, and it has to be said plainly: `output: "export"` cannot honour
  // rewrites, so this does nothing to the built site. Production gets /profile/:address
  // from the edge rewrite in vercel.json, and that is the only thing serving it there.
  //
  // It exists because without it the two environments disagree about a URL the app itself
  // generates: the address form in app/account/page.tsx navigates to /profile/<addr>, which
  // 404s under `next dev` and works in production. A form that is broken only on localhost
  // is how a real bug gets dismissed as "just the dev server".
  //
  // Keep this in step with vercel.json by hand. Two declarations of one route is a cost;
  // the alternative is a dev server that lies about the routing.
  async rewrites() {
    return [
      { source: "/profile/:address", destination: "/account/?a=:address" },
      { source: "/profile/:address/", destination: "/account/?a=:address" },
    ];
  },
};
export default nextConfig;
