// Screenshot-only stand-in for @clerk/nextjs/server. See clerk-nextjs.tsx.
import { NextResponse } from "next/server";

export const auth = Object.assign(async () => ({ userId: "screenshot" }), { protect: async () => ({ userId: "screenshot" }) });
export function clerkMiddleware() {
  return () => NextResponse.next();
}
