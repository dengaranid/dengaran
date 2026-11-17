---
name: Dengaran
description: Search and play live radio in the browser, in one calm dark window.
colors:
  bg: "#0c0c0b"
  panel: "#161514"
  panel-soft: "#201f1d"
  surface-sunken: "#121110"
  group-title-bg: "#1a1918"
  active-row: "#1f2a27"
  text: "#ece8e1"
  text-soft: "#d6d1c8"
  muted: "#a8a299"
  ink: "#161514"
  on-accent: "#f4f0e8"
  border: "rgba(236, 232, 225, 0.08)"
  edge-highlight: "rgba(255, 255, 255, 0.04)"
  primary: "#8fa6b9"
  primary-dark: "#4f6678"
  primary-darker: "#44596a"
  play: "#4f7a66"
  play-hover: "#5b8a74"
  play-strong: "#49715e"
  play-strong-hover: "#436756"
  stop: "#e6e1d8"
  success: "#6f9a83"
  success-soft: "#93b39f"
  warning: "#cbb27a"
  danger: "#e0a088"
  favorite: "#a96d6d"
typography:
  display:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "clamp(1.5rem, 1.1rem + 1.2vw, 1.85rem)"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.04em"
  title:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "0.95rem"
    fontWeight: 650
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.4
  meta:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "0.82rem"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "0.72rem"
    fontWeight: 600
    letterSpacing: "0.08em"
  control:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "0.88rem"
    fontWeight: 600
  landing-wordmark:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
  tech:
    fontFamily: "ui-monospace, \"SF Mono\", Menlo, Consolas, monospace"
    fontSize: "0.86em"
    letterSpacing: "0.02em"
rounded:
  none: "0"
  dot: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary-dark}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.none}"
    padding: "0 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.primary-darker}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.none}"
    padding: "0 16px"
    height: "44px"
  button-hero:
    textColor: "{colors.text}"
    rounded: "{rounded.none}"
    padding: "0 12px"
    height: "36px"
  player-play:
    backgroundColor: "{colors.play}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.none}"
    size: "44px"
  player-play-hover:
    backgroundColor: "{colors.play-hover}"
  player-stop:
    backgroundColor: "{colors.stop}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    size: "44px"
  row-play-outline:
    backgroundColor: "transparent"
    textColor: "{colors.success-soft}"
    rounded: "{rounded.none}"
    size: "40px"
  input-search:
    backgroundColor: "{colors.panel-soft}"
    textColor: "{colors.text}"
    rounded: "{rounded.none}"
    padding: "0 12px"
    height: "44px"
  picker-button:
    backgroundColor: "{colors.panel-soft}"
    textColor: "{colors.text}"
    rounded: "{rounded.none}"
    padding: "0 12px"
    height: "44px"
  station-row:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    padding: "8px 12px 8px 18px"
  station-row-current:
    backgroundColor: "{colors.active-row}"
  panel-tab:
    textColor: "{colors.muted}"
    typography: "{typography.control}"
    padding: "0 8px"
    height: "48px"
  toast:
    backgroundColor: "{colors.stop}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "10px 10px 10px 14px"
---

# Design System: Dengaran

## Overview

**Creative North Star: "The Night Receiver"**

Dengaran looks like a radio set on a desk at night: one dark rectangular window centered on the screen, warm charcoal surfaces, cream text, and a single green light that comes on only while a broadcast is playing. Technical readouts (codec, bitrate) use a monospace face, the way a tuner shows frequencies. Everything else stays quiet so the page can sit in a background tab for hours.

The palette follows the colors of plain everyday clothing (charcoal, cream, sage, dusty rose, blue gray): muted, low saturation, and never loud. Depth comes from one level of tonal difference between surfaces, thin 1px lines, and a single deep shadow under the main window. Components are flat, square, and spare: zero radius, hairline borders, and a filled background only for the one primary action in view.

The system rejects rounded corners, colored gradients, a light theme, web fonts, animated equalizers, and station logos.

**Key Characteristics:**
- One centered window on desktop; full-width window on screens up to 900px.
- Warm charcoal surfaces stepped by small lightness changes, separated by 1px lines at 8% cream.
- Square corners everywhere; circles only for 8px status dots.
- System UI font only, with weights shifted down (600 and 650 for emphasis, never 700 or above).
- Green means "playing", amber means "waiting or warning", dusty rose is only the favorite heart, peach is only errors.

## Colors

A low-chroma night palette: warm charcoal and cream, with blue gray for interface focus and sage green for live audio.

### Primary
- **Blue Gray Dial** (`primary`): focus rings, selected tab underline, open picker outline, loading state, active Sleep Timer. The interface color, not the audio color.
- **Deep Slate** (`primary-dark`, hover `primary-darker`): filled background of the generic primary button, with cream text.

### Secondary
- **Sage Signal** (`play`, hover `play-hover`): filled Play button in the mini player.
- **Deep Sage** (`play-strong`, hover `play-strong-hover`): backgrounds that carry cream text, where `play` would fall below 4.5:1.
- **Live Green** (`success`): the 8px "now playing" dot in lists and the LIVE badge dot.
- **Pale Sage** (`success-soft`): LIVE badge text and the icon of the outline Play button in rows.

