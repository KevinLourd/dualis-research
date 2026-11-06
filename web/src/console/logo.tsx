/**
 * The Dualis logo, same as the public site's header (Kevin 2026-11-06: align the console on the site): Solomon's knot
 * (`site/public/brand/mark.svg`, masters in design/assets/Logos/) + the wide-tracked caps wordmark. Drawn inline in
 * `currentColor` so it follows the console theme (indigo on light, lavender on dark).
 */
export function Logo() {
  return (
    <span className="flex items-center gap-2.5 px-1 text-kumo-brand">
      <KnotMark className="size-7 shrink-0" />
      <span className="flex flex-col uppercase leading-none">
        <span className="text-[16px] font-medium tracking-[0.34em]">Dualis</span>
        <span className="mt-1.5 text-[8px] font-medium tracking-[0.62em]">Research</span>
      </span>
    </span>
  );
}

function KnotMark({ className }: { className?: string }) {
  const loopH = { x: 26, y: 82, width: 204, height: 92, rx: 46 };
  const loopV = { x: 82, y: 26, width: 92, height: 204, rx: 46 };
  return (
    <svg viewBox="0 0 256 256" fill="none" aria-hidden className={className}>
      <defs>
        <clipPath id="dlk-h0">
          <circle cx="174" cy="82" r="39" />
        </clipPath>
        <clipPath id="dlk-h1">
          <circle cx="82" cy="174" r="39" />
        </clipPath>
        <mask id="dlk-h" maskUnits="userSpaceOnUse" x="0" y="0" width="256" height="256">
          <rect width="256" height="256" fill="#fff" />
          <rect {...loopV} stroke="#000" strokeWidth="52" clipPath="url(#dlk-h0)" />
          <rect {...loopV} stroke="#000" strokeWidth="52" clipPath="url(#dlk-h1)" />
        </mask>
        <clipPath id="dlk-v0">
          <circle cx="82" cy="82" r="39" />
        </clipPath>
        <clipPath id="dlk-v1">
          <circle cx="174" cy="174" r="39" />
        </clipPath>
        <mask id="dlk-v" maskUnits="userSpaceOnUse" x="0" y="0" width="256" height="256">
          <rect width="256" height="256" fill="#fff" />
          <rect {...loopH} stroke="#000" strokeWidth="52" clipPath="url(#dlk-v0)" />
          <rect {...loopH} stroke="#000" strokeWidth="52" clipPath="url(#dlk-v1)" />
        </mask>
      </defs>
      <g transform="rotate(45 128 128)">
        <rect {...loopH} stroke="currentColor" strokeWidth="34" mask="url(#dlk-h)" />
        <rect {...loopV} stroke="currentColor" strokeWidth="34" mask="url(#dlk-v)" />
        <rect x="116" y="116" width="24" height="24" fill="currentColor" />
      </g>
    </svg>
  );
}
