import { Badge } from "@cloudflare/kumo";
import {
  ArrowLeftIcon,
  ArrowsClockwiseIcon,
  BookmarkSimpleIcon,
  CalendarBlankIcon,
  ChartBarIcon,
  ChatCircleIcon,
  ExportIcon,
  HeartIcon,
  LinkSimpleIcon,
} from "@phosphor-icons/react/ssr";
import Link from "@/console/link";
import { LogoDownload } from "@/console/logo-download";
import { hasLogo, logoSvg } from "@/console/sandbox-logos";
import type { GoldSandboxAccount, GoldSandboxPost, SandboxAngle, SandboxFormat } from "@/db/schema/sandbox";

/**
 * Sandbox pages (Kevin 2026-11-11): fake X profiles and Substack publications drawn as close to the real sites as we can,
 * so Thierry judges a tone the way his readers would meet it. Third-party look: the hex values below are X's and
 * Substack's own, never Dualis tokens. No X or Substack logo asset. Each post carries its format and angle as tags
 * (skill content-matrix); an Article shows as a card that opens in the page (`?article=<id>`).
 */

export const FORMAT_LABEL: Record<SandboxFormat, string> = { "x-post": "X post", "x-article": "X Article", "substack-note": "Note", "substack-article": "Article" };
export const ANGLE_LABEL: Record<SandboxAngle, string> = { signal: "Signal", "macro-24h": "Macro 24h", "trending-format": "Trending format", competitor: "Competitor" };
const ANGLES = Object.keys(ANGLE_LABEL) as SandboxAngle[];
const isArticle = (f: SandboxFormat) => f === "x-article" || f === "substack-article";

function SandboxLabel({ live }: { live: boolean }) {
  return <Badge variant="outline">{live ? "Live on X: each post goes out at its time" : "Sandbox, not published"}</Badge>;
}

export function Avatar({ account, size }: { account: Pick<GoldSandboxAccount, "avatarText" | "avatarColor" | "displayName" | "platform" | "handle">; size: number }) {
  return (
    <span
      role="img"
      aria-label={account.displayName}
      className={`inline-flex shrink-0 items-center justify-center font-bold text-white select-none ${account.platform === "x" ? "rounded-full" : "rounded-[22%]"}`}
      style={{ width: size, height: size, background: account.avatarColor, fontSize: Math.round(size * 0.38) }}
    >
      {hasLogo(account.handle) ? <span className="inline-flex" dangerouslySetInnerHTML={{ __html: logoSvg(account.handle, { size }) }} /> : account.avatarText}
    </span>
  );
}

/** The profile's big avatar: its logo downloads as a PNG on hover. */
function BigAvatar({ account, size }: { account: GoldSandboxAccount; size: number }) {
  const avatar = <Avatar account={account} size={size} />;
  if (!hasLogo(account.handle)) return avatar;
  return (
    <LogoDownload handle={account.handle} background={account.avatarColor} round={account.platform === "x"}>
      {avatar}
    </LogoDownload>
  );
}

/** The page's filters and open Article, from the URL. */
export type SandboxView = { format: SandboxFormat | null; angle: SandboxAngle | null; article: string | null };

