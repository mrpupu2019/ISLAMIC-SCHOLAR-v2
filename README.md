# ISLAMIC SCHOLAR - Discord bot

A lightweight Discord bot for an Islamic community. One process, one token. It includes:

| Part | What it does |
|---|---|
| **iscllv10allinone** (cleaned up) | `#` commands for moderation, staff tools, tickets, staff applications, logs, the Islamic content filter, AFK, **automatic welcome DM**, **Islamic reminders** |
| **isdatamod** (unchanged) | Commands without a prefix (`Salam`, `invite`, `help`, `cmd`, `warn`, `mute`, `kick`, `bannow`, `verifygirl`...), the Q&A database (`#addqa`, `#removeqa`, `#qastatus`), `#ta` text to speech |
| **autorcdc** (unchanged) | Automatic emoji reactions in the configured channels |

Removed from iscllv10allinone: the ranking and statistics system (`stats`, `top10`, `top-record`, voice and message tracking), every Register command and the registration welcome, Talent commands, the server tag system, truth or dare, fortune, giveaways, `eval`, `ip`, and the bot joining voice.

## Run on Railway
1. Push this folder to a GitHub repository (`package.json` must be at the root).
2. Railway → **New Project → Deploy from GitHub repo**.
3. **Settings → Volumes → New Volume** with mount path `/data`.
4. **Variables**: `DISCORD_TOKEN` = your bot token, `DATA_DIR` = `/data`.
5. Keep **1 replica** and do not create a public domain (the bot does not need a port).
6. In the Discord Developer Portal → Bot, turn on the **Presence**, **Server Members** and **Message Content** intents.

The start command and restart policy come from `railway.json`. Expected use is about **55-90 MB RAM** and almost no CPU.

## Run locally
```bash
npm install            # Node.js 20
cp .env.example .env   # add DISCORD_TOKEN
npm start
npm test               # offline tests, no token needed
```

## Environment variables
| Name | Required | Default | Meaning |
|---|---|---|---|
| `DISCORD_TOKEN` | yes | - | Bot token |
| `DATA_DIR` | on Railway | `./data` | Where `json.sqlite` and `qadata.json` are stored (use the volume) |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn` or `error` |
| `DISABLED_FEATURES` | no | - | Comma list of features to switch off, e.g. `voice-log,dm-log` |
| `MESSAGE_CACHE_SIZE` | no | `50` | Messages cached per channel |
| `DB_FLUSH_MS` | no | `10000` | How often database changes are saved |

Feature names: `presence, commands, members, filters, message-log, voice-log, dm-log, tickets, applications, vanity-guard, timers, isdatamod, autoreact`.

## `#` commands
Type `#help` in Discord. Members only see the commands they are allowed to use. `#help <command>` shows usage.

| Category | Commands |
|---|---|
| General | `help`, `avatar`, `banner`, `userinfo`, `serverinfo`, `afk`, `where`, `link`, `perms` |
| Moderation | `warn`, `warnings`, `mute`, `unmute`, `vmute`, `unvmute`, `jail`, `unjail`, `ban`, `tempban`, `unban`, `baninfo`, `banlist`, `record`, `clearrecord`, `vckick`, `clear`, `snipe`, `lock`, `unlock` |
| Staff | `poll`, `filter`, `linkfilter`, `roleinfo`, `staffcheck`, `staffcall`, `temprole`, `addroleall`, `removeroleall`, `dmrole`, `dm`, `testwelcome`, `reboot` |
| Support | `ticketpanel`, `livesupport`, `apply`, `applications`, `applyban` |

Durations use `10m`, `2h`, `7d` and so on. Mutes, temporary roles and temporary bans are saved, so they still end on time after a restart.

## Islamic content filter
This runs automatically on new and edited messages. Admins and members with **Manage Messages** are not affected.
* **Inappropriate words**: English, Bangla (Latin and Bengali script), Hindi and Turkish profanity, sexual words and slurs. It also catches simple tricks like `sh1t` or `fuuuck`. Switch it with `#filter on|off`. It is on by default.
* **Nicknames** with inappropriate words are changed to a Muslim name from `isdatamod.randomNicknames`.
* **Invites to other servers** are always removed. Your own invite link is allowed.
* **Adult, gambling and IP-grabber/scam sites** are always removed.
* **All links**: `#linkfilter on|off` (off by default, or set `filter.blockAllLinks` in `config.json`).

Removed messages are logged in `logs.messagelog`. To change the lists, edit `src/content/filter-words.json`.

## Configuration (`config.json`)
| Section | Keys |
|---|---|
| `bot` | `owner`, `prefix`, `name` (embed footer), `BotStatus`, `presenceStatus`, `guildVanityURL`, `footer` (welcome DM footer), `iltifatsize` (messages between Islamic reminders) |
| `roles.staff` | General staff role (staffcheck, staffcall, snipe and every moderation command) |
| `penals` | `staff` role, `log` channel and hourly `limit` for `ban`, `jail`, `mute` (`roles` = mute role, `vmuterole`) and `warn` |
| `logs` | `messagelog` (deleted and filtered messages), `voicelog` |
| `channels` | `chat` (reminders), `rules`, `selfRolesChannel`, `botdmlog`, `urlguardlog` |
| `filter` | `blockAllLinks` |
| `tickets.supportRole` | Role that can see tickets |
| `applications` | `category`, `logChannel` (where applications arrive), `resultChannel`, `approvedRole`, `managerRole` |
| `welcomeDm`, `isdatamod`, `autoreact` | Same as before (unchanged) |

## Project layout
```
index.js                 start-up, Discord client (only the needed intents, no full member cache)
config.json              server IDs and switches
src/core/                logger, env, storage, event bus, command loader, ui (embed style), timers, tickets, afk
src/commands/            general.js, moderation.js, staff.js, support.js
src/features/            one file per background feature (isdatamod.js and autoreact.js unchanged)
src/content/             reminders.json (unchanged), filter-words.json
packages/quick.db/       local, cached quick.db-compatible store (SQLite)
data/seed/               first-run data: penalty records + Q&A database
test/                    offline tests (npm test)
```
To add a command, add an object `{ name, aliases, usage, description, perm?, roles?, run(ctx) }` to one of the files in `src/commands/`.
