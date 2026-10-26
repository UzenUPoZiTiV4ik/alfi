/* Модель Альфи и три её варианта, один рендерер на всю команду.
   Картинки и сцены собираются из того же кода, поэтому кот везде одинаковый. */
(() => {
  'use strict';
  const legacy = window.Mascot;
  const HEIGHT = 2.18;
  const MODEL_RENDER_SIZE = 640; // Canonical source: shape and facial detail do not depend on display size.
  const VARIANTS = Object.freeze([
    { id: 'reference', index: 0, name: 'Альфи · Исходная модель' },
    { id: 'soft', index: 1, name: 'Альфи · Мягкий винил' },
    { id: 'round', index: 2, name: 'Альфи · Круглый друг' },
    { id: 'mitten', index: 3, name: 'Альфи · Лапки-варежки' }
  ]);
  function variantIndex(value, fallback = 0) {
    const match = VARIANTS.find(item => item.id === value);
    if (match) return match.index;
    const n = value !== null && value !== undefined && value !== '' ? Number(value) : NaN;
    return Number.isInteger(n) && n >= 0 && n <= 3 ? n : fallback;
  }
  const COLOR_MORPH_MS = 380;               // длительность перелива палитры между персонажами
  const DEFAULT_VARIANT = 0; // Production always uses the reference model, not an experimental URL preset.
  const DEFAULT_POSE = { yaw: 0.020, pitch: 0.012, roll: 0, squash: 0, wave: 0, tilt: 0 };
  const KINDS = legacy ? legacy.KINDS : { alfi: { fur: '#EF3124', acc: 1 } };
  const materials = Object.fromEntries(Object.entries(KINDS).map(([kind, info]) => [kind, {
    fur: [1,3,5].map(i => Math.pow(parseInt(info.fur.slice(i,i+2),16)/255,2.2)), acc: info.acc
  }]));
  const materialFor = kind => materials[kind] || materials.alfi;
  // Свой персонаж: материал регистрируется на лету, цвет приходит из интерфейса.
  const normalizeHex = value => {
    const raw = String(value || '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(raw)) return '#' + raw.split('').map(ch => ch + ch).join('').toUpperCase();
    if (/^[0-9a-f]{6}$/i.test(raw)) return '#' + raw.toUpperCase();
    return null;
  };
  function registerKind(kind, info = {}) {
    const fur = normalizeHex(info.fur);
    if (typeof kind !== 'string' || !kind || !fur) return false;
    const acc = [1,2,3].includes(Number(info.acc)) ? Number(info.acc) : 0;
    materials[kind] = { fur: [1,3,5].map(i => Math.pow(parseInt(fur.slice(i,i+2),16)/255,2.2)), acc };
    KINDS[kind] = { fur, acc };
    return true;
  }
  const VS = 'attribute vec2 aPosition; void main(){gl_Position=vec4(aPosition,0.0,1.0);}';
  const FS = String.raw`
precision highp float;
uniform vec2 uResolution;
uniform vec3 uRotation;
uniform vec2 uCenter;
uniform float uScale;
uniform float uTime;
uniform float uBackground;
uniform float uDrawModel;
uniform float uSquash;
uniform float uWave;
uniform vec3 uFur;
uniform vec3 uFurFrom;
uniform float uFurMix;
uniform float uAcc;
uniform float uVariant;
// Живость: наклон головы и тень под лапами (она растёт вместе с котом при смене).
uniform float uTilt;
uniform float uShadow;
const float COIN_SCALE = 2.18 / 1.78;

const vec3 HEAD = vec3(-0.018, 1.286, 0.005);
const vec3 RADII = vec3(0.625, 0.428, 0.477);
const float PI = 3.14159265359;

// Палитра строится из цвета шерсти: один тон и его родня вместо чужих цветов.
vec3 rgb2hsv(vec3 c){
  vec4 K=vec4(0.,-1./3.,2./3.,-1.);
  vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));
  vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));
  float d=q.x-min(q.w,q.y);
  return vec3(abs(q.z+(q.w-q.y)/(6.*d+1e-10)),d/(q.x+1e-10),q.x);
}
vec3 hsv2rgb(vec3 c){
  vec3 p=abs(fract(c.xxx+vec3(1.,2./3.,1./3.))*6.-3.);
  return c.z*mix(vec3(1.),clamp(p-1.,0.,1.),c.y);
}
vec3 furSrgb(vec3 lin){ return pow(max(lin,vec3(0.0001)),vec3(1.0/2.2)); }
// Перелив цвета: тон едет по кратчайшей дуге, а в середине цвета бледнеют.
// Так переход не проскакивает грязными оттенками и читается как мягкая волна.
vec3 mixFurSrgb(vec3 a,vec3 b,float t){
  if(t<=0.001) return a;
  if(t>=0.999) return b;
  vec3 ha=rgb2hsv(a), hb=rgb2hsv(b);
  float dh=hb.x-ha.x; dh-=floor(dh+0.5);
  float wave=sin(t*3.14159265);
  float hue=fract(ha.x+dh*t);
  float sat=mix(ha.y,hb.y,t)*(1.0-0.55*wave);
  float val=mix(ha.z,hb.z,t)+0.10*wave;
  return hsv2rgb(vec3(hue,clamp(sat,0.,1.),clamp(val,0.,1.)));
}
vec3 curFurSrgb(){ return mixFurSrgb(furSrgb(uFurFrom),furSrgb(uFur),uFurMix); }
vec3 pal(vec3 fur,float hueShift,float satMul,float val,float shadeAmt){
  vec3 h=rgb2hsv(fur);
  // Белые и серые коты не дают своего тона: для них работает фирменная лиловая гамма,
  // цветные коты уводят её в свой тон тем сильнее, чем чище цвет.
  float chroma=smoothstep(.12,.55,h.y);
  // Тёмная шерсть гасит и саму сцену: чёрный кот не может жить на белом фоне.
  float shade=mix(1.0,mix(.26,1.0,smoothstep(.05,.85,h.z)),clamp(shadeAmt,0.,1.));
  float hue=mix(.66,h.x,chroma)+hueShift*mix(1.,.45,chroma);
  float satBase=mix(.44,max(.38,h.y*.95),chroma);
  float sat=clamp(satBase*satMul,0.,1.);
  float v=clamp(val*shade,0.,1.);
  return hsv2rgb(vec3(fract(hue),sat,v));
}


mat2 rot(float a) { float c=cos(a), s=sin(a); return mat2(c,s,-s,c); }
float smin(float a,float b,float k) { float h=clamp(0.5+0.5*(b-a)/k,0.0,1.0); return mix(b,a,h)-k*h*(1.0-h); }
float smax(float a,float b,float k) { return -smin(-a,-b,k); }
float ellipse(vec3 p,vec3 r) { float a=length(p/r),b=length(p/(r*r)); return a*(a-1.0)/max(b,0.00001); }
float roundedVolume(vec3 p,vec3 r,float power) {
  // Powers 2.25 and 2.5 give soft pads; square roots avoid expensive vector pow.
  vec3 q=abs(p)/r;
  bool flatter=power>2.4;
  vec3 root=flatter?sqrt(q):sqrt(sqrt(q));
  float sum=dot(q*q*root,vec3(1.0));
  if(sum<0.00000001) return -min(r.x,min(r.y,r.z));
  float k=pow(sum,flatter?0.4:0.4444444444);
  float kRoot=flatter?sqrt(k):sqrt(sqrt(k));
  return (k-1.0)*k*kRoot/max(length(q*root/r),0.00001);
}
float capsule(vec3 p,vec3 a,vec3 b,float r) { vec3 pa=p-a,ba=b-a; return length(pa-ba*clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0))-r; }
float segment(vec2 p,vec2 a,vec2 b) { vec2 pa=p-a,ba=b-a; return length(pa-ba*clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0)); }
float roundedBox(vec2 p,vec2 b,float r) { vec2 q=abs(p)-b; return length(max(q,0.0))+min(max(q.x,q.y),0.0)-r; }
float cone(vec2 p,float r1,float r2,float h) {
  p.x=abs(p.x); float b=(r1-r2)/h,a=sqrt(1.0-b*b),k=dot(p,vec2(-b,a));
  if(k<0.0) return length(p)-r1;
  if(k>a*h) return length(p-vec2(0.0,h))-r2;
  return dot(p,vec2(a,b))-r1;
}
float bezier(vec2 p,vec2 a,vec2 b,vec2 c) {
  float d=100.0; vec2 last=a;
  for(int i=1;i<=16;i++) { float t=float(i)/16.0; vec2 q=mix(mix(a,b,t),mix(b,c,t),t); d=min(d,segment(p,last,q)); last=q; }
  return d;
}
float triangle(vec2 p,vec2 a,vec2 b,vec2 c) {
  vec2 e0=b-a,e1=c-b,e2=a-c,v0=p-a,v1=p-b,v2=p-c;
  vec2 q0=v0-e0*clamp(dot(v0,e0)/dot(e0,e0),0.0,1.0);
  vec2 q1=v1-e1*clamp(dot(v1,e1)/dot(e1,e1),0.0,1.0);
  vec2 q2=v2-e2*clamp(dot(v2,e2)/dot(e2,e2),0.0,1.0);
  float s=sign(e0.x*e2.y-e0.y*e2.x);
  vec2 d=min(min(vec2(dot(q0,q0),s*(v0.x*e0.y-v0.y*e0.x)),vec2(dot(q1,q1),s*(v1.x*e1.y-v1.y*e1.x))),vec2(dot(q2,q2),s*(v2.x*e2.y-v2.y*e2.x)));
  return -sqrt(d.x)*sign(d.y);
}
float trapezoid(vec2 p,float r1,float r2,float height) {
  vec2 k1=vec2(r2,height),k2=vec2(r2-r1,2.0*height); p.x=abs(p.x);
  vec2 a=vec2(max(0.0,p.x-(p.y<0.0?r1:r2)),abs(p.y)-height);
  vec2 b=p-k1+k2*clamp(dot(k1-p,k2)/dot(k2,k2),0.0,1.0);
  float signD=(b.x<0.0&&a.y<0.0)?-1.0:1.0;
  return signD*sqrt(min(dot(a,a),dot(b,b)));
}
float logoA(vec2 q){
  float d=segment(q,vec2(-.30,-.24),vec2(-.07,.40));
  d=min(d,segment(q,vec2(.30,-.24),vec2(.07,.40)));
  d=min(d,segment(q,vec2(-.07,.40),vec2(.07,.40)));
  d=min(d,segment(q,vec2(-.14,-.02),vec2(.14,-.02)));
  d=min(d,segment(q,vec2(-.30,-.46),vec2(.30,-.46)));
  return d-.075;
}
vec3 headRadii() {
  if(uVariant<0.5) return RADII;
  if(uVariant<1.5) return vec3(0.622,0.452,0.474);
  if(uVariant<2.5) return vec3(0.675,0.468,0.493);
  return vec3(0.624,0.447,0.472);
}
float faceScale() {
  if(uVariant<0.5) return 1.0;
  if(uVariant<1.5) return 0.94;
  if(uVariant<2.5) return 0.85;
  return 0.90;
}
vec3 headPoint(vec3 p) {
  // Живой наклон головы вокруг шеи: маленький, чтобы морда не съезжала с ошейника.
  vec3 pivot=vec3(HEAD.x,1.0,0.0);
  p-=pivot; p.xy=rot(uTilt)*p.xy; p+=pivot;
  float tilt=uVariant<0.5?0.172:(uVariant<1.5?0.105:(uVariant<2.5?0.055:0.075));
  p-=HEAD; p.xy=rot(tilt)*p.xy; p+=HEAD; return p;
}
vec3 earPoint(vec3 h) {
  vec3 e=vec3(abs(h.x-HEAD.x),h.y,h.z)-vec3(0.315,1.550,-0.013);
  float tilt=uVariant<0.5?-0.12:-0.075;
  e.xy=rot(tilt)*e.xy;
  if(uVariant>0.5) {
    e.y/=uVariant<1.5?0.91:(uVariant<2.5?0.89:0.84);
    e.x/=uVariant<2.5?1.06:0.97;
  }
  return e;
}
float earShape(vec3 e) {
  float d=cone(vec2(length(vec2(e.x,e.z*1.70)),e.y),0.226,0.070,0.245)/1.70;
  if(uVariant<0.5) {
    float inner=cone(e.xy-vec2(0.0,0.072),0.145,0.033,0.187);
    d+=0.006*(1.0-smoothstep(-0.010,0.012,inner))*smoothstep(0.030,0.110,e.z);
  }
  return d;
}
float cuteHead(vec3 h) {
  vec3 p=h-HEAD;
  float lower=1.0-smoothstep(-0.30,0.05,p.y);
  p.x/=1.0+0.040*lower; p.y/=1.0+0.055*lower;
  float d=ellipse(p,headRadii());
  d=smin(d,earShape(earPoint(h)),0.074);
  if(uVariant<2.5) d=smin(d,ellipse(h-vec3(HEAD.x,1.046,0.260),vec3(0.375,0.168,0.200)),0.106);
  return d;
}
float headShape(vec3 h) {
  if(uVariant>0.5) return cuteHead(h);
  vec3 p=h-HEAD;
  p.x/=1.0+0.06*smoothstep(0.08,-0.30,p.y);
  p.y/=1.0+0.115*smoothstep(0.0,-0.35,p.y);
  float d=ellipse(p,RADII);
  d=smin(d,earShape(earPoint(h)),0.056);
  // A single broad chin keeps the lower face full without separate spherical cheeks.
  d=smin(d,ellipse(h-vec3(HEAD.x,1.044,0.260),vec3(0.405,0.182,0.213)),0.092);
  vec2 m=vec2(abs(h.x-HEAD.x)-0.113,h.y-1.074);
  d-=0.019*exp(-dot(m/vec2(0.125,0.111),m/vec2(0.125,0.111)))*smoothstep(0.24,0.40,h.z);
  return d;
}
float cutePaw(vec3 q,bool raised) {
  float side=raised?-1.0:1.0;
  if(uVariant<1.5) {
    float d=ellipse(q,vec3(0.164,0.151,0.139));
    // Three very low pads read as one paw, not three separate finger balls.
    for(int i=-1;i<=1;i++) {
      vec3 f=q-vec3(float(i)*0.059,0.008,0.073);
      d=smin(d,ellipse(f,vec3(0.066,0.080,0.084)),0.063);
    }
    return smin(d,ellipse(q-vec3(side*0.105,-0.027,0.063),vec3(0.062,0.077,0.075)),0.060);
  }
  if(uVariant<2.5) {
    q.xy=rot(side*0.12)*q.xy;
    return ellipse(q,vec3(0.169,0.155,0.148));
  }
  q.xy=rot(side*0.15)*q.xy;
  float d=ellipse(q,vec3(0.151,0.153,0.137));
  return smin(d,ellipse(q-vec3(side*0.109,-0.048,0.025),vec3(0.072,0.083,0.076)),0.065);
}
float raisedPaw(vec3 p) {
  if(uVariant>0.5) return cutePaw(p-vec3(uVariant<2.5?0.697:0.689,1.214,0.255),true);
  vec3 q=p-vec3(0.680,1.203,0.250);
  // A plain round mitten: no fingers, no thumb, just one soft ball.
  return ellipse(q,vec3(0.182,0.175,0.167));
}
float cuteRaisedArm(vec3 p) {
  float radius=uVariant<1.5?0.146:(uVariant<2.5?0.151:0.138);
  float d=capsule(p,vec3(0.485,0.755,0.107),vec3(0.610,0.945,0.171),radius);
  d=smin(d,capsule(p,vec3(0.608,0.937,0.170),vec3(0.689,1.152,0.247),radius*0.89),0.070);
  return smin(d,raisedPaw(p),0.057);
}
float raisedArm(vec3 p) {
  if(uVariant>0.5) return cuteRaisedArm(p);
  // The lower forearm bends inward and slightly back into the torso.
  vec3 a=p;
  float bend=1.0-smoothstep(0.690,1.040,p.y);
  a.x+=0.065*bend; a.z+=0.020*bend;
  vec3 q=a-vec3(0.588,0.856,0.126); q.xy=rot(0.22)*q.xy;
  float d=ellipse(q,vec3(0.174,0.295,0.168));
  d=smin(d,ellipse(a-vec3(0.656,1.041,0.171),vec3(0.157,0.211,0.158)),0.060);
  return smin(d,raisedPaw(p),0.042);
}
float cuteLoweredArm(vec3 p) {
  vec3 a=p-vec3(-0.445,0.807,0.106); a.xy=rot(0.41)*a.xy;
  float d=ellipse(a,vec3(0.146,0.267,0.149));
  vec3 q=p-vec3(-0.558,0.603,0.329); q.xy=rot(-0.11)*q.xy;
  return smin(d,cutePaw(q,false),0.065);
}
float loweredArm(vec3 p) {
  if(uVariant>0.5) return cuteLoweredArm(p);
  vec3 q=p-vec3(-0.455,0.805,0.110); q.xy=rot(0.46)*q.xy;
  float d=ellipse(q,vec3(0.158,0.283,0.160));
  vec3 h=p-vec3(-0.560,0.595,0.333);
  h.xy=rot(-0.105)*h.xy;
  // The resting paw is a single round mitten tucked against the body.
  float paw=ellipse(h-vec3(-0.010,0.006,0.004),vec3(0.172,0.165,0.146));
  return smin(d,paw,0.030);
}
float cuteFeet(vec3 p) {
  vec3 q=vec3(abs(p.x),p.y,p.z)-vec3(uVariant<2.5?0.239:0.230,0.112,0.331);
  float rx=uVariant<1.5?0.164:(uVariant<2.5?0.176:0.155);
  float rz=uVariant<1.5?0.160:(uVariant<2.5?0.165:0.155);
  float d=ellipse(q,vec3(rx,0.112,rz));
  for(int i=-1;i<=1;i++) {
    float middle=1.0-abs(float(i));
    float reach=uVariant<1.5?0.099:(uVariant<2.5?0.091:0.085);
    vec3 toe=q-vec3(float(i)*0.067,-0.008,reach+0.008*middle);
    vec3 pad=uVariant<1.5?vec3(0.063,0.096,0.074):(uVariant<2.5?vec3(0.064,0.094,0.066):vec3(0.058,0.094,0.067));
    d=smin(d,ellipse(toe,pad),uVariant<1.5?0.043:0.050);
  }
  return d;
}
float footShape(vec3 p) {
  if(uVariant>0.5) return cuteFeet(p);
  vec3 f=vec3(abs(p.x),p.y,p.z)-vec3(0.234,0.112,0.321);
  // Broad heel and instep: the toes grow out of one foot, not three upright tubes.
  vec3 heel=f;
  heel.x/=mix(0.84,1.0,smoothstep(-0.085,0.075,f.z));
  float d=roundedVolume(heel,vec3(0.160,0.112,0.152),2.5);
  float toes=100.0;
  for(int i=-1;i<=1;i++) {
    float middle=1.0-abs(float(i));
    vec3 toe=f-vec3(float(i)*0.087,-0.006+0.006*middle,0.087+0.014*middle);
    toe.xz=rot(float(i)*0.055)*toe.xz;
    float pad=roundedVolume(toe,vec3(0.074,0.106+0.006*middle,0.110),2.5);
    toes=smin(toes,pad,0.019);
  }
  return smin(d,toes,0.036);
}
float cuteBody(vec3 p) {
  vec3 center=uVariant<2.5?vec3(0.0,0.595,-0.024):vec3(0.0,0.598,-0.029);
  vec3 q=p-center;
  vec3 r=uVariant<1.5?vec3(0.526,0.500,0.413):(uVariant<2.5?vec3(0.533,0.481,0.413):vec3(0.479,0.496,0.395));
  q.x/=1.0-0.125*q.y;
  float d=ellipse(q,r);
  vec3 leg=vec3(abs(p.x),p.y,p.z)-vec3(uVariant<2.5?0.275:0.255,0.265,0.105);
  d=smin(d,ellipse(leg,vec3(0.187,0.214,0.232)),0.087);
  d=smin(d,footShape(p),0.040);
  float shoulder=ellipse(p-vec3(0.368,1.003,0.018),vec3(0.168,0.164,0.188));
  return smin(d,shoulder,0.082);
}
float bodyShape(vec3 p) {
  if(uVariant>0.5) return cuteBody(p);
  vec3 q=p-vec3(0.0,0.595,-0.024);
  q.x/=1.0-0.10*smoothstep(0.39,-0.46,q.y);
  float d=ellipse(q,vec3(0.579,0.502,0.436));
  d=smin(d,ellipse(p-vec3(0.0,0.910,-0.035),vec3(0.470,0.270,0.385)),0.090);
  // Taller pear-shaped torso and large seated haunches, not a compressed sphere.
  vec3 leg=vec3(abs(p.x),p.y,p.z)-vec3(0.379,0.329,0.033);
  leg.xy=rot(0.38)*leg.xy;
  d=smin(d,ellipse(leg,vec3(0.240,0.303,0.292)),0.047);
  d=smin(d,footShape(p),0.016);
  // Shoulder support belongs to the torso; limbs are composed separately below.
  return smin(d,ellipse(p-vec3(0.397,1.035,0.007),vec3(0.172,0.148,0.223)),0.055);
}
float neckShape(vec3 p) {
  // The internal neck ends inside the gold tube: no exposed red throat above it.
  vec3 n=p-vec3(-0.002,1.095,0.014);
  n.y+=0.105*n.z;
  float d=ellipse(n,vec3(0.400,0.165,0.350));
  return max(d,p.y+0.105*(p.z-0.014)-1.150);
}
float collar(vec3 p) {
  vec3 q=p-vec3(-0.002,1.140,0.015);
  q.y+=0.105*q.z;
  float r=length(q.xz/vec2(0.390,0.331))*0.364;
  // A true rounded tube around an elliptical neck, not a beveled flat ribbon.
  return length(vec2(r-0.364,q.y))-0.062;
}
vec3 coinPoint(vec3 p) {
  float z=uVariant<0.5?0.438:(uVariant<2.5?0.417:0.399);
  p-=vec3(0.034,0.811,z); p.yz=rot(0.14)*p.yz; return p/COIN_SCALE;
}
float coinShape(vec3 m){
  float r=length(m.xy);
  if(r>.26) return (length(m)-.2)*COIN_SCALE;                   // дёшево вдали
  float d=max(r-.172,abs(m.z)-.024)-.012;           // диск со скруглённым ребром
  d=smin(d,length(vec2(r-.158,m.z-.03))-.014,.008); // выпуклый ободок
  d-=(1.-r*r/.0196)*.012*step(r,.14)*step(0.,m.z);  // поле выпуклое, как у монеты
  float A=logoA(m.xy/.21)*.21;
  d-=smoothstep(.003,-.003,A)*.008*step(0.,m.z)*step(r,.14);   // выпуклая «А»
  return d*COIN_SCALE;
}
float specs(vec3 h) {
  if(uAcc<1.5) return 1000.0;
  float s=faceScale(), y=1.24+(1.308-1.24)*s, z=0.466+(headRadii().z-RADII.z);
  vec3 q=vec3(abs(h.x-HEAD.x),h.y,h.z);
  vec3 l=q-vec3(0.247*s,y,z);
  float bridge=capsule(q,vec3(0.0,y+0.005,z+0.021),vec3(0.105*s,y+0.002,z+0.012),0.017*s);
  if(uAcc<2.5) {
    float lens=ellipse(l,vec3(0.154*s,0.105*s,0.037))+max(0.0,l.y-0.050*s)*0.5;
    return min(lens,bridge);
  }
  float ring=length(vec2(length(l.xy)-0.143*s,l.z))-0.015*s;
  return min(ring,bridge);
}
// Materials: 1 torso/head, 2 ink, 3 gold, 4 coin, 5 limbs, 6 glasses.
vec2 scene(vec3 p) {
  vec3 h=headPoint(p-vec3(0.0,0.270,0.0));
  float hd=headShape(h),bd=bodyShape(p);
  float core=smin(smin(hd,bd,0.024),neckShape(p),0.067);
  vec3 arm=p-vec3(0.505,1.035,0.100);
  // The raised arm waves forward and back (around X), not side to side.
  arm.yz=rot(-uWave)*arm.yz; arm+=vec3(0.505,1.035,0.100);
  float right=raisedArm(arm-vec3(0.018,0.270,0.047));
  float left=loweredArm(p);
  // Blend into the torso only at the shoulders, never into the face or cheeks.
  float rightShoulder=1.0-smoothstep(1.075,1.205,p.y);
  float leftShoulder=smoothstep(0.765,0.930,p.y);
  float attachment=min(smin(bd,right,0.001+0.034*rightShoulder),smin(bd,left,0.001+0.030*leftShoulder));
  vec2 hit=vec2(min(core,attachment),1.0);
  // Hard minima preserve the natural contact crease where a paw touches the head.
  float limb=min(left,right);
  if(limb<hit.x+0.00008) hit=vec2(min(hit.x,limb),5.0);
  float s=faceScale();
  vec3 noseAt=vec3(HEAD.x,1.24+(1.168-1.24)*s,0.483+headRadii().z-RADII.z);
  vec3 noseSize=uVariant<0.5?vec3(0.061,0.054,0.034):vec3(0.043,0.037,0.027);
  float nose=ellipse(h-noseAt,noseSize);
  if(nose<hit.x) hit=vec2(nose,2.0);
  float c=collar(p);
  c=min(c,capsule(p,vec3(0.034,1.048,0.350),vec3(0.034,1.040,0.410),0.018));
  if(c<hit.x) hit=vec2(c,3.0);
  // Монетка с «А» у всей команды: это знак «мы из Альфы». Очки (acc 2 и 3) надеваются отдельно.
  { float m=coinShape(coinPoint(p)); if(m<hit.x) hit=vec2(m,4.0); }
  float glasses=specs(h); if(glasses<hit.x) hit=vec2(glasses,6.0);
  return hit;
}
vec3 toLocal(vec3 p) {
  p.y-=1.13; p.xz=rot(-uRotation.x)*p.xz; p.yz=rot(-uRotation.y)*p.yz; p.xy=rot(-uRotation.z)*p.xy; p.y+=1.13;
  float stretch=1.0+uSquash; p.y/=stretch; p.xz*=sqrt(stretch); return p;
}
vec3 directionLocal(vec3 d) { d.xz=rot(-uRotation.x)*d.xz; d.yz=rot(-uRotation.y)*d.yz; d.xy=rot(-uRotation.z)*d.xy; return d; }
vec3 directionWorld(vec3 d) { d.xy=rot(uRotation.z)*d.xy; d.yz=rot(uRotation.y)*d.yz; d.xz=rot(uRotation.x)*d.xz; return d; }
vec3 normalAt(vec3 p) {
  vec2 e=vec2(1.0,-1.0)*0.00065;
  return normalize(e.xyy*scene(p+e.xyy).x+e.yyx*scene(p+e.yyx).x+e.yxy*scene(p+e.yxy).x+e.xxx*scene(p+e.xxx).x);
}
float ambientOcclusion(vec3 p,vec3 n){
  float o=0.,s=1.;
  for(int i=1;i<6;i++){float h=.012+.045*float(i);o+=(h-scene(p+n*h).x)*s;s*=.72;}
  return clamp(1.-1.6*o,0.,1.);
}
float softShadow(vec3 p,vec3 l){
  float r=1.,t=.02;
  for(int i=0;i<28;i++){
    float h=scene(p+l*t).x;
    r=min(r,9.*h/t);
    t+=clamp(h,.012,.12);
    if(r<.01||t>1.6)break;
  }
  return clamp(r,0.,1.);
}
float faceInk(vec3 h,float px) {
  if(uVariant>0.5) { float s=faceScale(); h.x=HEAD.x+(h.x-HEAD.x)/s; h.y=1.24+(h.y-1.24)/s; px/=s; }
  if(h.z<0.24||h.y<0.92||h.y>1.42) return 0.0;
  vec2 f=vec2(abs(h.x-HEAD.x),h.y);
  float eye=bezier(f,vec2(0.172,1.292),vec2(0.247,1.365),vec2(0.324,1.292))-0.0135;
  float mouth=bezier(f,vec2(0.0,1.022),vec2(0.139,0.860),vec2(0.188,1.025))-0.014;
  float stem=bezier(f,vec2(0.0,1.138),vec2(0.009,1.064),vec2(0.0,1.022))-0.013;
  return 1.0-smoothstep(-px,px,min(eye,min(mouth,stem)));
}
float earInk(vec3 h,float px) {
  vec3 e=earPoint(h);
  float inner=uVariant<0.5?cone(e.xy-vec2(0.0,0.072),0.145,0.033,0.187):cone(e.xy-vec2(0.0,0.072),0.127,0.028,0.159);
  float exposed=ellipse(h-HEAD,headRadii())-earShape(e);
  return (1.0-smoothstep(-px,px,inner))*smoothstep(0.006,0.020,e.z)*smoothstep(-0.004,0.008,exposed);
}
float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123); }
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
float n2(vec2 p);
vec3 shade(vec3 pw,vec3 rd,float id,float px){
  vec3 p=toLocal(pw);
  vec3 nl=normalAt(p);
  vec3 n=directionWorld(nl);
  vec3 v=-rd;
  vec3 L1=normalize(vec3(-.55,.75,.62)), L2=normalize(vec3(.85,.12,.35)), L3=normalize(vec3(.55,.45,-.75));
  float occ=ambientOcclusion(p,nl);
  float sh=softShadow(p+nl*.004,directionLocal(L1));
  float ndv=max(dot(n,v),0.);
  float fr=pow(1.-ndv,4.);
  vec3 r=reflect(rd,n);
  vec3 c;
  float lum=dot(uFur,vec3(.3,.59,.11));
  if(id<2.5||(id>4.5&&id<5.5)){
    vec3 q=vec3(abs(p.x),p.y,p.z);
    vec3 h=headPoint(p-vec3(0.0,0.270,0.0));
    vec3 base=uFur;
    // серединка ушей и мордочка
    float ie=id>4.5?0.0:earInk(h,px);
    base=mix(base,lum<.06?vec3(.30,.025,.02):vec3(.05,.012,.012),ie);
    float ink=id>4.5?0.0:(id>1.5?1.0:faceInk(h,px));
    base=mix(base,lum<.06?vec3(.72,.70,.68):vec3(.014,.006,.006),ink);
    // складочки между пальчиками на ступнях и опущенной лапке
    vec3 f=q-vec3(.234,.112,.321);
    float cr=smoothstep(.012,.0,abs(abs(f.x)-.0435))*smoothstep(.12,.19,f.z)*smoothstep(.06,-.01,f.y);
    if(uVariant<0.5) base*=1.-.4*cr;
    // пластилин: заметная ручная лепка и мелкие вмятины от пальцев
    float micro=.055, mf=22.;
    vec3 nb=normalize(n+micro*(vec3(n2(p.xy*mf),n2(p.yz*mf+3.),n2(p.zx*mf+7.))-.5));
    float dif=max(dot(nb,L1),0.);
    float wrap=max(0.,(dot(nb,L1)+.5)/1.5);
    float key=mix(wrap,dif,.55)*mix(.35,1.,sh);
    float fill=max(0.,(dot(nb,L2)+.3)/1.3);
    float sky=.5+.5*nb.y;
    vec3 diff=key*vec3(1.,.95,.9)*1.25+fill*vec3(.75,.7,1.)*.35+sky*vec3(.38,.34,.45)*.5+vec3(.05,.04,.05);
    c=base*diff*mix(.3,1.,occ);
    // подповерхностное: в тенях цвет уходит в насыщенный красный, а не в бурый
    c+=base*base*vec3(1.4,.5,.45)*.35*(1.-key)*occ;
    // мягкий матовый блик, бархатистый край, контровой; у пластилина блик почти гаснет
    float gl=mix(1.,.5,max(ink,ie))*.2;
    vec3 hv=normalize(L1+v);
    float nh=max(dot(nb,hv),0.);
    c+=vec3(1.,.96,.94)*(pow(nh,24.)*.14+pow(nh,5.)*.04)*sh*gl*occ;
    c+=env(r)*(.012+.1*fr)*gl*occ;
    c+=fr*base*vec3(1.,.7,.8)*.35*occ;
    c+=pow(max(dot(n,L3),0.),4.)*vec3(1.,.6,.8)*.3*occ;
    c*=vec3(1.05,1.0,.94);
  } else if(id<4.5){
    // золото: металл по Френелю - цвет только из окраскенных отражений, без диффуза
    vec3 m=coinPoint(p);
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
      // блик пробегает по монете раз в пять секунд
      float k=fract(uTime/5.0)*3.0;
      float pos=mix(-.30,.30,k);
      float sweep=exp(-pow((m.x*.72+m.y*.70-pos)/.032,2.))*step(k,1.)*step(rr,.19);
      g+=vec3(1.,.93,.76)*sweep*1.5;
    }
    c=g;
  } else {
    c=vec3(.012,.012,.016)+env(r)*(.06+.5*fr)+vec3(1.)*pow(max(dot(r,L1),0.),50.)*1.2;
  }
  return c/(1.0+0.05*c);
}
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*n2(p);p=mat2(1.6,1.2,-1.2,1.6)*p;a*=.5;}return s;}


float sdSeg2(vec2 p,vec2 a,vec2 b){return segment(p,a,b);}
float band(vec2 p,vec2 a,vec2 b,float w){return sdSeg2(p,a,b)-w;}
vec3 marble(vec2 p,vec3 fur){
  vec2 w=p*2.2+vec2(uTime*.03,-uTime*.02);
  vec2 q=vec2(fbm(w),fbm(w+vec2(5.2,1.3)));
  float f=fbm(w+3.*q+vec2(uTime*.04,0.));
  // Буква светится чуть сильнее фона, иначе на тёмной шерсти она пропадает.
  vec3 deep=pal(fur,-.04,.95,.95,.45), mid=pal(fur,.04,.86,1.,.45), light=pal(fur,.14,.62,1.,.45);
  vec3 c=mix(deep,mid,smoothstep(.35,.72,q.x));
  c=mix(c,light,smoothstep(.46,.8,f));
  return c;
}
vec3 background(vec2 fc){
  vec2 uv=fc/uResolution;
  float ar=uResolution.x/uResolution.y;
  vec2 p=vec2(uv.x*ar,uv.y);
  // Цвет фона — не маска сверху, а перекрашенная палитра самого кота.
  vec3 fur=curFurSrgb();
  vec3 c1=pal(fur,.00,.95,.95,1.0), c2=pal(fur,.10,.84,.96,1.0), c3=pal(fur,.20,.54,.99,1.0);
  vec3 col=mix(c1,c2,smoothstep(0.,1.,uv.x*.7+uv.y*.5));
  col=mix(col,c3,smoothstep(.55,1.2,uv.x+uv.y*.3)*.62);
  // В середине перелива цвет уходит в светлую дымку: переход читается волной, а не радугой.
  col=mix(col,vec3(1.0),.46*sin(clamp(uFurMix,0.,1.)*3.14159265));
  col*=1.+.045*sin(vec3(0.,2.,4.)+uTime*.25+uv.x*3.+uv.y*2.);
  // Буква «А» за котом: вершина и перекладина видны, ноги уходят за нижний край и растворяются.
  float cx=uCenter.x/uResolution.y;
  vec2 ap=vec2(cx+.012,.90);
  float w=.072;
  vec2 leg=vec2(.46,-.94);
  float d=band(p,ap,ap+leg*vec2(-1.,1.),w);
  d=min(d,band(p,ap,ap+leg,w));
  float barY=ap.y-.50, barX=.50*.46/.94;
  d=min(d,band(p,vec2(ap.x-barX,barY),vec2(ap.x+barX,barY),w*.82));
  // низ ног тает над лапами кота: буква читается, а нижний край сцены чистый
  float feetY=uCenter.y/uResolution.y;
  float fade=smoothstep(feetY+.02,feetY+.22,uv.y);
  float m=smoothstep(.004,-.004,d)*fade;
  if(m>0.) col=mix(col,marble(p,fur),.70*m);
  col*=1.-.07*smoothstep(.06,0.,d)*(1.-m)*fade;
  col+=.06*smoothstep(.25,0.,abs(uv.x*.6-uv.y+.35));
  // Тёплый ореол за котом: сцена как будто подсвечена на него.
  vec2 cc=(fc-(uCenter+vec2(0.,uScale*1.05)))/uScale;
  col=mix(col,vec3(1.,.97,.95),.16*exp(-dot(cc,cc)/.9));
  // Искорки: медленно всплывают и мерцают, у каждой свой ритм.
  for(int i=0;i<6;i++){
    float fi=float(i);
    float sx=hash(vec2(fi,3.1)), sp=.010+.014*hash(vec2(fi,7.7));
    float y=fract(hash(vec2(fi,5.3))+uTime*sp);
    vec2 sc=vec2(sx*ar+.03*sin(uTime*.4+fi*1.7),y*1.1-.05);
    vec2 sd=p-sc;
    float sz=.0045+.006*hash(vec2(fi,9.1));
    float tw=.5+.5*sin(uTime*(1.1+hash(vec2(fi,2.2)))+fi*2.3);
    float life=smoothstep(0.,.18,y)*smoothstep(1.,.75,y);
    float star=exp(-length(sd)/sz)*.55+exp(-abs(sd.x*sd.y)/(sz*sz*.06))*exp(-length(sd)/(sz*3.5))*.7;
    col+=vec3(1.,.98,.96)*star*tw*life*.55;
  }
  return col;
}


void main() {
  vec2 fc=gl_FragCoord.xy;
  vec2 screen=(fc-uCenter)/uScale;
  float alpha=uBackground;
  vec3 color=uBackground>0.5?pow(background(fc),vec3(2.2)):vec3(0.0);
  // Match the previous backdrop's tone mapping while keeping the reference model.
  color=color/(1.0+0.05*color);
  if(uBackground>0.5) {
    float nearShadow=length((screen-vec2(0.0,0.01))/vec2(0.52,0.05));
    float softShadow=length((screen-vec2(0.0,0.02))/vec2(0.85,0.16));
    color*=mix(1.0,(1.0-0.5*(1.0-smoothstep(0.2,1.0,nearShadow)))*(1.0-0.18*(1.0-smoothstep(0.0,1.0,softShadow))),uShadow);
  }
  vec3 origin=vec3(screen,5.0);
  vec3 ray=normalize(vec3((screen-vec2(0.0,1.13))*0.008,-1.0));
  vec3 oc=origin-vec3(0.0,1.13,0.0);
  float b=dot(oc,ray),disc=b*b-dot(oc,oc)+1.30*1.30;
  if(uDrawModel>0.5&&disc>0.0) {
    float t=-b-sqrt(disc),end=-b+sqrt(disc),nearest=10.0,nearT=t;
    vec2 hit=vec2(0.0); bool found=false;
    for(int i=0;i<150;i++) {
      hit=scene(toLocal(origin+ray*t));
      if(hit.x<nearest) { nearest=hit.x; nearT=t; }
      if(hit.x<0.00035) { found=true; break; }
      t+=max(hit.x*0.72,0.00012); if(t>end) break;
    }
    float px=0.62/uScale;
    if(found) { color=shade(origin+ray*t,ray,hit.y,px); alpha=1.0; }
    else if(nearest<1.15/uScale) {
      vec3 p=origin+ray*nearT;
      vec3 edge=shade(p,ray,scene(toLocal(p)).y,px);
      float coverage=1.0-smoothstep(0.0,1.15/uScale,nearest);
      color=uBackground>0.5?mix(color,edge,coverage):edge;
      alpha=max(alpha,coverage);
    }
  }
  color=color/(1.0+0.07*color);
  color=pow(max(color,0.0),vec3(1.0/2.2));
  if(max(color.r,max(color.g,color.b))>0.02) color+=(hash(fc)-0.5)/700.0;
  gl_FragColor=vec4(color,alpha);
}
`;
  const glCanvas = document.createElement('canvas');
  const stages = new Set();
  const stageByElement = new WeakMap();
  const imageCache = new Map();
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let renderer = null, unavailable = false, contextEventsAttached = false;
  let raf = 0, lastPaint = 0;

  function fallbackImage(kind = 'alfi', variant = DEFAULT_VARIANT, focus = 'full') {
    variant = variantIndex(variant,DEFAULT_VARIANT);
    const color = (KINDS[kind] || KINDS.alfi).fur;
    const highlight = '#'+[1,3,5].map(i => Math.round(parseInt(color.slice(i,i+2),16)*0.55+255*0.45).toString(16).padStart(2,'0')).join('');
    const bodyWidth = [120,114,125,106][variant];
    const pawWidth = [44,40,42,38][variant];
    const footWidth = [42,42,46,39][variant];
    const scale = [1,.94,.85,.90][variant];
    const ink = kind === 'money' ? '#eee5df' : '#30201d';
    const face = `<g transform="translate(148 185) scale(${scale}) translate(-148 -185)"><g fill="none" stroke="${ink}" stroke-width="${variant===0?8:6}" stroke-linecap="round"><path d="M82 153Q104 133 124 155M189 161Q212 141 234 165M145 198 141 223Q114 252 99 224M141 223Q165 258 191 233"/></g><ellipse cx="147" cy="188" rx="${variant===0?15:10}" ry="${variant===0?14:9}" fill="${ink}"/></g>`;
    const medal = `<g transform="translate(148 330) scale(.84) translate(-148 -351)"><circle cx="148" cy="351" r="60" fill="#7b2d16" opacity=".18" transform="translate(3 4)"/><circle cx="148" cy="351" r="60" fill="url(#gold)"/><circle cx="148" cy="351" r="47" fill="none" stroke="#a56918" stroke-width="1.2"/><path fill="#ef3124" fill-rule="evenodd" d="M126 365 143 321Q148 311 153 321L172 365H158L153 352H141L137 365ZM144 341H152L148 328Z"/><path d="M132 375h33v8h-33z" fill="#ef3124"/></g>`;
    const glasses = kind === 'tax' ? '<g fill="none" stroke="#312a29" stroke-width="7"><circle cx="102" cy="157" r="25"/><circle cx="209" cy="163" r="25"/><path d="M127 157h57"/></g>' : kind === 'money' ? '<g fill="#252328"><rect x="73" y="141" width="59" height="37" rx="12"/><rect x="181" y="147" width="59" height="37" rx="12"/><path d="M130 153h55v8h-55z"/></g>' : '';
    const details = variant===0 ? '<g stroke="#b92d20" stroke-width="2" fill="none" opacity=".5" stroke-linecap="round"><path d="M284 203v10M304 205v9M45 375l-8 6M44 388l-9 5M77 430v31M101 430v32M192 430v32M218 430v32"/></g>' : '';
    const headScale = variant===2 ? 'translate(-8 -5) scale(1.055)' : variant===3 ? 'translate(4 4) scale(.976)' : '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${focus==='feet'?'0 290 360 190':'0 0 360 480'}"><defs><linearGradient id="red" x1=".1" y1="0" x2=".9" y2="1"><stop stop-color="${highlight}"/><stop offset=".32" stop-color="${color}"/><stop offset="1" stop-color="${color}"/></linearGradient><linearGradient id="gold" x1="0" y1="0" x2=".7" y2="1"><stop stop-color="#fff4ce"/><stop offset=".25" stop-color="#f6d479"/><stop offset=".65" stop-color="#d9a742"/><stop offset="1" stop-color="#ad771c"/></linearGradient></defs><g fill="url(#red)"><ellipse cx="149" cy="350" rx="${bodyWidth}" ry="113"/><path d="M244 309C277 326 295 279 303 231L310 186C303 161 273 159 261 188L251 228C245 260 229 291 244 309Z"/><path d="M79 273C33 282 17 323 24 367L65 382 94 307Z"/></g><g transform="${headScale}"><path fill="url(#red)" d="M30 108C51 63 91 24 112 20 130 15 132 44 151 56 178 69 207 60 230 42 251 20 281 59 292 101 326 204 282 267 155 274 35 280-16 192 30 108Z"/><path d="M67 79Q91 34 112 31L135 63Z" fill="#35201c"/><path d="M207 68Q235 36 243 47L269 113Z" fill="#35201c"/>${face}${glasses}</g><path d="M65 263Q152 284 239 267L237 287Q149 306 66 285Z" fill="url(#gold)"/>${medal}<g fill="url(#red)"><ellipse cx="296" cy="184" rx="${pawWidth}" ry="${variant===0?41:38}"/><ellipse cx="34" cy="376" rx="${variant===3?32:36}" ry="${variant===0?40:37}"/><ellipse cx="90" cy="448" rx="${footWidth}" ry="30"/><ellipse cx="205" cy="448" rx="${footWidth+1}" ry="30"/>${variant===3?'<ellipse cx="278" cy="200" rx="16" ry="18"/>':''}</g>${details}</svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function createRenderer() {
    const gl = glCanvas.getContext('webgl', { alpha:true,premultipliedAlpha:false,antialias:false,preserveDrawingBuffer:false,powerPreference:'high-performance',failIfMajorPerformanceCaveat:true });
    if (!gl) return null;
    const compile = (type, source) => {
      const shader = gl.createShader(type); gl.shaderSource(shader,source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) {
        console.error('Alfi reference shader:',gl.getShaderInfoLog(shader)); gl.deleteShader(shader); return null;
      }
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER,VS); if (!vertex) return null;
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    const programs = new Map();
    const uniformNames = ['uResolution','uRotation','uCenter','uScale','uTime','uBackground','uDrawModel','uSquash','uWave','uFur','uFurFrom','uFurMix','uAcc','uTilt','uShadow'];
    function programFor(variant) {
      const key = String(variant);
      if (programs.has(key)) return programs.get(key);
      // геометрия зависит от варианта, цвета приходят юниформами
      const source = FS.replace('uniform float uVariant;','const float uVariant = '+variant.toFixed(1)+';');
      const fragment = compile(gl.FRAGMENT_SHADER,source); if (!fragment) return null;
      const program = gl.createProgram(); gl.attachShader(program,vertex); gl.attachShader(program,fragment);
      gl.bindAttribLocation(program,0,'aPosition'); gl.linkProgram(program); gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program,gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(program));gl.deleteProgram(program);return null; }
      const U = Object.fromEntries(uniformNames.map(name=>[name,gl.getUniformLocation(program,name)]));
      const entry = { program,U }; programs.set(key,entry); return entry;
    }
    if (!contextEventsAttached) {
      contextEventsAttached = true;
      glCanvas.addEventListener('webglcontextlost',event=>{
        event.preventDefault();unavailable=true;renderer=null;
        for (const s of stages) showFallback(s); syncLoop();
      });
      glCanvas.addEventListener('webglcontextrestored',()=>{
        unavailable=false;renderer=null;
        for (const s of stages) { s.fallback=false;s.bgAt=null;paint(s,performance.now(),false); }
        syncLoop();
      });
    }
    return {
      canvas:glCanvas,
      draw({width,height,cx,cy,scale,time=3,background=false,drawModel=true,pose=DEFAULT_POSE,material=materialFor('alfi'),materialFrom=null,colorMix=1,variant=DEFAULT_VARIANT,shadow=1}) {
        const entry = programFor(variant);
        if (!entry) { unavailable=true;renderer=null;return false; }
        if (glCanvas.width<width) glCanvas.width=width;
        if (glCanvas.height<height) glCanvas.height=height;
        const U = entry.U;
        gl.useProgram(entry.program);gl.viewport(0,0,width,height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform2f(U.uResolution,width,height);gl.uniform2f(U.uCenter,cx,cy);gl.uniform1f(U.uScale,scale);gl.uniform1f(U.uTime,time);
        gl.uniform1f(U.uBackground,background?1:0);gl.uniform1f(U.uDrawModel,drawModel?1:0);
        gl.uniform3f(U.uRotation,pose.yaw,pose.pitch,pose.roll);gl.uniform1f(U.uSquash,pose.squash);gl.uniform1f(U.uWave,pose.wave);
        gl.uniform3fv(U.uFur,material.fur);
        gl.uniform3fv(U.uFurFrom,(materialFrom||material).fur);
        gl.uniform1f(U.uFurMix,Math.max(0,Math.min(1,colorMix)));
        gl.uniform1f(U.uAcc,material.acc);
        gl.uniform1f(U.uTilt,pose.tilt||0);
        gl.uniform1f(U.uShadow,shadow);
        gl.drawArrays(gl.TRIANGLES,0,3);return true;
      },
      blit(ctx,width,height,destination) {
        const d=destination||{x:0,y:0,width,height};
        ctx.drawImage(glCanvas,0,glCanvas.height-height,width,height,d.x,d.y,d.width,d.height);
      }
    };
  }
  function getRenderer() {
    if (unavailable) return null;
    if (!renderer) { renderer = createRenderer(); if (!renderer) unavailable = true; }
    return renderer;
  }
  function img(kind = 'alfi', size = 160, options = {}) {
    const variant = variantIndex(options.variant,DEFAULT_VARIANT), focus = options.focus || 'full';
    if (options.forceFallback) return fallbackImage(kind,variant,focus);
    const width = Math.max(MODEL_RENDER_SIZE,Math.min(1024,Math.round(size*2)));
    const key = kind + ':' + width + ':' + JSON.stringify(options);
    if (imageCache.has(key)) return imageCache.get(key);
    const R = getRenderer(); if (!R) return fallbackImage(kind,variant,focus);
    const height = focus === 'feet' ? Math.round(width*0.62) : width;
    const out = document.createElement('canvas'); out.width=width;out.height=height;
    const ctx = out.getContext('2d');
    const pose = { ...DEFAULT_POSE, ...options };
    const view = focus === 'feet' ? { cx:width*0.50,cy:height*0.22,scale:width*0.95 } : { cx:width*0.46,cy:width*0.08,scale:width*0.90/HEIGHT };
    if (!R.draw({ width,height,...view,pose,material:materialFor(kind),variant,time:options.time ?? 3 })) return fallbackImage(kind,variant,focus);
    R.blit(ctx,width,height);
    const source = out.toDataURL('image/png');
    if (imageCache.size >= 64) imageCache.delete(imageCache.keys().next().value);
    imageCache.set(key,source); return source;
  }

  function showFallback(s) {
    s.fallback = true; s.el.classList.remove('is-nogl'); s.canvas.hidden = true;
    if (!s.fallbackImage) {
      const image = new Image(); image.alt = ''; image.setAttribute('aria-hidden','true');
      image.src = fallbackImage(s.kind,s.variant); image.className = 'mascot-reference-fallback';
      image.style.cssText = 'position:absolute;z-index:-1;pointer-events:none;user-select:none;max-width:none;';
      s.el.prepend(image); s.fallbackImage = image;
    }
    const width = s.size * 360 / 480;
    s.fallbackImage.hidden = false;
    s.fallbackImage.style.width = width + 'px'; s.fallbackImage.style.height = s.size + 'px';
    s.fallbackImage.style.left = (s.ax-width*0.43) + 'px'; s.fallbackImage.style.top = (s.ay-s.size) + 'px';
    s.canvas.dataset.renderer = 'svg'; s.canvas.dataset.ready = 'true';
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // Живость: дыхание, моргание, подёргивание уха, наклон головы и румянец.
  // У каждого движения свой случайный таймер, поэтому кот не выглядит зацикленным.
  function updatePose(s, now, animate) {
    // Перерисовка без анимации (ресайз, перенос узла) держит текущую позу: иначе кот дёргается в исходную.
    if (motion.matches || (!animate && !s.pose)) { s.pose = { ...DEFAULT_POSE }; s.last = now; return; }
    if (!animate) { s.last = now; return; }
    const t = (now-s.t0)/1000, dt = Math.min(0.05,(now-(s.last || now))/1000); s.last = now;
    let yaw=DEFAULT_POSE.yaw+Math.sin(t*0.37)*0.020, pitch=DEFAULT_POSE.pitch+Math.sin(t*0.23)*0.012;
    let lean = 0;
    if (s.pointer && now-s.pointerAt < 4000) {
      if (now - (s.rectAt || 0) > 250) { s.rect = s.el.getBoundingClientRect(); s.rectAt = now; }
      const dx = (s.pointer.x-s.rect.left-s.ax)/420;
      const dy = (s.pointer.y-s.rect.top-(s.ay-s.size*0.65))/420;
      yaw=DEFAULT_POSE.yaw+clamp(-dx*0.30,-0.10,0.10);
      pitch=DEFAULT_POSE.pitch+clamp(dy*0.22,-0.07,0.07);
      lean = clamp(-dx*0.10,-0.05,0.05);
    }
    const k = Math.min(1,dt*5);
    s.pose.yaw += (yaw-s.pose.yaw)*k;
    s.pose.pitch += (pitch-s.pose.pitch)*k;
    s.velocity += (-s.squash*140-s.velocity*10)*dt;
    s.squash = clamp(s.squash+s.velocity*dt,-0.085,0.065);
    const happy = now < s.happyUntil, hover = !!s.hover;
    s.pose.squash = s.squash+Math.sin(t*2.1)*0.006;
    s.pose.roll = Math.sin(t*0.8)*0.006;
    // Мах лапкой: фаза накапливается, чтобы смена темпа не давала рывка.
    const waveAmp = happy ? 0.09 : hover ? 0.065 : 0.025, waveRate = happy ? 5.2 : hover ? 4.0 : 2.4;
    s.waveAmp = (s.waveAmp ?? waveAmp) + (waveAmp - (s.waveAmp ?? waveAmp))*Math.min(1,dt*4);
    s.wavePh = (s.wavePh || 0) + dt*waveRate;
    s.pose.wave = Math.sin(s.wavePh)*s.waveAmp;
    // Без моргания и дёрганья ушей: спокойный кот читается дороже.
    s.pose.blink = 0; s.pose.ear = 0;
    // Голова наклоняется только в ответ на курсор и радость.
    const tilt = lean + (happy || hover ? 0.07 : 0);
    s.pose.tilt += (tilt - s.pose.tilt)*Math.min(1,dt*(happy ? 6 : 3));
  }
  // ---------- Смена персонажа: перелив краской ----------
  // Новый цвет стекает сверху вниз одной густой волной с подтёками и заливает
  // всю сцену вместе с котом. Сам кот не крутится и не прыгает: под краской уже
  // стоит новый, живой и в своей позе. Рисунок подтёков у каждого помощника свой
  // и не меняется от раза к разу: он считается из имени.
  const easeOut3 = x => 1 - Math.pow(1 - x, 3);
  const easeInOut = x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  const SWAP_MS = 980, PLOP_AT = 0.86;
  function dripsFor(kind) {
    let h = 2166136261;
    for (const ch of String(kind)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0) / 4294967296);
    const n = 4 + Math.floor(rnd() * 2), drips = [];
    for (let i = 0; i < n; i++) drips.push({ x: (i + 0.25 + rnd() * 0.5) / n, len: 0.07 + rnd() * 0.11, w: 0.04 + rnd() * 0.035, lag: rnd() * 0.12 });
    return { drips, phase: rnd() * 6.28 };
  }
  // Край краски: плавная волна и капли, которые убегают вперёд и к концу догоняются.
  function paintEdge(sw, u, w, h) {
    const k = easeInOut(u), base = -0.24 * h + k * 1.32 * h, pts = [];
    for (let i = 0; i <= 64; i++) {
      const x = i / 64;
      let y = base + Math.sin(x * 7.2 + sw.phase + u * 2.4) * 0.016 * h + Math.sin(x * 15.5 - sw.phase) * 0.006 * h;
      for (const d of sw.drips) {
        const reach = d.len * h * Math.sin(Math.PI * clamp((u - d.lag) / (1 - d.lag), 0, 1));
        const q = (x - d.x) / d.w;
        // Капля: узкая шейка и круглый кончик, без прямых стенок.
        y += reach * Math.exp(-q * q * 1.6);
      }
      pts.push([x * w, y]);
    }
    return pts;
  }
  function drawCat(s, img) {
    if (!img) return;
    const D = s.dpr, side = s.size / 0.90 * D, c = s.ctx;
    c.save(); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.drawImage(img, 0, 0, img.width, img.height, s.ax * D - side * 0.46, s.ay * D - side * 0.92, side, side);
    c.restore();
  }
  const cloneCanvas = src => { const c = document.createElement('canvas'); c.width = src.width; c.height = src.height; c.getContext('2d').drawImage(src, 0, 0); return c; };

  // ---------- Сердечки: только на тык по коту, два штучки и без вспышек ----------
  function burst(s) {
    const now = performance.now(), x0 = s.ax + s.size * 0.12, y0 = s.ay - s.size * 0.98;
    for (let i = 0; i < 2; i++) s.parts.push({ x: x0 + s.size * (i ? 0.08 : -0.06), y: y0, vy: -46 - i * 8, size: 7 + i * 1.5, life: 1300, color: i ? '#FFFFFF' : '#FF9AAE', t0: now + i * 160 });
  }
  function drawParticles(s, now) {
    if (!s.parts.length) return;
    const D = s.dpr, c = s.ctx, dt = Math.min(0.05, (now - (s.partAt || now)) / 1000); s.partAt = now;
    s.parts = s.parts.filter(p => now - p.t0 < p.life);
    for (const p of s.parts) {
      const a = (now - p.t0) / p.life;
      if (a < 0) continue;
      p.y += p.vy * dt;
      const r = p.size * D * (a < 0.2 ? easeOut3(a / 0.2) : 1);
      c.save(); c.translate(p.x * D, p.y * D); c.globalAlpha = 1 - a * a; c.fillStyle = p.color;
      c.beginPath(); c.moveTo(0, r * 0.75);
      c.bezierCurveTo(-r * 1.25, -r * 0.05, -r * 0.6, -r * 1.05, 0, -r * 0.42);
      c.bezierCurveTo(r * 0.6, -r * 1.05, r * 1.25, -r * 0.05, 0, r * 0.75);
      c.fill(); c.restore();
    }
  }

  function paint(s, now, animate) {
    if (s.destroyed) return;
    updatePose(s,now,animate);
    if (s.forceFallback) { showFallback(s); return; }
    const R = getRenderer(); if (!R) { showFallback(s); return; }
    s.fallback = false; s.canvas.hidden = false;
    if (s.fallbackImage) s.fallbackImage.hidden = true;
    const width = s.canvas.width, height = s.canvas.height, D = s.dpr;

    // Перелив палитры фона: пока идёт, фон пересобирается каждый кадр.
    if (s.colorFrom && !motion.matches) {
      const k = Math.min(1, (now - s.colorT0) / COLOR_MORPH_MS);
      s.colorMix = k * k * (3 - 2 * k);
      if (k >= 1) { s.colorFrom = null; s.colorMix = 1; }
      s.bgAt = null;
    }

    if (s.swap && (motion.matches || now - s.swap.t0 >= SWAP_MS)) { s.swap = null; s.bgAt = null; }
    const swap = s.swap, u = swap ? clamp((now - swap.t0) / SWAP_MS, 0, 1) : 1;
    // Краска дошла до лап: кот чуть приседает, будто на него плюхнулся цвет.
    if (swap && !swap.plop && u >= PLOP_AT) { swap.plop = true; s.velocity -= 0.9; }

    const base = { width,height,cx:s.ax*D,cy:(s.h-s.ay)*D,scale:s.size/HEIGHT*D,time:motion.matches ? 3 : (now-s.t0)/1000,pose:s.pose,variant:s.variant };
    const bgTarget = s.bgTarget || s.material;

    // Слой без фона не рисует подложку.
    s.ctx.clearRect(0,0,width,height);
    if (!s.bare) {
      if (swap || s.bgAt === null || (!motion.matches && now - s.bgAt > 33)) {
        if (!R.draw({ ...base, background:true, drawModel:false, material:bgTarget, materialFrom:s.colorFrom || bgTarget, colorMix:s.colorMix, shadow:1 })) { showFallback(s); return; }
        s.bgContext.clearRect(0,0,width,height); R.blit(s.bgContext,width,height); s.bgAt = now;
      }
    }

    // Модель можно спрятать на время перехода: её рисует отдельный DOM-слой.
    if (!s.modelVisible) { if (!s.bare) s.ctx.drawImage(s.background,0,0); s.canvas.dataset.ready = 'true'; return; }

    // Модель рисуется в свой холст фиксированного размера и кладётся на сцену одним drawImage.
    const sourceSize=MODEL_RENDER_SIZE;
    const args = { ...base, material:s.material, materialFrom:s.material, colorMix:1 };
    const portrait={...args,width:sourceSize,height:sourceSize,cx:sourceSize*0.46,cy:sourceSize*0.08,scale:sourceSize*0.90/HEIGHT};
    if (!R.draw(portrait)) { showFallback(s); return; }
    s.modelCtx.clearRect(0,0,sourceSize,sourceSize);
    R.blit(s.modelCtx,sourceSize,sourceSize);

    const c = s.ctx;
    if (swap) {
      // Снизу последний кадр старого, сверху под краской новый фон и новый кот.
      c.drawImage(swap.from,0,0);
      const pts = paintEdge(swap, u, width, height);
      const trace = () => { c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]); };
      // Мягкая тень впереди края: у краски появляется толщина.
      c.save(); c.beginPath(); trace(); c.lineJoin = 'round'; c.lineCap = 'round';
      c.strokeStyle = 'rgba(40, 10, 30, .14)'; c.lineWidth = 10 * D; c.translate(0, 4 * D); c.stroke(); c.restore();
      c.save(); c.beginPath(); c.moveTo(0, -1); c.lineTo(width, -1); c.lineTo(width, pts[pts.length - 1][1]);
      for (let i = pts.length - 1; i >= 0; i--) c.lineTo(pts[i][0], pts[i][1]);
      c.closePath(); c.clip();
      if (!s.bare) c.drawImage(s.background,0,0);
      drawCat(s, s.model);
      c.restore();
      // Влажный блик вдоль самой кромки.
      c.save(); c.beginPath(); trace(); c.lineJoin = 'round'; c.lineCap = 'round';
      c.strokeStyle = 'rgba(255, 255, 255, .38)'; c.lineWidth = 2.5 * D; c.translate(0, -3.5 * D); c.stroke(); c.restore();
    } else {
      if (!s.bare) c.drawImage(s.background,0,0);
      drawCat(s, s.model);
    }
    drawParticles(s, now);
    s.canvas.dataset.modelSourceSize=String(sourceSize);
    s.canvas.dataset.variant=String(s.variant);
    s.canvas.dataset.renderer = 'webgl'; s.canvas.dataset.ready = 'true';
  }
  // Запуск смены: снимаем то, что сейчас на сцене, новая модель рисуется живой.
  // Снимок того, что сейчас на сцене (в том числе недолитая прошлая краска), уходит под новую.
  function beginSwap(s, kind) {
    s.swap = { t0: performance.now(), from: cloneCanvas(s.canvas), plop: false, ...dripsFor(kind) };
  }
  const canSwap = s => !motion.matches && !s.fallback && !s.bare && !s.still && s.visible && !s.destroyed;
  function resize(s) {
    if (s.destroyed) return;
    const rect = s.el.getBoundingClientRect(); s.rect = rect; s.w = rect.width; s.h = rect.height;
    const anchor = s.anchor ? s.anchor(rect) : { x:rect.width*0.74,y:rect.height*0.82,size:240 };
    s.ax = anchor.x; s.ay = anchor.y; s.size = anchor.size;
    // Multi-step ray marching: budget fill rate rather than multiplying retina pixels.
    s.dpr = Math.min(devicePixelRatio || 1,2,Math.sqrt(1800000/Math.max(1,s.w*s.h)));
    const width = Math.max(1,Math.round(s.w*s.dpr)),height = Math.max(1,Math.round(s.h*s.dpr));
    if (s.canvas.width !== width) s.canvas.width = width;
    if (s.canvas.height !== height) s.canvas.height = height;
    s.background.width = width; s.background.height = height; s.bgAt = null;
    if (s.visible || s.forceFallback) paint(s,performance.now(),false);
    syncLoop();
  }
  // still: сцена рисуется один раз и не участвует в общем цикле — так переход держит 60 к/с.
  function canAnimate(s) { return !s.destroyed && !s.still && s.visible && !s.fallback && !s.forceFallback && !motion.matches && !document.hidden && !(s.holdUntil > performance.now()); }
  function tick(now) {
    raf = 0;
    if (document.hidden) return;
    // Пока палитра переливается, рисуем чаще: 20 к/с для этого движения мало.
    let morphing = false;
    for (const s of stages) if (s.colorFrom || s.swap || s.parts.length) { morphing = true; break; }
    // 20 к/с для живой сцены читались как рывки: держим 30, а на переливе — 60.
    if (now-lastPaint >= (morphing ? 16 : 33)) {
      lastPaint = now;
      for (const s of stages) if (canAnimate(s)) paint(s,now,true);
    }
    syncLoop();
  }
  function syncLoop() {
    const active = [...stages].some(canAnimate);
    if (!active && raf) { cancelAnimationFrame(raf); raf = 0; }
    else if (active && !raf) raf = requestAnimationFrame(tick);
  }
  const resizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) { const s = stageByElement.get(entry.target); if (s) resize(s); }
  });
  const intersectionObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const s = stageByElement.get(entry.target); if (!s) continue;
      const wasVisible = s.visible; s.visible = entry.isIntersecting;
      if (s.visible && !wasVisible) paint(s,performance.now(),false);
    }
    syncLoop();
  });
  function stage(el, options = {}) {
    const kind = options.kind || 'alfi';
    const existing = stageByElement.get(el); if (existing) existing.api.destroy();
    const canvas = document.createElement('canvas'); canvas.className = 'mascot-canvas';
    canvas.setAttribute('aria-hidden','true'); canvas.style.pointerEvents = 'none';
    canvas.dataset.mascot = 'alfi-reference-20261024-v6'; el.prepend(canvas);
    const background = document.createElement('canvas');
    const model = document.createElement('canvas'); model.width = model.height = MODEL_RENDER_SIZE;
    const s = { el,canvas,ctx:canvas.getContext('2d'),background,bgContext:background.getContext('2d'),bgAt:null,
      model,modelCtx:model.getContext('2d'),swap:null,parts:[],hover:false,
      kind,material:materialFor(kind),variant:variantIndex(options.variant,DEFAULT_VARIANT),anchor:options.anchor,forceFallback:!!options.forceFallback,fallback:false,fallbackImage:null,destroyed:false,
      visible:true,w:0,h:0,dpr:1,ax:0,ay:0,size:240,rect:null,t0:0,last:0,
      pose:{...DEFAULT_POSE},squash:0,velocity:0,happyUntil:0,pointer:null,pointerAt:0,modelVisible:true,
      bare:!!options.bare, still:!!options.still, bgTarget:null, colorFrom:null,colorT0:0,colorMix:1 };
    // Призрак рождается в старом цвете и переливается в новый.
    if (options.morphFrom) {
      const from = materialFor(options.morphFrom);
      if (from) { s.colorFrom = from; s.colorT0 = performance.now(); s.colorMix = 0; }
    }
    const api = {
      poke() { if (!motion.matches && !s.fallback) { s.velocity -= 1.6; s.happyUntil = performance.now()+1400; burst(s); syncLoop(); } },
      // Смена персонажа: новый цвет переливается сверху краской.
      swap(kind) {
        if (typeof kind !== 'string' || !kind) return false;
        if (!canSwap(s)) return api.setKind(kind);
        beginSwap(s, kind);
        s.kind = kind; s.material = materialFor(kind); s.bgTarget = null; s.bgAt = null; s.colorFrom = null; s.colorMix = 1;
        syncLoop(); return true;
      },
      hover(on) { if (s.hover !== !!on) { s.hover = !!on; syncLoop(); } },
      // Сжатие для смены персонажа: в нижней точке силуэт максимально сжат.
      squash(v = 3.2) { if (!motion.matches && !s.fallback) { s.velocity -= Math.abs(v); syncLoop(); } },
      hit(x,y) {
        const u = s.size/HEIGHT,px=(x-s.ax)/u,py=(s.ay-y)/u;
        const inside = (cx,cy,rx,ry) => ((px-cx)/rx)**2+((py-cy)/ry)**2 <= 1;
        return inside(-0.018,1.556,0.66,0.58)||inside(0,0.60,0.61,0.61)||inside(0.70,1.48,0.21,0.20)||inside(0.60,1.17,0.23,0.34)||inside(-0.56,0.60,0.19,0.20);
      },
      head() { const u=s.size/HEIGHT;return { x:s.ax-0.018*u,y:s.ay-1.556*(1+s.pose.squash)*u,r:0.65*u }; },
      // Смена персонажа без пересоздания сцены: меняем материал, холст и фон остаются.
      // Мгновенная смена персонажа: модель и фон переключаются сразу.
      setKind(kind) {
        if (typeof kind !== 'string' || !kind) return false;
        s.kind = kind; s.material = materialFor(kind);
        // Если фон ещё переливается, даём ему договорить: иначе будет рывок в цвет.
        s.bgTarget = null; s.bgAt = null;
        if (!s.colorFrom) s.colorMix = 1;
        paint(s,performance.now(),false); syncLoop(); return true;
      },
      // Только фон: палитра переливается в цвет нового персонажа, модель пока прежняя.
      setBackdrop(kind) {
        const next = materialFor(kind);
        if (!next) return false;
        s.colorFrom = s.bgTarget || s.material;
        s.bgTarget = next; s.colorT0 = performance.now(); s.colorMix = 0; s.bgAt = null;
        paint(s,performance.now(),false); syncLoop(); return true;
      },
      setModelVisible(on) { s.modelVisible = !!on; paint(s,performance.now(),false); syncLoop(); },
      // Снимок позы и метрик: по ним DOM-слой встаёт пиксель в пиксель.
      snapshot() { return { pose:{...s.pose}, x:s.ax, y:s.ay, size:s.size }; },
      relayout() { resize(s); },
      // На время перелёта панели сцена замирает на последнем кадре: главный поток свободен, движение идёт без рывков.
      hold(ms) { s.holdUntil = performance.now() + ms; clearTimeout(s.holdTimer); s.holdTimer = setTimeout(() => { s.holdUntil = 0; s.last = performance.now(); syncLoop(); }, ms + 20); },
      destroy() {
        s.destroyed = true; stages.delete(s); stageByElement.delete(el);
        resizeObserver.unobserve(el); intersectionObserver.unobserve(el);
        canvas.remove(); if (s.fallbackImage) s.fallbackImage.remove(); syncLoop();
      }
    };
    s.api = api; stages.add(s); stageByElement.set(el,s);
    resize(s); resizeObserver.observe(el); intersectionObserver.observe(el);
    return api;
  }
  addEventListener('pointermove', event => {
    if (motion.matches) return;
    const now = performance.now();
    for (const s of stages) if (canAnimate(s)) { s.pointer={x:event.clientX,y:event.clientY};s.pointerAt=now; }
  }, { passive:true });
  document.addEventListener('visibilitychange', () => { syncLoop(); });
  motion.addEventListener('change', () => {
    for (const s of stages) { s.squash=0;s.velocity=0;s.pointer=null;paint(s,performance.now(),false); }
    syncLoop();
  });
  window.Mascot = { ...legacy,stage,img,KINDS,HEIGHT,VARIANTS,defaultVariant:DEFAULT_VARIANT,registerKind,version:'alfi-reference-20261024-v7',fallback:fallbackImage };
})();
