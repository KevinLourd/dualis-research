"use client";

import { Button, Dialog, LinkButton } from "@cloudflare/kumo";
import { DownloadSimpleIcon, XIcon } from "@phosphor-icons/react";

/**
 * A visual's thumbnail in the draft panel; a click opens it large in a modal, the only place with its Download (Kevin
 * 2026-11-09: « Seulement dans la modale d'agrandissement tu mets le bouton download, pas dans le right panel »).
 */
export function VisualZoom({ src, video, title, alt, downloadHref }: { src: string; video: boolean; title: string; alt: string; downloadHref: string }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger
        render={(p) => (
          <button {...p} type="button" aria-label={`Enlarge ${title}`} className="block w-full cursor-zoom-in rounded-md ring-1 ring-kumo-hairline">
            {video ? (
              <video src={src} muted loop playsInline preload="metadata" className="pointer-events-none aspect-video w-full rounded-md bg-black" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- a private file streamed by our own route, never optimised
              <img src={src} alt={alt} loading="lazy" className="aspect-video w-full rounded-md object-cover" />
            )}
          </button>
        )}
      />
      <Dialog className="flex w-[min(92vw,1280px)] max-w-none flex-col gap-4 p-6">
        <div className="flex items-center justify-between gap-4">
          <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
          <div className="flex items-center gap-2">
            <LinkButton href={downloadHref} variant="primary" icon={<DownloadSimpleIcon />}>
              Download
            </LinkButton>
            <Dialog.Close render={(props) => <Button {...props} variant="secondary" shape="square" icon={<XIcon />} aria-label="Close" />} />
          </div>
        </div>
        {video ? (
          <video src={src} controls autoPlay muted loop playsInline className="max-h-[80vh] w-full rounded-md bg-black" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- a private file streamed by our own route, never optimised
          <img src={src} alt={alt} className="max-h-[80vh] w-full rounded-md object-contain" />
        )}
      </Dialog>
    </Dialog.Root>
  );
}
