# Lane 1: Backend API

Owns this folder and `CONTRACT.md`. Builds the endpoints in section 4 of the contract.

- [ ] `POST /ingest`: one message or an array, drop duplicate ids, store everything.
- [ ] `GET /live`: server-sent events, `event: reading` per accepted message.
- [ ] `GET /blocks/<block id>/latest`, `GET /help`, `POST /help/<id>/assign`, `GET /broadcast`.
- [ ] Replay a backlog posted after a network cut in `time` order.
- [ ] Move the blackout forecast, fair-share allocation and outbreak model out of `twin/index.html` and into the API.
- [ ] Deploy somewhere the devices and the twin can both reach. Azure is a nod to the Microsoft sponsor.

Test it with `node tools/replay.mjs <your url>/ingest`.
