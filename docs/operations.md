# Operations

Commands below run from the repository root unless stated otherwise. This runbook describes
an isolated Telegram test installation first; optional networks, public site and AI shows have
separate rollout requirements. It does not authorize production changes.

## Deploy a test installation from scratch

### 1. Prepare isolated accounts and source

Use Node 22 and pnpm 12.14.0, a GitHub account/repository with Actions, a Cloudflare account
with Workers, D1 and R2, a new Telegram bot, a private test channel and an Anthropic API key.
Add the new bot as a test-channel administrator with permission to post; start a private chat
with it as both author and operator so notifications are deliverable. Obtain your own numeric
Telegram user/chat IDs and the private channel ID; never commit them.

Create your own repository from this source and clone it. Do not point a test installation at
the production repository, bot, channel, database or bucket. The Worker fetches tenant config
from unauthenticated raw GitHub URLs on `main`, so this implementation requires public config
in that repository. Inspect copied content before making it public; use synthetic test content.
Keep only your own branding and the existing project branding you are authorized to use.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm --filter @handmake/publisher exec tsx src/cli.ts --dry-run "$PWD/fixtures/sample-payload.json" --root "$PWD"
```

Populate `.env` locally without printing its values. Tools do not automatically load that file;
export only the variables each command needs using your local secret-loading method. Disable
shell tracing and avoid tokens in command arguments, screenshots and saved terminal output.

For the smallest installation, retain the `faden-und-stimmung` tenant ID in your isolated copy
so the sample payload works. In `config/tenants/faden-und-stimmung.yaml`, retain only the
`telegram` channel, set `featureFlags.wotwPoll: false` and `canonicalLinks: false`, and remove
`shows`, `entryNamePolicy` and `site`. Keep the required `workOfWeek` and `announcements`
blocks even with polls disabled; use synthetic announcement templates in your copy. Scheduled
announcements create drafts for review, not automatic channel posts. Keep the meeting schedule,
languages, content store, feature flags and empty offerings. Retain the `ai`
budget/translation configuration and review its model, estimated prices and spending limits
before a translation call. These are configuration changes in your copy, not production edits.
Commit and push your test config to its `main` before starting the bot.

Disable the copied **Refresh Threads token** workflow in repository Actions settings. Do not
run **Generate and mark show** or **Site** for this minimal installation. The Publish workflow calls
Site after delivery; without site configuration/legal secrets that downstream job will fail.
This does not undo Telegram publication. See the optional-site section before enabling it.

### 2. Provision private state and configure the Worker

In `apps/bot/wrangler.toml`, choose a unique Worker `name`; change `GITHUB_REPO` to your
`owner/repo` and set `PUBLISH_LIVE = "false"`. Replace the copied D1 database name/ID and R2
bucket name with resources created in your own account. Keep bindings `DB` and `SHOW_MEDIA`,
and `migrations_dir = "migrations"` unchanged. Provisioning an empty private bucket satisfies
the existing Worker configuration; leaving show secrets unset keeps generation disabled.

```sh
pnpm -C apps/bot exec wrangler login
pnpm -C apps/bot exec wrangler d1 create faden-test-bot
pnpm -C apps/bot exec wrangler r2 bucket create faden-test-media
# After replacing database_name/database_id and bucket_name in wrangler.toml:
pnpm -C apps/bot run db:migrate
```

`db:migrate` applies every pending migration through the `DB` binding, including usage metrics.
For production, migration changes require Volodymyr's approval before application.

### 3. Install secrets and callback routing

Use the GitHub repository Settings → Secrets and variables → Actions and interactive
`wrangler secret put` prompts. Names below are exact; values never belong in YAML.

| Name | Worker secret | GitHub Actions secret |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Yes | Yes, same new bot |
| `TELEGRAM_WEBHOOK_SECRET` | Yes, random Telegram-compatible secret | No |
| `TELEGRAM_ALLOWED_USER_IDS` | Yes, JSON mapping your user IDs to `faden-und-stimmung` | No |
| `ANTHROPIC_API_KEY` | Yes | No |
| `GITHUB_DISPATCH_TOKEN` | Yes | No |
| `PUBLISH_CALLBACK_SECRET` | Yes, independent random key | Yes, identical value |
| `TELEGRAM_TEST_CHANNEL_ID` | No | Yes, private test channel |
| `AUTHOR_CHAT_ID`, `OPERATOR_CHAT_ID` | No | Yes, private chats started above |

The dispatch token is fine-grained, scoped only to your repository with Contents read/write.
The Actions `GITHUB_TOKEN` also needs permission to push `content/` commits; repository rules
must permit that bot identity. Do not broaden the dispatch token to account-wide access.
For the allow-list, the JSON shape is `{"<your-numeric-user-id>":"faden-und-stimmung"}`.
Add both author and operator user IDs if different. `/stats` uses this same allow-list.

```sh
pnpm -C apps/bot exec wrangler secret put TELEGRAM_BOT_TOKEN
pnpm -C apps/bot exec wrangler secret put TELEGRAM_WEBHOOK_SECRET
pnpm -C apps/bot exec wrangler secret put TELEGRAM_ALLOWED_USER_IDS
pnpm -C apps/bot exec wrangler secret put ANTHROPIC_API_KEY
pnpm -C apps/bot exec wrangler secret put GITHUB_DISPATCH_TOKEN
pnpm -C apps/bot exec wrangler secret put PUBLISH_CALLBACK_SECRET
pnpm -C apps/bot run deploy
```

Set repository **variable** `PUBLISH_CALLBACK_URL` to the full callback URL, such as
`https://faden-test-bot.<account>.workers.dev/callbacks/published`. The publisher uses it verbatim.
Export the new bot token and webhook secret locally, then register the root Worker URL:

