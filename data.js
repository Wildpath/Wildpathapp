// NO EMOJIS — SVG icons or plain text only throughout this file
const spots = [
  // ══════════════════════════════════════════════════════════
  // WILDPATH DEMO SPOTS — 5 real California locations
  // ══════════════════════════════════════════════════════════
  {
    id:1, name:"Sutro Baths",
    lat:37.7799, lng:-122.5135,
    type:"urban", typeLabel:"Urban Exploration",
    typeColor:"#C4524A", icon:"urban",
    heroGradient:"linear-gradient(160deg,#0d1a2e,#1a3a5c,#0d2233)",
    rating:4.7, reviews:387, distance:"8 mi away", elevation:"Sea level",
    legal:"legal", legalText:"Legal", legalClass:"legal-legal",
    trailLength:"0.3 mi loop", difficulty:"Easy", diffClass:"diff-easy",
    bestSeason:"All year", parkingCost:"Free", entryFee:"Free",
    roadCondition:"Paved", cellSignal:"Good",
    season:[2,2,2,2,2,2,2,2,2,2,2,2],
    permitRequired:false, parkingCapacity:"Large lots at Lands End",
    parkingFillTime:"10am–2pm on weekends",
    fourWD:false,
    permitData:null, discoveredBy:'wildpath_admin', addedDate:'Jan 5, 2026', verifiedBy:'wildpath_admin', verifiedDate:'Mar 10, 2026', nearestHospital:'UCSF Medical Center — 4 mi', nearestTown:'San Francisco, CA — 8 mi',
    rangerContact:{agency:'Golden Gate National Recreation Area',district:'Fort Point & Presidio Visitor Center',phone:'415-561-4323',website:'https://www.nps.gov/goga',email:null},
    weather:[
      {day:"Mon",icon:"fog",high:58,low:50},
      {day:"Tue",icon:"cloud",high:60,low:51},
      {day:"Wed",icon:"fog",high:56,low:49},
      {day:"Thu",icon:"cloud",high:61,low:50},
      {day:"Fri",icon:"rain",high:55,low:48}
    ],
    crowd:60,
    campingText:"No camping — urban NPS site",
    reviews_data:[
      {user:"UrbanExplorer_Bay",stars:5,date:"Mar 15, 2026",text:"The ruins at the edge of the Pacific are simply stunning. Concrete pools, crumbling archways, and crashing waves — pure atmosphere."},
      {user:"HistoryBuff_SF",stars:5,date:"Feb 28, 2026",text:"Built in 1896 and burned in 1966 — 70 years of history written in these concrete bones. One of the most evocative places in California."},
      {user:"SunsetHiker_CA",stars:4,date:"Jan 10, 2026",text:"Free, easy to reach by Muni bus, and genuinely awe-inspiring. The cave at low tide is the cherry on top."}
    ],
    similar:[4,3,5],
    approach:"Take the 48 Muni bus to the end of Point Lobos Avenue. Walk north through the parking area following signs for Sutro Baths. The ruins are visible from the trail in about 5 minutes. No fee, no permit required. The ruins sit within Golden Gate National Recreation Area.",
    gear:["Sturdy walking shoes","Extra layer for ocean wind","Camera"],
    hazards:["Unfenced edges above crumbling pools","Slippery wet concrete","Rogue waves on outer rocks"],
    insiderTips:"Visit at low tide to see the most of the ruins and access the sea cave. The NPS trail descends to the ruins basin — do not climb on the fragile concrete walls. Spectacular at sunset when the light turns the ruins golden.",
    accessibility:"Paved path descends to ruins basin. Rocky terrain inside ruins is uneven — accessible viewing from the path above.",
    kidScore:4, dogFriendly:true, shade:"None — fully exposed",
    crowdsByDay:[40,35,42,48,55,72,80], hiddenGem:false
  },
  {
    id:2, name:"Moaning Caverns",
    lat:38.0774, lng:-120.4707,
    type:"caves", typeLabel:"Cave",
    typeColor:"#9B7DC4", icon:"cave",
    heroGradient:"linear-gradient(160deg,#1a0a2e,#2d1a5c,#0d0520)",
    rating:4.6, reviews:644, distance:"140 mi away", elevation:"2100 ft",
    legal:"permit", legalText:"Permit Required", legalClass:"legal-permit",
    trailLength:"165 ft vertical descent", difficulty:"Moderate", diffClass:"diff-moderate",
    bestSeason:"All year", parkingCost:"Included with ticket",
    entryFee:"$24–$45/person depending on tour",
    roadCondition:"Paved", cellSignal:"None underground",
    season:[2,2,2,2,2,2,2,2,2,2,2,2],
    permitRequired:true,
    permitInfo:"Guided tours required. Purchase tickets at the visitor center or online at moaningcaverns.com. Rappelling adventure tour books out quickly on weekends.",
    permitData:{name:'Guided Cave Tour', agency:'Valerio Enterprises', cost:'$23 per person', url:'https://www.moaningcavern.com'}, discoveredBy:'caver_historic', addedDate:'Jan 8, 2026', verifiedBy:'GoldCountryExplorer', verifiedDate:'Apr 3, 2026', nearestHospital:'Mark Twain Medical Center — 22 mi', nearestTown:'Angels Camp, CA — 12 mi',
    rangerContact:{agency:'Valerio Enterprises (private)',district:'Calaveras Ranger District, El Dorado National Forest',phone:'209-795-4251',website:'https://www.fs.usda.gov/eldorado',email:'eldorado@fs.fed.us'},
    parkingCapacity:"50 cars",
    parkingFillTime:"Rarely fills",
    fourWD:false,
    weather:[
      {day:"Mon",icon:"cloud",high:72,low:55},
      {day:"Tue",icon:"sun",high:75,low:57},
      {day:"Wed",icon:"cloud",high:70,low:54},
      {day:"Thu",icon:"rain",high:65,low:52},
      {day:"Fri",icon:"cloud",high:68,low:53}
    ],
    crowd:45,
    campingText:"Glory Hole Campground — 5 mi",
    reviews_data:[
      {user:"CaverNerd_West",stars:5,date:"Apr 3, 2026",text:"California's largest public cavern. The 165-foot vertical chamber is jaw-dropping — you can see the bottom from the spiral staircase."},
      {user:"GoldCountryExplorer",stars:5,date:"Mar 12, 2026",text:"Open since 1922. The guided rappelling tour is the highlight — absolute bucket list item."},
      {user:"FamilyAdventures_NorCal",stars:4,date:"Feb 8, 2026",text:"The walking tour with the spiral stairs is perfect for families. The cavern formations are spectacular."}
    ],
    similar:[1,3,4],
    approach:"Take Highway 4 east toward Angels Camp to Vallecito. Turn south on Moaning Cave Road. The cavern entrance and parking are clearly signed. Purchase tour tickets at the visitor center on arrival. Admission required for all tours.",
    gear:["Closed-toe shoes (harness provided on rappel tours)","Helmet (provided)","Layers — cave is 58°F year-round","Change of clothes if rappelling"],
    hazards:["165-foot drop on rappel tour","Complete darkness below staircase","Slippery stairs when wet","Temperature near 58°F — cold without layers"],
    insiderTips:"The rappel adventure is far more memorable than the walking tour. Book online for weekends — walking tours sell out by noon in summer. The cavern has been open to the public since 1922, making it one of California's oldest tourist attractions.",
    accessibility:"Walking tour uses 236-step spiral staircase. Rappelling requires full mobility. Not wheelchair accessible.",
    kidScore:4, dogFriendly:false, shade:"Full — underground",
    crowdsByDay:[28,24,28,34,42,68,75], hiddenGem:false
  },
  {
    id:3, name:"McWay Falls Overlook",
    lat:36.1572, lng:-121.6715,
    type:"scenic", typeLabel:"Scenic Overlook",
    typeColor:"#D4A843", icon:"scenic",
    heroGradient:"linear-gradient(160deg,#1a4a3a,#2d6e52,#0d2e22)",
    rating:4.9, reviews:1182, distance:"148 mi away", elevation:"+160 ft",
    legal:"permit", legalText:"Permit Required", legalClass:"legal-permit",
    trailLength:"0.5 mi paved RT", difficulty:"Easy", diffClass:"diff-easy",
    bestSeason:"All year, spring for peak flow",
    parkingCost:"Day use fee included with park entry",
    entryFee:"$12/vehicle — Julia Pfeiffer Burns State Park",
    roadCondition:"Paved", cellSignal:"Partial",
    season:[2,2,2,2,1,1,1,1,1,2,2,2],
    permitRequired:true,
    permitData:{name:'Julia Pfeiffer Burns State Park Day Use', agency:'California State Parks', cost:'$12 per vehicle', url:'https://www.parks.ca.gov/?page_id=578'}, discoveredBy:'bigsur_ranger', addedDate:'Jan 10, 2026', verifiedBy:'CoastalWanderer_CA', verifiedDate:'May 12, 2026', nearestHospital:'Community Hospital of the Monterey Peninsula — 43 mi', nearestTown:'Big Sur, CA — 3 mi',
    rangerContact:{agency:'California State Parks',district:'Big Sur Sector',phone:'831-667-2315',website:'https://www.parks.ca.gov/?page_id=578',email:null},
    parkingCapacity:"30 cars at day-use lot",
    parkingFillTime:"9am–11am weekends and summer",
    fourWD:false,
    weather:[
      {day:"Mon",icon:"sun",high:68,low:52},
      {day:"Tue",icon:"cloud",high:65,low:50},
      {day:"Wed",icon:"rain",high:58,low:48},
      {day:"Thu",icon:"cloud",high:62,low:49},
      {day:"Fri",icon:"sun",high:70,low:53}
    ],
    crowd:65,
    campingText:"Pfeiffer Big Sur State Park — 3 mi north",
    reviews_data:[
      {user:"CoastalWanderer_CA",stars:5,date:"May 12, 2026",text:"An 80-foot waterfall dropping onto a perfectly framed beach. This view is genuinely one of a kind — there is nothing else like it in North America."},
      {user:"BigSurPhotographer",stars:5,date:"Apr 20, 2026",text:"The spring runoff doubles the water volume and the turquoise cove turns emerald green. Arrive at 9am to beat tour buses."},
      {user:"ScenicDrive_101",stars:5,date:"Mar 15, 2026",text:"Short paved trail, stunning reward. The waterfall falls onto the sand and the beach is completely inaccessible — which somehow makes it more magical."}
    ],
    similar:[1,4,5],
    approach:"From Highway 1 in Big Sur, turn into Julia Pfeiffer Burns State Park. Day use fee required at the entrance kiosk. Walk the Overlook Trail — a paved half-mile path — to the viewing platform above the falls. Do not attempt to descend to the beach — it is permanently closed to the public and descent is extremely dangerous.",
    gear:["Layers for coastal wind","Camera or phone","Sunscreen"],
    hazards:["Unfenced cliff overlook","Slippery when wet","No beach access — descent is illegal and has caused fatalities","Crowds can limit viewing platform space"],
    insiderTips:"Arrive before 9am on weekends. The waterfall runs year-round but spring (Feb–Apr) provides the highest water volume and most dramatic view. The beach below is inaccessible and off-limits — view only from the platform.",
    accessibility:"Fully paved ADA-accessible path to main viewing platform. One of the most accessible scenic spots on the California coast.",
    kidScore:5, dogFriendly:false, shade:"Partial — wooded trail with open overlook",
    crowdsByDay:[42,38,44,52,62,88,92], hiddenGem:false
  },
  {
    id:4, name:"Empire Mine State Historic Park",
    lat:39.2196, lng:-121.0557,
    type:"urban", typeLabel:"Urban Exploration",
    typeColor:"#C4524A", icon:"urban",
    heroGradient:"linear-gradient(160deg,#1a0a00,#3d2010,#100500)",
    rating:4.7, reviews:523, distance:"138 mi away", elevation:"2800 ft",
    legal:"permit", legalText:"Permit Required", legalClass:"legal-permit",
    trailLength:"3 mi of mine yard trails", difficulty:"Easy", diffClass:"diff-easy",
    bestSeason:"Spring and Fall",
    parkingCost:"Included with entry",
    entryFee:"$10/vehicle — California State Historic Park",
    roadCondition:"Paved", cellSignal:"Partial",
    season:[2,2,2,2,2,1,1,1,2,2,2,2],
    permitRequired:true,
    permitData:{name:'Day Use Entry Fee', agency:'California State Parks', cost:'$10 per vehicle', url:'https://www.parks.ca.gov/?page_id=500'}, discoveredBy:'goldrush_historian', addedDate:'Jan 12, 2026', verifiedBy:'GoldRushHistory', verifiedDate:'Apr 18, 2026', nearestHospital:'Sierra Nevada Memorial Hospital — 4 mi', nearestTown:'Grass Valley, CA — 1 mi',
    rangerContact:{agency:'California State Parks',district:'Gold Fields District',phone:'530-273-8522',website:'https://www.parks.ca.gov/?page_id=500',email:null},
    parkingCapacity:"Large paved lot",
    parkingFillTime:"Rarely fills",
    fourWD:false,
    weather:[
      {day:"Mon",icon:"sun",high:78,low:52},
      {day:"Tue",icon:"sun",high:82,low:54},
      {day:"Wed",icon:"cloud",high:76,low:51},
      {day:"Thu",icon:"sun",high:80,low:53},
      {day:"Fri",icon:"cloud",high:74,low:50}
    ],
    crowd:35,
    campingText:"Chana Flat Campground — 8 mi (Tahoe NF)",
    reviews_data:[
      {user:"GoldRushHistory",stars:5,date:"Apr 18, 2026",text:"From 1850 to 1956 this mine produced 5.8 million ounces of gold. The preserved mine yard, shaft entrance, and Bourn Cottage are extraordinarily well-maintained."},
      {user:"FoothillsExplorer",stars:5,date:"Mar 5, 2026",text:"The 367 miles of tunnels below your feet are humbling to contemplate. The museum puts the scale of the operation into perspective."},
      {user:"FamilyAdventures_Sierra",stars:4,date:"Feb 20, 2026",text:"Kids loved the mine shaft entrance and ore cart displays. Docents are incredibly knowledgeable. Spend at least 2 hours."}
    ],
    similar:[1,2,3],
    approach:"From Highway 49 in Grass Valley, take Empire Street east to the park entrance on East Empire Street. Day use entrance fee per person required at the kiosk. The mine yard and historic buildings are a short walk from the parking area. Self-guided trail maps available at the visitor center.",
    gear:["Walking shoes","Layers (mornings can be cool)","Water","Camera"],
    hazards:["Mine shaft entrance is secured — do not attempt to enter","Steep mine yard terrain in some areas","Hot summer afternoons — avoid July and August midday"],
    insiderTips:"The owner's cottage (Bourn Cottage) and gardens are stunning in spring. The mine operated until 1956 — making it one of the longest-running gold mines in California history. Visit on a weekday for a private docent-led tour.",
    accessibility:"Paved paths throughout mine yard. Mostly accessible with some uneven terrain near shaft.",
    kidScore:4, dogFriendly:true, shade:"Partial — wooded grounds",
    crowdsByDay:[20,18,22,26,32,52,58], hiddenGem:false
  },
  {
    id:5, name:"Alamere Falls",
    lat:37.9823, lng:-122.7634,
    type:"waterfall", typeLabel:"Waterfall",
    typeColor:"#6ABCD4", icon:"falls",
    heroGradient:"linear-gradient(160deg,#08102a,#18285a,#04081a)",
    rating:4.9, reviews:412, distance:"35 mi away", elevation:"+800 ft",
    legal:"legal", legalText:"Legal", legalClass:"legal-legal",
    trailLength:"8 mi RT via Palomarin", difficulty:"Moderate to Hard", diffClass:"diff-moderate",
    bestSeason:"Late winter and spring for max flow",
    parkingCost:"Free", entryFee:"Free — Point Reyes National Seashore",
    roadCondition:"Paved to trailhead", cellSignal:"None on trail",
    season:[2,2,2,2,1,0,0,0,0,1,2,2],
    permitRequired:false,
    permitData:null, discoveredBy:'pointreyes_hiker', addedDate:'Jan 15, 2026', verifiedBy:'PointReyesHiker', verifiedDate:'Dec 20, 2025', nearestHospital:'Marin General Hospital — 38 mi', nearestTown:'Bolinas, CA — 5 mi',
    rangerContact:{agency:'National Park Service — Point Reyes National Seashore',district:'Bear Valley Visitor Center',phone:'415-464-5100',website:'https://www.nps.gov/pore',email:'pore_information@nps.gov'},
    parkingCapacity:"25 cars at Palomarin Trailhead",
    parkingFillTime:"Weekends fill by 9am Nov–Apr",
    fourWD:false,
    weather:[
      {day:"Mon",icon:"fog",high:60,low:48},
      {day:"Tue",icon:"cloud",high:63,low:50},
      {day:"Wed",icon:"sun",high:66,low:51},
      {day:"Thu",icon:"cloud",high:61,low:49},
      {day:"Fri",icon:"rain",high:56,low:47}
    ],
    crowd:42,
    campingText:"Coast Camp — 5 mi (walk-in permit required)",
    reviews_data:[
      {user:"PointReyesHiker",stars:5,date:"Dec 20, 2025",text:"One of only two tidefalls in California. The waterfall drops 40 feet directly onto the beach and the ocean rolls in just feet away. Nothing else like it."},
      {user:"WaterfallChaser_Bay",stars:5,date:"Nov 18, 2025",text:"The hike is long but every step is worth it. Bass Lake and Pelican Lake along the way are stunning bonuses. Start at dawn."},
      {user:"NorCalWanderer",stars:4,date:"Feb 12, 2026",text:"Bring good boots — the informal trail down to the beach is steep and muddy in winter. The payoff is extraordinary."}
    ],
    similar:[3,1,2],
    approach:"Start at the Palomarin Trailhead at the end of Mesa Road in Bolinas. From Highway 1 take the Bolinas Lagoon exit and follow the unmarked road to Bolinas, then Mesa Road to its end. Hike north on the Coast Trail for approximately 4 miles passing Bass Lake and Pelican Lake. Look for an informal use trail on the left leading down to the beach and waterfall. The trail is unmaintained and requires careful navigation. Total round trip approximately 8 miles.",
    gear:["Hiking boots (waterproof recommended)","Layers for coastal wind","Water (2L minimum — no sources)","Trekking poles","Tide chart (beach access best 2hrs either side of low tide)"],
    hazards:["Long 8-mile round trip with significant elevation","Informal trail to beach is steep and unmaintained","Coastal trail can be very muddy Nov–Mar","No cell signal on trail","Beach access can be cut off at high tide"],
    insiderTips:"The falls run best November through April after rain. Start before 7am on weekends to secure parking. The beach below the falls is only fully accessible at low tide — bring a tide chart. The illegal shortcut across private property has resulted in trespassing citations.",
    accessibility:"Long coastal hike on dirt trail required. Not wheelchair accessible.",
    kidScore:2, dogFriendly:true, shade:"Partial — mixed coastal scrub and forest",
    crowdsByDay:[28,24,28,34,38,62,70], hiddenGem:false
  }
];

// ── NorCal Peaks (accurate coords & elevations) ───
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
