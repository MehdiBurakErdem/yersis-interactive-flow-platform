/* ============================================================
   Türkiye Üretim & Satış Yeri Akış Platformu — render engine
   ============================================================ */
(function(){
"use strict";

const RAW = window.APP_DATA;
const GEO = RAW.geo.features;
const IL_MAP = RAW.ilMap;                 // "ŞANLIURFA" -> "Şanlıurfa"
const ALL_FLOWS = RAW.flows;               // [{src,dst,urun,count,samples}]
const URUNLER = RAW.urunler;
const ERRORS = RAW.errors;
const TOTAL_RECORDS = RAW.totalRecords;

// Katman 2 — Soru 11: İş Gücü Hareketliliği
const ALL_FLOWS2 = RAW.flows2;             // [{yon,src,dst,tur,count,samples}]
const URUNLER2 = RAW.urunler2_gidis;       // hareket türleri (kısa etiket)

// Katman 3 — Soru 9a: Temel İhtiyaç Temin Yeri
const ALL_FLOWS3 = RAW.flows3;             // [{src,dst,kategori,count,samples}]
const URUNLER3 = RAW.kategoriler3;
const L3_IL_STATS = RAW.l3_il_stats;
const L3_EXCLUDED_POLATELI = RAW.l3_excluded_polateli_count;
const S9B_GENEL = RAW.s9b_genel;
const S9B_PER_IL = RAW.s9b_per_il;
const S9B_N_PER_IL = RAW.s9b_n_per_il;

const COLOR = {
  land: 0x0d1c30,
  landAlt: 0x0f2036,
  edge: 0x6f93b8,
  self: 0xc9a24b,
  accent: 0x3fd7c7,
  accent2: 0x5ec3ff,
  glow: 0x9be9df
};

// Katman renk paletleri — her katman kendi accent/accent2/glow/self üçlüsünü kullanır
const LAYER_PALETTES = [
  { accent:0x3fd7c7, accent2:0x5ec3ff, glow:0x9be9df, self:0xc9a24b, cssAccent:'#3fd7c7', cssAccent2:'#5ec3ff', cssSelf:'#c9a24b' },   // L1 — teal/mavi (mevcut)
  { accent:0xff8a3d, accent2:0xffb673, glow:0xffd9ae, self:0xc9a24b, cssAccent:'#ff8a3d', cssAccent2:'#ffb673', cssSelf:'#c9a24b' },   // L2 — parlak turuncu
  { accent:0xa78bfa, accent2:0xc9b6ff, glow:0xe0d4ff, self:0xc9a24b, cssAccent:'#a78bfa', cssAccent2:'#c9b6ff', cssSelf:'#c9a24b' }    // L3 — mor/ametist
];

/* ---------------- geo helpers ---------------- */

// compute lon/lat bounds across all features
let minLon=Infinity,maxLon=-Infinity,minLat=Infinity,maxLat=-Infinity;
GEO.forEach(f=>{
  walkCoords(f.coords, f.type, (lon,lat)=>{
    if(lon<minLon)minLon=lon; if(lon>maxLon)maxLon=lon;
    if(lat<minLat)minLat=lat; if(lat>maxLat)maxLat=lat;
  });
});
const lonMid=(minLon+maxLon)/2, latMid=(minLat+maxLat)/2;
const cosLat = Math.cos(latMid*Math.PI/180);
const SCALE = 8.6; // world units per degree (roughly, x-axis)
function project(lon,lat){
  const x = (lon-lonMid)*cosLat*SCALE;
  const z = (latMid-lat)*SCALE;
  return [x,z];
}
function walkCoords(coords, type, cb){
  if(type==='Polygon'){
    coords.forEach(ring=>ring.forEach(pt=>cb(pt[0],pt[1])));
  } else { // MultiPolygon
    coords.forEach(poly=>poly.forEach(ring=>ring.forEach(pt=>cb(pt[0],pt[1]))));
  }
}

// shoelace centroid of largest ring (by area) per feature, in projected space
function biggestRingCentroid(f){
  let rings = [];
  if(f.type==='Polygon'){ rings = [f.coords[0]]; }
  else { f.coords.forEach(poly=>rings.push(poly[0])); }
  let best=null, bestArea=-1;
  rings.forEach(ring=>{
    const pts = ring.map(p=>project(p[0],p[1]));
    let area=0;
    for(let i=0;i<pts.length-1;i++){
      area += pts[i][0]*pts[i+1][1]-pts[i+1][0]*pts[i][1];
    }
    area = Math.abs(area/2);
    if(area>bestArea){ bestArea=area; best=pts; }
  });
  let cx=0, cz=0, a=0;
  for(let i=0;i<best.length-1;i++){
    const cross = best[i][0]*best[i+1][1]-best[i+1][0]*best[i][1];
    a += cross;
    cx += (best[i][0]+best[i+1][0])*cross;
    cz += (best[i][1]+best[i+1][1])*cross;
  }
  a = a/2;
  if(Math.abs(a)<1e-6){ return best[0]; }
  return [cx/(6*a), cz/(6*a)];
}

/* ---------------- Il registry ---------------- */
const ILLER = {}; // name(proper case) -> {x,z,mesh,pulseMesh,label}
GEO.forEach(f=>{
  const c = biggestRingCentroid(f);
  ILLER[f.name] = { name:f.name, x:c[0], z:c[1], feature:f };
});

function properName(upperName){
  return IL_MAP[upperName] || (upperName.charAt(0)+upperName.slice(1).toLowerCase());
}

/* ============================================================
   THREE.JS SCENE SETUP
   ============================================================ */
const wrap = document.getElementById('canvas-wrap');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x060b16, 0.0032);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth/window.innerHeight, 0.1, 4000);
const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x060b16, 1);
wrap.appendChild(renderer.domElement);

// lights
scene.add(new THREE.AmbientLight(0x8fb0d8, 0.65));
const dl = new THREE.DirectionalLight(0xcfe6ff, 0.9);
dl.position.set(-60,140,80);
scene.add(dl);
const dl2 = new THREE.DirectionalLight(0x3fd7c7, 0.25);
dl2.position.set(80,60,-100);
scene.add(dl2);

/* ---------------- custom orbit-style camera controls ---------------- */
const target = new THREE.Vector3(0,0,0);
let camRadius = 165, camTheta = Math.PI*0.5, camPhi = 0.62; // spherical (theta around Y, phi from vertical)
const HOME = { radius:165, theta:Math.PI*0.5, phi:0.62 };
function applyCamera(){
  const r = camRadius;
  const x = target.x + r*Math.sin(camPhi)*Math.cos(camTheta);
  const y = target.y + r*Math.cos(camPhi);
  const z = target.z + r*Math.sin(camPhi)*Math.sin(camTheta);
  camera.position.set(x,y,z);
  camera.lookAt(target);
}
applyCamera();

