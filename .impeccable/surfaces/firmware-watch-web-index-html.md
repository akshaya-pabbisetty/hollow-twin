---
version: 1
slug: "firmware-watch-web-index-html"
primary_target: "firmware/watch/web/index.html"
related_targets: ["twin/watch/index.html"]
---

# Family watch and phone app

Scope: `firmware/watch/web/index.html` (copied to `twin/watch/index.html`): the round watch face (also rendered inside the 3D watch at `/watch/device`, via `?embed=1`) and the Hollow Family phone app beside it. Mode: Operate.

Audience: judges first (PRODUCT.md), who open /watch on a phone or laptop; in-world, a resident on a deep level telling family they are safe during a blackout and a network cut.
Task: one press of I'M OK (or NEED HELP twice) reaches family; see who is safe, your block's power, your help call, radio messages.
Constraints: keep every function, ID, label and honesty line; caution strips were pinned by the user; must work in the 3D watch's circular iframe.

## Direction contract

THESIS: A message is a journey, not a toast. Every check-in shows the line it travelled, watch to relay to family, like a transit line. Refuses the category default: GitHub-dark smartwatch with a glowing green button, emoji tabs and pills everywhere.
OWN-WORLD: Graphite ground (near-black, faintly warm) with safety yellow as the committed shell colour (app header band, primary action, lit stations). Caution chevron strips (yellow/black, 45 degrees) appear only on real states: network cut, help armed, alarm. Signal green only for "safe", signal red only for help. Barlow / Barlow Condensed (road-sign lineage) in tabular numerals; squared 3-4 px corners; drawn SVG icons, one stroke.
STORY: The judge sees a watch that says where its wearer is (and, with the API connected, how long the block's power lasts; in local mode it shows no number, by the honesty rule in PRODUCT.md and the watch's own "shows nothing rather than guess"), presses I'M OK, and watches the message travel the line; cuts the network and sees the strips and the route go through relays; reads the family list with each member's route.
FIRST VIEWPORT: Phone: the round face fills the width; clock and block at top; yellow I'M OK square-cornered disc centre; NEED HELP and I feel sick below; three drawn-icon tabs at the bottom of the face. Under the face, the network status line and the relay line diagram. Then the app: yellow header band, block power card (a forecast only when the API is connected; otherwise a plain line saying to connect it), help card, Who's safe with per-member route lines, radio messages.
FORM: transit-line diagram, position 4 of 7 on the grounded list, seed:58e60e76283febd4. Pinned material (user): caution strips. Roll ran degraded (no challengers); user gave no preference between the roll and the pick.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
