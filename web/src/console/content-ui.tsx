"use client";

import { Button } from "@cloudflare/kumo";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useFormStatus } from "react-dom";

/** Copies a draft's full text (Substack has no posting API: paste it in the editor). */
export function CopyButton({ text, label = "Copy text" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      icon={copied ? CheckIcon : CopyIcon}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}

/** A form's submit button that says it is working while the server action runs. */
export function PendingButton({ label, pendingLabel, variant = "secondary" }: { label: string; pendingLabel: string; variant?: "primary" | "secondary" | "ghost" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size="sm" loading={pending} disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}
