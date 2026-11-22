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

Run `pnpm reel:watch ~/Desktop/temp/videos` from the repository root to scan the folder
every 10 seconds. The watcher processes stable MP4 and MOV files, oldest first, and
saves `<name>-reel.mp4` beside each source, using its name without the extension.
The body is 30 seconds or the source duration rounded down, with a 2.5-second end card.
Sources shorter than five seconds fail. Watch and listen to each reel before sending it.

To start the watcher automatically with your user session, create the video folder
and install the systemd user unit from the repository root.

```sh
mkdir -p ~/Desktop/temp/videos ~/.config/systemd/user
cp apps/reel/systemd/handmake-reel-watch.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now handmake-reel-watch
journalctl --user -u handmake-reel-watch
```

Read `<name>.reel-error.txt` for the reason a file failed. Fix the cause and delete the
error file to retry. For a finale, `--audio-from`, or music, run `pnpm reel` manually.
