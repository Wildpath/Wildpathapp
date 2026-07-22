// NO EMOJIS — SVG icons or plain text only throughout this file
// Phase 2: spots live in Supabase. This array stays empty — approved spots
// are fetched from the spots table on load and pushed into userSpots.
const spots = [];

const NORCAL_PEAKS = [
  {name:"Mt Shasta",        elev:14179, lat:41.4092, lng:-122.1949},
  {name:"Lassen Peak",      elev:10457, lat:40.4882, lng:-121.5051},
  {name:"Mt Eddy",          elev:9025,  lat:41.3216, lng:-122.4563},
  {name:"Thompson Peak",    elev:9002,  lat:41.0438, lng:-123.0346},
  {name:"Black Butte",      elev:6325,  lat:41.4498, lng:-122.2982},
  {name:"Mt Rose",          elev:10776, lat:39.3649, lng:-119.9132},
  {name:"Pyramid Peak",     elev:9983,  lat:38.8588, lng:-120.1597},
  {name:"Castle Peak",      elev:9103,  lat:39.3766, lng:-120.3655},
  {name:"Brokeoff Mtn",     elev:9235,  lat:40.4453, lng:-121.5281},
  {name:"Snow Mtn",         elev:7056,  lat:39.3945, lng:-122.7534},
  {name:"Mt St Helena",     elev:4341,  lat:38.6707, lng:-122.6348},
  {name:"Mt Diablo",        elev:3849,  lat:37.8816, lng:-121.9142},
  {name:"Mt Tamalpais",     elev:2571,  lat:37.9233, lng:-122.5975},
  {name:"Half Dome",        elev:8836,  lat:37.7459, lng:-119.5332},
  {name:"El Capitan",       elev:7569,  lat:37.7336, lng:-119.6375},
  {name:"Clouds Rest",      elev:9926,  lat:37.7667, lng:-119.5320},
  {name:"Mt Dana",          elev:13057, lat:37.8994, lng:-119.2220},
  {name:"Mt Lyell",         elev:13120, lat:37.7391, lng:-119.2694},
  {name:"Mt Ritter",        elev:13143, lat:37.6888, lng:-119.1978},
  {name:"Matterhorn Peak",  elev:12264, lat:38.0564, lng:-119.3636},
  {name:"Sonora Peak",      elev:11462, lat:38.3386, lng:-119.6353},
  {name:"Dardanelles Cone", elev:9524,  lat:38.4288, lng:-119.8831},
  {name:"Grouse Ridge",     elev:7707,  lat:39.4083, lng:-120.6225}
];

