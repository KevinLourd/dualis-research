import { BRAND, categoryLabel, formatDate } from "@/lib/model";
import type { Publication } from "@/lib/queries";
import { Mark } from "./mark";

/**
 * A report cover: a photo of the company or its industry (Thierry 2026-11-06, picked once per post from Wikimedia
 * Commons by the console's `cover-photos` collector), an indigo veil, the shelf, title, date and the mark. A post
 * whose photo is not picked yet shows the plain indigo page. Never an AI image.
 */
export function Cover({ post, className = "" }: { post: Pick<Publication, "title" | "category" | "publishedAt" | "photo">; className?: string }) {
  return (
    <div className={`cover ${className}`} role="img" aria-label={`Cover: ${post.title}`}>
      {post.photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="cv-photo" src={post.photo.url} alt="" loading="lazy" decoding="async" />
      )}
      <div className="cv-veil" />
      <div className="cv-text">
        <p className="cv-shelf">{categoryLabel(post.category)}</p>
        <p className="cv-title">{post.title}</p>
        <p className="cv-date">{formatDate(post.publishedAt) ?? ""}</p>
      </div>
      <div className="cv-brand">
        <Mark />
        <span>{BRAND}</span>
      </div>
    </div>
  );
}

/** "Cover photo: Jane Doe, CC BY-SA 4.0", linked to the Commons page (the licence asks for the credit). */
export function PhotoCredit({ photo }: { photo: Publication["photo"] }) {
  if (!photo) return null;
  return (
    <a className="photo-credit" href={photo.link} target="_blank" rel="noopener noreferrer">
      Cover {photo.credit.charAt(0).toLowerCase() + photo.credit.slice(1)}
    </a>
  );
}
