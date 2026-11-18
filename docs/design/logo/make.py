import sys, math
S=sys.argv[1]
w=open('config/tenants/assets/faden-und-stimmung/wordmark.svg').read()
inner=w[w.index('>')+1:w.rindex('</svg>')]
INK='#283442'; PAPER='#e3ddcd'; THREAD='#b3362b'; GROUND='#27313c'
def needle(x,y,angle,scale,paper):
    # needle eye at (x,y), tip direction = angle (deg, 0 = right)
    return f'''<g transform="translate({x} {y}) rotate({angle-90}) scale({scale}) translate(-11 -21)">
  <path d="M11 14 C14.2 14 14.6 20 14 30 L11.6 90 L11 92 L10.4 90 L8 30 C7.4 20 7.8 14 11 14 Z" fill="#59616d"/>
  <path d="M10 26 L10.7 86" stroke="#c9d0d6" stroke-width="1" stroke-linecap="round"/>
  <ellipse cx="11" cy="21" rx="1.3" ry="4" fill="{paper}"/></g>'''
def square(bg,ink):
    L,T,R,B,r=70,70,930,930,80
    end=470; start=880  # sewn: from start clockwise round to end; unsewn chalk end..start
    seam=(f"M {start} {T} Q {R} {T} {R} {T+r-30} L {R} {B-r} Q {R} {B} {R-r} {B} L {L+r} {B} "
          f"Q {L} {B} {L} {B-r} L {L} {T+r} Q {L} {T} {L+r} {T} L {end} {T}")
    eye=end+40
    thread=f'<path d="M {end} {T} C {end-10} {T-70} {eye+30} {T-75} {eye} {T}" fill="none" stroke="{THREAD}" stroke-width="7" stroke-linecap="round"/>'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">
<rect width="1000" height="1000" fill="{bg}"/>
<path d="M {end} {T} L {start} {T}" stroke="{ink}" stroke-opacity="0.3" stroke-width="3" stroke-dasharray="3 11" stroke-linecap="round"/>
<path d="{seam}" fill="none" stroke="{THREAD}" stroke-width="11" stroke-dasharray="30 17" stroke-linecap="round"/>
{thread}{needle(eye,T,0,3.0,bg)}
<svg x="115" y="165" width="780" height="680" viewBox="0 0 1890 1581" color="{ink}">{inner}</svg>
</svg>'''
def avatar(bg,ink,bold=0):
    cx=cy=500; R=410
    a0=math.radians(-60); a1=math.radians(-60+300)  # sewn 300 degrees clockwise (svg y down)
    p=lambda a:(cx+R*math.cos(a), cy+R*math.sin(a))
    x0,y0=p(a0); x1,y1=p(a1)
    seam=f"M {x0:.1f} {y0:.1f} A {R} {R} 0 1 1 {x1:.1f} {y1:.1f}"
    chalk=f"M {x1:.1f} {y1:.1f} A {R} {R} 0 0 1 {x0:.1f} {y0:.1f}"
    ae=a1+math.radians(5); ex,ey=p(ae)
    tang=math.degrees(ae)+90
    thread=f'<path d="M {x1:.1f} {y1:.1f} C {x1-40:.1f} {y1-60:.1f} {ex+10:.1f} {ey-80:.1f} {ex:.1f} {ey:.1f}" fill="none" stroke="{THREAD}" stroke-width="8" stroke-linecap="round"/>'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">
<rect width="1000" height="1000" fill="{bg}"/>
<path d="{chalk}" fill="none" stroke="{ink}" stroke-opacity="0.3" stroke-width="3" stroke-dasharray="3 11"/>
<path d="{seam}" fill="none" stroke="{THREAD}" stroke-width="13" stroke-dasharray="34 18" stroke-linecap="round"/>
{thread}{needle(ex,ey,tang,2.4,bg)}
<svg x="190" y="205" width="620" height="590" viewBox="0 0 1890 1581" color="{ink}">{inner.replace('stroke="none"', f'stroke="currentColor" stroke-width="{bold}"')}</svg>
</svg>'''
for name,svg in [('square-light',square(PAPER,INK)),('square-dark',square(GROUND,PAPER)),('avatar-light',avatar(PAPER,INK)),('avatar-bold',avatar(PAPER,INK,90))]:
    open(f'{S}/{name}.svg','w').write(svg)
