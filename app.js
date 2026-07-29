// NO EMOJIS — SVG icons or plain text only throughout this file
// =============================================================================
// STRICT RULE — No emojis allowed anywhere in this app.
// Never add emojis to any text, labels, buttons, placeholders, empty states,
// notifications, or any other UI element.
// Use Tabler icons (inline SVG) or plain text only.
// This rule applies to all future edits permanently.
// =============================================================================

// ═══════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════
// ═══════════════════════════════════════════════════
// MAPBOX ACCESS TOKEN
// Set MAPBOX_TOKEN below, or paste it in the in-app
// token prompt that appears if the map fails to load.
// Get a free token at mapbox.com → Account → Access Tokens
// ═══════════════════════════════════════════════════
const MAPBOX_TOKEN_DEFAULT = 'pk.eyJ1Ijoid2lsZHBhdGgxMiIsImEiOiJjbXBya2I1aWQxMHB2MnFweG92cjJtbW81In0.wGxIYBZeRDif7L3VTLlXFw';
const MAPBOX_TOKEN = localStorage.getItem('mapbox-token') || MAPBOX_TOKEN_DEFAULT;
mapboxgl.accessToken = MAPBOX_TOKEN;

function saveMapboxToken(){
  const val=(document.getElementById('mapboxTokenInput')?.value||'').trim();
  if(!val.startsWith('pk.')){
    showToast('Token must start with pk.eyJ1…');
    return;
  }
  // Save to both key names so either lookup works
  localStorage.setItem('mapbox-token', val);
  // Hide the error overlay and init the map immediately — no page reload needed
  const errEl=document.getElementById('mapError');
  if(errEl)errEl.classList.remove('show');
  showToast('Token saved — loading map…');
  initMap();
}

function _saveTokenAndLoad(){
  const val=(document.getElementById('token-input')?.value||'').trim();
  if(val.startsWith('pk.')){
    localStorage.setItem('mapbox-token', val);
    mapboxgl.accessToken = val;
    const prompt=document.getElementById('mapbox-token-prompt');
    if(prompt)prompt.style.display='none';
    initMap();
  } else {
    const err=document.getElementById('token-input-error');
    if(err)err.style.display='block';
  }
}

let map=null; // primary Mapbox GL JS instance
let currentStyle='standard', currentPin=0, drawerOpen=false, currentScreen='map';
let landLabelTimer=null, sheetOpen=false, sheetTouchStartY=0;
let peakMarkers=[], spotMarkerEls=[], spotMarkerRefs=[];
let activeFilters=new Set();
let hiddenGemFilterActive=false;
let addSpotMode=false, addSpotTempLat=null, addSpotTempLng=null;
let waypointMarkers=[], parkingMarker=null;
let userSpots=[]; // hydrated from Supabase spots table (status=approved)
let personalSpots=[]; // hydrated from Supabase personal_spots table — only this user's own, gold pins
let allHikes=[]; // hydrated from Supabase hikes table — RLS already scopes to what I can see
let savedPlaces=[]; // hydrated from Supabase saved_places table — red want-to-go pins, any ref_type
let favorites=new Set(JSON.parse(localStorage.getItem('wp_favs')||'[]'));

const landLayerCache={nationalForest:{on:false},blm:{on:false},stateParks:{on:false},private:{on:false}};
const featureLayerCache={};
FEATURE_LAYERS.forEach(f=>featureLayerCache[f.id]={on:false});

// ── Mapbox GL JS style URLs ──────────────────────────
const MAP_STYLES={
  standard: {url:'mapbox://styles/mapbox/outdoors-v12',       label:'Standard'},
  terrain:  {url:'mapbox://styles/mapbox/outdoors-v12',       label:'Terrain'},
  satellite:{url:'mapbox://styles/mapbox/satellite-streets-v12', label:'Satellite'},
  hybrid:   {url:'mapbox://styles/mapbox/satellite-streets-v12', label:'Hybrid'}
};
// In-memory cache for fetched land GeoJSON — no re-fetch on style switch
let _blmGeoJSON=null, _nfGeoJSON=null, _spGeoJSON=null;

// Backward-compat shim so old leafletMap.xxx calls still work
const leafletMap={
  flyTo([lat,lng],zoom,opts={}){if(map)map.flyTo({center:[lng,lat],zoom:zoom??map.getZoom(),duration:(opts.duration??1)*1000,essential:true});},
  setView([lat,lng],zoom,opts={}){if(map){if(opts.animate===false)map.jumpTo({center:[lng,lat],zoom});else map.flyTo({center:[lng,lat],zoom,duration:400});}},
  getCenter(){if(!map)return{lat:37.8,lng:-121.4};const c=map.getCenter();return{lat:c.lat,lng:c.lng};},
  getZoom(){return map?map.getZoom():7;},
  getBounds(){
    if(!map)return{getNorthEast:()=>({lat:38,lng:-121}),getSouthWest:()=>({lat:37,lng:-122})};
    const b=map.getBounds();
    return{getNorthEast:()=>({lat:b.getNorthEast().lat,lng:b.getNorthEast().lng}),getSouthWest:()=>({lat:b.getSouthWest().lat,lng:b.getSouthWest().lng})};
  },
  setMaxZoom(){},
  invalidateSize(){if(map)map.resize();},
  hasLayer(layer){return layer&&typeof layer.getElement==='function';},
  removeLayer(layer){if(layer){if(typeof layer.remove==='function')layer.remove();else if(typeof layer.addTo==='undefined'){}  }},
  addLayer(layer){if(layer&&map&&typeof layer.addTo==='function')layer.addTo(map);},
  on(ev,fn){if(map)map.on(ev,fn);},
  fitBounds(bounds,opts={}){if(map&&bounds)try{map.fitBounds(bounds,{padding:opts.padding||40,duration:(opts.duration??1)*1000});}catch{}},
  remove(){if(map)map.remove();}
};

// ═══════════════════════════════════════════════════
// IMAGE COMPRESSION — downscale before any localStorage write
// Max 1080px longest side, JPEG 0.8 — ~10x smaller than raw photos
// ═══════════════════════════════════════════════════
function compressImage(file,maxDim=1080,quality=0.8){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error('read_failed'));
    reader.onload=ev=>{
      const img=new Image();
      img.onload=()=>{
        let w=img.width,h=img.height;
        if(Math.max(w,h)>maxDim){
          const scale=maxDim/Math.max(w,h);
          w=Math.round(w*scale);h=Math.round(h*scale);
        }
        const canvas=document.createElement('canvas');
        canvas.width=w;canvas.height=h;
        canvas.getContext('2d').drawImage(img,0,0,w,h);
        resolve(canvas.toDataURL('image/jpeg',quality));
      };
      // Not a decodable image (e.g. HEIC unsupported) — fall back to original
      img.onerror=()=>resolve(ev.target.result);
      img.src=ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ═══════════════════════════════════════════════════
// SECURITY HELPERS — sanitize, password hashing, admin code
// ═══════════════════════════════════════════════════
// Escape HTML special chars — use on ALL user-typed text before innerHTML
function sanitize(str){
  if(str==null)return '';
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}


// Passwords are handled entirely by Supabase Auth — nothing password-related
// is stored in code or localStorage. Admin role comes from profiles.role.

// ═══════════════════════════════════════════════════
// SAVED STORE — single canonical key 'wildpath-saved'
// { postIds:[], spotIds:[], folders:[{name,postIds}] }
// ═══════════════════════════════════════════════════
function _getSavedStore(){
  const s=_DB['wildpath-saved']||{};
  return{postIds:s.postIds||[],spotIds:s.spotIds||[],folders:s.folders||[]};
}
function _setSavedStore(s){_DB['wildpath-saved']=s;}
function getSavedPostIds(){return _getSavedStore().postIds;}
function setSavedPostIds(a){const s=_getSavedStore();s.postIds=a;_setSavedStore(s);}
function getSavedSpotIds(){return _getSavedStore().spotIds;}
function setSavedSpotIds(a){const s=_getSavedStore();s.spotIds=a;_setSavedStore(s);}

// ═══════════════════════════════════════════════════
// ERROR FEEDBACK — retry toast + inline map notice
// ═══════════════════════════════════════════════════
function _showRetryToast(msg,retryJs){
  document.getElementById('_retryToast')?.remove();
  const el=document.createElement('div');
  el.id='_retryToast';
  el.style.cssText='position:absolute;bottom:calc(var(--nav-h) + 14px);left:50%;transform:translateX(-50%);z-index:9600;background:rgba(30,25,20,.96);border:1px solid var(--border2);border-radius:22px;padding:9px 16px;display:flex;align-items:center;gap:10px;font-size:12px;color:var(--txt1);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:0 6px 20px rgba(0,0,0,.5);white-space:nowrap;max-width:92%';
  el.innerHTML=`<span style="overflow:hidden;text-overflow:ellipsis">${msg}</span>
    <span onclick="document.getElementById('_retryToast').remove();${retryJs}" style="color:var(--accent);font-weight:700;cursor:pointer;flex-shrink:0">Tap to retry</span>
    <span onclick="document.getElementById('_retryToast').remove()" style="color:var(--txt3);cursor:pointer;flex-shrink:0;padding-left:2px">×</span>`;
  document.getElementById('app').appendChild(el);
  setTimeout(()=>{if(document.getElementById('_retryToast')===el)el.remove();},10000);
}
function _showMapNotice(text){
  document.getElementById('_mapNotice')?.remove();
  const el=document.createElement('div');
  el.id='_mapNotice';
  el.style.cssText='position:absolute;bottom:calc(var(--nav-h) + 14px);left:50%;transform:translateX(-50%);z-index:9500;background:rgba(30,25,20,.92);border:1px solid var(--border2);border-radius:20px;padding:7px 14px;font-size:11px;color:var(--txt2);backdrop-filter:blur(12px);pointer-events:none;white-space:nowrap';
  el.textContent=text;
  document.getElementById('app').appendChild(el);
  setTimeout(()=>el.remove(),4000);
}

// ═══════════════════════════════════════════════════
// STORAGE KEY MIGRATION — runs once per load, moves data
// from legacy key names to canonical ones, then removes legacy
// ═══════════════════════════════════════════════════
function _migrateStorageKeys(){
  // Phase 2: app data moved to Supabase. Purge all legacy localStorage data
  // keys so only UI preferences remain on-device.
  try{
    const dataKeys=['wildpath-posts','wildpath-communities','wildpath-community-members',
      'wildpath-community-posts','wildpath-votes','wildpath-comments','wildpath-follows',
      'wildpath-notifications','wildpath-messages','wildpath-spot-drops','wildpath-recent-searches',
      'wildpath-user-profiles','wildpath-pending-members','wildpath-saved','wildpath-saved-posts',
      'wildpath-saved-folders','wildpath-saved-hikes','wildpath-active-hike','wildpath-users',
      'wildpath-current-user','wildpath-guest','wildpath-pending-spots','wildpath-spots-approved',
      'wp_pending_spots','wp_user_spots','wp_saved_spots','wp_favs','wp_collections','wp_want_to_go',
      'wp_journal','wp_personal_moments','wp_username','wp_mapbox_token','wp_avatar',
      'wildpath-dark-mode','wildpath-light-mode','wildpath-map-style'];
    dataKeys.forEach(k=>localStorage.removeItem(k));
    Object.keys(localStorage).filter(k=>k.startsWith('wp_avatar_')||k.startsWith('wp_comments_')||k.startsWith('wp_community_spots_')||k.startsWith('wildpath-user-location-')).forEach(k=>localStorage.removeItem(k));
  }catch(e){console.warn('Storage purge:',e);}
}


// ═══════════════════════════════════════════════════
// SUPABASE SYNC LAYER
// Hydrates the in-memory _DB from Supabase and writes
// every mutation through to the backend. All reads in
// the app stay synchronous against _DB.
// ═══════════════════════════════════════════════════
let _sbHydrated=false,_sbChannels=[];

function _sbAdaptProfile(r){
  return{username:r.username,avatarUrl:r.avatar_url||null,bio:r.bio||'',role:r.role||'explorer',fullName:r.full_name||''};
}
function _sbAdaptPost(r,likesMap){
  const prof=r.profiles||{};
  const spot=r.spot_id?[...spots,...userSpots].find(s=>String(s.id)===String(r.spot_id)):null;
  return{
    id:r.id,userId:r.user_id,
    username:prof.username||(getUserProfile(r.user_id)||{}).username||'explorer',
    verified:false,
    type:r.video_url?'video':(r.photo_url?'photo':'text'),
    mediaUrl:r.photo_url||r.video_url||null,
    mediaUrls:r.photo_url?[r.photo_url]:[],
    caption:r.caption||'',
    spotId:r.spot_id||null,spotName:spot?spot.name:null,
    lat:r.lat??spot?.lat??null,lng:r.lng??spot?.lng??null,
    privacy:r.privacy||'public',
    showOnSpot:r.show_on_spot!==false,
    likes:(likesMap&&likesMap[r.id])||[],
    communityIds:[],
    createdAt:r.created_at
  };
}
function _sbAdaptSpot(r){
  const def=(typeof SPOT_TYPE_DEFS!=='undefined'&&SPOT_TYPE_DEFS[r.type])||{label:r.type,color:'#7AB87A',icon:r.type};
  const legal=r.legal_status||'caution';
  return{
    id:r.id,name:r.name,lat:r.lat,lng:r.lng,type:r.type,
    typeLabel:def.label,typeColor:def.color,icon:def.icon,
    heroGradient:'linear-gradient(160deg,#0f1410,#1e251e,#0a100a)',
    rating:0,reviews:0,distance:'',elevation:r.elevation_gain||'—',
    legal,legalText:legal==='legal'?'Legal':legal==='illegal'?'Illegal':'Caution',
    legalClass:'legal-'+(legal==='legal'?'legal':legal==='illegal'?'illegal':'caution'),
    trailLength:r.hike_time||'—',difficulty:r.difficulty||'Moderate',
    diffClass:'diff-'+String(r.difficulty||'moderate').toLowerCase(),
    bestSeason:r.best_season||'Year-round',parkingCost:'—',entryFee:'—',
    roadCondition:r.road_condition||'—',cellSignal:'—',
    season:[1,1,1,1,1,1,1,1,1,1,1,1],
    permitRequired:!!r.permit_url,
    permitData:r.permit_url?{name:r.permit_name||'Permit',url:r.permit_url,cost:r.permit_cost||''}:null,
    parkingCapacity:'—',parkingFillTime:'—',fourWD:false,
    weather:[],crowd:30,campingText:'—',
    reviews_data:[],similar:[],
    approach:r.approach||'',gear:[],hazards:[],insiderTips:r.description||'',
    description:r.description||'',
    accessibility:'—',kidScore:3,dogFriendly:true,shade:'—',
    crowdsByDay:[30,25,28,32,35,55,60],hiddenGem:true,
    nearestTown:r.nearest_town||null,nearestHospital:r.nearest_hospital||null,
    discoveredBy:r.discovered_by||null,submittedBy:r.submitted_by||null,
    createdAt:r.created_at
  };
}

// Upload a dataURL to a public bucket; resolves to the public URL
async function _sbUploadDataUrl(bucket,dataUrl,ext){
  const blob=await (await fetch(dataUrl)).blob();
  const path=`${_myUid()}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext||'jpg'}`;
  const {error}=await db.storage.from(bucket).upload(path,blob,{contentType:blob.type||'image/jpeg'});
  if(error)throw error;
  return db.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

// ── Hydration: pull everything the UI needs into _DB ──
async function _sbHydrate(){
  // Outer safety net: hydration must NEVER throw and must NEVER block a user
  // from landing on / staying on the Map tab after login or signup — it only
  // refreshes data for screens that are already visible.
  try{
    const failed=[];
    const run=async(name,fn)=>{try{await fn();}catch(e){failed.push(name);console.warn('[Supabase] '+name+' load failed:',e?.message||e);}};
    await run('spots',_sbLoadSpots);
    await Promise.allSettled([run('profiles',_sbLoadProfiles),run('communities',_sbLoadCommunities)]);
    await Promise.allSettled([
      run('posts',_sbLoadPosts),run('messages',_sbLoadMessages),run('follows',_sbLoadFollows),
      run('notifications',_sbLoadNotifications),run('saved',_sbLoadSaved),run('pending spots',_sbLoadPendingSpots),
      run('personal spots',_sbLoadPersonalSpots),run('saved places',_sbLoadSavedPlaces),run('my hikes',_loadMyHikes),run('hikes',_sbLoadHikes)
    ]);
    _sbHydrated=true;
    try{_sbSubscribeRealtime();}catch(e){console.warn('[Supabase] realtime:',e);}
    // Refresh whatever is on screen
    try{refreshSpotMarkers();}catch(e){}
    try{if(typeof buildHomeFeed==='function')buildHomeFeed();}catch(e){}
    try{buildFeed();}catch(e){}
    try{buildCommunitiesTab();}catch(e){}
    try{buildProfile();}catch(e){}
    try{_updateNotifBadge();}catch(e){}
    if(failed.length){
      _showRetryToast('Could not load: '+failed.join(', '),'_sbHydrate()');
    }else{
      console.log('[Supabase] hydrated');
    }
  }catch(e){
    console.warn('[Supabase] hydrate failed unexpectedly (non-blocking):',e?.message||e);
  }
}

async function _sbLoadProfiles(){
  const {data,error}=await db.from('profiles').select('*');
  if(error)throw error;
  const m={};
  (data||[]).forEach(r=>{m[r.id]=_sbAdaptProfile(r);});
  _cgSet(CK.profiles,m);
}

async function _sbLoadSpots(){
  const {data,error}=await db.from('spots').select('*').eq('status','approved');
  if(error)throw error;
  userSpots.length=0;
  (data||[]).forEach(r=>userSpots.push(_sbAdaptSpot(r)));
}

async function _sbLoadHikes(){
  try{
    const {data,error}=await db.from('hikes').select('*');
    if(error)throw error;
    allHikes.length=0;
    (data||[]).forEach(h=>allHikes.push(h));
    _renderHikePins();
  }catch(e){console.warn('[Supabase] hikes load:',e);}
}
async function _sbLoadPersonalSpots(){
  if(isGuest())return;
  const {data,error}=await db.from('personal_spots').select('*').eq('user_id',_myUid());
  if(error)throw error;
  personalSpots.length=0;
  (data||[]).forEach(r=>{
    const def=(typeof SPOT_TYPE_DEFS!=='undefined'&&SPOT_TYPE_DEFS[r.type])||{label:r.type,color:'#D4A843',icon:r.type};
    personalSpots.push({
      id:'personal_'+r.id,personalSpotId:r.id,name:r.name,lat:r.lat,lng:r.lng,type:r.type,
      typeLabel:def.label,notes:r.notes||'',photos:r.photo_urls||[],
      heroGradient:'linear-gradient(160deg,#2a2410,#3a3018,#1a1608)',
      createdAt:r.created_at,tier:'personal'
    });
  });
}

async function _sbLoadPosts(){
  const {data,error}=await db.from('posts').select('*, profiles!posts_user_id_fkey(username, avatar_url)')
    .eq('privacy','public').order('created_at',{ascending:false}).limit(20);
  if(error)throw error;
  const rows=data||[];
  const ids=rows.map(r=>r.id);
  const likesMap={},commentsMap={};
  if(ids.length){
    try{
      const {data:likeRows}=await db.from('likes').select('post_id,user_id').in('post_id',ids);
      (likeRows||[]).forEach(l=>{(likesMap[l.post_id]=likesMap[l.post_id]||[]).push(l.user_id);});
    }catch(e){}
    try{
      const {data:cRows}=await db.from('comments').select('*').in('post_id',ids).order('created_at');
      (cRows||[]).forEach(c=>{
        (commentsMap[c.post_id]=commentsMap[c.post_id]||[]).push({
          id:c.id,postId:c.post_id,userId:c.user_id,
          username:(getUserProfile(c.user_id)||{}).username||'explorer',
          text:c.content,createdAt:c.created_at,parentId:null
        });
      });
    }catch(e){}
  }
  setPosts(rows.map(r=>_sbAdaptPost(r,likesMap)));
  _cgSet(CK.comments,commentsMap);
}

async function _sbLoadMessages(){
  if(isGuest())return;
  const me=_myUid();
  const {data,error}=await db.from('messages').select('*')
    .or(`sender_id.eq.${me},receiver_id.eq.${me}`).order('created_at');
  if(error)throw error;
  const map={};
  (data||[]).forEach(r=>{map[_dmConvKey(r.sender_id,r.receiver_id)]=(map[_dmConvKey(r.sender_id,r.receiver_id)]||[]).concat([_sbAdaptMessage(r)]);});
  setMessages(map);
}
function _sbAdaptMessage(r){
  const m={id:r.id,fromId:r.sender_id,text:r.content||'',time:r.created_at};
  if(r.media_url){m.mediaUrl=r.media_url;m.mediaType=/\.(mp4|mov|webm)(\?|$)/i.test(r.media_url)?'video':'photo';delete m.text;}
  if(r.post_id){
    const p=getPosts().find(x=>String(x.id)===String(r.post_id));
    m.postCard=p?{id:p.id,mediaUrl:p.mediaUrl,caption:p.caption,spotId:p.spotId,spotName:p.spotName,username:p.username,gradient:null}:{id:r.post_id,caption:'Shared post'};
  }
  if(r.spot_id){
    const s=[...spots,...userSpots].find(x=>String(x.id)===String(r.spot_id));
    if(s)m.spotCard={id:s.id,name:s.name,typeLabel:s.typeLabel,heroGradient:s.heroGradient};
  }
  return m;
}

async function _sbLoadFollows(){
  const {data,error}=await db.from('follows').select('follower_id,following_id');
  if(error)throw error;
  const map={};
  (data||[]).forEach(r=>{(map[r.follower_id]=map[r.follower_id]||[]).push(String(r.following_id));});
  setFollows(map);
}

async function _sbLoadNotifications(){
  if(isGuest())return;
  const {data,error}=await db.from('notifications').select('*')
    .eq('user_id',_myUid()).order('created_at',{ascending:false}).limit(50);
  if(error)throw error;
  setNotifs((data||[]).map(r=>({
    id:r.id,type:r.type,
    fromUsername:(getUserProfile(r.from_user_id)||{}).username||'Someone',
    message:r.message||'',read:!!r.read,createdAt:r.created_at
  })));
}

async function _sbLoadSaved(){
  if(isGuest())return;
  const {data,error}=await db.from('saved_spots').select('*').eq('user_id',_myUid());
  if(error)throw error;
  const spotIds=[],folders={};
  (data||[]).forEach(r=>{
    spotIds.push(r.spot_id);
    const f=r.folder_name||'General';
    (folders[f]=folders[f]||[]).push(r.spot_id);
  });
  _setSavedStore({postIds:[],spotIds,folders:Object.entries(folders).map(([name,ids])=>({name,postIds:ids}))});
}

async function _sbLoadSavedPlaces(){
  if(isGuest())return;
  const {data,error}=await db.from('saved_places').select('*').eq('user_id',_myUid()).order('saved_at',{ascending:false});
  if(error)throw error;
  savedPlaces.length=0;
  (data||[]).forEach(r=>savedPlaces.push({id:r.id,refType:r.ref_type,refId:r.ref_id,name:r.name,lat:r.lat,lng:r.lng,folderName:r.folder_name||'General',savedAt:r.saved_at}));
}

async function _sbLoadCommunities(){
  const {data,error}=await db.from('communities').select('*');
  if(error)throw error;
  setCommunities((data||[]).map(r=>({
    id:r.id,name:r.name,desc:r.description||'',coverDataUrl:r.cover_url||null,
    privacy:r.privacy||'public',focus:r.focus?[r.focus]:[],rules:r.rules||'',
    adminId:String(r.created_by||''),memberCount:r.members_count||0,createdAt:r.created_at
  })));
  try{
    const {data:mem}=await db.from('community_members').select('community_id,user_id');
    const map={};
    (mem||[]).forEach(r=>{(map[r.community_id]=map[r.community_id]||[]).push(String(r.user_id));});
    _cgSet(CK.members,map);
  }catch(e){}
  try{
    const {data:cp}=await db.from('community_posts').select('*').order('created_at',{ascending:false});
    const map={};
    (cp||[]).forEach(r=>{(map[r.community_id]=map[r.community_id]||[]).push(r.id);});
    _cgSet(CK.cposts,map);
  }catch(e){}
}

// ── Write-through helpers (fire-and-forget with console warning) ──
function _sbTry(promise,label){
  Promise.resolve(promise).then(({error}={})=>{if(error)console.warn('[Supabase] '+label+':',error.message);})
    .catch(e=>console.warn('[Supabase] '+label+':',e));
}
function _sbToggleLike(postId,on){
  if(isGuest())return;
  if(on)_sbTry(db.from('likes').insert({post_id:postId,user_id:_myUid()}),'like');
  else _sbTry(db.from('likes').delete().eq('post_id',postId).eq('user_id',_myUid()),'unlike');
}
function _sbToggleFollow(uid,on){
  if(isGuest())return;
  if(on)_sbTry(db.from('follows').insert({follower_id:_myUid(),following_id:uid}),'follow');
  else _sbTry(db.from('follows').delete().eq('follower_id',_myUid()).eq('following_id',uid),'unfollow');
}
function _sbNotify(toUid,type,message){
  if(isGuest()||!toUid||String(toUid)===String(_myUid()))return;
  if(!/^[0-9a-f-]{36}$/i.test(String(toUid)))return; // only real user ids
  _sbTry(db.from('notifications').insert({user_id:toUid,type,from_user_id:_myUid(),message}),'notify');
}

// ── Realtime: messages, notifications, posts ──
function _sbSubscribeRealtime(){
  _sbChannels.forEach(ch=>{try{db.removeChannel(ch);}catch(e){}});
  _sbChannels=[];
  if(!isGuest()){
    const me=_myUid();
    _sbChannels.push(db.channel('rt-messages')
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:`receiver_id=eq.${me}`},payload=>{
        const r=payload.new;
        const key=_dmConvKey(r.sender_id,r.receiver_id);
        const map=getMessages();
        (map[key]=map[key]||[]).push(_sbAdaptMessage(r));
        setMessages(map);
        try{if(typeof _dmConvUserId!=='undefined'&&_dmConvUserId&&_dmConvKey(me,_dmConvUserId)===key)_renderDmChat();}catch(e){}
        try{_renderCommDmInbox('');}catch(e){}
      }).subscribe());
    _sbChannels.push(db.channel('rt-notifications')
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:`user_id=eq.${me}`},payload=>{
        const r=payload.new;
        const notifs=getNotifs();
        notifs.unshift({id:r.id,type:r.type,fromUsername:(getUserProfile(r.from_user_id)||{}).username||'Someone',message:r.message||'',read:false,createdAt:r.created_at});
        setNotifs(notifs.slice(0,50));
        try{_updateNotifBadge();}catch(e){}
      }).subscribe());
  }
  _sbChannels.push(db.channel('rt-posts')
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'posts'},payload=>{
      const r=payload.new;
      if(r.privacy!=='public')return;
      if(String(r.user_id)===String(_myUid()))return; // own posts added locally on submit
      const posts=getPosts();
      if(posts.find(p=>String(p.id)===String(r.id)))return;
      posts.unshift(_sbAdaptPost(r,null));
      setPosts(posts);
      try{buildFeed();}catch(e){}
      try{if(typeof buildHomeFeed==='function')buildHomeFeed();}catch(e){}
    }).subscribe());
}

// ═══════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════
let _guestMode=false,_sbSession=null;
const _LAUNCH_SCREEN_MIN_MS=800;
// Supabase's client parses a `#access_token=...&type=recovery` hash automatically
// (detectSessionInUrl) and fires this event once that session is established —
// used as a fallback in case the direct hash check in window.onload below ever
// races the client's own parsing.
db.auth.onAuthStateChange((event)=>{
  if(event==='PASSWORD_RECOVERY')_showNewPasswordScreen();
});
window.onload=async()=>{
  _migrateStorageKeys();
  const launchStart=Date.now();
  const isRecovery=/type=recovery/.test(window.location.hash);
  try{
    const {data}=await db.auth.getSession();
    _sbSession=data?.session||null;
  }catch(e){console.warn('[Supabase] getSession failed:',e);}
  // Keep the launch screen up for a minimum ~800ms so it never just flashes,
  // regardless of how fast (or slow) the session check resolves.
  const elapsed=Date.now()-launchStart;
  if(elapsed<_LAUNCH_SCREEN_MIN_MS)await new Promise(r=>setTimeout(r,_LAUNCH_SCREEN_MIN_MS-elapsed));
  _hideLaunchScreen();
  if(isRecovery){
    // Clean the token out of the URL/history, then show the New Password screen
    // instead of the normal Map/Login branch below.
    history.replaceState(null,'',window.location.pathname+window.location.search);
    _showNewPasswordScreen();
    return;
  }
  if(_sbSession){
    await _sbLoadCurrentUser(_sbSession.user);
    _hideLoginScreen();
    _launchApp();
    _sbHydrate().catch(e=>console.warn('[Supabase] hydrate error (non-blocking):',e));
  } else {
    _currentUser=null;
    _showLoginScreen();
  }
};
function _showNewPasswordScreen(){
  document.getElementById('loginScreen')?.style.setProperty('display','none');
  const np=document.getElementById('newPasswordScreen');
  if(np)np.style.display='flex';
}
function _hideLaunchScreen(){
  const ls=document.getElementById('launchScreen');
  if(ls){
    ls.style.opacity='0';
    ls.style.transition='opacity 0.3s ease';
    setTimeout(()=>{ls.style.display='none';},310);
  }
}

// Load (or lazily create) the profiles row for the signed-in auth user
async function _sbLoadCurrentUser(authUser){
  let prof=null;
  try{
    const {data}=await db.from('profiles').select('*').eq('id',authUser.id).maybeSingle();
    prof=data;
    if(!prof){
      const uname=(authUser.user_metadata?.username||authUser.email?.split('@')[0]||'explorer').slice(0,24);
      const {data:ins}=await db.from('profiles').insert({id:authUser.id,username:uname}).select().single();
      prof=ins;
    }
  }catch(e){console.warn('[Supabase] profile load failed:',e);}
  _currentUser={
    id:authUser.id,
    email:authUser.email||'',
    username:prof?.username||authUser.email?.split('@')[0]||'explorer',
    fullName:prof?.full_name||'',
    role:prof?.role||'explorer',
    createdAt:prof?.created_at||new Date().toISOString()
  };
  if(prof)setUserProfile(authUser.id,_sbAdaptProfile(prof));
}

function _showLoginScreen(){
  const ls=document.getElementById('loginScreen');
  if(ls)ls.style.display='flex';
}
function _hideLoginScreen(){
  const ls=document.getElementById('loginScreen');
  if(ls){
    ls.style.opacity='0';
    ls.style.transition='opacity 0.35s ease';
    setTimeout(()=>{ls.style.display='none';ls.style.opacity='';ls.style.transition='';},360);
  }
}
function loginShowSignIn(){
  document.getElementById('loginSignInPanel').style.display='block';
  document.getElementById('loginSignUpPanel').style.display='none';
  document.getElementById('loginTabSignIn').style.cssText='flex:1;text-align:center;padding:9px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;background:#B8E87A;color:#0f1a0a;transition:all .2s';
  document.getElementById('loginTabSignUp').style.cssText='flex:1;text-align:center;padding:9px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;color:rgba(255,255,255,0.5);transition:all .2s';
  const e=document.getElementById('loginSignInError');if(e)e.style.display='none';
}
function loginShowSignUp(){
  document.getElementById('loginSignInPanel').style.display='none';
  document.getElementById('loginSignUpPanel').style.display='block';
  document.getElementById('loginTabSignUp').style.cssText='flex:1;text-align:center;padding:9px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;background:#B8E87A;color:#0f1a0a;transition:all .2s';
  document.getElementById('loginTabSignIn').style.cssText='flex:1;text-align:center;padding:9px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;color:rgba(255,255,255,0.5);transition:all .2s';
  const e=document.getElementById('loginSignUpError');if(e)e.style.display='none';
}
async function _sbSignIn(email,pw,showErr){
  try{
    const {data,error}=await db.auth.signInWithPassword({email,password:pw});
    if(error){showErr(error.message||'Sign in failed.');return false;}
    _sbSession=data.session;_guestMode=false;
    await _sbLoadCurrentUser(data.user);
    _hideLoginScreen();
    if(!_appInitialized)_launchApp();else{buildProfile();showToast('Welcome back, '+_currentUser.username+'!');}
    _sbHydrate().catch(e=>console.warn('[Supabase] hydrate error (non-blocking):',e));
    return true;
  }catch(e){showErr('Could not reach the server — check your connection.');return false;}
}
async function _sbSignUp(username,email,pw,showErr){
  try{
    const {data,error}=await db.auth.signUp({email,password:pw,options:{data:{username}}});
    if(error){showErr(error.message||'Sign up failed.');return false;}
    if(!data.session){
      showErr('Account created — check your email to confirm, then sign in.');
      return false;
    }
    _sbSession=data.session;_guestMode=false;
    try{await db.from('profiles').insert({id:data.user.id,username});}catch(e){console.warn('profile insert:',e);}
    await _sbLoadCurrentUser(data.user);
    _hideLoginScreen();
    if(!_appInitialized)_launchApp();else{buildProfile();showToast('Welcome to WildPath!');}
    _sbHydrate().catch(e=>console.warn('[Supabase] hydrate error (non-blocking):',e));
    return true;
  }catch(e){showErr('Could not reach the server — check your connection.');return false;}
}
function doLogin(){
  const email=(document.getElementById('loginEmail')?.value||'').trim().toLowerCase();
  const pw=document.getElementById('loginPassword')?.value||'';
  const errEl=document.getElementById('loginSignInError');
  const showErr=m=>{if(errEl){errEl.textContent=m;errEl.style.display='block';}};
  if(!email||!pw){showErr('Enter your email and password.');return;}
  _sbSignIn(email,pw,showErr);
}
function doSignup(){
  const username=(document.getElementById('signupUsername')?.value||'').trim();
  const email=(document.getElementById('signupEmail')?.value||'').trim().toLowerCase();
  const pw=document.getElementById('signupPassword')?.value||'';
  const confirm=document.getElementById('signupConfirm')?.value||'';
  const errEl=document.getElementById('loginSignUpError');
  const showErr=msg=>{if(errEl){errEl.textContent=msg;errEl.style.display='block';}};
  if(!username||!email||!pw||!confirm){showErr('All fields are required.');return;}
  if(pw!==confirm){showErr('Passwords do not match.');return;}
  if(pw.length<6){showErr('Password must be at least 6 characters.');return;}
  _sbSignUp(username,email,pw,showErr);
}
function continueAsGuest(){
  _guestMode=true;_sbSession=null;
  _currentUser={id:'guest',username:'Guest',role:'guest',email:''};
  _hideLoginScreen();
  if(!_appInitialized)_launchApp();
  _sbHydrate().catch(e=>console.warn('[Supabase] hydrate error (non-blocking):',e)); // guests still see public spots and posts (RLS allows anon reads)
}

// The live GitHub Pages URL — where Supabase redirects back to after the user
// clicks the password-reset link in their email.
const _LIVE_APP_URL='https://wildpath.github.io/Wildpathapp/wildpath.html';
function openForgotPassword(){
  document.getElementById('fpForm').style.display='block';
  document.getElementById('fpIntro').style.display='block';
  document.getElementById('fpSentMsg').style.display='none';
  const emailInput=document.getElementById('fpEmail');
  if(emailInput)emailInput.value=(document.getElementById('loginEmail')?.value||'').trim();
  document.getElementById('forgotPasswordScreen').style.display='flex';
}
function closeForgotPassword(){
  document.getElementById('forgotPasswordScreen').style.display='none';
}
async function sendPasswordReset(){
  const email=(document.getElementById('fpEmail')?.value||'').trim().toLowerCase();
  if(!email){showToast('Enter your email address');return;}
  try{
    await db.auth.resetPasswordForEmail(email,{redirectTo:_LIVE_APP_URL});
  }catch(e){console.warn('[Supabase] resetPasswordForEmail:',e);}
  // Same confirmation whether or not the email exists in the system —
  // never reveal account existence through this flow.
  document.getElementById('fpForm').style.display='none';
  document.getElementById('fpIntro').style.display='none';
  document.getElementById('fpSentMsg').style.display='block';
}
async function confirmNewPassword(){
  const pw=document.getElementById('npPassword')?.value||'';
  const errEl=document.getElementById('npError');
  const showErr=m=>{if(errEl){errEl.textContent=m;errEl.style.display='block';}};
  if(errEl)errEl.style.display='none';
  if(!pw||pw.length<6){showErr('Password must be at least 6 characters.');return;}
  try{
    const {error}=await db.auth.updateUser({password:pw});
    if(error){showErr(error.message||'Could not update password.');return;}
    document.getElementById('newPasswordScreen').style.display='none';
    showToast('Password updated');
    if(!_appInitialized){
      const {data}=await db.auth.getSession();
      if(data?.session){_sbSession=data.session;await _sbLoadCurrentUser(data.session.user);}
      _launchApp();
      _sbHydrate().catch(e=>console.warn('[Supabase] hydrate error (non-blocking):',e));
    } else {
      showTab('map');
    }
  }catch(e){showErr('Could not reach the server — check your connection.');}
}

function _launchApp(){
  // ── If app is already running (e.g. user just signed in via Profile tab)
  //    skip full re-init — just refresh user-specific UI then fire callback
  if(_appInitialized){
    buildProfile();
    if(_currentUser&&_currentUser.role==='admin')_applyAdminUI();
    if(typeof _loginCallback==='function' && isLoggedIn()){
      const cb=_loginCallback;
      _loginCallback=null;
      setTimeout(cb,50);
    } else {
      _loginCallback=null;
    }
    return;
  }
  _appInitialized=true;

  // Show map tab first so the #map container has real dimensions before
  // Mapbox GL creates its WebGL context — a 0×0 container causes silent failure
  showTab('map');

  initMap();
  buildLayersPanel();
  buildSidePanel();
  buildPlanForm();
  buildProfile();
  // Show location permission card on first run, otherwise init geo
  const locGranted=localStorage.getItem('wp_location_granted');
  if(!locGranted){
    setTimeout(()=>{
      const card=document.getElementById('locationPermCard');
      if(card)card.style.display='flex';
    }, 1800);
  } else {
    setTimeout(initGeolocation, 800);
  }
  // Init service worker
  registerServiceWorker();
  // Restore day mode
  if(localStorage.getItem('wp_day_mode')==='1')document.body.classList.add('day-mode');
  // Restore theme — single canonical key
  if(localStorage.getItem('wp_theme')==='light')document.body.classList.add('light-mode');
  // Update UI for admin users
  if(_currentUser&&_currentUser.role==='admin')_applyAdminUI();
}

// ═══════════════════════════════════════════════════
// MAP INIT
// ═══════════════════════════════════════════════════
function initMap(){
  const tok = localStorage.getItem('mapbox-token') || MAPBOX_TOKEN_DEFAULT;
  mapboxgl.accessToken = tok;

  const savedStyle=localStorage.getItem('wp_map_style')||'standard';
  const styleUrl=MAP_STYLES[savedStyle]?MAP_STYLES[savedStyle].url:MAP_STYLES.standard.url;

  map=new mapboxgl.Map({
    container:'map',
    style:styleUrl,
    center:[-121.5, 38.5],
    zoom:6,
    pitch:0,
    bearing:0,
    attributionControl:false,
    antialias:true,
    minZoom:3,
    maxZoom:22
  });

  // ── Compass button reflects live map bearing (standard map-app behavior) ──
  map.on('rotate',()=>{
    const bearing=-map.getBearing();
    const needle=document.getElementById('compassNeedle');
    if(needle)needle.style.transform=`rotate(${bearing}deg)`;
  });

  map.on('load',()=>{
    console.log('Map loaded successfully');
    // Spot markers as GeoJSON circles (includes community spots via _buildSpotsGeoJSON)
    _initSpotLayers();
    // Land boundary GL layers (sources + empty data)
    _initLandBoundaryLayers();
    // Peak labels
    _initPeakLabels();
    // Friend location dots on main map
    _addFriendDotsToMainMap();
    // Restore 3D if satellite/hybrid were active
    if((currentStyle==='satellite'||currentStyle==='hybrid')&&_map3dOn){
      _enable3DTerrain();
    }
    // Restore any active land layers
    Object.keys(LAND_STYLES).forEach(t=>{if(landLayerCache[t]&&landLayerCache[t].on)showLandType(t);});
    // Fetch land data in background
    _prefetchLandData();
    // Rivers always visible
    loadRiversAlways();
  });

  // Reload rivers / peaks on map move (debounced)
  let _riverReloadTimer=null;
  map.on('moveend',()=>{
    clearTimeout(_riverReloadTimer);
    _riverReloadTimer=setTimeout(loadRiversAlways,2000);
  });

  map.on('error',(e)=>{
    console.error('Mapbox error:',e.error);
    const errEl=document.getElementById('mapError');
    if(errEl){
      const msg=(e.error?.message||'').toLowerCase();
      const status=e.error?.status;
      if(status===401||msg.includes('token')||msg.includes('unauthorized')||msg.includes('access')){
        errEl.classList.add('show');
        // Pre-fill token field if saved token exists (so user can see/correct it)
        const saved=localStorage.getItem('mapbox-token')||'';
        const inp=document.getElementById('mapboxTokenInput');
        if(inp&&saved)inp.value=saved;
      }
    }
  });

  // Click on spot circles — open full detail page directly
  map.on('click','spot-circles',e=>{
    if(e.features&&e.features.length){
      const id=e.features[0].properties.id;
      const spot=[...spots,...userSpots,...personalSpots].find(s=>String(s.id)===String(id));
      if(!spot)return;
      // Measure mode: tapping a spot pin adds it as a measure point instead of opening detail
      if(_measureModeActive){_addMeasurePoint(spot.lat,spot.lng);e.preventDefault();return;}
      openDetail(spot.id);
      e.preventDefault();
    }
  });
  map.on('mouseenter','spot-circles',()=>{map.getCanvas().style.cursor='pointer';});
  map.on('mouseleave','spot-circles',()=>{map.getCanvas().style.cursor='';});

  // Map click — add-spot mode and sheet close
  map.on('click',e=>{
    if(_measureModeActive){_addMeasurePoint(e.lngLat.lat,e.lngLat.lng);return;}
    if(addSpotMode){
      addSpotTempLat=e.lngLat.lat; addSpotTempLng=e.lngLat.lng;
      addSpotMode=false;
      map.getCanvas().style.cursor='';
      showToast('Location pinned');
      document.getElementById('addSpotOverlay').classList.add('open');
      const disp=document.getElementById('aspLocDisplay');
      if(disp){disp.textContent=`${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}`;disp.style.display='block';}
      return;
    }
    if(sheetOpen){closeSheet();}
  });

  _initLongPressPin(map);

  // Sheet swipe dismiss
  const sheet=document.getElementById('spotSheet');
  const handleBar=document.getElementById('sheetHandleBar');
  if(handleBar){
    handleBar.addEventListener('touchstart',e=>{sheetTouchStartY=e.touches[0].clientY;},{passive:true});
    handleBar.addEventListener('touchmove',e=>{
      const dy=e.touches[0].clientY-sheetTouchStartY;
      if(dy>0){sheet.style.transform=`translateY(${dy}px)`;e.preventDefault();}
    },{passive:false});
    handleBar.addEventListener('touchend',e=>{
      const dy=e.changedTouches[0].clientY-sheetTouchStartY;
      if(dy>70)closeSheet();else sheet.style.transform='';
    });
  }
  buildFilterStrip();
}

// Spot type colors
const SPOT_TYPE_COLORS={
  hiking:'#7AB87A',biking:'#D4874A',swimming:'#6A9BC4',caves:'#9B7DC4',
  urban:'#C4524A',scenic:'#D4A843',river:'#5BA8C4',lava_tube:'#C4704A',
  waterfall:'#6ABCD4',natural_slide:'#6ABCD4',rock_climbing:'#D4A843'
};
function _spotColor(type){return SPOT_TYPE_COLORS[type]||'#B8E87A';}

// ═══════════════════════════════════════════════════
// LONG-PRESS QUICK PIN (Section 2) — hold 500ms within
// 10px tolerance anywhere on a map to drop a temp pin
// with inline Personal/Community/Global tier tiles.
// ═══════════════════════════════════════════════════
let _mapLpTimer=null, _lpStartPoint=null, _lpActive=false, _lpMapRef=null;
let _quickPinMarker=null, _quickPinLat=null, _quickPinLng=null, _quickPinTier='personal';

function _initLongPressPin(mapInstance){
  const start=e=>{
    _lpActive=true;
    _lpStartPoint=e.point;
    clearTimeout(_mapLpTimer);
    _mapLpTimer=setTimeout(()=>{
      if(_lpActive)_dropQuickPin(mapInstance,e.lngLat.lat,e.lngLat.lng);
    },500);
  };
  const move=e=>{
    if(!_lpActive||!_lpStartPoint)return;
    const dx=e.point.x-_lpStartPoint.x, dy=e.point.y-_lpStartPoint.y;
    if(Math.hypot(dx,dy)>10){clearTimeout(_mapLpTimer);_lpActive=false;}
  };
  const end=()=>{_lpActive=false;clearTimeout(_mapLpTimer);};
  mapInstance.on('touchstart',start);
  mapInstance.on('touchmove',move);
  mapInstance.on('touchend',end);
  mapInstance.on('mousedown',start);
  mapInstance.on('mousemove',move);
  mapInstance.on('mouseup',end);
}

function _dropQuickPin(mapInstance,lat,lng){
  _lpActive=false;
  _quickPinLat=lat;_quickPinLng=lng;_quickPinTier='personal';
  _lpMapRef=mapInstance;
  if(_quickPinMarker){try{_quickPinMarker.remove();}catch(e){}}
  const el=document.createElement('div');
  el.style.cssText='width:26px;height:26px;border-radius:50% 50% 50% 0;background:#B8E87A;border:2px solid #fff;transform:rotate(-45deg);box-shadow:0 2px 8px rgba(0,0,0,.4)';
  _quickPinMarker=new mapboxgl.Marker({element:el,anchor:'bottom'}).setLngLat([lng,lat]).addTo(mapInstance);
  _pulseAtLocation(lat,lng);
  _showQuickPinCard(lat,lng);
}

async function _showQuickPinCard(lat,lng){
  const existing=document.getElementById('_quickPinCard');
  if(existing)existing.remove();
  const card=document.createElement('div');
  card.id='_quickPinCard';
  card.style.cssText='position:absolute;left:12px;right:12px;bottom:calc(var(--nav-h) + 12px);z-index:850;background:var(--bg1);border:1px solid var(--border2);border-radius:16px;padding:14px;box-shadow:0 8px 24px rgba(0,0,0,.5)';
  card.innerHTML=`
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px">
      <div>
        <div id="_qpAddress" style="font-size:13px;font-weight:700;color:var(--txt0)">Looking up address…</div>
        <div style="font-size:11px;color:var(--txt3);margin-top:2px">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
      </div>
      <div onclick="_cancelQuickPin()" style="width:26px;height:26px;border-radius:50%;background:var(--bg2);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:14px;color:var(--txt2);flex-shrink:0">×</div>
    </div>
    <div id="_qpTierTiles" style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px">
      <div data-tier="personal" onclick="_qpSelectTier('personal')" style="border:1.5px solid var(--accent);background:rgba(184,232,122,.1);border-radius:10px;padding:8px 4px;text-align:center;cursor:pointer">
        <div style="font-size:11px;font-weight:700;color:var(--txt0)">Personal</div>
      </div>
      <div data-tier="community" onclick="_qpSelectTier('community')" style="border:1.5px solid var(--border2);background:var(--bg2);border-radius:10px;padding:8px 4px;text-align:center;cursor:pointer">
        <div style="font-size:11px;font-weight:700;color:var(--txt0)">Community</div>
      </div>
      <div data-tier="global" onclick="_qpSelectTier('global')" style="border:1.5px solid var(--border2);background:var(--bg2);border-radius:10px;padding:8px 4px;text-align:center;cursor:pointer">
        <div style="font-size:11px;font-weight:700;color:var(--txt0)">Global</div>
      </div>
    </div>
    <div id="_qpCommunityPicker" style="display:none;margin-bottom:10px">
      <select id="_qpCommunitySelect" style="width:100%;background:var(--bg2);border:1px solid var(--border2);border-radius:8px;color:var(--txt0);padding:8px;font-size:12px;font-family:var(--font)"></select>
    </div>
    <div style="display:flex;gap:8px">
      <button onclick="_qpSaveNow()" style="flex:1;padding:11px;background:var(--accent);color:#0f1a0a;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:var(--font)">Save as Personal Spot</button>
      <button onclick="_qpCreateFull()" style="flex:1;padding:11px;background:var(--bg2);border:1px solid var(--border2);color:var(--txt0);border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:var(--font)">Create Full Spot</button>
    </div>
  `;
  document.getElementById('app').appendChild(card);
  try{
    const res=await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16`,{headers:{'Accept-Language':'en-US,en'}});
    const data=await res.json();
    const addrEl=document.getElementById('_qpAddress');
    if(addrEl)addrEl.textContent=data.display_name?data.display_name.split(',').slice(0,3).join(', '):'Unnamed location';
  }catch(e){
    const addrEl=document.getElementById('_qpAddress');
    if(addrEl)addrEl.textContent='Unnamed location';
  }
}

function _qpSelectTier(tier){
  _quickPinTier=tier;
  document.querySelectorAll('#_qpTierTiles [data-tier]').forEach(t=>{
    const isSel=t.dataset.tier===tier;
    t.style.borderColor=isSel?'var(--accent)':'var(--border2)';
    t.style.background=isSel?'rgba(184,232,122,.1)':'var(--bg2)';
  });
  const picker=document.getElementById('_qpCommunityPicker');
  if(picker){
    picker.style.display=tier==='community'?'block':'none';
    if(tier==='community'){
      const sel=document.getElementById('_qpCommunitySelect');
      const myUid=String(_myUid());
      const myComms=getCommunities().filter(c=>getMembers(c.id).includes(myUid));
      sel.innerHTML=myComms.length?myComms.map(c=>`<option value="${c.id}">${sanitize(c.name)}</option>`).join(''):'<option value="">Join a community first</option>';
    }
  }
  const saveBtn=document.querySelector('#_quickPinCard button');
  if(saveBtn)saveBtn.textContent=tier==='personal'?'Save as Personal Spot':tier==='community'?'Submit to Community':'Submit for Review';
}

function _qpSaveNow(){
  if(isGuest()){showLoginScreen();return;}
  const addrEl=document.getElementById('_qpAddress');
  const name=(addrEl?.textContent||'New Spot').split(',')[0].trim()||'New Spot';
  if(_quickPinTier==='personal'){
    _submitPersonalSpot(name,'scenic',_quickPinLat,_quickPinLng,'',[]);
  } else if(_quickPinTier==='community'){
    const cid=document.getElementById('_qpCommunitySelect')?.value;
    if(!cid){showToast('Select a community first');return;}
    _submitCommunityPendingSpot(cid,name,'scenic',_quickPinLat,_quickPinLng,'',[]);
  } else {
    submitSpotForReview({name,type:'scenic',lat:_quickPinLat,lng:_quickPinLng,legal:'caution',photos:[]});
  }
  _cancelQuickPin();
}

function _qpCreateFull(){
  const lat=_quickPinLat,lng=_quickPinLng,tier=_quickPinTier;
  _cancelQuickPin();
  addSpotTempLat=lat;addSpotTempLng=lng;
  openAddSpot(tier);
  setTimeout(()=>{
    const disp=document.getElementById('aspLocDisplay');
    if(disp){disp.textContent=`${lat.toFixed(5)}, ${lng.toFixed(5)}`;disp.style.display='block';}
  },100);
}

function _cancelQuickPin(){
  if(_quickPinMarker){try{_quickPinMarker.remove();}catch(e){}_quickPinMarker=null;}
  document.getElementById('_quickPinCard')?.remove();
}

// ═══════════════════════════════════════════════════
// DISTANCE MEASURING TOOL (Section 10) — three input
// methods: tap points, type From/To locations, or tap
// two spot pins in sequence (handled in spot-circles click).
// ═══════════════════════════════════════════════════
let _measureModeActive=false, _measurePoints=[], _measureDriving=false;

function startMeasureMode(){
  if(_measureModeActive){showToast('Already measuring');return;}
  _measureModeActive=true;_measurePoints=[];_measureDriving=false;
  const border=document.createElement('div');
  border.id='_measureBorder';
  border.className='measure-mode-border';
  document.getElementById('map-screen')?.appendChild(border);
  _showMeasureCard();
  showToast('Tap points on the map to measure distance');
}

function _measureSegmentDistanceMi(lat1,lng1,lat2,lng2){
  const straightMi=_haversine(lat1,lng1,lat2,lng2)*0.000621371;
  return _measureDriving?straightMi*1.3:straightMi;
}
function _measureTotalDistanceMi(){
  let total=0;
  for(let i=1;i<_measurePoints.length;i++){
    const a=_measurePoints[i-1],b=_measurePoints[i];
    total+=_measureSegmentDistanceMi(a.lat,a.lng,b.lat,b.lng);
  }
  return total;
}

function _addMeasurePoint(lat,lng,label){
  _measurePoints.push({lat,lng,label:label||null});
  _renderMeasureOverlay();
  _updateMeasureCard();
}

function _renderMeasureOverlay(){
  if(!map)return;
  const coords=_measurePoints.map(p=>[p.lng,p.lat]);
  const lineGeo={type:'Feature',geometry:{type:'LineString',coordinates:coords}};
  if(map.getSource('measure-line-src')){map.getSource('measure-line-src').setData(lineGeo);}
  else{
    map.addSource('measure-line-src',{type:'geojson',data:lineGeo});
    map.addLayer({id:'measure-line',type:'line',source:'measure-line-src',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#ffffff','line-width':2.5,'line-dasharray':[2,2]}});
  }
  const dotFeatures=_measurePoints.map(p=>({type:'Feature',geometry:{type:'Point',coordinates:[p.lng,p.lat]},properties:{}}));
  const dotGeo={type:'FeatureCollection',features:dotFeatures};
  if(map.getSource('measure-dots-src')){map.getSource('measure-dots-src').setData(dotGeo);}
  else{
    map.addSource('measure-dots-src',{type:'geojson',data:dotGeo});
    map.addLayer({id:'measure-dots',type:'circle',source:'measure-dots-src',paint:{'circle-radius':5,'circle-color':'#ffffff','circle-stroke-width':1.5,'circle-stroke-color':'#000'}});
  }
  // Per-segment midpoint distance labels
  const labelFeatures=[];
  for(let i=1;i<_measurePoints.length;i++){
    const a=_measurePoints[i-1],b=_measurePoints[i];
    const mid=[(a.lng+b.lng)/2,(a.lat+b.lat)/2];
    const segMi=_measureSegmentDistanceMi(a.lat,a.lng,b.lat,b.lng);
    labelFeatures.push({type:'Feature',geometry:{type:'Point',coordinates:mid},properties:{label:segMi.toFixed(2)+' mi'}});
  }
  const labelGeo={type:'FeatureCollection',features:labelFeatures};
  if(map.getSource('measure-labels-src')){map.getSource('measure-labels-src').setData(labelGeo);}
  else{
    map.addSource('measure-labels-src',{type:'geojson',data:labelGeo});
    map.addLayer({id:'measure-labels',type:'symbol',source:'measure-labels-src',layout:{'text-field':['get','label'],'text-size':11,'text-font':['Open Sans Bold','Arial Unicode MS Bold']},paint:{'text-color':'#fff','text-halo-color':'rgba(0,0,0,.8)','text-halo-width':1.5}});
  }
}

function _showMeasureCard(){
  const existing=document.getElementById('_measureCard');
  if(existing)existing.remove();
  const card=document.createElement('div');
  card.id='_measureCard';
  card.style.cssText='position:absolute;left:12px;right:12px;bottom:calc(var(--nav-h) + 12px);z-index:850;background:var(--bg1);border:1px solid var(--border2);border-radius:16px;padding:14px;box-shadow:0 8px 24px rgba(0,0,0,.5)';
  card.innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div>
        <span id="_measureTotal" style="font-size:18px;font-weight:800;color:var(--accent)">0.00 mi</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div onclick="_measureUseMyLocation()" title="Use my location" style="width:26px;height:26px;border-radius:50%;background:var(--bg2);display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--txt1)">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
        </div>
        <div onclick="_exitMeasureMode()" style="width:26px;height:26px;border-radius:50%;background:var(--bg2);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:14px;color:var(--txt2)">×</div>
      </div>
    </div>
    <div style="display:flex;background:var(--bg2);border-radius:10px;padding:3px;margin-bottom:10px">
      <div id="_measureModeStraight" onclick="_setMeasureDriveMode(false)" style="flex:1;text-align:center;padding:7px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;background:var(--accent);color:#0f1a0a">Straight Line</div>
      <div id="_measureModeDriving" onclick="_setMeasureDriveMode(true)" style="flex:1;text-align:center;padding:7px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;color:var(--txt2)">Est. Driving</div>
    </div>
    <div id="_measureNavRow" style="display:none;gap:8px;margin-bottom:10px"></div>
    <div id="_measureLocSearchRow" style="display:none;gap:8px;margin-bottom:10px;flex-direction:column">
      <input id="_measureFromInput" placeholder="From…" oninput="_measureLocSearch('from',this.value)" style="background:var(--bg2);border:1px solid var(--border2);border-radius:8px;color:var(--txt0);padding:8px 10px;font-size:12px;font-family:var(--font);outline:none">
      <div id="_measureFromDrop" class="ac-drop"></div>
      <input id="_measureToInput" placeholder="To…" oninput="_measureLocSearch('to',this.value)" style="background:var(--bg2);border:1px solid var(--border2);border-radius:8px;color:var(--txt0);padding:8px 10px;font-size:12px;font-family:var(--font);outline:none">
      <div id="_measureToDrop" class="ac-drop"></div>
    </div>
    <div style="display:flex;gap:8px">
      <div onclick="_toggleMeasureLocSearch()" style="flex:1;text-align:center;padding:9px;background:var(--bg2);border:1px solid var(--border2);border-radius:9px;font-size:11px;font-weight:700;color:var(--txt1);cursor:pointer">Type Locations</div>
      <div onclick="_undoMeasurePoint()" style="flex:1;text-align:center;padding:9px;background:var(--bg2);border:1px solid var(--border2);border-radius:9px;font-size:11px;font-weight:700;color:var(--txt1);cursor:pointer">Undo</div>
      <div onclick="_clearMeasurePoints()" style="flex:1;text-align:center;padding:9px;background:var(--bg2);border:1px solid var(--border2);border-radius:9px;font-size:11px;font-weight:700;color:var(--txt1);cursor:pointer">Clear</div>
    </div>
  `;
  document.getElementById('app').appendChild(card);
  _updateMeasureNavButtons();
}
function _updateMeasureCard(){
  const el=document.getElementById('_measureTotal');
  if(el)el.textContent=_measureTotalDistanceMi().toFixed(2)+' mi';
  _updateMeasureNavButtons();
}
// Nav buttons only need the first and last point — turn-by-turn apps don't
// support arbitrary waypoint chains the way this tool's line does.
function _updateMeasureNavButtons(){
  const row=document.getElementById('_measureNavRow');
  if(!row)return;
  if(_measurePoints.length<2){row.style.display='none';row.innerHTML='';return;}
  row.style.display='flex';
  row.innerHTML=`
    <div onclick="_openAppleMapsNav()" style="flex:1;text-align:center;padding:9px;background:transparent;border:1.5px solid var(--border2);border-radius:9px;font-size:11px;font-weight:700;color:var(--txt0);cursor:pointer">Open in Apple Maps</div>
    <div onclick="_openGoogleMapsNav()" style="flex:1;text-align:center;padding:9px;background:transparent;border:1.5px solid var(--border2);border-radius:9px;font-size:11px;font-weight:700;color:var(--txt0);cursor:pointer">Open in Google Maps</div>
  `;
}
function _openAppleMapsNav(){
  if(_measurePoints.length<2)return;
  const o=_measurePoints[0],d=_measurePoints[_measurePoints.length-1];
  window.open(`maps://maps.apple.com/?saddr=${o.lat},${o.lng}&daddr=${d.lat},${d.lng}&dirflg=d`,'_blank');
}
function _openGoogleMapsNav(){
  if(_measurePoints.length<2)return;
  const o=_measurePoints[0],d=_measurePoints[_measurePoints.length-1];
  window.open(`https://www.google.com/maps/dir/?api=1&origin=${o.lat},${o.lng}&destination=${d.lat},${d.lng}&travelmode=driving`,'_blank');
}
// Reuse the already-cached GPS fix (_userLat/_userLng) if the blue dot is already
// active, so this never triggers a second permission prompt on top of Locate Me.
function _measureUseMyLocation(){
  if(_userLat!=null&&_userLng!=null){
    _addMeasurePoint(_userLat,_userLng,'My Location');
    showToast('Added your current location');
    return;
  }
  if(!navigator.geolocation){showToast('Location not available on this device');return;}
  navigator.geolocation.getCurrentPosition(
    pos=>{
      const lat=pos.coords.latitude,lng=pos.coords.longitude;
      _userLat=lat;_userLng=lng;window._lastUserLat=lat;window._lastUserLng=lng;
      _placeUserDot(lat,lng);
      _addMeasurePoint(lat,lng,'My Location');
      showToast('Added your current location');
    },
    ()=>showToast('Could not get your location'),
    {enableHighAccuracy:true,timeout:10000}
  );
}
function _setMeasureDriveMode(driving){
  _measureDriving=driving;
  const straightEl=document.getElementById('_measureModeStraight');
  const drivingEl=document.getElementById('_measureModeDriving');
  if(straightEl){straightEl.style.background=driving?'':'var(--accent)';straightEl.style.color=driving?'var(--txt2)':'#0f1a0a';}
  if(drivingEl){drivingEl.style.background=driving?'var(--accent)':'';drivingEl.style.color=driving?'#0f1a0a':'var(--txt2)';}
  _renderMeasureOverlay();
  _updateMeasureCard();
}
function _undoMeasurePoint(){
  _measurePoints.pop();
  _renderMeasureOverlay();
  _updateMeasureCard();
}
function _clearMeasurePoints(){
  _measurePoints=[];
  _renderMeasureOverlay();
  _updateMeasureCard();
}
function _toggleMeasureLocSearch(){
  const row=document.getElementById('_measureLocSearchRow');
  if(row)row.style.display=row.style.display==='none'?'flex':'none';
}
let _measureFromLL=null,_measureToLL=null;
async function _measureLocSearch(which,q){
  const dropId=which==='from'?'_measureFromDrop':'_measureToDrop';
  const drop=document.getElementById(dropId);
  if(!drop)return;
  if(!q.trim()){drop.classList.remove('open');return;}
  clearTimeout(window['_measureSearchTimer_'+which]);
  window['_measureSearchTimer_'+which]=setTimeout(async()=>{
    try{
      const res=await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`,{headers:{'Accept-Language':'en-US,en'}});
      const data=await res.json();
      drop.innerHTML=data.map(d=>`<div class="ac-item" onclick='_selectMeasureLoc("${which}",${d.lat},${d.lon},${JSON.stringify((d.display_name||'').split(',')[0])})'><div class="ac-name">${sanitize((d.display_name||'').split(',')[0])}</div></div>`).join('');
      drop.classList.add('open');
    }catch(e){}
  },350);
}
function _selectMeasureLoc(which,lat,lng,name){
  const inp=document.getElementById(which==='from'?'_measureFromInput':'_measureToInput');
  const drop=document.getElementById(which==='from'?'_measureFromDrop':'_measureToDrop');
  if(inp)inp.value=name;
  if(drop)drop.classList.remove('open');
  if(which==='from')_measureFromLL={lat:parseFloat(lat),lng:parseFloat(lng)};
  else _measureToLL={lat:parseFloat(lat),lng:parseFloat(lng)};
  if(_measureFromLL&&_measureToLL){
    _measurePoints=[_measureFromLL,_measureToLL];
    _renderMeasureOverlay();
    _updateMeasureCard();
    const bounds=[[Math.min(_measureFromLL.lng,_measureToLL.lng),Math.min(_measureFromLL.lat,_measureToLL.lat)],[Math.max(_measureFromLL.lng,_measureToLL.lng),Math.max(_measureFromLL.lat,_measureToLL.lat)]];
    if(map)map.fitBounds(bounds,{padding:80,duration:600});
  }
}
function _exitMeasureMode(){
  _measureModeActive=false;
  _measurePoints=[];
  _measureFromLL=null;_measureToLL=null;
  document.getElementById('_measureBorder')?.remove();
  document.getElementById('_measureCard')?.remove();
  if(map){
    ['measure-line','measure-dots','measure-labels'].forEach(id=>{try{if(map.getLayer(id))map.removeLayer(id);}catch(e){}});
    ['measure-line-src','measure-dots-src','measure-labels-src'].forEach(id=>{try{if(map.getSource(id))map.removeSource(id);}catch(e){}});
  }
}

function _buildSpotsGeoJSON(){
  // Merge global spots, user-added spots, and spots from all communities the user is in
  const commSpots=getAllCommunitySpots();
  const commSpotIds=new Set(commSpots.map(s=>s.id));
  // Avoid dupes (community spots that were also added to userSpots via submitSpotForReview)
  const allS=[...spots,...userSpots.filter(s=>!commSpotIds.has(s.id)),...commSpots];
  const FILTER_TYPES={water:['swimming','river','waterfall','natural_slide'],caves:['caves','lava_tube'],hiking:['hiking'],biking:['biking'],views:['scenic'],urban:['urban'],climb:['rock_climbing']};
  let filtered=activeFilters.size>0?allS.filter(s=>{let ok=false;activeFilters.forEach(fid=>{const t=FILTER_TYPES[fid]||[];if(t.includes(s.type))ok=true;});return ok;}):allS;
  if(hiddenGemFilterActive)filtered=filtered.filter(s=>s.hiddenGem);
  // Build saved and visited sets for pin colors
  const savedSet=new Set(getSavedSpotIds());
  const myUid=String(_myUid&&_myUid()||'guest');
  const postedSet=new Set(getPosts().filter(p=>String(p.userId)===myUid&&p.spotId).map(p=>p.spotId));
  const features=filtered.map(s=>{
    // Pin color: yellow=visited/posted, red=saved, white=public
    let pinColor='#FFFFFF';
    if(postedSet.has(s.id))pinColor='#F5C842';
    else if(savedSet.has(s.id))pinColor='#E05252';
    return{type:'Feature',geometry:{type:'Point',coordinates:[s.lng,s.lat]},properties:{id:s.id,name:s.name,type:s.type,color:pinColor}};
  });
  // My own pending submissions — visible only to me, marked Pending Review
  getPendingSpots().filter(s=>String(s._submitterUid)===myUid&&s.lat&&s.lng).forEach(s=>{
    features.push({type:'Feature',geometry:{type:'Point',coordinates:[s.lng,s.lat]},
      properties:{id:s.id,name:s.name+' — Pending Review',type:s.type,color:'#D4874A',pending:1}});
  });
  // My personal spots — always gold, only I ever see these (RLS-scoped at the source)
  personalSpots.forEach(s=>{
    features.push({type:'Feature',geometry:{type:'Point',coordinates:[s.lng,s.lat]},
      properties:{id:s.id,name:s.name,type:s.type,color:'#D4A843',personal:1}});
  });
  // Saved raw locations (no other pin exists for these — saved real/personal spots
  // are already colored red/gold by the logic above and shouldn't be duplicated here)
  savedPlaces.filter(p=>p.refType==='raw_location').forEach(p=>{
    features.push({type:'Feature',geometry:{type:'Point',coordinates:[p.lng,p.lat]},
      properties:{id:'saved_'+p.id,name:p.name,type:'saved',color:'#E05252',saved:1}});
  });
  return{type:'FeatureCollection',features};
}

function _initSpotLayers(){
  if(!map)return;
  const geojson=_buildSpotsGeoJSON();
  if(map.getSource('spots')){map.getSource('spots').setData(geojson);return;}
  map.addSource('spots',{
    type:'geojson',
    data:geojson,
    cluster:true,
    clusterMaxZoom:11,
    clusterRadius:50
  });
  // Cluster bubble
  map.addLayer({id:'spot-clusters',type:'circle',source:'spots',
    filter:['has','point_count'],
    paint:{
      'circle-color':['step',['get','point_count'],'#B8E87A',5,'#7AB87A',20,'#4A9849'],
      'circle-radius':['step',['get','point_count'],16,5,22,20,28],
      'circle-stroke-width':2,'circle-stroke-color':'#fff','circle-opacity':0.9
    }
  });
  // Cluster count label
  map.addLayer({id:'spot-cluster-count',type:'symbol',source:'spots',
    filter:['has','point_count'],
    layout:{'text-field':['get','point_count_abbreviated'],'text-font':['Open Sans Bold','Arial Unicode MS Bold'],'text-size':12},
    paint:{'text-color':'#0b1a0b'}
  });
  // Individual pins (unclustered)
  map.addLayer({id:'spot-halos',type:'circle',source:'spots',
    filter:['!',['has','point_count']],
    paint:{'circle-radius':9,'circle-color':'#fff','circle-opacity':0.9}
  });
  map.addLayer({id:'spot-circles',type:'circle',source:'spots',
    filter:['!',['has','point_count']],
    paint:{'circle-radius':6,'circle-color':['get','color'],'circle-stroke-width':1.5,'circle-stroke-color':'#fff'}
  });
  // Click cluster → zoom in
  map.on('click','spot-clusters',e=>{
    const features=map.queryRenderedFeatures(e.point,{layers:['spot-clusters']});
    if(!features.length)return;
    map.getSource('spots').getClusterExpansionZoom(features[0].properties.cluster_id,(err,zoom)=>{
      if(err)return;
      map.easeTo({center:features[0].geometry.coordinates,zoom:zoom+0.5,duration:400});
    });
  });
  map.on('mouseenter','spot-clusters',()=>{map.getCanvas().style.cursor='pointer';});
  map.on('mouseleave','spot-clusters',()=>{map.getCanvas().style.cursor='';});
}

function refreshSpotMarkers(){
  if(!map||!map.getSource('spots'))return;
  map.getSource('spots').setData(_buildSpotsGeoJSON());
}

// Add friend real-time location dots to main map (small blue dots)
let _friendMainMapMarkers=[];
function _addFriendDotsToMainMap(){
  if(!map)return;
  _friendMainMapMarkers.forEach(m=>{try{m.remove();}catch(e){}});
  _friendMainMapMarkers=[];
  const myUid=String(_myUid&&_myUid()||'guest');
  const follows=getFollows&&getFollows()||{};
  const followingIds=follows[myUid]||[];
  followingIds.forEach(uid=>{
    const locData=localStorage.getItem('wildpath-user-location-'+uid);
    if(!locData)return;
    try{
      const loc=JSON.parse(locData);
      if(Date.now()-loc.ts>3600000)return;// older than 1 hour
      const prof=getUserProfile&&getUserProfile(uid)||{};
      const name=prof.username||uid;
      const el=document.createElement('div');
      el.style.cssText='width:20px;height:20px;border-radius:50%;background:#6EC6F5;border:2px solid #fff;box-shadow:0 0 0 3px rgba(110,198,245,.3);display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;color:#0a1a2a;cursor:pointer';
      el.textContent=name.slice(0,2).toUpperCase();
      const marker=new mapboxgl.Marker({element:el}).setLngLat([loc.lng,loc.lat]).setPopup(new mapboxgl.Popup({offset:14}).setHTML(`<div style="color:#fff;font-size:12px"><strong>@${name}</strong><br><span style="opacity:.7">Live location</span></div>`)).addTo(map);
      _friendMainMapMarkers.push(marker);
    }catch(e){}
  });
}

// Add a new spot to the map (called after user submits)
function addSpotMarkerToMap(spot){
  // Just refresh the GeoJSON — spot is already in userSpots by the time this runs
  refreshSpotMarkers();
}

// Peak labels as MapLibre symbol layer
function _initPeakLabels(){
  if(!map)return;
  const geojson={type:'FeatureCollection',features:NORCAL_PEAKS.map(p=>({type:'Feature',geometry:{type:'Point',coordinates:[p.lng,p.lat]},properties:{name:p.name,elev:p.elev.toLocaleString()+' ft'}}))};
  if(map.getSource('peaks')){map.getSource('peaks').setData(geojson);return;}
  map.addSource('peaks',{type:'geojson',data:geojson});
  map.addLayer({id:'peak-labels',type:'symbol',source:'peaks',minzoom:7,layout:{'text-field':['concat',['get','name'],'\n',['get','elev']],'text-font':['Open Sans Bold','Arial Unicode MS Bold'],'text-size':10,'text-offset':[0,1.1],'text-anchor':'top'},paint:{'text-color':'#e8dece','text-halo-color':'rgba(20,17,14,0.9)','text-halo-width':1.5}});
}

function updatePeakVisibility(){/* handled by MapLibre minzoom */}

// ── Map style switcher ────────────────────────────
function setMapStyle(key){
  if(!MAP_STYLES[key]||!map)return;
  const prevStyle=currentStyle;
  currentStyle=key;
  console.log('Style switched to ' + key);

  // Disable 3D when switching to non-satellite styles
  if(key==='standard'||key==='terrain'){
    _disable3DTerrain();
    _map3dOn=false;
  }
  // Show/hide 3D toggle button in dot menu
  _update3DToggleVisibility();

  // Guard against double-firing
  let _styleInitDone=false;
  function _onStyleReady(){
    if(_styleInitDone)return; _styleInitDone=true;
    console.log('Style.load fired for '+key);
    // Re-add all custom layers in correct order:
    // 1. Terrain (if satellite/hybrid and 3D was on)
    if((key==='satellite'||key==='hybrid')&&_map3dOn){
      _enable3DTerrain();
    }
    // 2. BLM layer
    // 3. National Forest layer
    // 4. State Parks layer
    _initLandBoundaryLayers();
    // Restore active land layers from cache
    Object.keys(LAND_STYLES).forEach(t=>{
      if(landLayerCache[t]&&landLayerCache[t].on)showLandType(t);
    });
    // 5. All spot pins
    _initSpotLayers();
    // 6. Peak labels
    _initPeakLabels();
    // 7. Rivers always visible
    _riversBounds=null; // force reload after style switch
    loadRiversAlways();
    // 8. Restore county + private land layers if they were on
    const countyToggle=document.getElementById('spToggle-counties')||document.getElementById('toggle-counties');
    if(countyToggle&&countyToggle.classList.contains('on')){
      _countiesLoaded=false; // force re-add since GL layers were destroyed
      const wasOn=true;
      countyToggle.classList.remove('on'); // toggleCountyLayer reads 'on' class to decide direction
      toggleCountyLayer(countyToggle);
    }
    const privToggle=document.getElementById('spToggle-privateland')||document.getElementById('toggle-privateland');
    if(privToggle&&privToggle.classList.contains('on')){
      _privateLandLoaded=false;
      privToggle.classList.remove('on');
      togglePrivateLandLayer(privToggle);
    }
    // Re-add markers
    if(_userDotMarker&&_userLat)_userDotMarker.addTo(map);
    if(_carMarker&&localStorage.getItem('wp_car_pin')){
      const p=JSON.parse(localStorage.getItem('wp_car_pin'));
      if(p)_carMarker.setLngLat([p.lng,p.lat]).addTo(map);
    }
  }

  map.once('style.load', _onStyleReady);

  map.setStyle(MAP_STYLES[key].url);

  // Update style grid chips
  document.querySelectorAll('.map-style-tile').forEach(t=>t.classList.remove('active'));
  const tile=document.getElementById('tile-'+key);
  if(tile)tile.classList.add('active');
  document.querySelectorAll('.style-chip').forEach(c=>c.classList.remove('active'));
  const chip=document.getElementById('style-'+key);
  if(chip)chip.classList.add('active');
  localStorage.setItem('wp_map_style',key);
}

function applyTileFilter(){/* no-op — Mapbox handles styling natively */}

function _update3DToggleVisibility(){
  const item=document.getElementById('dotMenu3DItem');
  if(!item)return;
  const isSatOrHybrid=(currentStyle==='satellite'||currentStyle==='hybrid');
  item.style.display=isSatOrHybrid?'flex':'none';
}

// ═══════════════════════════════════════════════════
// LAND OWNERSHIP LAYERS — Mapbox GL fill + outline
// Data fetched once on load, cached in memory,
// re-added from cache after every style switch.
// ═══════════════════════════════════════════════════
const LAND_STYLES={
  nationalForest:{color:'#4A7C59',fillColor:'#4A7C59',fillOpacity:0.15,width:5,label:'National Forest'},
  blm:           {color:'#D4A843',fillColor:'#D4A843',fillOpacity:0.15,width:5,label:'BLM Land'},
  stateParks:    {color:'#4A9EF5',fillColor:'#4A9EF5',fillOpacity:0.20,width:5,label:'State Park'},
  private:       {color:'#E8453C',fillColor:'#E8453C',fillOpacity:0.08,width:2,  label:'Private Property'}
};

const LAND_FETCH_URLS={
  blm: "https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_LimitedScale/MapServer/7/query?where=ADMIN_ST='CA'+AND+ADMIN_AGENCY_CODE='BLM'&outFields=ADMIN_UNIT_NAME&returnGeometry=true&resultRecordCount=500&f=geojson",
  nationalForest: "https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_LimitedScale/MapServer/9/query?where=ADMIN_ST='CA'&outFields=ADMIN_UNIT_NAME&returnGeometry=true&resultRecordCount=500&f=geojson",
  stateParks: "https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_LimitedScale/MapServer/14/query?where=ADMIN_ST='CA'+AND+ADMIN_AGENCY_CODE='ST'&outFields=ADMIN_UNIT_NAME&returnGeometry=true&resultRecordCount=500&f=geojson"
};

// Fetch all three land datasets concurrently on app load
// Data stored in _blmGeoJSON / _nfGeoJSON / _spGeoJSON
// ═══════════════════════════════════════════════════
// HIKES ON THE MAP (Section 9) — distinct trail-icon pins,
// separate from spot circles. Tap draws the route + opens detail.
// ═══════════════════════════════════════════════════
let _hikeMarkers=[];
function _renderHikePins(){
  if(!map)return;
  _hikeMarkers.forEach(mk=>{try{mk.remove();}catch(e){}});
  _hikeMarkers=[];
  allHikes.forEach(h=>{
    // Pending hikes never show as map pins for anyone but their creator —
    // they surface only in the relevant approval queue until approved.
    if(h.status!=='approved'&&String(h.user_id)!==String(_myUid()))return;
    const coords=h.route_geojson?.geometry?.coordinates;
    if(!coords||!coords.length)return;
    const trailhead=coords[0]; // [lng,lat]
    const diffColor=h.difficulty==='Easy'?'#4CAF50':h.difficulty==='Hard'?'#E05252':'#D4A843';
    const el=document.createElement('div');
    el.style.cssText=`width:26px;height:26px;border-radius:6px;background:${diffColor};border:2px solid #fff;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.4)`;
    el.innerHTML='<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#fff" stroke-width="2.2"><path d="M8 3l4 8 5-5 5 15H2z"/></svg>';
    el.onclick=()=>openHikeDetail(h.id);
    const marker=new mapboxgl.Marker({element:el}).setLngLat(trailhead).addTo(map);
    _hikeMarkers.push(marker);
  });
}

function openHikeDetail(hikeId){
  const h=allHikes.find(x=>String(x.id)===String(hikeId));
  if(!h)return;
  const coords=h.route_geojson?.geometry?.coordinates||[];
  // Draw the full route on the main map
  _clearHikeRouteOnMap();
  if(coords.length>1&&map){
    map.addSource('active-hike-route-src',{type:'geojson',data:{type:'Feature',geometry:{type:'LineString',coordinates:coords}}});
    map.addLayer({id:'active-hike-route-line',type:'line',source:'active-hike-route-src',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#B8E87A','line-width':4,'line-opacity':.9}});
    const bounds=coords.reduce((b,c)=>b.extend(c),new mapboxgl.LngLatBounds(coords[0],coords[0]));
    map.fitBounds(bounds,{padding:80,duration:600});
  }
  const diffColor=h.difficulty==='Easy'?'#4CAF50':h.difficulty==='Hard'?'#E05252':'#D4A843';
  const trailhead=coords[0]||[0,0];
  const existing=document.getElementById('_hikeDetailSheet');
  if(existing)existing.remove();
  const sheet=document.createElement('div');
  sheet.id='_hikeDetailSheet';
  sheet.style.cssText='position:absolute;inset:0;z-index:820;background:rgba(0,0,0,.75);display:flex;align-items:flex-end';
  sheet.onclick=(e)=>{if(e.target===sheet){sheet.remove();_clearHikeRouteOnMap();}};
  sheet.innerHTML=`<div style="background:var(--bg1);border-radius:20px 20px 0 0;width:100%;max-height:80vh;overflow-y:auto;padding:0 0 calc(env(safe-area-inset-bottom,0px)+16px)">
    <div style="padding:16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
      <div style="font-size:17px;font-weight:700;color:var(--txt0)">${sanitize(h.name)}</div>
      <button onclick="document.getElementById('_hikeDetailSheet').remove();_clearHikeRouteOnMap()" style="background:var(--bg2);border:1px solid var(--border);color:var(--txt1);border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:14px">×</button>
    </div>
    <div style="padding:16px">
      <span style="display:inline-block;background:${diffColor}22;border:1px solid ${diffColor};color:${diffColor};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:4px 10px;border-radius:10px;margin-bottom:14px">${h.difficulty||'Moderate'}</span>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">
        <div style="background:var(--bg2);border-radius:12px;padding:12px;text-align:center">
          <div style="font-size:16px;font-weight:800;color:var(--txt0)">${h.distance||0} mi</div>
          <div style="font-size:9px;color:var(--txt3);text-transform:uppercase;margin-top:2px">Distance</div>
        </div>
        <div style="background:var(--bg2);border-radius:12px;padding:12px;text-align:center">
          <div style="font-size:16px;font-weight:800;color:var(--txt0)">${h.elevation_gain||0} ft</div>
          <div style="font-size:9px;color:var(--txt3);text-transform:uppercase;margin-top:2px">Elev Gain</div>
        </div>
        <div style="background:var(--bg2);border-radius:12px;padding:12px;text-align:center">
          <div style="font-size:16px;font-weight:800;color:var(--txt0)">${_fmtHikeDuration(h.duration)}</div>
          <div style="font-size:9px;color:var(--txt3);text-transform:uppercase;margin-top:2px">Est. Time</div>
        </div>
      </div>
      ${h.description?`<div style="font-size:13px;color:var(--txt1);line-height:1.6;margin-bottom:16px">${sanitize(h.description)}</div>`:''}
      ${(h.photo_urls&&h.photo_urls.length)?`<div style="display:flex;gap:8px;overflow-x:auto;margin-bottom:16px">${h.photo_urls.map(u=>`<img src="${u}" style="width:100px;height:100px;object-fit:cover;border-radius:10px;flex-shrink:0">`).join('')}</div>`:''}
      <button onclick="_startHikeNavigation(${trailhead[1]},${trailhead[0]})" style="width:100%;padding:14px;background:var(--accent);border:none;border-radius:12px;color:#0f1a0a;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
        Start Navigation
      </button>
    </div>
  </div>`;
  document.getElementById('app').appendChild(sheet);
}
function _clearHikeRouteOnMap(){
  if(!map)return;
  try{if(map.getLayer('active-hike-route-line'))map.removeLayer('active-hike-route-line');}catch(e){}
  try{if(map.getSource('active-hike-route-src'))map.removeSource('active-hike-route-src');}catch(e){}
}
function _startHikeNavigation(lat,lng){
  const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent);
  const url=isIOS?`https://maps.apple.com/?daddr=${lat},${lng}`:`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  window.open(url,'_blank');
}

async function _prefetchLandData(){
  console.log('[WildPath] Land fetch URLs:');
  console.log('  BLM:', LAND_FETCH_URLS.blm);
  console.log('  National Forest:', LAND_FETCH_URLS.nationalForest);
  console.log('  State Parks:', LAND_FETCH_URLS.stateParks);
  const fetchWithTimeout=async(url,name)=>{
    try{
      const ctrl=new AbortController();
      const tid=setTimeout(()=>ctrl.abort(),15000);
      const res=await fetch(url,{signal:ctrl.signal});
      clearTimeout(tid);
      if(!res.ok)throw new Error(`HTTP ${res.status} from ${url}`);
      const j=await res.json();
      console.log(`[WildPath] ${name}: ${j.features?.length||0} features loaded`);
      return j;
    }catch(e){
      console.error(`[WildPath] ${name} fetch failed: ${e.message}`);
      return null;
    }
  };
  const [blm,nf,sp]=await Promise.all([
    fetchWithTimeout(LAND_FETCH_URLS.blm,'BLM'),
    fetchWithTimeout(LAND_FETCH_URLS.nationalForest,'National Forest'),
    fetchWithTimeout(LAND_FETCH_URLS.stateParks,'State Parks')
  ]);
  if(blm){_blmGeoJSON=blm; if(landLayerCache.blm?.on)showLandType('blm');}
  if(nf) {_nfGeoJSON=nf;  if(landLayerCache.nationalForest?.on)showLandType('nationalForest');}
  if(sp) {_spGeoJSON=sp;  if(landLayerCache.stateParks?.on)showLandType('stateParks');}
  const failed=[!blm&&'BLM',!nf&&'National Forest',!sp&&'State Parks'].filter(Boolean);
  if(failed.length)_showRetryToast(failed.join(' + ')+' boundaries failed to load','_prefetchLandData()');
}

// Called on map load + after every style switch
// Creates empty GeoJSON sources and fill+line layers
function _initLandBoundaryLayers(){
  if(!map)return;
  const empty={type:'FeatureCollection',features:[]};
  Object.entries(LAND_STYLES).forEach(([type,sty])=>{
    const srcId=`land-${type}`;
    const fillId=`land-${type}-fill`;
    const lineId=`land-${type}-line`;

    const outlineId=`land-${type}-outline`;
    // Source
    if(!map.getSource(srcId)){
      map.addSource(srcId,{type:'geojson',data:empty});
    }
    // Fill layer
    if(!map.getLayer(fillId)){
      map.addLayer({
        id:fillId, type:'fill', source:srcId,
        layout:{visibility:'none'},
        paint:{'fill-color':sty.fillColor,'fill-opacity':sty.fillOpacity}
      });
    }
    // White outline underneath (wider, semi-transparent)
    if(!map.getLayer(outlineId)){
      map.addLayer({
        id:outlineId, type:'line', source:srcId,
        layout:{'line-join':'round','line-cap':'round',visibility:'none'},
        paint:{'line-color':'#ffffff','line-width':sty.width+2,'line-opacity':0.4}
      });
    }
    // Colored outline layer on top
    if(!map.getLayer(lineId)){
      map.addLayer({
        id:lineId, type:'line', source:srcId,
        layout:{'line-join':'round','line-cap':'round',visibility:'none'},
        paint:{'line-color':sty.color,'line-width':sty.width,'line-opacity':0.9}
      });
    }
    // Click → show land name pill
    map.on('click',fillId,e=>{
      const p=(e.features&&e.features[0].properties)||{};
      const name=p.FORESTNAME||p.ADMIN_UNIT_NAME||p.UNITNAME||p.UNITNAME||p.NAME||p.name||sty.label;
      const label=type==='blm'?'BLM Land':type==='nationalForest'?name:type==='stateParks'?name:sty.label;
      showLandLabel(sty.label,label);
    });
  });
  // Populate from cached data if already fetched
  if(_blmGeoJSON){const s=map.getSource('land-blm');if(s)s.setData(_blmGeoJSON);}
  if(_nfGeoJSON) {const s=map.getSource('land-nationalForest');if(s)s.setData(_nfGeoJSON);}
  if(_spGeoJSON) {const s=map.getSource('land-stateParks');if(s)s.setData(_spGeoJSON);}
}

async function showLandType(type){
  if(!map)return;
  const sty=LAND_STYLES[type];
  // Use cached data if available, otherwise use LAND_FALLBACK
  let data=null;
  if(type==='blm')data=_blmGeoJSON;
  else if(type==='nationalForest')data=_nfGeoJSON;
  else if(type==='stateParks')data=_spGeoJSON;
  // Fall back to bundled geometry
  if(!data&&LAND_FALLBACK&&LAND_FALLBACK[type])data=LAND_FALLBACK[type];
  if(!data||!data.features){
    // Last resort: start a live fetch
    const url=LAND_FETCH_URLS[type];
    if(!url)return;
    try{
      const ctrl=new AbortController();
      setTimeout(()=>ctrl.abort(),10000);
      const res=await fetch(url,{signal:ctrl.signal});
      if(res.ok){
        data=await res.json();
        if(type==='blm')_blmGeoJSON=data;
        else if(type==='nationalForest')_nfGeoJSON=data;
        else if(type==='stateParks')_spGeoJSON=data;
        console.log(`[WildPath] ${type}: ${data.features.length} features loaded on demand`);
      }
    }catch(e){console.warn(`[WildPath] ${type} on-demand fetch failed`);}
  }
  if(!data||!data.features){
    _showRetryToast((LAND_STYLES[type]?.label||type)+' layer failed to load',`showLandType('${type}')`);
    return;
  }
  const src=map.getSource(`land-${type}`);
  if(src)src.setData(data);
  const fillId=`land-${type}-fill`, lineId=`land-${type}-line`, outlineId=`land-${type}-outline`;
  if(map.getLayer(fillId))map.setLayoutProperty(fillId,'visibility','visible');
  if(map.getLayer(outlineId))map.setLayoutProperty(outlineId,'visibility','visible');
  if(map.getLayer(lineId))map.setLayoutProperty(lineId,'visibility','visible');
  landLayerCache[type]={on:true};
}

function hideLandType(type){
  if(!map)return;
  const fillId=`land-${type}-fill`, lineId=`land-${type}-line`, outlineId=`land-${type}-outline`;
  if(map.getLayer(fillId))map.setLayoutProperty(fillId,'visibility','none');
  if(map.getLayer(outlineId))map.setLayoutProperty(outlineId,'visibility','none');
  if(map.getLayer(lineId))map.setLayoutProperty(lineId,'visibility','none');
  landLayerCache[type]={on:false};
}

async function toggleLandOwnership(el){
  const row=el.closest('.layer-row');
  const isOn=el.classList.contains('on');
  if(isOn){
    ['nationalForest','blm','stateParks','private'].forEach(t=>hideLandType(t));
    el.classList.remove('on'); if(row)row.classList.remove('layer-active');
  }else{
    el.classList.add('on'); if(row)row.classList.add('layer-active');
    showToast('Loading boundary data...');
    await Promise.all(['nationalForest','blm','stateParks'].map(t=>showLandType(t)));
    showToast('Land boundaries loaded');
  }
}

// ── Land label pill ───────────────────────────────
function showLandLabel(icon,text){
  const pill=document.getElementById('landLabelPill');
  const iconEl=document.getElementById('landLabelIcon');
  const textEl=document.getElementById('landLabelText');
  if(iconEl)iconEl.textContent=icon;
  if(textEl)textEl.textContent=text||icon;
  if(pill)pill.classList.add('show');
  if(landLabelTimer)clearTimeout(landLabelTimer);
  landLabelTimer=setTimeout(()=>pill&&pill.classList.remove('show'),3000);
}

// ═══════════════════════════════════════════════════
// FEATURE TOGGLE LAYERS
// ═══════════════════════════════════════════════════
async function toggleFeatureLayer(id,el){
  const cfg=FEATURE_LAYERS.find(f=>f.id===id);
  if(!cfg)return;
  const state=featureLayerCache[id];
  const row=el?el.closest('.layer-row'):null;
  const srcBadge=row?row.querySelector('.layer-source'):null;
  const toggleEl=el||document.getElementById('toggle-'+id);

  if(state.on){
    if(state.layer&&typeof state.layer.remove==='function')state.layer.remove();
    state.layer=null; state.on=false;
    if(toggleEl)toggleEl.classList.remove('on');
    if(row)row.classList.remove('layer-active');
    return;
  }

  if(cfg.type==='land'){toggleLandOwnership(toggleEl);return;}

  state.on=true;
  if(toggleEl)toggleEl.classList.add('on');
  if(row)row.classList.add('layer-active');

  if(cfg.type==='tile'){
    if(!map){state.on=false;return;}
    const srcId='tile-'+id, layId='tile-'+id+'-raster';
    try{
      if(!map.getSource(srcId))map.addSource(srcId,{type:'raster',tiles:[cfg.tileUrl],tileSize:256,attribution:cfg.tileAttr||'',maxzoom:19});
      if(!map.getLayer(layId))map.addLayer({id:layId,type:'raster',source:srcId,paint:{'raster-opacity':cfg.opacity||0.8}});
      state.layer={remove(){try{map.removeLayer(layId);}catch{}try{map.removeSource(srcId);}catch{}}};
      if(srcBadge){srcBadge.textContent='Live';srcBadge.style.background='rgba(196,149,106,.2)';srcBadge.style.color='var(--accent)';}
    }catch(err){
      state.on=false;
      if(toggleEl)toggleEl.classList.remove('on');
      if(row)row.classList.remove('layer-active');
    }
    return;
  }

  if(cfg.type==='overpass'){
    // Guard: at zoom < 9 the bounding box is too large and will time-out
    if(!map||map.getZoom()<9){
      showToast(`Zoom in to load ${cfg.label}`);
      state.on=false;
      if(toggleEl)toggleEl.classList.remove('on');
      if(row)row.classList.remove('layer-active');
      return;
    }
    if(srcBadge){srcBadge.textContent='Loading';srcBadge.style.background='rgba(255,255,255,.08)';srcBadge.style.color='var(--txt2)';}
    try{
      const data=await fetchOverpass(cfg.query);
      state.layer=osmWaysToLayerGroup(
        data,
        {color:cfg.lineColor,weight:cfg.lineWeight||2,opacity:cfg.lineOpacity||.78},
        cfg.icon,
        cfg.opts||{}
      );
      if(srcBadge){srcBadge.textContent='OSM';srcBadge.style.background='rgba(196,149,106,.2)';srcBadge.style.color='var(--accent)';}
    }catch{
      showToast(`${cfg.label} unavailable`);
      state.on=false;
      if(toggleEl)toggleEl.classList.remove('on');
      if(row)row.classList.remove('layer-active');
      if(srcBadge){srcBadge.textContent='Error';srcBadge.style.background='rgba(224,82,82,.2)';srcBadge.style.color='var(--red)';}
    }
  }
}

async function fetchOverpass(queryTpl){
  const b=map?map.getBounds():{getSouth:()=>35.5,getWest:()=>-125,getNorth:()=>42.5,getEast:()=>-114};
  const bbox=`${Math.max(b.getSouth(),35.5).toFixed(4)},${Math.max(b.getWest(),-125).toFixed(4)},${Math.min(b.getNorth(),42.5).toFixed(4)},${Math.min(b.getEast(),-114).toFixed(4)}`;
  const q=queryTpl.replace(/\{\{bbox\}\}/g,bbox);
  const res=await fetch('https://overpass-api.de/api/interpreter',{
    method:'POST',
    body:'data='+encodeURIComponent(q),
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    signal:AbortSignal.timeout(18000)
  });
  if(!res.ok)throw new Error('Overpass HTTP '+res.status);
  return res.json();
}

function osmWaysToLayerGroup(osmJson,style,layerIcon,opts={}){
  if(!map)return{remove(){},addTo(){return this;}};
  const{showLabels=false,variableWidth=false,waterBodies=false,dashArray=null,glow=false}=opts;
  const gid='osm-'+Date.now()+'-'+Math.random().toString(36).substr(2,5);
  const sourceIds=[],layerIds=[];

  const lineFeatures=[],waterFeatures=[];
  (osmJson.elements||[]).forEach(el=>{
    if(waterBodies&&el.type==='way'&&el.geometry?.length>2){
      const nat=el.tags?.natural,water=el.tags?.water,luse=el.tags?.landuse;
      if(nat==='water'||water||luse==='reservoir'){
        const coords=el.geometry.map(p=>[p.lon,p.lat]);
        if(coords[0][0]!==coords[coords.length-1][0]||coords[0][1]!==coords[coords.length-1][1])coords.push(coords[0]);
        waterFeatures.push({type:'Feature',geometry:{type:'Polygon',coordinates:[coords]},properties:{name:el.tags?.name||null}});
        return;
      }
    }
    if(el.type==='way'&&el.geometry?.length>1){
      const name=el.tags?.name||el.tags?.['name:en']||el.tags?.ref||null;
      let weight=style.weight||2;
      if(variableWidth&&el.tags?.waterway){weight=el.tags.waterway==='river'?5:el.tags.waterway==='canal'?3.5:1.8;}
      lineFeatures.push({type:'Feature',geometry:{type:'LineString',coordinates:el.geometry.map(p=>[p.lon,p.lat])},properties:{name,weight}});
    }
  });

  // Water body fill layers
  if(waterFeatures.length){
    const wSrc=gid+'-wsrc';
    map.addSource(wSrc,{type:'geojson',data:{type:'FeatureCollection',features:waterFeatures}});
    map.addLayer({id:gid+'-wfill',type:'fill',source:wSrc,paint:{'fill-color':'#1a5a7a','fill-opacity':0.55}});
    map.addLayer({id:gid+'-wline',type:'line',source:wSrc,paint:{'line-color':'#2fa8cc','line-width':1.2,'line-opacity':0.7}});
    sourceIds.push(wSrc); layerIds.push(gid+'-wfill',gid+'-wline');
  }

  // Line features: glow + main
  if(lineFeatures.length){
    const lSrc=gid+'-lsrc';
    map.addSource(lSrc,{type:'geojson',data:{type:'FeatureCollection',features:lineFeatures}});
    // Glow layer — only for trails that request it (hiking, biking)
    if(glow){
      map.addLayer({id:gid+'-glow',type:'line',source:lSrc,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':style.color,'line-width':['*',['get','weight'],4.5],'line-opacity':0.18,'line-blur':4}});
      layerIds.push(gid+'-glow');
    }
    // Main line — with optional dash array
    const mainLinePaint={'line-color':style.color,'line-width':['get','weight'],'line-opacity':style.opacity||0.85};
    if(dashArray)mainLinePaint['line-dasharray']=dashArray;
    const mainLineLayout=dashArray?{'line-cap':'butt','line-join':'round'}:{'line-cap':'round','line-join':'round'};
    map.addLayer({id:gid+'-line',type:'line',source:lSrc,layout:mainLineLayout,paint:mainLinePaint});
    map.on('click',gid+'-line',e=>{
      const name=e.features[0].properties.name;
      if(name)showLandLabel(layerIcon||'Map',name);
    });
    sourceIds.push(lSrc); layerIds.push(gid+'-line');

    // Trail labels (midpoint symbols)
    if(showLabels){
      const labelFeats=lineFeatures.filter(f=>f.properties.name&&f.geometry.coordinates.length>4).map(f=>{
        const c=f.geometry.coordinates,mid=c[Math.floor(c.length/2)];
        return{type:'Feature',geometry:{type:'Point',coordinates:mid},properties:{name:f.properties.name}};
      });
      if(labelFeats.length){
        const lbSrc=gid+'-lbsrc';
        map.addSource(lbSrc,{type:'geojson',data:{type:'FeatureCollection',features:labelFeats}});
        map.addLayer({id:gid+'-labels',type:'symbol',source:lbSrc,layout:{'text-field':['get','name'],'text-size':10,'text-font':['Open Sans Regular','Arial Unicode MS Regular'],'text-allow-overlap':false},paint:{'text-color':style.color,'text-halo-color':'rgba(0,0,0,.7)','text-halo-width':1.5}});
        sourceIds.push(lbSrc); layerIds.push(gid+'-labels');
      }
    }
  }

  return{
    remove(){
      layerIds.forEach(lid=>{try{map.removeLayer(lid);}catch{}});
      sourceIds.forEach(sid=>{try{map.removeSource(sid);}catch{}});
    },
    addTo(){return this;} // no-op — layers already added to map
  };
}

// Reverse-lookup feature name at a lat/lng point via Overpass (for tile layers)
async function lookupFeatureAtPoint(lat,lng){
  try{
    const q=`[out:json][timeout:6];(way["name"]["highway"~"path|track|footway|bridleway|cycleway"](around:120,${lat},${lng});way["name"]["waterway"](around:120,${lat},${lng});way["name"]["railway"](around:120,${lat},${lng});relation["name"]["route"~"hiking|bicycle|foot"](around:200,${lat},${lng}););out tags;`;
    const res=await fetch('https://overpass-api.de/api/interpreter',{
      method:'POST',body:'data='+encodeURIComponent(q),
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      signal:AbortSignal.timeout(6000)
    });
    if(!res.ok)return;
    const data=await res.json();
    const features=(data.elements||[]).filter(f=>f.tags?.name);
    if(features.length>0){
      const best=features[0];
      const icon=osmTagsToIcon(best.tags);
      showLandLabel(icon, best.tags.name);
    }
  }catch{/* silent — no feature at this point */}
}

function osmTagsToIcon(tags){
  if(!tags)return'Map';
  const hw=tags.highway||''; const ww=tags.waterway||''; const rw=tags.railway||'';
  const rt=tags.route||'';
  if(ww)return'River';
  if(rw||rt==='train')return'Rail';
  if(rt==='bicycle'||hw==='cycleway')return'Bike';
  if(rt==='hiking'||hw==='path'||hw==='footway')return'Trail';
  if(hw==='track')return'Track';
  if(tags.tunnel)return'Tunnel';
  return'Map';
}

// ── Build layers panel ────────────────────────────
function buildLayersPanel(){
  const list=document.getElementById('layersList');

  // Land ownership color legend
  const legend=document.createElement('div');
  legend.className='land-legend';
  legend.innerHTML=`
    <div class="land-legend-item"><div class="land-dot" style="background:#4A7C59"></div>National Forest</div>
    <div class="land-legend-item"><div class="land-dot" style="background:#D4A843"></div>BLM</div>
    <div class="land-legend-item"><div class="land-dot" style="background:#4A9EF5"></div>State Parks</div>
    <div class="land-legend-item"><div class="land-dot" style="background:#e05252"></div>Private</div>`;
  list.appendChild(legend);

  // Layer toggles — only the 5 correct layers (no hiking, biking, rivers)
  const PANEL_LAYERS=[
    {id:'blm',label:'BLM Land',desc:'Bureau of Land Management — yellow boundary'},
    {id:'natforest',label:'National Forest',desc:'USFS managed lands — green boundary'},
    {id:'stateparks',label:'State Parks',desc:'California State Parks — blue boundary'},
    {id:'counties',label:'County Lines',desc:'California county boundaries'},
    {id:'privateland',label:'Private Land',desc:'Private vs. public land boundary'},
  ];
  PANEL_LAYERS.forEach(cfg=>{
    const row=document.createElement('div');
    row.className='layer-row';
    row.innerHTML=`
      <div class="layer-left">
        <div class="layer-info">
          <div class="layer-name">${cfg.label}</div>
          <div class="layer-desc">${cfg.desc}</div>
        </div>
      </div>
      <div class="toggle" id="toggle-${cfg.id}" onclick="toggleSidePanelLayer('${cfg.id}',this)"></div>`;
    list.appendChild(row);
  });

  // Peaks note
  const note=document.createElement('div');
  note.style.cssText='padding:10px 12px;background:var(--bg2);border-radius:11px;border:1px solid var(--border);margin-top:6px';
  note.innerHTML=`<div style="font-size:11px;color:var(--txt2);font-weight:600">△ <strong style="color:var(--txt1)">Peaks & Summits</strong> are always visible on the map</div>`;
  list.appendChild(note);
}

// Overpass fetch with 429 retry: up to 2 retries, 2s backoff each
// (shared by on-demand trails toggle and spot-detail trail fetches)
async function _overpassFetchRetry(query,timeoutMs){
  for(let attempt=0;attempt<3;attempt++){
    if(attempt>0)await new Promise(r=>setTimeout(r,2000));
    try{
      const res=await fetch('https://overpass-api.de/api/interpreter',{
        method:'POST',body:'data='+encodeURIComponent(query),
        headers:{'Content-Type':'application/x-www-form-urlencoded'},
        signal:AbortSignal.timeout(timeoutMs)
      });
      if(res.status===429){continue;}
      if(!res.ok)throw new Error('HTTP '+res.status);
      return await res.json();
    }catch(e){
      if(attempt===2)throw e;
    }
  }
}

// ── Rivers always visible (cannot be toggled off) ──────────────
let _riversLoaded=false;
let _riversBounds=null;

async function loadRiversAlways(){
  if(!map)return;
  const bounds=map.getBounds();
  // Skip if same viewport
  const key=`${bounds.getSouth().toFixed(2)},${bounds.getWest().toFixed(2)},${bounds.getNorth().toFixed(2)},${bounds.getEast().toFixed(2)}`;
  if(_riversBounds===key)return;
  _riversBounds=key;

  // Remove old river layers
  ['wp-rivers-major','wp-rivers-medium','wp-rivers-small','wp-rivers-lakes-fill','wp-rivers-lakes-line'].forEach(id=>{
    try{if(map.getLayer(id))map.removeLayer(id);}catch{}
  });
  ['wp-rivers-src','wp-rivers-lakes-src'].forEach(id=>{
    try{if(map.getSource(id))map.removeSource(id);}catch{}
  });

  try{
    const bbox=`${Math.max(bounds.getSouth(),34).toFixed(3)},${Math.max(bounds.getWest(),-125).toFixed(3)},${Math.min(bounds.getNorth(),42.5).toFixed(3)},${Math.min(bounds.getEast(),-114).toFixed(3)}`;
    const q=`[out:json][timeout:18][maxsize:2000000];(way["waterway"~"river|canal"](${bbox});way["waterway"="stream"](${bbox}););out geom tags;`;
    const res=await fetch('https://overpass-api.de/api/interpreter',{
      method:'POST',body:'data='+encodeURIComponent(q),
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      signal:AbortSignal.timeout(18000)
    });
    if(!res.ok)return;
    const data=await res.json();
    const features=[];
    (data.elements||[]).forEach(el=>{
      if(el.type==='way'&&el.geometry?.length>1){
        const ww=el.tags?.waterway||'stream';
        const width=ww==='river'?4:ww==='canal'?3:2;
        features.push({type:'Feature',
          geometry:{type:'LineString',coordinates:el.geometry.map(p=>[p.lon,p.lat])},
          properties:{width,name:el.tags?.name||null,waterway:ww}
        });
      }
    });
    if(!features.length)return;
    if(!map)return;
    map.addSource('wp-rivers-src',{type:'geojson',data:{type:'FeatureCollection',features}});
    map.addLayer({id:'wp-rivers-major',type:'line',source:'wp-rivers-src',filter:['==',['get','waterway'],'river'],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#5BA8C4','line-width':4,'line-opacity':.85}});
    map.addLayer({id:'wp-rivers-medium',type:'line',source:'wp-rivers-src',filter:['==',['get','waterway'],'canal'],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#5BA8C4','line-width':3,'line-opacity':.8}});
    map.addLayer({id:'wp-rivers-small',type:'line',source:'wp-rivers-src',filter:['==',['get','waterway'],'stream'],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#5BA8C4','line-width':2,'line-opacity':.75}});
    console.log('[WildPath] Rivers loaded:', features.length, 'waterways');
  }catch(e){
    console.warn('[WildPath] Rivers load failed:', e);
  }
}

// ── County Boundaries ──────────────────────────────────────────
let _countyData=null;
let _countiesLoaded=false;

async function toggleCountyLayer(toggleEl){
  const isOn=toggleEl.classList.contains('on');
  if(isOn){
    // Turn off
    toggleEl.classList.remove('on');
    ['wp-counties-line','wp-counties-labels'].forEach(id=>{try{if(map.getLayer(id))map.setLayoutProperty(id,'visibility','none');}catch{}});
    return;
  }
  toggleEl.classList.add('on');
  if(_countiesLoaded){
    ['wp-counties-line','wp-counties-labels'].forEach(id=>{try{if(map.getLayer(id))map.setLayoutProperty(id,'visibility','visible');}catch{}});
    return;
  }
  showToast('Loading county boundaries…');
  try{
    if(!_countyData){
      const res=await fetch('https://corsproxy.io/?https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/california-counties.geojson',{signal:AbortSignal.timeout(12000)});
      if(!res.ok)throw new Error('HTTP '+res.status);
      _countyData=await res.json();
    }
    if(!map.getSource('wp-counties-src')){
      map.addSource('wp-counties-src',{type:'geojson',data:_countyData});
    }
    if(!map.getLayer('wp-counties-line')){
      map.addLayer({id:'wp-counties-line',type:'line',source:'wp-counties-src',paint:{'line-color':'rgba(255,255,255,0.6)','line-width':1.5,'line-opacity':0.7}});
    }
    // County name labels
    const labelFeats=(_countyData.features||[]).map(f=>{
      try{
        const coords=f.geometry.type==='Polygon'?f.geometry.coordinates[0]:f.geometry.coordinates[0][0];
        let sumX=0,sumY=0;
        coords.forEach(c=>{sumX+=c[0];sumY+=c[1];});
        const cx=sumX/coords.length, cy=sumY/coords.length;
        const name=f.properties.name||f.properties.NAME||'';
        return{type:'Feature',geometry:{type:'Point',coordinates:[cx,cy]},properties:{name}};
      }catch{return null;}
    }).filter(Boolean);
    if(!map.getSource('wp-county-labels-src')){
      map.addSource('wp-county-labels-src',{type:'geojson',data:{type:'FeatureCollection',features:labelFeats}});
    }
    if(!map.getLayer('wp-counties-labels')){
      map.addLayer({id:'wp-counties-labels',type:'symbol',source:'wp-county-labels-src',layout:{'text-field':['get','name'],'text-size':11,'text-font':['Open Sans Regular','Arial Unicode MS Regular'],'text-allow-overlap':false,'text-ignore-placement':false},paint:{'text-color':'rgba(255,255,255,0.8)','text-halo-color':'rgba(0,0,0,0.6)','text-halo-width':1.5}});
    }
    _countiesLoaded=true;
    console.log('[WildPath] County boundaries loaded');
  }catch(e){
    toggleEl.classList.remove('on');
    console.error('[WildPath] County boundaries failed:', e);
    showToast('County boundaries unavailable');
  }
}

// ── Private Land Boundaries ───────────────────────────────────
let _privateLandData=null;
let _privateLandLoaded=false;

async function togglePrivateLandLayer(toggleEl){
  const isOn=toggleEl.classList.contains('on');
  if(isOn){
    toggleEl.classList.remove('on');
    ['wp-privateland-fill','wp-privateland-line'].forEach(id=>{try{if(map.getLayer(id))map.setLayoutProperty(id,'visibility','none');}catch{}});
    return;
  }
  toggleEl.classList.add('on');
  if(_privateLandLoaded){
    ['wp-privateland-fill','wp-privateland-line'].forEach(id=>{try{if(map.getLayer(id))map.setLayoutProperty(id,'visibility','visible');}catch{}});
    return;
  }
  showToast('Loading land boundaries…');
  try{
    if(!_privateLandData){
      const url='https://corsproxy.io/?https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA/MapServer/0/query?where=1%3D1&outFields=ADMIN_AGENCY_CODE&geometry=-124,36,-119,42&geometryType=esriGeometryEnvelope&f=geojson';
      const res=await fetch(url,{signal:AbortSignal.timeout(20000)});
      if(!res.ok)throw new Error('HTTP '+res.status);
      _privateLandData=await res.json();
    }
    if(!map.getSource('wp-privateland-src')){
      map.addSource('wp-privateland-src',{type:'geojson',data:_privateLandData});
    }
    if(!map.getLayer('wp-privateland-fill')){
      map.addLayer({id:'wp-privateland-fill',type:'fill',source:'wp-privateland-src',paint:{'fill-color':'#E8453C','fill-opacity':0.08}});
    }
    if(!map.getLayer('wp-privateland-line')){
      map.addLayer({id:'wp-privateland-line',type:'line',source:'wp-privateland-src',paint:{'line-color':'#E8453C','line-width':2,'line-opacity':0.7}});
    }
    _privateLandLoaded=true;
    console.log('[WildPath] Private land boundaries loaded');
  }catch(e){
    toggleEl.classList.remove('on');
    console.error('[WildPath] Private land failed:', e);
    showToast('Private land data unavailable');
  }
}

function toggleLayersPanel(){
  // Opens the side panel to the Layers section
  const panel=document.getElementById('sidePanel');
  const overlay=document.getElementById('sidePanelOverlay');
  if(!panel)return;
  if(panel.classList.contains('open')){
    panel.classList.remove('open');
    if(overlay)overlay.classList.remove('open');
  } else {
    panel.classList.add('open');
    if(overlay)overlay.classList.add('open');
    // Scroll to layers section
    const layerSection=document.getElementById('sidePanelLayers');
    if(layerSection)setTimeout(()=>layerSection.scrollIntoView({behavior:'smooth',block:'start'}),200);
  }
}

function toggleLayers(){
  document.getElementById('layersPanel').classList.toggle('open');
  document.getElementById('layersOverlay').classList.toggle('open');
}

// ═══════════════════════════════════════════════════
// SPOT BOTTOM SHEET — defined fully below
// ═══════════════════════════════════════════════════

function closeSheet(){
  document.getElementById('spotSheet').classList.remove('open');
  document.getElementById('sheetBackdrop').classList.remove('open');
  sheetOpen=false; drawerOpen=false;
}

// Alias for legacy compatibility
function openDrawer(id){openSheet(id);}
function closeDrawer(){closeSheet();}

function startNavigation(lat,lng,name){
  const url=`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
  window.open(url,'_blank');
  showToast('Opening navigation…');
}

// ═══════════════════════════════════════════════════
// SPOT DETAIL — 3-tab design (full implementation below)
// ═══════════════════════════════════════════════════

// ═══════════════════════════════════════════════════
// SCREEN SWITCHER + LOCATE
// ═══════════════════════════════════════════════════
let _prevTab='';
let _tabAnimTimers=[];
const _tabOrder=['map','community','profile'];
function showTab(tabName) {
  if(tabName===currentScreen&&_prevTab!=='')return;

  // Cancel all pending animation timers from previous switches
  _tabAnimTimers.forEach(t=>clearTimeout(t));
  _tabAnimTimers=[];

  var screens = ['map-screen','community-screen','profile-screen','screen-plan'];
  var navs = ['nav-map','nav-community','nav-profile'];

  // Determine slide direction based on tab order
  const prevIdx=_tabOrder.indexOf(_prevTab);
  const nextIdx=_tabOrder.indexOf(tabName);
  const goRight=nextIdx>prevIdx;
  const animate=_prevTab!=='';

  // Animate out the current screen
  const outEl = document.getElementById(_prevTab+'-screen')||document.getElementById('screen-'+_prevTab);
  if(animate&&outEl&&outEl.style.display!=='none'){
    outEl.style.transition='transform 220ms ease';
    outEl.style.transform=goRight?'translateX(-100%)':'translateX(100%)';
    _tabAnimTimers.push(setTimeout(()=>{outEl.style.display='none';outEl.style.transform='';outEl.style.transition='';},220));
  }

  // Hide all others immediately (no animation)
  screens.forEach(function(id) {
    const el=document.getElementById(id);
    if(el&&el!==outEl){el.style.display='none';el.style.transform='';el.style.transition='';}
  });
  navs.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });

  // Animate in the new screen
  var screen = document.getElementById(tabName + '-screen') || document.getElementById('screen-' + tabName);
  if (screen) {
    if(animate){
      screen.style.transform=goRight?'translateX(100%)':'translateX(-100%)';
      screen.style.display='flex';
      screen.style.transition='';
      requestAnimationFrame(()=>{
        requestAnimationFrame(()=>{
          screen.style.transition='transform 220ms ease';
          screen.style.transform='translateX(0)';
          _tabAnimTimers.push(setTimeout(()=>{screen.style.transition='';},230));
        });
      });
    } else {
      screen.style.display='flex';
      screen.style.transform='';
    }
  }
  var nav = document.getElementById('nav-' + tabName);
  if (nav) nav.classList.add('active');
  _prevTab=tabName;
  currentScreen = tabName;

  if (tabName === 'map' && map) setTimeout(function(){ map.resize(); }, 50);
  if (tabName === 'community') buildCommunityScreen();
  if (tabName === 'profile') buildProfile();
  if (tabName === 'plan') _onShowPlanScreen();
  // Show messages FAB only when Community tab is active; reset to community view
  const msgFab = document.getElementById('commMsgFab');
  if (msgFab) msgFab.style.display = (tabName === 'community') ? 'flex' : 'none';
  if (tabName === 'community') {
    const cv = document.getElementById('commCommunityView');
    const mv = document.getElementById('commMessagesView');
    if (cv) cv.style.transform = 'translateX(0)';
    if (mv) mv.style.transform = 'translateX(100%)';
  }
}

function switchScreen(name, el) {
  showTab(name);
}

function locateMe(){
  if(!navigator.geolocation){showToast('Geolocation not supported');return;}
  showToast('Locating you…');
  navigator.geolocation.getCurrentPosition(
    pos=>{
      const{latitude:lat,longitude:lng}=pos.coords;
      leafletMap.flyTo([lat,lng],13,{animate:true,duration:1.2});
      _placeUserDot(lat,lng);
      showToast('Location found');
    },
    ()=>showToast('Location unavailable')
  );
}

// ═══════════════════════════════════════════════════
// PLAN SCREEN
// ═══════════════════════════════════════════════════
let _tripDays=2;
function buildPlanForm(){
  const container=document.getElementById('interestCheckboxes');
  if(!container)return;
  interests.forEach(interest=>{
    const item=document.createElement('div');
    item.className='checkbox-item'+(interest.includes('Hiking')||interest.includes('Swimming')?' checked':'');
    item.innerHTML=`<div class="checkbox-box">${item.className.includes('checked')?'+':''}</div><span>${interest}</span>`;
    item.onclick=()=>{item.classList.toggle('checked');item.querySelector('.checkbox-box').textContent=item.classList.contains('checked')?'+':'';};
    container.appendChild(item);
  });
  // Build duration pills 1–14 + Custom input
  const row=document.getElementById('tripDurationRow');
  if(row){
    const pills=Array.from({length:14},(_,i)=>i+1).map(d=>
      `<div onclick="setTripDays(${d},this)" class="duration-pill${d===_tripDays?' active':''}" style="flex-shrink:0">${d}D</div>`
    ).join('');
    const customActive=_tripDays>14;
    row.innerHTML=pills+`<div style="flex-shrink:0;display:flex;align-items:center;gap:0">
      <input id="tripDaysCustom" type="number" min="1" max="30" placeholder="Custom"
        value="${customActive?_tripDays:''}"
        style="width:68px;height:32px;border-radius:20px;border:1.5px solid ${customActive?'var(--accent)':'rgba(255,255,255,.12)'};
               background:${customActive?'rgba(184,232,122,.13)':'var(--bg2)'};color:${customActive?'var(--accent)':'var(--txt1)'};
               font-size:12px;font-weight:600;font-family:var(--font);text-align:center;padding:0 8px;outline:none;
               -moz-appearance:textfield;flex-shrink:0"
        oninput="setTripDaysCustom(this.value)"
        onfocus="this.select()"
      /><label for="tripDaysCustom" style="font-size:10px;color:var(--txt3);margin-left:5px;flex-shrink:0">days</label>
    </div>`;
  }
  renderItinerary(DEFAULT_ROUTE, _tripDays);
}
function setTripDays(d,el){
  _tripDays=d;
  document.querySelectorAll('#tripDurationRow .duration-pill').forEach(p=>p.classList.remove('active'));
  if(el)el.classList.add('active');
  // Clear custom input styling when a pill is selected
  const ci=document.getElementById('tripDaysCustom');
  if(ci){ci.value='';ci.style.borderColor='rgba(255,255,255,.12)';ci.style.background='var(--bg2)';ci.style.color='var(--txt1)';}
  // Sync home-plan custom input
  const hpCustom=document.getElementById('hpCustomDays');
  if(hpCustom&&d>14)hpCustom.value=d;
  // Re-render if a plan is already showing
  if(_planState){renderItinerary(_planState.route,_tripDays);}
}
function setTripDaysCustom(val){
  const n=parseInt(val);
  if(!n||n<1||n>30)return;
  _tripDays=n;
  // Deactivate all pills
  document.querySelectorAll('#tripDurationRow .duration-pill').forEach(p=>p.classList.remove('active'));
  // Style custom input as active
  const ci=document.getElementById('tripDaysCustom');
  if(ci){ci.style.borderColor='var(--accent)';ci.style.background='rgba(184,232,122,.13)';ci.style.color='var(--accent)';}
  if(_planState){renderItinerary(_planState.route,_tripDays);}
}


// ── Nominatim geocoding ───────────────────────────
async function geocodeLocation(query){
  if(!query.trim())return null;
  // Check if already lat,lng coords
  const coordMatch=query.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
  if(coordMatch)return{lat:parseFloat(coordMatch[1]),lng:parseFloat(coordMatch[2]),name:query};
  try{
    const url=`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=us&viewbox=-124.6,42.5,-114.0,32.5`;
    const res=await fetch(url,{
      headers:{'Accept-Language':'en-US,en','User-Agent':'WildPath/1.0 (prototype)'},
      signal:AbortSignal.timeout(8000)
    });
    if(!res.ok)throw new Error();
    const data=await res.json();
    if(!data.length)return null;
    return{lat:parseFloat(data[0].lat),lng:parseFloat(data[0].lon),
      name:data[0].display_name.split(',')[0]||query};
  }catch{return null;}
}

// ── Geographic route matching ─────────────────────
function distToSegment(px,py,ax,ay,bx,by){
  const dx=bx-ax,dy=by-ay,lenSq=dx*dx+dy*dy;
  if(lenSq===0)return Math.sqrt((px-ax)**2+(py-ay)**2);
  const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/lenSq));
  return Math.sqrt((px-(ax+t*dx))**2+(py-(ay+t*dy))**2);
}
function projOnRoute(lat,lng,s,e){
  const dx=e.lng-s.lng,dy=e.lat-s.lat,lenSq=dx*dx+dy*dy;
  if(lenSq===0)return 0;
  return((lng-s.lng)*dx+(lat-s.lat)*dy)/lenSq;
}
function findSpotsAlongRoute(startGeo,endGeo){
  const routeLen=Math.sqrt((endGeo.lat-startGeo.lat)**2+(endGeo.lng-startGeo.lng)**2);
  const threshold=Math.max(routeLen*0.85,1.2);
  return spots.filter(sp=>{
    const d=distToSegment(sp.lat,sp.lng,startGeo.lat,startGeo.lng,endGeo.lat,endGeo.lng);
    const proj=projOnRoute(sp.lat,sp.lng,startGeo,endGeo);
    return d<threshold&&proj>=-0.25&&proj<=1.25;
  }).sort((a,b)=>projOnRoute(a.lat,a.lng,startGeo,endGeo)-projOnRoute(b.lat,b.lng,startGeo,endGeo));
}

// ── Dynamic itinerary from geocoded endpoints ─────
function renderDynamicItinerary(startGeo,endGeo,routeSpots,numDays,startText,endText){
  const distDeg=Math.sqrt((endGeo.lat-startGeo.lat)**2+(endGeo.lng-startGeo.lng)**2);
  const distMi=Math.round(distDeg*69);
  const driveHrs=Math.round(distMi/52*10)/10;
  const times=['8:00 AM','10:30 AM','1:00 PM','3:30 PM','5:30 PM'];

  const days=[];
  const perDay=Math.max(2,Math.ceil((routeSpots.length||1)/numDays));
  for(let d=0;d<numDays;d++){
    const ds=routeSpots.slice(d*perDay,(d+1)*perDay);
    const theme=d===0?`Leaving ${startGeo.name}`:d===numDays-1?`Arriving ${endGeo.name}`:'Along the Route';
    const dayDrives=ds.slice(0,-1).map((_,i)=>{
      const s1=ds[i],s2=ds[i+1];
      const dist=Math.sqrt((s2.lat-s1.lat)**2+(s2.lng-s1.lng)**2)*69;
      return `${Math.round(dist/48*60)} min drive`;
    });
    days.push({
      label:`Day ${d+1}`,theme,cost:`~$${12+ds.length*9} total`,totalDrive:'',
      spots:ds.length>0?ds.map((sp,i)=>({
        name:sp.name,time:times[Math.min(i,4)],duration:'2–3 hrs',
        icon:sp.icon,note:`${sp.typeLabel} · ${sp.rating} · ${sp.elevation}`,
        cost:sp.entryFee!=='Free'?sp.entryFee:null
      })):[{name:`Drive through ${theme}`,time:'10:00 AM',duration:'All day',icon:'',note:'Flexible exploration at your own pace'}],
      drives:dayDrives
    });
  }
  renderItinerary({
    name:`${startGeo.name} → ${endGeo.name}`,
    distance:`~${distMi} mi`,driveTime:`~${driveHrs} hrs`,
    highlight:routeSpots.length>0?routeSpots.map(s=>s.name).slice(0,3).join(' · '):'Custom NorCal adventure',
    days
  },numDays);
}


// ── Trip Plan State ───────────────────────────────
let _planState=null;
let _planDragSrc=null;

function renderItinerary(route,numDays){
  const daysToShow=Math.min(numDays||2,route.days.length);
  const daySlice=route.days.slice(0,daysToShow);

  // Build state with per-spot UIDs so cards stay stable
  _planState={
    route,
    days:daySlice.map((day,di)=>({
      ...day,
      spots:day.spots.map((sp,si)=>({
        ...sp,
        _uid:`${di}_${si}_${Math.random().toString(36).slice(2,7)}`,
        kept:true,
        _alt:null
      }))
    }))
  };
  _renderPlanState();
}

function _renderPlanState(){
  if(!_planState)return;
  const {route,days}=_planState;
  const totalCost=days.reduce((sum,d)=>{const m=d.cost.match(/\$(\d+)/);return sum+(m?parseInt(m[1]):0);},0);
  const keptTotal=days.reduce((s,d)=>s+d.spots.filter(sp=>sp.kept).length,0);

  const _itinOut=document.getElementById('itineraryOutput')||document.getElementById('hpItineraryOutput');
  if(!_itinOut)return;
  _itinOut.innerHTML=`
    <div class="route-summary-card fade-in">
      <div class="route-summary-title">${route.name}</div>
      <div class="route-stats-row">
        <div class="route-stat"><div class="route-stat-value">${route.distance}</div><div class="route-stat-label">Distance</div></div>
        <div class="route-stat"><div class="route-stat-value">${route.driveTime}</div><div class="route-stat-label">Drive</div></div>
        <div class="route-stat"><div class="route-stat-value">${days.length}d</div><div class="route-stat-label">Duration</div></div>
        <div class="route-stat"><div class="route-stat-value">~$${totalCost}</div><div class="route-stat-label">Est. Cost</div></div>
      </div>
      <div class="route-highlight">${route.highlight}</div>
    </div>
    ${days.map((day,di)=>`
      <div class="itinerary-day fade-in">
        <div class="day-header">
          <div class="day-pill">${day.label}</div>
          <div class="day-date">${day.theme}</div>
          <div class="day-cost">${day.cost}</div>
        </div>
        <div id="plan-day-${di}" class="plan-spots-list">
          ${day.spots.map((sp,si)=>_planSpotCardHTML(sp,di,si)).join('')}
        </div>
        <div onclick="_addSpotToDay(${di})"
          style="display:flex;align-items:center;gap:8px;padding:8px 14px;border:1.5px dashed rgba(255,255,255,.1);border-radius:12px;cursor:pointer;margin-bottom:4px;color:var(--txt3);font-size:12px;font-weight:500;-webkit-tap-highlight-color:transparent;transition:border-color .15s"
          onmouseenter="this.style.borderColor='rgba(184,232,122,.3)';this.style.color='var(--accent)'"
          onmouseleave="this.style.borderColor='rgba(255,255,255,.1)';this.style.color='var(--txt3)'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> Add spot to ${day.label}
        </div>
      </div>
    `).join('')}
    <button class="btn-confirm-itinerary" onclick="confirmItinerary()">
      Confirm Itinerary${keptTotal>0?` · ${keptTotal} spot${keptTotal!==1?'s':''}` :''}
    </button>
  `;

  // Wire up drag-and-drop for each day
  days.forEach((_,di)=>_initPlanDayDrag(di));
}

function _planSpotCardHTML(sp,di,si){
  const removedCls=sp.kept?'':'removed-card';
  const keepActiveCls=sp.kept?' active':'';
  return `
    <div class="plan-spot-card ${removedCls}" id="psc-${sp._uid}"
         draggable="true"
         data-uid="${sp._uid}" data-di="${di}" data-si="${si}"
         onclick="_planCardTap('${sp._uid}')">
      <div class="plan-drag-handle">⋮⋮</div>
      <div class="itin-num">${si+1}</div>
      <div class="itin-info">
        <div class="itin-name">${sp.name}</div>
        <div class="itin-meta">${sp.time} · ${sp.duration}${sp.cost?' · <span style="color:var(--yellow)">'+sp.cost+'</span>':''}</div>
        <div class="itin-note">${sp.note}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:6px;flex-shrink:0">
        <div class="itin-icon">${_getSpotIcon(sp.type,sp.typeColor)}</div>
        <div style="display:flex;gap:4px">
          <button class="plan-btn-keep${keepActiveCls}"
            onclick="event.stopPropagation();_planKeep('${sp._uid}')" title="Keep">+</button>
          <button class="plan-btn-remove"
            onclick="event.stopPropagation();_planRemove('${sp._uid}')" title="Remove">×</button>
        </div>
      </div>
    </div>
    ${!sp.kept&&sp._alt?_planAltHTML(sp._alt,sp._uid):''}
    ${!sp.kept&&!sp._alt?`<div style="font-size:11px;color:var(--txt3);padding:4px 14px 6px">Spot removed — finding alternative…</div>`:''}
  `;
}

function _planAltHTML(alt,removedUid){
  return `
    <div class="plan-alt-card" onclick="event.stopPropagation();_acceptAlt('${removedUid}')">
      <div style="font-size:20px;flex-shrink:0">${alt.name.slice(0,1)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:10px;font-weight:700;color:var(--accent);letter-spacing:.5px;margin-bottom:3px">ALTERNATIVE</div>
        <div style="font-size:13px;font-weight:700;color:var(--txt0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${alt.name}</div>
        <div style="font-size:11px;color:var(--txt2);margin-top:2px">${alt.typeLabel||''} · ${alt.rating||'4.5'}${alt.distance?' · '+alt.distance:''}</div>
      </div>
      <div style="font-size:12px;font-weight:700;color:var(--accent);flex-shrink:0">Use ›</div>
    </div>`;
}

// ── Plan card actions ─────────────────────────────
function _planFindSpot(uid){
  if(!_planState)return null;
  for(const day of _planState.days)
    for(const sp of day.spots)
      if(sp._uid===uid)return sp;
  return null;
}

function _planKeep(uid){
  const sp=_planFindSpot(uid);
  if(!sp)return;
  sp.kept=true;sp._alt=null;
  _renderPlanState();
}

function _planRemove(uid){
  const sp=_planFindSpot(uid);
  if(!sp)return;
  sp.kept=false;
  // Find an alternative spot not already in plan
  const usedNames=new Set(_planState.days.flatMap(d=>d.spots.map(s=>s.name.toLowerCase())));
  const alts=spots.filter(s=>!usedNames.has(s.name.toLowerCase()));
  if(alts.length){
    sp._alt=alts[Math.floor(Math.random()*Math.min(alts.length,10))];
  }
  _renderPlanState();
}

function _acceptAlt(removedUid){
  const sp=_planFindSpot(removedUid);
  if(!sp||!sp._alt)return;
  const alt=sp._alt;
  // Replace spot data with alt
  sp.name=alt.name;sp.icon='';
  sp.note=alt.description||(`${alt.typeLabel||''} · ${alt.rating||'4.5'} · ${alt.distance||''}`);
  sp.cost=alt.entryFee&&alt.entryFee!=='Free'&&alt.entryFee!=='Check ahead'?alt.entryFee:null;
  sp.kept=true;sp._alt=null;
  _renderPlanState();
  showToast(`Swapped to ${alt.name.slice(0,22)}`);
}

function _planCardTap(uid){
  const sp=_planFindSpot(uid);
  if(!sp)return;
  // Try to find matching spot in the spots array
  const allS=[...spots,...userSpots];
  const match=allS.find(s=>s.name===sp.name||s.name.toLowerCase().includes(sp.name.toLowerCase().slice(0,12)));
  if(match){
    openSheet(match.id);
    showToast(`Opening ${match.name.slice(0,24)}…`);
  } else {
    showToast(`${sp.name.slice(0,30)}`);
  }
}

function confirmItinerary(){
  if(!_planState)return;
  const kept=_planState.days.map(d=>({...d,spots:d.spots.filter(s=>s.kept)}))
    .filter(d=>d.spots.length>0);
  if(!kept.length){showToast('Keep at least one spot first');return;}
  const names=kept.flatMap(d=>d.spots.map(s=>s.name));
  const _confOut=document.getElementById('itineraryOutput')||document.getElementById('hpItineraryOutput');
  if(!_confOut)return;
  _confOut.innerHTML=`
    <div style="background:var(--bg1);border-radius:20px;border:1px solid rgba(196,149,106,.3);
      padding:28px 20px;text-align:center;animation:bounceIn .5s ease">
      <div style="font-size:44px;margin-bottom:12px;color:var(--accent)">+</div>
      <div style="font-size:17px;font-weight:700;color:var(--txt0);margin-bottom:6px">Itinerary Confirmed!</div>
      <div style="font-size:13px;color:var(--txt2);line-height:1.6;margin-bottom:18px">
        ${kept.length} day${kept.length!==1?'s':''} · ${names.length} stop${names.length!==1?'s':''}
      </div>
      <div style="text-align:left;background:var(--bg2);border-radius:12px;padding:14px">
        ${kept.map(d=>`
          <div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:6px;margin-top:${d===kept[0]?0:10}px">${d.label}</div>
          ${d.spots.map((sp,i)=>`
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span style="font-size:14px">${_getSpotIcon(sp.type,sp.typeColor)}</span>
              <span style="font-size:12px;color:var(--txt1);flex:1">${sp.name}</span>
              ${i<d.spots.length-1?'':''}
            </div>`).join('')}
        `).join('')}
      </div>
      <button onclick="_editItinerary()" style="margin-top:16px;background:none;border:1px solid var(--border2);
        color:var(--txt2);border-radius:10px;padding:10px 22px;font-size:13px;
        font-family:var(--font);cursor:pointer;font-weight:600">← Edit Plan</button>
    </div>`;
  // Add map export buttons after a short delay
  setTimeout(_addMapExportButtons, 150);
}

function _editItinerary(){_renderPlanState();}

// ── Drag-and-drop within a day ────────────────────
function _initPlanDayDrag(di){
  const list=document.getElementById(`plan-day-${di}`);
  if(!list)return;
  // Attach swipe-left to remove
  _attachPlanCardSwipe(di);
  const cards=list.querySelectorAll('.plan-spot-card');
  cards.forEach(card=>{
    card.addEventListener('dragstart',e=>{
      _planDragSrc=card;
      e.dataTransfer.effectAllowed='move';
      e.dataTransfer.setData('text/plain',card.dataset.uid);
      setTimeout(()=>card.classList.add('removed-card'),0);
    });
    card.addEventListener('dragend',()=>{
      card.classList.remove('removed-card');
      list.querySelectorAll('.plan-spot-card').forEach(c=>c.classList.remove('drag-over'));
      _planDragSrc=null;
      _syncDayOrder(di);
    });
    card.addEventListener('dragover',e=>{
      if(!_planDragSrc||_planDragSrc===card)return;
      e.preventDefault();
      const r=card.getBoundingClientRect();
      const after=e.clientY>r.top+r.height/2;
      list.querySelectorAll('.plan-spot-card').forEach(c=>c.classList.remove('drag-over'));
      card.classList.add('drag-over');
      if(after)card.after(_planDragSrc);else card.before(_planDragSrc);
    });
    card.addEventListener('drop',e=>{e.preventDefault();card.classList.remove('drag-over');});
  });
}

function _syncDayOrder(di){
  if(!_planState)return;
  const list=document.getElementById(`plan-day-${di}`);
  if(!list)return;
  const newOrder=[...list.querySelectorAll('.plan-spot-card')].map(c=>c.dataset.uid);
  const day=_planState.days[di];
  if(!day)return;
  day.spots.sort((a,b)=>{const ia=newOrder.indexOf(a._uid),ib=newOrder.indexOf(b._uid);return ia-ib;});
  // Renumber
  day.spots.forEach((sp,i)=>{const el=list.querySelector(`#psc-${sp._uid} .itin-num`);if(el)el.textContent=i+1;});
}

// ═══════════════════════════════════════════════════
// PROFILE
// ═══════════════════════════════════════════════════
function _buildProfileLoginForm(){
  const screen=document.getElementById('profile-screen');
  if(!screen)return;
  // Use a full-cover overlay so the real profile HTML stays intact underneath
  let ov=document.getElementById('profileLoginOverlay');
  if(!ov){
    ov=document.createElement('div');
    ov.id='profileLoginOverlay';
    ov.style.cssText='position:absolute;inset:0;z-index:50;background:var(--bg0);overflow-y:auto;padding-bottom:var(--nav-h)';
    screen.appendChild(ov);
  }
  ov.style.display='flex';
  ov.style.flexDirection='column';
  ov.style.alignItems='center';
  ov.innerHTML=`
    <div style="padding:60px 24px 40px;width:100%;display:flex;flex-direction:column;align-items:center">
      <div style="text-align:center;margin-bottom:40px;display:flex;flex-direction:column;align-items:center;gap:10px">
        <svg width="44" height="44" viewBox="0 0 48 48" fill="none"><path d="M4 40 L16 18 L24 28 L32 16 L44 40 Z" fill="#B8E87A" opacity=".9"/><path d="M2 40 Q8 36 14 38 Q20 40 26 37 Q32 34 38 36 Q42 38 46 40" stroke="#B8E87A" stroke-width="1.5" stroke-linecap="round" fill="none" opacity=".45"/></svg>
        <div style="font-size:26px;font-weight:700;color:var(--txt0);letter-spacing:-.02em">WildPath</div>
        <div style="font-size:14px;color:var(--txt2);line-height:1.5;padding:0 10px">Discover and share hidden exploration spots</div>
      </div>
      <div style="width:100%;max-width:340px">
        <div class="login-tabs">
          <div class="login-tab active" id="profileTabSignIn" onclick="profileShowSignIn()">Sign In</div>
          <div class="login-tab" id="profileTabSignUp" onclick="profileShowSignUp()">Create Account</div>
        </div>
        <div id="profileSignInPanel">
          <div class="login-error-new" id="profileLoginError"></div>
          <input class="login-input-new" id="profileLoginEmail" type="email" placeholder="Email address" autocomplete="email" onkeydown="if(event.key==='Enter')doProfileSignIn()">
          <input class="login-input-new" id="profileLoginPassword" type="password" placeholder="Password" autocomplete="current-password" onkeydown="if(event.key==='Enter')doProfileSignIn()">
          <button class="login-btn-new" type="button" onclick="doProfileSignIn()">Sign In</button>
        </div>
        <div id="profileSignUpPanel" style="display:none">
          <div class="login-error-new" id="profileSignupError"></div>
          <input class="login-input-new" id="profileSignupUsername" type="text" placeholder="Username" autocomplete="username" onkeydown="if(event.key==='Enter')doProfileSignUp()">
          <input class="login-input-new" id="profileSignupEmail" type="email" placeholder="Email address" autocomplete="email" onkeydown="if(event.key==='Enter')doProfileSignUp()">
          <input class="login-input-new" id="profileSignupPassword" type="password" placeholder="Password" autocomplete="new-password" onkeydown="if(event.key==='Enter')doProfileSignUp()">
          <input class="login-input-new" id="profileSignupConfirm" type="password" placeholder="Confirm password" autocomplete="new-password" onkeydown="if(event.key==='Enter')doProfileSignUp()">
          <button class="login-btn-new" type="button" onclick="doProfileSignUp()">Create Account</button>
        </div>
      </div>
    </div>`;
}

function buildProfile(){
  // Remove login overlay if user just signed in
  const ov=document.getElementById('profileLoginOverlay');
  if(ov)ov.style.display='none';
  // If guest — show inline login/signup form instead of profile content
  if(isGuest()){
    _buildProfileLoginForm();
    return;
  }
  // Update profile header with actual user info
  if(_currentUser&&_currentUser.username){
    const unEl=document.getElementById('profileUsername');
    if(unEl)unEl.textContent='@'+_currentUser.username;
    const avatarText=document.getElementById('profileAvatarText');
    if(avatarText)avatarText.textContent=_currentUser.username.slice(0,2).toUpperCase();
    // Full real name below username
    const fullNameEl=document.getElementById('profileFullName');
    if(fullNameEl)fullNameEl.textContent=_currentUser.fullName||_currentUser.username||'Explorer';
    // Load saved avatar photo if any
    const savedAvatar=(getUserProfile(String(_currentUser.id))||{}).avatarUrl;
    if(savedAvatar){
      const img=document.getElementById('profileAvatarImg');
      const txt=document.getElementById('profileAvatarText');
      if(img){img.src=savedAvatar;img.style.display='block';}
      if(txt)txt.style.display='none';
    }
  }
  // Update tile counts (combined saved spots + saved posts — see the second
  // write further down in this function, which used to silently overwrite this
  // one since both targeted the same #profileSavedCount element)
  const savedList=getSavedSpotIds();
  const pinnedList=JSON.parse(localStorage.getItem('wp_want_to_go')||'[]');
  const pinnedCountEl=document.getElementById('profilePinnedCount');
  if(pinnedCountEl)pinnedCountEl.textContent=pinnedList.length?pinnedList.length+' pinned':'Want to go';
  // Profile map thumbnail (static mini map)
  _initProfileMapThumbnail();

  // ─── Posts / Followers / Following stats ──────────────────────
  const _profMyUid=String(_myUid());
  const _profAllPosts=getPosts();
  const _profMyPosts=_profAllPosts.filter(p=>String(p.userId)===_profMyUid);
  const _profFollows=getFollows();
  const _profFollowingCount=(_profFollows[_profMyUid]||[]).length;
  const _profFollowerCount=Object.keys(_profFollows).filter(u=>((_profFollows[u]||[]).includes(_profMyUid))).length;
  const postsCountEl=document.getElementById('profilePostsCount');
  if(postsCountEl)postsCountEl.textContent=_profMyPosts.length;
  const followersCountEl=document.getElementById('profileFollowersCount');
  if(followersCountEl)followersCountEl.textContent=_profFollowerCount;
  const followingCountEl=document.getElementById('profileFollowingCount');
  if(followingCountEl)followingCountEl.textContent=_profFollowingCount;
  const memberSinceEl=document.getElementById('profileMemberSince');
  if(memberSinceEl&&_currentUser){
    const yr=_currentUser.createdAt?new Date(_currentUser.createdAt).getFullYear():2026;
    memberSinceEl.textContent='Member since '+yr;
  }
  // ─── Posts grid (with private overlay + lock) ────────────────
  const _profGrid=document.getElementById('profilePostsGrid');
  if(_profGrid){
    if(!_profMyPosts.length){
      _profGrid.innerHTML=`<div style="grid-column:1/-1;padding:48px 20px;text-align:center;color:var(--txt3);font-size:13px;line-height:1.7">No posts yet.<br><span style="font-size:12px">Share your first spot in the Community tab.</span></div>`;
    } else {
      _profGrid.innerHTML=_profMyPosts.map(p=>{
        const hasPhoto=p.mediaUrl&&p.type==='photo';
        const isPrivate=p.privacy==='private';
        return `<div onclick="openCommPost('${p.id}')" style="aspect-ratio:1;overflow:hidden;cursor:pointer;background:var(--bg3);position:relative">${
          hasPhoto
            ?`<img src="${p.mediaUrl}" style="width:100%;height:100%;object-fit:cover" loading="lazy">`
            :`<div style="width:100%;height:100%;background:var(--bg2);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:4px;padding:8px"><div style="font-size:10px;color:var(--txt3)">text</div><div style="font-size:9px;color:var(--txt3);text-align:center;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical">${p.caption||''}</div></div>`
        }${isPrivate?'<div style="position:absolute;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:flex-end;padding:6px"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="rgba(255,255,255,.8)" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>':''}</div>`;
      }).join('');
    }
  }
  // Tagged grid (posts tagged with this user)
  const _tagGrid=document.getElementById('profileTaggedGrid');
  if(_tagGrid){
    const taggedPosts=getPosts().filter(p=>p.taggedUsers&&p.taggedUsers.includes(String(_myUid())));
    if(!taggedPosts.length){
      _tagGrid.innerHTML=`<div style="grid-column:1/-1;padding:48px 20px;text-align:center;color:var(--txt3);font-size:13px">No tagged posts yet.</div>`;
    } else {
      _tagGrid.innerHTML=taggedPosts.map(p=>{
        const hasPhoto=p.mediaUrl&&p.type==='photo';
        return `<div onclick="openCommPost('${p.id}')" style="aspect-ratio:1;overflow:hidden;cursor:pointer;background:var(--bg3)">${hasPhoto?`<img src="${p.mediaUrl}" style="width:100%;height:100%;object-fit:cover" loading="lazy">`:`<div style="width:100%;height:100%;background:var(--bg2);display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--txt3)">text</div>`}</div>`;
      }).join('');
    }
  }
  // My Hikes section
  const hikes=JSON.parse(localStorage.getItem('wildpath-saved-hikes')||'[]');
  const hikesEl=document.getElementById('profileMyHikes');
  if(hikesEl){
    if(!hikes.length){
      hikesEl.style.display='none';
    } else {
      hikesEl.style.display='block';
      hikesEl.innerHTML=`<div style="padding:16px 14px 8px;font-size:14px;font-weight:700;color:var(--txt0)">My Hikes</div>`+
        hikes.slice(0,5).map(h=>`<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid var(--border);cursor:pointer">
          <div style="width:42px;height:42px;border-radius:10px;background:linear-gradient(135deg,#1a3a2a,#2d5a3a);display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#B8E87A" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600;color:var(--txt0)">${h.date||'Hike'}</div>
            <div style="font-size:11px;color:var(--txt3);margin-top:2px">${h.distStr||''} · ${h.timeStr||''}</div>
          </div>
          <div style="font-size:10px;color:var(--txt3);text-transform:uppercase">${h.privacy||'private'}</div>
        </div>`).join('');
    }
  }
  // Combined saved count — spots (saved_spots) + posts, single source of truth
  const savedPostIds=getSavedPostIds();
  const _savedTotalCountEl=document.getElementById('profileSavedCount');
  const _savedTotal=savedList.length+savedPostIds.length;
  if(_savedTotalCountEl)_savedTotalCountEl.textContent=_savedTotal+' saved'+(_savedTotal===1?'':'');

  // Start on Posts tab
  switchProfileTab('posts');

  const statsData=[{icon:'',value:'284',label:'Miles Hiked'},{icon:'',value:'42.8k',label:'Elev. Gained (ft)'},{icon:'',value:spots.length+userSpots.length,label:'Spots Visited'},{icon:'',value:'196',label:'Hours Outside'}];
  document.getElementById('statsGrid').innerHTML=statsData.map(s=>`<div class="stat-card"><div class="stat-icon">${s.icon}</div><div class="stat-value">${s.value}</div><div class="stat-label">${s.label}</div></div>`).join('');
  const months=['J','F','M','A','M','J','J','A','S','O','N','D'],maxV=Math.max(...monthActivity);
  document.getElementById('miniChart').innerHTML=months.map((m,i)=>`<div class="chart-col"><div class="chart-bar" style="height:${(monthActivity[i]/maxV)*100}%"></div><div class="chart-label">${m}</div></div>`).join('');
  const bg=document.getElementById('badgesGrid');if(bg)bg.innerHTML=badges.map(b=>`<div class="badge-item${b.earned?'':' locked'}"><div class="badge-emoji">${b.emoji?_getSpotIcon(b.emoji,'var(--accent)'):'<i class="ti ti-award" style="font-size:22px;color:var(--accent)"></i>'}</div><div class="badge-name">${b.name}</div></div>`).join('');
  document.getElementById('proFeaturesList').innerHTML=proFeatures.map(f=>`<div class="pro-feature"><span class="${f.free?'pro-check':'pro-lock'}">${f.free?'+':''}</span><span>${f.text}</span>${!f.free?'<span style="margin-left:auto;font-size:10px;background:rgba(74,144,217,.2);color:#64b5f6;padding:2px 7px;border-radius:5px;font-weight:800">PRO</span>':''}</div>`).join('');
  document.getElementById('savedSpots').innerHTML=savedSpotsList.map(s=>`<div class="saved-spot-row" onclick="showToast('Opening ${s.name.substring(0,18)}…')"><div class="saved-spot-icon">${s.icon?_getSpotIcon(s.icon):'<i class="ti ti-map-pin" style="font-size:18px;color:var(--txt3)"></i>'}</div><div><div class="saved-spot-name">${s.name}</div><div class="saved-spot-dist">${s.dist} away</div></div><div class="saved-spot-arrow">›</div></div>`).join('');
  // Settings — open full-screen settings on tap, plus sign out
  document.getElementById('settingsList').innerHTML=`
    <div class="settings-row" onclick="openSettingsFull()" style="border:1px solid rgba(184,232,122,.2);border-radius:12px;margin-bottom:8px;background:rgba(184,232,122,.05)">
      <div class="settings-left">
        <div class="settings-icon"></div>
        <div class="settings-name" style="font-weight:600;color:var(--txt0)">Settings</div>
      </div>
      <div class="settings-arrow" style="color:var(--accent)">›</div>
    </div>
    ${settingItems.map(s=>`<div class="settings-row" onclick="openSettingsPanel('${s.key}')"><div class="settings-left"><div class="settings-icon">${s.icon}</div><div class="settings-name">${s.name}</div></div><div class="settings-arrow">›</div></div>`).join('')}
    <div class="settings-row" onclick="signOut()" style="margin-top:8px;border-radius:12px;border:1px solid rgba(196,82,74,.25);background:rgba(196,82,74,.05)">
      <div class="settings-left">
        <div class="settings-icon" style="color:#e88080"><i class="ti ti-logout" style="font-size:18px;color:#e88080"></i></div>
        <div class="settings-name" style="color:#e88080">Sign Out</div>
      </div>
    </div>`;

  // Admin section — show only for admin role
  _buildAdminSection();

  buildYearReview();
  buildFavList();
  buildCollections();
  buildJournalList();
}

function _buildAdminSection(){
  // Remove existing admin section if any
  const existing=document.getElementById('adminProfileSection');
  if(existing)existing.remove();
  if(!isAdmin())return;

  const pending=getPendingSpots();
  const allSpots=[...spots,...userSpots];
  const section=document.createElement('div');
  section.id='adminProfileSection';
  section.className='profile-section';
  section.innerHTML=`
    <div class="admin-section">
      <div class="admin-section-title">Admin Panel</div>
      <div class="admin-stat">
        <span class="admin-stat-label">Total Official Spots</span>
        <span class="admin-stat-val">${spots.length}</span>
      </div>
      <div class="admin-stat">
        <span class="admin-stat-label">User Submissions</span>
        <span class="admin-stat-val">${userSpots.length}</span>
      </div>
      <div class="admin-stat">
        <span class="admin-stat-label">Pending Review</span>
        <span class="admin-stat-val">
          ${pending.length>0?`<span class="admin-stat-badge">${pending.length}</span>`:pending.length}
        </span>
      </div>
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        <button onclick="_showPendingSpots()" style="flex:1;padding:10px;background:rgba(212,135,74,.15);border:1px solid rgba(212,135,74,.4);border-radius:10px;color:#D4874A;font-size:13px;font-weight:700;cursor:pointer;font-family:var(--font)">
          Pending Spots ${pending.length>0?`(${pending.length})`:''}
        </button>
        <button onclick="_showPendingHikes()" style="flex:1;padding:10px;background:rgba(212,135,74,.15);border:1px solid rgba(212,135,74,.4);border-radius:10px;color:#D4874A;font-size:13px;font-weight:700;cursor:pointer;font-family:var(--font)">
          Pending Hikes
        </button>
        <button onclick="_showManageSpots()" style="flex:1;padding:10px;background:rgba(184,232,122,.1);border:1px solid rgba(184,232,122,.3);border-radius:10px;color:var(--accent);font-size:13px;font-weight:700;cursor:pointer;font-family:var(--font)">
          Manage Spots
        </button>
      </div>
      <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">
        <div style="font-size:12px;font-weight:700;color:var(--txt2);letter-spacing:.4px;text-transform:uppercase;margin-bottom:10px">Unified Pending Review</div>
        <div id="unifiedPendingReviewList" style="font-size:12px;color:var(--txt3)">Loading…</div>
      </div>
    </div>`;
  // adminPanelAnchor sits in the always-visible profile header (unlike the legacy
  // #profileAboutContent/.profile-section markup, which is display:none — kept only
  // for older JS compat and never actually shown in the current Profile layout).
  const anchor=document.getElementById('adminPanelAnchor');
  if(anchor)anchor.appendChild(section);
  _buildUnifiedPendingReview();
}

// Combines Global pending spots, Global pending hikes, and Community pending
// spots/hikes across every community this account created, into one list sorted
// most-recent-first — so the app admin doesn't have to check the global queue
// and every individual community separately.
async function _buildUnifiedPendingReview(){
  const container=document.getElementById('unifiedPendingReviewList');
  if(!container)return;
  const items=[];
  getPendingSpots().forEach(s=>{
    items.push({
      tierLabel:'Global',name:s.name,
      meta:sanitize(s.typeLabel||s.type||'')+' · Submitted by '+sanitize(s._submittedBy||'Unknown'),
      submittedAt:s._submittedAt||0,
      approve:`approveSpot('${s._pendingId}')`,reject:`rejectSpot('${s._pendingId}')`
    });
  });
  try{
    const {data,error}=await db.from('hikes').select('*').eq('visibility','global').eq('status','pending').order('created_at');
    if(!error)(data||[]).forEach(h=>{
      const submitter=(getUserProfile(h.user_id)||{}).username||'Explorer';
      items.push({
        tierLabel:'Global',name:h.name,
        meta:(h.distance||0)+' mi · '+(h.difficulty||'Moderate')+' hike · Submitted by '+sanitize(submitter),
        submittedAt:h.created_at,
        approve:`_approveGlobalHike('${h.id}')`,reject:`_rejectGlobalHike('${h.id}')`
      });
    });
  }catch(e){console.warn('[Supabase] unified review — global hikes:',e);}
  const myUid=String(_myUid());
  const myAdminComms=getCommunities().filter(c=>String(c.adminId)===myUid);
  for(const c of myAdminComms){
    try{
      const {data,error}=await db.from('community_pending_spots').select('*').eq('community_id',c.id).eq('status','pending').order('submitted_at');
      if(!error)(data||[]).forEach(s=>{
        items.push({
          tierLabel:c.name||'Community',name:s.name,
          meta:sanitize(s.type||'')+' · '+(+s.lat).toFixed(4)+', '+(+s.lng).toFixed(4),
          submittedAt:s.submitted_at,
          approve:`_approveCommunityPendingSpot('${s.id}','${c.id}')`,reject:`_rejectCommunityPendingSpot('${s.id}','${c.id}')`
        });
      });
    }catch(e){console.warn('[Supabase] unified review — community spots:',e);}
    try{
      const {data,error}=await db.from('hikes').select('*').eq('community_id',c.id).eq('visibility','community').eq('status','pending');
      if(!error)(data||[]).forEach(h=>{
        items.push({
          tierLabel:c.name||'Community',name:h.name,
          meta:(h.distance||0)+' mi · '+(h.difficulty||'Moderate')+' hike',
          submittedAt:h.created_at,
          approve:`_approveCommunityPendingHike('${h.id}','${c.id}')`,reject:`_rejectCommunityPendingHike('${h.id}','${c.id}')`
        });
      });
    }catch(e){console.warn('[Supabase] unified review — community hikes:',e);}
  }
  items.sort((a,b)=>new Date(b.submittedAt||0)-new Date(a.submittedAt||0));
  if(!container)return; // profile may have navigated away while awaiting
  if(!items.length){
    container.innerHTML='<div style="padding:4px 0">Nothing pending across Global or your communities</div>';
    return;
  }
  container.innerHTML=items.map(it=>`
    <div style="background:var(--bg2);border-radius:12px;padding:12px;margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">
        <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;padding:2px 8px;border-radius:8px;background:rgba(184,232,122,.15);color:var(--accent);white-space:nowrap">${sanitize(it.tierLabel)}</span>
        <span style="font-size:13px;font-weight:700;color:var(--txt0)">${sanitize(it.name)}</span>
      </div>
      <div style="font-size:11px;color:var(--txt3)">${it.meta}</div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button onclick="${it.approve};setTimeout(_buildUnifiedPendingReview,400)" style="flex:1;padding:8px;background:rgba(184,232,122,.15);border:1.5px solid var(--accent);border-radius:8px;color:var(--accent);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">Approve</button>
        <button onclick="${it.reject};setTimeout(_buildUnifiedPendingReview,400)" style="flex:1;padding:8px;background:rgba(196,82,74,.1);border:1.5px solid rgba(196,82,74,.4);border-radius:8px;color:var(--red);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">Reject</button>
      </div>
    </div>`).join('');
}

function _showPendingSpots(){
  const pending=getPendingSpots();
  if(!pending.length){showToast('No spots pending review');return;}
  // Show a simple overlay with pending spot cards
  let overlay=document.getElementById('pendingSpotsOverlay');
  if(!overlay){
    overlay=document.createElement('div');
    overlay.id='pendingSpotsOverlay';
    overlay.style.cssText='position:absolute;inset:0;background:var(--bg0);z-index:9100;overflow-y:auto;display:flex;flex-direction:column;padding:0 0 var(--nav-h) 0';
    document.getElementById('app').appendChild(overlay);
  }
  overlay.innerHTML=`
    <div style="display:flex;align-items:center;padding:54px 20px 16px;border-bottom:1px solid var(--border);gap:14px">
      <div onclick="this.closest('#pendingSpotsOverlay').remove()" style="width:36px;height:36px;border-radius:50%;background:var(--bg2);border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;color:var(--txt2)">←</div>
      <div style="font-size:17px;font-weight:700;color:var(--txt0)">Pending Spots (${pending.length})</div>
    </div>
    ${pending.map(s=>`
      <div class="pending-spot-row">
        ${(s.photos&&s.photos.length)?`<div style="display:flex;gap:6px;overflow-x:auto;margin-bottom:10px;-webkit-overflow-scrolling:touch">${s.photos.map(u=>`<img src="${u}" style="width:76px;height:76px;object-fit:cover;border-radius:10px;flex-shrink:0">`).join('')}</div>`:''}
        <div class="pending-spot-name">${sanitize(s.name)}</div>
        <div class="pending-spot-meta">${sanitize(s.typeLabel||s.type)} · Submitted by ${sanitize(s._submittedBy)||'Unknown'}</div>
        <div style="font-size:11px;color:var(--txt3);margin-top:4px">${(+s.lat).toFixed(5)}, ${(+s.lng).toFixed(5)}</div>
        ${s.reviews_data?.[0]?.text?`<div style="font-size:12px;color:var(--txt2);margin-top:6px;line-height:1.5">${sanitize(s.reviews_data[0].text)}</div>`:''}
        <div class="pending-spot-btns">
          <button class="pending-approve" onclick="approveSpot('${s._pendingId}');this.closest('.pending-spot-row').remove();showToast('Approved!')">Approve</button>
          <button class="pending-reject" onclick="rejectSpot('${s._pendingId}');this.closest('.pending-spot-row').remove();showToast('Rejected')">Reject</button>
        </div>
      </div>`).join('')}`;
  overlay.style.display='flex';
}

// Global-tier hikes need the same app-admin review path as global spots —
// without this they would sit at status 'pending' forever.
async function _showPendingHikes(){
  if(!isAdmin())return;
  let rows=[];
  try{
    const {data,error}=await db.from('hikes').select('*').eq('visibility','global').eq('status','pending').order('created_at');
    if(error)throw error;
    rows=data||[];
  }catch(e){
    console.warn('[Supabase] pending hikes load:',e);
    showToast('Could not load pending hikes');
    return;
  }
  if(!rows.length){showToast('No hikes pending review');return;}
  let overlay=document.getElementById('pendingHikesOverlay');
  if(!overlay){
    overlay=document.createElement('div');
    overlay.id='pendingHikesOverlay';
    overlay.style.cssText='position:absolute;inset:0;background:var(--bg0);z-index:9100;overflow-y:auto;display:flex;flex-direction:column;padding:0 0 var(--nav-h) 0';
    document.getElementById('app').appendChild(overlay);
  }
  overlay.innerHTML=`
    <div style="display:flex;align-items:center;padding:54px 20px 16px;border-bottom:1px solid var(--border);gap:14px">
      <div onclick="this.closest('#pendingHikesOverlay').remove()" style="width:36px;height:36px;border-radius:50%;background:var(--bg2);border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;color:var(--txt2)">←</div>
      <div style="font-size:17px;font-weight:700;color:var(--txt0)">Pending Hikes (${rows.length})</div>
    </div>
    ${rows.map(h=>{
      const diffColor=h.difficulty==='Easy'?'#4CAF50':h.difficulty==='Hard'?'#E05252':'#D4A843';
      const submitter=(getUserProfile(h.user_id)||{}).username||'Explorer';
      return`<div class="pending-spot-row">
        <div class="pending-spot-name">${sanitize(h.name)}</div>
        <div class="pending-spot-meta">${h.distance||0} mi · ${h.elevation_gain||0} ft gain · <span style="color:${diffColor};font-weight:700">${h.difficulty||'Moderate'}</span> · Submitted by ${sanitize(submitter)}</div>
        ${h.description?`<div style="font-size:12px;color:var(--txt2);margin-top:6px;line-height:1.5">${sanitize(h.description)}</div>`:''}
        <div class="pending-spot-btns">
          <button class="pending-approve" onclick="_approveGlobalHike('${h.id}');this.closest('.pending-spot-row').remove()">Approve</button>
          <button class="pending-reject" onclick="_rejectGlobalHike('${h.id}');this.closest('.pending-spot-row').remove()">Reject</button>
        </div>
      </div>`;}).join('')}`;
  overlay.style.display='flex';
}
function _approveGlobalHike(hikeId){
  _sbTry(db.from('hikes').update({status:'approved'}).eq('id',hikeId),'approve global hike');
  showToast('Hike approved!');
  setTimeout(()=>_sbLoadHikes(),300);
}
function _rejectGlobalHike(hikeId){
  _sbTry(db.from('hikes').delete().eq('id',hikeId),'reject global hike');
  showToast('Hike rejected');
}

function _showManageSpots(){
  if(!isAdmin())return;
  const allS=[...spots,...userSpots];
  let overlay=document.getElementById('manageSpotsOverlay');
  if(!overlay){
    overlay=document.createElement('div');
    overlay.id='manageSpotsOverlay';
    overlay.style.cssText='position:absolute;inset:0;background:var(--bg0);z-index:9100;overflow-y:auto;display:flex;flex-direction:column;padding:0 0 var(--nav-h) 0';
    document.getElementById('app').appendChild(overlay);
  }
  overlay.innerHTML=`
    <div style="display:flex;align-items:center;padding:54px 20px 16px;border-bottom:1px solid var(--border);gap:14px;flex-shrink:0">
      <div onclick="this.closest('#manageSpotsOverlay').remove()" style="width:36px;height:36px;border-radius:50%;background:var(--bg2);border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;color:var(--txt2);flex-shrink:0">←</div>
      <div style="font-size:17px;font-weight:700;color:var(--txt0)">All Spots (${allS.length})</div>
    </div>
    <div style="padding:12px 16px;flex:1">
      ${allS.map(s=>`
        <div id="manageRow_${s.id}" style="display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid var(--border)">
          <div style="width:38px;height:38px;border-radius:10px;background:${s.heroGradient};flex-shrink:0"></div>
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:700;color:var(--txt0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.name}</div>
            <div style="font-size:11px;color:var(--txt2);margin-top:1px">${s.typeLabel||s.type} · ${s.userSubmitted?'<span style="color:var(--yellow)">User submitted</span>':'Official'}</div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button onclick="document.getElementById('manageSpotsOverlay').remove();setTimeout(()=>openDetail(${s.id}),50)" style="background:rgba(212,135,74,.15);border:1px solid rgba(212,135,74,.3);color:#D4874A;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer;font-family:var(--font)">Edit</button>
            <button onclick="_manageDeleteSpot('${s.id}',this)" style="background:rgba(196,82,74,.1);border:1px solid rgba(196,82,74,.25);color:var(--red);border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer;font-family:var(--font)">×</button>
          </div>
        </div>`).join('')}
    </div>`;
  overlay.style.display='flex';
}

function _manageDeleteSpot(spotId, btn){
  const spot=[...spots,...userSpots].find(s=>s.id===spotId);
  if(!spot)return;
  if(!window.confirm(`Delete "${spot.name}"?`))return;
  const sIdx=spots.findIndex(s=>s.id===spotId);
  if(sIdx>=0)spots.splice(sIdx,1);
  const uIdx=userSpots.findIndex(s=>s.id===spotId);
  if(uIdx>=0)userSpots.splice(uIdx,1);
  const row=document.getElementById(`manageRow_${spotId}`);
  if(row)row.remove();
  // Update header count
  const overlay=document.getElementById('manageSpotsOverlay');
  if(overlay){
    const header=overlay.querySelector('[style*="font-size:17px"]');
    if(header)header.textContent=`All Spots (${spots.length+userSpots.length})`;
  }
  try{refreshSpotMarkers();}catch(e){}
  showToast(`"${spot.name}" deleted`);
}

// ─── Year in Review ───────────────────────────────
function buildYearReview(){
  const favCount=favorites.size;
  const visitedCount=38+userSpots.length;
  const journalEntries=JSON.parse(localStorage.getItem('wp_journal')||'[]');
  const topType=favCount>0?'Hikes':' Swims';
  document.getElementById('yearReview').innerHTML=`
    <div class="year-review-card">
      <div style="font-size:13px;font-weight:700;color:var(--txt0);margin-bottom:4px">Your WildPath 2026 so far…</div>
      <div class="year-stat-row">
        <div class="year-stat"><div class="year-stat-val">${visitedCount}</div><div class="year-stat-lbl">Spots Visited</div></div>
        <div class="year-stat"><div class="year-stat-val">${favCount||12}</div><div class="year-stat-lbl">Saved</div></div>
        <div class="year-stat"><div class="year-stat-val">${journalEntries.length||7}</div><div class="year-stat-lbl">Journal Entries</div></div>
      </div>
      <div style="font-size:12px;color:var(--txt2);margin-top:10px;line-height:1.6">
        Most visited: <strong style="color:var(--accent)">Swimming Holes</strong> · Peak month: <strong style="color:var(--accent)">July</strong>
      </div>
    </div>`;
}

// ─── Favorites list ───────────────────────────────
function buildFavList(){
  const allS=[...spots,...userSpots];
  const favSpots=allS.filter(s=>favorites.has(s.id));
  const el=document.getElementById('favList');
  const countEl=document.getElementById('favCount');
  if(countEl)countEl.textContent=favSpots.length+' spots';
  if(!favSpots.length){
    el.innerHTML=`<div style="font-size:13px;color:var(--txt2);padding:14px 0">No favorites yet — tap the heart on any spot to save it here.</div>`;
    return;
  }
  el.innerHTML=favSpots.map(s=>`
    <div class="fav-row" onclick="goToSpot('${s.id}')">
      <div class="fav-thumb" style="background:${s.heroGradient}"></div>
      <div style="flex:1;min-width:0">
        <div class="fav-name">${s.name}</div>
        <div class="fav-type" style="color:${s.typeColor}">${s.icon} ${s.typeLabel} · ${s.distance}</div>
      </div>
      <button onclick="event.stopPropagation();toggleFavorite(${s.id});buildFavList();buildYearReview()" style="background:none;border:none;font-size:12px;font-weight:700;cursor:pointer;color:#e05252;padding:6px 10px">Remove</button>
    </div>`).join('');
}

// ─── Collections ─────────────────────────────────
// Load collections, stripping any emoji from icon field (migration from old format)
let collections=(()=>{
  const _c=JSON.parse(localStorage.getItem('wp_collections')||'[]');
  return _c.map(c=>({...c,icon:''})); // strip emoji icons — replaced with Tabler icons at render time
})();
// ─── Journal ─────────────────────────────────────
let journalEntries=JSON.parse(localStorage.getItem('wp_journal')||'[]');
let journalStarVal=5;

function buildJournalList(){
  const el=document.getElementById('journalList');
  if(!journalEntries.length){
    el.innerHTML=`<div style="font-size:13px;color:var(--txt2);padding:10px 0">No journal entries yet. Document your adventures!</div>`;
    return;
  }
  const sorted=[...journalEntries].sort((a,b)=>b.ts-a.ts).slice(0,5);
  el.innerHTML=sorted.map(e=>`
    <div class="journal-entry">
      <div class="journal-entry-header">
        <span class="journal-entry-spot">${e.spotName||'General'} (${e.stars||5}/5)</span>
        <span class="journal-entry-date">${e.date}</span>
      </div>
      <div class="journal-entry-text">${e.notes}</div>
    </div>`).join('');
  if(journalEntries.length>5)el.innerHTML+=`<div style="font-size:12px;color:var(--txt2);text-align:center;padding:8px">${journalEntries.length-5} more entries…</div>`;
}

function initJournalStars(){
  const container=document.getElementById('journalStars');
  if(!container)return;
  container.innerHTML=[1,2,3,4,5].map(n=>
    `<span onclick="setJournalStar(${n})" style="font-size:22px;cursor:pointer;transition:.1s" class="jstar" data-v="${n}"></span>`
  ).join('');
}

function openJournalEntry(){
  const overlay=document.getElementById('journalOverlay');
  const sel=document.getElementById('journalSpotSelect');
  const allS=[...spots,...userSpots];
  sel.innerHTML='<option value="">No specific spot</option>'+allS.slice(0,20).map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
  document.getElementById('journalDate').value=new Date().toISOString().split('T')[0];
  document.getElementById('journalNotes').value='';
  journalStarVal=5;
  initJournalStars();
  document.querySelectorAll('.jstar').forEach(s=>s.textContent=parseInt(s.dataset.v)<=5?'':'');
  overlay.classList.add('open');
}

function closeJournal(){document.getElementById('journalOverlay').classList.remove('open');}

function setJournalStar(n){
  journalStarVal=n;
  document.querySelectorAll('.jstar').forEach(s=>s.textContent=parseInt(s.dataset.v)<=n?'':'');
}

function saveJournalEntry(){
  const notes=document.getElementById('journalNotes').value.trim();
  if(!notes){showToast('Write something first');return;}
  const selEl=document.getElementById('journalSpotSelect');
  const spotId=parseInt(selEl.value)||null;
  const spotName=spotId?[...spots,...userSpots].find(s=>s.id===spotId)?.name||'':selEl.options[selEl.selectedIndex].text;
  journalEntries.push({
    id:Date.now(),ts:Date.now(),
    spotId,spotName:spotName==='No specific spot'?'':spotName,
    date:document.getElementById('journalDate').value,
    notes,stars:journalStarVal
  });
  localStorage.setItem('wp_journal',JSON.stringify(journalEntries));
  closeJournal();
  buildJournalList();
  buildYearReview();
  showToast('Journal entry saved');
}

// ═══════════════════════════════════════════════════
// SPOT MARKER HELPERS
// ═══════════════════════════════════════════════════

// ═══════════════════════════════════════════════════
// FILTER SYSTEM
// ═══════════════════════════════════════════════════
function buildFilterStrip(){
  const strip=document.getElementById('filterStrip');
  strip.innerHTML='';
  SPOT_FILTERS.forEach(f=>{
    const chip=document.createElement('div');
    chip.className='filter-chip'+(f.id==='all'?' factive':'');
    chip.dataset.filter=f.id;
    chip.innerHTML=f.label;
    chip.onclick=()=>setFilter(f.id);
    strip.appendChild(chip);
  });
}

function setFilter(filterId){
  const FILTER_TYPES={
    water:['swimming','river','waterfall','natural_slide'],
    caves:['caves','lava_tube'],
    hiking:['hiking'],biking:['biking'],views:['scenic'],urban:['urban'],climb:['rock_climbing']
  };
  if(filterId==='all'){
    activeFilters.clear();
    document.querySelectorAll('.filter-chip').forEach(c=>c.classList.remove('factive'));
    document.querySelector('.filter-chip[data-filter="all"]').classList.add('factive');
  }else{
    document.querySelector('.filter-chip[data-filter="all"]').classList.remove('factive');
    const chip=document.querySelector(`.filter-chip[data-filter="${filterId}"]`);
    if(activeFilters.has(filterId)){
      activeFilters.delete(filterId);
      chip.classList.remove('factive');
      if(activeFilters.size===0)document.querySelector('.filter-chip[data-filter="all"]').classList.add('factive');
    }else{
      activeFilters.add(filterId);
      chip.classList.add('factive');
    }
  }
  refreshSpotMarkers();
}

// ═══════════════════════════════════════════════════
// FAVORITES
// ═══════════════════════════════════════════════════
function toggleFavorite(spotId){
  if(isGuest()){showLoginScreen(()=>toggleFavorite(spotId));return;}
  if(favorites.has(spotId)){favorites.delete(spotId);showToast('Removed from favorites');}
  else{favorites.add(spotId);showToast('Saved to favorites');}
  localStorage.setItem('wp_favs',JSON.stringify([...favorites]));
  const btn=document.getElementById('favBtn');
  if(btn){btn.classList.toggle('saved',favorites.has(spotId));btn.textContent=favorites.has(spotId)?'Saved':'Save';}
}

// ═══════════════════════════════════════════════════
// ADD SPOT FORM
// ═══════════════════════════════════════════════════
let aspSelectedType=null, aspSelectedDiff='Easy', aspStarVal=5;
let _aspPhotos=[]; // photo dataUrls for new spot submission

function handleAspPhotos(e){
  const files=Array.from(e.target.files||[]);
  if(!files.length)return;
  Promise.all(files.map(f=>compressImage(f))).then(urls=>{
    _aspPhotos=[..._aspPhotos,...urls];
    _renderAspPhotoGrid();
  }).catch(()=>showToast('Could not read photo'));
  e.target.value='';
}
function _renderAspPhotoGrid(){
  const grid=document.getElementById('aspPhotoGrid');
  if(!grid)return;
  grid.innerHTML=_aspPhotos.map((url,i)=>`
    <div style="position:relative;aspect-ratio:1;border-radius:10px;overflow:hidden;background:var(--bg3)">
      <img src="${url}" style="width:100%;height:100%;object-fit:cover">
      <button onclick="_removeAspPhoto(${i})" style="position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;background:rgba(0,0,0,.7);border:none;color:#fff;font-size:14px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;font-family:var(--font)">×</button>
    </div>`).join('');
}
function _removeAspPhoto(i){_aspPhotos.splice(i,1);_renderAspPhotoGrid();}

function openAddSpot(presetTier){
  if(isGuest()){showLoginScreen(()=>openAddSpot(presetTier));return;}
  aspSelectedType=null; aspSelectedDiff='Easy'; aspStarVal=5;
  addSpotTempLat=null; addSpotTempLng=null;
  // Reset visibility tier tiles to Personal (default) unless a preset was passed
  const tier=presetTier||'personal';
  document.querySelectorAll('#aspTierTiles .asp-tier-tile').forEach(t=>{
    const isSel=t.dataset.tier===tier;
    t.classList.toggle('selected',isSel);
    t.style.borderColor=isSel?'var(--accent)':'var(--border2)';
    t.style.background=isSel?'rgba(184,232,122,.1)':'var(--bg2)';
  });
  selectAspTier(tier,document.querySelector(`#aspTierTiles [data-tier="${tier}"]`));
  // Build type grid
  const grid=document.getElementById('aspTypeGrid');
  grid.innerHTML='';
  Object.entries(SPOT_TYPE_DEFS).forEach(([key,def])=>{
    const chip=document.createElement('div');
    chip.className='type-chip';
    chip.dataset.type=key;
    chip.innerHTML=`<span class="type-chip-icon">${_getSpotIcon(key,def.color)}</span><span>${def.label}</span>`;
    chip.onclick=()=>{
      document.querySelectorAll('.type-chip').forEach(c=>c.classList.remove('selected'));
      chip.classList.add('selected');
      aspSelectedType=key;
    };
    grid.appendChild(chip);
  });
  // Reset stars
  updateStarDisplay(aspStarVal);
  document.getElementById('aspLocDisplay').style.display='none';
  document.getElementById('addSpotOverlay').classList.add('open');
}

function closeAddSpot(){
  document.getElementById('addSpotOverlay').classList.remove('open');
  addSpotMode=false;
  if(map)map.getCanvas().style.cursor='';
  _aspPhotos=[];
  _addSpotCommunityId=null;
  const grid=document.getElementById('aspPhotoGrid');
  if(grid)grid.innerHTML='';
}

function startMapPinMode(){
  closeAddSpot();
  addSpotMode=true;
  if(map)map.getCanvas().style.cursor='crosshair';
  showToast('Tap the map to place your spot');
}

let _aspVisibilityTier='personal';
function selectAspTier(tier,el){
  _aspVisibilityTier=tier;
  document.querySelectorAll('#aspTierTiles .asp-tier-tile').forEach(t=>{
    const isSel=t===el||t.dataset.tier===tier;
    t.classList.toggle('selected',isSel);
    t.style.borderColor=isSel?'var(--accent)':'var(--border2)';
    t.style.background=isSel?'rgba(184,232,122,.1)':'var(--bg2)';
  });
  const picker=document.getElementById('aspCommunityPicker');
  if(picker){
    picker.style.display=tier==='community'?'block':'none';
    if(tier==='community')_populateAspCommunitySelect();
  }
  const submitBtn=document.querySelector('.btn-submit-spot');
  if(submitBtn)submitBtn.textContent=tier==='personal'?'Save Personal Spot':tier==='community'?'Submit to Community':'Submit for Review';
}
function _populateAspCommunitySelect(){
  const sel=document.getElementById('aspCommunitySelect');
  if(!sel)return;
  const myUid=String(_myUid());
  const myComms=getCommunities().filter(c=>getMembers(c.id).includes(myUid));
  sel.innerHTML=myComms.length
    ? myComms.map(c=>`<option value="${c.id}">${sanitize(c.name)}</option>`).join('')
    : '<option value="">You have not joined any communities yet</option>';
}

function selectDiff(el){
  document.querySelectorAll('.diff-btn').forEach(b=>b.classList.remove('selected'));
  el.classList.add('selected');
  aspSelectedDiff=el.dataset.diff;
}

function setStarRating(e){
  const s=parseInt(e.target.dataset.s);
  if(!s)return;
  aspStarVal=s;
  updateStarDisplay(s);
}

function updateStarDisplay(n){
  const row=document.getElementById('aspStars');
  if(!row)return;
  [...row.children].forEach((s,i)=>{
    s.style.color=i<n?'#f4b942':'var(--txt3)';
    s.style.opacity=i<n?'1':'0.35';
  });
}

function submitNewSpot(){
  const name=(document.getElementById('aspName').value||'').trim();
  if(!name){showToast('Enter a spot name');return;}
  if(!aspSelectedType){showToast('Select a spot type');return;}
  const hasLoc=addSpotTempLat||document.getElementById('aspLocSearch').value.trim();
  if(!hasLoc){showToast('Add a location');return;}

  const def=SPOT_TYPE_DEFS[aspSelectedType];
  const id=1000+userSpots.length+Date.now()%10000;
  const lat=addSpotTempLat||37.8;
  const lng=addSpotTempLng||-122.4;
  const desc=(document.getElementById('aspDesc').value||'').trim()||'Community-added spot';

  const newSpot={
    id,name,lat,lng,type:aspSelectedType,
    typeLabel:def.label,typeColor:def.color,icon:def.icon,emoji:def.icon,
    heroGradient:`linear-gradient(160deg,#0f1410,#1e251e,#0a100a)`,
    rating:aspStarVal,reviews:1,distance:'? mi away',elevation:'?',
    legal:'legal',legalText:'Legal',legalClass:'legal-legal',
    trailLength:'Unknown',difficulty:aspSelectedDiff,
    diffClass:`diff-${aspSelectedDiff.toLowerCase()}`,
    bestSeason:'Year-round',parkingCost:'Unknown',entryFee:'Unknown',
    roadCondition:'Unknown',cellSignal:'Unknown',
    season:[1,1,1,1,1,1,1,1,1,1,1,1],permitRequired:false,
    parkingCapacity:'Unknown',parkingFillTime:'Unknown',fourWD:false,
    weather:[{day:'Mon',icon:'sun',high:72,low:50},{day:'Tue',icon:'sun',high:74,low:51},{day:'Wed',icon:'partly-cloudy',high:68,low:48},{day:'Thu',icon:'sun',high:71,low:50},{day:'Fri',icon:'partly-cloudy',high:65,low:47}],
    crowd:30,campingText:'Unknown',
    reviews_data:[{user:'You',stars:aspStarVal,date:new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}),text:desc}],
    similar:[1,2,3],
    approach:desc,gear:[],hazards:[],insiderTips:desc,
    accessibility:'Unknown',kidScore:3,dogFriendly:true,shade:'Unknown',
    crowdsByDay:[30,25,28,32,35,55,60],hiddenGem:true,
    userSubmitted:true,submittedDate:Date.now(),
    photos:[..._aspPhotos],
    heroGradient:_aspPhotos.length?undefined:`linear-gradient(160deg,#0f1410,#1e251e,#0a100a)`
  };
  if(_aspPhotos.length)newSpot.heroGradient=`linear-gradient(160deg,#0f1410,#1e251e,#0a100a)`;

  // Opened from a community map (legacy entry point): community-tier spots must
  // go through that community's admin approval, same as the tier-picker path —
  // never straight onto the live community map.
  if(_addSpotCommunityId){
    const savedCid=_addSpotCommunityId;
    _addSpotCommunityId=null;
    _submitCommunityPendingSpot(savedCid,name,aspSelectedType,lat,lng,desc,_aspPhotos);
    _aspPhotos=[];
    closeAddSpot();
    setTimeout(()=>openCommunityMap(savedCid),300);
    return;
  }

  // Three-tier visibility: Personal (instant), Community (that community's admin review), Global (app admin review)
  if(_aspVisibilityTier==='personal'){
    _submitPersonalSpot(name,aspSelectedType,lat,lng,desc,_aspPhotos);
  } else if(_aspVisibilityTier==='community'){
    const cid=document.getElementById('aspCommunitySelect')?.value;
    if(!cid){showToast('Select a community first');return;}
    _submitCommunityPendingSpot(cid,name,aspSelectedType,lat,lng,desc,_aspPhotos);
  } else {
    submitSpotForReview(newSpot);
  }
  _aspPhotos=[];
  closeAddSpot();
  leafletMap.flyTo([lat,lng],14,{animate:true,duration:1.2});
}

async function _submitPersonalSpot(name,type,lat,lng,notes,photoDataUrls){
  if(isGuest()){showLoginScreen();return;}
  try{
    const photoUrls=[];
    for(const dataUrl of (photoDataUrls||[]).slice(0,6)){
      try{photoUrls.push(await _sbUploadDataUrl('Spot Photos',dataUrl,'jpg'));}catch(e){console.warn('personal spot photo upload:',e);}
    }
    const {data,error}=await db.from('personal_spots').insert({
      user_id:_myUid(),name,type,lat,lng,notes,photo_urls:photoUrls
    }).select().single();
    if(error)throw error;
    const def=SPOT_TYPE_DEFS[type]||{label:type,color:'#D4A843'};
    personalSpots.push({
      id:'personal_'+data.id,personalSpotId:data.id,name,lat,lng,type,
      typeLabel:def.label,notes,photos:photoUrls,
      heroGradient:'linear-gradient(160deg,#2a2410,#3a3018,#1a1608)',
      createdAt:data.created_at,tier:'personal'
    });
    refreshSpotMarkers();
    showToast('Personal spot saved — only you can see it');
  }catch(e){
    console.warn('[Supabase] personal spot submit failed:',e);
    showToast('Could not save spot — check connection');
  }
}

async function _submitCommunityPendingSpot(communityId,name,type,lat,lng,description,photoDataUrls){
  if(isGuest()){showLoginScreen();return;}
  try{
    const photoUrls=[];
    for(const dataUrl of (photoDataUrls||[]).slice(0,6)){
      try{photoUrls.push(await _sbUploadDataUrl('Spot Photos',dataUrl,'jpg'));}catch(e){console.warn('community spot photo upload:',e);}
    }
    const {error}=await db.from('community_pending_spots').insert({
      community_id:communityId,user_id:_myUid(),name,type,lat,lng,description,photo_urls:photoUrls,status:'pending'
    });
    if(error)throw error;
    showToast('Submitted — waiting for that community\'s approval');
  }catch(e){
    console.warn('[Supabase] community spot submit failed:',e);
    showToast('Could not submit spot — check connection');
  }
}

// ═══════════════════════════════════════════════════
// WAYPOINTS & PARKING
// ═══════════════════════════════════════════════════

function dropWaypoint(lat,lng,name){
  if(!map)return null;
  const label=name||`Waypoint ${waypointMarkers.length+1}`;
  const el=document.createElement('div');
  el.className='waypoint-marker-el';
  el.textContent=label;
  const m=new mapboxgl.Marker({element:el,anchor:'center'})
    .setLngLat([lng,lat]).addTo(map);
  waypointMarkers.push({marker:m,label});
  return m;
}

// ═══════════════════════════════════════════════════
// AUTOCOMPLETE
// ═══════════════════════════════════════════════════
const acTimers={};
function acInput(inputEl,dropId,isLocationField){
  const id=inputEl.id;
  clearTimeout(acTimers[id]);
  const q=inputEl.value.trim();
  const drop=document.getElementById(dropId);
  if(q.length<3){drop.classList.remove('open');return;}
  acTimers[id]=setTimeout(()=>fetchAcResults(q,inputEl,drop,isLocationField),340);
}

async function fetchAcResults(q,inputEl,drop,isLocationField){
  try{
    const url=`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5&addressdetails=1`;
    const res=await fetch(url,{headers:{'Accept-Language':'en-US,en','User-Agent':'WildPath/1.0'}});
    if(!res.ok)return;
    const data=await res.json();
    if(!data.length){drop.classList.remove('open');return;}
    drop.innerHTML='';
    data.forEach(r=>{
      const parts=r.display_name.split(',');
      const name=parts[0].trim();
      const sub=parts.slice(1,3).join(',').trim();
      const item=document.createElement('div');
      item.className='ac-item';
      item.innerHTML=`<div class="ac-name">${name}</div><div class="ac-sub">${sub}</div>`;
      item.onclick=()=>{
        inputEl.value=name;
        drop.classList.remove('open');
        if(isLocationField){
          addSpotTempLat=parseFloat(r.lat);
          addSpotTempLng=parseFloat(r.lon);
          const disp=document.getElementById('aspLocDisplay');
          disp.style.display='block';
          disp.textContent=`${r.display_name.split(',').slice(0,2).join(',')}`;
        }
      };
      drop.appendChild(item);
    });
    drop.classList.add('open');
  }catch{drop.classList.remove('open');}
}

// Close dropdowns on outside click
document.addEventListener('click',e=>{
  if(!e.target.closest('.ac-wrap'))document.querySelectorAll('.ac-drop').forEach(d=>d.classList.remove('open'));
});

// goToSpot — fly to a spot on the Map and open its detail sheet.
// Retained from the removed Explore screen because the favorites list uses it.
function goToSpot(id){
  const s=[...spots,...userSpots].find(x=>String(x.id)===String(id));
  if(!s)return;
  showTab('map');
  setTimeout(()=>{
    if(map)map.flyTo({center:[s.lng,s.lat],zoom:14,duration:1200,essential:true});
    setTimeout(()=>openDetail(s.id),1300);
  },200);
}

// ═══════════════════════════════════════════════════
// SPOT SHEET — with favorites btn + conditions
// ═══════════════════════════════════════════════════
function openSheet(pinIndex){
  const allS=[...spots,...userSpots];
  const spot=allS.find(s=>s.id===pinIndex)||allS[0];
  currentPin=pinIndex; sheetOpen=true;
  const legalColors={legal:'#6fcf97',permit:'#f0c040',gray:'#e07b39',illegal:'#ff7070'};
  const legalBg={legal:'rgba(74,124,89,.18)',permit:'rgba(212,160,23,.18)',gray:'rgba(224,123,57,.18)',illegal:'rgba(224,82,82,.18)'};
  const legalIcon={legal:'Legal',permit:'Permit Required',gray:'Gray Area',illegal:'Illegal'};
  const lat=spot.lat.toFixed(5), lng=spot.lng.toFixed(5);
  const isFav=favorites.has(spot.id);

  document.getElementById('sheetContent').innerHTML=`
    <div class="sheet-hero" style="background:${spot.heroGradient}">
      <!-- hero clean -->
      <div class="sheet-hero-overlay"></div>
    </div>
    <div class="sheet-body">
      <div class="sheet-badge-row">
        <span class="sheet-type-badge" style="background:${spot.typeColor}22;color:${spot.typeColor}">${spot.typeLabel}</span>
        <span class="sheet-legal-chip" style="background:${legalBg[spot.legal]};color:${legalColors[spot.legal]}">${legalIcon[spot.legal]}</span>
      </div>
      <div class="sheet-spot-name">${spot.name}</div>
      <div class="sheet-rating-row">
        <span class="sheet-stars" style="color:var(--yellow);font-size:13px;font-weight:800">${spot.rating}</span>
        <span class="sheet-review-count">${spot.rating} · ${spot.reviews} reviews</span>
      </div>
      <div class="sheet-coords"><span></span>${lat}°N, ${Math.abs(parseFloat(lng)).toFixed(5)}°W</div>
      <div class="sheet-stats-row">
        <div class="sheet-stat"><div class="sheet-stat-val">${spot.distance}</div><div class="sheet-stat-label">Away</div></div>
        <div class="sheet-stat"><div class="sheet-stat-val">${spot.elevation}</div><div class="sheet-stat-label">Elevation</div></div>
        <div class="sheet-stat"><div class="sheet-stat-val">${spot.difficulty}</div><div class="sheet-stat-label">Difficulty</div></div>
        <div class="sheet-stat"><div class="sheet-stat-val">${spot.trailLength.split(' ')[0]}</div><div class="sheet-stat-label">Trail</div></div>
      </div>
      <div class="sheet-season">Best Season: <strong style="color:var(--txt0)">${spot.bestSeason}</strong>&nbsp;·&nbsp;Entry: <strong style="color:var(--txt0)">${spot.entryFee}</strong></div>
      ${spot.insiderTips?`<div style="background:rgba(212,160,23,.1);border:1px solid rgba(212,160,23,.25);border-radius:12px;padding:10px 12px;margin-bottom:14px;font-size:12px;color:#d4c080;line-height:1.5"><strong>Local Tip:</strong> ${spot.insiderTips}</div>`:''}
      <div class="sheet-actions-row" style="gap:6px">
        <a href="https://maps.apple.com/?daddr=${spot.lat},${spot.lng}&dirflg=d" target="_blank" class="sheet-btn-nav" style="text-decoration:none;text-align:center;flex:1">Apple Maps</a>
        <a href="https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lng}" target="_blank" class="sheet-btn-nav" style="text-decoration:none;text-align:center;flex:1;background:var(--accent);color:#0f1a0a">Google Maps</a>
        <button class="btn-fav${isFav?' saved':''}" id="favBtn" onclick="toggleFavorite('${spot.id}')">${isFav?'Saved':'Save'}</button>
      </div>
      <button class="sheet-btn-full" style="margin-top:8px" onclick="openDetail('${spot.id}')">View Full Details →</button>
    </div>`;

  document.getElementById('spotSheet').classList.add('open');
  document.getElementById('sheetBackdrop').classList.add('open');
  document.getElementById('spotSheet').style.transform='';
  // Check for road/fire alerts near this spot (show on map behind sheet)
  setTimeout(()=>checkAlertBanner(spot),100);
}

// ═══════════════════════════════════════════════════
// SPOT DETAIL PAGE — 3-TAB DESIGN
// ═══════════════════════════════════════════════════
let _detailSpotId=null;
let _detailTrailLayerIds=[];
let _detailTrailSourceIds=[];
// Terrain mini-map instances
let _terrainMap=null;
let _terrainFsMap=null;
let _terrainCurrentSpot=null;
let _terrainRotateRafId=null;
let _terrainRotateResumeTimer=null;
let _terrainUserInteracting=false;

function openDetail(spotIdOrObj){
  const myUid=String(_myUid?_myUid():'guest');
  const myPending=getPendingSpots().filter(s=>String(s._submitterUid)===myUid);
  const allS=[...spots,...userSpots,...myPending,...personalSpots];
  const spot=typeof spotIdOrObj==='object'?spotIdOrObj:allS.find(s=>s.id===spotIdOrObj)||allS[0];
  if(!spot)return;
  _detailSpotId=spot.id;
  currentPin=spot.id;
  _updateDetailSaveBtnState();

  // ── New design elements (stars, chips, mini map, reviews, bookmark) ──
  // Called first so elements are ready; mini map needs container visible
  setTimeout(()=>_populateDetailNewElements(spot),60);

  // ── Header: name (+ Pending Review badge for unapproved submissions) ──
  const nameEl=document.getElementById('detailName');
  if(nameEl){
    nameEl.textContent=spot.name;
    if(spot._pendingId)nameEl.innerHTML=sanitize(spot.name)+' <span style="display:inline-block;vertical-align:middle;background:rgba(212,135,74,.18);border:1px solid rgba(212,135,74,.45);color:#D4874A;font-size:10px;font-weight:700;letter-spacing:.5px;padding:3px 9px;border-radius:12px;text-transform:uppercase">Pending Review</span>';
    else if(spot.tier==='personal')nameEl.innerHTML=sanitize(spot.name)+' <span style="display:inline-block;vertical-align:middle;background:rgba(212,168,67,.18);border:1px solid rgba(212,168,67,.45);color:#D4A843;font-size:10px;font-weight:700;letter-spacing:.5px;padding:3px 9px;border-radius:12px;text-transform:uppercase">Personal</span>';
  }

  // ── Permit suggestion chip ──
  const permitChip=document.getElementById('detailPermitChip');
  if(permitChip){
    const lc=spot.legal||'legal';
    if(lc==='permit'){
      permitChip.style.display='block';
      permitChip.innerHTML=`<div style="display:inline-flex;align-items:center;gap:6px;background:rgba(240,192,64,.12);border:1px solid rgba(240,192,64,.35);border-radius:20px;padding:6px 14px">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#f0c040" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <span style="font-size:12px;font-weight:700;color:#f0c040">Permit Required</span>
        ${spot.permitData?`<span style="font-size:11px;color:rgba(240,192,64,.7)">·</span><a href="${spot.permitData.url}" target="_blank" rel="noopener" style="font-size:12px;font-weight:700;color:#B8E87A;text-decoration:none">Get Permit</a>`:''}
      </div>`;
    } else if(lc==='illegal'){
      permitChip.style.display='block';
      permitChip.innerHTML=`<div style="display:inline-flex;align-items:center;gap:6px;background:rgba(224,82,82,.1);border:1px solid rgba(224,82,82,.3);border-radius:20px;padding:6px 14px">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#ff7070" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
        <span style="font-size:12px;font-weight:700;color:#ff7070">Do Not Trespass</span>
      </div>`;
    } else if(lc==='gray'){
      permitChip.style.display='block';
      permitChip.innerHTML=`<div style="display:inline-flex;align-items:center;gap:6px;background:rgba(224,123,57,.1);border:1px solid rgba(224,123,57,.3);border-radius:20px;padding:6px 14px">
        <span style="font-size:12px;font-weight:700;color:#e07b39">Gray Area — Check Before Visiting</span>
      </div>`;
    } else {
      permitChip.style.display='none';
    }
  }

  // ── Header badges: type pill + legal badge ──
  const badgesEl=document.getElementById('detailHeaderBadges');
  if(badgesEl){
    const typeColor=spot.typeColor||'#888';
    const legalColors={legal:'#6fcf97',permit:'#f0c040',gray:'#e07b39',illegal:'#ff7070'};
    const legalTexts={legal:'Legal',permit:'Permit Required',gray:'Gray Area',illegal:'Illegal'};
    const lc=spot.legal||'legal';
    badgesEl.innerHTML=`
      <span style="background:${typeColor}22;color:${typeColor};border:1px solid ${typeColor}44;border-radius:20px;padding:4px 12px;font-size:12px;font-weight:700">${spot.typeLabel||spot.type}</span>
      <span style="background:${legalColors[lc]}22;color:${legalColors[lc]};border:1px solid ${legalColors[lc]}44;border-radius:20px;padding:4px 12px;font-size:12px;font-weight:700">${legalTexts[lc]||'Legal'}</span>`;
  }

  // ── Quick stats 4-card row ──
  const statsEl=document.getElementById('detailQuickStats');
  if(statsEl){
    const dist=spot._realDistStr||spot.distance||'—';
    const diff=spot.difficulty||'Easy';
    const hikeTime=spot.trailLength?(()=>{
      const mi=parseFloat(spot.trailLength)||2;
      const hrs=mi/2.5;
      const lo=Math.max(0.5,hrs*0.8),hi=hrs*1.2;
      return `${lo<1?(lo*60).toFixed(0)+'m':lo.toFixed(1)+'h'}–${hi<1?(hi*60).toFixed(0)+'m':hi.toFixed(1)+'h'}`;
    })():'—';
    const elev=spot.elevation||'—';
    statsEl.innerHTML=[
      {label:'Distance',value:dist},
      {label:'Difficulty',value:diff},
      {label:'Time',value:hikeTime},
      {label:'Elevation',value:elev}
    ].map(c=>`<div style="background:var(--bg1);border:1px solid var(--border);border-radius:12px;padding:12px 8px;text-align:center">
      <div style="font-size:12px;font-weight:700;color:var(--txt0);margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.value}</div>
      <div style="font-size:10px;color:var(--txt3);letter-spacing:.3px;text-transform:uppercase">${c.label}</div>
    </div>`).join('');
  }

  // ── Legal status banner — kept hidden (permit chip in scroll body handles this) ──
  const legalEl=document.getElementById('detailLegalBanner');
  if(legalEl){legalEl.style.display='none';}
  if(false&&legalEl){
    const lc=spot.legal||'legal';
    const legalConfig={
      legal:{bg:'rgba(74,180,100,.12)',border:'rgba(74,180,100,.3)',color:'#6fcf97',title:'Open to Public',desc:'No permit required. Free and open access.'},
      permit:{bg:'rgba(240,192,64,.10)',border:'rgba(240,192,64,.35)',color:'#f0c040',title:'Permit Required',desc:'Reservation or fee required before visiting.'},
      gray:{bg:'rgba(224,123,57,.10)',border:'rgba(224,123,57,.3)',color:'#e07b39',title:'Legally Gray',desc:'Access unclear — check local regulations before visiting.'},
      illegal:{bg:'rgba(224,82,82,.10)',border:'rgba(224,82,82,.3)',color:'#ff7070',title:'Do Not Trespass',desc:'Private property. Entering without permission is trespassing.'}
    };
    const cfg=legalConfig[lc]||legalConfig.legal;
    let permitHTML='';
    if(lc==='permit'&&spot.permitData){
      const pd=spot.permitData;
      permitHTML=`
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid ${cfg.border}">
          <div style="font-size:12px;color:var(--txt1);margin-bottom:4px"><strong>${pd.name}</strong></div>
          <div style="font-size:12px;color:var(--txt2);margin-bottom:2px">${pd.agency}</div>
          <div style="font-size:12px;color:var(--txt2);margin-bottom:10px">${pd.cost}</div>
          <a href="${pd.url}" target="_blank" rel="noopener" style="display:inline-block;background:#B8E87A;color:#0f1a0a;border-radius:10px;padding:10px 20px;font-size:13px;font-weight:700;text-decoration:none;-webkit-tap-highlight-color:transparent">Get Permit →</a>
        </div>`;
    }
    legalEl.style.cssText=`background:${cfg.bg};border:1px solid ${cfg.border};border-radius:14px;padding:14px 16px`;
    legalEl.innerHTML=`
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
        <div style="width:10px;height:10px;border-radius:50%;background:${cfg.color};flex-shrink:0"></div>
        <div style="font-size:14px;font-weight:700;color:${cfg.color}">${cfg.title}</div>
      </div>
      <div style="font-size:13px;color:var(--txt1);line-height:1.5">${cfg.desc}</div>
      ${permitHTML}`;
  }

  // ── Freshness ──
  const freshnessEl=document.getElementById('detailFreshness');
  if(freshnessEl&&spot.verifiedBy){
    const vDate=new Date(spot.verifiedDate||Date.now());
    const daysSince=Math.floor((Date.now()-vDate)/86400000);
    const dotColor=daysSince<30?'#6fcf97':daysSince<90?'#f0c040':daysSince<180?'#e07b39':'#ff7070';
    const freshnessLabel=daysSince<30?'Recently verified':daysSince<90?'Verified this season':daysSince<180?'Verify before going':'Needs re-verification';
    const dateStr=vDate.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
    freshnessEl.innerHTML=`
      <div style="font-size:13px;font-weight:700;color:var(--txt0);margin-bottom:8px">Freshness</div>
      <div style="background:var(--bg1);border:1px solid var(--border);border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:12px">
        <div style="width:12px;height:12px;border-radius:50%;background:${dotColor};flex-shrink:0"></div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600;color:var(--txt0)">${freshnessLabel}</div>
          <div style="font-size:11px;color:var(--txt3);margin-top:2px">Verified by @${spot.verifiedBy} · ${dateStr}</div>
        </div>
      </div>`;
  }

  // ── Approach as numbered steps ──
  const approachEl=document.getElementById('detailApproach');
  if(approachEl&&spot.approach){
    const raw=spot.approach;
    // Split on sentence ends or periods+spaces into steps
    const sentences=raw.replace(/([.!?])\s+/g,'$1\n').split('\n').map(s=>s.trim()).filter(s=>s.length>15);
    const steps=sentences.slice(0,6);
    approachEl.innerHTML=`
      <div style="font-size:13px;font-weight:700;color:var(--txt0);margin-bottom:10px">How to Get There</div>
      ${steps.map((step,i)=>`
        <div style="display:flex;gap:12px;margin-bottom:10px;align-items:flex-start">
          <div style="width:24px;height:24px;border-radius:50%;background:#B8E87A;color:#0f1a0a;font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">${i+1}</div>
          <div style="background:var(--bg1);border:1px solid var(--border);border-radius:10px;padding:10px 12px;flex:1;font-size:13px;color:var(--txt1);line-height:1.5">${step}</div>
        </div>`).join('')}`;
  }

  // ── Discovered by ──
  const discEl=document.getElementById('detailDiscoveredBy');
  if(discEl&&spot.discoveredBy){
    discEl.innerHTML=`<div style="font-size:12px;color:var(--txt3)">Discovered by <strong style="color:var(--txt2)">@${spot.discoveredBy}</strong></div>`;
  }

  // ── Nearest services ──
  const servicesEl=document.getElementById('detailNearestServices');
  if(servicesEl){
    const hospital=spot.nearestHospital||'Check locally';
    const town=spot.nearestTown||'See map';
    servicesEl.innerHTML=`
      <div style="font-size:13px;font-weight:700;color:var(--txt0);margin-bottom:8px">Nearest Services</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div style="background:rgba(224,82,82,.08);border:1px solid rgba(224,82,82,.2);border-radius:12px;padding:12px">
          <div style="font-size:10px;color:var(--txt3);letter-spacing:.7px;text-transform:uppercase;font-weight:700;margin-bottom:4px">Hospital</div>
          <div style="font-size:12px;font-weight:700;color:var(--txt0);line-height:1.3">${hospital}</div>
        </div>
        <div style="background:rgba(74,90,217,.08);border:1px solid rgba(74,90,217,.2);border-radius:12px;padding:12px">
          <div style="font-size:10px;color:var(--txt3);letter-spacing:.7px;text-transform:uppercase;font-weight:700;margin-bottom:4px">Nearest Town</div>
          <div style="font-size:12px;font-weight:700;color:var(--txt0);line-height:1.3">${town}</div>
        </div>
      </div>`;
  }

  // ── Photos tab: legacy uploads + posts tagged to this spot with show_on_spot=true ──
  const photosGridEl=document.getElementById('detailPhotosGrid');
  if(photosGridEl){
    const communityPhotos=JSON.parse(localStorage.getItem(`wp_photos_${spot.id}`)||'[]').map(p=>({url:p.url,postId:null}));
    const taggedPostPhotos=getPosts()
      .filter(p=>String(p.spotId)===String(spot.id)&&p.showOnSpot!==false&&p.mediaUrl)
      .map(p=>({url:p.mediaUrl,postId:p.id}));
    const allPhotos=[...taggedPostPhotos,...communityPhotos];
    if(!allPhotos.length){
      photosGridEl.innerHTML=`
        <div style="text-align:center;padding:48px 20px">
          <div style="width:80px;height:80px;border-radius:16px;background:${spot.heroGradient||'var(--bg3)'};margin:0 auto 16px;display:flex;align-items:center;justify-content:center">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="1.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </div>
          <div style="font-size:14px;font-weight:600;color:var(--txt1);margin-bottom:6px">No photos yet</div>
          <div style="font-size:13px;color:var(--txt3);margin-bottom:16px">Be the first to share a photo of this spot</div>
          <button type="button" onclick="openPhotoPicker()" style="background:rgba(184,232,122,.15);border:1px solid rgba(184,232,122,.3);color:#B8E87A;border-radius:12px;padding:10px 20px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Add Your Photo</button>
        </div>`;
    } else {
      photosGridEl.innerHTML=`<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:2px">${
        allPhotos.map(p=>`<div style="aspect-ratio:1;overflow:hidden;border-radius:4px;cursor:pointer" onclick="${p.postId?`openPostDetail('${p.postId}')`:`openPhotoFull('${p.url}')`}"><img src="${p.url}" style="width:100%;height:100%;object-fit:cover" loading="lazy"></div>`).join('')
      }</div>`;
    }
  }

  // ── Discussion tab ──
  const commentsList=document.getElementById('detailCommentsList');
  if(commentsList) _renderDetailComments(spot.id);

  // ── Navigation buttons ──
  const appleMaps=document.getElementById('detailAppleMapsBtn');
  if(appleMaps)appleMaps.href=`https://maps.apple.com/?daddr=${spot.lat},${spot.lng}&dirflg=d`;
  const googleMaps=document.getElementById('detailGoogleMapsBtn');
  if(googleMaps)googleMaps.href=`https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lng}`;

  // ── Admin edit button ──
  const adminBtn=document.getElementById('detailAdminEditBtn');
  if(adminBtn)adminBtn.style.display=isAdmin()?'block':'none';

  // ── Extra content (community, conditions, etc) ──
  const extraEl=document.getElementById('detailExtra');
  if(extraEl){
    let extraHTML='';
    // Gear list
    if(spot.gear&&spot.gear.length){
      extraHTML+=`<div style="margin-top:14px">
        <div style="font-size:13px;font-weight:700;color:var(--txt0);margin-bottom:8px">What to Bring</div>
        <div style="background:var(--bg1);border:1px solid var(--border);border-radius:12px;padding:12px 14px">
          ${spot.gear.map(g=>`<div style="font-size:13px;color:var(--txt1);padding:4px 0;display:flex;align-items:center;gap:8px"><span style="color:#B8E87A">+</span>${g}</div>`).join('')}
        </div>
      </div>`;
    }
    // Hazards
    if(spot.hazards&&spot.hazards.length){
      extraHTML+=`<div style="margin-top:14px">
        <div style="font-size:13px;font-weight:700;color:var(--txt0);margin-bottom:8px">Hazards</div>
        <div style="background:rgba(224,82,82,.07);border:1px solid rgba(224,82,82,.18);border-radius:12px;padding:12px 14px">
          ${spot.hazards.map(h=>`<div style="font-size:13px;color:var(--txt1);padding:4px 0;display:flex;align-items:center;gap:8px"><span style="color:#ff7070;font-weight:700">!</span>${h}</div>`).join('')}
        </div>
      </div>`;
    }
    // Insider tips
    if(spot.insiderTips){
      extraHTML+=`<div style="margin-top:14px">
        <div style="font-size:13px;font-weight:700;color:var(--txt0);margin-bottom:8px">Insider Tips</div>
        <div style="background:rgba(184,232,122,.06);border:1px solid rgba(184,232,122,.18);border-radius:12px;padding:12px 14px;font-size:13px;color:var(--txt1);line-height:1.6">${spot.insiderTips}</div>
      </div>`;
    }
    // Reviews
    const revData=spot.reviews_data||[];
    const userRevs=JSON.parse(localStorage.getItem(`wp_reviews_${spot.id}`)||'[]');
    const allRevs=[...revData,...userRevs];
    if(allRevs.length){
      const _sSVG=(f,e)=>Array.from({length:5},(_,i)=>i<f?'<svg viewBox="0 0 24 24" width="13" height="13" style="vertical-align:middle" fill="#F5A623" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>':'<svg viewBox="0 0 24 24" width="13" height="13" style="vertical-align:middle" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>').join('');
      const stars=n=>_sSVG(n,5-n);
      extraHTML+=`<div style="margin-top:14px">
        <div style="font-size:13px;font-weight:700;color:var(--txt0);margin-bottom:8px">Reviews</div>
        ${allRevs.map(r=>`<div style="padding:12px 0;border-bottom:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <div style="font-size:13px;font-weight:700;color:var(--txt0)">${r.user}</div>
            <div style="font-size:11px;color:var(--txt3)">${r.date||''}</div>
          </div>
          <div style="color:#f0c040;font-size:12px;margin-bottom:4px">${stars(r.stars||5)}</div>
          <div style="font-size:13px;color:var(--txt1);line-height:1.5">${r.text||r.notes||''}</div>
        </div>`).join('')}
      </div>`;
    }
    // Similar spots
    const allSpots=[...spots,...userSpots];
    const similar=(spot.similar||[]).map(id=>allSpots.find(s=>s.id===id)).filter(Boolean);
    if(similar.length){
      extraHTML+=`<div style="margin-top:14px;margin-bottom:16px">
        <div style="font-size:13px;font-weight:700;color:var(--txt0);margin-bottom:8px">Similar Spots</div>
        <div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none">
          ${similar.map(s=>`<div onclick="openDetail('${s.id}')" style="flex-shrink:0;width:120px;cursor:pointer">
            <div style="width:120px;height:80px;border-radius:10px;background:${s.heroGradient};margin-bottom:6px"></div>
            <div style="font-size:12px;font-weight:700;color:var(--txt0)">${s.name}</div>
            <div style="font-size:11px;color:var(--txt3)">${s.typeLabel}</div>
          </div>`).join('')}
        </div>
      </div>`;
    }
    extraEl.innerHTML=extraHTML;
  }

  // ── Elevation context row ──
  const elevRowEl=document.getElementById('detailElevRow');
  if(elevRowEl){
    const elevStr=spot.elevation||'';
    const isGain=elevStr.startsWith('+');
    const numericElev=elevStr.replace(/[^0-9,]/g,'');
    elevRowEl.innerHTML=`
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#B8E87A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
      ${numericElev?`<span style="font-size:13px;font-weight:700;color:var(--txt1)">${isGain?'+':''}${numericElev} ft</span>`:''}
      ${isGain?`<span style="font-size:11px;color:var(--txt3)">elevation gain</span>`:(numericElev?`<span style="font-size:11px;color:var(--txt3)">elevation</span>`:'')}
      <span style="font-size:10px;color:rgba(184,232,122,.55);margin-left:auto;font-weight:600;letter-spacing:.4px">3D TERRAIN ↑</span>`;
  }

  // ── Ranger contact ──
  _buildRangerContact(spot);

  // ── Show on Info tab by default ──
  switchDetailTab('info');

  // ── Fetch live weather ──
  fetchLiveWeather(spot);

  // ── Load nearby trails on map ──
  loadDetailTrails(spot);

  // ── Community spot integrations ──
  _communitySpotId=spot.id;
  setTimeout(()=>{
    if(typeof buildConditionsDash==='function')buildConditionsDash(spot.id);
    if(typeof buildTripReports==='function')buildTripReports(spot.id);
  },100);

  // ── Slide up animation ──
  // ── Show map tab first so map is visible behind the sheet ──
  showTab('map');

  const detail=document.getElementById('screen-detail');
  const sheet=document.getElementById('detailSheet');
  detail.style.display='flex';
  if(sheet){
    sheet.style.transition='none';
    sheet.style.transform='translateY(100%)';
    requestAnimationFrame(()=>{
      sheet.style.transition='transform 0.38s cubic-bezier(0.32,0.72,0,1)';
      requestAnimationFrame(()=>{
        sheet.style.transform='translateY(0)';
        detail.classList.add('active');
      });
    });
  } else {
    detail.style.transform='translateY(100%)';
    detail.style.transition='transform 0.38s cubic-bezier(0.32,0.72,0,1)';
    setTimeout(()=>{detail.style.transform='translateY(0)';detail.classList.add('active');},10);
  }

  // ── Drag-to-dismiss on drag handle ──
  _initDetailDragToDismiss();

  // ── Init terrain preview after display:flex gives the container real dimensions ──
  setTimeout(()=>initTerrainPreview(spot),80);

  closeSheet();
}

function switchDetailTab(tab){
  ['info','photos','discussion'].forEach(t=>{
    const panel=document.getElementById('detailPanel'+t.charAt(0).toUpperCase()+t.slice(1));
    const tabEl=document.getElementById('detailTab'+t.charAt(0).toUpperCase()+t.slice(1));
    if(panel)panel.style.display=t===tab?(t==='discussion'?'flex':'block'):'none';
    if(tabEl){
      tabEl.style.color=t===tab?'var(--txt0)':'var(--txt3)';
      tabEl.style.borderBottom=t===tab?'2px solid #B8E87A':'2px solid transparent';
      tabEl.style.fontWeight=t===tab?'700':'600';
    }
  });
}

function closeDetail(){
  const d=document.getElementById('screen-detail');
  const sheet=document.getElementById('detailSheet');
  if(!d)return;
  closeTerrainFullscreen();
  if(sheet){
    sheet.style.transition='transform 0.34s cubic-bezier(0.32,0.72,0,1)';
    sheet.style.transform='translateY(100%)';
  } else {
    d.style.transition='transform 0.34s cubic-bezier(0.32,0.72,0,1)';
    d.style.transform='translateY(100%)';
  }
  setTimeout(()=>{
    d.classList.remove('active');
    d.style.display='none';
    if(sheet){sheet.style.transition='';sheet.style.transform='translateY(100%)';}
    destroyTerrainPreview();
    // Clean up detail mini map
    if(_detailMiniMapInstance){try{_detailMiniMapInstance.remove();}catch(e){}  _detailMiniMapInstance=null;}
    // Clean up comment panel
    closeDetailCommentPanel();
    // Clear search
    const si=document.getElementById('detailSearchInput');if(si)si.value='';
    const sd=document.getElementById('detailSearchDrop');if(sd)sd.style.display='none';
  },360);
  removeDetailTrails();
  _detailSpotId=null;
}

function _renderDetailComments(spotId){
  const el=document.getElementById('detailCommentsList');
  if(!el)return;
  const comments=JSON.parse(localStorage.getItem(`wp_comments_spot_${spotId}`)||'[]');
  if(!comments.length){
    el.innerHTML=`<div style="padding:32px 0;text-align:center;color:var(--txt3);font-size:13px">No comments yet. Be the first to share!</div>`;
    return;
  }
  el.innerHTML=comments.map(c=>{
    const _sf=(n)=>Array.from({length:Math.min(5,n)},()=>'<svg viewBox="0 0 24 24" width="13" height="13" style="vertical-align:middle" fill="#F5A623" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>').join('');
    const stars=c.stars?_sf(c.stars):'';
    const initials=(c.username||'?').slice(0,2).toUpperCase();
    return`<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="width:34px;height:34px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#B8E87A;flex-shrink:0">${initials}</div>
      <div style="flex:1">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px">
          <div style="font-size:13px;font-weight:700;color:var(--txt0)">@${c.username||'Explorer'}</div>
          <div style="font-size:10px;color:var(--txt3)">${c.date||''}</div>
        </div>
        ${stars?`<div style="color:#F5A623;font-size:12px;margin-bottom:3px">${stars}</div>`:''}
        <div style="font-size:13px;color:var(--txt1);line-height:1.55">${c.text}</div>
      </div>
    </div>`;
  }).join('');
}

// submitDetailComment defined further down (handles star ratings)

function openPhotoFull(url){
  const ov=document.createElement('div');
  ov.style.cssText='position:absolute;inset:0;z-index:9999;background:rgba(0,0,0,.95);display:flex;align-items:center;justify-content:center';
  ov.onclick=()=>ov.remove();
  ov.innerHTML=`<img src="${url}" style="max-width:100%;max-height:100%;object-fit:contain"><div style="position:absolute;top:16px;right:16px;color:#fff;font-size:24px;cursor:pointer;background:rgba(0,0,0,.4);border-radius:50%;width:40px;height:40px;display:flex;align-items:center;justify-content:center">×</div>`;
  document.getElementById('app').appendChild(ov);
}

// ── Trails near spot (only while detail is open) ──────────────
async function loadDetailTrails(spot){
  if(!map)return;
  removeDetailTrails(); // clear any previous
  try{
    const r=0.018; // ~2km in degrees
    const bbox=`${spot.lat-r},${spot.lng-r},${spot.lat+r},${spot.lng+r}`;
    const q=`[out:json][timeout:15];way["highway"~"path|footway|track"](${bbox});out geom tags;`;
    const data=await _overpassFetchRetry(q,15000);
    const features=[];
    (data.elements||[]).forEach(el=>{
      if(el.type==='way'&&el.geometry?.length>1){
        features.push({type:'Feature',
          geometry:{type:'LineString',coordinates:el.geometry.map(p=>[p.lon,p.lat])},
          properties:{name:el.tags?.name||null}
        });
      }
    });
    if(!features.length)return;
    const srcId='detail-trails-src';
    const lineId='detail-trails-line';
    const labelId='detail-trails-labels';
    if(!document.getElementById('screen-detail')?.classList.contains('active'))return;
    map.addSource(srcId,{type:'geojson',data:{type:'FeatureCollection',features}});
    map.addLayer({id:lineId,type:'line',source:srcId,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#B8E87A','line-width':3,'line-opacity':.85}});
    _detailTrailSourceIds=[srcId];
    _detailTrailLayerIds=[lineId];
    // Labels for named trails
    const labelFeats=features.filter(f=>f.properties.name).map(f=>{
      const c=f.geometry.coordinates;
      const mid=c[Math.floor(c.length/2)];
      return{type:'Feature',geometry:{type:'Point',coordinates:mid},properties:{name:f.properties.name}};
    });
    if(labelFeats.length){
      const lbSrc=srcId+'-lbl';
      map.addSource(lbSrc,{type:'geojson',data:{type:'FeatureCollection',features:labelFeats}});
      map.addLayer({id:labelId,type:'symbol',source:lbSrc,layout:{'text-field':['get','name'],'text-size':10,'text-font':['Open Sans Regular','Arial Unicode MS Regular'],'text-allow-overlap':false},paint:{'text-color':'#B8E87A','text-halo-color':'rgba(0,0,0,.7)','text-halo-width':1.5}});
      _detailTrailSourceIds.push(lbSrc);
      _detailTrailLayerIds.push(labelId);
    }
  }catch(e){
    _showMapNotice('Trails unavailable — trail server busy, reopen spot to retry');
  }
}

function removeDetailTrails(){
  if(!map)return;
  _detailTrailLayerIds.forEach(id=>{try{map.removeLayer(id);}catch{}});
  _detailTrailSourceIds.forEach(id=>{try{map.removeSource(id);}catch{}});
  _detailTrailLayerIds=[];
  _detailTrailSourceIds=[];
}

// ═══════════════════════════════════════════════════
// TERRAIN DASHBOARD — 3D HERO PREVIEW
// ═══════════════════════════════════════════════════

function initTerrainPreview(spot){
  _terrainCurrentSpot=spot;
  destroyTerrainPreview(); // clear any previous map

  const shimmer=document.getElementById('terrainShimmer');
  const container=document.getElementById('terrainMiniMapContainer');
  const spotLabel=document.getElementById('terrainSpotLabel');
  const elevLabel=document.getElementById('terrainElevLabel');
  const expandBtn=document.getElementById('terrainExpandBtn');
  const hero=document.getElementById('detailTerrainHero');

  // Reset state
  if(shimmer)shimmer.style.display='block';
  if(spotLabel)spotLabel.style.display='none';
  if(elevLabel)elevLabel.style.display='none';
  if(expandBtn)expandBtn.style.display='none';
  if(container)container.innerHTML='';

  const token=mapboxgl.accessToken;
  if(!token||token==='MISSING'){_terrainFallback(spot);return;}

  try{
    _terrainMap=new mapboxgl.Map({
      container:'terrainMiniMapContainer',
      style:'mapbox://styles/mapbox/satellite-streets-v12',
      center:[spot.lng,spot.lat],
      zoom:13,
      pitch:65,
      bearing:0,
      interactive:true,
      attributionControl:true,
      logoPosition:'bottom-right'
    });

    _terrainMap.on('load',()=>{
      // Add Mapbox terrain DEM source
      _terrainMap.addSource('mapbox-dem',{
        type:'raster-dem',
        url:'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize:512,
        maxzoom:14
      });
      // Enable 3D terrain — dramatic exaggeration
      _terrainMap.setTerrain({source:'mapbox-dem',exaggeration:2.5});
      // Sky atmosphere
      try{
        if(!_terrainMap.getLayer('sky')){
          _terrainMap.addLayer({id:'sky',type:'sky',paint:{
            'sky-type':'atmosphere',
            'sky-atmosphere-color':'rgba(220,235,255,1)',
            'sky-atmosphere-halo-color':'rgba(180,210,255,0.7)',
            'sky-atmosphere-sun':[0.0,90.0],
            'sky-atmosphere-sun-intensity':15
          }});
        }
      }catch{}
      // Fade out shimmer
      if(shimmer){shimmer.style.transition='opacity .4s';shimmer.style.opacity='0';setTimeout(()=>{shimmer.style.display='none';shimmer.style.opacity='1';shimmer.style.transition='';},400);}
      // Show spot label + expand button
      if(spotLabel){spotLabel.textContent=spot.name;spotLabel.style.display='block';}
      if(expandBtn)expandBtn.style.display='block';
      // Fetch elevation badge
      _fetchTerrainElevation(spot.lat,spot.lng).then(elevFt=>{
        if(elevFt&&elevFt>0&&elevLabel){
          elevLabel.textContent='▲ '+Math.round(elevFt).toLocaleString()+' ft';
          elevLabel.style.display='block';
        }
      });
      // ── Auto-rotation RAF ──
      _terrainUserInteracting=false;
      function _rotateTerrain(){
        _terrainRotateRafId=requestAnimationFrame(_rotateTerrain);
        if(!_terrainMap||_terrainUserInteracting)return;
        const bearing=(_terrainMap.getBearing()+0.1)%360;
        _terrainMap.setBearing(bearing);
      }
      _terrainRotateRafId=requestAnimationFrame(_rotateTerrain);
      // Pause on touch/mouse, resume after 3s
      function _pauseRotation(){
        _terrainUserInteracting=true;
        clearTimeout(_terrainRotateResumeTimer);
        _terrainRotateResumeTimer=setTimeout(()=>{_terrainUserInteracting=false;},3000);
      }
      _terrainMap.on('touchstart',_pauseRotation);
      _terrainMap.on('mousedown',_pauseRotation);
    });

    _terrainMap.on('error',()=>{_terrainFallback(spot);});

  }catch(e){
    _terrainFallback(spot);
  }
}

function _terrainFallback(spot){
  const shimmer=document.getElementById('terrainShimmer');
  const container=document.getElementById('terrainMiniMapContainer');
  if(shimmer)shimmer.style.display='none';
  if(container){
    container.style.cssText=`position:absolute;inset:0;background:${spot.heroGradient||'linear-gradient(160deg,#0d1a0d,#1a3a1a)'};z-index:2`;
    container.innerHTML=`<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:.25">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#B8E87A" stroke-width="1.2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
    </div>`;
  }
}

function destroyTerrainPreview(){
  // Stop auto-rotation
  if(_terrainRotateRafId){cancelAnimationFrame(_terrainRotateRafId);_terrainRotateRafId=null;}
  clearTimeout(_terrainRotateResumeTimer);
  _terrainUserInteracting=false;
  if(_terrainMap){
    try{_terrainMap.remove();}catch{}
    _terrainMap=null;
  }
  const container=document.getElementById('terrainMiniMapContainer');
  if(container){container.innerHTML='';container.style.cssText='position:absolute;inset:0;z-index:2';}
}

function openTerrainFullscreen(){
  const spot=_terrainCurrentSpot;
  if(!spot)return;
  const ov=document.getElementById('terrainFullscreenOverlay');
  if(!ov)return;
  ov.style.display='flex';
  const nameEl=document.getElementById('terrainFsSpotName');
  if(nameEl)nameEl.textContent=spot.name+' — 3D Terrain';
  const fsContainer=document.getElementById('terrainFullscreenMapContainer');
  if(!fsContainer)return;
  fsContainer.innerHTML='';
  const token=mapboxgl.accessToken;
  if(!token||token==='MISSING'){
    fsContainer.style.background=spot.heroGradient||'#0d1a0d';
    return;
  }
  try{
    _terrainFsMap=new mapboxgl.Map({
      container:'terrainFullscreenMapContainer',
      style:'mapbox://styles/mapbox/satellite-streets-v12',
      center:[spot.lng,spot.lat],
      zoom:12,
      pitch:65,
      bearing:0,
      interactive:true,
      antialias:true,
      attributionControl:false,
      logoPosition:'bottom-left'
    });
    _terrainFsMap.on('load',()=>{
      _terrainFsMap.addSource('mapbox-dem-fs',{
        type:'raster-dem',
        url:'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize:512,
        maxzoom:14
      });
      _terrainFsMap.setTerrain({source:'mapbox-dem-fs',exaggeration:2.5});
      try{
        _terrainFsMap.addLayer({id:'sky-fs',type:'sky',paint:{
          'sky-type':'atmosphere',
          'sky-atmosphere-color':'rgba(220,235,255,1)',
          'sky-atmosphere-halo-color':'rgba(180,210,255,0.8)',
          'sky-atmosphere-sun':[0.0,90.0],
          'sky-atmosphere-sun-intensity':15
        }});
      }catch{}
      try{
        _terrainFsMap.setFog({
          color:'white',
          'high-color':'#245bde',
          'horizon-blend':0.04,
          'space-color':'#0b0b19',
          'star-intensity':0.15
        });
      }catch{}
    });
    _terrainFsMap.on('error',()=>{});
  }catch(e){}
}

function closeTerrainFullscreen(){
  const ov=document.getElementById('terrainFullscreenOverlay');
  if(ov)ov.style.display='none';
  if(_terrainFsMap){
    try{_terrainFsMap.remove();}catch{}
    _terrainFsMap=null;
  }
  const fsC=document.getElementById('terrainFullscreenMapContainer');
  if(fsC)fsC.innerHTML='';
}

async function _fetchTerrainElevation(lat,lng){
  // Use Mapbox terrain-rgb tile at zoom 12 to sample elevation at the spot's coordinates
  const z=12;
  const sinLat=Math.sin(lat*Math.PI/180);
  const x=Math.floor((lng+180)/360*Math.pow(2,z));
  const y=Math.floor((0.5-Math.log((1+sinLat)/(1-sinLat))/(4*Math.PI))*Math.pow(2,z));
  const token=mapboxgl.accessToken;
  if(!token||token==='MISSING')return null;
  const url=`https://api.mapbox.com/v4/mapbox.terrain-rgb/${z}/${x}/${y}.pngraw?access_token=${token}`;
  try{
    return await new Promise(resolve=>{
      const img=new Image();
      img.crossOrigin='anonymous';
      img.onload=()=>{
        try{
          const canvas=document.createElement('canvas');
          canvas.width=256;canvas.height=256;
          const ctx=canvas.getContext('2d');
          ctx.drawImage(img,0,0);
          // Sub-pixel position within tile
          const tx=(lng+180)/360*Math.pow(2,z)-x;
          const ty=(0.5-Math.log((1+sinLat)/(1-sinLat))/(4*Math.PI))*Math.pow(2,z)-y;
          const px=Math.min(255,Math.max(0,Math.floor(tx*256)));
          const py=Math.min(255,Math.max(0,Math.floor(ty*256)));
          const d=ctx.getImageData(px,py,1,1).data;
          // Mapbox terrain-rgb encoding: height = -10000 + ((R*65536 + G*256 + B) * 0.1)
          const elevM=-10000+((d[0]*65536+d[1]*256+d[2])*0.1);
          const elevFt=elevM*3.28084;
          resolve(elevFt>-100?elevFt:null);
        }catch{resolve(null);}
      };
      img.onerror=()=>resolve(null);
      img.src=url;
      // Timeout fallback
      setTimeout(()=>resolve(null),8000);
    });
  }catch{return null;}
}

// ═══════════════════════════════════════════════════
// RANGER DISTRICT CONTACT
// ═══════════════════════════════════════════════════

function _buildRangerContact(spot){
  const el=document.getElementById('detailRangerContact');
  if(!el)return;

  const rc=spot.rangerContact;
  if(!rc){
    // Private or unclear land — show access warning
    if(spot.legal==='illegal'||spot.legal==='gray'){
      el.innerHTML=`<div style="background:rgba(224,82,82,.07);border:1px solid rgba(224,82,82,.2);border-radius:12px;padding:12px 14px;font-size:11px;color:#e07b39;line-height:1.5">This spot may be on private land — verify legal access before visiting.</div>`;
    }else{
      el.innerHTML='';
    }
    return;
  }

  // Build contact rows
  const rows=[];
  if(rc.phone){
    const clean=rc.phone.replace(/[^0-9+]/g,'');
    rows.push({icon:'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--txt2)" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.1 19.79 19.79 0 0 1 1.61 4.5 2 2 0 0 1 3.6 2.32h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.06 6.06l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 17.2z"/></svg>',label:rc.phone,href:`tel:${clean}`,external:false});
  }
  if(rc.website){
    let domain='';
    try{domain=new URL(rc.website).hostname.replace(/^www\./,'');}catch{domain=rc.website;}
    rows.push({icon:'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--txt2)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',label:domain,href:rc.website,external:true});
  }
  if(rc.email){
    rows.push({icon:'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--txt2)" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',label:rc.email,href:`mailto:${rc.email}`,external:false});
  }else{
    // No email — show "Contact via website" as website link
    rows.push({icon:'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--txt2)" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',label:'Contact via website',href:rc.website||'#',external:true,muted:true});
  }

  el.innerHTML=`
    <div style="font-size:13px;font-weight:700;color:var(--txt0);margin-bottom:10px;display:flex;align-items:center;gap:8px">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#B8E87A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
      Ranger District Contact
    </div>
    <div style="background:var(--bg1);border:1px solid var(--border);border-left:3px solid #B8E87A;border-radius:12px;overflow:hidden">
      <div style="padding:12px 14px 10px">
        <div style="font-size:12px;font-weight:600;color:rgba(255,255,255,.85)">${rc.agency}</div>
        <div style="font-size:10px;color:var(--txt3);margin-top:3px;line-height:1.4">${rc.district}</div>
      </div>
      ${rows.map(r=>`
        <a href="${r.href}" ${r.external?'target="_blank" rel="noopener"':''} style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-top:1px solid var(--border);text-decoration:none;-webkit-tap-highlight-color:transparent" onclick="event.stopPropagation()">
          <span style="font-size:16px;flex-shrink:0;line-height:1">${r.icon}</span>
          <span style="flex:1;font-size:12px;color:${r.muted?'var(--txt3)':'var(--txt1)'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.label}</span>
          <span style="font-size:14px;color:var(--txt3);flex-shrink:0">›</span>
        </a>`).join('')}
    </div>
    <div style="font-size:9px;color:var(--txt3);margin-top:7px;line-height:1.5;padding:0 2px">Contacting the ranger district before visiting remote spots is recommended for current conditions and access information.</div>`;
}

// ═══════════════════════════════════════════════════
// CALTRANS / ROAD ALERT BANNER
// ═══════════════════════════════════════════════════
const _KNOWN_ALERTS=[
  {name:'Hwy 1 Big Sur',lat:36.15,lng:-121.68,radius:.3,msg:' Hwy 1 near Big Sur: seasonal closures possible — check Caltrans before driving'},
  {name:'I-80 Sierra',lat:39.3,lng:-120.4,radius:1.2,msg:'snow I-80 Chain Control Zone — R2 restrictions may apply above 5000 ft'},
  {name:'Hwy 89 Lassen',lat:40.6,lng:-121.5,radius:.8,msg:'Hwy 89 near Lassen: check seasonal closure status with park'},
  {name:'Hwy 49 Gold Country',lat:39.25,lng:-121.0,radius:.6,msg:'Hwy 49: road construction delays near Nevada City — expect 15-min wait'},
  {name:'Hwy 120 Yosemite',lat:37.9,lng:-119.6,radius:.9,msg:'Snow: Hwy 120 Tioga Pass: chain controls may be required — check Caltrans'},
];
function checkAlertBanner(spot){
  const banner=document.getElementById('alertBanner');
  const bannerText=document.getElementById('alertBannerText');
  if(!banner||!bannerText)return;
  // Find closest alert within radius
  let hit=null;
  for(const a of _KNOWN_ALERTS){
    const d=Math.hypot(spot.lat-a.lat,spot.lng-a.lng);
    if(d<=a.radius){hit=a;break;}
  }
  if(hit){
    bannerText.textContent=hit.msg;
    banner.style.display='flex';
    banner.style.alignItems='center';
    banner.style.justifyContent='space-between';
  } else {
    banner.style.display='none';
  }
}

// ═══════════════════════════════════════════════════
// OPEN-METEO LIVE WEATHER
// ═══════════════════════════════════════════════════
const WMO_ICON={0:'sun',1:'sun',2:'partly-cloudy',3:'cloudy',45:'fog',48:'fog',
  51:'drizzle',53:'drizzle',55:'drizzle',61:'rain',63:'rain',65:'rain',
  71:'snow',73:'snow',75:'snow',77:'snow',
  80:'showers',81:'showers',82:'storm',85:'snow',86:'snow',
  95:'storm',96:'storm',99:'storm'};
const WMO_LABEL={0:'Clear',1:'Sunny',2:'Partly cloudy',3:'Overcast',45:'Foggy',48:'Foggy',
  51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',61:'Light rain',63:'Rain',65:'Heavy rain',
  71:'Light snow',73:'Snow',75:'Heavy snow',77:'Snow grains',
  80:'Rain showers',81:'Heavy showers',82:'Violent showers',85:'Snow showers',86:'Heavy snow showers',
  95:'Thunderstorm',96:'Thunderstorm',99:'Thunderstorm'};
const DAYS_SHORT=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

async function fetchLiveWeather(spot){
  const wEl=document.getElementById('weatherWidget');
  if(!wEl)return;
  // Show loading shimmer
  wEl.innerHTML=`<div style="font-size:11px;color:var(--txt2);font-weight:700;letter-spacing:.8px;text-transform:uppercase;margin-bottom:10px">5-Day Forecast at Trailhead</div>
    <div style="display:flex;gap:8px">${[0,1,2,3,4].map(()=>`<div style="flex:1;background:rgba(255,255,255,.05);border-radius:8px;height:72px;animation:pulse 1.2s ease-in-out infinite"></div>`).join('')}</div>`;
  try{
    const url=`https://api.open-meteo.com/v1/forecast?latitude=${spot.lat}&longitude=${spot.lng}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&temperature_unit=fahrenheit&timezone=auto&forecast_days=5`;
    const res=await fetch(url,{signal:AbortSignal.timeout(6000)});
    if(!res.ok)throw new Error('HTTP '+res.status);
    const data=await res.json();
    const d=data.daily;
    const days=d.time.map((t,i)=>{
      const dt=new Date(t+'T12:00:00');
      const code=d.weathercode[i];
      return{
        day:DAYS_SHORT[dt.getDay()],
        icon:WMO_ICON[code]||'',
        label:WMO_LABEL[code]||'',
        high:Math.round(d.temperature_2m_max[i]),
        low:Math.round(d.temperature_2m_min[i]),
        precip:Math.round((d.precipitation_sum[i]||0)*100)/100
      };
    });
    if(!document.getElementById('weatherWidget'))return; // detail may have closed
    const nwsLat2=spot.lat.toFixed(2),nwsLng2=spot.lng.toFixed(2);
    const nwsUrl2=`https://forecast.weather.gov/MapClick.php?CityName=&state=CA&site=&textField1=${nwsLat2}&textField2=${nwsLng2}`;
    document.getElementById('weatherWidget').innerHTML=`
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
        <div style="font-size:11px;color:var(--txt2);font-weight:700;letter-spacing:.8px;text-transform:uppercase">Live 5-Day Forecast</div>
        <a href="${nwsUrl2}" target="_blank" rel="noopener" style="font-size:10px;color:var(--txt3);text-decoration:none">Source: NWS ↗</a>
      </div>
      <div class="weather-days">${days.map(d=>`
        <div class="weather-day">
          <div class="weather-dayname">${d.day}</div>
          <div class="weather-icon" title="${d.label}" style="font-size:9px;color:var(--txt2);letter-spacing:.2px;text-transform:uppercase">${d.icon}</div>
          <div class="weather-temp">${d.high}°</div>
          <div class="weather-low">${d.low}°</div>
          ${d.precip>0?`<div style="font-size:9px;color:#7ab8f5;margin-top:1px">${d.precip}"</div>`:''}
        </div>`).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <a href="${nwsUrl2}" target="_blank" rel="noopener" style="font-size:11px;color:var(--accent);text-decoration:none;background:rgba(184,232,122,.1);border:1px solid rgba(184,232,122,.2);border-radius:8px;padding:4px 10px">NWS ↗</a>
        <a href="https://inciweb.nwcg.gov" target="_blank" rel="noopener" style="font-size:11px;color:var(--orange);text-decoration:none;background:rgba(212,135,74,.1);border:1px solid rgba(212,135,74,.2);border-radius:8px;padding:4px 10px">Fire Danger ↗</a>
        <a href="https://quickmap.dot.ca.gov" target="_blank" rel="noopener" style="font-size:11px;color:var(--blue);text-decoration:none;background:rgba(106,155,196,.1);border:1px solid rgba(106,155,196,.2);border-radius:8px;padding:4px 10px">Road Conditions ↗</a>
        <a href="https://www.airnow.gov/?city=&state=CA&country=USA" target="_blank" rel="noopener" style="font-size:11px;color:var(--txt2);text-decoration:none;background:rgba(255,255,255,.05);border:1px solid var(--border2);border-radius:8px;padding:4px 10px">Air Quality ↗</a>
      </div>`;
  }catch(e){
    const w=document.getElementById('weatherWidget');
    if(w)w.innerHTML=`<div style="font-size:11px;color:var(--txt2);font-weight:700;letter-spacing:.8px;text-transform:uppercase;margin-bottom:10px">5-Day Forecast at Trailhead</div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:18px;background:rgba(255,255,255,.03);border-radius:10px">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--txt3)" stroke-width="1.6"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>
        <div style="font-size:12px;color:var(--txt2)">Weather unavailable</div>
        <div onclick="var _ws=[...spots,...userSpots].find(s=>s.id===_detailSpotId);if(_ws)fetchLiveWeather(_ws)" style="font-size:11px;color:var(--accent);font-weight:700;cursor:pointer">Tap to retry</div>
      </div>`;
  }
}

// ═══════════════════════════════════════════════════
// USGS STREAM GAUGE
// ═══════════════════════════════════════════════════
async function fetchUSGSGauge(spot){
  const el=document.getElementById('usgsWidget');
  if(!el)return;
  try{
    // Find nearest USGS gauge within ~0.5 degree using WaterML REST API
    const bbox=`${spot.lng-.5},${spot.lat-.5},${spot.lng+.5},${spot.lat+.5}`;
    const url=`https://waterservices.usgs.gov/nwis/iv/?format=json&bBox=${bbox}&parameterCd=00060,00065&siteStatus=active`;
    const res=await fetch(url,{signal:AbortSignal.timeout(8000)});
    if(!res.ok)throw new Error('HTTP '+res.status);
    const data=await res.json();
    const sites=(data.value?.timeSeries||[]).slice(0,3);
    if(!sites.length){el.innerHTML=`<div style="font-size:12px;color:var(--txt2)">No USGS gauge within 30 mi</div>`;return;}
    el.innerHTML=sites.map(s=>{
      const name=s.sourceInfo?.siteName||'Unnamed gauge';
      const val=s.values?.[0]?.value?.[0]?.value??'--';
      const unit=s.variable?.unit?.unitCode||'';
      const param=s.variable?.variableName||'';
      const isFlow=param.toLowerCase().includes('discharge');
      const isCfs=parseFloat(val);
      const level=isFlow?(isCfs<100?'Low':isCfs<500?'Normal':isCfs<2000?'High':'Flood'):'';
      return`<div style="padding:8px 0;border-bottom:1px solid var(--border);last-child:border:none">
        <div style="font-size:11px;color:var(--txt2);margin-bottom:2px">${name.length>40?name.slice(0,40)+'…':name}</div>
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <span style="font-size:16px;font-weight:800;color:var(--blue)">${parseFloat(val).toFixed(1)} <span style="font-size:11px;font-weight:400;color:var(--txt2)">${unit}</span></span>
          ${level?`<span style="font-size:11px;font-weight:700">${level}</span>`:''}
        </div>
      </div>`;
    }).join('')+`<div style="font-size:10px;color:var(--txt3);margin-top:6px">Source: USGS National Water Information System · Real-time</div>`;
  }catch(e){
    if(el)el.innerHTML=`<div style="font-size:12px;color:var(--txt2)">Water data unavailable offline</div>`;
  }
}

function drawElevProfile(spot){
  const canvas=document.getElementById('elevCanvas');
  if(!canvas)return;
  const ctx=canvas.getContext('2d');
  const W=canvas.width=canvas.offsetWidth||300;
  const H=canvas.height=56;
  const gain=parseInt((spot.elevation||'+0').replace(/[^0-9]/g,''))||100;
  const pts=[];
  // Generate a smooth elevation curve
  for(let i=0;i<=20;i++){
    const t=i/20;
    // Hill profile: up then down, or just ascending
    let y;
    if(spot.type==='hiking'||spot.type==='biking'){
      y=Math.sin(t*Math.PI)*0.7+t*0.3;
    }else if(spot.type==='caves'||spot.type==='lava_tube'){
      y=1-Math.pow(t-0.5,2)*2;
    }else{
      y=t*0.6+Math.sin(t*Math.PI*2)*0.2;
    }
    pts.push({x:t*W,y:H-(y*(H-8)+4)});
  }
  ctx.clearRect(0,0,W,H);
  // Fill gradient
  const grad=ctx.createLinearGradient(0,0,0,H);
  grad.addColorStop(0,'rgba(196,149,106,.4)');
  grad.addColorStop(1,'rgba(196,149,106,.0)');
  ctx.beginPath();ctx.moveTo(0,H);
  pts.forEach(p=>ctx.lineTo(p.x,p.y));
  ctx.lineTo(W,H);ctx.closePath();
  ctx.fillStyle=grad;ctx.fill();
  // Line
  ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);
  pts.forEach(p=>ctx.lineTo(p.x,p.y));
  ctx.strokeStyle='#6fcf97';ctx.lineWidth=2;ctx.stroke();
}

// ═══════════════════════════════════════════════════
// SHARE TRIP PLAN + I'M BACK SAFE
// ═══════════════════════════════════════════════════

// ═══════════════════════════════════════════════════
// COMMUNITY — CONDITIONS DASHBOARD, TRIP REPORTS, Q&A
// ═══════════════════════════════════════════════════
let _communitySpotId=null;

// ── Conditions Dashboard ──────────────────────────
function buildConditionsDash(spotId){
  const el=document.getElementById('conditionsDash');
  if(!el)return;
  const reports=getCommunityData('wp_tripreports',spotId);
  const latest=reports[0]; // most recent
  // Fallback demo data when no user reports exist
  const water=latest?.water||'Normal';
  const trail=latest?.trail||'Great';
  const road=latest?.road||'Open — Good';
  const gate=latest?.gate||'Open';
  const lastDate=latest?latest.date:'Community reported';
  const verifications=JSON.parse(localStorage.getItem(`wp_verify_${spotId}`)||'[]');
  const lastVerified=verifications[0]||null;
  const colorMap={Normal:'good','Great':'good','Open':'good','Open — Good':'good','Open — Good':'good',Low:'warn','Poor':'warn','4WD Only':'warn',High:'warn',Flood:'bad',Closed:'bad',Locked:'bad'};
  const getC=v=>colorMap[v]||'';
  el.innerHTML=`
    <div class="verify-row">
      <div>
        <div style="font-size:12px;font-weight:700">Spot Verified</div>
        <div style="font-size:11px;color:var(--txt2);margin-top:2px">${lastVerified?`Last confirmed ${lastVerified.date} by ${lastVerified.user}`:'Be the first to verify this spot'}</div>
      </div>
      <button class="verify-btn" onclick="verifySpot(${spotId})">Confirm</button>
    </div>
    <div class="conditions-grid">
      <div class="cond-cell"><div class="cond-label">Water Level</div><div class="cond-val ${getC(water)}">${water}</div></div>
      <div class="cond-cell"><div class="cond-label">Trail</div><div class="cond-val ${getC(trail)}">${trail}</div></div>
      <div class="cond-cell"><div class="cond-label">Access Road</div><div class="cond-val ${getC(road)}">${road}</div></div>
      <div class="cond-cell"><div class="cond-label">Gate</div><div class="cond-val ${getC(gate)}">${gate}</div></div>
    </div>
    ${latest?`<div style="font-size:10px;color:var(--txt3);margin-bottom:16px;margin-top:-4px">Updated ${lastDate} · Community sourced</div>`:'<div style="font-size:10px;color:var(--txt3);margin-bottom:16px;margin-top:-4px">No recent reports — be the first!</div>'}`;
}

function verifySpot(spotId){
  const key=`wp_verify_${spotId}`;
  const existing=JSON.parse(localStorage.getItem(key)||'[]');
  existing.unshift({user:'You',date:'Today',ts:Date.now()});
  localStorage.setItem(key,JSON.stringify(existing.slice(0,10)));
  buildConditionsDash(spotId);
  showToast('Spot verified — thanks!');
}

// ── Community Map Spots (per-community spot storage) ──
let _addSpotCommunityId=null; // set when add-spot sheet opened from inside a community
function getCommunitySpots(cid){return JSON.parse(localStorage.getItem('wp_community_spots_'+cid)||'[]');}
function setCommunitySpots(cid,arr){localStorage.setItem('wp_community_spots_'+cid,JSON.stringify(arr));}
function getAllCommunitySpots(){
  const comms=getCommunities();
  const myUid=String(_myUid&&_myUid()||'guest');
  const myComms=comms.filter(c=>getMembers(c.id).includes(myUid)||c.adminId===myUid);
  const all=[];const seen=new Set();
  myComms.forEach(c=>{getCommunitySpots(c.id).forEach(s=>{if(!seen.has(s.id)){seen.add(s.id);all.push(s);}});});
  return all;
}

// ── Trip Reports ──────────────────────────────────
function getCommunityData(key,spotId){
  const all=JSON.parse(localStorage.getItem(key)||'{}');
  return (all[spotId]||[]).sort((a,b)=>b.ts-a.ts);
}
function saveCommunityData(key,spotId,item){
  const all=JSON.parse(localStorage.getItem(key)||'{}');
  if(!all[spotId])all[spotId]=[];
  all[spotId].unshift(item);
  if(all[spotId].length>20)all[spotId]=all[spotId].slice(0,20);
  localStorage.setItem(key,JSON.stringify(all));
}

function buildTripReports(spotId){
  const el=document.getElementById('tripReportsList');
  if(!el)return;
  const reports=getCommunityData('wp_tripreports',spotId);
  // Mix in some seeded data for first-time view
  const seeded=[
    {user:'RiverRunner_Jen',date:'May 20, 2026',ts:Date.now()-86400000,water:'Normal',trail:'Great',road:'Open — Good',gate:'Open',notes:'Perfect conditions! Water level is ideal — knee-deep at the main pool. Parking was full by 10am.'},
    {user:'WeekendExplorer',date:'May 14, 2026',ts:Date.now()-604800000,water:'High',trail:'Good',road:'Open — Rough',gate:'Open',notes:'A bit high from recent rain but still fun. The upper falls were running strong.'}
  ];
  const all=[...reports,...(reports.length<2?seeded:[])].slice(0,5);
  if(!all.length){el.innerHTML=`<div style="font-size:13px;color:var(--txt2);padding:12px 0">No trip reports yet. Be the first!</div>`;return;}
  el.innerHTML=all.map(r=>{
    const tags=[r.water&&r.water!=='Not applicable'?{t:r.water}:null,r.trail?{t:r.trail}:null,r.road&&r.road!=='Open — Good'?{t:r.road,warn:true}:null].filter(Boolean);
    return`<div class="trip-report-card">
      <div class="tr-header"><span class="tr-user">${r.user}</span><span class="tr-date">${r.date}</span></div>
      <div class="tr-tags">${tags.map(t=>`<span class="tr-tag ${t.warn?'warn':t.t==='Flood'||t.t==='Closed'?'bad':''}">${t.t}</span>`).join('')}</div>
      ${r.notes?`<div class="tr-notes">${r.notes}</div>`:''}
    </div>`;
  }).join('');
}

function openTripReport(){
  document.getElementById('trNotes').value='';
  document.getElementById('tripReportOverlay').classList.add('open');
}
function closeTripReport(){document.getElementById('tripReportOverlay').classList.remove('open');}
function saveTripReport(){
  const water=document.getElementById('trWater').value;
  const trail=document.getElementById('trTrail').value;
  const road=document.getElementById('trRoad').value;
  const gate=document.getElementById('trGate').value;
  const notes=document.getElementById('trNotes').value.trim();
  if(!notes){showToast('Add a note about conditions');return;}
  const now=new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  saveCommunityData('wp_tripreports',_communitySpotId,{user:'You',date:now,ts:Date.now(),water,trail,road,gate,notes});
  closeTripReport();
  buildTripReports(_communitySpotId);
  buildConditionsDash(_communitySpotId);
  showToast('Trip report posted — thanks!');
}

// ── Q&A ───────────────────────────────────────────
function buildQA(spotId){
  const el=document.getElementById('qaList');
  if(!el)return;
  const questions=getCommunityData('wp_qa',spotId);
  const seeded=[
    {user:'NewHiker_2026',date:'May 18, 2026',ts:Date.now()-172800000,question:'Is there a restroom at the trailhead?',answers:[{user:'LocalGuide_Mike',date:'May 19, 2026',text:'There\'s a vault toilet at the main parking area. Not always stocked with TP — bring your own.'}]},
    {user:'FamilyTrip_CA',date:'May 10, 2026',ts:Date.now()-1209600000,question:'Can kids under 8 handle this trail?',answers:[{user:'DadOfThree_Explorer',date:'May 11, 2026',text:'Yes! My 6-year-old made it just fine. The trail is flat most of the way. Bring snacks and start early.'}]}
  ];
  const all=[...questions,...(questions.length<2?seeded:[])].slice(0,6);
  if(!all.length){el.innerHTML=`<div style="font-size:13px;color:var(--txt2);padding:12px 0">No questions yet. Ask something!</div>`;return;}
  el.innerHTML=all.map(q=>`
    <div class="qa-card">
      <div style="font-size:11px;color:var(--txt3);margin-bottom:4px">${q.user} · ${q.date}</div>
      <div class="qa-q">Q: ${q.question}</div>
      ${(q.answers||[]).map(a=>`<div class="qa-a"><strong>${a.user}:</strong> ${a.text}</div>`).join('')}
      ${(!q.answers||!q.answers.length)?`<button class="qa-answer-btn" onclick="openAnswerModal('${(q.ts||0)}')">Answer this ›</button>`:''}
    </div>`).join('');
}

function openAskQuestion(){
  document.getElementById('qaQuestion').value='';
  document.getElementById('qaOverlay').classList.add('open');
}
function closeQA(){document.getElementById('qaOverlay').classList.remove('open');}
function saveQuestion(){
  const q=document.getElementById('qaQuestion').value.trim();
  if(!q){showToast('Type a question first');return;}
  const now=new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  saveCommunityData('wp_qa',_communitySpotId,{user:'You',date:now,ts:Date.now(),question:q,answers:[]});
  closeQA();
  buildQA(_communitySpotId);
  showToast('Question posted');
}
function openAnswerModal(ts){showToast('Answer feature coming soon!');}

// ─── Fire & Flood Safety Indicators ──────────────
async function fetchFireDanger(spot){
  // Use NIFC / InciWeb lookup — approximate by lat/lng bounding box
  // For demo: show danger level based on spot type and season
  const mo=new Date().getMonth();
  const summerFire=(mo>=5&&mo<=9);
  const nearFire=['hiking','biking','scenic'].includes(spot.type);
  const riskLevel=summerFire&&nearFire?'Moderate':summerFire?'Low':'Very Low';
  const riskColor=riskLevel==='High'||riskLevel==='Very High'?'var(--red)':riskLevel==='Moderate'?'var(--yellow)':'var(--green-hi)';
  const wEl=document.getElementById('detailExtra');
  if(!wEl)return;
  // Append fire danger row after extra sections
  const fireDiv=document.createElement('div');
  fireDiv.id='fireDangerRow';
  fireDiv.innerHTML=`<div style="display:flex;align-items:center;justify-content:space-between;background:rgba(224,82,82,.06);border:1px solid rgba(224,82,82,.18);border-radius:10px;padding:10px 14px;margin-bottom:16px">
    <div><div style="font-size:12px;font-weight:800">Fire Danger</div><div style="font-size:11px;color:var(--txt2);margin-top:2px">National Forest zone estimate</div></div>
    <div style="font-size:14px;font-weight:800;color:${riskColor}">${riskLevel}</div>
  </div>`;
  // Only insert if not already there
  if(!document.getElementById('fireDangerRow'))wEl.appendChild(fireDiv);
}

// ═══════════════════════════════════════════════════
// DEVICE LOCATION
// ═══════════════════════════════════════════════════
let _userLat=null, _userLng=null, _userDotMarker=null;

function initGeolocation(){
  if(!navigator.geolocation)return;
  navigator.geolocation.getCurrentPosition(
    pos=>{
      _userLat=pos.coords.latitude;
      _userLng=pos.coords.longitude;
      _placeUserDot(_userLat,_userLng);
      _refreshAllDistances();
      leafletMap.flyTo([_userLat,_userLng],12,{animate:true,duration:1.6});
    },
    err=>{
      // Silently fall back — user denied or unavailable
      console.log('Geolocation denied/unavailable');
    },
    {enableHighAccuracy:true,timeout:12000,maximumAge:60000}
  );
  // Continuous watch for dot updates
  navigator.geolocation.watchPosition(
    pos=>{
      _userLat=pos.coords.latitude;
      _userLng=pos.coords.longitude;
      window._lastUserLat=_userLat; window._lastUserLng=_userLng;
      _placeUserDot(_userLat,_userLng);
    },
    ()=>{},
    {enableHighAccuracy:true,maximumAge:10000,timeout:15000}
  );
}

function _placeUserDot(lat,lng){
  if(!map)return;
  if(_userDotMarker){_userDotMarker.remove();_userDotMarker=null;}
  const el=document.createElement('div');
  el.className='user-dot-wrap';
  el.innerHTML='<div class="user-dot-cone" id="userDotCone"></div><div class="user-dot-ring"></div><div class="user-dot-inner"></div>';
  _userDotMarker=new mapboxgl.Marker({element:el,anchor:'center'})
    .setLngLat([lng,lat])
    .addTo(map);
  // Update Find Me button to show active state
  const btn=document.getElementById('findMeBtn');
  if(btn){btn.style.background='var(--blue)';btn.style.boxShadow='0 4px 20px rgba(74,143,223,.6)';}
  const locBtn=document.getElementById('locateMeBtn');
  if(locBtn)locBtn.style.background='rgba(91,155,212,.35)';
  // Re-apply cone visibility/heading if orientation is already bound
  if(_headingBound&&_lastHeading!=null)_updateUserDotCone(_lastHeading);
}

// ═══════════════════════════════════════════════════
// FACING DIRECTION CONE (Section 7) — DeviceOrientationEvent
// drives a translucent cone on the blue dot, like Apple Maps.
// ═══════════════════════════════════════════════════
let _headingBound=false, _lastHeading=null, _headingPermissionDenied=false;
function _updateUserDotCone(heading){
  _lastHeading=heading;
  const cone=document.getElementById('userDotCone');
  if(!cone)return;
  cone.style.display='block';
  cone.style.transform=`translate(-50%,-100%) rotate(${heading}deg)`;
}
function _onDeviceHeading(e){
  let heading=null;
  if(e.webkitCompassHeading!=null)heading=e.webkitCompassHeading; // iOS: true heading, 0=N clockwise
  else if(e.alpha!=null)heading=(360-e.alpha)%360; // Android: alpha is counterclockwise from N
  if(heading==null)return;
  _updateUserDotCone(heading);
}
function _bindDeviceHeading(){
  if(_headingBound)return;
  _headingBound=true;
  window.addEventListener('deviceorientationabsolute',_onDeviceHeading,true);
  window.addEventListener('deviceorientation',_onDeviceHeading,true);
}
function _requestHeadingPermission(){
  if(_headingPermissionDenied)return;
  if(typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function'){
    // iOS 13+: must be called from within a direct user-gesture handler (the locate-me tap)
    DeviceOrientationEvent.requestPermission().then(state=>{
      if(state==='granted')_bindDeviceHeading();
      else _headingPermissionDenied=true; // dot-only, no cone, per spec
    }).catch(()=>{_headingPermissionDenied=true;});
  } else {
    // Android / non-iOS: no permission prompt needed
    _bindDeviceHeading();
  }
}

function _refreshAllDistances(){
  if(_userLat==null||_userLng==null)return;
  const allS=[...spots,...userSpots];
  allS.forEach(s=>{
    const d=_haversineDistMi(_userLat,_userLng,s.lat,s.lng);
    s._realDistMi=d;
    s._realDistStr=d<1?`${Math.round(d*5280)} ft away`:d<10?`${d.toFixed(1)} mi away`:`${Math.round(d)} mi away`;
  });
}

function findMe(){
  const btn=document.getElementById('findMeBtn');
  // Must be requested directly inside this tap handler — iOS requires a user gesture
  _requestHeadingPermission();
  if(_userLat!=null&&_userLng!=null){
    leafletMap.flyTo([_userLat,_userLng],14,{animate:true,duration:1.2});
    showToast('Centered on your location');
    return;
  }
  if(!navigator.geolocation){showToast('Location not supported');return;}
  if(btn){btn.style.background='rgba(74,143,223,.7)';}
  showToast('Finding your location…');
  navigator.geolocation.getCurrentPosition(
    pos=>{
      _userLat=pos.coords.latitude; _userLng=pos.coords.longitude;
      window._lastUserLat=_userLat; window._lastUserLng=_userLng;
      _placeUserDot(_userLat,_userLng);
      _refreshAllDistances();
      leafletMap.flyTo([_userLat,_userLng],14,{animate:true,duration:1.2});
      showToast('Location found');
    },
    ()=>{
      if(btn){btn.style.background='';}
      showToast('Location unavailable');
    },
    {enableHighAccuracy:true,timeout:10000}
  );
}

// ═══════════════════════════════════════════════════
// SIDE PANEL (MAP CONTROLS)
// ═══════════════════════════════════════════════════
let _sidePanelOpen=false;

function toggleSidePanel(){
  _sidePanelOpen=!_sidePanelOpen;
  const sp=document.getElementById('sidePanel');
  sp.classList.toggle('open',_sidePanelOpen);
  // Reset scroll so map style tiles are always visible at top when opened
  if(_sidePanelOpen) sp.scrollTop=0;
  document.getElementById('sidePanelOverlay').classList.toggle('open',_sidePanelOpen);
}

function updateStyleTiles(style){
  document.querySelectorAll('.map-style-tile').forEach(t=>{
    t.classList.toggle('active',t.id==='tile-'+style);
  });
  // Also sync old style chips if still present
  document.querySelectorAll('.style-chip').forEach(c=>{
    c.classList.toggle('active',c.id==='style-'+style);
  });
}

function buildSidePanel(){
  // ── Spot type filters ──
  const FILTER_TYPES=[
    {id:'',label:'All',emoji:''},
    {id:'water',label:'Water',emoji:''},
    {id:'hiking',label:'Hiking',emoji:''},
    {id:'caves',label:'Caves',emoji:''},
    {id:'lava_tube',label:'Lava Tubes',emoji:''},
    {id:'biking',label:'Biking',emoji:''},
    {id:'scenic',label:'Scenic',emoji:''},
    {id:'urban',label:'Urban',emoji:''},
    {id:'swimming',label:'Swimming',emoji:''},
    {id:'river',label:'Rivers',emoji:''},
    {id:'waterfall',label:'Waterfalls',emoji:''},
    {id:'natural_slide',label:'Slides',emoji:''},
  ];
  const filterEl=document.getElementById('sidePanelFilters');
  if(filterEl){
    filterEl.innerHTML=FILTER_TYPES.map(f=>`
      <div class="filter-chip-panel${f.id===''?' active':''}" data-filter="${f.id}"
           onclick="setSidePanelFilter('${f.id}',this)">
        ${f.label}
      </div>`).join('');
  }

  // Layer toggles are hardcoded in HTML (#sidePanelLandLayers) — no duplicate injection needed
}

function setSidePanelFilter(filterId, el){
  // Update chip visuals
  document.querySelectorAll('#sidePanelFilters .filter-chip-panel').forEach(c=>{
    c.classList.remove('active');
  });
  el.classList.add('active');
  // Apply filter — map to spot types
  const waterTypes=['swimming','river','waterfall','natural_slide'];
  if(filterId===''){
    activeFilters.clear();
  } else if(filterId==='water'){
    activeFilters=new Set(waterTypes);
  } else {
    activeFilters=new Set([filterId]);
  }
  // Re-filter markers on map via GeoJSON rebuild
  refreshSpotMarkers();
  showToast(filterId?`Showing ${el.textContent.trim()} spots`:'Showing all spots');
}

function toggleSidePanelLayer(layerId, toggleEl){
  // Handle county boundaries
  if(layerId==='counties'){
    toggleCountyLayer(toggleEl);
    return;
  }
  // Handle private land boundaries
  if(layerId==='privateland'){
    togglePrivateLandLayer(toggleEl);
    return;
  }

  // Toggle on/off classes (supports both plain 'on' and 'on'/'off' toggle elements)
  const isNowOn=!toggleEl.classList.contains('on');
  toggleEl.classList.toggle('on',isNowOn);
  toggleEl.classList.toggle('off',!isNowOn);

  // Map side-panel IDs → land type keys used by showLandType/hideLandType
  const glTypeMap={
    blm:'blm',
    natforest:'nationalForest',
    stateparks:'stateParks',
    land:'private',
    property:'private',
    privateland:'private'
  };
  if(glTypeMap[layerId]){
    const t=glTypeMap[layerId];
    const label={blm:'BLM Land',nationalForest:'National Forest',stateParks:'State Parks',private:'Private Land'}[t]||t;
    if(isNowOn){
      showLandType(t);
      showToast('Showing '+label);
    } else {
      hideLandType(t);
      showToast('Hiding '+label);
    }
    return;
  }

  // Try to trigger existing feature layer toggle if it exists
  if(typeof FEATURE_LAYERS!=='undefined'){
    const match=FEATURE_LAYERS.find(f=>f.id===layerId);
    if(match){
      toggleFeatureLayer(layerId);
      return;
    }
  }

  // Special handling for hidden gems only
  if(layerId==='hiddenonly'){
    hiddenGemFilterActive=isNowOn;
    refreshSpotMarkers();
    showToast(isNowOn?'Showing hidden gems only':'Showing all spots');
  }
}

// ═══════════════════════════════════════════════════
// PHOTO CAROUSEL (Detail Page)
// ═══════════════════════════════════════════════════
async function fetchSpotPhotos(spot){
  // ONLY show user-uploaded community photos — no Wikipedia, Unsplash, or any online photos
  const gridEl=document.getElementById('detailPhotosGrid');
  if(!gridEl)return;
  const communityPhotos=JSON.parse(localStorage.getItem(`wp_photos_${spot.id}`)||'[]');
  if(!communityPhotos.length){
    gridEl.innerHTML=`
      <div style="text-align:center;padding:48px 20px">
        <div style="width:80px;height:80px;border-radius:16px;background:${spot.heroGradient||'var(--bg3)'};margin:0 auto 16px;display:flex;align-items:center;justify-content:center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="1.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        </div>
        <div style="font-size:14px;font-weight:600;color:var(--txt1);margin-bottom:6px">No photos yet</div>
        <div style="font-size:13px;color:var(--txt3);margin-bottom:16px">Be the first to share a photo of this spot</div>
        <button type="button" onclick="openPhotoPicker()" style="background:rgba(184,232,122,.15);border:1px solid rgba(184,232,122,.3);color:#B8E87A;border-radius:12px;padding:10px 20px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Add Your Photo</button>
      </div>`;
    return;
  }
  gridEl.innerHTML=`<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:2px">${
    communityPhotos.map((p,i)=>`<div style="aspect-ratio:1;overflow:hidden;border-radius:4px;cursor:pointer;position:relative" onclick="openPhotoFull('${p.url}')">
      <img src="${p.url}" style="width:100%;height:100%;object-fit:cover" loading="lazy">
      ${isAdmin()?`<button onclick="event.stopPropagation();_removePhoto(${i},${spot.id})" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,.6);border:none;color:#fff;border-radius:50%;width:22px;height:22px;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center">×</button>`:''}
    </div>`).join('')
  }</div>
  <div style="padding:12px;text-align:center">
    <button type="button" onclick="openPhotoPicker()" style="background:rgba(184,232,122,.10);border:1px solid rgba(184,232,122,.25);color:#B8E87A;border-radius:12px;padding:8px 18px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">+ Add Photo</button>
  </div>`;
}

function _buildCarousel(carousel,counter,dotsEl,heroIcon,photos,spot){
  if(!photos.length){
    counter.style.display='none';
    dotsEl.innerHTML='';
    heroIcon.style.opacity='0.55';
    return;
  }

  const total=photos.length;
  counter.textContent=`1 / ${total}`;
  counter.style.display=total>1?'block':'none';

  // Build slides
  carousel.innerHTML=photos.map((p,i)=>{
    if(p.type==='gradient'){
      return `<div class="photo-slide loaded" style="background:${spot.heroGradient}" data-idx="${i}" data-photo-type="gradient">
        
      </div>`;
    }
    return `<div class="photo-slide" data-idx="${i}" data-photo-type="${p.type}" style="position:relative">
      <img src="${p.url}" alt="${spot.name}" loading="lazy"
           onload="this.parentNode.classList.add('loaded');this.parentNode.querySelector('.slide-placeholder')&&(this.parentNode.querySelector('.slide-placeholder').style.display='none')"
           onerror="this.style.display='none';this.parentNode.classList.add('loaded')"
           style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none">
      <div class="slide-placeholder" style="position:absolute;inset:0;background:${spot.heroGradient}"></div>
      ${p.credit?`<div style="position:absolute;bottom:6px;right:8px;font-size:9px;color:rgba(255,255,255,.5);background:rgba(0,0,0,.35);border-radius:6px;padding:2px 6px;backdrop-filter:blur(4px)">${p.credit}</div>`:''}
      ${p.type==='community'?`<div class="photo-remove-hint${isAdmin()?' show':''}"><button class="photo-remove-btn" onclick="_removeCarouselPhoto(${i},${spot.id})">${isAdmin()?'Delete':'Remove Photo'}</button></div>`:''}
    </div>`;
  }).join('');

  heroIcon.style.opacity='0';

  // Dot indicators
  dotsEl.innerHTML=photos.map((_,i)=>
    `<div class="photo-dot${i===0?' active':''}" onclick="scrollCarouselTo(${i})"></div>`
  ).join('');

  // Scroll listener
  carousel.addEventListener('scroll',()=>{
    const idx=Math.round(carousel.scrollLeft/carousel.offsetWidth);
    counter.textContent=`${idx+1} / ${total}`;
    dotsEl.querySelectorAll('.photo-dot').forEach((d,i)=>d.classList.toggle('active',i===idx));
  },{passive:true});

  // Long-press to reveal remove overlay on community photos
  _attachCarouselLongPress(carousel,photos,spot);
}

function _attachCarouselLongPress(carousel,photos,spot){
  let _lpTimer=null;
  let _lpStartX=0,_lpStartY=0;

  function cancelLP(){
    if(_lpTimer){clearTimeout(_lpTimer);_lpTimer=null;}
    // Hide all remove hints
    carousel.querySelectorAll('.photo-remove-hint.show').forEach(el=>el.classList.remove('show'));
  }

  carousel.addEventListener('pointerdown',e=>{
    const slide=e.target.closest('.photo-slide');
    if(!slide||slide.dataset.photoType!=='community')return;
    _lpStartX=e.clientX;_lpStartY=e.clientY;
    _lpTimer=setTimeout(()=>{
      const hint=slide.querySelector('.photo-remove-hint');
      if(hint)hint.classList.add('show');
      _lpTimer=null;
    },600);
  },{passive:true});

  carousel.addEventListener('pointermove',e=>{
    if(!_lpTimer)return;
    const dx=Math.abs(e.clientX-_lpStartX),dy=Math.abs(e.clientY-_lpStartY);
    if(dx>10||dy>10)cancelLP();
  },{passive:true});

  carousel.addEventListener('pointerup',()=>{if(_lpTimer)cancelLP();},{passive:true});
  carousel.addEventListener('pointercancel',cancelLP,{passive:true});
}

function _removeCarouselPhoto(idx,spotId){_removePhoto(idx,spotId);}

// Remove photo from grid by index
function _removePhoto(idx,spotId){
  const stored=JSON.parse(localStorage.getItem(`wp_photos_${spotId}`)||'[]');
  if(idx>=0&&idx<stored.length)stored.splice(idx,1);
  localStorage.setItem(`wp_photos_${spotId}`,JSON.stringify(stored));
  const allS=[...spots,...userSpots];
  const sp=allS.find(s=>s.id===spotId);
  if(sp)fetchSpotPhotos(sp);
  showToast('Photo removed');
}

function scrollCarouselTo(idx){
  const carousel=document.getElementById('detailPhotoCarousel');
  if(carousel)carousel.scrollTo({left:idx*carousel.offsetWidth,behavior:'smooth'});
}

// ═══════════════════════════════════════════════════
// SAFETY — SHARE TRIP PLAN / I'M BACK SAFE
// ═══════════════════════════════════════════════════
function shareTripPlan(spotName,lat,lng){
  const mapsUrl=`https://maps.google.com/?q=${lat},${lng}`;
  const now=new Date();
  const eta=new Date(now.getTime()+4*60*60*1000); // +4h default
  const fmtTime=d=>`${d.getHours()%12||12}:${String(d.getMinutes()).padStart(2,'0')} ${d.getHours()>=12?'PM':'AM'}`;
  const msg=`WildPath Trip Plan\nSpot: ${spotName}\nMap: ${mapsUrl}\nDeparting: ${fmtTime(now)}\nExpected back by: ${fmtTime(eta)}\n\nIf you don't hear from me by ${fmtTime(eta)}, please call 911 and give them this location.`;
  if(navigator.share){
    navigator.share({title:`WildPath — ${spotName}`,text:msg}).catch(()=>{});
  } else if(navigator.clipboard){
    navigator.clipboard.writeText(msg).then(()=>showToast('Trip plan copied — paste to share'));
  } else {
    showToast('Share not available on this browser');
  }
}

function imBackSafe(spotName){
  const msg=`I'm back safely from ${spotName}! Thanks for keeping an eye out.`;
  if(navigator.share){
    navigator.share({title:'WildPath — Back Safe',text:msg}).catch(()=>{});
  } else if(navigator.clipboard){
    navigator.clipboard.writeText(msg).then(()=>showToast('Message copied'));
  }
  showToast('Glad you made it back safely!');
}

// ═══════════════════════════════════════════════════
// COMPASS MODE
// ═══════════════════════════════════════════════════
let compassActive=false, compassOrientHandler=null;

function toggleCompass(){
  const overlay=document.getElementById('compassOverlay');
  if(!compassActive){
    compassActive=true;
    overlay.style.boxShadow='0 0 0 2px var(--accent),0 0 14px rgba(196,149,106,.4)';

    const handleOrientation=e=>{
      // webkitCompassHeading is true heading on iOS; alpha is counterclockwise on Android
      let heading=e.webkitCompassHeading!=null
        ? e.webkitCompassHeading
        : (360-(e.alpha||0));
      const needle=document.getElementById('compassNeedle');
      if(needle) needle.style.transform=`rotate(${-heading}deg)`;

      // If a destination spot is selected, show bearing line
      const destEl=document.getElementById('compassBearing');
      const allSp=[...spots,...userSpots];
      const sp=allSp.find(s=>s.id===currentPin);
      if(sp && e.webkitCompassHeading!=null){
        // compute bearing from current GPS to spot
        // We store last user position from breadcrumb or locateMe
        if(window._lastUserLat!=null){
          const dLon=(sp.lng-window._lastUserLng)*Math.PI/180;
          const lat1=window._lastUserLat*Math.PI/180,lat2=sp.lat*Math.PI/180;
          const y=Math.sin(dLon)*Math.cos(lat2);
          const x=Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon);
          const bearing=(Math.atan2(y,x)*180/Math.PI+360)%360;
          const relBearing=bearing-heading;
          if(destEl) destEl.style.transform=`rotate(${relBearing}deg)`;
        }
      }
    };

    // iOS 13+ requires explicit permission
    if(typeof DeviceOrientationEvent!=='undefined' && typeof DeviceOrientationEvent.requestPermission==='function'){
      DeviceOrientationEvent.requestPermission().then(state=>{
        if(state==='granted'){
          compassOrientHandler=handleOrientation;
          window.addEventListener('deviceorientationabsolute',handleOrientation,true);
          window.addEventListener('deviceorientation',handleOrientation,true);
          showToast('Compass active');
        } else {
          compassActive=false;
          overlay.style.boxShadow='';
          showToast('Compass permission denied');
        }
      }).catch(()=>{
        compassActive=false;
        overlay.style.boxShadow='';
        showToast('Compass unavailable');
      });
    } else {
      compassOrientHandler=handleOrientation;
      window.addEventListener('deviceorientationabsolute',handleOrientation,true);
      window.addEventListener('deviceorientation',handleOrientation,true);
      showToast('Compass active');
    }

  } else {
    compassActive=false;
    overlay.style.boxShadow='';
    if(compassOrientHandler){
      window.removeEventListener('deviceorientationabsolute',compassOrientHandler,true);
      window.removeEventListener('deviceorientation',compassOrientHandler,true);
      compassOrientHandler=null;
    }
    const needle=document.getElementById('compassNeedle');
    if(needle) needle.style.transform='rotate(0deg)';
    showToast('Compass off');
  }
}

// ═══════════════════════════════════════════════════
// BREADCRUMB TRAIL
// ═══════════════════════════════════════════════════
let breadcrumbActive=false, breadcrumbWatchId=null, breadcrumbPoints=[], breadcrumbPolyline=null, _breadcrumbStartMarker=null;

function toggleBreadcrumb(){
  const btn=document.getElementById('breadcrumbMenuIcon');
  if(!breadcrumbActive){
    if(!navigator.geolocation){showToast('Location not supported');return;}
    breadcrumbActive=true;
    if(btn){btn.style.color='var(--accent)';btn.style.filter='drop-shadow(0 0 6px rgba(196,149,106,.6))';}
    breadcrumbPoints=[];

    // Initialize MapLibre GL GeoJSON source + layer for breadcrumb trail
    if(map){
      if(!map.getSource('breadcrumb-src')){
        map.addSource('breadcrumb-src',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
        map.addLayer({id:'breadcrumb-glow',type:'line',source:'breadcrumb-src',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#6fcf97','line-width':7,'line-opacity':0.15}});
        map.addLayer({id:'breadcrumb-line',type:'line',source:'breadcrumb-src',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#6fcf97','line-width':2.5,'line-opacity':0.88,'line-dasharray':[2,1.5]}});
      } else {
        map.getSource('breadcrumb-src').setData({type:'FeatureCollection',features:[]});
      }
    }

    showToast('Recording trail…');

    breadcrumbWatchId=navigator.geolocation.watchPosition(
      pos=>{
        const{latitude:lat,longitude:lng}=pos.coords;
        window._lastUserLat=lat; window._lastUserLng=lng;
        breadcrumbPoints.push([lng,lat]); // [lng,lat] for MapLibre
        if(map&&map.getSource('breadcrumb-src')){
          const geojson=breadcrumbPoints.length>1?{type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'LineString',coordinates:breadcrumbPoints},properties:{}}]}:{type:'FeatureCollection',features:[]};
          map.getSource('breadcrumb-src').setData(geojson);
        }
        if(breadcrumbPoints.length===1&&map){
          // Start dot marker
          const el=document.createElement('div');
          el.style.cssText='width:12px;height:12px;border-radius:50%;background:#6fcf97;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)';
          el.title='Trail Start';
          _breadcrumbStartMarker=new mapboxgl.Marker({element:el,anchor:'center'}).setLngLat([lng,lat]).addTo(map);
        }
      },
      ()=>showToast('Location error'),
      {enableHighAccuracy:true,maximumAge:4000,timeout:12000}
    );

  } else {
    breadcrumbActive=false;
    if(btn){btn.style.color='';btn.style.filter='';}
    if(breadcrumbWatchId!=null){
      navigator.geolocation.clearWatch(breadcrumbWatchId);
      breadcrumbWatchId=null;
    }
    // Compute total distance (breadcrumbPoints stored as [lng,lat] for MapLibre)
    let distMi=0;
    for(let i=1;i<breadcrumbPoints.length;i++){
      distMi+=_haversineDistMi(
        breadcrumbPoints[i-1][1],breadcrumbPoints[i-1][0],
        breadcrumbPoints[i][1],breadcrumbPoints[i][0]
      );
    }
    if(_breadcrumbStartMarker){_breadcrumbStartMarker.remove();_breadcrumbStartMarker=null;}
    showToast(breadcrumbPoints.length>1
      ? `Trail saved — ${distMi.toFixed(2)} mi`
      : 'Trail cleared');
    // GL line stays on map until next toggle-on clears it
  }
}

function _haversineDistMi(lat1,lon1,lat2,lon2){
  const R=3958.8,dLat=(lat2-lat1)*Math.PI/180,dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function _haversine(lat1,lon1,lat2,lon2){
  const R=6371000;
  const dLat=(lat2-lat1)*Math.PI/180;
  const dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

// ═══════════════════════════════════════════════════
// HIKE TRACKING
// ═══════════════════════════════════════════════════
let _hikeWatchId=null,_hikePoints=[],_hikeStartTime=null,_hikeTimerInterval=null;

// ── Hike creation method chooser (Section 9: record / draw / manual) ──
function openHikeCreateChooser(){
  if(isGuest()){showLoginScreen();return;}
  const existing=document.getElementById('_hikeChooserSheet');
  if(existing)existing.remove();
  const sheet=document.createElement('div');
  sheet.id='_hikeChooserSheet';
  sheet.style.cssText='position:fixed;inset:0;z-index:800;display:flex;flex-direction:column;justify-content:flex-end';
  sheet.innerHTML=`
    <div style="position:absolute;inset:0;background:rgba(0,0,0,.5)" onclick="this.parentElement.remove()"></div>
    <div style="position:relative;background:var(--bg1);border-radius:20px 20px 0 0;padding:16px 16px calc(env(safe-area-inset-bottom,0px)+16px)">
      <div style="font-size:15px;font-weight:700;color:var(--txt0);margin-bottom:14px">New Hike</div>
      <div onclick="document.getElementById('_hikeChooserSheet').remove();startHikeTracking()" style="display:flex;align-items:center;gap:12px;padding:14px;background:var(--bg2);border-radius:12px;cursor:pointer;margin-bottom:8px">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--accent)" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <div><div style="font-size:14px;font-weight:700;color:var(--txt0)">Record with GPS</div><div style="font-size:11px;color:var(--txt3)">Track your route live as you hike</div></div>
      </div>
      <div onclick="document.getElementById('_hikeChooserSheet').remove();startDrawHikeMode()" style="display:flex;align-items:center;gap:12px;padding:14px;background:var(--bg2);border-radius:12px;cursor:pointer;margin-bottom:8px">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg>
        <div><div style="font-size:14px;font-weight:700;color:var(--txt0)">Draw on Map</div><div style="font-size:11px;color:var(--txt3)">Tap waypoints to trace a route</div></div>
      </div>
      <div onclick="document.getElementById('_hikeChooserSheet').remove();openManualHikeForm()" style="display:flex;align-items:center;gap:12px;padding:14px;background:var(--bg2);border-radius:12px;cursor:pointer">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--accent)" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        <div><div style="font-size:14px;font-weight:700;color:var(--txt0)">Enter Manually</div><div style="font-size:11px;color:var(--txt3)">Fill in the details yourself</div></div>
      </div>
    </div>`;
  document.body.appendChild(sheet);
}

// ── Draw-on-map hike creation ──────────────────────────────────
let _drawHikeActive=false, _drawHikePoints=[];
function startDrawHikeMode(){
  _drawHikeActive=true;_drawHikePoints=[];
  showToast('Tap points on the map to draw your route');
  _showDrawHikeCard();
  if(map)map.on('click',_onDrawHikeMapClick);
}
function _onDrawHikeMapClick(e){
  if(!_drawHikeActive)return;
  _drawHikePoints.push({lat:e.lngLat.lat,lng:e.lngLat.lng});
  _renderDrawHikeLine();
  _updateDrawHikeCard();
}
function _renderDrawHikeLine(){
  if(!map)return;
  const coords=_drawHikePoints.map(p=>[p.lng,p.lat]);
  const geo={type:'Feature',geometry:{type:'LineString',coordinates:coords}};
  if(map.getSource('draw-hike-src')){map.getSource('draw-hike-src').setData(geo);return;}
  map.addSource('draw-hike-src',{type:'geojson',data:geo});
  map.addLayer({id:'draw-hike-line',type:'line',source:'draw-hike-src',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#B8E87A','line-width':4,'line-dasharray':[1,1]}});
}
function _drawHikeDistanceMi(){
  let m=0;
  for(let i=1;i<_drawHikePoints.length;i++)m+=_haversine(_drawHikePoints[i-1].lat,_drawHikePoints[i-1].lng,_drawHikePoints[i].lat,_drawHikePoints[i].lng);
  return m*0.000621371;
}
function _showDrawHikeCard(){
  const existing=document.getElementById('_drawHikeCard');
  if(existing)existing.remove();
  const card=document.createElement('div');
  card.id='_drawHikeCard';
  card.style.cssText='position:absolute;left:12px;right:12px;bottom:calc(var(--nav-h) + 12px);z-index:850;background:var(--bg1);border:1px solid var(--border2);border-radius:16px;padding:14px;box-shadow:0 8px 24px rgba(0,0,0,.5)';
  card.innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div><span id="_drawHikeDist" style="font-size:16px;font-weight:800;color:var(--accent)">0.00 mi</span> <span style="font-size:11px;color:var(--txt3)">· <span id="_drawHikePtCount">0</span> points</span></div>
      <div onclick="_cancelDrawHike()" style="width:26px;height:26px;border-radius:50%;background:var(--bg2);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:14px;color:var(--txt2)">×</div>
    </div>
    <div style="display:flex;gap:8px">
      <button onclick="_undoDrawHikePoint()" style="flex:1;padding:10px;background:var(--bg2);border:1px solid var(--border2);color:var(--txt1);border-radius:10px;font-size:12px;font-weight:700;cursor:pointer;font-family:var(--font)">Undo</button>
      <button onclick="_finishDrawHike()" style="flex:1;padding:10px;background:var(--accent);border:none;color:#0f1a0a;border-radius:10px;font-size:12px;font-weight:700;cursor:pointer;font-family:var(--font)">Finish</button>
    </div>`;
  document.getElementById('app').appendChild(card);
}
function _updateDrawHikeCard(){
  const distEl=document.getElementById('_drawHikeDist');
  const cntEl=document.getElementById('_drawHikePtCount');
  if(distEl)distEl.textContent=_drawHikeDistanceMi().toFixed(2)+' mi';
  if(cntEl)cntEl.textContent=_drawHikePoints.length;
}
function _undoDrawHikePoint(){
  _drawHikePoints.pop();
  _renderDrawHikeLine();
  _updateDrawHikeCard();
}
function _cancelDrawHike(){
  _drawHikeActive=false;
  if(map){map.off('click',_onDrawHikeMapClick);try{if(map.getLayer('draw-hike-line'))map.removeLayer('draw-hike-line');}catch(e){}try{if(map.getSource('draw-hike-src'))map.removeSource('draw-hike-src');}catch(e){}}
  document.getElementById('_drawHikeCard')?.remove();
  _drawHikePoints=[];
}
function _finishDrawHike(){
  if(_drawHikePoints.length<2){showToast('Add at least 2 points');return;}
  const distMi=_drawHikeDistanceMi();
  _cancelDrawHike();
  _showHikeSummary({points:_drawHikePoints,distStr:distMi.toFixed(2)+' mi',distMi,timeStr:'—',elapsedSec:0,elevGainFt:0,paceStr:'—'});
}

// ── Manual hike form entry ───────────────────────────────────────
function openManualHikeForm(){
  if(isGuest()){showLoginScreen();return;}
  const existing=document.getElementById('_manualHikeOverlay');
  if(existing)existing.remove();
  const overlay=document.createElement('div');
  overlay.id='_manualHikeOverlay';
  overlay.style.cssText='position:fixed;inset:0;z-index:700;background:var(--bg0);display:flex;flex-direction:column;overflow:hidden';
  overlay.innerHTML=`
    <div style="display:flex;align-items:center;padding:52px 16px 14px;border-bottom:1px solid var(--border);flex-shrink:0">
      <div onclick="this.closest('#_manualHikeOverlay').remove()" style="font-size:22px;color:var(--txt0);cursor:pointer;padding:0 12px 0 0">←</div>
      <div style="flex:1;font-size:17px;font-weight:700;color:var(--txt0);text-align:center">New Hike</div>
      <div style="width:44px"></div>
    </div>
    <div style="flex:1;overflow-y:auto;padding:20px 16px">
      <div class="form-group"><label class="form-label">Hike Name</label><input class="form-input" id="mhName" type="text" placeholder="e.g. Mist Falls Trail"></div>
      <div class="form-group"><label class="form-label">Description</label><textarea class="form-input" id="mhDesc" rows="3" style="resize:none"></textarea></div>
      <div class="form-group">
        <label class="form-label">Difficulty</label>
        <div class="diff-btns">
          <div class="diff-btn selected" data-diff="Easy" onclick="selectDiff(this)">Easy</div>
          <div class="diff-btn" data-diff="Moderate" onclick="selectDiff(this)">Moderate</div>
          <div class="diff-btn" data-diff="Hard" onclick="selectDiff(this)">Hard</div>
        </div>
      </div>
      <div class="form-group"><label class="form-label">Distance (miles)</label><input class="form-input" id="mhDist" type="number" step="0.1" placeholder="e.g. 4.2"></div>
      <div class="form-group"><label class="form-label">Elevation Gain (feet)</label><input class="form-input" id="mhElev" type="number" placeholder="e.g. 850"></div>
      <div class="form-group">
        <label class="form-label">Trailhead Location</label>
        <input class="form-input" id="mhLocSearch" placeholder="Search for the trailhead…" oninput="_manualHikeLocSearch(this.value)" autocomplete="off">
        <div id="mhLocDrop" class="ac-drop"></div>
        <div id="mhLocDisplay" style="display:none;font-size:12px;color:var(--accent);margin-top:6px"></div>
      </div>
      <button class="btn-submit-spot" onclick="_submitManualHike()">Continue</button>
      <button class="btn-cancel-modal" onclick="document.getElementById('_manualHikeOverlay').remove()">Cancel</button>
    </div>`;
  document.body.appendChild(overlay);
  aspSelectedDiff='Easy';
}
let _mhLat=null,_mhLng=null;
function _manualHikeLocSearch(q){
  const drop=document.getElementById('mhLocDrop');
  if(!q.trim()){drop.classList.remove('open');return;}
  clearTimeout(window._mhSearchTimer);
  window._mhSearchTimer=setTimeout(async()=>{
    try{
      const res=await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`,{headers:{'Accept-Language':'en-US,en'}});
      const data=await res.json();
      drop.innerHTML=data.map(d=>`<div class="ac-item" onclick="_selectManualHikeLoc(${d.lat},${d.lon},'${(d.display_name||'').replace(/'/g,"\\'").slice(0,50)}')"><div class="ac-name">${sanitize((d.display_name||'').split(',')[0])}</div></div>`).join('');
      drop.classList.add('open');
    }catch(e){}
  },350);
}
function _selectManualHikeLoc(lat,lng,name){
  _mhLat=parseFloat(lat);_mhLng=parseFloat(lng);
  document.getElementById('mhLocSearch').value=name;
  document.getElementById('mhLocDrop').classList.remove('open');
  const disp=document.getElementById('mhLocDisplay');
  disp.style.display='block';disp.textContent=`📍 ${lat},${lng}`;
}
function _submitManualHike(){
  const name=(document.getElementById('mhName').value||'').trim();
  if(!name){showToast('Enter a hike name');return;}
  if(_mhLat==null){showToast('Search and select a trailhead location');return;}
  const desc=(document.getElementById('mhDesc').value||'').trim();
  const distMi=parseFloat(document.getElementById('mhDist').value)||0;
  const elevFt=parseFloat(document.getElementById('mhElev').value)||0;
  const difficulty=aspSelectedDiff;
  document.getElementById('_manualHikeOverlay').remove();
  // Manual entry has no real route geometry — represent as a single trailhead point
  window._manualHikeData={name,description:desc,distMi,elevFt,difficulty,lat:_mhLat,lng:_mhLng};
  _showManualHikeTierPicker();
}
function _showManualHikeTierPicker(){
  const sheet=document.createElement('div');
  sheet.id='_manualHikeTierSheet';
  sheet.style.cssText='position:fixed;inset:0;z-index:800;display:flex;flex-direction:column;justify-content:flex-end';
  sheet.innerHTML=`
    <div style="position:absolute;inset:0;background:rgba(0,0,0,.5)" onclick="this.parentElement.remove()"></div>
    <div style="position:relative;background:var(--bg1);border-radius:20px 20px 0 0;padding:16px 16px calc(env(safe-area-inset-bottom,0px)+16px)">
      <div style="font-size:15px;font-weight:700;color:var(--txt0);margin-bottom:14px">Who can see this hike?</div>
      <button onclick="_submitManualHikeFinal('personal')" style="width:100%;padding:14px;background:var(--accent);border:none;border-radius:12px;color:#0f1a0a;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px">Personal — only me</button>
      <button onclick="document.getElementById('_manualHikeTierSheet').remove();_pickManualHikeCommunity()" style="width:100%;padding:14px;background:var(--bg2);border:1.5px solid var(--border2);border-radius:12px;color:var(--txt0);font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px">Community — needs approval</button>
      <button onclick="_submitManualHikeFinal('global')" style="width:100%;padding:14px;background:var(--bg2);border:1.5px solid var(--border2);border-radius:12px;color:var(--txt0);font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Global — app admin review</button>
    </div>`;
  document.body.appendChild(sheet);
}
function _pickManualHikeCommunity(){
  const myUid=String(_myUid());
  const myComms=getCommunities().filter(c=>getMembers(c.id).includes(myUid));
  if(!myComms.length){showToast('Join a community first');return;}
  const sheet=document.createElement('div');
  sheet.id='_manualHikeCommPicker';
  sheet.style.cssText='position:fixed;inset:0;z-index:800;display:flex;flex-direction:column;justify-content:flex-end';
  sheet.innerHTML=`<div style="background:var(--bg1);border-radius:20px 20px 0 0;padding:16px;max-height:60vh;overflow-y:auto">
    <div style="font-size:15px;font-weight:700;color:var(--txt0);margin-bottom:12px">Choose Community</div>
    ${myComms.map(c=>`<div onclick="document.getElementById('_manualHikeCommPicker').remove();_submitManualHikeFinal('community','${c.id}')" style="padding:12px 0;border-bottom:1px solid var(--border);cursor:pointer;font-size:14px;color:var(--txt0);font-weight:600">${sanitize(c.name)}</div>`).join('')}
  </div>`;
  document.body.appendChild(sheet);
}
async function _submitManualHikeFinal(visibility,communityId){
  document.getElementById('_manualHikeTierSheet')?.remove();
  const d=window._manualHikeData;
  if(!d)return;
  try{
    const routeGeojson={type:'Feature',geometry:{type:'LineString',coordinates:[[d.lng,d.lat],[d.lng,d.lat]]},properties:{}};
    const {error}=await db.from('hikes').insert({
      user_id:_myUid(),name:d.name,description:d.description,route_geojson:routeGeojson,
      difficulty:d.difficulty,distance:d.distMi,duration:0,elevation_gain:d.elevFt,
      visibility,community_id:communityId||null,
      status:visibility==='personal'?'approved':'pending'
    });
    if(error)throw error;
    showToast(visibility==='personal'?'Hike saved!':'Hike submitted for review!');
    window._manualHikeData=null;
    _loadMyHikes();_sbLoadHikes();
  }catch(e){
    console.warn('[Supabase] manual hike save failed:',e);
    showToast('Could not save hike — check connection');
  }
}

function startHikeTracking(){
  if(_hikeWatchId!==null){showToast('Already tracking a hike');return;}
  // Show custom confirmation modal instead of confirm()
  const existing=document.getElementById('_hikeConfirmModal');
  if(existing)existing.remove();
  const modal=document.createElement('div');
  modal.id='_hikeConfirmModal';
  modal.style.cssText='position:fixed;inset:0;z-index:800;background:rgba(0,0,0,.7);display:flex;align-items:flex-end;';
  modal.innerHTML=`
    <div style="width:100%;background:var(--bg1);border-radius:20px 20px 0 0;padding:24px 20px 36px;box-sizing:border-box">
      <div style="font-size:18px;font-weight:800;color:var(--txt0);margin-bottom:6px">Track Your Hike</div>
      <div style="font-size:14px;color:var(--txt2);margin-bottom:20px;line-height:1.5">WildPath will record your GPS route, distance, and time. Your location is stored only on this device.</div>
      <div style="display:flex;gap:10px">
        <button onclick="document.getElementById('_hikeConfirmModal').remove()"
          style="flex:1;padding:14px;background:var(--bg3);border:none;color:var(--txt1);border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">Cancel</button>
        <button onclick="document.getElementById('_hikeConfirmModal').remove();_beginHikeTracking()"
          style="flex:2;padding:14px;background:var(--accent);border:none;color:var(--bg0);border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">Start Tracking</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}
let _lastHikePointTime=0;
function _beginHikeTracking(){
  _hikePoints=[];
  _hikeStartTime=Date.now();
  _lastHikePointTime=0;
  _clearLiveHikeLine();
  const pill=document.getElementById('hikeTrackingPill');
  if(pill)pill.style.display='flex';
  _hikeTimerInterval=setInterval(_updateHikePill,1000);
  // Record a GPS point every 5 seconds (per spec), high accuracy
  _hikeWatchId=navigator.geolocation.watchPosition(
    pos=>{
      const now=Date.now();
      if(now-_lastHikePointTime<5000)return;
      _lastHikePointTime=now;
      const pt={lat:pos.coords.latitude,lng:pos.coords.longitude,alt:pos.coords.altitude,ts:now};
      _hikePoints.push(pt);
      localStorage.setItem('wildpath-active-hike',JSON.stringify({points:_hikePoints,startTime:_hikeStartTime}));
      _updateHikePill();
      _drawLiveHikeLine();
    },
    ()=>{},
    {enableHighAccuracy:true,timeout:10000,maximumAge:0}
  );
  showToast('Hike tracking started');
}
function _drawLiveHikeLine(){
  if(!map||_hikePoints.length<2)return;
  const coords=_hikePoints.map(p=>[p.lng,p.lat]);
  const geo={type:'Feature',geometry:{type:'LineString',coordinates:coords}};
  if(map.getSource('live-hike-src')){map.getSource('live-hike-src').setData(geo);return;}
  map.addSource('live-hike-src',{type:'geojson',data:geo});
  map.addLayer({id:'live-hike-line',type:'line',source:'live-hike-src',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#B8E87A','line-width':4,'line-opacity':.9}});
}
function _clearLiveHikeLine(){
  if(!map)return;
  try{if(map.getLayer('live-hike-line'))map.removeLayer('live-hike-line');}catch(e){}
  try{if(map.getSource('live-hike-src'))map.removeSource('live-hike-src');}catch(e){}
}
function _updateHikePill(){
  const pill=document.getElementById('hikeTrackingPill');
  if(!pill)return;
  const elapsedSec=Math.floor((Date.now()-(_hikeStartTime||Date.now()))/1000);
  const h=Math.floor(elapsedSec/3600),m=Math.floor((elapsedSec%3600)/60),s=elapsedSec%60;
  const timeStr=h>0?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`;
  const distMeters=_hikePoints.reduce((acc,pt,i)=>{
    if(i===0)return 0;
    return acc+_haversine(pt.lat,pt.lng,_hikePoints[i-1].lat,_hikePoints[i-1].lng);
  },0);
  const distMi=distMeters*0.000621371;
  const useKm=localStorage.getItem('wp_units')==='km';
  const distStr=useKm?(distMeters/1000).toFixed(2)+' km':distMi.toFixed(2)+' mi';
  const timeEl=document.getElementById('hikePillTime');
  const distEl=document.getElementById('hikePillDist');
  const paceEl=document.getElementById('hikePillPace');
  if(timeEl)timeEl.textContent=timeStr;
  if(distEl)distEl.textContent=distStr;
  if(paceEl){
    if(distMi>0.05){
      const paceMinPerMi=(elapsedSec/60)/distMi;
      const pm=Math.floor(paceMinPerMi),ps=Math.round((paceMinPerMi-pm)*60);
      paceEl.textContent=`${pm}:${String(ps).padStart(2,'0')}/mi`;
    } else {
      paceEl.textContent='—';
    }
  }
}
function stopHikeTracking(){
  if(_hikeWatchId!==null){navigator.geolocation.clearWatch(_hikeWatchId);_hikeWatchId=null;}
  clearInterval(_hikeTimerInterval);_hikeTimerInterval=null;
  const pill=document.getElementById('hikeTrackingPill');
  if(pill)pill.style.display='none';
  _clearLiveHikeLine();
  const elapsedSec=Math.floor((Date.now()-(_hikeStartTime||Date.now()))/1000);
  const distMeters=_hikePoints.reduce((acc,pt,i)=>{
    if(i===0)return 0;
    return acc+_haversine(pt.lat,pt.lng,_hikePoints[i-1].lat,_hikePoints[i-1].lng);
  },0);
  const distMi=distMeters*0.000621371;
  const useKm=localStorage.getItem('wp_units')==='km';
  const distStr=useKm?(distMeters/1000).toFixed(2)+' km':distMi.toFixed(2)+' mi';
  const h=Math.floor(elapsedSec/3600),m=Math.floor((elapsedSec%3600)/60),s=elapsedSec%60;
  const timeStr=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  // Elevation gain: sum of positive altitude deltas between consecutive points (meters -> feet)
  let elevGainM=0;
  for(let i=1;i<_hikePoints.length;i++){
    const a0=_hikePoints[i-1].alt,a1=_hikePoints[i].alt;
    if(a0!=null&&a1!=null&&a1>a0)elevGainM+=(a1-a0);
  }
  const elevGainFt=Math.round(elevGainM*3.28084);
  const paceMinPerMi=distMi>0.05?(elapsedSec/60)/distMi:null;
  const paceStr=paceMinPerMi?`${Math.floor(paceMinPerMi)}:${String(Math.round((paceMinPerMi-Math.floor(paceMinPerMi))*60)).padStart(2,'0')}/mi`:'—';
  _showHikeSummary({points:_hikePoints,distStr,distMi,timeStr,elapsedSec,distMeters,elevGainFt,paceStr});
  localStorage.removeItem('wildpath-active-hike');
}
function _showHikeSummary(hike){
  window._lastHikeData=hike;
  const overlay=document.createElement('div');
  overlay.id='_hikeSummaryOverlay';
  overlay.style.cssText='position:fixed;inset:0;z-index:700;background:var(--bg0);display:flex;flex-direction:column;overflow:hidden';
  const dateName='Hike '+new Date().toLocaleDateString('en-US',{month:'long',day:'numeric'});
  overlay.innerHTML=`
    <div style="display:flex;align-items:center;padding:52px 16px 14px;border-bottom:1px solid var(--border);flex-shrink:0">
      <div onclick="this.closest('#_hikeSummaryOverlay').remove()" style="font-size:22px;color:var(--txt0);cursor:pointer;padding:0 12px 0 0">←</div>
      <div style="flex:1;font-size:17px;font-weight:700;color:var(--txt0);text-align:center">Hike Summary</div>
      <div style="width:44px"></div>
    </div>
    <div style="flex:1;overflow-y:auto;padding:20px 16px">
      ${hike.points.length>1?`<div id="hikeSummaryMap" style="width:100%;height:200px;border-radius:14px;overflow:hidden;background:var(--bg2);margin-bottom:16px"></div>`:''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px">
        <div style="background:var(--bg2);border-radius:14px;padding:14px;text-align:center">
          <div style="font-size:20px;font-weight:800;color:var(--txt0)">${hike.timeStr}</div>
          <div style="font-size:10px;color:var(--txt3);margin-top:4px;text-transform:uppercase;letter-spacing:.5px">Total Time</div>
        </div>
        <div style="background:var(--bg2);border-radius:14px;padding:14px;text-align:center">
          <div style="font-size:20px;font-weight:800;color:var(--accent)">${hike.distStr}</div>
          <div style="font-size:10px;color:var(--txt3);margin-top:4px;text-transform:uppercase;letter-spacing:.5px">Total Distance</div>
        </div>
        <div style="background:var(--bg2);border-radius:14px;padding:14px;text-align:center">
          <div style="font-size:20px;font-weight:800;color:var(--txt0)">${hike.paceStr}</div>
          <div style="font-size:10px;color:var(--txt3);margin-top:4px;text-transform:uppercase;letter-spacing:.5px">Average Pace</div>
        </div>
        <div style="background:var(--bg2);border-radius:14px;padding:14px;text-align:center">
          <div style="font-size:20px;font-weight:800;color:var(--txt0)">${hike.elevGainFt?hike.elevGainFt+' ft':'—'}</div>
          <div style="font-size:10px;color:var(--txt3);margin-top:4px;text-transform:uppercase;letter-spacing:.5px">Elevation Gain</div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Hike Name</label>
        <input class="form-input" id="hikeNameInput" value="${dateName}" type="text">
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
        <button onclick="_confirmSaveHike('personal')" style="width:100%;padding:14px;background:var(--accent);border:none;border-radius:12px;color:#0f1a0a;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Save to My Hikes</button>
        <button onclick="_openHikeCommunityPicker()" style="width:100%;padding:14px;background:var(--bg2);border:1.5px solid var(--border2);border-radius:12px;color:var(--txt0);font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Share to Community</button>
        <button onclick="_discardHike()" style="width:100%;padding:14px;background:none;border:none;color:var(--red);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Discard</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  if(hike.points.length>1){
    setTimeout(()=>{
      const mapEl=overlay.querySelector('#hikeSummaryMap');
      if(!mapEl)return;
      const coords=hike.points.map(p=>[p.lng,p.lat]);
      const bounds=coords.reduce((b,c)=>b.extend(c),new mapboxgl.LngLatBounds(coords[0],coords[0]));
      try{
        const m=new mapboxgl.Map({container:mapEl,style:'mapbox://styles/mapbox/dark-v11',bounds,fitBoundsOptions:{padding:30},interactive:false,attributionControl:false});
        m.on('load',()=>{
          m.addSource('route',{type:'geojson',data:{type:'Feature',geometry:{type:'LineString',coordinates:coords}}});
          m.addLayer({id:'route-line',type:'line',source:'route',paint:{'line-color':'#B8E87A','line-width':3}});
          const startEl=document.createElement('div');
          startEl.style.cssText='width:16px;height:16px;border-radius:50%;background:#4CAF50;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)';
          new mapboxgl.Marker({element:startEl}).setLngLat(coords[0]).setPopup(new mapboxgl.Popup({offset:12}).setText('Start')).addTo(m);
          const endEl=document.createElement('div');
          endEl.style.cssText='width:16px;height:16px;border-radius:50%;background:#E05252;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)';
          new mapboxgl.Marker({element:endEl}).setLngLat(coords[coords.length-1]).setPopup(new mapboxgl.Popup({offset:12}).setText('End')).addTo(m);
        });
      }catch(e){}
    },100);
  }
}

function _discardHike(){
  if(!window.confirm('Discard this hike? This cannot be undone.'))return;
  document.getElementById('_hikeSummaryOverlay')?.remove();
  window._lastHikeData=null;
  showToast('Hike discarded');
}

async function _confirmSaveHike(visibility,communityId){
  if(isGuest()){showLoginScreen();return;}
  const hike=window._lastHikeData;
  if(!hike){showToast('No hike data');return;}
  const name=(document.getElementById('hikeNameInput')?.value||'').trim()||'Untitled Hike';
  const btn=event?.target;
  if(btn){btn.disabled=true;btn.textContent='Saving…';}
  try{
    const coords=hike.points.map(p=>[p.lng,p.lat]);
    const routeGeojson={type:'Feature',geometry:{type:'LineString',coordinates:coords},properties:{}};
    const row={
      user_id:_myUid(),name,route_geojson:routeGeojson,difficulty:'Moderate',
      distance:Math.round((hike.distMi||0)*100)/100,duration:hike.elapsedSec,
      elevation_gain:hike.elevGainFt||0,visibility,
      community_id:communityId||null,
      // Personal is instant. Community and Global both require approval — Community by
      // that community's admin, Global by the app admin (same rule as spots).
      status:visibility==='personal'?'approved':'pending'
    };
    const {error}=await db.from('hikes').insert(row);
    if(error)throw error;
    // Hikes are also saveable into the user's saved folders (Section 8 requirement)
    if(coords.length){
      const mid=coords[Math.floor(coords.length/2)];
      _savePlaceToFolder('hike',null,name,mid[1],mid[0],'My Hikes').catch(()=>{});
    }
    document.getElementById('_hikeSummaryOverlay')?.remove();
    showToast(visibility==='global'?'Hike submitted for admin review!':visibility==='community'?'Hike submitted for community review!':'Hike saved!');
    _loadMyHikes();
  }catch(e){
    console.warn('[Supabase] hike save failed:',e);
    showToast('Could not save hike — check connection');
    if(btn){btn.disabled=false;btn.textContent=visibility==='personal'?'Save to My Hikes':'Share to Community';}
  }
}

function _openHikeCommunityPicker(){
  const myUid=String(_myUid());
  const myComms=getCommunities().filter(c=>getMembers(c.id).includes(myUid));
  if(!myComms.length){showToast('Join a community first');return;}
  const existing=document.getElementById('_hikeCommPicker');
  if(existing)existing.remove();
  const sheet=document.createElement('div');
  sheet.id='_hikeCommPicker';
  sheet.style.cssText='position:fixed;inset:0;z-index:9500;display:flex;flex-direction:column;justify-content:flex-end';
  sheet.onclick=(e)=>{if(e.target===sheet)sheet.remove();};
  sheet.innerHTML=`<div style="background:var(--bg1);border-radius:20px 20px 0 0;padding:16px;max-height:60vh;overflow-y:auto">
    <div style="font-size:15px;font-weight:700;color:var(--txt0);margin-bottom:12px">Share to Community</div>
    ${myComms.map(c=>`<div onclick="document.getElementById('_hikeCommPicker').remove();_confirmSaveHike('community','${c.id}')" style="padding:12px 0;border-bottom:1px solid var(--border);cursor:pointer;font-size:14px;color:var(--txt0);font-weight:600">${sanitize(c.name)}</div>`).join('')}
  </div>`;
  document.body.appendChild(sheet);
}

// ── My Hikes (Profile tab) ──────────────────────────────────────
let myHikes=[];
async function _loadMyHikes(){
  if(isGuest())return;
  try{
    const {data,error}=await db.from('hikes').select('*').eq('user_id',_myUid()).order('created_at',{ascending:false});
    if(error)throw error;
    myHikes=data||[];
    _renderMyHikesSection();
  }catch(e){console.warn('[Supabase] my hikes load:',e);}
}
function _renderMyHikesSection(){
  const el=document.getElementById('myHikesGrid');
  if(!el)return;
  if(!myHikes.length){el.innerHTML='<div style="padding:16px;text-align:center;color:var(--txt3);font-size:12px">No hikes recorded yet</div>';return;}
  el.innerHTML=myHikes.map(h=>{
    const coords=h.route_geojson?.geometry?.coordinates||[];
    const diffColor=h.difficulty==='Easy'?'#4CAF50':h.difficulty==='Hard'?'#E05252':'#D4A843';
    return`<div onclick='_reopenHikeSummary(${JSON.stringify(h.id)})' style="background:var(--bg2);border-radius:14px;padding:12px;margin-bottom:8px;display:flex;gap:12px;align-items:center;cursor:pointer">
      <div style="width:56px;height:56px;border-radius:10px;background:linear-gradient(135deg,#1a3a2a,#2d5a3a);flex-shrink:0;display:flex;align-items:center;justify-content:center">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#B8E87A" stroke-width="1.8"><path d="M8 3l4 8 5-5 5 15H2z"/></svg>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:var(--txt0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${sanitize(h.name)}</div>
        <div style="font-size:11px;color:var(--txt3);margin-top:2px">${h.distance||0} mi · ${_fmtHikeDuration(h.duration)}</div>
        <span style="display:inline-block;margin-top:4px;font-size:9px;font-weight:700;color:${diffColor};text-transform:uppercase">${h.difficulty||'Moderate'}</span>
      </div>
    </div>`;
  }).join('');
}
function _fmtHikeDuration(sec){
  if(!sec)return '0m';
  const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60);
  return h>0?`${h}h ${m}m`:`${m}m`;
}
function _reopenHikeSummary(hikeId){
  const h=myHikes.find(x=>String(x.id)===String(hikeId));
  if(!h)return;
  const coords=h.route_geojson?.geometry?.coordinates||[];
  const points=coords.map(c=>({lng:c[0],lat:c[1]}));
  const m=Math.floor((h.duration||0)/60),s=(h.duration||0)%60;
  const hh=Math.floor((h.duration||0)/3600);
  const timeStr=`${String(hh).padStart(2,'0')}:${String(m%60).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  _showHikeSummary({points,distStr:(h.distance||0)+' mi',distMi:h.distance||0,timeStr,elapsedSec:h.duration||0,elevGainFt:h.elevation_gain||0,paceStr:'—'});
}

// ═══════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════
function showToast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2400);
}

// ═══════════════════════════════════════════════════
// SPOT & PLACE ICON HELPERS
// ═══════════════════════════════════════════════════
function _getSpotIcon(type,color){
  const iconMap={
    // Type keys
    hiking:'ti-walk',swimming:'ti-droplet',water:'ti-droplet',
    caves:'ti-mountain',cave:'ti-mountain',lava_tube:'ti-flame',
    scenic:'ti-eye',urban:'ti-building',historic:'ti-building-arch',
    biking:'ti-bike',bike:'ti-bike',rock_climbing:'ti-mountain-filled',climb:'ti-mountain-filled',
    river:'ti-ripple',waterfall:'ti-droplet-filled',falls:'ti-droplet-filled',
    natural_slide:'ti-wave-sine',slide:'ti-wave-sine',beach:'ti-umbrella-beach',
    // Nominatim/misc aliases
    peak:'ti-mountain',mountain:'ti-mountain',lava:'ti-flame',
    scenic_overlook:'ti-eye',historic_site:'ti-building-arch',
    rail:'ti-train',air:'ti-plane',med:'ti-first-aid-kit',road:'ti-road',
    city:'ti-building',town:'ti-building',village:'ti-home',
    park:'ti-trees',forest:'ti-tree',lake:'ti-droplet-filled',bay:'ti-waves',
    spring:'ti-droplet',trail:'ti-walk',path:'ti-walk'
  };
  const cls=iconMap[type]||'ti-map-pin';
  const c=color||'var(--accent)';
  return `<i class="ti ${cls}" style="font-size:18px;color:${c}"></i>`;
}

// ═══════════════════════════════════════════════════
// LIVE MAP SEARCH
// ═══════════════════════════════════════════════════
function liveSearchSpots(query){
  const drop=document.getElementById('mapSearchDrop');
  if(!drop)return;
  const q=(query||'').trim().toLowerCase();
  if(!q){drop.classList.remove('open');drop.innerHTML='';return;}
  const allS=[...spots,...userSpots];
  const results=allS.filter(s=>
    s.name.toLowerCase().includes(q)||
    s.typeLabel.toLowerCase().includes(q)||
    (s.description||'').toLowerCase().includes(q)
  ).slice(0,8);
  if(!results.length){
    drop.innerHTML=`<div class="search-no-results">No spots found for "${query}"</div>`;
    drop.classList.add('open'); return;
  }
  drop.innerHTML=results.map(s=>{
    const dist=s._realDistStr||s.distance||'';
    return `<div class="search-result-item" onclick="selectSearchResult('${s.id}')">
      <div class="search-result-icon">${_getSpotIcon(s.type,s.typeColor)}</div>
      <div class="search-result-info">
        <div class="search-result-name">${sanitize(s.name)}</div>
        <div class="search-result-meta">${s.typeLabel}${dist?' · '+dist:''}</div>
      </div>
    </div>`;
  }).join('');
  drop.classList.add('open');
}
function selectSearchResult(id){
  const allS=[...spots,...userSpots];
  const spot=allS.find(s=>s.id===id);
  if(!spot)return;
  const input=document.getElementById('mapSearchInput');
  if(input){input.value='';input.blur();}
  document.getElementById('mapSearchDrop').classList.remove('open');
  // Switch to map and fly to spot
  showTab('map');
  leafletMap.flyTo([spot.lat,spot.lng],14,{animate:true,duration:1.2});
  setTimeout(()=>openSheet(spot.id),1200);
}
// Close search drop on map click
document.addEventListener('click',e=>{
  const drop=document.getElementById('mapSearchDrop');
  const input=document.getElementById('mapSearchInput');
  if(drop&&input&&!drop.contains(e.target)&&e.target!==input){
    drop.classList.remove('open');
  }
});

// ═══════════════════════════════════════════════════
// DYNAMIC DETAIL SECTION TITLE + STICKY NAV BAR
// ═══════════════════════════════════════════════════
const SPOT_SECTION_TITLES={
  hiking:'Trail Info',biking:'Route Info',swimming:'Spot Info',
  caves:'Cave Info',rock_climbing:'Climb Info',scenic:'Viewpoint Info',
  urban:'Location Info',river:'River Info',lava_tube:'Tube Info',
  waterfall:'Waterfall Info',natural_slide:'Slide Info',default:'Spot Info'
};
function updateDetailSectionTitle(spotType){
  const el=document.getElementById('detailInfoTitle');
  if(el)el.textContent=SPOT_SECTION_TITLES[spotType]||SPOT_SECTION_TITLES.default;
}
function setNavigateStickyBtn(lat,lng,name){
  const apple=document.getElementById('appleMapsBtnSticky');
  if(apple)apple.href=`https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`;
  const google=document.getElementById('googleMapsBtnSticky');
  if(google)google.href=`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}


// ═══════════════════════════════════════════════════
// HOME SCREEN
// ═══════════════════════════════════════════════════
let _homeFilter='all';
let _homeFeaturedId=0;

function buildHomeScreen(){
  // Personalise greeting
  const greetName=document.getElementById('homeGreetingName');
  const greetTime=document.getElementById('homeGreetingTime');
  const hr=new Date().getHours();
  const timeLabel=hr<12?'Good morning':hr<17?'Good afternoon':'Good evening';
  if(greetTime)greetTime.textContent=timeLabel;
  if(greetName){
    const name=_currentUser&&_currentUser.username&&_currentUser.role!=='guest'
      ?_currentUser.username
      :'Explorer';
    greetName.textContent=`Hello, ${name}`;
  }

  const allS=[...spots,...userSpots];
  // Pick a featured spot (rotate daily)
  const dayIdx=Math.floor(Date.now()/86400000)%allS.length;
  const featured=allS[dayIdx]||allS[0];
  _homeFeaturedId=featured.id;

  const fc=document.getElementById('homeFeaturedCard');
  if(!fc)return;

  // Featured card — use optional chaining since redesigned HTML may omit some IDs
  const _set=(id,val)=>{const el=document.getElementById(id);if(el)el.textContent=val;};
  const _setStyle=(id,prop,val)=>{const el=document.getElementById(id);if(el)el.style[prop]=val;};
  _setStyle('homeFeaturedGrad','background',featured.heroGradient||'linear-gradient(160deg,#1a4a3a,#2d6e52)');
  _set('homeFeaturedEmoji',featured.typeLabel||'');
  _set('homeFeaturedName',featured.name);
  _set('homeFeaturedBadge',featured.typeLabel||'Spot');
  _set('homeFeaturedRating',`${featured.rating} · ${featured.reviews} reviews`);
  _set('homeFeaturedDist',featured._realDistStr||featured.distance||'');
  // Update stats row if present (new design uses homeFeaturedStats)
  const statsEl=document.getElementById('homeFeaturedStats');
  if(statsEl){
    statsEl.innerHTML=`
      <div class="featured-stat">${featured.rating} rating</div>
      <div class="featured-stat">${featured.distance||''}</div>
      <div class="featured-stat">${featured.difficulty||featured.typeLabel||''}</div>`;
  }

  renderHomeSpots(_homeFilter);
}

function openFeaturedSpot(){
  const allS=[...spots,...userSpots];
  const spot=allS.find(s=>s.id===_homeFeaturedId);
  if(!spot)return;
  showTab('map');
  setTimeout(()=>{
    if(leafletMap)leafletMap.flyTo([spot.lat,spot.lng],14,{animate:true,duration:1});
    setTimeout(()=>openSheet(spot.id),1100);
  },200);
}

function renderHomeSpots(filter){
  const container=document.getElementById('homeNearbyScroll');
  if(!container)return;
  const allS=[...spots,...userSpots];
  let filtered=allS;
  if(filter&&filter!=='all'){
    const typeMap={hiking:['hiking'],forest:['hiking'],caves:['caves','lava_tube'],river:['river','swimming','waterfall','natural_slide'],urban:['urban'],coast:['scenic','swimming']};
    const types=typeMap[filter]||[filter];
    filtered=allS.filter(s=>types.includes(s.type));
  }
  const show=filtered.slice(0,10);
  container.innerHTML=show.map(s=>`
    <div class="nearby-card" onclick="goToSpotFromHome('${s.id}')">
      <div class="nearby-card-img" style="background:${s.heroGradient||'var(--bg3)'}">
      </div>
      <div class="nearby-card-body">
        <div class="nearby-card-name">${sanitize(s.name)}</div>
        <div class="nearby-card-dist">${s.typeLabel} · ${s._realDistStr||s.distance||''}</div>
      </div>
    </div>
  `).join('');
}

function setHomeFilter(filter,el){
  _homeFilter=filter;
  document.querySelectorAll('#homeFilterRow .home-chip').forEach(c=>c.classList.remove('active'));
  if(el)el.classList.add('active');
  renderHomeSpots(filter);
}

function goToSpotFromHome(id){
  showTab('map');
  setTimeout(()=>{
    const allS=[...spots,...userSpots];
    const spot=allS.find(s=>s.id===id);
    if(spot&&leafletMap)leafletMap.flyTo([spot.lat,spot.lng],14,{animate:true,duration:1});
    setTimeout(()=>openSheet(id),1100);
  },200);
}

function homeSearch(val){
  const clear=document.getElementById('homeSearchClear');
  if(clear)clear.style.display=val?'inline':'none';
  if(!val||!val.trim()){document.getElementById('homeSearchDrop').innerHTML='';document.getElementById('homeSearchDrop').classList.remove('open');return;}
  nominatimSearchInto(val,document.getElementById('homeSearchDrop'),true);
}

function clearHomeSearch(){
  const inp=document.getElementById('homeSearchInput');
  const drop=document.getElementById('homeSearchDrop');
  const clear=document.getElementById('homeSearchClear');
  if(inp)inp.value='';
  if(drop){drop.innerHTML='';drop.classList.remove('open');}
  if(clear)clear.style.display='none';
}

// ═══════════════════════════════════════════════════
// NOMINATIM SEARCH (Map Screen)
// ═══════════════════════════════════════════════════
let _nominatimTimer=null;

function nominatimSearch(val){
  const clear=document.getElementById('searchClearBtn');
  if(clear)clear.style.display=val?'inline':'none';
  if(!val||!val.trim()){
    const drop=document.getElementById('mapSearchDrop');
    if(drop){drop.innerHTML='';drop.classList.remove('open');}
    return;
  }
  clearTimeout(_nominatimTimer);
  _nominatimTimer=setTimeout(()=>nominatimSearchInto(val,document.getElementById('mapSearchDrop'),false),340);
}

async function nominatimSearchInto(query,drop,isHome){
  if(!drop)return;
  const q=query.trim();
  if(!q){drop.innerHTML='';drop.classList.remove('open');return;}

  // First: search local WildPath spots
  const allS=[...spots,...userSpots];
  const localHits=allS.filter(s=>
    s.name.toLowerCase().includes(q.toLowerCase())||
    s.typeLabel.toLowerCase().includes(q.toLowerCase())
  ).slice(0,3);

  // Show local results immediately
  let html=localHits.map(s=>`
    <div class="search-result-item" onclick="${isHome?'goToSpotFromHome':'selectSearchResult'}(${s.id})">
      <div class="search-result-icon">${_getSpotIcon(s.type,s.typeColor)}</div>
      <div class="search-result-info">
        <div class="search-result-name">${sanitize(s.name)}</div>
        <div class="search-result-meta">${s.typeLabel} · ${s._realDistStr||s.distance||''}</div>
      </div>
    </div>`).join('');

  if(html){drop.innerHTML=html;drop.classList.add('open');}

  // Then fetch Nominatim results
  try{
    const url=`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6&viewbox=-124.5,42.5,-114,32&bounded=0&addressdetails=1&extratags=1`;
    const r=await fetch(url,{headers:{'Accept-Language':'en-US,en'},signal:AbortSignal.timeout(4000)});
    const data=await r.json();
    if(!data.length&&!localHits.length){
      drop.innerHTML=`<div class="search-no-results">No results for "${q}"</div>`;
      drop.classList.add('open');return;
    }
    const nomHtml=data.slice(0,5).map(item=>{
      const icon=_nominatimIcon(item.type,item.class);
      const region=item.address?.state||item.address?.country||'';
      const name=item.display_name.split(',')[0];
      const sub=[item.address?.county,item.address?.state].filter(Boolean).join(', ');
      return `<div class="search-result-item" onclick="flyToNominatim(${item.lat},${item.lon},'${name.replace(/'/g,"\\'")}')">
        <div class="search-result-icon" style="font-size:18px">${icon}</div>
        <div class="search-result-info">
          <div class="search-result-name">${name}</div>
          <div class="search-result-meta">${sub||item.type||'Place'}</div>
        </div>
      </div>`;
    }).join('');
    drop.innerHTML=html+nomHtml;
    if(html||nomHtml)drop.classList.add('open');
  }catch(e){
    drop.innerHTML=html+`<div class="search-no-results" style="color:var(--txt3)">Place search unavailable — check connection</div>`;
    drop.classList.add('open');
  }
}

function _nominatimIcon(type,cls){
  const iconMap={
    peak:'ti-mountain',mountain:'ti-mountain',hill:'ti-mountain',volcano:'ti-flame',
    river:'ti-ripple',stream:'ti-ripple',lake:'ti-droplet-filled',reservoir:'ti-droplet-filled',
    beach:'ti-umbrella-beach',bay:'ti-waves',
    trail:'ti-walk',path:'ti-walk',park:'ti-trees',forest:'ti-tree',
    city:'ti-building',town:'ti-building',village:'ti-home',suburb:'ti-building',
    cave:'ti-mountain',waterfall:'ti-droplet',spring:'ti-droplet',
    road:'ti-road',motorway:'ti-road',street:'ti-road',
    airport:'ti-plane',station:'ti-train',hospital:'ti-first-aid-kit'
  };
  const tiCls=iconMap[type]||iconMap[cls]||'ti-map-pin';
  return `<i class="ti ${tiCls}" style="font-size:18px;color:var(--txt3)"></i>`;
}

function flyToNominatim(lat,lon,name){
  const drop=document.getElementById('mapSearchDrop');
  const input=document.getElementById('mapSearchInput');
  if(drop)drop.classList.remove('open');
  if(input){input.value=name;input.blur();}
  showTab('map');
  setTimeout(()=>{
    if(map)map.flyTo({center:[parseFloat(lon),parseFloat(lat)],zoom:14,duration:1200,essential:true});
  },200);
}

function clearMapSearch(){
  const inp=document.getElementById('mapSearchInput');
  const drop=document.getElementById('mapSearchDrop');
  const clear=document.getElementById('searchClearBtn');
  if(inp)inp.value='';
  if(drop){drop.innerHTML='';drop.classList.remove('open');}
  if(clear)clear.style.display='none';
}

// ═══════════════════════════════════════════════════
// 3-DOT MAP MENU
// ═══════════════════════════════════════════════════
function toggleDotMenu(){
  const btn=document.getElementById('mapDotBtn');
  const menu=document.getElementById('mapDotMenu');
  const overlay=document.getElementById('mapDotOverlay');
  if(!btn)return;
  const open=btn.classList.contains('menu-open');
  if(open){closeDotMenu();}else{
    btn.classList.add('menu-open');
    menu.classList.add('menu-open');
    overlay.classList.add('menu-open');
  }
}
function closeDotMenu(){
  const btn=document.getElementById('mapDotBtn');
  const menu=document.getElementById('mapDotMenu');
  const overlay=document.getElementById('mapDotOverlay');
  if(btn)btn.classList.remove('menu-open');
  if(menu)menu.classList.remove('menu-open');
  if(overlay)overlay.classList.remove('menu-open');
}

// ═══════════════════════════════════════════════════
// COMPASS — DEVICE ORIENTATION
// ═══════════════════════════════════════════════════
let _compassHandler=null;

function initCompassOrientation(){
  if(_compassHandler){showToast('Compass already active');return;}
  // iOS 13+ requires permission
  if(typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function'){
    DeviceOrientationEvent.requestPermission().then(state=>{
      if(state==='granted')_startCompass();
      else showToast('Compass permission denied');
    }).catch(()=>showToast('Compass unavailable'));
  } else {
    _startCompass();
  }
}

function _startCompass(){
  const needle=document.getElementById('compassNeedle');
  if(!needle)return;
  showToast('Compass active');
  _compassHandler=(e)=>{
    let heading=null;
    if(e.webkitCompassHeading!=null){
      heading=e.webkitCompassHeading; // iOS: degrees from north
    } else if(e.absolute&&e.alpha!=null){
      heading=(360-e.alpha)%360;
    } else if(e.alpha!=null){
      heading=(360-e.alpha)%360;
    }
    if(heading!=null){
      // Rotate needle counter-clockwise by heading so red tip always points to geographic north
      needle.style.transform=`rotate(${-heading}deg)`;
    }
  };
  window.addEventListener('deviceorientationabsolute',_compassHandler,true);
  window.addEventListener('deviceorientation',_compassHandler,true);
}

// ═══════════════════════════════════════════════════
// PIN MY CAR
// ═══════════════════════════════════════════════════
let _carMarker=null;

function dropCarPin(){
  if(!navigator.geolocation){showToast('Location not supported');return;}
  const existing=localStorage.getItem('wp_car_pin');
  if(existing){
    const pin=JSON.parse(existing);
    if(!confirm('Update car location?')){
      // Show existing pin popup
      _placeCarMarkerOnMap(pin.lat,pin.lng);
      showCarPinPopup(pin.lat,pin.lng,pin.address||'');
      return;
    }
  }
  showToast('Getting your location…');
  navigator.geolocation.getCurrentPosition(async pos=>{
    const{latitude:lat,longitude:lng}=pos.coords;
    let address='';
    try{
      const r=await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,{signal:AbortSignal.timeout(5000)});
      const d=await r.json();
      address=d.display_name||`${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }catch{address=`${lat.toFixed(5)}, ${lng.toFixed(5)}`;}
    const pinData={lat,lng,address,time:Date.now()};
    localStorage.setItem('wp_car_pin',JSON.stringify(pinData));
    _placeCarMarkerOnMap(lat,lng);
    showCarPinPopup(lat,lng,address);
    showToast('Car pinned');
  },()=>showToast('Location unavailable'));
}

function _placeCarMarkerOnMap(lat,lng){
  if(!map)return;
  if(_carMarker){_carMarker.remove();_carMarker=null;}
  const el=document.createElement('div');
  el.style.cssText='background:#C4956A;color:#1A1714;font-size:11px;font-weight:800;padding:4px 8px;border-radius:12px;white-space:nowrap;box-shadow:0 3px 12px rgba(196,149,106,.6);border:1.5px solid rgba(255,255,255,.2);cursor:pointer';
  el.textContent='My Car';
  el.onclick=()=>showCarPinPopup(lat,lng,JSON.parse(localStorage.getItem('wp_car_pin')||'{}').address||'');
  _carMarker=new mapboxgl.Marker({element:el,anchor:'center'})
    .setLngLat([lng,lat])
    .addTo(map);
  showTab('map');
  map.flyTo({center:[lng,lat],zoom:16,duration:1000,essential:true});
}

function showCarPinPopup(lat,lng,address){
  const popup=document.getElementById('carPinPopup');
  const addrEl=document.getElementById('carPinAddr');
  if(!popup)return;
  if(addrEl)addrEl.textContent=address||'Locating address…';
  popup.classList.add('show');
  setTimeout(()=>popup.classList.remove('show'),6000);
}




// ═══════════════════════════════════════════════════
// SETTINGS PANELS — FULLY FUNCTIONAL
// ═══════════════════════════════════════════════════
function openSettingsPanel(key){
  const overlay=document.getElementById('settingsPanelOverlay');
  const title=document.getElementById('settingsPanelTitle');
  const body=document.getElementById('settingsPanelBody');
  if(!overlay)return;

  const panels={
    location:()=>{
      title.textContent='Location Services';
      const granted=localStorage.getItem('wp_location_granted')==='1';
      body.innerHTML=`
        <p class="sp-sub">WildPath uses your location to show nearby spots, calculate distances, and drop breadcrumb trails.</p>
        <div class="sp-row">
          <div><div class="sp-row-label">Status</div><div class="sp-row-val">${granted?'Permission granted':'Not granted'}</div></div>
        </div>
        <div class="sp-row">
          <div class="sp-row-label">Enable Location</div>
          <button onclick="navigator.geolocation.getCurrentPosition(p=>{localStorage.setItem('wp_location_granted','1');showToast('Location enabled');openSettingsPanel('location')},()=>showToast('Location denied'))" style="background:var(--accent);color:var(--bg0);border:none;padding:8px 16px;border-radius:10px;font-weight:700;cursor:pointer;font-family:inherit">Enable</button>
        </div>
      `;
    },
    offline:()=>{
      title.textContent='Offline Maps';
      body.innerHTML=`<p class="sp-sub">Downloaded map areas are available without internet.</p>${buildOfflineAreasList()}`;
    },
    darkmode:()=>{
      title.textContent='Display Mode';
      const isDark=!document.body.classList.contains('day-mode');
      body.innerHTML=`
        <p class="sp-sub">Choose between dark (warm charcoal) and day (light parchment) mode.</p>
        <div class="sp-row">
          <div class="sp-row-label">Dark Mode</div>
          <div onclick="setDayMode(false)" style="padding:8px 18px;border-radius:10px;cursor:pointer;font-weight:700;font-size:13px;background:${isDark?'var(--accent)':'var(--bg3)'};color:${isDark?'var(--bg0)':'var(--txt2)'};border:1px solid ${isDark?'var(--accent)':'var(--border2)'}">Warm Dark</div>
        </div>
        <div class="sp-row">
          <div class="sp-row-label">Day Mode</div>
          <div onclick="setDayMode(true)" style="padding:8px 18px;border-radius:10px;cursor:pointer;font-weight:700;font-size:13px;background:${!isDark?'var(--accent)':'var(--bg3)'};color:${!isDark?'var(--bg0)':'var(--txt2)'};border:1px solid ${!isDark?'var(--accent)':'var(--border2)'}">Light Parchment</div>
        </div>
      `;
    },
    share:()=>{
      title.textContent='Share Profile';
      body.innerHTML=`
        <p class="sp-sub">Share your WildPath stats and profile with friends.</p>
        <div style="background:var(--bg2);border-radius:14px;padding:14px;margin-bottom:14px;text-align:center">
          
          <div style="font-size:17px;font-weight:800;color:var(--txt0)">Explorer_WP</div>
          <div style="font-size:13px;color:var(--txt3);margin-top:4px">${_getMySpotCount()} spots visited</div>
        </div>
        <button onclick="shareProfile()" style="width:100%;padding:13px;background:var(--accent);color:var(--bg0);border:none;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">Share My Profile</button>
      `;
    },
    help:()=>{
      title.textContent='Help & Support';
      body.innerHTML=`
        <p class="sp-sub">Have questions or found a bug? We'd love to hear from you.</p>
        <div class="sp-row"><div class="sp-row-label">Email Support</div><a href="mailto:support@wildpath.app" style="color:var(--accent);font-size:13px">support@wildpath.app</a></div>
        <div class="sp-row"><div class="sp-row-label">Version</div><div class="sp-row-val">WildPath 2.0 Beta</div></div>
        <div class="sp-row"><div class="sp-row-label">Data Sources</div><div class="sp-row-val">OpenStreetMap, Wikimedia Commons, Nominatim, Overpass API</div></div>
      `;
    },
    legal:()=>{
      title.textContent=' Legal Info';
      body.innerHTML=`
        <div class="legal-block"><b style="font-size:13px;color:var(--txt0);display:block;margin-bottom:6px">Terms of Service</b>WildPath is provided for informational purposes only. Always check current conditions before visiting any location. WildPath is not responsible for injuries, trespassing, or other incidents. Use good judgment and follow posted rules.</div>
        <div class="legal-block"><b style="font-size:13px;color:var(--txt0);display:block;margin-bottom:6px">Privacy Policy</b>WildPath stores your data locally on your device. No personal data is transmitted to our servers. Location data is used only to show nearby spots and is never stored remotely.</div>
        <div class="legal-block"><b style="font-size:13px;color:var(--txt0);display:block;margin-bottom:6px">Open Source Licenses</b>
          <b>Leaflet.js</b> © Volodymyr Agafonkin — BSD-2-Clause<br>
          <b>OpenStreetMap</b> © OpenStreetMap contributors — ODbL<br>
          <b>Nominatim</b> © OpenStreetMap contributors — ODbL<br>
          <b>Overpass API</b> © Roland Olbricht — LGPL<br>
          <b>Wikimedia Commons</b> — CC-BY-SA<br>
          <b>Unsplash</b> — Unsplash License
        </div>
      `;
    },
    notifications:()=>{
      title.textContent='Notifications';
      const enabled=localStorage.getItem('wp_notif')==='1';
      body.innerHTML=`
        <p class="sp-sub">Get notified about trail conditions, crowd levels, and new nearby spots.</p>
        <div class="sp-row">
          <div class="sp-row-label">Push Notifications</div>
          <div onclick="this.classList.toggle('on');localStorage.setItem('wp_notif',this.classList.contains('on')?'1':'0')" style="width:46px;height:26px;border-radius:13px;background:${enabled?'var(--accent)':'var(--bg3)'};cursor:pointer;position:relative;transition:background .2s;border:1px solid var(--border2)" class="${enabled?'on':''}">
            <div style="position:absolute;top:3px;left:${enabled?'22':'3'}px;width:20px;height:20px;border-radius:50%;background:#fff;transition:left .2s;box-shadow:0 1px 4px rgba(0,0,0,.3)"></div>
          </div>
        </div>
      `;
    }
  };

  const build=panels[key];
  if(build){build();}else{
    title.textContent='Settings';
    body.innerHTML=`<p class="sp-sub">This setting is coming soon.</p>`;
  }
  overlay.classList.add('open');
}

function closeSettingsPanel(){
  const overlay=document.getElementById('settingsPanelOverlay');
  if(overlay)overlay.classList.remove('open');
}

function setDayMode(on){
  if(on){document.body.classList.add('day-mode');localStorage.setItem('wp_day_mode','1');}
  else{document.body.classList.remove('day-mode');localStorage.setItem('wp_day_mode','0');}
  closeSettingsPanel();
  showToast(on?'Day mode on':'Dark mode on');
}

function shareProfile(){
  const spotCount=_getMySpotCount();
  const text=`Check out my WildPath explorer profile — ${spotCount} spots visited!`;
  if(navigator.share){navigator.share({title:'My WildPath Profile',text});}
  else if(navigator.clipboard){navigator.clipboard.writeText(text).then(()=>showToast('Copied to clipboard'));}
  else showToast('Profile link copied');
}

function buildOfflineAreasList(){
  const areas=JSON.parse(localStorage.getItem('wp_offline_areas')||'[]');
  if(!areas.length)return`<div style="text-align:center;padding:24px 0;color:var(--txt3);font-size:13px">No offline areas downloaded yet.<br><br><button onclick="closeSettingsPanel();showTab('map');setTimeout(openOfflineDownload,300)" style="background:var(--accent);color:var(--bg0);border:none;padding:10px 20px;border-radius:10px;font-weight:700;cursor:pointer;font-family:inherit">Download an Area</button></div>`;
  return areas.map((a,i)=>`
    <div class="offline-row">
      <div>
        <div style="font-size:13px;font-weight:700;color:var(--txt0)">${sanitize(a.name)||'Unnamed Area'}</div>
        <div style="font-size:11px;color:var(--txt3);margin-top:3px">${a.sizeMB||'?'} MB · ${a.date||'Unknown date'}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button onclick="_sfViewOffline(${i})" style="background:rgba(184,232,122,.12);color:var(--accent);border:1px solid rgba(184,232,122,.25);padding:6px 12px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">View</button>
        <button onclick="deleteOfflineArea(${i})" style="background:rgba(196,82,74,.15);color:var(--red);border:1px solid rgba(196,82,74,.25);padding:6px 12px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">Delete</button>
      </div>
    </div>`).join('');
}

function deleteOfflineArea(idx){
  const areas=JSON.parse(localStorage.getItem('wp_offline_areas')||'[]');
  const name=areas[idx]?.name||'Area';
  areas.splice(idx,1);
  localStorage.setItem('wp_offline_areas',JSON.stringify(areas));
  showToast(`${name} deleted`);
  openSettingsPanel('offline');
}

// ═══════════════════════════════════════════════════
// OFFLINE DOWNLOAD
// ═══════════════════════════════════════════════════
function closeOfflineDownload(){
  const overlay=document.getElementById('offlineDownloadOverlay');
  const panel=document.getElementById('offlinePanel');
  if(panel)panel.classList.remove('show');
  setTimeout(()=>{if(overlay)overlay.classList.remove('active');},350);
}

function startOfflineDownload(){
  if(!map){closeOfflineDownload();return;}
  const nameInp=document.getElementById('offlineAreaName');
  const name=(nameInp?.value||'').trim()||`Area ${(JSON.parse(localStorage.getItem('wp_offline_areas')||'[]')).length+1}`;
  const b=map.getBounds();
  const ne={lat:b.getNorthEast().lat,lng:b.getNorthEast().lng};
  const sw={lat:b.getSouthWest().lat,lng:b.getSouthWest().lng};
  const wFrac=(100-_offlineRect.left-_offlineRect.right)/100;
  const hFrac=(100-_offlineRect.top-_offlineRect.bottom)/100;
  const tileUrls=_getTileUrlsForBounds(b,8,_offlineZoom);
  const sizeMB=Math.min(Math.round(_estimateTileCount(wFrac,hFrac,8,_offlineZoom)*0.015),999);
  const allS=[...spots,...userSpots];
  const spotIds=allS.filter(s=>s.lat>=sw.lat&&s.lat<=ne.lat&&s.lng>=sw.lng&&s.lng<=ne.lng).map(s=>s.id);
  const areas=JSON.parse(localStorage.getItem('wp_offline_areas')||'[]');
  areas.push({name,date:new Date().toLocaleDateString(),sizeMB,bounds:{ne,sw},zoomRange:`z8–${_offlineZoom}`,tileUrls,spotIds,createdAt:Date.now()});
  localStorage.setItem('wp_offline_areas',JSON.stringify(areas));
  closeOfflineDownload();
  showToast(`"${name}" saved for offline use`);
}

function _getTileUrlsForBounds(bounds,zMin,zMax){
  const urls=[];
  const ne=bounds.getNorthEast();
  const sw=bounds.getSouthWest();
  const baseUrl='https://tile.openstreetmap.org';
  for(let z=zMin;z<=zMax;z++){
    const x0=_llToTile(sw.lat,sw.lng,z).x;
    const x1=_llToTile(ne.lat,ne.lng,z).x;
    const y0=_llToTile(ne.lat,sw.lng,z).y;
    const y1=_llToTile(sw.lat,ne.lng,z).y;
    for(let x=x0;x<=x1;x++){
      for(let y=y0;y<=y1;y++){
        urls.push(`${baseUrl}/${z}/${x}/${y}.png`);
      }
    }
  }
  return urls.slice(0,2000); // cap at 2000 tiles
}

function _llToTile(lat,lng,z){
  const n=Math.pow(2,z);
  const x=Math.floor((lng+180)/360*n);
  const latR=lat*Math.PI/180;
  const y=Math.floor((1-Math.log(Math.tan(latR)+1/Math.cos(latR))/Math.PI)/2*n);
  return{x,y};
}

// ═══════════════════════════════════════════════════
// SERVICE WORKER (for offline tile serving)
// ═══════════════════════════════════════════════════
function registerServiceWorker(){
  if(!('serviceWorker' in navigator))return;
  // Register the real sw.js file (blob URL registration is blocked by browsers)
  navigator.serviceWorker.register('/sw.js',{scope:'/'}).then(()=>{
    // Monitor online/offline
    window.addEventListener('offline',()=>{
      const badge=document.getElementById('offlineBadge');
      if(badge)badge.style.display='block';
    });
    window.addEventListener('online',()=>{
      const badge=document.getElementById('offlineBadge');
      if(badge)badge.style.display='none';
    });
    if(!navigator.onLine){
      const badge=document.getElementById('offlineBadge');
      if(badge)badge.style.display='block';
    }
  }).catch(()=>{/* SW not available in this context (e.g. file:// or cross-origin) */});
}

// ═══════════════════════════════════════════════════
// DEVICE LOCATION PERMISSION CARD
// ═══════════════════════════════════════════════════
let _watchId=null;

function requestLocationPermission(){
  const card=document.getElementById('locationPermCard');
  if(!navigator.geolocation){
    showToast('Geolocation not supported');
    if(card)card.style.display='none';
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos=>{
      localStorage.setItem('wp_location_granted','1');
      if(card)card.style.display='none';
      _onLocationGranted(pos.coords.latitude,pos.coords.longitude);
      startLocationWatch();
    },
    err=>{
      if(card)card.style.display='none';
      const banner=document.getElementById('locationDeniedBanner');
      if(banner)banner.style.display='block';
    },
    {enableHighAccuracy:true,timeout:10000}
  );
}

function dismissLocationPerm(){
  const card=document.getElementById('locationPermCard');
  if(card)card.style.display='none';
  localStorage.setItem('wp_location_granted','skipped');
}

function _onLocationGranted(lat,lng){
  window._lastUserLat=lat; window._lastUserLng=lng;
  window._userLat=lat; window._userLng=lng;
  if(leafletMap){
    leafletMap.flyTo([lat,lng],13,{animate:true,duration:1.5});
    _placeUserDot(lat,lng);
    _refreshAllDistances();
  }
}

function startLocationWatch(){
  if(_watchId!=null||!navigator.geolocation)return;
  _watchId=navigator.geolocation.watchPosition(
    pos=>{
      const{latitude:lat,longitude:lng}=pos.coords;
      window._lastUserLat=lat; window._lastUserLng=lng;
      window._userLat=lat; window._userLng=lng;
      _placeUserDot(lat,lng);
    },
    ()=>{},
    {enableHighAccuracy:true,maximumAge:5000,timeout:15000}
  );
}

// ═══════════════════════════════════════════════════
// PROFILE EDITING
// ═══════════════════════════════════════════════════
function openProfileEditSheet(){
  const sheet=document.getElementById('profileEditSheet');
  if(sheet)sheet.style.display='flex';
}
function closeProfileEditSheet(){
  const sheet=document.getElementById('profileEditSheet');
  if(sheet)sheet.style.display='none';
}
function openAvatarActionSheet(){
  const sheet=document.createElement('div');
  sheet.style.cssText='position:fixed;inset:0;z-index:800;display:flex;flex-direction:column;justify-content:flex-end';
  sheet.innerHTML=`
    <div style="position:absolute;inset:0;background:rgba(0,0,0,.5)" onclick="this.closest('[style*=fixed]').remove()"></div>
    <div style="position:relative;background:var(--bg1);border-radius:20px 20px 0 0;padding:12px 16px calc(var(--nav-h) + 12px)">
      <div style="font-size:12px;color:var(--txt3);text-align:center;margin-bottom:12px;font-weight:600">Change Profile Photo</div>
      <div onclick="document.getElementById('avatarFileCamera').click();this.closest('[style*=fixed]').remove()" style="display:flex;align-items:center;gap:12px;padding:14px;background:var(--bg2);border-radius:12px;cursor:pointer;margin-bottom:8px">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--txt0)" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        <span style="font-size:15px;font-weight:600;color:var(--txt0)">Take Photo</span>
      </div>
      <div onclick="document.getElementById('avatarFileLibrary').click();this.closest('[style*=fixed]').remove()" style="display:flex;align-items:center;gap:12px;padding:14px;background:var(--bg2);border-radius:12px;cursor:pointer;margin-bottom:8px">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--txt0)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        <span style="font-size:15px;font-weight:600;color:var(--txt0)">Choose from Library</span>
      </div>
      <div onclick="this.closest('[style*=fixed]').remove()" style="padding:14px;text-align:center;font-size:15px;font-weight:600;color:var(--txt3);cursor:pointer">Cancel</div>
    </div>`;
  document.body.appendChild(sheet);
}

function openAvatarPicker(){
  closeProfileEditSheet();
  document.getElementById('avatarPickerInput')?.click();
}
function handleAvatarUpload(e){
  const file=e.target.files&&e.target.files[0];
  console.log('[AVATAR STEP 1] file input change fired:',file?{name:file.name,type:file.type,size:file.size}:'NO FILE');
  if(!file)return;
  if(isGuest()){showLoginScreen();return;}
  // Crop square, downscale to 200x200, upload to Avatars bucket
  openCropModal(file,'square_locked',async(croppedDataUrl)=>{
    try{
      const small=await _resizeDataUrl(croppedDataUrl,200);
      console.log('[AVATAR STEP 2] compressImage/resize complete, dataUrl length:',small?.length);

      const path=`${_myUid()}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.jpg`;
      const blob=await (await fetch(small)).blob();
      console.log('[AVATAR STEP 3] uploading to bucket "Avatars" at path:',path,'blob size:',blob.size);
      const {data:uploadData,error:uploadError}=await db.storage.from('Avatars').upload(path,blob,{contentType:blob.type||'image/jpeg'});
      console.log('[AVATAR STEP 3] upload response:',uploadData,'error:',uploadError);
      if(uploadError)throw uploadError;

      const url=db.storage.from('Avatars').getPublicUrl(path).data.publicUrl;
      console.log('[AVATAR STEP 4] getPublicUrl:',url);
      if(!url)throw new Error('getPublicUrl returned no URL');

      const {data:updateData,error:updateError}=await db.from('profiles').update({avatar_url:url}).eq('id',_myUid()).select();
      console.log('[AVATAR STEP 5] profiles.avatar_url update response:',updateData,'error:',updateError);
      if(updateError)throw updateError;

      const pd=getUserProfile(_myUid())||{};
      pd.avatarUrl=url;
      setUserProfile(_myUid(),pd);
      const bustedUrl=url+(url.includes('?')?'&':'?')+'t='+Date.now();
      _applyAvatar(bustedUrl);
      console.log('[AVATAR STEP 6] img src updated with cache-busted URL:',bustedUrl);
      showToast('Profile photo updated');
    }catch(err){
      console.warn('[AVATAR] upload chain failed:',err);
      showToast('Could not upload photo — check connection');
    }
  });
  e.target.value='';
}
// Downscale a dataURL to an exact square size (for avatars)
function _resizeDataUrl(dataUrl,size){
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{
      const c=document.createElement('canvas');
      c.width=size;c.height=size;
      c.getContext('2d').drawImage(img,0,0,size,size);
      resolve(c.toDataURL('image/jpeg',0.85));
    };
    img.onerror=()=>resolve(dataUrl);
    img.src=dataUrl;
  });
}
function _applyAvatar(src){
  const img=document.getElementById('profileAvatarImg');
  const txt=document.getElementById('profileAvatarText');
  const shareAv=document.getElementById('shareProfileAvatar');
  if(img){img.src=src;img.style.display='block';}
  if(txt)txt.style.display='none';
  if(shareAv){shareAv.innerHTML=`<img src="${src}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;}
}
function openUsernameEdit(){
  closeProfileEditSheet();
  const modal=document.getElementById('usernameEditModal');
  const inp=document.getElementById('usernameEditInput');
  const cur=document.getElementById('profileUsername');
  if(inp&&cur)inp.value=cur.textContent.replace('@','');
  if(modal)modal.style.display='flex';
}
function closeUsernameEdit(){
  const modal=document.getElementById('usernameEditModal');
  if(modal)modal.style.display='none';
}
function saveUsername(){
  if(isGuest()){showLoginScreen();return;}
  const inp=document.getElementById('usernameEditInput');
  const usernameEl=document.getElementById('profileUsername');
  const shareEl=document.getElementById('shareProfileUsername');
  if(!inp||!inp.value.trim())return;
  const uname=inp.value.trim().replace('@','').slice(0,24);
  db.from('profiles').update({username:uname}).eq('id',_myUid()).then(({error})=>{
    if(error){showToast(error.message&&error.message.includes('duplicate')?'Username already taken':'Could not update username');return;}
    if(_currentUser)_currentUser.username=uname;
    const prof=getUserProfile(_myUid())||{};prof.username=uname;setUserProfile(_myUid(),prof);
    if(usernameEl)usernameEl.textContent='@'+uname;
    if(shareEl)shareEl.textContent='@'+uname;
    closeUsernameEdit();
    showToast('Username saved');
  });
}
// Restore profile on load
(()=>{
  setTimeout(()=>{
    const av=(getUserProfile(String(_myUid()))||{}).avatarUrl;
    if(av)_applyAvatar(av);
  },150);
  const un=null; // username comes from the profiles table via buildProfile
  if(un){
    setTimeout(()=>{
      const el=document.getElementById('profileUsername');
      if(el)el.textContent=un;
    },100);
  }
})();

// ═══════════════════════════════════════════════════
// CROP MODAL — Canvas-based reusable cropper
// ═══════════════════════════════════════════════════
let _cropImg=null,_cropAspect='free',_cropOnConfirm=null;
let _cropBox={x:0,y:0,w:100,h:100};
let _cropCanvasW=0,_cropCanvasH=0,_cropImgOffX=0,_cropImgOffY=0,_cropImgDrawW=0,_cropImgDrawH=0;

function openCropModal(file,aspectRatio,onConfirm){
  const modal=document.getElementById('cropModal');
  if(!modal)return;
  _cropOnConfirm=onConfirm;
  _cropAspect=aspectRatio||'free';
  const canvas=document.getElementById('cropCanvas');
  const ctx=canvas.getContext('2d');
  const img=new Image();
  const reader=new FileReader();
  reader.onload=ev=>{
    img.onload=()=>{
      _cropImg=img;
      // Size canvas to fit image
      const maxW=Math.min(img.width,window.innerWidth);
      const maxH=Math.min(img.height,Math.round(window.innerHeight*0.55));
      const scale=Math.min(maxW/img.width,maxH/img.height,1);
      canvas.width=Math.round(img.width*scale);
      canvas.height=Math.round(img.height*scale);
      _cropCanvasW=canvas.width;_cropCanvasH=canvas.height;
      _cropImgOffX=0;_cropImgOffY=0;_cropImgDrawW=canvas.width;_cropImgDrawH=canvas.height;
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
      // Init crop box centered, aspect-locked
      _initCropBox();
      _drawCropBox();
      modal.style.display='flex';
      // Show/hide aspect ratio buttons
      const row=document.getElementById('cropAspectRow');
      if(row)row.style.display=(_cropAspect==='square_locked'||_cropAspect==='16:5_locked')?'none':'flex';
    };
    img.src=ev.target.result;
  };
  reader.readAsDataURL(file);
}
function _initCropBox(){
  const ratio=typeof _cropAspect==='number'?_cropAspect:parseFloat(_cropAspect)||0;
  const pad=20;
  const maxW=_cropCanvasW-pad*2;const maxH=_cropCanvasH-pad*2;
  let bw=maxW,bh=maxH;
  if(ratio>0){
    bh=Math.round(bw/ratio);
    if(bh>maxH){bh=maxH;bw=Math.round(bh*ratio);}
  }
  _cropBox={x:Math.round((_cropCanvasW-bw)/2),y:Math.round((_cropCanvasH-bh)/2),w:bw,h:bh};
}
function _drawCropBox(){
  const box=document.getElementById('cropBox');
  const wrap=document.getElementById('cropCanvasWrap');
  const canvas=document.getElementById('cropCanvas');
  if(!box||!canvas)return;
  const cr=canvas.getBoundingClientRect();
  const wr=wrap.getBoundingClientRect();
  const scaleX=cr.width/canvas.width;const scaleY=cr.height/canvas.height;
  const offX=cr.left-wr.left;const offY=cr.top-wr.top;
  box.style.left=(offX+_cropBox.x*scaleX)+'px';
  box.style.top=(offY+_cropBox.y*scaleY)+'px';
  box.style.width=(_cropBox.w*scaleX)+'px';
  box.style.height=(_cropBox.h*scaleY)+'px';
}
function closeCropModal(){
  const modal=document.getElementById('cropModal');
  if(modal)modal.style.display='none';
  _cropImg=null;_cropOnConfirm=null;
}
function confirmCrop(){
  if(!_cropImg)return;
  const canvas=document.getElementById('cropCanvas');
  if(!canvas)return;
  const scaleX=_cropImg.width/_cropCanvasW;
  const scaleY=_cropImg.height/_cropCanvasH;
  const offCanvas=document.createElement('canvas');
  offCanvas.width=Math.round(_cropBox.w*scaleX);
  offCanvas.height=Math.round(_cropBox.h*scaleY);
  const ctx2=offCanvas.getContext('2d');
  ctx2.drawImage(_cropImg,Math.round(_cropBox.x*scaleX),Math.round(_cropBox.y*scaleY),offCanvas.width,offCanvas.height,0,0,offCanvas.width,offCanvas.height);
  const dataUrl=offCanvas.toDataURL('image/jpeg',0.85);
  closeCropModal();
  if(typeof _cropOnConfirm==='function')_cropOnConfirm(dataUrl);
}
function setCropAspect(ratio,el){
  document.querySelectorAll('.crop-aspect-btn').forEach(b=>b.classList.remove('active'));
  if(el)el.classList.add('active');
  _cropAspect=ratio==='free'?'free':parseFloat(ratio)||'free';
  _initCropBox();
  _drawCropBox();
}

// ═══════════════════════════════════════════════════
// SHARE PROFILE — FUNCTIONAL
// ═══════════════════════════════════════════════════
function shareProfile(){
  const overlay=document.getElementById('shareProfileOverlay');
  if(!overlay)return;
  const un=(_currentUser?.username)||localStorage.getItem('wp_username')||'wildexplorer';
  const initials=un.replace('@','').slice(0,2).toUpperCase()||'WP';
  const av=(getUserProfile(String(_myUid()))||{}).avatarUrl;
  const unEl=document.getElementById('shareProfileUsername');
  if(unEl)unEl.textContent='@'+un.replace('@','');
  const avEl=document.getElementById('shareProfileAvatar');
  if(avEl){
    if(av)avEl.innerHTML=`<img src="${av}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    else avEl.textContent=initials;
  }
  const myUid=String(_myUid());
  const myPosts=getPosts().filter(p=>String(p.userId)===myUid&&!p.id.startsWith('dp_'));
  const visitedSpots=new Set(myPosts.filter(p=>p.spotId).map(p=>String(p.spotId))).size;
  const visitedEl=document.getElementById('shareVisitedCount');
  if(visitedEl)visitedEl.textContent=visitedSpots;
  const postEl=document.getElementById('sharePostCount');
  if(postEl)postEl.textContent=myPosts.length;
  const addedEl=document.getElementById('shareSpotCount');
  if(addedEl)addedEl.textContent=userSpots.filter(s=>s.submittedBy===myUid).length;
  overlay.style.display='flex';
}
function closeShareProfile(){
  const overlay=document.getElementById('shareProfileOverlay');
  if(overlay)overlay.style.display='none';
}
function copyShareLink(){
  const url=`https://wildpath.app/profile/${(localStorage.getItem('wp_username')||'explorer').replace('@','')}`;
  navigator.clipboard?.writeText(url).then(()=>showToast('Link copied')).catch(()=>showToast('Copied'));
}
function _getMySpotCount(){
  const myUid=_myUid();
  const allPosts=getPosts();
  return new Set(allPosts.filter(p=>String(p.userId)===String(myUid)&&p.spotId).map(p=>p.spotId)).size;
}
function nativeShare(){
  const un=localStorage.getItem('wp_username')||'@wildexplorer';
  const spotCount=_getMySpotCount();
  const text=`Check out my WildPath profile — ${spotCount} spots visited in California! Join me`;
  if(navigator.share){
    navigator.share({title:`WildPath — ${un}`,text,url:'https://wildpath.app'}).catch(()=>{});
  } else {
    copyShareLink();
  }
  closeShareProfile();
}

// ═══════════════════════════════════════════════════
// COLLECTIONS — FIX
// ═══════════════════════════════════════════════════
function buildCollections(){
  const el=document.getElementById('collectionsList');
  if(!el)return;
  if(!collections.length){
    collections=[
      {id:1,name:'California Waterfalls',icon:'',spotIds:[]},
      {id:2,name:'Summer Swims',icon:'',spotIds:[]},
      {id:3,name:'Cave Quest',icon:'',spotIds:[]}
    ];
    localStorage.setItem('wp_collections',JSON.stringify(collections));
  }
  el.innerHTML=collections.map((c,idx)=>`
    <div class="collection-row" onclick="openCollectionDetail(${idx})">
      <div class="collection-icon"><i class="ti ti-folder" style="font-size:22px;color:var(--accent)"></i></div>
      <div class="collection-name">${sanitize(c.name)}</div>
      <div class="collection-count">${c.spotIds.length} spots</div>
      <div style="color:var(--txt3);font-size:18px;margin-left:8px">›</div>
    </div>`).join('');
}

function createCollection(){
  // Inline modal instead of prompt()
  const existing=document.getElementById('_createCollectionModal');
  if(existing)existing.remove();
  const modal=document.createElement('div');
  modal.id='_createCollectionModal';
  modal.style.cssText='position:fixed;inset:0;z-index:800;background:rgba(0,0,0,.7);display:flex;align-items:flex-end;';
  modal.innerHTML=`
    <div style="width:100%;background:var(--bg1);border-radius:20px 20px 0 0;padding:20px 20px 32px;box-sizing:border-box">
      <div style="font-size:17px;font-weight:800;color:var(--txt0);margin-bottom:16px">New Collection</div>
      <input id="_collNameInput" placeholder="Collection name…" maxlength="40"
        style="width:100%;background:var(--bg2);border:1px solid var(--border2);color:var(--txt0);border-radius:12px;padding:12px 14px;font-size:15px;font-family:inherit;outline:none;box-sizing:border-box">
      <div style="display:flex;gap:10px;margin-top:14px">
        <button onclick="document.getElementById('_createCollectionModal').remove()"
          style="flex:1;padding:13px;background:var(--bg3);border:none;color:var(--txt1);border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Cancel</button>
        <button onclick="_submitNewCollection()"
          style="flex:1;padding:13px;background:var(--accent);border:none;color:var(--bg0);border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Create</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  setTimeout(()=>{const i=document.getElementById('_collNameInput');if(i)i.focus();},100);
}
function _submitNewCollection(){
  const nameEl=document.getElementById('_collNameInput');
  const name=(nameEl&&nameEl.value.trim())||'';
  if(!name){showToast('Enter a collection name');return;}
  const id=Date.now();
  collections.push({id,name,spotIds:[]});
  localStorage.setItem('wp_collections',JSON.stringify(collections));
  document.getElementById('_createCollectionModal')?.remove();
  buildCollections();
  openCollectionDetail(collections.length-1);
}

function openCollectionDetail(idx){
  const c=collections[idx];
  if(!c)return;
  const overlay=document.getElementById('collectionDetailOverlay');
  const nameEl=document.getElementById('collectionDetailName');
  const body=document.getElementById('collectionDetailBody');
  if(!overlay)return;
  if(nameEl)nameEl.textContent=c.name;
  const allS=[...spots,...userSpots];
  const addBtn=`<button onclick="_openCollectionSpotPicker(${idx})" style="width:100%;padding:12px;background:rgba(184,232,122,.12);border:1px solid rgba(184,232,122,.3);color:var(--accent);border-radius:12px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:14px">+ Add Spot</button>`;
  if(!c.spotIds.length){
    body.innerHTML=addBtn+`
      <div style="text-align:center;padding:32px 20px">
        <div style="font-size:17px;font-weight:700;color:var(--txt0);margin-bottom:8px">No spots yet</div>
        <div style="font-size:13px;color:var(--txt2);line-height:1.6">Tap Add Spot to start building this collection</div>
      </div>`;
  } else {
    const saved=c.spotIds.map(id=>allS.find(s=>s.id===id)).filter(Boolean);
    body.innerHTML=addBtn+saved.map(s=>`
      <div class="saved-spot-row" onclick="openDetail('${s.id}')" style="cursor:pointer">
        <div class="saved-spot-icon">${_getSpotIcon(s.type,s.typeColor)}</div>
        <div><div class="saved-spot-name">${s.name}</div><div class="saved-spot-dist">${s.typeLabel}</div></div>
        <div class="saved-spot-arrow">›</div>
      </div>`).join('');
  }
  overlay.style.display='flex';
}
function _openCollectionSpotPicker(collIdx){
  const existing=document.getElementById('_collSpotPicker');
  if(existing)existing.remove();
  const allS=[...spots,...userSpots];
  const c=collections[collIdx];
  const modal=document.createElement('div');
  modal.id='_collSpotPicker';
  modal.style.cssText='position:fixed;inset:0;z-index:900;background:rgba(0,0,0,.75);display:flex;align-items:flex-end;';
  modal.innerHTML=`
    <div style="width:100%;background:var(--bg1);border-radius:20px 20px 0 0;padding:16px 0 32px;max-height:70vh;display:flex;flex-direction:column;box-sizing:border-box">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:0 20px 14px">
        <div style="font-size:17px;font-weight:800;color:var(--txt0)">Add to ${c.name}</div>
        <button onclick="document.getElementById('_collSpotPicker').remove()" style="background:var(--bg3);border:none;color:var(--txt1);width:28px;height:28px;border-radius:50%;font-size:14px;cursor:pointer">x</button>
      </div>
      <div style="overflow-y:auto;flex:1;padding:0 16px">
        ${allS.map(s=>`
          <div onclick="_addSpotToCollection(${collIdx},${s.id})" style="display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid var(--border);cursor:pointer">
            <div style="width:36px;height:36px;border-radius:8px;background:${s.heroGradient};flex-shrink:0"></div>
            <div style="flex:1"><div style="font-size:13px;font-weight:700;color:var(--txt0)">${s.name}</div><div style="font-size:11px;color:var(--txt2)">${s.typeLabel||''}</div></div>
            ${c.spotIds.includes(s.id)?'<span style="font-size:11px;color:var(--accent);font-weight:700">Added</span>':''}
          </div>`).join('')}
      </div>
    </div>`;
  document.body.appendChild(modal);
}
function _addSpotToCollection(collIdx,spotId){
  const c=collections[collIdx];
  if(!c)return;
  if(c.spotIds.includes(spotId)){showToast('Already in collection');return;}
  c.spotIds.push(spotId);
  localStorage.setItem('wp_collections',JSON.stringify(collections));
  document.getElementById('_collSpotPicker')?.remove();
  openCollectionDetail(collIdx);
  showToast('Spot added to collection');
}

function closeCollectionDetail(){
  const overlay=document.getElementById('collectionDetailOverlay');
  if(overlay)overlay.style.display='none';
}

function editCollectionName(){
  const idx=collections.findIndex(c=>document.getElementById('collectionDetailName').textContent.includes(c.name));
  if(idx<0)return;
  const name=prompt('New name:',collections[idx].name);
  if(name&&name.trim()){
    collections[idx].name=name.trim();
    localStorage.setItem('wp_collections',JSON.stringify(collections));
    document.getElementById('collectionDetailName').textContent=collections[idx].name;
    buildCollections();
  }
}

// ═══════════════════════════════════════════════════
// Q&A — INLINE REDESIGN
// ═══════════════════════════════════════════════════
function submitInlineQA(){
  const inp=document.getElementById('qaInlineInput');
  if(!inp||!inp.value.trim())return;
  const question=inp.value.trim();
  inp.value='';
  const key=`wp_qa_${_communitySpotId||0}`;
  const qas=JSON.parse(localStorage.getItem(key)||'[]');
  qas.unshift({id:Date.now(),q:question,answers:[],ts:Date.now()});
  localStorage.setItem(key,JSON.stringify(qas));
  buildQA(_communitySpotId||0);
  showToast('Question posted');
}

function buildQA(spotId){
  const el=document.getElementById('qaList');
  if(!el)return;
  const key=`wp_qa_${spotId}`;
  const qas=JSON.parse(localStorage.getItem(key)||'[]');

  // Seed with sample questions for well-known spots
  const seeds={
    0:[{id:1,q:'Is the trail stroller-friendly?',answers:[{text:'Yes, it\'s a paved path all the way to the overlook.',helpful:3}],ts:1700000000000}],
    1:[{id:1,q:'What\'s the water temperature in late June?',answers:[{text:'Around 62–65°F — refreshing but not too cold.',helpful:5}],ts:1700000000000}],
    2:[{id:1,q:'Is there a weight limit for the rappel?',answers:[{text:'Max 250 lbs. The guided groups are capped at 12 people.',helpful:2}],ts:1700000000000}],
  };
  const allQA=[...(seeds[spotId]||[]),...qas];

  if(!allQA.length){
    el.innerHTML=`<div style="font-size:13px;color:var(--txt2);padding:12px 0;text-align:center">No questions yet. Be the first to ask!</div>`;
    return;
  }
  el.innerHTML=allQA.slice(0,8).map(item=>`
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:14px;padding:13px 14px;margin-bottom:10px">
      <div style="font-size:13px;font-weight:700;color:var(--txt0);margin-bottom:8px">${item.q}</div>
      ${(item.answers||[]).map(a=>`
        <div style="margin-left:12px;border-left:2px solid var(--border2);padding-left:10px;margin-bottom:6px">
          <div style="font-size:12px;color:var(--txt1);line-height:1.5">${a.text}</div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:5px">
            <button onclick="event.stopPropagation();this.innerHTML='+ '+((parseInt(this.innerHTML.replace(/\D+/g,''))||0)+1)" style="background:none;border:none;color:var(--txt3);font-size:11px;cursor:pointer;padding:0">+${a.helpful||0}</button>
            <button onclick="event.stopPropagation()" style="background:none;border:none;color:var(--txt3);font-size:11px;cursor:pointer;padding:0">-</button>
          </div>
        </div>`).join('')}
      <button onclick="replyToQA(${item.id},'${spotId}')" style="font-size:11px;color:var(--accent);background:none;border:none;cursor:pointer;padding:4px 0;font-weight:700;font-family:inherit">↩ Reply</button>
    </div>`).join('');
}

function replyToQA(qaId,spotId){
  const answer=prompt('Your answer:');
  if(!answer||!answer.trim())return;
  const key=`wp_qa_${spotId}`;
  const qas=JSON.parse(localStorage.getItem(key)||'[]');
  const qa=qas.find(q=>q.id===qaId);
  if(qa){qa.answers=(qa.answers||[]);qa.answers.push({text:answer.trim(),helpful:0});}
  localStorage.setItem(key,JSON.stringify(qas));
  buildQA(parseInt(spotId));
  showToast('Answer posted');
}

// ═══════════════════════════════════════════════════
// PHOTO MANAGEMENT
// ═══════════════════════════════════════════════════
function openPhotoPicker(){
  if(isGuest()){showLoginScreen(()=>openPhotoPicker());return;}
  // Reuse or create a hidden file input
  let inp=document.getElementById('photoPickerInput');
  if(!inp){
    inp=document.createElement('input');
    inp.type='file';
    inp.id='photoPickerInput';
    inp.accept='image/*';
    inp.multiple=true;
    inp.style.display='none';
    inp.onchange=handlePhotoUpload;
    document.body.appendChild(inp);
  }
  inp.click();
}

function handlePhotoUpload(e){
  const files=Array.from(e.target.files||[]);
  if(!files.length)return;
  // Prefer _detailSpotId (detail tab open) then fall back to _communitySpotId
  const spotId=_detailSpotId||_communitySpotId||0;
  const stored=JSON.parse(localStorage.getItem(`wp_photos_${spotId}`)||'[]');
  let loaded=0;
  files.forEach(file=>{
    const reader=new FileReader();
    reader.onload=ev=>{
      stored.push({url:ev.target.result,type:'community',credit:'My Photo'});
      loaded++;
      if(loaded===files.length){
        localStorage.setItem(`wp_photos_${spotId}`,JSON.stringify(stored));
        const allS=[...spots,...userSpots];
        const spot=allS.find(s=>s.id===spotId);
        if(spot)fetchSpotPhotos(spot);
        showToast(`${files.length} photo${files.length>1?'s':''} added`);
      }
    };
    reader.readAsDataURL(file);
  });
  e.target.value='';
}

// ═══════════════════════════════════════════════════
// OFFLINE DOWNLOAD — RESIZABLE WITH HANDLES
// ═══════════════════════════════════════════════════
let _offlineZoom=12;
let _offlineRect={top:15,left:8,bottom:35,right:8}; // percentages
let _offlineDragState=null;

function openOfflineDownload(){
  const overlay=document.getElementById('offlineDownloadOverlay');
  if(!overlay)return;
  overlay.classList.add('active');
  _renderOfflineRect();
  setTimeout(()=>{
    const panel=document.getElementById('offlinePanel');
    if(panel){
      _buildOfflinePanel(panel);
      panel.classList.add('show');
    }
  },50);
}

function _renderOfflineRect(){
  const rect=document.getElementById('offlineSelectRect');
  if(!rect)return;
  rect.style.cssText=`
    position:absolute;
    top:${_offlineRect.top}%;left:${_offlineRect.left}%;
    right:${_offlineRect.right}%;bottom:${_offlineRect.bottom}%;
    border:2px dashed rgba(196,149,106,.9);border-radius:10px;
    background:rgba(196,149,106,.07);
  `;
  // Add drag handles
  const handles=[
    {pos:'nw',style:'top:-6px;left:-6px;cursor:nw-resize'},
    {pos:'n', style:'top:-6px;left:50%;transform:translateX(-50%);cursor:n-resize'},
    {pos:'ne',style:'top:-6px;right:-6px;cursor:ne-resize'},
    {pos:'e', style:'top:50%;right:-6px;transform:translateY(-50%);cursor:e-resize'},
    {pos:'se',style:'bottom:-6px;right:-6px;cursor:se-resize'},
    {pos:'s', style:'bottom:-6px;left:50%;transform:translateX(-50%);cursor:s-resize'},
    {pos:'sw',style:'bottom:-6px;left:-6px;cursor:sw-resize'},
    {pos:'w', style:'top:50%;left:-6px;transform:translateY(-50%);cursor:w-resize'},
  ];
  rect.innerHTML=handles.map(h=>`
    <div data-handle="${h.pos}" style="position:absolute;width:12px;height:12px;background:var(--accent);border-radius:50%;${h.style};pointer-events:all;touch-action:none"></div>
  `).join('');
  // Attach drag events
  rect.querySelectorAll('[data-handle]').forEach(h=>{
    h.addEventListener('pointerdown',e=>{
      e.stopPropagation();e.preventDefault();
      _offlineDragState={handle:h.dataset.handle,startX:e.clientX,startY:e.clientY,startRect:{..._offlineRect}};
      h.setPointerCapture(e.pointerId);
    });
    h.addEventListener('pointermove',e=>{
      if(!_offlineDragState||_offlineDragState.handle!==h.dataset.handle)return;
      const overlay=document.getElementById('offlineDownloadOverlay');
      const ow=overlay.offsetWidth,oh=overlay.offsetHeight;
      const dx=(e.clientX-_offlineDragState.startX)/ow*100;
      const dy=(e.clientY-_offlineDragState.startY)/oh*100;
      const s=_offlineDragState.startRect;
      const pos=_offlineDragState.handle;
      const r={..._offlineRect};
      if(pos.includes('n'))r.top=Math.min(s.top+dy,100-s.bottom-5);
      if(pos.includes('s'))r.bottom=Math.min(s.bottom-dy,100-s.top-5);
      if(pos.includes('w'))r.left=Math.min(s.left+dx,100-s.right-5);
      if(pos.includes('e'))r.right=Math.min(s.right-dx,100-s.left-5);
      r.top=Math.max(0,Math.min(r.top,90));
      r.bottom=Math.max(0,Math.min(r.bottom,90));
      r.left=Math.max(0,Math.min(r.left,90));
      r.right=Math.max(0,Math.min(r.right,90));
      _offlineRect=r;
      _renderOfflineRect();
      _updateOfflineSize();
    });
    h.addEventListener('pointerup',()=>{_offlineDragState=null;});
  });
}

function _updateOfflineSize(){
  const el=document.getElementById('offlineSizeEst');
  const warn=document.getElementById('offlineSizeWarn');
  if(!el)return;
  const wPct=(100-_offlineRect.left-_offlineRect.right)/100;
  const hPct=(100-_offlineRect.top-_offlineRect.bottom)/100;
  const tiles=_estimateTileCount(wPct,hPct,8,_offlineZoom);
  const mb=Math.round(tiles*0.015);
  el.textContent=`~${Math.min(mb,999)} MB`;
  if(warn){warn.style.display=mb>500?'block':'none';}
}

function _estimateTileCount(wFrac,hFrac,zMin,zMax){
  let count=0;
  const b=leafletMap?leafletMap.getBounds():{};
  for(let z=zMin;z<=zMax;z++){
    const tilesWide=Math.pow(2,z);
    const w=Math.ceil(wFrac*tilesWide/3);
    const h=Math.ceil(hFrac*tilesWide/3);
    count+=w*h;
  }
  return Math.min(count,5000);
}

function _buildOfflinePanel(panel){
  _updateOfflineSize();
  panel.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-size:16px;font-weight:800;color:var(--txt0)">Download Area</div>
      <button onclick="closeOfflineDownload()" style="background:var(--bg3);border:none;color:var(--txt1);width:28px;height:28px;border-radius:50%;font-size:14px;cursor:pointer">×</button>
    </div>
    <p style="font-size:12px;color:var(--txt2);margin-bottom:12px">Pinch or double-tap to zoom the map, then drag the corner handles to resize the area.</p>
    <!-- Preset buttons -->
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <button onclick="setOfflinePreset('small')" style="flex:1;padding:8px;background:var(--bg2);border:1px solid var(--border2);color:var(--txt1);border-radius:10px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit"> Small</button>
      <button onclick="setOfflinePreset('medium')" style="flex:1;padding:8px;background:var(--bg2);border:1px solid var(--border2);color:var(--txt1);border-radius:10px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit"> City</button>
      <button onclick="setOfflinePreset('large')" style="flex:1;padding:8px;background:var(--bg2);border:1px solid var(--border2);color:var(--txt1);border-radius:10px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit"> Region</button>
    </div>
    <!-- Zoom slider -->
    <div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <div style="font-size:11px;font-weight:700;color:var(--txt2);text-transform:uppercase;letter-spacing:.5px">Max Zoom Detail</div>
        <div style="font-size:13px;font-weight:800;color:var(--accent)" id="offlineZoomLabel">z${_offlineZoom}</div>
      </div>
      <input type="range" min="8" max="18" value="${_offlineZoom}" id="offlineZoomSlider"
        style="width:100%;accent-color:var(--accent)"
        oninput="setOfflineZoom(parseInt(this.value))">
      <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--txt3);margin-top:2px"><span>z8 Overview</span><span>z18 Street</span></div>
    </div>
    <!-- Size estimate -->
    <div style="background:var(--bg2);border-radius:12px;padding:12px 14px;margin-bottom:10px;display:flex;justify-content:space-between">
      <div><div style="font-size:11px;color:var(--txt3);font-weight:700;text-transform:uppercase;letter-spacing:.5px">Est. Size</div><div style="font-size:16px;font-weight:800;color:var(--txt0);margin-top:2px" id="offlineSizeEst">~? MB</div></div>
      <div><div style="font-size:11px;color:var(--txt3);font-weight:700;text-transform:uppercase;letter-spacing:.5px">Zoom Range</div><div style="font-size:16px;font-weight:800;color:var(--txt0);margin-top:2px">z8–${_offlineZoom}</div></div>
    </div>
    <div id="offlineSizeWarn" style="display:none;background:rgba(196,82,74,.12);border:1px solid rgba(196,82,74,.25);border-radius:10px;padding:8px 12px;margin-bottom:10px;font-size:12px;color:var(--red)"> Area exceeds 500 MB — try a smaller zoom level or area</div>
    <input id="offlineAreaName" placeholder="Area name (e.g. Big Sur Coast)" style="width:100%;background:var(--bg2);border:1px solid var(--border2);color:var(--txt0);border-radius:10px;padding:10px 12px;font-size:13px;margin-bottom:12px;font-family:inherit;outline:none">
    <button onclick="startOfflineDownload()" style="width:100%;padding:14px;background:linear-gradient(135deg,var(--accent),var(--accent-dim));color:var(--bg0);font-size:15px;font-weight:800;border:none;border-radius:12px;cursor:pointer;font-family:inherit">Download Now</button>
  `;
  _updateOfflineSize();
}

function setOfflinePreset(size){
  const presets={
    small:{top:25,left:25,bottom:25,right:25},
    medium:{top:18,left:12,bottom:18,right:12},
    large:{top:10,left:5,bottom:10,right:5}
  };
  _offlineRect=presets[size]||presets.medium;
  _renderOfflineRect();
  _updateOfflineSize();
}

function setOfflineZoom(z){
  _offlineZoom=z;
  const label=document.getElementById('offlineZoomLabel');
  if(label)label.textContent=`z${z}`;
  const panel=document.getElementById('offlinePanel');
  const rangeEl=panel?.querySelector('#offlineZoomSlider');
  const rangeLabel=panel?.querySelector('#offlineZoomLabel+*');
  // Update zoom range display
  const zoneEl=panel?.querySelectorAll('[style*="Zoom Range"] + *');
  _updateOfflineSize();
}

// ═══════════════════════════════════════════════════
// ADD SPOT — NOMINATIM ADDRESS SEARCH
// ═══════════════════════════════════════════════════
let _aspAddressTimer=null;

function aspAddressSearch(val){
  clearTimeout(_aspAddressTimer);
  const drop=document.getElementById('aspAddressDrop');
  if(!val||!val.trim()){if(drop){drop.innerHTML='';drop.classList.remove('open');}return;}

  // Check if decimal coords
  const coordMatch=val.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
  if(coordMatch){
    const lat=parseFloat(coordMatch[1]),lng=parseFloat(coordMatch[2]);
    if(lat>=-90&&lat<=90&&lng>=-180&&lng<=180){
      drop.innerHTML=`<div class="search-result-item" onclick="aspFlyTo(${lat},${lng},'${lat.toFixed(4)}, ${lng.toFixed(4)}')">
        <div class="search-result-icon"></div>
        <div class="search-result-info">
          <div class="search-result-name">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
          <div class="search-result-meta">GPS Coordinates</div>
        </div>
      </div>`;
      drop.classList.add('open');
      return;
    }
  }

  _aspAddressTimer=setTimeout(async()=>{
    try{
      const url=`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(val)}&format=json&limit=5&countrycodes=us&addressdetails=1`;
      const r=await fetch(url,{headers:{'Accept-Language':'en-US,en'},signal:AbortSignal.timeout(4000)});
      const data=await r.json();
      if(!data.length){drop.innerHTML=`<div class="search-no-results">No results found</div>`;drop.classList.add('open');return;}
      drop.innerHTML=data.map(item=>{
        const name=item.display_name.split(',')[0];
        const sub=[item.address?.county,item.address?.state].filter(Boolean).join(', ');
        const icon=_nominatimIcon(item.type,item.class);
        return `<div class="search-result-item" onclick="aspFlyTo(${item.lat},${item.lon},'${name.replace(/'/g,"\\'")}')">
          <div class="search-result-icon">${icon}</div>
          <div class="search-result-info">
            <div class="search-result-name">${name}</div>
            <div class="search-result-meta">${sub||item.type||'Place'}</div>
          </div>
        </div>`;
      }).join('');
      drop.classList.add('open');
    }catch{}
  },350);
}

function aspFlyTo(lat,lng,name){
  // Close dropdown
  const drop=document.getElementById('aspAddressDrop');
  const inp=document.getElementById('aspAddressSearch');
  if(drop){drop.innerHTML='';drop.classList.remove('open');}
  if(inp)inp.value=name;

  // Set coords
  addSpotTempLat=parseFloat(lat);
  addSpotTempLng=parseFloat(lng);

  // Show location display
  const disp=document.getElementById('aspLocDisplay');
  if(disp){disp.textContent=`${parseFloat(lat).toFixed(5)}, ${parseFloat(lng).toFixed(5)}`;disp.style.display='block';}

  // Fly map to location
  if(leafletMap){
    leafletMap.flyTo([parseFloat(lat),parseFloat(lng)],15,{animate:true,duration:1});
    showToast('Location set — tap Add to Map to confirm');
  }
}

// ═══════════════════════════════════════════════════
// DATA FIXES — Spot audit helpers
// ═══════════════════════════════════════════════════
(()=>{
  spots.forEach(s=>{
    if(s.type==='hiking'&&s.name.includes('State')){
      if(s.entryFee&&s.entryFee.includes('/person'))s.entryFee='Check ahead';
    }
    if(!s.entryFee)s.entryFee='Check ahead';
    if(!s.parkingCost)s.parkingCost='Check ahead';
    if(!s.roadCondition)s.roadCondition='Unknown';
  });
})();

// ═══════════════════════════════════════════════════
// HOME TAB — DISCOVER / PLAN SWITCH
// ═══════════════════════════════════════════════════
function switchHomeTab(tab, el){
  document.querySelectorAll('.home-tab-pill').forEach(p=>p.classList.remove('active'));
  if(el)el.classList.add('active');
  const disc=document.getElementById('homeDiscoverPanel');
  const plan=document.getElementById('homePlanPanel');
  if(tab==='discover'){
    disc.style.display='block';
    plan.style.display='none';
  } else {
    disc.style.display='none';
    plan.style.display='block';
    // Inject plan form into home plan content if not yet built
    const content=document.getElementById('homePlanContent');
    if(!content.querySelector('.route-card')){
      content.innerHTML=_buildInlinePlanHTML();
    }
  }
}

function _buildInlinePlanHTML(){
  // Inject a simplified version of the plan screen
  return `
    <div style="font-size:22px;font-weight:700;color:var(--txt0);letter-spacing:-.4px;margin-bottom:4px">Route Planner</div>
    <div style="font-size:13px;color:var(--txt3);margin-bottom:20px">Enter start &amp; end — WildPath builds the route</div>
    <div class="route-card" style="margin-bottom:12px">
      <div class="route-input-stack">
        <div class="route-point-col">
          <div class="route-dot start-dot"></div>
          <div class="route-vert-line"></div>
          <div class="route-dot end-dot"></div>
        </div>
        <div class="route-fields">
          <div class="route-field-wrap">
            <div class="route-field-label">From</div>
            <div class="ac-wrap"><input class="route-field-input" id="hpRouteStart" placeholder="San Francisco, CA" type="text" autocomplete="off" oninput="acInput(this,'hpAcDropStart',false)"><div class="ac-drop" id="hpAcDropStart"></div></div>
          </div>
          <div class="route-separator"></div>
          <div class="route-field-wrap">
            <div class="route-field-label">To</div>
            <div class="ac-wrap"><input class="route-field-input" id="hpRouteEnd" placeholder="Yosemite Valley, CA" type="text" autocomplete="off" oninput="acInput(this,'hpAcDropEnd',false)"><div class="ac-drop" id="hpAcDropEnd"></div></div>
          </div>
        </div>
      </div>
    </div>
    <div style="margin-bottom:12px">
      <div style="font-size:12px;font-weight:600;color:var(--txt2);margin-bottom:8px;letter-spacing:.3px">TRIP DURATION</div>
      <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none" id="hpDurationRow">
        ${Array.from({length:14},(_,i)=>i+1).map(d=>`<div onclick="setTripDays(${d},null)" class="duration-pill${d===_tripDays?' active':''}" style="font-size:11px">${d}D</div>`).join('')}
        <div style="flex-shrink:0">
          <input type="number" min="1" max="30" placeholder="Custom" id="hpCustomDays"
            style="width:72px;height:34px;background:var(--bg2);border:1.5px solid var(--border2);border-radius:20px;color:var(--txt0);font-size:12px;font-family:var(--font);text-align:center;outline:none;padding:0 8px"
            oninput="setTripDaysCustom(this.value)">
        </div>
      </div>
    </div>
    <button class="btn-generate" onclick="_generateInlinePlan()" style="margin-bottom:16px">Plan My Route</button>
    <div id="hpItineraryOutput"></div>`;
}

function _onShowPlanScreen(){
  const container=document.getElementById('planScreenBody');
  if(container&&!container.dataset.built){
    container.innerHTML=_buildInlinePlanHTML();
    container.dataset.built='1';
    // Seed duration pills
    const row=document.getElementById('hpDurationRow');
    if(row){
      row.innerHTML=Array.from({length:14},(_,i)=>i+1).map(d=>
        `<div onclick="setTripDays(${d},null)" class="duration-pill${d===_tripDays?' active':''}" style="font-size:11px;flex-shrink:0">${d}D</div>`
      ).join('')+`<div style="flex-shrink:0"><input type="number" min="1" max="30" placeholder="Custom" id="hpCustomDays" style="width:72px;height:34px;background:var(--bg2);border:1.5px solid var(--border2);border-radius:20px;color:var(--txt0);font-size:12px;font-family:var(--font);text-align:center;outline:none;padding:0 8px" oninput="setTripDaysCustom(this.value)"></div>`;
    }
  }
}

async function _generateInlinePlan(){
  const start=(document.getElementById('hpRouteStart')?.value||'').trim();
  const end=(document.getElementById('hpRouteEnd')?.value||'').trim();
  const outEl=document.getElementById('itineraryOutput')||document.getElementById('hpItineraryOutput');
  if(outEl)outEl.innerHTML='<div style="text-align:center;padding:24px;color:var(--txt3);font-size:13px">Building your route…</div>';
  if(!start&&!end){
    renderItinerary(DEFAULT_ROUTE,_tripDays);
    return;
  }
  // Match known routes first
  if(start||end){
    const q=(start+' '+end).toLowerCase();
    const matched=TRIP_ROUTES.find(r=>
      r.startKw.some(k=>q.includes(k))&&r.endKw.some(k=>q.includes(k))
    );
    if(matched){renderItinerary(matched,_tripDays);return;}
  }
  // Geocode and build dynamic route
  showToast('Geocoding route…');
  const[startGeo,endGeo]=await Promise.all([
    start?geocodeLocation(start):Promise.resolve({lat:37.7749,lng:-122.4194,name:'San Francisco'}),
    end?geocodeLocation(end):Promise.resolve({lat:37.8651,lng:-119.5383,name:'Yosemite'})
  ]);
  if(!startGeo||!endGeo){showToast('Could not find one of those locations');return;}
  const routeSpots=findSpotsAlongRoute(startGeo,endGeo);
  renderDynamicItinerary(startGeo,endGeo,routeSpots,_tripDays,start,end);
}

// ═══════════════════════════════════════════════════
// COMPASS FULL-SCREEN PANEL
// ═══════════════════════════════════════════════════
let _compassPanelActive=false;
let _compassOriented=false;
let _compassHeading=0;
let _compassWatchId=null;
let _compassAnimId=null;
let _compassGpsWatchId=null;

function openCompassPanel(){
  const panel=document.getElementById('compassPanel');
  if(!panel)return;
  panel.classList.add('open');
  _compassPanelActive=true;
  // Draw fixed outer ring once
  _drawCompassOuter();
  // Draw inner rose at 0°
  _drawCompassFace(0);
  _startCompassGPS();
  // iOS 13+ requires user-gesture permission for DeviceOrientation
  if(typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function'){
    // Show the permission button; auto-request may not work without user gesture
    const permBtn=document.getElementById('compassPermBtn');
    if(permBtn)permBtn.style.display='block';
    document.getElementById('compassCardinalVal').textContent='TAP TO ENABLE';
  } else {
    _bindCompassOrientation();
  }
}

function _requestCompassPermission(){
  const permBtn=document.getElementById('compassPermBtn');
  if(permBtn)permBtn.style.display='none';
  if(typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function'){
    DeviceOrientationEvent.requestPermission().then(state=>{
      if(state==='granted'){
        _bindCompassOrientation();
      } else {
        document.getElementById('compassCardinalVal').textContent='PERMISSION DENIED';
      }
    }).catch(()=>_bindCompassOrientation());
  } else {
    _bindCompassOrientation();
  }
}

function closeCompassPanel(){
  const panel=document.getElementById('compassPanel');
  if(panel)panel.classList.remove('open');
  _compassPanelActive=false;
  if(_compassWatchId!==null){window.removeEventListener('deviceorientation',_onCompassOrientation);_compassWatchId=null;}
  if(_compassGpsWatchId!==null){navigator.geolocation.clearWatch(_compassGpsWatchId);_compassGpsWatchId=null;}
  if(_compassAnimId){cancelAnimationFrame(_compassAnimId);_compassAnimId=null;}
}

function _bindCompassOrientation(){
  _compassWatchId=1;
  window.addEventListener('deviceorientation',_onCompassOrientation,true);
}

function _onCompassOrientation(e){
  let heading=0;
  if(e.webkitCompassHeading!=null){heading=e.webkitCompassHeading;}
  else if(e.alpha!=null){heading=(360-e.alpha)%360;}
  _compassHeading=heading;
  if(!_compassAnimId)_compassAnimId=requestAnimationFrame(_updateCompassDisplay);
}

function _updateCompassDisplay(){
  _compassAnimId=null;
  if(!_compassPanelActive)return;
  const h=_compassHeading;
  const cardinals=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  const card=cardinals[Math.round(h/22.5)%16];
  document.getElementById('compassHeadingVal').textContent=`${Math.round(h)}°`;
  document.getElementById('compassCardinalVal').textContent=card;
  // Rotate only inner canvas via CSS — no redraw needed every frame
  const inner=document.getElementById('compassRingCanvas');
  if(inner)inner.style.transform=`rotate(${-h}deg)`;
}

function _startCompassGPS(){
  if(!navigator.geolocation)return;
  const update=pos=>{
    const lat=pos.coords.latitude.toFixed(5);
    const lng=pos.coords.longitude.toFixed(5);
    const el=document.getElementById('compassCoordsVal');
    if(el)el.textContent=`${lat}° N,  ${lng}° W`;
    const alt=pos.coords.altitude;
    const altEl=document.getElementById('compassAltVal');
    if(altEl){
      if(alt!=null){
        const ftVal=Math.round(alt*3.28084);
        altEl.textContent=`Altitude: ${Math.round(alt)} m  (${ftVal} ft)`;
      } else {
        altEl.textContent='Altitude: —';
      }
    }
  };
  update({coords:{latitude:0,longitude:0,altitude:null}}); // placeholder
  _compassGpsWatchId=navigator.geolocation.watchPosition(update,()=>{},{enableHighAccuracy:true,maximumAge:2000});
}

// Draw fixed outer ring — called once when compass opens, never redrawn
function _drawCompassOuter(){
  const canvas=document.getElementById('compassOuterCanvas');
  if(!canvas)return;
  const ctx=canvas.getContext('2d');
  const W=280,H=280,cx=140,cy=140,R=120;
  ctx.clearRect(0,0,W,H);

  // Outer ring border
  ctx.beginPath();ctx.arc(cx,cy,R+2,0,Math.PI*2);
  ctx.strokeStyle='rgba(255,255,255,.12)';ctx.lineWidth=1;ctx.stroke();

  // Degree tick marks on outer ring (fixed, never rotate)
  for(let deg=0;deg<360;deg+=5){
    const rad=(deg-90)*Math.PI/180;
    const isMajor=deg%45===0,isMed=deg%15===0;
    const r1=isMajor?R-12:isMed?R-7:R-4;
    const r2=R+2;
    ctx.beginPath();
    ctx.moveTo(cx+Math.cos(rad)*r1,cy+Math.sin(rad)*r1);
    ctx.lineTo(cx+Math.cos(rad)*r2,cy+Math.sin(rad)*r2);
    ctx.strokeStyle=isMajor?'rgba(255,255,255,.6)':'rgba(255,255,255,.2)';
    ctx.lineWidth=isMajor?1.5:0.7;
    ctx.stroke();
  }

  // Fixed N/S/E/W cardinal labels — always facing up, never rotate
  ctx.font='bold 15px -apple-system,sans-serif';
  ctx.textAlign='center';ctx.textBaseline='middle';
  const cardFixed=[
    {deg:0,  label:'N',color:'#E05252'},
    {deg:90, label:'E',color:'rgba(200,184,168,.72)'},
    {deg:180,label:'S',color:'rgba(200,184,168,.72)'},
    {deg:270,label:'W',color:'rgba(200,184,168,.72)'},
  ];
  cardFixed.forEach(({deg,label,color})=>{
    const rad=(deg-90)*Math.PI/180;
    const lx=cx+Math.cos(rad)*(R-24);
    const ly=cy+Math.sin(rad)*(R-24);
    ctx.fillStyle=color;
    ctx.fillText(label,lx,ly);
  });

  // Fixed NE/SE/SW/NW intercardinal labels
  ctx.font='600 9px -apple-system,sans-serif';
  [{deg:45,label:'NE'},{deg:135,label:'SE'},{deg:225,label:'SW'},{deg:315,label:'NW'}].forEach(({deg,label})=>{
    const rad=(deg-90)*Math.PI/180;
    const lx=cx+Math.cos(rad)*(R-22);
    const ly=cy+Math.sin(rad)*(R-22);
    ctx.fillStyle='rgba(200,184,168,.4)';
    ctx.fillText(label,lx,ly);
  });
}

// Draw rotating inner compass rose — only needle and inner fill, no labels
// The canvas element itself is rotated via CSS transform, not by redrawing
function _drawCompassFace(heading){
  const canvas=document.getElementById('compassRingCanvas');
  if(!canvas)return;
  const ctx=canvas.getContext('2d');
  const W=280,H=280,cx=140,cy=140,R=100;
  ctx.clearRect(0,0,W,H);

  // Inner circle background
  ctx.beginPath();ctx.arc(cx,cy,R+4,0,Math.PI*2);
  ctx.fillStyle='rgba(22,25,22,.9)';ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,.08)';ctx.lineWidth=1;ctx.stroke();

  // 8-point rose petals (background)
  for(let i=0;i<8;i++){
    const rad=(i*45-90)*Math.PI/180;
    ctx.save();ctx.translate(cx,cy);ctx.rotate(rad);
    ctx.beginPath();
    ctx.moveTo(0,-R+4);ctx.lineTo(5,-R+20);ctx.lineTo(0,-R+30);ctx.lineTo(-5,-R+20);
    ctx.closePath();
    ctx.fillStyle=i===0?'rgba(224,82,82,.12)':'rgba(255,255,255,.04)';
    ctx.fill();
    ctx.restore();
  }

  // Needle — north (top of canvas = up = magnetic north when rotated)
  // Red north half — points up (toward magnetic north)
  ctx.save();ctx.translate(cx,cy);
  ctx.beginPath();ctx.moveTo(0,-R+10);ctx.lineTo(8,0);ctx.lineTo(0,14);ctx.lineTo(-8,0);
  ctx.closePath();
  ctx.fillStyle='#E05252';ctx.fill();
  // White south half
  ctx.beginPath();ctx.moveTo(0,14);ctx.lineTo(8,0);ctx.lineTo(0,R-10);ctx.lineTo(-8,0);
  ctx.closePath();
  ctx.fillStyle='rgba(255,255,255,.55)';ctx.fill();
  ctx.restore();

  // Center cap
  ctx.beginPath();ctx.arc(cx,cy,8,0,Math.PI*2);
  ctx.fillStyle='#B8E87A';ctx.fill();
  ctx.beginPath();ctx.arc(cx,cy,4,0,Math.PI*2);
  ctx.fillStyle='#0f1a0a';ctx.fill();
}

// ═══════════════════════════════════════════════════
// 3D TERRAIN — Satellite and Hybrid only
// Uses Mapbox DEM terrain-v1 tiles
// ═══════════════════════════════════════════════════
let _map3dOn=false;

function _enable3DTerrain(){
  if(!map)return;
  console.log('[3D] Enabling terrain...');
  // Step 1: remove old DEM source if it exists
  if(map.getSource('mapbox-dem')){
    try{map.removeSource('mapbox-dem');}catch(e){}
  }
  // Step 2: add fresh DEM source
  map.addSource('mapbox-dem',{
    type:'raster-dem',
    url:'mapbox://mapbox.mapbox-terrain-dem-v1',
    tileSize:512,
    maxzoom:14
  });
  // Step 3: set terrain — maximum quality exaggeration
  map.setTerrain({source:'mapbox-dem', exaggeration:1.8});
  // Step 4: smooth pitch transition to 50°
  map.easeTo({pitch:50, duration:1000, essential:true});
  // Step 5: enhanced sky layer
  if(!map.getLayer('sky')){
    try{
      map.addLayer({
        id:'sky', type:'sky',
        paint:{
          'sky-type':'atmosphere',
          'sky-atmosphere-color':'rgba(220,235,255,1)',
          'sky-atmosphere-halo-color':'rgba(180,210,255,0.8)',
          'sky-atmosphere-sun':[0.0,90.0],
          'sky-atmosphere-sun-intensity':15
        }
      });
    }catch(e){}
  }
  // Step 6: atmospheric fog for depth
  try{
    map.setFog({
      color:'white',
      'high-color':'#245bde',
      'horizon-blend':0.04,
      'space-color':'#0b0b19',
      'star-intensity':0.15
    });
  }catch(e){}
  // Step 7: 3D building extrusions at zoom 15+
  if(!map.getLayer('3d-buildings')){
    try{
      map.addLayer({
        id:'3d-buildings',
        source:'composite',
        'source-layer':'building',
        filter:['==','extrude','true'],
        type:'fill-extrusion',
        minzoom:15,
        paint:{
          'fill-extrusion-color':'#aaa',
          'fill-extrusion-height':['interpolate',['linear'],['zoom'],15,0,15.05,['get','height']],
          'fill-extrusion-base':['interpolate',['linear'],['zoom'],15,0,15.05,['get','min_height']],
          'fill-extrusion-opacity':0.6
        }
      });
    }catch(e){}
  }
  console.log('[3D] Terrain enabled — exaggeration 1.8, pitch 50°, fog + buildings');
}

function _disable3DTerrain(){
  if(!map)return;
  console.log('[3D] Disabling terrain...');
  // Remove terrain
  try{map.setTerrain(null);}catch(e){}
  // Flatten pitch
  map.easeTo({pitch:0, duration:800, essential:true});
  // Remove sky layer
  try{if(map.getLayer('sky'))map.removeLayer('sky');}catch(e){}
  // Remove building extrusions
  try{if(map.getLayer('3d-buildings'))map.removeLayer('3d-buildings');}catch(e){}
  // Clear fog
  try{map.setFog({});}catch(e){}
  // Remove DEM source
  try{if(map.getSource('mapbox-dem'))map.removeSource('mapbox-dem');}catch(e){}
  console.log('[3D] Terrain disabled');
}

function toggle3DMap(){
  if(!map)return;
  // 3D only available on satellite / hybrid
  if(currentStyle!=='satellite'&&currentStyle!=='hybrid'){
    showToast('Switch to Satellite or Hybrid for 3D terrain');
    return;
  }
  _map3dOn=!_map3dOn;
  const label=document.getElementById('map3dLabel');

  if(_map3dOn){
    _enable3DTerrain();
    if(label)label.textContent='Disable 3D';
    showToast('3D terrain on');
  } else {
    _disable3DTerrain();
    if(label)label.textContent='Enable 3D';
    showToast('2D view restored');
  }
}

// ═══════════════════════════════════════════════════
// SETTINGS FULL-SCREEN
// ═══════════════════════════════════════════════════
function openSettingsFull(){
  const overlay=document.getElementById('settingsFullOverlay');
  if(!overlay)return;
  _buildSettingsFull();
  overlay.classList.add('open');
}

function closeSettingsFull(){
  const overlay=document.getElementById('settingsFullOverlay');
  if(overlay)overlay.classList.remove('open');
}

function _buildSettingsFull(){
  const body=document.getElementById('settingsFullBody');
  if(!body)return;
  const locGranted=localStorage.getItem('wp_location_granted')==='1';
  const isDark=!document.body.classList.contains('light-mode');
  const notifOn=localStorage.getItem('wp_notif')==='1';
  const notifComm=localStorage.getItem('wp_notif_comm')==='1';
  const notifMsg=localStorage.getItem('wp_notif_msg')==='1';
  const units=localStorage.getItem('wp_units')||'miles';
  const offlineAreas=JSON.parse(localStorage.getItem('wp_offline_areas')||'[]');
  const _msKey=localStorage.getItem('wp_map_style')||'standard';
  const mapStyle=_msKey.charAt(0).toUpperCase()+_msKey.slice(1);
  const shareLocOn=localStorage.getItem('wp_share_location')==='1';

  const mapStyleRow=`<div class="sf-row">
    <div class="sf-row-icon"></div>
    <div class="sf-row-info"><div class="sf-row-label">Map Style</div><div class="sf-row-val" style="font-size:11px;color:var(--txt3)">${mapStyle}</div></div>
    <div style="display:flex;gap:4px;align-items:center">
      ${['Standard','Terrain','Satellite','Hybrid'].map(s=>`<div onclick="_sfSetMapStyle('${s}')" style="padding:5px 8px;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;background:${mapStyle===s?'var(--accent)':'var(--bg3)'};color:${mapStyle===s?'#0f1a0a':'var(--txt2)'}">${s}</div>`).join('')}
    </div>
  </div>`;

  const offlineMapsHtml=offlineAreas.length?offlineAreas.map((a,i)=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
    <div>
      <div style="font-size:13px;color:var(--txt0)">${sanitize(a.name)||'Downloaded Area '+(i+1)}</div>
      <div style="font-size:11px;color:var(--txt3)">${a.sizeMB?a.sizeMB+' MB · ':''}${a.date||''}</div>
    </div>
    <div style="display:flex;gap:4px;flex-shrink:0">
      <div onclick="_sfViewOffline(${i})" style="color:var(--accent);font-size:13px;font-weight:600;cursor:pointer;padding:4px 8px">View</div>
      <div onclick="_sfDeleteOffline(${i})" style="color:var(--red);font-size:13px;font-weight:600;cursor:pointer;padding:4px 8px">Remove</div>
    </div>
  </div>`).join(''):'<div style="font-size:12px;color:var(--txt3);padding:8px 0">No areas downloaded</div>';

  body.innerHTML=`
    <div class="settings-section-head">Preferences</div>
    ${_sfRow('','Dark Mode','',isDark?'On':'Off','_sfToggleDark()',isDark,true)}
    ${_sfRow('','Units','',units==='miles'?'Miles':'Kilometers','_sfToggleUnits()',units==='miles',true)}
    ${mapStyleRow}

    <div class="settings-section-head">Location & Services</div>
    <div class="sf-row" onclick="_sfLocation()">
      <div class="sf-row-icon"></div>
      <div class="sf-row-info">
        <div class="sf-row-label">Location Services</div>
        <div class="sf-row-val" style="font-size:11px;color:${locGranted?'#B8E87A':'var(--red)'}">${locGranted?'Enabled':'Tap to enable'}</div>
      </div>
      <div class="sf-row-right"><span style="font-size:13px;color:var(--txt3)">${locGranted?'On':'Off'}</span> <span>›</span></div>
    </div>
    ${_sfRow('','Share My Location with Friends','Visible on Friends Map',shareLocOn?'On':'Off','_sfToggleShareLoc()',shareLocOn,true)}
    <div class="sf-row" onclick="openOfflineDownload()">
      <div class="sf-row-icon"></div>
      <div class="sf-row-info"><div class="sf-row-label">Offline Maps</div><div class="sf-row-val">${offlineAreas.length} area${offlineAreas.length!==1?'s':''} downloaded</div></div>
      <div class="sf-row-right"><span>›</span></div>
    </div>
    ${offlineAreas.length?`<div style="padding:0 16px 8px;background:var(--bg0)">${offlineMapsHtml}<div onclick="_sfDownloadCurrentView()" style="margin-top:8px;padding:10px;background:var(--bg2);border-radius:10px;text-align:center;font-size:13px;font-weight:600;color:var(--accent);cursor:pointer">Download Current Map View</div></div>`:'<div style="padding:0 16px 8px"><div onclick="_sfDownloadCurrentView()" style="padding:10px;background:var(--bg2);border-radius:10px;text-align:center;font-size:13px;font-weight:600;color:var(--accent);cursor:pointer">Download Current Map View</div></div>'}

    <div class="settings-section-head">Notifications</div>
    ${_sfRow('','New Spots Nearby','','',''  ,notifOn,true).replace('onclick=""','onclick="_sfToggleNotif()"')}
    ${_sfRow('','Community Activity','','',''  ,notifComm,true).replace('onclick=""','onclick="_sfToggleNotifComm()"')}
    ${_sfRow('','Messages','','',''  ,notifMsg,true).replace('onclick=""','onclick="_sfToggleNotifMsg()"')}

    <div class="settings-section-head">Account</div>
    ${_sfRow('','Change Username','','','_sfChangeUsername()')}
    ${_sfRow('','Change Password','','','_sfChangePassword()')}
    ${_sfRow('','Share Profile','Generate a shareable card','','shareProfile()')}
    <div class="sf-row" onclick="_sfSignOut()" style="cursor:pointer">
      <div class="sf-row-icon"></div>
      <div class="sf-row-info"><div class="sf-row-label" style="color:var(--red)">Sign Out</div></div>
      <div class="sf-row-right"><span>›</span></div>
    </div>

    <div class="settings-section-head">App Info</div>
    ${_sfRow('','Legal Info','Terms, Privacy, Licenses','','_sfOpenLegal()')}
    ${_sfRow('','Help & Support','','','openSettingsPanel("help")')}
    <div class="sf-row" style="cursor:default">
      <div class="sf-row-icon"></div>
      <div class="sf-row-info">
        <div class="sf-row-label">App Version</div>
        <div class="sf-row-val">1.0.0 Beta</div>
      </div>
    </div>
  `;
}

function _sfRow(icon,label,sub,val,action,toggleState,isToggle=false){
  const toggleHTML=isToggle?`
    <button class="sf-toggle ${toggleState?'on':''}" onclick="${action};_buildSettingsFull()">
      <div class="sf-toggle-knob"></div>
    </button>`:
    `<div class="sf-row-right">
      ${val?`<span style="font-size:13px;color:var(--txt3)">${val}</span> `:''}
      <span>›</span>
    </div>`;
  return `<div class="sf-row" onclick="${isToggle?'':action}">
    <div class="sf-row-icon">${icon}</div>
    <div class="sf-row-info">
      <div class="sf-row-label">${label}</div>
      ${sub?`<div class="sf-row-val">${sub}</div>`:''}
    </div>
    ${toggleHTML}
  </div>`;
}

function _sfToggleDark(){
  const isLight=document.body.classList.contains('light-mode');
  if(isLight){document.body.classList.remove('light-mode');localStorage.setItem('wp_theme','dark');}
  else{document.body.classList.add('light-mode');localStorage.setItem('wp_theme','light');}
  _buildSettingsFull();
}
function _sfToggleUnits(){
  const cur=localStorage.getItem('wp_units')||'miles';
  localStorage.setItem('wp_units',cur==='miles'?'km':'miles');
  showToast(cur==='miles'?'Switched to kilometers':'Switched to miles');
  _buildSettingsFull();
}
function _sfToggleNotif(){
  const cur=localStorage.getItem('wp_notif')==='1';
  localStorage.setItem('wp_notif',cur?'0':'1');
  showToast(cur?'Notifications off':'New spots alerts on');
  _buildSettingsFull();
}
function _sfToggleNotifComm(){
  const cur=localStorage.getItem('wp_notif_comm')==='1';
  localStorage.setItem('wp_notif_comm',cur?'0':'1');
  showToast(cur?'Community alerts off':'Community activity alerts on');
  _buildSettingsFull();
}
function _sfToggleNotifMsg(){
  const cur=localStorage.getItem('wp_notif_msg')==='1';
  localStorage.setItem('wp_notif_msg',cur?'0':'1');
  showToast(cur?'Message alerts off':'Message alerts on');
  _buildSettingsFull();
}
function _sfLocation(){
  navigator.geolocation.getCurrentPosition(
    ()=>{localStorage.setItem('wp_location_granted','1');showToast('Location enabled');_buildSettingsFull();},
    ()=>showToast('Location access denied — check device settings')
  );
}
function _sfSetMapStyle(s){
  const keyMap={Standard:'standard',Terrain:'terrain',Satellite:'satellite',Hybrid:'hybrid'};
  if(typeof setMapStyle==='function'&&keyMap[s])setMapStyle(keyMap[s]);
  showToast('Map style: '+s);
  _buildSettingsFull();
}
function _sfViewOffline(i){
  const areas=JSON.parse(localStorage.getItem('wp_offline_areas')||'[]');
  const a=areas[i];
  if(!a||!map)return;
  closeSettingsFull();
  showTab('map');
  setTimeout(()=>{
    if(a.bounds)map.fitBounds([[a.bounds.sw.lng,a.bounds.sw.lat],[a.bounds.ne.lng,a.bounds.ne.lat]],{padding:40,duration:800});
    showToast(`Viewing "${a.name||'downloaded area'}"`);
  },350);
}
function _sfDeleteOffline(i){
  const areas=JSON.parse(localStorage.getItem('wp_offline_areas')||'[]');
  areas.splice(i,1);
  localStorage.setItem('wp_offline_areas',JSON.stringify(areas));
  showToast('Offline area removed');
  _buildSettingsFull();
}
function _pulseAtLocation(lat,lng){
  if(!map)return;
  const el=document.createElement('div');
  el.className='pin-pulse-marker';
  const marker=new mapboxgl.Marker({element:el,anchor:'center'}).setLngLat([lng,lat]).addTo(map);
  setTimeout(()=>{try{marker.remove();}catch(e){}},2900);
}

function openSavedPlacesSheet(){
  const existing=document.getElementById('_savedPlacesSheet');
  if(existing){existing.remove();return;}
  const sheet=document.createElement('div');
  sheet.id='_savedPlacesSheet';
  sheet.style.cssText='position:absolute;inset:0;z-index:800;background:rgba(0,0,0,.75);display:flex;align-items:flex-end';
  sheet.onclick=(e)=>{if(e.target===sheet)sheet.remove();};
  const inner=document.createElement('div');
  inner.style.cssText='background:var(--bg1);border-radius:20px 20px 0 0;width:100%;max-height:75vh;overflow-y:auto;padding:0 0 calc(env(safe-area-inset-bottom,0px)+16px);display:flex;flex-direction:column';
  inner.innerHTML=`
    <div style="padding:16px 14px 10px;border-bottom:1px solid var(--border);flex-shrink:0">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="font-size:16px;font-weight:700;color:var(--txt0)">My Saved Places</div>
        <button onclick="document.getElementById('_savedPlacesSheet').remove()" style="background:var(--bg2);border:1px solid var(--border);color:var(--txt1);border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:14px">×</button>
      </div>
      <input id="savedPlacesSearch" placeholder="Search saved places…" oninput="_filterSavedPlaces(this.value)" style="width:100%;height:38px;background:var(--bg2);border:1px solid var(--border2);border-radius:10px;color:var(--txt0);padding:0 12px;font-size:13px;outline:none;font-family:var(--font)">
    </div>
    <div id="savedPlacesList" style="flex:1;overflow-y:auto"></div>
  `;
  sheet.appendChild(inner);
  document.getElementById('app').appendChild(sheet);
  _renderSavedPlacesList('');
}

function _renderSavedPlacesList(filter){
  const listEl=document.getElementById('savedPlacesList');
  if(!listEl)return;
  const q=(filter||'').toLowerCase();
  const allS=[...spots,...userSpots];
  const folders=_getSavedFolders();
  const personal=(typeof personalSpots!=='undefined'?personalSpots:[]);
  const hikes=(typeof savedHikes!=='undefined'?savedHikes:[]);

  const rowHtml=(name,sub,lat,lng,iconSvg)=>`
    <div onclick="_flyToSavedPlace(${lat},${lng})" style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-bottom:1px solid var(--border);cursor:pointer">
      <div style="width:40px;height:40px;border-radius:10px;background:var(--bg3);display:flex;align-items:center;justify-content:center;flex-shrink:0">${iconSvg}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:600;color:var(--txt0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${sanitize(name)}</div>
        <div style="font-size:11px;color:var(--txt3);margin-top:1px">${sub}</div>
      </div>
    </div>`;

  const bookmarkIcon='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
  const pinIcon='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#D4A843" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
  const hikeIcon='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--accent)" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';

  let html='';

  // Folders (each expandable inline to its saved spots)
  const filteredFolders=folders.filter(f=>!q||f.name.toLowerCase().includes(q));
  if(filteredFolders.length){
    html+=`<div style="padding:10px 14px 4px;font-size:11px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px">Saved Folders</div>`;
    html+=filteredFolders.map(f=>rowHtml(f.name,`${(f.postIds||[]).length} saved`,
      allS.find(s=>f.postIds?.includes(s.id))?.lat||37.8, allS.find(s=>f.postIds?.includes(s.id))?.lng||-122.4, bookmarkIcon)).join('');
  }

  // Flat saved spots (from saved_spots ids, resolved against known spots)
  const savedIds=getSavedSpotIds();
  const savedResolved=savedIds.map(id=>allS.find(s=>String(s.id)===String(id))).filter(Boolean).filter(s=>!q||s.name.toLowerCase().includes(q));
  if(savedResolved.length){
    html+=`<div style="padding:10px 14px 4px;font-size:11px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px">Saved Spots</div>`;
    html+=savedResolved.map(s=>rowHtml(s.name,s.typeLabel||'Spot',s.lat,s.lng,bookmarkIcon)).join('');
  }

  // Personal spots (populated once Section 1's personal_spots table is wired up)
  const filteredPersonal=personal.filter(s=>!q||s.name.toLowerCase().includes(q));
  if(filteredPersonal.length){
    html+=`<div style="padding:10px 14px 4px;font-size:11px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px">Personal Spots</div>`;
    html+=filteredPersonal.map(s=>rowHtml(s.name,'Personal',s.lat,s.lng,pinIcon)).join('');
  }

  // Saved hikes (populated once Section 8/9's hikes table is wired up)
  const filteredHikes=hikes.filter(h=>!q||h.name.toLowerCase().includes(q));
  if(filteredHikes.length){
    html+=`<div style="padding:10px 14px 4px;font-size:11px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px">Saved Hikes</div>`;
    html+=filteredHikes.map(h=>rowHtml(h.name,(h.distance||'')+' mi',h.startLat,h.startLng,hikeIcon)).join('');
  }

  if(!html){
    html=`<div style="padding:40px 20px;text-align:center;color:var(--txt3);font-size:13px">${q?'No matches found':'Nothing saved yet — bookmark a spot to see it here'}</div>`;
  }
  listEl.innerHTML=html;
}

function _filterSavedPlaces(val){_renderSavedPlacesList(val);}

function _flyToSavedPlace(lat,lng){
  document.getElementById('_savedPlacesSheet')?.remove();
  if(!map||lat==null||lng==null)return;
  map.flyTo({center:[lng,lat],zoom:15,duration:900,essential:true});
  setTimeout(()=>_pulseAtLocation(lat,lng),950);
}

function openMyDownloadsSheet(){
  const areas=JSON.parse(localStorage.getItem('wp_offline_areas')||'[]');
  const existing=document.getElementById('_myDownloadsSheet');
  if(existing)existing.remove();
  const sheet=document.createElement('div');
  sheet.id='_myDownloadsSheet';
  sheet.style.cssText='position:absolute;inset:0;z-index:800;background:rgba(0,0,0,.75);display:flex;align-items:flex-end';
  sheet.onclick=(e)=>{if(e.target===sheet)sheet.remove();};
  sheet.innerHTML=`<div style="background:var(--bg1);border-radius:20px 20px 0 0;width:100%;max-height:75vh;overflow-y:auto;padding:0 0 calc(env(safe-area-inset-bottom,0px)+16px)">
    <div style="padding:16px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
      <div style="font-size:16px;font-weight:700;color:var(--txt0)">My Downloads</div>
      <button onclick="document.getElementById('_myDownloadsSheet').remove()" style="background:var(--bg2);border:1px solid var(--border);color:var(--txt1);border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:14px">×</button>
    </div>
    ${areas.length?areas.map((a,i)=>`
      <div onclick="_flyToDownloadedArea(${i})" style="padding:12px 14px;border-bottom:1px solid var(--border);cursor:pointer;display:flex;gap:12px;align-items:center">
        <div style="width:44px;height:44px;border-radius:12px;background:var(--bg3);display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--accent)" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
        </div>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:700;color:var(--txt0)">${sanitize(a.name)||'Downloaded Area'}</div>
          <div style="font-size:12px;color:var(--txt3);margin-top:2px">${a.sizeMB?a.sizeMB+' MB · ':''}${a.date||''}</div>
        </div>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--txt3)" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>`).join(''):`<div style="padding:32px;text-align:center;color:var(--txt3);font-size:13px">No areas downloaded yet.<br><br><span onclick="document.getElementById('_myDownloadsSheet')?.remove();openOfflineDownload()" style="color:var(--accent);font-weight:700;cursor:pointer">Download an area →</span></div>`}
  </div>`;
  document.getElementById('app').appendChild(sheet);
}
function _flyToDownloadedArea(i){
  const areas=JSON.parse(localStorage.getItem('wp_offline_areas')||'[]');
  const a=areas[i];
  document.getElementById('_myDownloadsSheet')?.remove();
  if(!a?.bounds||!map)return;
  map.fitBounds([[a.bounds.sw.lng,a.bounds.sw.lat],[a.bounds.ne.lng,a.bounds.ne.lat]],{padding:40,duration:800});
  showToast(`Viewing "${a.name||'downloaded area'}"`);
}

function _sfDownloadCurrentView(){
  const bounds=leafletMap.getBounds();
  const ne=bounds.getNorthEast();const sw=bounds.getSouthWest();
  const areas=JSON.parse(localStorage.getItem('wp_offline_areas')||'[]');
  const allS=[...spots,...userSpots];
  const spotIds=allS.filter(s=>s.lat>=sw.lat&&s.lat<=ne.lat&&s.lng>=sw.lng&&s.lng<=ne.lng).map(s=>s.id);
  const zoom=map?Math.round(map.getZoom()):12;
  const tileUrls=map?_getTileUrlsForBounds(bounds,8,zoom):[];
  const sizeMB=Math.min(Math.round(tileUrls.length*0.015),999);
  areas.push({name:`Area ${areas.length+1}`,date:new Date().toLocaleDateString(),sizeMB,zoomRange:`z8–${zoom}`,bounds:{ne,sw},tileUrls,spotIds,createdAt:Date.now()});
  localStorage.setItem('wp_offline_areas',JSON.stringify(areas));
  showToast('Map view saved for offline use');
  _buildSettingsFull();
}
function _sfToggleShareLoc(){
  const cur=localStorage.getItem('wp_share_location')==='1';
  if(!cur){
    navigator.geolocation.getCurrentPosition(
      pos=>{
        localStorage.setItem('wp_share_location','1');
        localStorage.setItem('wildpath-user-location-'+_myUid(),JSON.stringify({lat:pos.coords.latitude,lng:pos.coords.longitude,ts:Date.now()}));
        showToast('Location sharing enabled');
        _buildSettingsFull();
        // Start interval
        if(window._locShareInterval)clearInterval(window._locShareInterval);
        window._locShareInterval=setInterval(()=>{
          if(localStorage.getItem('wp_share_location')!=='1'){clearInterval(window._locShareInterval);return;}
          navigator.geolocation.getCurrentPosition(p=>{
            localStorage.setItem('wildpath-user-location-'+_myUid(),JSON.stringify({lat:p.coords.latitude,lng:p.coords.longitude,ts:Date.now()}));
          });
        },30000);
      },
      ()=>showToast('Location access denied')
    );
  } else {
    localStorage.setItem('wp_share_location','0');
    if(window._locShareInterval)clearInterval(window._locShareInterval);
    showToast('Location sharing disabled');
    _buildSettingsFull();
  }
}
function _sfChangeUsername(){
  if(isGuest()){showLoginScreen();return;}
  const newName=prompt('Enter new username:');
  if(!newName||!newName.trim())return;
  const uname=newName.trim().replace('@','').slice(0,24);
  db.from('profiles').update({username:uname}).eq('id',_myUid()).then(({error})=>{
    if(error){showToast(error.message.includes('duplicate')?'Username already taken':'Could not update username');return;}
    _currentUser.username=uname;
    const prof=getUserProfile(_myUid())||{};prof.username=uname;setUserProfile(_myUid(),prof);
    showToast('Username updated');
    buildProfile();
  });
}
function _sfChangePassword(){
  if(isGuest()){showLoginScreen();return;}
  const nw=prompt('Enter new password (6+ characters):');
  if(!nw||nw.length<6){if(nw!==null)showToast('Password must be at least 6 characters');return;}
  db.auth.updateUser({password:nw}).then(({error})=>{
    showToast(error?('Could not update: '+error.message):'Password updated');
  });
}
function _sfSignOut(){
  closeSettingsFull();
  signOut();
}
function _sfOpenLegal(){
  const overlay=document.createElement('div');
  overlay.style.cssText='position:fixed;inset:0;z-index:700;background:var(--bg0);display:flex;flex-direction:column;overflow:hidden';
  overlay.innerHTML=`
    <div style="display:flex;align-items:center;padding:52px 16px 14px;border-bottom:1px solid var(--border);flex-shrink:0">
      <div onclick="this.closest('[style*=fixed]').remove()" style="cursor:pointer;padding:4px 8px 4px 0;font-size:15px;color:var(--txt0)">← Back</div>
      <div style="flex:1;text-align:center;font-size:17px;font-weight:700;color:var(--txt0)">Legal Info</div>
      <div style="width:60px"></div>
    </div>
    <div style="flex:1;overflow-y:auto;padding:20px 16px">
      <div style="font-size:16px;font-weight:700;color:var(--txt0);margin-bottom:10px">Terms of Service</div>
      <p style="font-size:13px;color:var(--txt2);line-height:1.7;margin-bottom:20px">WildPath is provided for personal, non-commercial use. You agree to use the app responsibly and in compliance with all applicable laws. Do not trespass or access private property. WildPath is not responsible for injuries, damages, or losses arising from outdoor activities.</p>
      <div style="font-size:16px;font-weight:700;color:var(--txt0);margin-bottom:10px">Privacy Policy</div>
      <p style="font-size:13px;color:var(--txt2);line-height:1.7;margin-bottom:20px">WildPath stores your data locally on your device using localStorage. We do not transmit personal data to external servers except for map tile requests (Mapbox) and geocoding (Nominatim). Your location is only used when you enable location services. We do not sell your data.</p>
      <div style="font-size:16px;font-weight:700;color:var(--txt0);margin-bottom:10px">Open Source Licenses</div>
      <div style="background:var(--bg2);border-radius:12px;padding:14px;margin-bottom:8px">
        <div style="font-size:14px;font-weight:700;color:var(--txt0)">Mapbox GL JS</div>
        <div style="font-size:11px;color:var(--txt3)">v3.6.0 — Mapbox Terms of Service</div>
      </div>
      <div style="background:var(--bg2);border-radius:12px;padding:14px;margin-bottom:8px">
        <div style="font-size:14px;font-weight:700;color:var(--txt0)">Nominatim</div>
        <div style="font-size:11px;color:var(--txt3)">OpenStreetMap — ODbL License</div>
      </div>
      <div style="background:var(--bg2);border-radius:12px;padding:14px;margin-bottom:24px">
        <div style="font-size:14px;font-weight:700;color:var(--txt0)">Tabler Icons</div>
        <div style="font-size:11px;color:var(--txt3)">MIT License</div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}
function _sfOpenMapStyle(){/* handled inline in _buildSettingsFull */}

// Override openSettingsPanel to also work from profile settings rows
const _origOpenSettingsPanel=openSettingsPanel;
// Patch settingsList onclick in profile to open the full settings screen
function _patchSettingsRows(){
  const list=document.getElementById('settingsList');
  if(!list)return;
  list.querySelectorAll('.settings-row').forEach(row=>{
    const origClick=row.getAttribute('onclick');
    if(origClick&&origClick.includes('openSettingsPanel')){
      row.setAttribute('onclick',origClick.replace('openSettingsPanel','_origOpenSettingsPanel'));
    }
  });
  // Add a main Settings button at the top of the profile that opens the full settings screen
  const settingsHeader=document.querySelector('#profile-screen .settings-row:first-child');
}

// Trip duration pills: also allow 15-30 via custom input in main plan screen
// ── Trip planner export buttons (Apple Maps + Google Maps) ──
function _addMapExportButtons(){
  if(!_planState)return;
  const output=document.getElementById('itineraryOutput')||document.getElementById('hpItineraryOutput');
  if(!output)return;
  const existingExport=output.querySelector('.map-export-row');
  if(existingExport)return; // already added

  // Collect all kept spots with lat/lng
  const allSpots=[...spots,...userSpots];
  const keptSpots=_planState.days.flatMap(d=>d.spots.filter(s=>s.kept));
  const waypoints=keptSpots.map(sp=>{
    const match=allSpots.find(s=>s.name===sp.name)||allSpots.find(s=>s.name.includes(sp.name.slice(0,10)));
    return match?{lat:match.lat,lng:match.lng,name:sp.name}:null;
  }).filter(Boolean);

  if(!waypoints.length)return;

  // Apple Maps URL (daddr supports only start/end — chain via saddr/daddr)
  const appleBase='https://maps.apple.com/?';
  const firstWp=waypoints[0];
  const lastWp=waypoints[waypoints.length-1];
  const appleUrl=appleBase+`saddr=${firstWp.lat},${firstWp.lng}&daddr=${lastWp.lat},${lastWp.lng}&dirflg=d`;

  // Google Maps URL with waypoints
  const gStart=`${firstWp.lat},${firstWp.lng}`;
  const gEnd=`${lastWp.lat},${lastWp.lng}`;
  const gWaypoints=waypoints.slice(1,-1).map(w=>`${w.lat},${w.lng}`).join('|');
  const googleUrl=`https://www.google.com/maps/dir/?api=1&origin=${gStart}&destination=${gEnd}${gWaypoints?'&waypoints='+encodeURIComponent(gWaypoints):''}`;

  const row=document.createElement('div');
  row.className='map-export-row';
  row.style.cssText='display:flex;gap:10px;margin-top:14px;padding:0 2px';
  row.innerHTML=`
    <a href="${appleUrl}" target="_blank" rel="noopener"
      style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;
      border:1.5px solid rgba(255,255,255,.12);border-radius:12px;padding:12px 8px;
      text-decoration:none;color:var(--txt0);font-size:12px;font-weight:600;
      background:rgba(255,255,255,.04)">
      Apple Maps
    </a>
    <a href="${googleUrl}" target="_blank" rel="noopener"
      style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;
      border:1.5px solid rgba(255,255,255,.12);border-radius:12px;padding:12px 8px;
      text-decoration:none;color:var(--txt0);font-size:12px;font-weight:600;
      background:rgba(255,255,255,.04)">
      Google Maps
    </a>`;
  output.appendChild(row);
}

// Open full settings from profile settings list
function openSettingsFromProfile(){openSettingsFull();}

// ═══════════════════════════════════════════════════
// TRIP PLANNER — SWIPE LEFT TO REMOVE SPOT CARDS
// ═══════════════════════════════════════════════════

function _attachPlanCardSwipe(di){
  const list=document.getElementById(`plan-day-${di}`);
  if(!list)return;
  list.querySelectorAll('.plan-spot-card').forEach(card=>{
    let startX=0,startY=0,dx=0;
    card.addEventListener('touchstart',e=>{
      startX=e.touches[0].clientX;startY=e.touches[0].clientY;dx=0;
    },{passive:true});
    card.addEventListener('touchmove',e=>{
      dx=e.touches[0].clientX-startX;
      const dy=Math.abs(e.touches[0].clientY-startY);
      if(Math.abs(dx)>dy&&Math.abs(dx)>8){
        // Horizontal swipe
        const move=Math.min(0,dx); // only left
        card.style.transform=`translateX(${move}px)`;
        card.style.transition='none';
        // Show/hide red delete bg
        let bg=card.nextElementSibling;
        if(!bg||!bg.classList.contains('swipe-del-bg')){
          bg=document.createElement('div');
          bg.className='swipe-del-bg';
          bg.style.cssText='position:absolute;right:0;top:0;bottom:0;width:80px;background:#C4524A;border-radius:0 16px 16px 0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;pointer-events:none;z-index:-1';
          bg.textContent='Remove';
          card.style.position='relative';
          card.after(bg);
        }
        bg.style.opacity=Math.min(1,Math.abs(dx)/80)+'';
      }
    },{passive:true});
    card.addEventListener('touchend',()=>{
      card.style.transition='transform .25s ease';
      if(dx<-80){
        // Trigger remove
        card.style.transform='translateX(-110%)';
        setTimeout(()=>{
          const uid=card.dataset.uid;
          if(uid)_planRemove(uid);
        },200);
      } else {
        card.style.transform='';
        // Remove swipe bg
        const bg=card.nextElementSibling;
        if(bg&&bg.classList.contains('swipe-del-bg'))bg.remove();
      }
    },{passive:true});
  });
}

// ═══════════════════════════════════════════════════
// TRIP PLANNER — ADD SPOT TO DAY
// ═══════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// AUTH SYSTEM — inline Profile-tab login only (no overlay screens)
// ═══════════════════════════════════════════════════════════════
let _currentUser = null;
let _appInitialized = false;
let _loginCallback = null;

// ── Pending spots submitted by explorer users ──
let _pendingSpots = JSON.parse(localStorage.getItem('wildpath-pending-spots')||'[]');

function _saveUsers(users){/* Phase 2: users live in Supabase profiles */}
function _getUsers(){
  const m=_cgGet(CK.profiles)||{};
  return Object.entries(m).map(([id,p])=>({id,username:p.username,fullName:p.fullName||'',email:'',role:p.role||'explorer'}));
}

// Profile tab inline login panel toggles
function profileShowSignIn(){
  const si=document.getElementById('profileSignInPanel');
  const su=document.getElementById('profileSignUpPanel');
  if(si)si.style.display='block';
  if(su)su.style.display='none';
  document.getElementById('profileTabSignIn')?.classList.add('active');
  document.getElementById('profileTabSignUp')?.classList.remove('active');
  const e=document.getElementById('profileLoginError');if(e)e.classList.remove('show');
}
function profileShowSignUp(){
  const si=document.getElementById('profileSignInPanel');
  const su=document.getElementById('profileSignUpPanel');
  if(si)si.style.display='none';
  if(su)su.style.display='block';
  document.getElementById('profileTabSignIn')?.classList.remove('active');
  document.getElementById('profileTabSignUp')?.classList.add('active');
  const e=document.getElementById('profileSignupError');if(e)e.classList.remove('show');
}
// Legacy stubs (called nowhere now, kept to prevent ReferenceErrors)
function showSignIn(){}
function showSignUp(){}

function _showLoginError(id, msg){
  const el=document.getElementById(id);
  if(el){el.textContent=msg; el.classList.add('show');}
}

// Profile-tab sign in
function doProfileSignIn(){
  const email=(document.getElementById('profileLoginEmail')?.value||'').trim().toLowerCase();
  const pw=document.getElementById('profileLoginPassword')?.value||'';
  if(!email||!pw){_showLoginError('profileLoginError','Enter your email and password.');return;}
  _sbSignIn(email,pw,m=>_showLoginError('profileLoginError',m));
}

// Profile-tab sign up
function doProfileSignUp(){
  const username=(document.getElementById('profileSignupUsername')?.value||'').trim();
  const email=(document.getElementById('profileSignupEmail')?.value||'').trim().toLowerCase();
  const pw=document.getElementById('profileSignupPassword')?.value||'';
  const confirm=document.getElementById('profileSignupConfirm')?.value||'';
  if(!username||!email||!pw||!confirm){_showLoginError('profileSignupError','All fields are required.');return;}
  if(pw!==confirm){_showLoginError('profileSignupError','Passwords do not match.');return;}
  if(pw.length<6){_showLoginError('profileSignupError','Password must be 6+ characters.');return;}
  _sbSignUp(username,email,pw,m=>_showLoginError('profileSignupError',m));
}

// Legacy stubs
function doSignIn(){doProfileSignIn();}
function doSignUp(){doProfileSignUp();}
function doGuestMode(){}

function signOut(){
  db.auth.signOut().catch(()=>{});
  _sbSession=null;_guestMode=false;
  _currentUser=null;
  Object.keys(_DB).forEach(k=>delete _DB[k]);
  showToast('Signed out');
  setTimeout(()=>{_showLoginScreen();},400);
}

// ── Admin UI helpers ──────────────────────────────
function _applyAdminUI(){
  // Mark body so CSS can target admin-only elements
  document.body.classList.add('is-admin');
  // Add admin badge to profile header
  const profileHeader=document.querySelector('#profile-screen .profile-name');
  if(profileHeader&&_currentUser){
    profileHeader.insertAdjacentHTML('afterend','<span class="admin-badge">ADMIN</span>');
  }
}

function isAdmin(){return _currentUser&&_currentUser.role==='admin';}
function isGuest(){return _guestMode||!_currentUser||_currentUser.id==='guest';}
function isLoggedIn(){return !!_currentUser&&_currentUser.id!=='guest'&&!_guestMode;}

// ── Route gated actions to login screen ────────────────────────
function promptSignIn(cb){
  _loginCallback=typeof cb==='function'?cb:null;
  showToast('Sign in to continue');
  _showLoginScreen();
}
function showLoginScreen(cb){promptSignIn(cb);}

// Profile tab — always opens; shows inline login form if guest
function switchToProfile(el){switchScreen('profile',el);}

// ── Admin: Pending spots management ──────────────
// Pending spots — Supabase pending_spots table, cached in memory
let _pendingSpotsCache=[];
function getPendingSpots(){return _pendingSpotsCache;}
function savePendingSpots(arr){_pendingSpotsCache=arr;}

async function _sbLoadPendingSpots(){
  if(isGuest())return;
  try{
    let q=db.from('pending_spots').select('*').eq('status','pending').order('submitted_at');
    if(!isAdmin())q=q.eq('submitted_by',_myUid());
    const {data,error}=await q;
    if(error)throw error;
    _pendingSpotsCache=(data||[]).map(r=>{
      const s=_sbAdaptSpot(r);
      s._pendingId=r.id;
      s._submitterUid=String(r.submitted_by||'');
      s._submittedBy=(getUserProfile(r.submitted_by)||{}).username||'Explorer';
      s._submittedAt=r.submitted_at;
      s.photos=r.photo_urls||[];
      return s;
    });
    try{refreshSpotMarkers();}catch(e){}
  }catch(e){console.warn('[Supabase] pending spots load:',e);}
}

function approveSpot(spotId){
  const idx=_pendingSpotsCache.findIndex(s=>s._pendingId===spotId);
  if(idx===-1)return;
  const s=_pendingSpotsCache[idx];
  _pendingSpotsCache.splice(idx,1);
  (async()=>{
    try{
      const {data,error}=await db.from('spots').insert({
        name:s.name,type:s.type,lat:s.lat,lng:s.lng,
        legal_status:s.legal||'caution',description:s.description||s.insiderTips||'',
        approach:s.approach||'',difficulty:s.difficulty||null,
        submitted_by:s._submitterUid||null,status:'approved',
        discovered_by:s._submittedBy||null
      }).select().single();
      if(error)throw error;
      await db.from('pending_spots').delete().eq('id',spotId);
      userSpots.push(_sbAdaptSpot(data));
      refreshSpotMarkers();
      showToast('Spot approved and published!');
    }catch(e){
      console.warn('[Supabase] approve failed:',e);
      showToast('Approve failed — check connection');
      _sbLoadPendingSpots();
    }
  })();
}
function rejectSpot(spotId){
  const idx=_pendingSpotsCache.findIndex(s=>s._pendingId===spotId);
  if(idx>-1)_pendingSpotsCache.splice(idx,1);
  _sbTry(db.from('pending_spots').delete().eq('id',spotId),'reject spot');
  try{refreshSpotMarkers();}catch(e){}
  showToast('Spot rejected.');
}

// Every submission goes to pending_spots — nothing goes live without admin approval
function submitSpotForReview(spot){
  if(isGuest()){showLoginScreen();return;}
  (async()=>{
    try{
      // Upload photos to spot-photos bucket first (never store base64)
      const photoUrls=[];
      for(const dataUrl of (spot.photos||[]).slice(0,6)){
        try{photoUrls.push(await _sbUploadDataUrl('Spot Photos',dataUrl,'jpg'));}catch(e){console.warn('spot photo upload:',e);}
      }
      const {data,error}=await db.from('pending_spots').insert({
        name:spot.name,type:spot.type,lat:spot.lat,lng:spot.lng,
        legal_status:spot.legal||'caution',
        description:spot.description||spot.insiderTips||'',
        approach:spot.approach||'',
        photo_urls:photoUrls,
        submitted_by:_myUid()
      }).select().single();
      if(error)throw error;
      const s=_sbAdaptSpot(data);
      s._pendingId=data.id;s._submitterUid=String(_myUid());s._submittedBy=_myName();s.photos=photoUrls;
      _pendingSpotsCache.push(s);
      refreshSpotMarkers(); // submitter sees it with Pending badge
      showToast(isAdmin()?'Spot queued — approve it in Admin Review':'Spot submitted for review!');
    }catch(e){
      console.warn('[Supabase] spot submit failed:',e);
      showToast('Could not submit spot — check connection');
    }
  })();
}

// Guest mode: route to Profile tab inline login
function requireAuth(action,cb){
  if(isGuest()){promptSignIn(cb||null);return false;}
  return true;
}

// ═══════════════════════════════════════════════════
// ADMIN — EDIT & DELETE SPOTS
// ═══════════════════════════════════════════════════
let _adminEditSpotId = null;

function adminEditSpot(){
  if(!isAdmin()){showToast('Admin only');return;}
  const allS=[...spots,...userSpots];
  const spot=allS.find(s=>s.id===currentPin);
  if(!spot){showToast('Spot not found');return;}
  _adminEditSpotId=spot.id;

  // Pre-fill fields
  const f=(id,val)=>{const el=document.getElementById(id);if(el)el.value=val||'';};
  f('aeSpotName',   spot.name);
  f('aeSpotDesc',   spot.description||spot.approach||'');
  f('aeSpotApproach', spot.approach||'');
  f('aeSpotTips',   spot.insiderTips||'');
  f('aeSpotFee',    spot.entryFee||'');
  f('aeSpotSeason', spot.bestSeason||'');
  f('aeSpotRoad',   spot.roadCondition||'');

  const legalSel=document.getElementById('aeSpotLegal');
  if(legalSel)legalSel.value=spot.legal||'legal';

  document.getElementById('adminEditOverlay').classList.add('open');
}

function closeAdminEdit(){
  document.getElementById('adminEditOverlay').classList.remove('open');
  _adminEditSpotId=null;
}

function saveAdminEdit(){
  if(!_adminEditSpotId){closeAdminEdit();return;}
  const g=(id)=>(document.getElementById(id)?.value||'').trim();
  const name=g('aeSpotName');
  if(!name){showToast('Name cannot be empty');return;}

  const legal=document.getElementById('aeSpotLegal')?.value||'legal';
  const legalMap={
    legal:{text:'Legal',cls:'legal-legal'},
    permit:{text:'Permit Required',cls:'legal-permit'},
    gray:{text:'Gray Area',cls:'legal-gray'},
    illegal:{text:'Illegal / No Trespassing',cls:'legal-illegal'}
  };
  const legalInfo=legalMap[legal]||legalMap.legal;

  // Update in spots array
  let found=false;
  for(let i=0;i<spots.length;i++){
    if(spots[i].id===_adminEditSpotId){
      spots[i].name=name;
      spots[i].description=g('aeSpotDesc');
      spots[i].approach=g('aeSpotApproach');
      spots[i].insiderTips=g('aeSpotTips');
      spots[i].entryFee=g('aeSpotFee');
      spots[i].bestSeason=g('aeSpotSeason');
      spots[i].roadCondition=g('aeSpotRoad');
      spots[i].legal=legal;
      spots[i].legalText=legalInfo.text;
      spots[i].legalClass=legalInfo.cls;
      found=true; break;
    }
  }
  // Also check userSpots
  if(!found){
    for(let i=0;i<userSpots.length;i++){
      if(userSpots[i].id===_adminEditSpotId){
        userSpots[i].name=name;
        userSpots[i].description=g('aeSpotDesc');
        userSpots[i].approach=g('aeSpotApproach');
        userSpots[i].insiderTips=g('aeSpotTips');
        userSpots[i].entryFee=g('aeSpotFee');
        userSpots[i].bestSeason=g('aeSpotSeason');
        userSpots[i].roadCondition=g('aeSpotRoad');
        userSpots[i].legal=legal;
        userSpots[i].legalText=legalInfo.text;
        userSpots[i].legalClass=legalInfo.cls;
        found=true; break;
      }
    }
    // userSpots is a Supabase cache — server-side spot editing comes later
  }

  closeAdminEdit();
  showToast('Spot updated');
  // Re-render detail page with updated data
  setTimeout(()=>openDetail(_adminEditSpotId||currentPin),50);
  // Refresh map markers
  try{refreshSpotMarkers();}catch(e){}
}

function adminDeleteSpot(){
  if(!isAdmin()){return;}
  const allS=[...spots,...userSpots];
  const spot=allS.find(s=>s.id===((_adminEditSpotId)||currentPin));
  if(!spot){closeAdminEdit();return;}

  // Confirm — use toast-based confirm pattern
  const confirmed=window.confirm(`Delete "${spot.name}"? This cannot be undone.`);
  if(!confirmed)return;

  // Remove from spots array (built-in spots kept in-memory only; remove from userSpots if community)
  const sIdx=spots.findIndex(s=>s.id===spot.id);
  if(sIdx>=0)spots.splice(sIdx,1);

  const uIdx=userSpots.findIndex(s=>s.id===spot.id);
  if(uIdx>=0)userSpots.splice(uIdx,1);

  // Remove marker from map
  if(window._spotMarkers){
    const m=window._spotMarkers[spot.id];
    if(m){m.remove();delete window._spotMarkers[spot.id];}
  }

  closeAdminEdit();
  closeDetail();
  showToast(`"${spot.name}" deleted`);
  try{refreshSpotMarkers();}catch(e){}
}

// ── Expose _spotMarkers on addSpotMarkerToMap ─────────
if(!window._spotMarkers)window._spotMarkers={};

// ════════════════════════════════════════════════════════════════
//  COMMUNITY SYSTEM  — complete social platform
// ════════════════════════════════════════════════════════════════

// ── State ─────────────────────────────────────────────────────
let _commFeedFilter='all', _commFeedSort='recent', _commSubTab='feed';
let _currentCommunityId=null, _currentPostId=null, _currentProfileUserId=null;
let _dmConvUserId=null;
let _cpStep=1, _cpType=null, _cpMediaDataUrl=null, _cpMediaFiles=[];
let _cpTaggedSpotLat=null, _cpTaggedSpotLng=null, _cpSpotSearchTimer=null;
let _cpTaggedSpotId=null, _cpTaggedSpotName='', _cpShareCommunities=[];
let _cpShowOnSpot=true;
let _ccStep=1, _ccCoverDataUrl=null, _ccPrivacy='public', _ccFocusTags=[];
let _sdLat=37.5, _sdLng=-120.0, _sdPhotoDataUrl=null, _sdMap=null;
let _commSortMode='hot'; // for community detail feed
let _commentReplyTo=null; // parent comment id for replies

// ── localStorage keys ──────────────────────────────────────────
const CK={
  posts:'wildpath-posts', communities:'wildpath-communities',
  members:'wildpath-community-members', cposts:'wildpath-community-posts',
  votes:'wildpath-votes', comments:'wildpath-comments',
  follows:'wildpath-follows', notifs:'wildpath-notifications',
  messages:'wildpath-messages', spotdrops:'wildpath-spot-drops',
  searches:'wildpath-recent-searches', profiles:'wildpath-user-profiles',
  pendingMembers:'wildpath-pending-members'
};

// ── Data helpers ───────────────────────────────────────────────
// Phase 2: all app data lives in memory (_DB), hydrated from Supabase.
// localStorage is ONLY for UI preferences (theme, map style, units).
const _DB={};
function _cgGet(k){return _DB[k]??null;}
function _cgSet(k,v){_DB[k]=v;}
function getPosts(){return _cgGet(CK.posts)||[];}
function setPosts(v){_cgSet(CK.posts,v);}
function getCommunities(){return _cgGet(CK.communities)||[];}
function setCommunities(v){_cgSet(CK.communities,v);}
function getMembers(cid){const m=_cgGet(CK.members)||{};return m[cid]||[];}
function setMembers(cid,arr){const m=_cgGet(CK.members)||{};m[cid]=arr;_cgSet(CK.members,m);}
function getPendingMembers(cid){const m=_cgGet(CK.pendingMembers)||{};return m[cid]||[];}
function setPendingMembers(cid,arr){const m=_cgGet(CK.pendingMembers)||{};m[cid]=arr;_cgSet(CK.pendingMembers,m);}
function getCPosts(cid){const m=_cgGet(CK.cposts)||{};return m[cid]||[];}
function setCPosts(cid,arr){const m=_cgGet(CK.cposts)||{};m[cid]=arr;_cgSet(CK.cposts,m);}
function getVotes(){return _cgGet(CK.votes)||{};}
function setVotes(v){_cgSet(CK.votes,v);}
function getComments(pid){const m=_cgGet(CK.comments)||{};return m[pid]||[];}
function setComments(pid,arr){const m=_cgGet(CK.comments)||{};m[pid]=arr;_cgSet(CK.comments,m);}
function getFollows(){return _cgGet(CK.follows)||{};}
function setFollows(v){_cgSet(CK.follows,v);}
function getNotifs(){return _cgGet(CK.notifs)||[];}
function setNotifs(v){_cgSet(CK.notifs,v);}
function getMessages(){return _cgGet(CK.messages)||{};}
function setMessages(v){_cgSet(CK.messages,v);}
function getSpotDrops(){return _cgGet(CK.spotdrops)||[];}
function setSpotDrops(v){_cgSet(CK.spotdrops,v);}
function getUserProfile(uid){const m=_cgGet(CK.profiles)||{};return m[uid]||null;}
function setUserProfile(uid,data){const m=_cgGet(CK.profiles)||{};m[uid]=data;_cgSet(CK.profiles,m);}

// ── Helpers ────────────────────────────────────────────────────
function _myUid(){return _currentUser?.id||'guest';}
function _myName(){return _currentUser?.username||'Explorer';}
function _myInitials(){const n=_myName();return n.slice(0,2).toUpperCase();}
function _timeAgo(iso){
  const s=Math.floor((Date.now()-new Date(iso))/1000);
  if(s<60)return s+'s';if(s<3600)return Math.floor(s/60)+'m';
  if(s<86400)return Math.floor(s/3600)+'h';return Math.floor(s/86400)+'d';
}
function _uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
function _isFollowing(uid){const f=getFollows();return(f[_myUid()]||[]).includes(uid);}
function _isAdmin(){return isAdmin();}
function _verifiedBadge(){
  return `<span class="verified-badge"><svg viewBox="0 0 10 10"><polyline points="2,5 4.5,7.5 8,3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
}
function _userVerified(uid){
  return (getUserProfile(uid)||{}).role==='admin';
}
function _avatarHtml(username,size=32,photoUrl=null){
  const initials=(username||'?').slice(0,2).toUpperCase();
  const colors=['#2d5a3a','#3a2d5a','#5a3a2d','#2d4a5a','#5a2d4a'];
  const ci=username?username.charCodeAt(0)%colors.length:0;
  if(photoUrl&&(photoUrl.startsWith('data:')||photoUrl.startsWith('http'))){
    return `<div class="post-avatar" style="width:${size}px;height:${size}px;font-size:${Math.floor(size*0.35)}px"><img src="${photoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"></div>`;
  }
  return `<div class="post-avatar" style="width:${size}px;height:${size}px;font-size:${Math.floor(size*0.35)}px;background:${colors[ci]}">${initials}</div>`;
}

// ── Community screen setup ─────────────────────────────────────
function buildCommunityScreen(){
  try {
    _updateNotifBadge();
    _buildCommunityList();
  } catch(e) {
    console.error('Community screen error:', e);
  }
}

function _buildCommunityList(){
  try {
    const listEl=document.getElementById('commListContent');
    if(!listEl)return;
    const comms=getCommunities();
    // Sort: pinned first, then by member count
    const pinned=JSON.parse(localStorage.getItem('wp_pinned_comms')||'[]');
    const sorted=[...comms].sort((a,b)=>{
      const ap=pinned.includes(a.id)?1:0;
      const bp=pinned.includes(b.id)?1:0;
      if(ap!==bp)return bp-ap;
      return (b.memberCount||0)-(a.memberCount||0);
    });
    if(!sorted.length){
      listEl.innerHTML=`<div style="text-align:center;padding:56px 20px">
        <div style="font-size:14px;color:var(--txt3);margin-bottom:18px">No communities yet — be the first to create one</div>
        <button onclick="openCreateCommunity()" style="padding:12px 28px;background:var(--accent);border:none;border-radius:12px;color:#0f1a0a;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Create Community</button>
      </div>`;
      return;
    }
    listEl.innerHTML=sorted.map(c=>{
      const isPinned=pinned.includes(c.id);
      const members=c.memberCount||(getMembers(c.id)||[]).length||0;
      const coverBg=c.coverColor||c.coverGrad||'linear-gradient(135deg,#1a2c1a,#2d4a2d)';
      const letter=(c.name||'C')[0].toUpperCase();
      return `<div class="comm-unified-row" onclick="openCommunityDetail('${c.id}')">
        <div style="width:44px;height:44px;border-radius:50%;flex-shrink:0;overflow:hidden;background:${coverBg};display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;color:rgba(255,255,255,.8)">
          ${c.coverUrl?`<img src="${c.coverUrl}" style="width:100%;height:100%;object-fit:cover">`:letter}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:700;color:var(--txt0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.name||'Community'}${isPinned?' <span style="color:var(--accent);font-size:10px">pinned</span>':''}</div>
          <div style="font-size:12px;color:var(--txt3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${members.toLocaleString()} members</div>
        </div>
        <div onclick="event.stopPropagation();_commInfoMenu('${c.id}')" style="width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--txt3)">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="19" r="1" fill="currentColor"/></svg>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    console.error('Community screen error:', e);
  }
}

function _commInfoMenu(commId){
  const pinned=JSON.parse(localStorage.getItem('wp_pinned_comms')||'[]');
  const isPinned=pinned.includes(commId);
  // Show a simple action sheet
  const sheet=document.createElement('div');
  sheet.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.7);display:flex;align-items:flex-end';
  sheet.innerHTML=`<div style="width:100%;background:var(--bg1);border-radius:20px 20px 0 0;padding:20px 16px calc(env(safe-area-inset-bottom,0px)+16px)">
    <div style="width:36px;height:4px;background:var(--border2);border-radius:2px;margin:0 auto 16px"></div>
    <div onclick="_togglePinComm('${commId}');this.closest('[style*=fixed]').remove()" style="padding:14px 0;font-size:15px;font-weight:600;color:var(--txt0);cursor:pointer;border-bottom:1px solid var(--border)">
      ${isPinned?'Unpin Group':'Pin Group'}
    </div>
    <div onclick="openCommunityDetail('${commId}');this.closest('[style*=fixed]').remove()" style="padding:14px 0;font-size:15px;font-weight:600;color:var(--txt0);cursor:pointer">View Community</div>
    <div onclick="this.closest('[style*=fixed]').remove()" style="padding:14px 0;font-size:15px;font-weight:600;color:var(--txt3);cursor:pointer;text-align:center">Cancel</div>
  </div>`;
  sheet.onclick=e=>{if(e.target===sheet)sheet.remove();};
  document.body.appendChild(sheet);
}

function _togglePinComm(commId){
  const pinned=JSON.parse(localStorage.getItem('wp_pinned_comms')||'[]');
  const idx=pinned.indexOf(commId);
  if(idx>=0)pinned.splice(idx,1);
  else pinned.unshift(commId);
  localStorage.setItem('wp_pinned_comms',JSON.stringify(pinned));
  _buildCommunityList();
  showToast(idx>=0?'Group unpinned':'Group pinned to top');
}

// Legacy switchCommTab — kept for compat
function switchCommTab(tab){
  _commSubTab=tab;
}

// ── Feed ───────────────────────────────────────────────────────
function buildFeed(){
  const scroll=document.getElementById('feedScroll');
  if(!scroll)return;
  let posts=getPosts();
  if(_commFeedFilter!=='all') posts=posts.filter(p=>p.type===_commFeedFilter);
  if(_commFeedSort==='week') posts=posts.sort((a,b)=>(b.likes?.length||0)-(a.likes?.length||0));
  else if(_commFeedSort==='alltime') posts=posts.sort((a,b)=>(b.likes?.length||0)-(a.likes?.length||0));
  else posts=posts.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  if(!posts.length){scroll.innerHTML='<div style="text-align:center;padding:48px 20px;color:var(--txt3)"><div style="font-size:14px;font-weight:600;color:var(--txt2)">No posts yet</div><div style="font-size:12px;margin-top:6px">Be the first to share something</div></div>';return;}
  scroll.innerHTML=posts.map(p=>buildPostCard(p)).join('');
  _initVideoObserver();
}

function setFeedFilter(f,el){
  _commFeedFilter=f;
  document.querySelectorAll('.feed-chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  buildFeed();
}

let _feedSortOpen=false;
function toggleFeedSort(){
  _feedSortOpen=!_feedSortOpen;
  const drop=document.getElementById('feedSortDrop');
  if(drop){drop.style.display=_feedSortOpen?'block':'none';}
  // position it under the button
  const btn=document.getElementById('feedSortBtn');
  if(btn&&drop){
    const rect=btn.getBoundingClientRect();
    const appRect=document.getElementById('app').getBoundingClientRect();
    drop.style.top=(rect.bottom-appRect.top+4)+'px';
    drop.style.right=(appRect.right-rect.right)+'px';
    drop.style.position='absolute';
  }
}
function setFeedSort(s){
  _commFeedSort=s;
  const labels={recent:'Recent',week:'Top This Week',alltime:'Top All Time'};
  const lbl=document.getElementById('feedSortLabel');
  if(lbl)lbl.textContent=labels[s]||s;
  _feedSortOpen=false;
  const drop=document.getElementById('feedSortDrop');
  if(drop)drop.style.display='none';
  buildFeed();
}

// ── Post card builder ─────────────────────────────────────────
function buildPostCard(post,compact=false){
  const profileData=getUserProfile(post.userId)||{};
  const avatarUrl=profileData.avatarUrl||null;
  const verif=_userVerified(post.userId)||post.verified;
  const myLiked=(post.likes||[]).includes(_myUid());
  const likeCount=(post.likes||[]).length;
  const commentCount=getComments(post.id).length;
  const spotPill=post.spotName?`<div class="post-spot-pill" onclick="event.stopPropagation();openSpotFromPost('${post.spotId}')">${sanitize(post.spotName)}</div>`:'';

  let mediaHtml='';
  if(post.type==='photo'&&post.mediaUrl){
    mediaHtml=`<div class="post-media-wrap" ondblclick="handlePostDoubleTap(event,'${post.id}')"><img src="${post.mediaUrl}" loading="lazy" onerror="this.style.display='none'"></div>`;
  } else if(post.type==='video'&&post.mediaUrl){
    mediaHtml=`<div class="post-media-wrap" ondblclick="handlePostDoubleTap(event,'${post.id}')"><video src="${post.mediaUrl}" loop muted playsinline class="comm-video" data-postid="${post.id}" style="width:100%;height:100%;object-fit:cover"></video><div class="post-media-sound" onclick="event.stopPropagation();toggleVideoSound(this)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg></div></div>`;
  } else if(post.type==='spotdrop'&&post.spotdrop){
    const sd=post.spotdrop;
    const votes=_getPostVoteScore(post.id);
    mediaHtml=`<div style="padding:12px 14px">
      <div class="reddit-spotdrop-map" onclick="event.stopPropagation()">
        <div style="background:linear-gradient(135deg,#1a3a2a,#2d5a3a);width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:14px;color:var(--txt2)">
          ${(sd.lat||37.5).toFixed(4)}, ${(sd.lng||-120).toFixed(4)}
        </div>
        <div class="reddit-spotdrop-map-pin"></div>
      </div>
      <div class="reddit-spotdrop-info">
        <div style="font-size:13px;font-weight:700;color:var(--txt0)">${sanitize(sd.name)||'Unknown Spot'}</div>
        <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">
          <span class="post-type-badge">${sd.type||'spot'}</span>
          <span class="post-type-badge" style="color:${sd.legal==='legal'?'var(--green)':sd.legal==='illegal'?'var(--red)':'var(--yellow)'}">${sd.legal==='legal'?'Legal':sd.legal==='illegal'?'Illegal':'Caution'}</span>
        </div>
        ${sd.approach?`<div style="font-size:11px;color:var(--txt2);margin-top:6px;line-height:1.4">${sanitize(sd.approach.slice(0,120))}${sd.approach.length>120?'…':''}</div>`:''}
        ${votes>=10&&_isAdmin()?`<button class="reddit-approve-btn" onclick="event.stopPropagation();approveSpotDrop('${post.id}')">Add to WildPath Map</button>`:''}
        ${votes>=10&&!_isAdmin()?`<div style="font-size:10px;color:var(--accent);margin-top:4px;font-weight:700">Nominated for the map! (${votes} votes)</div>`:''}
      </div>
    </div>`;
  }

  const captionTrunc=post.caption&&post.caption.length>140?post.caption.slice(0,140)+'…':post.caption||'';
  const captionHtml=post.type!=='spotdrop'&&post.caption?`<div class="post-caption">${sanitize(captionTrunc)}${post.caption.length>140?`<span class="post-seemore" onclick="event.stopPropagation();openPostDetail('${post.id}')"> See more</span>`:''}</div>`:'';

  return `<div class="post-card" onclick="openPostDetail('${post.id}')">
    <div class="post-card-hdr" onclick="event.stopPropagation()">
      <div class="post-avatar-wrap" onclick="openUserProfile('${post.userId}')">
        ${_avatarHtml(post.username,32,avatarUrl)}
      </div>
      <div class="post-meta" onclick="openUserProfile('${post.userId}')">
        <div class="post-username">${sanitize(post.username)}${verif?_verifiedBadge():''}</div>
        <div class="post-time">${_timeAgo(post.createdAt)}</div>
      </div>
      ${spotPill}
    </div>
    ${mediaHtml}
    ${captionHtml}
    <div class="post-actions" onclick="event.stopPropagation()">
      <div class="post-action${myLiked?' liked':''}" onclick="togglePostLike('${post.id}',this)">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="${myLiked?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        <span class="post-like-count">${likeCount}</span>
      </div>
      <div class="post-action" onclick="openPostDetail('${post.id}')">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span>${commentCount}</span>
      </div>
      <div class="post-action" onclick="sharePost('${post.id}')">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </div>
      <div class="post-action" onclick="bookmarkPost('${post.id}',this)">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
      </div>
    </div>
    ${post.spotType?`<div class="post-type-row"><span class="post-type-badge">${post.spotType}</span>${post.region?`<span class="post-region">${post.region}</span>`:''}</div>`:''}
  </div>`;
}

function togglePostLike(postId,el){
  if(isGuest()){showLoginScreen(()=>togglePostLike(postId,el));return;}
  const posts=getPosts();
  const p=posts.find(x=>x.id===postId);
  if(!p)return;
  if(!p.likes)p.likes=[];
  const uid=_myUid();
  const idx=p.likes.indexOf(uid);
  if(idx>-1){p.likes.splice(idx,1);_sbToggleLike(postId,false);}
  else{ p.likes.push(uid); _sbToggleLike(postId,true); _addNotif(p.userId,'like',_myName(),'liked your post'); }
  setPosts(posts);
  // update UI
  const card=el?.closest('.post-card')||el?.closest('.reddit-post');
  if(card){
    const liked=p.likes.includes(uid);
    el.classList.toggle('liked',liked);
    const svg=el.querySelector('svg');if(svg)svg.setAttribute('fill',liked?'currentColor':'none');
    const cnt=el.querySelector('.post-like-count');if(cnt)cnt.textContent=p.likes.length;
  }
}

function handlePostDoubleTap(event,postId){
  const rect=event.currentTarget.getBoundingClientRect();
  const appRect=document.getElementById('app').getBoundingClientRect();
  const x=event.clientX-appRect.left;
  const y=event.clientY-appRect.top;
  const burst=document.createElement('div');
  burst.className='heart-burst';
  burst.innerHTML='<svg viewBox="0 0 24 24" width="44" height="44" fill="#ff4d6d" stroke="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
  burst.style.left=x+'px';
  burst.style.top=y+'px';
  document.getElementById('app').appendChild(burst);
  setTimeout(()=>burst.remove(),850);
  // auto-like
  const posts=getPosts();
  const p=posts.find(x=>x.id===postId);
  if(p&&!p.likes?.includes(_myUid())){
    if(!p.likes)p.likes=[];
    p.likes.push(_myUid());
    setPosts(posts);
    // update like button in nearest card
    const card=event.currentTarget.closest('.post-card');
    if(card){const btn=card.querySelector('.post-action');if(btn){btn.classList.add('liked');const cnt=btn.querySelector('.post-like-count');if(cnt)cnt.textContent=p.likes.length;}}
  }
}

function openSpotFromPost(spotId){
  if(!spotId)return;
  const allS=[...spots,...userSpots];
  const s=allS.find(x=>x.id===spotId);
  if(s){openDetail(s.id);}
}

function sharePost(postId){showToast('Link copied!');}
function bookmarkPost(postId,el){
  if(isGuest()){showLoginScreen();return;}
  openSaveFolderSheet(postId,el);
}

// ── Save-to-folder system ───────────────────────────────────────
function _getSavedFolders(){return _getSavedStore().folders;}
function _setSavedFolders(arr){const s=_getSavedStore();s.folders=arr;_setSavedStore(s);}

// ═══════════════════════════════════════════════════
// SAVE ANY LOCATION (Section 3) — spots, personal spots,
// community spots, or a raw lat/lng from a post — all save
// the same way into saved_places with a folder.
// ═══════════════════════════════════════════════════
function openPlaceSaveSheet(refType,refId,name,lat,lng){
  if(isGuest()){showLoginScreen();return;}
  const existing=document.getElementById('_placeSaveSheet');
  if(existing)existing.remove();
  const folders=[...new Set([..._getSavedFolders().map(f=>f.name),...savedPlaces.map(p=>p.folderName)])];
  const sheet=document.createElement('div');
  sheet.id='_placeSaveSheet';
  sheet.style.cssText='position:fixed;inset:0;z-index:9500;display:flex;flex-direction:column;justify-content:flex-end';
  sheet.onclick=(e)=>{if(e.target===sheet)sheet.remove();};
  const safeName=String(name).replace(/'/g,"\\'");
  sheet.innerHTML=`
    <div style="position:relative;background:var(--bg1);border-radius:20px 20px 0 0;padding:16px 16px calc(env(safe-area-inset-bottom,0px) + 16px);max-height:70vh;overflow-y:auto">
      <div style="font-size:15px;font-weight:700;color:var(--txt0);margin-bottom:14px">Save "${sanitize(name)}"</div>
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <input id="_newPlaceFolderInput" placeholder="New folder name…" style="flex:1;height:40px;background:var(--bg2);border:1px solid var(--border2);border-radius:10px;color:var(--txt0);padding:0 12px;font-size:13px;outline:none;font-family:var(--font)">
        <button onclick="_createAndSavePlace('${refType}','${refId||''}','${safeName}',${lat},${lng})" style="height:40px;padding:0 16px;background:var(--accent);color:#0f1a0a;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:var(--font);white-space:nowrap">Create</button>
      </div>
      ${folders.length?folders.map(f=>`
        <div onclick="_savePlaceToFolder('${refType}','${refId||''}','${safeName}',${lat},${lng},'${f.replace(/'/g,"\'")}');document.getElementById('_placeSaveSheet').remove()" style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);cursor:pointer;-webkit-tap-highlight-color:transparent">
          <div style="width:38px;height:38px;border-radius:10px;background:var(--bg3);display:flex;align-items:center;justify-content:center">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          </div>
          <div style="font-size:14px;font-weight:600;color:var(--txt0)">${sanitize(f)}</div>
        </div>`).join(''):'<div style="font-size:13px;color:var(--txt3);text-align:center;padding:20px 0">No folders yet — create one above</div>'}
    </div>`;
  document.body.appendChild(sheet);
}

// THE single save-a-spot function — every save entry point in the app (main map
// spot detail, Your Map, Friends Map, and post "Save Spot") funnels through here
// for real spots, and it writes to saved_spots — the exact table Profile's Saved
// section reads back from. Previously the spot-detail Save button wrote only to
// saved_places while Profile read from saved_spots, so saves never appeared.
async function saveSpot(spotId,folderName){
  if(isGuest()){showLoginScreen();return false;}
  if(!spotId)return false;
  folderName=folderName||'General';
  try{
    const {error}=await db.from('saved_spots').upsert({user_id:_myUid(),spot_id:spotId,folder_name:folderName});
    if(error)throw error;
    const saved=getSavedSpotIds();
    if(!saved.includes(spotId)){saved.push(spotId);setSavedSpotIds(saved);}
    const store=_getSavedStore();
    if(!store.folders.find(f=>f.name===folderName))store.folders.push({name:folderName,postIds:[]});
    _setSavedStore(store);
    refreshSpotMarkers();
    if(typeof _updateDetailSaveBtnState==='function')_updateDetailSaveBtnState();
    showToast(`Saved to "${folderName}"`);
    return true;
  }catch(e){
    console.warn('[Supabase] saveSpot failed:',e);
    showToast('Could not save — check connection');
    return false;
  }
}
async function unsaveSpot(spotId){
  if(!spotId)return;
  try{
    const {error}=await db.from('saved_spots').delete().eq('user_id',_myUid()).eq('spot_id',spotId);
    if(error)throw error;
  }catch(e){console.warn('[Supabase] unsaveSpot failed:',e);}
  setSavedSpotIds(getSavedSpotIds().filter(id=>String(id)!==String(spotId)));
  refreshSpotMarkers();
  if(typeof _updateDetailSaveBtnState==='function')_updateDetailSaveBtnState();
  showToast('Removed from saved');
}

async function _savePlaceToFolder(refType,refId,name,lat,lng,folderName){
  // Real spots (global/community) have a genuine row in `spots` and satisfy
  // saved_spots' foreign key — route those through the one canonical saveSpot().
  if(refType==='spot'&&refId){
    await saveSpot(refId,folderName);
    return;
  }
  // Personal spots and raw post locations have no spots.id to reference, so they
  // can't satisfy saved_spots' FK — these still go through the generalized
  // saved_places table (see SETUP-SUPABASE.md Section 3).
  try{
    const {data,error}=await db.from('saved_places').insert({
      user_id:_myUid(),ref_type:refType,ref_id:refId||null,name,lat,lng,folder_name:folderName
    }).select().single();
    if(error)throw error;
    savedPlaces.unshift({id:data.id,refType,refId,name,lat,lng,folderName,savedAt:data.saved_at});
    refreshSpotMarkers();
    showToast(`Saved to "${folderName}"`);
  }catch(e){
    console.warn('[Supabase] save place failed:',e);
    showToast('Could not save — check connection');
  }
}

function _createAndSavePlace(refType,refId,name,lat,lng){
  const inp=document.getElementById('_newPlaceFolderInput');
  const folderName=(inp?.value||'').trim();
  if(!folderName){showToast('Enter a folder name');return;}
  _savePlaceToFolder(refType,refId,name,lat,lng,folderName);
  document.getElementById('_placeSaveSheet')?.remove();
}

// Post overflow: "Save Spot" — saves the post's tagged spot or raw lat/lng location
function savePostLocation(postId){
  const post=getPosts().find(p=>String(p.id)===String(postId))||_feedPosts?.find(p=>String(p.id)===String(postId));
  if(!post){showToast('Post not found');return;}
  if(post.spotId){
    const s=[...spots,...userSpots].find(x=>String(x.id)===String(post.spotId));
    openPlaceSaveSheet('spot',post.spotId,s?.name||post.spotName||'Spot',s?.lat||post.lat,s?.lng||post.lng);
  } else if(post.lat&&post.lng){
    openPlaceSaveSheet('raw_location',null,post.caption?.slice(0,40)||'Saved location',post.lat,post.lng);
  } else {
    showToast('This post has no location to save');
  }
}

function openSaveFolderSheet(postId,triggerEl){
  const existing=document.getElementById('_saveFolderSheet');
  if(existing)existing.remove();
  const folders=_getSavedFolders();
  const sheet=document.createElement('div');
  sheet.id='_saveFolderSheet';
  sheet.style.cssText='position:fixed;inset:0;z-index:9500;display:flex;flex-direction:column;justify-content:flex-end';
  sheet.innerHTML=`
    <div style="position:absolute;inset:0;background:rgba(0,0,0,.55)" onclick="document.getElementById('_saveFolderSheet').remove()"></div>
    <div style="position:relative;background:var(--bg1);border-radius:20px 20px 0 0;padding:16px 16px calc(env(safe-area-inset-bottom,0px) + 16px);max-height:70vh;overflow-y:auto">
      <div style="font-size:15px;font-weight:700;color:var(--txt0);margin-bottom:14px">Save to Folder</div>
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <input id="_newFolderInput" placeholder="New folder name…" style="flex:1;height:40px;background:var(--bg2);border:1px solid var(--border2);border-radius:10px;color:var(--txt0);padding:0 12px;font-size:13px;outline:none;font-family:var(--font)">
        <button onclick="_createAndSaveFolder('${postId}')" style="height:40px;padding:0 16px;background:var(--accent);color:#0f1a0a;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:var(--font);white-space:nowrap">Create</button>
      </div>
      ${folders.length?folders.map(f=>`
        <div onclick="_savePostToFolder('${postId}','${f.name.replace(/'/g,"\\'")}');document.getElementById('_saveFolderSheet').remove()" style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);cursor:pointer;-webkit-tap-highlight-color:transparent">
          <div style="width:38px;height:38px;border-radius:10px;background:var(--bg3);display:flex;align-items:center;justify-content:center">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          </div>
          <div>
            <div style="font-size:14px;font-weight:600;color:var(--txt0)">${sanitize(f.name)}</div>
            <div style="font-size:11px;color:var(--txt3)">${f.postIds.length} saved</div>
          </div>
        </div>`).join(''):'<div style="font-size:13px;color:var(--txt3);text-align:center;padding:20px 0">No folders yet — create one above</div>'}
    </div>`;
  document.body.appendChild(sheet);
  if(triggerEl){const svg=triggerEl.querySelector('.feed-save-svg');if(svg){svg.setAttribute('fill','#B8E87A');svg.setAttribute('stroke','#B8E87A');}}
}

function _savePostToFolder(postId,folderName){
  if(isGuest()){showLoginScreen();return;}
  const folders=_getSavedFolders();
  let folder=folders.find(f=>f.name===folderName);
  if(!folder){folder={name:folderName,postIds:[]};folders.push(folder);}
  if(!folder.postIds.includes(postId))folder.postIds.push(postId);
  _setSavedFolders(folders);
  // Persist: folders are backed by saved_spots — save the post's tagged spot
  const post=getPosts().find(p=>String(p.id)===String(postId));
  if(post?.spotId)_sbTry(db.from('saved_spots').upsert({user_id:_myUid(),spot_id:post.spotId,folder_name:folderName}),'save to folder');
  // Also add to flat saved-posts list for backwards compat
  const saved=getSavedPostIds();
  if(!saved.includes(postId))saved.push(postId);
  setSavedPostIds(saved);
  showToast(`Saved to "${folderName}"`);
}

function _createAndSaveFolder(postId){
  const inp=document.getElementById('_newFolderInput');
  const name=(inp?.value||'').trim();
  if(!name){showToast('Enter a folder name');return;}
  _savePostToFolder(postId,name);
  document.getElementById('_saveFolderSheet')?.remove();
}

function openSavedFolder(folderName){
  const folders=_getSavedFolders();
  const folder=folders.find(f=>f.name===folderName);
  if(!folder)return;
  const allPosts=[..._feedPosts,...getPosts()];
  const posts=folder.postIds.map(id=>allPosts.find(p=>p.id===id)).filter(Boolean);
  const grid=document.getElementById('savedPostsGrid');
  const title=document.getElementById('savedPostsPageTitle');
  if(title)title.textContent=folderName;
  if(!grid)return;
  if(!posts.length){grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--txt3);font-size:13px">No posts in this folder</div>';return;}
  grid.innerHTML=posts.map(p=>{
    const thumb=p.photos?.[0]||p.mediaUrl||'';
    const bg=p.spotGradient||p.heroGradient||'linear-gradient(160deg,#0d1a0d,#1a3a2a)';
    const isGrad=thumb&&thumb.startsWith('gradient:');
    const gradVal=isGrad?thumb.replace('gradient:',''):null;
    const innerHtml=isGrad?`<div style="width:100%;height:100%;background:${gradVal}"></div>`:(thumb?`<img src="${thumb}" style="width:100%;height:100%;object-fit:cover">`:'');
    return`<div onclick="openPostDetail('${p.id}')" style="aspect-ratio:1;position:relative;overflow:hidden;cursor:pointer;background:${bg}">${innerHtml}</div>`;
  }).join('');
}

// ── Video intersection observer ────────────────────────────────
function _initVideoObserver(){
  const videos=document.querySelectorAll('.comm-video');
  if(!videos.length)return;
  const obs=new IntersectionObserver(entries=>{
    entries.forEach(e=>{
      if(e.isIntersecting) e.target.play().catch(()=>{});
      else{ e.target.pause(); e.target.currentTime=0;}
    });
  },{threshold:.5});
  videos.forEach(v=>obs.observe(v));
}
function toggleVideoSound(btn){
  const video=btn?.previousElementSibling;
  if(!video)return;
  video.muted=!video.muted;
  btn.innerHTML=video.muted?'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>':'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
}

// ── Communities tab ─────────────────────────────────────────────
function buildCommunitiesTab(){
  buildYourCommunitiesRow();
  buildDiscoverList();
}

function buildYourCommunitiesRow(){
  const row=document.getElementById('yourCommunitiesRow');
  if(!row)return;
  const all=getCommunities();
  const mine=all.filter(c=>getMembers(c.id).includes(String(_myUid()))||c.adminId===String(_myUid()));
  if(!mine.length){
    row.innerHTML='<div style="padding:8px 0;font-size:12px;color:var(--txt3)">You haven\'t joined any communities yet</div>';
    return;
  }
  row.innerHTML=mine.map(c=>_commCardHtml(c)).join('');
}

function _commCardHtml(c){
  const coverHtml=c.coverDataUrl
    ?`<img src="${c.coverDataUrl}" style="width:100%;height:100%;object-fit:cover">`
    :`<div style="width:100%;height:100%;${c.coverGrad||'background:var(--bg3)'};"></div>`;
  return `<div class="comm-card" onclick="openCommunityDetail('${c.id}')">
    <div class="comm-card-cover">${coverHtml}</div>
    <div class="comm-card-name">${sanitize(c.name)}</div>
    <div class="comm-card-members">${_fmt(c.memberCount)} members</div>
  </div>`;
}

function buildDiscoverList(){
  const list=document.getElementById('discoverCommunitiesList');
  if(!list)return;
  const all=getCommunities();
  const myUid=String(_myUid());
  const notJoined=all.filter(c=>c.privacy!=='secret'&&!getMembers(c.id).includes(myUid)&&c.adminId!==myUid);
  if(!notJoined.length){list.innerHTML='<div style="padding:12px 16px;font-size:12px;color:var(--txt3)">You\'ve joined all public communities!</div>';return;}
  list.innerHTML=notJoined.map(c=>{
    const coverHtml=c.coverDataUrl
      ?`<img src="${c.coverDataUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:10px">`
      :`<div style="width:100%;height:100%;${c.coverGrad||'background:var(--bg3)'};border-radius:10px;"></div>`;
    return `<div class="comm-discover-row">
      <div class="comm-discover-cover">${coverHtml}</div>
      <div class="comm-discover-info">
        <div class="comm-discover-name">${sanitize(c.name)}</div>
        <div class="comm-discover-desc">${c.desc||''}</div>
        <div class="comm-discover-members">${_fmt(c.memberCount||0)} members</div>
      </div>
      <button class="comm-join-btn${getPendingMembers(c.id).includes(String(_myUid()))?'':''}" id="joinBtn_${c.id}" onclick="event.stopPropagation();joinCommunity('${c.id}',this)" ${getPendingMembers(c.id).includes(String(_myUid()))?'style="opacity:.6;pointer-events:none"':''}>${getPendingMembers(c.id).includes(String(_myUid()))?'Pending':'Request'}</button>
    </div>`;
  }).join('');
}

function _fmt(n){if(n>=1000)return(n/1000).toFixed(1)+'k';return String(n);}

function joinCommunity(cid,btn){
  if(isGuest()){showLoginScreen(()=>joinCommunity(cid,btn));return;}
  const comms=getCommunities();
  const c=comms.find(x=>x.id===cid);
  if(!c)return;
  const uid=String(_myUid());
  const members=getMembers(cid);
  if(members.includes(uid))return; // already a member
  if(c.privacy==='private'){
    const pending=getPendingMembers(cid);
    if(pending.includes(uid)){showToast('Your request is still pending approval');return;}
    pending.push(uid);
    setPendingMembers(cid,pending);
    _sbNotify(c.adminId,'join_request','requested to join '+c.name);
    showToast('Join request sent — waiting for admin approval');
    if(btn){btn.textContent='Request Pending';btn.style.opacity='0.6';btn.style.pointerEvents='none';}
    return;
  }
  members.push(uid);
  setMembers(cid,members);
  c.memberCount=(c.memberCount||0)+1;
  setCommunities(comms);
  _sbTry(db.from('community_members').insert({community_id:cid,user_id:uid}),'join community');
  if(btn){btn.textContent='Member';btn.classList.add('joined');}
  showToast('Joined '+c.name+'!');
}

function showAllCommunities(){
  buildCommunitiesTab();
  showToast('Showing all communities');
}

// ── Community Detail Page ──────────────────────────────────────
function openCommunityDetail(cid){
  _currentCommunityId=cid;
  const page=document.getElementById('communityDetailPage');
  if(!page)return;
  _renderCommunityDetail(cid);
  page.classList.add('open');
}

function closeCommunityDetail(){
  const page=document.getElementById('communityDetailPage');
  if(page)page.classList.remove('open');
  _currentCommunityId=null;
}

function _renderCommunityDetail(cid){
  const comms=getCommunities();
  const c=comms.find(x=>x.id===cid);
  if(!c)return;
  const hdr=document.getElementById('commDetailHeader');
  const body=document.getElementById('commDetailBody');
  const members=getMembers(cid);
  const isMember=members.includes(String(_myUid()));
  const isAdminOfComm=c.adminId===String(_myUid())||_isAdmin();
  const postIds=getCPosts(cid);
  const allPosts=getPosts().filter(p=>p.communityIds?.includes(cid));
  const spots_count=new Set(allPosts.filter(p=>p.spotId).map(p=>p.spotId)).size;

  const coverHtml=c.coverDataUrl
    ?`<img src="${c.coverDataUrl}" style="width:100%;height:100%;object-fit:cover">`
    :`<div style="width:100%;height:100%;${c.coverGrad||'background:linear-gradient(135deg,#1a3a2a,#2d5a3a)'};"></div>`;

  hdr.innerHTML=`
    <div class="comm-detail-cover" ${isAdminOfComm?`onclick="if(event.target.closest('.cfp-back')||event.target.closest('.comm-detail-settings'))return;document.getElementById('commCoverTapInput').click()" style="cursor:pointer"`:''}>
      ${coverHtml}
      <div class="comm-detail-cover-grad"></div>
      ${isAdminOfComm?`<div style="position:absolute;top:54px;right:60px;width:34px;height:34px;border-radius:50%;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;pointer-events:none"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></div><input type="file" id="commCoverTapInput" accept="image/*" style="display:none" onchange="_handleCoverTapUpload(event,'${cid}')">`:''}
      <button class="cfp-back" onclick="closeCommunityDetail()" style="position:absolute;top:54px;left:14px;background:rgba(0,0,0,.45);width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;border:none;cursor:pointer">←</button>
      ${isAdminOfComm?`<div class="comm-detail-settings" onclick="openCommSettings('${cid}')"><svg viewBox='0 0 24 24' width='18' height='18' fill='none' stroke='currentColor' stroke-width='2'><circle cx='12' cy='12' r='3'/><path d='M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'/></svg></div>`:''}
      <div class="comm-detail-cover-name">${sanitize(c.name)}</div>
    </div>
    <div class="comm-stats-row">
      <div class="comm-stat-item"><div class="comm-stat-val">${allPosts.length}</div><div class="comm-stat-label">Posts</div></div>
      <div class="comm-stat-divider"></div>
      <div class="comm-stat-item"><div class="comm-stat-val">${_fmt(c.memberCount||members.length)}</div><div class="comm-stat-label">Members</div></div>
      <div class="comm-stat-divider"></div>
      <div class="comm-stat-item"><div class="comm-stat-val">${spots_count}</div><div class="comm-stat-label">Spots</div></div>
    </div>`;

  const isPending=getPendingMembers(cid).includes(String(_myUid()));
  let joinHtml='';
  if(c.adminId===String(_myUid()))joinHtml=`<div class="comm-join-big joined" style="cursor:default">You're the Admin</div>`;
  else if(isMember)joinHtml=`<div class="comm-join-big joined" onclick="leaveCommunity('${cid}')">Member — Tap to Leave</div>`;
  else if(isPending)joinHtml=`<div class="comm-join-big" style="opacity:.6;pointer-events:none">Request Pending</div>`;
  else joinHtml=`<div class="comm-join-big" onclick="joinCommunity('${cid}',this);_renderCommunityDetail('${cid}')">Join Community</div>`;

  body.innerHTML=`
    ${joinHtml}
    ${c.desc?`<div class="comm-desc-section"><div style="font-size:13px;color:var(--txt2);line-height:1.5">${sanitize(c.desc)}</div></div>`:''}
    ${c.rules?`<div class="comm-rules-card" onclick="this.querySelector('.comm-rules-body').classList.toggle('open');this.querySelector('.comm-rules-arrow').textContent=this.querySelector('.comm-rules-body').classList.contains('open')?'▲':'▼'">
      <div class="comm-rules-hdr"><span>Community Rules</span><span class="comm-rules-arrow">▼</span></div>
      <div class="comm-rules-body"><pre style="font-family:inherit;font-size:12px;white-space:pre-wrap;color:var(--txt2)">${sanitize(c.rules)}</pre></div>
    </div>`:''}
    <div class="comm-post-to" onclick="openCreatePostForCommunity('${cid}')">
      <div style="width:36px;height:36px;background:rgba(184,232,122,.1);border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--accent)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></div>
      <div><div style="font-size:13px;font-weight:600;color:var(--txt0)">Post to Community</div><div style="font-size:11px;color:var(--txt3);margin-top:1px">Share photos, tips, or spot drops</div></div>
    </div>
    <div style="display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:0">
      <div id="commTabPosts" onclick="setCommView('posts',this,'${cid}')" style="flex:1;text-align:center;padding:10px;font-size:13px;font-weight:700;color:var(--txt0);cursor:pointer;border-bottom:2px solid var(--accent)">Posts</div>
      <div id="commTabMap" onclick="setCommView('map',this,'${cid}')" style="flex:1;text-align:center;padding:10px;font-size:13px;font-weight:600;color:${isMember?'var(--txt2)':'var(--txt3)'};cursor:pointer;border-bottom:2px solid transparent;display:flex;align-items:center;justify-content:center;gap:5px">${isMember?'':'<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'}Map</div>
    </div>
    <div id="commPostsView">
      <div class="comm-sort-pills" id="commSortPills">
        <div class="comm-sort-pill active" onclick="setCommSort('hot',this)">Hot</div>
        <div class="comm-sort-pill" onclick="setCommSort('new',this)">New</div>
        <div class="comm-sort-pill" onclick="setCommSort('top',this)">Top</div>
      </div>
      <div id="commDetailFeed"></div>
    </div>
    <div id="commMapView" style="display:none;min-height:400px;position:relative">
      <div id="commMapEl" style="position:absolute;inset:0;min-height:400px"></div>
    </div>`;

  _buildCommDetailFeed(cid);
}

function setCommView(view,el,cid){
  const activeCid=cid||_currentCommunityId;
  const postsView=document.getElementById('commPostsView');
  const mapView=document.getElementById('commMapView');
  const tabPosts=document.getElementById('commTabPosts');
  const tabMap=document.getElementById('commTabMap');

  if(view==='map'){
    // Gate map behind membership
    const comms=getCommunities();
    const c=comms.find(x=>x.id===activeCid);
    const uid=String(_myUid());
    const isMember=getMembers(activeCid).includes(uid)||(c&&c.adminId===uid);

    // Update tab styles
    if(tabPosts){tabPosts.style.borderBottomColor='transparent';tabPosts.style.color='var(--txt2)';tabPosts.style.fontWeight='600';}
    if(tabMap){tabMap.style.borderBottomColor='var(--accent)';tabMap.style.color='var(--txt0)';tabMap.style.fontWeight='700';}
    if(postsView)postsView.style.display='none';
    if(mapView)mapView.style.display='block';

    if(!isMember){
      // Show a visible locked state inside the map view
      const isPending=getPendingMembers(activeCid).includes(uid);
      if(mapView)mapView.innerHTML=`<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 24px;text-align:center;min-height:300px">
        <div style="width:52px;height:52px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;margin-bottom:16px">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="var(--txt2)" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </div>
        <div style="font-size:16px;font-weight:700;color:var(--txt0);margin-bottom:8px">Members Only</div>
        <div style="font-size:13px;color:var(--txt2);margin-bottom:20px;line-height:1.5">${isPending?'Your join request is pending admin approval.':'Join this community to see member-shared spots on the map.'}</div>
        ${isPending?`<div style="padding:10px 20px;border-radius:20px;background:var(--bg3);color:var(--txt3);font-size:13px;font-weight:600">Request Pending</div>`:`<div onclick="joinCommunity('${activeCid}',this);setCommView('map',null,'${activeCid}')" style="padding:11px 24px;border-radius:20px;background:var(--accent);color:#0b1a0b;font-size:13px;font-weight:700;cursor:pointer">Request to Join</div>`}
      </div>`;
      return;
    }

    // Member — build the inline map
    if(mapView){
      mapView.style.cssText='display:block;height:420px;position:relative';
      // Ensure commMapEl exists inside mapView
      if(!mapView.querySelector('#commMapEl')){
        mapView.innerHTML='<div id="commMapEl" style="position:absolute;inset:0"></div>';
      }
    }
    _buildCommMap(activeCid);
    return;
  }

  // Posts view
  if(postsView)postsView.style.display='block';
  if(mapView)mapView.style.display='none';
  if(tabPosts){tabPosts.style.borderBottomColor='var(--accent)';tabPosts.style.color='var(--txt0)';tabPosts.style.fontWeight='700';}
  if(tabMap){tabMap.style.borderBottomColor='transparent';tabMap.style.color='var(--txt2)';tabMap.style.fontWeight='600';}
}

function openCommunityMap(cid){
  if(!cid)return;
  const page=document.getElementById('communityMapPage');
  if(!page)return;
  _addSpotCommunityId=cid;
  const comms=getCommunities();
  const comm=comms.find(c=>c.id===cid);
  const titleEl=document.getElementById('communityMapTitle');
  if(titleEl)titleEl.textContent=(comm?.name||'Community')+' Map';
  page.style.display='flex';
  _buildCommunityFullMap(cid);
}

function closeCommunityMap(){
  const page=document.getElementById('communityMapPage');
  if(page)page.style.display='none';
  _addSpotCommunityId=null;
}

function openAddSpotFromCommunityMap(){
  // Hide community map without clearing _addSpotCommunityId
  const page=document.getElementById('communityMapPage');
  if(page)page.style.display='none';
  // Navigate to map tab so user can place pin
  showTab('map');
  setTimeout(()=>openAddSpot(),250);
}

function _buildCommunityFullMap(cid){
  const container=document.getElementById('communityMapEl');
  if(!container)return;
  // Always rebuild (community spots may have changed)
  if(container._mapInst){try{container._mapInst.remove();}catch(e){} container._mapInst=null; container.innerHTML='';}
  const tok=localStorage.getItem('mapbox-token')||'';
  // Gather spots: community-specific spots + posts with location
  const commSpots=getCommunitySpots(cid);
  const posts=getPosts().filter(p=>p.communityIds?.includes(cid)&&(p.lat||p.spotId));
  const allS=[...spots,...userSpots,...commSpots];
  const pinMap=new Map();
  commSpots.forEach(s=>{if(s.lat&&s.lng)pinMap.set(`${s.lat},${s.lng}`,{lat:s.lat,lng:s.lng,name:s.name,id:s.id});});
  posts.forEach(p=>{
    let lat=p.lat,lng=p.lng,name=p.spotName||p.username||'Post';
    if(!lat&&p.spotId){const s=allS.find(x=>x.id===p.spotId);if(s){lat=s.lat;lng=s.lng;name=s.name;}}
    if(lat&&lng){const k=`${lat},${lng}`;if(!pinMap.has(k))pinMap.set(k,{lat,lng,name});}
  });
  const pins=[...pinMap.values()];
  if(!tok){
    container.innerHTML=`<div style="padding:20px 16px;color:var(--txt3);font-size:13px"><div style="font-size:15px;font-weight:700;color:var(--txt0);margin-bottom:12px">Community Spots</div>${pins.length?pins.map(p=>`<div style="padding:10px 0;border-bottom:1px solid var(--border)"><div style="color:var(--txt0);font-size:13px">${p.name}</div><div style="font-size:11px;color:var(--txt3);margin-top:2px">${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}</div></div>`).join(''):'<div style="color:var(--txt3);padding:20px 0">No spots yet — tap Add Spot to be first!</div>'}<div style="margin-top:16px;font-size:11px;color:var(--txt3)">Add a Mapbox token in settings to enable map view</div></div>`;
    return;
  }
  mapboxgl.accessToken=tok;
  try{
    const center=pins.length?[pins[0].lng,pins[0].lat]:[-121.5,38.5];
    const m=new mapboxgl.Map({container,style:'mapbox://styles/mapbox/dark-v11',center,zoom:pins.length?8:5,interactive:true,attributionControl:false});
    container._mapInst=m;
    m.on('load',()=>{
      pins.forEach(p=>{
        new mapboxgl.Marker({color:'#B8E87A',scale:0.9}).setLngLat([p.lng,p.lat]).setPopup(new mapboxgl.Popup({offset:20}).setText(p.name)).addTo(m);
      });
      if(pins.length>1){
        const lngs=pins.map(p=>p.lng),lats=pins.map(p=>p.lat);
        m.fitBounds([[Math.min(...lngs)-.1,Math.min(...lats)-.1],[Math.max(...lngs)+.1,Math.max(...lats)+.1]],{padding:70,duration:600});
      }
    });
  }catch(e){console.warn('Community map failed',e);}
}
function _buildCommMap(cid){
  const container=document.getElementById('commMapEl');
  if(!container)return;
  // If already built for this same community, skip
  if(container._mapInit&&container._mapCid===cid)return;
  // Tear down previous map instance if switching communities
  if(container._mapInst){try{container._mapInst.remove();}catch(e){}container._mapInst=null;}
  container._mapInit=false;
  container._mapCid=cid;
  const token=localStorage.getItem('mapbox-token')||'';
  const posts=getPosts().filter(p=>p.communityIds?.includes(cid)&&(p.lat||p.spotId));
  const allS=[...spots,...userSpots];
  const mapPins=posts.map(p=>{
    if(p.lat&&p.lng)return{lat:p.lat,lng:p.lng,name:p.spotName||p.username||'Post'};
    const s=allS.find(x=>x.id===p.spotId);
    return s?{lat:s.lat,lng:s.lng,name:s.name}:null;
  }).filter(Boolean);
  if(!token){
    container.innerHTML=`<div style="padding:20px;color:var(--txt3);font-size:13px"><div style="font-size:14px;font-weight:700;color:var(--txt0);margin-bottom:12px">Community Spot Locations</div>${mapPins.length?mapPins.map(p=>`<div style="padding:10px;border-bottom:1px solid var(--border)">${p.name}<br><span style="font-size:11px;color:var(--txt3)">${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}</span></div>`).join(''):'<div style="color:var(--txt3)">No location data</div>'}${!token?'<div style="margin-top:12px;font-size:11px;color:var(--txt3)">Add a Mapbox token to enable map view</div>':''}</div>`;
    return;
  }
  container._mapInit=true;
  mapboxgl.accessToken=token;
  try{
    const m=new mapboxgl.Map({container,style:'mapbox://styles/mapbox/dark-v11',center:mapPins.length?[mapPins[0].lng,mapPins[0].lat]:[-121.5,38.5],zoom:mapPins.length?8:5,interactive:true,attributionControl:false});
    container._mapInst=m;
    m.on('load',()=>{
      mapPins.forEach(p=>{
        new mapboxgl.Marker({color:'#B8E87A',scale:.8}).setLngLat([p.lng,p.lat]).setPopup(new mapboxgl.Popup({offset:20}).setText(p.name)).addTo(m);
      });
    });
  }catch(e){console.warn('Community inline map failed',e);}
}

function setCommSort(s,el){
  _commSortMode=s;
  document.querySelectorAll('.comm-sort-pill').forEach(p=>p.classList.remove('active'));
  if(el)el.classList.add('active');
  _buildCommDetailFeed(_currentCommunityId);
}

function _buildCommDetailFeed(cid){
  const container=document.getElementById('commDetailFeed');
  if(!container)return;
  let posts=getPosts().filter(p=>p.communityIds?.includes(cid));
  if(_commSortMode==='new') posts.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  else if(_commSortMode==='top') posts.sort((a,b)=>(b.likes?.length||0)-(a.likes?.length||0));
  else posts.sort((a,b)=>{
    const scoreA=(b.likes?.length||0)+getComments(a.id).length*2;
    const scoreB=(b.likes?.length||0)+getComments(b.id).length*2;
    return scoreB-scoreA;
  });
  if(!posts.length){container.innerHTML='<div style="text-align:center;padding:32px 20px;color:var(--txt3)"><div style="font-size:13px">No posts yet — be the first!</div></div>';return;}
  container.innerHTML=posts.map(p=>_redditPostHtml(p)).join('');
}

function _redditPostHtml(post){
  const votes=_getPostVoteScore(post.id);
  const myVote=_getMyVote(post.id);
  const commentCount=getComments(post.id).length;
  const verif=_userVerified(post.userId)||post.verified;

  let contentHtml='';
  if(post.type==='photo'&&post.mediaUrl){
    contentHtml=`<img class="reddit-post-img" src="${post.mediaUrl}" loading="lazy" onerror="this.style.display='none'"><div class="reddit-post-body">${sanitize(post.caption)}</div>`;
  } else if(post.type==='text'){
    contentHtml=`<div class="reddit-post-title">${sanitize((post.caption||'').slice(0,80))}</div><div class="reddit-post-body">${sanitize((post.caption||'').slice(80))}</div>`;
  } else if(post.type==='spotdrop'&&post.spotdrop){
    const sd=post.spotdrop;
    contentHtml=`<div class="reddit-spotdrop-map" style="height:130px">
      <div style="width:100%;height:100%;background:linear-gradient(135deg,#1a3a2a,#2d5a3a);display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--txt2)">${(sd.lat||37.5).toFixed(4)}, ${(sd.lng||-120).toFixed(4)}</div>
    </div>
    <div class="reddit-spotdrop-info">
      <div style="font-size:12px;font-weight:700;color:var(--txt0)">${sanitize(sd.name)}</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:3px">
        <span class="post-type-badge">${sanitize(sd.type)}</span>
        <span class="post-type-badge" style="color:${sd.legal==='legal'?'var(--green)':sd.legal==='illegal'?'var(--red)':'var(--yellow)'}">${sd.legal==='legal'?'Legal':sd.legal==='illegal'?'Illegal':'Caution'}</span>
      </div>
      ${sd.approach?`<div style="font-size:10px;color:var(--txt2);margin-top:4px;line-height:1.4">${sanitize(sd.approach.slice(0,100))}…</div>`:''}
      ${votes>=10&&_isAdmin()?`<button class="reddit-approve-btn" onclick="approveSpotDrop('${post.id}')">Add to WildPath Map</button>`:''}
    </div>`;
  } else {
    contentHtml=`<div class="reddit-post-body">${sanitize(post.caption)}</div>`;
  }

  const longPressAttrs=`oncontextmenu="event.preventDefault();showPostCtxMenu(event,'${post.id}')" ontouchstart="_startLongPress(event,'${post.id}')" ontouchend="_cancelLongPress()"`;
  return `<div class="reddit-post" onclick="openPostDetail('${post.id}')" ${longPressAttrs}>
    <div class="vote-col" onclick="event.stopPropagation()">
      <button class="vote-btn up${myVote===1?' voted':''}" onclick="castVote('${post.id}',1,this)">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>
      </button>
      <span class="vote-score${votes>0?' positive':votes<0?' negative':''}" id="vs_${post.id}">${votes}</span>
      <button class="vote-btn down${myVote===-1?' voted':''}" onclick="castVote('${post.id}',-1,this)">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
    </div>
    <div class="reddit-post-content">
      ${contentHtml}
      <div class="reddit-post-meta">
        <span onclick="event.stopPropagation();openUserProfile('${post.userId}')" style="cursor:pointer">${sanitize(post.username)}${verif?_verifiedBadge():''}</span>
        <span>· ${_timeAgo(post.createdAt)}</span>
        <div class="reddit-post-comments" onclick="event.stopPropagation();openPostDetail('${post.id}')">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          ${commentCount}
        </div>
      </div>
    </div>
  </div>`;
}

// ── Vote system ────────────────────────────────────────────────
function _getPostVoteScore(postId){
  const v=getVotes();
  return Object.entries(v).filter(([k])=>k.startsWith(postId+'_')).reduce((s,[,val])=>s+val,0);
}
function _getMyVote(postId){const v=getVotes();return v[postId+'_'+_myUid()]||0;}
function castVote(postId,dir,btn){
  if(isGuest()){showLoginScreen();return;}
  const v=getVotes();
  const key=postId+'_'+_myUid();
  const current=v[key]||0;
  if(current===dir) v[key]=0; // undo vote
  else v[key]=dir;
  setVotes(v);
  const newScore=_getPostVoteScore(postId);
  const scoreEl=document.getElementById('vs_'+postId);
  if(scoreEl){
    scoreEl.textContent=newScore;
    scoreEl.className='vote-score'+(newScore>0?' positive':newScore<0?' negative':'');
  }
  // Update btn states
  const col=btn?.closest('.vote-col');
  if(col){
    col.querySelector('.vote-btn.up')?.classList.toggle('voted',v[key]===1);
    col.querySelector('.vote-btn.down')?.classList.toggle('voted',v[key]===-1);
  }
  // Check for spot drop nomination threshold
  const posts=getPosts();
  const p=posts.find(x=>x.id===postId);
  if(p?.type==='spotdrop'&&newScore===10){
    _addNotif(_isAdmin()?_myUid():'admin','spotdrop',_myName(),`New spot nominated by community — review and approve: "${p.spotdrop?.name}"`);
    showToast('Spot has 10 votes — admin notified!');
  }
}

// ── Long press context menu ────────────────────────────────────
let _lpTimer=null;
function _startLongPress(event,postId){
  _lpTimer=setTimeout(()=>showPostCtxMenu(event,postId),600);
}
function _cancelLongPress(){clearTimeout(_lpTimer);}
function showPostCtxMenu(event,postId){
  if(event?.preventDefault)event.preventDefault();
  const posts=getPosts();
  const post=posts.find(p=>p.id===postId);
  if(!post)return;
  const isOwn=String(post.userId)===String(_myUid());
  const saveItem=(post.spotId||(post.lat&&post.lng))?`<div class="ctx-menu-item" onclick="closeCtxMenu();savePostLocation('${postId}')">Save Spot</div>`:'';
  let items='';
  if(_isAdmin()){
    items=`${saveItem}<div class="ctx-menu-item" onclick="ctxPinPost('${postId}')">Pin Post</div>
      <div class="ctx-menu-item danger" onclick="ctxDeletePost('${postId}')">Delete Post</div>
      <div class="ctx-menu-item danger" onclick="ctxBanMember('${post.userId}')">Ban Member</div>`;
  } else if(isOwn){
    items=`${saveItem}<div class="ctx-menu-item danger" onclick="ctxDeletePost('${postId}')">Delete Post</div>`;
  } else {
    items=`${saveItem}<div class="ctx-menu-item" onclick="ctxReportPost('${postId}')">Report Post</div>`;
  }
  const menu=document.getElementById('commCtxMenu');
  const overlay=document.getElementById('commCtxOverlay');
  if(!menu||!items)return;
  menu.innerHTML=items;
  const appRect=document.getElementById('app').getBoundingClientRect();
  const x=Math.min((event?.clientX||200)-appRect.left,appRect.width-180);
  const y=Math.min((event?.clientY||300)-appRect.top,appRect.height-120);
  menu.style.left=x+'px'; menu.style.top=y+'px';
  menu.style.display='block'; overlay.style.display='block';
}
function closeCtxMenu(){
  const menu=document.getElementById('commCtxMenu');
  const overlay=document.getElementById('commCtxOverlay');
  if(menu)menu.style.display='none';
  if(overlay)overlay.style.display='none';
}
function ctxPinPost(id){closeCtxMenu();showToast('Post pinned to top');}
function ctxDeletePost(id){
  closeCtxMenu();
  if(!confirm('Delete this post?'))return;
  const posts=getPosts().filter(p=>p.id!==id);
  setPosts(posts);
  buildFeed();
  if(_currentCommunityId)_buildCommDetailFeed(_currentCommunityId);
  showToast('Post deleted');
}
function ctxBanMember(uid){closeCtxMenu();showToast('Member removed from community');}
function ctxReportPost(id){closeCtxMenu();showToast('Post reported — thank you');}

function leaveCommunity(cid){
  _sbTry(db.from('community_members').delete().eq('community_id',cid).eq('user_id',_myUid()),'leave community');
  const members=getMembers(cid).filter(m=>m!==String(_myUid()));
  setMembers(cid,members);
  const comms=getCommunities();
  const c=comms.find(x=>x.id===cid);
  if(c){c.memberCount=Math.max(0,(c.memberCount||1)-1);setCommunities(comms);}
  closeCommunityDetail();
  buildCommunitiesTab();
  showToast('Left community');
}

// ── Post Detail Page ───────────────────────────────────────────
function openPostDetail(postId){
  _currentPostId=postId;
  const posts=getPosts();
  const post=posts.find(p=>p.id===postId);
  if(!post)return;
  const page=document.getElementById('postDetailPage');
  if(!page)return;
  _renderPostDetail(post);
  page.classList.add('open');
  // Update comment avatar
  const ca=document.getElementById('commentAvatarSmall');
  if(ca)ca.innerHTML=_myInitials();
  _commentReplyTo=null;
}

function closePostDetail(){
  const page=document.getElementById('postDetailPage');
  if(page)page.classList.remove('open');
  _currentPostId=null;
}

function _renderPostDetail(post){
  const body=document.getElementById('postDetailBody');
  if(!body)return;
  const profileData=getUserProfile(post.userId)||{};
  const verif=_userVerified(post.userId)||post.verified;
  const following=_isFollowing(post.userId);
  const myLiked=(post.likes||[]).includes(_myUid());
  const likeCount=(post.likes||[]).length;

  let mediaHtml='';
  if(post.type==='photo'&&post.mediaUrl){
    mediaHtml=`<img class="post-detail-media" src="${post.mediaUrl}" ondblclick="handlePostDoubleTap(event,'${post.id}')">`;
  } else if(post.type==='video'&&post.mediaUrl){
    mediaHtml=`<video class="post-detail-media" src="${post.mediaUrl}" autoplay loop muted playsinline controls style="width:100%;display:block"></video>`;
  }

  const comments=getComments(post.id);
  const topComments=comments.filter(c=>!c.parentId);
  const commentsHtml=topComments.map(c=>{
    const replies=comments.filter(r=>r.parentId===c.id);
    return _commentHtml(c)+replies.map(r=>_commentHtml(r,true)).join('');
  }).join('');

  body.innerHTML=`
    ${mediaHtml}
    <div class="post-detail-user-row">
      <div onclick="openUserProfile('${post.userId}')" style="cursor:pointer">${_avatarHtml(post.username,36,profileData.avatarUrl||null)}</div>
      <div style="flex:1;margin-left:10px" onclick="openUserProfile('${post.userId}')">
        <div style="font-size:13px;font-weight:700;color:var(--txt0);display:flex;align-items:center;gap:4px">${sanitize(post.username)}${verif?_verifiedBadge():''}</div>
        <div style="font-size:10px;color:var(--txt3)">${_timeAgo(post.createdAt)}</div>
      </div>
      ${String(post.userId)!==String(_myUid())?`<button class="follow-btn${following?' following':''}" onclick="toggleFollow('${post.userId}',this)">${following?'Following':'Follow'}</button>`:''}
    </div>
    ${post.spotName?`<div style="padding:8px 16px"><div class="post-spot-pill" onclick="openSpotFromPost('${post.spotId}')">${sanitize(post.spotName)}</div></div>`:''}
    ${post.caption?`<div class="post-caption" style="padding:8px 16px 12px;font-size:13px">${sanitize(post.caption)}</div>`:''}
    <div class="post-actions" style="border-top:1px solid rgba(255,255,255,.06);border-bottom:1px solid rgba(255,255,255,.06);padding:10px 16px">
      <div class="post-action${myLiked?' liked':''}" onclick="togglePostLike('${post.id}',this)">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="${myLiked?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        <span class="post-like-count">${likeCount}</span>
      </div>
      <div class="post-action"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span>${getComments(post.id).length}</span></div>
      <div class="post-action" onclick="sharePost('${post.id}')"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></div>
      <div class="post-action" onclick="bookmarkPost('${post.id}',this)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></div>
    </div>
    <div style="padding:12px 16px 4px;font-size:13px;font-weight:700;color:var(--txt0)">Comments</div>
    <div class="comments-section" id="commentsListBody">${commentsHtml||'<div style="padding:16px;text-align:center;color:var(--txt3);font-size:12px">No comments yet — start the conversation!</div>'}</div>`;
}

function _commentHtml(c,isReply=false){
  const isOwn=String(c.userId)===String(_myUid());
  const verif=_userVerified(c.userId);
  return `<div class="comment-item${isReply?' reply':''}" oncontextmenu="event.preventDefault();showCommentCtx('${c.id}','${isOwn}')" ontouchstart="_startCommentLongPress('${c.id}','${isOwn}')" ontouchend="_cancelLongPress()">
    <div style="display:flex;gap:8px;align-items:flex-start">
      ${_avatarHtml(c.username,24)}
      <div style="flex:1">
        <div class="comment-user">${sanitize(c.username)}${verif?_verifiedBadge():''}</div>
        <div class="comment-text">${sanitize(c.text)}</div>
        <div class="comment-meta">
          <span>${_timeAgo(c.createdAt)}</span>
          ${!isReply?`<span class="comment-reply-btn" onclick="setCommentReply('${c.id}','${c.username}')">Reply</span>`:''}
        </div>
      </div>
    </div>
  </div>`;
}

function setCommentReply(parentId,username){
  _commentReplyTo=parentId;
  const inp=document.getElementById('commentInput');
  if(inp){inp.placeholder=`Reply to @${username}…`;inp.focus();}
}

function showCommentCtx(cid,isOwn){
  const menu=document.getElementById('commCtxMenu');
  const overlay=document.getElementById('commCtxOverlay');
  if(!menu)return;
  menu.innerHTML=isOwn==='true'||isOwn===true
    ?`<div class="ctx-menu-item danger" onclick="deleteComment('${cid}')">Delete</div>`
    :`<div class="ctx-menu-item" onclick="closeCtxMenu();showToast('Comment reported')">Report</div>`;
  menu.style.left='50%'; menu.style.top='40%';
  menu.style.transform='translateX(-50%)';
  menu.style.display='block'; overlay.style.display='block';
}
let _commentLpTimer=null;
function _startCommentLongPress(cid,isOwn){_commentLpTimer=setTimeout(()=>showCommentCtx(cid,isOwn),600);}

function deleteComment(cid){
  closeCtxMenu();
  if(!_currentPostId)return;
  const arr=getComments(_currentPostId).filter(c=>c.id!==cid&&c.parentId!==cid);
  setComments(_currentPostId,arr);
  _renderPostDetail(getPosts().find(p=>p.id===_currentPostId));
}

function submitComment(){
  if(isGuest()){showLoginScreen();return;}
  const inp=document.getElementById('commentInput');
  const text=(inp?.value||'').trim();
  if(!text||!_currentPostId)return;
  const posts=getPosts();
  const post=posts.find(p=>p.id===_currentPostId);
  const newComment={
    id:_uid(),postId:_currentPostId,
    userId:_myUid(),username:_myName(),
    verified:_userVerified(_myUid()),
    text,createdAt:new Date().toISOString(),
    parentId:_commentReplyTo||null
  };
  const arr=getComments(_currentPostId);
  arr.push(newComment);
  setComments(_currentPostId,arr);
  // Write through to Supabase (replies flatten to top-level comments in Phase 2)
  db.from('comments').insert({post_id:_currentPostId,user_id:_myUid(),content:text}).select().single()
    .then(({data,error})=>{
      if(error){console.warn('[Supabase] comment:',error.message);return;}
      newComment.id=data.id;newComment.createdAt=data.created_at;
    });
  if(post)_addNotif(post.userId,'comment',_myName(),'commented on your post');
  inp.value='';
  inp.placeholder='Add a comment…';
  _commentReplyTo=null;
  _renderPostDetail(post);
  showToast('Comment posted');
}

// ── Follow system ──────────────────────────────────────────────
function toggleFollow(uid,btn){
  if(isGuest()){showLoginScreen();return;}
  const f=getFollows();
  const myId=String(_myUid());
  if(!f[myId])f[myId]=[];
  const suid=String(uid);
  const idx=f[myId].indexOf(suid);
  if(idx>-1){f[myId].splice(idx,1);_sbToggleFollow(suid,false);}
  else{f[myId].push(suid);_sbToggleFollow(suid,true);_addNotif(uid,'follow',_myName(),'started following you');}
  setFollows(f);
  const following=f[myId].includes(suid);
  if(btn){btn.textContent=following?'Following':'Follow';btn.classList.toggle('following',following);}
}

// ── User Profile Page ──────────────────────────────────────────
function openUserProfile(userId){
  if(!userId||userId==='undefined')return;
  _currentProfileUserId=userId;
  const page=document.getElementById('userProfilePage');
  if(!page)return;
  _renderUserProfile(userId);
  page.classList.add('open');
}
function closeUserProfile(){
  document.getElementById('userProfilePage')?.classList.remove('open');
  _currentProfileUserId=null;
}

function _renderUserProfile(userId){
  const body=document.getElementById('userProfileBody');
  const title=document.getElementById('userProfilePageTitle');
  const editBtn=document.getElementById('userProfileEditBtn');
  if(!body)return;
  const isOwn=String(userId)===String(_myUid());
  const profileData=getUserProfile(userId)||{};
  // Try to get user info from posts or seed
  const userPosts=getPosts().filter(p=>String(p.userId)===String(userId));
  const username=profileData.username||userPosts[0]?.username||'Explorer';
  const bio=profileData.bio||'Exploring California\'s hidden spots';
  const avatarUrl=profileData.avatarUrl||null;
  const verif=_userVerified(userId);
  const f=getFollows();
  const following=!isOwn&&(f[String(_myUid())]||[]).includes(String(userId));
  const postCount=userPosts.length;
  const communities=getCommunities().filter(c=>getMembers(c.id).includes(String(userId))).length;
  const spotIds=new Set(userPosts.filter(p=>p.spotId).map(p=>p.spotId)).size;
  if(title)title.textContent=username;
  if(editBtn)editBtn.style.display=isOwn?'block':'none';

  body.innerHTML=`
    <div style="text-align:center;padding:24px 16px 0">
      <div class="user-profile-avatar" style="margin:0 auto">${avatarUrl?`<img src="${avatarUrl}">`:sanitize((username||'?').slice(0,2).toUpperCase())}</div>
      <div style="font-size:18px;font-weight:700;color:var(--txt0);margin-top:10px;display:flex;align-items:center;justify-content:center;gap:6px">${sanitize(username)}${verif?_verifiedBadge():''}</div>
      ${verif?`<div style="font-size:10px;font-weight:700;color:var(--accent);letter-spacing:.5px;margin-top:2px;text-transform:uppercase">Verified Explorer</div>`:''}
      <div style="font-size:13px;color:var(--txt2);margin-top:6px;padding:0 20px">${sanitize(bio)}</div>
      ${!isOwn?`<button class="follow-btn${following?' following':''}" style="margin-top:14px" onclick="toggleFollow('${userId}',this)">${following?'Following':'Follow'}</button>`:''}
    </div>
    <div class="user-profile-stats">
      <div class="user-profile-stat"><div class="user-profile-stat-val">${postCount}</div><div class="user-profile-stat-label">Posts</div></div>
      <div class="user-profile-stat"><div class="user-profile-stat-val">${spotIds}</div><div class="user-profile-stat-label">Spots</div></div>
      <div class="user-profile-stat"><div class="user-profile-stat-val">${communities}</div><div class="user-profile-stat-label">Communities</div></div>
    </div>
    <div class="profile-tab-row">
      <div class="profile-tab-item active" id="upTabPosts" onclick="switchUserProfileTab('posts','${userId}')">Posts</div>
      <div class="profile-tab-item" id="upTabSpots" onclick="switchUserProfileTab('spots','${userId}')">Spots</div>
    </div>
    <div id="upTabContent"></div>`;

  _renderUserPostsTab(userId);
}

function switchUserProfileTab(tab,userId){
  document.getElementById('upTabPosts')?.classList.toggle('active',tab==='posts');
  document.getElementById('upTabSpots')?.classList.toggle('active',tab==='spots');
  if(tab==='posts') _renderUserPostsTab(userId);
  else _renderUserSpotsTab(userId);
}

function _renderUserPostsTab(userId){
  const content=document.getElementById('upTabContent');
  if(!content)return;
  const userPosts=getPosts().filter(p=>String(p.userId)===String(userId));
  if(!userPosts.length){content.innerHTML='<div style="text-align:center;padding:32px;color:var(--txt3);font-size:13px">No posts yet</div>';return;}
  content.innerHTML=`<div class="user-post-grid">${userPosts.map(p=>`<div class="user-post-thumb" onclick="openPostDetail('${p.id}')">
    ${p.mediaUrl?`<img src="${p.mediaUrl}" loading="lazy">`:`<div style="width:100%;height:100%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--txt3)">${p.type==='text'?'text':''}</div>`}
    ${p.type==='video'?`<div class="user-post-video-icon">▶</div>`:''}
  </div>`).join('')}</div>`;
}

function _renderUserSpotsTab(userId){
  const content=document.getElementById('upTabContent');
  if(!content)return;
  const userPosts=getPosts().filter(p=>String(p.userId)===String(userId)&&p.spotId);
  const spotIds=[...new Set(userPosts.map(p=>p.spotId))];
  const allS=[...spots,...userSpots];
  const userSpotObjs=spotIds.map(id=>allS.find(s=>s.id===id)).filter(Boolean);
  content.innerHTML=`
    <div style="height:180px;background:var(--bg2);margin:0;display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--txt3)">
      ${userSpotObjs.length} spots posted from
    </div>
    <div style="padding:8px 14px">
    ${userSpotObjs.map(s=>`<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="openDetail('${s.id}')">
      <div style="width:40px;height:40px;background:${s.heroGradient||'var(--bg3)'};border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px"></div>
      <div><div style="font-size:13px;font-weight:600;color:var(--txt0)">${s.name}</div><div style="font-size:11px;color:var(--txt3)">${s.region||s.distance||''}</div></div>
    </div>`).join('')}
    </div>`;
}

function openEditProfile(){
  const page=document.getElementById('editProfilePage');
  if(!page)return;
  const profileData=getUserProfile(_myUid())||{};
  const inp=document.getElementById('editProfileUsername');
  const bio=document.getElementById('editProfileBio');
  const av=document.getElementById('editProfileAvatar');
  if(inp)inp.value=profileData.username||_myName();
  if(bio)bio.value=profileData.bio||'';
  if(av){
    if(profileData.avatarUrl)av.innerHTML=`<img src="${profileData.avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    else av.textContent=_myInitials();
  }
  page.classList.add('open');
}
function closeEditProfile(){document.getElementById('editProfilePage')?.classList.remove('open');}
function saveEditProfile(){
  const username=(document.getElementById('editProfileUsername')?.value||'').trim()||_myName();
  const bio=(document.getElementById('editProfileBio')?.value||'').trim();
  const existing=getUserProfile(_myUid())||{};
  setUserProfile(_myUid(),{...existing,username,bio});
  if(_currentUser)_currentUser.username=username;
  closeEditProfile();
  if(_currentProfileUserId)_renderUserProfile(_currentProfileUserId);
  showToast('Profile updated');
}
function handleEditAvatar(e){
  const file=e.target.files?.[0];if(!file)return;
  console.log('[AVATAR STEP 1] (edit sheet) file input change fired:',file?{name:file.name,size:file.size}:'NO FILE');
  if(isGuest()){showLoginScreen();return;}
  compressImage(file,200).then(async dataUrl=>{
    try{
      console.log('[AVATAR STEP 2] (edit sheet) compressImage complete, length:',dataUrl?.length);
      const url=await _sbUploadDataUrl('Avatars',dataUrl,'jpg');
      console.log('[AVATAR STEP 3-4] (edit sheet) uploaded, public URL:',url);
      const {data:updateData,error}=await db.from('profiles').update({avatar_url:url}).eq('id',_myUid()).select();
      console.log('[AVATAR STEP 5] (edit sheet) profiles update response:',updateData,'error:',error);
      if(error)throw error;
      const bustedUrl=url+(url.includes('?')?'&':'?')+'t='+Date.now();
      const av=document.getElementById('editProfileAvatar');
      if(av)av.innerHTML=`<img src="${bustedUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
      const existing=getUserProfile(_myUid())||{};
      setUserProfile(_myUid(),{...existing,avatarUrl:url});
      _applyAvatar(bustedUrl);
      console.log('[AVATAR STEP 6] (edit sheet) img src updated with cache-busted URL:',bustedUrl);
    }catch(err){console.warn('[AVATAR] (edit sheet) upload chain failed:',err);showToast('Could not upload photo');}
  }).catch(()=>showToast('Could not read photo'));
}

// ── Notifications ──────────────────────────────────────────────
function _updateNotifBadge(){
  const notifs=getNotifs();
  const unread=notifs.filter(n=>!n.read).length;
  const badge=document.getElementById('commNotifBadge');
  const navBadge=document.getElementById('communityNavBadge');
  if(badge){badge.textContent=unread;badge.style.display=unread?'flex':'none';}
  if(navBadge){navBadge.style.display=unread>0?'block':'none';}
}

function _addNotif(toUserId,type,fromName,message){
  if(String(toUserId)===String(_myUid()))return;
  _sbNotify(toUserId,type,message); // delivered to the other user via realtime
}

function openNotificationsPage(){
  const page=document.getElementById('notificationsPage');
  if(!page)return;
  _renderNotifications();
  page.classList.add('open');
}
function closeNotificationsPage(){
  document.getElementById('notificationsPage')?.classList.remove('open');
  _updateNotifBadge();
}
function _renderNotifications(){
  const body=document.getElementById('notificationsBody');
  if(!body)return;
  const notifs=getNotifs();
  const _nSVG=(p,c='var(--txt2)')=>`<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const icons={
    like:_nSVG('<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>','#ff4d6d'),
    comment:_nSVG('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
    follow:_nSVG('<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>'),
    join:_nSVG('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
    spotdrop:_nSVG('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>','var(--accent)'),
    reply:_nSVG('<polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>'),
    newsave:_nSVG('<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>')
  };
  if(!notifs.length){body.innerHTML='<div style="text-align:center;padding:48px 20px;color:var(--txt3);font-size:13px">No notifications yet</div>';return;}
  body.innerHTML=notifs.map(n=>`<div class="notif-item${n.read?'':' unread'}" onclick="markNotifRead('${n.id}')">
    <div class="notif-icon">${icons[n.type]||_nSVG('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>')}</div>
    <div class="notif-text"><strong>${n.fromUsername||'Someone'}</strong> ${n.message||''}</div>
    <div class="notif-time">${_timeAgo(n.createdAt)}</div>
  </div>`).join('');
}
function markNotifRead(id){
  const notifs=getNotifs().map(n=>n.id===id?{...n,read:true}:n);
  setNotifs(notifs);
  _renderNotifications();
  _updateNotifBadge();
  if(!isGuest())_sbTry(db.from('notifications').update({read:true}).eq('id',id).eq('user_id',_myUid()),'mark notif read');
}
function markAllNotifsRead(){
  const unreadIds=getNotifs().filter(n=>!n.read).map(n=>n.id);
  setNotifs(getNotifs().map(n=>({...n,read:true})));
  _renderNotifications();
  _updateNotifBadge();
  showToast('All notifications marked as read');
  if(!isGuest()&&unreadIds.length)_sbTry(db.from('notifications').update({read:true}).eq('user_id',_myUid()).in('id',unreadIds),'mark all notifs read');
}

// ── DM System ──────────────────────────────────────────────────
function _dmConvKey(uid1,uid2){return [String(uid1),String(uid2)].sort().join('__');}
function openDmPage(){
  const page=document.getElementById('dmPage');
  if(!page)return;
  _renderDmInbox();
  page.classList.add('open');
}
function closeDmPage(){document.getElementById('dmPage')?.classList.remove('open');}

function _renderDmInbox(filter=''){
  const body=document.getElementById('dmInboxBody');
  if(!body)return;
  const msgs=getMessages();
  const myId=String(_myUid());
  const convos=Object.entries(msgs).filter(([key])=>key.includes(myId));
  if(!convos.length){body.innerHTML='<div style="text-align:center;padding:48px 20px;color:var(--txt3);font-size:13px">No messages yet<br><br><span style="color:var(--accent);cursor:pointer" onclick="openNewDm()">Start a conversation →</span></div>';return;}

  body.innerHTML=convos.map(([key,arr])=>{
    const otherUid=key.split('__').find(u=>u!==myId)||key.split('__')[0];
    if(filter&&!otherUid.toLowerCase().includes(filter.toLowerCase()))return '';
    const last=arr[arr.length-1];
    const profileData=getUserProfile(otherUid)||{};
    const username=profileData.username||('cave_ghost');
    return `<div class="dm-convo-row" onclick="openDmChat('${otherUid}')">
      ${_avatarHtml(username,40,profileData.avatarUrl||null)}
      <div class="dm-convo-info">
        <div class="dm-convo-name">${sanitize(username)}</div>
        <div class="dm-convo-preview">${sanitize(last?.text)||'Spot card shared'}</div>
      </div>
      <div class="dm-convo-time">${last?_timeAgo(last.time):''}</div>
    </div>`;
  }).join('');
}
function filterDmSearch(val){_renderDmInbox(val);}

// ── Community ↔ Messages swap (two views inside community-screen) ──
let _commActiveView='community';
function swapCommTab(view){
  _commActiveView=view;
  const cv=document.getElementById('commCommunityView');
  const mv=document.getElementById('commMessagesView');
  const fab=document.getElementById('commMsgFab');
  if(!cv||!mv)return;
  if(view==='messages'){
    cv.style.transform='translateX(-100%)';
    mv.style.transform='translateX(0)';
    if(fab)fab.style.display='none';
    _renderCommDmInbox('');
  } else {
    cv.style.transform='translateX(0)';
    mv.style.transform='translateX(100%)';
    if(fab)fab.style.display='flex';
  }
}

function _renderCommDmInbox(filter){
  const body=document.getElementById('commDmInboxBody');
  if(!body)return;
  const msgs=getMessages();
  const myId=String(_myUid());
  const convos=Object.entries(msgs).filter(([key])=>key.includes(myId));
  if(!convos.length){
    body.innerHTML='<div style="text-align:center;padding:60px 24px;color:var(--txt3);font-size:13px;line-height:1.7">No messages yet<br><span style="color:var(--accent);cursor:pointer" onclick="openNewDm()">Start a conversation →</span></div>';
    return;
  }
  body.innerHTML=convos.map(([key,arr])=>{
    const otherUid=key.split('__').find(u=>u!==myId)||key.split('__')[0];
    if(filter&&!(otherUid.toLowerCase().includes(filter.toLowerCase()))){return '';}
    const last=arr[arr.length-1];
    const profileData=getUserProfile(otherUid)||{};
    const username=profileData.username||otherUid.replace('demo','user_')||'Explorer';
    const preview=last?.postCard?`Shared a post`:(last?.spotCard?`Shared a spot`:(last?.text||''));
    const initials=username.slice(0,2).toUpperCase();
    const colors=['#2d5a3a','#3a2d5a','#5a3a2d','#2d4a5a','#5a2d4a'];
    const ci=username.charCodeAt(0)%colors.length;
    const avatarContent=profileData.avatarUrl
      ?`<img src="${profileData.avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      :initials;
    return `<div class="comm-unified-row" onclick="openDmChat('${otherUid}')">
      <div style="width:44px;height:44px;border-radius:50%;flex-shrink:0;background:${colors[ci]};display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;color:#fff;overflow:hidden">${avatarContent}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:700;color:var(--txt0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">@${sanitize(username)}</div>
        <div style="font-size:12px;color:var(--txt3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${sanitize(preview)}</div>
      </div>
      <div style="font-size:10px;color:var(--txt3);flex-shrink:0">${last?_timeAgo(last.time):''}</div>
    </div>`;
  }).join('');
}

function filterCommDmSearch(val){_renderCommDmInbox(val);}

function openDmChat(userId){
  _dmConvUserId=userId;
  const page=document.getElementById('dmChatPage');
  if(!page)return;
  const profileData=getUserProfile(userId)||{};
  const username=profileData.username||'cave_ghost';
  const title=document.getElementById('dmChatTitle');
  if(title)title.textContent=username;
  // Populate avatar in header
  const avatarEl=document.getElementById('dmChatHeaderAvatar');
  if(avatarEl){
    if(profileData.avatarUrl){
      avatarEl.innerHTML=`<img src="${profileData.avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    } else {
      avatarEl.textContent=username.slice(0,2).toUpperCase();
    }
  }
  _renderDmChat();
  page.classList.add('open');
}
function closeDmChat(){document.getElementById('dmChatPage')?.classList.remove('open');_dmConvUserId=null;}

function _renderDmChat(){
  const area=document.getElementById('dmMessagesArea');
  if(!area||!_dmConvUserId)return;
  const key=_dmConvKey(_myUid(),_dmConvUserId);
  const msgs=(getMessages()[key])||[];
  area.innerHTML=msgs.map(m=>{
    const sent=String(m.fromId)===String(_myUid());
    if(m.postCard){
      const p=m.postCard;
      const thumb=p.mediaUrl?`<img src="${p.mediaUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:10px 10px 0 0" loading="lazy">`
        :`<div style="width:100%;height:100%;background:${p.gradient};border-radius:10px 10px 0 0"></div>`;
      return `<div style="display:flex;flex-direction:column;align-items:${sent?'flex-end':'flex-start'};max-width:240px;${sent?'align-self:flex-end':'align-self:flex-start'}">
        <div onclick="${p.spotId?`openDetail(${p.spotId})`:'void 0'}" style="width:200px;background:var(--bg2);border:1px solid var(--border2);border-radius:12px;overflow:hidden;cursor:${p.spotId?'pointer':'default'}">
          <div style="width:100%;height:120px;overflow:hidden">${thumb}</div>
          <div style="padding:8px 10px">
            ${p.spotName?`<div style="font-size:10px;font-weight:700;color:#B8E87A;margin-bottom:3px">${sanitize(p.spotName)}</div>`:''}
            ${p.caption?`<div style="font-size:12px;color:var(--txt1);line-height:1.4">${sanitize(p.caption)}</div>`:''}
          </div>
        </div>
        <div class="dm-msg-time" style="text-align:${sent?'right':'left'}">${_timeAgo(m.time)}</div>
      </div>`;
    }
    if(m.spotCard){
      const s=m.spotCard;
      return `<div style="align-self:${sent?'flex-end':'flex-start'}">
        <div class="dm-spot-card" onclick="openDetail('${s.id}')">
          <div class="dm-spot-card-img" style="${s.heroGradient?`background:${s.heroGradient}`:''}">${s.name?s.name[0]:''}</div>
          <div class="dm-spot-card-info">
            <div class="dm-spot-card-name">${sanitize(s.name)}</div>
            <div style="font-size:10px;color:var(--txt3);margin-top:2px">${s.typeLabel||''}</div>
            <div style="font-size:10px;color:var(--accent);margin-top:4px;font-weight:700">View Spot →</div>
          </div>
        </div>
        <div class="dm-msg-time">${_timeAgo(m.time)}</div>
      </div>`;
    }
    if(m.mediaUrl){
      const tag=m.mediaType==='video'
        ?`<video src="${m.mediaUrl}" style="max-width:200px;max-height:200px;border-radius:12px;display:block" controls muted>`
        :`<img src="${m.mediaUrl}" style="max-width:200px;max-height:200px;border-radius:12px;display:block;object-fit:cover">`;
      return `<div style="display:flex;flex-direction:column;align-items:${sent?'flex-end':'flex-start'};align-self:${sent?'flex-end':'flex-start'};gap:4px">${tag}<div class="dm-msg-time" style="text-align:${sent?'right':'left'}">${_timeAgo(m.time)}</div></div>`;
    }
    return `<div style="display:flex;flex-direction:column;align-items:${sent?'flex-end':'flex-start'}">
      <div class="dm-bubble dm-bubble-${sent?'sent':'recv'}">${sanitize(m.text)}</div>
      <div class="dm-msg-time" style="text-align:${sent?'right':'left'}">${_timeAgo(m.time)}</div>
    </div>`;
  }).join('');
  area.scrollTop=area.scrollHeight;
}

function sendDmMessage(){
  showToast('Messaging is coming soon');
}

function openDmSpotShare(){
  const allS=[...spots,...userSpots];
  const results=allS.slice(0,8);
  const menu=document.getElementById('commCtxMenu');
  const overlay=document.getElementById('commCtxOverlay');
  if(!menu)return;
  menu.style.cssText='display:block;left:10px;right:10px;bottom:70px;top:auto;transform:none;max-height:200px;overflow-y:auto';
  menu.innerHTML=results.map(s=>`<div class="ctx-menu-item" onclick="sendDmSpotCard('${s.id}')">${sanitize(s.name)}</div>`).join('');
  if(overlay)overlay.style.display='block';
}
function sendDmSpotCard(spotId){
  closeCtxMenu();
  if(!_dmConvUserId)return;
  const allS=[...spots,...userSpots];
  const s=allS.find(x=>x.id===spotId);
  if(!s)return;
  const key=_dmConvKey(_myUid(),_dmConvUserId);
  const msgs=getMessages();
  if(!msgs[key])msgs[key]=[];
  msgs[key].push({id:_uid(),fromId:_myUid(),spotCard:{id:s.id,name:s.name,typeLabel:s.typeLabel,heroGradient:s.heroGradient},time:new Date().toISOString()});
  setMessages(msgs);
  _renderDmChat();
  _sbTry(db.from('messages').insert({sender_id:_myUid(),receiver_id:_dmConvUserId,spot_id:s.id}),'send spot card');
}
function openDmMediaAttach(){
  if(!_dmConvUserId)return;
  const existing=document.getElementById('_dmAttachSheet');
  if(existing){existing.remove();return;}
  const sheet=document.createElement('div');
  sheet.id='_dmAttachSheet';
  sheet.style.cssText='position:fixed;inset:0;z-index:9400;display:flex;flex-direction:column;justify-content:flex-end';
  sheet.innerHTML=`
    <div style="position:absolute;inset:0;background:rgba(0,0,0,.5)" onclick="document.getElementById('_dmAttachSheet').remove()"></div>
    <div style="position:relative;background:var(--bg1);border-radius:20px 20px 0 0;padding:16px 16px calc(env(safe-area-inset-bottom,0px)+16px)">
      <div style="font-size:15px;font-weight:700;color:var(--txt0);margin-bottom:14px">Share</div>
      <label style="display:flex;align-items:center;gap:14px;padding:14px;background:var(--bg2);border-radius:12px;cursor:pointer;margin-bottom:8px">
        <div style="width:38px;height:38px;border-radius:10px;background:rgba(184,232,122,.12);display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--accent)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        </div>
        <span style="font-size:15px;font-weight:600;color:var(--txt0)">Photo or Video</span>
        <input type="file" accept="image/*,video/*" style="display:none" onchange="sendDmMedia(event)">
      </label>
      <div onclick="openDmSpotShare();document.getElementById('_dmAttachSheet').remove()" style="display:flex;align-items:center;gap:14px;padding:14px;background:var(--bg2);border-radius:12px;cursor:pointer;margin-bottom:8px">
        <div style="width:38px;height:38px;border-radius:10px;background:rgba(184,232,122,.12);display:flex;align-items:center;justify-content:center">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        </div>
        <span style="font-size:15px;font-weight:600;color:var(--txt0)">Share a Spot</span>
      </div>
      <div onclick="openDmPostShare();document.getElementById('_dmAttachSheet').remove()" style="display:flex;align-items:center;gap:14px;padding:14px;background:var(--bg2);border-radius:12px;cursor:pointer;margin-bottom:8px">
        <div style="width:38px;height:38px;border-radius:10px;background:rgba(184,232,122,.12);display:flex;align-items:center;justify-content:center">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--accent)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        </div>
        <span style="font-size:15px;font-weight:600;color:var(--txt0)">Share a Post</span>
      </div>
    </div>`;
  document.body.appendChild(sheet);
}

function sendDmMedia(e){
  document.getElementById('_dmAttachSheet')?.remove();
  const file=e.target.files?.[0];
  if(!file||!_dmConvUserId)return;
  const isVideo=file.type.startsWith('video/');
  if(isVideo&&file.size>VIDEO_MAX_BYTES){showToast('Video too large — choose a shorter clip');return;}
  const done=async dataUrl=>{
    let mediaUrl=dataUrl;
    try{mediaUrl=await _sbUploadDataUrl('Post Media',dataUrl,isVideo?'mp4':'jpg');}
    catch(e){console.warn('[Supabase] dm media upload:',e);showToast('Upload failed — check connection');return;}
    const key=_dmConvKey(_myUid(),_dmConvUserId);
    const msgs=getMessages();
    if(!msgs[key])msgs[key]=[];
    msgs[key].push({id:_uid(),fromId:_myUid(),mediaUrl,mediaType:isVideo?'video':'photo',time:new Date().toISOString()});
    setMessages(msgs);
    _renderDmChat();
    _sbTry(db.from('messages').insert({sender_id:_myUid(),receiver_id:_dmConvUserId,media_url:mediaUrl}),'send media');
  };
  if(isVideo){
    const reader=new FileReader();
    reader.onload=ev=>done(ev.target.result);
    reader.readAsDataURL(file);
  } else {
    compressImage(file).then(done).catch(()=>showToast('Could not read photo'));
  }
}

function openDmPostShare(){
  const allPosts=getPosts().slice(0,12);
  const existing=document.getElementById('_dmPostShareSheet');
  if(existing)existing.remove();
  const sheet=document.createElement('div');
  sheet.id='_dmPostShareSheet';
  sheet.style.cssText='position:fixed;inset:0;z-index:9450;display:flex;flex-direction:column;justify-content:flex-end';
  sheet.innerHTML=`
    <div style="position:absolute;inset:0;background:rgba(0,0,0,.6)" onclick="this.parentElement.remove()"></div>
    <div style="position:relative;background:var(--bg1);border-radius:20px 20px 0 0;max-height:75vh;display:flex;flex-direction:column">
      <div style="padding:16px;border-bottom:1px solid var(--border);flex-shrink:0;font-size:15px;font-weight:700;color:var(--txt0)">Share a Post</div>
      <div style="overflow-y:auto;flex:1;padding:12px 16px">
        ${allPosts.map(p=>`
          <div onclick="sendDmPostCard('${p.id}');this.closest('#_dmPostShareSheet').remove()" style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer">
            <div style="width:52px;height:52px;border-radius:10px;overflow:hidden;background:${p.heroGradient||'var(--bg3)'};flex-shrink:0">
              ${p.mediaUrl?`<img src="${p.mediaUrl}" style="width:100%;height:100%;object-fit:cover" loading="lazy">`:''}
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:600;color:var(--txt0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">@${p.username||'explorer'}</div>
              <div style="font-size:12px;color:var(--txt3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.caption||'(no caption)'}</div>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
  document.body.appendChild(sheet);
}

function sendDmPostCard(postId){
  if(!_dmConvUserId)return;
  const p=getPosts().find(x=>x.id===postId)||_feedPosts.find(x=>x.id===postId);
  if(!p)return;
  const key=_dmConvKey(_myUid(),_dmConvUserId);
  const msgs=getMessages();
  if(!msgs[key])msgs[key]=[];
  msgs[key].push({id:_uid(),fromId:_myUid(),postCard:{id:p.id,mediaUrl:p.mediaUrl,caption:p.caption,spotId:p.spotId,spotName:p.spotName,username:p.username,gradient:p.heroGradient},time:new Date().toISOString()});
  setMessages(msgs);
  _renderDmChat();
  _sbTry(db.from('messages').insert({sender_id:_myUid(),receiver_id:_dmConvUserId,post_id:p.id}),'send post card');
}

function openNewDm(){openNewMessageOverlay();}
function openNewMessageOverlay(){
  const overlay=document.createElement('div');
  overlay.style.cssText='position:fixed;inset:0;z-index:600;background:var(--bg0);display:flex;flex-direction:column;overflow:hidden';
  const users=_getUsers().filter(u=>String(u.id)!==String(_myUid()));
  let filteredUsers=users;
  overlay.innerHTML=`
    <div style="display:flex;align-items:center;padding:52px 16px 12px;border-bottom:1px solid var(--border);flex-shrink:0;gap:12px">
      <div onclick="this.closest('[style*=fixed]').remove()" style="font-size:15px;color:var(--txt0);cursor:pointer;padding:4px 8px 4px 0">Cancel</div>
      <div style="flex:1;font-size:17px;font-weight:700;color:var(--txt0);text-align:center">New Message</div>
      <div style="width:60px"></div>
    </div>
    <div style="padding:12px 16px;flex-shrink:0">
      <div style="display:flex;align-items:center;background:var(--bg2);border:1px solid var(--border2);border-radius:12px;height:42px;padding:0 14px;gap:10px">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--txt3)" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input id="newMsgSearch" placeholder="Search people…" oninput="_filterNewMsgUsers(this.value)" style="flex:1;background:none;border:none;outline:none;color:var(--txt0);font-size:14px;font-family:inherit">
      </div>
    </div>
    <div id="newMsgUserList" style="flex:1;overflow-y:auto;padding:0 16px"></div>`;
  function renderUsers(list){
    const el=overlay.querySelector('#newMsgUserList');
    if(!el)return;
    if(!list.length){el.innerHTML='<div style="text-align:center;padding:32px;color:var(--txt3);font-size:13px">No users found</div>';return;}
    el.innerHTML=list.map(u=>`<div onclick="this.closest('[style*=fixed]').remove();openDmChat('${u.id}')" style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);cursor:pointer">
      <div style="width:42px;height:42px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#B8E87A;flex-shrink:0">${(u.username||u.id||'?').slice(0,2).toUpperCase()}</div>
      <div>
        <div style="font-size:14px;font-weight:600;color:var(--txt0)">@${u.username||u.id}</div>
        ${u.fullName?`<div style="font-size:11px;color:var(--txt3)">${u.fullName}</div>`:''}
      </div>
    </div>`).join('');
  }
  renderUsers(users);
  overlay._filterNewMsgUsers=function(val){
    filteredUsers=users.filter(u=>(u.username||'').toLowerCase().includes(val.toLowerCase())||(u.fullName||'').toLowerCase().includes(val.toLowerCase()));
    renderUsers(filteredUsers);
  };
  window._filterNewMsgUsers=overlay._filterNewMsgUsers.bind(overlay);
  document.body.appendChild(overlay);
}

// ── Post Creation Wizard ───────────────────────────────────────
let _cpSharedComms=[];
function openCreatePost(targetCommunityId=null){
  if(isGuest()){showLoginScreen(()=>openCreatePost(targetCommunityId));return;}
  _cpStep=1; _cpType=null; _cpMediaDataUrl=null; _cpMediaFiles=[];
  _cpTaggedSpotId=null; _cpTaggedSpotName=''; _cpTaggedSpotLat=null; _cpTaggedSpotLng=null;
  _cpShareCommunities=[];
  _cpShowOnSpot=true;
  document.getElementById('cpShowOnSpotToggle')?.classList.add('on');
  if(targetCommunityId)_cpShareCommunities=[targetCommunityId];
  const page=document.getElementById('createPostPage');
  if(!page)return;
  // Reset all steps
  document.querySelectorAll('#createPostPage .wizard-step').forEach(s=>s.classList.remove('active'));
  document.getElementById('cpStep1')?.classList.add('active');
  document.querySelectorAll('#createPostPage .media-type-tile').forEach(t=>t.classList.remove('selected'));
  if(document.getElementById('cpCaption'))document.getElementById('cpCaption').value='';
  if(document.getElementById('cpCharCount'))document.getElementById('cpCharCount').textContent='0';
  _updateCpProgress(1,5);
  page.classList.add('open');
  _buildShareCommList();
}
function openCreatePostForCommunity(cid){openCreatePost(cid);}
function closeCreatePost(){document.getElementById('createPostPage')?.classList.remove('open');}

function selectPostType(type,el){
  _cpType=type;
  document.querySelectorAll('#createPostPage .media-type-tile').forEach(t=>t.classList.remove('selected'));
  el.classList.add('selected');
}
// _cpStep values: 1=type, 2=media, 3=details, 4=preview
// HTML element map: 1→cpStep1, 2→cpStep2, 3→cpStep4, 4→cpStep5
function _cpShowStep(logicalStep){
  const idMap={1:'cpStep1',2:'cpStep2',3:'cpStep4',4:'cpStep5'};
  document.querySelectorAll('#createPostPage .wizard-step').forEach(s=>s.classList.remove('active'));
  document.getElementById(idMap[logicalStep])?.classList.add('active');
  const total=_cpType==='text'?3:4;
  const display=(_cpType==='text'&&logicalStep>=3)?logicalStep-1:logicalStep;
  _updateCpProgress(display,total);
  const title=document.getElementById('createPostTitle');
  if(title)title.textContent=logicalStep<=2?'New Post':logicalStep===3?'Details':'Preview';
  const stepLabel=document.getElementById('createPostStepLabel');
  if(stepLabel)stepLabel.textContent=`Step ${display} of ${total}`;
}
function cpNext(){
  if(_cpStep===1){
    if(!_cpType){showToast('Choose a post type first');return;}
    if(_cpType==='spotdrop'){
      document.querySelectorAll('#createPostPage .wizard-step').forEach(s=>s.classList.remove('active'));
      document.getElementById('cpStepSpotDrop')?.classList.add('active');
      _updateCpProgress(2,4);
      _initSpotDropMap();
      return;
    }
    if(_cpType==='text'){_cpStep=3;}else{_cpStep=2;}
  } else if(_cpStep===2){
    if(!_cpMediaDataUrl){showToast('Select at least one photo or video');return;}
    _cpStep=3;
  } else if(_cpStep===3){
    _cpStep=4;
    _cpShowStep(4);
    _buildCpPreview(); // preview only — nothing is saved here
    return;
  } else {
    return;
  }
  _cpShowStep(_cpStep);
}
function cpBack(){
  if(_cpStep===4){_cpStep=3;}
  else if(_cpStep===3){_cpStep=(_cpType==='text')?1:2;}
  else if(_cpStep===2){_cpStep=1;}
  else{return;}
  _cpShowStep(_cpStep);
}
function _updateCpProgress(step,total){
  const bar=document.getElementById('createPostProgress');
  if(bar)bar.style.width=`${(step/total)*100}%`;
}
const VIDEO_MAX_BYTES=5*1024*1024; // 5 MB
function _readFileAsDataUrl(file){
  return new Promise((resolve,reject)=>{
    if(file.type.startsWith('video/')){
      console.log('[WildPath] video file size:',file.size,'bytes');
      if(file.size>VIDEO_MAX_BYTES){
        showToast('Video is too large for this prototype — choose a shorter clip or lower quality video');
        reject(new Error('video_too_large'));
        return;
      }
    }
    if(file.type.startsWith('video/')){
      const r=new FileReader();
      r.onload=e=>resolve({dataUrl:e.target.result,type:'video',name:file.name});
      r.onerror=()=>reject(new Error('read_failed'));
      r.readAsDataURL(file);
    } else {
      compressImage(file).then(dataUrl=>resolve({dataUrl,type:'photo',name:file.name})).catch(reject);
    }
  });
}
function _renderCpMediaThumbs(){
  const row=document.getElementById('cpThumbRow');
  const count=document.getElementById('cpMediaCount');
  const wrap=document.getElementById('cpMediaPreviewWrap');
  if(!row)return;
  if(!_cpMediaFiles.length){if(wrap)wrap.style.display='none';_cpMediaDataUrl=null;return;}
  if(wrap)wrap.style.display='block';
  if(count)count.textContent=`${_cpMediaFiles.length} selected`;
  _cpMediaDataUrl=_cpMediaFiles[0].dataUrl;
  row.innerHTML=_cpMediaFiles.map((f,i)=>`
    <div style="position:relative;flex-shrink:0;width:82px;height:82px">
      <${f.type==='video'?'video':'img'} src="${f.dataUrl}" style="width:82px;height:82px;object-fit:cover;border-radius:10px;display:block" ${f.type==='video'?'muted':''}>
      <button onclick="removeCpMedia(${i})" style="position:absolute;top:3px;right:3px;width:20px;height:20px;border-radius:50%;background:rgba(0,0,0,.75);border:none;color:#fff;font-size:13px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;font-family:var(--font)">×</button>
    </div>`).join('');
}
function removeCpMedia(i){
  _cpMediaFiles.splice(i,1);
  _renderCpMediaThumbs();
}
function _cpSetMediaLoading(on){
  const btn=document.getElementById('cpAddMediaBtn');
  const next=document.querySelector('#cpStep2 .wizard-next-btn');
  if(btn){btn.style.opacity=on?'0.5':'1';btn.style.pointerEvents=on?'none':'auto';}
  if(next){next.disabled=on;next.textContent=on?'Processing…':'Continue →';}
}
function handleCpMediaSelect(e){
  const files=Array.from(e.target.files||[]);
  if(!files.length)return;
  _cpMediaFiles=[];
  _cpSetMediaLoading(true);
  Promise.allSettled(files.map(_readFileAsDataUrl)).then(results=>{
    _cpMediaFiles=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
    _renderCpMediaThumbs();
    _cpSetMediaLoading(false);
  });
  e.target.value='';
}
function handleCpMediaAppend(e){
  const files=Array.from(e.target.files||[]);
  if(!files.length)return;
  _cpSetMediaLoading(true);
  Promise.allSettled(files.map(_readFileAsDataUrl)).then(results=>{
    const good=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
    _cpMediaFiles=[..._cpMediaFiles,...good];
    _renderCpMediaThumbs();
    _cpSetMediaLoading(false);
  });
  e.target.value='';
}
function _buildCpPreview(){
  const card=document.getElementById('cpPreviewCard');
  if(!card)return;
  const caption=(document.getElementById('cpCaption')?.value||'').trim();
  const fakePost={id:'preview',userId:_myUid(),username:_myName(),type:_cpType||'text',
    mediaUrl:_cpMediaDataUrl,caption,spotId:_cpTaggedSpotId,spotName:_cpTaggedSpotName,
    likes:[],createdAt:new Date().toISOString(),communityIds:_cpShareCommunities};
  card.innerHTML=buildPostCard(fakePost);
}
function updateCpCharCount(ta){const el=document.getElementById('cpCharCount');if(el)el.textContent=ta.value.length;}
function searchCpSpot(q){
  const res=document.getElementById('cpSpotResults');
  if(!res)return;
  if(!q.trim()){res.style.display='none';return;}
  const allS=[...spots,...userSpots];
  const matches=allS.filter(s=>s.name.toLowerCase().includes(q.toLowerCase())).slice(0,5);
  const spotHtml=matches.length
    ?`<div style="font-size:10px;font-weight:700;color:var(--txt3);padding:6px 12px 2px;letter-spacing:.5px;text-transform:uppercase">WildPath Spots</div>`
     +matches.map(s=>`<div onclick="selectCpSpot('${s.id}','${s.name.replace(/'/g,"\\'")}',${s.lat||0},${s.lng||0})" style="padding:9px 12px;border-bottom:1px solid var(--border);cursor:pointer;display:flex;align-items:center;gap:10px"><svg viewBox="0 0 24 24" width="13" height="13" fill="#B8E87A" style="flex-shrink:0"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg><div><div style="font-size:13px;font-weight:600;color:var(--txt0)">${s.name}</div><div style="font-size:11px;color:var(--txt3)">${s.typeLabel||'Spot'}</div></div></div>`).join('')
    :'';
  if(spotHtml){res.style.display='block';res.innerHTML=spotHtml;}else{res.style.display='none';}
  clearTimeout(_cpSpotSearchTimer);
  _cpSpotSearchTimer=setTimeout(()=>{
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=8&countrycodes=us`,{headers:{'Accept-Language':'en'}})
      .then(r=>r.json()).then(data=>{
        const inp=document.getElementById('cpSpotSearch');
        if(inp?.value!==q)return;
        const nomHtml=data.map(d=>{
          const name=(d.display_name||'').split(',').slice(0,3).join(', ');
          return `<div onclick="selectCpLocation('${name.replace(/'/g,"\\'")}',${d.lat},${d.lon})" style="padding:9px 12px;border-bottom:1px solid var(--border);cursor:pointer;display:flex;align-items:center;gap:10px"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2" style="flex-shrink:0"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg><div style="font-size:13px;color:var(--txt1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</div></div>`;
        }).join('');
        if(!nomHtml&&!spotHtml){res.style.display='none';return;}
        let full=spotHtml;
        if(nomHtml)full+=`<div style="font-size:10px;font-weight:700;color:var(--txt3);padding:6px 12px 2px;letter-spacing:.5px;text-transform:uppercase">All Locations</div>`+nomHtml;
        res.style.display='block';res.innerHTML=full;
      }).catch(()=>{
        res.style.display='block';
        res.innerHTML+=`<div style="padding:9px 12px;font-size:11px;color:var(--txt3)">Place search unavailable — check connection</div>`;
      });
  },350);
}
function selectCpSpot(id,name,lat,lng){
  _cpTaggedSpotId=id; _cpTaggedSpotName=name;
  _cpTaggedSpotLat=lat||null; _cpTaggedSpotLng=lng||null;
  const pill=document.getElementById('cpSpotTagPill');
  const tagged=document.getElementById('cpSpotTagged');
  const hint=document.getElementById('cpCreateSpotHint');
  if(pill)pill.textContent=name;
  if(tagged)tagged.style.display='block';
  if(hint)hint.style.display='none';
  document.getElementById('cpSpotSearch').value='';
  document.getElementById('cpSpotResults').style.display='none';
}
function selectCpLocation(name,lat,lng){
  _cpTaggedSpotId=null; _cpTaggedSpotName=name;
  _cpTaggedSpotLat=parseFloat(lat); _cpTaggedSpotLng=parseFloat(lng);
  const pill=document.getElementById('cpSpotTagPill');
  const tagged=document.getElementById('cpSpotTagged');
  const hint=document.getElementById('cpCreateSpotHint');
  if(pill)pill.textContent=name;
  if(tagged)tagged.style.display='block';
  if(hint)hint.style.display='flex';
  document.getElementById('cpSpotSearch').value='';
  document.getElementById('cpSpotResults').style.display='none';
}
function clearCpSpotTag(){
  _cpTaggedSpotId=null;_cpTaggedSpotName='';_cpTaggedSpotLat=null;_cpTaggedSpotLng=null;
  const tagged=document.getElementById('cpSpotTagged');
  const hint=document.getElementById('cpCreateSpotHint');
  if(tagged)tagged.style.display='none';
  if(hint)hint.style.display='none';
}
function _buildShareCommList(){
  const list=document.getElementById('cpShareCommunitiesList');
  if(!list)return;
  const mine=getCommunities().filter(c=>getMembers(c.id).includes(String(_myUid()))||c.adminId===String(_myUid()));
  list.innerHTML=mine.map(c=>`<div class="share-to-row">
    <div class="share-to-name">${sanitize(c.name)}</div>
    <div class="toggle-switch${_cpShareCommunities.includes(c.id)?' on':''}" onclick="toggleShareTo('comm_${c.id}',this)"></div>
  </div>`).join('');
}
function toggleShareTo(key,el){
  el.classList.toggle('on');
  if(key==='profile')return;
  const cid=key.replace('comm_','');
  const idx=_cpShareCommunities.indexOf(cid);
  if(idx>-1)_cpShareCommunities.splice(idx,1);
  else _cpShareCommunities.push(cid);
}
function toggleShowOnSpot(el){
  _cpShowOnSpot=!_cpShowOnSpot;
  el.classList.toggle('on',_cpShowOnSpot);
}
function submitPost(){
  if(isGuest()){showLoginScreen();return;}
  const caption=(document.getElementById('cpCaption')?.value||'').trim();
  const btn=document.getElementById('cpPostNowBtn');
  if(btn){btn.disabled=true;btn.innerHTML='Uploading…';}
  (async()=>{
    try{
      // Upload media to post-media bucket — never store base64
      let photo_url=null,video_url=null;
      const first=_cpMediaFiles[0];
      if(first){
        if(first.type==='video')video_url=await _sbUploadDataUrl('Post Media',first.dataUrl,'mp4');
        else photo_url=await _sbUploadDataUrl('Post Media',first.dataUrl,'jpg');
      }
      const allS=[...spots,...userSpots];
      const taggedSpot=_cpTaggedSpotId?allS.find(s=>String(s.id)===String(_cpTaggedSpotId)):null;
      const row={
        user_id:_myUid(),caption,photo_url,video_url,privacy:'public',
        spot_id:taggedSpot?taggedSpot.id:null,
        lat:_cpTaggedSpotLat??taggedSpot?.lat??null,
        lng:_cpTaggedSpotLng??taggedSpot?.lng??null,
        show_on_spot:taggedSpot?_cpShowOnSpot:true
      };
      const {data,error}=await db.from('posts').insert(row).select('*, profiles!posts_user_id_fkey(username, avatar_url)').single();
      if(error)throw error;
      const posts=getPosts();
      posts.unshift(_sbAdaptPost(data,null));
      setPosts(posts);
      for(const cid of (_cpShareCommunities||[])){
        _sbTry(db.from('community_posts').insert({community_id:cid,user_id:_myUid(),content:caption,photo_url:photo_url}),'community share');
        const cp=getCPosts(cid);cp.unshift(data.id);setCPosts(cid,cp);
      }
      if(btn){btn.innerHTML='Posted!';btn.style.background='#4CAF50';}
      setTimeout(()=>{
        if(btn){btn.disabled=false;}
        closeCreatePost();
        showTab('community');
        switchCommTab('feed');
        buildFeed();
      },800);
    }catch(e){
      console.warn('[Supabase] post failed:',e);
      if(btn){btn.disabled=false;btn.innerHTML='Post Now';btn.style.background='';}
      showToast('Could not post — check connection');
    }
  })();
}

// ── Spot Drop ──────────────────────────────────────────────────
function _initSpotDropMap(){
  const container=document.getElementById('spotDropMap');
  if(!container||_sdMap)return;
  try{
    if(typeof mapboxgl==='undefined'||!mapboxgl.accessToken){
      container.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:12px;color:var(--txt2);text-align:center;padding:16px">Map preview not available<br><br>Enter coordinates below</div>';
      return;
    }
    _sdMap=new mapboxgl.Map({container,style:'mapbox://styles/mapbox/outdoors-v12',center:[_sdLng,_sdLat],zoom:10,interactive:true});
    _sdMap.on('move',()=>{const c=_sdMap.getCenter();_sdLat=c.lat;_sdLng=c.lng;});
  }catch(e){container.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--txt2);font-size:12px">Map unavailable — enter location manually</div>';}
}
function searchSdLocation(q){
  const res=document.getElementById('sdLocResults');
  if(!res||!q.trim()){if(res)res.style.display='none';return;}
  fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&countrycodes=us`)
    .then(r=>r.json()).then(data=>{
      if(!data.length){res.style.display='none';return;}
      res.style.display='block';
      res.innerHTML=data.map(d=>`<div style="padding:10px 12px;border-bottom:1px solid var(--border);cursor:pointer;font-size:12px;color:var(--txt0)" onclick="selectSdLocation(${d.lat},${d.lon},'${(d.display_name||'').slice(0,40)}')">${(d.display_name||'').slice(0,60)}</div>`).join('');
    }).catch(()=>{
      res.style.display='block';
      res.innerHTML='<div style="padding:10px 12px;font-size:11px;color:var(--txt3)">Location search unavailable — check connection</div>';
    });
}
function selectSdLocation(lat,lon,name){
  _sdLat=parseFloat(lat); _sdLng=parseFloat(lon);
  if(_sdMap)_sdMap.flyTo({center:[_sdLng,_sdLat],zoom:13});
  document.getElementById('sdLocResults').style.display='none';
  const inp=document.getElementById('sdLocSearch');
  if(inp)inp.value=name;
}
function handleSdPhoto(e){
  const file=e.target.files?.[0];if(!file)return;
  compressImage(file).then(dataUrl=>{
    _sdPhotoDataUrl=dataUrl;
    const prev=document.getElementById('sdPhotoPreview');
    if(prev){prev.style.display='block';const img=prev.querySelector('img');if(img)img.src=_sdPhotoDataUrl;}
  }).catch(()=>showToast('Could not read photo'));
}
function submitSpotDrop(){
  if(isGuest()){showLoginScreen();return;}
  const name=(document.getElementById('sdSpotName')?.value||'').trim();
  if(!name){showToast('Enter a spot name');return;}
  const type=document.getElementById('sdSpotType')?.value||'';
  const legal=document.getElementById('sdLegalStatus')?.value||'caution';
  const desc=(document.getElementById('sdDescription')?.value||'').trim();
  const approach=(document.getElementById('sdApproach')?.value||'').trim();
  const sd={name,lat:_sdLat,lng:_sdLng,type,legal,description:desc,approach,photo:_sdPhotoDataUrl,votes:0,submittedBy:_myName()};
  const newPost={
    id:_uid(),userId:_myUid(),username:_myName(),verified:_userVerified(_myUid()),
    type:'spotdrop',mediaUrl:_sdPhotoDataUrl,caption:desc,
    spotId:null,spotName:name,spotType:type,region:null,
    communityIds:_cpShareCommunities,likes:[],createdAt:new Date().toISOString(),spotdrop:sd
  };
  const posts=getPosts();posts.unshift(newPost);setPosts(posts);
  const drops=getSpotDrops();drops.unshift(sd);setSpotDrops(drops);
  _cpShareCommunities.forEach(cid=>{const cp=getCPosts(cid);cp.unshift(newPost.id);setCPosts(cid,cp);});
  closeCreatePost();
  showTab('community');
  buildFeed();
  showToast('Spot Drop posted! Community will vote');
  if(_sdMap){_sdMap.remove();_sdMap=null;}
}

function approveSpotDrop(postId){
  if(!_isAdmin()){showToast('Admin only');return;}
  const posts=getPosts();
  const post=posts.find(p=>p.id===postId);
  if(!post?.spotdrop){showToast('Spot drop data missing');return;}
  const sd=post.spotdrop;
  const newSpot={
    id:Date.now(),name:sd.name,lat:sd.lat,lng:sd.lng,
    type:sd.type,typeLabel:sd.type?.charAt(0).toUpperCase()+sd.type?.slice(1)||'Spot',
    description:sd.description,approach:sd.approach,
    legal:sd.legal,heroGradient:'linear-gradient(135deg,#1a3a2a,#2d5a3a)',
    rating:0,reviews:0,distance:'',difficulty:'Unknown',
    discoveredBy:sd.submittedBy,communityNominated:true,
    approved:true,_submittedBy:sd.submittedBy
  };
  userSpots.push(newSpot);
  try{refreshSpotMarkers();}catch{}
  post.spotdrop.approved=true;
  post.spotId=newSpot.id;
  post.spotName=newSpot.name;
  setPosts(posts);
  buildFeed();
  if(_currentCommunityId)_buildCommDetailFeed(_currentCommunityId);
  showToast(` "${sd.name}" added to the WildPath map!`);
  addNotification(`"${sd.name}" was added to the map! Discovered by ${sd.submittedBy}`);
}

// ── Community Creation Wizard ──────────────────────────────────
let _ccFocusTagsList=[];
function openCreateCommunity(){
  if(isGuest()){showLoginScreen(()=>openCreateCommunity());return;}
  _ccStep=1; _ccCoverDataUrl=null; _ccPrivacy='public'; _ccFocusTagsList=[];
  const page=document.getElementById('createCommunityPage');
  if(!page)return;
  document.querySelectorAll('#createCommunityPage .wizard-step').forEach(s=>s.classList.remove('active'));
  document.getElementById('ccStep1')?.classList.add('active');
  if(document.getElementById('ccName'))document.getElementById('ccName').value='';
  if(document.getElementById('ccDesc'))document.getElementById('ccDesc').value='';
  if(document.getElementById('ccRules'))document.getElementById('ccRules').value='';
  document.querySelectorAll('#createCommunityPage .privacy-tile').forEach(t=>t.classList.remove('selected'));
  document.querySelectorAll('#createCommunityPage .focus-chip').forEach(c=>c.classList.remove('selected'));
  document.getElementById('ccCoverPreview').style.display='none';
  document.getElementById('ccCoverZone').style.display='flex';
  _updateCcProgress();
  page.classList.add('open');
}
function closeCreateCommunity(){document.getElementById('createCommunityPage')?.classList.remove('open');}
function _updateCcProgress(){
  const bar=document.getElementById('ccProgress');
  if(bar)bar.style.width=`${(_ccStep/5)*100}%`;
  const lbl=document.getElementById('ccStepLabel');
  if(lbl)lbl.textContent=`Step ${_ccStep} of 5`;
}
function ccNext(){
  if(_ccStep===1){
    const name=(document.getElementById('ccName')?.value||'').trim();
    if(!name){showToast('Enter a community name');return;}
  }
  _ccStep++;
  document.querySelectorAll('#createCommunityPage .wizard-step').forEach(s=>s.classList.remove('active'));
  document.getElementById(`ccStep${_ccStep}`)?.classList.add('active');
  _updateCcProgress();
}
function handleCcCover(e){
  const file=e.target.files?.[0];if(!file)return;
  compressImage(file).then(dataUrl=>{
    _ccCoverDataUrl=dataUrl;
    const prev=document.getElementById('ccCoverPreview');
    const zone=document.getElementById('ccCoverZone');
    if(prev){prev.style.display='block';const img=prev.querySelector('img');if(img)img.src=_ccCoverDataUrl;}
    if(zone)zone.style.display='none';
  }).catch(()=>showToast('Could not read photo'));
}
function selectCcPrivacy(p,el){
  _ccPrivacy=p;
  document.querySelectorAll('#createCommunityPage .privacy-tile').forEach(t=>t.classList.remove('selected'));
  el.classList.add('selected');
}
function toggleCcFocus(tag,el){
  el.classList.toggle('selected');
  const idx=_ccFocusTagsList.indexOf(tag);
  if(idx>-1)_ccFocusTagsList.splice(idx,1);
  else _ccFocusTagsList.push(tag);
}
function submitCreateCommunity(){
  if(isGuest()){showLoginScreen();return;}
  const name=(document.getElementById('ccName')?.value||'').trim();
  const desc=(document.getElementById('ccDesc')?.value||'').trim();
  const rules=(document.getElementById('ccRules')?.value||'').trim();
  if(!name){showToast('Enter a community name');return;}
  (async()=>{
    try{
      let cover_url=null;
      if(_ccCoverDataUrl){
        try{cover_url=await _sbUploadDataUrl('Community Covers',_ccCoverDataUrl,'jpg');}catch(e){console.warn('cover upload:',e);}
      }
      const {data,error}=await db.from('communities').insert({
        name,description:desc,rules,cover_url,privacy:_ccPrivacy,
        focus:_ccFocusTagsList[0]||null,created_by:_myUid(),members_count:1
      }).select().single();
      if(error)throw error;
      await db.from('community_members').insert({community_id:data.id,user_id:_myUid(),role:'admin'}).then(()=>{},()=>{});
      const newComm={id:data.id,name,desc,rules,coverDataUrl:cover_url,privacy:_ccPrivacy,
        focusTags:_ccFocusTagsList,adminId:String(_myUid()),createdAt:data.created_at,memberCount:1};
      const comms=getCommunities();comms.push(newComm);setCommunities(comms);
      setMembers(newComm.id,[String(_myUid())]);
      closeCreateCommunity();
      openCommunityDetail(newComm.id);
      showToast(`"${name}" created!`);
    }catch(e){
      console.warn('[Supabase] community create:',e);
      showToast('Could not create community — check connection');
    }
  })();
}

// ── Community Settings ─────────────────────────────────────────
function openCommSettings(cid){
  const page=document.getElementById('commSettingsPage');
  if(!page)return;
  _renderCommSettings(cid);
  page.classList.add('open');
}
function closeCommSettings(){document.getElementById('commSettingsPage')?.classList.remove('open');}
function _renderCommSettings(cid){
  const body=document.getElementById('commSettingsBody');
  if(!body)return;
  const comms=getCommunities();
  const c=comms.find(x=>x.id===cid);
  if(!c)return;
  const members=getMembers(cid);
  const inviteLink=`wildpath://community/${cid}`;
  const isCommAdmin=c.adminId===String(_myUid());
  if(isCommAdmin){_loadCommunityPendingSpots(cid);_loadCommunityPendingHikes(cid);}

  const membersHtml=members.map(uid=>`<div class="member-row">
    ${_avatarHtml(uid,36)}
    <div class="member-row-info">
      <div class="member-name">${uid}</div>
      <div class="member-date">Member</div>
    </div>
    ${c.adminId===String(_myUid())&&uid!==String(_myUid())?`<button class="member-menu-btn" onclick="showMemberMenu('${cid}','${uid}',this)">⋯</button>`:''}
  </div>`).join('');

  const pending=getPendingMembers(cid);
  const pendingHtml=pending.length?pending.map(uid=>`<div class="member-row">
    ${_avatarHtml(uid,36)}
    <div class="member-row-info">
      <div class="member-name">${uid}</div>
      <div class="member-date">Pending approval</div>
    </div>
    <div style="display:flex;gap:6px;flex-shrink:0">
      <button onclick="approveMember('${cid}','${uid}')" style="padding:5px 10px;background:rgba(184,232,122,.15);border:1.5px solid var(--accent);border-radius:8px;color:var(--accent);font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">Approve</button>
      <button onclick="rejectMember('${cid}','${uid}')" style="padding:5px 10px;background:rgba(196,82,74,.1);border:1.5px solid rgba(196,82,74,.4);border-radius:8px;color:var(--red);font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">Reject</button>
    </div>
  </div>`).join(''):'<div style="font-size:12px;color:var(--txt3);padding:6px 0">No pending requests</div>';

  body.innerHTML=`
    <div style="padding:14px 16px;border-bottom:1px solid var(--border)">
      <div class="settings-row" onclick="openEditCommunity('${cid}')" style="padding:12px 0">
        <div class="settings-left"><div class="settings-icon"></div><div class="settings-name">Edit Community Info</div></div>
        <div class="settings-arrow">›</div>
      </div>
    </div>
    <div style="padding:12px 16px;border-bottom:1px solid var(--border)">
      <div style="font-size:12px;font-weight:700;color:var(--accent);letter-spacing:.4px;text-transform:uppercase;margin-bottom:10px">Join Requests${pending.length?` (${pending.length})`:''}</div>
      ${pendingHtml}
    </div>
    ${isCommAdmin?`<div style="padding:12px 16px;border-bottom:1px solid var(--border)" id="commPendingSpotsSection">
      <div style="font-size:12px;font-weight:700;color:var(--accent);letter-spacing:.4px;text-transform:uppercase;margin-bottom:10px">Pending Spot Approval</div>
      <div id="commPendingSpotsList" style="font-size:12px;color:var(--txt3)">Loading…</div>
    </div>`:''}
    ${isCommAdmin?`<div style="padding:12px 16px;border-bottom:1px solid var(--border)" id="commPendingHikesSection">
      <div style="font-size:12px;font-weight:700;color:var(--accent);letter-spacing:.4px;text-transform:uppercase;margin-bottom:10px">Pending Hike Approval</div>
      <div id="commPendingHikesList" style="font-size:12px;color:var(--txt3)">Loading…</div>
    </div>`:''}
    <div style="padding:12px 16px;border-bottom:1px solid var(--border)">
      <div style="font-size:12px;font-weight:700;color:var(--txt2);letter-spacing:.4px;text-transform:uppercase;margin-bottom:10px">Members (${members.length})</div>
      ${membersHtml}
    </div>
    <div style="padding:14px 16px;border-bottom:1px solid var(--border)">
      <div style="font-size:12px;font-weight:700;color:var(--txt2);letter-spacing:.4px;text-transform:uppercase;margin-bottom:10px">Invite Link</div>
      <div style="background:var(--bg2);border:1px solid var(--border2);border-radius:10px;padding:10px 12px;font-size:12px;color:var(--txt2);display:flex;align-items:center;justify-content:space-between">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${inviteLink}</span>
        <span style="color:var(--accent);cursor:pointer;font-weight:700;flex-shrink:0;margin-left:8px" onclick="copyInviteLink('${inviteLink}')">Copy</span>
      </div>
    </div>
    <div style="padding:14px 16px">
      <div style="font-size:12px;font-weight:700;color:var(--red);letter-spacing:.4px;text-transform:uppercase;margin-bottom:10px">Danger Zone</div>
      <button onclick="confirmDeleteCommunity('${cid}','${c.name}')" style="width:100%;padding:12px;background:rgba(196,82,74,.1);border:1.5px solid rgba(196,82,74,.4);border-radius:12px;color:var(--red);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Delete Community</button>
    </div>`;
}
async function _loadCommunityPendingSpots(cid){
  const listEl=document.getElementById('commPendingSpotsList');
  if(!listEl)return;
  try{
    const {data,error}=await db.from('community_pending_spots').select('*').eq('community_id',cid).eq('status','pending').order('submitted_at');
    if(error)throw error;
    const rows=data||[];
    if(!rows.length){listEl.innerHTML='<div style="padding:4px 0">No spots pending approval</div>';return;}
    listEl.innerHTML=rows.map(s=>`
      <div style="background:var(--bg2);border-radius:12px;padding:12px;margin-bottom:8px">
        ${(s.photo_urls&&s.photo_urls[0])?`<img src="${s.photo_urls[0]}" style="width:100%;height:100px;object-fit:cover;border-radius:8px;margin-bottom:8px">`:''}
        <div style="font-size:13px;font-weight:700;color:var(--txt0)">${sanitize(s.name)}</div>
        <div style="font-size:11px;color:var(--txt3);margin-top:2px">${sanitize(s.type)} · ${(+s.lat).toFixed(4)}, ${(+s.lng).toFixed(4)}</div>
        ${s.description?`<div style="font-size:12px;color:var(--txt2);margin-top:6px;line-height:1.5">${sanitize(s.description)}</div>`:''}
        <div style="display:flex;gap:8px;margin-top:10px">
          <button onclick="_approveCommunityPendingSpot('${s.id}','${cid}')" style="flex:1;padding:8px;background:rgba(184,232,122,.15);border:1.5px solid var(--accent);border-radius:8px;color:var(--accent);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">Approve</button>
          <button onclick="_rejectCommunityPendingSpot('${s.id}','${cid}')" style="flex:1;padding:8px;background:rgba(196,82,74,.1);border:1.5px solid rgba(196,82,74,.4);border-radius:8px;color:var(--red);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">Reject</button>
        </div>
      </div>`).join('');
  }catch(e){
    console.warn('[Supabase] community pending spots:',e);
    listEl.innerHTML='<div style="padding:4px 0;color:var(--red)">Could not load pending spots</div>';
  }
}

async function _approveCommunityPendingSpot(spotId,cid){
  try{
    const {data:pending,error:selErr}=await db.from('community_pending_spots').select('*').eq('id',spotId).single();
    if(selErr)throw selErr;
    const {error:insErr}=await db.from('spots').insert({
      name:pending.name,type:pending.type,lat:pending.lat,lng:pending.lng,
      legal_status:'caution',description:pending.description||'',
      submitted_by:pending.user_id,status:'approved',community_id:cid
    });
    if(insErr)throw insErr;
    await db.from('community_pending_spots').delete().eq('id',spotId);
    showToast('Spot approved!');
    _loadCommunityPendingSpots(cid);
    _sbLoadSpots().then(()=>refreshSpotMarkers());
  }catch(e){
    console.warn('[Supabase] approve community spot:',e);
    showToast('Could not approve — check connection');
  }
}

function _rejectCommunityPendingSpot(spotId,cid){
  _sbTry(db.from('community_pending_spots').delete().eq('id',spotId),'reject community spot');
  showToast('Spot rejected');
  setTimeout(()=>_loadCommunityPendingSpots(cid),300);
}

async function _loadCommunityPendingHikes(cid){
  const listEl=document.getElementById('commPendingHikesList');
  if(!listEl)return;
  try{
    const {data,error}=await db.from('hikes').select('*').eq('community_id',cid).eq('visibility','community').eq('status','pending');
    if(error)throw error;
    const rows=data||[];
    if(!rows.length){listEl.innerHTML='<div style="padding:4px 0">No hikes pending approval</div>';return;}
    listEl.innerHTML=rows.map(h=>{
      const diffColor=h.difficulty==='Easy'?'#4CAF50':h.difficulty==='Hard'?'#E05252':'#D4A843';
      return`<div style="background:var(--bg2);border-radius:12px;padding:12px;margin-bottom:8px">
        <div style="font-size:13px;font-weight:700;color:var(--txt0)">${sanitize(h.name)}</div>
        <div style="font-size:11px;color:var(--txt3);margin-top:2px">${h.distance||0} mi · ${h.elevation_gain||0} ft gain · <span style="color:${diffColor};font-weight:700">${h.difficulty}</span></div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button onclick="_approveCommunityPendingHike('${h.id}','${cid}')" style="flex:1;padding:8px;background:rgba(184,232,122,.15);border:1.5px solid var(--accent);border-radius:8px;color:var(--accent);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">Approve</button>
          <button onclick="_rejectCommunityPendingHike('${h.id}','${cid}')" style="flex:1;padding:8px;background:rgba(196,82,74,.1);border:1.5px solid rgba(196,82,74,.4);border-radius:8px;color:var(--red);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">Reject</button>
        </div>
      </div>`;
    }).join('');
  }catch(e){
    console.warn('[Supabase] community pending hikes:',e);
    listEl.innerHTML='<div style="padding:4px 0;color:var(--red)">Could not load pending hikes</div>';
  }
}
function _approveCommunityPendingHike(hikeId,cid){
  _sbTry(db.from('hikes').update({status:'approved'}).eq('id',hikeId),'approve community hike');
  showToast('Hike approved!');
  setTimeout(()=>{_loadCommunityPendingHikes(cid);_sbLoadHikes();},300);
}
function _rejectCommunityPendingHike(hikeId,cid){
  _sbTry(db.from('hikes').delete().eq('id',hikeId),'reject community hike');
  showToast('Hike rejected');
  setTimeout(()=>_loadCommunityPendingHikes(cid),300);
}

function showMemberMenu(cid,uid,btn){
  const menu=document.getElementById('commCtxMenu');
  const overlay=document.getElementById('commCtxOverlay');
  if(!menu)return;
  const rect=btn.getBoundingClientRect();
  const appRect=document.getElementById('app').getBoundingClientRect();
  menu.innerHTML=`<div class="ctx-menu-item" onclick="closeCtxMenu();showToast('Promoted to moderator')">⭐ Promote to Moderator</div>
    <div class="ctx-menu-item danger" onclick="closeCtxMenu();removeMember('${cid}','${uid}')">Remove from Community</div>`;
  menu.style.cssText=`display:block;left:auto;right:${appRect.right-rect.right+10}px;top:${rect.bottom-appRect.top+4}px;transform:none`;
  overlay.style.display='block';
}
function removeMember(cid,uid){
  const members=getMembers(cid).filter(m=>m!==uid);
  setMembers(cid,members);
  _renderCommSettings(cid);
  showToast('Member removed');
}
function approveMember(cid,uid){
  const pending=getPendingMembers(cid).filter(m=>m!==uid);
  setPendingMembers(cid,pending);
  const members=getMembers(cid);
  if(!members.includes(uid)){
    members.push(uid);
    setMembers(cid,members);
    const comms=getCommunities();
    const c=comms.find(x=>x.id===cid);
    if(c){c.memberCount=(c.memberCount||0)+1;setCommunities(comms);}
  }
  // Notify the user they were approved
  const userNotifs=_cgGet('wp_notifs_'+uid)||[];
  const c=getCommunities().find(x=>x.id===cid);
  userNotifs.unshift({id:'japproved_'+uid+'_'+cid,type:'join_approved',commId:cid,commName:c?.name||'',createdAt:new Date().toISOString(),read:false});
  _cgSet('wp_notifs_'+uid,userNotifs);
  _renderCommSettings(cid);
  showToast('Member approved');
}
function rejectMember(cid,uid){
  const pending=getPendingMembers(cid).filter(m=>m!==uid);
  setPendingMembers(cid,pending);
  _renderCommSettings(cid);
  showToast('Request rejected');
}
function copyInviteLink(link){navigator.clipboard?.writeText(link);showToast('Invite link copied!');}
function confirmDeleteCommunity(cid,name){
  const typed=prompt(`Type "${name}" to confirm deletion:`);
  if(typed!==name){showToast('Incorrect name — community not deleted');return;}
  const comms=getCommunities().filter(c=>c.id!==cid);
  setCommunities(comms);
  closeCommSettings();
  closeCommunityDetail();
  buildCommunitiesTab();
  showToast('Community deleted');
}

// ── Edit Community Info (admin only) ───────────────────────────
function openEditCommunity(cid){
  const comms=getCommunities();
  const c=comms.find(x=>x.id===cid);
  if(!c)return;
  let _editCoverDataUrl=c.coverDataUrl||null;
  // Build overlay
  const overlay=document.createElement('div');
  overlay.id='editCommOverlay';
  overlay.style.cssText='position:fixed;inset:0;z-index:600;background:var(--bg0);display:flex;flex-direction:column;overflow:hidden';
  overlay.innerHTML=`
    <div style="display:flex;align-items:center;padding:52px 16px 14px;border-bottom:1px solid var(--border);flex-shrink:0;gap:12px">
      <div onclick="document.getElementById('editCommOverlay').remove()" style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--txt0)" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </div>
      <div style="flex:1;font-size:17px;font-weight:700;color:var(--txt0);text-align:center">Edit Community</div>
      <button id="editCommSaveBtn" onclick="_saveEditCommunity('${cid}')" style="background:var(--accent);color:#0f1a0a;border:none;border-radius:10px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Save</button>
    </div>
    <div style="flex:1;overflow-y:auto;padding:16px">
      <!-- Cover photo -->
      <div style="margin-bottom:16px">
        <div style="font-size:12px;font-weight:700;color:var(--txt2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Cover Photo</div>
        <div id="editCommCoverPreview" style="width:100%;height:120px;border-radius:12px;overflow:hidden;background:${c.coverGrad||'linear-gradient(135deg,#1a3a2a,#2d5a3a)'};position:relative;cursor:pointer" onclick="document.getElementById('editCommCoverInput').click()">
          ${c.coverDataUrl?`<img src="${c.coverDataUrl}" style="width:100%;height:100%;object-fit:cover">`:''}
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35)">
            <div style="text-align:center">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="rgba(255,255,255,.8)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              <div style="font-size:11px;color:rgba(255,255,255,.7);margin-top:4px">Tap to change</div>
            </div>
          </div>
        </div>
        <input id="editCommCoverInput" type="file" accept="image/*" style="display:none" onchange="_handleEditCommCover(event,'${cid}')">
      </div>
      <!-- Name -->
      <div style="margin-bottom:12px">
        <div style="font-size:12px;font-weight:700;color:var(--txt2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Community Name</div>
        <input id="editCommName" value="${(c.name||'').replace(/"/g,'&quot;')}" style="width:100%;height:46px;background:var(--bg2);border:1px solid var(--border2);border-radius:12px;color:var(--txt0);padding:0 14px;font-size:14px;font-family:inherit;outline:none;box-sizing:border-box">
      </div>
      <!-- Description -->
      <div style="margin-bottom:12px">
        <div style="font-size:12px;font-weight:700;color:var(--txt2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Description</div>
        <textarea id="editCommDesc" style="width:100%;min-height:80px;background:var(--bg2);border:1px solid var(--border2);border-radius:12px;color:var(--txt0);padding:12px 14px;font-size:14px;font-family:inherit;outline:none;box-sizing:border-box;resize:none">${c.desc||''}</textarea>
      </div>
      <!-- Privacy -->
      <div style="margin-bottom:12px">
        <div style="font-size:12px;font-weight:700;color:var(--txt2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Privacy</div>
        <div style="display:flex;gap:8px">
          <div id="editPrivPublic" onclick="_setEditPrivacy('public','${cid}')" style="flex:1;padding:10px;text-align:center;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;border:2px solid ${(c.privacy||'public')==='public'?'var(--accent)':'var(--border2)'};color:${(c.privacy||'public')==='public'?'var(--accent)':'var(--txt2)'};background:var(--bg2)">Public</div>
          <div id="editPrivPrivate" onclick="_setEditPrivacy('private','${cid}')" style="flex:1;padding:10px;text-align:center;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;border:2px solid ${c.privacy==='private'?'var(--accent)':'var(--border2)'};color:${c.privacy==='private'?'var(--accent)':'var(--txt2)'};background:var(--bg2)">Private</div>
        </div>
      </div>
      <!-- Rules -->
      <div style="margin-bottom:24px">
        <div style="font-size:12px;font-weight:700;color:var(--txt2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Community Rules</div>
        <textarea id="editCommRules" style="width:100%;min-height:100px;background:var(--bg2);border:1px solid var(--border2);border-radius:12px;color:var(--txt0);padding:12px 14px;font-size:14px;font-family:inherit;outline:none;box-sizing:border-box;resize:none">${c.rules||''}</textarea>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  // store cover data url on overlay element
  overlay._editCoverDataUrl=_editCoverDataUrl;
  overlay._editPrivacy=c.privacy||'public';
}
function _handleEditCommCover(e,cid){
  const file=e.target.files?.[0];if(!file)return;
  compressImage(file).then(dataUrl=>{
    const overlay=document.getElementById('editCommOverlay');
    if(overlay)overlay._editCoverDataUrl=dataUrl;
    const prev=document.getElementById('editCommCoverPreview');
    if(prev){
      let img=prev.querySelector('img');
      if(!img){img=document.createElement('img');img.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover';prev.insertBefore(img,prev.firstChild);}
      img.src=dataUrl;
    }
  }).catch(()=>showToast('Could not read photo'));
}
function _handleCoverTapUpload(e,cid){
  const file=e.target.files?.[0];if(!file)return;
  compressImage(file).then(async dataUrl=>{
    try{
      const url=await _sbUploadDataUrl('Community Covers',dataUrl,'jpg');
      const {error}=await db.from('communities').update({cover_url:url}).eq('id',cid);
      if(error)throw error;
      const comms=getCommunities();
      const c=comms.find(x=>x.id===cid);
      if(c){c.coverDataUrl=url;setCommunities(comms);}
      _renderCommunityDetail(cid);
      showToast('Cover photo updated');
    }catch(err){console.warn('[Supabase] cover:',err);showToast('Could not upload cover');}
  }).catch(()=>showToast('Could not read photo'));
  e.target.value='';
}
function _setEditPrivacy(p,cid){
  const overlay=document.getElementById('editCommOverlay');
  if(overlay)overlay._editPrivacy=p;
  const pub=document.getElementById('editPrivPublic');
  const priv=document.getElementById('editPrivPrivate');
  if(pub){pub.style.borderColor=p==='public'?'var(--accent)':'var(--border2)';pub.style.color=p==='public'?'var(--accent)':'var(--txt2)';}
  if(priv){priv.style.borderColor=p==='private'?'var(--accent)':'var(--border2)';priv.style.color=p==='private'?'var(--accent)':'var(--txt2)';}
}
function _saveEditCommunity(cid){
  const overlay=document.getElementById('editCommOverlay');
  const name=(document.getElementById('editCommName')?.value||'').trim();
  const desc=(document.getElementById('editCommDesc')?.value||'').trim();
  const rules=(document.getElementById('editCommRules')?.value||'').trim();
  const privacy=overlay?overlay._editPrivacy:'public';
  const coverDataUrl=overlay?overlay._editCoverDataUrl:null;
  if(!name){showToast('Enter a community name');return;}
  const comms=getCommunities();
  const c=comms.find(x=>x.id===cid);
  if(!c)return;
  c.name=name;c.desc=desc;c.rules=rules;c.privacy=privacy;
  if(coverDataUrl)c.coverDataUrl=coverDataUrl;
  setCommunities(comms);
  overlay?.remove();
  _renderCommunityDetail(cid);
  showToast('Community updated');
  (async()=>{
    try{
      const upd={name,description:desc,rules,privacy};
      if(coverDataUrl&&coverDataUrl.startsWith('data:')){
        upd.cover_url=await _sbUploadDataUrl('Community Covers',coverDataUrl,'jpg');
        c.coverDataUrl=upd.cover_url;setCommunities(comms);
      }
      const {error}=await db.from('communities').update(upd).eq('id',cid);
      if(error)throw error;
    }catch(e){console.warn('[Supabase] community update:',e);}
  })();
}

// ── Spot detail communities section ────────────────────────────
function buildSpotCommunitiesSection(spotId){
  const allPosts=getPosts().filter(p=>p.spotId===spotId);
  const commIds=[...new Set(allPosts.flatMap(p=>p.communityIds||[]))];
  if(!commIds.length)return'';
  const comms=getCommunities().filter(c=>commIds.includes(c.id));
  if(!comms.length)return'';
  const cards=comms.map(c=>{
    const postCount=allPosts.filter(p=>p.communityIds?.includes(c.id)).length;
    const coverHtml=c.coverDataUrl?`<img src="${c.coverDataUrl}" style="width:100%;height:100%;object-fit:cover">`:
      `<div style="width:100%;height:100%;${c.coverGrad||'background:var(--bg3)'};"></div>`;
    return `<div class="spot-comm-mini-card" onclick="openCommunityDetail('${c.id}')">
      <div class="spot-comm-mini-cover">${coverHtml}</div>
      <div class="spot-comm-mini-info">
        <div class="spot-comm-mini-name">${c.name}</div>
        <div class="spot-comm-mini-posts">${postCount} post${postCount!==1?'s':''}</div>
      </div>
    </div>`;
  }).join('');
  return `<div style="padding:14px 0;border-top:1px solid var(--border)">
    <div style="font-size:13px;font-weight:700;color:var(--txt0);margin-bottom:10px">In Communities</div>
    <div class="spot-communities-scroll">${cards}</div>
  </div>`;
}

// ── Admin: Verified Explorer system ───────────────────────────
function grantVerifiedExplorer(userId){
  if(!_isAdmin())return;
  const users=JSON.parse(localStorage.getItem('wildpath-users')||'[]');
  const u=users.find(x=>String(x.id)===String(userId));
  if(u){u.verified=true;localStorage.setItem('wildpath-users',JSON.stringify(users));}
  showToast('Verified Explorer status granted');
}
function revokeVerifiedExplorer(userId){
  if(!_isAdmin())return;
  const users=JSON.parse(localStorage.getItem('wildpath-users')||'[]');
  const u=users.find(x=>String(x.id)===String(userId));
  if(u){u.verified=false;localStorage.setItem('wildpath-users',JSON.stringify(users));}
  showToast('Verified status revoked');
}

// ── Community is wired via showTab('community') → buildCommunityScreen() ──

// ── Notification helper from admin ─────────────────────────────
function addNotification(msg){
  const notifs=getNotifs();
  notifs.unshift({id:_uid(),type:'spotdrop',fromUsername:'System',message:msg,read:false,createdAt:new Date().toISOString()});
  setNotifs(notifs.slice(0,50));
  _updateNotifBadge();
}

setTimeout(()=>{
  _updateNotifBadge();
},500);

// ═══════════════════════════════════════════════════
// PROFILE TAB SWITCHING
// ═══════════════════════════════════════════════════
function switchProfileTab(tab){
  const postsGrid=document.getElementById('profilePostsGrid');
  const taggedGrid=document.getElementById('profileTaggedGrid');
  const aboutContent=document.getElementById('profileAboutContent');
  const tabPosts=document.getElementById('profileTabPosts');
  const tabTagged=document.getElementById('profileTabTagged');
  const tabAbout=document.getElementById('profileTabAbout');
  // Hide all
  if(postsGrid)postsGrid.style.display='none';
  if(taggedGrid)taggedGrid.style.display='none';
  if(aboutContent)aboutContent.style.display='none';
  // Reset tab styles
  const allTabs=[tabPosts,tabTagged,tabAbout];
  allTabs.forEach(t=>{if(t){t.style.borderBottom='2px solid transparent';}});
  // Show selected
  if(tab==='posts'){
    if(postsGrid)postsGrid.style.display='grid';
    if(tabPosts){tabPosts.style.borderBottom='2px solid var(--accent)';const svg=tabPosts.querySelector('svg');if(svg)svg.setAttribute('stroke','var(--txt0)');}
    if(tabTagged){const svg=tabTagged.querySelector('svg');if(svg)svg.setAttribute('stroke','var(--txt3)');}
  } else if(tab==='tagged'){
    if(taggedGrid)taggedGrid.style.display='grid';
    if(tabTagged){tabTagged.style.borderBottom='2px solid var(--accent)';const svg=tabTagged.querySelector('svg');if(svg)svg.setAttribute('stroke','var(--txt0)');}
    if(tabPosts){const svg=tabPosts.querySelector('svg');if(svg)svg.setAttribute('stroke','var(--txt3)');}
  } else {
    // 'about' — legacy
    if(aboutContent)aboutContent.style.display='block';
    if(tabAbout){tabAbout.style.borderBottom='2px solid var(--accent)';}
  }
}

// ═══════════════════════════════════════════════════
// FOLLOWERS / FOLLOWING OVERLAYS
// ═══════════════════════════════════════════════════
function _getUserInfo(uid){
  const users=JSON.parse(localStorage.getItem('wildpath-users')||'[]');
  const u=users.find(x=>String(x.id)===String(uid));
  if(u)return{username:u.username,verified:u.verified||false,photoUrl:u.photoUrl||null};
  const demos={demo1:'peak_wanderer',demo2:'trailhawk_kai',demo3:'cave_ghost',demo4:'swim_seeker',demo5:'ruins_reader'};
  const name=demos[uid]||'explorer_'+String(uid).slice(-4);
  return{username:name,verified:uid==='demo3'||uid==='demo1',photoUrl:null};
}

function _userRowHTML(uid){
  const info=_getUserInfo(uid);
  const initials=info.username.slice(0,2).toUpperCase();
  const isSelf=String(uid)===String(_myUid());
  const isFollowingUser=_isFollowing(uid);
  const verBadge=info.verified?`<span style="display:inline-flex;align-items:center;margin-left:3px;vertical-align:middle"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" fill="#4a9af5"/><polyline points="3.5,6 5,7.5 8.5,4" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`:''
  const followLabel=isFollowingUser?'Following':'Follow';
  const followStyle=isFollowingUser
    ?'border:1px solid var(--border2);background:transparent;color:var(--txt2)'
    :'border:1px solid var(--accent);background:rgba(196,149,106,.12);color:var(--accent)';
  const btnHtml=isSelf?'':`<button id="fwBtn_${uid}" onclick="toggleFollowUser('${uid}',this)" style="padding:7px 16px;border-radius:20px;${followStyle};font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap">${followLabel}</button>`;
  const avatarBg=info.photoUrl?'':`background:var(--bg3);`;
  const avatarInner=info.photoUrl
    ?`<img src="${info.photoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
    :`<span style="font-size:14px;font-weight:700;color:var(--accent)">${initials}</span>`;
  return `<div style="display:flex;align-items:center;gap:12px;padding:10px 16px">
    <div style="width:44px;height:44px;border-radius:50%;${avatarBg}display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden">${avatarInner}</div>
    <div style="flex:1;min-width:0">
      <div style="font-size:14px;font-weight:700;color:var(--txt0)">@${info.username}${verBadge}</div>
    </div>
    ${btnHtml}
  </div>`;
}

function toggleFollowUser(uid,btn){
  if(isGuest()){showLoginScreen();return;}
  const follows=getFollows();
  const myUid=String(_myUid());
  if(!follows[myUid])follows[myUid]=[];
  const targetUid=String(uid);
  const idx=follows[myUid].indexOf(targetUid);
  if(idx>=0){
    follows[myUid].splice(idx,1);
    _sbToggleFollow(targetUid,false);
    if(btn){btn.textContent='Follow';btn.style.borderColor='var(--accent)';btn.style.color='var(--accent)';btn.style.background='rgba(196,149,106,.12)';}
  } else {
    follows[myUid].push(targetUid);
    _sbToggleFollow(targetUid,true);
    if(btn){btn.textContent='Following';btn.style.borderColor='var(--border2)';btn.style.color='var(--txt2)';btn.style.background='transparent';}
  }
  setFollows(follows);
  // Keep profile following count live
  const fwingEl=document.getElementById('profileFollowingCount');
  if(fwingEl)fwingEl.textContent=(follows[myUid]||[]).length;
}

function openFollowersList(){
  const page=document.getElementById('followersListPage');
  if(!page)return;
  const content=document.getElementById('followersListContent');
  if(!content)return;
  const myUid=String(_myUid());
  const follows=getFollows();
  const followerUids=Object.keys(follows).filter(uid=>(follows[uid]||[]).includes(myUid)&&uid!==myUid);
  if(!followerUids.length){
    content.innerHTML=`<div style="padding:56px 20px;text-align:center;color:var(--txt3);font-size:14px;line-height:1.8">No followers yet.<br><span style="font-size:12px">Share your WildPath profile to attract followers.</span></div>`;
  } else {
    content.innerHTML=followerUids.map(uid=>_userRowHTML(uid)).join('');
  }
  page.style.display='flex';
}

function openFollowingList(){
  const page=document.getElementById('followingListPage');
  if(!page)return;
  const content=document.getElementById('followingListContent');
  if(!content)return;
  const myUid=String(_myUid());
  const follows=getFollows();
  const followingUids=(follows[myUid]||[]).filter(uid=>uid!==myUid);
  if(!followingUids.length){
    content.innerHTML=`<div style="padding:56px 20px;text-align:center;color:var(--txt3);font-size:14px;line-height:1.8">Not following anyone yet.<br><span style="font-size:12px">Discover explorers in the Community tab.</span></div>`;
  } else {
    content.innerHTML=followingUids.map(uid=>_userRowHTML(uid)).join('');
  }
  page.style.display='flex';
}

// ═══════════════════════════════════════════════════
// COMMUNITY SEARCH OVERLAY
// ═══════════════════════════════════════════════════
let _csActiveTab='people';

function openCommSearch(){
  const overlay=document.getElementById('commSearchOverlay');
  if(!overlay)return;
  overlay.style.display='flex';
  _csActiveTab='people';
  _csSetActiveTab('people');
  const inp=document.getElementById('commSearchInput');
  if(inp){inp.value='';setTimeout(()=>inp.focus(),80);}
  runCommSearch('');
}

function closeCommSearch(){
  const overlay=document.getElementById('commSearchOverlay');
  if(overlay)overlay.style.display='none';
  const inp=document.getElementById('commSearchInput');
  if(inp)inp.value='';
}

function switchCommSearchTab(tab){
  _csActiveTab=tab;
  _csSetActiveTab(tab);
  const q=document.getElementById('commSearchInput')?.value||'';
  runCommSearch(q);
}

function _csSetActiveTab(tab){
  const tp=document.getElementById('csTabPeople');
  const tc=document.getElementById('csTabComms');
  if(tp){tp.style.color=tab==='people'?'var(--txt0)':'var(--txt3)';tp.style.borderBottom=tab==='people'?'2px solid var(--accent)':'2px solid transparent';tp.style.fontWeight=tab==='people'?'700':'600';}
  if(tc){tc.style.color=tab==='communities'?'var(--txt0)':'var(--txt3)';tc.style.borderBottom=tab==='communities'?'2px solid var(--accent)':'2px solid transparent';tc.style.fontWeight=tab==='communities'?'700':'600';}
}

function runCommSearch(query){
  const results=document.getElementById('commSearchResults');
  if(!results)return;
  const q=(query||'').trim().toLowerCase();

  if(!q){
    // Show suggested people or communities
    if(_csActiveTab==='people'){
      const realUsers=JSON.parse(localStorage.getItem('wildpath-users')||'[]');
      // Deduplicate: build ordered unique list, skip current user
      const seen=new Set();
      const suggested=[];
      realUsers.forEach(u=>{
        const uid=String(u.id);
        if(uid!==String(_myUid())&&!seen.has(uid)){seen.add(uid);suggested.push(uid);}
      });
      // Fallback demo IDs not already in list
      ['demo1','demo2','demo3','demo4','demo5'].forEach(uid=>{
        if(!seen.has(uid)){seen.add(uid);suggested.push(uid);}
      });
      const suggestedSlice=suggested.slice(0,6);
      results.innerHTML=
        `<div style="padding:12px 16px 6px;font-size:11px;font-weight:700;color:var(--txt3);letter-spacing:.4px;text-transform:uppercase">Suggested People</div>`+
        suggestedSlice.map(uid=>_userRowHTML(uid)).join('');
    } else {
      const comms=getCommunities();
      if(!comms.length){
        results.innerHTML=`<div style="padding:48px 20px;text-align:center;color:var(--txt3);font-size:14px">No communities yet</div>`;
      } else {
        results.innerHTML=
          `<div style="padding:12px 16px 6px;font-size:11px;font-weight:700;color:var(--txt3);letter-spacing:.4px;text-transform:uppercase">Popular Communities</div>`+
          comms.slice(0,8).map(c=>_commSearchRowHTML(c)).join('');
      }
    }
    return;
  }

  if(_csActiveTab==='people'){
    const allUsers=JSON.parse(localStorage.getItem('wildpath-users')||'[]');
    const matchedReal=allUsers.filter(u=>(u.username||'').toLowerCase().includes(q));
    const demoData=[{id:'demo1',name:'peak_wanderer'},{id:'demo2',name:'trailhawk_kai'},{id:'demo3',name:'cave_ghost'},{id:'demo4',name:'swim_seeker'},{id:'demo5',name:'ruins_reader'}];
    const matchedDemo=demoData.filter(d=>d.name.includes(q));
    const realIds=new Set(matchedReal.map(u=>String(u.id)));
    const allMatches=[...matchedReal.map(u=>String(u.id)),...matchedDemo.map(d=>d.id).filter(id=>!realIds.has(id))];
    if(!allMatches.length){
      results.innerHTML=`<div style="padding:48px 20px;text-align:center;color:var(--txt3);font-size:14px">No people found for <strong style="color:var(--txt0)">"${query}"</strong></div>`;
    } else {
      results.innerHTML=allMatches.map(uid=>_userRowHTML(uid)).join('');
    }
  } else {
    const comms=getCommunities().filter(c=>c.name.toLowerCase().includes(q)||(c.desc||'').toLowerCase().includes(q));
    if(!comms.length){
      results.innerHTML=`<div style="padding:48px 20px;text-align:center;color:var(--txt3);font-size:14px">No communities found for <strong style="color:var(--txt0)">"${query}"</strong></div>`;
    } else {
      results.innerHTML=comms.map(c=>_commSearchRowHTML(c)).join('');
    }
  }
}

function _commSearchRowHTML(c){
  const members=getMembers(c.id);
  const uid=String(_myUid());
  const isMember=members.includes(uid)||c.adminId===uid;
  const isPending=getPendingMembers(c.id).includes(uid);
  const coverHtml=c.coverDataUrl
    ?`<img src="${c.coverDataUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:10px">`
    :`<div style="width:100%;height:100%;${c.coverGrad||'background:var(--bg3)'};border-radius:10px;"></div>`;
  const memberCount=c.memberCount||members.length;
  let btnStyle,btnLabel,btnExtra='';
  if(isMember){btnStyle='border:1px solid var(--border2);background:transparent;color:var(--txt2)';btnLabel='Joined';}
  else if(isPending){btnStyle='border:1px solid var(--border2);background:transparent;color:var(--txt3)';btnLabel='Pending';btnExtra='style="opacity:.7;pointer-events:none"';}
  else{btnStyle='border:1px solid var(--accent);background:rgba(196,149,106,.12);color:var(--accent)';btnLabel='Request';}
  return `<div style="display:flex;align-items:center;gap:12px;padding:10px 16px">
    <div style="width:44px;height:44px;flex-shrink:0;overflow:hidden;border-radius:10px">${coverHtml}</div>
    <div style="flex:1;min-width:0">
      <div style="font-size:14px;font-weight:700;color:var(--txt0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.name}</div>
      <div style="font-size:12px;color:var(--txt3);margin-top:2px">${memberCount.toLocaleString()} members · ${c.privacy||'public'}</div>
    </div>
    <button onclick="joinCommunity('${c.id}',this)" ${btnExtra} style="padding:7px 16px;border-radius:20px;${btnStyle};font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap">${btnLabel}</button>
  </div>`;
}

// ═══════════════════════════════════════════════════
// IN THE MOMENT CAPTURE
// ═══════════════════════════════════════════════════
let _momentPrivacy='public';
let _momentCapType='photo';
let _momentCapturedDataUrl=null;
let _momentStream=null;

function openMomentCapture(){
  if(isGuest()){showLoginScreen(()=>openMomentCapture());return;}
  const ov=document.getElementById('momentCaptureOverlay');
  if(!ov)return;
  ov.style.display='flex';
  // Show nearby spot or address
  const label=document.getElementById('momentLocationLabel');
  if(label){
    if(window._lastUserLat){
      const allS=[...spots,...userSpots];
      let nearestSpot=null,nearestDist=Infinity;
      allS.forEach(s=>{
        const d=Math.hypot(s.lat-window._lastUserLat,s.lng-window._lastUserLng)*111000;
        if(d<nearestDist){nearestDist=d;nearestSpot=s;}
      });
      if(nearestSpot&&nearestDist<500){
        label.textContent='Near '+nearestSpot.name;
      } else {
        label.textContent='Your location';
      }
    }
  }
  // Try to start camera
  if(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia){
    navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false})
      .then(stream=>{
        _momentStream=stream;
        const v=document.getElementById('momentVideo');
        if(v){v.srcObject=stream;v.style.display='block';}
      })
      .catch(()=>{
        // Camera not available — use file picker fallback
        showToast('Using file picker — camera not available');
      });
  }
}

function closeMomentCapture(){
  const ov=document.getElementById('momentCaptureOverlay');
  if(ov)ov.style.display='none';
  if(_momentStream){
    _momentStream.getTracks().forEach(t=>t.stop());
    _momentStream=null;
  }
  const v=document.getElementById('momentVideo');
  if(v){v.srcObject=null;v.style.display='none';}
}

function setCapType(type,el){
  _momentCapType=type;
  document.querySelectorAll('[id^="capType"]').forEach(e=>{
    e.style.color='rgba(255,255,255,.4)';e.style.borderBottom='2px solid transparent';e.style.fontWeight='600';
  });
  el.style.color='#B8E87A';el.style.borderBottom='2px solid #B8E87A';el.style.fontWeight='700';
}

function capturePhoto(){
  if(_momentStream){
    const v=document.getElementById('momentVideo');
    const canvas=document.createElement('canvas');
    canvas.width=v.videoWidth||640;canvas.height=v.videoHeight||480;
    const ctx=canvas.getContext('2d');
    ctx.drawImage(v,0,0);
    _momentCapturedDataUrl=canvas.toDataURL('image/jpeg',0.9);
    closeMomentCapture();
    showMomentPreview(_momentCapturedDataUrl);
  } else {
    // Fallback: open file picker
    document.getElementById('momentFileInput')?.click();
  }
}

function handleMomentCapture(e){
  const file=e.target.files?.[0];
  if(!file)return;
  const done=dataUrl=>{
    _momentCapturedDataUrl=dataUrl;
    closeMomentCapture();
    showMomentPreview(_momentCapturedDataUrl);
  };
  if(file.type.startsWith('video/')){
    const reader=new FileReader();
    reader.onload=ev=>done(ev.target.result);
    reader.readAsDataURL(file);
  } else {
    compressImage(file).then(done).catch(()=>showToast('Could not read photo'));
  }
}

function showMomentPreview(dataUrl){
  const ov=document.getElementById('momentPreviewOverlay');
  if(!ov)return;
  ov.style.display='flex';
  const img=document.getElementById('momentPreviewImg');
  if(img){img.src=dataUrl;img.style.display='block';}
  _momentPrivacy='public';
  setMomentPrivacy('public',document.getElementById('privTilePublic'));
}

function closeMomentPreview(){
  const ov=document.getElementById('momentPreviewOverlay');
  if(ov)ov.style.display='none';
  _momentCapturedDataUrl=null;
}

function setMomentPrivacy(type,el){
  _momentPrivacy=type;
  ['Public','Community','Private'].forEach(t=>{
    const tile=document.getElementById('privTile'+t);
    if(tile){
      tile.style.borderColor='rgba(255,255,255,.12)';
      tile.style.background='rgba(255,255,255,.06)';
    }
  });
  if(el){el.style.borderColor='#B8E87A';el.style.background='rgba(184,232,122,.15)';}
}

function postMoment(){
  if(!_momentCapturedDataUrl){showToast('No photo captured');return;}
  const caption=(document.getElementById('momentCaption')?.value||'').trim();
  // Store photo pinned to user's location
  if(window._lastUserLat){
    const post={
      id:'moment_'+Date.now(),
      type:'photo',
      mediaUrl:_momentCapturedDataUrl,
      caption,
      privacy:_momentPrivacy,
      userId:String(_myUid()),
      username:_currentUser?.username||'Explorer',
      lat:window._lastUserLat,
      lng:window._lastUserLng,
      createdAt:new Date().toISOString()
    };
    // Store in posts if public
    if(_momentPrivacy==='public'){
      const allPosts=getPosts();
      allPosts.unshift(post);
      setPosts(allPosts);
    }
    // Store in personal moments
    const personal=JSON.parse(localStorage.getItem('wp_personal_moments')||'[]');
    personal.unshift(post);
    localStorage.setItem('wp_personal_moments',JSON.stringify(personal.slice(0,100)));
    showToast('Posted!');
  } else {
    showToast('Location not available for this post');
  }
  closeMomentPreview();
}

// ── Verified at Location ──────────────────────────────────────
function verifyAtLocation(spotId){
  if(isGuest()){showLoginScreen();return;}
  if(!window._lastUserLat){showToast('Enable location first');return;}
  const allS=[...spots,...userSpots];
  const spot=allS.find(s=>s.id===spotId);
  if(!spot)return;
  const distM=Math.hypot(spot.lat-window._lastUserLat,spot.lng-window._lastUserLng)*111000;
  if(distM>300){
    showToast(`You must be within 300m of the spot. Currently ${Math.round(distM)}m away.`);
    return;
  }
  const username=_currentUser?.username||'Explorer';
  const today=new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  // Store verification
  const key=`wp_verify_${spotId}`;
  localStorage.setItem(key,JSON.stringify({username,date:today,timestamp:Date.now()}));
  // Update spot in memory
  spot.verifiedBy=username;
  spot.verifiedDate=new Date().toISOString();
  showToast(`Verified at location by @${username}`);
  // Refresh freshness section if detail is open
  if(_detailSpotId===spotId){
    const freshnessEl=document.getElementById('detailFreshness');
    if(freshnessEl){
      freshnessEl.innerHTML=`<div style="font-size:13px;font-weight:700;color:var(--txt0);margin-bottom:8px">Freshness</div>
        <div style="background:var(--bg1);border:1px solid var(--border);border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:12px">
          <div style="width:12px;height:12px;border-radius:50%;background:#6fcf97;flex-shrink:0"></div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600;color:var(--txt0)">Just verified</div>
            <div style="font-size:11px;color:var(--txt3);margin-top:2px">Verified by @${username} · ${today}</div>
          </div>
          <div style="font-size:12px;color:#6fcf97;font-weight:700">At Location</div>
        </div>`;
    }
  }
}

// ═══════════════════════════════════════════════════
// PIN COLOR SYSTEM — yellow=visited+posted, red=saved, white=public
// ═══════════════════════════════════════════════════
function _getPinColor(spotId){
  const myUid=String(_myUid());
  // Yellow: user has posted about this spot
  const posts=getPosts();
  const hasPosted=posts.some(p=>String(p.userId)===myUid&&p.spotId===spotId);
  if(hasPosted)return '#F5C842';
  // Red: user has saved this spot
  const saved=getSavedSpotIds();
  if(saved.includes(spotId))return '#E05252';
  // White (public default)
  return '#FFFFFF';
}

// ═══════════════════════════════════════════════════
// DETAIL PAGE — new element population
// ═══════════════════════════════════════════════════
let _detailMiniMapInstance=null;
let _detailCurrentStarRating=5;

function _populateDetailNewElements(spot){
  // ── Bookmark / Save state ──
  const saved=getSavedSpotIds();
  const isSaved=saved.includes(spot.id);
  // Legacy icon (may be removed from HTML)
  const bmIcon=document.getElementById('detailBookmarkIcon');
  const bmBtn=document.getElementById('detailBookmarkBtn');
  if(bmIcon){bmIcon.setAttribute('fill',isSaved?'#B8E87A':'none');bmIcon.setAttribute('stroke',isSaved?'#B8E87A':'var(--txt2)');}
  if(bmBtn){bmBtn.style.background=isSaved?'rgba(184,232,122,.18)':'var(--bg2)';bmBtn.style.borderColor=isSaved?'rgba(184,232,122,.5)':'var(--border2)';}
  // New Save button
  const saveBtnIcon=document.getElementById('detailSaveBtnIcon');
  const saveBtnLabel=document.getElementById('detailSaveBtnLabel');
  const saveBtn=document.getElementById('detailSaveBtn');
  if(saveBtnIcon){saveBtnIcon.setAttribute('fill',isSaved?'#B8E87A':'none');saveBtnIcon.setAttribute('stroke',isSaved?'#B8E87A':'var(--txt1)');}
  if(saveBtnLabel)saveBtnLabel.textContent=isSaved?'Saved':'Save';
  if(saveBtn){saveBtn.style.background=isSaved?'rgba(184,232,122,.12)':'var(--bg2)';saveBtn.style.borderColor=isSaved?'rgba(184,232,122,.4)':'var(--border2)';saveBtn.style.color=isSaved?'#B8E87A':'var(--txt0)';}

  // ── Stars row ──
  const starsEl=document.getElementById('detailStarsRow');
  const scoreEl=document.getElementById('detailRatingScore');
  const countEl=document.getElementById('detailRatingCount');
  if(starsEl){
    const r=parseFloat(spot.rating)||4.5;
    const full=Math.floor(r);
    const half=r-full>=0.5;
    let html='';
    for(let i=1;i<=5;i++){
      if(i<=full){html+='<svg viewBox="0 0 24 24" width="13" height="13" style="vertical-align:middle" fill="#F5A623" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';}
      else if(i===full+1&&half){html+='<svg viewBox="0 0 24 24" width="13" height="13" style="vertical-align:middle" fill="#F5A623" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';}
      else{html+='<svg viewBox="0 0 24 24" width="13" height="13" style="vertical-align:middle" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';}
    }
    starsEl.innerHTML=html;
  }
  if(scoreEl)scoreEl.textContent=spot.rating||'4.5';
  if(countEl){
    const rev=spot.reviews||Math.floor(Math.random()*200+20);
    const userRevs=JSON.parse(localStorage.getItem(`wp_reviews_${spot.id}`)||'[]').length;
    countEl.textContent=`(${rev+userRevs} reviews)`;
  }

  // ── Activity chips ──
  const chipsEl=document.getElementById('detailActivityChips');
  if(chipsEl){
    const typeChipMap={
      hiking:['Hiking','Trail Running','Backpacking','Dog Friendly','Camping Nearby'],
      biking:['Mountain Biking','Gravel Riding','E-Bike Friendly','Scenic Views'],
      swimming:['Swimming','Cliff Jumping','Fishing','Kayaking','Paddleboarding'],
      caves:['Spelunking','Photography','Adventure','Night Hike'],
      lava_tube:['Spelunking','Geology','Photography','Guided Tours'],
      scenic:['Photography','Sunset Views','Stargazing','Picnic Spot'],
      river:['Swimming','Fishing','Kayaking','Rafting','Tubing'],
      waterfall:['Swimming','Photography','Hiking','Family Friendly'],
      natural_slide:['Swimming','Cliff Jumping','Fun','Family Friendly'],
      rock_climbing:['Rock Climbing','Bouldering','Rappelling','Photography'],
      urban:['Urban Exploration','Photography','History','Architecture']
    };
    const chips=(typeChipMap[spot.type]||[spot.typeLabel||'Outdoor']).slice(0,5);
    chipsEl.innerHTML=chips.map((c,i)=>`
      <div style="flex-shrink:0;background:${i===0?'rgba(184,232,122,.15)':'rgba(255,255,255,.07)'};border:1px solid ${i===0?'rgba(184,232,122,.35)':'rgba(255,255,255,.12)'};border-radius:20px;padding:7px 14px;font-size:12px;font-weight:${i===0?'700':'600'};color:${i===0?'#B8E87A':'var(--txt1)'};white-space:nowrap">${c}</div>
    `).join('');
  }

  // ── Photo grid ──
  const pgEl=document.getElementById('detailPhotosGrid');
  const pgEmpty=document.getElementById('detailPhotosEmpty');
  const pgAdd=document.getElementById('detailAddPhotoRow');
  if(pgEl){
    const communityPhotos=JSON.parse(localStorage.getItem(`wp_photos_${spot.id}`)||'[]');
    if(!communityPhotos.length){
      pgEl.innerHTML='';
      pgEl.style.display='none';
      if(pgEmpty)pgEmpty.style.display='block';
      if(pgAdd)pgAdd.style.display='none';
    } else {
      pgEl.style.display='grid';
      if(pgEmpty)pgEmpty.style.display='none';
      if(pgAdd)pgAdd.style.display='block';
      pgEl.innerHTML=communityPhotos.slice(0,9).map(p=>`
        <div style="aspect-ratio:1;overflow:hidden;cursor:pointer;background:var(--bg3)" onclick="openPhotoFull('${p.url}')">
          <img src="${p.url}" style="width:100%;height:100%;object-fit:cover" loading="lazy">
        </div>`).join('');
    }
  }

  // ── Mini map ──
  _initDetailMiniMap(spot);

  // ── Rating bars ──
  const barsEl=document.getElementById('detailRatingBars');
  if(barsEl){
    const revData=spot.reviews_data||[];
    const userRevs=JSON.parse(localStorage.getItem(`wp_reviews_${spot.id}`)||'[]');
    const allRevs=[...revData,...userRevs];
    const counts=[0,0,0,0,0]; // index 0=1-star, 4=5-star
    allRevs.forEach(r=>{const s=Math.min(5,Math.max(1,Math.round(r.stars||5)));counts[s-1]++;});
    // If no reviews, simulate based on rating
    if(!allRevs.length){
      const base=parseFloat(spot.rating)||4.5;
      const total=spot.reviews||40;
      const fiveStarPct=Math.max(0,(base-4)*2*0.6+0.5);
      counts[4]=Math.round(total*fiveStarPct);
      counts[3]=Math.round(total*0.25);
      counts[2]=Math.round(total*0.1);
      counts[1]=Math.round(total*0.04);
      counts[0]=Math.round(total*0.01);
    }
    const total=counts.reduce((a,b)=>a+b,0)||1;
    barsEl.innerHTML=[5,4,3,2,1].map(s=>{
      const pct=Math.round((counts[s-1]/total)*100);
      return`<div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:11px;color:var(--txt2);width:14px;text-align:right;flex-shrink:0">${s}</span>
        <svg viewBox="0 0 24 24" width="11" height="11" fill="#F5A623" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        <div style="flex:1;height:5px;background:rgba(255,255,255,.1);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${pct>50?'#F5A623':'rgba(245,166,35,.5)'};border-radius:3px;transition:width .4s"></div>
        </div>
        <span style="font-size:11px;color:var(--txt3);width:28px;flex-shrink:0">${pct}%</span>
      </div>`;
    }).join('');
  }

  // ── Reviews list ──
  const revListEl=document.getElementById('detailReviewsList');
  if(revListEl){
    const revData=spot.reviews_data||[];
    const userRevs=JSON.parse(localStorage.getItem(`wp_reviews_${spot.id}`)||'[]');
    const allRevs=[...revData,...userRevs].slice(0,5);
    if(!allRevs.length){
      revListEl.innerHTML=`<div style="font-size:13px;color:var(--txt3);text-align:center;padding:8px 0">No reviews yet — add the first one!</div>`;
    } else {
      revListEl.innerHTML=allRevs.map(r=>{
        const stars=Array.from({length:Math.min(5,Math.max(1,r.stars||5))},()=>'<svg viewBox="0 0 24 24" width="13" height="13" style="vertical-align:middle" fill="#F5A623" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>').join('');
        const empty=Array.from({length:Math.max(0,5-(r.stars||5))},()=>'<svg viewBox="0 0 24 24" width="13" height="13" style="vertical-align:middle" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>').join('');
        return`<div style="background:var(--bg1);border:1px solid var(--border);border-radius:14px;padding:12px 14px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <div style="width:30px;height:30px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#B8E87A;flex-shrink:0">${(r.user||r.username||'?').slice(0,2).toUpperCase()}</div>
            <div style="flex:1">
              <div style="font-size:13px;font-weight:700;color:var(--txt0)">@${r.user||r.username||'Explorer'}</div>
              <div style="font-size:10px;color:var(--txt3)">${r.date||''}</div>
            </div>
            <div style="font-size:13px"><span style="color:#F5A623">${stars}</span><span style="color:var(--border2)">${empty}</span></div>
          </div>
          <div style="font-size:13px;color:var(--txt1);line-height:1.55">${r.text||r.notes||''}</div>
        </div>`;
      }).join('');
    }
  }
}

function _initDetailMiniMap(spot){
  // Destroy previous instance if spot changed
  if(_detailMiniMapInstance){
    try{_detailMiniMapInstance.remove();}catch(e){}
    _detailMiniMapInstance=null;
  }
  const container=document.getElementById('detailMiniMap');
  if(!container||!spot)return;
  const tok=localStorage.getItem('mapbox-token')||'';
  if(!tok)return;
  try{
    mapboxgl.accessToken=tok;
    _detailMiniMapInstance=new mapboxgl.Map({
      container:'detailMiniMap',
      style:'mapbox://styles/mapbox/outdoors-v12',
      center:[spot.lng,spot.lat],
      zoom:13,
      interactive:false,
      attributionControl:false
    });
    _detailMiniMapInstance.on('load',()=>{
      // Add a pulsing marker at the spot location
      const el=document.createElement('div');
      el.style.cssText='width:14px;height:14px;border-radius:50%;background:#B8E87A;border:2px solid #fff;box-shadow:0 0 0 4px rgba(184,232,122,.35)';
      new mapboxgl.Marker({element:el}).setLngLat([spot.lng,spot.lat]).addTo(_detailMiniMapInstance);
    });
  }catch(e){console.warn('Detail mini map init failed',e);}
}

function openDetailAddPost(){
  if(isGuest()){showLoginScreen();return;}
  const allS=[...spots,...userSpots,...personalSpots];
  const spot=allS.find(s=>String(s.id)===String(_detailSpotId));
  if(!spot)return;
  openCreatePost();
  setTimeout(()=>{
    // Personal spots have no row in the real spots table, so tag by raw location instead
    // (posts.spot_id is a real foreign key and can't point at a personal spot)
    if(spot.tier==='personal')selectCpLocation(spot.name,spot.lat,spot.lng);
    else selectCpSpot(spot.id,spot.name,spot.lat,spot.lng);
  },150);
}
function openDetailSaveSheet(){
  if(isGuest()){showLoginScreen();return;}
  if(!_detailSpotId)return;
  const allS=[...spots,...userSpots,...personalSpots];
  const spot=allS.find(s=>String(s.id)===String(_detailSpotId));
  if(!spot)return;
  // Already saved — tapping again unsaves rather than reopening the folder picker.
  if(spot.tier!=='personal'&&getSavedSpotIds().includes(spot.id)){unsaveSpot(spot.id);return;}
  const refType=spot.tier==='personal'?'personal_spot':'spot';
  openPlaceSaveSheet(refType,spot.personalSpotId||spot.id,spot.name,spot.lat,spot.lng);
}
// Reflects the current spot's saved state on the detail sheet's Save button.
function _updateDetailSaveBtnState(){
  const saveBtnIcon=document.getElementById('detailSaveBtnIcon');
  const saveBtnLabel=document.getElementById('detailSaveBtnLabel');
  const saveBtn=document.getElementById('detailSaveBtn');
  const isSaved=_detailSpotId&&getSavedSpotIds().includes(_detailSpotId);
  if(saveBtnIcon){saveBtnIcon.setAttribute('fill',isSaved?'#B8E87A':'none');saveBtnIcon.setAttribute('stroke',isSaved?'#B8E87A':'var(--txt1)');}
  if(saveBtnLabel)saveBtnLabel.textContent=isSaved?'Saved':'Save';
  if(saveBtn){saveBtn.style.background=isSaved?'rgba(184,232,122,.12)':'var(--bg2)';saveBtn.style.borderColor=isSaved?'rgba(184,232,122,.4)':'var(--border2)';saveBtn.style.color=isSaved?'#B8E87A':'var(--txt0)';}
}

function openDetailAddComment(){
  if(isGuest()){showLoginScreen();return;}
  _detailCurrentStarRating=5;
  setDetailReviewStar(5);
  const panel=document.getElementById('detailCommentPanel');
  if(panel){panel.style.display='flex';}
  const inp=document.getElementById('detailCommentInput');
  if(inp){inp.value='';inp.focus();}
}

function closeDetailCommentPanel(){
  const panel=document.getElementById('detailCommentPanel');
  if(panel)panel.style.display='none';
}

// ── Reviews overlay ──
function openDetailReviews(){
  const overlay=document.getElementById('detailReviewsOverlay');
  if(!overlay)return;
  const spot=[...spots,...userSpots].find(s=>s.id===_detailSpotId);
  if(!spot)return;

  // Big score
  const bigScore=document.getElementById('detailRevBigScore');
  const bigStars=document.getElementById('detailRevBigStars');
  const totalCount=document.getElementById('detailRevTotalCount');
  const r=parseFloat(spot.rating)||4.5;
  if(bigScore)bigScore.textContent=r.toFixed(1);
  if(bigStars){
    const full=Math.floor(r);const half=r-full>=0.5;let sh='';
    for(let i=1;i<=5;i++){
      if(i<=full)sh+=`<svg viewBox="0 0 24 24" width="14" height="14" fill="#F5A623" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;
      else if(i===full+1&&half)sh+=`<svg viewBox="0 0 24 24" width="14" height="14" fill="#F5A623" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;
      else sh+=`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;
    }
    bigStars.innerHTML=sh;
  }
  const revData=spot.reviews_data||[];
  const userRevs=JSON.parse(localStorage.getItem(`wp_reviews_${spot.id}`)||'[]');
  const allRevs=[...revData,...userRevs];
  const totalN=(spot.reviews||40)+userRevs.length;
  if(totalCount)totalCount.textContent=totalN+' ratings';

  // Rating bars
  const barsEl=document.getElementById('detailRevBars');
  if(barsEl){
    const counts=[0,0,0,0,0];
    allRevs.forEach(rv=>{const s=Math.min(5,Math.max(1,Math.round(rv.stars||5)));counts[s-1]++;});
    if(!allRevs.length){
      const base=r,total=spot.reviews||40;
      const fiveStarPct=Math.max(0,(base-4)*2*0.6+0.5);
      counts[4]=Math.round(total*fiveStarPct);counts[3]=Math.round(total*0.25);
      counts[2]=Math.round(total*0.1);counts[1]=Math.round(total*0.04);counts[0]=Math.round(total*0.01);
    }
    const total=counts.reduce((a,b)=>a+b,0)||1;
    barsEl.innerHTML=[5,4,3,2,1].map(s=>{
      const pct=Math.round((counts[s-1]/total)*100);
      return`<div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:11px;color:var(--txt2);width:10px;text-align:right;flex-shrink:0">${s}</span>
        <svg viewBox="0 0 24 24" width="11" height="11" fill="#F5A623" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        <div style="flex:1;height:5px;background:rgba(255,255,255,.1);border-radius:3px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${pct>50?'#F5A623':'rgba(245,166,35,.5)'};border-radius:3px"></div></div>
        <span style="font-size:11px;color:var(--txt3);width:28px;flex-shrink:0">${pct}%</span>
      </div>`;
    }).join('');
  }

  // Reviews list
  const listEl=document.getElementById('detailRevList');
  if(listEl){
    const displayRevs=[...allRevs].slice(0,20);
    if(!displayRevs.length){
      listEl.innerHTML=`<div style="font-size:13px;color:var(--txt3);text-align:center;padding:16px 0">No reviews yet — tap "Write a Review" to be first!</div>`;
    } else {
      listEl.innerHTML=displayRevs.map(rv=>{
        const stars='★'.repeat(Math.min(5,Math.max(1,rv.stars||5)));
        const empty='☆'.repeat(Math.max(0,5-(rv.stars||5)));
        return`<div style="background:var(--bg1);border:1px solid var(--border);border-radius:14px;padding:14px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <div style="width:34px;height:34px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#B8E87A;flex-shrink:0">${(rv.user||rv.username||'?').slice(0,2).toUpperCase()}</div>
            <div style="flex:1">
              <div style="font-size:13px;font-weight:700;color:var(--txt0)">@${rv.user||rv.username||'Explorer'}</div>
              <div style="font-size:11px;color:var(--txt3)">${rv.date||''}</div>
            </div>
            <div style="font-size:14px;color:#F5A623;letter-spacing:1px">${stars}<span style="color:rgba(255,255,255,.2)">${empty}</span></div>
          </div>
          <div style="font-size:13px;color:var(--txt1);line-height:1.5">${rv.text||rv.comment||''}</div>
        </div>`;
      }).join('');
    }
  }

  overlay.style.display='flex';
  requestAnimationFrame(()=>requestAnimationFrame(()=>{overlay.style.transform='translateY(0)';}));
}

function closeDetailReviews(){
  const overlay=document.getElementById('detailReviewsOverlay');
  if(!overlay)return;
  overlay.style.transform='translateY(100%)';
  setTimeout(()=>{overlay.style.display='none';},350);
}

function setDetailReviewStar(n){
  _detailCurrentStarRating=n;
  document.querySelectorAll('.detail-review-star').forEach(s=>{
    const v=parseInt(s.getAttribute('data-v'));
    s.style.color=v<=n?'#F5A623':'var(--border2)';
  });
}

function submitDetailComment(){
  if(isGuest()){showLoginScreen();return;}
  const inp=document.getElementById('detailCommentInput');
  const text=(inp?.value||'').trim();
  if(!text||!_detailSpotId){showToast('Write something first');return;}
  const comment={
    id:'c'+Date.now(),
    spotId:_detailSpotId,
    username:_currentUser?.username||'Explorer',
    user:_currentUser?.username||'Explorer',
    text,
    stars:_detailCurrentStarRating,
    date:new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
  };
  // Save to reviews
  const rKey=`wp_reviews_${_detailSpotId}`;
  const revs=JSON.parse(localStorage.getItem(rKey)||'[]');
  revs.unshift(comment);
  localStorage.setItem(rKey,JSON.stringify(revs.slice(0,50)));
  // Save to comments
  const cKey=`wp_comments_spot_${_detailSpotId}`;
  const existing=JSON.parse(localStorage.getItem(cKey)||'[]');
  existing.unshift(comment);
  localStorage.setItem(cKey,JSON.stringify(existing.slice(0,200)));
  if(inp)inp.value='';
  closeDetailCommentPanel();
  _renderDetailComments(_detailSpotId);
  // Refresh review section
  const allS=[...spots,...userSpots];
  const spot=allS.find(s=>s.id===_detailSpotId);
  if(spot)_populateDetailNewElements(spot);
  // Re-render reviews overlay if open
  const revOverlay=document.getElementById('detailReviewsOverlay');
  if(revOverlay&&revOverlay.style.display!=='none')openDetailReviews();
  showToast('Review posted!');
}

function detailSearch(query){
  const dropEl=document.getElementById('detailSearchDrop');
  if(!dropEl)return;
  const q=(query||'').trim().toLowerCase();
  if(!q){dropEl.style.display='none';return;}
  const allS=[...spots,...userSpots];
  const matches=allS.filter(s=>
    s.name.toLowerCase().includes(q)||
    (s.typeLabel||'').toLowerCase().includes(q)||
    (s.tags||[]).some(t=>t.toLowerCase().includes(q))
  ).slice(0,6);
  if(!matches.length){dropEl.style.display='none';return;}
  dropEl.style.display='block';
  dropEl.innerHTML=matches.map(s=>`
    <div onclick="openDetail('${s.id}');document.getElementById('detailSearchInput').value='';document.getElementById('detailSearchDrop').style.display='none'"
      style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px">
      <div style="width:32px;height:32px;border-radius:8px;background:${s.heroGradient||'var(--bg3)'};flex-shrink:0"></div>
      <div>
        <div style="font-size:13px;font-weight:700;color:var(--txt0)">${s.name}</div>
        <div style="font-size:11px;color:var(--txt3)">${s.typeLabel||''} · ${s._realDistStr||s.distance||''}</div>
      </div>
    </div>`).join('');
}

function openDetailOnMap(){
  const allS=[...spots,...userSpots];
  const spot=allS.find(s=>s.id===_detailSpotId);
  closeDetail();
  showTab('map');
  if(!spot)return;
  setTimeout(()=>{
    if(map){
      map.flyTo({center:[spot.lng,spot.lat],zoom:14,duration:1200,essential:true});
      setTimeout(()=>openSheet(spot.id),1300);
    }
  },300);
}

// ═══════════════════════════════════════════════════
// HOME FEED — TikTok-style full-screen post viewer
// ═══════════════════════════════════════════════════
let _feedPosts=[];
let _feedPostIdx=0;
let _feedMediaIdx=0;
let _feedLiked=false;
let _feedSaved=false;
let _feedTouchStartX=0;
let _feedTouchStartY=0;
let _feedTouchStartTime=0;
let _feedTouchActive=false;
let _feedSwipeInProgress=false;
let _feedSendPostIdx=-1;
let _feedMapsInited=new Set();

function buildHomeFeed(){
  // Gather feed posts: community posts (public or own) + spot posts
  const userPosts=getPosts().filter(p=>p.privacy!=='private'||(String(p.userId)===String(_myUid())));
  const spotPosts=_buildSpotFeedPosts();
  // Use DEMO_POSTS as seed content when no real posts exist
  const demoPadding=(typeof DEMO_POSTS!=='undefined'&&(userPosts.length+spotPosts.length)===0)?DEMO_POSTS:
    (typeof DEMO_POSTS!=='undefined'?DEMO_POSTS.filter(dp=>!userPosts.find(up=>up.id===dp.id)):[]);
  const combined=[...userPosts,...spotPosts,...demoPadding];
  // Deduplicate by id, sort by newest first
  const seen=new Set();
  _feedPosts=combined.filter(p=>{if(seen.has(p.id))return false;seen.add(p.id);return true;})
    .sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));

  // Always show grid, hide viewer
  const gridEl=document.getElementById('feedGrid');
  const viewportEl=document.getElementById('feedViewport');
  const topBar=document.getElementById('feedViewerTopBar');
  if(gridEl)gridEl.style.display='flex';
  if(viewportEl)viewportEl.style.display='none';
  if(topBar)topBar.style.display='none';

  const gridContent=document.getElementById('feedGridContent');
  const emptyEl=document.getElementById('feedEmptyState');

  if(!_feedPosts.length){
    if(gridContent)gridContent.innerHTML='';
    if(emptyEl){emptyEl.style.display='flex';}
    return;
  }
  if(emptyEl)emptyEl.style.display='none';
  if(!gridContent)return;

  const myUid=String(_myUid());
  _feedMapsInited=new Set();

  // ── Build Instagram-style scrollable cards with photo carousels ──
  gridContent.innerHTML=_feedPosts.map((post,idx)=>{
    const initials=(post.username||'?').slice(0,2).toUpperCase();
    const likeCount=(post.likes||[]).length;
    const commentCount=(getComments(post.id)||[]).length;
    const liked=(post.likes||[]).map(String).includes(myUid);
    const bg=post.spotGradient||post.heroGradient||'linear-gradient(160deg,#0d1a0d 0%,#1a3a2a 60%,#0d2a1a 100%)';
    const timeAgo=_timeAgo(post.createdAt);
    const hasMap=!!(post.lat&&post.lng);

    // ── Build slides for infinite-loop carousel ──────────────────
    const photos=post.photos||(post.mediaUrl?[post.mediaUrl]:[]);
    const realCount=Math.max(photos.length,1)+(hasMap?1:0);
    const showDots=realCount>1;
    const spotNameEnc=(post.spotName||'').replace(/'/g,'&#39;');

    // Slide renderer — position:absolute per slide
    const _rs=(src,si)=>{
      const isFirst=si===0;
      const baseStyle=`position:absolute;top:0;left:0;width:100%;height:100%;transform:translateX(${isFirst?'0':'100%'});transition:none`;
      if(!src)return`<div class="fcs" data-si="${si}" style="${baseStyle};background:${bg};display:flex;align-items:flex-end;padding:20px">${post.caption?`<p style="font-size:15px;font-weight:600;color:rgba(255,255,255,.85);line-height:1.5;margin:0">${post.caption.slice(0,120)}${post.caption.length>120?'…':''}</p>`:''}</div>`;
      if(src.startsWith('gradient:')){const g=src.replace('gradient:','');return`<div class="fcs" data-si="${si}" style="${baseStyle};background:${g}"></div>`;}
      return`<div class="fcs" data-si="${si}" style="${baseStyle};overflow:hidden;background:${bg}"><img src="${src}" style="width:100%;height:100%;object-fit:cover;display:block" loading="lazy"></div>`;
    };

    // Real slides HTML
    const realSlidesHtml=(photos.length>0?photos.map((src,si)=>_rs(src,si)):[_rs(null,0)]).join('');

    // Map slide (real — carries the Mapbox container ID)
    const mapSlide_si=photos.length>0?photos.length:1;
    const mapSlideHtml=hasMap?`<div class="fcs fcs-map" data-si="${mapSlide_si}" style="position:absolute;top:0;left:0;width:100%;height:100%;transform:translateX(100%);transition:none;background:#0d1a0d">
      <div id="fcmap-${idx}" style="position:absolute;inset:0"></div>
      <div style="position:absolute;top:10px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.72);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:rgba(255,255,255,.9);font-size:11px;font-weight:700;padding:5px 14px;border-radius:20px;pointer-events:none;white-space:nowrap;z-index:2;max-width:80%;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:5px"><svg viewBox="0 0 24 24" width="9" height="9" fill="#B8E87A"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/></svg>${spotNameEnc||'Location'}</div>
      <div onclick="event.stopPropagation();_feedCardGoToMap(${idx})" style="position:absolute;bottom:14px;left:50%;transform:translateX(-50%);background:rgba(184,232,122,.15);border:1px solid rgba(184,232,122,.4);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border-radius:20px;padding:8px 20px;font-size:12px;font-weight:700;color:#B8E87A;cursor:pointer;z-index:2;white-space:nowrap">View Full Spot</div>
    </div>`:'';

    // Spot location pill
    const spotPill=post.spotName?`<div onclick="event.stopPropagation();_feedCardGoToMap(${idx})" style="display:flex;align-items:center;gap:4px;background:rgba(184,232,122,.12);border:1px solid rgba(184,232,122,.25);border-radius:20px;padding:4px 10px;cursor:pointer;flex-shrink:0">
      <svg viewBox="0 0 24 24" width="10" height="10" fill="#B8E87A"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/></svg>
      <span style="font-size:11px;font-weight:700;color:#B8E87A;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${post.spotName}</span>
    </div>`:'';

    // Dots — one per real slide, last is map-pin SVG if hasMap
    const dotsHtml=showDots?`<div class="fcd-row" style="display:flex;align-items:center;justify-content:center;gap:5px;padding:8px 0 0">${Array.from({length:realCount},(_,i)=>{
      const isMapDot=hasMap&&i===realCount-1;
      const active=i===0;
      if(isMapDot)return`<div class="fcd fcd-map${active?' fcd-active':''}" style="display:flex;align-items:center;justify-content:center;transition:all .2s"><svg viewBox="0 0 24 24" width="${active?9:7}" height="${active?9:7}" fill="${active?'#B8E87A':'rgba(255,255,255,.35)'}" stroke="none"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/></svg></div>`;
      return`<div class="fcd${active?' fcd-active':''}" style="width:${active?7:5}px;height:${active?7:5}px;border-radius:50%;background:${active?'#B8E87A':'rgba(255,255,255,.35)'};transition:all .2s"></div>`;
    }).join('')}</div>`:`<div style="height:8px"></div>`;

    return `<div class="feed-card" data-idx="${idx}" data-spotid="${post.spotId||''}" data-lat="${post.lat||''}" data-lng="${post.lng||''}" style="background:var(--bg1);border-bottom:1px solid rgba(255,255,255,.07)">

      <!-- Card header: avatar · username · time · spot pill -->
      <div style="display:flex;align-items:center;gap:10px;padding:12px 14px">
        <div onclick="_showUserPopup('${post.userId}','${post.username}',this)" style="width:36px;height:36px;border-radius:50%;background:var(--bg3);border:2px solid rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#B8E87A;flex-shrink:0;cursor:pointer">${initials}</div>
        <div style="flex:1;min-width:0">
          <div onclick="_showUserPopup('${post.userId}','${sanitize(post.username)}',this)" style="font-size:13px;font-weight:700;color:var(--txt0);cursor:pointer">@${sanitize(post.username)||'explorer'}</div>
          <div style="font-size:11px;color:var(--txt3);margin-top:1px">${timeAgo}</div>
        </div>
        ${spotPill}
      </div>

      <!-- Photo carousel — square aspect ratio, position:absolute per-slide -->
      <div class="feed-carousel" data-postidx="${idx}" data-real-count="${realCount}" data-hasmap="${hasMap?1:0}" data-lat="${post.lat||''}" data-lng="${post.lng||''}" data-spotname="${spotNameEnc}" style="position:relative;overflow:hidden;aspect-ratio:1;width:100%;touch-action:pan-y;cursor:grab">
        <div class="feed-carousel-track" style="position:relative;height:100%;width:100%">
          ${realSlidesHtml}${mapSlideHtml}
        </div>
      </div>

      <!-- Dot indicators (below photo, above action bar) -->
      ${dotsHtml}

      <!-- Action bar: like · comment · send · save -->
      <div style="display:flex;align-items:center;padding:10px 14px 4px;gap:0">
        <div onclick="_feedCardLike(${idx},this)" style="display:flex;align-items:center;gap:5px;padding:4px 12px 4px 0;cursor:pointer;-webkit-tap-highlight-color:transparent">
          <svg class="feed-like-svg" viewBox="0 0 24 24" width="22" height="22" fill="${liked?'#ff4d6d':'none'}" stroke="${liked?'#ff4d6d':'var(--txt1)'}" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          <span class="feed-like-count" style="font-size:13px;font-weight:600;color:var(--txt1)">${likeCount||''}</span>
        </div>
        <div onclick="event.stopPropagation();openPostDetail('${post.id}')" style="display:flex;align-items:center;gap:5px;padding:4px 12px;cursor:pointer;-webkit-tap-highlight-color:transparent">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--txt1)" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span style="font-size:13px;font-weight:600;color:var(--txt1)">${commentCount||''}</span>
        </div>
        <div onclick="_feedCardSend(${idx})" style="display:flex;align-items:center;gap:5px;padding:4px 12px;cursor:pointer;-webkit-tap-highlight-color:transparent">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--txt1)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </div>
        <div onclick="_feedCardSave(${idx},this)" style="margin-left:auto;padding:4px 0 4px 8px;cursor:pointer;-webkit-tap-highlight-color:transparent">
          <svg class="feed-save-svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--txt1)" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        </div>
      </div>

      <!-- Caption -->
      ${post.caption?`<div style="padding:4px 14px 14px;font-size:13px;color:var(--txt0);line-height:1.55"><span style="font-weight:700;margin-right:6px">@${sanitize(post.username)||'explorer'}</span>${sanitize(post.caption)}</div>`:'<div style="height:12px"></div>'}

    </div>`;
  }).join('');

  // ── Init carousels and attach swipe gestures ──
  _initFeedCarousels();
}

function _timeAgo(iso){
  if(!iso)return '';
  const secs=Math.floor((Date.now()-new Date(iso).getTime())/1000);
  if(secs<60)return 'just now';
  if(secs<3600)return Math.floor(secs/60)+'m ago';
  if(secs<86400)return Math.floor(secs/3600)+'h ago';
  if(secs<604800)return Math.floor(secs/86400)+'d ago';
  return Math.floor(secs/604800)+'w ago';
}

function _attachFeedCardSwipeGestures(){
  const cards=document.querySelectorAll('.feed-card');
  cards.forEach(card=>{
    let tx=0,ty=0,swiped=false;
    card.addEventListener('touchstart',e=>{
      tx=e.touches[0].clientX;
      ty=e.touches[0].clientY;
      swiped=false;
    },{passive:true});
    card.addEventListener('touchend',e=>{
      if(swiped)return;
      const dx=e.changedTouches[0].clientX-tx;
      const dy=e.changedTouches[0].clientY-ty;
      // Right swipe: horizontal dominant, dx > 70px
      if(dx>70&&Math.abs(dy)<60){
        swiped=true;
        const idx=parseInt(card.dataset.idx);
        _feedCardGoToMap(idx);
      }
    },{passive:true});
  });
}

function _feedCardGoToMap(idx){
  const post=_feedPosts[idx];
  if(!post)return;
  const lat=post.lat;
  const lng=post.lng;
  const spotId=post.spotId;
  showTab('map');
  if(map&&lat&&lng){
    setTimeout(()=>{
      map.flyTo({center:[lng,lat],zoom:14,duration:1000,essential:true});
      if(spotId)setTimeout(()=>openDetail(spotId),1100);
    },250);
  } else if(spotId){
    setTimeout(()=>openDetail(spotId),300);
  }
}

function _feedCardLike(idx,btn){
  const post=_feedPosts[idx];
  if(!post)return;
  const myUid=String(_myUid());
  post.likes=post.likes||[];
  const alreadyLiked=post.likes.map(String).includes(myUid);
  if(alreadyLiked){post.likes=post.likes.filter(u=>String(u)!==myUid);_sbToggleLike(post.id,false);}
  else{post.likes.push(myUid);_sbToggleLike(post.id,true);}
  const svg=btn.querySelector('.feed-like-svg');
  const countEl=btn.querySelector('.feed-like-count');
  const liked2=post.likes.map(String).includes(myUid);
  if(svg){svg.setAttribute('fill',liked2?'#ff4d6d':'none');svg.setAttribute('stroke',liked2?'#ff4d6d':'var(--txt1)');}
  if(countEl)countEl.textContent=post.likes.length||'';
  // Persist to localStorage posts
  const allPosts=getPosts();
  const lp=allPosts.find(p=>p.id===post.id);
  if(lp){lp.likes=post.likes;setPosts(allPosts);}
  // Heart burst
  const burst=document.createElement('div');
  burst.style.cssText='position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:9999;animation:_feedBurst .6s ease forwards';
  burst.innerHTML='<svg viewBox="0 0 24 24" width="80" height="80" fill="#ff4d6d" stroke="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
  if(liked2){document.body.appendChild(burst);setTimeout(()=>burst.remove(),650);}
}

function _feedCardSave(idx,btn){
  const post=_feedPosts[idx];
  if(!post)return;
  openSaveFolderSheet(post.id,btn);
}

function _feedCardShare(idx){
  const post=_feedPosts[idx];
  if(!post)return;
  const name=post.spotName||post.username||'this post';
  if(navigator.share){navigator.share({title:'WildPath',text:`Check out ${name} on WildPath!`,url:window.location.href}).catch(()=>{});}
  else{showToast('Link copied');}
}

function _feedCardSend(idx){
  _feedSendPostIdx=idx;
  openFeedSendSheet();
}

// Keep openFeedViewer as no-op (feed is now scroll-based, no overlay viewer)
function openFeedViewer(idx){_feedCardGoToMap(idx);}
function closeFeedViewer(){}

// ── Feed post carousels — position:absolute per-slide ──────────
function _initFeedCarousels(){
  document.querySelectorAll('.feed-carousel').forEach(carousel=>{
    const realCount=parseInt(carousel.dataset.realCount)||1;
    if(realCount<=1)return;
    const track=carousel.querySelector('.feed-carousel-track');
    if(!track)return;
    const dotsRow=carousel.parentElement.querySelector('.fcd-row');

    let cur=0; // logical index 0..realCount-1
    const slides=Array.from(track.querySelectorAll('.fcs'));
    if(!slides.length)return;

    function _setSlidePositions(withTransition){
      slides.forEach((s,i)=>{
        s.style.transition=withTransition?'transform 300ms ease':'none';
        let offset=i-cur;
        // wrap: if offset is more than half the count, adjust
        if(offset>Math.floor(realCount/2)) offset-=realCount;
        else if(offset<-Math.floor(realCount/2)) offset+=realCount;
        s.style.transform=`translateX(${offset*100}%)`;
      });
    }

    function updateDots(idx){
      if(!dotsRow)return;
      dotsRow.querySelectorAll('.fcd').forEach((d,i)=>{
        const active=i===idx;
        if(d.classList.contains('fcd-map')){
          const sv=d.querySelector('svg');
          if(sv){sv.setAttribute('width',active?9:7);sv.setAttribute('height',active?9:7);sv.setAttribute('fill',active?'#B8E87A':'rgba(255,255,255,.35)');}
        } else {
          d.style.background=active?'#B8E87A':'rgba(255,255,255,.35)';
          d.style.width=(active?7:5)+'px';
          d.style.height=(active?7:5)+'px';
        }
      });
    }

    function maybeInitMap(idx){
      if(parseInt(carousel.dataset.hasmap)!==1)return;
      if(idx!==realCount-1)return;
      const pi=carousel.dataset.postidx;
      const lat=parseFloat(carousel.dataset.lat);
      const lng=parseFloat(carousel.dataset.lng);
      const sn=carousel.dataset.spotname||'';
      setTimeout(()=>_initFeedCardMap('fcmap-'+pi,lat,lng,sn),60);
    }

    function goTo(newIdx){
      // Remove transitions, snap all to new positions
      cur=((newIdx%realCount)+realCount)%realCount;
      // Force reflow before adding transition
      slides.forEach(s=>{s.style.transition='none';});
      void track.offsetWidth; // reflow
      slides.forEach((s,i)=>{
        s.style.transition='transform 300ms ease';
        let offset=i-cur;
        if(offset>Math.floor(realCount/2)) offset-=realCount;
        else if(offset<-Math.floor(realCount/2)) offset+=realCount;
        s.style.transform=`translateX(${offset*100}%)`;
      });
      updateDots(cur);
      maybeInitMap(cur);
      console.log('[carousel] slide',cur,'/',realCount);
    }

    // Initial placement — no transition
    _setSlidePositions(false);
    updateDots(0);

    // ── Touch ──────────────────────────────────────────────────────
    let tx=0,ty=0,tdrag=false,tVertDom=false;
    carousel.addEventListener('touchstart',e=>{
      tx=e.touches[0].clientX;ty=e.touches[0].clientY;
      tdrag=true;tVertDom=false;
    },{passive:true});
    carousel.addEventListener('touchmove',e=>{
      if(!tdrag)return;
      const dx=e.touches[0].clientX-tx;
      const dy=e.touches[0].clientY-ty;
      if(!tVertDom&&Math.abs(dy)>Math.abs(dx)+8){tVertDom=true;tdrag=false;return;}
    },{passive:true});
    carousel.addEventListener('touchend',e=>{
      if(!tdrag)return;tdrag=false;tVertDom=false;
      const dx=e.changedTouches[0].clientX-tx;
      if(dx<-50)goTo(cur+1);
      else if(dx>50)goTo(cur-1);
    },{passive:true});

    // ── Mouse ──────────────────────────────────────────────────────
    let mdown=false,mx=0;
    carousel.addEventListener('mousedown',e=>{
      mdown=true;mx=e.clientX;
      carousel.style.cursor='grabbing';
      e.preventDefault();
      const onUp=ev=>{
        document.removeEventListener('mouseup',onUp);
        if(!mdown)return;mdown=false;
        carousel.style.cursor='grab';
        const dx=ev.clientX-mx;
        if(dx<-50)goTo(cur+1);
        else if(dx>50)goTo(cur-1);
      };
      document.addEventListener('mouseup',onUp);
    });
  });
}

function _initFeedCardMap(containerId,lat,lng,spotName){
  if(_feedMapsInited.has(containerId))return;
  const el=document.getElementById(containerId);
  if(!el)return;
  // Reuse the app-wide token already set on mapboxgl — never prompt separately
  _feedMapsInited.add(containerId);
  try{
    const m=new mapboxgl.Map({
      container:el,
      style:'mapbox://styles/mapbox/dark-v11',
      center:[lng,lat],zoom:13,
      interactive:true,
      attributionControl:false
    });
    new mapboxgl.Marker({color:'#B8E87A',scale:0.85}).setLngLat([lng,lat]).addTo(m);
  }catch(err){
    console.warn('Feed card map error:',err);
    el.innerHTML=`<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#0d1a0d"><div style="font-size:12px;color:rgba(255,255,255,.3)">${spotName||''}</div></div>`;
  }
}

function _buildSpotFeedPosts(){
  // Build synthetic posts for spots that have photos, to fill the feed
  const allS=[...spots,...userSpots];

  // ── Two hard-coded demo posts at the top so the user can swipe between them ──
  const demoPosts=[];
  const spot0=allS[0]; // Sutro Baths
  const spot1=allS[1]; // Moaning Caverns
  if(spot0){
    demoPosts.push({
      id:'demo_post_0',
      type:'spot',
      spotId:spot0.id,
      spotName:'McWay Falls',
      spotGradient:spot0.heroGradient||'linear-gradient(160deg,#0d1a2e,#1a3a5c)',
      caption:'Golden hour at the edge of the Pacific. The fog rolled in through the ruined archways and I just stood there watching the light change.',
      mediaUrl:null,
      photos:[
        'gradient:linear-gradient(160deg,#0a1a0a,#1a3a1a,#0d2a0d)',
        'gradient:linear-gradient(160deg,#0a1a1a,#1a3a3a,#0d2a2a)',
        'gradient:linear-gradient(160deg,#0a0d1a,#1a2040,#0d1530)'
      ],
      username:'jaron_explores',
      userId:'demo_user_1',
      lat:spot0.lat,
      lng:spot0.lng,
      likes:['demo_user_2','demo_user_3'],
      createdAt:new Date(Date.now()-3600000*2).toISOString(),
      privacy:'public'
    });
  }
  if(spot1){
    demoPosts.push({
      id:'demo_post_1',
      type:'spot',
      spotId:spot1.id,
      spotName:'Moaning Caverns',
      spotGradient:spot1.heroGradient||'linear-gradient(160deg,#1a0a2e,#2d1a5c)',
      caption:'Rappelled 165 feet straight down into the dark. Heart pounding the entire way. Moaning Caverns is absolutely wild — bucket list unlocked.',
      mediaUrl:null,
      photos:[
        'gradient:linear-gradient(160deg,#1a0a2a,#3a1a4a,#2a0d3a)',
        'gradient:linear-gradient(160deg,#0a0d2a,#1a2060,#0d1550)'
      ],
      username:'trail_seeker',
      userId:'demo_user_2',
      lat:spot1.lat,
      lng:spot1.lng,
      likes:['demo_user_1'],
      createdAt:new Date(Date.now()-86400000).toISOString(),
      privacy:'public'
    });
  }

  // Rest of spots fill the feed
  const posts=[];
  allS.slice(0,12).forEach((s,i)=>{
    // Skip spots already used in demo posts
    if((spot0&&s.id===spot0.id)||(spot1&&s.id===spot1.id))return;
    posts.push({
      id:'spot_feed_'+s.id,
      type:'spot',
      spotId:s.id,
      spotName:s.name,
      spotGradient:s.heroGradient||'linear-gradient(135deg,#1a3a2a,#2d6e52)',
      caption:s.description||s.insiderTips||`${s.typeLabel||'Spot'} near ${s.name}`,
      mediaUrl:null,
      photos:[`https://picsum.photos/seed/${s.id}w1/800/800`,`https://picsum.photos/seed/${s.id}w2/800/800`],
      username:s.discoveredBy||'WildPath',
      userId:'system',
      lat:s.lat,
      lng:s.lng,
      likes:[],
      createdAt:new Date(Date.now()-(i+2)*86400000*3).toISOString(),
      privacy:'public'
    });
  });
  return [...demoPosts,...posts];
}

function _renderFeedPost(idx){
  const post=_feedPosts[idx];
  if(!post)return;
  _feedMediaIdx=0;
  _feedLiked=false;
  _feedSaved=false;

  // Author
  const avatarEl=document.getElementById('feedPostAvatar');
  const usernameEl=document.getElementById('feedPostUsername');
  if(avatarEl){
    avatarEl.innerHTML='';
    const initials=(post.username||'WP').slice(0,2).toUpperCase();
    // Try avatar image
    const savedAvatar=(getUserProfile(String(post.userId))||{}).avatarUrl;
    if(savedAvatar&&post.userId!=='system'){
      const img=document.createElement('img');
      img.src=savedAvatar;img.style.cssText='width:100%;height:100%;object-fit:cover;border-radius:50%';
      avatarEl.appendChild(img);
    } else {
      avatarEl.textContent=initials;
    }
  }
  if(usernameEl)usernameEl.textContent='@'+(post.username||'wildpath');

  // Location pill
  const locNameEl=document.getElementById('feedLocationName');
  const locPill=document.getElementById('feedLocationPill');
  const spotName=post.spotName||(()=>{
    if(post.spotId){const s=[...spots,...userSpots].find(x=>x.id===post.spotId);return s?s.name:null;}
    return null;
  })();
  if(locPill)locPill.style.display=spotName?'flex':'none';
  if(locNameEl)locNameEl.textContent=spotName||'';

  // Like state
  const liked=(post.likes||[]).includes(String(_myUid()));
  _feedLiked=liked;
  _setFeedLikeUI(liked);
  const likeCountEl=document.getElementById('feedLikeCount');
  if(likeCountEl)likeCountEl.textContent=(post.likes||[]).length;

  // Comment count
  const commCountEl=document.getElementById('feedCommentCount');
  if(commCountEl){
    // Post comments are always post-scoped — never depend on spot link
    commCountEl.textContent=getComments(post.id).length;
  }

  // Save state
  const savedSpots=getSavedSpotIds();
  _feedSaved=post.spotId&&savedSpots.includes(post.spotId);
  _setFeedSaveUI(_feedSaved);

  // Build media slides
  _buildFeedSlides(post);
}

function _buildFeedSlides(post){
  const container=document.getElementById('feedMediaSlides');
  if(!container)return;

  const slides=[];
  // Media slide(s)
  if(post.mediaUrl&&post.type==='photo'){
    slides.push(`<div style="width:100vw;height:100%;flex-shrink:0;background:#000;overflow:hidden;display:flex;align-items:center;justify-content:center">
      <img src="${post.mediaUrl}" style="width:100%;height:100%;object-fit:cover">
    </div>`);
  } else if(post.type==='spot'||post.spotId){
    // Gradient hero for spot
    const allS=[...spots,...userSpots];
    const s=allS.find(x=>x.id===(post.spotId||post.id.replace('spot_feed_','')));
    const grad=(s&&s.heroGradient)||post.spotGradient||'linear-gradient(135deg,#1a3a2a,#2d6e52)';
    const label=s?s.typeLabel:'Spot';
    slides.push(`<div style="width:100vw;height:100%;flex-shrink:0;background:${grad};overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px">
      <div style="font-size:64px;opacity:0.8">${_getSpotEmojiForType(s?.type)}</div>
      <div style="font-size:18px;font-weight:700;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,.6);padding:0 32px;text-align:center">${post.spotName||s?.name||'Wild Spot'}</div>
      <div style="font-size:13px;color:rgba(255,255,255,.7)">${label}</div>
    </div>`);
  } else {
    // Text/generic post
    slides.push(`<div style="width:100vw;height:100%;flex-shrink:0;background:linear-gradient(135deg,#0b1a0b,#1a3a2a);overflow:hidden;display:flex;align-items:center;justify-content:center;padding:32px">
      <div style="font-size:16px;color:#fff;line-height:1.6;text-align:center">${post.caption||''}</div>
    </div>`);
  }
  // If post has a spotId, also add a map slide
  if(post.spotId){
    const allS=[...spots,...userSpots];
    const s=allS.find(x=>x.id===post.spotId);
    if(s){
      slides.push(`<div style="width:100vw;height:100%;flex-shrink:0;background:#0b1a0b;overflow:hidden;position:relative" id="feedMapSlide_${post.id}">
        <div id="feedMapSlideMap_${post.id}" style="position:absolute;inset:0"></div>
        <div style="position:absolute;bottom:16px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.7);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.2);border-radius:20px;padding:6px 16px;font-size:12px;color:#fff;font-weight:600;white-space:nowrap">${s.name}</div>
      </div>`);
    }
  }

  container.innerHTML=slides.join('');
  container.style.transition='none';
  container.style.transform='translateX(0)';
  // If the first slide is a map slide (no other media), init it
  if(slides.length>1&&post.spotId){
    // Map slide is last - init lazily when swiped to
  }
  _updateFeedDots(slides.length,0,!!post.spotId);
  // Store slide count on the post object for gesture handler
  _feedPosts[_feedPostIdx]._slideCount=slides.length;
}

function _getSpotEmojiForType(type){
  return '';
}

function _updateFeedDots(total,current,hasMapSlide){
  const dotsEl=document.getElementById('feedDotsRow');
  if(!dotsEl)return;
  if(total<=1){dotsEl.innerHTML='';return;}
  dotsEl.innerHTML=Array.from({length:total},(_,i)=>{
    const isLast=i===total-1;
    const isActive=i===current;
    if(isLast&&hasMapSlide){
      // Map pin icon as final dot
      const pinColor=isActive?'#B8E87A':'rgba(255,255,255,.45)';
      const scale=isActive?1.2:1;
      return `<div style="width:16px;height:16px;display:flex;align-items:center;justify-content:center;transition:all .2s;transform:scale(${scale})">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="${pinColor}" stroke="none" style="transition:fill .2s">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
      </div>`;
    }
    return `<div style="width:${isActive?16:6}px;height:6px;border-radius:3px;background:${isActive?'#B8E87A':'rgba(255,255,255,.3)'};transition:all .2s"></div>`;
  }).join('');
}

function _setFeedLikeUI(liked){
  // Only the bottom bar heart icon (feedLikeIconBar); the media-area duplicate was removed
  const iconBar=document.getElementById('feedLikeIconBar');
  if(iconBar){iconBar.setAttribute('fill',liked?'#ff4d6d':'none');iconBar.setAttribute('stroke',liked?'#ff4d6d':'var(--txt2)');}
}

function _setFeedSaveUI(saved){
  const icon=document.getElementById('feedSaveIcon');
  if(icon){icon.setAttribute('fill',saved?'#B8E87A':'none');icon.setAttribute('stroke',saved?'#B8E87A':'var(--txt2)');}
}

function feedToggleLike(){
  if(isGuest()){showLoginScreen();return;}
  const post=_feedPosts[_feedPostIdx];
  if(!post)return;
  _feedLiked=!_feedLiked;
  _setFeedLikeUI(_feedLiked);
  const allPosts=getPosts();
  const livePost=allPosts.find(p=>p.id===post.id);
  if(livePost){
    const uid=String(_myUid());
    livePost.likes=livePost.likes||[];
    if(_feedLiked){if(!livePost.likes.includes(uid))livePost.likes.push(uid);}
    else{livePost.likes=livePost.likes.filter(u=>u!==uid);}
    setPosts(allPosts);
    post.likes=livePost.likes;
  } else {
    post.likes=post.likes||[];
    if(_feedLiked)post.likes.push(String(_myUid()));
    else post.likes=post.likes.filter(u=>u!==String(_myUid()));
  }
  const likeCountEl=document.getElementById('feedLikeCount');
  if(likeCountEl)likeCountEl.textContent=(post.likes||[]).length;
}

function shareFeedPost(){
  const post=_feedPosts[_feedPostIdx];
  if(!post)return;
  const spotName=post.spotName||'this spot';
  if(navigator.share){
    navigator.share({title:'WildPath — '+spotName,text:`Check out ${spotName} on WildPath!`,url:window.location.href}).catch(()=>{});
  } else {
    showToast('Share: WildPath — '+spotName);
  }
}

function feedOpenComments(){
  const post=_feedPosts[_feedPostIdx];
  if(!post)return;
  if(post.spotId){openDetail(post.spotId);}
  else{openPostDetail(post.id);}
}

function feedToggleSave(){
  if(isGuest()){showLoginScreen();return;}
  const post=_feedPosts[_feedPostIdx];
  if(!post)return;
  _feedSaved=!_feedSaved;
  _setFeedSaveUI(_feedSaved);
  const savedPosts=getSavedPostIds();
  if(_feedSaved){
    if(!savedPosts.find(p=>p.id===post.id))savedPosts.unshift(post);
    if(post.spotId){const s=getSavedSpotIds();if(!s.includes(post.spotId)){s.push(post.spotId);setSavedSpotIds(s);}}
  } else {
    const i=savedPosts.findIndex(p=>p.id===post.id);if(i>=0)savedPosts.splice(i,1);
    if(post.spotId){const s=getSavedSpotIds();const si=s.indexOf(post.spotId);if(si>=0){s.splice(si,1);setSavedSpotIds(s);}}
  }
  setSavedPostIds(savedPosts);
  showToast(_feedSaved?'Saved!':'Removed from saved');
  refreshSpotMarkers();
}

function feedOpenSpotDetail(){
  const post=_feedPosts[_feedPostIdx];
  if(!post)return;
  if(post.spotId)openDetail(post.spotId);
}

function openFeedAuthorProfile(){
  const post=_feedPosts[_feedPostIdx];
  if(!post||post.userId==='system')return;
  _openUserProfileSheet(post.userId,post.username);
}

function _showUserPopup(userId,username,anchorEl){
  // Remove any existing popup
  document.querySelectorAll('._user-popup').forEach(p=>p.remove());
  const allPosts=getPosts();
  const userPosts=allPosts.filter(p=>String(p.userId)===String(userId));
  const follows=getFollows();
  const myUid=String(_myUid());
  const myFollowing=follows[myUid]||[];
  const isFollowing=myFollowing.includes(String(userId));
  const initials=(username||'?').slice(0,2).toUpperCase();
  const followerCount=Object.values(follows).filter(arr=>arr.includes(String(userId))).length;

  const popup=document.createElement('div');
  popup.className='_user-popup';
  popup.style.cssText='position:fixed;z-index:8000;background:var(--bg1);border:1px solid var(--border2);border-radius:16px;padding:14px;width:220px;box-shadow:0 8px 32px rgba(0,0,0,.5)';

  // Position near anchor
  const rect=anchorEl?anchorEl.getBoundingClientRect():null;
  const top=rect?Math.min(rect.bottom+6,window.innerHeight-200):100;
  const left=rect?Math.max(8,Math.min(rect.left,window.innerWidth-228)):window.innerWidth/2-110;
  popup.style.top=top+'px';popup.style.left=left+'px';

  popup.innerHTML=`
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <div style="width:42px;height:42px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;color:#B8E87A;flex-shrink:0">${initials}</div>
      <div>
        <div style="font-size:14px;font-weight:700;color:var(--txt0)">@${username||'explorer'}</div>
        <div style="font-size:11px;color:var(--txt3)">${followerCount} followers · ${userPosts.length} posts</div>
      </div>
    </div>
    <div style="display:flex;gap:8px">
      ${!isGuest()?`<button onclick="_toggleFollowUser('${userId}','${username}',this)" style="flex:1;padding:8px;border-radius:10px;border:1.5px solid ${isFollowing?'var(--border2)':'#B8E87A'};background:${isFollowing?'transparent':'#B8E87A'};color:${isFollowing?'var(--txt2)':'#0f1a0a'};font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">${isFollowing?'Following':'Follow'}</button>`:''}
      <button onclick="document.querySelectorAll('._user-popup').forEach(p=>p.remove());_openUserProfileSheet('${userId}','${username}')" style="flex:1;padding:8px;border-radius:10px;border:1.5px solid var(--border2);background:transparent;color:var(--txt0);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">View Profile</button>
    </div>`;

  // Dismiss on outside click
  const dismiss=(e)=>{if(!popup.contains(e.target)){popup.remove();document.removeEventListener('click',dismiss,true);}};
  setTimeout(()=>document.addEventListener('click',dismiss,true),50);
  document.body.appendChild(popup);
}

function _openUserProfileSheet(uid,username){
  const existing=document.getElementById('userProfileSheet');
  if(existing)existing.remove();
  const sheet=document.createElement('div');
  sheet.id='userProfileSheet';
  sheet.style.cssText='position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.6);display:flex;align-items:flex-end';
  const allPosts=getPosts();
  const userPosts=allPosts.filter(p=>String(p.userId)===String(uid));
  const initials=(username||'?').slice(0,2).toUpperCase();
  const follows=getFollows();
  const myUid=String(_myUid());
  const myFollowing=follows[myUid]||[];
  const isFollowing=myFollowing.includes(String(uid));
  const photoGrid=userPosts.slice(0,9).map(p=>{
    const bg=p.mediaUrl?'':`background:${p.spotGradient||p.heroGradient||'linear-gradient(135deg,#1a2c1a,#2d4a2d)'}`;
    return `<div style="aspect-ratio:1;overflow:hidden;border-radius:6px;${bg}">
      ${p.mediaUrl?`<img src="${p.mediaUrl}" style="width:100%;height:100%;object-fit:cover" loading="lazy">`:''}
    </div>`;
  }).join('');
  sheet.innerHTML=`<div style="width:100%;max-height:82vh;background:var(--bg1);border-radius:20px 20px 0 0;display:flex;flex-direction:column;overflow:hidden">
    <div style="width:40px;height:4px;background:rgba(255,255,255,.18);border-radius:2px;margin:12px auto 0"></div>
    <!-- Header -->
    <div style="padding:16px 16px 12px;display:flex;align-items:center;gap:14px;border-bottom:1px solid var(--border);flex-shrink:0">
      <div style="width:54px;height:54px;border-radius:50%;background:var(--bg3);border:2px solid rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:#B8E87A;flex-shrink:0">${initials}</div>
      <div style="flex:1">
        <div style="font-size:16px;font-weight:800;color:var(--txt0)">@${username||'explorer'}</div>
        <div style="font-size:12px;color:var(--txt3);margin-top:2px">${userPosts.length} posts · Explorer</div>
      </div>
      ${!isGuest()?`<button onclick="_toggleFollowUser('${uid}','${username}',this)" style="padding:8px 18px;border-radius:20px;border:1.5px solid ${isFollowing?'var(--border2)':'#B8E87A'};background:${isFollowing?'transparent':'#B8E87A'};color:${isFollowing?'var(--txt2)':'#0f1a0a'};font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">${isFollowing?'Following':'Follow'}</button>`:''}
    </div>
    <!-- Post grid -->
    <div style="flex:1;overflow-y:auto;padding:12px">
      ${photoGrid?`<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px">${photoGrid}</div>`:`<div style="text-align:center;padding:40px 20px;color:var(--txt3);font-size:13px">No posts yet</div>`}
    </div>
    <div style="padding:12px 16px;flex-shrink:0">
      <button onclick="document.getElementById('userProfileSheet').remove()" style="width:100%;height:44px;background:var(--bg2);border:1px solid var(--border2);color:var(--txt1);border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">Close</button>
    </div>
  </div>`;
  sheet.onclick=e=>{if(e.target===sheet)sheet.remove();};
  document.body.appendChild(sheet);
}

function _toggleFollowUser(uid,username,btn){
  if(isGuest()){showLoginScreen();return;}
  const follows=getFollows();
  const myUid=String(_myUid());
  const following=follows[myUid]||[];
  const idx=following.indexOf(String(uid));
  if(idx>=0){following.splice(idx,1);btn.textContent='Follow';btn.style.background='#B8E87A';btn.style.color='#0f1a0a';btn.style.borderColor='#B8E87A';}
  else{following.push(String(uid));btn.textContent='Following';btn.style.background='transparent';btn.style.color='var(--txt2)';btn.style.borderColor='var(--border2)';}
  follows[myUid]=following;
  setFollows(follows);
  showToast(idx>=0?'Unfollowed @'+username:'Following @'+username);
}

function _feedNavigatePost(dir){
  // dir: +1=next, -1=prev
  const newIdx=_feedPostIdx+dir;
  if(newIdx<0){closeFeedViewer();return;} // swipe down past first post = back to grid
  if(newIdx>=_feedPosts.length)return;
  _feedPostIdx=newIdx;
  _feedMediaIdx=0;
  _renderFeedPost(_feedPostIdx);
}

function _feedNavigateMedia(dir){
  // dir: +1=next slide, -1=prev slide
  const post=_feedPosts[_feedPostIdx];
  const total=post?._slideCount||1;
  const newMediaIdx=_feedMediaIdx+dir;
  if(newMediaIdx<0){
    // Already at first slide — do nothing
    return false;
  }
  if(newMediaIdx>=total){
    // Past last slide — advance to next post
    _feedNavigatePost(1);
    return true;
  }
  _feedMediaIdx=newMediaIdx;
  const container=document.getElementById('feedMediaSlides');
  if(container){
    container.style.transition='transform .28s cubic-bezier(.4,0,.2,1)';
    container.style.transform=`translateX(-${_feedMediaIdx*100}vw)`;
  }
  _updateFeedDots(total,_feedMediaIdx,!!post.spotId);
  // Init map slide if navigating to it
  if(post.spotId&&_feedMediaIdx===total-1){
    _initFeedMapSlide(post);
  }
  return true;
}

function _initFeedMapSlide(post){
  const mapContainerId='feedMapSlideMap_'+post.id;
  const mapContainer=document.getElementById(mapContainerId);
  if(!mapContainer||mapContainer._mapInit)return;
  mapContainer._mapInit=true;
  const allS=[...spots,...userSpots];
  const s=allS.find(x=>x.id===post.spotId);
  if(!s)return;
  const tok=localStorage.getItem('mapbox-token')||'';
  if(!tok)return;
  try{
    mapboxgl.accessToken=tok;
    const slideMap=new mapboxgl.Map({
      container:mapContainerId,
      style:'mapbox://styles/mapbox/outdoors-v12',
      center:[s.lng,s.lat],
      zoom:13,
      interactive:true,
      attributionControl:false
    });
    slideMap.on('load',()=>{
      const el=document.createElement('div');
      el.style.cssText='width:16px;height:16px;border-radius:50%;background:#B8E87A;border:3px solid #fff;box-shadow:0 0 0 5px rgba(184,232,122,.3)';
      new mapboxgl.Marker({element:el}).setLngLat([s.lng,s.lat]).addTo(slideMap);
    });
  }catch(e){}
}

function _initFeedGestures(){
  const viewport=document.getElementById('feedViewport');
  if(!viewport||viewport._gesturesAttached)return;
  viewport._gesturesAttached=true;

  viewport.addEventListener('touchstart',(e)=>{
    _feedTouchStartX=e.touches[0].clientX;
    _feedTouchStartY=e.touches[0].clientY;
    _feedTouchStartTime=Date.now();
    _feedTouchActive=true;
    _feedSwipeInProgress=false;
  },{passive:true});

  viewport.addEventListener('touchend',(e)=>{
    if(!_feedTouchActive)return;
    _feedTouchActive=false;
    const dx=e.changedTouches[0].clientX-_feedTouchStartX;
    const dy=e.changedTouches[0].clientY-_feedTouchStartY;
    const dt=Date.now()-_feedTouchStartTime;
    const absDx=Math.abs(dx), absDy=Math.abs(dy);
    // Minimum swipe distance
    if(Math.max(absDx,absDy)<40)return;
    // Determine primary direction
    if(absDx>absDy&&absDx>50){
      // Horizontal swipe
      if(dx<-50){
        // Swipe left → next media or next post
        _feedNavigateMedia(1);
      } else if(dx>50&&_feedMediaIdx>0){
        // Swipe right → prev media
        _feedNavigateMedia(-1);
      }
    } else if(absDy>absDx&&absDy>60){
      // Vertical swipe
      if(dy<-60){
        // Swipe up → next post
        _feedNavigatePost(1);
      } else if(dy>60){
        // Swipe down → prev post
        _feedNavigatePost(-1);
      }
    }
  },{passive:true});
}

// ═══════════════════════════════════════════════════
// PROFILE — map thumbnail, saved, want-to-go
// ═══════════════════════════════════════════════════
let _profileMapThumbnailInstance=null;

function _initProfileMapThumbnail(){
  const container=document.getElementById('profileMapThumbnail');
  if(!container)return;
  const tok=localStorage.getItem('mapbox-token')||'';
  if(!tok){
    container.innerHTML=`<div style="width:100%;height:100%;background:linear-gradient(135deg,#0b1a0b,#1a3a2a);border-radius:12px"></div>`;
    return;
  }
  // Destroy previous
  if(_profileMapThumbnailInstance){try{_profileMapThumbnailInstance.remove();}catch(e){}  _profileMapThumbnailInstance=null;}
  container.style.cssText='width:100%;height:100%;border-radius:12px;overflow:hidden;position:relative';
  try{
    mapboxgl.accessToken=tok;
    _profileMapThumbnailInstance=new mapboxgl.Map({
      container,
      style:'mapbox://styles/mapbox/outdoors-v12',
      center:window._lastUserLng?[window._lastUserLng,window._lastUserLat]:[-121.5,38.5],
      zoom:8,
      interactive:false,
      attributionControl:false
    });
    _profileMapThumbnailInstance.on('load',()=>{
      // Add dots for visited spots
      const myUid=String(_myUid());
      const myPosts=getPosts().filter(p=>String(p.userId)===myUid&&p.spotId);
      const visitedIds=new Set(myPosts.map(p=>p.spotId));
      const allS=[...spots,...userSpots].filter(s=>visitedIds.has(s.id));
      allS.forEach(s=>{
        const el=document.createElement('div');
        el.style.cssText='width:8px;height:8px;border-radius:50%;background:#F5C842;border:1.5px solid #fff';
        new mapboxgl.Marker({element:el}).setLngLat([s.lng,s.lat]).addTo(_profileMapThumbnailInstance);
      });
    });
  }catch(e){console.warn('Profile map thumbnail failed',e);}
}

// ═══════════════════════════════════════════════════
// REUSABLE FULL-FEATURED MAP (Section 4) — shared control
// set (styles, search, boundary layers, compass, zoom,
// long-press pin) applied to any Mapbox instance + pin filter.
// ═══════════════════════════════════════════════════
function _secondaryMapControlsHTML(prefix){
  return `
    <div style="position:absolute;top:16px;left:70px;right:14px;z-index:100">
      <div style="position:relative;background:rgba(26,23,20,.88);border:1px solid rgba(255,255,255,.08);border-radius:26px;display:flex;align-items:center;gap:10px;padding:0 16px;height:52px;backdrop-filter:blur(20px)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--txt3)" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input type="text" id="${prefix}SearchInput" placeholder="Search anywhere…" oninput="_secondaryMapSearch('${prefix}',this.value)" autocomplete="off" style="background:none;border:none;outline:none;color:var(--txt0);font-size:15px;flex:1;font-family:var(--font)">
      </div>
      <div id="${prefix}SearchDrop" style="display:none;background:var(--bg1);border:1px solid var(--border2);border-radius:14px;margin-top:6px;max-height:240px;overflow-y:auto"></div>
    </div>
    <div onclick="_toggleSecondaryLayers('${prefix}')" style="position:absolute;top:16px;left:16px;width:44px;height:52px;background:rgba(26,23,20,.88);border:1px solid rgba(255,255,255,.08);border-radius:22px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:100">
      <svg width="20" height="14" viewBox="0 0 20 14" fill="none"><rect width="20" height="2.2" rx="1.1" fill="var(--txt1)"/><rect y="5.9" width="14" height="2.2" rx="1.1" fill="var(--txt1)"/><rect y="11.8" width="20" height="2.2" rx="1.1" fill="var(--txt1)"/></svg>
    </div>
    <div id="${prefix}LayersPanel" style="display:none;position:absolute;top:76px;left:16px;z-index:110;background:var(--bg1);border:1px solid var(--border2);border-radius:14px;padding:10px;width:200px;box-shadow:0 8px 24px rgba(0,0,0,.5)">
      <div style="font-size:11px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Map Style</div>
      <div style="display:flex;gap:5px;margin-bottom:10px;flex-wrap:wrap">
        ${['standard','terrain','satellite','hybrid'].map(s=>`<div onclick="_secondaryMapSetStyle('${prefix}','${s}')" style="flex:1 1 40%;padding:6px 4px;text-align:center;background:var(--bg2);border:1px solid var(--border2);border-radius:8px;font-size:10px;font-weight:700;color:var(--txt1);cursor:pointer;text-transform:capitalize">${s}</div>`).join('')}
      </div>
      <div style="font-size:11px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Boundaries</div>
      ${[['blm','BLM Land','#D4A843'],['nationalForest','National Forest','#4A7C59'],['stateParks','State Parks','#4A9EF5'],['countylines','County Lines','rgba(255,255,255,.5)'],['privateland','Private Land','#E8453C']].map(([id,label,color])=>`
        <div onclick="_toggleSecondaryLandLayer('${prefix}','${id}',this)" data-layer="${id}" style="display:flex;align-items:center;gap:8px;padding:6px 2px;cursor:pointer">
          <div style="width:10px;height:10px;border-radius:2px;background:${color};flex-shrink:0"></div>
          <span style="font-size:12px;color:var(--txt1);flex:1">${label}</span>
          <div class="side-layer-toggle off" style="transform:scale(.75);transform-origin:right center"><div class="side-layer-knob"></div></div>
        </div>`).join('')}
    </div>
    <div id="${prefix}RightStack" style="position:absolute;bottom:20px;right:16px;z-index:100;display:flex;flex-direction:column-reverse;align-items:center;gap:10px">
      <div id="${prefix}CompassOverlay" onclick="_secondaryMaps['${prefix}']?.easeTo({bearing:0,duration:500})" style="width:44px;height:44px;border-radius:50%;background:rgba(0,0,0,.45);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.35)">
        <svg viewBox="0 0 32 32" width="24" height="24"><circle cx="16" cy="16" r="15" fill="rgba(22,19,16,.7)" stroke="rgba(196,149,106,.4)" stroke-width="1"/>
          <g id="${prefix}CompassNeedle" style="transform-origin:16px 16px;transition:transform .15s linear">
            <polygon points="16,6 18.5,16 16,18 13.5,16" fill="#e05252"/>
            <polygon points="16,18 18.5,16 16,26 13.5,16" fill="rgba(200,184,168,.6)"/>
          </g>
        </svg>
      </div>
    </div>
  `;
}

const _secondaryMaps={}; // prefix -> Mapbox instance
const _secondaryMapStyleState={};

function _decorateSecondaryMap(prefix,m,container,pinFilterFn,onPinClick){
  _secondaryMaps[prefix]=m;
  _secondaryMapStyleState[prefix]='standard';
  // Inject controls into the container's parent (sibling of the map div)
  const controlsHost=document.createElement('div');
  controlsHost.style.cssText='position:absolute;inset:0;pointer-events:none;z-index:50';
  controlsHost.innerHTML=_secondaryMapControlsHTML(prefix);
  [...controlsHost.children].forEach(c=>c.style.pointerEvents='auto');
  container.parentElement.appendChild(controlsHost);
  m.on('rotate',()=>{
    const needle=document.getElementById(prefix+'CompassNeedle');
    if(needle)needle.style.transform=`rotate(${-m.getBearing()}deg)`;
  });
  // Boundary layers — reuse already-cached GeoJSON, no re-fetch
  Object.entries(LAND_STYLES).forEach(([type,sty])=>{
    const empty={type:'FeatureCollection',features:[]};
    if(!m.getSource('land-'+type))m.addSource('land-'+type,{type:'geojson',data:empty});
    if(!m.getLayer('land-'+type+'-fill'))m.addLayer({id:'land-'+type+'-fill',type:'fill',source:'land-'+type,layout:{visibility:'none'},paint:{'fill-color':sty.fillColor,'fill-opacity':sty.fillOpacity}});
    if(!m.getLayer('land-'+type+'-line'))m.addLayer({id:'land-'+type+'-line',type:'line',source:'land-'+type,layout:{visibility:'none'},paint:{'line-color':sty.color,'line-width':sty.width}});
  });
  _initLongPressPin(m);
  _refreshSecondaryMapPins(prefix,m,pinFilterFn,onPinClick);
}

function _refreshSecondaryMapPins(prefix,m,pinFilterFn,onPinClick){
  if(!m)return;
  const pins=pinFilterFn();
  (m._secondaryMarkers||[]).forEach(mk=>{try{mk.remove();}catch(e){}});
  m._secondaryMarkers=[];
  pins.forEach(p=>{
    const el=document.createElement('div');
    el.style.cssText=`width:16px;height:16px;border-radius:50%;background:${p.color};border:2px solid #fff;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.4)`;
    const marker=new mapboxgl.Marker({element:el}).setLngLat([p.lng,p.lat]).addTo(m);
    el.onclick=()=>{if(onPinClick)onPinClick(p);else openDetail(p.id);};
    m._secondaryMarkers.push(marker);
  });
  if(pins.length>1){
    const lngs=pins.map(p=>p.lng),lats=pins.map(p=>p.lat);
    m.fitBounds([[Math.min(...lngs)-.3,Math.min(...lats)-.3],[Math.max(...lngs)+.3,Math.max(...lats)+.3]],{padding:60,duration:600,maxZoom:11});
  } else if(pins.length===1){
    m.flyTo({center:[pins[0].lng,pins[0].lat],zoom:11,duration:600});
  }
}

function _secondaryMapSetStyle(prefix,styleKey){
  const m=_secondaryMaps[prefix];
  if(!m||!MAP_STYLES[styleKey])return;
  _secondaryMapStyleState[prefix]=styleKey;
  m.setStyle(MAP_STYLES[styleKey].url);
  m.once('style.load',()=>{
    Object.entries(LAND_STYLES).forEach(([type,sty])=>{
      const empty={type:'FeatureCollection',features:[]};
      if(!m.getSource('land-'+type))m.addSource('land-'+type,{type:'geojson',data:empty});
      if(!m.getLayer('land-'+type+'-fill'))m.addLayer({id:'land-'+type+'-fill',type:'fill',source:'land-'+type,layout:{visibility:'none'},paint:{'fill-color':sty.fillColor,'fill-opacity':sty.fillOpacity}});
      if(!m.getLayer('land-'+type+'-line'))m.addLayer({id:'land-'+type+'-line',type:'line',source:'land-'+type,layout:{visibility:'none'},paint:{'line-color':sty.color,'line-width':sty.width}});
    });
  });
  document.getElementById(prefix+'LayersPanel').style.display='none';
}

function _toggleSecondaryLayers(prefix){
  const panel=document.getElementById(prefix+'LayersPanel');
  if(panel)panel.style.display=panel.style.display==='none'?'block':'none';
}

function _toggleSecondaryLandLayer(prefix,layerId,rowEl){
  const m=_secondaryMaps[prefix];
  if(!m)return;
  const toggleEl=rowEl.querySelector('.side-layer-toggle');
  const isOn=toggleEl.classList.contains('on');
  const dataMap={blm:_blmGeoJSON,nationalForest:_nfGeoJSON,stateParks:_spGeoJSON};
  const geo=dataMap[layerId];
  if(!isOn&&geo){
    const src=m.getSource('land-'+layerId);
    if(src)src.setData(geo);
    if(m.getLayer('land-'+layerId+'-fill'))m.setLayoutProperty('land-'+layerId+'-fill','visibility','visible');
    if(m.getLayer('land-'+layerId+'-line'))m.setLayoutProperty('land-'+layerId+'-line','visibility','visible');
    toggleEl.classList.add('on');toggleEl.classList.remove('off');
  } else if(!isOn){
    showToast('Boundary data not loaded yet — open the main Map tab first');
  } else {
    if(m.getLayer('land-'+layerId+'-fill'))m.setLayoutProperty('land-'+layerId+'-fill','visibility','none');
    if(m.getLayer('land-'+layerId+'-line'))m.setLayoutProperty('land-'+layerId+'-line','visibility','none');
    toggleEl.classList.remove('on');toggleEl.classList.add('off');
  }
}

let _secondaryMapSearchTimer=null;
function _secondaryMapSearch(prefix,q){
  clearTimeout(_secondaryMapSearchTimer);
  const drop=document.getElementById(prefix+'SearchDrop');
  if(!q.trim()){if(drop)drop.style.display='none';return;}
  _secondaryMapSearchTimer=setTimeout(async()=>{
    try{
      const res=await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6`,{headers:{'Accept-Language':'en-US,en'}});
      const data=await res.json();
      if(!drop)return;
      if(!data.length){drop.style.display='none';return;}
      drop.innerHTML=data.map(d=>`<div onclick="_secondaryMapFlyTo('${prefix}',${d.lat},${d.lon});document.getElementById('${prefix}SearchDrop').style.display='none';document.getElementById('${prefix}SearchInput').value=''" style="padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer;font-size:13px;color:var(--txt0)">${sanitize((d.display_name||'').split(',').slice(0,2).join(', '))}</div>`).join('');
      drop.style.display='block';
    }catch(e){}
  },350);
}
function _secondaryMapFlyTo(prefix,lat,lng){
  const m=_secondaryMaps[prefix];
  if(m)m.flyTo({center:[lng,lat],zoom:13,duration:800});
}

function openProfileYourMap(){

  const page=document.getElementById('yourMapPage');
  if(!page)return;
  page.style.display='flex';
  _buildYourMap();
}
// Deterministic per-community pin color (hash id -> hue)
function _communityColor(cid){
  let h=0; for(let i=0;i<String(cid).length;i++)h=(h*31+String(cid).charCodeAt(i))>>>0;
  return `hsl(${h%360},65%,58%)`;
}

function _yourMapPinFilter(){
  const myUid=String(_myUid());
  const savedIds=new Set(getSavedSpotIds());
  const allGlobal=[...spots,...userSpots];
  const pins=[];
  // Personal spots — gold
  personalSpots.forEach(s=>pins.push({id:s.id,name:s.name,lat:s.lat,lng:s.lng,color:'#D4A843'}));
  // Saved spots (any type) — red
  savedPlaces.forEach(p=>pins.push({id:'saved_'+p.id,name:p.name,lat:p.lat,lng:p.lng,color:'#E05252'}));
  allGlobal.filter(s=>savedIds.has(s.id)).forEach(s=>pins.push({id:s.id,name:s.name,lat:s.lat,lng:s.lng,color:'#E05252'}));
  // Community spots from communities the user belongs to — community color
  getCommunities().filter(c=>getMembers(c.id).includes(myUid)).forEach(c=>{
    getCommunitySpots(c.id).forEach(s=>{
      if(s.lat&&s.lng)pins.push({id:s.id,name:s.name,lat:s.lat,lng:s.lng,color:_communityColor(c.id)});
    });
  });
  return pins;
}

function _buildYourMap(){
  const container=document.getElementById('yourMapEl');
  if(!container)return;
  if(container._mapInst){try{container._mapInst.remove();}catch(e){}container._mapInst=null;container.innerHTML='';}
  const parent=container.parentElement;
  [...parent.children].forEach(c=>{if(c!==container)c.remove();}); // clear previously injected controls on rebuild
  try{
    const m=new mapboxgl.Map({container,style:MAP_STYLES.standard.url,center:[-121.5,38.5],zoom:6,interactive:true,attributionControl:false});
    container._mapInst=m;
    m.on('load',()=>{
      _decorateSecondaryMap('ym',m,container,_yourMapPinFilter,(p)=>{
        const spot=[...spots,...userSpots,...personalSpots].find(s=>String(s.id)===String(p.id));
        if(spot)openDetail(spot.id);
      });
    });
  }catch(e){console.warn('Your map failed',e);}
}

function openFriendsMap(){
  const page=document.getElementById('friendsMapPage');
  if(!page)return;
  // Rebuild every open so new follows/spots appear
  const fmEl=document.getElementById('friendsMapEl');
  if(fmEl){fmEl._mapInit=false;if(fmEl._mapInst){try{fmEl._mapInst.remove();}catch(e){}}fmEl._mapInst=null;fmEl.innerHTML='';}
  page.style.display='flex';
  _buildFriendsMap();
}
function _buildFriendsMap(){
  const container=document.getElementById('friendsMapEl');
  if(!container)return;
  const myUid=String(_myUid());
  const follows=getFollows();
  const followingIds=new Set(follows[myUid]||[]);
  const followingUsers=Array.from(followingIds);
  const allPosts=getPosts();
  const allS=[...spots,...userSpots];
  // Build legend: "You" dot + friends
  const legend=document.getElementById('friendsMapLegend');
  if(legend){
    const youEntry=`<div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
      <div style="width:14px;height:14px;border-radius:50%;background:#F5C842;border:2px solid #fff;flex-shrink:0"></div>
      <span style="font-size:12px;color:var(--txt0)">You</span>
    </div>`;
    const friendEntries=followingUsers.map(uid=>{
      const p=getUserProfile(uid)||{};
      const name=p.username||uid;
      return`<div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <div style="width:28px;height:28px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#B8E87A">${name.slice(0,2).toUpperCase()}</div>
        <span style="font-size:12px;color:var(--txt0)">@${name}</span>
      </div>`;
    });
    const sep='<div style="width:1px;height:20px;background:var(--border);flex-shrink:0"></div>';
    legend.innerHTML=youEntry+(followingUsers.length?sep+friendEntries.join(sep):'<span style="font-size:12px;color:var(--txt3);margin-left:8px">Follow people to see their spots</span>');
  }
  if(container._mapInit)return;
  container._mapInit=true;
  try{
    const m=new mapboxgl.Map({container,style:MAP_STYLES.standard.url,center:[-121.5,38.5],zoom:6,interactive:true,attributionControl:false});
    container._mapInst=m;
    m.on('load',()=>{
      // Standard reusable controls: search, boundary layers, compass, zoom, long-press
      const friendsPinFilter=()=>{
        const myPostsF=allPosts.filter(p=>String(p.userId)===myUid&&p.spotId);
        const visitedIdsF=new Set(myPostsF.map(p=>p.spotId));
        const mySavedF=getSavedSpotIds();
        const myVisitedF=[...allS.filter(s=>visitedIdsF.has(s.id)||mySavedF.includes(s.id)),...userSpots.filter(s=>s.userSubmitted)];
        const uniq=new Map();myVisitedF.forEach(s=>uniq.set(s.id,{id:s.id,name:s.name,lat:s.lat,lng:s.lng,color:'#F5C842'}));
        // Spots posted about or saved by people I follow
        followingUsers.forEach(uid=>{
          allPosts.filter(p=>String(p.userId)===uid&&p.spotId).forEach(p=>{
            const s=allS.find(x=>x.id===p.spotId);
            if(s&&!uniq.has(s.id))uniq.set(s.id,{id:s.id,name:s.name,lat:s.lat,lng:s.lng,color:'#B8E87A'});
          });
        });
        return[...uniq.values()];
      };
      _decorateSecondaryMap('fm',m,container,friendsPinFilter,(p)=>{
        const spot=[...spots,...userSpots].find(s=>String(s.id)===String(p.id));
        if(spot)openDetail(spot.id);
      });

      // ── FRIENDS spots (initials bubbles — tap to open profile) ──
      let hasFriendPins=false;
      const seenFriendMarkers=new Map(); // uid → marker, so each friend only gets one pin
      followingUsers.forEach(uid=>{
        const prof=getUserProfile(uid)||{};
        const name=prof.username||('user'+uid);
        const friendPosts=allPosts.filter(p=>String(p.userId)===uid&&(p.lat||p.spotId));
        friendPosts.forEach(p=>{
          let lat=p.lat,lng=p.lng;
          if(!lat&&p.spotId){const s=allS.find(x=>x.id===p.spotId);if(s){lat=s.lat;lng=s.lng;}}
          if(!lat||!lng)return;
          hasFriendPins=true;
          const el=document.createElement('div');
          el.style.cssText='width:34px;height:34px;border-radius:50%;background:#B8E87A;border:2.5px solid #fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#0f1a0a;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.4);transition:transform .15s';
          el.textContent=name.slice(0,2).toUpperCase();
          // Tap opens profile sheet
          el.addEventListener('click',()=>{
            el.style.transform='scale(1.15)';
            setTimeout(()=>{el.style.transform='';},150);
            _openUserProfileSheet(uid,name);
          });
          el.addEventListener('mouseenter',()=>el.style.transform='scale(1.1)');
          el.addEventListener('mouseleave',()=>el.style.transform='');
          new mapboxgl.Marker({element:el}).setLngLat([lng,lat]).addTo(m);
          seenFriendMarkers.set(uid,true);
        });
        // Real-time location dot — also tappable for profile
        const locData=localStorage.getItem('wildpath-user-location-'+uid);
        if(locData){
          try{
            const loc=JSON.parse(locData);
            if(Date.now()-loc.ts<3600000){
              hasFriendPins=true;
              const dotEl=document.createElement('div');
              dotEl.style.cssText='width:34px;height:34px;border-radius:50%;background:#B8E87A;border:2.5px solid #fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#0f1a0a;cursor:pointer;box-shadow:0 0 0 6px rgba(184,232,122,.25)';
              dotEl.textContent=name.slice(0,2).toUpperCase();
              dotEl.addEventListener('click',()=>_openUserProfileSheet(uid,name));
              new mapboxgl.Marker({element:dotEl}).setLngLat([loc.lng,loc.lat]).addTo(m);
            }
          }catch(e){}
        }
      });

      // ── DEMO: show community-recommended spots when no friends yet ──
      if(!hasFriendPins){
        spots.forEach((s,i)=>{
          const demoNames=['Ranger','Hiker','Explorer','Scout','Trailhead'];
          const colors=['#B8E87A','#74C4F5','#F5A623','#C47AE8','#F5C842'];
          const el=document.createElement('div');
          el.style.cssText=`width:30px;height:30px;border-radius:50%;background:${colors[i%colors.length]};border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#0f1a0a;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.4)`;
          el.textContent=demoNames[i%demoNames.length].slice(0,2).toUpperCase();
          new mapboxgl.Marker({element:el}).setLngLat([s.lng,s.lat])
            .setPopup(new mapboxgl.Popup({offset:22}).setHTML(`<div style="font-size:12px;font-weight:700;color:#fff">${s.name}</div><div style="font-size:11px;color:rgba(255,255,255,.7);margin-top:2px">Community recommended</div>`))
            .addTo(m);
        });
        m.fitBounds([[-124,36],[-117,39]],{padding:40,duration:800});
      }
    });
  }catch(e){console.warn('Friends map error',e);}
}

function setFriendsMapStyle(style, btn){
  const container=document.getElementById('friendsMapEl');
  if(container&&container._mapInst){
    container._mapInst.setStyle('mapbox://styles/mapbox/'+style);
  }
  // Update button active states
  const bar=document.getElementById('friendsMapStyleBar');
  if(bar){
    bar.querySelectorAll('button').forEach(b=>{
      const isActive=b===btn;
      b.style.background=isActive?'rgba(255,255,255,.9)':'rgba(0,0,0,.45)';
      b.style.color=isActive?'#0f1a0a':'#fff';
      b.style.fontWeight=isActive?'700':'600';
      b.style.border=isActive?'none':'1px solid rgba(255,255,255,.2)';
    });
  }
}

function setYourMapStyle(style, btn){
  const container=document.getElementById('yourMapEl');
  if(container&&container._mapInst){
    container._mapInst.setStyle('mapbox://styles/mapbox/'+style);
  }
  // Update button active states
  const page=document.getElementById('yourMapPage');
  if(page){
    page.querySelectorAll('[onclick^="setYourMapStyle"]').forEach(b=>{
      const isActive=b===btn;
      b.style.background=isActive?'rgba(255,255,255,.9)':'rgba(0,0,0,.45)';
      b.style.color=isActive?'#0f1a0a':'#fff';
      b.style.fontWeight=isActive?'700':'600';
      b.style.border=isActive?'none':'1px solid rgba(255,255,255,.2)';
    });
  }
}

function openSavedLocations(){
  const saved=getSavedSpotIds();
  if(!saved.length){showToast('No saved spots yet — bookmark spots to save them');return;}
  const allS=[...spots,...userSpots].filter(s=>saved.includes(s.id));
  _showSpotListSheet('Saved Locations',allS);
}

function openSavedPostsPage(){
  const page=document.getElementById('savedPostsPage');
  if(!page)return;
  page.style.display='flex';
  _renderSavedSpotsSection();
  _renderSavedPostsGrid();
}
// The Saved page's spots list — resolves saved_spots ids (hydrated into
// getSavedSpotIds() by _sbLoadSaved) against every known spot source, so a
// spot saved anywhere in the app (main map, Your Map, Friends Map, a post)
// shows up here immediately.
function _renderSavedSpotsSection(){
  const section=document.getElementById('savedSpotsSection');
  if(!section)return;
  const ids=new Set(getSavedSpotIds().map(String));
  if(!ids.size){section.innerHTML='';return;}
  const commSpots=getAllCommunitySpots();
  const allS=[...spots,...userSpots,...personalSpots,...commSpots];
  const savedSpots=allS.filter(s=>ids.has(String(s.id)));
  section.innerHTML=`
    <div style="padding:14px 16px 4px;font-size:12px;font-weight:700;color:var(--txt3);letter-spacing:.4px;text-transform:uppercase">Saved Spots (${savedSpots.length})</div>
    ${savedSpots.map(s=>`
      <div onclick="document.getElementById('savedPostsPage').style.display='none';openDetail('${s.id}')" style="display:flex;align-items:center;gap:12px;padding:10px 16px;cursor:pointer;-webkit-tap-highlight-color:transparent">
        <div style="width:44px;height:44px;border-radius:10px;flex-shrink:0;background:${s.heroGradient||'linear-gradient(160deg,#0d1a0d,#1a3a2a)'};overflow:hidden">${s.photos&&s.photos[0]?`<img src="${s.photos[0]}" style="width:100%;height:100%;object-fit:cover">`:''}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:700;color:var(--txt0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${sanitize(s.name)}</div>
          <div style="font-size:12px;color:var(--txt3);margin-top:2px">${sanitize(s.typeLabel||s.type||'')}</div>
        </div>
        <div onclick="event.stopPropagation();unsaveSpot('${s.id}').then(()=>_renderSavedSpotsSection())" style="width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--accent)">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" stroke="none"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        </div>
      </div>`).join('')}
    ${savedSpots.length<ids.size?`<div style="padding:4px 16px 8px;font-size:11px;color:var(--txt3)">${ids.size-savedSpots.length} saved spot${ids.size-savedSpots.length!==1?'s':''} could not be found (may be from a different tier)</div>`:''}
  `;
}
function _renderSavedPostsGrid(){
  const folders=_getSavedFolders();
  const grid=document.getElementById('savedPostsGrid');
  if(!grid)return;
  const cnt=document.getElementById('profileSavedCount');
  const totalSaved=getSavedPostIds().length;
  if(cnt)cnt.textContent=totalSaved+' post'+(totalSaved!==1?'s':'');
  if(!folders.length){
    // Fallback: show flat grid if no folders
    const savedIds=getSavedPostIds();
    const allPosts=getPosts();
    const savedPosts=_feedPosts.filter(p=>savedIds.includes(p.id)).concat(allPosts.filter(p=>savedIds.includes(p.id)&&!_feedPosts.find(fp=>fp.id===p.id)));
    if(!savedPosts.length){grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--txt3);font-size:13px">No saved posts yet — tap the bookmark on any post</div>';return;}
    grid.innerHTML=savedPosts.map(p=>{
      const thumb=p.photos?.[0]||p.mediaUrl||'';
      const bg=p.spotGradient||p.heroGradient||'linear-gradient(160deg,#0d1a0d,#1a3a2a)';
      const isGrad=thumb&&thumb.startsWith('gradient:');
      const gradVal=isGrad?thumb.replace('gradient:',''):null;
      const innerHtml=isGrad?`<div style="width:100%;height:100%;background:${gradVal}"></div>`:(thumb?`<img src="${thumb}" style="width:100%;height:100%;object-fit:cover">`:'');
      return`<div onclick="openPostDetail('${p.id}')" style="aspect-ratio:1;position:relative;overflow:hidden;cursor:pointer;background:${bg}">${innerHtml}</div>`;
    }).join('');
    return;
  }
  // Show folder list view
  grid.style.display='flex';
  grid.style.flexDirection='column';
  grid.style.gap='0';
  grid.innerHTML=folders.map(f=>`
    <div onclick="openSavedFolder('${f.name.replace(/'/g,"\\'")}');this.closest('.saved-folders-list')?.scrollTo(0,0)" style="display:flex;align-items:center;gap:14px;padding:14px 0;border-bottom:1px solid var(--border);cursor:pointer;-webkit-tap-highlight-color:transparent">
      <div style="width:52px;height:52px;border-radius:14px;background:var(--bg3);display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="var(--accent)" stroke-width="1.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:700;color:var(--txt0)">${sanitize(f.name)}</div>
        <div style="font-size:12px;color:var(--txt3);margin-top:2px">${f.postIds.length} post${f.postIds.length!==1?'s':''}</div>
      </div>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--txt3)" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    </div>`).join('');
}
function _openSavedPostDetail(postId){
  const p=_feedPosts.find(x=>x.id===postId)||getPosts().find(x=>x.id===postId);
  if(!p)return;
  if(p.spotId)openDetail(p.spotId);
  else openPostDetail(postId);
}
function setSavedView(view,el){
  document.getElementById('savedTabGrid').style.cssText='padding:6px 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;background:'+(view==='grid'?'var(--accent)':'var(--bg2)')+';color:'+(view==='grid'?'#0f1a0a':'var(--txt2)');
  document.getElementById('savedTabMap').style.cssText='padding:6px 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;background:'+(view==='map'?'var(--accent)':'var(--bg2)')+';color:'+(view==='map'?'#0f1a0a':'var(--txt2)');
  document.getElementById('savedPostsGrid').style.display=view==='grid'?'grid':'none';
  const mapEl=document.getElementById('savedPostsMap');
  if(mapEl){mapEl.style.display=view==='map'?'flex':'none';}
  if(view==='map')_initSavedPostsMap();
}
function _initSavedPostsMap(){
  const container=document.getElementById('savedPostsMapEl');
  if(!container||container._mapInit)return;
  container._mapInit=true;
  // Reuse the app-wide mapboxgl.accessToken — never a separate check or prompt
  const savedIds=getSavedPostIds();
  const posts=_feedPosts.filter(p=>savedIds.includes(p.id)&&p.lat&&p.lng);
  try{
    const m=new mapboxgl.Map({container,style:'mapbox://styles/mapbox/dark-v11',center:[-121.5,38.5],zoom:5,interactive:true,attributionControl:false});
    m.on('load',()=>{
      posts.forEach(p=>{
        const el=document.createElement('div');
        el.style.cssText='width:32px;height:32px;border-radius:50%;overflow:hidden;border:2px solid #B8E87A;cursor:pointer';
        const thumb=p.photos?.[0]||p.mediaUrl||'';
        const isGrad=thumb&&thumb.startsWith('gradient:');
        el.innerHTML=(thumb&&!isGrad)?`<img src="${thumb}" style="width:100%;height:100%;object-fit:cover">`:`<div style="width:100%;height:100%;background:${isGrad?thumb.replace('gradient:',''):p.spotGradient||'var(--bg3)'}"></div>`;
        el.onclick=()=>_openSavedPostDetail(p.id);
        new mapboxgl.Marker({element:el}).setLngLat([p.lng,p.lat]).addTo(m);
      });
    });
  }catch(e){}
}

function openWantToGoList(){
  const pinned=JSON.parse(localStorage.getItem('wp_want_to_go')||'[]');
  if(!pinned.length){showToast('No pinned spots yet — add spots to your want-to-go list');return;}
  const allS=[...spots,...userSpots].filter(s=>pinned.includes(s.id));
  _showSpotListSheet('Want to Go',allS);
}

function _showSpotListSheet(title,spotList){
  // Create an overlay sheet showing a list of spots
  const existing=document.getElementById('_spotListSheet');
  if(existing)existing.remove();
  const sheet=document.createElement('div');
  sheet.id='_spotListSheet';
  sheet.style.cssText='position:absolute;inset:0;z-index:800;background:rgba(0,0,0,.75);display:flex;align-items:flex-end';
  sheet.onclick=(e)=>{if(e.target===sheet)sheet.remove();};
  const inner=document.createElement('div');
  inner.style.cssText='background:var(--bg1);border-radius:20px 20px 0 0;width:100%;max-height:75vh;overflow-y:auto;padding:0 0 calc(env(safe-area-inset-bottom,0px)+16px)';
  inner.innerHTML=`
    <div style="padding:16px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
      <div style="font-size:16px;font-weight:700;color:var(--txt0)">${title}</div>
      <button onclick="document.getElementById('_spotListSheet').remove()" style="background:var(--bg2);border:1px solid var(--border);color:var(--txt1);border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:14px">×</button>
    </div>
    ${spotList.length?spotList.map(s=>`
      <div onclick="openDetail('${s.id}');document.getElementById('_spotListSheet')?.remove()" style="padding:12px 14px;border-bottom:1px solid var(--border);cursor:pointer;display:flex;gap:12px;align-items:center">
        <div style="width:52px;height:52px;border-radius:12px;background:${s.heroGradient||'var(--bg3)'};flex-shrink:0"></div>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:700;color:var(--txt0)">${s.name}</div>
          <div style="font-size:12px;color:var(--txt3);margin-top:2px">${s.typeLabel||''} · ${s._realDistStr||s.distance||''}</div>
          <div style="font-size:11px;color:var(--txt3)">${s.rating} · ${s.reviews} reviews</div>
        </div>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--txt3)" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>`).join('')
    :`<div style="padding:32px;text-align:center;color:var(--txt3);font-size:13px">No spots yet.</div>`}
  `;
  sheet.appendChild(inner);
  document.getElementById('app').appendChild(sheet);
}

// ═══════════════════════════════════════════════════
// OPEN COMMUNITY POST — tap on post in profile grid
// ═══════════════════════════════════════════════════
function openCommPost(postId){
  openPostDetail(postId);
}

// ═══════════════════════════════════════════════════
// DETAIL PAGE — DRAG TO DISMISS
// ═══════════════════════════════════════════════════
let _detailDragStartY=0, _detailDragActive=false, _detailDragDismissThreshold=120;

function _initDetailDragToDismiss(){
  const handle=document.getElementById('detailDragHandle');
  const sheet=document.getElementById('detailSheet');
  if(!handle||!sheet||handle._dragInited)return;
  handle._dragInited=true;

  handle.addEventListener('touchstart',(e)=>{
    _detailDragStartY=e.touches[0].clientY;
    _detailDragActive=true;
    sheet.style.transition='none';
  },{passive:true});

  handle.addEventListener('touchmove',(e)=>{
    if(!_detailDragActive)return;
    const dy=e.touches[0].clientY-_detailDragStartY;
    if(dy>0){sheet.style.transform=`translateY(${dy}px)`;}
  },{passive:true});

  handle.addEventListener('touchend',(e)=>{
    if(!_detailDragActive)return;
    _detailDragActive=false;
    const dy=e.changedTouches[0].clientY-_detailDragStartY;
    if(dy>_detailDragDismissThreshold){
      closeDetail();
    } else {
      sheet.style.transition='transform 0.3s cubic-bezier(0.32,0.72,0,1)';
      sheet.style.transform='translateY(0)';
    }
  },{passive:true});
}

// ═══════════════════════════════════════════════════
// CONTENT CREATION — REDESIGNED FORM OVERLAY
// ═══════════════════════════════════════════════════
let _createCapturedDataUrl=null, _createCapturedBlob=null;
let _createNewSelectedSpotId=null, _createNewPrivacy='public';
let _createAdvancedOpen=false;
// Legacy vars kept so old refs don't throw
let _createStream=null, _createFacingMode='environment', _createType='photo';
let _createIsRecording=false, _createMediaRecorder=null, _createChunks=[];

function openFeedCreate(){
  if(isGuest()){showLoginScreen();return;}
  const ov=document.getElementById('feedCreateOverlay');
  if(!ov)return;
  ov.style.display='flex';
  // Reset all fields
  _createCapturedDataUrl=null;
  _createCapturedBlob=null;
  _createNewSelectedSpotId=null;
  _createNewPrivacy='public';
  _createAdvancedOpen=false;
  // Media placeholder
  const placeholder=document.getElementById('createMediaPlaceholder');
  const prevImg=document.getElementById('createNewPreviewImg');
  const prevVid=document.getElementById('createNewPreviewVid');
  const removeBtn=document.getElementById('createMediaRemoveBtn');
  if(placeholder)placeholder.style.display='flex';
  if(prevImg){prevImg.style.display='none';prevImg.src='';}
  if(prevVid){prevVid.style.display='none';prevVid.src='';}
  if(removeBtn)removeBtn.style.display='none';
  // Caption
  const cap=document.getElementById('createNewCaption');
  if(cap)cap.value='';
  const remain=document.getElementById('createCharRemain');
  if(remain)remain.textContent='500';
  // Location
  clearCreateLocationNew();
  // Own comment
  const comm=document.getElementById('createNewOwnComment');
  if(comm)comm.value='';
  // Privacy — default Public selected
  setCreateNewPrivacy('public',document.getElementById('createNewPrivPublic'));
  // Advanced closed
  const adv=document.getElementById('createAdvancedContent');
  const chev=document.getElementById('createAdvancedChevron');
  if(adv)adv.style.display='none';
  if(chev)chev.style.transform='rotate(0deg)';
  // Post button disabled
  _updateCreatePostBtn();
  // Hide success anim
  const succ=document.getElementById('createSuccessAnim');
  if(succ)succ.style.display='none';
  // Reset file inputs
  const lib=document.getElementById('createLibraryInput');
  if(lib)lib.value='';
}

function closeFeedCreate(){
  const ov=document.getElementById('feedCreateOverlay');
  if(ov)ov.style.display='none';
  _clearCreateCamUI(); // stop any live camera stream and remove DOM elements
}

// Legacy compat stubs
function _stopCreateCamera(){if(_createStream){_createStream.getTracks().forEach(t=>t.stop());_createStream=null;}}
function _startCreateCamera(){}
function setCreateTab(){}
function flipCreateCamera(){}
function createCapture(){document.getElementById('createLibraryInput')?.click();}
function handleCreateFile(e){handleCreateNewFile(e);}
function closeFeedCreatePreview(){closeFeedCreate();}
function setCreatePrivacy(type,el){setCreateNewPrivacy(type,el);}
function filterCreateLocation(q){filterCreateLocationNew(q);}
function clearCreateLocation(){clearCreateLocationNew();}
function _selectCreateLocation(id,name){_selectCreateLocationNew(id,name);}
function submitCreatePost(){submitCreateNewPost();}

// ── New create overlay functions ──

function _updateCreatePostBtn(){
  const btn=document.getElementById('createNewPostBtn');
  if(!btn)return;
  const hasMedia=!!_createCapturedDataUrl;
  btn.disabled=!hasMedia;
  btn.style.opacity=hasMedia?'1':'0.35';
  btn.style.cursor=hasMedia?'pointer':'not-allowed';
}

function createTakePhotoDemo(){
  // Try live camera via getUserMedia first
  if(navigator.mediaDevices && navigator.mediaDevices.getUserMedia){
    navigator.mediaDevices.getUserMedia({video:{facingMode:_createFacingMode},audio:false})
      .then(stream=>{ _startCreateLiveCamera(stream); })
      .catch(()=>{
        // getUserMedia denied or unavailable — try capture= file input (mobile native camera)
        const cap=document.getElementById('createCameraCapture');
        if(cap){ cap.click(); }
      });
  } else {
    // No getUserMedia at all — try capture= file input
    const cap=document.getElementById('createCameraCapture');
    if(cap){ cap.click(); }
  }
}

function _startCreateLiveCamera(stream){
  _createStream=stream;
  const area=document.getElementById('createMediaArea');
  if(!area)return;
  // Hide placeholder
  const ph=document.getElementById('createMediaPlaceholder');
  if(ph) ph.style.display='none';

  // Create live video element
  const vid=document.createElement('video');
  vid.id='createLiveVid';
  vid.autoplay=true;
  vid.playsInline=true;
  vid.muted=true;
  vid.srcObject=stream;
  vid.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:14px;';
  area.appendChild(vid);

  // Camera UI overlay: cancel | shutter | flip
  const ui=document.createElement('div');
  ui.id='createCamUI';
  ui.style.cssText='position:absolute;bottom:14px;left:0;right:0;display:flex;align-items:center;justify-content:space-between;padding:0 24px;z-index:10;';
  ui.innerHTML=`
    <button onclick="_cancelCreateLiveCam()" style="background:rgba(0,0,0,.55);border:none;border-radius:50%;width:40px;height:40px;display:flex;align-items:center;justify-content:center;cursor:pointer;">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="2.2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
    <button onclick="_captureCreateFrame()" style="background:#fff;border:3px solid rgba(255,255,255,.6);border-radius:50%;width:64px;height:64px;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 0 0 4px rgba(255,255,255,.2);">
      <div style="width:52px;height:52px;border-radius:50%;background:#fff;"></div>
    </button>
    <button onclick="_flipCreateLiveCam()" style="background:rgba(0,0,0,.55);border:none;border-radius:50%;width:40px;height:40px;display:flex;align-items:center;justify-content:center;cursor:pointer;">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="2"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
    </button>`;
  area.appendChild(ui);
}

function _captureCreateFrame(){
  const vid=document.getElementById('createLiveVid');
  if(!vid)return;
  const canvas=document.createElement('canvas');
  canvas.width=vid.videoWidth||600;
  canvas.height=vid.videoHeight||600;
  canvas.getContext('2d').drawImage(vid,0,0,canvas.width,canvas.height);
  _clearCreateCamUI();
  _createCapturedDataUrl=canvas.toDataURL('image/jpeg',0.92);
  _createCapturedBlob=null;
  _showCreateNewPreview(_createCapturedDataUrl,false);
  _updateCreatePostBtn();
}

function _cancelCreateLiveCam(){
  _clearCreateCamUI();
  const ph=document.getElementById('createMediaPlaceholder');
  if(ph) ph.style.display='flex';
}

function _flipCreateLiveCam(){
  _clearCreateCamUI();
  _createFacingMode=(_createFacingMode==='environment')?'user':'environment';
  if(navigator.mediaDevices && navigator.mediaDevices.getUserMedia){
    navigator.mediaDevices.getUserMedia({video:{facingMode:_createFacingMode},audio:false})
      .then(stream=>{ _createStream=stream; _startCreateLiveCamera(stream); })
      .catch(()=>{ const ph=document.getElementById('createMediaPlaceholder'); if(ph)ph.style.display='flex'; });
  }
}

function _clearCreateCamUI(){
  if(_createStream){
    _createStream.getTracks().forEach(t=>t.stop());
    _createStream=null;
  }
  const vid=document.getElementById('createLiveVid');
  const ui=document.getElementById('createCamUI');
  if(vid) vid.remove();
  if(ui) ui.remove();
}

function handleCreateNewFile(event){
  const file=event.target.files?.[0];
  if(!file)return;
  const isVideo=file.type.startsWith('video');
  const done=dataUrl=>{
    _createCapturedDataUrl=dataUrl;
    _createCapturedBlob=file;
    _showCreateNewPreview(dataUrl, isVideo);
    _updateCreatePostBtn();
  };
  if(isVideo){
    const reader=new FileReader();
    reader.onload=e=>done(e.target.result);
    reader.readAsDataURL(file);
  } else {
    compressImage(file).then(done).catch(()=>showToast('Could not read photo'));
  }
}

function _showCreateNewPreview(dataUrl, isVideo){
  const placeholder=document.getElementById('createMediaPlaceholder');
  const prevImg=document.getElementById('createNewPreviewImg');
  const prevVid=document.getElementById('createNewPreviewVid');
  const removeBtn=document.getElementById('createMediaRemoveBtn');
  if(placeholder)placeholder.style.display='none';
  if(isVideo){
    if(prevImg)prevImg.style.display='none';
    if(prevVid){prevVid.src=dataUrl;prevVid.style.display='block';}
  } else {
    if(prevVid)prevVid.style.display='none';
    if(prevImg){prevImg.src=dataUrl;prevImg.style.display='block';}
  }
  if(removeBtn)removeBtn.style.display='flex';
}

function clearCreateNewMedia(){
  _createCapturedDataUrl=null;
  _createCapturedBlob=null;
  const placeholder=document.getElementById('createMediaPlaceholder');
  const prevImg=document.getElementById('createNewPreviewImg');
  const prevVid=document.getElementById('createNewPreviewVid');
  const removeBtn=document.getElementById('createMediaRemoveBtn');
  if(placeholder)placeholder.style.display='flex';
  if(prevImg){prevImg.style.display='none';prevImg.src='';}
  if(prevVid){prevVid.style.display='none';prevVid.src='';}
  if(removeBtn)removeBtn.style.display='none';
  const lib=document.getElementById('createLibraryInput');
  if(lib)lib.value='';
  _updateCreatePostBtn();
}

function updateCreateCharCount(el){
  const remaining=500-(el.value||'').length;
  const span=document.getElementById('createCharRemain');
  if(span){span.textContent=remaining;span.style.color=remaining<50?'#ff6b6b':'var(--txt3)';}
}

let _createLocNominatimTimer=null;
function filterCreateLocationNew(query){
  const drop=document.getElementById('createNewLocationDrop');
  const clear=document.getElementById('createNewLocationClear');
  if(clear)clear.style.display=query?'block':'none';
  if(!drop)return;
  if(!query){drop.style.display='none';return;}

  // First show WildPath spots
  const allS=[...spots,...userSpots];
  const spotResults=allS.filter(s=>s.name.toLowerCase().includes(query.toLowerCase())).slice(0,5);
  const spotItems=spotResults.map(s=>
    `<div onclick="_selectCreateLocationNew('${s.id}','${s.name.replace(/'/g,"\\'")}')" style="padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer;display:flex;align-items:center;gap:10px;-webkit-tap-highlight-color:transparent">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="#B8E87A" style="flex-shrink:0"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
      <div><div style="font-size:13px;font-weight:600;color:var(--txt0)">${s.name}</div><div style="font-size:11px;color:var(--txt3)">${s.typeLabel||'WildPath Spot'}</div></div>
    </div>`
  ).join('');

  if(spotItems){drop.style.display='block';drop.innerHTML=spotItems;}

  // Then query Nominatim (debounced)
  clearTimeout(_createLocNominatimTimer);
  _createLocNominatimTimer=setTimeout(()=>{
    fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`,{headers:{'Accept-Language':'en'}})
      .then(r=>r.json())
      .then(results=>{
        if(!document.getElementById('createNewLocationInput')||document.getElementById('createNewLocationInput').value!==query)return;
        const nomItems=results.map(r=>{
          const displayName=r.display_name.split(',').slice(0,3).join(', ');
          return `<div onclick="_selectCreateLocationNew(null,'${displayName.replace(/'/g,"\\'")}')" style="padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer;display:flex;align-items:center;gap:10px;-webkit-tap-highlight-color:transparent">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="2" style="flex-shrink:0"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            <div style="font-size:13px;color:var(--txt1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${displayName}</div>
          </div>`;
        }).join('');
        if(nomItems){
          drop.style.display='block';
          drop.innerHTML=(spotItems||'')+nomItems;
        } else if(!spotItems){
          drop.style.display='none';
        }
      })
      .catch(()=>{
        drop.style.display='block';
        drop.innerHTML=(typeof spotItems!=='undefined'&&spotItems?spotItems:'')+'<div style="padding:10px 12px;font-size:11px;color:var(--txt3)">Place search unavailable — check connection</div>';
      });
  },350);
}

function _selectCreateLocationNew(spotId, name){
  _createNewSelectedSpotId=spotId;
  const drop=document.getElementById('createNewLocationDrop');
  const chosen=document.getElementById('createNewLocationChosen');
  const label=document.getElementById('createNewLocationLabel');
  const input=document.getElementById('createNewLocationInput');
  const clear=document.getElementById('createNewLocationClear');
  if(drop){drop.style.display='none';drop.innerHTML='';}
  if(input)input.value='';
  if(clear)clear.style.display='none';
  if(label)label.textContent=name;
  if(chosen)chosen.style.display='block';
}

function clearCreateLocationNew(){
  _createNewSelectedSpotId=null;
  const drop=document.getElementById('createNewLocationDrop');
  const chosen=document.getElementById('createNewLocationChosen');
  const input=document.getElementById('createNewLocationInput');
  const clear=document.getElementById('createNewLocationClear');
  if(drop){drop.style.display='none';drop.innerHTML='';}
  if(chosen)chosen.style.display='none';
  if(input)input.value='';
  if(clear)clear.style.display='none';
}

function setCreateNewPrivacy(type, el){
  _createNewPrivacy=type;
  [['createNewPrivPublic','public'],['createNewPrivCommunity','community'],['createNewPrivPrivate','private']].forEach(([id,t])=>{
    const tile=document.getElementById(id);
    if(!tile)return;
    const isSelected=t===type;
    tile.style.border=isSelected?'2px solid rgba(184,232,122,.7)':'2px solid var(--border2)';
    tile.style.background=isSelected?'rgba(184,232,122,.12)':'var(--bg2)';
    const label=tile.querySelector('div:last-child');
    if(label){label.style.color=isSelected?'#B8E87A':'var(--txt2)';label.style.fontWeight=isSelected?'700':'600';}
  });
}

function toggleCreateAdvanced(){
  _createAdvancedOpen=!_createAdvancedOpen;
  const adv=document.getElementById('createAdvancedContent');
  const chev=document.getElementById('createAdvancedChevron');
  if(adv)adv.style.display=_createAdvancedOpen?'flex':'none';
  if(chev)chev.style.transform=_createAdvancedOpen?'rotate(180deg)':'rotate(0deg)';
}

function submitCreateNewPost(){
  if(isGuest()){showLoginScreen();return;}
  if(!_createCapturedDataUrl){showToast('Please select media first');return;}

  const caption=(document.getElementById('createNewCaption')?.value||'').trim();
  const ownComment=(document.getElementById('createNewOwnComment')?.value||'').trim();
  const privacy=_createNewPrivacy||'public';
  const myUid=_myUid();
  const username=_currentUser?.username||'Explorer';

  const newPost={
    id:_uid(),
    userId:myUid,
    username,
    type:'photo',
    mediaUrl:_createCapturedDataUrl,
    caption,
    spotId:_createNewSelectedSpotId||null,
    privacy,
    likes:[],
    comments:ownComment?[{userId:myUid,username,text:ownComment,createdAt:new Date().toISOString()}]:[],
    createdAt:new Date().toISOString()
  };

  const posts=getPosts();
  posts.unshift(newPost);
  setPosts(posts);

  // Show success animation then return to feed
  const succ=document.getElementById('createSuccessAnim');
  const circle=document.getElementById('createSuccessCircle');
  const text=document.getElementById('createSuccessText');
  if(succ){
    succ.style.display='flex';
    setTimeout(()=>{if(circle)circle.style.transform='scale(1)';},30);
    setTimeout(()=>{if(text)text.style.opacity='1';},250);
    setTimeout(()=>{
      succ.style.display='none';
      closeFeedCreate();
      showTab('map');
    },1400);
  } else {
    closeFeedCreate();
    showTab('map');
  }
}

// ═══════════════════════════════════════════════════
// ACTIVITY / NOTIFICATIONS PAGE
// ═══════════════════════════════════════════════════
function openActivityPage(){
  const page=document.getElementById('feedActivityPage');
  if(!page)return;
  page.style.display='flex';
  // Hide badge
  const badge=document.getElementById('feedActivityBadge');
  if(badge)badge.style.display='none';
  _buildActivityList();
}

function closeFeedActivity(){
  const page=document.getElementById('feedActivityPage');
  if(page)page.style.display='none';
}

function _buildActivityList(){
  const list=document.getElementById('feedActivityList');
  if(!list)return;
  const myUid=String(_myUid());
  const posts=getPosts();
  const myPosts=posts.filter(p=>String(p.userId)===myUid);
  const events=[];

  // Collect likes on my posts
  myPosts.forEach(post=>{
    (post.likes||[]).forEach(uid=>{
      if(String(uid)===myUid)return;
      const profile=getUserProfile(uid)||{};
      events.push({type:'like',username:profile.username||'Someone',postCaption:post.caption||'your post',time:post.createdAt,avatar:profile.avatarUrl||null});
    });
  });

  // Collect comments on my posts — post-scoped, never spot-keyed
  myPosts.forEach(post=>{
    getComments(post.id).forEach(c=>{
      if(String(c.userId)===myUid)return;
      events.push({type:'comment',username:c.username||'Someone',text:c.text||'',time:c.createdAt||c.date,avatar:null});
    });
  });

  if(!events.length){
    list.innerHTML=`<div style="text-align:center;padding:60px 20px;color:var(--txt3)">
      
      <div style="font-size:15px;font-weight:700;color:var(--txt1)">No activity yet</div>
      <div style="font-size:13px;margin-top:6px;line-height:1.6">When someone likes or comments on your posts, it'll show up here.</div>
    </div>`;
    return;
  }

  list.innerHTML=events.map(ev=>{
    const initials=(ev.username||'?').slice(0,2).toUpperCase();
    const icon=ev.type==='like'
      ?`<svg viewBox="0 0 24 24" width="14" height="14" fill="#ff4d6d" stroke="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`
      :`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#B8E87A" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
    const desc=ev.type==='like'
      ?`liked your post${ev.postCaption?' "'+ev.postCaption.slice(0,30)+(ev.postCaption.length>30?'…':'')+'"':''}`
      :`commented: "${(ev.text||'').slice(0,40)}${(ev.text||'').length>40?'…':''}"`;
    return `<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid var(--border)">
      <div style="width:40px;height:40px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#B8E87A;flex-shrink:0">${initials}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;color:var(--txt0)"><strong>@${ev.username}</strong> ${desc}</div>
      </div>
      <div style="flex-shrink:0">${icon}</div>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════
// FEED SEND SHEET (DM a post)
// ═══════════════════════════════════════════════════
function openFeedSendSheet(){
  const sheet=document.getElementById('feedSendSheet');
  const inner=document.getElementById('feedSendSheetInner');
  if(!sheet||!inner)return;
  sheet.style.display='flex';
  inner.style.transition='none';
  inner.style.transform='translateY(100%)';
  requestAnimationFrame(()=>{
    inner.style.transition='transform 0.3s cubic-bezier(0.32,0.72,0,1)';
    requestAnimationFrame(()=>{inner.style.transform='translateY(0)';});
  });
  const searchInput=document.getElementById('feedSendSearchInput');
  if(searchInput){searchInput.value='';setTimeout(()=>searchInput.focus(),350);}
  filterFeedSendSearch('');
  // Drag-to-dismiss on the inner sheet
  _attachSendSheetDrag(inner,sheet);
}

function _attachSendSheetDrag(inner,sheet){
  if(inner._dragAttached)return;
  inner._dragAttached=true;
  let ty=0,sy=0,dragging=false;
  inner.addEventListener('touchstart',e=>{
    if(e.target.closest('input')||e.target.closest('#feedSendUserList'))return;
    dragging=true;sy=e.touches[0].clientY;ty=0;
    inner.style.transition='none';
  },{passive:true});
  inner.addEventListener('touchmove',e=>{
    if(!dragging)return;
    ty=Math.max(0,e.touches[0].clientY-sy);
    inner.style.transform='translateY('+ty+'px)';
  },{passive:true});
  inner.addEventListener('touchend',()=>{
    if(!dragging)return;dragging=false;
    if(ty>80){closeFeedSendSheet();}
    else{inner.style.transition='transform 0.25s cubic-bezier(0.32,0.72,0,1)';inner.style.transform='translateY(0)';}
  },{passive:true});
}

function closeFeedSendSheet(){
  const inner=document.getElementById('feedSendSheetInner');
  const sheet=document.getElementById('feedSendSheet');
  if(!inner||!sheet)return;
  inner.style.transition='transform 0.25s cubic-bezier(0.32,0.72,0,1)';
  inner.style.transform='translateY(100%)';
  setTimeout(()=>{sheet.style.display='none';_feedSendPostIdx=-1;},260);
}

function filterFeedSendSearch(query){
  const list=document.getElementById('feedSendUserList');
  if(!list)return;
  const myUid=String(_myUid());
  const colors=['#2d5a3a','#3a2d5a','#5a3a2d','#2d4a5a','#5a2d4a'];

  function userRow(uid,username,fullName,avatarUrl){
    const initials=(username||'??').slice(0,2).toUpperCase();
    const ci=(username||'').charCodeAt(0)%colors.length;
    const avatarContent=avatarUrl?`<img src="${avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:(initials);
    return `<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.06);-webkit-tap-highlight-color:transparent" onclick="sendFeedPostAsDm('${uid}')">
      <div style="width:40px;height:40px;border-radius:50%;background:${colors[ci]};display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;flex-shrink:0;overflow:hidden">${avatarContent}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:700;color:var(--txt0)">@${username||'Explorer'}</div>
        ${fullName?`<div style="font-size:12px;color:var(--txt3);margin-top:1px">${fullName}</div>`:''}
      </div>
      <div style="background:transparent;border:1.5px solid #B8E87A;border-radius:20px;padding:5px 14px;font-size:12px;font-weight:700;color:#B8E87A;flex-shrink:0">Send</div>
    </div>`;
  }

  if(query){
    // Search all users by username
    const allUsers=_getUsers()||[];
    const filtered=allUsers.filter(u=>String(u.id||u.uid)!==myUid&&(u.username||'').toLowerCase().includes(query.toLowerCase()));
    if(!filtered.length){
      list.innerHTML=`<div style="text-align:center;padding:40px 20px;color:var(--txt3);font-size:13px">No users found</div>`;
      return;
    }
    list.innerHTML=filtered.map(u=>userRow(u.id||u.uid||'',u.username,u.fullName,null)).join('');
  } else {
    // Show recent conversations as suggested recipients
    const msgs=getMessages();
    const convos=Object.entries(msgs).filter(([k])=>k.includes(myUid)).slice(0,8);
    if(convos.length){
      const header=`<div style="font-size:11px;font-weight:700;color:var(--txt3);letter-spacing:.5px;text-transform:uppercase;padding:10px 16px 4px">Recent</div>`;
      const allUsersMap={};(_getUsers()||[]).forEach(u=>{allUsersMap[String(u.id||u.uid)]=u;});
      list.innerHTML=header+convos.map(([key])=>{
        const otherUid=key.split('__').find(u=>u!==myUid)||key.split('__')[0];
        const pd=getUserProfile(otherUid)||{};
        const uu=allUsersMap[otherUid]||{};
        const username=pd.username||uu.username||otherUid||'Explorer';
        const fullName=pd.fullName||uu.fullName||'';
        return userRow(otherUid,username,fullName,pd.avatarUrl||null);
      }).join('');
    } else {
      // Fall back to showing all users
      const allUsers=(_getUsers()||[]).filter(u=>String(u.id||u.uid)!==myUid).slice(0,12);
      if(!allUsers.length){
        list.innerHTML=`<div style="text-align:center;padding:40px 20px;color:var(--txt3);font-size:13px">Search to find people</div>`;
        return;
      }
      const header=`<div style="font-size:11px;font-weight:700;color:var(--txt3);letter-spacing:.5px;text-transform:uppercase;padding:10px 16px 4px">People</div>`;
      list.innerHTML=header+allUsers.map(u=>userRow(u.id||u.uid||'',u.username,u.fullName||'',null)).join('');
    }
  }
}

function sendFeedPostAsDm(toUserId){
  if(isGuest()){showLoginScreen();return;}
  const post=_feedPosts[_feedSendPostIdx>=0?_feedSendPostIdx:_feedPostIdx];
  if(!post)return;
  const key=_dmConvKey(_myUid(),toUserId);
  const msgs=getMessages();
  if(!msgs[key])msgs[key]=[];
  // Send as post card (rich preview)
  const postCard={
    caption:(post.caption||'').slice(0,80)+(post.caption&&post.caption.length>80?'…':''),
    spotName:post.spotName||'',
    gradient:post.spotGradient||post.heroGradient||'linear-gradient(135deg,#1a3a2a,#2d4a3a)',
    mediaUrl:(post.photos&&post.photos[0])||post.mediaUrl||null,
    spotId:post.spotId||null
  };
  msgs[key].push({id:_uid(),fromId:_myUid(),postCard,time:new Date().toISOString()});
  setMessages(msgs);
  // Get recipient username for toast
  const pd=getUserProfile(toUserId)||{};
  const toName=pd.username||toUserId||'them';
  closeFeedSendSheet();
  // Checkmark toast
  showToast('Sent to @'+toName);
}

// ═══════════════════════════════════════════════════
// COMMUNITY LIST — pin left + 3-dot right
// ═══════════════════════════════════════════════════
// Override _buildCommunityList with pin+3-dot design
(function(){
  const _orig=window._buildCommunityList;
  window._buildCommunityList=function(){
    try {
      const listEl=document.getElementById('commListContent');
      if(!listEl)return;
      const comms=getCommunities();
      const pinned=JSON.parse(localStorage.getItem('wp_pinned_comms')||'[]');
      const sorted=[...comms].sort((a,b)=>{
        const ap=pinned.includes(a.id)?1:0, bp=pinned.includes(b.id)?1:0;
        if(ap!==bp)return bp-ap;
        return (b.memberCount||0)-(a.memberCount||0);
      });
      if(!sorted.length){
        listEl.innerHTML=`<div style="text-align:center;padding:56px 20px">
          <div style="font-size:14px;color:var(--txt3);margin-bottom:18px">No communities yet — be the first to create one</div>
          <button onclick="openCreateCommunity()" style="padding:12px 28px;background:var(--accent);border:none;border-radius:12px;color:#0f1a0a;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Create Community</button>
        </div>`;
        return;
      }
      listEl.innerHTML=sorted.map(c=>{
        const isPinned=pinned.includes(c.id);
        const since=c.createdAt?new Date(c.createdAt).getFullYear():'2024';
        const members=c.memberCount||(getMembers?.(c.id)||[]).length||0;
        const coverBg=c.coverColor||'linear-gradient(135deg,#1a2c1a,#2d4a2d)';
        return `<div style="display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px solid var(--border)">
          <!-- Pin icon on far LEFT -->
          <div onclick="event.stopPropagation();_togglePinComm('${c.id}')" style="flex-shrink:0;width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;background:${isPinned?'rgba(184,232,122,.15)':'transparent'}">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="${isPinned?'#B8E87A':'none'}" stroke="${isPinned?'#B8E87A':'var(--txt3)'}" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          </div>
          <!-- Cover thumbnail -->
          <div onclick="openCommunityDetail('${c.id}')" style="width:52px;height:52px;border-radius:10px;flex-shrink:0;overflow:hidden;background:${coverBg};cursor:pointer">
            ${c.coverUrl?`<img src="${c.coverUrl}" style="width:100%;height:100%;object-fit:cover">`:''}
          </div>
          <!-- Info -->
          <div onclick="openCommunityDetail('${c.id}')" style="flex:1;min-width:0;cursor:pointer">
            <div style="font-size:14px;font-weight:700;color:var(--txt0);line-height:1.3">
              ${c.name||'Community'}
              ${isPinned?'<svg viewBox="0 0 24 24" width="9" height="9" fill="var(--accent)" stroke="none" style="margin-left:4px;vertical-align:middle"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>':''}
            </div>
            <div style="font-size:12px;color:var(--txt3);margin-top:2px">${members.toLocaleString()} members · since ${since}</div>
          </div>
          <!-- Three-dot on far RIGHT -->
          <div onclick="event.stopPropagation();_commThreeDotMenu('${c.id}')" style="flex-shrink:0;width:34px;height:34px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;background:var(--bg2);border:1px solid var(--border2)">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="var(--txt2)"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
          </div>
        </div>`;
      }).join('');
    } catch(e) {
      console.error('Community screen error:', e);
    }
  };
})();

function _commThreeDotMenu(commId){
  const pinned=JSON.parse(localStorage.getItem('wp_pinned_comms')||'[]');
  const isPinned=pinned.includes(commId);
  const sheet=document.createElement('div');
  sheet.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.65);display:flex;align-items:flex-end';
  sheet.innerHTML=`<div style="width:100%;background:var(--bg1);border-radius:20px 20px 0 0;padding:14px 0 calc(env(safe-area-inset-bottom,0px)+14px)">
    <div style="width:36px;height:4px;background:var(--border2);border-radius:2px;margin:0 auto 12px"></div>
    <div onclick="openCommunityDetail('${commId}');this.closest('[style*=fixed]').remove()" style="padding:14px 20px;font-size:15px;font-weight:600;color:var(--txt0);cursor:pointer;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--txt2)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      View Community
    </div>
    <div onclick="_togglePinComm('${commId}');this.closest('[style*=fixed]').remove()" style="padding:14px 20px;font-size:15px;font-weight:600;color:var(--txt0);cursor:pointer;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--txt2)" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
      ${isPinned?'Unpin from Top':'Pin to Top'}
    </div>
    <div onclick="showToast('Notifications muted');this.closest('[style*=fixed]').remove()" style="padding:14px 20px;font-size:15px;font-weight:600;color:var(--txt0);cursor:pointer;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--txt2)" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
      Mute Notifications
    </div>
    <div onclick="showToast('Left community');this.closest('[style*=fixed]').remove()" style="padding:14px 20px;font-size:15px;font-weight:600;color:#e05252;cursor:pointer;display:flex;align-items:center;gap:12px">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#e05252" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      Leave Community
    </div>
    <div onclick="this.closest('[style*=fixed]').remove()" style="padding:14px 20px;font-size:15px;font-weight:600;color:var(--txt3);cursor:pointer;text-align:center">Cancel</div>
  </div>`;
  sheet.onclick=e=>{if(e.target===sheet)sheet.remove();};
  document.body.appendChild(sheet);
}

// ═══════════════════════════════════════════════════
// MAP SIDE PANEL — 3D toggle + land layer toggles
// ═══════════════════════════════════════════════════
const _sidePanelActiveLayers=new Set();

// ═══════════════════════════════════════════════════
// ON-DEMAND TRAILS TOGGLE (side panel) — independent of the
// automatic 2km spot-detail trails, which always stay on regardless.
// ═══════════════════════════════════════════════════
let _viewportTrailsOn=false;
const _viewportTrailsCache=new Map();
let _viewportTrailsBounds=null, _viewportTrailsMoveHandler=null;

function toggleTrailsLayer(rowEl){
  _viewportTrailsOn=!_viewportTrailsOn;
  const toggleEl=rowEl?.querySelector('.side-layer-toggle');
  if(toggleEl)toggleEl.classList.toggle('on',_viewportTrailsOn);
  if(toggleEl)toggleEl.classList.toggle('off',!_viewportTrailsOn);
  if(_viewportTrailsOn){
    _loadViewportTrails();
    if(!_viewportTrailsMoveHandler){
      let debounceTimer=null;
      _viewportTrailsMoveHandler=()=>{
        clearTimeout(debounceTimer);
        debounceTimer=setTimeout(_loadViewportTrails,800);
      };
      map.on('moveend',_viewportTrailsMoveHandler);
    }
  } else {
    _clearViewportTrails();
    if(_viewportTrailsMoveHandler){map.off('moveend',_viewportTrailsMoveHandler);_viewportTrailsMoveHandler=null;}
  }
}

function _clearViewportTrails(){
  try{if(map&&map.getLayer('viewport-trails-line'))map.removeLayer('viewport-trails-line');}catch{}
  try{if(map&&map.getSource('viewport-trails-src'))map.removeSource('viewport-trails-src');}catch{}
}

async function _loadViewportTrails(){
  if(!map||!_viewportTrailsOn)return;
  const zoom=map.getZoom();
  if(zoom<11){_clearViewportTrails();return;}
  const b=map.getBounds();
  const bbox=`${b.getSouth().toFixed(3)},${b.getWest().toFixed(3)},${b.getNorth().toFixed(3)},${b.getEast().toFixed(3)}`;
  if(_viewportTrailsBounds===bbox)return;
  _viewportTrailsBounds=bbox;
  try{
    let data;
    if(_viewportTrailsCache.has(bbox)){
      data=_viewportTrailsCache.get(bbox);
    }else{
      const q=`[out:json][timeout:20];way["highway"~"path|footway|track"](${bbox});out geom;`;
      data=await _overpassFetchRetry(q,20000);
      _viewportTrailsCache.set(bbox,data);
    }
    if(!_viewportTrailsOn)return; // toggled off while fetch was in flight
    const features=(data.elements||[])
      .filter(el=>el.type==='way'&&el.geometry?.length>1)
      .map(el=>({type:'Feature',geometry:{type:'LineString',coordinates:el.geometry.map(p=>[p.lon,p.lat])},properties:{}}));
    _clearViewportTrails();
    if(!features.length)return;
    map.addSource('viewport-trails-src',{type:'geojson',data:{type:'FeatureCollection',features}});
    map.addLayer({id:'viewport-trails-line',type:'line',source:'viewport-trails-src',
      layout:{'line-cap':'round','line-join':'round'},
      paint:{'line-color':'#9CAF88','line-width':2,'line-opacity':.8}});
  }catch(e){
    console.warn('[Trails] viewport load failed:',e);
    _viewportTrailsBounds=null;
    _showMapNotice('Trails unavailable — data server busy');
  }
}

function _toggleSidePanelLayer(layerId, rowEl){
  // Get the visual toggle element inside the row
  const toggleEl=rowEl?.querySelector('.side-layer-toggle')||rowEl;
  // Remap HTML layer IDs to the IDs toggleSidePanelLayer expects
  const idRemap={countylines:'counties'};
  const mappedId=idRemap[layerId]||layerId;
  // Delegate to the real toggle function which calls showLandType/hideLandType
  toggleSidePanelLayer(mappedId, toggleEl);
}

function _addSidePanelLayer(layerId){
  if(!map||!map.loaded())return;
  try{
    const configs={
      blm:{color:'#f9a825',opacity:0.25,label:'Bureau of Land Management',source:'blm-data'},
      natforest:{color:'#388e3c',opacity:0.25,label:'National Forest',source:'natforest-data'},
      stateparks:{color:'#1565c0',opacity:0.25,label:'State Parks',source:'stateparks-data'},
      countylines:{color:'rgba(255,255,255,0.7)',opacity:1,label:'County Lines',source:'countylines-data',line:true},
      privateland:{color:'#c62828',opacity:0.18,label:'Private Land',source:'privateland-data'}
    };
    const cfg=configs[layerId];
    if(!cfg)return;
    // Use existing layers if available (from the layers system)
    const existingLayer=document.querySelector(`[data-layer="${layerId}"]`);
    // Try to toggle existing map layer if it exists
    const layerIds=map.getStyle()?.layers?.map(l=>l.id)||[];
    const matchingLayer=layerIds.find(id=>id.toLowerCase().includes(layerId)||id.toLowerCase().includes(cfg.label.toLowerCase().replace(/ /g,'-')));
    if(matchingLayer){
      map.setLayoutProperty(matchingLayer,'visibility','visible');
    } else {
      // Show toast since real boundary data requires a tile source
      showToast(`${cfg.label} layer toggled`);
    }
  }catch(e){}
}

function _removeSidePanelLayer(layerId){
  if(!map||!map.loaded())return;
  try{
    const configs={blm:{label:'Bureau of Land Management'},natforest:{label:'National Forest'},stateparks:{label:'State Parks'},countylines:{label:'County Lines'},privateland:{label:'Private Land'}};
    const cfg=configs[layerId];
    if(!cfg)return;
    const layerIds=map.getStyle()?.layers?.map(l=>l.id)||[];
    const matchingLayer=layerIds.find(id=>id.toLowerCase().includes(layerId)||id.toLowerCase().includes((cfg.label||'').toLowerCase().replace(/ /g,'-')));
    if(matchingLayer){map.setLayoutProperty(matchingLayer,'visibility','none');}
  }catch(e){}
}

// Show/hide 3D toggle based on style
function _updateSidePanel3DRow(styleName){
  const row=document.getElementById('sidePanel3DRow');
  if(row){row.style.display=(styleName==='satellite'||styleName==='hybrid')?'block':'none';}
}

// Hook into setMapStyle to show/hide 3D row — wrap without breaking original
const _origSetMapStyle=window.setMapStyle;
if(_origSetMapStyle){
  window.setMapStyle=function(s,...args){
    _origSetMapStyle.call(this,s,...args);
    _updateSidePanel3DRow(s);
  };
}

// Legacy stubs removed — real toggleDotMenu/closeDotMenu functions are defined above

// CSS helper for side-layer toggles (injected once)
(function(){
  if(document.getElementById('_sideLayerStyles'))return;
  const style=document.createElement('style');
  style.id='_sideLayerStyles';
  style.textContent=`
    .side-layer-toggle{width:40px;height:24px;border-radius:12px;position:relative;transition:background .2s;flex-shrink:0}
    .side-layer-toggle.off{background:var(--border2)}
    .side-layer-toggle.on{background:#B8E87A}
    .side-layer-knob{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .2s;box-shadow:0 1px 3px rgba(0,0,0,.3)}
    .side-layer-toggle.on .side-layer-knob{transform:translateX(16px)}
  `;
  document.head.appendChild(style);
})();

// ═══════════════════════════════════════════════════
// COMMUNITY — PULL TO REFRESH
// ═══════════════════════════════════════════════════
(function(){
  let _ptr_startY=0, _ptr_dist=0, _ptr_active=false;
  const THRESHOLD=60;

  document.addEventListener('DOMContentLoaded',()=>{
    const scrollEl=document.getElementById('commCommunitiesList');
    if(!scrollEl)return;
    scrollEl.addEventListener('touchstart',(e)=>{
      if(scrollEl.scrollTop===0){
        _ptr_startY=e.touches[0].clientY;
        _ptr_active=true;
      }
    },{passive:true});
    scrollEl.addEventListener('touchmove',(e)=>{
      if(!_ptr_active)return;
      _ptr_dist=e.touches[0].clientY-_ptr_startY;
    },{passive:true});
    scrollEl.addEventListener('touchend',()=>{
      if(_ptr_active&&_ptr_dist>THRESHOLD){
        _buildCommunityList();
        showToast('Communities refreshed');
      }
      _ptr_active=false;
      _ptr_dist=0;
    },{passive:true});
  });
})();

function _sidePanelToggle3D(){
  toggle3DMap();
  // Sync visual toggle
  const tog=document.getElementById('sidePanel3DToggle');
  const knob=document.getElementById('sidePanel3DKnob');
  if(tog&&knob){
    const is3dOn=typeof _map3dOn!=='undefined'?_map3dOn:false;
    if(is3dOn){
      tog.style.background='#B8E87A';
      knob.style.transform='translateX(18px)';
    } else {
      tog.style.background='var(--border2)';
      knob.style.transform='translateX(0)';
    }
  }
}
