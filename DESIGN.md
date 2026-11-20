---
name: Hollow Twin — Relay Line
description: Warm cream and safety yellow for the family watch and the Hollow Family phone app; every message shows the line it travelled.
colors:
  safety-yellow: "#FFC627"
  on-yellow: "#141414"
  yellow-ink: "#7A5600"
  yellow-wash: "rgba(255,198,39,.22)"
  signal-green: "#17703C"
  signal-red: "#B0261F"
  red-wash: "rgba(201,48,42,.09)"
  power-amber: "#A85A00"
  cream-ground: "#DCDBD3"
  cream-face: "#F3F2EC"
  cream-raise: "#FBFAF6"
  cream-sunk: "#E8E7E0"
  bezel: "#2A2B2E"
  rule: "#C9C8BF"
  rule-strong: "#A4A39A"
  ink: "#1F2124"
  ink-dim: "#55575B"
  ink-faint: "#66686C"
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
    backgroundColor: "{colors.cream-sunk}"
    textColor: "{colors.yellow-ink}"
  button-help:
    backgroundColor: "{colors.red-wash}"
    textColor: "{colors.signal-red}"
    rounded: "{rounded.sm}"
    padding: "5px 12px 4px"
  button-help-armed:
    backgroundColor: "{colors.signal-red}"
    textColor: "#FFFFFF"
  button-secondary:
    backgroundColor: "{colors.cream-raise}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  button-primary:
    backgroundColor: "{colors.safety-yellow}"
    textColor: "{colors.on-yellow}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  tab:
    backgroundColor: "{colors.cream-sunk}"
    textColor: "{colors.ink-dim}"
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
    backgroundColor: "{colors.cream-raise}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
  status-tag:
    backgroundColor: "{colors.cream-sunk}"
    textColor: "{colors.ink-faint}"
    typography: "{typography.label}"
    rounded: "{rounded.tag}"
    padding: "4px 7px 3px"
  status-tag-safe:
    backgroundColor: "{colors.signal-green}"
    textColor: "#FFFFFF"
  status-tag-help:
    backgroundColor: "{colors.signal-red}"
    textColor: "#FFFFFF"
  input:
    backgroundColor: "{colors.cream-sunk}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
  message:
    backgroundColor: "{colors.cream-raise}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "7px 10px"
  message-mine:
    backgroundColor: "{colors.yellow-wash}"
  chip-morse:
    backgroundColor: "{colors.yellow-wash}"
    textColor: "{colors.yellow-ink}"
    rounded: "{rounded.sm}"
---

# Design System: Hollow Twin — Relay Line

## Overview

**Creative North Star: "The Relay Line"**

A message is a journey, not a toast. The world reads like a transit map printed on warm paper: a light, faintly warm cream ground, a dark bezel round the watch, one committed shell colour (safety yellow), and road-sign type in tabular numerals. Every check-in shows the line it travelled (watch, relay, family) as stations and segments; the line is drawn in ink and its stations fill with yellow as the message moves. When the Directorate cuts the network, the round face takes a solid yellow rim, the restore-network button wears a yellow-and-black caution strip, and the line's segments turn dashed because the hops are now radio.

**Scope.** This system currently covers two surfaces only: the round family watch face and the Hollow Family phone app beside it (`firmware/watch/web/index.html`, copied byte-for-byte to `twin/watch/index.html`, also rendered alone inside the 3D watch's circular screen with `?embed=1`). The main 3D twin (`twin/index.html`) and `/scout` use an older, separate control-room grey system and are not governed by this file. Do not port Relay Line tokens into the twin, and do not treat the twin's styles as part of this world, until someone decides to migrate it.

Density is a wristwatch's: few words, big tap targets on the face, short condensed labels. The phone app below is a calm column of cards and lists under a yellow header band. It is light, flat and tonal; the only things that cast shadows are physical objects (the watch and its I'M OK disc). Dark mode was considered and rejected by the user; the system is light only.

**Key Characteristics:**
- Warm cream ground, dark bezel, safety-yellow shell, signal colours reserved for meaning.
- Yellow is a fill, never text; any yellow-family text is the dark Yellow Ink.
- Route lines drawn in ink with yellow stations, at full size under the watch and in miniature on every family member.
- The round face never carries stripes: state rims are solid colour. Caution strips live only on straight edges in real states (armed help, restore network, alarm cards).
- Barlow for sentences, Barlow Condensed 700 uppercase for labels, clock and headings; tabular numerals throughout.
- Squared 2-3 px corners on everything rectangular; true circles only for the face, the I'M OK disc, the Morse key, stations and status dots.
- Drawn single-stroke SVG icons (1.8 stroke, round caps).

## Colors

A light warm-cream ground with dark ink, one loud shell colour used as a fill, and three deep signal colours that each mean exactly one thing.