function hrefWith(base: string, view: SandboxView, change: Partial<SandboxView>) {
  const next = { ...view, ...change };
  const q = new URLSearchParams();
  if (next.format) q.set("format", next.format);
  if (next.angle) q.set("angle", next.angle);
  if (next.article) q.set("article", next.article);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

/** One row: the « not published » badge, then format and angle chips above the timeline (Dualis console look: they are ours, not the site's). */
export function SandboxFilters({ base, view, formats, live = false }: { base: string; view: SandboxView; formats: SandboxFormat[]; live?: boolean }) {
  const chip = (active: boolean, href: string, label: string) => (
    <Link key={href + label} href={href} className={`rounded-full border px-3 py-1 text-sm ${active ? "border-transparent bg-kumo-brand text-white" : "border-kumo-line bg-kumo-base text-kumo-default hover:bg-kumo-tint"}`}>
      {label}
    </Link>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SandboxLabel live={live} />
      <span className="ml-4 text-sm text-kumo-subtle">Format</span>
      {chip(view.format === null, hrefWith(base, view, { format: null, article: null }), "All")}
      {formats.map((f) => chip(view.format === f, hrefWith(base, view, { format: f, article: null }), FORMAT_LABEL[f]))}
      <span className="ml-4 text-sm text-kumo-subtle">Angle</span>
      {chip(view.angle === null, hrefWith(base, view, { angle: null, article: null }), "All")}
      {ANGLES.map((a) => chip(view.angle === a, hrefWith(base, view, { angle: a, article: null }), ANGLE_LABEL[a]))}
    </div>
  );
}

/** The two tags and where the idea came from, under every post. */
function PostTags({ post, muted }: { post: GoldSandboxPost; muted: string }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
      <span className="rounded-full bg-kumo-recessed px-2 py-0.5 font-medium text-kumo-default">{FORMAT_LABEL[post.format]}</span>
      <span className="rounded-full bg-kumo-recessed px-2 py-0.5 font-medium text-kumo-default">{ANGLE_LABEL[post.angle]}</span>
      <span className="min-w-0 truncate" style={{ color: muted }} title={post.input.label}>
        {post.input.url ? (
          <a href={post.input.url} target="_blank" rel="noreferrer" className="hover:underline">
            {post.input.label}
          </a>
        ) : (
          post.input.label
        )}
      </span>
    </div>
  );
}

