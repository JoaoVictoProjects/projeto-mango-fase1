const enabled=new URLSearchParams(location.search).get('structural')==='1';
if(enabled)startWhenReady();

function startWhenReady(){
  if(window.MANGO_RENDER_BRIDGE)return initialize(window.MANGO_RENDER_BRIDGE);
  addEventListener('mango:render-bridge-ready',event=>initialize(event.detail),{once:true});
  setTimeout(()=>{if(!window.MANGO_STRUCTURAL_DRAW){document.documentElement.dataset.structuralRenderer='fallback';console.warn('[Mango structural] Ponte indisponível; fallback v0.37 preservado.')}},5000);
}

function initialize(bridge){
  if(!bridge?.entities||!window.d3){document.documentElement.dataset.structuralRenderer='fallback';return;}
  const visibleEntities=[...bridge.entities]
    .filter(entity=>entity?.feature?.geometry?.coordinates?.length)
    .map((entity,index)=>Object.assign(entity,{
      anchor:Array.isArray(entity.anchor)?entity.anchor:d3.geoCentroid(entity.feature),
      pickId:entity.pickId||index+1
    }));
  const polygonsOf=geometry=>geometry.type==='Polygon'?[geometry.coordinates]:geometry.type==='MultiPolygon'?geometry.coordinates:[];
  const topHeight=.011,bevelHeight=.007,shrink=.996;
  const grainCanvas=document.createElement('canvas'),grainCtx=grainCanvas.getContext('2d');
  grainCanvas.width=grainCanvas.height=64;
  let grainSeed=0x4d414e47;
  for(let i=0;i<780;i++){
    grainSeed=(grainSeed*1664525+1013904223)>>>0;const x=grainSeed&63;
    grainSeed=(grainSeed*1664525+1013904223)>>>0;const y=grainSeed&63;
    grainSeed=(grainSeed*1664525+1013904223)>>>0;const light=(grainSeed&3)!==0;
    grainCtx.fillStyle=light?'rgba(244,220,158,.18)':'rgba(0,8,12,.16)';
    grainCtx.fillRect(x,y,(grainSeed&7)===0?2:1,1);
  }
  const grainPattern=ctx=>ctx.createPattern(grainCanvas,'repeat');
  const colorCache=new Map();
  const rgb=hex=>{
    if(colorCache.has(hex))return colorCache.get(hex);
    const value=parseInt(hex.slice(1),16),color=[value>>16&255,value>>8&255,value&255];
    colorCache.set(hex,color);return color;
  };
  const shade=(color,factor)=>`rgb(${Math.round(color[0]*factor)},${Math.round(color[1]*factor)},${Math.round(color[2]*factor)})`;
  const transformPoint=(point,anchor,center,height,localShrink=1)=>{
    const radial=[center.x+(point[0]-center.x)*(1+height),center.y+(point[1]-center.y)*(1+height)];
    return[anchor[0]+(radial[0]-anchor[0])*localShrink,anchor[1]+(radial[1]-anchor[1])*localShrink];
  };
  const projectRing=(ring,projection,center,anchor,height,localShrink)=>{
    const result=[];
    for(const coordinate of ring){
      if(d3.geoDistance(coordinate,center.geo)>Math.PI/2-.006){result.push(null);continue;}
      const projected=projection(coordinate);
      result.push(projected?transformPoint(projected,anchor,center,height,localShrink):null);
    }
    return result;
  };
  const trace=(ctx,points,close=true)=>{
    let open=false;
    for(const point of points){
      if(!point){open=false;continue;}
      if(!open){ctx.moveTo(point[0],point[1]);open=true;}else ctx.lineTo(point[0],point[1]);
    }
    if(close&&open)ctx.closePath();
  };
  window.MANGO_STRUCTURAL_DRAW=({ctx,projection,center:geoCenter,cam})=>{
    const center={x:cam.x,y:cam.y,geo:geoCenter};
    const sorted=visibleEntities.map(entity=>({entity,distance:d3.geoDistance(entity.anchor,geoCenter)}))
      .filter(item=>item.distance<Math.PI/2+.45).sort((a,b)=>b.distance-a.distance);
    ctx.save();ctx.lineJoin='round';ctx.lineCap='round';
    for(const {entity} of sorted){
      const baseColor=rgb(entity.iso2==='AQ'?'#b8c8c9':bridge.colorFor(entity.iso2||entity.id));
      const anchorProjection=projection(entity.anchor);
      if(!anchorProjection)continue;
      for(const polygon of polygonsOf(entity.feature.geometry)){
        for(const ring of polygon){
          const base=projectRing(ring,projection,center,anchorProjection,.001,1);
          const bevel=projectRing(ring,projection,center,anchorProjection,bevelHeight,.996);
          const top=projectRing(ring,projection,center,anchorProjection,topHeight,shrink);
          for(let i=0;i<ring.length-1;i++){
            if(!base[i]||!base[i+1]||!bevel[i]||!bevel[i+1]||!top[i]||!top[i+1])continue;
            const dx=top[i+1][0]-top[i][0],dy=top[i+1][1]-top[i][1];
            const directional=.70+.18*Math.max(-1,Math.min(1,(dx-dy)/(Math.hypot(dx,dy)||1)));
            ctx.beginPath();trace(ctx,[base[i],base[i+1],bevel[i+1],bevel[i]]);
            ctx.fillStyle=shade(baseColor,.27*directional);ctx.fill();
            ctx.beginPath();trace(ctx,[bevel[i],bevel[i+1],top[i+1],top[i]]);
            ctx.fillStyle=shade(baseColor,.48*directional);ctx.fill();
          }
        }
      }
    }
    for(const {entity} of sorted){
      const baseColor=rgb(entity.iso2==='AQ'?'#b8c8c9':bridge.colorFor(entity.iso2||entity.id));
      const anchorProjection=projection(entity.anchor);
      if(!anchorProjection)continue;
      ctx.save();
      ctx.translate(anchorProjection[0],anchorProjection[1]);ctx.scale(shrink,shrink);ctx.translate(-anchorProjection[0],-anchorProjection[1]);
      ctx.translate(cam.x,cam.y);ctx.scale(1+topHeight,1+topHeight);ctx.translate(-cam.x,-cam.y);
      ctx.beginPath();d3.geoPath(projection,ctx)(entity.feature);
      const light=.80+.10*Math.sin((entity.anchor[0]+45)*Math.PI/180);
      ctx.fillStyle=shade(baseColor,light);ctx.fill('evenodd');
      ctx.strokeStyle='rgba(7,12,16,.58)';ctx.lineWidth=Math.max(.45,cam.r/1200);ctx.stroke();
      ctx.clip('evenodd');
      ctx.globalAlpha=.72;ctx.fillStyle=grainPattern(ctx);
      ctx.fillRect(cam.x-cam.r*1.05,cam.y-cam.r*1.05,cam.r*2.1,cam.r*2.1);
      ctx.restore();
    }
    ctx.restore();
  };
  document.documentElement.dataset.structuralRenderer='active-cpu';
  document.documentElement.dataset.structuralTerritories=String(visibleEntities.length);
  bridge.state.dirty=true;
}
