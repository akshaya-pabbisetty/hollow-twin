# The 2-minute video

This is an online hackathon: judges never meet us. The video is the whole presentation, and some judges stop watching early, so **the first 10 seconds have to stand on their own**. Every number spoken is read off the screen in that take.

**Length: 2:00.** Check the platform's limit and trim beat 5 if it is shorter. Record at 1920 x 1080. **Burn the captions in**: many judges watch muted. Use our own voices. The thumbnail is [`img/hollow-twin-thumbnail.jpg`](img/hollow-twin-thumbnail.jpg).

## Shot list and narration

About 270 spoken words: a calm pace, not a rush.

| # | Time | On screen | Narration (word for word) |
| --- | --- | --- | --- |
| 1 | 0:00–0:12 | **One continuous take, no cuts**: a hand unplugs the router. It presses the Arduino's I'M OK button. The Pi's terminal prints `HELD`. The router goes back in; the Pi prints the upload, the twin draws "I'm OK" travelling up the lift, and Mom's phone watch buzzes "Dad is safe" | "The network is down. Dad presses one button. His message waits in the relay box, and the moment a line opens, his family knows he's alive." |
| 2 | 0:12–0:20 | Title card ([`img/title-card.jpg`](img/title-card.jpg)): the Directorate's poster stamped FALSE | "This is Hollow Twin." |
| 3 | 0:20–0:40 | Twin, story beat 1: the descent into the Hollow, the cutaway of nine levels | "Thirty-two million people live underground in the Hollow. The Directorate controls the power, the network, and the numbers. And the deeper you live, the less you get." |
| 4 | 0:40–1:05 | Story beats 2 to 4: blocks tagged with hours left; hour 30 under the Directorate's rule; the same hours under fair share | "When a geothermal unit fails, Hollow Twin forecasts every block's battery and warns the ones about to go dark, hours ahead. Under the Directorate's rule, twelve deep blocks are dark by hour thirty. Same failure, same power, one fair rule: life support first, then shared per person. No block goes dark." |
| 5 | 1:05–1:25 | The family watch on a phone, filmed in a hand: cut the network, hold HELP; the radio route lights up; Mom's watch turns red. Then the 3D watch page: the antenna glows, radio rings spread, the help queue shows the call ranked by its vitals | "When the Directorate cuts the network, our watches keep talking. A help call hops relay to relay, reaches the family, and joins the rescue queue, ranked by the caller's blood oxygen and pulse." |
| 6 | 1:25–1:40 | AR: the watch appearing on a real wrist through the phone camera; then the scout rover placed on a real floor and walked around. Then the twin: the rover riding the lift to Deepwell | "You can try the watch on your own wrist. And where even the relays can't reach, our scout rover drives the tunnels with a med kit, and brings the cut-off block's messages back out." |
| 7 | 1:40–1:53 | The README's "What is real and what is simulated" table, then a block card with an alert citing its limit | "Every alert cites a published safety standard, and every number says where it came from: a real device, scripted data, or the simulation. The Arduino and Pi are real; the rover and radios are designed, not built." |
| 8 | 1:53–2:00 | End card ([`img/end-card.jpg`](img/end-card.jpg)): the link and the four names. Our faces for two seconds before it, if we can | "Hollow Twin. We count ourselves." |

## Getting each shot

- **Beat 1 (the most important 12 seconds):** follow [`HARDWARE.md`](HARDWARE.md), "What to film". Keep the router, the Arduino, the Pi's screen and the phone in one frame, or split-screen the Pi's terminal next to the camera, but **never cut inside the take**. The phone watch is Mom: open `/watch/?api=<API>&device=watch-0011&name=Mom&block=l1-winch-gallery&to=watch-0071=Maya,watch-0012=Dad` and enter the key in Settings.
- **Beats 3 and 4:** open the twin with `?intro=0` and press **Play the 75-second story** (or `?story=1`). Record the beats, then speed up or trim the waiting in the edit. Turn the on-screen captions into the narration rather than reading them.
- **Beat 5:** the phone watch as Maya (the default) on the live API, with the key entered in Settings. Then `/watch/device/?api=<API>` with the key in **Connect**, the "Lung sickness" preset on, and HELP held. The API scores that call 115.
- **Beat 6:** `/ar/` on a phone. For the wrist: good light, the back of the wrist toward the camera, the other hand holding the phone. For the rover: **View in your room**, pointed at the floor. Screen-record the phone.

## Before uploading

- [ ] The first 10 seconds make sense with the sound off.
- [ ] Every number spoken is on screen in that take (12 blocks, hour 30, 115).
- [ ] Nothing claims a device that does not exist: say "simulated relays" where they are, and "designed, not built" for the rover.
- [ ] The captions are readable on a phone.
- [ ] Uploaded (YouTube, unlisted), played once in a logged-out browser, and the link put in `README.md` (`VIDEO_LINK`) and in the submission.
- [ ] A second take is saved as a backup.
