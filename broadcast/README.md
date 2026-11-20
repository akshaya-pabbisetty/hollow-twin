# Public broadcast page

Built: [`twin/broadcast/index.html`](../twin/broadcast/index.html), served next to the twin at `/broadcast/`.

The page anyone in the Hollow can open to see what the surface scouts measured. The Directorate can read it but cannot edit it.

- The verdict: which way back up the readings support (suits, sealed domes, sealed outposts, or stay underground), from `GET /broadcast`.
- Every surface reading against its published limits, with links to each source.
- The latest picture a scout sent.
- The public record of verdict changes, from `GET /surface/history`, which the API only appends to.

It uses the same API address as the twin (`?api=` or the address the twin remembers). For a demo: start the API and run `npm run scenario -- surface` in `api/`. The verdict is rule-based (published limits), not AI.
