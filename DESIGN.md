---
name: Hollow Twin — Relay Line
description: Graphite and safety yellow for the family watch and the Hollow Family phone app; every message shows the line it travelled.
colors:
  safety-yellow: "#FFC627"
  on-yellow: "#141414"
  yellow-wash: "rgba(255,198,39,.13)"
  signal-green: "#3CC27A"
  signal-red: "#FF4D42"
  red-wash: "rgba(255,77,66,.13)"
  power-amber: "#FF9A2E"
  graphite-ground: "#11100E"
  graphite-face: "#191816"
  graphite-raise: "#201F1C"
  graphite-sunk: "#131210"
  bezel: "#282624"
  rule: "#383632"
  rule-strong: "#4E4B46"
  chalk: "#EEECE6"
  chalk-dim: "#A6A49C"
  chalk-faint: "#8E8C85"
typography:
  display:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "27px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.02em"
    fontFeature: "tnum"
  headline:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.04em"
  title:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "0.02em"
  body:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: "tnum"
  body-strong:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.4
  body-small:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "0.08em"
  section-label:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.14em"
  code:
    fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "15px"
    fontWeight: 400
    letterSpacing: "3px"
rounded:
  tag: "2px"
  sm: "3px"
  container: "6px"
  round: "50%"
spacing:
  xxs: "4px"
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "32px"
components:
  button-ok:
    backgroundColor: "{colors.safety-yellow}"
    textColor: "{colors.on-yellow}"
    typography: "{typography.title}"
    rounded: "{rounded.round}"
    width: "33%"
  button-ok-busy:
    backgroundColor: "{colors.graphite-sunk}"
    textColor: "{colors.safety-yellow}"
  button-help:
    backgroundColor: "{colors.red-wash}"
    textColor: "#FF8F87"
    rounded: "{rounded.sm}"
    padding: "5px 12px 4px"
  button-secondary:
    backgroundColor: "{colors.graphite-raise}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  button-primary:
    backgroundColor: "{colors.safety-yellow}"
    textColor: "{colors.on-yellow}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  tab:
    backgroundColor: "{colors.graphite-sunk}"
    textColor: "{colors.chalk-dim}"
    rounded: "{rounded.sm}"
    width: "42px"
    height: "28px"
  tab-active:
    backgroundColor: "{colors.safety-yellow}"
    textColor: "{colors.on-yellow}"
  app-header:
    backgroundColor: "{colors.safety-yellow}"
    textColor: "{colors.on-yellow}"
    typography: "{typography.headline}"
    padding: "14px 16px 12px"
  card:
    backgroundColor: "{colors.graphite-raise}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
  status-tag:
    backgroundColor: "{colors.graphite-sunk}"
    textColor: "{colors.chalk-faint}"
    typography: "{typography.label}"
    rounded: "{rounded.tag}"
    padding: "4px 7px 3px"
  status-tag-safe:
    backgroundColor: "{colors.signal-green}"
    textColor: "#07210F"
  input:
    backgroundColor: "{colors.graphite-sunk}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
  message:
    backgroundColor: "{colors.graphite-raise}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.sm}"
    padding: "7px 10px"
  message-mine:
    backgroundColor: "{colors.yellow-wash}"
---

# Design System: Hollow Twin — Relay Line

## Overview

**Creative North Star: "The Relay Line"**

A message is a journey, not a toast. The world reads like a transit line painted on a tunnel wall: a near-black, faintly warm graphite ground, one committed shell colour (safety yellow), and road-sign type in tabular numerals. Every check-in shows the line it travelled (watch, relay, family) as stations and segments, and the line lights up in yellow as the message moves. When the Directorate cuts the network, yellow-and-black caution strips appear on the rim of the watch, on the cut switch, and on an armed help button, and the line's segments turn dashed because the hops are now radio.

