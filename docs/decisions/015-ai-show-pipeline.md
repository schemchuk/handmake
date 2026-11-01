# 015 — AI show pipeline: providers, templates, cost

Status: **accepted** (2026-11-01, after the author approved the test results) · Date: 2026-11-01 · Task: T43 (resolves Q15), input for T44

## Context
A show (F30) is one real work presented by an AI-generated fictional model: 3-5 images and one short
video, every 1-2 weeks. Only real works are shown, so the embroidery in the result must stay the
author's embroidery. Budget (spec round 8): 20 EUR/month target, warn at 20, stop new shows at 25 EUR
(T42 ledger, `assertCanStartShow`).

T43 was closed by Volodymyr on 2026-11-01 without a written report, and he could not recall which
provider the comparison favoured. This ADR therefore does **not** record a past test. It records a
proposal built from public price lists (checked 2026-11-01, secondary sources, not yet confirmed on the
providers' own pages) and states what still has to be verified before T44 relies on it.

## Options
Images (garment on a model, or work in a scene):
1. **Dedicated try-on API (FASHN).** Built for garment-to-person; about 0.075 USD per credit, one credit
   per standard try-on output. Strong on plain garments; embroidery detail and non-garment works
   (pillows, appliqués) are unproven.
2. **General image-edit model with reference images, called through an aggregator (fal.ai).** Handles all
   three templates (worn, close-up, interior) with one adapter; price per image varies by model,
   roughly 0.03-0.17 USD.
3. Cheap try-on endpoints (PiAPI about 0.007, ModelsLab about 0.02 USD per image). Cheapest, quality
   and licence terms unknown; not proposed.

Video (image-to-video, one 5-second clip per show):
1. **Kling 3.0** (via fal.ai): about 0.084 USD/s silent at 720p, so about 0.42 USD per 5 s clip.
2. **Veo 3.1 Lite** (Google): about 0.05 USD/s, about 0.25 USD per 5-6 s clip; always has audio, which
   we would drop.
3. Runway Gen-4.5: about 0.12 USD/s. Dearer, no advantage for this use.

## Decision (proposed)
- **One adapter behind the existing port:** `ShowGenerator` (ADR 007) with a fal.ai implementation for
  both images and video. One API key, one invoice, models switchable by config string without code
  changes. FASHN stays an alternative adapter if the garment tests show fal.ai models distort
  embroidery.
- **Models (tested 2026-11-01, see Test results):** images `fal-ai/nano-banana-2/edit` (Gemini 3.1 Flash
  Image, up to 14 reference images, commercial use stated on fal's model page); video
  `fal-ai/kling-video/v2.5-turbo/pro/image-to-video`, 5 s, silent. Model ids live in tenant config, not
  code. Kling 3.0 stays a candidate once its fal endpoint is tested.
- **Templates** (English prompts; reference inputs are the author's photo of the work plus the model's
  reference image from the tenant `models:` list). Drafts, to be tuned on real results:
  - *worn* (embroidered clothing): "Photograph of {model_look} wearing the garment from the reference
    photo, standing in soft daylight, plain neutral background. The garment, its cut, colours and every
    embroidered motif must be reproduced exactly as in the reference; do not add, remove or restyle any
    embroidery."
  - *closeup* (appliqués, accessories): "Close-up photograph of {model_look} holding or wearing the item
    from the reference photo, shallow depth of field, natural light. The item stays identical to the
    reference."
  - *interior* (pillows, embroideries): "Interior photograph of a bright, calm living space showing the
    item from the reference photo in place (sofa, wall). The item stays identical to the reference."
  - *video*: "Slow, gentle camera movement, the person makes a small natural movement; the garment and
    its embroidery do not change."
- **Marking:** every generated image and video carries the AI label (site: "KI-generiertes Model";
  channel posts: caption line) and C2PA/metadata where the provider supplies it. Real work photos stay
  unmarked.
- **Cost per show (estimate):** 5 images at about 0.10 USD with about 2 attempts each is about 1.0 USD;
  one clip at about 0.42 USD with about 2 attempts is about 0.85 USD. Total about 2 USD per show, so
  2-4 shows a month cost about 4-8 USD, well inside 20 EUR. The T44 `/show` flow books every call to
  the T42 ledger and stops at the cap.
- **Q15 outcome:** provisionally answered by the above. It is closed only after the verification below.

## Test results (2026-11-01)
Run through fal.ai with the author's photos (her consent to send works to providers: Volodymyr, 2026-11-01).
Inputs: blouse 1 (cross-stitch peonies), pillow 1-2 (golden crochet mesh), appliqué 4 and 6 (crochet
flower). Outputs and the side-by-side page stay outside the repo (local review page for the author).
- 7 images (3 worn blouse, 2 pillow interiors, 2 appliqué close-ups) and
  3 five-second videos, one per work, first attempt each; no regeneration was needed to reach usable
  results.
- **Fidelity:** pillow mesh, hooked rings and flower appliqué are reproduced almost exactly. The blouse
  keeps cut, fabric and the pink/green cross-stitch roses; the **arrangement of the motifs shifts slightly**
  between shots (sleeve cuffs and shoulder buds vary). Acceptable for a "show", but the author must judge it;
  the prompt wording "do not rearrange" did not fully prevent it.
- **Video:** the garment, the flower and the pillow stay stable over 5 s; faces drift slightly (fictional
  models, so tolerated; fixed reference images per model, T44, should reduce it).
- **Cost (estimate, to confirm against the fal balance):** images about 0.08 USD each (fal: 10 USD is about 125
  Nano Banana 2 images), videos about 0.35 USD each (Kling 2.5 Turbo Pro, 0.07 USD/s). The whole test cost 1.61 USD (fal balance 10.00 → 8.39 USD, read by Volodymyr).
  Per show: 4 images (about 0.32) + 1 video (about 0.35), about 0.70 USD per attempt, about 1.4 USD with one
  regeneration each.

## Licence and data terms (read 2026-11-01, fal.ai legal pages)
- API Services terms: fal does not use Client Content (our uploaded photos) to train its own products,
  **except for APIs marked "Pending Enterprise Ready" ("Excluded Models")**, to which its security and
  DPA obligations also do not apply. Whether `nano-banana-2/edit` or Kling 2.5 Turbo Pro carry that mark
  is not visible on their model pages (both show "Commercial use"). Check the model pages again before
  the first production show; the underlying model owners (Google, Kuaishou) have their own terms.
- Terms of Service: outputs may not be used to train competing AI models; outputs are provided as-is,
  and the customer carries the risk for them. Our use (own marketing images, AI-labelled) is within this.
- Consequence: keep photos limited to the works themselves (no people, no private data), as now.

## Verification before T44 (status)
1. ~~Consent to send photos~~ given by Volodymyr for the author (2026-11-01); it covers later works too.
   Photos are not committed to the repo.
2. ~~Run each template~~ done (see Test results). Record the real per-call prices from the fal balance.
3. ~~Licence/terms~~ read (section above); the "Excluded Models" mark stays a pre-production check.
4. Prices: fal's own pricing pages gave the video rate; image price is derived from fal's credit table.
   The real per-call cost is read from the fal balance after the first production show and written here.
5. ~~Author approval~~ given 2026-11-01. Prompts used in the test are the ones in this ADR.

## Consequences
- T44 can be built against a mocked `ShowGenerator` now; the real adapter waits for verification.
- If embroidery is distorted by every general model, fall back to FASHN for worn garments and to
  close-up photos of the original for other works (no generated scene).
- Prices change often; the ledger records actual prices per call, and the estimate above is rechecked at
  the first real show.