/** Minimal markdown for Articles: `##` headings, `- ` lists, paragraphs, **bold**. */
function Markdown({ text, h2 }: { text: string; h2: string }) {
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p.replace(/\*([^*]+)\*/g, "$1")));
  const blocks = text.replace(/\n{3,}/g, "\n\n").split(/\n\s*\n/);
  return (
    <>
      {blocks.map((b, i) => {
        const t = b.trim();
        if (/^#{1,3}\s/.test(t)) {
          return (
            <h2 key={i} className={h2}>
              {inline(t.replace(/^#{1,3}\s+/, ""))}
            </h2>
          );
        }
        const lines = t.split("\n");
        if (lines.every((l) => /^\s*[-*]\s/.test(l))) {
          return (
            <ul key={i} className="my-3 list-disc pl-6">
              {lines.map((l, j) => (
                <li key={j} className="my-1">
                  {inline(l.replace(/^\s*[-*]\s+/, ""))}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="my-4">
            {inline(t)}
          </p>
        );
      })}
    </>
  );
}

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
const compact = (n: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const longDate = (at: Date) => at.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Almaty" });

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

function Visual({ id, className, style }: { id: string; className: string; style?: React.CSSProperties }) {
  // eslint-disable-next-line @next/next/no-img-element -- a private file streamed by /api/visuals, signed-in
  return <img src={`/api/visuals/${id}`} alt="" loading="lazy" className={className} style={style} />;
}

/* ------------------------------------------------------------------ X ------------------------------------------------------------------ */

const X = { ink: "#0f1419", muted: "#536471", rule: "#eff3f4", blue: "#1d9bf0", font: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' } as const;

function XAction({ icon }: { icon: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-[13px]" style={{ color: X.muted }}>
      {icon}
    </span>
  );
}

function XActions() {
  return (
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
  );
}

type PageProps = { account: GoldSandboxAccount; posts: GoldSandboxPost[]; total: number; pairedHref: string; base: string; view: SandboxView; liveUrls?: Record<string, string> };

/** An open X Article: X's reader view (title, cover, author row, body). */
function XArticle({ account, post, back }: { account: GoldSandboxAccount; post: GoldSandboxPost; back: string }) {
  return (
    <article className="px-4 pb-10">
      <Link href={back} className="mt-2 inline-flex items-center gap-2 rounded-full py-2 text-[15px] font-bold hover:underline">
        <ArrowLeftIcon size={20} /> Article
      </Link>
      {post.visualId && <Visual id={post.visualId} className="mt-2 aspect-[5/2] w-full rounded-2xl border object-cover" style={{ borderColor: X.rule }} />}
      <h1 className="mt-5 text-[31px] leading-9 font-extrabold">{post.title}</h1>
      <div className="mt-4 flex items-center gap-2 text-[15px]">
        <Avatar account={account} size={40} />
        <span className="flex flex-col">
          <span className="font-bold">{account.displayName}</span>
          <span style={{ color: X.muted }}>
            @{account.handle} · {longDate(post.postAt)}
          </span>
        </span>
      </div>
      <PostTags post={post} muted={X.muted} />
      {post.subtitle && <p className="mt-5 text-[19px] leading-7" style={{ color: X.muted }}>{post.subtitle}</p>}
      <div className="text-[17px] leading-7">
        <Markdown text={post.text} h2="mt-8 mb-2 text-[23px] leading-7 font-extrabold" />
      </div>
    </article>
  );
}

export function XProfile({ account, posts, total, pairedHref, base, view, liveUrls = {} }: PageProps) {
  const now = new Date();
  const open = view.article ? posts.find((p) => p.id === view.article) : undefined;
  return (
    <div className="mx-auto w-full max-w-[600px] border-x bg-white" style={{ borderColor: X.rule, color: X.ink, fontFamily: X.font }}>
      <div className="flex items-center gap-8 px-4 py-1.5">
        <div className="flex flex-col">
          <span className="text-[20px] leading-6 font-extrabold">{account.displayName}</span>
          <span className="text-[13px]" style={{ color: X.muted }}>
            {fmt(total)} posts
          </span>
        </div>
      </div>
      {open ? (
        <XArticle account={account} post={open} back={hrefWith(base, view, { article: null })} />
      ) : (
        <>
          <div className="aspect-[3/1] w-full" style={{ background: `linear-gradient(135deg, ${account.bannerColor} 0%, ${account.avatarColor} 160%)` }} />
          <div className="px-4">
            <div className="flex items-start justify-between">
              <span className="-mt-[12%] inline-flex rounded-full border-4 border-white">
                <BigAvatar account={account} size={133} />
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
              <p className="text-[31px] leading-9 font-extrabold">{total === 0 ? `@${account.handle} hasn't posted` : "No posts match"}</p>
              <p className="mt-2 text-[15px]" style={{ color: X.muted }}>
                {total === 0 ? "Posts land with the next daily collect." : "Try another format or angle."}
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
                  {liveUrls[`${p.day}:${p.slot}`] && (
                    <a href={liveUrls[`${p.day}:${p.slot}`]} target="_blank" rel="noreferrer" className="ml-auto shrink-0 text-[13px] font-bold hover:underline" style={{ color: X.blue }}>
                      View on X ↗
                    </a>
                  )}
                </div>
                {isArticle(p.format) ? (
                  <Link href={hrefWith(base, view, { article: p.id })} className="mt-2 block overflow-hidden rounded-2xl border hover:bg-black/[0.02]" style={{ borderColor: X.rule }}>
                    {p.visualId ? <Visual id={p.visualId} className="aspect-[5/2] w-full object-cover" /> : <div className="aspect-[5/2] w-full" style={{ background: account.bannerColor }} />}
                    <div className="flex flex-col gap-1 px-3 py-3">
                      <span className="text-[13px] font-bold" style={{ color: X.muted }}>
                        Article
                      </span>
                      <span className="text-[17px] leading-6 font-extrabold">{p.title}</span>
                      {p.subtitle && <span className="text-[15px] leading-5" style={{ color: X.muted }}>{p.subtitle}</span>}
                    </div>
                  </Link>
                ) : (
                  <>
                    <p className="text-[15px] leading-5 break-words whitespace-pre-wrap">
                      <XText text={p.text} linkColor={X.blue} />
                    </p>
                    {p.visualId && <Visual id={p.visualId} className="mt-3 w-full rounded-2xl border" style={{ borderColor: X.rule }} />}
                  </>
                )}
                <PostTags post={p} muted={X.muted} />
                <XActions />
              </div>
            </article>
          ))}
        </>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- Substack --------------------------------------------------------------- */

const S = { ink: "#363737", muted: "#777", rule: "#e6e6e6", accent: "#FF6719", font: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', serif: 'Spectral, Georgia, "Times New Roman", serif' } as const;

const noteTime = (at: Date) => at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "Asia/Almaty" });

/** An open Substack post: the publication's post page (title, subtitle, byline, cover, body). */
function SubstackArticle({ account, post, back }: { account: GoldSandboxAccount; post: GoldSandboxPost; back: string }) {
  return (
    <article className="mx-auto max-w-[728px] px-5 pt-6 pb-16">
      <Link href={back} className="inline-flex items-center gap-2 text-[14px] hover:underline" style={{ color: S.muted }}>
        <ArrowLeftIcon size={16} /> Notes
      </Link>
      <h1 className="mt-6 text-[40px] leading-[1.15] font-bold" style={{ fontFamily: S.serif }}>
        {post.title}
      </h1>
      {post.subtitle && <p className="mt-3 text-[20px] leading-snug" style={{ color: S.muted }}>{post.subtitle}</p>}
      <div className="mt-6 flex items-center gap-3 border-y py-3 text-[14px]" style={{ borderColor: S.rule }}>
        <Avatar account={account} size={36} />
        <span className="flex flex-col">
          <span className="font-semibold uppercase tracking-wide">{account.author}</span>
          <span style={{ color: S.muted }}>{longDate(post.postAt)}</span>
        </span>
      </div>
      <PostTags post={post} muted={S.muted} />
      {post.visualId && <Visual id={post.visualId} className="mt-6 w-full rounded-md" />}
      <div className="text-[19px] leading-[1.6]" style={{ fontFamily: S.serif }}>
        <Markdown text={post.text} h2="mt-10 mb-2 text-[28px] leading-tight font-bold" />
      </div>
    </article>
  );
}

export function SubstackHome({ account, posts, total, pairedHref, base, view }: PageProps) {
  const open = view.article ? posts.find((p) => p.id === view.article) : undefined;
  return (
    <div className="w-full bg-white" style={{ color: S.ink, fontFamily: S.font }}>
      <header className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: S.rule }}>
        <Link href={base} className="flex items-center gap-3">
          <Avatar account={account} size={36} />
          <span className="text-[17px] font-bold">{account.displayName}</span>
        </Link>
        <span className="flex items-center gap-2">
          <span className="rounded-md px-4 py-2 text-[14px] font-semibold text-white" style={{ background: S.accent }}>
            Subscribe
          </span>
          <span className="rounded-md border px-4 py-2 text-[14px] font-semibold" style={{ borderColor: S.rule }}>
            Sign in
          </span>
        </span>
      </header>
      {open ? (
        <SubstackArticle account={account} post={open} back={hrefWith(base, view, { article: null })} />
      ) : (
        <>
          <section className="mx-auto flex max-w-[560px] flex-col items-center px-5 py-12 text-center">
            <BigAvatar account={account} size={80} />
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
                {total === 0 ? "No notes yet. Notes land with the next daily collect." : "No posts match. Try another format or angle."}
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
                  {isArticle(p.format) ? (
                    <Link href={hrefWith(base, view, { article: p.id })} className="flex overflow-hidden rounded-lg border hover:bg-black/[0.02]" style={{ borderColor: S.rule }}>
                      <span className="flex min-w-0 flex-1 flex-col gap-1 p-4">
                        <span className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: S.muted }}>
                          {account.displayName}
                        </span>
                        <span className="text-[19px] leading-snug font-bold" style={{ fontFamily: S.serif }}>
                          {p.title}
                        </span>
                        {p.subtitle && <span className="text-[15px] leading-snug" style={{ color: S.muted }}>{p.subtitle}</span>}
                      </span>
                      {p.visualId && <Visual id={p.visualId} className="w-[34%] shrink-0 object-cover" />}
                    </Link>
                  ) : (
                    <>
                      <p className="text-[16px] leading-[1.55] break-words whitespace-pre-wrap">{p.text}</p>
                      {p.visualId && <Visual id={p.visualId} className="mt-1 w-full rounded-lg border" style={{ borderColor: S.rule }} />}
                    </>
                  )}
                  <PostTags post={p} muted={S.muted} />
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
        </>
      )}
    </div>
  );
}