```sh
pnpm -C apps/bot run webhook:set https://faden-test-bot.<account>.workers.dev
```

Replace the example URL before running. `webhook:set` requires that URL argument and the two
environment variables; it prints only the registered URL. A bot has one webhook: sharing a
production token would redirect production traffic.

### 4. Verify the test flow

Send synthetic Ukrainian text and photos of handmade items to the new bot, then `/done`.
Translation makes a paid API request; review the preview and confirm consent before publishing.
Observe the Publish run in your repository, the private-channel album/German reply, and the
publication notification. Check `content/ledger/<draftId>.json` and the generated content commit.
Test content is committed publicly even though the channel is private; use no private text,
identifiable faces or participant data. Check a non-allow-listed account cannot create drafts.

Rerun the successful publish job with the same payload and draft ID: saved remote IDs should
stay unchanged. Check `/stats` and `/cost` from the allowed private chat. Site failure in this
minimal setup is expected; inspect the publish job and callback separately. Record results for
independent review; do not infer a successful deployment from a dry run alone.

### Optional public site, networks and shows

For a site, restore and adapt `site:` with your own HTTPS `baseUrl`, profiles and bundled fonts;
remove the copied newsletter action, group links and author-specific text unless intended.
Create your own Pages project with `wrangler pages project create <your-project>` (run via
`pnpm -C apps/bot exec`). Adapt the fixed project name in your copy of
[site.yml](../.github/workflows/site.yml). That workflow currently enables indexing explicitly;
set `SITE_INDEXABLE: 'false'` until approval. Set GitHub Secrets `CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_API_TOKEN` with Pages deployment permissions, and the four `IMPRESSUM_*` fields
from [.env.example](../.env.example). These fields become public in generated HTML.
A public German site needs reviewed Impressum and privacy information; generated legal text
is a starting point, not legal advice or final approval. Obtain Volodymyr's and the author's
approval before publishing their personal details or enabling indexing.

Validate with `pnpm --filter @handmake/site build` and run Site manually on `main` after setup.
Test posts remain site-excluded, so an empty blog is expected. Add live credentials and change
`PUBLISH_LIVE` only for an explicitly authorized live rollout.

Network credentials, scopes and recovery: [Instagram](instagram-runbook.md),
[Facebook](facebook-runbook.md), [Threads](threads-runbook.md). Channels are enabled by config
key presence; omit optional keys until their own accounts and credentials are ready.
Shows need private media, a separate HMAC key, approved models and billing:
[deployment](show-deployment.md), [recovery](show-recovery.md), [copies](show-copies.md).
Do not enable participant intake, contest names or comment collection as part of this test.

