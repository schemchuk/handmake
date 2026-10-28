# 012 — Video: HTML templates rendered to MP4 in a GitHub Actions job, files in R2

Status: proposed (decided at the start of phase 2b) · Date: 2026-10-28

## Context
Spec v5 F20-F21: a short vertical video (about 15-30 s) from a new work of the author, with AI-written
UA/DE captions, previewed and then published to channels with video capability (Telegram video,
Instagram Reels, later Shorts/TikTok). Rendering must be deterministic. A headless browser and FFmpeg
cannot run in a Cloudflare Worker. Videos (5-30 MB) should not be committed to Git. Instagram Reels
publishing needs a public `video_url`.

## Options
Renderer:
1. **HyperFrames** (HeyGen, open source, github.com/heygen-com/hyperframes): HTML/CSS/GSAP →
   deterministic MP4 via headless Chrome + FFmpeg, npm CLI, agent skills for Claude Code. Apache-2.0
   (compatible with resale), Node >= 22 (verified in the v5 review, N8).
2. Remotion: mature React → MP4. Free for individuals and small companies; a paid company licence is
   needed above a size limit, which matters for reselling to bloggers' businesses.
3. FFmpeg slideshow scripts: no browser, cheapest, but weak motion/typography; hard to theme.
4. Generative AI video (Veo, Sora, Runway): not deterministic, costs per second, invents content —
   conflicts with "authentic photos of real works".

Where it runs:
1. **GitHub Actions job (`render-video`)**, triggered by dispatch like publish. Free for a public repo,
   Chrome and FFmpeg available.
2. A container (Cloud Run, Fly.io): more setup, costs, needed only at higher volume.

Storage:
1. **Cloudflare R2** behind a `MediaStore` port: 10 GB free, no egress fees, public URLs for Reels.
2. Git LFS: bandwidth quota and repo bloat.

## Decision (proposed)
HyperFrames templates in `packages/video` (versioned, one template = one look, themed by tenant
config), rendered by a `render-video` Actions job, output stored in R2 via a new `MediaStore` port.
The AI (`TextGenerator` port) writes the caption script; the author previews the rendered file in the
bot (sent as a Telegram video) and publishes it like a post. Channels declare `video` capability;
the ledger records the video op like any other.
The job has its own concurrency group and commits nothing. R2 URLs are unlisted but public; they
only hold published videos.
Before accepting (start of 2b): pin a version, smoke-test render time per video on an Actions runner,
and check upstream activity (some users move to Remotion).

## Consequences
- New ports: `MediaStore`, `VideoRenderer`, `TextGenerator`; new capability `video` on adapters.
- New workflow file (sensitive PR) and R2 secrets.
- Cost stays near 0 € at a few videos per month; AI cost for captions is small.
- EU AI Act transparency for AI-generated media is checked before phase 2b goes live (spec section 7).
