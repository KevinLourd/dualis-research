import { subscribeHref } from "@/lib/model";

/** Every Subscribe button: Thierry's Substack subscribe page, or a disabled button until he sets it in the console. */
export function SubscribeButton({
  substackUrl,
  label = "Subscribe",
  variant = "primary",
}: {
  substackUrl: string | null;
  label?: string;
  variant?: "primary" | "outline" | "light";
}) {
  const href = subscribeHref(substackUrl);
  const cls = `btn btn-${variant}`;
  if (!href) {
    return (
      <span className={cls} aria-disabled="true" title="Opens once Thierry's Substack is set (console: Content > Channels)">
        {label}
      </span>
    );
  }
  return (
    <a target="_blank" rel="noopener noreferrer" className={cls} href={href}>
      {label}
    </a>
  );
}
