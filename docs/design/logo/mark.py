"""Small round mark (no text) for the favicon and the site header.

The round logo without the wordmark: a paper disc, the unfinished red seam with fewer, thicker
stitches (readable at 16-32 px), the faint chalk gap and the needle at the end of the seam.
Run from the repo root: python3 docs/design/logo/mark.py <out.svg>
"""
import math, sys

INK = '#283442'; PAPER = '#e3ddcd'; THREAD = '#b3362b'; NEEDLE = '#59616d'
cx = cy = 32; R = 22
a0 = math.radians(-60); a1 = math.radians(-60 + 300)
p = lambda a, r=R: (cx + r * math.cos(a), cy + r * math.sin(a))
x0, y0 = p(a0); x1, y1 = p(a1)
# 300 degrees of seam, split into 9 stitches with round caps.
arc = R * math.radians(300); n = 8; W = 5; gap = 2.2; dash = arc / n - gap - W  # caps add W
ae = a1 + math.radians(9); ex, ey = p(ae)
tang = math.degrees(ae) + 90
# needle: eye at (ex, ey), tip along the tangent
tx, ty = ex + 14 * math.cos(math.radians(tang)), ey + 14 * math.sin(math.radians(tang))
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<circle cx="32" cy="32" r="31" fill="{PAPER}"/>
<path d="M {x1:.2f} {y1:.2f} A {R} {R} 0 0 1 {x0:.2f} {y0:.2f}" fill="none" stroke="{INK}" stroke-opacity="0.35" stroke-width="1.2" stroke-dasharray="1 2.4"/>
<path d="M {x0:.2f} {y0:.2f} A {R} {R} 0 1 1 {x1:.2f} {y1:.2f}" fill="none" stroke="{THREAD}" stroke-width="{W}" stroke-dasharray="{dash:.2f} {gap + W:.2f}" stroke-linecap="round"/>
<path d="M {x1:.2f} {y1:.2f} Q {(x1 + ex) / 2:.2f} {min(y1, ey) - 6:.2f} {ex:.2f} {ey:.2f}" fill="none" stroke="{THREAD}" stroke-width="2.2" stroke-linecap="round"/>
<path d="M {ex:.2f} {ey:.2f} L {tx:.2f} {ty:.2f}" stroke="{NEEDLE}" stroke-width="2.6" stroke-linecap="round"/>
<circle cx="{ex:.2f}" cy="{ey:.2f}" r="0.7" fill="{PAPER}"/>
</svg>
'''
open(sys.argv[1], 'w').write(svg)
