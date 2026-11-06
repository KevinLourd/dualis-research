import type { Metadata } from "next";
import { Legal } from "@/components/legal-page";
import { TERMS } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms of Use" };

export default function Terms() {
  return <Legal page={TERMS} />;
}
