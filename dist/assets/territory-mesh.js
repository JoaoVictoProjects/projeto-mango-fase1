import * as THREE from 'three';

const enabled = new URLSearchParams(location.search).get('structural') === '1';
if (enabled) startWhenReady();

function startWhenReady() {
  if (window.MANGO_RENDER_BRIDGE) return initialize(window.MANGO_RENDER_BRIDGE);
  let settled = false;
  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    document.documentElement.dataset.structuralRenderer = 'fallback';
    console.warn('[Mango structural] Ponte indisponível; fallback v0.37 preservado.');
  }, 5000);
  addEventListener('mango:render-bridge-ready', event => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    initialize(event.detail);
  }, { once: true });
}

function initialize(bridge) {
  const canvas = document.querySelector('#territoryMesh');
  if (!canvas || !bridge || !window.d3) {
    document.documentElement.dataset.structuralRenderer = 'fallback';
    return;
  }
  try {
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(1);
    const scene = new THREE.Scene();
    const camera = new THREE.Camera();
    camera.matrixAutoUpdate = false;
    const uniforms = {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uCenter: { value: new THREE.Vector2() },
      uRadius: { value: 1 },
      uRotation: { value: new THREE.Vector3() }
    };
    const territories = [];
    for (const entity of bridge.entities) {
      const mesh = buildTerritory(entity, entity.iso2 === 'AQ' ? '#b8c8c9' : bridge.colorFor(entity.iso2 || entity.id), uniforms);
      if (!mesh) continue;
      mesh.userData = { territoryId: entity.iso2 || entity.id, pickId: entity.pickId };
      scene.add(mesh);
      territories.push(mesh);
    }
    if (!territories.length) throw new Error('Nenhuma geometria territorial válida foi criada.');
    const frame = () => {
      const state = bridge.state, globeCamera = bridge.camera(), dpr = state.dpr;
      const width = Math.max(1, Math.round(state.width * dpr)), height = Math.max(1, Math.round(state.height * dpr));
      if (canvas.width !== width || canvas.height !== height) renderer.setSize(width, height, false);
      uniforms.uResolution.value.set(width, height);
      uniforms.uCenter.value.set(globeCamera.x * dpr, globeCamera.y * dpr);
      uniforms.uRadius.value = globeCamera.r * dpr;
      uniforms.uRotation.value.set(...state.rotation.map(value => value * bridge.radians));
      renderer.render(scene, camera);
      requestAnimationFrame(frame);
    };
    document.documentElement.dataset.structuralRenderer = 'active';
    document.documentElement.dataset.structuralTerritories = String(territories.length);
    requestAnimationFrame(frame);
  } catch (error) {
    document.documentElement.dataset.structuralRenderer = 'fallback';
    console.warn('[Mango structural] Camada indisponível; fallback v0.37 preservado.', error);
  }
}