// ── Land ownership fallback GeoJSON (accurate multi-point boundaries) ─
function makeFC(items){
  return{type:'FeatureCollection',features:items.map(it=>({
    type:'Feature',properties:{name:it.name,FORESTNAME:it.name,ALAND_NAME:it.name,UNITNAME:it.name,type:it.t||''},
    geometry:{type:'Polygon',coordinates:[[...it.c,it.c[0]]]}
  }))};
}
const LAND_FALLBACK = {
  // Accurate boundary shapes derived from official forest proclamation boundaries
  nationalForest: makeFC([
    {name:"Shasta-Trinity NF",t:"National Forest",c:[
      [-122.5,40.05],[-121.8,40.0],[-121.3,40.1],[-121.0,40.3],[-121.1,40.7],[-121.0,41.0],
      [-121.3,41.2],[-121.8,41.5],[-122.2,41.7],[-122.7,41.8],[-123.0,41.7],[-123.4,41.4],
      [-123.6,41.0],[-123.5,40.6],[-123.2,40.3],[-122.9,40.1],[-122.5,40.05]
    ]},
    {name:"Six Rivers NF",t:"National Forest",c:[
      [-124.05,40.2],[-123.5,40.1],[-123.0,40.25],[-122.8,40.6],[-122.9,41.0],[-123.1,41.3],
      [-123.5,41.5],[-123.8,41.6],[-124.1,41.5],[-124.2,41.1],[-124.1,40.7],[-124.05,40.2]
    ]},
    {name:"Klamath NF",t:"National Forest",c:[
      [-122.9,41.0],[-122.5,40.9],[-122.1,41.0],[-121.9,41.2],[-122.0,41.5],[-122.3,41.75],
      [-122.8,41.8],[-123.2,41.75],[-123.5,41.5],[-123.4,41.2],[-123.1,41.0],[-122.9,41.0]
    ]},
    {name:"Mendocino NF",t:"National Forest",c:[
      [-123.3,38.85],[-122.9,38.75],[-122.5,38.8],[-122.3,39.0],[-122.2,39.4],[-122.3,39.75],
      [-122.6,39.95],[-123.0,40.0],[-123.2,39.8],[-123.3,39.4],[-123.4,39.0],[-123.3,38.85]
    ]},
    {name:"Lassen NF",t:"National Forest",c:[
      [-121.7,40.2],[-121.2,40.15],[-120.7,40.2],[-120.45,40.4],[-120.5,40.65],[-120.8,40.85],
      [-121.2,40.95],[-121.55,40.9],[-121.8,40.7],[-121.75,40.45],[-121.7,40.2]
    ]},
    {name:"Plumas NF",t:"National Forest",c:[
      [-121.35,39.55],[-121.0,39.5],[-120.5,39.5],[-120.1,39.65],[-120.0,39.9],[-120.1,40.2],
      [-120.5,40.35],[-121.0,40.3],[-121.35,40.1],[-121.4,39.8],[-121.35,39.55]
    ]},
    {name:"Tahoe NF",t:"National Forest",c:[
      [-121.05,39.0],[-120.7,38.95],[-120.3,39.0],[-120.05,39.2],[-120.0,39.5],[-120.1,39.75],
      [-120.45,39.85],[-120.8,39.8],[-121.0,39.6],[-121.1,39.3],[-121.05,39.0]
    ]},
    {name:"El Dorado NF",t:"National Forest",c:[
      [-120.7,38.4],[-120.2,38.3],[-119.85,38.4],[-119.7,38.65],[-119.75,38.9],[-120.0,39.05],
      [-120.35,39.0],[-120.65,38.85],[-120.75,38.6],[-120.7,38.4]
    ]},
    {name:"Stanislaus NF",t:"National Forest",c:[
      [-120.5,37.75],[-120.0,37.7],[-119.55,37.8],[-119.35,38.0],[-119.4,38.3],[-119.7,38.45],
      [-120.1,38.5],[-120.5,38.35],[-120.65,38.1],[-120.6,37.85],[-120.5,37.75]
    ]},
    {name:"Sierra NF",t:"National Forest",c:[
      [-119.8,37.05],[-119.35,37.0],[-119.0,37.15],[-118.85,37.4],[-118.9,37.7],[-119.1,37.9],
      [-119.5,37.85],[-119.75,37.65],[-119.85,37.35],[-119.8,37.05]
    ]}
  ]),
  blm: makeFC([
    {name:"BLM Redding Field Office",t:"Bureau of Land Management",c:[
      [-123.0,40.0],[-122.2,39.9],[-121.6,40.05],[-121.5,40.35],[-121.8,40.6],
      [-122.3,40.6],[-122.8,40.45],[-123.0,40.2],[-123.0,40.0]
    ]},
    {name:"BLM Eagle Lake Field Office",t:"Bureau of Land Management",c:[
      [-121.1,40.35],[-120.6,40.3],[-120.1,40.5],[-120.05,40.85],[-120.4,41.0],
      [-120.9,40.95],[-121.15,40.75],[-121.1,40.35]
    ]},
    {name:"BLM Alturas Field Office",t:"Bureau of Land Management",c:[
      [-120.95,41.0],[-120.2,41.0],[-119.5,41.05],[-119.4,41.5],[-119.7,41.95],
      [-120.4,42.0],[-120.9,41.85],[-121.1,41.5],[-121.0,41.15],[-120.95,41.0]
    ]},
    {name:"BLM Ukiah Field Office",t:"Bureau of Land Management",c:[
      [-123.2,38.75],[-122.7,38.65],[-122.3,38.8],[-122.2,39.15],[-122.4,39.5],
      [-122.8,39.55],[-123.15,39.35],[-123.25,39.0],[-123.2,38.75]
    ]},
    {name:"BLM Folsom Lake Area",t:"Bureau of Land Management",c:[
      [-121.3,38.55],[-120.8,38.5],[-120.4,38.65],[-120.35,39.0],[-120.65,39.15],
      [-121.1,39.05],[-121.35,38.8],[-121.3,38.55]
    ]},
    {name:"BLM Central Coast Field Office",t:"Bureau of Land Management",c:[
      [-121.5,35.8],[-120.9,35.75],[-120.4,35.9],[-120.2,36.25],[-120.4,36.6],
      [-120.9,36.65],[-121.4,36.5],[-121.55,36.1],[-121.5,35.8]
    ]}
  ]),
  stateParks: makeFC([
    {name:"Point Reyes National Seashore",t:"National Seashore",c:[
      [-123.0,37.98],[-122.9,37.9],[-122.75,37.88],[-122.68,38.0],[-122.7,38.12],
      [-122.8,38.2],[-123.0,38.22],[-123.05,38.08],[-123.0,37.98]
    ]},
    {name:"Mt Tamalpais State Park",t:"State Park",c:[
      [-122.72,37.89],[-122.62,37.87],[-122.55,37.9],[-122.52,37.96],[-122.58,38.0],
      [-122.68,38.0],[-122.73,37.96],[-122.72,37.89]
    ]},
    {name:"Marin Headlands GGNRA",t:"National Recreation Area",c:[
      [-122.58,37.80],[-122.51,37.80],[-122.46,37.82],[-122.44,37.86],[-122.48,37.89],
      [-122.54,37.89],[-122.58,37.87],[-122.58,37.80]
    ]},
    {name:"Pfeiffer Big Sur State Park",t:"State Park",c:[
      [-121.87,36.2],[-121.72,36.18],[-121.6,36.22],[-121.58,36.32],[-121.65,36.42],
      [-121.78,36.42],[-121.87,36.35],[-121.87,36.2]
    ]},
    {name:"Julia Pfeiffer Burns SP",t:"State Park",c:[
      [-121.72,36.12],[-121.62,36.11],[-121.55,36.15],[-121.55,36.22],
      [-121.62,36.24],[-121.72,36.2],[-121.72,36.12]
    ]},
    {name:"Big Basin Redwoods SP",t:"State Park",c:[
      [-122.33,37.14],[-122.2,37.12],[-122.13,37.17],[-122.13,37.24],
      [-122.22,37.27],[-122.32,37.24],[-122.33,37.14]
    ]},
    {name:"Samuel P. Taylor SP",t:"State Park",c:[
      [-122.78,38.0],[-122.67,37.99],[-122.58,38.01],[-122.56,38.06],
      [-122.62,38.1],[-122.73,38.08],[-122.78,38.04],[-122.78,38.0]
    ]},
    {name:"D.L. Bliss State Park (Tahoe)",t:"State Park",c:[
      [-120.13,38.97],[-120.03,38.96],[-119.96,39.0],[-119.95,39.07],
      [-120.03,39.09],[-120.12,39.07],[-120.13,38.97]
    ]},
    {name:"McArthur-Burney Falls SP",t:"State Park",c:[
      [-121.73,41.0],[-121.6,40.99],[-121.5,41.03],[-121.49,41.1],
      [-121.57,41.13],[-121.7,41.12],[-121.73,41.05],[-121.73,41.0]
    ]},
    {name:"Año Nuevo State Park",t:"State Park",c:[
      [-122.35,37.09],[-122.28,37.08],[-122.21,37.1],[-122.2,37.16],
      [-122.27,37.18],[-122.34,37.15],[-122.35,37.09]
    ]},
    {name:"Henry Cowell Redwoods SP",t:"State Park",c:[
      [-122.08,37.02],[-122.0,37.01],[-121.95,37.05],[-121.95,37.1],
      [-122.02,37.12],[-122.08,37.09],[-122.08,37.02]
    ]},
    {name:"Humboldt Redwoods SP",t:"State Park",c:[
      [-124.08,40.05],[-123.98,40.0],[-123.85,40.08],[-123.8,40.25],
      [-123.88,40.42],[-124.0,40.45],[-124.1,40.35],[-124.1,40.15],[-124.08,40.05]
    ]}
  ]),
  private: makeFC([
    {name:"Agricultural Land — Sacramento Valley",t:"Private",c:[
      [-122.3,38.1],[-121.5,38.0],[-121.0,38.1],[-120.8,38.5],[-121.0,39.0],
      [-121.5,39.4],[-122.0,39.5],[-122.4,39.2],[-122.5,38.7],[-122.3,38.1]
    ]},
    {name:"Napa/Sonoma Wine Country",t:"Private",c:[
      [-122.9,38.15],[-122.4,38.1],[-122.1,38.3],[-122.0,38.6],[-122.3,38.8],
      [-122.7,38.75],[-123.0,38.5],[-123.0,38.25],[-122.9,38.15]
    ]},
    {name:"Central Valley Farmland",t:"Private",c:[
      [-121.8,36.9],[-121.0,36.8],[-120.4,37.0],[-120.2,37.5],[-120.4,38.0],
      [-121.0,38.1],[-121.6,37.9],[-121.9,37.5],[-121.8,36.9]
    ]}
  ])
};

