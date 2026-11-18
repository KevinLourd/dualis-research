import { auth } from "@clerk/nextjs/server";
import { approve, checkAuthorize, OAuthError } from "@/connector/oauth";

/** The Allow button of /oauth/authorize: the signed-in console user gives Claude a code, back on Claude's callback. */
export async function POST(req: Request): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return new Response("Sign in to the Dualis console first", { status: 401 });
  const form = new URLSearchParams(await req.text());
  try {
    const request = checkAuthorize(form);
    return new Response(null, { status: 303, headers: { location: approve(request, userId) } });
  } catch (e) {
    if (e instanceof OAuthError) return new Response(e.message, { status: 400 });
    throw e;
  }
}
