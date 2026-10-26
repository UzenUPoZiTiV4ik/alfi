/* Кот Альфи на WebGL без библиотек: SDF и рэймарчинг.
   Mascot.stage(el, {anchor}) — живая сцена, Mascot.img(kind, size) — статичная картинка. */
window.Mascot = (function () {
  'use strict';

  const VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';

  const FS = `
precision highp float;
uniform vec2 uRes;        // размер буфера, px
uniform vec2 uC;          // точка между ступнями, px (от низа-слева)
uniform float uS;         // px на единицу сцены
uniform float uT;         // время, с
uniform vec3 uRot;        // поворот: yaw, pitch, roll
uniform float uSq;        // сжатие-растяжение
uniform float uBg;        // 1 рисовать фон, 0 прозрачный
uniform vec3 uFur;        // цвет винила (линейный)
uniform float uAcc;       // 0 нет, 1 медаль с «А», 2 тёмные очки, 3 круглые очки
uniform float uWave;      // угол поднятой лапки, рад

const float MID=.86;      // центр вращения и ограничивающей сферы (по высоте)
const float BR=1.12;      // радиус ограничивающей сферы

float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*n2(p);p=mat2(1.6,1.2,-1.2,1.6)*p;a*=.5;}return s;}

float smin(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}
float smax(float a,float b,float k){return -smin(-a,-b,k);}
float sdRB(vec3 p,vec3 b,float r){vec3 q=abs(p)-b;return length(max(q,0.))+min(max(q.x,max(q.y,q.z)),0.)-r;}
float sdE(vec3 p,vec3 r){float k0=length(p/r),k1=length(p/(r*r));return k0*(k0-1.)/k1;}
float sdCap(vec3 p,vec3 a,vec3 b,float r){vec3 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*h)-r;}
float sdSeg2(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*h);}
mat2 r2(float a){float c=cos(a),s=sin(a);return mat2(c,s,-s,c);}

// Треугольник: основание на y=0 (±w), вершина в (0,h). Точная SDF (iq)
float tri2(vec2 p,float w,float h){
  p.y=h-p.y;
  vec2 q=vec2(w,h);
  p.x=abs(p.x);
  vec2 a=p-q*clamp(dot(p,q)/dot(q,q),0.,1.);
  vec2 b=p-q*vec2(clamp(p.x/q.x,0.,1.),1.);
  float s=-sign(q.y);
  vec2 d=min(vec2(dot(a,a),s*(p.x*q.y-p.y*q.x)),vec2(dot(b,b),s*(p.y-q.y)));
  return -sqrt(d.x)*sign(d.y);
}

// Логотип «А» в плоскости медали
float logoA(vec2 q){
  float d=sdSeg2(q,vec2(-.30,-.24),vec2(-.07,.40));
  d=min(d,sdSeg2(q,vec2(.30,-.24),vec2(.07,.40)));
  d=min(d,sdSeg2(q,vec2(-.07,.40),vec2(.07,.40)));
  d=min(d,sdSeg2(q,vec2(-.14,-.02),vec2(.14,-.02)));
  d=min(d,sdSeg2(q,vec2(-.30,-.46),vec2(.30,-.46)));
  return d-.075;
}

// ---------- Модель (ступни на y=0, смотрит в +z) ----------
const vec3 HC=vec3(0.,1.17,.02);     // центр головы
const vec3 HR=vec3(.52,.44,.46);     // радиусы головы: меньше и круглее
const vec3 NC=vec3(0.,1.10,.497);    // носик

// уши: гладкий скруглённый конус (две сферы с плавным переходом), сплющенный спереди назад.
// Ни граней, ни рёбер: кончик круглый, серединка – мягкая вмятина
vec3 earP(vec3 q){
  vec3 e=q-vec3(.27,1.44,.0);
  e.xy=r2(.25)*e.xy;
  e.xz=r2(.25)*e.xz;
  return e;
}
float rcone(vec2 q,float r1,float r2,float h){
  q.x=abs(q.x);
  float b=(r1-r2)/h,a=sqrt(1.-b*b);
  float k=dot(q,vec2(-b,a));
  if(k<0.) return length(q)-r1;
  if(k>a*h) return length(q-vec2(0.,h))-r2;
  return dot(q,vec2(a,b))-r1;
}
// внутренняя часть уха в его плоскости
float earIn2(vec2 xy){return rcone(xy-vec2(0.,.055),.095,.035,.14);}
float ear(vec3 q){
  vec3 e=earP(q);
  const float K=2.1;                                   // сплющивание по толщине
  vec2 s=vec2(length(vec2(e.x,e.z*K)),e.y);
  float b=(.16-.055)/.24,a=sqrt(1.-b*b);
  float k=dot(s,vec2(-b,a));
  float d=k<0.?length(s)-.16:(k>a*.24?length(s-vec2(0.,.24))-.055:dot(s,vec2(a,b))-.16);
  d/=K;
  // мягкая вмятина спереди
  d+=.016*smoothstep(.04,-.03,earIn2(e.xy))*smoothstep(-.01,.04,e.z);
  return d;
}
// тёмная серединка уха на передней стороне – только там, где ухо выступает над головой
float earIn(vec3 q,float px){
  vec3 e=earP(q);
  float onEar=sdE(q-HC,HR)-ear(q);                   // >0: мы на ухе, а не на голове
  return smoothstep(px,-px,earIn2(e.xy)+.004)*smoothstep(.0,.03,e.z)*smoothstep(.0,.025,onEar);
}
float head(vec3 p,vec3 q){
  vec3 h=p-HC;
  h.x/=1.+.05*clamp(-h.y/HR.y,0.,1.);               // книзу чуть шире
  float d=sdE(h,HR);
  d=smin(d,sdE(q-vec3(.26,1.0,.24),vec3(.22,.17,.17)),.08);    // щёчки
  d=smin(d,sdE(q-vec3(.08,1.03,.41),vec3(.11,.08,.08)),.05);   // пухлая мордочка у рта
  d=smin(d,sdE(p-NC,vec3(.04,.03,.028)),.012);                   // носик
  d=smin(d,ear(q),.045);
  return d;
}
float torso(vec3 p,vec3 q){
  vec3 b=p-vec3(0.,.43,0.);
  b.x/=1.-.06*clamp(-b.y/.46,0.,1.);                // к низу чуть уже, как груша
  float d=sdE(b,vec3(.50,.46,.43));
  // ступни с пальчиками
  vec3 f=q-vec3(.20,.085,.25);
  float ft=sdE(f,vec3(.155,.095,.17));
  ft=smin(ft,length(f-vec3(-.065,.0,.135))-.06,.05);
  ft=smin(ft,length(f-vec3(.0,.008,.15))-.062,.05);
  ft=smin(ft,length(f-vec3(.065,.0,.135))-.06,.05);
  d=smin(d,ft,.06);
  // опущенная лапка на животе (-x)
  vec3 pl=vec3(-p.x,p.y,p.z);
  float a=sdCap(pl,vec3(.34,.70,.05),vec3(.40,.47,.20),.11);
  vec3 hp=pl-vec3(.40,.40,.25);
  float fist=sdE(hp,vec3(.13,.12,.12));
  fist=smin(fist,length(hp-vec3(.0,.06,.09))-.055,.035);   // пальчики спереди
  fist=smin(fist,length(hp-vec3(.0,-.0,.10))-.055,.035);
  fist=smin(fist,length(hp-vec3(.0,-.06,.09))-.055,.035);
  a=smin(a,fist,.05);
  d=smin(d,a,.08);
  return d;
}
// Поднятая лапка (+x): машет вокруг плеча
const vec3 SH=vec3(.43,.74,.03);
vec3 armP(vec3 p){vec3 a=p-SH;a.xy=r2(uWave)*a.xy;return a;}
float arm(vec3 p){
  vec3 a=armP(p);
  float d=sdCap(a,vec3(-.10,-.06,.0),vec3(.14,.24,.07),.125);
  vec3 h=a-vec3(.16,.32,.10);
  float paw=sdE(h,vec3(.16,.17,.14));
  // пальчики сверху-спереди
  paw=smin(paw,length(h-vec3(-.07,.12,.06))-.06,.04);
  paw=smin(paw,length(h-vec3(.0,.145,.06))-.062,.04);
  paw=smin(paw,length(h-vec3(.07,.12,.06))-.06,.04);
  return smin(d,paw,.06);
}
// ошейник: золотая лента под подбородком, выступает над телом
float collar(vec3 p){
  vec3 c=p-vec3(0.,.76,.02);
  float r=length(c.xz/vec2(.36,.315))*.338;
  vec2 b=abs(vec2(r-.338,c.y))-vec2(.018,.028);
  return length(max(b,0.))+min(max(b.x,b.y),0.)-.012;
}
// медаль: монета с ободком и выпуклой эмалевой «А»
vec3 medalP(vec3 p){vec3 m=p-vec3(0.,.525,.425);m.yz=r2(.14)*m.yz;return m;}
float medal(vec3 p){
  vec3 m=medalP(p);
  float r=length(m.xy);
  if(r>.26) return length(m)-.2;                   // дёшево вдали
  float d=max(r-.172,abs(m.z)-.024)-.012;           // диск со скруглённым ребром
  d=smin(d,length(vec2(r-.158,m.z-.03))-.014,.008); // выпуклый ободок
  d-=(1.-r*r/.0196)*.012*step(r,.14)*step(0.,m.z);  // поле выпуклое, как у монеты
  float A=logoA(m.xy/.21)*.21;
  d-=smoothstep(.003,-.003,A)*.008*step(0.,m.z)*step(r,.14);   // выпуклая «А»
  return d;
}
float specs(vec3 q){
  if(uAcc<1.5) return 1e3;
  vec3 l=q-vec3(.20,1.20,.45);
  float br=sdCap(q,vec3(0.,1.21,.48),vec3(.08,1.21,.47),.017);
  if(uAcc<2.5){
    float lens=sdE(l,vec3(.15,.105,.035))+max(0.,l.y-.05)*.5;
    return min(lens,br);
  }
  float ring=length(vec2(length(l.xy)-.13,l.z))-.016;
  return min(ring,br);
}

// x – расстояние, y – материал (1 винил, 3 ошейник, 4 медаль, 5 очки)
vec2 map(vec3 p){
  vec3 q=vec3(abs(p.x),p.y,p.z);
  float hd=head(p,q),to=torso(p,q);
  float d=smin(hd,to,.055);                         // чёткая складка шеи
  // рука плавно срастается только с телом, с головой – чистый стык, без «сварки»
  d=min(d,smin(to,arm(p),.07));
  vec2 r=vec2(d,1.);
  float c=collar(p);if(c<r.x)r=vec2(c,3.);
  if(uAcc>.5&&uAcc<1.5){float m=medal(p);if(m<r.x)r=vec2(m,4.);}
  float s=specs(q);if(s<r.x)r=vec2(s,5.);
  return r;
}

// мир -> локальные координаты (вращение вокруг середины фигуры, ступни стоят на месте при сжатии)
vec3 toL(vec3 p){
  p.y-=MID;
  p.xz=r2(uRot.x)*p.xz;
  p.yz=r2(uRot.y)*p.yz;
  p.xy=r2(uRot.z)*p.xy;
  p.y+=MID;
  float s=1.+uSq;
  p.y/=s;p.xz*=sqrt(s);
  return p;
}
vec3 dirL(vec3 d){d.xz=r2(uRot.x)*d.xz;d.yz=r2(uRot.y)*d.yz;d.xy=r2(uRot.z)*d.xy;return d;}
vec3 dirW(vec3 n){n.xy=r2(-uRot.z)*n.xy;n.yz=r2(-uRot.y)*n.yz;n.xz=r2(-uRot.x)*n.xz;return n;}

vec3 calcN(vec3 p){
  vec2 k=vec2(1,-1)*.001;
  return normalize(k.xyy*map(p+k.xyy).x+k.yyx*map(p+k.yyx).x+k.yxy*map(p+k.yxy).x+k.xxx*map(p+k.xxx).x);
}
float ao(vec3 p,vec3 n){
  float o=0.,s=1.;
  for(int i=1;i<6;i++){float h=.012+.045*float(i);o+=(h-map(p+n*h).x)*s;s*=.72;}
  return clamp(1.-1.6*o,0.,1.);
}
float shadow(vec3 p,vec3 l){
  float r=1.,t=.02;
  for(int i=0;i<28;i++){
    float h=map(p+l*t).x;
    r=min(r,9.*h/t);
    t+=clamp(h,.012,.12);
    if(r<.01||t>1.6)break;
  }
  return clamp(r,0.,1.);
}

// Печать на мордочке: глаза-дужки, носик, рот «ω». Маска 0..1
float faceInk(vec3 p,float px){
  if(p.z<.2||p.y<.82||p.y>1.42) return 0.;
  vec2 f=p.xy-vec2(0.,HC.y);
  vec2 g=vec2(abs(f.x),f.y);
  // глаза: прищуренные полумесяцы ∩, внешние концы чуть ниже
  vec2 e=g-vec2(.205,.04);
  e=r2(.22)*e;
  float eyes=max(length(e)-.074,-(length(e-vec2(0.,-.027))-.074))-.003;
  // носик – тёмный шарик (геометрия в head)
  float nose=length((p-NC)/vec3(.04,.03,.028))-1.1;
  nose*=.03;
  // рот «ω»: чёрточка от носика и две дуги, внешние уголки приподняты
  vec2 m=g-vec2(.064,-.125);
  float mr=.064,mw=.0125;
  float a=atan(m.y,m.x);
  float arc=abs(length(m)-mr)-mw;
  if(a>.45||(a>0.&&m.x<0.)){
    vec2 c1=mr*vec2(cos(.45),sin(.45));
    arc=min(length(m-c1),length(m+vec2(mr,0.)))-mw;
  }
  float stem=sdSeg2(f,vec2(0.,-.085),vec2(0.,-.125))-mw;
  float d=min(min(eyes,nose),min(arc,stem));
  return smoothstep(px,-px,d);
}

// студийное окружение: тёмный пол, светлый купол, софтбоксы. Для металла контраст отражений – главное
vec3 env(vec3 r){
  float y=r.y;
  vec3 c=mix(vec3(.035,.025,.035),vec3(.36,.30,.46),smoothstep(-.45,.02,y));      // пол -> горизонт
  c=mix(c,vec3(.9,.88,1.),smoothstep(.08,.75,y));                                  // купол
  c+=vec3(3.4,3.2,3.)*smoothstep(.88,.97,dot(r,normalize(vec3(-.45,.78,.45))));     // ключевой софтбокс
  c+=vec3(.62,.6,.58)*smoothstep(.6,.92,dot(r,vec3(0.,.1,.995)));                  // фронтальная карта
  c+=vec3(1.9,1.1,1.6)*smoothstep(.82,.95,dot(r,normalize(vec3(.85,.3,-.4))));      // контровой
  c+=vec3(.8,.85,1.1)*smoothstep(.86,.97,dot(r,normalize(vec3(-.95,.05,.25))));     // полоса слева
  return c;
}

vec4 shade(vec3 pw,vec3 rd,float id,float px){
  vec3 p=toL(pw);
  vec3 nl=calcN(p);
  vec3 n=dirW(nl);
  vec3 v=-rd;
  vec3 L1=normalize(vec3(-.55,.75,.62)), L2=normalize(vec3(.85,.12,.35)), L3=normalize(vec3(.55,.45,-.75));
  float occ=ao(p,nl);
  float sh=shadow(p+nl*.004,dirL(L1));
  float ndv=max(dot(n,v),0.);
  float fr=pow(1.-ndv,4.);
  vec3 r=reflect(rd,n);
  vec3 c;
  float lum=dot(uFur,vec3(.3,.59,.11));
  if(id<1.5){
    vec3 q=vec3(abs(p.x),p.y,p.z);
    vec3 base=uFur;
    // серединка ушей и мордочка
    float ie=earIn(q,px);
    base=mix(base,lum<.06?vec3(.30,.025,.02):vec3(.05,.012,.012),ie);
    float ink=faceInk(p,px);
    base=mix(base,lum<.06?vec3(.72,.70,.68):vec3(.014,.006,.006),ink);
    // складочки между пальчиками на ступнях и опущенной лапке
    vec3 f=q-vec3(.20,.085,.25);
    float cr=smoothstep(.012,.0,abs(abs(f.x)-.034))*smoothstep(.10,.16,f.z)*smoothstep(.06,-.01,f.y);
    base*=1.-.4*cr;
    // матовый винил с едва заметной неровностью
    vec3 nb=normalize(n+.01*(vec3(n2(p.xy*9.),n2(p.yz*9.+3.),n2(p.zx*9.+7.))-.5));
    float dif=max(dot(nb,L1),0.);
    float wrap=max(0.,(dot(nb,L1)+.5)/1.5);
    float key=mix(wrap,dif,.55)*mix(.35,1.,sh);
    float fill=max(0.,(dot(nb,L2)+.3)/1.3);
    float sky=.5+.5*nb.y;
    vec3 diff=key*vec3(1.,.95,.9)*1.25+fill*vec3(.75,.7,1.)*.35+sky*vec3(.38,.34,.45)*.5+vec3(.05,.04,.05);
    c=base*diff*mix(.3,1.,occ);
    // подповерхностное: в тенях цвет уходит в насыщенный красный, а не в бурый
    c+=base*base*vec3(1.4,.5,.45)*.35*(1.-key)*occ;
    // мягкий матовый блик, бархатистый край, контровой
    float gl=mix(1.,.5,max(ink,ie));
    vec3 hv=normalize(L1+v);
    float nh=max(dot(nb,hv),0.);
    c+=vec3(1.,.96,.94)*(pow(nh,24.)*.14+pow(nh,5.)*.04)*sh*gl*occ;
    c+=env(r)*(.012+.1*fr)*gl*occ;
    c+=fr*base*vec3(1.,.7,.8)*.35*occ;
    c+=pow(max(dot(n,L3),0.),4.)*vec3(1.,.6,.8)*.3*occ;
  } else if(id<4.5){
    // золото: металл по Френелю – цвет только из окраскенных отражений, без диффуза
    vec3 m=medalP(p);
    float A=0.;
    if(id>3.5) A=smoothstep(px,-px,logoA(m.xy/.21)*.21)*step(.0,m.z)*step(length(m.xy),.14);
    vec3 F0=vec3(1.,.64,.17);
    // у золота на скользящем угле оттенок остаётся тёплым, а не уходит в белый
    vec3 F=F0+(mix(F0,vec3(1.,.93,.8),.55)-F0)*pow(1.-ndv,5.);
    // слегка размытое отражение (шероховатость ~0.15)
    vec3 ra=normalize(r+vec3(.05,.03,0.)), rb=normalize(r-vec3(.03,.05,0.));
    vec3 E=env(r)*.5+env(ra)*.25+env(rb)*.25;
    vec3 g=F*E*mix(.3,1.,occ);
    // рефлекс от красного тела снизу и по краям
    g+=F0*vec3(.55,.05,.03)*.45*smoothstep(.15,-.5,r.y)*occ;
    vec3 hv=normalize(L1+v);
    float nh=max(dot(n,hv),0.);
    g+=vec3(1.,.95,.82)*pow(nh,260.)*3.5*sh;           // острый блик
    g+=F0*pow(nh,28.)*.3*sh;                            // ореол блика
    if(id>3.5){
      // тонкие круговые риски полировки на поле монеты
      float rr=length(m.xy);
      g*=.93+.12*n2(vec2(rr*300.,floor(atan(m.y,m.x)*6.)));
      // красная эмаль с глянцевым лаком
      vec3 red=vec3(.80,.025,.02);
      float ld=max(dot(n,L1),0.)*mix(.4,1.,sh);
      vec3 en=red*(.22+.95*ld+.25*max(dot(n,L2),0.))*mix(.5,1.,occ);
      en+=env(r)*(.03+.5*pow(1.-ndv,5.));
      en+=vec3(1.)*pow(nh,180.)*1.6*sh;
      g=mix(g,en,A);
    }
    c=g;
  } else {
    c=vec3(.012,.012,.016)+env(r)*(.06+.5*fr)+vec3(1.)*pow(max(dot(r,L1),0.),50.)*1.2;
  }
  return vec4(c,1.);
}

// ---------- фон: переливы и большая «А» с мраморной заливкой ----------
float band(vec2 p,vec2 a,vec2 b,float w){return sdSeg2(p,a,b)-w;}
vec3 marble(vec2 p){
  vec2 w=p*2.2+vec2(uT*.03,-uT*.02);
  vec2 q=vec2(fbm(w),fbm(w+vec2(5.2,1.3)));
  float f=fbm(w+3.*q+vec2(uT*.04,0.));
  vec3 peach=vec3(1.,.80,.68), pink=vec3(.94,.27,.62), lil=vec3(.98,.70,.86);
  vec3 c=mix(peach,lil,smoothstep(.3,.7,q.x));
  c=mix(c,pink,smoothstep(.48,.78,f));
  c=mix(c,vec3(.80,.12,.48),smoothstep(.72,.9,f)*.7);
  return c;
}
vec3 background(vec2 fc){
  vec2 uv=fc/uRes;
  float ar=uRes.x/uRes.y;
  vec2 p=vec2(uv.x*ar,uv.y);
  vec3 c1=vec3(.53,.55,.95), c2=vec3(.80,.62,.96), c3=vec3(.96,.74,.93);
  vec3 col=mix(c1,c2,smoothstep(0.,1.,uv.x*.7+uv.y*.5));
  col=mix(col,c3,smoothstep(.55,1.2,uv.x+uv.y*.3)*.6);
  col+=.06*sin(vec3(0.,2.,4.)+uT*.25+uv.x*3.+uv.y*2.);
  vec2 ap=vec2(ar*.80,1.45);
  float w=.15;
  float d=band(p,ap,vec2(ar*.80-.95,-.25),w);
  d=min(d,band(p,ap,vec2(ar*.80+.95,-.25),w));
  d=min(d,band(p,vec2(ar*.80-.62,.22),vec2(ar*.80+.62,.22),w*.8));
  float m=smoothstep(.004,-.004,d);
  if(m>0.) col=mix(col,marble(p),m);
  col*=1.-.10*smoothstep(.06,0.,d)*(1.-m);
  col+=.08*smoothstep(.25,0.,abs(uv.x*.6-uv.y+.35));
  return col;
}

void main(){
  vec2 fc=gl_FragCoord.xy;
  vec3 col=uBg>.5?pow(background(fc),vec3(2.2)):vec3(0.);
  float alpha=uBg;
  vec2 sp=(fc-uC)/uS;                 // единицы сцены, ступни в (0,0)
  float px=1.5/uS;                    // ~1.5 px в единицах сцены

  // контактная тень под ступнями
  if(uBg>.5){
    float t1=length((sp-vec2(.0,.01))/vec2(.52,.05));
    float t2=length((sp-vec2(.0,.02))/vec2(.85,.16));
    col*=(1.-.5*smoothstep(1.,.2,t1))*(1.-.18*smoothstep(1.,0.,t2));
  }

  vec2 cp=sp-vec2(0.,MID);
  if(dot(cp,cp)<BR*BR*1.05){
    vec3 ro=vec3(sp,6.);
    vec3 rd=normalize(vec3(cp*.03,-6.));
    vec3 oc=ro-vec3(0.,MID,0.);
    float b=dot(oc,rd),cc=dot(oc,oc)-BR*BR,hd=b*b-cc;
    if(hd>0.){
      float t=-b-sqrt(hd),tmax=-b+sqrt(hd);
      float mn=1e3,tm=t;vec2 h=vec2(1e3,1.);bool hit=false;
      for(int i=0;i<110;i++){
        h=map(toL(ro+rd*t));
        if(h.x<mn){mn=h.x;tm=t;}
        if(h.x<.0005){hit=true;break;}
        t+=h.x*.8;
        if(t>tmax)break;
      }
      if(hit){
        col=shade(ro+rd*t,rd,h.y,px).rgb;alpha=1.;
      } else if(mn<px){
        // сглаживание силуэта: досветить ближайшую точку и смешать по покрытию
        float k=1.-mn/px;
        vec3 pw=ro+rd*tm;
        float id=map(toL(pw)).y;
        vec3 c=shade(pw,rd,id,px).rgb;
        col=mix(col,c,k);alpha=max(alpha,k);
      }
    }
  }
  col=col/(1.+.12*col);               // мягкое сжатие бликов
  col=pow(max(col,0.),vec3(1./2.2));
  col+=(h21(fc+uT)-.5)/255.;
  gl_FragColor=vec4(col,alpha);
}`;

  // ---------- WebGL-обёртка ----------
  function renderer(canvas, transparent) {
    const gl = canvas.getContext('webgl', { premultipliedAlpha: false, alpha: !!transparent, antialias: false, preserveDrawingBuffer: !!transparent });
    if (!gl) return null;
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(o)); return null; } return o; };
    const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return null;
    const pr = gl.createProgram();
    gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(pr)); return null; }
    gl.useProgram(pr);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = {};
    ['uRes', 'uC', 'uS', 'uT', 'uRot', 'uSq', 'uBg', 'uFur', 'uAcc', 'uWave'].forEach((n) => (U[n] = gl.getUniformLocation(pr, n)));
    return {
      gl,
      draw(u) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform2f(U.uRes, canvas.width, canvas.height);
        gl.uniform2f(U.uC, u.cx, u.cy);
        gl.uniform1f(U.uS, u.s);
        gl.uniform1f(U.uT, u.t || 0);
        gl.uniform3f(U.uRot, u.yaw || 0, u.pitch || 0, u.roll || 0);
        gl.uniform1f(U.uSq, u.sq || 0);
        gl.uniform1f(U.uBg, u.bg ? 1 : 0);
        gl.uniform3fv(U.uFur, u.fur);
        gl.uniform1f(U.uAcc, u.acc || 0);
        gl.uniform1f(U.uWave, u.wave || 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    };
  }

  const lin = (hex) => [1, 3, 5].map((i) => Math.pow(parseInt(hex.slice(i, i + 2), 16) / 255, 2.2));
  // Персонажи: Альфи и команда помощников (цвета из палитры брендбука).
  // acc: 1 медаль с «А» (только у Альфи), 2 тёмные очки, 3 круглые очки
  const KINDS = {
    alfi:   { fur: '#EF3124', acc: 1 },
    tax:    { fur: '#E4E2DC', acc: 3 },
    money:  { fur: '#2A2A30', acc: 2 },
    sales:  { fur: '#7A3FE0', acc: 0 },
    people: { fur: '#16C8D2', acc: 0 },
    law:    { fur: '#6A7275', acc: 3 },
    ved:    { fur: '#F2B33D', acc: 2 }
  };
  const params = (k) => { const c = KINDS[k] || KINDS.alfi; return { fur: lin(c.fur), acc: c.acc }; };
  const HEIGHT = 1.78;   // рост фигуры от ступней до кончиков ушей, ед.

  // ---------- Статичные рендеры ----------
  let still = null;
  const cache = {};
  function img(kind = 'alfi', size = 160, o) {
    const key = kind + size + (o ? JSON.stringify(o) : '');
    if (cache[key]) return cache[key];
    if (!still) {
      const c = document.createElement('canvas');
      still = { c, r: renderer(c, true) };
    }
    if (!still.r) return '';
    const W = size * 2;   // рендер с запасом, браузер уменьшит – края мягче
    still.c.width = still.c.height = W;
    const s = W * 0.5;   // фигура ~1.8 ед. по высоте, ~1.6 по ширине
    still.r.draw(Object.assign(params(kind), { cx: W * 0.47, cy: W * 0.5 - 0.88 * s, s, t: 2, yaw: -0.32, pitch: 0.04, roll: 0, wave: 0.3, bg: false }, o || {}));
    return (cache[key] = still.c.toDataURL('image/png'));
  }

  // ---------- Живая сцена ----------
  function stage(el, opts = {}) {
    const canvas = document.createElement('canvas');
    canvas.className = 'mascot-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    el.prepend(canvas);
    const R = renderer(canvas, false);
    if (!R) { el.classList.add('is-nogl'); return null; }
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const P = params(opts.kind || 'alfi');
    const st = { w: 0, h: 0, dpr: 1, ax: 0, ay: 0, size: 240, yaw: -0.3, pitch: 0, ty: -0.3, tp: 0, sq: 0, sqv: 0, happy: 0, happyUntil: 0, mx: null, my: null, idle: 0, vis: true, t0: performance.now() };

    function resize() {
      const r = el.getBoundingClientRect();
      st.dpr = Math.min(devicePixelRatio || 1, 2);
      st.w = r.width; st.h = r.height;
      canvas.width = Math.round(r.width * st.dpr); canvas.height = Math.round(r.height * st.dpr);
      const a = opts.anchor ? opts.anchor(r) : { x: r.width * 0.7, y: r.height * 0.8, size: 240 };
      st.ax = a.x; st.ay = a.y; st.size = a.size;
      if (reduce) frame(performance.now());
    }
    // Куда повернуться: к курсору, в покое – к тексту слева с лёгким покачиванием
    function look(now) {
      const cxp = st.ax, cyp = st.ay - st.size * 0.65;
      if (st.mx != null && now - st.idle < 4000) {
        const r = el.getBoundingClientRect();
        const dx = (st.mx - r.left - cxp) / 420, dy = (st.my - r.top - cyp) / 420;
        st.ty = Math.max(-0.6, Math.min(0.6, dx * 0.8));
        st.tp = Math.max(-0.25, Math.min(0.3, dy * 0.45));
      } else {
        const t = now / 1000;
        st.ty = -0.3 + Math.sin(t * 0.37) * 0.18;
        st.tp = Math.sin(t * 0.23) * 0.05;
      }
    }
    function frame(now) {
      const t = (now - st.t0) / 1000;
      const dt = Math.min(0.05, (now - (st.last || now)) / 1000); st.last = now;
      look(now);
      st.yaw += (st.ty - st.yaw) * Math.min(1, dt * 5);
      st.pitch += (st.tp - st.pitch) * Math.min(1, dt * 5);
      // после тыка машет активнее
      const hTarget = now < st.happyUntil ? 1 : 0;
      st.happy += (hTarget - st.happy) * Math.min(1, dt * 6);
      // пружина сжатия
      st.sqv += (-st.sq * 160 - st.sqv * 9) * dt; st.sq += st.sqv * dt;
      const breath = reduce ? 0 : Math.sin(t * 2.1) * 0.008;
      const wave = reduce ? 0.34 : 0.34 + Math.sin(t * (2.6 + st.happy * 5)) * (0.08 + st.happy * 0.05);
      const s = (st.size / HEIGHT) * st.dpr;
      R.draw(Object.assign({}, P, {
        cx: st.ax * st.dpr, cy: (st.h - st.ay) * st.dpr, s,
        t: reduce ? 3 : t, yaw: st.yaw, pitch: -st.pitch, roll: reduce ? 0 : Math.sin(t * 0.8) * 0.015,
        sq: breath + st.sq, wave, bg: true
      }));
    }
    function loop(now) {
      if (st.vis && !document.hidden) frame(now);
      st.raf = requestAnimationFrame(loop);
    }
    resize();
    new ResizeObserver(resize).observe(el);
    new IntersectionObserver(([e]) => (st.vis = e.isIntersecting)).observe(el);
    addEventListener('pointermove', (e) => { st.mx = e.clientX; st.my = e.clientY; st.idle = performance.now(); if (reduce) frame(performance.now()); }, { passive: true });
    if (!reduce) st.raf = requestAnimationFrame(loop);

    return {
      // Тык: Альфи подпрыгивает и машет лапкой
      poke() { st.sqv -= 3.2; st.happyUntil = performance.now() + 1600; if (reduce) frame(performance.now()); },
      hit(x, y) { const dx = x - st.ax, dy = y - (st.ay - st.size * 0.5); return Math.hypot(dx, dy) < st.size * 0.48; },
      // где голова (px от el) – чтобы пузырь не налезал на мордочку
      head() { const u = st.size / HEIGHT; return { x: st.ax, y: st.ay - 1.15 * u, r: 0.62 * u }; },
      relayout: resize
    };
  }

  const ok = (() => { try { return !!document.createElement('canvas').getContext('webgl'); } catch (e) { return false; } })();
  return { stage, img, ok, KINDS };
})();
