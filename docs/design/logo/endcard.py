import sys, re
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
OUT=sys.argv[1]
PAPER='#e3ddcd'; THREAD='#b3362b'
font=TTFont('node_modules/.pnpm/@fontsource+gabriela@5.3.0/node_modules/@fontsource/gabriela/files/gabriela-latin-400-normal.woff')
gs=font.getGlyphSet(); cmap=font.getBestCmap(); upm=font['head'].unitsPerEm
def text_path(s, size):
    pen=SVGPathPen(gs); x=0; sc=size/upm
    for ch in s:
        g=cmap[ord(ch)]
        tp=TransformPen(pen,(sc,0,0,-sc,x*sc,0)); gs[g].draw(tp); x+=gs[g].width
    return pen.getCommands(), x*sc
logo=open('docs/design/logo/logo-round-small.svg').read()
logo_inner=logo[logo.index('>')+1:logo.rindex('</svg>')]
def card(W,H,lx,ly,ls,tx,ty,tsize,arrow):
    d,tw=text_path('Folge uns',tsize)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">
<defs><clipPath id="c"><circle cx="500" cy="500" r="500"/></clipPath></defs>
<svg x="{lx}" y="{ly}" width="{ls}" height="{ls}" viewBox="0 0 1000 1000"><g clip-path="url(#c)">{logo_inner}</g></svg>
<g transform="translate({tx-tw/2:.1f} {ty})"><path d="{d}" fill="{PAPER}" stroke="#1b232c" stroke-opacity="0.55" stroke-width="10" paint-order="stroke"/></g>
<path d="{arrow[0]}" fill="none" stroke="{THREAD}" stroke-width="14" stroke-dasharray="34 18" stroke-linecap="round"/>
<path d="{arrow[1]}" fill="none" stroke="{THREAD}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
</svg>'''
# portrait 1080x1920: IG Reels hides ~bottom 380 px (username/Follow at bottom-left) and a right column
p=card(1080,1920, 250,330,580, 540,1080,150,
  ("M 640 1190 C 640 1330 470 1380 330 1470 C 260 1515 225 1545 205 1585",
   "M 168 1525 L 200 1595 L 272 1572"))
l=card(1920,1080, 180,190,620, 1300,520,170,
  ("M 1300 640 C 1300 760 1050 820 820 900 C 720 935 650 960 610 990",
   "M 600 925 L 600 995 L 672 1000"))
open(f'{OUT}/endcard-portrait.svg','w').write(p); open(f'{OUT}/endcard-landscape.svg','w').write(l)
