"use client";

import { Button } from "@cloudflare/kumo";
import { Dialog } from "@cloudflare/kumo/primitives/dialog";
import { XIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";

/**
 * Right slide-over panel, driven by the URL (`?preview=…`, `?run=…`): every panel is linkable and server-rendered.
 * `closeHref` = the same URL without the panel parameter. Built on Base UI Dialog (focus trap, Esc, scroll lock).
 */
export function SlideOver({
  title,
  subtitle,
  closeHref,
  size = "md",
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  closeHref: string;
  /** `lg` for an analysis or an item with charts. */
  size?: "md" | "lg";
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <Dialog.Root open onOpenChange={(open) => !open && router.push(closeHref, { scroll: false })}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/20 transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup className={`fixed inset-y-0 right-0 z-50 flex ${size === "lg" ? "w-[min(680px,100vw)]" : "w-[min(480px,100vw)]"} flex-col bg-kumo-base shadow-2xl ring-1 ring-kumo-line outline-none transition-[transform,opacity] duration-200 ease-out data-[ending-style]:translate-x-6 data-[ending-style]:opacity-0 data-[starting-style]:translate-x-6 data-[starting-style]:opacity-0`}>
          <header className="flex items-start justify-between gap-3 border-b border-kumo-hairline px-6 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-semibold text-kumo-strong">{title}</Dialog.Title>
              {subtitle && <div className="mt-0.5 text-sm text-kumo-subtle">{subtitle}</div>}
            </div>
            <Dialog.Close
              render={(props) => <Button {...props} variant="ghost" shape="square" size="sm" icon={XIcon} aria-label="Close" />}
            />
          </header>
          <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-5 [&>*]:shrink-0">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
