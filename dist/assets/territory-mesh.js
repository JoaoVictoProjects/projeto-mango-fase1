(() => {
  const enabled = new URLSearchParams(location.search).get('structural') === '1';
  if (!enabled) return;

  const canvas = document.querySelector('#territoryMesh');
  const bridge = window.MANGO_RENDER_BRIDGE;
  if (!canvas || !bridge || !window.d3) return;

  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    powerPreference: 'high-performance'
  });
  if (!gl) return;

  const vertexSource = `#version 300 es
    precision highp float;
    in vec3 aGeo;
    in vec3 aColor;
    in float aFace;
    uniform vec2 uResolution;
    uniform vec2 uCenter;
    uniform float uRadius;
    uniform vec3 uRotation;
    out vec3 vColor;
    out float vFace;
    out float vLight;
    const float HALF_PI=1.57079632679;
    vec3 projectGeo(float lon,float lat,float height){
      float lambda=lon+uRotation.x,phi=lat;
      float cp=cos(phi),x=cos(lambda)*cp,y=sin(lambda)*cp,z=sin(phi);
      float cdp=cos(uRotation.y),sdp=sin(uRotation.y),cdg=cos(uRotation.z),sdg=sin(uRotation.z);
      float k=z*cdp+x*sdp;
      float viewLon=atan(y*cdg-k*sdg,x*cdp-z*sdp);
      float viewLat=asin(clamp(k*cdg+y*sdg,-1.,1.));
      float cv=cos(viewLat),depth=cv*cos(viewLon),scale=1.+height;
      vec2 screen=uCenter+vec2(cv*sin(viewLon),-sin(viewLat))*uRadius*scale;
      vec2 clip=vec2(screen.x/uResolution.x*2.-1.,1.-screen.y/uResolution.y*2.);
      return vec3(clip,depth);
    }
    void main(){
      vec3 projected=projectGeo(aGeo.x,aGeo.y,aGeo.z);
      gl_Position=vec4(projected.xy,clamp(projected.z,-1.,1.),1.);
      vColor=aColor;vFace=aFace;
      vLight=clamp(.48+projected.z*.30+.20*sin(aGeo.x+1.1),.24,1.05);
    }`;

  const fragmentSource = `#version 300 es
    precision highp float;
    in vec3 vColor;
    in float vFace;
    in float vLight;
    out vec4 outColor;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
    void main(){
      float grain=(hash(floor(gl_FragCoord.xy*.72))-.5)*.075;
      vec3 top=vColor*(vLight+grain)+vec3(.045,.030,.014)*grain;
      vec3 side=vColor*.28*(.72+.28*vLight);
      vec3 color=mix(top,side,step(.5,vFace));
      outColor=vec4(color,.985);
    }`;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  }

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));

  const mapWidth = 720, mapHeight = 360;
  const raster = document.createElement('canvas');
  raster.width = mapWidth; raster.height = mapHeight;
  const rc = raster.getContext('2d', { willReadFrequently: true });
  const projection = d3.geoEquirectangular().translate([mapWidth / 2, mapHeight / 2]).scale(mapWidth / (2 * Math.PI)).precision(.1);
  const path = d3.geoPath(projection, rc);
  const entities = bridge.entities;
  const byPick = new Map();
  for (const entity of entities) {
    byPick.set(entity.pickId, entity);
    rc.beginPath(); path(entity.feature);
    rc.fillStyle = `rgb(${entity.pickId & 255},${entity.pickId >> 8 & 255},${entity.pickId >> 16 & 255})`;
    rc.fill('evenodd');
  }
  const pixels = rc.getImageData(0, 0, mapWidth, mapHeight).data;
  const ids = new Uint32Array(mapWidth * mapHeight);
  for (let i = 0, p = 0; i < ids.length; i++, p += 4) if (pixels[p + 3]) ids[i] = pixels[p] + (pixels[p + 1] << 8) + (pixels[p + 2] << 16);

  const positions = [], colors = [], faces = [];
  const height = .014, base = .0015;
  const rgb = hex => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
  const geo = (x, y, h) => [(x / mapWidth * 2 - 1) * Math.PI, (0.5 - y / mapHeight) * Math.PI, h];
  function push(vertex, color, face) { positions.push(...vertex); colors.push(...color); faces.push(face); }
  function tri(a, b, c, color, face) { push(a, color, face); push(b, color, face); push(c, color, face); }
  function quad(a, b, c, d, color, face) { tri(a, b, c, color, face); tri(a, c, d, color, face); }

  for (let y = 1; y < mapHeight - 1; y++) for (let x = 0; x < mapWidth; x++) {
    const i = y * mapWidth + x, id = ids[i];
    if (!id) continue;
    const entity = byPick.get(id); if (!entity) continue;
    const color = rgb(bridge.colorFor(entity.iso2 || entity.id));
    const x1 = x + 1, y1 = y + 1;
    const a = geo(x, y, height), b = geo(x1, y, height), c = geo(x1, y1, height), d = geo(x, y1, height);
    quad(a, b, c, d, color, 0);
    const left = ids[y * mapWidth + (x + mapWidth - 1) % mapWidth];
    const right = ids[y * mapWidth + (x + 1) % mapWidth];
    const up = ids[(y - 1) * mapWidth + x], down = ids[(y + 1) * mapWidth + x];
    if (left !== id) quad(geo(x, y1, base), geo(x, y, base), a, d, color, 1);
    if (right !== id) quad(geo(x1, y, base), geo(x1, y1, base), c, b, color, 1);
    if (up !== id) quad(geo(x, y, base), geo(x1, y, base), b, a, color, 1);
    if (down !== id) quad(geo(x1, y1, base), geo(x, y1, base), d, c, color, 1);
  }

  function buffer(name, size, data) {
    const location = gl.getAttribLocation(program, name), object = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, object); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  }
  gl.useProgram(program);
  buffer('aGeo', 3, new Float32Array(positions));
  buffer('aColor', 3, new Float32Array(colors));
  buffer('aFace', 1, new Float32Array(faces));
  const uniforms = Object.fromEntries(['uResolution','uCenter','uRadius','uRotation'].map(name => [name, gl.getUniformLocation(program, name)]));
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.GREATER); gl.clearDepth(-1); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);

  function frame() {
    const state = bridge.state, cam = bridge.camera(), dpr = state.dpr;
    const width = Math.round(state.width * dpr), heightPx = Math.round(state.height * dpr);
    if (canvas.width !== width || canvas.height !== heightPx) { canvas.width = width; canvas.height = heightPx; }
    gl.viewport(0, 0, width, heightPx); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);
    gl.uniform2f(uniforms.uResolution, width, heightPx); gl.uniform2f(uniforms.uCenter, cam.x * dpr, cam.y * dpr); gl.uniform1f(uniforms.uRadius, cam.r * dpr);
    gl.uniform3f(uniforms.uRotation, state.rotation[0] * bridge.radians, state.rotation[1] * bridge.radians, state.rotation[2] * bridge.radians);
    gl.drawArrays(gl.TRIANGLES, 0, faces.length);
    requestAnimationFrame(frame);
  }
  document.documentElement.dataset.structuralRenderer = 'active';
  requestAnimationFrame(frame);
})();
