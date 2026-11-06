import { LINKEDIN_URL, X_URL } from "@/lib/model";
import { LinkedInIcon, SubstackIcon, XIcon } from "./icons";

/** Substack, X and LinkedIn, the row Aurelion keeps at the top right of every page band. */
export function Social({ substackUrl, className = "social" }: { substackUrl: string | null; className?: string }) {
  return (
    <div className={className}>
      {substackUrl && (
        <a target="_blank" rel="noopener noreferrer" href={substackUrl} aria-label="Substack">
          <SubstackIcon />
        </a>
      )}
      <a target="_blank" rel="noopener noreferrer" href={X_URL} aria-label="X">
        <XIcon />
      </a>
      <a target="_blank" rel="noopener noreferrer" href={LINKEDIN_URL} aria-label="LinkedIn">
        <LinkedInIcon />
      </a>
    </div>
  );
}
