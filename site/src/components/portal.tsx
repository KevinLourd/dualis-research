"use client";

import { useState } from "react";
import { CATEGORIES, categoryLabel, formatDate, shelf, type ResearchCategory } from "@/lib/model";
import type { Publication } from "@/lib/queries";
import { Cover, PhotoCredit } from "./cover";

/**
 * The research portal: a black and white list of what Thierry published; the row under the pointer shows its report
 * on the right (Thierry 2026-11-04). Every row opens the piece on Substack.
 */
export function Portal({ posts }: { posts: Publication[] }) {
  const [tab, setTab] = useState<ResearchCategory | "all">("all");
  const rows = shelf(posts, tab);
  const [activeId, setActiveId] = useState<string | null>(rows[0]?.id ?? null);
  const active = rows.find((p) => p.id === activeId) ?? rows[0] ?? null;
  const tabs: { key: ResearchCategory | "all"; label: string }[] = [{ key: "all", label: "All" }, ...CATEGORIES.map((c) => ({ key: c.key, label: c.title }))];
  return (
    <div className="portal">
      <div className="portal-tabs" role="tablist" aria-label="Research shelves">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => {
              setTab(t.key);
              setActiveId(shelf(posts, t.key)[0]?.id ?? null);
            }}
          >
            {t.label}
            <span className="count">{shelf(posts, t.key).length}</span>
          </button>
        ))}
      </div>
      <div className="portal-body">
        <ol className="portal-list">
          {rows.map((p) => (
            <li key={p.id} data-active={active?.id === p.id}>
              <a target="_blank" rel="noopener noreferrer" href={p.url} onMouseEnter={() => setActiveId(p.id)} onFocus={() => setActiveId(p.id)}>
                <span className="pl-date">{formatDate(p.publishedAt)}</span>
                <span className="pl-title">{p.title}</span>
                <span className="pl-shelf">{categoryLabel(p.category)}</span>
              </a>
            </li>
          ))}
          {rows.length === 0 && <li className="portal-empty">Nothing on this shelf yet.</li>}
        </ol>
        <aside className="portal-preview" aria-live="polite">
          {active && (
            <a target="_blank" rel="noopener noreferrer" href={active.url} className="pp-card">
              <Cover post={active} />
              <div className="pp-text">
                <p className="pp-shelf">{categoryLabel(active.category)}</p>
                <h3>{active.title}</h3>
                {active.subtitle && <p>{active.subtitle}</p>}
                <p className="pp-meta">
                  {formatDate(active.publishedAt)}
                  {active.wordCount ? ` · ${Math.max(1, Math.round(active.wordCount / 230))} min read` : ""}
                  {active.audience === "everyone" ? " · Free" : active.audience ? " · Subscribers" : ""}
                </p>
                <span className="link-arrow">Read the report</span>
              </div>
            </a>
          )}
          {active?.photo && (
            <p className="pp-credit">
              <PhotoCredit photo={active.photo} />
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
