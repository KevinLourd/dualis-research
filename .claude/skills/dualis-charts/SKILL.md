---
name: dualis-charts
description: Draw or redraw any Dualis Research chart (Substack Note, article, report exhibit, website, X post) in the house style, from the underlying numbers. Load before writing any chart or plot code for Dualis, or when Thierry asks to "make this chart Dualis style", "redo the charts of this report", or to change a chart colour.
---

# Dualis charts

One design system for every Dualis chart: `design/tokens.json` in the public repo KevinLourd/dualis-research. The site,
the console and this skill all read it, so a chart drawn here matches the website and every other report.

## The one rule: rebuild from the data
A chart is redrawn from its NUMBERS, never traced from a picture. Before drawing:
1. Find the data: a CSV or Excel file the user attached, a table in the text, or the company's filings / the source the
   original chart cites. Use the exact figures and their period labels.
2. If only an image of a chart is available, do NOT read values off the pixels. Ask for the data file, or for the source
   (filing, Koyfin export, Excel model), and say which numbers are missing.
3. Show the numbers you used in a small table under the chart in your reply, so they can be checked.

## How to draw
Use `dualis_charts.py` (in this skill's folder; matplotlib only, $0). It loads the tokens itself and prints which copy it used.

```python
import sys; sys.path.insert(0, "<this skill folder>")
import dualis_charts as dc
fig, ax = dc.figure("dark")   # "dark" = the black Note chart (default), "light" = report page
dc.bars(ax, ["FY23", "FY24", "FY25", "FY26E"], [455, 498, 541, 590], label="Revenue ($m)")
dc.line(ax, ["FY23", "FY24", "FY25", "FY26E"], [12.4, 13.1, 14.6, 15.8], label="EBITDA margin (%, right)", right=True, fmt="{:.1f}%")
dc.finish(fig, ax, title="Margins are back at the 2019 level", source="Source: Company filings, Dualis Research.", out="chart.png")
```

From a CSV (first column = x axis, one series per other column):
`python dualis_charts.py data.csv --kind bar --right "EBITDA margin" --title "..." --source "..." --out chart.png`
Price paths: `--kind line --benchmark "S&P 500"`.

Style rules (from `chart.rules` in tokens.json, follow them all): legend on top; a value on every bar and on the last
point of each line; an estimate period ends with E (FY26E) and draws lighter; source line under the chart; titles state
the claim; green and red only for long / short data. Never pass colours by hand: `dc` reads them from the tokens.

A whole report: draw every chart with the same theme, one call per exhibit, number them Exhibit 1, 2, 3 in the text.

## Changing the design system
- Claude Code (Kevin, in the repo): edit `design/tokens.json`, run `node design/build.mjs`, open a PR. CI fails if a
  generated file is out of date.
- Thierry: console > Design system > Edit on a colour. The console commits the change to the same file on GitHub; the
  website follows within minutes, this skill on its next run.
- From Claude Desktop, never edit a local copy: write the change you want (token name, light and dark value, why) and
  Thierry applies it on the Design system page.

## Install in Claude Desktop (Thierry)
1. Download `dualis-charts.zip`: console > Design system > Download the chart skill
   (https://github.com/KevinLourd/dualis-research/releases/download/design-skill/dualis-charts.zip).
2. Claude Desktop > Settings > Capabilities: turn on code execution.
3. Settings > Capabilities > Skills > Upload skill > pick the zip.
4. In any chat or stock project: attach the data and ask "Chart this in the Dualis style".
The zip carries a copy of tokens.json for sandboxes without internet; with internet the skill reads the live file.
