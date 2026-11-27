/* GLSL sources. Every effect defines `vec4 effect(vec2 uv)` returning premultiplied colour. */
(function () {
  const PM = (window.PM = window.PM || {});

  PM.VERT = `
attribute vec2 aPos; attribute vec2 aUv; varying vec2 vUv;
void main(){ vUv = aUv; gl_Position = vec4(aPos.x*2.-1., 1.-aPos.y*2., 0., 1.); }`;

  PM.FRAG_HEAD = `
precision highp float;
varying vec2 vUv;
uniform float uTime, uOpacity, uSpeed, uScale, uReact, uFeather, uBright, uAspect;
uniform vec4 uAudio;
uniform vec3 uA, uB, uC;
uniform float uSpec[32];
uniform sampler2D uTex;
uniform vec2 uFlip;
#define T (uTime*uSpeed)
#define BASS (uAudio.x*uReact)
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x), mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x), f.y); }
float fbm(vec2 p){ float a=.5, s=0.; for(int i=0;i<5;i++){ s+=a*noise(p); p=p*2.02+7.1; a*=.5; } return s; }
float spec(float x){ float fi=clamp(x,0.,.999)*32.; float v=0.;
  for(int i=0;i<32;i++){ if(float(i)<=fi && fi<float(i+1)) v=uSpec[i]; } return v; }
vec3 pal(float t){ t=fract(t)*3.; if(t<1.) return mix(uA,uB,t); if(t<2.) return mix(uB,uC,t-1.); return mix(uC,uA,t-2.); }
`;

  PM.FRAG_MAIN = `
void main(){
  vec4 c = effect(vUv);
  float f = 1.;
  if(uFeather > 0.001){ float e = uFeather*.5;
    f = smoothstep(0.,e,vUv.x)*smoothstep(0.,e,1.-vUv.x)*smoothstep(0.,e,vUv.y)*smoothstep(0.,e,1.-vUv.y); }
  gl_FragColor = clamp(c,0.,1.) * (uOpacity*uBright*f);
}`;

  PM.SHADERS = {
    solid: `vec4 effect(vec2 uv){ return vec4(uA*(1.+BASS*.0),1.); }`,
    tex: `vec4 effect(vec2 uv){
      if(uFlip.x>.5) uv.x=1.-uv.x; if(uFlip.y>.5) uv.y=1.-uv.y;
      vec4 c=texture2D(uTex,uv); c.rgb*=1.+BASS*.8; return c; }`,
    grid: `vec4 effect(vec2 uv){
      vec2 g=uv*8.; vec2 f=abs(fract(g)-.5);
      float line=smoothstep(.46,.49,max(f.x,f.y));
      float chk=mod(floor(g.x)+floor(g.y),2.);
      vec3 c=mix(vec3(.10),vec3(.24),chk); c=mix(c,vec3(1.),line);
      float d=min(min(uv.x,1.-uv.x),min(uv.y,1.-uv.y));
      c=mix(c,vec3(1.,.15,.2),1.-step(.012,d));
      vec2 q=abs(uv-.5); c=mix(c,vec3(0.,.9,1.),1.-step(.004,min(q.x,q.y)));
      float r=length((uv-.5)*vec2(uAspect,1.));
      c=mix(c,vec3(1.,.9,0.),1.-smoothstep(0.,.006,abs(r-.4)));
      return vec4(c,1.); }`,
    mood: `vec4 effect(vec2 uv){
      float n=fbm(uv*1.5*uScale+vec2(T*.05,T*.03));
      vec3 c=pal(n+T*.02); return vec4(c*(.8+.4*BASS),1.); }`,
    plasma: `vec4 effect(vec2 uv){
      vec2 p=(uv-.5)*vec2(uAspect,1.)*4.*uScale;
      float v=sin(p.x+T)+sin(p.y*1.3-T*.7)+sin(length(p)*1.5-T*1.2)+sin((p.x+p.y)*.8+T*.5);
      return vec4(pal(v*.15+T*.03+BASS*.2),1.); }`,
    aurora: `vec4 effect(vec2 uv){
      float n=fbm(vec2(uv.x*3.*uScale+T*.1,T*.05));
      float b1=exp(-pow((uv.y-.3-n*.5)*4.,2.));
      float n2=fbm(vec2(uv.x*5.*uScale-T*.07,3.+T*.04));
      float b2=exp(-pow((uv.y-.5-n2*.4)*5.,2.));
      vec3 c=(uA*b1+uB*b2+uC*b1*b2)*(1.+BASS);
      float a=clamp(max(c.r,max(c.g,c.b)),0.,1.); return vec4(c,a); }`,
    stripes: `vec4 effect(vec2 uv){
      float s=sin((uv.x*uAspect+uv.y*.5)*20.*uScale-T*2.);
      float m=smoothstep(-.1,.1,s); return vec4(mix(uA,uB,m)*(1.+BASS*.5),1.); }`,
    rings: `vec4 effect(vec2 uv){
      vec2 p=(uv-.5)*vec2(uAspect,1.); float d=length(p);
      float w=sin(d*24.*uScale-T*3.-BASS*4.);
      float m=smoothstep(0.,.2,w); return vec4(pal(d-T*.1)*m,m); }`,
    outline: `vec4 effect(vec2 uv){
      float d=min(min(uv.x,1.-uv.x),min(uv.y,1.-uv.y));
      float w=.02*uScale;
      float line=1.-smoothstep(0.,w,d);
      float glow=exp(-d*30./uScale)*.6;
      float a=atan(uv.y-.5,uv.x-.5)/6.2832+.5;
      float run=pow(.5+.5*sin((a-T*.15)*12.5664),4.);
      float i=clamp(line+glow*(.4+run+BASS),0.,1.);
      return vec4(mix(uA,uB,run)*i,i); }`,
    stars: `vec4 effect(vec2 uv){
      vec2 g=uv*vec2(uAspect,1.)*14.*uScale; vec2 id=floor(g); vec2 f=fract(g)-.5;
      float h=hash(id); vec2 o=vec2(hash(id+3.1),hash(id+7.7))-.5;
      float d=length(f-o*.6);
      float tw=.5+.5*sin(T*(1.+h*3.)+h*40.);
      float s=(1.-smoothstep(0.,.08*h+.03,d))*tw*(1.+BASS*2.)*step(.4,h);
      s=clamp(s,0.,1.); return vec4(pal(h)*s+vec3(s)*.3,s); }`,
    lava: `vec4 effect(vec2 uv){
      float n=fbm(uv*3.*uScale+vec2(0.,T*.15)+fbm(uv*2.*uScale-T*.1));
      vec3 c=mix(uA,uB,smoothstep(.3,.7,n));
      c=mix(c,uC,smoothstep(.65,.9,n+BASS*.2)); return vec4(c,1.); }`,
    bars: `vec4 effect(vec2 uv){
      float n=floor(24.*uScale); float bi=floor(uv.x*n); float fx=fract(uv.x*n);
      float v=spec((bi+.5)/n)*(.4+uReact);
      v=max(v,.05+.03*sin(T*2.+bi));
      float y=1.-uv.y;
      float m=step(y,v)*step(.12,fx)*step(fx,.88);
      vec3 c=mix(uA,uB,y); c=mix(c,uC,smoothstep(.7,1.,y)); return vec4(c*m,m); }`,
    pulse: `vec4 effect(vec2 uv){
      float l=mix(.55+.25*sin(T*.8),1.,clamp(uAudio.x*uReact*2.,0.,1.));
      return vec4(mix(uA,uB,.5+.5*sin(T*.2))*l,1.); }`,
    scan: `vec4 effect(vec2 uv){
      float y=fract(T*.2); float d=abs(uv.y-y); d=min(d,1.-d);
      float l=exp(-d*40./uScale);
      vec3 c=uA*l*(1.+BASS)+uB*.08; return vec4(c,clamp(l+.08,0.,1.)); }`,
  };

  /* Effects offered in the editor. */
  PM.EFFECTS = [
    ['mood', 'Mood light'],
    ['plasma', 'Plasma'],
    ['aurora', 'Aurora'],
    ['lava', 'Lava'],
    ['stripes', 'Stripes'],
    ['rings', 'Rings'],
    ['outline', 'Edge outline'],
    ['stars', 'Stars'],
    ['scan', 'Scan line'],
    ['bars', 'Spectrum bars (music)'],
    ['pulse', 'Pulse (music)'],
  ];
})();
