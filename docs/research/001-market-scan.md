# 001 — Market scan: similar projects and monetization ideas

Date: 2026-10-21. Author: claude-code. Status: first pass, desk research only.

Purpose: collect ideas worth reusing for the circle now, and options for later commercialization.
This is a quick web scan, not a market study. Figures come from single sources unless noted.

## 1. Local craft circles in Germany (direct analogues)

What exists:
- Free "Strickcafé" / "Nähcafé" / "Handarbeitstreff" formats run by parishes, libraries,
  community centres and associations, typically weekly or bi-weekly, no sign-up
  ([Dortmund](https://www.dortmund.de/newsroom/presse-mitteilungen/haekeln-stricken-und-naehen-im-handarbeitstreff-im-begegnungszentrum-luetgendortmund.html),
  [Demmin](https://www.nordkurier.de/regional/demmin/nahen-verbindet!-demminer-verein-bringt-menschen-zusammen-1141425)).
- Shops with an integrated café and paid courses, e.g. Die Mercerie in Munich
  ([Ravelry](https://www.ravelry.com/shops/die-mercerie)).
- Paid one-off workshops in cafés with materials, drink and cake included
  ([Augsburg example](https://www.regioactive.de/freizeit/haekle-deine-sommertasche-augsburg-cafe-artisanal-2026-07-24-zHnlRhDytV)).
- Charity knitting meetups (items for people experiencing homelessness), which get local press.

Observations:
- Most of these are announced with PDF flyers and parish or city pages. Online presence is weak:
  no channel, no archive of results, no easy way to find the next date.
- Local press covers the topic ("Handarbeit liegt im Trend",
  [Stuttgarter Zeitung](https://www.stuttgarter-zeitung.de/lokales/stuttgart/handarbeit-liegt-im-trend-stricken-tufting-haekeln-diese-workshops-und-treffen-gibt-es-in-stuttgart-79042708.html)).

Ideas to take:
- A clear, always up-to-date "next meeting" block (date, time, what to bring) on every channel.
- A gallery or archive of finished pieces. Our content source gives this for free.
- Downloadable or printable flyer generated from the same data (offline audience matters here).
- Occasional themed or charity projects as a content and press hook.

## 2. Discovery channels for local events

- [nebenan.de](https://www.evangelisch.de/inhalte/149238/25-05-2018/damit-sich-nachbarn-wieder-haeufiger-begegnen):
  neighbourhood network with groups and events, real-name accounts, free.
- Meetup: interest groups and events, broader reach than nebenan.de
  ([overview](https://www.loewenstark.com/wissen/soziale-netzwerke/meetup?pdf=31755)).
- City and VHS event calendars.

Idea to take: an iCal (`.ics`) feed of meetings generated from content, plus manual cross-posting
to nebenan.de / Meetup. Neither offers a convenient public posting API, so automating them is a non-goal for now.

## 3. Online craft schools and paid communities (monetization patterns)

- Makerist (Berlin, 2013): video courses, material kits, e-books, member gallery; acquired by
  Fabfab in 2020 according to [CB Insights](https://www.cbinsights.com/company/makerist) (unverified)
  ([Gründerküche](https://www.gruenderkueche.de/gruendertalk/gruenderstory-makerist-die-handarbeitsschule-im-internet/)).
- Creator memberships on Patreon: monthly pattern and video tutorial, community chat, monthly live
  session, tiered perks
  ([Charm Patterns](https://charmpatterns.com/patreon-membership/), [YumiYarns](https://www.patreon.com/YumiYarns/about)).
  A low entry tier (about $3) is reported to widen who joins
  ([podcast](https://creativesoncamera.buzzsprout.com/2440311/episodes/19065276-creating-a-safe-online-community-for-artists)).
- Local private lessons in Landshut are listed at an average of about 15 €/hour
  ([fixando](https://www.fixando.de/en/hakelkurse/kosten/Bayern/Landshut), aggregator estimate).

Monetization options, from least to most effort:
1. Paid special workshops (materials included) next to the free weekly circle.
2. Material kits for a monthly project, sold locally.
3. Patterns or tutorials (PDF or video) under our own brand.
4. Membership (monthly project + community).
5. The software itself (see section 4).

## 4. Tools: multi-channel publishing (the "product" angle)

- [Postiz](https://railway.com/deploy/postiz): open source (AGPL-3.0) scheduler for 18-30
  platforms including Telegram and Instagram. Self-hosted needs Node, PostgreSQL and at least 1 GB RAM.
  Newer versions depend on Temporal.
- Buffer, Later and similar: paid SaaS, general purpose.

Telegram-bot-as-CMS for static sites, closest to the intake idea:
- [ithilfe/bikes (tblog)](https://github.com/ithilfe/bikes): Telegram messages -> Hugo posts,
  manual approval, GitHub Actions polling, GitHub Pages.
- [Write-up of a Telegram -> MDX -> pull request flow](https://hemachander.is-a.dev/blog/how-this-blog-system-works/)
  with chat-ID allow-list and PR review.
- [docops-bot](https://docops-bot.readthedocs.io/en/latest/): the reverse direction (git -> Telegram channel).
- The Hugo forum found no established solution
  ([thread](https://discourse.gohugo.io/t/telegram-bot-for-hugo-publishing/49073)). The niche is small.

Takeaway: general schedulers are crowded. A narrow product could be
"phone-first intake bot -> reviewed Git content -> Telegram + Instagram + static site" for small
volunteer groups (circles, clubs, parishes). Few polished open-source options exist. This is also a
strong portfolio story.

## 5. Instagram API status

- "Instagram API with Instagram Login" (Meta's naming has shifted to
  "Business Login for Instagram") publishes for Business **and** Creator accounts **without a linked
  Facebook Page**, via `graph.instagram.com`, scope `instagram_business_content_publish`
  ([Meta docs](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login)).
- This removes most of the complexity seen in the lumara project (Pages, System Users, several apps).
  Scope names differ between Meta pages, so check the current reference at build time.

## 6. Flags for Volodymyr (legal / personal data, not legal advice)

- **Commercialization vs. volunteer status:** paid workshops or kit sales may change the tax and
  legal status (e.g. Übungsleiterpauschale 3,300 €/year from 2026 applies to teaching for
  non-profit or public bodies, [minijob-zentrale](https://magazin.minijob-zentrale.de/uebungsleiterpauschale-ehrenamt-2026/);
  otherwise a trade or freelance registration and the Kleinunternehmer rule may apply).
  It may also conflict with the host organization's rules. Needs a tax advisor or the host's answer.
- **Intake bot:** it processes only the wife's own messages if restricted to an allow-list of chat
  IDs. Participant data must never be sent through it in phase 1.
- **Selling online** (kits, memberships) adds payment, consumer-law (Widerruf) and GDPR obligations.

## Open questions for the interview

- Which monetization options (section 3) are realistic for her, and on what horizon?
- Is "product for other groups" (section 4) a goal, or only a portfolio story?
- Should the intake bot run always-on (webhook, needs free hosting such as a serverless worker)
  or poll from GitHub Actions (free, but posts arrive with a 5-15 minute delay)?
