import { SignIn } from "@clerk/nextjs";
import { Logo } from "@/console/logo";

export default function SignInPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-kumo-canvas">
      <Logo />
      <SignIn />
    </main>
  );
}
