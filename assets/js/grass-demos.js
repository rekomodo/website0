/* Small explanatory WebGL scenes. Deterministic blades and periodic gradient noise
   keep the comparisons identical and the wind seamless. Only the combined Results scene animates, while visible. */
(() => {
  'use strict';
  const WIND_SAMPLE_SCALE = 0.05;
  const vertex = `
    precision mediump float;
    attribute vec3 position;
    attribute vec3 bladeNormal;
    attribute vec2 bladeUV;
    attribute vec2 root;
    attribute float side;
    attribute vec2 variation;
    uniform mat4 vp;
    uniform sampler2D noise;
    uniform float scroll;
    uniform float windSampleScale;
    uniform float mode;
    uniform float amount;
    varying vec3 normalV;
    varying float heightV;
    varying float treatment;
    void main(){
      float h=bladeUV.y;
      vec3 p=position;
      vec3 n=bladeNormal;
      if((mode>2.5 && mode<3.5 && side>0.5) || (mode>3.5 && side>=0.0)){
        float x=mix(variation.x,variation.y,mode>3.5?0.8:amount);
        p.y *= (0.55+0.5*x)/(0.55+0.5*variation.x);
        vec2 center=root+vec2(mode>3.5?0.0:2.05,0.0);
        p.xz=center+(p.xz-center)*(0.14+0.05*x)/(0.14+0.05*variation.x);
      }
      if(mode<0.5 || (mode>3.5 && side>=0.0)){
        float wind=texture2D(noise,root*windSampleScale+vec2(scroll,scroll*0.37)).r;
        float bend=(wind-0.3)*1.5;
        p.x+=bend*h*h;
        p.z+=bend*h*h*0.35;
        n=normalize(n+vec3(-2.0*bend*h,0.0,-0.7*bend*h));
      }
      if((mode>0.5 && mode<1.5 && side>0.5) || (mode>3.5 && side>=0.0)){
        float a=(bladeUV.x-0.5)*(mode>3.5?0.16:amount)*6.2831853;
        n=vec3(n.x*cos(a)+n.z*sin(a),n.y,-n.x*sin(a)+n.z*cos(a));
      }
      normalV=n; heightV=h; treatment=side;
      gl_Position=vp*vec4(p,1.0);
    }`;
  const fragment = `
    precision mediump float;
    uniform float mode;
    uniform float amount;
    varying vec3 normalV;
    varying float heightV;
    varying float treatment;
    void main(){
      vec3 n=normalize(normalV);
      if(!gl_FrontFacing)n=-n;
      vec3 light=normalize(vec3(-0.65,0.8,0.7));
      float diffuse=mode>3.5
        ? 0.55+0.65*max(dot(n,light),0.0)
        : 0.28+0.72*max(dot(n,light),0.0);
      vec3 color=mix(vec3(0.09,0.30,0.16),vec3(0.55,0.67,0.22),heightV*heightV);
      float ao=1.0;
      if((mode>1.5 && mode<2.5 && treatment>0.5) || (mode>3.5 && treatment>=0.0))ao=mix(1.0-0.75*(mode>3.5?0.3:amount),1.0,heightV*heightV);
      if(treatment < -0.5) color=vec3(0.17,0.23,0.13);
      gl_FragColor=vec4(pow(color*diffuse*ao,vec3(0.85)),1.0);
    }`;
  function multiply(a,b){const o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)o[c*4+r]+=a[k*4+r]*b[c*4+k];return o;}
  function normalize(v){const n=Math.hypot(...v);return v.map(x=>x/n);}
  function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
  function camera(aspect,wind){
    const scale=Math.max(1,2.2/aspect);
    const eye=(wind?[3.5,3.8,5.7]:[0,3.8,8.2]).map(v=>v*scale),target=[0,0.35,0];
    const z=normalize(eye.map((x,i)=>x-target[i])),x=normalize(cross([0,1,0],z)),y=cross(z,x);
    const dot=v=>-v.reduce((s,n,i)=>s+n*eye[i],0);
    const view=[x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,dot(x),dot(y),dot(z),1];
    const f=1/Math.tan(0.56/2),near=0.1,far=50;
    return multiply([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0],view);
  }
  const N=128,period=8;
  const fade=t=>t*t*t*(t*(t*6-15)+10);
  function gradient(x,y){const a=((Math.sin((x%period+period)%period*127.1+(y%period+period)%period*311.7)*43758.5453)%1)*Math.PI*2;return [Math.cos(a),Math.sin(a)];}
  function perlin(x,y){
    const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
    const v=(dx,dy)=>{const g=gradient(ix+dx,iy+dy);return g[0]*(fx-dx)+g[1]*(fy-dy);};
    const mix=(a,b,t)=>a+(b-a)*t;
    return mix(mix(v(0,0),v(1,0),fade(fx)),mix(v(0,1),v(1,1),fade(fx)),fade(fy));
  }
  const noise=new Uint8Array(N*N*4);
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    const v=Math.round(Math.max(0,Math.min(1,0.5+0.62*perlin(x/N*period,y/N*period)))*255),i=(y*N+x)*4;
    noise.set([v,v,v,255],i);
  }
  // Nearest-cell values: neighboring blades share one seed's size value.
  const cells=Array.from({length:16},(_,i)=>({
    x:(i%4-1.5)*0.95+Math.sin(i*13)*0.25,
    z:(Math.floor(i/4)-1.5)*0.95+Math.cos(i*17)*0.25,
    value:(Math.sin(i*31.7)*43758.5%1+1)%1
  }));
  function clumpAt(x,z){let best=Infinity,value=0;for(const c of cells){const d=(x-c.x)**2+(z-c.z)**2;if(d<best){best=d;value=c.value;}}return value;}
  function geometry(wind){
    const arrays={position:[],bladeNormal:[],bladeUV:[],root:[],side:[],variation:[]};
    function add(p,n,uv,r,s){arrays.position.push(...p);arrays.bladeNormal.push(...n);arrays.bladeUV.push(...uv);arrays.root.push(...r);arrays.side.push(s);const hash=Math.abs(Math.sin(Math.round((r[0]/3.3+0.5)*15)*37.2+Math.round((r[1]/3.3+0.5)*15)*17.9)*4321)%1;arrays.variation.push(hash,clumpAt(...r));}
    const tiles=wind?[0]:[-2.05,2.05],size=wind?4:3.3,count=wind?18:16;
    tiles.forEach((offset,tile)=>{
      for(let j=0;j<count;j++)for(let i=0;i<count;i++){
        const hash=Math.abs(Math.sin(i*37.2+j*17.9)*4321)%1;
        const rx=(i/(count-1)-0.5)*size,rz=(j/(count-1)-0.5)*size;
        const angle=hash*6.28,c=Math.cos(angle),s=Math.sin(angle),height=0.55+hash*0.5,width=0.14+hash*0.05;
        const n=[s,0,c],r=[rx,rz];
        const point=(u,h)=>{const w=(u-0.5)*width*(1-h*0.85);return [rx+offset+c*w+s*h*h*0.18,h*height,rz-s*w+c*h*h*0.18];};
        for(let k=0;k<6;k++){
          const a=k/6,b=(k+1)/6;
          for(const [u,h] of [[0,a],[1,a],[0,b],[1,a],[1,b],[0,b]])add(point(u,h),n,[u,h],r,tile);
        }
      }
      // Ground tiles use the same shader, with upward-facing normals.
      const a=size/2+0.15;
      for(const [x,z] of [[-a,-a],[a,-a],[-a,a],[a,-a],[a,a],[-a,a]])add([offset+x,-0.025,z],[0,1,0],[0.5,0], [0,0],-1);
    });return arrays;
  }
  function setup(el){
    const kind=el.dataset.grassDemo,result=kind==='result',wind=kind==='wind',mode=result?4:wind?0:kind==='normals'?1:kind==='clumping'?3:2;
    const canvas=el.querySelector('.grass-demo-scene'),slider=el.querySelector('input'),out=el.querySelector('output'),status=el.querySelector('[role=status]');
    const gl=canvas.getContext('webgl',{antialias:true,alpha:false});
    if(!gl){status.textContent='This interactive demo needs WebGL. The explanation and video above are still available.';slider.disabled=true;return;}
    function shader(type,source){const sh=gl.createShader(type);gl.shaderSource(sh,source);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(sh));return sh;}
    const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const data=geometry(wind||result),sizes={position:3,bladeNormal:3,bladeUV:2,root:2,side:1,variation:2};
    Object.entries(data).forEach(([name,values])=>{const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values),gl.STATIC_DRAW);const a=gl.getAttribLocation(program,name);if(a>=0){gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,sizes[name],gl.FLOAT,false,0,0);}});
    const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,N,N,0,gl.RGBA,gl.UNSIGNED_BYTE,noise);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
    gl.enable(gl.DEPTH_TEST);gl.clearColor(0.10,0.125,0.115,1);
    const u=name=>gl.getUniformLocation(program,name);
    gl.uniform1f(u('windSampleScale'),WIND_SAMPLE_SCALE);gl.uniform1f(u('mode'),mode);gl.uniform1i(u('noise'),0);
    const textureCanvas=el.querySelector('.grass-demo-noise canvas'),ctx=textureCanvas?.getContext('2d');
    let elapsed=0;
    function draw(){
      const w=Math.max(1,canvas.clientWidth),h=canvas.clientHeight,dpr=Math.min(devicePixelRatio||1,2);
      if(canvas.width!==Math.round(w*dpr))canvas.width=Math.round(w*dpr);if(canvas.height!==Math.round(h*dpr))canvas.height=Math.round(h*dpr);gl.viewport(0,0,canvas.width,canvas.height);
      const value=Number(slider.value)/100,scroll=result?elapsed*value*2*WIND_SAMPLE_SCALE:value*30*WIND_SAMPLE_SCALE;
      out.value=result?(value*2).toFixed(2)+'×':wind?(value*30).toFixed(1)+' s':mode===1?(value*0.5).toFixed(2):value.toFixed(2);
      gl.uniformMatrix4fv(u('vp'),false,camera(w/h,wind||result));gl.uniform1f(u('scroll'),scroll);gl.uniform1f(u('amount'),mode===1?value*0.5:value);
      gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,data.position.length/3);
      if(ctx){
        textureCanvas.width=N;textureCanvas.height=N;const img=ctx.createImageData(N,N);
        for(let y=0;y<N;y++)for(let x=0;x<N;x++){
          if(mode===3){const v=Math.round(clumpAt((x/(N-1)-0.5)*3.3,(y/(N-1)-0.5)*3.3)*255);img.data.set([v,v,v,255],(y*N+x)*4);continue;}
          const sx=((Math.floor((x/N-0.5)*4*WIND_SAMPLE_SCALE*N+scroll*N)%N)+N)%N;
          const sy=((Math.floor((y/N-0.5)*4*WIND_SAMPLE_SCALE*N+scroll*0.37*N)%N)+N)%N;
          img.data.set(noise.subarray((sy*N+sx)*4,(sy*N+sx)*4+4),(y*N+x)*4);
        }
        ctx.putImageData(img,0,0);ctx.fillStyle='#e6cc7a';
        const count=mode===3?16:18;for(let j=0;j<count;j++)for(let i=0;i<count;i++){ctx.beginPath();ctx.arc(i/(count-1)*(N-6)+3,j/(count-1)*(N-6)+3,1.2,0,Math.PI*2);ctx.fill();}
      }
      el.dataset.ready='true';
    }
    if(result){
      const button=el.querySelector('button');
      let playing=!matchMedia('(prefers-reduced-motion: reduce)').matches,visible=false,frame=0,last=0;
      const sync=()=>{button.textContent=playing?'Pause animation':'Play animation';button.setAttribute('aria-pressed',String(playing));};
      function tick(now){frame=0;if(!playing||!visible||document.hidden)return;if(last)elapsed+=Math.min((now-last)/1000,0.1);last=now;draw();frame=requestAnimationFrame(tick);}
      function schedule(){cancelAnimationFrame(frame);frame=0;last=0;if(playing&&visible&&!document.hidden)frame=requestAnimationFrame(tick);}
      button.addEventListener('click',()=>{playing=!playing;sync();schedule();});
      new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;schedule();}).observe(el);
      document.addEventListener('visibilitychange',schedule);sync();
    }
    slider.addEventListener('input',draw);new ResizeObserver(draw).observe(canvas);
    canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();status.textContent='The 3D view was interrupted. Reload the page to restore it.';});draw();
  }
  document.querySelectorAll('[data-grass-demo]').forEach(el=>{try{setup(el);}catch(error){el.querySelector('[role=status]').textContent='The 3D demo could not load. Please try reloading the page.';console.error(error);}});
})();