// LAND_QUERY_APIS replaced by LAND_FETCH_URLS in the new land boundary section below

// ── Spot type definitions ─────────────────────────
const SPOT_TYPE_DEFS={
  hiking:       {label:'Hiking Trail',    color:'#4a7c59',icon:'hiking'},
  biking:       {label:'Biking Trail',    color:'#d4a017',icon:'biking'},
  swimming:     {label:'Swimming Hole',   color:'#4a90d9',icon:'water'},
  caves:        {label:'Cave',            color:'#8b5cf6',icon:'cave'},
  rock_climbing:{label:'Rock Climbing',   color:'#ff7043',icon:'climb'},
  scenic:       {label:'Scenic Overlook', color:'#e07b39',icon:'scenic'},
  urban:        {label:'Urban Explore',   color:'#e05252',icon:'urban'},
  river:        {label:'River Spot',      color:'#2fa8cc',icon:'river'},
  lava_tube:    {label:'Lava Tube',       color:'#b86060',icon:'lava'},
  waterfall:    {label:'Waterfall',       color:'#4fc3f7',icon:'falls'},
  natural_slide:{label:'Natural Slide',   color:'#26c6a6',icon:'slide'}
};
const SPOT_FILTERS=[
  {id:'all',    label:'All',    icon:'', types:null},
  {id:'water',  label:'Water',  icon:'', types:['swimming','river','waterfall','natural_slide']},
  {id:'caves',  label:'Caves',  icon:'', types:['caves','lava_tube']},
  {id:'hiking', label:'Hiking', icon:'', types:['hiking']},
  {id:'biking', label:'Biking', icon:'', types:['biking']},
  {id:'views',  label:'Views',  icon:'', types:['scenic']},
  {id:'urban',  label:'Urban',  icon:'', types:['urban']},
  {id:'climb',  label:'Climb',  icon:'', types:['rock_climbing']},
];

