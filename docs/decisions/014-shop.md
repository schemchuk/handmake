# 014 — Shop: external checkout behind a ShopProvider port, behind a monetization flag

Status: proposed (decided at the start of phase 4) · Date: 2026-10-28

## Context
Spec v5 F28-F29: a shop for the author's own works, later, behind a per-tenant monetization switch.
The country of business registration is not fixed yet (Q12). Taxes and consumer law differ by country;
VAT on cross-border sales is a burden for a one-person shop.

## Options
1. **Merchant of record (Lemon Squeezy, Paddle-like services):** the provider is the legal seller and
   handles VAT and invoices worldwide. Fits an unknown registration country; higher fees. Some do not
   allow physical goods — must be checked.
2. **Stripe Payment Links / Checkout:** cheap and simple; the author is the seller and handles VAT,
   invoices and consumer-law texts herself.
3. **Marketplace (Etsy):** existing traffic and checkout; listing fees, less control, the site only
   links out.
4. Full shop (Shopify): monthly fee, most features, most setup.

## Decision (proposed)
No shop code before phase 4. The architecture only reserves the seams:
- A `work` may carry `sale: { status, price?, checkoutUrl? }` (absent until phase 4).
- A `ShopProvider` port (`listProducts`, `checkoutUrl(work)`), first implementation chosen in phase 4
  between options 1-3 once Q12 is answered; the site renders a shop section and "buy" buttons only when
  the tenant's `monetization` flag is on.
- Participants' works are never products (spec v5 section 9): the content schema rejects `sale` on
  contest entries and results.

## Consequences
- Phase 4 starts with a short legal checklist (spec section 8) and this ADR's decision.
- For resale to bloggers the same port lets each tenant bring its own provider.