let dragging=false, dragBtn=0, lastX=0, lastY=0;
renderer.domElement.addEventListener('contextmenu', e=>e.preventDefault());
renderer.domElement.addEventListener('pointerdown', e=>{
  dragging=true; dragBtn=e.button; lastX=e.clientX; lastY=e.clientY;
});
window.addEventListener('pointerup', ()=>dragging=false);
window.addEventListener('pointermove', e=>{
  if(!dragging) return;
  const dx = e.clientX-lastX, dy = e.clientY-lastY;
  lastX=e.clientX; lastY=e.clientY;
  if(dragBtn===2){ // pan
    const panSpeed = camRadius*0.0012;
    const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrix,0);
    const camUp = new THREE.Vector3().setFromMatrixColumn(camera.matrix,1);
    target.addScaledVector(camRight, -dx*panSpeed);
    target.addScaledVector(camUp, dy*panSpeed);
  } else {
    camTheta -= dx*0.0055;
    camPhi = Math.max(0.18, Math.min(1.35, camPhi - dy*0.0045));
  }
  applyCamera();
});
renderer.domElement.addEventListener('wheel', e=>{
  e.preventDefault();
  camRadius = Math.max(46, Math.min(420, camRadius + e.deltaY*0.09));
  applyCamera();
}, {passive:false});

function resetCamera(){
  camRadius = HOME.radius; camTheta = HOME.theta; camPhi = HOME.phi;
  target.set(0,0,0);
  applyCamera();
}

