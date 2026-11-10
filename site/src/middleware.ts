import { NextResponse, type NextRequest } from "next/server";
import { isAuthorized, NOINDEX } from "./lib/site-gate";

export function middleware(request: NextRequest) {
  if (!isAuthorized(request.headers.get("authorization"), process.env.SITE_PASSWORD ?? "")) {
    return new NextResponse("Private preview", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Dualis Research preview", charset="UTF-8"', "X-Robots-Tag": NOINDEX },
    });
  }
  const res = NextResponse.next();
  res.headers.set("X-Robots-Tag", NOINDEX);
  return res;
}

export const config = { matcher: "/:path*" };
