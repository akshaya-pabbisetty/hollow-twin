# Plan to the deadline

Proposed on Nov 17 after an outside review of the whole project (two independent reviewers read the repo and questioned every decision). It replaces the earlier five-device plan. Anything here can change if the team disagrees; say so in the group chat by Tuesday noon ET.

**Deadline: Friday Nov 20, 11:00 PM ET. No edits after submitting. We submit by 6:00 PM ET.**

## Think like the judge

A judge gives us a few minutes. They will see, in this order: the title and one line on the judging platform, the video, maybe the live link, maybe the README. They should leave with one sentence:

> When the power fails, Hollow Twin warns the deep levels first, shares what is left fairly, and gets a family's "I'm OK" through a network the Directorate switched off.

Everything below is judged against that. Work a judge cannot see in those few minutes comes after work they can.

## What we claim, and what we stopped claiming

**We claim four of the fifteen problems: 1 (blackout warning), 2 (fair share), 7 (network cut), 8 (families).** They are one outage seen from four sides, and each one works end to end today.

We stopped claiming the rest. The outbreak simulator, the water and flood layers, the sickness count and the surface verdict stay in the product as "also in the prototype". Reason: both reviewers said the easiest way to lose is to promise nine things and have a judge find the one that is not finished.

| Decision | Before | Now | Why |
| --- | --- | --- | --- |
| Problems claimed | 8 or 9 | 5: 1, 2, 7, 8, and 10 by rover (Nov 17: the rover is part of the product) | Each works end to end in the twin; the rover is designed in CAD and simulated, and says so |
| Hardware | Five devices by Wednesday | One watch (Arduino) and one relay box (Raspberry Pi), already written and tested against the API; see docs/HARDWARE.md | Uses parts we have; proves the network-cut claim with real hardware |
| AI | "Add AI that does real work" | No AI. Pitch rules where every alert cites a published limit | There is no real data to train or test on; a rushed estimator would dress up invented numbers as evidence. The claim that judges want AI came from our own notes, not from the organizers |
| Who owns the numbers | Twin and API each had their own forecast, allocation and limits | The API owns them. The twin shows them and falls back to its own simulation only where the API has no data | A judge asking "which number is true?" must get one answer |
| Broadcast page and surface story | Planned | Not built for the submission | The verdict logic exists in the API; a page for it is an add-on only |
| Video | Ten shots, three minutes | Five beats, about 100 seconds | One story a judge can retell |
| Feature freeze | Thursday 6 PM | Thursday noon | Friday is for the video and the form, not for code |

## Where things stand (Nov 17, early morning ET)

- Done: the twin reads the API (live stream, forecasts, allocation, check-ins, alerts), uses the API's limits, tags where every number comes from, and has a 75-second guided story for someone who opens the link cold.
- Done: the API (merged as PR #1), with scenario scripts that play each video beat through the real pipeline.
- Not done: the API is not hosted. The public link therefore runs on the twin's built-in simulation and says so.
- Not started: the video and the submission form.
- Unknown: what the judging platform asks for (video length, repo, live link). Two teammates have not joined the repo yet.

## Verify first (Tuesday morning, before any building)

1. **Open the judging platform** and write down: video length limit and format, whether a public repo or live link is required, every form field, the exact deadline. The official doc gives the deadline as both "Friday" and "Saturday" Nov 20; Nov 20 is a Friday. Treat it as Friday.
2. **Hardware: run docs/HARDWARE.md once on the real Arduino and Pi** (about half an hour). The code is written and tested with a stand-in watch; it has not touched the physical boards yet.
3. **Teammates: a reply by Tuesday noon ET.** After that, the plan assumes two people and offers the add-ons below to anyone who shows up.
4. **Hosting: who has an account that can keep the API awake?** Azure for Students, Render, or a tunnel from a machine that stays on. See the first task below.

## Day by day

| When (ET) | Twin owner (anudeep-bonagiri) | Backend owner (SandeepMadhavarapu) | Done when |
| --- | --- | --- | --- |
| **Tue Nov 17** | Review the live link on a second laptop and a phone. Read the story captions aloud; fix anything that sounds wrong. Draft the narration from `docs/SUBMISSION.md`. | **Host the API** (time-box: 3 hours; if it fights back, we film against a local API and say so). Then merge the test fix. | The public twin shows "API connected", or we have decided to film locally |
| **Wed Nov 18** | Point the public twin at the hosted API (`DEFAULT_API` in `twin/index.html`). Rehearse the five beats at recording resolution. | Keep one scenario running so the hosted twin always has something arriving. Decide what "latest reading" means when clocks disagree, and make the two timing-dependent tests deterministic. | **8 PM: one uninterrupted take of all five beats**, API and twin on screen together |
| **Thu Nov 19** | Record the rough cut with narration. Show it to one person who has never seen the project; fix what confused them. | Fix only what the rough cut exposed. No new endpoints. | **Noon: demo path frozen.** Evening: rough cut, submission text and README final |
| **Fri Nov 20** | Final take in the morning. Edit, check audio and legibility, upload. | Check every link in the submission from a logged-out browser. Make the repo public if the form needs it. | **Submitted by 6 PM**, after reading the platform's preview |

**If the other two teammates join**, in this order, and only if it is working by Wednesday 8 PM:

1. A second relay box, so the radio hop between relays is real too. Only if the Arduino-and-Pi take already works.
2. Narration, captions and a second pair of eyes on the video.
3. A minimal broadcast page that reads `GET /broadcast`.

## The proof shot

The fifteen seconds a judge should remember: **a check-in is pressed during the network cut, held, then delivered. The screen shows it arrive from the API and travel up the lift to the family's block.**

For it to be honest:

- The message really goes through `POST /ingest` and comes back on `GET /live`; the strip at the top left of the twin shows it arriving.
- The relay hop is scripted unless real boards carry it. The screen says "API, simulated" and the narration says "simulated relays".
- We show it delivered after the gap, with the delay on screen. We never say a radio mesh is working.

## Rules we keep

- Only the four of us contribute. AI tools are allowed by the rules.
- No coding after 11 PM ET on Friday. We stop at Thursday noon anyway.
- Nothing on screen without its source: twin simulation, scripted data through the API, or a device.
- Numbers in the narration are read off the screen in that take, never from memory.