window.addEventListener('resize', ()=>{
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ============================================================
   BUILD MAP GEOMETRY
   ============================================================ */
const mapGroup = new THREE.Group();
scene.add(mapGroup);

const LAND_Y = 0;
const LAND_THICK = 1.15;

function buildProvinceMesh(f){
  const polys = f.type==='Polygon' ? [f.coords] : f.coords;
  const group = new THREE.Group();
  polys.forEach(poly=>{
    const outer = poly[0].map(p=>project(p[0],p[1]));
    const shape = new THREE.Shape(outer.map(p=>new THREE.Vector2(p[0],p[1])));
    for(let h=1; h<poly.length; h++){
      const hole = poly[h].map(p=>project(p[0],p[1]));
      shape.holes.push(new THREE.Path(hole.map(p=>new THREE.Vector2(p[0],p[1]))));
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth:LAND_THICK, bevelEnabled:false, curveSegments:2 });
    geo.rotateX(Math.PI/2); // shape XY -> world XZ, extrude along -Y after rotate
    const mat = new THREE.MeshStandardMaterial({
      color: COLOR.land, roughness:0.92, metalness:0.08,
      emissive:0x050b14, emissiveIntensity:0.4
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.province = f.name;
    group.add(mesh);

    // edges (top rim), drawn slightly above the surface to avoid z-fighting
    const edgesGeo = new THREE.EdgesGeometry(geo, 8);
    const edgeMat = new THREE.LineBasicMaterial({ color: COLOR.edge, transparent:true, opacity:0.32 });
    const edgeLines = new THREE.LineSegments(edgesGeo, edgeMat);
    edgeLines.position.y = 0.01;
    group.add(edgeLines);
  });
  return group;
}

const provinceMeshes = {}; // name -> {group, baseMat[]}
GEO.forEach(f=>{
  const g = buildProvinceMesh(f);
  mapGroup.add(g);
  provinceMeshes[f.name] = g;
});

// subtle base plate / glow floor beneath the map
(function(){
  const bboxPts=[];
  GEO.forEach(f=>walkCoords(f.coords, f.type, (lon,lat)=>bboxPts.push(project(lon,lat))));
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  bboxPts.forEach(p=>{ if(p[0]<minX)minX=p[0]; if(p[0]>maxX)maxX=p[0]; if(p[1]<minZ)minZ=p[1]; if(p[1]>maxZ)maxZ=p[1]; });
  const pad = 18;
  const w = (maxX-minX)+pad*2, d=(maxZ-minZ)+pad*2;
  const cx=(minX+maxX)/2, cz=(minZ+maxZ)/2;
  const plateGeo = new THREE.PlaneGeometry(w,d,1,1);
  const plateMat = new THREE.MeshBasicMaterial({ color:0x081120, transparent:true, opacity:0.55 });
  const plate = new THREE.Mesh(plateGeo, plateMat);
  plate.rotation.x = -Math.PI/2;
  plate.position.set(cx, -LAND_THICK-0.9, cz);
  scene.add(plate);

  const gridHelper = new THREE.GridHelper(Math.max(w,d), 24, 0x14263f, 0x0c1928);
  gridHelper.position.set(cx, -LAND_THICK-0.85, cz);
  gridHelper.material.transparent = true;
  gridHelper.material.opacity = 0.35;
  scene.add(gridHelper);
})();

/* province name labels (sprites) */
function makeTextSprite(text, opts){
  opts = opts||{};
  const fontSize = opts.fontSize||34;
  const color = opts.color||'rgba(200,220,240,0.85)';
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `600 ${fontSize}px Segoe UI, sans-serif`;
  const metrics = ctx.measureText(text);
  canvas.width = Math.ceil(metrics.width)+16;
  canvas.height = fontSize+16;
  ctx.font = `600 ${fontSize}px Segoe UI, sans-serif`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 8, canvas.height/2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map:tex, transparent:true, depthTest:false, depthWrite:false });
  const sprite = new THREE.Sprite(mat);
  const scale = (opts.scale||0.052);
  sprite.scale.set(canvas.width*scale, canvas.height*scale, 1);
  sprite.renderOrder = 10;
  return sprite;
}

const labelGroup = new THREE.Group();
scene.add(labelGroup);
Object.values(ILLER).forEach(il=>{
  const spr = makeTextSprite(il.name, { fontSize:30, scale:0.048 });
  spr.position.set(il.x, 0.9, il.z);
  spr.userData.baseY = 0.9;
  spr.userData.province = il.name;
  labelGroup.add(spr);
  il.label = spr;
});

/* ============================================================
   FLOW DATA MODEL
   ============================================================ */

// normalize flows to proper-case province names & attach positions
function normFlows(list, itemKey){
  return list.map(f=>{
    const srcName = properName(f.src);
    const dstName = properName(f.dst);
    const o = {
      srcKey:f.src, dstKey:f.dst, src:srcName, dst:dstName,
      count:f.count, samples:f.samples,
      self: srcName===dstName
    };
    o[itemKey] = f[itemKey];
    if(f.yon) o.yon = f.yon;
    return o;
  }).filter(f=> ILLER[f.src] && ILLER[f.dst]);
}

const FLOWS1 = normFlows(ALL_FLOWS, 'urun');
const FLOWS2 = normFlows(ALL_FLOWS2, 'tur');
const FLOWS3 = normFlows(ALL_FLOWS3, 'kategori');

const LAYERS = [
  { id:'l1', tab:'Üretim & Satış', title:'Üretim & Satış Yeri Akış Platformu', subtitle:'Şanlıurfa · Gaziantep · Kilis — 445 yerleşim verisi',
    flows:FLOWS1, items:URUNLER, itemKey:'urun', filterTitle:'ÜRÜN / FAALİYET TÜRÜ', filterHint:'Excel "Ürün" sütunundan otomatik okunur',
    kpiLabel:'ÜRÜN TÜRÜ', hasDirection:false, hasS9b:false, palette:LAYER_PALETTES[0],
    legendSelf:'İl içi hareket', legendFlow:'Akış bağlantısı',
    statOutLbl:'EN FAZLA ÇIKIŞ', statInLbl:'EN FAZLA GİRİŞ', srcLbl:'KAYNAK İL', dstLbl:'HEDEF İL',
    ilOutLbl:'Toplam Çıkış', ilInLbl:'Toplam Giriş', ilTopOutLbl:'En çok gönderdiği il', ilTopInLbl:'En çok aldığı il',
    prodTitle:'FAALİYET DAĞILIMI' },
  { id:'l2', tab:'İş Gücü Hareketliliği', title:'Soru 11 — İş Gücü Hareketliliği Analizi', subtitle:'Yerleşimlerden dışa/içe iş gücü akışı',
    flows:FLOWS2, items:URUNLER2, itemKey:'tur', filterTitle:'HAREKET TÜRÜ', filterHint:'Excel S11 verisinden otomatik okunur',
    kpiLabel:'HAREKET TÜRÜ', hasDirection:true, hasS9b:false, palette:LAYER_PALETTES[1],
    legendSelf:'İl içi hareket', legendFlow:'Akış bağlantısı',
    statOutLbl:'EN FAZLA GİDİLEN İL', statInLbl:'EN FAZLA GELİNEN İL', srcLbl:'KAYNAK İL', dstLbl:'HEDEF İL',
    ilOutLbl:'Toplam Çıkış', ilInLbl:'Toplam Giriş', ilTopOutLbl:'En çok gidilen il', ilTopInLbl:'En çok gelinen il',
    prodTitle:'HAREKET TÜRÜ DAĞILIMI' },
  { id:'l3', tab:'Temel İhtiyaçlar', title:'Soru 9a — Temel İhtiyaç Temin Yeri', subtitle:'Şanlıurfa · Gaziantep · Kilis — temin akışı',
    flows:FLOWS3, items:URUNLER3, itemKey:'kategori', filterTitle:'İHTİYAÇ KATEGORİSİ', filterHint:'Excel S9a verisinden otomatik okunur',
    kpiLabel:'KATEGORİ', hasDirection:false, hasS9b:true, palette:LAYER_PALETTES[2],
    legendSelf:'İl içinde temin', legendFlow:'Temin akışı',
    statOutLbl:'DİĞER İLLERE SAĞLADIĞI', statInLbl:'EN ÇOK TEMİN ALDIĞI İL', srcLbl:'KAYNAK İL', dstLbl:'HEDEF İL',
    ilOutLbl:'Diğer illere sağladığı temin', ilInLbl:'İl dışından temin edilen', ilTopOutLbl:'En çok temin sağladığı il', ilTopInLbl:'En çok temin aldığı il',
    prodTitle:'KATEGORİ DAĞILIMI' }
];
let currentLayerIdx = 0;
let currentDir = 'GIDIS'; // Katman 2 için Gidiş/Geliş yönü
let currentIlFilter = 'Tümü'; // tüm katmanlarda ortak il filtresi

let currentProduct = 'Tümü';
let currentGroups = [];     // aggregated per (src,dst) for the active product+yön filtresi
let arcObjects = [];        // three.js objects currently in scene for flows
let selectedIl = null;

function ilFilterField(layer){
  if(layer.id==='l3') return 'dst';
  if(layer.id==='l2') return currentDir==='GIDIS' ? 'src' : 'dst';
  return 'src';
}

function aggregateForProduct(product){
  const layer = LAYERS[currentLayerIdx];
  const key = layer.itemKey;
  let subset = layer.flows;
  if(layer.hasDirection) subset = subset.filter(f=>f.yon===currentDir);
  if(product!=='Tümü') subset = subset.filter(f=>f[key]===product);
  if(currentIlFilter!=='Tümü'){
    const field = ilFilterField(layer) + 'Key';
    subset = subset.filter(f=>f[field]===currentIlFilter);
  }
  const map = new Map();
  subset.forEach(f=>{
    const gkey = f.src+'→'+f.dst;
    if(!map.has(gkey)){
      map.set(gkey, { src:f.src, dst:f.dst, self:f.self, count:0, products:{} });
    }
    const g = map.get(gkey);
    g.count += f.count;
    g.products[f[key]] = (g.products[f[key]]||0) + f.count;
  });
  return Array.from(map.values()).sort((a,b)=>b.count-a.count);
}

/* ---------------- il aggregate stats (for tooltip / detail) ---------------- */
function ilStats(ilName, groups){
  let out=0,inn=0,selfCount=0;
  const outTargets={}, inSources={}, prodDist={}, inProdDist={};
  groups.forEach(g=>{
    if(g.self){
      if(g.src===ilName){
        selfCount = g.count;
        Object.entries(g.products).forEach(([p,c])=>{ prodDist[p]=(prodDist[p]||0)+c; });
      }
      return;
    }
    if(g.src===ilName){ out+=g.count; outTargets[g.dst]=(outTargets[g.dst]||0)+g.count;
      Object.entries(g.products).forEach(([p,c])=>{ prodDist[p]=(prodDist[p]||0)+c; }); }
    if(g.dst===ilName){ inn+=g.count; inSources[g.src]=(inSources[g.src]||0)+g.count;
      Object.entries(g.products).forEach(([p,c])=>{ inProdDist[p]=(inProdDist[p]||0)+c; }); }
  });
  const topOut = Object.entries(outTargets).sort((a,b)=>b[1]-a[1])[0];
  const topIn = Object.entries(inSources).sort((a,b)=>b[1]-a[1])[0];
  return { out, inn, selfCount, topOut, topIn, prodDist, inProdDist };
}

/* returns true if a given province has any involvement (as src or dst) in a layer's FULL (unfiltered) flow set */
function provinceHasDataInLayer(layerIdx, ilName){
  const layer = LAYERS[layerIdx];
  return layer.flows.some(f=> (f.src===ilName || f.dst===ilName) );
}

/* ============================================================
   ARC / FLOW VISUALS
   ============================================================ */
const TUBULAR_SEGS = 48;
const RADIAL_SEGS = 6;

function arcHeight(dist){
  return Math.min(26, Math.max(6, dist*0.32));
}

function makeCurve(g, offsetIdx, offsetTotal){
  const a = ILLER[g.src], b = ILLER[g.dst];
  let ax=a.x, az=a.z, bx=b.x, bz=b.z;
  const dx=bx-ax, dz=bz-az;
  const dist = Math.sqrt(dx*dx+dz*dz);
  // perpendicular offset to separate overlapping routes sharing similar direction
  let ox=0, oz=0;
  if(offsetTotal>1){
    const nx=-dz/(dist||1), nz=dx/(dist||1);
    const spread = (offsetIdx-(offsetTotal-1)/2) * Math.min(3.4, dist*0.05);
    ox = nx*spread; oz = nz*spread;
  }
  const midx=(ax+bx)/2+ox, midz=(az+bz)/2+oz;
  const h = arcHeight(dist);
  const p0 = new THREE.Vector3(ax,0.4,az);
  const p1 = new THREE.Vector3(midx, h, midz);
  const p2 = new THREE.Vector3(bx,0.4,bz);
  return new THREE.CatmullRomCurve3([p0,p1,p2]);
}

function thicknessForCount(count, maxCount){
  const t = Math.sqrt(count/Math.max(1,maxCount));
  return 0.16 + t*0.62; // clamp between min & max tube radius
}

function buildArcMesh(curve, radius, colorHex){
  const geo = new THREE.TubeGeometry(curve, TUBULAR_SEGS, radius, RADIAL_SEGS, false);
  geo.setDrawRange(0,0);
  const mat = new THREE.MeshBasicMaterial({
    color:colorHex, transparent:true, opacity:0.85
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.indicesPerSeg = RADIAL_SEGS*6;
  mesh.userData.totalSegs = TUBULAR_SEGS;
  return mesh;
}

function revealTube(mesh, frac){
  const segs = Math.max(1, Math.round(mesh.userData.totalSegs*frac));
  mesh.geometry.setDrawRange(0, segs*mesh.userData.indicesPerSeg);
}

// count-badge sprite (small numeral near arc midpoint)
function makeBadge(n, pos){
  const canvas = document.createElement('canvas');
  const size=64;
  canvas.width=size; canvas.height=size;
  const ctx=canvas.getContext('2d');
  ctx.beginPath(); ctx.arc(size/2,size/2,size/2-3,0,Math.PI*2);
  ctx.fillStyle='rgba(8,18,32,0.88)'; ctx.fill();
  ctx.lineWidth=3; ctx.strokeStyle='rgba(63,215,199,0.85)'; ctx.stroke();
  ctx.fillStyle='#eafffb';
  ctx.font='600 28px Segoe UI, sans-serif';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(String(n), size/2, size/2+2);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map:tex, transparent:true, depthTest:false });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(2.6,2.6,1);
  spr.position.copy(pos);
  spr.renderOrder = 12;
  return spr;
}

// pulsing ring for self-loop provinces (intra-il hareket)
function makeRing(il, count, maxCount){
  const g = new THREE.RingGeometry(1.4, 1.9, 40);
  const m = new THREE.MeshBasicMaterial({ color:COLOR.self, transparent:true, opacity:0.75, side:THREE.DoubleSide });
  const ring = new THREE.Mesh(g,m);
  ring.rotation.x = -Math.PI/2;
  ring.position.set(il.x, 0.55, il.z);
  ring.userData.baseScale = 1 + Math.min(1.6, count/Math.max(1,maxCount)*1.6);
  ring.scale.setScalar(ring.userData.baseScale);
  return ring;
}

let animState = {
  playing:false,
  speed:1,
  t:0,            // seconds elapsed in the current cycle
  items:[],       // {type:'arc'|'self', mesh, startT, dur, curve?, dot?, badgeShown, pos?}
  cycleLen:1,
};

function clearArcs(){
  arcObjects.forEach(o=>{
    scene.remove(o);
    if(o.geometry) o.geometry.dispose();
    if(o.material) o.material.dispose();
  });
  arcObjects = [];
}

function rebuildFlowsForProduct(product){
  clearArcs();
  currentProduct = product;
  currentGroups = aggregateForProduct(product);
  const maxCount = Math.max(1, ...currentGroups.map(g=>g.count));

  // group offsets for overlapping same-direction-ish routes (by rounded bearing bucket from src)
  const bySrc = {};
  currentGroups.filter(g=>!g.self).forEach(g=>{
    bySrc[g.src] = bySrc[g.src]||[];
    bySrc[g.src].push(g);
  });

  const items = [];
  let stagger = 0;
  const STAGGER_STEP = 0.14;
  const DUR = 1.05;

  currentGroups.forEach(g=>{
    if(g.self){
      const il = ILLER[g.src];
      const ring = makeRing(il, g.count, maxCount);
      ring.material.opacity = 0;
      scene.add(ring);
      arcObjects.push(ring);
      items.push({ type:'self', mesh:ring, startT:stagger, dur:0.7, il, count:g.count });
      stagger += STAGGER_STEP*0.6;
      return;
    }
    const siblings = bySrc[g.src];
    const idx = siblings.indexOf(g);
    const curve = makeCurve(g, idx, siblings.length);
    const radius = thicknessForCount(g.count, maxCount);
    const mesh = buildArcMesh(curve, radius, COLOR.accent);
    scene.add(mesh);
    arcObjects.push(mesh);

    const dotGeo = new THREE.SphereGeometry(radius*2.1+0.15, 12, 12);
    const dotMat = new THREE.MeshBasicMaterial({ color:COLOR.glow, transparent:true, opacity:0 });
    const dot = new THREE.Mesh(dotGeo, dotMat);
    scene.add(dot);
    arcObjects.push(dot);

    const badgePos = curve.getPointAt(0.52);
    items.push({ type:'arc', mesh, dot, curve, startT:stagger, dur:DUR, group:g, badgeShown:false, badgePos });
    stagger += STAGGER_STEP;
  });

  animState.items = items;
  animState.cycleLen = stagger + 1.4;
  animState.t = 0;

  updateRightPanel();
  updateKPI();
  buildFlowList();
}

function stepAnimation(dt){
  if(!animState.playing) return;
  animState.t += dt*animState.speed;
  if(animState.t > animState.cycleLen){ animState.t = 0; resetVisualState(); }

  let activeFlowIdx = -1;
  animState.items.forEach((it,i)=>{
    const localT = animState.t - it.startT;
    if(localT<0){ return; }
    if(it.type==='arc'){
      const frac = Math.min(1, localT/it.dur);
      revealTube(it.mesh, frac);
      it.mesh.material.opacity = 0.28 + frac*0.55;
      if(frac<1){
        activeFlowIdx = i;
        const p = it.curve.getPointAt(frac);
        it.dot.position.copy(p);
        it.dot.material.opacity = 1;
        it.dot.scale.setScalar(1+Math.sin(animState.t*10)*0.06);
      } else {
        it.dot.material.opacity = Math.max(0, it.dot.material.opacity-dt*3);
        // gentle idle pulse on completed arcs
        it.mesh.material.opacity = 0.55 + Math.sin(animState.t*1.6+it.startT)*0.08;
        if(!it.badgeShown && it.group.count>1){
          it.badgeShown = true;
          const badge = makeBadge(it.group.count, it.badgePos);
          scene.add(badge);
          arcObjects.push(badge);
          it.badgeSprite = badge;
        }
        if(it.badgeSprite){
          it.badgeSprite.material.opacity = 1;
          const s = 2.6 + Math.sin(animState.t*2+it.startT)*0.12;
          it.badgeSprite.scale.set(s,s,1);
          it.badgeSprite.lookAt(camera.position);
        }
      }
    } else if(it.type==='self'){
      const frac = Math.min(1, localT/it.dur);
      it.mesh.material.opacity = 0.75*Math.min(1,frac*2);
      const pulse = it.mesh.userData.baseScale*(1+Math.sin(animState.t*2.4+it.startT)*0.08);
      it.mesh.scale.setScalar(pulse);
      if(!it.badgeShown && frac>0.3){
        it.badgeShown = true;
        const pos = new THREE.Vector3(it.il.x, 1.7, it.il.z);
        it.badgeSprite = makeBadge(it.count, pos);
        scene.add(it.badgeSprite);
        arcObjects.push(it.badgeSprite);
      }
      if(it.badgeSprite){
        it.badgeSprite.material.opacity = 0.75*Math.min(1,frac*2);
        it.badgeSprite.lookAt(camera.position);
      }
      if(frac<1) activeFlowIdx = i;
    }
  });

  highlightActive(activeFlowIdx);
}

function resetVisualState(){
  animState.items.forEach(it=>{
    if(it.type==='arc'){
      revealTube(it.mesh, 0);
      it.mesh.material.opacity = 0;
      it.dot.material.opacity = 0;
      if(it.badgeSprite){
        scene.remove(it.badgeSprite);
        it.badgeSprite.material.map.dispose();
        it.badgeSprite.material.dispose();
        const oi = arcObjects.indexOf(it.badgeSprite);
        if(oi>=0) arcObjects.splice(oi,1);
        it.badgeSprite = null;
        it.badgeShown = false;
      }
    } else {
      it.mesh.material.opacity = 0;
      if(it.badgeSprite){
        scene.remove(it.badgeSprite);
        it.badgeSprite.material.map.dispose();
        it.badgeSprite.material.dispose();
        const oi = arcObjects.indexOf(it.badgeSprite);
        if(oi>=0) arcObjects.splice(oi,1);
        it.badgeSprite = null;
        it.badgeShown = false;
      }
    }
  });
}

let lastActiveFlowIdx = -1;
function highlightActive(idx){
  if(idx===lastActiveFlowIdx) return;
  lastActiveFlowIdx = idx;
  document.querySelectorAll('.flow-row').forEach(el=>el.classList.remove('active'));
  if(idx>=0){
    const el = document.querySelector('.flow-row[data-idx="'+idx+'"]');
    if(el){ el.classList.add('active'); el.scrollIntoView({block:'nearest'}); }
  }
}

/* ============================================================
   UI: chips, KPI, right panel, flow list, il-detail
   ============================================================ */

const chipList = document.getElementById('chip-list');
function shortLabel(p){
  if(p.length<=16) return p;
  return p.split('(')[0].trim().split(/\s+/).slice(0,2).join(' ');
}
const ilFilterListEl = document.getElementById('il-filter-list');
const IL_FILTER_OPTIONS = ['Tümü','Şanlıurfa','Gaziantep','Kilis'];
function buildIlFilterChips(){
  ilFilterListEl.innerHTML='';
  IL_FILTER_OPTIONS.forEach(name=>{
    const key = name==='Tümü' ? 'Tümü' : name.toLocaleUpperCase('tr-TR');
    const el = document.createElement('div');
    el.className = 'chip'+(currentIlFilter===key?' active':'');
    el.textContent = name;
    el.addEventListener('click', ()=>{
      currentIlFilter = key;
      document.querySelectorAll('#il-filter-list .chip').forEach(c=>c.classList.remove('active'));
      el.classList.add('active');
      rebuildFlowsForProduct(currentProduct);
      if(LAYERS[currentLayerIdx].hasS9b) renderS9b();
    });
    ilFilterListEl.appendChild(el);
  });
}

function buildChips(){
  const chips = ['Tümü', ...LAYERS[currentLayerIdx].items];
  chipList.innerHTML='';
  chips.forEach(p=>{
    const el = document.createElement('div');
    el.className = 'chip'+(p===currentProduct?' active':'');
    el.textContent = shortLabel(p);
    el.title = p;
    el.addEventListener('click', ()=>{
      document.querySelectorAll('.chip').forEach(c=>c.classList.remove('active'));
      el.classList.add('active');
      rebuildFlowsForProduct(p);
    });
    chipList.appendChild(el);
  });
}

function fmt(n){ return n.toLocaleString('tr-TR'); }

function updateKPI(){
  const layer = LAYERS[currentLayerIdx];
  document.getElementById('kpi-il').textContent = '81';
  const totalHareket = currentGroups.reduce((s,g)=>s+g.count,0);
  document.getElementById('kpi-hareket').textContent = fmt(totalHareket);
  document.getElementById('kpi-rota').textContent = fmt(currentGroups.length);
  const urunCount = currentProduct==='Tümü' ? layer.items.length : 1;
  document.getElementById('kpi-urun').textContent = urunCount;
  document.getElementById('kpi-urun-lbl').textContent = layer.kpiLabel;
}

function updateRightPanel(){
  const layer = LAYERS[currentLayerIdx];
  document.getElementById('right-title').textContent = currentProduct.toUpperCase();
  const totalHareket = currentGroups.reduce((s,g)=>s+g.count,0);
  const srcSet = new Set(currentGroups.filter(g=>!g.self).map(g=>g.src).concat(currentGroups.filter(g=>g.self).map(g=>g.src)));
  const dstSet = new Set(currentGroups.map(g=>g.dst));
  // overall top sender / receiver across current selection
  const outTotals={}, inTotals={};
  currentGroups.forEach(g=>{
    if(!g.self){ outTotals[g.src]=(outTotals[g.src]||0)+g.count; inTotals[g.dst]=(inTotals[g.dst]||0)+g.count; }
  });
  const topOut = Object.entries(outTotals).sort((a,b)=>b[1]-a[1])[0];
  const topIn = Object.entries(inTotals).sort((a,b)=>b[1]-a[1])[0];

  const grid = document.getElementById('stat-grid');
  grid.innerHTML = `
    <div class="stat-box"><div class="v">${fmt(totalHareket)}</div><div class="k">TOPLAM HAREKET</div></div>
    <div class="stat-box"><div class="v">${fmt(currentGroups.length)}</div><div class="k">AKTİF BAĞLANTI</div></div>
    <div class="stat-box"><div class="v">${srcSet.size}</div><div class="k">${layer.srcLbl}</div></div>
    <div class="stat-box"><div class="v">${dstSet.size}</div><div class="k">${layer.dstLbl}</div></div>
    <div class="stat-box wide"><span class="k">${layer.statOutLbl}</span><b style="color:var(--accent)">${topOut?topOut[0]:'—'}</b></div>
    <div class="stat-box wide"><span class="k">${layer.statInLbl}</span><b style="color:var(--accent-2)">${topIn?topIn[0]:'—'}</b></div>
  `;
}

function buildFlowList(){
  const wrap = document.getElementById('flow-list');
  wrap.innerHTML='';
  currentGroups.forEach((g,i)=>{
    const row = document.createElement('div');
    row.className='flow-row';
    row.dataset.idx = i;
    const routeTxt = g.self ? (g.src+' (il içi)') : (g.src+' → '+g.dst);
    row.innerHTML = `<span class="idx">${String(i+1).padStart(2,'0')}</span><span class="rt">${routeTxt}</span><span class="cnt">${g.count}</span>`;
    wrap.appendChild(row);
  });
}

/* ---------------- il-detail panel ---------------- */
const ilDetail = document.getElementById('il-detail');
document.getElementById('il-detail-close').addEventListener('click', ()=>{
  ilDetail.style.display='none';
  selectedIl=null;
});
function showIlDetail(ilName){
  selectedIl = ilName;
  const layer = LAYERS[currentLayerIdx];
  const st = ilStats(ilName, currentGroups);
  document.getElementById('il-detail-title').textContent = ilName;
  document.getElementById('il-out-lbl').textContent = layer.ilOutLbl;
  document.getElementById('il-in-lbl').textContent = layer.ilInLbl;
  document.getElementById('il-top-out-lbl').textContent = layer.ilTopOutLbl;
  document.getElementById('il-top-in-lbl').textContent = layer.ilTopInLbl;
  document.getElementById('il-out').textContent = fmt(st.out);
  document.getElementById('il-in').textContent = fmt(st.inn);
  document.getElementById('il-top-out').textContent = st.topOut? st.topOut[0]+' ('+st.topOut[1]+')':'—';
  document.getElementById('il-top-in').textContent = st.topIn? st.topIn[0]+' ('+st.topIn[1]+')':'—';
  document.getElementById('il-prod-title').textContent = layer.prodTitle;

  // Katman 3 (S9a) için ek il-içi / il-dışı temin detayı
  const ex1row = document.getElementById('il-extra1-row');
  const ex2row = document.getElementById('il-extra2-row');
  if(layer.id==='l3'){
    const totTemin = st.selfCount + st.inn;
    const icPct = totTemin>0 ? Math.round(st.selfCount/totTemin*100) : 0;
    const disPct = totTemin>0 ? Math.round(st.inn/totTemin*100) : 0;
    document.getElementById('il-extra1-lbl').textContent = 'İl içinde kalan';
    document.getElementById('il-extra1').textContent = fmt(st.selfCount)+' kayıt ('+icPct+'%)';
    document.getElementById('il-extra2-lbl').textContent = 'İl dışına çıkan';
    document.getElementById('il-extra2').textContent = fmt(st.inn)+' kayıt ('+disPct+'%)';
    ex1row.style.display='flex';
    ex2row.style.display='flex';
  } else {
    ex1row.style.display='none';
    ex2row.style.display='none';
  }

  const prodList = document.getElementById('il-prod-list');
  const prodListIn = document.getElementById('il-prod-list-in');
  const prodTitleEl = document.getElementById('il-prod-title');
  const prodTitleInEl = document.getElementById('il-prod-title-in');
  prodList.innerHTML=''; prodListIn.innerHTML='';

  const outEntries = Object.entries(st.prodDist).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const inEntries = Object.entries(st.inProdDist).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const bothPresent = outEntries.length>0 && inEntries.length>0;

  function renderBars(container, entries){
    const maxV = entries.length? entries[0][1] : 1;
    entries.forEach(([p,c])=>{
      const row=document.createElement('div');
      row.className='prod-bar-row';
      row.innerHTML = `<div style="display:flex;justify-content:space-between;"><span>${shortLabel(p)}</span><b style="color:var(--text-hi)">${c}</b></div>
        <div class="prod-bar-bg"><div class="prod-bar-fg" style="width:${(c/maxV*100).toFixed(0)}%"></div></div>`;
      container.appendChild(row);
    });
  }

  if(outEntries.length===0 && inEntries.length===0){
    prodTitleEl.style.display='block';
    prodTitleEl.textContent = layer.prodTitle;
    prodList.innerHTML = '<div style="font-size:10.5px;color:var(--text-lo);">Bu seçim için veri yok</div>';
    prodTitleInEl.style.display='none';
  } else {
    if(outEntries.length>0){
      prodTitleEl.style.display='block';
      prodTitleEl.textContent = layer.prodTitle + (bothPresent ? ' — Gönderilen' : '');
      renderBars(prodList, outEntries);
    } else {
      prodTitleEl.style.display='none';
    }
    if(inEntries.length>0){
      prodTitleInEl.style.display='block';
      prodTitleInEl.textContent = layer.prodTitle + (bothPresent ? ' — Alınan' : '');
      renderBars(prodListIn, inEntries);
    } else {
      prodTitleInEl.style.display='none';
    }
  }
  ilDetail.style.display='block';
}

/* ============================================================
   RAYCASTING: hover tooltip + click detail
   ============================================================ */
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();
const tooltip = document.getElementById('tooltip');
let hoveredProvince = null;

function getAllProvinceMeshes(){
  const arr=[];
  Object.values(provinceMeshes).forEach(g=>{
    g.children.forEach(c=>{ if(c.isMesh) arr.push(c); });
  });
  return arr;
}
const PROVINCE_HIT_MESHES = getAllProvinceMeshes();

function onPointerMoveRay(e){
  const rect = renderer.domElement.getBoundingClientRect();
  mouseNDC.x = ((e.clientX-rect.left)/rect.width)*2-1;
  mouseNDC.y = -((e.clientY-rect.top)/rect.height)*2+1;
  raycaster.setFromCamera(mouseNDC, camera);
  const hits = raycaster.intersectObjects(PROVINCE_HIT_MESHES, false);
  if(hits.length>0){
    const name = hits[0].object.userData.province;
    hoveredProvince = name;
    const st = ilStats(name, currentGroups);
    tooltip.style.display='block';
    tooltip.style.left = (e.clientX+16)+'px';
    tooltip.style.top = (e.clientY+16)+'px';
    const topProd = Object.entries(st.prodDist).sort((a,b)=>b[1]-a[1])[0];
    tooltip.innerHTML = `<div class="tt-title">${name.toUpperCase()}</div>
      <div class="tt-row"><span>Giriş</span><b>${fmt(st.inn)}</b></div>
      <div class="tt-row"><span>Çıkış</span><b>${fmt(st.out)}</b></div>
      <div class="tt-row"><span>Toplam</span><b>${fmt(st.inn+st.out)}</b></div>
      ${topProd?`<div class="tt-row"><span>Öne çıkan faaliyet</span><b>${shortLabel(topProd[0])}</b></div>`:''}`;
    renderer.domElement.style.cursor='pointer';
  } else {
    hoveredProvince = null;
    tooltip.style.display='none';
    renderer.domElement.style.cursor='grab';
  }
}
renderer.domElement.addEventListener('pointermove', onPointerMoveRay);
renderer.domElement.addEventListener('pointerdown', (e)=>{
  if(e.button!==0) return;
  // treat as click only if not dragged far
  const downX=e.clientX, downY=e.clientY;
  const up = (ue)=>{
    window.removeEventListener('pointerup', up);
    if(Math.abs(ue.clientX-downX)<4 && Math.abs(ue.clientY-downY)<4 && hoveredProvince){
      handleProvinceClick(hoveredProvince);
    }
  };
  window.addEventListener('pointerup', up);
});

/* Harita üzerinden katman/detay geçişi: aktif katmanda hiç verisi olmayan bir il tıklanırsa,
   o ilin verisi olan ilk katmana otomatik geçilir. */
function handleProvinceClick(ilName){
  if(!provinceHasDataInLayer(currentLayerIdx, ilName)){
    for(let i=0;i<LAYERS.length;i++){
      if(i!==currentLayerIdx && provinceHasDataInLayer(i, ilName)){
        switchLayer(i, ilName);
        return;
      }
    }
  }
  showIlDetail(ilName);
}

/* ============================================================
   KATMAN (LAYER) YÖNETİMİ
   ============================================================ */
const layerTabsEl = document.getElementById('layer-tabs');
function buildLayerTabs(){
  layerTabsEl.innerHTML = '';
  LAYERS.forEach((layer, i)=>{
    const el = document.createElement('div');
    el.className = 'layer-tab'+(i===currentLayerIdx?' active':'');
    const dot = document.createElement('span');
    dot.className='dot';
    dot.style.background = layer.palette.cssAccent;
    el.appendChild(dot);
    const txt = document.createElement('span');
    txt.textContent = layer.tab;
    el.appendChild(txt);
    el.addEventListener('click', ()=>{ if(i!==currentLayerIdx) switchLayer(i); });
    layerTabsEl.appendChild(el);
  });
}

function applyLayerPalette(layer){
  const p = layer.palette;
  document.documentElement.style.setProperty('--accent', p.cssAccent);
  document.documentElement.style.setProperty('--accent-2', p.cssAccent2);
  document.documentElement.style.setProperty('--accent-soft', p.cssAccent+'29');
  COLOR.accent = p.accent;
  COLOR.accent2 = p.accent2;
  COLOR.glow = p.glow;
  COLOR.self = p.self;
}

function switchLayer(idx, focusIl){
  currentLayerIdx = idx;
  const layer = LAYERS[idx];
  currentProduct = 'Tümü';
  currentDir = 'GIDIS';
  currentIlFilter = 'Tümü';
  buildIlFilterChips();

  applyLayerPalette(layer);
  buildLayerTabs();

  // sol panel başlık/ipucu
  document.getElementById('filter-title').firstChild.textContent = layer.filterTitle;
  document.getElementById('filter-hint').textContent = layer.filterHint;

  // Gidiş/Geliş yön seçici sadece Katman 2'de görünür
  const dirTitle = document.getElementById('dir-title');
  const dirRow = document.getElementById('dir-row');
  if(layer.hasDirection){
    dirTitle.style.display='block';
    dirRow.style.display='flex';
    document.querySelectorAll('.dir-btn').forEach(b=>b.classList.toggle('active', b.dataset.dir==='GIDIS'));
  } else {
    dirTitle.style.display='none';
    dirRow.style.display='none';
  }

  // marka metni
  document.getElementById('brand-t2').textContent = layer.title;
  document.getElementById('brand-t3').textContent = layer.subtitle;
  document.title = layer.title + ' · T.C. Sanayi ve Teknoloji Bakanlığı';

  // gösterge (legend)
  document.getElementById('legend-flow-txt').textContent = layer.legendFlow;
  document.getElementById('legend-self-txt').textContent = layer.legendSelf;
  document.getElementById('legend-active-dot').style.background = layer.palette.cssAccent2;
  document.getElementById('legend-flow-dot').style.background = layer.palette.cssAccent;

  // S9b paneli sadece Katman 3'te görünür
  const s9b = document.getElementById('s9b-panel');
  if(layer.hasS9b){
    s9b.classList.add('visible');
    renderS9b();
  } else {
    s9b.classList.remove('visible');
    s9b.classList.remove('open');
  }

  // upload/veri notu sadece Katman 1'de anlamlı
  document.getElementById('data-note').style.display = (layer.id==='l1' && ERRORS && ERRORS.length>0) ? 'block' : 'none';

  buildChips();
  rebuildFlowsForProduct('Tümü');
  ilDetail.style.display='none';
  selectedIl=null;

  if(focusIl){
    setTimeout(()=>showIlDetail(focusIl), 60);
  }
}

/* ============================================================
   SORU 9B — En Çok Zorluk Yaşanan Konular (akordiyon panel)
   ============================================================ */
const S9B_COLORS = ['#a78bfa','#c9b6ff','#8b5cf6','#7c3aed','#6d28d9','#5b21b6','#4c1d95','#ddd6fe'];
function renderS9b(){
  const inner = document.getElementById('s9b-inner');
  const header = document.querySelector('#s9b-header .htxt');
  const sub = document.querySelector('#s9b-header .hsub');

  if(currentIlFilter !== 'Tümü'){
    const ilKey = currentIlFilter;
    header.textContent = 'Soru 9b — ' + ilKey + ' Zorluk Dağılımı';
    const perIl = S9B_PER_IL[ilKey] || {};
    const n = S9B_N_PER_IL[ilKey] || 0;
    sub.textContent = 'n=' + n + ' · il filtresine göre güncellenir · genişletmek için tıklayın';
    if(n===0){
      inner.innerHTML = '<div style="font-size:11px;color:var(--text-lo);padding:6px 0;">'+ilKey+' için yeterli veri bulunmuyor.</div>';
      return;
    }
    const entries = Object.entries(perIl).sort((a,b)=>b[1].n-a[1].n);
    const maxN = entries.length? entries[0][1].n : 1;
    let html = '<div style="font-size:10px;color:var(--text-lo);margin-bottom:8px;">'+ilKey+' DAĞILIMI (n='+n+')</div>';
    entries.forEach(([k,v],i)=>{
      const col = S9B_COLORS[i % S9B_COLORS.length];
      html += `<div class="s9b-rank-row">
        <span class="rn">${i+1}.</span>
        <span class="rl">${k}</span>
        <span class="rb-bg"><span class="rb-fg" style="width:${(v.n/maxN*100).toFixed(0)}%;background:${col}"></span></span>
        <span class="rv">%${v.pct.toFixed(1).replace('.',',')}</span>
      </div>`;
    });
    const top = entries[0];
    html += `<div id="s9b-kani">${ilKey} yerleşimlerinde en çok belirtilen zorluk <b>${top[0]}</b> (%${top[1].pct.toFixed(1).replace('.',',')}); bu, temel ihtiyaçların temininde değil, ${top[0].toLocaleLowerCase('tr-TR')} gibi hizmetlere erişimde yaşanan darboğazı işaret ediyor.</div>`;
    inner.innerHTML = html;
    return;
  }

  header.textContent = 'Soru 9b — En Çok Zorluk Yaşanan Konular';
  sub.textContent = 'Temel ihtiyaç temininde yaşanan zorluklar · genişletmek için tıklayın';
  const genelEntries = Object.entries(S9B_GENEL).sort((a,b)=>b[1].n-a[1].n);
  const maxN = genelEntries.length? genelEntries[0][1].n : 1;
  let html = '<div style="font-size:10px;color:var(--text-lo);margin-bottom:8px;">GENEL DAĞILIM (n='+ (genelEntries.reduce((s,[,v])=>s+v.n,0)) +')</div>';
  genelEntries.forEach(([k,v],i)=>{
    const col = S9B_COLORS[i % S9B_COLORS.length];
    html += `<div class="s9b-rank-row">
      <span class="rn">${i+1}.</span>
      <span class="rl">${k}</span>
      <span class="rb-bg"><span class="rb-fg" style="width:${(v.n/maxN*100).toFixed(0)}%;background:${col}"></span></span>
      <span class="rv">%${v.pct.toFixed(1).replace('.',',')}</span>
    </div>`;
  });

  html += '<div style="font-size:10px;color:var(--text-lo);margin:12px 0 2px;">İL BAZINDA EN ÇOK BELİRTİLEN ZORLUK <span style="opacity:.7;">(tıklayarak o ile odaklan)</span></div>';
  html += '<div id="s9b-il-grid">';
  ['ŞANLIURFA','GAZİANTEP','KİLİS'].forEach(il=>{
    const perIl = S9B_PER_IL[il] || {};
    const n = S9B_N_PER_IL[il] || 0;
    const entries = Object.entries(perIl).sort((a,b)=>b[1].n-a[1].n);
    const top = entries[0];
    html += `<div class="s9b-il-box" data-il="${il}" style="cursor:pointer;">
      <div class="ilname">${il} (n=${n})</div>
      ${ top ? `<div class="iltop">${top[0]}</div><div class="ilpct">%${top[1].pct.toFixed(1).replace('.',',')}</div>` : `<div class="iltop" style="color:var(--text-lo);font-weight:400;">Yeterli veri yok</div>` }
    </div>`;
  });
  html += '</div>';

  html += `<div id="s9b-kani">
    Yerleşimlerin temel ihtiyaç maddelerini temin ederken yaşadığı en büyük zorluk
    <b>finansal hizmetlere erişim (bankacılık/kredi)</b> ve <b>gıda maddeleri</b> temininde yoğunlaşıyor;
    bu, <b>Şanlıurfa'da bankacılık hizmetlerinin</b>, <b>Gaziantep'te ise gıda tedarik zincirinin</b>
    yerleşim düzeyinde daha kırılgan olduğuna işaret ediyor. Kilis için yeterli veri bulunmadığından
    (n=${S9B_N_PER_IL['KİLİS']||0}) bu ilde kanaat oluşturulamamıştır.
  </div>`;

  inner.innerHTML = html;
  inner.querySelectorAll('.s9b-il-box').forEach(box=>{
    box.addEventListener('click', (e)=>{
      e.stopPropagation();
      const il = box.getAttribute('data-il');
      currentIlFilter = il;
      document.querySelectorAll('#il-filter-list .chip').forEach(c=>{
        c.classList.toggle('active', c.textContent===il.charAt(0)+il.slice(1).toLocaleLowerCase('tr-TR'));
      });
      rebuildFlowsForProduct(currentProduct);
      renderS9b();
      document.getElementById('s9b-panel').classList.add('open');
    });
  });
}

document.getElementById('s9b-header').addEventListener('click', ()=>{
  document.getElementById('s9b-panel').classList.toggle('open');
});

/* ============================================================
   Playback controls
   ============================================================ */
const btnPlay = document.getElementById('btn-play');
btnPlay.addEventListener('click', ()=>{
  animState.playing = !animState.playing;
  btnPlay.textContent = animState.playing ? '⏸' : '▶';
});
document.getElementById('btn-restart').addEventListener('click', ()=>{
  animState.t = 0; resetVisualState();
  animState.playing = true; btnPlay.textContent='⏸';
});
document.querySelectorAll('.speed-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.speed-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    animState.speed = parseFloat(btn.dataset.speed);
  });
});

