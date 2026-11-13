"use client";

import { DownloadSimpleIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { logoSvg } from "./sandbox-logos";

/** 400 x 400: the size X asks for a profile picture (Substack takes it too). */
const PNG_SIZE = 400;

async function downloadPng(handle: string, background: string): Promise<void> {
  const svg = logoSvg(handle, { size: PNG_SIZE, background });
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = PNG_SIZE;
  canvas.height = PNG_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d canvas");
  ctx.drawImage(img, 0, 0, PNG_SIZE, PNG_SIZE);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG export failed"))), "image/png"));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${handle}-logo.png`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Wraps a big avatar: on hover a Download button saves the logo as a 400 x 400 PNG on the account's colour. */
export function LogoDownload({ handle, background, round, children }: { handle: string; background: string; round: boolean; children: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <button
        type="button"
        onClick={() => void downloadPng(handle, background)}
        aria-label={`Download the @${handle} logo (PNG, 400 x 400)`}
        className={`absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-1 bg-black/55 text-[13px] font-bold text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 ${round ? "rounded-full" : "rounded-[22%]"}`}
      >
        <DownloadSimpleIcon size={22} weight="bold" />
        Download
      </button>
    </span>
  );
}
