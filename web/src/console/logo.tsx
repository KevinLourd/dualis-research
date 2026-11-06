/** Split-disc mark (design/ logo direction 1) + wordmark. */
export function Logo() {
  return (
    <span className="flex items-center gap-2 px-1 text-kumo-strong">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden className="shrink-0 text-kumo-brand">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M5.6 18.4 18.4 5.6A9 9 0 0 1 5.6 18.4Z" fill="currentColor" />
      </svg>
      <span className="text-base font-semibold tracking-tight">Dualis Research</span>
    </span>
  );
}
