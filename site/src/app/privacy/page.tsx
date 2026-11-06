import type { Metadata } from "next";
import { Legal } from "@/components/legal-page";
import { PRIVACY } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function Privacy() {
  return <Legal page={PRIVACY} />;
}
