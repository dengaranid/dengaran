# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user: anyone, in any country, who wants to find and play a live radio station in the browser. Indonesia is the default starting country, not the boundary of the audience. Design decisions favor a listener who opens the site, picks a station quickly, and then leaves the tab open for a long time while doing something else (work, study, chores), on desktop or on a phone.

Secondary audience: station owners and copyright holders who may ask for a station to be hidden, through the contact address.

## Product Purpose

Dengaran (https://dengaran.id) lets people search and play radio stations from Indonesia and other countries directly in the browser. Success means a listener reaches a playing stream with as few steps as possible, and the stream keeps playing for as long as they want it to.

## Positioning

Three properties, confirmed as the ones every future change must keep:

- Clean: no ads, no cookies, no account sign-up. Play starts without any gate.
- Fast and light: a static site with plain HTML, CSS, and JavaScript, no framework, no `npm install`. Pages load quickly on slow connections.
- Calm for long use: an interface that can stay open for hours as background audio without demanding attention.

## Operating Context

- The page is often a background tab or a phone with the screen locked. Control from the lock screen (Media Session), keyboard shortcuts, and the Sleep Timer are part of normal use.
- Station streams come from third-party servers of uneven quality. Streams drop, use HTTP, or ship as `.pls`, `.m3u`, or HLS playlists. Automatic reconnection is part of the product, not an edge case.
- Station data comes from the public Radio Browser API (https://www.radio-browser.info). The app fetches the server list at runtime and falls back to fixed mirrors.
- Visitors arrive at the home page or at static landing pages per city and genre, for example `/radio-online-jakarta`.

## Capabilities and Constraints

- Search by name, country, and genre; sort by popularity, votes, name, or bitrate. "Semua negara" searches station names across all countries.
- Favorites and recently played stations are stored in the browser only and never sent to a server.
- Hosting is Cloudflare Pages, static only. There is no backend and no user account, so features that need server state or identity are out of scope.
- Privacy wording: the site uses Cloudflare Web Analytics. Copy must never claim "no tracking" or "no analytics". The accurate claim is no ads, no cookies, no account.
- On HTTPS pages, search shows only HTTPS streams. HTTP stations already in Favorites or recently played stay visible with an `HTTP` label.
- The UI language is Indonesian. Multi-language support is deferred until analytics show a consistent share of visits from outside Indonesia; until then the global audience is served by an Indonesian interface.
- The starting country is guessed from the browser: Indonesian time zones first, then the country code in `navigator.languages`.
- The app does not record broadcasts.
- Station logos are not shown, and no image requests go to station servers.
- Support is only the Saweria link https://saweria.co/dengaranid, framed as buying a coffee ("Traktir"). No QR code, no paid tier, no license.

## Brand Commitments

- Name: Dengaran. Tagline in the current UI: "Radio online hari ini".
- Voice: plain, short Indonesian. Factual statements, no hype.
- Icons: Lucide SVG, written inline. Icons from another source need an attribution entry in `THIRD_PARTY_NOTICES.md`.
- Assets on hand: `assets/favicon.svg`, `assets/favicon-48.png`, `assets/apple-touch-icon.png`, `assets/og-image.png`.
- The repository is public and intentionally has no license file.

## Evidence on Hand

- Real station data from Radio Browser, shown live.
- No testimonials, user counts, press, or partner logos exist. Future work must not invent them.

## Product Principles

1. The shortest path to sound wins. Every screen is judged by how quickly a listener gets from arrival to a playing stream.
2. Nothing on the page exists to monetize attention. No ads, no cookie banners, no sign-up prompts; the only ask is the voluntary Traktir link.
3. Built to stay open. Visual and motion choices must hold up after hours in a background tab; no decoration that pulls the eye while audio plays.
4. Weight is a feature. A change that adds a framework, a build dependency, or a large asset needs a strong reason.
5. Honest about data and streams. Privacy copy matches what the site actually does, and failed or HTTP streams are labeled instead of hidden behind vague errors.

## Accessibility & Inclusion

- Keyboard use is a first-class path: skip links to the station list and the player, and keyboard shortcuts for playback.
- Text color contrast is at least 4.5:1, and icon contrast at least 3:1.
- The page must work on slow connections and at narrow phone widths (checked at 320 to 375 px).
