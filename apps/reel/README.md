# Local process reels

Requires Node 22.23.4+ and system `ffmpeg` / `ffprobe` with H.264/AAC encoders.
No install, network, AI, bot access or runtime npm dependencies are needed.

1. Record the work on the phone, showing items and hands without identifiable faces.
2. Transfer the original via Saved Messages (within its upload limits) or cable to the computer.
3. From the repository root run:

   ```sh
   pnpm reel /path/to/recording.mp4 --length 30 --finale 59:20 --audio-from 12:10
   ```

4. Watch and listen to the output, then send it to the bot through `/work` as usual.
   The raw recording stays on your computer. The existing people confirmation still applies.

Default output is `<input>-reel.mp4` beside the source. `--out <file>` chooses another path;
existing files require `--force`. The input and music files cannot be output paths.
`--length <seconds>` defaults to 30, maximum 55. The source must be at least that long,
and enough active footage must remain. `--finale <mm:ss>` appends three seconds at normal
speed (two seconds if only two remain). Omit it for a reel without a finale.
By default, a 2.5-second end card follows the body and finale: the last frame is frozen,
blurred and darkened, with the logo, “Folge uns” and downward arrow fading in over 0.3 seconds.
The matching portrait or landscape artwork is scaled to the full output resolution.
Total duration is `--length` + 2.5 seconds; the size budget and limits include the card.
Recording sound loops under the card (or music continues), fading out over the last second.
Use `--no-endcard` to retain the previous output and duration without a card.
Both time options also accept `h:mm:ss` for recordings lasting hours.
`--audio-from <mm:ss>` selects normal-speed recording sound; otherwise the longest
non-silent stretch is selected. Short sound stretches loop, with fades and loudness normalization (I=-16 LUFS, TP=-1.5 dBTP, LRA=11).
The finale retains its own sound. Silent videos receive a silent audio track.

Only overlapping stillness and silence lasting at least four seconds are removed.
Active footage is accelerated evenly. Output is H.264/AAC, 30 fps, 1080 px short side (aspect ratio preserved, never upscaled),
with source metadata removed (MP4 technical/container tags remain), AAC 128k and a bitrate
budget of 19 MB. A failed size/duration check retries once at 720 px, then reports an error;
output must be at most 20 MB and 60 seconds. Temporary files are removed after success/failure.

Optional licensed music: `--music /path/to/music.wav --music-volume 0.2` mixes underneath;
`--music-only` replaces recording sound, including the finale. Volume must be 0..1.
Music loops to fill the reel. You are responsible for music rights and people's consent:
the tool cannot distinguish machine sound from voices, radio or TV. Listen before sending.

Checks: `pnpm --filter @handmake/reel test --maxWorkers=2` and
`pnpm --filter @handmake/reel typecheck`. The integration test generates its own short clip
and skips with a message if system ffmpeg/ffprobe are unavailable.

## Watch a folder

Copy an MP4 or MOV by hand from the phone transfer folder (`~/Desktop/temp/videos`)
into `~/Desktop/Ролики`. The watcher scans the inbox every 10 seconds, oldest stable
video first. It ignores other file types and subfolders. It saves the reel in
`~/Desktop/Готові рілси` as `<stem>-reel.mp4`, adding `-2`, `-3`, and so on when
needed. After rendering and logging the music credit, it sends the inbox copy to the
desktop Trash with `gio trash`. If Trash is unavailable, it moves the copy into
`Ролики/оброблені/`. The phone transfer folder stays untouched.

Run from the repository root to start the inbox watcher manually.

```sh
pnpm reel:watch ~/Desktop/Ролики --out-dir "$HOME/Desktop/Готові рілси" \
  --trash-source --music-dir ~/Music/рілси
```

A bare `pnpm reel:watch <dir>` keeps the source and writes the reel beside it.
With a separate output folder and no `--trash-source`, retained sources can render
again after a restart. Use `--interval <seconds>` to change the scan interval.