// ── Feature toggle layer configs ──────────────────
const FEATURE_LAYERS = [
  {id:'railroads',    label:'Train Tracks', icon:'', desc:'Rail lines — grey dashed',
   type:'overpass', lineColor:'#888888', lineWeight:2, lineOpacity:.85,
   query:'[out:json][timeout:18][maxsize:2000000];(way["railway"~"rail|narrow_gauge|light_rail"]({{bbox}}););out geom tags;',
   opts:{dashArray:[5,3]}},
  {id:'tunnels',      label:'Tunnels', icon:'', desc:'Road & rail tunnels — dashed',
   type:'overpass', lineColor:'#5a5a6a', lineWeight:3, lineOpacity:.8,
   query:'[out:json][timeout:12][maxsize:800000];(way["tunnel"="yes"]({{bbox}});way["railway"]["tunnel"="yes"]({{bbox}}););out geom tags;',
   opts:{dashArray:[3,4]}},
  {id:'rivers',       label:'Rivers & Streams', icon:'', desc:'Rivers, streams, lakes — blue',
   type:'overpass', lineColor:'#5BA8C4', lineWeight:3, lineOpacity:.9,
   query:'[out:json][timeout:20][maxsize:2500000];(way["waterway"~"river|canal|stream"]({{bbox}});way["natural"="water"]({{bbox}}););out geom tags;',
   opts:{variableWidth:true,waterBodies:true}},
  {id:'fireRoads',    label:'Fire Roads', icon:'', desc:'Fire & forest access roads — dashed',
   type:'overpass', lineColor:'#A0784A', lineWeight:2, lineOpacity:.85,
   query:'[out:json][timeout:15][maxsize:1200000];(way["highway"="track"]({{bbox}});way["highway"="service"]["service"="forestry"]({{bbox}}););out geom tags;',
   opts:{dashArray:[6,3]}},
  {id:'landOwnership',label:'Land Ownership',   icon:'', desc:'BLM · NF · State Parks · Private', type:'land'}
];