function buildTerritory(entity, hexColor, uniforms) {
  const positions = [], colors = [], faces = [], color = new THREE.Color(hexColor);
  for (const polygon of entity.feature?.geometry?.coordinates || []) appendPolygon(polygon, positions, colors, faces, color);
  if (!positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('aGeo', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aFace', new THREE.Float32BufferAttribute(faces, 1));
  const material = new THREE.RawShaderMaterial({
    uniforms, transparent: true, depthTest: true, depthWrite: true, side: THREE.DoubleSide,
    vertexShader: `#version 300 es
      precision highp float;
      in vec3 position;in vec3 aGeo;in vec3 aColor;in float aFace;
      uniform vec2 uResolution;uniform vec2 uCenter;uniform float uRadius;uniform vec3 uRotation;
      out vec3 vColor;out float vFace;out float vDepth;out vec2 vGeo;
      vec3 projectGeo(float lon,float lat,float elevation){
        float lambda=lon+uRotation.x,cp=cos(lat),x=cos(lambda)*cp,y=sin(lambda)*cp,z=sin(lat);
        float cdp=cos(uRotation.y),sdp=sin(uRotation.y),cdg=cos(uRotation.z),sdg=sin(uRotation.z);
        float k=z*cdp+x*sdp,viewLon=atan(y*cdg-k*sdg,x*cdp-z*sdp),viewLat=asin(clamp(k*cdg+y*sdg,-1.,1.));
        float cv=cos(viewLat),depth=cv*cos(viewLon),scale=1.+elevation;
        vec2 screen=uCenter+vec2(cv*sin(viewLon),-sin(viewLat))*uRadius*scale;
        return vec3(screen.x/uResolution.x*2.-1.,1.-screen.y/uResolution.y*2.,depth);
      }
      void main(){vec3 p=projectGeo(aGeo.x,aGeo.y,aGeo.z);gl_Position=vec4(p.xy,-p.z,1.);vColor=aColor;vFace=aFace;vDepth=p.z;vGeo=aGeo.xy;}`,
    fragmentShader: `#version 300 es
      precision highp float;
      in vec3 vColor;in float vFace;in float vDepth;in vec2 vGeo;out vec4 outColor;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);}
      void main(){
        if(vDepth<-.015)discard;
        float mineral=floor(noise(vGeo*vec2(115.,72.))*7.)/7.,grain=(hash(floor(gl_FragCoord.xy*.72))-.5)*.055;
        float light=clamp(.48+vDepth*.34+.16*sin(vGeo.x+1.1),.24,1.08);
        vec3 top=vColor*(.76+light*.30)+vec3(.10,.072,.032)*(mineral-.5)+grain;
        vec3 bevel=vColor*(.50+light*.18)+vec3(.10,.065,.020),side=vColor*(.20+light*.12);
        vec3 color=mix(top,bevel,step(.5,vFace));color=mix(color,side,step(1.5,vFace));
        outColor=vec4(color,smoothstep(-.015,.025,vDepth)*.995);
      }`
  });
  return new THREE.Mesh(geometry, material);
}

function appendPolygon(polygon, positions, colors, faces, color) {
  const rings = polygon.map(cleanRing).filter(ring => ring.length >= 3);
  if (!rings.length) return;
  const center = window.d3.geoCentroid({ type: 'Polygon', coordinates: polygon });
  const lon0 = center[0] * Math.PI / 180, lat0 = center[1] * Math.PI / 180;
  const projected = rings.map(ring => ring.map(point => tangent(point, lon0, lat0)));
  const contour = projected[0].map(p => new THREE.Vector2(p.x, p.y));
  const holes = projected.slice(1).map(ring => ring.map(p => new THREE.Vector2(p.x, p.y)));
  const triangles = THREE.ShapeUtils.triangulateShape(contour, holes), flat = rings.flat();
  for (const triangle of triangles) for (const index of triangle) push(flat[index], topHeight(flat[index]), color, 0, positions, colors, faces);
  for (const ring of rings) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    quad(a, b, SIDE_TOP, BASE_HEIGHT, color, 2, positions, colors, faces);
    quad(a, b, TOP_HEIGHT, SIDE_TOP, color, 1, positions, colors, faces);
  }
}

function cleanRing(ring) {
  const result = Array.isArray(ring) ? ring.filter(point => Number.isFinite(point?.[0]) && Number.isFinite(point?.[1])) : [];
  if (result.length > 1) {
    const a = result[0], b = result.at(-1);
    if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) result.pop();
  }
  return result;
}

function tangent(point, lon0, lat0) {
  const lon = point[0] * Math.PI / 180, lat = point[1] * Math.PI / 180;
  let delta = lon - lon0;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return { x: Math.cos(lat) * Math.sin(delta), y: Math.cos(lat0) * Math.sin(lat) - Math.sin(lat0) * Math.cos(lat) * Math.cos(delta) };
}

function push(point, height, color, face, positions, colors, faces) {
  positions.push(point[0] * Math.PI / 180, point[1] * Math.PI / 180, height);
  colors.push(color.r, color.g, color.b);faces.push(face);
}

function quad(a, b, upper, lower, color, face, positions, colors, faces) {
  for (const [point, height] of [[a,lower],[b,lower],[b,upper],[a,lower],[b,upper],[a,upper]]) push(point,height,color,face,positions,colors,faces);
}

function topHeight(point) {
  return TOP_HEIGHT + (Math.sin(point[0] * 2.34 + point[1] * 3.25) * .5 + .5) * RELIEF_HEIGHT;
}

const BASE_HEIGHT=.0015,SIDE_TOP=.0105,TOP_HEIGHT=.014,RELIEF_HEIGHT=.00045;