document.querySelectorAll('.dir-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.dir-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    currentDir = btn.dataset.dir;
    rebuildFlowsForProduct(currentProduct);
  });
});

/* map controls */
document.getElementById('mc-plus').addEventListener('click', ()=>{ camRadius=Math.max(46,camRadius-22); applyCamera(); });
document.getElementById('mc-minus').addEventListener('click', ()=>{ camRadius=Math.min(420,camRadius+22); applyCamera(); });
document.getElementById('mc-home').addEventListener('click', resetCamera);
document.getElementById('mc-full').addEventListener('click', ()=>{
  if(!document.fullscreenElement){ document.documentElement.requestFullscreen().catch(()=>{}); }
  else { document.exitFullscreen().catch(()=>{}); }
});

/* data note (unmatched rows) */
(function(){
  const note = document.getElementById('data-note');
  if(ERRORS && ERRORS.length>0){
    note.style.display='block';
    note.textContent = `${ERRORS.length} kayıt eşleştirilemedi (görüntülemek için tıklayın).`;
    let expanded=false;
    note.addEventListener('click', ()=>{
      expanded=!expanded;
      if(expanded){
        const lines = ERRORS.slice(0,20).map(e=>`Satır ${e.row}: ${e.reason}`).join('<br/>');
        note.innerHTML = lines + (ERRORS.length>20?`<br/>… ve ${ERRORS.length-20} kayıt daha`:'');
      } else {
        note.textContent = `${ERRORS.length} kayıt eşleştirilemedi (görüntülemek için tıklayın).`;
      }
    });
  }
})();