### Tertiary
- **Brass Amber** (`warning`): the buffering badge and the `HTTP` label. A warning, not an error.
- **Dusty Rose** (`favorite`): the favorite heart icon only. Never text or large fills.
- **Soft Peach** (`danger`): error text in the player status and station error flags.

### Neutral
- **Night Charcoal** (`bg`): page background, with a faint cream radial light at the top.
- **Cabinet Charcoal** (`panel`): the main window and dialogs.
- **Raised Charcoal** (`panel-soft`): inputs, pickers, Sleep Timer options.
- **Sunken Charcoal** (`surface-sunken`): search bar, dialog tab strip, player bar.
- **Group Charcoal** (`group-title-bg`): sticky group headings in the station list.
- **Tuned Green Charcoal** (`active-row`): background of the station row that is currently loaded.
- **Warm Cream** (`text`), **Soft Cream** (`text-soft`), **Stone** (`muted`): primary text, secondary text, metadata and section labels.
- **Paper Cream** (`stop`, `on-accent`): filled Stop button and toast background; cream text on filled accents.
- **Ink** (`ink`): dark text on cream fills.
- **Hairline** (`border`) and **Edge Light** (`edge-highlight`): all dividers, and the 1px light line on top of the window.

### Named Rules
**The One Light Rule.** Green appears only for audio that is playing or can be played. A screen shows at most one filled green button (the mini player).

**The One Cream Stop Rule.** The filled cream Stop button appears once on screen, in the mini player. Row buttons use the outline version.

**The Token Rule.** New colors are added as tokens on `:root` in `src/styles.css`, with text contrast of at least 4.5:1 and icon contrast of at least 3:1.

## Typography

**Body Font:** system-ui (with -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)
**Label/Mono Font:** ui-monospace (with "SF Mono", Menlo, Consolas, monospace), only for codec and bitrate.

**Character:** the device's own UI font, set small and tight, so the page reads like part of the operating system. Monospace appears only where the data is technical.

### Hierarchy
- **Display** (600, `clamp(1.5rem, 1.1rem + 1.2vw, 1.85rem)`, line-height 1, letter-spacing -0.04em): the "Dengaran" wordmark only.
- **Title** (650, 0.95rem): station names in rows, the now-playing name in the player.
- **Body** (400, 1rem, line-height 1.4): dialog text and general copy. The tagline uses 0.95rem in `muted`.
- **Meta** (400, 0.8 to 0.82rem): country, genre, and station metadata in `muted`; tags at 0.75rem with a faded `#` prefix.
- **Label** (650, 0.72rem, letter-spacing 0.08em, uppercase): badges only (LIVE, MEMUAT, Sleep).
- **Control** (600, 0.88rem): panel tabs (Radio, Favorit, Baru Diputar) and the "Baru Diputar" panel heading, written with a capital letter at the start of each word, not uppercase; text on header buttons, dialog tabs, the support link button, landing tabs, small buttons, and the player status line.
- **Landing wordmark** (1.25rem): the "Dengaran" mark in the header of the station list pages generated by the build.
- Dialog titles use the Body size (1rem, 600). Genre chips above the list use the Meta size (0.8rem) with a 1px `border`; the "Genre" label before them uses the same size at weight 600 in `muted`, with a capital letter only at the start of the word.

### Named Rules
**The Minus 200 Rule.** Weights sit 200 below the usual choice. Emphasis uses 600 or 650. There is no 700, 800, or 900 anywhere.

**The System Font Rule.** No web fonts are loaded. Typography changes are made with size, weight, spacing, and case.

## Layout

On desktop (min-width 901px) the app is a column up to 1180px wide, centered vertically and horizontally, with 14px 24px padding and a 12px gap between header and window. The window is a CSS grid: content panels on top, player at the bottom. The panels are two columns: a flexible station list and a 350px side panel (`--side-width`) for recently played. The search bar (search, country, sort) sits at the top of the station list column only, because country and sort filter only that list; the "Baru diputar" heading in the side panel is 69px high so the line under it continues the line under the search bar. The panel height follows its content up to the viewport height, and the player keeps a 44px minimum content height when empty, so the window does not change height when the first station starts.

From 900px down the window spans the full screen width without side borders, the side panel moves behind tabs, and a 58px bottom navigation appears above the safe area. Below 600px station metadata and tags wrap to a second line. Layout is checked at 320, 375, 600, and 900px.

Spacing uses a 4px base: 4, 8, 12, 16, and 24px, with 8px the most common gap. Rows are dense (8px vertical padding) with 18px left inset that lines up with group headings and section headers.

## Elevation & Depth

The system is flat with tonal layering. Surfaces differ by small lightness steps (sunken, panel, raised) and are separated by 1px hairlines. Only floating layers get a shadow: the main window, dialogs, the picker popover, and the toast.

