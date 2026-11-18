import { clerkMiddleware } from "@clerk/nextjs/server";

/**
 * Signed-out visitors are sent to /sign-in. The console layout ALSO calls auth.protect() before reading data,
 * so a route the middleware matcher misses is still protected. The Claude connector's endpoints are public: /mcp checks
 * its own OAuth bearer (web/src/connector/), discovery, registration and token answer anyone (Claude's servers);
 * /oauth/authorize stays behind the console sign-in.
 */
const PUBLIC = /^\/(sign-in|mcp$|\.well-known\/oauth-|oauth\/(register|token)$)/;

export default clerkMiddleware(
  async (auth, req) => {
    if (!PUBLIC.test(req.nextUrl.pathname)) await auth.protect();
  },
  { signInUrl: "/sign-in" },
);

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