**Scope.** This system currently covers two surfaces only: the round family watch face and the Hollow Family phone app beside it (`firmware/watch/web/index.html`, copied byte-for-byte to `twin/watch/index.html`, also rendered alone inside the 3D watch's circular screen with `?embed=1`). The main 3D twin (`twin/index.html`) and `/scout` use an older, separate control-room grey system and are not governed by this file. Do not port Relay Line tokens into the twin, and do not treat the twin's styles as part of this world, until someone decides to migrate it.

Density is a wristwatch's: few words, big tap targets on the face, short condensed labels. The phone app below is a calm column of cards and lists under a yellow header band. It is flat and tonal; the only things that cast shadows are physical objects (the watch face and its I'M OK disc).

**Key Characteristics:**
- Graphite ground, safety-yellow shell, signal colours reserved for meaning.
- Caution strips only on real states: network cut, help armed, alarm.
- Barlow for sentences, Barlow Condensed 700 uppercase for labels, clock and headings; tabular numerals throughout.
- The route line (stations and segments) is the signature, at full size under the watch and in miniature on every family member.
- Squared 2-3 px corners on everything rectangular; true circles only for the face, the I'M OK disc, the Morse key and status dots.
- Drawn single-stroke SVG icons (1.8 stroke, round caps).

## Colors

A dark warm-graphite ground carrying one loud shell colour and three signal colours that each mean exactly one thing.

