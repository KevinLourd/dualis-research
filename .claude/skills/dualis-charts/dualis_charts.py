#!/usr/bin/env python3
"""Dualis Research charts: any chart redrawn from its DATA in the Dualis style (design/tokens.json).

Library:
    import dualis_charts as dc
    fig, ax = dc.figure("dark")                       # "dark" = Notes and X (white on deep indigo), "light" = website and report pages
    dc.bars(ax, ["FY24", "FY25", "FY26E"], [498, 541, 590], label="Revenue ($m)")
    dc.line(ax, ["FY24", "FY25", "FY26E"], [13.1, 14.6, 15.8], label="EBITDA margin (%)", right=True, fmt="{:.1f}%")
    dc.finish(fig, ax, title="Margins are back at the 2019 level", source="Source: Company filings, Dualis Research.", out="chart.png")

Command line (first column = x axis, one series per other column):
    python dualis_charts.py data.csv --kind bar --title "..." --source "..." --out chart.png
    python dualis_charts.py prices.csv --kind line --benchmark "S&P 500" --title "..." --source "..." --out chart.png
    Options: --theme dark|light, --right "<column>" (second axis, drawn as a line), --format "{:,.0f}", --percent

Tokens, in this order: DUALIS_TOKENS (a path), design/tokens.json of the Dualis repo when run inside it, the live file
on GitHub main, then the copy shipped inside the skill zip (it prints which one it used).
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib import font_manager  # noqa: E402
from matplotlib.patches import FancyBboxPatch  # noqa: E402

HERE = Path(__file__).resolve().parent
LIVE_URL = "https://raw.githubusercontent.com/KevinLourd/dualis-research/main/design/tokens.json"
ESTIMATE = re.compile(r"\d[Ee]$")

_tokens: dict | None = None
_source = ""


def _repo_tokens() -> Path | None:
    for parent in [HERE, *HERE.parents]:
        p = parent / "design" / "tokens.json"
        if p.is_file():
            return p
    return None


def load_tokens(verbose: bool = True) -> dict:
    """The design system. No value is typed here: every colour comes from tokens.json."""
    global _tokens, _source
    if _tokens is not None:
        return _tokens
    env = os.environ.get("DUALIS_TOKENS")
    repo = _repo_tokens()
    if env:
        _tokens, _source = json.loads(Path(env).read_text()), env
    elif repo:
        _tokens, _source = json.loads(repo.read_text()), str(repo)
    else:
        try:
            with urllib.request.urlopen(LIVE_URL, timeout=8) as r:
                _tokens, _source = json.loads(r.read().decode()), LIVE_URL
        except Exception as e:  # sandbox without network: the copy shipped in the zip, said out loud
            bundled = HERE / "tokens.json"
            if not bundled.is_file():
                raise RuntimeError(f"No design tokens: GitHub unreachable ({e}) and no tokens.json beside the skill") from e
            _tokens, _source = json.loads(bundled.read_text()), f"{bundled} (copy shipped with the skill: GitHub unreachable)"
    if verbose:
        print(f"Dualis design system v{_tokens['version']} from {_source}", file=sys.stderr)
    return _tokens


def color(name: str, theme: str = "light"):
    for c in load_tokens()["color"]["tokens"]:
        if c["name"] == name:
            v = c["value"][theme]
            m = re.match(r"rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)", v)
            return (int(m[1]) / 255, int(m[2]) / 255, int(m[3]) / 255, float(m[4])) if m else v
    raise KeyError(f"design/tokens.json has no colour {name!r}")


def _fonts() -> None:
    for d in [HERE / "fonts", *(p / "web/src/collectors/dimensions/growth-brief/fonts" for p in HERE.parents)]:
        if d.is_dir():
            for f in d.glob("*.ttf"):
                font_manager.fontManager.addfont(str(f))
            break
    names = {f.name for f in font_manager.fontManager.ttflist}
    plt.rcParams["font.family"] = "IBM Plex Sans" if "IBM Plex Sans" in names else "DejaVu Sans"


class Style:
    def __init__(self, theme: str):
        spec = load_tokens()["chart"]["themes"][theme]
        self.bg = color(spec["background"])
        self.grid = color(spec["grid"])
        self.base = color(spec["baseline"])
        self.text = color(spec["text"])
        self.axis = color(spec["axis"])
        self.series = [color(s) for s in spec["series"]]
        # Charts with many series: the palette of this theme (light values on white, dark values on deep indigo).
        self.palette = [color(s, theme) for s in spec.get("palette", [])]


def figure(theme: str = "dark"):
    """A 16:9 figure on the chart ground."""
    _fonts()
    s = Style(theme)
    size = load_tokens()["chart"]["size"]
    fig, ax = plt.subplots(figsize=(size["width"] / size["dpi"], size["height"] / size["dpi"]), dpi=size["dpi"])
    fig.patch.set_facecolor(s.bg)
    ax.set_facecolor(s.bg)
    for side in ["top", "right", "left"]:
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color(s.base)
    ax.tick_params(colors=s.axis, labelsize=8, length=0)
    ax.yaxis.grid(True, color=s.grid, linewidth=0.8)
    ax.xaxis.grid(False)
    ax.set_axisbelow(True)
    ax._dualis = s  # type: ignore[attr-defined]
    ax._dualis_n = 0  # type: ignore[attr-defined]
    return fig, ax


def _next(ax, muted: bool = False):
    s = ax._dualis
    if muted:
        return s.series[2]
    n = ax._dualis_n
    # Main series, then the second-series colour; a third series and beyond take the palette from its third colour.
    c = s.series[n] if n < 2 or not s.palette else s.palette[n % len(s.palette)]
    ax._dualis_n += 1
    return c


def bars(ax, labels, values, label=None, fmt="{:,.0f}", muted=False):
    """Bars with rounded tops and a value on each. A label ending in E (FY26E) is an estimate: drawn lighter."""
    s, c = ax._dualis, _next(ax, muted)
    xs = list(range(len(labels)))
    top = max(values)
    width = 0.56
    for i, (x, v, lab) in enumerate(zip(xs, values, labels)):
        est = bool(ESTIMATE.search(str(lab)))
        ax.add_patch(FancyBboxPatch((x - width / 2, 0), width, v, boxstyle=f"round,pad=0,rounding_size={width * 0.08}",
                                    mutation_aspect=top / 12, facecolor=c, edgecolor="none", alpha=0.6 if est else 1, zorder=2,
                                    label=label if i == 0 else None))
        ax.text(x, v + top * 0.02, fmt.format(v), ha="center", va="bottom", color=s.text, fontsize=8)
    ax.set_xticks(xs, [str(x) for x in labels])
    ax.set_xlim(-0.6, len(xs) - 0.4)
    ax.set_ylim(0, top * 1.15)


def line(ax, labels, values, label=None, right=False, fmt="{:,.1f}", benchmark=False, dots=None):
    """A line (dots when few points). right=True puts it on a second axis. The last point carries its value."""
    s = ax._dualis
    target = ax
    if right:
        target = ax.twinx()
        target.set_facecolor("none")
        for side in ["top", "right", "left", "bottom"]:
            target.spines[side].set_visible(False)
        target.tick_params(colors=s.axis, labelsize=8, length=0)
    c = _next(ax, muted=benchmark)
    xs = list(range(len(labels)))
    show_dots = dots if dots is not None else len(values) <= 24
    target.plot(xs, values, color=c, linewidth=1.6 if benchmark else 2, marker="o" if show_dots else None, markersize=4, label=label, zorder=3)
    target.annotate(fmt.format(values[-1]), (xs[-1], values[-1]), xytext=(6, 0), textcoords="offset points", color=c, fontsize=8, va="center")
    if right:
        lo, hi = min(values), max(values)
        target.set_ylim(0 if lo >= 0 else lo * 1.2, hi * 1.3)
    elif len(labels) > 12:
        step = max(1, len(labels) // 6)
        ax.set_xticks(xs[::step], [str(labels[i]) for i in xs[::step]])
    else:
        ax.set_xticks(xs, [str(x) for x in labels])
    return target


def finish(fig, ax, title=None, source="Source: Dualis Research.", out="chart.png", legend=True):
    """Title, legend on top left, source line under the chart. Saves a PNG (or SVG by extension)."""
    s = ax._dualis
    handles, labels = [], []
    for a in fig.axes:
        h, lab = a.get_legend_handles_labels()
        handles += h
        labels += lab
    rows = max(1, -(-len(labels) // 5)) if legend else 1  # the legend wraps 5 a row
    top = (0.80 if title else 0.86) - 0.05 * (rows - 1)
    fig.subplots_adjust(left=0.08, right=0.92, top=top, bottom=0.14)
    if title:
        fig.text(0.08, 0.93, title, color=s.text, fontsize=13, fontweight="semibold", ha="left", va="center")
    if legend and labels:
        fig.legend(handles, labels, loc="upper left", bbox_to_anchor=(0.075, top + 0.025 + 0.05 * rows), ncol=min(len(labels), 5),
                   frameon=False, labelcolor=s.text, fontsize=8, handlelength=1.2)
    fig.text(0.08, 0.04, source, color=s.axis, fontsize=7, ha="left")
    fig.savefig(out, facecolor=s.bg)
    plt.close(fig)
    return out


def _number(v: str) -> float:
    return float(v.strip().replace(",", "").replace("%", "").replace("$", ""))


def main(argv=None):
    p = argparse.ArgumentParser(description="Redraw a chart from its data in the Dualis style")
    p.add_argument("csv")
    p.add_argument("--kind", choices=["bar", "line"], default="bar")
    p.add_argument("--theme", choices=["dark", "light"], default="dark")
    p.add_argument("--title")
    p.add_argument("--source", default="Source: Dualis Research.")
    p.add_argument("--right", help="column drawn as a line on the right axis")
    p.add_argument("--benchmark", help="column drawn in the benchmark grey")
    p.add_argument("--format", default="{:,.0f}")
    p.add_argument("--percent", action="store_true", help="values are percents: labels end with %")
    p.add_argument("--out", default="chart.png")
    a = p.parse_args(argv)
    with open(a.csv, newline="") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        raise SystemExit(f"{a.csv} has no rows")
    x, *cols = list(rows[0].keys())
    labels = [r[x] for r in rows]
    fmt = a.format + ("%" if a.percent else "")
    fig, ax = figure(a.theme)
    ordered = [c for c in cols if c not in (a.right, a.benchmark)] + ([a.benchmark] if a.benchmark else [])
    for c in ordered:
        vals = [_number(r[c]) for r in rows]
        if a.kind == "bar" and c != a.benchmark:
            bars(ax, labels, vals, label=c, fmt=fmt)
        else:
            line(ax, labels, vals, label=c, fmt=fmt, benchmark=c == a.benchmark)
    if a.right:
        line(ax, labels, [_number(r[a.right]) for r in rows], label=f"{a.right} (right)", right=True, fmt="{:,.1f}")
    print(finish(fig, ax, title=a.title, source=a.source, out=a.out))


if __name__ == "__main__":
    main()