### Primary
- **Safety Yellow** (#FFC627): the shell, always as a fill. The phone app's header band, the dialog header, the I'M OK disc, the active watch tab, primary buttons (Save, SEND), lit route stations, the radio badge, the solid rim on the face while the network is cut, the info alert rim, the Morse key while pressed, text selection. Text on it is always On-Yellow. At 1.4:1 on the face it is never used for text or thin lines on cream.
- **On-Yellow** (#141414): text and icons on Safety Yellow (11.7:1), and the dark half of every caution strip.
- **Yellow Ink** (#7A5600): the only yellow-family text colour. Morse code, the Morse chip's label and border, the busy I'M OK label, the info level word on an alert (5.9:1 on the face).
- **Yellow Wash** (22% Safety Yellow): the wearer's own messages in the log (with a 35% Yellow Ink border) and the Morse chip.

### Secondary (signals)
- **Signal Green** (#17703C): "safe" only. Safe status dots, the SAFE tag (white text, 6.1:1), the safe alert rim, a block whose power is fine, the network-up dot, the borders of an ok card.
- **Signal Red** (#B0261F): help only. NEED HELP (text and border, solid when armed), help tags and rows, the unread pip, alarm cards, the danger alert rim, the network-down dot. Its soft fill is **Red Wash** (9%, mixed from a slightly brighter red, rgb 201 48 42).
- **Power Amber** (#A85A00): power warnings and "no API" state only (block battery under the team's warning level, the warn alert rim, the network-unknown dot).

### Neutral
- **Cream Ground** (#DCDBD3): the page background and the browser theme colour.
- **Cream Face** (#F3F2EC): the watch face, the phone app body, dialogs, alert discs.
- **Cream Raise** (#FBFAF6): cards, family rows, chips, messages, secondary buttons, the Morse key.
- **Cream Sunk** (#E8E7E0): wells: inactive tabs, inputs, status tags, the busy I'M OK disc.
- **Bezel** (#2A2B2E): the watch's 9px ring, the one dark mass on the page (10:1 against the ground).
- **Rule** (#C9C8BF) and **Rule Strong** (#A4A39A): hairline borders, list dividers, unlit route segments (Rule) and unlit stations and miniature lines (Rule Strong).
- **Ink** (#1F2124): primary text, lit route segments and the outline of lit stations, the Morse key's ring. **Ink Dim** (#55575B): secondary text and labels. **Ink Faint** (#66686C): notes, unlit station names, empty states, "tap to dismiss" (5.0:1 on the face, 4.5:1 on Sunk).

### Named Rules
**The Yellow Shell Rule.** Safety Yellow is the container and the call to act, never a status and never text. It does not mean "safe" or "warning"; that is what the signal colours are for. When a yellow-family word is needed on cream, it is Yellow Ink.

**The Ink Line Rule.** A route is drawn in Ink: lit segments are Ink, lit stations are Safety Yellow discs ringed in Ink. Unlit parts fall back to Rule and Rule Strong. Yellow never draws the line itself, because a yellow line vanishes on cream.

**The One Meaning Rule.** Green is only "safe", red is only help or alarm, amber is only a power or connection warning. A colour that appears without its meaning is a bug.

**The Straight-Edge Strip Rule.** The caution strip (45 degree yellow/black bands, 6 px on the restore-network button, 5 px under the armed help button) appears only on straight edges and only when the state is real: the network toggle while the network is cut (labelled Restore network), the help button while armed. The alarm variant swaps yellow for Signal Red on the top edge of an alarm card. The round face never carries stripes: its states are solid rims (yellow for network cut; green, red, amber or yellow for an arriving alert). Never use a strip as decoration, a divider or a section header.

## Typography

**Display Font:** Barlow Condensed 700 (with Arial Narrow, sans-serif)
**Body Font:** Barlow 400 and 600 (with system-ui, sans-serif)
**Label/Mono Font:** Barlow Condensed 700 for labels; ui-monospace for Morse code

**Character:** Road-sign lineage. Condensed bold capitals read at a glance on a 40 mm face and in a tunnel; the regular-width Barlow carries plain sentences. Fonts are embedded as WOFF2 in the page (Barlow 400, 600; Barlow Condensed 700) so the watch works with the network cut.

### Hierarchy
- **Display** (Condensed 700, 27px, 1.0): the clock on the face.
- **Headline** (Condensed 700, 24px, uppercase, 0.04em): the app name in the yellow header band. The I'M OK disc uses the same voice at 23px.
- **Title** (Condensed 700, 22px, 1.15): the text of an arriving alert; 18px uppercase in dialog headers; 20px for typed Morse text.
- **Body** (Barlow 400, 15px, 1.4): page text; 600 for names and card leads. Smaller steps at 14px (messages, family rows), 13.5/13px (cards, chips, panel buttons), 12.5px (secondary lines, network status), 12px (face status, notes, field labels).
- **Label** (Condensed 700, 11px, uppercase, 0.06–0.10em): status tags, route station names, power line, radio badge, hints. 10px for the miniature route caption.
- **Section label** (Condensed 700, 12px, uppercase, 0.14em, Ink Dim): headings of the app's sections (Your block, Your help call, Who's safe, Radio messages). These are real section headings, one per section.

### Named Rules
**The Road-Sign Rule.** Anything a person scans (a time, a state, a station, a heading) is Barlow Condensed 700 in capitals. Anything a person reads as a sentence is Barlow in sentence case.

**The Tabular Rule.** Numerals are tabular everywhere (set on the body), so clocks, hours of power and counts do not jitter as they change.

## Layout

Two columns that wrap: the watch column (`min(88vw, 360px)`) and the phone app (`min(92vw, 380px)`), centred with a 32px gap; on a phone they stack, watch first. Page padding is 16px at the sides plus safe-area insets. The watch column stacks the face, the network status line, the route line, and the Cut network / Settings bar with 14px gaps.

The face is a square circle positioned in percentages so it scales with its width and survives the 3D watch's circular iframe: clock block at 8.5% from the top, the active screen between 31% and 17.5% from the bottom with 9% side insets, the three tabs at 6.5% from the bottom. In embed mode only the face renders, filling the viewport on a transparent page, with no bezel or shadow.

The app body pads 16px; sections open with an 18px top margin. Spacing steps cluster at 4, 6, 8, 12, 16 and 32px; the face uses tighter 3–6px gaps.

## Elevation & Depth

Flat, tonal layering on a light ground: Cream Ground under Cream Face, with Raise (lighter) for cards and Sunk (darker) for wells, separated by 1px Rule borders. Shadows belong only to physical objects, and they are tinted with Ink rather than black.

### Shadow Vocabulary
- **Watch body** (`box-shadow: 0 0 0 1px #000, 0 16px 36px rgba(31,33,36,.28)`): the face inside its 9px Bezel ring, as an object sitting on the page.
- **Pressable disc** (`box-shadow: 0 5px 12px rgba(31,33,36,.28)`): the I'M OK disc only.
- **Pip cut-out** (`box-shadow: 0 0 0 2px #F3F2EC`): separates the unread pip from its tab.
- **Dialog scrim** (`rgba(31,33,36,.45)`): the backdrop behind a dialog; the dialog itself casts nothing.

### Named Rules
**The Objects-Only Rule.** Cards, rows, messages and dialogs are flat. If it is not a physical part of the watch, it does not cast a shadow.

## Shapes

Squared and engineered. Rectangular controls and containers use 3px corners; status tags and the radio badge use 2px; the phone app and dialogs use 6px. True circles are reserved for round objects: the face, the I'M OK disc, the Morse key, status dots and route stations. The final station on a route is a 3px-cornered square (the destination). Borders are 1px hairlines; 1.5px on the help button; 2px Ink on the Morse key; 3px strip border on the restore-network button. State rims on the round face are solid rings drawn inside the bezel (about 7px for network cut, 9px for an alert).

Icons are drawn single-stroke SVG at 24-unit viewBox, 1.8 stroke, round caps and joins, `currentColor`, 16px (12–14px inline).

## Components

### Buttons
Tactile and blunt, like labelled panel switches.
- **I'M OK disc:** a Safety Yellow circle a third of the face wide, On-Yellow condensed caps, the pressable-disc shadow. Busy: Cream Sunk with a 3px inset yellow ring and Yellow Ink text.
- **NEED HELP:** Red Wash with a 1.5px Signal Red border and Signal Red condensed caps (3px corners). Armed (first tap of two): solid Signal Red with white caps and a 5px black/yellow caution strip along the bottom edge.
- **I feel sick:** a quiet outlined button (Rule Strong border, Ink Dim text, 12px).
- **Secondary (Cut network, Settings, Cancel):** Cream Raise, Rule Strong border, 600 weight, 8px 16px. Hover darkens the border to Ink Dim. While the network is cut the toggle reads Restore network and its border becomes a 3px yellow/black caution strip.
- **Primary (Save, SEND):** Safety Yellow with On-Yellow text and a yellow border.
- **Press:** every pressable on the face scales to 0.95 in 80ms ease-out. **Focus:** a 2px outline at 2px offset (see Do's and Don'ts on its colour).

### Tabs (watch)
Three 42 x 28px squared tabs, drawn icons only (Home, Family, Talk) with aria-labels. Inactive: Cream Sunk with Rule border and Ink Dim icon. Active: Safety Yellow with On-Yellow icon. Unread: an 8px Signal Red pip at the top right, cut out from the tab by a 2px Cream Face ring.

### Status tags and dots
Condensed 11px caps on 2px-cornered chips. Default: Cream Sunk, Rule border, Ink Faint. Safe: solid Signal Green with white text. Help: solid Signal Red with white text. Status dots are 8–9px circles (Rule Strong when unknown); a help dot blinks at 1s in two steps.

### Cards / Containers
- **Corner Style:** 3px (cards, rows, messages, chips); 6px (app, dialog).
- **Background:** Cream Raise on Cream Face.
- **Shadow Strategy:** none (Objects-Only Rule).
- **Border:** 1px Rule; the border takes the state colour (amber for a power warning, green for ok, red for alarm). An alarm card adds a 6px red/black strip on its top edge.
- **Internal Padding:** 10px 12px.

### Messages and chips
Messages are Cream Raise bubbles (3px, 7px 10px, 14px text) with an 11px Ink Dim meta line. The wearer's own sit right in Yellow Wash; a help message takes Red Wash with a Signal Red border. Quick-reply chips are Cream Raise in a two-column grid; the Morse chip spans both columns in Yellow Wash with a Yellow Ink border and label.

### Inputs / Fields
Cream Sunk wells with a Rule Strong 1px border, 3px corners, 8px 10px padding, inheriting body type. Labels are Barlow 600 12px in Ink Dim above the field; help text is 12px Ink Faint. Checkboxes take Safety Yellow as accent.

### Navigation
The phone app has no navigation bar; it is one scrolling column. Its header is a Safety Yellow band holding the app name (headline) and a 12.5px 600 subline at 72% opacity. Dialogs repeat that band as their header.

### Arriving alert (watch)
Anything that arrives covers the face until tapped: a Cream Face disc, condensed title text in Ink, an Ink Dim subline, a faint uppercase "tap to dismiss". Its level is a solid 9px rim inside the bezel: Safety Yellow (info), Signal Green (safe), Power Amber (warning), Signal Red (danger). No stripes on the round face.

### Route line (signature)
The journey of the last message, drawn as a transit line: stations (15px circles, Cream Face fill with a 3px Rule Strong ring) joined by 3px Rule segments, condensed caps station names in Ink Faint with a small Barlow 11px subline. Lit stations fill Safety Yellow with an Ink ring, lit segments turn Ink and lit names turn Ink (300ms ease-out). Radio hops are dashed segments (5px on, 4px off). The last station is a square. A 9px miniature of the same line (2px Rule Strong strokes; Ink and yellow when on) sits under every family member in Who's safe, ending in a red station when that member asked for help, with a 10px condensed caption of how it travelled. Dashed hops during a cut are drawn, not radioed, and the page says so.

## Do's and Don'ts

### Do:
- **Do** keep this system to the watch and phone app surfaces until a migration of `twin/index.html` is decided.
- **Do** keep the system light: Cream Ground (#DCDBD3) page, Cream Face (#F3F2EC) surfaces, Ink (#1F2124) text, with the Bezel (#2A2B2E) as the only dark mass.
- **Do** show the route for every check-in, drawn in Ink with Safety Yellow stations, dashed for radio hops.
- **Do** put text on Safety Yellow in On-Yellow (#141414), and set any yellow-family text on cream in Yellow Ink (#7A5600).
- **Do** mark states on the round face with solid rims, and keep caution strips to straight edges in real states (armed help, restore network, alarm card).
- **Do** use Barlow Condensed 700 caps for anything scanned and Barlow for sentences, with tabular numerals.
- **Do** put white text on solid Signal Green and Signal Red tags (6.1:1 and 6.7:1).
- **Do** honour reduced motion: transitions and the help blink switch off.

### Don't:
- **Don't** build the category default: a GitHub-dark smartwatch with a glowing green button, emoji tabs and pill chips everywhere.
- **Don't** reintroduce a dark or graphite theme; the user rejected dark mode.
- **Don't** put caution strips on the round face or its rims.
- **Don't** use Safety Yellow as text, as a line on cream, or to mean "safe" or "warning"; don't use green and red for anything but safe and help.
- **Don't** use Safety Yellow for focus rings on cream (1.4:1). Focus is a 2px ink outline (#1F2124, 14:1).
- **Do** set small status words in Signal Green only at this darker value (5.5:1 on the face, 5.9:1 on cards); a lighter green fails at 11px.
- **Don't** use rounded pill shapes on rectangular controls; corners stay at 2–3px (6px for the app and dialog containers).
- **Don't** add shadows to cards, rows or dialogs.
- **Don't** use emoji or icon fonts; icons are drawn single-stroke SVG.
- **Don't** add uppercase eyebrows or kickers above headings; the condensed section labels are the headings.
