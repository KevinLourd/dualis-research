/* GENERATED from design/tokens.json by design/build.mjs. Edit tokens.json, never this file. */

export const DESIGN_VERSION = 3;

export const COLOR = {
  "paper": {
    "light": "#F4F5F7",
    "dark": "#0A1120"
  },
  "surface": {
    "light": "#FFFFFF",
    "dark": "#111A2C"
  },
  "ink": {
    "light": "#17142E",
    "dark": "#E9ECF2"
  },
  "muted": {
    "light": "#5E5A73",
    "dark": "#9AA4B4"
  },
  "rule": {
    "light": "#E2E4E9",
    "dark": "#24304A"
  },
  "brand": {
    "light": "#2B2463",
    "dark": "#B9B2EA"
  },
  "on-brand": {
    "light": "#FFFFFF",
    "dark": "#0A1120"
  },
  "long": {
    "light": "#1E7A57",
    "dark": "#4CC28F"
  },
  "short": {
    "light": "#B0353A",
    "dark": "#E46B6E"
  },
  "long-soft": {
    "light": "#E3F1EA",
    "dark": "#13281F"
  },
  "short-soft": {
    "light": "#F7E4E4",
    "dark": "#2E1618"
  },
  "accent": {
    "light": "#2B2463",
    "dark": "#B9B2EA"
  },
  "accent-ink": {
    "light": "#1E1947",
    "dark": "#D2CDF3"
  },
  "brand-fill": {
    "light": "#2B2463",
    "dark": "#5B53A8"
  },
  "brand-fill-hover": {
    "light": "#1E1947",
    "dark": "#6C64B8"
  },
  "brand-chart": {
    "light": "#2B2463",
    "dark": "#9C93DF"
  },
  "accent-soft": {
    "light": "#EEF0F3",
    "dark": "#1B1733"
  },
  "deep": {
    "light": "#1A1640",
    "dark": "#1A1640"
  },
  "on-deep": {
    "light": "rgba(255, 255, 255, 0.8)",
    "dark": "rgba(255, 255, 255, 0.8)"
  },
  "beige": {
    "light": "#F2EFEA",
    "dark": "#F2EFEA"
  },
  "footer": {
    "light": "#0E1016",
    "dark": "#0E1016"
  },
  "chart-bg": {
    "light": "#161616",
    "dark": "#161616"
  },
  "chart-grid": {
    "light": "#2A2A2A",
    "dark": "#2A2A2A"
  },
  "chart-base": {
    "light": "#444444",
    "dark": "#444444"
  },
  "chart-text": {
    "light": "#E6E6E6",
    "dark": "#E6E6E6"
  },
  "chart-muted": {
    "light": "#8F8F8F",
    "dark": "#8F8F8F"
  },
  "chart-bar": {
    "light": "#FFFFFF",
    "dark": "#FFFFFF"
  },
  "chart-bar-muted": {
    "light": "#55555E",
    "dark": "#55555E"
  },
  "chart-line": {
    "light": "#E0592A",
    "dark": "#E0592A"
  },
  "chart-light-base": {
    "light": "#B8B6C4",
    "dark": "#B8B6C4"
  },
  "chart-light-bench": {
    "light": "#A3A0B2",
    "dark": "#A3A0B2"
  }
} as const;

export type ColorToken = keyof typeof COLOR;

export const FONT = {
  "serif": "\"Newsreader\", \"Source Serif 4\", Georgia, serif",
  "sans": "\"IBM Plex Sans\", system-ui, -apple-system, \"Segoe UI\", sans-serif",
  "mono": "\"IBM Plex Mono\", ui-monospace, \"SFMono-Regular\", Menlo, monospace"
} as const;