The body is 30 seconds or the source duration rounded down, with a 2.5-second end card.
Sources shorter than five seconds fail. Watch and listen to each reel before sending it.

Files must be unchanged across consecutive scans and closed according to `fuser`.
If `fuser` is unavailable, the watcher waits for 60 seconds of observed stability.
The watcher waits for a missing folder and resumes when it reappears. Locks and
temporary files live under `$XDG_RUNTIME_DIR/handmake-reel/`, or under
`~/.local/state/handmake-reel/` if the runtime directory is unset.

To start the watcher automatically with your user session, create the video folder
and install the systemd user unit from the repository root.

```sh
mkdir -p ~/Desktop/Ролики ~/.config/systemd/user
cp apps/reel/systemd/handmake-reel-watch.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable handmake-reel-watch
systemctl --user restart handmake-reel-watch
journalctl --user -u handmake-reel-watch
```

If the input cannot be read by `ffprobe`, the watcher retries on later scans and
records the failure only after the source has stayed unchanged and closed for ten
minutes. Without `fuser`, it can only check that the source stays unchanged.
Read `<name>.reel-error.txt` for the reason a file failed. Fix the cause and delete the
error file to retry. For a finale, `--audio-from`, or music, run `pnpm reel` manually.

### Music library

Keep verified CC0 tracks in the top level of `~/Music/рілси/` as MP3, M4A, OGG,
FLAC or WAV. Add one row per track to the UTF-8 `ліцензії.csv` with this header.

```csv
file,title,creator,license,license_url,source,page,downloaded,verified_on_page
```

Use the exact filename, the track title and creator, a CC0 license label (for example,
`CC0 1.0`), and the track's source page. Quote fields containing commas, quotes or
newlines, doubling any quotes inside them. Tracks without a complete CC0 entry are
skipped. An empty eligible library produces an error beside the source.

Music replaces the recording sound throughout the reel and loops under the end card.
The watcher picks each track once per round and avoids repeating the last track at
a round boundary when at least two tracks are available. It saves rotation in
`~/.local/state/handmake-reel/music-rotation.json` and appends the license evidence to
`~/.local/state/handmake-reel/music-log.csv` (date, input, output, track, title, creator,
license and page). The desktop notification includes the track title.

## Clean folders after work enters the queue

The user timer runs every five minutes. The oneshot service reads
`~/.config/handmake-reel/cleanup.env` (mode `600`). Set `REEL_HANDOFF_BOT_URL` to the
bot's HTTPS base URL (the publish callback URL without `/callbacks/published`) and
`REEL_HANDOFF_SECRET` to the shared secret provisioned for the bot.

```sh
mkdir -p ~/.config/systemd/user
cp apps/reel/systemd/handmake-reel-cleanup.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now handmake-reel-cleanup.timer
journalctl --user -u handmake-reel-cleanup.service
```

The service launches from `~/VS_Code_projects/handmake`. To run a single check with
the same configuration, use `systemctl --user start handmake-reel-cleanup.service`.

Each run asks the bot for queue hand-offs in one signed request. Each hand-off is a cutoff:
top-level visible regular files in both folders whose filesystem change time (`ctime`) is
strictly earlier go to the desktop Trash with `gio trash`. An inbox video stays until
its matching reel exists in the output folder or its `.reel-error.txt` exists in the inbox.
Files held open only by `xdg-document-portal` can be moved. Other open files and files
whose holders cannot be checked are retried for up to 24 hours, then logged and left.
If files move, the service sends one desktop notification with the total.

At startup, cleanup checks both folders. It recreates missing folders and their parents
with mode `0755` (subject to the service's umask) and logs each recreation. If either
folder path is a symlink or another non-directory entry, cleanup logs the error and
trashes nothing. Every trashed file must have one of the configured folders as its exact
parent. Subfolders and symlinks inside either folder stay in place.

The cursor and pending retries live in `~/.local/state/handmake-reel/cleanup.json`.
The first run and migration from the publication-based state establish a baseline at
the current time without moving files. A failed request leaves the cursor intact and
moves no files.
