import { auth, currentUser } from "@clerk/nextjs/server";
import { Button } from "@cloudflare/kumo";
import { checkAuthorize, OAuthError } from "@/connector/oauth";
import { Logo } from "@/console/logo";

/**
 * Where Claude sends Thierry when he adds the connector. The middleware already made him sign in to the console
 * (Clerk, allowlisted emails); one click on Allow sends Claude its code (/oauth/approve).
 */
export const dynamic = "force-dynamic";

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  await auth.protect();
  const user = await currentUser();
  let request;
  try {
    request = checkAuthorize(params);
  } catch (e) {
    if (!(e instanceof OAuthError)) throw e;
    return (
      <Frame>
        <p className="text-kumo-danger">{e.message}</p>
      </Frame>
    );
  }
  const host = new URL(request.redirectUri).host;
  const email = user?.primaryEmailAddress?.emailAddress;
  return (
    <Frame>
      <h1 className="text-xl font-semibold text-kumo-strong">Connect Claude to Dualis Research</h1>
      <p className="text-kumo-default">
        {request.clientName} ({host}) will read the design system and the website&apos;s words, and publish the changes you approve in the chat.
      </p>
      {email ? <p className="text-sm text-kumo-subtle">Signed in as {email}</p> : null}
      <form method="post" action="/oauth/approve" className="flex justify-end">
        {Object.entries(params).map(([k, v]) => (v === undefined ? null : <input key={k} type="hidden" name={k} value={v} />))}
        <Button variant="primary" type="submit">
          Allow
        </Button>
      </form>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-kumo-canvas p-6">
      <Logo />
      <div className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-kumo-hairline bg-kumo-base p-6">{children}</div>
    </main>
  );
}
