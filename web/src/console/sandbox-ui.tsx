import { Badge } from "@cloudflare/kumo";
import {
  ArrowLeftIcon,
  BookmarkSimpleIcon,
  CalendarBlankIcon,
  ChartBarIcon,
  ChatCircleIcon,
  ExportIcon,
  HeartIcon,
  LinkSimpleIcon,
  ArrowsClockwiseIcon,
} from "@phosphor-icons/react/ssr";
import Link from "@/console/link";
import type { GoldSandboxAccount, GoldSandboxPost, SandboxTone } from "@/db/schema/sandbox";

/**
 * Sandbox pages (Kevin 2026-11-11): fake X profiles and Substack publications drawn as close to the real sites as we can,
 * so Thierry judges a tone the way his readers would meet it. Third-party look: the hex values below are X's and
 * Substack's own, never Dualis tokens. No X or Substack logo asset.
 */

export const TONE_LABEL: Record<SandboxTone, { name: string; line: string }> = {
  urgent: { name: "Urgent", line: "Breaking-news alarm, one shock number." },
  balanced: { name: "Balanced", line: "Our current drafts' tone." },
  neutral: { name: "Neutral", line: "Sober research note, no emoji." },
};

export function SandboxLabel() {
  return (
    <Badge variant="outline" className="self-start">
      Sandbox, not published
    </Badge>
  );
}

export function Avatar({ account, size }: { account: Pick<GoldSandboxAccount, "avatarText" | "avatarColor" | "displayName" | "platform">; size: number }) {
  return (
    <span
      role="img"
      aria-label={account.displayName}
      className={`inline-flex shrink-0 items-center justify-center font-bold text-white select-none ${account.platform === "x" ? "rounded-full" : "rounded-[22%]"}`}
      style={{ width: size, height: size, background: account.avatarColor, fontSize: Math.round(size * 0.38) }}
    >
      {account.avatarText}
    </span>
  );
}

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
const compact = (n: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** X's own time stamp: « 3h » under a day, else « Nov 11 ». */
function xTime(at: Date, now: Date) {
  const mins = Math.round((now.getTime() - at.getTime()) / 60_000);
  if (mins >= 0 && mins < 60) return `${Math.max(1, mins)}m`;
  if (mins >= 60 && mins < 24 * 60) return `${Math.floor(mins / 60)}h`;
  return at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "Asia/Almaty" });
}

/** $CASHTAGS and bare domains in X blue, the rest as written. */
function XText({ text, linkColor }: { text: string; linkColor: string }) {
  const parts = text.split(/(\$[A-Z][A-Z0-9.]{0,9}\b|\b[a-z0-9-]+\.substack\.com\b)/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <span key={i} style={{ color: linkColor }}>
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  );
}

/* ------------------------------------------------------------------ X ------------------------------------------------------------------ */