// ── Profile data ──────────────────────────────────
const badges=[{emoji:"hiking",name:"First Hike",earned:true},{emoji:"water",name:"Splash Zone",earned:true},{emoji:"",name:"Sunrise Chaser",earned:true},{emoji:"cave",name:"Cave Crawler",earned:true},{emoji:"peak",name:"Summit Seeker",earned:true},{emoji:"rain",name:"Rain Hiker",earned:true},{emoji:"camp",name:"Camp Master",earned:false},{emoji:"bird",name:"Eagle Eye",earned:false},{emoji:"bike",name:"Dirt Devil",earned:false},{emoji:"",name:"Hidden Gem",earned:false},{emoji:"map",name:"Cartographer",earned:false},{emoji:"",name:"Thru-Hiker",earned:false}];
const monthActivity=[12,8,22,35,48,60,58,62,40,30,18,10];
const proFeatures=[{text:"Offline map downloads",free:false},{text:"Land ownership layers",free:false},{text:"Fire history overlays",free:false},{text:"Unlimited trip planning",free:false},{text:"Basic map access",free:true},{text:"Spot details & reviews",free:true}];
// savedSpotsList is built dynamically from favorited spots + demo fallbacks
const savedSpotsList=[
  {name:"McWay Falls Overlook",dist:"148 mi",icon:"scenic"},
  {name:"Sutro Baths",dist:"8 mi",icon:"urban"},
  {name:"Alamere Falls",dist:"35 mi",icon:"falls"},
  {name:"Moaning Caverns",dist:"140 mi",icon:"cave"}
];
const settingItems=[
  {icon:"",name:"Notifications",key:"notifications"},
  {icon:"",name:"Location Services",key:"location"},
  {icon:"",name:"Offline Maps",key:"offline"},
  {icon:"",name:"Dark Mode",key:"darkmode"},
  {icon:"",name:"Share Profile",key:"share"},
  {icon:"",name:"Help & Support",key:"help"},
  {icon:"",name:"Legal Info",key:"legal"}
];
// ── Trip Routes Database ──────────────────────────
const TRIP_ROUTES=[
  {id:'sf_yosemite',
   startKw:['san francisco','sf','bay area','oakland','berkeley','marin','alameda'],
   endKw:['yosemite','el capitan','half dome','tuolumne','valley'],
   name:'Bay Area → Yosemite Valley',distance:'195 mi',driveTime:'3.5 hrs',
   highlight:'Granite walls · Waterfalls · Old-growth redwoods',
   days:[
    {label:'Day 1',theme:'Bay to the Foothills',cost:'$42 total',totalDrive:'3.5 hrs driving',
     spots:[
      {name:'Marin Headlands Sunrise Overlook',time:'7:00 AM',duration:'1 hr',icon:'sunrise',note:'Iconic Golden Gate views before the crowds — arrive before dawn',type:'Scenic'},
      {name:'Muir Woods Cathedral Grove',time:'9:00 AM',duration:'2 hrs',icon:'forest',note:'Tallest old-growth redwoods near the city — reserve timed entry at recreation.gov',type:'Hiking',cost:'$15/person'},
      {name:'Groveland Lunch Stop',time:'1:30 PM',duration:'45 min',icon:'food',note:'Last real food town before Yosemite — historic Gold Rush main street',type:'Town'},
      {name:'Tunnel View Arrival',time:'4:00 PM',duration:'1.5 hrs',icon:'peak',note:'First iconic view of El Cap, Half Dome, and Bridalveil Falls — pure cinema',type:'Scenic'}
     ],drives:['45 min drive','2 hr 10 min drive','50 min drive']},
    {label:'Day 2',theme:'Yosemite Valley Floor',cost:'$35 total',totalDrive:'45 min driving',
     spots:[
      {name:'Mirror Lake at Sunrise',time:'6:30 AM',duration:'1.5 hrs',icon:'wildlife',note:'Still water reflection of Half Dome — magic window before 8am',type:'Hiking'},
      {name:'Valley Floor Loop — El Cap Meadow',time:'9:00 AM',duration:'3 hrs',icon:'hiking',note:'Bridalveil Fall, Cook\'s Meadow, El Cap Meadow along the Merced River',type:'Hiking',cost:'$35 park entry'},
      {name:'Glacier Point Panorama',time:'1:30 PM',duration:'2 hrs',icon:'bird',note:'3,200 ft above the valley floor — all of Yosemite spread below you',type:'Scenic'},
      {name:'Sentinel Bridge Sunset',time:'7:30 PM',duration:'1 hr',icon:'sunset',note:'Half Dome reflected perfectly in the Merced River at golden hour',type:'Scenic'}
     ],drives:['20 min drive','30 min drive','25 min drive']}
   ]},
  {id:'sf_tahoe',
   startKw:['san francisco','sf','bay area','oakland','berkeley','sacramento','sac','stockton'],
   endKw:['tahoe','lake tahoe','south lake','truckee','tahoe city','incline'],
   name:'Bay Area → Lake Tahoe',distance:'190 mi',driveTime:'3.5 hrs',
   highlight:'Alpine lake · Secret coves · Sierra Nevada peaks',
   days:[
    {label:'Day 1',theme:'Up to the High Sierra',cost:'$55 total',totalDrive:'3.5 hrs driving',
     spots:[
      {name:'Folsom Lake Overlook',time:'10:00 AM',duration:'30 min',icon:'water',note:'Stretch stop at the gateway to the Sierra foothills',type:'Scenic'},
      {name:'Grouse Ridge Viewpoint',time:'12:30 PM',duration:'1 hr',icon:'peak',note:'Stunning Sierra panorama at 7,700 ft — the Tahoe Basin laid out below',type:'Scenic'},
      {name:'Truckee Old Town',time:'3:00 PM',duration:'1 hr',icon:'town',note:'Coffee + last-minute gear in the classic gateway town on the Truckee River',type:'Town'},
      {name:'Lake Tahoe Secret Cove',time:'5:00 PM',duration:'2 hrs',icon:'swim',note:'Crystal water visible 30 feet down — prime sunset swimming among granite boulders',type:'Swimming',cost:'$5 parking'}
     ],drives:['1 hr 10 min drive','1 hr 15 min drive','30 min drive']},
    {label:'Day 2',theme:'Tahoe Basin Explorer',cost:'$30 total',totalDrive:'1 hr driving',
     spots:[
      {name:'Eagle Lake Alpine Trail',time:'7:30 AM',duration:'2.5 hrs',icon:'bird',note:'Hike to alpine lake at 6,600 ft with sweeping views of Emerald Bay',type:'Hiking'},
      {name:'Emerald Bay State Park',time:'11:00 AM',duration:'1.5 hrs',icon:'scenic',note:'Most photographed spot in California — Vikingsholm castle at the water\'s edge',type:'Scenic'},
      {name:'Sand Harbor Beach',time:'1:30 PM',duration:'3 hrs',icon:'beach',note:'Afternoon swim in glacially clear water among dramatic granite boulders',type:'Swimming',cost:'$10/vehicle'},
      {name:'Tahoe Rim Sunset Walk',time:'5:30 PM',duration:'1 hr',icon:'sunrise',note:'Short ridge walk above the north shore for alpenglow on the peaks',type:'Hiking'}
     ],drives:['20 min drive','25 min drive','15 min drive']}
   ]},
  {id:'sf_bigsur',
   startKw:['san francisco','sf','bay area','santa cruz','monterey','salinas','carmel'],
   endKw:['big sur','mcway','julia pfeiffer','pfeiffer','carmel','lucia','gorda'],
   name:'Bay Area → Big Sur Coast',distance:'155 mi',driveTime:'3 hrs',
   highlight:'Rugged coastline · Waterfalls · Ancient redwood canyons',
   days:[
    {label:'Day 1',theme:'Coast Highway South',cost:'$25 total',totalDrive:'3 hrs driving',
     spots:[
      {name:'Sutro Baths Ruins & Sea Cave',time:'7:30 AM',duration:'1 hr',icon:'urban',note:'Historic 1896 ruins — tunnel to sea cave only accessible at low tide',type:'Urban'},
      {name:'Devil\'s Slide Coastal Trail',time:'10:00 AM',duration:'1.5 hrs',icon:'water',note:'Dramatic converted highway along sheer cliffs above the Pacific',type:'Hiking'},
      {name:'Pigeon Point Lighthouse',time:'1:30 PM',duration:'45 min',icon:'light',note:'115 ft lighthouse — whale spouts often visible offshore Oct–Apr',type:'Scenic'},
      {name:'McWay Falls Overlook',time:'4:00 PM',duration:'1.5 hrs',icon:'water',note:'Waterfall drops 80 ft onto a beach no one can reach — one of CA\'s most iconic views',type:'Hiking',cost:'$10/vehicle'}
     ],drives:['30 min drive','45 min drive','1 hr drive']},
    {label:'Day 2',theme:'Big Sur Valley & Hidden Spots',cost:'$20 total',totalDrive:'30 min driving',
     spots:[
      {name:'Pfeiffer Big Sur Redwood Loop',time:'8:00 AM',duration:'2 hrs',icon:'forest',note:'Cathedral redwood groves along the Big Sur River — misty and ancient',type:'Hiking'},
      {name:'Pfeiffer Beach — Purple Sand',time:'11:00 AM',duration:'1.5 hrs',icon:'beach',note:'Manganese garnet creates unique purple-tinted sand — sea arch exposed at low tide',type:'Scenic'},
      {name:'Partington Cove & Sea Tunnel',time:'1:30 PM',duration:'1.5 hrs',icon:'cave',note:'Hike down to hidden cove via historic bootlegger\'s sea tunnel',type:'Hiking'},
      {name:'Bixby Bridge Golden Hour',time:'5:30 PM',duration:'1 hr',icon:'bridge',note:'Most famous bridge on the California coast — sunset light is perfect here',type:'Scenic'}
     ],drives:['10 min drive','20 min drive','15 min drive']}
   ]},
  {id:'sac_shasta',
   startKw:['sacramento','sac','chico','redding','red bluff','corning','willows'],
   endKw:['shasta','mount shasta','mt shasta','dunsmuir','weed','mccloud','castle crags'],
   name:'Sacramento → Mount Shasta',distance:'228 mi',driveTime:'3.5 hrs',
   highlight:'Active volcano · Lava tubes · Alpine wilderness',
   days:[
    {label:'Day 1',theme:'Up the Valley to the Volcano',cost:'$20 total',totalDrive:'3.5 hrs driving',
     spots:[
      {name:'Black Butte Cinder Cone Hike',time:'11:00 AM',duration:'3 hrs',icon:'lava',note:'Dramatic volcanic plug — 1,800 ft gain with unreal views of Mt Shasta',type:'Hiking'},
      {name:'Mt Shasta City Town Walk',time:'3:30 PM',duration:'1 hr',icon:'town',note:'Stock up on food and gear in this iconic Pacific Crest Trail town',type:'Town'},
      {name:'Bunny Flat Alpenglow',time:'7:00 PM',duration:'1 hr',icon:'scenic',note:'At 6,900 ft — watch the glacier cap turn pink then violet at sunset',type:'Scenic'}
     ],drives:['2 hr 45 min drive','20 min drive']},
    {label:'Day 2',theme:'Volcano Country',cost:'$15 total',totalDrive:'1.5 hrs driving',
     spots:[
      {name:'Shasta Caverns Tour',time:'9:00 AM',duration:'2 hrs',icon:'cave',note:'Ferry across Lake Shasta then tour the spectacular cave system',type:'Caves',cost:'$30/person'},
      {name:'McCloud Three Falls Loop',time:'12:30 PM',duration:'2.5 hrs',icon:'water',note:'Upper, Middle, and Lower falls — the Lower fall has a swimmable pool',type:'Hiking'},
      {name:'Mossbrae Falls Rail Hike',time:'3:30 PM',duration:'1.5 hrs',icon:'',note:'Walk the old railroad grade to a curtain of water emerging from mossy cliffs',type:'Hiking'}
     ],drives:['45 min drive','30 min drive']}
   ]},
  {id:'sf_pointreyes',
   startKw:['san francisco','sf','bay area','marin','petaluma','novato','san rafael'],
   endKw:['point reyes','inverness','bolinas','stinson beach','olema'],
   name:'Day Trip: SF → Point Reyes',distance:'45 mi',driveTime:'1 hr 20 min',
   highlight:'Wild coast · Tule elk · Lighthouse · Oysters',
   days:[
    {label:'Full Day',theme:'Point Reyes National Seashore',cost:'$30 total',totalDrive:'1.5 hrs total driving',
     spots:[
      {name:'Tomales Bay Morning Kayak',time:'8:30 AM',duration:'2.5 hrs',icon:'',note:'Paddle the protected calm bay — harbor seals often pop up alongside',type:'Water'},
      {name:'Tule Elk Reserve',time:'12:00 PM',duration:'1 hr',icon:'',note:'Free-roaming elk herd on windswept grass ridges — bring binoculars',type:'Wildlife'},
      {name:'Point Reyes Lighthouse',time:'2:00 PM',duration:'1.5 hrs',icon:'light',note:'308 steps down the headland — best whale watching spot in Northern CA',type:'Scenic'},
      {name:'Drakes Beach at Sunset',time:'5:30 PM',duration:'1 hr',icon:'beach',note:'White chalk cliffs meeting the Pacific — elk often wander the dunes at dusk',type:'Scenic'}
     ],drives:['25 min drive','15 min drive','20 min drive']}
   ]}
];
const DEFAULT_ROUTE={
  name:'NorCal Multi-Day Adventure',distance:'~200 mi',driveTime:'varies',
  highlight:'Best of Northern California\'s wild places',
  days:[
    {label:'Day 1',theme:'Bay & Coast',cost:'$35 total',totalDrive:'2 hrs driving',
     spots:[
      {name:'Marin Headlands Ridge Ride',time:'7:30 AM',duration:'3 hrs',icon:'biking',note:'Epic MTB or hike with Golden Gate views across the Bay',type:'Hiking/Biking'},
      {name:'Farallon Islands Vista Point',time:'1:00 PM',duration:'1.5 hrs',icon:'bird',note:'Ocean views 27 miles out — whale watching in season',type:'Scenic'},
      {name:'Sutro Baths Low Tide Cave',time:'4:00 PM',duration:'1 hr',icon:'urban',note:'1896 ruins and hidden sea cave tunnel — check tide charts first',type:'Urban'}
     ],drives:['40 min drive','20 min drive']},
    {label:'Day 2',theme:'Sierra Foothills',cost:'$40 total',totalDrive:'2.5 hrs driving',
     spots:[
      {name:'Moaning Cavern Vertical Descent',time:'10:00 AM',duration:'2 hrs',icon:'cave',note:'165 ft rope descent into a living cave — one of California\'s wildest experiences',type:'Caves',cost:'$24/person'},
      {name:'Lake Tahoe Secret Cove',time:'2:30 PM',duration:'2.5 hrs',icon:'water',note:'End the trip with the clearest water in the Sierra Nevada',type:'Swimming'}
     ],drives:['1 hr 30 min drive']}
   ]
};
const interests=["Hiking","Swimming","Caves","Urban Exploration","Camping","Photography","Biking"];

