"""Telegram avatars: the vote bot and the chat.

Same round hoop as logo-round.svg (paper, unfinished red seam, chalk gap, needle), with an
embroidered symbol instead of the wordmark and one Ukrainian word in the site font Gabriela
(text converted to paths):
- bot:  a stitched ballot box with a red check mark, "Голосування";
- chat: a stitched speech bubble with three red knots, "Розмови".
Run from the repo root: python3 docs/design/logo/avatars.py <out-dir>
"""
import math, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

OUT = sys.argv[1]
INK = '#283442'; PAPER = '#e3ddcd'; THREAD = '#b3362b'
font = TTFont('node_modules/.pnpm/@fontsource+gabriela@5.3.0/node_modules/@fontsource/gabriela/files/gabriela-cyrillic-400-normal.woff')
gs = font.getGlyphSet(); cmap = font.getBestCmap(); upm = font['head'].unitsPerEm


def text_path(s, size):
    pen = SVGPathPen(gs); x = 0; sc = size / upm
    for ch in s:
        g = cmap[ord(ch)]
        gs[g].draw(TransformPen(pen, (sc, 0, 0, -sc, x * sc, 0))); x += gs[g].width
    return pen.getCommands(), x * sc


def needle(x, y, angle, scale):
    return f'''<g transform="translate({x:.1f} {y:.1f}) rotate({angle - 90:.1f}) scale({scale}) translate(-11 -21)">
  <path d="M11 14 C14.2 14 14.6 20 14 30 L11.6 90 L11 92 L10.4 90 L8 30 C7.4 20 7.8 14 11 14 Z" fill="#59616d"/>
  <path d="M10 26 L10.7 86" stroke="#c9d0d6" stroke-width="1" stroke-linecap="round"/>
  <ellipse cx="11" cy="21" rx="1.3" ry="4" fill="{PAPER}"/></g>'''


def hoop():
    cx = cy = 500; R = 420
    a0 = math.radians(-60); a1 = math.radians(240)
    p = lambda a: (cx + R * math.cos(a), cy + R * math.sin(a))
    x0, y0 = p(a0); x1, y1 = p(a1)
    ae = a1 + math.radians(5); ex, ey = p(ae)
    return f'''<path d="M {x1:.1f} {y1:.1f} A {R} {R} 0 0 1 {x0:.1f} {y0:.1f}" fill="none" stroke="{INK}" stroke-opacity="0.3" stroke-width="3" stroke-dasharray="3 11"/>
<path d="M {x0:.1f} {y0:.1f} A {R} {R} 0 1 1 {x1:.1f} {y1:.1f}" fill="none" stroke="{THREAD}" stroke-width="15" stroke-dasharray="36 18" stroke-linecap="round"/>
<path d="M {x1:.1f} {y1:.1f} C {x1 - 40:.1f} {y1 - 60:.1f} {ex + 10:.1f} {ey - 80:.1f} {ex:.1f} {ey:.1f}" fill="none" stroke="{THREAD}" stroke-width="8" stroke-linecap="round"/>
{needle(ex, ey, math.degrees(ae) + 90, 2.4)}'''


def label(word, y, max_w=500, size=112):
    d, w = text_path(word, size)
    if w > max_w:
        d, w = text_path(word, size * max_w / w)
    return f'<g transform="translate({500 - w / 2:.1f} {y})"><path d="{d}" fill="{INK}"/></g>'


STITCH_INK = f'fill="none" stroke="{INK}" stroke-width="12" stroke-dasharray="30 16" stroke-linecap="round" stroke-linejoin="round"'
STITCH_RED = f'fill="none" stroke="{THREAD}" stroke-width="30" stroke-dasharray="62 22" stroke-linecap="round" stroke-linejoin="round"'


def avatar(symbol, word):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">
<rect width="1000" height="1000" fill="{PAPER}"/>
{hoop()}
{symbol}
{label(word, 770)}
</svg>
'''


ballot = f'''<rect x="330" y="250" width="300" height="300" rx="34" {STITCH_INK}/>
<path d="M 385 405 L 470 495 L 690 225" {STITCH_RED}/>'''

bubble = f'''<path d="M 300 240 L 700 240 Q 750 240 750 290 L 750 490 Q 750 540 700 540 L 430 540 L 340 620 L 350 540 L 300 540 Q 250 540 250 490 L 250 290 Q 250 240 300 240 Z" {STITCH_INK}/>
<circle cx="390" cy="390" r="30" fill="{THREAD}"/><circle cx="500" cy="390" r="30" fill="{THREAD}"/><circle cx="610" cy="390" r="30" fill="{THREAD}"/>'''

open(f'{OUT}/avatar-bot-vote.svg', 'w').write(avatar(ballot, 'Голосування'))
open(f'{OUT}/avatar-chat.svg', 'w').write(avatar(bubble, 'Розмови'))