const X = { ink: "#0f1419", muted: "#536471", rule: "#eff3f4", blue: "#1d9bf0", font: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' } as const;

function XAction({ icon, count }: { icon: React.ReactNode; count?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[13px]" style={{ color: X.muted }}>
      {icon}
      {count && <span>{count}</span>}
    </span>
  );
}

export function XProfile({ account, posts, pairedHref }: { account: GoldSandboxAccount; posts: GoldSandboxPost[]; pairedHref: string }) {
  const now = new Date();
  return (
    <div className="mx-auto w-full max-w-[600px] border-x bg-white" style={{ borderColor: X.rule, color: X.ink, fontFamily: X.font }}>
      <div className="flex items-center gap-8 px-4 py-1.5">
        <Link href="/sandbox" aria-label="Back" className="rounded-full p-2 hover:bg-black/5">
          <ArrowLeftIcon size={20} />
        </Link>
        <div className="flex flex-col">
          <span className="text-[20px] leading-6 font-extrabold">{account.displayName}</span>
          <span className="text-[13px]" style={{ color: X.muted }}>
            {fmt(posts.length)} posts
          </span>
        </div>
      </div>
      <div className="aspect-[3/1] w-full" style={{ background: `linear-gradient(135deg, ${account.bannerColor} 0%, ${account.avatarColor} 160%)` }} />
      <div className="px-4">
        <div className="flex items-start justify-between">
          <span className="-mt-[12%] inline-flex rounded-full border-4 border-white">
            <Avatar account={account} size={133} />
          </span>
          <span className="mt-3 rounded-full px-4 py-1.5 text-[15px] font-bold text-white" style={{ background: X.ink }}>
            Follow
          </span>
        </div>
        <div className="mt-3 flex flex-col">
          <span className="text-[20px] leading-6 font-extrabold">{account.displayName}</span>
          <span className="text-[15px]" style={{ color: X.muted }}>
            @{account.handle}
          </span>
        </div>
        <p className="mt-3 text-[15px] leading-5 whitespace-pre-wrap">
          <XText text={account.bio} linkColor={X.blue} />
        </p>
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[15px]" style={{ color: X.muted }}>
          <Link href={pairedHref} className="inline-flex items-center gap-1 hover:underline" style={{ color: X.blue }}>
            <LinkSimpleIcon size={18} style={{ color: X.muted }} />
            {account.url}
          </Link>
          <span className="inline-flex items-center gap-1">
            <CalendarBlankIcon size={18} />
            Joined {account.joined}
          </span>
        </div>
        <div className="mt-3 flex gap-5 text-[14px]" style={{ color: X.muted }}>
          <span>
            <b style={{ color: X.ink }}>{fmt(account.following)}</b> Following
          </span>
          <span>
            <b style={{ color: X.ink }}>{fmt(account.followers)}</b> Followers
          </span>
        </div>
      </div>
      <nav className="mt-4 flex border-b text-[15px]" style={{ borderColor: X.rule, color: X.muted }}>
        {["Posts", "Replies", "Highlights", "Articles", "Media", "Likes"].map((t, i) => (
          <span key={t} className="flex flex-1 justify-center">
            <span className={`relative py-4 ${i === 0 ? "font-bold" : "font-medium"}`} style={i === 0 ? { color: X.ink } : undefined}>
              {t}
              {i === 0 && <span className="absolute inset-x-0 bottom-0 h-1 rounded-full" style={{ background: X.blue }} />}
            </span>
          </span>
        ))}
      </nav>
      {posts.length === 0 && (
        <div className="px-8 py-12 text-center">
          <p className="text-[31px] leading-9 font-extrabold">@{account.handle} hasn&apos;t posted</p>
          <p className="mt-2 text-[15px]" style={{ color: X.muted }}>
            Posts land with the next daily collect.
          </p>
        </div>
      )}
      {posts.map((p) => (
        <article key={p.id} className="flex gap-2 border-b px-4 py-3" style={{ borderColor: X.rule }}>
          <Avatar account={account} size={40} />
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-w-0 items-baseline gap-1 text-[15px]">
              <span className="truncate font-bold">{account.displayName}</span>
              <span className="truncate" style={{ color: X.muted }}>
                @{account.handle} · {xTime(p.postAt, now)}
              </span>
            </div>
            <p className="text-[15px] leading-5 break-words whitespace-pre-wrap">
              <XText text={p.text} linkColor={X.blue} />
            </p>
            {p.visualId && (
              // eslint-disable-next-line @next/next/no-img-element -- a private file streamed by /api/visuals, signed-in
              <img src={`/api/visuals/${p.visualId}`} alt="" loading="lazy" className="mt-3 w-full rounded-2xl border" style={{ borderColor: X.rule }} />
            )}
            <div className="mt-3 flex max-w-[425px] justify-between">
              <XAction icon={<ChatCircleIcon size={18} />} />
              <XAction icon={<ArrowsClockwiseIcon size={18} />} />
              <XAction icon={<HeartIcon size={18} />} />
              <XAction icon={<ChartBarIcon size={18} />} />
              <span className="flex gap-3">
                <XAction icon={<BookmarkSimpleIcon size={18} />} />
                <XAction icon={<ExportIcon size={18} />} />
              </span>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- Substack --------------------------------------------------------------- */

const S = { ink: "#363737", muted: "#777", rule: "#e6e6e6", accent: "#FF6719", font: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', serif: 'Spectral, Georgia, "Times New Roman", serif' } as const;

function noteTime(at: Date) {
  return at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "Asia/Almaty" });
}

export function SubstackHome({ account, posts, pairedHref }: { account: GoldSandboxAccount; posts: GoldSandboxPost[]; pairedHref: string }) {
  return (
    <div className="w-full bg-white" style={{ color: S.ink, fontFamily: S.font }}>
      <header className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: S.rule }}>
        <span className="flex items-center gap-3">
          <Avatar account={account} size={36} />
          <span className="text-[17px] font-bold">{account.displayName}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="rounded-md px-4 py-2 text-[14px] font-semibold text-white" style={{ background: S.accent }}>
            Subscribe
          </span>
          <span className="rounded-md border px-4 py-2 text-[14px] font-semibold" style={{ borderColor: S.rule }}>
            Sign in
          </span>
        </span>
      </header>
      <section className="mx-auto flex max-w-[560px] flex-col items-center px-5 py-12 text-center">
        <Avatar account={account} size={80} />
        <h1 className="mt-5 text-[32px] leading-tight font-bold" style={{ fontFamily: S.serif }}>
          {account.displayName}
        </h1>
        <p className="mt-3 text-[17px] leading-relaxed" style={{ color: S.muted }}>
          {account.bio}
        </p>
        <p className="mt-2 text-[14px]" style={{ color: S.muted }}>
          By {account.author} · {compact(account.followers)} subscribers ·{" "}
          <Link href={pairedHref} className="underline">
            @{account.handle} on X
          </Link>
        </p>
        <div className="mt-6 flex w-full max-w-[420px] overflow-hidden rounded-md border" style={{ borderColor: S.accent }}>
          <span className="flex-1 px-3 py-2.5 text-left text-[15px]" style={{ color: S.muted }}>
            Type your email...
          </span>
          <span className="px-5 py-2.5 text-[15px] font-semibold text-white" style={{ background: S.accent }}>
            Subscribe
          </span>
        </div>
      </section>
      <nav className="mx-auto flex max-w-[728px] gap-6 border-b px-5 text-[15px]" style={{ borderColor: S.rule, color: S.muted }}>
        {["Home", "Notes", "Archive", "About"].map((t) => (
          <span key={t} className={`py-3 ${t === "Notes" ? "border-b-2 font-semibold" : ""}`} style={t === "Notes" ? { borderColor: S.ink, color: S.ink } : undefined}>
            {t}
          </span>
        ))}
      </nav>
      <div className="mx-auto flex max-w-[728px] flex-col px-5 pb-12">
        {posts.length === 0 && (
          <p className="py-12 text-center text-[15px]" style={{ color: S.muted }}>
            No notes yet. Notes land with the next daily collect.
          </p>
        )}
        {posts.map((p) => (
          <article key={p.id} className="flex gap-3 border-b py-5" style={{ borderColor: S.rule }}>
            <Avatar account={account} size={40} />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex items-baseline gap-1.5 text-[15px]">
                <span className="font-semibold">{account.author}</span>
                <span style={{ color: S.muted }}>· {noteTime(p.postAt)}</span>
              </div>
              <p className="text-[16px] leading-[1.55] break-words whitespace-pre-wrap">{p.text}</p>
              {p.visualId && (
                // eslint-disable-next-line @next/next/no-img-element -- a private file streamed by /api/visuals, signed-in
                <img src={`/api/visuals/${p.visualId}`} alt="" loading="lazy" className="mt-1 w-full rounded-lg border" style={{ borderColor: S.rule }} />
              )}
              <div className="mt-1 flex gap-6" style={{ color: S.muted }}>
                <HeartIcon size={18} />
                <ChatCircleIcon size={18} />
                <ArrowsClockwiseIcon size={18} />
                <ExportIcon size={18} />
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