// ── Demo feed posts (shown when no user posts exist) ─────────────
const DEMO_POSTS = [
  {
    id:'dp_001',
    userId:'demo_u1',
    username:'kai_explores',
    caption:'Woke up at 4am to catch this. Half Dome reflected perfectly in the Merced River. Zero people, just fog and silence.',
    photos:[
      'https://images.unsplash.com/photo-1472396961693-142e6e269027?w=800',
      'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800'
    ],
    lat:37.7459, lng:-119.5332,
    spotName:'Half Dome, Yosemite',
    likes:['u2','u3','u4','u5','u6','u7','u8','u9','u10','u11','u12','u13'],
    commentsCount:14,
    createdAt:new Date(Date.now()-86400000*2).toISOString(),
    privacy:'public',type:'post'
  },
  {
    id:'dp_002',
    userId:'demo_u2',
    username:'sierralocal',
    caption:'Secret swimming hole off Hwy 49. Water temp was perfect. Locals only spot — you have to scramble down a sketchy trail to get here.',
    photos:[
      'https://images.unsplash.com/photo-1504701954957-2010ec3bcec1?w=800',
      'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=800'
    ],
    lat:38.9132, lng:-120.3655,
    spotName:'South Yuba River, Nevada County',
    likes:['u1','u3','u5','u7','u9','u11','u13','u14','u15'],
    commentsCount:22,
    createdAt:new Date(Date.now()-86400000*3).toISOString(),
    privacy:'public',type:'post'
  },
  {
    id:'dp_003',
    userId:'demo_u3',
    username:'pointreyes.collective',
    caption:'Tule elk at sunset on the ridge above Drakes Beach. This spot never gets old. Bring binoculars.',
    photos:[
      'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=800'
    ],
    lat:38.0,lng:-122.95,
    spotName:'Point Reyes National Seashore',
    likes:['u1','u2','u4','u5','u6','u7','u8'],
    commentsCount:8,
    createdAt:new Date(Date.now()-86400000*4).toISOString(),
    privacy:'public',type:'post'
  },
  {
    id:'dp_004',
    userId:'demo_u4',
    username:'norcal.trails',
    caption:'McCloud Falls lower pool. Best swimming in Shasta County hands down. Come early — the parking lot fills by 10am on weekends.',
    photos:[
      'https://images.unsplash.com/photo-1433086966358-54859d0ed716?w=800',
      'https://images.unsplash.com/photo-1515705576963-95cad62945b6?w=800',
      'https://images.unsplash.com/photo-1518098268026-4e89f1a2cd8e?w=800'
    ],
    lat:41.2500, lng:-122.0000,
    spotName:'McCloud River Falls, Siskiyou County',
    likes:['u1','u2','u3','u5','u6','u7','u8','u9','u10','u11','u12','u13','u14','u15','u16','u17'],
    commentsCount:31,
    createdAt:new Date(Date.now()-86400000*5).toISOString(),
    privacy:'public',type:'post'
  },
  {
    id:'dp_005',
    userId:'demo_u5',
    username:'wildpath_official',
    caption:'Alamere Falls — one of the only tidal waterfalls in California. Low tide only. 8-mile RT hike from the Palomarin trailhead.',
    photos:[
      'https://images.unsplash.com/photo-1534430480872-3498386e7856?w=800',
      'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800'
    ],
    lat:37.9233, lng:-122.7100,
    spotName:'Alamere Falls, Marin County',
    likes:['u1','u2','u3','u4','u6','u7','u8','u9','u10','u11'],
    commentsCount:19,
    createdAt:new Date(Date.now()-86400000*6).toISOString(),
    privacy:'public',type:'post'
  },
  {
    id:'dp_006',
    userId:'demo_u6',
    username:'tahoe.wild',
    caption:'Eagle Lake at sunrise. 6,600ft. The kind of stillness you can only find when you start hiking before dawn.',
    photos:[
      'https://images.unsplash.com/photo-1439853949212-36589f9a5aae?w=800',
      'https://images.unsplash.com/photo-1495107334309-fcf20504a5ab?w=800'
    ],
    lat:38.9400, lng:-120.1100,
    spotName:'Eagle Lake, Lake Tahoe Basin',
    likes:['u1','u2','u3','u4','u5','u7','u8'],
    commentsCount:12,
    createdAt:new Date(Date.now()-86400000*7).toISOString(),
    privacy:'public',type:'post'
  },
  {
    id:'dp_007',
    userId:'demo_u7',
    username:'coastwatcher',
    caption:'Sutro Baths sea cave at dead low tide. The tunnel opens up completely — you can walk all the way through. Check tide charts before you go.',
    photos:[
      'https://images.unsplash.com/photo-1499336315816-097655dcfbda?w=800'
    ],
    lat:37.7793, lng:-122.5132,
    spotName:'Sutro Baths Sea Cave, San Francisco',
    likes:['u1','u2','u3','u4','u5','u6','u8','u9','u10','u11','u12'],
    commentsCount:27,
    createdAt:new Date(Date.now()-86400000*8).toISOString(),
    privacy:'public',type:'post'
  },
  {
    id:'dp_008',
    userId:'demo_u8',
    username:'lassen.adventures',
    caption:'Bumpass Hell hydrothermal area in Lassen Volcanic. Otherworldly. Smells like sulphur but the colors are unreal. Less than 3mi from the trailhead.',
    photos:[
      'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=800',
      'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=800'
    ],
    lat:40.4453, lng:-121.5281,
    spotName:'Lassen Volcanic National Park',
    likes:['u1','u3','u5','u7','u9','u10','u11','u12'],
    commentsCount:16,
    createdAt:new Date(Date.now()-86400000*10).toISOString(),
    privacy:'public',type:'post'
  },
  {
    id:'dp_009',
    userId:'demo_u9',
    username:'big.sur.daily',
    caption:'Pfeiffer Beach at the keyhole arch. Purple sand only shows up at low tide when the waves wash over the manganese garnet. Timing is everything here.',
    photos:[
      'https://images.unsplash.com/photo-1465804575741-338df8554e02?w=800',
      'https://images.unsplash.com/photo-1520116468816-95b69f847357?w=800'
    ],
    lat:36.2340, lng:-121.8150,
    spotName:'Pfeiffer Beach, Big Sur',
    likes:['u1','u2','u3','u4','u5','u6','u7','u8','u10','u11','u12','u13','u14','u15','u16','u17','u18'],
    commentsCount:45,
    createdAt:new Date(Date.now()-86400000*12).toISOString(),
    privacy:'public',type:'post'
  },
  {
    id:'dp_010',
    userId:'demo_u10',
    username:'humboldt.redwoods',
    caption:'Avenue of the Giants — pull off anywhere and just walk into the old-growth. These trees are 1,500 years old. It resets something in your brain.',
    photos:[
      'https://images.unsplash.com/photo-1448375240586-882707db888b?w=800',
      'https://images.unsplash.com/photo-1544735716-392fe2489ffa?w=800'
    ],
    lat:40.3000, lng:-124.0000,
    spotName:'Humboldt Redwoods State Park',
    likes:['u1','u2','u3','u4','u5','u6','u7','u8','u9','u11','u12','u13'],
    commentsCount:33,
    createdAt:new Date(Date.now()-86400000*14).toISOString(),
    privacy:'public',type:'post'
  }
];
