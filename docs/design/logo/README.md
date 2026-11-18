# Logo

Decision (Volodymyr, 2026-11-18): the **round** variant is the base logo.

- `logo-round.svg`: the author's handwritten wordmark (`config/tenants/assets/faden-und-stimmung/wordmark.svg`,
  unchanged) inside an unfinished red seam (`#b3362b`, site thread colour) on a circle, like an
  embroidery hoop. The seam stops; the thread runs to the eye of the needle (same needle as the
  site seam animation); the rest of the circle is a faint chalk line: work in progress.
- `logo-round-small.svg`: same, wordmark thickened for avatar sizes (readable at 110 px, not at 64 px).
- `draft-square.svg`: rejected square draft (the dashed rectangle reads as a "cut here" coupon line).
- Colours: paper `#e3ddcd`, ink `#283442`, thread `#b3362b` (tenant theme).
- `make.py` regenerates the drafts from the wordmark: `python3 docs/design/logo/make.py <out-dir>`
  from the repo root.

Open: hand-made (uneven, slightly slanted) stitches instead of even machine dashes; export sizes for
Instagram/Telegram avatars and the site; a separate small mark for the favicon (the text does not
read at favicon size).

## Reel end card (T69)

`endcard.py` renders `apps/reel/assets/endcard-{portrait,landscape}.svg` from `logo-round-small.svg`
and the site display font Gabriela (OFL, text converted to paths): the round logo, "Folge uns"
(German only, Volodymyr 2026-11-18) and a red stitched arrow pointing down-left to where the
Instagram/Facebook Reels Follow button sits, kept above the bottom ~380 px that Reels covers.
Run `python3 docs/design/logo/endcard.py <out-dir>` from the repo root, then render the SVGs to PNG
(sharp) into `apps/reel/assets/`.
