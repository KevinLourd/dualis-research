import { clerkMiddleware } from "@clerk/nextjs/server";

/**
 * Signed-out visitors are sent to /sign-in. The console layout ALSO calls auth.protect() before reading data,
 * so a route the middleware matcher misses is still protected.
 */
export default clerkMiddleware(
  async (auth, req) => {
    if (!req.nextUrl.pathname.startsWith("/sign-in")) await auth.protect();
  },
  { signInUrl: "/sign-in" },
);

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