### Primary
- **Safety Yellow** (#FFC627): the shell. The phone app's header band, the dialog header, the I'M OK disc, the active watch tab, primary buttons (Save, SEND), lit route stations and segments, Morse code text, focus rings and text selection. Text on it is always On-Yellow.
- **On-Yellow** (#141414): text and icons on Safety Yellow (11.7:1), and the dark half of every caution strip.
- **Yellow Wash** (13% Safety Yellow): the wearer's own messages in the log and the Morse chip.

### Secondary (signals)
- **Signal Green** (#3CC27A): "safe" only. Safe status dots, the SAFE tag, a safe arrival alert, a block whose power is fine, network-up dot.
- **Signal Red** (#FF4D42): help only. NEED HELP, help tags and rows, the unread pip, alarm cards, danger alerts, network-down dot. Its soft fill is **Red Wash** (13%).
- **Power Amber** (#FF9A2E): power warnings and "no API" state only (block battery under the team's warning level, the network-unknown dot).

### Neutral
- **Graphite Ground** (#11100E): page background and the browser theme colour.
- **Graphite Face** (#191816): the watch face, the phone app body, dialogs.
- **Graphite Raise** (#201F1C): cards, family rows, chips, messages, secondary buttons.
- **Graphite Sunk** (#131210): wells: inactive tabs, inputs, status tags, the Morse key, the busy I'M OK disc.
- **Bezel** (#282624): the watch's ring.
- **Rule** (#383632) and **Rule Strong** (#4E4B46): hairline borders, list dividers, unlit route segments and stations.
- **Chalk** (#EEECE6): primary text. **Chalk Dim** (#A6A49C): secondary text and labels. **Chalk Faint** (#8E8C85): notes, unlit station names, empty states (at least 4.9:1 on every graphite).

### Named Rules
**The Yellow Shell Rule.** Safety Yellow is the container and the call to act, never a status. It never means "safe" and never means "warning"; that is what the signal colours are for.

**The One Meaning Rule.** Green is only "safe", red is only help or alarm, amber is only a power or connection warning. A colour that appears without its meaning is a bug.

**The Real-State Strip Rule.** The caution strip (45 degree yellow/black, 6 px bands) appears only when the state is real: the rim of the face while the network is cut, the Cut network toggle while on, the help button while armed. The alarm variant swaps yellow for Signal Red (on the top edge of an alarm card and the rim of a danger alert). Never use it as decoration, a divider or a section header.

## Typography

**Display Font:** Barlow Condensed 700 (with Arial Narrow, sans-serif)
**Body Font:** Barlow 400 and 600 (with system-ui, sans-serif)
**Label/Mono Font:** Barlow Condensed 700 for labels; ui-monospace for Morse code

**Character:** Road-sign lineage. Condensed bold capitals read at a glance on a 40 mm face and in a tunnel; the regular-width Barlow carries plain sentences. Fonts are embedded as WOFF2 in the page (Barlow 400, 600; Barlow Condensed 700) so the watch works with the network cut.

### Hierarchy
- **Display** (Condensed 700, 27px, 1.0): the clock on the face.
- **Headline** (Condensed 700, 24px, uppercase, 0.04em): the app name in the yellow header band. The I'M OK disc uses the same voice at 23px.
- **Title** (Condensed 700, 22px, 1.15): the text of an arriving alert; 18px uppercase in dialog headers; 20px for typed Morse text.
- **Body** (Barlow 400, 15px, 1.4): page text; 600 for names and card leads. Smaller steps at 14px (messages, family rows), 13.5/13px (cards, chips), 12.5px (secondary lines), 12px (status, notes).
- **Label** (Condensed 700, 11px, uppercase, 0.06–0.10em): status tags, route station names, power line, radio badge, hints.
- **Section label** (Condensed 700, 12px, uppercase, 0.14em, Chalk Dim): headings of the app's sections (Your block, Your help call, Who's safe, Radio messages). These are real section headings, one per section.

### Named Rules
**The Road-Sign Rule.** Anything a person scans (a time, a state, a station, a heading) is Barlow Condensed 700 in capitals. Anything a person reads as a sentence is Barlow in sentence case.

**The Tabular Rule.** Numerals are tabular everywhere (set on the body), so clocks, hours of power and counts do not jitter as they change.

## Layout

Two columns that wrap: the watch column (`min(88vw, 360px)`) and the phone app (`min(92vw, 380px)`), centred with a 32px gap; on a phone they stack, watch first. Page padding is 16px at the sides plus safe-area insets. The watch column stacks the face, the network status line, the route line, and the Cut network / Settings bar with 14px gaps.

The face is a square circle positioned in percentages so it scales with its width and survives the 3D watch's circular iframe: clock block at 8.5% from the top, the active screen between 31% and 17.5% from the bottom with 9% side insets, the three tabs at 6.5% from the bottom. In embed mode only the face renders, filling the viewport, with no border or shadow.

The app body pads 16px; sections open with an 18px top margin. Spacing steps cluster at 4, 6, 8, 12, 16 and 32px; the face uses tighter 3–6px gaps.

## Elevation & Depth

Flat, tonal layering: Graphite Ground under Graphite Face, with Raise for cards and Sunk for wells, separated by 1px Rule borders. Shadows belong only to physical objects.

### Shadow Vocabulary
- **Watch body** (`box-shadow: 0 0 0 2px #000, 0 18px 48px rgba(0,0,0,.55)`): the face, as an object sitting on the page.
- **Pressable disc** (`box-shadow: 0 6px 16px rgba(0,0,0,.45)`): the I'M OK disc only.
- **Pip cut-out** (`box-shadow: 0 0 0 2px #191816`): separates the unread pip from its tab.

### Named Rules
**The Objects-Only Rule.** Cards, rows, messages and dialogs are flat. If it is not a physical part of the watch, it does not cast a shadow.

## Shapes

Squared and engineered. Rectangular controls and containers use 3px corners; status tags and the radio badge use 2px; the phone app and dialogs use 6px. True circles are reserved for round objects: the face, the I'M OK disc, the Morse key, status dots and route stations. The final station on a route is a 3px-cornered square (the destination). Borders are 1px hairlines; 1.5px on the help button; 3px strip borders on the active cut toggle.

Icons are drawn single-stroke SVG at 24-unit viewBox, 1.8 stroke, round caps and joins, `currentColor`, 16px (12–14px inline).

## Components

### Buttons
Tactile and blunt, like labelled panel switches.
- **I'M OK disc:** a Safety Yellow circle a third of the face wide, On-Yellow condensed caps, the pressable-disc shadow. Busy: Graphite Sunk with a 3px inset yellow ring and yellow text.
- **NEED HELP:** Red Wash with a 1.5px Signal Red border and light-red condensed caps (3px corners). Armed (first tap of two): solid red with a caution strip along the bottom edge.
- **I feel sick:** a quiet outlined button (Rule Strong border, Chalk Dim text).
- **Secondary (Cut network, Settings, Cancel):** Graphite Raise, Rule Strong border, 600 weight, 8px 16px. Hover lifts the border to Chalk Dim. Cut network while on: Graphite Sunk, yellow text, 3px caution-strip border.
- **Primary (Save, SEND):** Safety Yellow with On-Yellow text.
- **Press:** every pressable on the face scales to 0.95 in 80ms ease-out. **Focus:** 2px Safety Yellow outline, 2px offset.

### Tabs (watch)
Three 42 x 28px squared tabs, drawn icons only (Home, Family, Talk) with aria-labels. Inactive: Graphite Sunk with Rule border and Chalk Dim icon. Active: Safety Yellow with On-Yellow icon. Unread: an 8px Signal Red pip at the top right.

### Status tags and dots
Condensed 11px caps on 2px-cornered chips. Default: Graphite Sunk, Rule border, Chalk Faint. Safe: solid Signal Green with dark-green text. Help: solid Signal Red. Status dots are 8–9px circles; a help dot blinks at 1s in two steps.

### Cards / Containers
- **Corner Style:** 3px (cards, rows, messages); 6px (app, dialog).
- **Background:** Graphite Raise on Graphite Face.
- **Shadow Strategy:** none (Objects-Only Rule).
- **Border:** 1px Rule; the border takes the state colour (amber for a power warning, green for ok, red for alarm). An alarm card adds a 6px red/black strip on its top edge.
- **Internal Padding:** 10px 12px.

### Inputs / Fields
Graphite Sunk wells with Rule Strong 1px border, 3px corners, 8px 10px padding, inheriting body type. Labels are Barlow 600 12px in Chalk Dim above the field; help text is 12px Chalk Faint. Focus is the shared yellow outline; checkboxes take Safety Yellow as accent.

### Navigation
The phone app has no navigation bar; it is one scrolling column. Its header is a Safety Yellow band holding the app name (headline) and a 12.5px 600 subline at 72% opacity. Dialogs repeat that band as their header.

### Arriving alert (watch)
Anything that arrives covers the face until tapped: Graphite Face disc, condensed title text, a dim subline, a faint uppercase "tap to dismiss". Its level is the 8–9px rim: solid yellow (info), solid green (safe), yellow/black strip (warning), red/black strip (danger).

### Route line (signature)
The journey of the last message, drawn as a transit line: stations (15px circles with a 3px Rule Strong border) joined by 3px segments, condensed caps station names with a small Barlow 11px subline. Lit stations fill Safety Yellow and lit segments turn yellow (300ms ease-out). Radio hops are dashed segments (5px on, 4px off). The last station is a square. A 9px miniature of the same line sits under every family member in Who's safe, ending in a red station when that member asked for help, with a condensed caption of how it travelled. Dashed hops during a cut are drawn, not radioed, and the page says so.

## Do's and Don'ts

### Do:
- **Do** keep this system to the watch and phone app surfaces until a migration of `twin/index.html` is decided.
- **Do** show the route for every check-in, lit in Safety Yellow, dashed for radio hops.
- **Do** put text on Safety Yellow in On-Yellow (#141414), never white.
- **Do** use the caution strip only for network cut, help armed and alarm (Real-State Strip Rule), with the red variant for alarm and danger.
- **Do** use Barlow Condensed 700 caps for anything scanned and Barlow for sentences, with tabular numerals.
- **Do** keep text on signal colours at 4.5:1 or better; dark text on green (as built), and dark text on red where the label is small.
- **Do** honour reduced motion: transitions and the help blink switch off.

### Don't:
- **Don't** build the category default: a GitHub-dark smartwatch with a glowing green button, emoji tabs and pill chips everywhere.
- **Don't** use Safety Yellow to mean "safe" or "warning", or green and red for anything but safe and help.
- **Don't** use rounded pill shapes on rectangular controls; corners stay at 2–3px (6px for the app and dialog containers).
- **Don't** add shadows to cards, rows or dialogs.
- **Don't** use emoji or icon fonts; icons are drawn single-stroke SVG.
- **Don't** add uppercase eyebrows or kickers above headings; the condensed section labels are the headings.
