# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
**Primary: hackathon judges** (Patriot HackFest Fall 2026, Life Underground track). They give the project a few minutes, roughly in this order: the title and one line on the judging platform, the video, maybe the live link, maybe the README. Many open https://hollow-twin.vercel.app cold, with no setup and no guide. Success means they leave able to retell one sentence:

> When the power fails, Hollow Twin warns the deep levels first, shares what is left fairly, and gets a family's "I'm OK" through a network the Directorate switched off.

**In-world users (they shape the content, not the priorities):** residents and families across the Hollow's levels, who use the watch to say "I'm OK", ask for help or report sickness, and block operators and responders, who read block forecasts, compare the power rules and send the rover. Design decisions put the judge's few minutes first. The in-world roles keep the content believable.

## Product Purpose
Hollow Twin is a digital twin of one sector of the Hollow in 2124: nine levels, 70 blocks, 32 million people, from the surface down to a geothermal plant 2,560 m underground. It treats one outage as five track problems seen from different sides:

1. **Blackout warning:** it forecasts every block's battery hours ahead and warns the blocks that will run dry before their lights go out.
2. **Fair share:** it replaces the Directorate's "upper levels first" with a rule anyone can check: every block's air, pumps and medical load first, then the rest per person.
3. **Network cut:** relay boxes store messages and pass them block to block, and each message carries the route it took.
4. **Families:** one "I'm OK" press reaches the family's watches over those relays.
5. **Medicine (by rover):** a scout rover drives the tunnels to a block that asked for help, with supplies and a relay box, and checks on the way whether the tunnel is passable.

Success means a judge understands the claim within about a minute, through the 75-second guided story, and can check it by clicking blocks, switching the power rule and cutting the network.

## Positioning
The pitch is one event seen from five sides, and every part of it can be checked: the forecasts and the allocation come from one API, every alert cites a published limit, and every number says whether it is simulated, scripted or from a device. The physical side is a real Arduino watch and a real Raspberry Pi relay that signs, holds and forwards messages, and the rover is designed in CAD down to every part. The headline comparison is that under the Directorate's rule 12 deep blocks are dark by hour 30 and 8.5 million people have no fans or scrubbers, while with the same supply shared fairly no block goes dark.

## Operating Context
- Judges see it on the judging platform, in a video of about 100 seconds in five beats, and at the public link (desktop, and maybe a phone).
- The public link runs on the twin's built-in simulation because the API is not hosted. With `?api=` set, the twin shows the API's data instead.
- Useful addresses: `/?story=1` starts the story right away (used for recording), and `/?intro=0` skips the intro card.
- The family watch at `/watch` is a web page that runs on a real phone and sends to the API.
- **Deadline: Friday Nov 20, 2026, 11:00 PM ET. No coding after that, and no edits after submitting. The team plans to submit by 6:00 PM ET.** The demo path was frozen at noon on Thursday Nov 19.

## Capabilities and Constraints
**Surfaces in scope for design work:**
- `twin/index.html`: the three.js cutaway, the 75-second guided story, block cards (readings, forecast, history, actions), the Directorate and Fair share switch, the network cut, the help list and "Send the rover".
- `twin/watch/` (`/watch`): the family watch with I'm OK, help (two taps), I feel sick, family status, walkie-talkie presets and Morse. It shows its block's power forecast and its help call going from queued to delivered. **Edit `firmware/watch/web/index.html`** and copy it to `twin/watch/index.html` before deploying.
- `twin/scout/` (`/scout`): the rover's CAD model, parts list and a mission down a flooded tunnel.

**Out of scope for design work** (they stay listed under "also in the prototype"): `/research`, `/broadcast`, the outbreak simulator, and the water, flood and sickness layers.

**Technical constraints:**
- The twin is one static HTML page (about 175 KB) with three.js and no build step. It deploys to Vercel with `vercel deploy --prod` from `twin/`.
- The API (`api/`) is Node with no dependencies. It owns the forecast, the allocation and the limits; the twin shows them and falls back to its own simulation only where the API has no data.
- Folder ownership: `twin/` and `docs/` belong to anudeep-bonagiri, and `api/` and `CONTRACT.md` belong to SandeepMadhavarapu. A change to a folder someone else owns goes in a pull request.
- Known gaps: the phone layout is usable but not tuned, and the help queue has no ranked list with an assign button.

**Terminology:** the Hollow, the Directorate, block, level, relay box, watch, scout rover (rover-01), Fair share, "I'm OK", check-in, help request, network cut.

## Brand Commitments
**Binding: the honesty rule.** No design change may weaken it:
- Every reading stays tagged as twin simulation, scripted data through the API, or a device (verified or unverified).
- Every alert cites its limit. CO2, heat, flood depth and water limits come from published standards (Health Canada, OSHA, the US National Weather Service, WHO, US EPA). The battery warning levels (24 h and 8 h) are the team's own choice, and the screen says so.
- Nothing claims to be built when it is not. The rover is "designed and simulated, not built". The other 68 relays, the sensor nodes and the vitals sensors are simulated or scripted. Relay hops during a cut are drawn, not radioed.

**Voice:** plain, direct and candid, in the spirit of "We would rather tell you than have you find out." Use short declarative sentences and concrete numbers, with no hype.

**Name:** Hollow Twin.

## Evidence on Hand
- The live twin: https://hollow-twin.vercel.app
- Screenshots: `docs/img/` (`directorate-rule.jpg`, `check-in-through-the-api.jpg`) and the social preview image `twin/og.jpg`.
- CAD: `twin/scout/cad/` (STEP, URDF, meshes), `twin/watch/device/cad/`, and AR models in `twin/ar/` (`scout.glb`, `watch.glb`).
- Hardware: one Arduino watch and one Raspberry Pi relay (`docs/HARDWARE.md`), plus relay-to-relay software tested with two relays.
- The API test suite (`api/tests/`) and the scenario scripts (`blackout`, `fairshare`, `networkcut`, `water`, `outbreak`, `care`, `surface`).
- Submission draft and video script: `docs/SUBMISSION.md`.
- **Absent, so never fabricate:** real sensor data, real populations, users, testimonials, press or field deployments. The API is not hosted, the rover is not built, and the radio hardware is not built.

## Product Principles
1. **One sentence a judge can retell.** Work a judge can see in their first few minutes comes before work they cannot see.
2. **Show it, then let them check it.** The story makes the claim, and the clickable twin proves it.
3. **Say where every number comes from.** Honesty about what is simulated is a feature, not a disclaimer.
4. **One source of truth.** The API owns the numbers, so a judge asking "which number is true?" gets one answer.
5. **Five problems, one outage.** Keep the claimed problems focused, and keep extras clearly labelled as extras.
