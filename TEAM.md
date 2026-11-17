# How we work

The plan and dates are in [`docs/PLAN.md`](docs/PLAN.md). This file is the standing rules.

## Folders and owners

| Folder | What it is | Owner |
| --- | --- | --- |
| [`twin/`](twin/) | The 3D twin and the guided story. Deploys to https://hollow-twin.vercel.app | anudeep-bonagiri |
| [`api/`](api/), [`CONTRACT.md`](CONTRACT.md) | The backend and the shared message format | SandeepMadhavarapu |
| [`docs/`](docs/) | The plan, the submission draft and the video script | anudeep-bonagiri |
| [`firmware/`](firmware/), [`robot/`](robot/), [`broadcast/`](broadcast/) | On hold. Only the two-relay check-in is still an add-on (see the plan) | open |

- Edit your own folder. A change to someone else's goes in a pull request for them to review.
- `CONTRACT.md` is the one shared file. Only the backend owner edits it. Adding a field is fine any time; renaming or removing one needs everyone's OK.
- `inspo/` reference images stay out of the repo; they are other people's work.

## Working without waiting

```sh
node tools/catcher.mjs      # a stand-in API on http://localhost:8788
node tools/replay.mjs       # sends every sample message every 2 seconds
```

The real API is in `api/` (`cd api && npm start`, port 8787). `tools/replay.mjs` takes any address, so it can feed either one.

## Event rules that bind us

- Only the four of us contribute. AI tools are allowed.
- No coding after Friday Nov 20, 11:00 PM ET, and no edits after submitting.
