# Style Guide — Pointing Poker Plus

This document defines the visual design language for Pointing Poker Plus, inspired by Jira's dark UI. All styling decisions should reference these tokens and conventions.

---

## Color Palette

### Core Surfaces

| Token | Hex | Usage |
|-------|-----|-------|
| `--background` | `#1D2125` | Page / body background |
| `--sidebar` | `#22272B` | Left/right sidebars, panel backgrounds |
| `--card` | `#282E33` | Cards, dialogs, elevated surfaces |
| `--popover` | `#282E33` | Dropdowns, tooltips, popovers |

### Text

| Token | Hex | Usage |
|-------|-----|-------|
| `--foreground` | `#B6C2CF` | Primary body text |
| `--muted-foreground` | `#738496` | Secondary/helper text, placeholders |

### Borders & Inputs

| Token | Hex | Usage |
|-------|-----|-------|
| `--border` | `#2C333A` | Dividers, panel edges, card borders |
| `--input` | `#2C333A` | Input field borders |

### Interactive / Brand

| Token | Hex | Usage |
|-------|-----|-------|
| `--primary` | `#579DFF` | Atlassian blue — primary buttons, links, active states, rings |
| `--primary-foreground` | `#1D2125` | Text on primary blue backgrounds |
| `--ring` | `#579DFF` | Focus ring |

### Component Variants

| Token | Hex | Usage |
|-------|-----|-------|
| `--secondary` | `#282E33` | Secondary button/badge backgrounds |
| `--secondary-foreground` | `#B6C2CF` | Text on secondary surfaces |
| `--muted` | `#22272B` | Muted backgrounds (code blocks, inline snippets) |
| `--accent` | `rgba(255,255,255,0.08)` | Hover overlay on dark surfaces |
| `--accent-foreground` | `#B6C2CF` | Text on accent hover |

### Semantic Colors

| Name | Hex | Usage |
|------|-----|-------|
| `--destructive` | `#F87168` | Errors, destructive actions |
| Success | `#4BCE97` | Voted indicator, done states |
| Warning | `#F5CD47` | Caution / in-review states |
| Info blue | `#579DFF` | Links, primary actions |
| Info blue (hover) | `#85B8FF` | Hover state for blue elements |

### Status Badge Colors

Use these specific background/text pairs for Jira-style status pills:

| Status category | Background | Text |
|----------------|-----------|------|
| To Do / Backlog | `#1C2B41` | `#579DFF` |
| In Progress | `#1C3A2A` | `#4BCE97` |
| Done / Completed | `#2C2A1E` | `#F5CD47` |
| Blocked / Flagged | `#3D1F1D` | `#F87168` |

---

## Typography

### Font Stack

- **UI font:** Inter (via `next/font/google`) — maps to `--font-sans`
- **Monospace:** Geist Mono — maps to `--font-mono`; use for session codes, issue keys, code blocks

### Scale & Weight

| Role | Size | Weight | Example usage |
|------|------|--------|---------------|
| Page title | `text-xl` | `font-semibold` | "Pointing Poker" room header |
| Section heading | `text-sm` | `font-semibold` | Sidebar section labels |
| Body | `text-sm` | `font-normal` | General UI text |
| Muted label | `text-xs` | `font-normal` | Helper text, timestamps |
| Issue key | `text-xs` | `font-mono font-medium` | MT56-3266 |
| Session code | `text-lg` | `font-mono font-bold tracking-widest` | ABC123 |

**Note:** Prefer `font-semibold` over `font-bold` for headings. Jira titles use medium-weight text, not heavy bold.

---

## Spacing & Layout

- **Base unit:** Tailwind default (4px)
- **Panel padding:** `p-3` or `px-3 py-2` for compact sidebars
- **Card padding:** `p-4` standard, `p-6` for prominent cards (home page)
- **Gap between items:** `gap-2` default, `gap-3` for looser lists

---

## Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius` | `3px` | Base radius — Jira uses nearly square corners |
| `--radius-sm` | `~2px` | Badges, small chips |
| `--radius-md` | `~2.5px` | Inputs, compact buttons |
| `--radius-lg` | `3px` | Cards, dialogs |

**Rationale:** Jira's UI is visually "flat" with very tight corner radii. Avoid rounded-full or large radii except for avatars.

---

## Component Conventions

### Buttons

- **Primary (default):** `bg-primary text-primary-foreground` — Atlassian blue fill
- **Secondary:** `bg-secondary text-secondary-foreground` — dark surface, used for "Next Round" style actions
- **Ghost:** transparent with `hover:bg-accent` — icon buttons, inline actions
- **Outline:** `border-border` with `hover:bg-accent` — lower-emphasis actions like "Connect Jira"
- Avoid full-width buttons except in forms/dialogs. Jira action buttons are right-aligned and fixed-width.

### Badges / Status Pills

- Use tight radius (`rounded-sm`) and small text (`text-xs`)
- Apply the status badge color pairs from the table above
- Avoid generic gray badges — always use a semantic color

### Cards

- `bg-card border border-border` — subtle border on elevated surface
- No heavy shadows — Jira uses border separation, not drop shadows

### Inputs

- `bg-card border-input` with `focus:ring-primary` — dark fill, primary ring on focus
- Labels: `text-sm font-medium` above input, `text-xs text-muted-foreground` for helper text below

### Sidebar / Issue List Items

- Default: `hover:bg-accent` (8% white overlay)
- Active/selected: `border-l-2 border-primary bg-primary/10` — left border highlight, Jira's selection pattern
- Pointed/done items: `opacity-60 hover:opacity-100`

### Avatars

- Background: `bg-primary/20 text-primary` — blue-tinted monogram
- Size in participant list: `h-7 w-7` with `text-xs` initials

---

## Motion & Animation

- **Minimal animation** — Jira's UI is functional and low-motion
- No scale transforms on interactive elements (no `hover:scale-105`)
- Border/color transitions only: `transition-colors`
- Dialog/sheet: keep existing enter/exit animations from shadcn (subtle fade/slide is fine)

---

## Dark Mode

The app runs exclusively in dark mode. The Jira palette above is the `:root` default — no light mode toggle is provided. The `.dark` CSS class is applied to `<html>` at the layout level to activate shadcn's dark variant overrides.

---

## Tailwind Usage Notes

- All semantic colors are referenced via CSS variable tokens (`text-primary`, `bg-card`, `border-border`, etc.) — never hardcode hex values in components except for one-off status badge colors not covered by the token set.
- Use `bg-[#1C2B41]` / `text-[#579DFF]` syntax for status badge colors that don't have dedicated tokens.
- Use `cn()` from `src/lib/utils.ts` to merge conditional class names.
- The `@theme inline` block in `globals.css` maps CSS variables to Tailwind color utilities — always extend there rather than adding raw Tailwind config.
