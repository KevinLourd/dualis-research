// Screenshot-only stand-in for @clerk/nextjs (aliased by next.config.ts when SCREENSHOT_AUTH_STUB=1 in `next dev`).
// Never part of a production build. Lets the signed-in console render without a Clerk secret.
export function ClerkProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
export function UserButton() {
  return (
    <span className="grid size-7 place-items-center rounded-full bg-kumo-brand text-xs font-semibold text-white" aria-label="Account">
      TM
    </span>
  );
}
export function SignIn() {
  return <div className="rounded-lg bg-kumo-base p-8 ring-1 ring-kumo-hairline">Clerk sign-in renders here.</div>;
}
