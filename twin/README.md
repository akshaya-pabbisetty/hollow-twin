# Lane 4: The twin

`index.html` is the whole twin: a three.js cutaway of the sector, the simulation, the outbreak model and the panels. It deploys to https://hollow-twin.vercel.app with `vercel deploy --prod` from this folder.

Open it locally with any static server, for example `python3 -m http.server 8787` in this folder.

- [ ] Subscribe to `/live` and let real messages override the simulated values for their block.
- [ ] Help queue from `button: help` messages, ranked by triage.
- [ ] Show a relayed check-in arriving (the `hops` and `via` fields) when the network is cut.
- [ ] Hand the forecast, fair-share and outbreak logic to the API once lane 1 has it.
