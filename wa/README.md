# Dualis WhatsApp service (`wa/`)

Dualis Research's own **linked device** on an existing WhatsApp number (in the private repo) (a number takes 4 linked
devices; another assistant uses one and keeps every chat but ours). Baileys (TypeScript), no paid WhatsApp API.

- **Talks only to the allowlist** (the `WHATSAPP_ALLOWLIST` secret, read by `web/src/whatsapp/allowlist.ts`): Thierry, and Kevin for tests. Any other chat on
  the number is ignored: never stored, never answered. A test message goes to Kevin, never Thierry.
- **Inbound**: every message from an allowlisted chat lands in bronze (`dimension = 'whatsapp'`, subject
  `message:<wa id>`, raw message), its media in bronze (`media:<wa id>`, base64), voice notes transcribed on the box
  CPU by Whisper base (transformers.js + ffmpeg, $0) into bronze (source `whisper`, `transcript:<wa id>`), then silver
  `whatsapp_messages` (one row per WhatsApp id) and gold `whatsapp_conversation`. Measured on the box: an 8 s note
  in ~9 s, ~700 MB while the model is loaded (dropped after 10 idle minutes).
- **Outbound**: rows of `app.whatsapp_outbox` (contract in the root `CLAUDE.md`). Every message opens with
  `*Dualis Research*`. A recipient off the allowlist is `refused`, nothing sent. Send results land in bronze
  (`send:<outbox id>`) then silver/gold; delivery receipts (`receipt:<wa id>`) move `delivery` forward.
- **Neon budget**: free compute sleeps after 5 idle minutes, so the service only touches the DB when an allowlisted
  chat moves, plus one idle tick every 30 min (outbox poll, heartbeat, session snapshot). After any activity it polls
  the outbox every 10 s for 15 min. A row queued while idle goes out within 30 min (on time if `scheduled_at` is set).
- **Hosted dimensions** (`wa/src/hosted.ts`): `content-replies` runs 20 s after Thierry's messages settle (a voice
  note after its transcript), `content-dispatch` on each idle tick (first one a minute after boot). Same context as
  `pnpm collect`: `ctx.complete` = Kevin's Claude subscription (`CLAUDE_OAUTH_TOKEN` in the box env), never the paid
  key. They run on the service's single serial chain, with Whisper and sends. The image carries all of `web/src`, so a
  web merge restarts the container (WhatsApp reconnects in seconds and delivers what arrived meanwhile).
- **Session**: Baileys files on the container volume; snapshot in `app.whatsapp_auth` (on link, then each idle tick),
  restored on a fresh volume. Unlinked from the phone: the session is wiped and a new code appears.

## Link it (once)
Console > Settings > WhatsApp shows the code (also printed in `docker logs dualis-wa`). On the phone of the number:
WhatsApp > Settings > Linked devices > Link a device > scan. The card turns **Linked**.

## Deploy
Every merge to `main`: `deploy.yml` job `whatsapp` (after migrations) tars `wa/` + `web/src` and ships them with the database URL and Claude token over SSH to `WA_DEPLOY_HOST`. That key is a forced command
(`wa/box/deploy-hook.sh` in `/root/dualis-wa/`): it rebuilds and restarts only when code or env changed. Own compose
project `dualis-wa`, never inside the host's other stacks; `mem_limit 1500m`. Moving hosts = install the hook + the key
line (`command="/root/dualis-wa/deploy-hook.sh",no-pty,...`) and change the three `WA_DEPLOY_*` secrets (host since 2026-11-11: root@62.83.93.230). `/root/dualis-wa/.hold` = build only, never start (another instance of the same WhatsApp session is live elsewhere: two clients kick each other off, error 440 conflict); `rm` it once the other one is stopped.

## Test
**Test the reply loop yourself, never ask Kevin to type it** (Kevin 2026-11-09 « tu peux faire les tests toi-même ? »).
First check the device is `linked` (`ops.whatsapp_link`) and the draft row is `sent` in `app.whatsapp_outbox`, BEFORE
telling anyone a message is on its way (2026-11-09: it had never been linked, nothing ever left). Then insert his answer
as a `gold.whatsapp_conversation` row (contact = the test number, direction `in`, `reply_to_wa_id` = the draft's
`wa_message_id`, `wa_message_id` `TEST-…`, sources `{test}`), run `collect.yml` with `content-replies`, read the new
outbox row, and delete the `TEST-` rows after. Scripts run inside the container from `/app/wa` (it has `postgres`).
`WhatsApp test` workflow (or `pnpm wa:test` in `web/`) queues a text + image to Kevin. Shared logic tests:
`web/src/whatsapp/whatsapp.test.ts` (PGlite). Transcription on a file: `pnpm build && pnpm transcribe note.ogg`.