/* upload button (placeholder — informs user of expected columns) */
document.getElementById('upload-btn').addEventListener('click', ()=>{
  document.getElementById('file-input').click();
});
document.getElementById('file-input').addEventListener('change', (e)=>{
  if(e.target.files && e.target.files[0]){
    alert('Yeni dosya alındı: '+e.target.files[0].name+'\n\nBu demoda dosya ayrıştırma sunucu tarafında yapılmadığından örnek veri gösterilmeye devam ediyor. Üretim ortamında bu adım Kaynak İl / Hedef İl / Ürün sütunlarını otomatik eşleştirir.');
  }
});

/* ============================================================
   Entrance animation + render loop
   ============================================================ */
let entranceProgress = 0;
mapGroup.scale.set(1,0.001,1);
labelGroup.children.forEach(s=>s.material.opacity=0);

const clock = new THREE.Clock();
function animate(){
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());

  if(entranceProgress<1){
    entranceProgress = Math.min(1, entranceProgress + dt*0.9);
    const ease = 1-Math.pow(1-entranceProgress,3);
    mapGroup.scale.set(1, Math.max(0.001,ease), 1);
    labelGroup.children.forEach(s=>{ s.material.opacity = Math.max(0, (entranceProgress-0.55)/0.45)*0.85; });
  }

  stepAnimation(dt);
  renderer.render(scene, camera);
}

/* ============================================================
   Boot
   ============================================================ */
buildLayerTabs();
buildIlFilterChips();
switchLayer(0);
resetCamera();
animate();

setTimeout(()=>{
  const loading = document.getElementById('loading');
  loading.style.opacity='0';
  setTimeout(()=>loading.style.display='none', 650);
}, 550);

})();