### Shadow Vocabulary
- **Window shadow** (`box-shadow: 0 40px 80px -24px rgba(0, 0, 0, 0.7)`, token `--shadow`): main window, dialogs, toast. On the window it is combined with `inset 0 1px 0 var(--edge-highlight)`.
- **Current-row bar** (`box-shadow: inset 2px 0 0 var(--play)`): a 2px green bar on the left edge of the loaded station row.
- **Open-picker outline** (`box-shadow: inset 0 0 0 1px var(--primary)`): a picker whose list is open.

### Named Rules
**The Flat-At-Rest Rule.** Controls never cast shadows. A shadow means the element floats above the window.

## Shapes

All boxes have square corners (`rounded.none`): window, dialogs, buttons, inputs, badges, toast. The only round shape is the 8px status dot (LIVE, buffering, now playing) and the volume slider thumb. Borders are 1px hairlines; selected tabs use a 2px bottom line in `primary`.

### Named Rules
**The Square Rule.** No border-radius on any rectangle. Circles are reserved for status dots.

## Components

### Buttons
Flat, square, and spare.
- **Shape:** square corners (0), 44px minimum height on primary controls, 36px for header and filter buttons.
- **Primary:** Deep Slate fill with cream text, 0 16px padding, weight 600. Hover moves to `primary-darker` in 0.15s.
- **Quiet:** transparent with a hairline border, for the second action in an empty state, so only one filled button shows.
- **Header buttons (Traktir, Tentang):** hairline border, 4% white fill, 0.88rem, 16px Lucide icon. Hover raises the fill to 10%.
- **Focus:** 2px `primary` outline with 2px offset on every focusable element; tabs and the player use a -2px inset offset.

### Play and Stop
The signature control, in two forms.
- **Mini player:** 44px square, filled. Play is `play` with cream icon; Stop is `stop` with ink icon; loading is `primary` with ink icon.
- **Station rows:** 40px square outline. Transparent background, 40% tinted border, icon in `success-soft` (Play), `stop` (Stop), or `primary` (loading). The fill appears only on keyboard focus or on hover for devices with a hover pointer.
- Labeled play buttons keep a fixed width (8.5em) so "Putar", "Memuat", and "Stop" do not shift their neighbors.

### Favorite Heart
No border in any state. The outline icon is `muted`; pressed fills the icon with `favorite`. Hover (hover devices only) adds a 6% white background to show the hit area.

### Station Rows
- **Layout:** grid of name and metadata, then heart, then play; 8px 12px 8px 18px padding; hairline bottom border.
- **States:** hover adds 2.5% white; the loaded station gets `active-row` plus the 2px green left bar; the playing station shows the 8px green dot before its name.
- **Text:** name 0.95rem weight 600 to 650, truncated with ellipsis; metadata 0.8rem `muted`; codec and bitrate in monospace.
- **Tags:** text buttons with a faded `#`, 24px minimum height, underline on hover.

### Inputs and Pickers
- **Style:** no border, `panel-soft` fill, square, 44px high, 0 12px padding.
- **Focus:** the global 2px `primary` outline.
- **Pickers (country, sort):** same surface as inputs with a 16px chevron that rotates 180deg in 0.2s; an open picker gets a 1px inset `primary` outline. The popover floats with the window shadow.

### Navigation
- **Panel tabs:** 0.88rem labels in `muted` with a capital letter at the start of each word, 48px high, 2px transparent bottom line. Hover turns text cream; selected turns text cream and the line `primary`.
- **Mobile:** a 58px bottom bar replaces the side panel from 900px down.

### Player Bar
The last row of the window. Station name at weight 650, status line at 0.88rem `muted`, LIVE badge (green dot plus letter-spaced 0.72rem text) or MEMUAT badge (amber), Sleep Timer badge in tinted `primary`, volume control, and play button. Errors show in `danger` with an inline alert icon.

### Toast
Cream (`stop`) panel with ink text, square, window shadow, entering in 0.28s with `cubic-bezier(0.16, 1, 0.3, 1)`, placed 12px above the player.

## Do's and Don'ts

### Do:
- **Do** use the tokens on `:root` in `src/styles.css`; add a token before using a new color.
- **Do** keep text contrast at 4.5:1 or above and icon contrast at 3:1 or above.
- **Do** use Lucide SVG icons inline at 16px (12px inside badges).
- **Do** keep touch targets at 40 to 44px for buttons and at least 24px for tags.
- **Do** keep motion to 0.15 to 0.2s color and border transitions and the `cubic-bezier(0.16, 1, 0.3, 1)` ease for popovers and toasts; under `prefers-reduced-motion` loaders pulse instead of spinning.
- **Do** mark the playing station with the static green dot, `active-row`, and the Stop icon.

### Don't:
- **Don't** add border-radius to any rectangle.
- **Don't** use colored gradients; the only gradient is the faint cream radial light behind the page.
- **Don't** add a light theme; the site is dark only (`color-scheme: dark`).
- **Don't** load web fonts.
- **Don't** use font-weight 700, 800, or 900.
- **Don't** animate an equalizer or any moving indicator for the playing station.
- **Don't** show station logos or request images from station servers.
- **Don't** use `favorite` for text or fills, or `danger` for anything other than errors.
- **Don't** show more than one filled Stop or Play button on screen.