## Failure and recovery

| Symptom | Check and recovery |
| --- | --- |
| API unavailable, rate limit or revoked credential | Read the failed job and operator alert. Restore the service/credential; preserve draft ID and ledger, then retry after checking delivery ambiguity below. Network-specific refresh procedures are in the linked runbooks. |
| Telegram succeeded, later channel failed | Inspect channel status and operation remote IDs in the ledger on `main`. The publisher stops at the failed channel; rerun with the original payload to skip saved operations and continue. Never generate a new draft ID to retry. |
| Publish job succeeded but preview remains publishing | Check callback URL and identical HMAC secrets. A callback failure alerts the operator without failing publication. Rerun the publish job after repair: saved deliveries are skipped and the callback is sent again. |
| Content push failed after delivery | Preserve the run/commit evidence. Compare destination messages and latest remote ledger before retrying. Restore missing progress from evidence; do not blindly rerun from stale state. Escalate non-trivial reconciliation to the operator. |
| Remote request timed out after possible acceptance | Inspect the destination first. External APIs and Git do not share a transaction; acceptance before a lost response/ledger write can duplicate on retry. Reconcile known remote IDs before resuming. Never delete the ledger to unblock a run. |
| Site build/deploy failed | Channel publication remains valid. Repair site configuration/legal secrets or deployment permission and rerun Site on `main`; it reads current content. No need to republish the post. |
| Worker does not respond | Check webhook registration, Cloudflare logs and pending Telegram updates using a secure local client. Run `pnpm -C apps/bot exec wrangler tail`; do not paste raw provider responses or credentials into issues. Verify D1 migrations and allow-list configuration. |
| Config fetch failed | Worker config is public raw GitHub YAML on `main`, cached for five minutes; failed refresh can use the previous cache. Fix access/schema errors. A cold Worker has no cached fallback. |

Use Actions → Publish on **main** for manual recovery with the original payload JSON and the
same live/test selection as the initial run. Do not change approved text, channels or mode while
resuming an existing delivery. Manual payload schema: [payload.ts](../apps/publisher/src/payload.ts).
Re-running an old workflow uses its original event revision; if pushed ledger progress is newer
than that revision, prefer a new manual dispatch on current `main` after reconciliation.
Keep payloads and logs out of public issues when they contain private material.

## Security boundaries and routine operations

- Telegram webhook authentication precedes allow-list parsing; unknown senders do not acquire
  participant records. The allow-list identifies author/operators, not circle participants.
- Publication callbacks use a dedicated HMAC key. Show transport and private contest names use
  separate keys; none is interchangeable with the webhook secret.
- Public Git content includes approved text and processed photos; private drafts are in D1 and
  show inputs in private R2. Photo processing strips metadata. Consent still governs visible faces.
- Daily cron cleans old drafts; contest/comment features have their own retention rules. Usage
  tables store tenant/draft IDs, counters, outcomes and times, not text, photos or participant IDs.
  See [usage metrics](usage-metrics.md) for the 28-day report and interpretation limits.
- Rotate a bot token in both GitHub and Worker secrets, update local `.env`, then register its
  webhook again. Rotate callback keys on both sides together. Replace the dispatch/API keys at
  their consumers and revoke old keys after verification. Never print token exchange responses.
- Before a bot upgrade, review migrations/config/secrets, apply approved migrations first, deploy
  from clean `main` with `pnpm -C apps/bot run deploy`, and record the Worker version. Publisher
  code needs no service deploy: Actions reads source from the selected revision.
- Git preserves approved content and ledger history, not private D1/R2 state. Arrange private
  backups and verify restore procedures before relying on those stores; a Git clone is not a
  database backup. No database restore or destructive rollback is authorized by this runbook.

## Review evidence

T34 checks Markdown targets, formatting, the no-credential sample dry run, and command/config
agreement with the current source. No remote resources, publishing, migrations or paid API calls
are created during documentation work. Acceptance still requires an independent developer to
follow the test-installation instructions and record the outcome; a source review alone does
not satisfy that deployment check.
