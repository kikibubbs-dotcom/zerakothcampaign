(function () {
  console.log("CAMPAIGN SCRIPT STARTED");
  
  const SUPABASE_URL = "https://imcwmrvtnucstizhkrhl.supabase.co";
  const SUPABASE_KEY = "sb_publishable_gx32auqh2BrgkVFneXCMXw_V7GCjkTf";

  const root = document.getElementById("dnd-hub");
  if (!root || root.dataset.started) return;
  root.dataset.started = "yes";

  const $ = id => root.querySelector("#" + id);
  const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[c]);

  const blank = () => ({
    title:"THE CAMPAIGN",
    mapUrl:"",
    markers:[],
    mapDrawings:[],
    markerLegend:{},
    characters:[],
    quests:[],
    npcs:[],
    journal:[],
    events:[],
    calendarConfig:null,
    elapsedDays:[],
    notices:[],
    sharedInventory:[],
    partyGold:0,
    sessions:[],
    sessionMode:null,
    homebrew:[],
    encounters:[],
    worldEntries:[]
  });

  let state = blank();
  let client;
  let member;
  let channel;
  let saveTimer;
  let saving = false;
  let pending = false;
  let ready = false;
  let dragging = null;
  let lastRemote = 0;
  let calendarView = null;
  let mapDrawing = false;
  let journalCanvasDirty = false;
  let activeCharacterSheetId = "";

  const empty = text => `<div class="empty-state">${escapeHTML(text)}</div>`;
  const isDM = () => member?.role === "dm";
  const canEditCharacter = c => isDM() || (!!member && c?.ownerId === member.id);
  const makeId = () => crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now()) + Math.random().toString(36).slice(2);

  function status(text) {
    $("save-status").textContent = text;
  }

  function defaultsCharacter() {
    return {
      id:makeId(), name:"New Adventurer", player:"", race:"", className:"",
      level:1, hp:10, maxHp:10, ac:10, initiative:0,
      speed:30, portrait:"", backstory:"", notes:"",
      gear:"", loveInterest:"", spellSlots:Array.from({length:9},()=>({used:0,total:0})),
      isNPC:false
    };
  }

  function safeNumber(value, fallback=0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function persist() {
    if (!ready) return;
    pending = true;
    status("Saving changes...");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 500);
  }

  async function save() {
    if (!ready || saving || !pending) return;
    saving = true;
    pending = false;
    try {
      const {error} = await client.functions.invoke("campaign-data", {
        body:{action:"save-state",data:state}
      });
      if (error?.context?.status === 409) {
        pending = false;
        status("Save conflict — reload the page to get the latest campaign.");
        return;
      }
      if (error?.context?.status === 401 || error?.context?.status === 403) {
        pending = false;
        status("Save denied — " + error.message);
        return;
      }
      if (error) throw error;
      status("✓ All changes saved");
    } catch (err) {
      pending = true;
      status("Save failed: " + err.message);
    } finally {
      saving = false;
      if (pending) saveTimer = setTimeout(save,1000);
    }
  }

  function refresh() {
    $("campaign-title").textContent = state.title || "THE CAMPAIGN";
    renderDashboard();
    renderMap();
    renderParty();
    renderCombat();
    renderInventory();
    renderSessions();
    renderSessionMode();
    renderReferenceLibrary();
    renderCharacters();
    if(activeCharacterSheetId)renderCharacterSheet();
    renderSpellbook();
    renderWorld();
    renderQuests();
    renderNPCs();
    renderJournal();
    renderCalendar();
    renderNotices();
  }

  function renderInventory(){
    const shared=Array.isArray(state.sharedInventory)?state.sharedInventory:[];
    $("party-gold").textContent=Math.max(0,safeNumber(state.partyGold))+" GP";
    $("shared-inventory-list").innerHTML=shared.length?shared.map(item=>
      '<article class="inventory-item"><div class="inventory-item-main"><strong>'+escapeHTML(item.name)+'</strong><span class="tag">'+escapeHTML(item.category||"Item")+'</span><span class="tag">'+escapeHTML(item.rarity||"Common")+'</span><p>'+escapeHTML(item.notes||"")+'</p><small>Qty: '+safeNumber(item.quantity,1)+' · '+escapeHTML(item.value||"No value")+(item.weight?" · "+escapeHTML(item.weight)+" wt":"")+'</small></div>'+(isDM()?'<div class="card-actions"><button onclick="Hub.editSharedItem(\''+item.id+'\')">EDIT</button><button onclick="Hub.removeSharedItem(\''+item.id+'\')">REMOVE</button></div>':"")+'</article>'
    ).join(""):empty("The party stash is empty.");
    $("character-inventory-list").innerHTML=state.characters.length?state.characters.map(c=>{
      const items=Array.isArray(c.inventoryItems)?c.inventoryItems:[],editable=canEditCharacter(c);
      return '<article class="inventory-character-card"><div class="inventory-character-heading"><div><span class="card-subtitle">'+(c.isNPC?"NPC COMPANION":"ADVENTURER")+'</span><h3>'+escapeHTML(c.name)+'</h3></div><div class="inventory-gold"><strong>'+Math.max(0,safeNumber(c.gold))+' GP</strong>'+(editable?'<button class="small-button" onclick="Hub.editCharacterGold(\''+c.id+'\')">EDIT GOLD</button>':"")+'</div></div><div class="inventory-item-list">'+(items.length?items.map(item=>'<div class="inventory-item compact"><div class="inventory-item-main"><strong>'+escapeHTML(item.name)+'</strong><span class="tag">'+escapeHTML(item.category||"Item")+'</span><span class="tag">'+escapeHTML(item.rarity||"Common")+'</span><small>Qty: '+safeNumber(item.quantity,1)+' · '+escapeHTML(item.value||"No value")+(item.weight?" · "+escapeHTML(item.weight)+" wt":"")+'</small>'+(item.notes?'<p>'+escapeHTML(item.notes)+'</p>':"")+'</div>'+(editable?'<div class="card-actions"><button onclick="Hub.editCharacterItem(\''+c.id+'\',\''+item.id+'\')">EDIT</button><button onclick="Hub.removeCharacterItem(\''+c.id+'\',\''+item.id+'\')">REMOVE</button></div>':"")+'</div>').join(""):empty("No items recorded yet."))+'</div>'+(editable?'<button class="small-button inventory-add-button" onclick="Hub.addCharacterItem(\''+c.id+'\')">+ ADD ITEM</button>':'<span class="list-meta">VIEW ONLY</span>')+'</article>';
    }).join(""):empty("Add characters to start tracking their inventories.");
  }
  function inventoryItemFields(item={}){return [
    {name:"name",label:"Item name",value:item.name||"",required:true,full:true},
    {name:"category",label:"Category",type:"select",value:item.category||"Equipment",options:["Equipment","Weapon","Armour","Potion","Magic item","Tool","Consumable","Treasure","Other"].map(x=>({value:x,label:x}))},
    {name:"rarity",label:"Rarity",type:"select",value:item.rarity||"Common",options:["Common","Uncommon","Rare","Very Rare","Legendary","Artifact","N/A"].map(x=>({value:x,label:x}))},
    {name:"quantity",label:"Quantity",type:"number",value:item.quantity??1,min:1},
    {name:"weight",label:"Weight",value:item.weight||"",placeholder:"e.g. 2 lb"},
    {name:"value",label:"Value",value:item.value||"",placeholder:"e.g. 50 GP"},
    {name:"notes",label:"Description / notes",type:"textarea",rows:3,value:item.notes||"",full:true},
    {name:"equipmentType",label:"Equipment type",type:"select",value:item.equipmentType||"other",options:[["other","Other / unequippable"],["weapon","Weapon"],["light","Light armour"],["medium","Medium armour"],["heavy","Heavy armour"],["shield","Shield"]].map(([value,label])=>({value,label}))},
    {name:"armorBase",label:"Armour base AC (armour only)",type:"number",min:0,value:item.armorBase??0},
    {name:"acBonus",label:"Additional AC bonus",type:"number",value:item.acBonus??0},
    {name:"attackBonus",label:"Weapon attack bonus",type:"number",value:item.attackBonus??0},
    {name:"damage",label:"Weapon damage dice",value:item.damage||"",placeholder:"e.g. 1d8"},
    {name:"damageType",label:"Damage type",value:item.damageType||"",placeholder:"e.g. slashing"}
  ];}
  function saveInventoryItem(item,v){Object.assign(item,{name:v.name.trim(),category:v.category,rarity:v.rarity,quantity:Math.max(1,safeNumber(v.quantity,1)),weight:v.weight,value:v.value,notes:v.notes,equipmentType:v.equipmentType||"other",armorBase:Math.max(0,safeNumber(v.armorBase)),acBonus:safeNumber(v.acBonus),attackBonus:safeNumber(v.attackBonus),damage:v.damage||"",damageType:v.damageType||""});}
  function calculateCharacterAC(c){
    const equipped=(c.inventoryItems||[]).filter(x=>x.equipped),armour=equipped.find(x=>["light","medium","heavy"].includes(x.equipmentType)),shield=equipped.find(x=>x.equipmentType==="shield");
    if(!armour&&!shield)return null;
    if(armour&&safeNumber(armour.armorBase)<=0)return null;
    const dex=Math.floor((safeNumber(c.dexterity,10)-10)/2);
    let ac=armour?Math.max(0,safeNumber(armour.armorBase,10))+Math.min(dex,armour.equipmentType==="medium"?2:armour.equipmentType==="heavy"?0:99)+safeNumber(armour.acBonus):10+dex;
    if(shield)ac+=2+safeNumber(shield.acBonus);
    return Math.max(0,ac);
  }
  function addCharacterItem(id){const c=state.characters.find(x=>x.id===id);if(!c||!canEditCharacter(c))return;openForm("Add item to "+c.name,inventoryItemFields(),v=>{if(!v.name.trim())return alert("Please enter an item name.");mutate(()=>{if(!Array.isArray(c.inventoryItems))c.inventoryItems=[];const item={id:makeId(),equipped:false};saveInventoryItem(item,v);c.inventoryItems.push(item);});});}
  function editCharacterItem(cid,iid){const c=state.characters.find(x=>x.id===cid),item=c?.inventoryItems?.find(x=>x.id===iid);if(!c||!item||!canEditCharacter(c))return;openForm("Edit "+item.name,inventoryItemFields(item),v=>{if(!v.name.trim())return alert("Please enter an item name.");mutate(()=>saveInventoryItem(item,v));});}
  function toggleEquippedItem(cid,iid){const c=state.characters.find(x=>x.id===cid),item=c?.inventoryItems?.find(x=>x.id===iid);if(!c||!item||!canEditCharacter(c))return;mutate(()=>{item.equipped=!item.equipped;if(item.equipped&&["light","medium","heavy"].includes(item.equipmentType))(c.inventoryItems||[]).forEach(other=>{if(other.id!==item.id&&["light","medium","heavy"].includes(other.equipmentType))other.equipped=false;});if(item.equipped&&item.equipmentType==="shield")(c.inventoryItems||[]).filter(x=>x.id!==item.id&&x.equipmentType==="shield").forEach(x=>x.equipped=false);});}
  function removeCharacterItem(cid,iid){const c=state.characters.find(x=>x.id===cid);if(!c||!canEditCharacter(c)||!confirm("Remove this item from the character inventory?"))return;mutate(()=>c.inventoryItems=(c.inventoryItems||[]).filter(x=>x.id!==iid));}
  function editCharacterGold(id){const c=state.characters.find(x=>x.id===id);if(!c||!canEditCharacter(c))return;openForm("Update "+c.name+" gold",[{name:"gold",label:"Gold pieces (GP)",type:"number",min:0,value:safeNumber(c.gold)}],v=>mutate(()=>c.gold=Math.max(0,safeNumber(v.gold))));}
  function addSharedItem(){if(!isDM())return;openForm("Add party loot",inventoryItemFields(),v=>{if(!v.name.trim())return alert("Please enter an item name.");mutate(()=>{if(!Array.isArray(state.sharedInventory))state.sharedInventory=[];state.sharedInventory.push({id:makeId(),name:v.name.trim(),category:v.category,rarity:v.rarity,quantity:Math.max(1,safeNumber(v.quantity,1)),weight:v.weight,value:v.value,notes:v.notes});});});}
  function editSharedItem(id){if(!isDM())return;const item=state.sharedInventory?.find(x=>x.id===id);if(!item)return;openForm("Edit party loot",inventoryItemFields(item),v=>{if(!v.name.trim())return alert("Please enter an item name.");mutate(()=>Object.assign(item,{name:v.name.trim(),category:v.category,rarity:v.rarity,quantity:Math.max(1,safeNumber(v.quantity,1)),weight:v.weight,value:v.value,notes:v.notes}));});}
  function removeSharedItem(id){if(!isDM()||!confirm("Remove this item from the shared party stash?"))return;mutate(()=>state.sharedInventory=(state.sharedInventory||[]).filter(x=>x.id!==id));}
  function editPartyGold(){if(!isDM())return;openForm("Update shared party funds",[{name:"gold",label:"Party gold pieces (GP)",type:"number",min:0,value:safeNumber(state.partyGold)}],v=>mutate(()=>state.partyGold=Math.max(0,safeNumber(v.gold))));}
  function renderSessions(){
    const list=$("session-list"),sessions=Array.isArray(state.sessions)?state.sessions:[];
    list.innerHTML=sessions.length?sessions.slice().sort((a,b)=>safeNumber(b.number)-safeNumber(a.number)).map(s=>{
      let out='<article class="list-card session-card"><div class="list-meta">SESSION '+safeNumber(s.number)+' · '+escapeHTML(s.date||"Date not recorded")+'</div><h3>'+escapeHTML(s.title||"Untitled session")+'</h3>';
      const sections=[["SUMMARY",s.summary],["IMPORTANT DECISIONS",s.decisions],["DISCOVERIES",s.discoveries],["NPC ENCOUNTERS",s.npcEncounters],["UNRESOLVED HOOKS",s.openHooks],["COMBAT & PARTY SNAPSHOT",s.combatSummary]];
      sections.forEach(([label,value])=>{if(value)out+='<div class="session-detail"><strong>'+label+'</strong><p>'+escapeHTML(value)+'</p></div>';});
      if(isDM())out+='<div class="card-actions"><button onclick="Hub.editSession(\''+s.id+'\')">EDIT</button><button onclick="Hub.removeSession(\''+s.id+'\')">DELETE</button></div>';
      return out+'</article>';
    }).join(""):empty("No sessions have been recorded yet.");
  }
  function renderSessionMode(){
    const host=$("session-mode-panel");if(!host)return;
    if(!isDM()){host.hidden=true;return;}host.hidden=false;
    const mode=state.sessionMode;
    if(!mode||!mode.active){host.innerHTML='<div class="session-mode-idle"><div><div class="hub-kicker">READY WHEN YOU ARE</div><h3>SESSION MODE</h3><p>Open a focused DM workspace for tonight’s game. Your notes will be saved into Session History when you finish.</p></div><button class="hub-button" onclick="Hub.startSessionMode()">▶ START SESSION</button></div>';return;}
    const started=mode.startedAt?new Date(mode.startedAt).toLocaleString():"Just now";
    host.innerHTML='<div class="session-mode-active"><div class="session-mode-heading"><div><div class="hub-kicker">SESSION IN PROGRESS</div><h3>'+escapeHTML(mode.title||"Untitled session")+'</h3><p>Started '+escapeHTML(started)+' · Notes save automatically</p></div><span class="session-live-pill">● LIVE</span></div><div class="session-mode-tools"><div class="session-mode-stat"><b>'+state.characters.length+'</b><span>CHARACTERS</span></div><div class="session-mode-stat"><b>'+state.quests.filter(q=>(q.status||"Active").toLowerCase()==="active").length+'</b><span>ACTIVE QUESTS</span></div><div class="session-mode-stat"><b>'+getCombat().combatants.length+'</b><span>COMBATANTS</span></div><button class="small-button" onclick="Hub.jumpTo(\'page-party\')">PARTY TRACKER</button><button class="small-button" onclick="Hub.jumpTo(\'quest-list\')">QUEST BOARD</button><button class="small-button" onclick="Hub.jumpTo(\'combat-tracker\')">COMBAT TRACKER</button><button class="small-button" onclick="Hub.jumpTo(\'page-journal\')">JOURNAL</button><button class="small-button" onclick="Hub.go(\'characters\')">NPC ARCHIVE</button><button class="small-button" onclick="Hub.go(\'world\')">WORLD ENCYCLOPEDIA</button><button class="small-button" onclick="Hub.go(\'calendar\')">CALENDAR</button></div><label class="session-notes-label">LIVE SESSION NOTES<textarea id="session-mode-notes" rows="7" placeholder="Record events, player decisions, clues, improvised details…">'+escapeHTML(mode.notes||"")+'</textarea></label><div class="session-mode-footer"><span class="list-meta">Notes are stored in shared campaign data, not private DM notes.</span><div><button class="small-button" onclick="Hub.cancelSessionMode()">DISCARD</button> <button class="hub-button" onclick="Hub.finishSessionMode()">FINISH & SAVE RECAP</button></div></div></div>';
    const notes=$("session-mode-notes");if(notes)notes.addEventListener("input",()=>{if(!state.sessionMode?.active)return;state.sessionMode.notes=notes.value;persist();});
  }
  function startSessionMode(){
    if(!isDM()||state.sessionMode?.active)return;
    const next=Math.max(0,...(state.sessions||[]).map(s=>safeNumber(s.number)))+1;
    openForm("Start a session",[{name:"title",label:"Session title",value:"Session "+next,required:true,full:true}],v=>{mutate(()=>state.sessionMode={active:true,title:v.title.trim()||"Untitled session",startedAt:new Date().toISOString(),notes:""});});
  }
  function finishSessionMode(){
    if(!isDM()||!state.sessionMode?.active)return;
    const mode=state.sessionMode,combat=getCombat();
    const combatSummary=["Combat: "+(combat.active?"active":"inactive")+" · Round "+safeNumber(combat.round,1),...combat.combatants.map(c=>c.name+" ("+safeNumber(c.hp)+"/"+safeNumber(c.maxHp)+" HP"+(c.conditions?" · "+c.conditions:"")+")")].join("\n");
    const number=Math.max(0,...(state.sessions||[]).map(s=>safeNumber(s.number)))+1;
    openForm("Finish session & save recap",[
      {name:"number",label:"Session number",type:"number",min:1,value:number},{name:"date",label:"Date played",value:new Date().toLocaleDateString()},
      {name:"title",label:"Session title",value:mode.title||"Session "+number,required:true,full:true},
      {name:"summary",label:"Session recap",type:"textarea",rows:5,value:mode.notes||"",full:true},
      {name:"decisions",label:"Important decisions",type:"textarea",rows:3,full:true},{name:"discoveries",label:"Discoveries & clues",type:"textarea",rows:3,full:true},
      {name:"npcEncounters",label:"NPCs encountered",type:"textarea",rows:3,full:true},{name:"openHooks",label:"Unresolved hooks & future leads",type:"textarea",rows:3,full:true}
    ],v=>{if(!v.title.trim())return alert("Please enter a session title.");mutate(()=>{if(!Array.isArray(state.sessions))state.sessions=[];state.sessions.push({id:makeId(),number:Math.max(1,safeNumber(v.number,number)),date:v.date,title:v.title.trim(),summary:v.summary,decisions:v.decisions,discoveries:v.discoveries,npcEncounters:v.npcEncounters,openHooks:v.openHooks,sessionNotes:mode.notes||"",combatSummary,startedAt:mode.startedAt,endedAt:new Date().toISOString(),source:"session-mode"});state.sessionMode=null;});go("dashboard");});
  }
  function cancelSessionMode(){if(!isDM()||!state.sessionMode?.active||!confirm("Discard the active session notes?"))return;mutate(()=>state.sessionMode=null);}

  function sessionFields(s={}){return [
    {name:"number",label:"Session number",type:"number",min:1,value:s.number??(Math.max(0,...(state.sessions||[]).map(x=>safeNumber(x.number)))+1)},
    {name:"date",label:"Date played",value:s.date||"",placeholder:"e.g. 17 November 2026"},
    {name:"title",label:"Session title",value:s.title||"",required:true,full:true},
    {name:"summary",label:"Session summary",type:"textarea",rows:5,value:s.summary||"",full:true},
    {name:"decisions",label:"Important decisions",type:"textarea",rows:3,value:s.decisions||"",full:true},
    {name:"discoveries",label:"Discoveries & clues",type:"textarea",rows:3,value:s.discoveries||"",full:true},
    {name:"npcEncounters",label:"NPCs encountered",type:"textarea",rows:3,value:s.npcEncounters||"",full:true},
    {name:"openHooks",label:"Unresolved hooks & future leads",type:"textarea",rows:3,value:s.openHooks||"",full:true}
  ];}
  function addSession(){if(!isDM())return;openForm("Log a session",sessionFields(),v=>{if(!v.title.trim())return alert("Please enter a session title.");mutate(()=>{if(!Array.isArray(state.sessions))state.sessions=[];state.sessions.push({id:makeId(),number:Math.max(1,safeNumber(v.number,1)),date:v.date,title:v.title.trim(),summary:v.summary,decisions:v.decisions,discoveries:v.discoveries,npcEncounters:v.npcEncounters,openHooks:v.openHooks});});});}
  function editSession(id){if(!isDM())return;const s=state.sessions?.find(x=>x.id===id);if(!s)return;openForm("Edit session "+s.number,sessionFields(s),v=>{if(!v.title.trim())return alert("Please enter a session title.");mutate(()=>Object.assign(s,{number:Math.max(1,safeNumber(v.number,1)),date:v.date,title:v.title.trim(),summary:v.summary,decisions:v.decisions,discoveries:v.discoveries,npcEncounters:v.npcEncounters,openHooks:v.openHooks}));});}
  function removeSession(id){if(!isDM()||!confirm("Delete this session record?"))return;mutate(()=>state.sessions=(state.sessions||[]).filter(s=>s.id!==id));}

  async function blobToDataURL(blob){
    return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||""));reader.onerror=()=>reject(new Error("The map image could not be read for export."));reader.readAsDataURL(blob);});
  }
  async function exportCampaign(){
    if(!isDM())return alert("Only the DM can export a campaign.");
    try{
      let mapImage="";
      if(state.mapUrl){
        const response=await fetch(state.mapUrl);if(!response.ok)throw new Error("The campaign map could not be fetched. Check the map URL and try again.");
        mapImage=await blobToDataURL(await response.blob());
      }
      const payload={format:"adventurers-chronicle-campaign",version:1,exportedAt:new Date().toISOString(),data:state,mapImage};
      const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
      const url=URL.createObjectURL(blob),a=document.createElement("a");
      a.href=url;a.download=(state.title||"campaign").toLowerCase().replace(/[^a-z0-9]+/g,"-")+"-backup.json";a.click();URL.revokeObjectURL(url);
    }catch(err){alert(err.message||"Campaign export failed.");}
  }
  async function importCampaign(file){
    if(!isDM()||!file)return;
    if(file.size>16*1024*1024)return alert("Please choose a campaign backup smaller than 16MB.");
    const reader=new FileReader();
    reader.onload=async()=>{
      try{
        const parsed=JSON.parse(String(reader.result||""));
        const incoming=parsed.format==="adventurers-chronicle-campaign"?parsed.data:parsed;
        if(!incoming||typeof incoming!=="object"||Array.isArray(incoming)||!Array.isArray(incoming.characters)||!Array.isArray(incoming.quests)||!Array.isArray(incoming.npcs))throw new Error("This doesn't look like a valid campaign backup.");
        if(!confirm("Import this campaign and replace the current campaign content? This cannot be undone. Player accounts and access codes will stay unchanged."))return;
        let mapUrl=incoming.mapUrl||"";
        if(parsed.mapImage){
          const parts=String(parsed.mapImage).match(/^data:([^;]+);base64,(.+)$/);
          if(!parts)throw new Error("The backup's map image is invalid.");
          const bytes=Uint8Array.from(atob(parts[2]),ch=>ch.charCodeAt(0));
          const fileType=parts[1]||"image/png",mapFile=new File([bytes],"campaign-map."+((fileType.split("/")[1]||"png").replace("jpeg","jpg")),{type:fileType});
          const {data:upload,error:signError}=await client.functions.invoke("campaign-data",{body:{action:"create-map-upload",filename:mapFile.name,content_type:fileType}});
          if(signError)throw signError;
          const {error:uploadError}=await client.storage.from("campaign-maps").uploadToSignedUrl(upload.path,upload.token,mapFile,{contentType:fileType,upsert:false});
          if(uploadError)throw uploadError;
          mapUrl=upload.publicUrl;
        }
        const fresh={...blank(),...incoming,mapUrl};
        ["markers","mapDrawings","characters","quests","npcs","journal","events","notices","elapsedDays","sharedInventory","sessions","homebrew","encounters","worldEntries"].forEach(k=>{if(!Array.isArray(fresh[k]))fresh[k]=[];});
        mutate(()=>state=fresh);
        alert("Campaign imported. The map image and campaign content were restored; player accounts and access codes were not changed.");
      }catch(err){alert(err.message||"The campaign backup could not be imported.");}
    };
    reader.onerror=()=>alert("The selected backup file could not be read.");
    reader.readAsText(file);
  }
  function takeRest(id,type){
    const c=state.characters.find(x=>x.id===id);if(!c||!canEditCharacter(c))return;
    const level=Math.max(1,safeNumber(c.level,1)),spent=Math.max(0,safeNumber(c.hitDiceUsed)),available=Math.max(0,level-spent);
    if(type==="long"&&safeNumber(c.hp)<1)return alert("A character must have at least 1 HP to benefit from a long rest.");
    if(type==="short"&&c.rulesEdition==="2024"&&safeNumber(c.hp)<1)return alert("A character must have at least 1 HP to benefit from a short rest under the 2024 rules.");
    const finish=hitDiceToSpend=>{
      mutate(()=>{
        if(!Array.isArray(c.resources))c.resources=[];
        if(type==="short"){
          c.resources.forEach(r=>{if(r.recovery==="short"||r.recovery==="short or long")r.used=0;});
          if(String(c.className||"").toLowerCase().includes("warlock")&&Array.isArray(c.spellSlots))c.spellSlots.forEach(slot=>{if(slot.total>0)slot.used=0;});
          const dieMatch=String(c.hitDice||"").match(/d(\d+)/i),dieSize=dieMatch?Math.max(2,Number(dieMatch[1])):8;
          const con=Math.floor((safeNumber(c.constitution,10)-10)/2);
          let healing=0;
          for(let i=0;i<hitDiceToSpend;i++){const rolled=Math.floor(Math.random()*dieSize)+1+con;healing+=c.rulesEdition==="2024"?Math.max(1,rolled):Math.max(0,rolled);}
          c.hitDiceUsed=Math.min(level,spent+hitDiceToSpend);
          c.hp=Math.min(safeNumber(c.maxHp),safeNumber(c.hp)+healing);
        }else{
          c.hp=Math.max(0,safeNumber(c.maxHp));
          if(Array.isArray(c.spellSlots))c.spellSlots.forEach(slot=>slot.used=0);
          c.resources.forEach(r=>{if(r.recovery!=="manual")r.used=0;});
          c.hitDiceUsed=c.rulesEdition==="2024"?0:Math.max(0,spent-Math.max(1,Math.floor(level/2)));
          if(c.rulesEdition==="2024"||c._foodAndDrinkForRest)c.exhaustion=Math.max(0,safeNumber(c.exhaustion)-1);
        }
        c.lastRest={type,at:new Date().toISOString()};
      });
      status((type==="long"?"Long Rest":"Short Rest")+" completed for "+c.name+".");
    };
    if(type==="short"){
      openForm("Short rest — "+c.name,[
        {name:"dice",label:"Hit Dice to spend (maximum "+available+")",type:"number",min:0,max:available,value:0}
      ],v=>finish(Math.max(0,Math.min(available,safeNumber(v.dice)))));
    }else{
      if(c.rulesEdition!=="2024"&&safeNumber(c.exhaustion)>0){
        const fed=confirm("Has "+c.name+" had food and drink during this long rest? If yes, 2014 rules reduce Exhaustion by 1.");
        c._foodAndDrinkForRest=fed;
      }
      if(!confirm("Finish a long rest for "+c.name+"? This restores HP, spell slots and long-rest resources.")){delete c._foodAndDrinkForRest;return;}
      finish(0);delete c._foodAndDrinkForRest;
    }
  }

  function editResources(id){
    const c=state.characters.find(x=>x.id===id);if(!c||!canEditCharacter(c))return;
    const resources=Array.isArray(c.resources)?c.resources:[];
    openForm("Class & character resources",[
      {name:"resources",label:"One resource per line: Name | maximum | used | recovery (short/long/manual)",type:"textarea",rows:8,value:resources.map(r=>[r.name,r.max,r.used,r.recovery].join(" | ")).join("\n"),full:true}
    ],v=>{
      const parsed=v.resources.split("\n").map(line=>line.split("|").map(x=>x.trim())).filter(x=>x[0]).map(x=>({id:makeId(),name:x[0],max:Math.max(0,safeNumber(x[1])),used:Math.max(0,Math.min(safeNumber(x[1]),safeNumber(x[2]))),recovery:["short","long","short or long","manual"].includes((x[3]||"long").toLowerCase())?(x[3]||"long").toLowerCase():"long"}));
      mutate(()=>c.resources=parsed);
    });
  }


  let referenceCategory="spells", referenceResults=[], referenceEdition="both", referencePage=1, referenceHasNext=false, referenceLastQuery="";
  const referenceTypes={spells:"spells",species:"species",classes:"classes",backgrounds:"backgrounds",feats:"feats",items:"items",creatures:"creatures",languages:"languages",conditions:"conditions"};
  function sourceEdition(entry){
    const key=String(entry.document?.key||"").toLowerCase();
    return key.includes("2024")?"2024":key.includes("2014")?"2014":"Open5e";
  }
  async function loadReference(){
    const list=$("reference-results");if(!list)return;
    const q=$("reference-search").value.trim();if(q!==referenceLastQuery){referencePage=1;referenceLastQuery=q;}list.innerHTML=empty("Searching the open rules library...");
    try{
      const params=new URLSearchParams({limit:"30",ordering:"name",page:String(referencePage),document__key__in:"srd-2014,srd-2024"});
      if(q)params.set("name__icontains",q);
      if(referenceEdition==="2014")params.set("document__key__iexact","srd-2014");
      if(referenceEdition==="2024")params.set("document__key__iexact","srd-2024");
      const response=await fetch("https://api.open5e.com/v2/"+referenceTypes[referenceCategory]+"/?"+params.toString());
      if(!response.ok)throw new Error("The open reference source is temporarily unavailable.");
      const payload=await response.json();referenceResults=Array.isArray(payload.results)?payload.results:[];referenceHasNext=!!payload.next;
      renderReferenceLibrary();
    }catch(err){list.innerHTML=empty(err.message+" You can still create campaign homebrew.");}
  }
  function referenceEntries(){
    const home=(state.homebrew||[]).filter(x=>x.category===referenceCategory||x.category==="all").map(x=>({...x,_homebrew:true}));
    return [...home,...referenceResults];
  }
  function renderReferenceLibrary(){
    const list=$("reference-results");if(!list)return;
    const entries=referenceEntries();
    if(!entries.length){list.innerHTML=empty("No entries found. Try a different search or create a homebrew entry.");const pager=$("reference-pagination");if(pager)pager.innerHTML="";return;}
    list.innerHTML=entries.map((entry,i)=>{
      const source=entry._homebrew?"CAMPAIGN HOMEBREW":(entry.document?.display_name||entry.document?.name||"OPEN SRD");
      const edition=entry._homebrew?(entry.edition||"Homebrew"):sourceEdition(entry);
      const detail=String(entry.desc||entry.description||"").replace(/<[^>]*>/g," ").slice(0,300);
      const meta=referenceCategory==="spells"?"Level "+safeNumber(entry.level)+" · "+(entry.school||"Spell"):source;
      const addLabel=referenceCategory==="creatures"?"ADD TO NPC ARCHIVE":"ADD TO CHARACTER";
      const controls='<button onclick="Hub.openReferenceEntry('+i+')">VIEW DETAILS</button><button onclick="Hub.applyReferenceEntry('+i+')">'+addLabel+'</button>';
      const own=entry._homebrew&&(isDM()||entry.ownerId===member?.id)?"<button onclick=\"Hub.editHomebrew(\'"+entry.id+"\')\">EDIT</button><button onclick=\"Hub.removeHomebrew(\'"+entry.id+"\')\">DELETE</button>":"";
      return '<article class="reference-card"><div class="reference-card-top"><span class="tag">'+escapeHTML(edition)+'</span><span class="list-meta">'+escapeHTML(meta)+'</span></div><h3>'+escapeHTML(entry.name||"Untitled")+'</h3><p>'+escapeHTML(detail||"Open the entry to view details.")+'</p><div class="list-meta">'+escapeHTML(source)+'</div><div class="card-actions">'+controls+own+'</div></article>';
    }).join("");
    $("reference-count").textContent=entries.length+" entries shown · Open SRD material and campaign homebrew";
    const pager=$("reference-pagination");if(pager)pager.innerHTML=(referencePage>1?'<button class="small-button" onclick="Hub.changeReferencePage(-1)">← PREVIOUS</button>':"")+(referenceHasNext?'<button class="small-button" onclick="Hub.changeReferencePage(1)">NEXT PAGE →</button>':"");
  }
  function openReferenceEntry(index){
    const entry=referenceEntries()[index];if(!entry)return;
    openForm(entry.name||"Reference entry",[
      {name:"details",label:"Description",type:"textarea",rows:8,value:entry.desc||entry.description||"No description available."},
      {name:"mechanics",label:"Mechanics",type:"textarea",rows:5,value:entry.mechanics||""},
      {name:"source",label:"Source",value:entry.document?.display_name||entry.source||"Open5e / campaign homebrew"},
      {name:"edition",label:"Rules version",value:entry._homebrew?entry.edition:sourceEdition(entry)}
    ],()=>{});
    const saveButton=$("hub-modal-form")?.querySelector("button[type=submit]");if(saveButton)saveButton.textContent="CLOSE";
  }
  function applyReferenceEntry(index){
    const entry=referenceEntries()[index];if(!entry)return;
    if(referenceCategory==="creatures"){
      if(!isDM())return alert("Only the DM can add creatures to the NPC archive.");
      mutate(()=>state.npcs.unshift({id:makeId(),name:entry.name||"Unnamed creature",role:"Creature",description:entry.desc||"",challengeRating:entry.cr||entry.challenge_rating||"",hp:safeNumber(entry.hp),maxHp:Math.max(1,safeNumber(entry.hp,1)),ac:safeNumber(entry.ac),npcActions:Array.isArray(entry.actions)?entry.actions.map(x=>x.name+": "+x.desc).join("\n"):"",source:entry.document?.display_name||"Open5e"}));
      alert(entry.name+" added to the NPC archive.");return;
    }
    const owned=state.characters.filter(c=>canEditCharacter(c));
    if(!owned.length)return alert("Create a character first, or ask the DM to add one to the archive.");
    openForm("Add "+entry.name+" to a character",[
      {name:"characterId",label:"Character",type:"select",required:true,options:owned.map(c=>({value:c.id,label:c.name}))}
    ],v=>{
      const c=state.characters.find(x=>x.id===v.characterId);if(!c||!canEditCharacter(c))return;
      const detail=String(entry.desc||entry.description||"").replace(/<[^>]*>/g," ").trim();
      const line="• "+entry.name+(entry.level!==undefined?" (Level "+entry.level+")":"")+" — "+detail;
      mutate(()=>{
        if(referenceCategory==="classes")c.className=entry.name;
        else if(referenceCategory==="species")c.race=entry.name;
        else if(referenceCategory==="backgrounds")c.background=entry.name;
        else if(referenceCategory==="spells"){
          if(!Array.isArray(c.spellbook))c.spellbook=[];
          if(!c.spellbook.some(s=>String(s.name).toLowerCase()===String(entry.name).toLowerCase()))c.spellbook.push({id:makeId(),name:entry.name,level:safeNumber(entry.level),school:entry.school||"",castingTime:entry.casting_time||"",range:entry.range||"",components:entry.components||"",duration:entry.duration||"",concentration:!!entry.concentration,ritual:!!entry.ritual,prepared:true,notes:detail,description:entry.desc||entry.description||""});
          c.spells=[c.spells||"",line].filter(Boolean).join("\n");
        }
        else if(referenceCategory==="items"){
          if(!Array.isArray(c.inventoryItems))c.inventoryItems=[];
          c.inventoryItems.push({id:makeId(),name:entry.name,category:"Equipment",rarity:"Common",quantity:1,notes:detail});
        }else c.features=[c.features||"",line].filter(Boolean).join("\n");
      });
      alert(entry.name+" added to "+c.name+".");
    });
  }
  function homebrewFields(entry={}){
    return [
      {name:"name",label:"Entry name",value:entry.name||"",required:true,full:true},
      {name:"category",label:"Category",type:"select",value:entry.category||referenceCategory,options:Object.keys(referenceTypes).map(k=>({value:k,label:k[0].toUpperCase()+k.slice(1)})).concat([{value:"all",label:"Other / general"}])},
      {name:"edition",label:"Rules version",type:"select",value:entry.edition||"Both",options:["2014","2024","Both","Homebrew / setting-specific"].map(x=>({value:x,label:x}))},
      {name:"description",label:"Description & rules",type:"textarea",rows:8,value:entry.description||"",full:true},
      {name:"mechanics",label:"Mechanics, prerequisites & effects",type:"textarea",rows:5,value:entry.mechanics||"",full:true},
      {name:"source",label:"Source / attribution (optional)",value:entry.source||"",full:true}
    ];
  }
  function addHomebrew(){
    openForm("Create homebrew reference",homebrewFields(),v=>{
      if(!v.name.trim())return alert("Enter an entry name.");
      mutate(()=>{if(!Array.isArray(state.homebrew))state.homebrew=[];state.homebrew.unshift({id:makeId(),ownerId:member.id,name:v.name.trim(),category:v.category,edition:v.edition,description:v.description,mechanics:v.mechanics,source:v.source,createdAt:new Date().toISOString()});});
      renderReferenceLibrary();
    });
  }
  function editHomebrew(id){
    const e=state.homebrew?.find(x=>x.id===id);if(!e||(!isDM()&&e.ownerId!==member.id))return;
    openForm("Edit homebrew entry",homebrewFields(e),v=>mutate(()=>Object.assign(e,{name:v.name.trim(),category:v.category,edition:v.edition,description:v.description,mechanics:v.mechanics,source:v.source})));
  }
  function removeHomebrew(id){
    const e=state.homebrew?.find(x=>x.id===id);if(!e||(!isDM()&&e.ownerId!==member.id)||!confirm("Delete this homebrew entry?"))return;
    mutate(()=>state.homebrew=state.homebrew.filter(x=>x.id!==id));renderReferenceLibrary();
  }
  function changeReferencePage(amount){referencePage=Math.max(1,referencePage+amount);loadReference();}
  function selectReferenceCategory(category){
    if(!referenceTypes[category])return;referenceCategory=category;referencePage=1;
    root.querySelectorAll("[data-reference-category]").forEach(b=>b.classList.toggle("active",b.dataset.referenceCategory===category));
    loadReference();
  }

  function searchCampaign(){
    const q=$("campaign-search-input").value.trim().toLowerCase(),results=$("campaign-search-results"),count=$("campaign-search-count");
    if(!q){count.textContent="Enter a search term to explore your campaign.";results.innerHTML="";return;}
    const entries=[],add=(type,id,title,body,page)=>{const text=[title,body].filter(Boolean).join(" ");if(text.toLowerCase().includes(q))entries.push({type,id,title,body,page});};
    (state.characters||[]).forEach(x=>add(x.isNPC?"Companion":"Character",x.id,x.name,[x.player,x.race,x.className,x.backstory,x.notes,x.gear].join(" "),"characters"));
    (state.npcs||[]).forEach(x=>add("NPC",x.id,x.name,[x.role,x.description,x.location,x.relationship].join(" "),"characters"));
    (state.quests||[]).forEach(x=>add("Quest",x.id,x.title,[x.description,x.reward,x.status].join(" "),"quests"));
    (state.journal||[]).forEach(x=>add("Journal",x.id,x.title,[x.date,x.author,x.body].join(" "),"journal"));
    (state.events||[]).forEach(x=>add("Calendar event",x.id,x.title,[x.date,x.description,x.fantasyDate?JSON.stringify(x.fantasyDate):""].join(" "),"calendar"));
    (state.markers||[]).forEach(x=>add("Map location",x.id,x.label,x.description||"","adventure"));
    (state.sharedInventory||[]).forEach(x=>add("Party loot",x.id,x.name,[x.category,x.rarity,x.notes,x.value].join(" "),"inventory"));
    (state.characters||[]).forEach(c=>(c.inventoryItems||[]).forEach(x=>add("Character item",x.id,x.name,[c.name,x.category,x.rarity,x.notes,x.value].join(" "),"inventory")));
    (state.sessions||[]).forEach(x=>add("Session "+safeNumber(x.number),x.id,x.title,[x.date,x.summary,x.decisions,x.discoveries,x.npcEncounters,x.openHooks].join(" "),"sessions"));
    (state.homebrew||[]).forEach(x=>add("Homebrew",x.id,x.name,[x.description,x.mechanics,x.category,x.edition].join(" "),"reference"));
    count.textContent=entries.length+" result"+(entries.length===1?"":"s")+" found";
    results.innerHTML=entries.length?entries.map(x=>'<button class="search-result" onclick="Hub.openSearchResult(\''+x.page+'\')"><span class="tag">'+escapeHTML(x.type)+'</span><strong>'+escapeHTML(x.title||"Untitled")+'</strong><span>'+escapeHTML((x.body||"").slice(0,180))+'</span></button>').join(""):empty("No matching campaign records found.");
  }
  function openSearchResult(page){go(page==="sessions"?"dashboard":page);}

  function renderDashboard() {
    $("stat-party").textContent = state.characters.filter(c=>!c.isNPC).length;
    $("stat-quests").textContent = state.quests.filter(q=>q.status==="Active").length;
    $("stat-npcs").textContent = state.npcs.length;
    $("stat-journal").textContent = state.journal.length;

    const party = state.characters.slice(0,5);
    $("dashboard-party").innerHTML = party.length
      ? party.map(c=>`
        <div class="hp-line">
          <span>${escapeHTML(c.name)}</span>
          <span>${safeNumber(c.hp)}/${safeNumber(c.maxHp)} HP</span>
        </div>
        <div class="hp-bar"><div class="hp-fill" style="width:${Math.max(0,Math.min(100,safeNumber(c.hp)/Math.max(1,safeNumber(c.maxHp))*100))}%;background:#79bd91"></div></div>
      `).join("")
      : empty("No adventurers have joined yet.");

    const quests = state.quests.filter(q=>q.status==="Active").slice(0,4);
    $("dashboard-quests").innerHTML = quests.length
      ? quests.map(q=>`<div class="list-card quest-card" onclick="Hub.openQuestDetails('${q.id}')"><h3>${escapeHTML(q.title)}</h3><p>${escapeHTML(q.description)}</p></div>`).join("")
      : empty("No active quests.");

    const notice = state.notices[0];
    $("dashboard-notice").innerHTML = notice
      ? `<div class="notice-feature"><div class="list-meta">${escapeHTML(notice.date)}</div><h3>${escapeHTML(notice.title)}</h3><p>${escapeHTML(notice.body)}</p></div>`
      : empty("No announcements yet.");

    const events = [...state.events].sort((a,b)=>(a.date||"").localeCompare(b.date||"")).slice(0,3);
    $("dashboard-events").innerHTML = events.length
      ? events.map(e=>`<div class="list-card"><div class="list-meta">${escapeHTML(e.date)}</div><h3>${escapeHTML(e.title)}</h3></div>`).join("")
      : empty("No upcoming events.");
  }

  function renderMap() {
    const img = $("world-map-image");
    const placeholder = $("map-placeholder");
    img.hidden = !state.mapUrl;
    placeholder.style.display = state.mapUrl ? "none" : "flex";
    if (state.mapUrl && img.src !== state.mapUrl) img.src = state.mapUrl;

    $("map-markers").innerHTML = state.markers.map(m=>`
      <div class="map-marker" data-marker="${escapeHTML(m.id)}"
        title="${escapeHTML(m.label)}"
        style="left:${m.x}%;top:${m.y}%;background:${escapeHTML(m.colour)}">
        <span class="marker-label">${escapeHTML(m.label)}</span>
      </div>
    `).join("");

    const colours = {};
    state.markers.forEach(m=>colours[m.colour]=true);
    const defaults={"#E66D69":"Red marker","#6D9DD5":"Blue marker","#76B68A":"Green marker","#D6AD5D":"Gold marker","#B28BD6":"Purple marker","#E69AC0":"Pink marker","#E9E5DA":"White marker"};
    $("map-legend").innerHTML = [...new Set([...Object.keys(defaults),...Object.keys(colours)])].map(c=>
      `<span class="legend-item"><i class="legend-dot" style="background:${escapeHTML(c)}"></i>${escapeHTML(state.markerLegend?.[c]||defaults[c]||c)}</span>`
    ).join("") || "No markers placed yet.";
    redrawMapCanvas();
  }

  function renderParty() {
    $("party-list").innerHTML = state.characters.length
      ? state.characters.map(c=>characterCard(c,true)).join("")
      : empty("Your party is waiting for its first adventurer.");
  }

  function getCombat(){
    const combat=state.combat&&typeof state.combat==="object"?state.combat:{active:false,round:1,activeTurnId:null,combatants:[]};
    if(!Array.isArray(combat.combatants))combat.combatants=[];
    combat.round=Math.max(1,safeNumber(combat.round,1));
    return combat;
  }
  function ensureCombat(){
    if(!state.combat||typeof state.combat!=="object")state.combat={active:false,round:1,activeTurnId:null,combatants:[]};
    if(!Array.isArray(state.combat.combatants))state.combat.combatants=[];
    state.combat.round=Math.max(1,safeNumber(state.combat.round,1));
    return state.combat;
  }
  function orderedCombatants(){
    return [...getCombat().combatants].sort((a,b)=>safeNumber(b.initiative)-safeNumber(a.initiative)||safeNumber(a.order)-safeNumber(b.order));
  }
  function renderCombat(){
    const combat=getCombat(),list=$("combat-list"),ordered=orderedCombatants();
    $("combat-round-label").textContent=combat.active?("ROUND "+combat.round):ordered.length?"ENCOUNTER READY":"NO ACTIVE ENCOUNTER";
    $("combat-round-label").classList.toggle("is-active",combat.active);
    const controls=root.querySelector(".combat-toolbar");
    if(controls)controls.style.display=isDM()?"":"none";
    $("combat-view-note").textContent=isDM()?"Only the DM can change combat. Everyone can follow the initiative order and live HP updates.":"Live encounter view · The DM manages initiative and combatant stats.";
    if(!ordered.length){list.innerHTML=empty(isDM()?"Add party members or enemies to prepare an encounter.":"The DM hasn't added anyone to this encounter yet.");return;}
    list.innerHTML=ordered.map((c,i)=>{
      const hp=Math.max(0,safeNumber(c.hp)),max=Math.max(1,safeNumber(c.maxHp,1)),percent=Math.max(0,Math.min(100,hp/max*100));
      const active=combat.active&&combat.activeTurnId===c.id;
      const conditions=String(c.conditions||"").split(",").map(x=>x.trim()).filter(Boolean);
      return `<article class="combatant-card ${active?"is-current-turn":""} ${hp===0?"is-unconscious":""}">
        <div class="combat-initiative">${safeNumber(c.initiative)}</div>
        <div class="combatant-main">
          <div class="combatant-title-row"><div><span class="combatant-type">${escapeHTML(c.kind||"COMBATANT")}</span><h3>${escapeHTML(c.name)}</h3></div>${active?'<span class="turn-indicator">CURRENT TURN</span>':""}</div>
          <div class="combatant-stats"><span><strong>${hp}</strong> / ${max} HP</span><span>${safeNumber(c.ac)} AC</span></div>
          <div class="hp-bar"><div class="hp-fill" style="width:${percent}%;background:${percent<25?"#dc6969":percent<50?"#d6ad5d":"#79bd91"}"></div></div>
          <div class="combat-conditions">${conditions.length?conditions.map(x=>'<span class="tag">'+escapeHTML(x)+'</span>').join(""):'<span class="combat-no-conditions">No conditions</span>'}</div>
          ${isDM()?'<div class="combatant-actions"><button onclick="Hub.adjustCombatHP(\''+c.id+'\',-5)">−5 HP</button><button onclick="Hub.adjustCombatHP(\''+c.id+'\',-1)">−1 HP</button><button onclick="Hub.adjustCombatHP(\''+c.id+'\',1)">+1 HP</button><button onclick="Hub.adjustCombatHP(\''+c.id+'\',5)">+5 HP</button><button onclick="Hub.editCombatant(\''+c.id+'\')">EDIT</button><button onclick="Hub.removeCombatant(\''+c.id+'\')">REMOVE</button></div>':""}
        </div>
      </article>`;
    }).join("");
  }
  function addCombatant(){
    if(!isDM())return;
    const combat=ensureCombat(),options=[];
    state.characters.forEach(c=>{if(!combat.combatants.some(x=>x.sourceId===c.id))options.push({value:"character:"+c.id,label:c.name+" · "+(c.isNPC?"Companion":"Player")});});
    state.npcs.forEach(n=>{if(!combat.combatants.some(x=>x.sourceId===n.id))options.push({value:"npc:"+n.id,label:n.name+" · NPC"});});
    if(!options.length)return alert("Everyone in the character and NPC archive is already in this encounter. Use ADD ENEMY for another combatant.");
    openForm("Add combatant from archive",[
      {name:"source",label:"Choose a character or NPC",type:"select",options,required:true,full:true},
      {name:"initiative",label:"Initiative roll",type:"number",value:"",placeholder:"Enter the initiative roll"},
      {name:"conditions",label:"Conditions (comma-separated)",placeholder:"e.g. Poisoned, Prone",full:true}
    ],v=>{
      const [type,id]=v.source.split(":"),source=type==="npc"?state.npcs.find(x=>x.id===id):state.characters.find(x=>x.id===id);
      if(!source||ensureCombat().combatants.some(x=>x.sourceId===id))return;
      const combatant={id:makeId(),sourceId:id,sourceType:type,name:source.name,kind:type==="npc"?"NPC":source.isNPC?"ALLY":"PLAYER",initiative:v.initiative.trim()===""?safeNumber(source.initiative):safeNumber(v.initiative),hp:safeNumber(source.hp),maxHp:Math.max(1,safeNumber(source.maxHp,1)),ac:safeNumber(source.ac),conditions:v.conditions||"",order:Date.now()};
      mutate(()=>ensureCombat().combatants.push(combatant));
    });
  }
  function addCombatEnemy(){
    if(!isDM())return;
    openForm("Add enemy to encounter",[
      {name:"name",label:"Enemy name",required:true,full:true},
      {name:"initiative",label:"Initiative roll",type:"number",value:0},
      {name:"hp",label:"Current HP",type:"number",value:10,min:0},
      {name:"maxHp",label:"Maximum HP",type:"number",value:10,min:1},
      {name:"ac",label:"Armour class",type:"number",value:10,min:0},
      {name:"conditions",label:"Conditions (comma-separated)",placeholder:"e.g. Restrained, Frightened",full:true}
    ],v=>{
      if(!v.name.trim())return alert("Please enter an enemy name.");
      const maxHp=Math.max(1,safeNumber(v.maxHp,10));
      mutate(()=>ensureCombat().combatants.push({id:makeId(),name:v.name.trim(),kind:"ENEMY",initiative:safeNumber(v.initiative),hp:Math.min(maxHp,Math.max(0,safeNumber(v.hp))),maxHp,ac:safeNumber(v.ac),conditions:v.conditions||"",order:Date.now()}));
    });
  }
  function adjustCombatHP(id,amount){
    if(!isDM())return;const combatant=ensureCombat().combatants.find(x=>x.id===id);if(!combatant)return;
    mutate(()=>{
      combatant.hp=Math.max(0,Math.min(safeNumber(combatant.maxHp,1),safeNumber(combatant.hp)+amount));
      if(combatant.sourceId){
        const source=combatant.sourceType==="npc"?state.npcs.find(x=>x.id===combatant.sourceId):state.characters.find(x=>x.id===combatant.sourceId);
        if(source)source.hp=combatant.hp;
      }
    });
  }
  function editCombatant(id){
    if(!isDM())return;const c=ensureCombat().combatants.find(x=>x.id===id);if(!c)return;
    openForm("Edit combatant",[
      {name:"name",label:"Name",value:c.name,required:true,full:true},
      {name:"initiative",label:"Initiative",type:"number",value:c.initiative},
      {name:"hp",label:"Current HP",type:"number",value:c.hp,min:0},
      {name:"maxHp",label:"Maximum HP",type:"number",value:c.maxHp,min:1},
      {name:"ac",label:"Armour class",type:"number",value:c.ac,min:0},
      {name:"conditions",label:"Conditions (comma-separated)",value:c.conditions||"",full:true}
    ],v=>{
      const maxHp=Math.max(1,safeNumber(v.maxHp,1));
      mutate(()=>{
        Object.assign(c,{name:v.name.trim(),initiative:safeNumber(v.initiative),hp:Math.min(maxHp,Math.max(0,safeNumber(v.hp))),maxHp,ac:safeNumber(v.ac),conditions:v.conditions||""});
        if(c.sourceId){
          const source=c.sourceType==="npc"?state.npcs.find(x=>x.id===c.sourceId):state.characters.find(x=>x.id===c.sourceId);
          if(source){source.hp=c.hp;source.maxHp=c.maxHp;source.ac=c.ac;}
        }
      });
    });
  }
  function removeCombatant(id){
    if(!isDM())return;const combat=ensureCombat();if(!combat.combatants.some(x=>x.id===id))return;
    if(!confirm("Remove this combatant from the encounter?"))return;
    mutate(()=>{combat.combatants=combat.combatants.filter(x=>x.id!==id);if(combat.activeTurnId===id)combat.activeTurnId=null;if(!combat.combatants.length){combat.active=false;combat.round=1;}});
  }
  function startCombat(){
    if(!isDM())return;const combat=ensureCombat(),ordered=orderedCombatants();if(!ordered.length)return alert("Add at least one combatant before starting.");
    mutate(()=>{combat.active=true;combat.round=1;combat.activeTurnId=ordered[0].id;});
  }
  function nextCombatTurn(){
    if(!isDM())return;const combat=ensureCombat(),ordered=orderedCombatants();if(!combat.active||!ordered.length)return;
    const index=ordered.findIndex(x=>x.id===combat.activeTurnId),next=index<0?0:(index+1)%ordered.length;
    mutate(()=>{if(index>=0&&next===0)combat.round++;combat.activeTurnId=ordered[next].id;});
  }
  function previousCombatTurn(){
    if(!isDM())return;const combat=ensureCombat(),ordered=orderedCombatants();if(!combat.active||!ordered.length)return;
    const index=ordered.findIndex(x=>x.id===combat.activeTurnId),previous=index<=0?ordered.length-1:index-1;
    mutate(()=>{if(index===0)combat.round=Math.max(1,combat.round-1);combat.activeTurnId=ordered[previous].id;});
  }
  function endCombat(){
    if(!isDM())return;const combat=ensureCombat();if(!combat.active)return;
    mutate(()=>{combat.active=false;combat.activeTurnId=null;});
  }
  function clearCombat(){
    if(!isDM())return;if(!confirm("Clear this encounter and remove all its combatants?"))return;
    mutate(()=>{state.combat={active:false,round:1,activeTurnId:null,combatants:[]};});
  }

  function characterCard(c,tracker) {
    const hp = safeNumber(c.hp);
    const max = Math.max(1,safeNumber(c.maxHp,1));
    const percent = Math.max(0,Math.min(100,hp/max*100));
    const slots = (c.spellSlots||Array.from({length:9},()=>({used:0,total:0})));
    const canEdit = canEditCharacter(c);
    return `
      <article class="character-card">
        <div class="card-subtitle">${c.isNPC?"NPC COMPANION":"PLAYER CHARACTER"}</div>
        ${c.portrait?`<img src="${escapeHTML(c.portrait)}" alt="" style="width:76px;height:76px;object-fit:cover;border-radius:8px;margin:8px 0">`:""}
        <h3>${escapeHTML(c.name)}</h3>
        <p>${escapeHTML(c.race)} ${escapeHTML(c.className)} · Level ${safeNumber(c.level,1)}</p>
        ${tracker?`
          <div class="hp-line"><strong>HIT POINTS</strong><span>${hp} / ${max}</span></div>
          <div class="hp-bar"><div class="hp-fill" style="width:${percent}%;background:${percent<25?"#dc6969":percent<50?"#d6ad5d":"#79bd91"}"></div></div>
          ${canEdit?`<div class="card-actions">
            <button onclick="Hub.changeHP('${c.id}',-1)">−1 HP</button>
            <button onclick="Hub.changeHP('${c.id}',-5)">−5 HP</button>
            <button onclick="Hub.changeHP('${c.id}',1)">+1 HP</button>
            <button onclick="Hub.changeHP('${c.id}',5)">+5 HP</button>
            <button onclick="Hub.openCharacterSheet('${c.id}')">OPEN CHARACTER SHEET</button>
            <button onclick="Hub.configureSlots('${c.id}')">SET SPELL SLOTS</button><button onclick="Hub.takeRest('${c.id}','short')">SHORT REST</button><button onclick="Hub.takeRest('${c.id}','long')">LONG REST</button><button onclick="Hub.editResources('${c.id}')">RESOURCES</button>
          </div>`:`<p class="list-meta">VIEW ONLY</p>`}
          <div class="hp-line"><strong>ARMOUR CLASS</strong><span>${safeNumber(c.ac)}</span></div>
          <div class="hp-line"><strong>INITIATIVE / SPEED</strong><span>${safeNumber(c.initiative)} / ${safeNumber(c.speed)} ft</span></div>
          <div class="card-subtitle" style="margin-top:17px">SPELL SLOTS — USED / TOTAL</div>
          <div class="spell-slots">
            ${slots.map((s,i)=>`
              <div class="spell-level">
                <strong>${i+1}</strong>
                <span>${safeNumber(s.used)}/${safeNumber(s.total)}</span>
                ${canEdit?`<div class="card-actions">
                  <button onclick="Hub.slot('${c.id}',${i},-1)">−</button>
                  <button onclick="Hub.slot('${c.id}',${i},1)">+</button>
                </div>`:""}
              </div>
            `).join("")}
          </div>
          ${(c.resources||[]).length?`<div class="card-subtitle" style="margin-top:14px">CLASS & CHARACTER RESOURCES</div>${c.resources.map(r=>`<div class="hp-line"><span>${escapeHTML(r.name)}</span><span>${safeNumber(r.used)}/${safeNumber(r.max)} used · ${escapeHTML(r.recovery||"long")} rest</span></div>`).join("")}`:""}
          ${safeNumber(c.exhaustion)>0?`<div class="hp-line"><strong>EXHAUSTION · ${escapeHTML(c.rulesEdition||"2014")}</strong><span>${safeNumber(c.exhaustion)}/6</span></div>`:""}
        `:`
          <div class="tag">HP ${hp}/${max}</div>
          <div class="tag">AC ${safeNumber(c.ac)}</div>
          <details class="archive-profile-details"><summary>VIEW FULL PROFILE</summary>
            <p><b>Background:</b> ${escapeHTML(c.background||"Not recorded")} · <b>Alignment:</b> ${escapeHTML(c.alignment||"Not recorded")}</p>
            <p><b>STR</b> ${safeNumber(c.strength,10)} · <b>DEX</b> ${safeNumber(c.dexterity,10)} · <b>CON</b> ${safeNumber(c.constitution,10)} · <b>INT</b> ${safeNumber(c.intelligence,10)} · <b>WIS</b> ${safeNumber(c.wisdom,10)} · <b>CHA</b> ${safeNumber(c.charisma,10)}</p>
            ${c.personality?'<p><b>Personality:</b> '+escapeHTML(c.personality)+'</p>':""}
            ${c.ideals?'<p><b>Ideals:</b> '+escapeHTML(c.ideals)+'</p>':""}
            ${c.bonds?'<p><b>Bonds:</b> '+escapeHTML(c.bonds)+'</p>':""}
            ${c.flaws?'<p><b>Flaws:</b> '+escapeHTML(c.flaws)+'</p>':""}
            ${c.backstory?'<p><b>Backstory:</b> '+escapeHTML(c.backstory)+'</p>':""}
            ${c.languagesKnown?'<p><b>Languages:</b> '+escapeHTML(c.languagesKnown)+'</p>':""}
          </details>
          ${canEdit?`<div class="card-actions">
            <button onclick="Hub.openCharacterSheet('${c.id}')">OPEN CHARACTER SHEET</button>
            <button onclick="Hub.removeCharacter('${c.id}')">REMOVE</button>
          </div>`:`<p class="list-meta">VIEW ONLY</p>`}
        `}
      </article>`;
  }


  function openCharacterSheet(id) {
    const c=state.characters.find(x=>x.id===id);if(!c)return;
    activeCharacterSheetId=id;
    const tab=root.querySelector('[data-tab="character-sheet"]');if(tab)tab.hidden=false;
    go("character-sheet");renderCharacterSheet();renderSpellbook();
  }

  function renderCharacterSheet(){
    const host=$("character-sheet-content"),c=state.characters.find(x=>x.id===activeCharacterSheetId);
    if(!host)return;if(!c){host.innerHTML=empty("Choose a character from the archive.");return;}
    const can=canEditCharacter(c),mod=v=>{const n=Math.floor((safeNumber(v,10)-10)/2);return n>=0?"+"+n:String(n);};
    const level=Math.max(1,safeNumber(c.level,1)),proficiencyBonus=2+Math.floor((level-1)/4),signed=n=>n>=0?"+"+n:String(n);
    const abilityForSave={strength:"strength",dexterity:"dexterity",constitution:"constitution",intelligence:"intelligence",wisdom:"wisdom",charisma:"charisma"};
    const skillAbility={"Acrobatics":"dexterity","Animal Handling":"wisdom","Arcana":"intelligence","Athletics":"strength","Deception":"charisma","History":"intelligence","Insight":"wisdom","Intimidation":"charisma","Investigation":"intelligence","Medicine":"wisdom","Nature":"intelligence","Perception":"wisdom","Performance":"charisma","Persuasion":"charisma","Religion":"intelligence","Sleight of Hand":"dexterity","Stealth":"dexterity","Survival":"wisdom"};
    const abilities=[["STR","strength"],["DEX","dexterity"],["CON","constitution"],["INT","intelligence"],["WIS","wisdom"],["CHA","charisma"]];
    const slots=Array.isArray(c.spellSlots)?c.spellSlots:Array.from({length:9},()=>({used:0,total:0}));
    const spells=Array.isArray(c.spellbook)?c.spellbook:[],items=Array.isArray(c.inventoryItems)?c.inventoryItems:[];
    const section=(id,title,body)=>'<div class="beyond-tab-panel'+(id==="core"?" active":"")+'" data-sheet-panel="'+id+'"><section class="beyond-section" id="sheet-'+id+'"><div class="beyond-section-heading"><h3>'+title+'</h3></div>'+body+'</section></div>';
    const skillText=String(c.skills||"").split(/[,;\n]+/).map(x=>x.trim()).filter(Boolean).map(x=>{const name=x.replace(/\s*\(.*\)$/ ,"").trim(),key=skillAbility[name]||"dexterity",expertise=/expertise/i.test(x),bonus=Math.floor((safeNumber(c[key],10)-10)/2)+proficiencyBonus+(expertise?proficiencyBonus:0);return name+" "+signed(bonus)+(expertise?" EXP":"");});
    const saveText=String(c.savingThrows||"").split(/[,;\n]+/).map(x=>x.trim()).filter(Boolean).map(x=>{const name=x.replace(/\s*\(.*\)$/ ,"").trim(),key=abilityForSave[name.toLowerCase()]||name.toLowerCase(),bonus=Math.floor((safeNumber(c[key],10)-10)/2)+proficiencyBonus;return name+" "+signed(bonus);});
    const hp=safeNumber(c.hp),maxHp=Math.max(1,safeNumber(c.maxHp,1));
    const attacks=Array.isArray(c.attackOptions)?c.attackOptions:[];
    const legacyAttacks=String(c.attacks||"").split(/[\n]+/).map(x=>x.trim()).filter(Boolean);
    const attackEntries=attacks.length?attacks:legacyAttacks.map(line=>{const parts=line.split("|").map(x=>x.trim());if(parts.length>=3)return{id:"legacy-"+line,name:parts[0],bonus:parts[1].replace(/[^+\-0-9]/g,""),damage:parts[2],damageType:parts[3]||"",notes:""};const match=line.match(/^(.+?):\s*([+-]?\d+)\s*to hit,\s*(.+)$/i);return{id:"legacy-"+line,name:match?match[1]:line,bonus:match?match[2]:"0",damage:match?match[3].replace(/\s+(?:slashing|piercing|bludgeoning|fire|cold|lightning|acid|poison|necrotic|radiant|psychic|force|thunder) damage.*$/i,""):"—",damageType:"",notes:match?"Legacy attack entry":"Add attack details to roll damage"};});
    const attackHtml=attackEntries.length?attackEntries.map(a=>'<article class="beyond-attack-row"><div class="beyond-attack-info"><strong>'+escapeHTML(a.name)+'</strong><span>'+escapeHTML(a.damage||"—")+' '+escapeHTML(a.damageType||"")+'</span>'+(a.notes?'<small>'+escapeHTML(a.notes)+'</small>':"")+'</div><div class="beyond-attack-bonus">'+escapeHTML((safeNumber(a.bonus)>=0?"+":"")+safeNumber(a.bonus))+'</div><div class="beyond-row-actions">'+(can?'<button class="small-button" onclick="Hub.rollAttack(\''+c.id+'\',\''+escapeHTML(a.id)+'\')">ROLL TO HIT</button><button class="small-button" onclick="Hub.rollDamage(\''+c.id+'\',\''+escapeHTML(a.id)+'\')">ROLL DAMAGE</button>':'')+(can&&!String(a.id).startsWith("legacy-")?'<button class="small-button" onclick="Hub.editAttack(\''+c.id+'\',\''+a.id+'\')">EDIT</button><button class="small-button" onclick="Hub.removeAttack(\''+c.id+'\',\''+a.id+'\')">REMOVE</button>':"")+'</div></article>').join(""):empty("No attacks added yet.");
    const conditions=Array.isArray(c.activeConditions)?c.activeConditions:[];
    const spellsHtml=spells.length?spells.map(s=>'<article class="beyond-list-row"><div class="beyond-row-main"><strong>'+escapeHTML(s.name)+'</strong><p>'+escapeHTML(s.description||s.notes||"No description recorded.")+'</p><small>'+escapeHTML(s.level?"Level "+s.level:"Cantrip")+' · '+escapeHTML(s.school||"Spell")+' · '+escapeHTML(s.castingTime||"—")+' · '+escapeHTML(s.range||"—")+'</small></div><div class="beyond-row-actions"><span class="beyond-pill">'+(s.prepared?"PREPARED":"KNOWN")+'</span>'+(can?'<button class="small-button" onclick="Hub.togglePreparedSpell(\''+c.id+'\',\''+s.id+'\')">'+(s.prepared?"UNPREPARE":"PREPARE")+'</button><button class="small-button" onclick="Hub.editSpell(\''+c.id+'\',\''+s.id+'\')">EDIT</button>':"")+'</div></article>').join(""):empty("No spells recorded.");
    const itemsHtml=items.length?items.map(x=>{const type=x.equipmentType||"other",details=[x.equipped?"EQUIPPED":"Carried",x.weight?x.weight:null,x.value?x.value:null,x.damage?("Damage "+x.damage+" "+(x.damageType||"")):null,["light","medium","heavy"].includes(type)?("Armour AC "+safeNumber(x.armorBase)):type==="shield"?"Shield +2 AC":null,x.attackBonus?("Attack "+(x.attackBonus>0?"+":"")+x.attackBonus):null].filter(Boolean).join(" · ");return '<article class="beyond-list-row '+(x.equipped?"beyond-item-equipped":"")+'"><div class="beyond-row-main"><strong>'+escapeHTML(x.name)+'</strong><p>'+escapeHTML(x.category||"Equipment")+' · '+escapeHTML(x.rarity||"Common")+' · Qty '+safeNumber(x.quantity,1)+'</p><small>'+escapeHTML(details)+'</small>'+(x.notes?'<p>'+escapeHTML(x.notes)+'</p>':"")+'</div>'+(can?'<div class="beyond-row-actions">'+(["weapon","light","medium","heavy","shield"].includes(type)?'<button class="small-button" onclick="Hub.toggleEquippedItem(\''+c.id+'\',\''+x.id+'\')">'+(x.equipped?"UNEQUIP":"EQUIP")+'</button>':"")+'<button class="small-button" onclick="Hub.editCharacterItem(\''+c.id+'\',\''+x.id+'\')">EDIT</button><button class="small-button" onclick="Hub.removeCharacterItem(\''+c.id+'\',\''+x.id+'\')">REMOVE</button></div>':"")+'</article>';}).join(""):empty("No equipment recorded.");
    const slotHtml=slots.map((s,i)=>'<div class="beyond-slot"><span>LEVEL '+(i+1)+'</span><strong>'+safeNumber(s.used)+' / '+safeNumber(s.total)+'</strong><div class="beyond-slot-dots">'+Array.from({length:Math.min(10,safeNumber(s.total))},(_,n)=>'<i class="'+(n<safeNumber(s.used)?"used":"")+'"></i>').join("")+'</div>'+(can?'<div class="beyond-row-actions"><button class="small-button" onclick="Hub.slot(\''+c.id+'\','+i+',-1)">−</button><button class="small-button" onclick="Hub.slot(\''+c.id+'\','+i+',1)">+</button></div>':"")+'</div>').join("");
    host.innerHTML='<div class="beyond-sheet"><div class="beyond-topline"><button class="small-button" onclick="Hub.go(\'characters\')">← CHARACTER ARCHIVE</button><span class="beyond-edition">'+escapeHTML(c.rulesEdition||"2014")+' RULES</span></div>'+
    '<header class="beyond-hero">'+(c.portrait?'<img class="beyond-portrait" src="'+escapeHTML(c.portrait)+'" alt="Character portrait">':'<div class="beyond-portrait placeholder">✦</div>')+'<div class="beyond-identity"><div class="hub-kicker">'+(c.isNPC?"NPC / COMPANION":"PLAYER CHARACTER")+'</div><h2>'+escapeHTML(c.name)+'</h2><p>'+escapeHTML(c.race||"Species not set")+' · '+escapeHTML(c.className||"Class not set")+' · Level '+safeNumber(c.level,1)+'</p><div class="beyond-tags"><span>'+escapeHTML(c.background||"Background not set")+'</span><span>'+escapeHTML(c.alignment||"Alignment not set")+'</span><span>'+escapeHTML(c.player||"No player assigned")+'</span></div></div><div class="beyond-hero-actions">'+(can?'<button class="hub-button" onclick="Hub.editCharacter(\''+c.id+'\')">EDIT CHARACTER</button><button class="small-button" onclick="Hub.takeRest(\''+c.id+'\',\'short\')">SHORT REST</button><button class="small-button" onclick="Hub.takeRest(\''+c.id+'\',\'long\')">LONG REST</button>':'<span class="list-meta">VIEW ONLY</span>')+'</div></header>'+
    '<div class="beyond-combat-strip"><div class="beyond-hp"><span>HIT POINTS</span><strong>'+hp+' <small>/ '+maxHp+'</small></strong><div class="beyond-hp-track"><i style="width:'+Math.max(0,Math.min(100,hp/maxHp*100))+'%"></i></div><small>'+safeNumber(c.tempHp)+' TEMP HP</small>'+(can?'<div class="beyond-row-actions"><button class="small-button" onclick="Hub.changeHP(\''+c.id+'\',1)">+1 HP</button><button class="small-button" onclick="Hub.changeHP(\''+c.id+'\',-1)">−1 HP</button><button class="small-button" onclick="Hub.setTempHP(\''+c.id+'\')">TEMP HP</button></div>':"")+'</div>'+
    '<div class="beyond-stat"><span>ARMOUR CLASS</span><strong>'+(calculateCharacterAC(c)??safeNumber(c.ac,10))+'</strong>'+(calculateCharacterAC(c)!==null?'<small>From equipped gear</small>':"")+'</div><div class="beyond-stat"><span>INITIATIVE</span><strong>'+mod(c.dexterity)+'</strong></div><div class="beyond-stat"><span>SPEED</span><strong>'+safeNumber(c.speed,30)+' ft</strong></div><div class="beyond-stat"><span>PROFICIENCY</span><strong>+'+proficiencyBonus+'</strong></div><div class="beyond-stat"><span>HIT DICE</span><strong>'+escapeHTML(c.hitDice||"—")+'</strong><small>'+safeNumber(c.hitDiceUsed)+' spent</small></div></div>'+
    '<nav class="beyond-tab-nav" role="tablist" aria-label="Character sheet sections"><button type="button" role="tab" data-sheet-tab="core" aria-selected="true" class="active" onclick="Hub.showCharacterSection(this.dataset.sheetTab)">Core</button><button type="button" role="tab" data-sheet-tab="saves" aria-selected="false" class="" onclick="Hub.showCharacterSection(this.dataset.sheetTab)">Saves & Skills</button><button type="button" role="tab" data-sheet-tab="combat" aria-selected="false" class="" onclick="Hub.showCharacterSection(this.dataset.sheetTab)">Combat</button><button type="button" role="tab" data-sheet-tab="spells" aria-selected="false" class="" onclick="Hub.showCharacterSection(this.dataset.sheetTab)">Spells</button><button type="button" role="tab" data-sheet-tab="inventory" aria-selected="false" class="" onclick="Hub.showCharacterSection(this.dataset.sheetTab)">Inventory</button><button type="button" role="tab" data-sheet-tab="features" aria-selected="false" class="" onclick="Hub.showCharacterSection(this.dataset.sheetTab)">Features</button><button type="button" role="tab" data-sheet-tab="notes" aria-selected="false" class="" onclick="Hub.showCharacterSection(this.dataset.sheetTab)">Notes</button></nav>'+
    '<div class="beyond-main-grid"><div class="beyond-primary">'+
    section("core","ABILITY SCORES",'<div class="beyond-abilities">'+abilities.map(([label,key])=>'<div class="beyond-ability"><span>'+label+'</span><strong>'+safeNumber(c[key],10)+'</strong><b>'+mod(c[key])+'</b></div>').join("")+'</div>')+
    section("saves","SAVING THROWS & SKILLS",'<div class="beyond-two-col"><div><h4>Saving throws</h4>'+(saveText.length?saveText.map(x=>'<span class="beyond-pill">'+escapeHTML(x)+'</span>').join(""):empty("Not recorded."))+'</div><div><h4>Skills</h4>'+(skillText.length?skillText.map(x=>'<span class="beyond-pill">'+escapeHTML(x)+'</span>').join(""):empty("Not recorded."))+'</div></div>')+
    section("combat","ATTACKS & COMBAT",'<div class="beyond-subheading"><div><h4>Attacks</h4><p>Roll an attack or its damage directly from the sheet.</p></div>'+(can?'<button class="hub-button" onclick="Hub.addAttack(\''+c.id+'\')">+ ADD ATTACK</button>':"")+'</div><div class="beyond-attack-list">'+attackHtml+'</div><div class="beyond-subheading"><div><h4>Hit points & damage</h4><p>Damage is applied to temporary HP before current HP.</p></div>'+(can?'<div class="beyond-row-actions"><button class="small-button" onclick="Hub.applyDamage(\''+c.id+'\')">APPLY DAMAGE</button><button class="small-button" onclick="Hub.healCharacter(\''+c.id+'\')">HEAL</button></div>':"")+'</div><div class="beyond-subheading"><div><h4>Death saving throws</h4><p>'+safeNumber(c.deathSuccesses)+'/3 successes · '+safeNumber(c.deathFailures)+'/3 failures'+(c.deathStatus?' · '+escapeHTML(c.deathStatus.toUpperCase()):"")+'</p></div></div><div class="beyond-death-saves"><div><span>SUCCESSES</span><strong>'+safeNumber(c.deathSuccesses)+' / 3</strong>'+(can?'<div class="beyond-row-actions"><button class="small-button" onclick="Hub.deathSave(\''+c.id+'\',1)">+ SUCCESS</button></div>':"")+'</div><div><span>FAILURES</span><strong>'+safeNumber(c.deathFailures)+' / 3</strong>'+(can?'<div class="beyond-row-actions"><button class="small-button" onclick="Hub.deathSave(\''+c.id+'\',-1)">+ FAILURE</button></div>':"")+'</div></div><div class="beyond-subheading"><div><h4>Active conditions</h4><p>Track effects currently affecting this character.</p></div>'+(can?'<button class="small-button" onclick="Hub.editConditions(\''+c.id+'\')">MANAGE CONDITIONS</button>':"")+'</div><div class="beyond-condition-list">'+(conditions.length?conditions.map(x=>'<span class="beyond-pill">'+escapeHTML(x)+'</span>').join(""):empty("No active conditions."))+'</div>')+
    section("spells","SPELLBOOK MANAGER",'<div class="beyond-subheading"><div><h4>Spell slots</h4><p>Track expended slots here.</p></div>'+(can?'<button class="small-button" onclick="Hub.configureSlots(\''+c.id+'\')">CONFIGURE SLOTS</button>':"")+'</div><div class="beyond-slots">'+slotHtml+'</div><div class="spellbook-embedded"><div class="reference-toolbar"><label for="spellbook-character">CHARACTER</label><select id="spellbook-character" onchange="Hub.selectSpellbookCharacter(this.value)"></select><button class="hub-button" type="button" onclick="Hub.addSpellToBook()">+ ADD SPELL</button></div><div class="spellbook-filter-toolbar"><input id="spellbook-filter-search" type="search" placeholder="Search spells..." oninput="Hub.renderSpellbook()"><select id="spellbook-filter-level" onchange="Hub.renderSpellbook()"><option value="all">All levels</option><option value="0">Cantrips</option><option value="1">Level 1</option><option value="2">Level 2</option><option value="3">Level 3</option><option value="4">Level 4</option><option value="5">Level 5</option><option value="6">Level 6</option><option value="7">Level 7</option><option value="8">Level 8</option><option value="9">Level 9</option></select><select id="spellbook-filter-prepared" onchange="Hub.renderSpellbook()"><option value="all">Prepared & known</option><option value="prepared">Prepared only</option><option value="known">Not prepared</option></select><select id="spellbook-filter-school" onchange="Hub.renderSpellbook()"><option value="all">All schools</option></select><select id="spellbook-filter-concentration" onchange="Hub.renderSpellbook()"><option value="all">Any concentration</option><option value="yes">Concentration</option><option value="no">No concentration</option></select></div><div id="spellbook-summary" class="list-meta"></div><div id="spellbook-list" class="reference-results"></div></div>')+
    section("inventory","EQUIPMENT & INVENTORY",'<div class="beyond-subheading"><div><h4>Carried equipment</h4><p>Gold: <b>'+safeNumber(c.gold)+' GP</b> · Equipped AC: <b>'+(calculateCharacterAC(c)??safeNumber(c.ac,10))+'</b></p><small>Equip armour and shields below to calculate AC automatically. Light armour adds full DEX, medium armour caps DEX at 2, heavy armour adds none.</small></div>'+(can?'<div class="beyond-row-actions"><button class="small-button" onclick="Hub.addCharacterItem(\''+c.id+'\')">+ ADD ITEM</button><button class="small-button" onclick="Hub.editCharacterGold(\''+c.id+'\')">EDIT GOLD</button></div>':"")+'</div>'+itemsHtml)+
    section("features","FEATURES, PROFICIENCIES & TRAITS",'<div class="beyond-two-col"><div><h4>Features & traits</h4><p class="beyond-pre">'+escapeHTML(c.features||"No features recorded.")+'</p></div><div><h4>Other proficiencies</h4><p><b>Languages:</b> '+escapeHTML(c.languagesKnown||"—")+'</p><p><b>Senses:</b> '+escapeHTML(c.senses||"—")+'</p><p><b>Other:</b> '+escapeHTML(c.proficiencies||"—")+'</p></div></div>')+
    section("notes","BACKGROUND & CHARACTER NOTES",'<div class="beyond-two-col"><div><h4>Personality</h4><p class="beyond-pre">'+escapeHTML(c.personality||"—")+'</p><h4>Ideals</h4><p class="beyond-pre">'+escapeHTML(c.ideals||"—")+'</p><h4>Bonds</h4><p class="beyond-pre">'+escapeHTML(c.bonds||"—")+'</p><h4>Flaws</h4><p class="beyond-pre">'+escapeHTML(c.flaws||"—")+'</p></div><div><h4>Backstory</h4><p class="beyond-pre">'+escapeHTML(c.backstory||"—")+'</p><h4>Additional notes</h4><p class="beyond-pre">'+escapeHTML(c.notes||"—")+'</p></div></div>')+
    '</div><aside class="beyond-sidebar"><section class="beyond-side-card"><h3>COMBAT RESOURCES</h3><p><b>Exhaustion:</b> '+safeNumber(c.exhaustion)+'</p><p><b>Death saves:</b> '+safeNumber(c.deathSuccesses)+'/3 successes · '+safeNumber(c.deathFailures)+'/3 failures</p>'+(can?'<button class="small-button" onclick="Hub.editResources(\''+c.id+'\')">MANAGE RESOURCES</button>':"")+'</section><section class="beyond-side-card"><h3>CHARACTER DETAILS</h3><p><b>Class & Subclass</b><br>'+escapeHTML(c.className||"—")+' '+escapeHTML(c.subclass||"")+'</p><p><b>Background</b><br>'+escapeHTML(c.background||"—")+'</p><p><b>Alignment</b><br>'+escapeHTML(c.alignment||"—")+'</p><p><b>Experience</b><br>'+escapeHTML(c.experience??"—")+'</p></section><section class="beyond-side-card"><h3>CONDITIONS</h3><p>'+escapeHTML(c.conditions||"No active conditions recorded.")+'</p>'+(can?'<button class="small-button" onclick="Hub.editCharacter(\''+c.id+'\')">EDIT CHARACTER</button>':"")+'</section></aside></div></div>';
    try{const saved=localStorage.getItem("dnd-sheet-tab:"+activeCharacterSheetId);if(saved&&["core","saves","combat","spells","inventory","features","notes"].includes(saved)){host.querySelectorAll("[data-sheet-panel]").forEach(p=>p.classList.toggle("active",p.dataset.sheetPanel===saved));host.querySelectorAll(".beyond-tab-nav button").forEach(b=>{const active=b.dataset.sheetTab===saved;b.classList.toggle("active",active);b.setAttribute("aria-selected",active?"true":"false");});}}catch(e){}
  }

  function setTempHP(id){
    const c=state.characters.find(x=>x.id===id);if(!c||!canEditCharacter(c))return;
    openForm("Set temporary hit points",[{name:"tempHp",label:"Temporary HP",type:"number",min:0,value:safeNumber(c.tempHp)}],v=>mutate(()=>c.tempHp=Math.max(0,safeNumber(v.tempHp))));
  }

  function renderCharacters() {
    const actions=root.querySelector(".archive-add-actions");
    if(actions){
      actions.querySelectorAll("[onclick*='Hub.addCharacter']").forEach(el=>el.style.display=isDM()?"none":"");
      actions.querySelectorAll("[onclick*='Hub.addNPC'],[onclick*='Hub.randomizeNPC']").forEach(el=>el.style.display=isDM()?"":"none");
    }
    const partyAdd=root.querySelector("#page-party .page-heading button[onclick*='Hub.addCharacter']");
    if(partyAdd)partyAdd.style.display=isDM()?"none":"";

    $("character-list").innerHTML = state.characters.length
      ? state.characters.map(c=>characterCard(c,false)).join("")
      : empty("No character profiles have been created.");
  }


  let activeSpellbookId="";
  function renderSpellbook(){
    const sel=$("spellbook-character"),list=$("spellbook-list");if(!sel||!list)return;
    const owned=state.characters.filter(c=>canEditCharacter(c));
    const visible=state.characters;
    if(!visible.length){sel.innerHTML="";list.innerHTML=empty("Create a character to manage a spellbook.");return;}
    if(!activeSpellbookId||!visible.some(c=>c.id===activeSpellbookId))activeSpellbookId=(owned[0]||visible[0]).id;
    sel.innerHTML=visible.map(c=>'<option value="'+escapeHTML(c.id)+'" '+(c.id===activeSpellbookId?'selected':'')+'>'+escapeHTML(c.name)+(canEditCharacter(c)?'':' · VIEW ONLY')+'</option>').join("");
    const c=visible.find(x=>x.id===activeSpellbookId),spells=Array.isArray(c.spellbook)?c.spellbook:[];
    const search=($("spellbook-filter-search")?.value||"").trim().toLowerCase(),levelFilter=$("spellbook-filter-level")?.value||"all",preparedFilter=$("spellbook-filter-prepared")?.value||"all",schoolFilter=$("spellbook-filter-school")?.value||"all",concentrationFilter=$("spellbook-filter-concentration")?.value||"all";
    const schools=[...new Set(spells.map(s=>String(s.school||"Other")).filter(Boolean))].sort(),schoolSelect=$("spellbook-filter-school");
    if(schoolSelect){const prior=schoolSelect.value;schoolSelect.innerHTML='<option value="all">All schools</option>'+schools.map(x=>'<option value="'+escapeHTML(x)+'">'+escapeHTML(x)+'</option>').join("");schoolSelect.value=schools.includes(prior)?prior:"all";}
    const filtered=spells.filter(s=>(!search||[s.name,s.description,s.notes,s.school].join(" ").toLowerCase().includes(search))&&(levelFilter==="all"||(levelFilter==="0"?safeNumber(s.level)===0:safeNumber(s.level)===safeNumber(levelFilter)))&&(preparedFilter==="all"||(preparedFilter==="prepared"?!!s.prepared:!s.prepared))&&(schoolFilter==="all"||String(s.school||"Other")===schoolFilter)&&(concentrationFilter==="all"||(concentrationFilter==="yes"?!!s.concentration:!s.concentration)));
    $("spellbook-summary").textContent=spells.length+" spells · "+spells.filter(s=>s.prepared).length+" prepared · "+(c.rulesEdition||"2014")+" rules · showing "+filtered.length;
    list.innerHTML=filtered.length?filtered.map(s=>'<article class="reference-card"><div class="reference-card-top"><span class="tag">'+(safeNumber(s.level)===0?'Cantrip':'Level '+safeNumber(s.level))+'</span><span class="list-meta">'+escapeHTML(s.school||'Spell')+(s.concentration?' · Concentration':'')+(s.ritual?' · Ritual':'')+'</span></div><h3>'+escapeHTML(s.name)+'</h3><p>'+escapeHTML(s.description||s.notes||'No description recorded.')+'</p><div class="spell-meta-grid"><span><b>CASTING</b> '+escapeHTML(s.castingTime||'—')+'</span><span><b>RANGE</b> '+escapeHTML(s.range||'—')+'</span><span><b>COMPONENTS</b> '+escapeHTML(s.components||'—')+'</span><span><b>DURATION</b> '+escapeHTML(s.duration||'—')+'</span></div>'+(s.concentration?'<p class="spell-extra-meta">Requires concentration</p>':"")+(s.ritual?'<p class="spell-extra-meta">Can be cast as a ritual</p>':"")+'<div class="card-actions">'+(canEditCharacter(c)?'<button onclick="Hub.togglePreparedSpell(\''+c.id+'\',\''+s.id+'\')">'+(s.prepared?'UNPREPARE':'PREPARE')+'</button><button onclick="Hub.editSpell(\''+c.id+'\',\''+s.id+'\')">EDIT</button><button onclick="Hub.removeSpell(\''+c.id+'\',\''+s.id+'\')">REMOVE</button>':'<span class="list-meta">VIEW ONLY</span>')+'</div></article>').join(""):empty("No spells in this spellbook yet. Add spells from the Rules Library or create a custom spell.");
  }
  function selectSpellbookCharacter(id){activeSpellbookId=id;renderSpellbook();}
  function spellFields(s={}){return [
    {name:"name",label:"Spell name",value:s.name||"",required:true,full:true},
    {name:"level",label:"Spell level (0 = cantrip)",type:"number",min:0,max:9,value:s.level??0},
    {name:"school",label:"School",value:s.school||""},
    {name:"castingTime",label:"Casting time",value:s.castingTime||""},
    {name:"range",label:"Range",value:s.range||""},
    {name:"components",label:"Components",value:s.components||""},
    {name:"duration",label:"Duration",value:s.duration||""},
    {name:"concentration",label:"Concentration? (yes/no)",value:s.concentration?"yes":"no"},
    {name:"ritual",label:"Ritual? (yes/no)",value:s.ritual?"yes":"no"},
    {name:"description",label:"Spell description & effects",type:"textarea",rows:6,value:s.description||"",full:true},
    {name:"notes",label:"Character-specific notes",type:"textarea",rows:3,value:s.notes||"",full:true}
  ];}
  function addSpellToBook(){const c=state.characters.find(x=>x.id===activeSpellbookId);if(!c||!canEditCharacter(c))return alert("Choose a character you can edit.");openForm("Add spell to "+c.name,spellFields(),v=>{if(!v.name.trim())return;mutate(()=>{if(!Array.isArray(c.spellbook))c.spellbook=[];c.spellbook.push({id:makeId(),...v,level:Math.max(0,Math.min(9,safeNumber(v.level))),concentration:/^(yes|true)$/i.test(v.concentration),ritual:/^(yes|true)$/i.test(v.ritual),prepared:true});});renderSpellbook();});}
  function addSpellToBookFor(id){activeSpellbookId=id;addSpellToBook();}
  function editSpell(cid,sid){const c=state.characters.find(x=>x.id===cid),s=c?.spellbook?.find(x=>x.id===sid);if(!c||!s||!canEditCharacter(c))return;openForm("Edit "+s.name,spellFields(s),v=>mutate(()=>Object.assign(s,{...v,level:Math.max(0,Math.min(9,safeNumber(v.level))),concentration:/^(yes|true)$/i.test(v.concentration),ritual:/^(yes|true)$/i.test(v.ritual)})));}
  function togglePreparedSpell(cid,sid){const c=state.characters.find(x=>x.id===cid),s=c?.spellbook?.find(x=>x.id===sid);if(!c||!s||!canEditCharacter(c))return;mutate(()=>s.prepared=!s.prepared);renderSpellbook();}
  function removeSpell(cid,sid){const c=state.characters.find(x=>x.id===cid);if(!c||!canEditCharacter(c)||!confirm("Remove this spell from the spellbook?"))return;mutate(()=>c.spellbook=(c.spellbook||[]).filter(s=>s.id!==sid));renderSpellbook();}

  let bestiaryResults=[];
  async function searchBestiary(){
    const host=$("bestiary-results");if(!host)return;const q=$("bestiary-search").value.trim();
    host.innerHTML=empty("Searching the open creature reference...");
    try{const p=new URLSearchParams({limit:"20",ordering:"name",document__key__in:"srd-2014,srd-2024"});if(q)p.set("name__icontains",q);
      const res=await fetch("https://api.open5e.com/v2/creatures/?"+p);if(!res.ok)throw new Error("Creature reference is unavailable.");const data=await res.json();bestiaryResults=data.results||[];
      host.innerHTML=bestiaryResults.length?bestiaryResults.map((m,i)=>'<article class="reference-card"><div class="reference-card-top"><span class="tag">CR '+escapeHTML(m.cr||m.challenge_rating||'?')+'</span><span class="list-meta">AC '+safeNumber(m.ac)+' · HP '+safeNumber(m.hp)+'</span></div><h3>'+escapeHTML(m.name)+'</h3><p>'+escapeHTML(String(m.desc||'').slice(0,320))+'</p><div class="card-actions"><button onclick="Hub.viewBestiary('+i+')">STAT BLOCK</button><button class="dm-only" onclick="Hub.saveBestiaryCreature('+i+')">SAVE TO ARCHIVE</button></div></article>').join(""):empty("No creatures found.");
      if(!isDM())host.querySelectorAll(".dm-only").forEach(x=>x.remove());
    }catch(e){host.innerHTML=empty(e.message+" You can still add a custom creature.");}
  }
  function viewBestiary(i){const m=bestiaryResults[i];if(!m)return;openForm(m.name+" · Stat block",[
    {name:"stats",label:"Core statistics",type:"textarea",rows:4,value:"CR: "+(m.cr||m.challenge_rating||"?")+"\nAC: "+(m.ac??"?")+"\nHP: "+(m.hp??"?")+"\nSpeed: "+(m.speed||"") ,full:true},
    {name:"abilities",label:"Abilities, traits & actions",type:"textarea",rows:9,value:(m.desc||"")+(Array.isArray(m.actions)?"\n\n"+m.actions.map(a=>a.name+": "+a.desc).join("\n\n"):""),full:true},
    {name:"source",label:"Source",value:m.document?.display_name||"Open SRD"}
  ],()=>{});const b=$("hub-modal-form")?.querySelector('button[type="submit"]');if(b)b.textContent="CLOSE";}
  function saveBestiaryCreature(i){if(!isDM())return;const m=bestiaryResults[i];if(!m)return;const n={id:makeId(),name:m.name,role:"Creature",description:m.desc||"",challengeRating:m.cr||m.challenge_rating||"",hp:safeNumber(m.hp),maxHp:Math.max(1,safeNumber(m.hp,1)),ac:safeNumber(m.ac),speed:m.speed||"",senses:m.senses||"",languages:m.languages||"",npcActions:Array.isArray(m.actions)?m.actions.map(a=>a.name+": "+a.desc).join("\n\n"):"",source:m.document?.display_name||"Open SRD",creatureType:m.type||"",size:m.size||"",alignment:m.alignment||""};mutate(()=>state.npcs.unshift(n));alert(m.name+" saved to the NPC archive.");}
  function addBestiaryCreature(){if(!isDM())return;openForm("Add custom creature",[
    {name:"name",label:"Creature name",required:true,full:true},{name:"creatureType",label:"Creature type"},{name:"size",label:"Size"},{name:"alignment",label:"Alignment"},
    {name:"challengeRating",label:"Challenge rating"},{name:"hp",label:"Hit points",type:"number",min:1,value:10},{name:"maxHp",label:"Maximum HP",type:"number",min:1,value:10},{name:"ac",label:"Armour class",type:"number",min:0,value:10},{name:"speed",label:"Speed"},{name:"senses",label:"Senses"},{name:"languages",label:"Languages"},{name:"description",label:"Description & traits",type:"textarea",rows:4,full:true},{name:"npcActions",label:"Actions & attacks",type:"textarea",rows:5,full:true}
  ],v=>{if(!v.name.trim())return;mutate(()=>state.npcs.unshift({id:makeId(),...v,hp:safeNumber(v.hp),maxHp:Math.max(1,safeNumber(v.maxHp)),ac:safeNumber(v.ac),role:"Creature"}));});
  }
  function renderEncounters(){const host=$("encounter-list");if(!host)return;const list=Array.isArray(state.encounters)?state.encounters:[];host.innerHTML=list.length?list.map(e=>'<article class="reference-card"><div class="reference-card-top"><span class="tag">'+escapeHTML(e.status||"Prepared")+'</span><span class="list-meta">'+(e.roster||[]).length+' roster entries</span></div><h3>'+escapeHTML(e.name)+'</h3><p>'+escapeHTML(e.notes||"No encounter notes.")+'</p><p>'+escapeHTML((e.roster||[]).map(x=>x.count+" × "+x.name).join(" · "))+'</p>'+(isDM()?'<div class="card-actions"><button onclick="Hub.editEncounter(\''+e.id+'\')">EDIT</button><button onclick="Hub.removeEncounter(\''+e.id+'\')">DELETE</button></div>':"")+'</article>').join(""):empty("No encounters prepared yet.");}
  function encounterFields(e={}){return [
    {name:"name",label:"Encounter name",value:e.name||"",required:true,full:true},
    {name:"roster",label:"One creature per line: creature name | quantity",type:"textarea",rows:6,value:(e.roster||[]).map(x=>x.name+" | "+x.count).join("\n"),full:true},
    {name:"notes",label:"Environment, tactics, objectives & treasure notes",type:"textarea",rows:5,value:e.notes||"",full:true},
    {name:"status",label:"Status",type:"select",value:e.status||"Prepared",options:["Prepared","In progress","Completed"].map(x=>({value:x,label:x}))}
  ];}
  function addEncounter(){if(!isDM())return;openForm("Build encounter",encounterFields(),v=>{if(!v.name.trim())return;const roster=v.roster.split("\n").map(x=>x.split("|")).filter(x=>x[0]?.trim()).map(x=>({name:x[0].trim(),count:Math.max(1,safeNumber(x[1],1))}));mutate(()=>state.encounters.unshift({id:makeId(),name:v.name.trim(),roster,notes:v.notes,status:v.status,createdAt:new Date().toISOString()}));});}
  function editEncounter(id){if(!isDM())return;const e=state.encounters.find(x=>x.id===id);if(!e)return;openForm("Edit encounter",encounterFields(e),v=>{const roster=v.roster.split("\n").map(x=>x.split("|")).filter(x=>x[0]?.trim()).map(x=>({name:x[0].trim(),count:Math.max(1,safeNumber(x[1],1))}));mutate(()=>Object.assign(e,{name:v.name.trim(),roster,notes:v.notes,status:v.status}));});}
  function removeEncounter(id){if(!isDM()||!confirm("Delete this prepared encounter?"))return;mutate(()=>state.encounters=state.encounters.filter(x=>x.id!==id));renderEncounters();}

  function worldFields(e={}){
    const fields=[
      {name:"title",label:"Entry title",value:e.title||"",required:true,full:true},
      {name:"category",label:"Category",type:"select",value:e.category||"Places",options:["Places","Regions","Factions","People","Deities","History","Culture","Other lore"].map(x=>({value:x,label:x}))},
      {name:"summary",label:"Short description",type:"textarea",rows:3,value:e.summary||"",full:true},
      {name:"details",label:"Full entry / lore",type:"textarea",rows:8,value:e.details||"",full:true},
      {name:"connections",label:"Related people, places, quests or clues",type:"textarea",rows:3,value:e.connections||"",full:true}
    ];
    if(isDM())fields.push({name:"secrets",label:"DM notes (campaign data is shared)",type:"textarea",rows:4,value:e.secrets||"",full:true});
    return fields;
  }
  function canEditWorldEntry(e){return isDM()||e?.ownerId===member?.id;}
  function renderWorld(){
    const host=$("world-list");if(!host)return;
    const q=($("world-search")?.value||"").toLowerCase(),cat=$("world-filter")?.value||"all";
    const list=(state.worldEntries||[]).filter(e=>(cat==="all"||e.category===cat)&&[e.title,e.summary,e.details,e.connections].join(" ").toLowerCase().includes(q));
    host.innerHTML=list.length?list.map(e=>'<article class="reference-card"><div class="reference-card-top"><span class="tag">'+escapeHTML(e.category)+'</span><span class="list-meta">'+escapeHTML(e.authorName||(e.ownerId===member?.id?member.display_name:"Campaign contributor"))+'</span></div><h3>'+escapeHTML(e.title)+'</h3><p>'+escapeHTML(e.summary||"")+'</p><details><summary>READ FULL ENTRY</summary><p>'+escapeHTML(e.details||"")+'</p>'+(e.connections?'<p><b>Connections:</b> '+escapeHTML(e.connections)+'</p>':"")+(isDM()&&e.secrets?'<p class="dm-secret"><b>DM notes:</b> '+escapeHTML(e.secrets)+'</p>':"")+'</details>'+(canEditWorldEntry(e)?'<div class="card-actions"><button onclick="Hub.editWorldEntry(\''+e.id+'\')">EDIT</button><button onclick="Hub.removeWorldEntry(\''+e.id+'\')">DELETE</button></div>':"")+'</article>').join(""):empty("No world entries match this search.");
  }
  function addWorldEntry(){
    openForm("Add world encyclopedia entry",worldFields(),v=>{
      if(!v.title.trim())return;
      const entry={id:makeId(),...v,ownerId:isDM()?null:member.id,authorName:member?.display_name||"Campaign",createdAt:new Date().toISOString()};
      mutate(()=>{if(!Array.isArray(state.worldEntries))state.worldEntries=[];state.worldEntries.unshift(entry);});
      renderWorld();
    });
  }
  function editWorldEntry(id){
    const e=state.worldEntries.find(x=>x.id===id);if(!e||!canEditWorldEntry(e))return;
    openForm("Edit "+e.title,worldFields(e),v=>{if(!v.title.trim())return;mutate(()=>Object.assign(e,v));renderWorld();});
  }
  function removeWorldEntry(id){
    const e=state.worldEntries.find(x=>x.id===id);if(!e||!canEditWorldEntry(e)||!confirm("Delete this world entry?"))return;
    mutate(()=>state.worldEntries=state.worldEntries.filter(x=>x.id!==id));renderWorld();
  }

  function renderQuests() {
    $("quest-list").innerHTML = state.quests.length
      ? state.quests.map(q=>{
        const status=(q.status||"Active").toLowerCase();
        return `<article class="list-card quest-card ${status==="completed"?"quest-completed":status==="failed"?"quest-failed":""}" onclick="Hub.openQuestDetails('${q.id}')">
          <div class="list-meta">${escapeHTML(q.status||"Active")} · ${escapeHTML(q.reward||"No reward specified")}</div>
          <h3>${escapeHTML(q.title)}</h3>
          <p>${escapeHTML(q.description||"No description provided.")}</p>
          ${isDM()? `<div class="quest-status-actions" onclick="event.stopPropagation()">
            <button class="complete-quest ${status==="completed"?"selected":""}" onclick="Hub.setQuestStatus('${q.id}','Completed')">✓ COMPLETED</button>
            <button class="fail-quest ${status==="failed"?"selected":""}" onclick="Hub.setQuestStatus('${q.id}','Failed')">✕ FAILED</button>
            <button onclick="Hub.editQuest('${q.id}')">EDIT</button>
            <button onclick="Hub.removeItem('quests','${q.id}')">DELETE</button>
          </div>`:""}
        </article>`;
      }).join("")
      : empty("No quests have been added.");
  }

  function renderNPCs() {
    $("npc-list").innerHTML = state.npcs.length
      ? state.npcs.map(n=>`
        <article class="character-card">
          ${n.portrait?`<img src="${escapeHTML(n.portrait)}" alt="" class="portrait-preview">`:""}
          <div class="card-subtitle">${escapeHTML(n.role||"UNKNOWN ROLE")}</div>
          <h3>${escapeHTML(n.name)}</h3>
          <p>${escapeHTML(n.description||"")}</p>
          <p><strong>Location:</strong> ${escapeHTML(n.location||"Unknown")}</p>
          <p><strong>HP / AC:</strong> ${safeNumber(n.hp)}/${safeNumber(n.maxHp)} · ${safeNumber(n.ac)} AC ${n.challengeRating?`· CR ${escapeHTML(n.challengeRating)}`:""}</p>
          <p><strong>Relationship:</strong> ${escapeHTML(n.relationship||"Unknown")}</p>
          <details class="archive-profile-details"><summary>VIEW FULL PROFILE</summary>
            <p><b>Species:</b> ${escapeHTML(n.race||"Unknown")} · <b>Alignment:</b> ${escapeHTML(n.alignment||"Unknown")} · <b>Location:</b> ${escapeHTML(n.location||"Unknown")}</p>
            <p><b>STR</b> ${safeNumber(n.strength,10)} · <b>DEX</b> ${safeNumber(n.dexterity,10)} · <b>CON</b> ${safeNumber(n.constitution,10)} · <b>INT</b> ${safeNumber(n.intelligence,10)} · <b>WIS</b> ${safeNumber(n.wisdom,10)} · <b>CHA</b> ${safeNumber(n.charisma,10)}</p>
            ${n.goals?'<p><b>Goals:</b> '+escapeHTML(n.goals)+'</p>':""}
            ${n.backstory?'<p><b>Backstory:</b> '+escapeHTML(n.backstory)+'</p>':""}
            ${n.features?'<p><b>Skills / traits:</b> '+escapeHTML(n.features)+'</p>':""}
            ${n.npcActions?'<p><b>Actions:</b> '+escapeHTML(n.npcActions)+'</p>':""}
          </details>
          ${isDM()? `<div class="card-actions"><button onclick="Hub.editNPC('${n.id}')">EDIT</button><button onclick="Hub.removeItem('npcs','${n.id}')">DELETE</button></div>`:""}
        </article>`).join("")
      : empty("No NPCs discovered yet.");
  }

  function renderJournal() {
    $("journal-list").innerHTML = state.journal.length
      ? state.journal.map(j=>`
        <article class="list-card">
          <div class="list-meta">${escapeHTML(j.date)} · ${escapeHTML(j.author||"Campaign")}</div>
          <h3>${escapeHTML(j.title)}</h3>
          <p>${escapeHTML(j.body)}</p>
          ${j.imageData?`<img class="journal-attachment" src="${j.imageData}" alt="Journal drawing or attached image" style="max-width:100%;max-height:420px;border-radius:6px;margin-top:12px">`:""}
          ${(isDM() || j.ownerId===member?.id)?`${(isDM() || member?.role==="player")?`<div class="card-actions"><button onclick="Hub.editJournal('${j.id}')">EDIT ENTRY</button><button onclick="Hub.removeItem('journal','${j.id}')">DELETE ENTRY</button></div>`:""}`:""}
        </article>`).join("")
      : empty("Your campaign story starts here.");
  }

  function calendarOrdinal(date,config){
    if(!date||!config)return 0;
    const yearDays=config.months.reduce((sum,m)=>sum+safeNumber(m.days),0);
    const epochYear=config.epochYear??1;
    const beforeMonths=config.months.slice(0,Math.max(0,safeNumber(date.month))).reduce((sum,m)=>sum+safeNumber(m.days),0);
    return (safeNumber(date.year)-epochYear)*yearDays+beforeMonths+safeNumber(date.day)-1;
  }
  function eventDistance(event,config){
    if(!event.fantasyDate||!config)return null;
    return calendarOrdinal(event.fantasyDate,config)-calendarOrdinal(config.currentDate,config);
  }
  function toggleEventAttendance(id){
    if(!isDM())return;const event=state.events.find(x=>x.id===id);if(!event)return;
    mutate(()=>event.attended=!event.attended);
  }

  function renderCalendar() {
    const setup=$("calendar-setup"), workspace=$("calendar-workspace");
    const config=state.calendarConfig;
    if (!config || !Array.isArray(config.months) || !config.months.length || !Array.isArray(config.weekdays) || !config.weekdays.length) {
      workspace.hidden=true;
      setup.innerHTML=isDM()?`
        <div class="hub-kicker">CREATE YOUR WORLD'S CALENDAR</div>
        <h3>Start with a blank calendar</h3>
        <p>Choose your own months, the length of each month, and the names of your weekdays. Nothing is pre-filled.</p>
        <div class="calendar-setup-fields">
          <label>Year label<input id="calendar-year-label" placeholder="e.g. Year"></label>
          <label>Starting year<input id="calendar-start-year" type="number" value="1" min="0"></label>
          <label>Month names <span>Separate each month with a comma</span><textarea id="calendar-month-names" rows="2" placeholder="e.g. Frostfall, Thawtide, Bloomrise"></textarea></label>
          <label>Days in each month <span>Enter one number per month, in the same order</span><input id="calendar-month-lengths" placeholder="e.g. 30, 28, 31"></label>
          <label>Weekday names <span>Separate each weekday with a comma</span><textarea id="calendar-weekday-names" rows="2" placeholder="e.g. Moonday, Starsday, Emberday"></textarea></label>
        </div>
        <button class="hub-button" onclick="Hub.saveCalendarSetup()">CREATE CALENDAR</button>
      `:empty("The DM hasn't created the campaign calendar yet.");
      return;
    }
    setup.innerHTML=isDM()?'<button class="small-button" onclick="Hub.editCalendarSetup()">EDIT CALENDAR SETTINGS</button>':"";
    workspace.hidden=false;
    const date=config.currentDate||{year:1,month:0,day:1};
    if (!calendarView) calendarView={year:date.year,month:date.month};
    if (calendarView.month<0) {calendarView.month=config.months.length-1;calendarView.year--;}
    if (calendarView.month>=config.months.length) {calendarView.month=0;calendarView.year++;}
    const month=config.months[calendarView.month];
    const currentMonth=config.months[date.month];
    $("calendar-current-date").textContent=`${currentMonth.name} ${date.day}, ${config.yearLabel||"Year"} ${date.year}`;
    $("calendar-month-heading").textContent=`${month.name} · ${config.yearLabel||"Year"} ${calendarView.year}`;
    $("calendar-advance").style.display=isDM()?"":"none";
    const epochYear=config.epochYear??date.year;
    const totalBeforeYear=(calendarView.year-epochYear)*config.months.reduce((sum,m)=>sum+m.days,0);
    const totalBeforeMonth=config.months.slice(0,calendarView.month).reduce((sum,m)=>sum+m.days,0);
    const weekdayOffset=((totalBeforeYear+totalBeforeMonth)%config.weekdays.length+config.weekdays.length)%config.weekdays.length;
    $("calendar-grid").style.gridTemplateColumns=`repeat(${config.weekdays.length},minmax(0,1fr))`;
    const weekdayHeaders=config.weekdays.map(day=>`<div class="calendar-weekday">${escapeHTML(day)}</div>`).join("");
    const blanks=Array.from({length:weekdayOffset},()=>'<div class="calendar-blank"></div>').join("");
    const cells=Array.from({length:month.days},(_,i)=>{
      const day=i+1, isCurrent=calendarView.year===date.year&&calendarView.month===date.month&&day===date.day;
      const isPast=(state.elapsedDays||[]).includes(`${calendarView.year}-${calendarView.month}-${day}`);
      const dayEvents=state.events.filter(e=>e.fantasyDate&&e.fantasyDate.year===calendarView.year&&e.fantasyDate.month===calendarView.month&&e.fantasyDate.day===day);
      return `<div class="calendar-day ${isCurrent?"is-current":""} ${isPast?"is-past":""}"><span class="calendar-day-number">${day}</span>${isDM()?`<button class="calendar-day-check" title="Toggle elapsed day" onclick="Hub.toggleCalendarDay(${calendarView.year},${calendarView.month},${day})">${isPast?"✓":"○"}</button>`:""}${dayEvents.map(e=>{const distance=eventDistance(e,config),missed=distance!==null&&distance<0&&!e.attended;return `<div class="calendar-event-chip ${e.attended?"event-attended":missed?"event-missed":""}" title="${escapeHTML(e.title)}">${escapeHTML(e.title)}</div>`;}).join("")}</div>`;
    }).join("");
    $("calendar-grid").innerHTML=weekdayHeaders+blanks+cells;
    const allEvents=[...state.events].sort((a,b)=>{
      const da=eventDistance(a,config),db=eventDistance(b,config);
      if(da===null&&db===null)return String(a.date||"").localeCompare(String(b.date||""));
      if(da===null)return 1;if(db===null)return -1;return da-db;
    });
    $("calendar-list").innerHTML=allEvents.length?allEvents.map(e=>{
      const distance=eventDistance(e,config),missed=distance!==null&&distance<0&&!e.attended,today=distance===0&&!e.attended;
      const m=e.fantasyDate?config.months[e.fantasyDate.month]:null;
      const dateLabel=e.fantasyDate?`${m?.name||"Unknown month"} ${safeNumber(e.fantasyDate.day)}, ${escapeHTML(config.yearLabel||"Year")} ${safeNumber(e.fantasyDate.year)}`:escapeHTML(e.date||"Date not set");
      const glow=distance===null||distance>30?0.025:distance>14?0.06:distance>7?0.10:distance>3?0.15:distance>1?0.21:distance===1?0.27:0.31;
      const countdown=distance===null?"":distance<0?"MISSED":distance===0?"TODAY":distance===1?"1 DAY TO GO":distance+" DAYS TO GO";
      const classes="calendar-event-card"+(missed?" event-missed":e.attended?" event-attended":today?" event-today":"");
      const background=missed||e.attended?"":`background:linear-gradient(110deg,rgba(214,184,121,${glow}),#222633 78%)`;
      return `<article class="list-card ${classes}" style="${background}">
        <div class="list-meta">${dateLabel}</div><div class="event-date-countdown">${e.attended?"ATTENDED":countdown}</div>
        <h3>${escapeHTML(e.title)}</h3><p>${escapeHTML(e.description||"")}</p>
        ${isDM()? `<div class="card-actions"><button onclick="Hub.toggleEventAttendance('${e.id}')">${e.attended?"MARK NOT ATTENDED":"MARK ATTENDED"}</button><button onclick="Hub.editEvent('${e.id}')">EDIT EVENT</button><button onclick="Hub.removeItem('events','${e.id}')">DELETE EVENT</button></div>`:(e.ownerId===member?.id?'<div class="card-actions"><button onclick="Hub.editEvent(\''+e.id+'\')">EDIT EVENT</button></div>':"")}
      </article>`;
    }).join(""):empty("No events have been added to the calendar yet.");
  }

  function saveCalendarSetup() {
    if (!isDM()) return;
    const names=$("calendar-month-names").value.split(",").map(x=>x.trim()).filter(Boolean);
    const lengths=$("calendar-month-lengths").value.split(",").map(x=>Number(x.trim()));
    const weekdays=$("calendar-weekday-names").value.split(",").map(x=>x.trim()).filter(Boolean);
    if (!names.length || names.length!==lengths.length || lengths.some(n=>!Number.isInteger(n)||n<1||n>1000) || !weekdays.length) {
      alert("Please provide a month name and a valid number of days for every month, plus at least one weekday.");
      return;
    }
    const year=Math.max(0,safeNumber($("calendar-start-year").value,1));
    mutate(()=>{state.calendarConfig={yearLabel:$("calendar-year-label").value.trim()||"Year",months:names.map((name,i)=>({name,days:lengths[i]})),weekdays,epochYear:year,currentDate:{year,month:0,day:1}};calendarView={year,month:0};});
  }

  function editCalendarSetup(){
    if(!isDM()||!state.calendarConfig)return;const c=state.calendarConfig;
    openForm("Edit fantasy calendar",[
      {name:"yearLabel",label:"Year label",value:c.yearLabel||"Year"},
      {name:"monthNames",label:"Month names (comma-separated)",value:c.months.map(m=>m.name).join(", "),full:true},
      {name:"monthLengths",label:"Days per month (comma-separated)",value:c.months.map(m=>m.days).join(", "),full:true},
      {name:"weekdays",label:"Weekday names (comma-separated)",value:c.weekdays.join(", "),full:true}
    ],v=>{
      const names=v.monthNames.split(",").map(x=>x.trim()).filter(Boolean),days=v.monthLengths.split(",").map(x=>Number(x.trim())),weekdays=v.weekdays.split(",").map(x=>x.trim()).filter(Boolean);
      if(!names.length||names.length!==days.length||days.some(n=>!Number.isInteger(n)||n<1||n>1000)||!weekdays.length)return alert("Please check your month names, month lengths and weekday names. No changes were made.");
      mutate(()=>{c.months=names.map((name,i)=>({name,days:days[i]}));c.weekdays=weekdays;c.yearLabel=v.yearLabel.trim()||"Year";c.currentDate.month=Math.min(c.currentDate.month,names.length-1);c.currentDate.day=Math.min(c.currentDate.day,days[c.currentDate.month]);calendarView={year:c.currentDate.year,month:c.currentDate.month};});
    });
  }  function calendarMonth(amount) {
    if (!state.calendarConfig) return;
    calendarView=calendarView||{...state.calendarConfig.currentDate};
    calendarView.month+=amount;
    renderCalendar();
  }

  function calendarToday() {
    if (!state.calendarConfig) return;
    calendarView={year:state.calendarConfig.currentDate.year,month:state.calendarConfig.currentDate.month};
    renderCalendar();
  }

  function toggleCalendarDay(year,month,day){
    if(!isDM())return;if(!Array.isArray(state.elapsedDays))state.elapsedDays=[];const key=`${year}-${month}-${day}`;const index=state.elapsedDays.indexOf(key);if(index>=0)state.elapsedDays.splice(index,1);else state.elapsedDays.push(key);refresh();persist();
  }

  function advanceCalendarDay(){
    if(!isDM()||!state.calendarConfig)return;const c=state.calendarConfig,d=c.currentDate,month=c.months[d.month];
    if(!Array.isArray(state.elapsedDays))state.elapsedDays=[];const passed=`${d.year}-${d.month}-${d.day}`;if(!state.elapsedDays.includes(passed))state.elapsedDays.push(passed);
    if(d.day<month.days)d.day++;else if(d.month<c.months.length-1){d.month++;d.day=1;}else{d.month=0;d.year++;d.day=1;}
    calendarView={year:d.year,month:d.month};refresh();persist();
  }
  function renderNotices(){
    const unread=state.notices.filter(n=>n.createdAt&&!(n.readBy||[]).includes(member?.id)).length,bar=$("notice-alert");
    bar.hidden=!unread;bar.textContent=unread?`✉ ${unread} new notice${unread===1?"":"s"} — click to read`:"";
    $("notice-list").innerHTML=state.notices.length?state.notices.map(n=>{const fresh=!!n.createdAt&&!(n.readBy||[]).includes(member?.id);return `<article class="list-card notice-card" onclick="Hub.markNoticeRead('${n.id}')"><div class="list-meta">${escapeHTML(n.date)} ${fresh?'<span class="tag">NEW!</span>':""}</div><h3>${escapeHTML(n.title)}</h3><p>${escapeHTML(n.body)}</p>${isDM()? `<div class="card-actions"><button onclick="event.stopPropagation();Hub.removeItem('notices','${n.id}')">DELETE NOTICE</button></div>`:""}</article>`;}).join(""):empty("The notice board is empty.");
  }  function mutate(fn) {
    fn();
    refresh();
    persist();
  }


  let modalSaveHandler = null;
  function closeModal(){const modal=$("hub-modal");modal.hidden=true;modal.innerHTML="";modalSaveHandler=null;}
  function imageFileToDataURL(file){
    return new Promise((resolve,reject)=>{
      if(!file)return resolve("");
      if(!file.type.startsWith("image/"))return reject(new Error("Please choose an image file."));
      if(file.size>5*1024*1024)return reject(new Error("Please use an image smaller than 5MB."));
      const reader=new FileReader();
      reader.onerror=()=>reject(new Error("The image could not be read."));
      reader.onload=()=>{
        const img=new Image();
        img.onerror=()=>reject(new Error("The selected image could not be opened."));
        img.onload=()=>{
          const scale=Math.min(1,640/Math.max(img.width,img.height));
          const canvas=document.createElement("canvas");
          canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));
          canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);
          const webp=canvas.toDataURL("image/webp",0.8);resolve(webp.startsWith("data:image/webp")?webp:canvas.toDataURL("image/jpeg",0.78));
        };
        img.src=reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  function openForm(title,fields,onSave){
    const modal=$("hub-modal");modalSaveHandler=onSave;
    const isArchive=fields.some(x=>x.group);
    const controls=fields.map((field,i)=>{
      const id="modal-field-"+i, value=field.value??"", full=field.full?" full":"";
      const group=field.group?` data-archive-group="${escapeHTML(field.group)}"`:"";
      if(field.type==="section")return `<div class="modal-section-title"${group}>${escapeHTML(field.label)}</div>`;
      let control="";
      if(field.type==="textarea")control=`<textarea id="${id}" name="${escapeHTML(field.name)}" rows="${field.rows||4}" ${field.required?"required":""} placeholder="${escapeHTML(field.placeholder||"")}">${escapeHTML(value)}</textarea>`;
      else if(field.type==="select")control=`<select id="${id}" name="${escapeHTML(field.name)}" ${field.required?"required":""}>${(field.options||[]).map(o=>`<option value="${escapeHTML(o.value)}" ${String(o.value)===String(value)?"selected":""}>${escapeHTML(o.label)}</option>`).join("")}</select>`;
      else if(field.type==="drawing")control=`<canvas id="journal-drawing-canvas" class="journal-editor-canvas" width="900" height="260"></canvas><div class="card-actions"><label class="small-button" style="cursor:pointer">UPLOAD IMAGE<input id="journal-image-upload" type="file" accept="image/*" hidden></label><button type="button" class="small-button" id="journal-clear-drawing">CLEAR DRAWING</button></div><p>Draw with your mouse or finger, or upload an image to attach it to this entry.</p>`;
      else if(field.type==="file")control=`<input id="${id}" name="${escapeHTML(field.name)}" type="file" accept="image/*"><span class="list-meta">Optional image upload · max 5MB</span>${field.preview?`<img class="portrait-preview" src="${escapeHTML(field.preview)}" alt="Current portrait">`:""}`;
      else control=`<input id="${id}" name="${escapeHTML(field.name)}" type="${field.type||"text"}" value="${escapeHTML(value)}" ${field.required?"required":""} placeholder="${escapeHTML(field.placeholder||"")}" ${field.min!==undefined?`min="${field.min}"`:""} ${field.max!==undefined?`max="${field.max}"`:""}>`;
      return `<label class="modal-field${full}" for="${id}"${group}>${escapeHTML(field.label)}${control}</label>`;
    }).join("");
    modal.innerHTML=`<div class="modal-card ${isArchive?"modal-wide":""}"><div class="modal-top"><h3>${escapeHTML(title)}</h3><button type="button" class="modal-close" id="modal-close">✕</button></div><form id="hub-modal-form"><div class="modal-fields">${controls}</div><div class="modal-actions"><button type="button" class="small-button" id="modal-cancel">CANCEL</button><button type="submit" class="hub-button">SAVE</button></div></form></div>`;
    modal.hidden=false;$("modal-close").onclick=closeModal;$("modal-cancel").onclick=closeModal;modal.onclick=e=>{if(e.target===modal)closeModal();};
    const form=$("hub-modal-form");
    const updateArchiveGroups=()=>{
      const selector=form.elements.namedItem("recordType");if(!selector)return;
      const selected=selector.value;
      form.querySelectorAll("[data-archive-group]").forEach(el=>{
        const groups=el.dataset.archiveGroup.split(" ");
        el.hidden=!groups.includes(selected);
      });
    };
    const typeSelector=form.elements.namedItem("recordType");
    if(typeSelector){typeSelector.addEventListener("change",updateArchiveGroups);updateArchiveGroups();}
    form.addEventListener("submit",async e=>{
      e.preventDefault();const values={},submittedForm=e.currentTarget;
      try{
        for(const field of fields){
          if(["drawing","section"].includes(field.type))continue;
          const el=submittedForm.elements.namedItem(field.name);
          values[field.name]=field.type==="file"?(el?.files?.[0]?await imageFileToDataURL(el.files[0]):""):(el?el.value:"");
        }
        if(modalSaveHandler)modalSaveHandler(values);
        closeModal();
      }catch(err){alert(err.message||"The form could not be saved.");}
    });
    if(fields.some(x=>x.type==="drawing"))setupJournalCanvas(fields.find(x=>x.type==="drawing").value||"");
  }
  function setupJournalCanvas(existingImage){
    const canvas=$("journal-drawing-canvas"),ctx=canvas.getContext("2d");journalCanvasDirty=false;ctx.fillStyle="#f4f0e6";ctx.fillRect(0,0,canvas.width,canvas.height);
    if(existingImage){const img=new Image();img.onload=()=>ctx.drawImage(img,0,0,canvas.width,canvas.height);img.src=existingImage;}
    let drawing=false;const point=e=>{const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width*canvas.width,y:(e.clientY-r.top)/r.height*canvas.height};};
    canvas.onpointerdown=e=>{drawing=true;journalCanvasDirty=true;const p=point(e);ctx.beginPath();ctx.moveTo(p.x,p.y);canvas.setPointerCapture(e.pointerId);};
    canvas.onpointermove=e=>{if(!drawing)return;const p=point(e);ctx.lineTo(p.x,p.y);ctx.strokeStyle="#282633";ctx.lineWidth=4;ctx.lineCap="round";ctx.lineJoin="round";ctx.stroke();};
    canvas.onpointerup=()=>drawing=false;canvas.onpointercancel=()=>drawing=false;
    $("journal-clear-drawing").onclick=()=>{ctx.fillStyle="#f4f0e6";ctx.fillRect(0,0,canvas.width,canvas.height);journalCanvasDirty=true;};
    $("journal-image-upload").onchange=e=>{const file=e.target.files[0];if(!file)return;if(file.size>2*1024*1024){alert("Please choose an image smaller than 2MB.");e.target.value="";return;}const reader=new FileReader();reader.onload=()=>{const img=new Image();img.onload=()=>{ctx.fillStyle="#f4f0e6";ctx.fillRect(0,0,canvas.width,canvas.height);const scale=Math.min(canvas.width/img.width,canvas.height/img.height),w=img.width*scale,h=img.height*scale;ctx.drawImage(img,(canvas.width-w)/2,(canvas.height-h)/2,w,h);journalCanvasDirty=true;};img.src=reader.result;};reader.readAsDataURL(file);};
  }
  function openJournalEditor(entry){
    const editing=!!entry,data=entry||{};
    openForm(editing?"Edit journal entry":"New journal entry",[
      {name:"title",label:"Entry title",value:data.title||"",required:true,full:true},
      {name:"date",label:"In-world date or session",value:data.date||""},
      {name:"author",label:"Author / character",value:data.author||""},
      {name:"body",label:"Your journal entry",type:"textarea",rows:8,value:data.body||"",full:true},
      {name:"drawing",label:"Drawing or image",type:"drawing",value:data.imageData||"",full:true}
    ],v=>{const imageData=journalCanvasDirty?$("journal-drawing-canvas")?.toDataURL("image/jpeg",0.78):(data.imageData||"");const updated={title:v.title.trim(),date:v.date,author:v.author,body:v.body,imageData};if(!updated.title)return alert("Please enter a title.");if(editing)mutate(()=>Object.assign(entry,updated));else mutate(()=>state.journal.unshift({id:makeId(),...updated,...(!isDM()?{ownerId:member.id}:{})}));});
  }

  function archiveFields(data={},type="player"){
    return [
      ...(type==="npc"?[{name:"joinParty",label:"Add this NPC to the party as a companion?",type:"select",value:data?.isCompanion?"yes":"no",options:[{value:"no",label:"No — keep in NPC directory"},{value:"yes",label:"Yes — add to party tracker"}],full:true}]:[]),
      {type:"section",label:"IDENTITY & APPEARANCE",group:"player companion npc"},
      {name:"name",label:"Name",value:data.name||"",required:true,group:"player companion npc"},
      {name:"player",label:"Player / owner",value:data.player||(isDM()?"":member?.display_name),group:"player"},
      {name:"role",label:"Role / occupation",value:data.role||"",group:"npc"},
      {name:"race",label:"Race / species",value:data.race||"",group:"player companion npc"},
      {name:"className",label:"Class",value:data.className||"",group:"player companion"},
      {name:"background",label:"Background",value:data.background||"",group:"player companion"},
      {name:"rulesEdition",label:"Rules version for this character",type:"select",value:data.rulesEdition||"2014",options:[{value:"2014",label:"2014 rules"},{value:"2024",label:"2024 rules"}],group:"player companion"},
      {name:"alignment",label:"Alignment",value:data.alignment||"",group:"player companion npc"},
      {name:"portrait",label:"Portrait image URL",type:"url",value:data.portrait?.startsWith("data:")?"":(data.portrait||""),placeholder:"https://…",group:"player companion npc"},
      {name:"portraitFile",label:"Or upload a portrait image",type:"file",preview:data.portrait||"",group:"player companion npc"},
      {type:"section",label:"ADVENTURER DETAILS",group:"player companion"},
      {name:"level",label:"Level",type:"number",value:data.level??1,min:1,group:"player companion"},
      {name:"experience",label:"Experience points",type:"number",value:data.experience??0,min:0,group:"player companion"},
      {type:"section",label:"COMBAT STATISTICS",group:"player companion npc"},
      {name:"hp",label:"Current hit points",type:"number",value:data.hp??10,min:0,group:"player companion npc"},
      {name:"maxHp",label:"Maximum hit points",type:"number",value:data.maxHp??10,min:1,group:"player companion npc"},
      {name:"exhaustion",label:"Exhaustion level",type:"number",value:data.exhaustion??0,min:0,max:6,group:"player companion npc"},
      {name:"ac",label:"Armour class",type:"number",value:data.ac??10,min:0,group:"player companion npc"},
      {name:"initiative",label:"Initiative",type:"number",value:data.initiative??0,group:"player companion npc"},
      {name:"speed",label:"Speed (ft)",type:"number",value:data.speed??30,min:0,group:"player companion npc"},
      {name:"hitDice",label:"Hit dice",value:data.hitDice||"",group:"player companion npc"},
      {name:"hitDiceUsed",label:"Hit dice spent",type:"number",value:data.hitDiceUsed??0,min:0,group:"player companion npc"},
      {name:"proficiency",label:"Proficiency bonus",type:"number",value:data.proficiency??2,min:0,group:"player companion npc"},
      {type:"section",label:"ABILITY SCORES",group:"player companion npc"},
      {name:"strength",label:"Strength (STR)",type:"number",value:data.strength??10,group:"player companion npc"},
      {name:"dexterity",label:"Dexterity (DEX)",type:"number",value:data.dexterity??10,group:"player companion npc"},
      {name:"constitution",label:"Constitution (CON)",type:"number",value:data.constitution??10,group:"player companion npc"},
      {name:"intelligence",label:"Intelligence (INT)",type:"number",value:data.intelligence??10,group:"player companion npc"},
      {name:"wisdom",label:"Wisdom (WIS)",type:"number",value:data.wisdom??10,group:"player companion npc"},
      {name:"charisma",label:"Charisma (CHA)",type:"number",value:data.charisma??10,group:"player companion npc"},
      {type:"section",label:"PROFICIENCIES & FEATURES",group:"player companion npc"},
      {name:"savingThrows",label:"Saving throw proficiencies",type:"textarea",rows:2,value:data.savingThrows||"",group:"player companion npc",full:true},
      {name:"skills",label:"Skills & proficiencies",type:"textarea",rows:3,value:data.skills||"",group:"player companion npc",full:true},
      {name:"features",label:"Class features, racial traits & feats",type:"textarea",rows:4,value:data.features||"",group:"player companion npc",full:true},
      {name:"spells",label:"Spells & magical abilities",type:"textarea",rows:4,value:data.spells||"",group:"player companion npc",full:true},
      {type:"section",label:"INVENTORY & STORY",group:"player companion"},
      {name:"gear",label:"Equipment, inventory & currency",type:"textarea",rows:4,value:data.gear||"",group:"player companion",full:true},
      {name:"personality",label:"Personality traits",type:"textarea",rows:2,value:data.personality||"",group:"player companion npc",full:true},
      {name:"ideals",label:"Ideals",type:"textarea",rows:2,value:data.ideals||"",group:"player companion npc",full:true},
      {name:"bonds",label:"Bonds",type:"textarea",rows:2,value:data.bonds||"",group:"player companion npc",full:true},
      {name:"flaws",label:"Flaws",type:"textarea",rows:2,value:data.flaws||"",group:"player companion npc",full:true},
      {name:"backstory",label:"Backstory",type:"textarea",rows:5,value:data.backstory||"",group:"player companion npc",full:true},
      {name:"loveInterest",label:"Relationships / connections",type:"textarea",rows:3,value:data.loveInterest||"",group:"player companion npc",full:true},
      {type:"section",label:"NPC DETAILS",group:"npc"},
      {name:"location",label:"Usual location",value:data.location||"",group:"npc"},
      {name:"relationship",label:"Relationship to the party",value:data.relationship||"",group:"npc"},
      {name:"description",label:"Description & known details",type:"textarea",rows:5,value:data.description||"",group:"npc",full:true},
      {name:"goals",label:"Goals & motivations",type:"textarea",rows:3,value:data.goals||"",group:"npc",full:true},
      {name:"challengeRating",label:"Challenge rating",value:data.challengeRating||"",group:"npc"},
      {name:"senses",label:"Senses",value:data.senses||"",group:"npc"},
      {name:"languages",label:"Languages",value:data.languages||"",group:"npc"},
      {name:"npcActions",label:"Actions & attacks",type:"textarea",rows:4,value:data.npcActions||"",group:"npc",full:true},
      {name:"secrets",label:"Secrets / information",type:"textarea",rows:3,value:data.secrets||"",group:"npc",full:true},
      {type:"section",label:"SAVING THROWS, SKILLS & DEFENCES",group:"player companion npc"},
      {name:"armorProficiencies",label:"Armour & shield proficiencies",value:data.armorProficiencies||"",group:"player companion npc",full:true},
      {name:"weaponProficiencies",label:"Weapon proficiencies",value:data.weaponProficiencies||"",group:"player companion npc",full:true},
      {name:"toolProficiencies",label:"Tool proficiencies",value:data.toolProficiencies||"",group:"player companion npc",full:true},
      {name:"languagesKnown",label:"Languages known",value:data.languagesKnown||"",group:"player companion npc",full:true},
      {name:"senses",label:"Senses & passive perception",value:data.senses||"",group:"player companion npc"},
      {name:"damageResistances",label:"Damage resistances / immunities / vulnerabilities",type:"textarea",rows:2,value:data.damageResistances||"",group:"player companion npc",full:true},
      {name:"conditions",label:"Condition immunities / current conditions",value:data.conditions||"",group:"player companion npc",full:true},
      {name:"deathSuccesses",label:"Death save successes",type:"number",min:0,max:3,value:data.deathSuccesses??0,group:"player companion"},
      {name:"deathFailures",label:"Death save failures",type:"number",min:0,max:3,value:data.deathFailures??0,group:"player companion"},
      {name:"inspiration",label:"Heroic inspiration / inspiration",type:"select",value:data.inspiration?"Yes":"No",options:[{value:"No",label:"No"},{value:"Yes",label:"Yes"}],group:"player companion"},
      {name:"attacks",label:"Attacks & combat options",type:"textarea",rows:3,value:data.attacks||"",group:"player companion npc",full:true},
      {name:"spellcastingAbility",label:"Spellcasting ability",value:data.spellcastingAbility||"",group:"player companion"},
      {name:"spellSaveDC",label:"Spell save DC",type:"number",min:0,value:data.spellSaveDC??0,group:"player companion"},
      {name:"spellAttackBonus",label:"Spell attack bonus",type:"number",value:data.spellAttackBonus??0,group:"player companion"},
      {name:"notes",label:"Additional notes",type:"textarea",rows:4,value:data.notes||"",group:"player companion npc",full:true}
    ];
  }
  function openCharacterTemplateForm(title,fields,onSave,data=null){
    activeCharacterSheetId=data?.id||"";
    const host=$("character-sheet-content");
    const fieldMap=new Map(fields.filter(f=>f.name&&(!f.group||f.group.split(" ").includes("player"))).map(f=>[f.name,f]));
    const used=new Set();
    const field=(name,extra="")=>{
      const f=fieldMap.get(name);if(!f)return "";
      used.add(name);
      const id="ddb-builder-"+name,value=f.value??"",type=f.type||"text";
      let control="";
      if(type==="textarea")control='<textarea id="'+id+'" name="'+escapeHTML(name)+'" rows="'+(f.rows||3)+'" placeholder="'+escapeHTML(f.placeholder||"")+'">'+escapeHTML(value)+'</textarea>';
      else if(type==="select")control='<select id="'+id+'" name="'+escapeHTML(name)+'">'+(f.options||[]).map(o=>'<option value="'+escapeHTML(o.value)+'" '+(String(o.value)===String(value)?"selected":"")+'>'+escapeHTML(o.label)+'</option>').join("")+'</select>';
      else if(type==="file")control='<input id="'+id+'" name="'+escapeHTML(name)+'" type="file" accept="image/*"><small class="ddb-field-hint">Choose an image · max 5MB</small>';
      else control='<input id="'+id+'" name="'+escapeHTML(name)+'" type="'+type+'" value="'+escapeHTML(value)+'" '+(f.required?"required":"")+' '+(f.min!==undefined?'min="'+f.min+'"':"")+' '+(f.max!==undefined?'max="'+f.max+'"':"")+' placeholder="'+escapeHTML(f.placeholder||"")+'">';
      return '<label class="ddb-inline-field '+(type==="textarea"?"ddb-inline-wide ":"")+extra+'" for="'+id+'"><span>'+escapeHTML(f.label)+(f.required?' <i>*</i>':"")+'</span>'+control+'</label>';
    };
    const section=(id,heading,body)=>'<section class="beyond-section ddb-edit-section" id="builder-'+id+'"><div class="beyond-section-heading"><h3>'+heading+'</h3></div>'+body+'</section>';
    const abilityNames=["strength","dexterity","constitution","intelligence","wisdom","charisma"];
    const abilityLabels=["STR","DEX","CON","INT","WIS","CHA"];
    const abilities=section("abilities","ABILITY SCORES",'<div class="beyond-abilities ddb-edit-abilities">'+abilityNames.map((n,i)=>{const f=fieldMap.get(n);if(!f)return "";used.add(n);const val=safeNumber(f.value,10),mod=Math.floor((val-10)/2);return '<label class="beyond-ability ddb-edit-ability" for="ddb-builder-'+n+'"><span>'+abilityLabels[i]+'</span><input id="ddb-builder-'+n+'" name="'+n+'" type="number" value="'+val+'"><b class="ddb-mod-preview">'+(mod>=0?"+":"")+mod+'</b></label>';}).join("")+'</div>');
    const portrait=data?.portrait?'<img class="beyond-portrait" src="'+escapeHTML(data.portrait)+'" alt="Current character portrait">':'<div class="beyond-portrait placeholder">✦</div>';
    const identity=section("identity","CHARACTER IDENTITY",'<div class="ddb-edit-identity"><div class="ddb-edit-portrait">'+portrait+field("portraitFile")+field("portrait")+'</div><div class="ddb-edit-identity-fields">'+field("name")+field("player")+field("race")+field("className")+field("background")+field("level")+field("rulesEdition")+field("alignment")+field("experience")+'</div></div>');
    const combat=section("combat","COMBAT & DEFENCES",'<div class="ddb-edit-combat-grid">'+["hitDice","hitDiceUsed","exhaustion","deathSuccesses","deathFailures","inspiration"].map(n=>field(n)).join("")+'</div>');
    const saves=section("saves","SAVING THROWS & SKILLS",'<div class="ddb-edit-two-col">'+field("savingThrows")+field("skills")+'</div>');
    const profs="";
    const attacks=section("attacks","ATTACKS & COMBAT",'<div class="ddb-edit-two-col">'+field("attacks")+'</div>');
    const features=section("features","FEATURES & PROFICIENCIES",'<div class="ddb-edit-two-col">'+field("features")+["armorProficiencies","weaponProficiencies","toolProficiencies","languagesKnown","senses","damageResistances","conditions"].map(n=>field(n)).join("")+'</div>');
    const spells=section("spells","SPELLCASTING",'<div class="ddb-edit-two-col">'+field("spellcastingAbility")+field("spellSaveDC")+field("spellAttackBonus")+field("spells")+'</div><p class="ddb-builder-note">You can add individual spells and configure spell slots after creating your character.</p>');
    const inventory=section("inventory","EQUIPMENT & INVENTORY",'<div class="ddb-edit-two-col">'+field("gear")+'</div><p class="ddb-builder-note">Individual inventory items and gold can be managed from the completed character sheet.</p>');
    const story=section("story","PERSONALITY & BACKGROUND",'<div class="ddb-edit-two-col">'+["personality","ideals","bonds","flaws","backstory","loveInterest","notes"].map(n=>field(n)).join("")+'</div>');
    const extras=fields.filter(f=>f.name&&!used.has(f.name)&&(!f.group||f.group.split(" ").includes("player"))).map(f=>field(f.name)).join("");
    go("character-sheet");
    host.innerHTML='<div class="ddb-character-builder ddb-sheet-editor"><div class="beyond-topline"><button type="button" class="small-button" onclick="Hub.go(\'characters\')">← CHARACTER ARCHIVE</button><span class="beyond-edition">'+escapeHTML(data?.rulesEdition||"2014")+' RULES · '+(data?"EDIT CHARACTER":"NEW CHARACTER")+'</span></div>'+
      '<form id="character-template-form"><header class="beyond-hero ddb-edit-hero">'+portrait+'<div class="beyond-identity"><div class="hub-kicker">D&amp;D CHARACTER SHEET</div><h2>'+(data?escapeHTML(data.name||"Unnamed character"):"New character")+'</h2><p>Enter your details directly into the sheet. You can leave sections blank and return to them later.</p><div class="beyond-tags"><span>CHARACTER BUILDER</span><span>EDITABLE SHEET</span></div></div></header>'+
      '<div class="beyond-combat-strip ddb-edit-stat-strip"><div class="beyond-hp"><span>HIT POINTS</span><div class="ddb-strip-fields">'+field("hp")+field("maxHp")+'</div></div>'+[["ARMOUR CLASS","ac"],["INITIATIVE","initiative"],["SPEED","speed"],["PROFICIENCY","proficiency"]].map(([label,n])=>'<div class="beyond-stat"><span>'+label+'</span>'+field(n)+'</div>').join("")+'</div>'+
      '<nav class="ddb-builder-tabs" role="tablist" aria-label="Character editor sections"><button type="button" class="active" data-builder-tab="core" aria-selected="true" onclick="Hub.showBuilderSection(this.dataset.builderTab)">Core</button><button type="button" data-builder-tab="combat" aria-selected="false" onclick="Hub.showBuilderSection(this.dataset.builderTab)">Combat</button><button type="button" data-builder-tab="spells" aria-selected="false" onclick="Hub.showBuilderSection(this.dataset.builderTab)">Spells</button><button type="button" data-builder-tab="inventory" aria-selected="false" onclick="Hub.showBuilderSection(this.dataset.builderTab)">Inventory</button><button type="button" data-builder-tab="features" aria-selected="false" onclick="Hub.showBuilderSection(this.dataset.builderTab)">Features</button><button type="button" data-builder-tab="notes" aria-selected="false" onclick="Hub.showBuilderSection(this.dataset.builderTab)">Notes</button></nav>'+
      '<div class="beyond-main-grid ddb-edit-main-grid"><div class="beyond-primary"><div class="ddb-builder-tab-panel active" data-builder-panel="core">'+identity+abilities+saves+'</div><div class="ddb-builder-tab-panel" data-builder-panel="combat">'+combat+attacks+'</div><div class="ddb-builder-tab-panel" data-builder-panel="spells">'+spells+'</div><div class="ddb-builder-tab-panel" data-builder-panel="inventory">'+inventory+'</div><div class="ddb-builder-tab-panel" data-builder-panel="features">'+features+'</div><div class="ddb-builder-tab-panel" data-builder-panel="notes">'+story+(extras?section("other","OTHER DETAILS",'<div class="ddb-edit-two-col">'+extras+'</div>'):"")+'</div></div>'+
      '<aside class="beyond-sidebar"><section class="beyond-side-card"><h3>CHARACTER AT A GLANCE</h3><p>Identity, class, level and rules version are grouped at the top of the sheet.</p></section><section class="beyond-side-card"><h3>BUILDER GUIDE</h3><p>Start with identity and ability scores, then add combat details, proficiencies, spells and equipment. You can save an incomplete sheet and finish it later.</p></section></aside></div>'+
      '<div class="ddb-builder-actions"><button type="button" class="small-button" onclick="Hub.go(\'characters\')">CANCEL</button><button type="submit" class="hub-button">'+(data?"SAVE CHARACTER":"CREATE CHARACTER")+'</button></div></form></div>';
    const form=$("character-template-form");
    form.addEventListener("input",e=>{
      if(e.target.name==="name"){const heading=host.querySelector(".ddb-edit-hero .beyond-identity h2");if(heading)heading.textContent=e.target.value||"New character";}
      if(abilityNames.includes(e.target.name)){const n=safeNumber(e.target.value,10),mod=Math.floor((n-10)/2),preview=e.target.closest(".ddb-edit-ability")?.querySelector(".ddb-mod-preview");if(preview)preview.textContent=(mod>=0?"+":"")+mod;}
    });
    form.addEventListener("submit",async e=>{
      e.preventDefault();const values={};
      try{
        for(const f of fields){
          if(!f.name||(f.group&&!f.group.split(" ").includes("player")))continue;
          const el=form.elements.namedItem(f.name);
          values[f.name]=f.type==="file"?(el?.files?.[0]?await imageFileToDataURL(el.files[0]):""):(el?el.value:"");
        }
        if(!String(values.name||"").trim()){alert("Please enter a character name.");return;}
        onSave(values);
        if(activeCharacterSheetId)go("character-sheet");else go("characters");
      }catch(err){alert(err.message||"The character sheet could not be saved.");}
    });
  }
  function openArchiveEditor(data=null,collection="characters"){
    if(collection==="npcs"&&!isDM())return;
    if(data&&collection==="characters"&&!canEditCharacter(data))return;
    const editing=!!data;
    const initialType=collection==="npcs"?"npc":data?.isNPC?"companion":"player";
    const fields=archiveFields(data||{},initialType);
    const saveArchiveEntry=v=>{
      if(!v.name.trim())return alert("Please enter a name.");
      const type=collection==="npcs"?"npc":initialType,portrait=v.portraitFile||v.portrait||data?.portrait||"";
      const common={id:data?.id||makeId(),name:v.name.trim(),race:v.race,className:v.className,alignment:v.alignment,portrait,personality:v.personality,ideals:v.ideals,bonds:v.bonds,flaws:v.flaws,backstory:v.backstory,loveInterest:v.loveInterest,notes:v.notes,rulesEdition:v.rulesEdition||"2014",exhaustion:Math.max(0,Math.min(6,safeNumber(v.exhaustion))),hitDiceUsed:Math.max(0,safeNumber(v.hitDiceUsed)),resources:Array.isArray(data?.resources)?data.resources:[],attackOptions:Array.isArray(data?.attackOptions)?data.attackOptions:[],activeConditions:Array.isArray(data?.activeConditions)?data.activeConditions:[],armorProficiencies:v.armorProficiencies,weaponProficiencies:v.weaponProficiencies,toolProficiencies:v.toolProficiencies,languagesKnown:v.languagesKnown,senses:v.senses,damageResistances:v.damageResistances,conditions:v.conditions,deathSuccesses:Math.max(0,Math.min(3,safeNumber(v.deathSuccesses))),deathFailures:Math.max(0,Math.min(3,safeNumber(v.deathFailures))),inspiration:v.inspiration==="Yes",attacks:v.attacks,spellcastingAbility:v.spellcastingAbility,spellSaveDC:safeNumber(v.spellSaveDC),spellAttackBonus:safeNumber(v.spellAttackBonus),spellbook:Array.isArray(data?.spellbook)?data.spellbook:[]};
      if(type==="npc"){
        const npc={...common,player:v.player,role:v.role,location:v.location,relationship:v.relationship,description:v.description,goals:v.goals,secrets:v.secrets,challengeRating:v.challengeRating,senses:v.senses,languages:v.languages,npcActions:v.npcActions,hp:Math.max(0,safeNumber(v.hp)),maxHp:Math.max(1,safeNumber(v.maxHp,1)),ac:safeNumber(v.ac),initiative:safeNumber(v.initiative),speed:safeNumber(v.speed),hitDice:v.hitDice,proficiency:safeNumber(v.proficiency),strength:safeNumber(v.strength,10),dexterity:safeNumber(v.dexterity,10),constitution:safeNumber(v.constitution,10),intelligence:safeNumber(v.intelligence,10),wisdom:safeNumber(v.wisdom,10),charisma:safeNumber(v.charisma,10),savingThrows:v.savingThrows,skills:v.skills,features:v.features,spells:v.spells,attacks:v.attacks};
        if(!isDM())return;
        mutate(()=>{
          if(v.joinParty==="yes"){
            const companion={...npc,id:data?.partyCharacterId||makeId(),isNPC:true,isCompanion:true,player:"Party companion",level:1,background:"NPC companion",rulesEdition:"2014",proficiency:safeNumber(npc.proficiency,2),spellSlots:Array.from({length:9},()=>({used:0,total:0})),spellbook:[]};
            if(data?.partyCharacterId){const existing=state.characters.find(x=>x.id===data.partyCharacterId);if(existing)Object.assign(existing,companion);else state.characters.push(companion);}
            else state.characters.push(companion);
            state.npcs=state.npcs.filter(x=>x.id!==data?.id);
          }else if(collection==="npcs"&&data)Object.assign(data,npc);
          else state.npcs.unshift(npc);
        });
      }else{
        const c={...common,player:type==="player"?(isDM()?v.player:member.display_name):"",background:v.background,level:Math.max(1,safeNumber(v.level,1)),experience:Math.max(0,safeNumber(v.experience)),hp:Math.max(0,safeNumber(v.hp)),maxHp:Math.max(1,safeNumber(v.maxHp,1)),ac:safeNumber(v.ac),initiative:safeNumber(v.initiative),speed:safeNumber(v.speed),hitDice:v.hitDice,proficiency:safeNumber(v.proficiency),strength:safeNumber(v.strength,10),dexterity:safeNumber(v.dexterity,10),constitution:safeNumber(v.constitution,10),intelligence:safeNumber(v.intelligence,10),wisdom:safeNumber(v.wisdom,10),charisma:safeNumber(v.charisma,10),savingThrows:v.savingThrows,skills:v.skills,features:v.features,spells:v.spells,gear:v.gear,isNPC:type==="companion",resources:Array.isArray(data?.resources)?data.resources:[],hitDiceUsed:Math.max(0,safeNumber(data?.hitDiceUsed)),armorProficiencies:v.armorProficiencies,weaponProficiencies:v.weaponProficiencies,toolProficiencies:v.toolProficiencies,languagesKnown:v.languagesKnown,senses:v.senses,damageResistances:v.damageResistances,conditions:v.conditions,deathSuccesses:Math.max(0,Math.min(3,safeNumber(v.deathSuccesses))),deathFailures:Math.max(0,Math.min(3,safeNumber(v.deathFailures))),inspiration:v.inspiration==="Yes",attacks:v.attacks,spellcastingAbility:v.spellcastingAbility,spellSaveDC:safeNumber(v.spellSaveDC),spellAttackBonus:safeNumber(v.spellAttackBonus),spellbook:Array.isArray(data?.spellbook)?data.spellbook:[]};
        c.hp=Math.min(c.hp,c.maxHp);
        if(!isDM())c.ownerId=member.id;else if(data?.ownerId)c.ownerId=data.ownerId;
        mutate(()=>{
          if(collection==="npcs")state.npcs=state.npcs.filter(x=>x.id!==data?.id);
          if(data&&collection==="characters")Object.assign(data,c);
          else state.characters.push(c);
        });
      }
      if(collection==="characters")activeCharacterSheetId=data?.id||state.characters[state.characters.length-1]?.id||"";
    };
    if(collection==="characters")openCharacterTemplateForm(editing?"Edit character sheet":"Blank character sheet",fields,saveArchiveEntry,data);
    else openForm(editing?"Edit archive entry":"Add to character & NPC archive",fields,saveArchiveEntry);
  }
  function addCharacter(){if(!isDM())openArchiveEditor(null,"characters");}
  function editCharacter(id){const c=state.characters.find(x=>x.id===id);if(c)openArchiveEditor(c,"characters");}
  function addNPC(){if(isDM())openArchiveEditor(null,"npcs");}
  function pickRandom(items){return items[Math.floor(Math.random()*items.length)];}
  function randomFullName(){return pickRandom(["Alder","Briar","Caelan","Dara","Elowen","Fen","Galen","Ilyra","Joren","Kaia","Liora","Marek","Neris","Orin","Perrin","Quill","Rhea","Sylvi","Tarin","Vesper","Wren","Yara","Zephyr"])+" "+pickRandom(["Ashford","Blackthorn","Brightwater","Cinderfall","Dawnmere","Duskwalker","Embervale","Frostmere","Greystone","Holloway","Ironwood","Moonbrook","Ravencrest","Silverleaf","Stormborn","Thornfield","Vale"]);}
  function randomizeCharacter(){
    if(!isDM()&&!member)return;
    const race=pickRandom(["Human","Elf","Dwarf","Halfling","Gnome","Dragonborn","Tiefling","Half-Orc","Half-Elf","Orc","Aasimar","Goliath"]);
    const cls=pickRandom(["Barbarian","Bard","Cleric","Druid","Fighter","Monk","Paladin","Ranger","Rogue","Sorcerer","Warlock","Wizard"]);
    const background=pickRandom(["Acolyte","Charlatan","Criminal","Entertainer","Folk Hero","Guild Artisan","Hermit","Noble","Outlander","Sage","Sailor","Soldier","Urchin"]);
    const scores=[15,14,13,12,10,8].sort(()=>Math.random()-.5),keys=["strength","dexterity","constitution","intelligence","wisdom","charisma"],stats={};
    keys.forEach((k,i)=>stats[k]=scores[i]);
    const die={Barbarian:12,Fighter:10,Paladin:10,Ranger:10,Bard:8,Cleric:8,Druid:8,Monk:8,Rogue:8,Sorcerer:6,Warlock:8,Wizard:6}[cls]||8;
    const hp=Math.max(1,die+Math.floor((stats.constitution-10)/2)),name=randomFullName();
    const entry={id:makeId(),name,player:isDM()?"Unassigned":member.display_name,race,className:cls,background,level:1,rulesEdition:pickRandom(["2014","2024"]),hp,maxHp:hp,ac:10+Math.floor((stats.dexterity-10)/2),initiative:Math.floor((stats.dexterity-10)/2),speed:30,proficiency:2,hitDice:"1d"+die,...stats,alignment:pickRandom(["Lawful Good","Neutral Good","Chaotic Good","Lawful Neutral","True Neutral","Chaotic Neutral","Lawful Evil","Neutral Evil","Chaotic Evil"]),personality:pickRandom(["Speaks before thinking, then regrets it.","Quietly observant and difficult to surprise.","Warm-hearted, generous and fiercely loyal.","Restless, curious and easily distracted.","Dry-witted, guarded and secretly sentimental.","Bold in a crisis, nervous in quiet moments."]),ideals:pickRandom(["Freedom: everyone deserves the chance to choose their own path.","Knowledge: understanding the world is worth any effort.","Community: nobody should be left behind.","Ambition: greatness must be earned.","Balance: every action has consequences.","Mercy: people can change when given a chance."]),bonds:pickRandom(["Owes their life to a stranger who vanished.","Carries a keepsake from a family member.","Protects a small hometown they rarely visit.","Searching for a missing friend or mentor.","Bound by a promise made to a loved one."]),flaws:pickRandom(["Cannot resist a mystery, even when dangerous.","Holds grudges longer than they should.","Takes foolish risks to prove their worth.","Hides problems instead of asking for help.","Trusts charming strangers too easily.","Will not back down from a public challenge."]),backstory:"Raised in "+pickRandom(["a remote mountain village","a crowded port city","a travelling merchant caravan","a noble household","a monastery","a frontier settlement","the backstreets of a sprawling city"])+", "+name.split(" ")[0]+" learned that "+pickRandom(["family is chosen as much as inherited","secrets can be more valuable than gold","the world is larger than any map","kindness can be a form of courage","survival depends on unlikely allies"])+". After "+pickRandom(["a disastrous expedition","a falling-out with a mentor","an unexpected inheritance","a strange recurring dream","a debt they could not repay","a chance encounter with a wandering adventurer"])+", they set out to discover what comes next.",skills:pickRandom(["Perception, Insight","Athletics, Intimidation","Stealth, Sleight of Hand","Arcana, History","Persuasion, Performance","Survival, Nature"]),languagesKnown:"Common, "+pickRandom(["Elvish","Dwarvish","Draconic","Halfling","Goblin","Sylvan"]),gear:"Adventurer's pack, a keepsake, travel clothes and 10 GP",spellSlots:Array.from({length:9},()=>({used:0,total:0})),isNPC:false};
    if(!isDM())entry.ownerId=member.id;
    mutate(()=>state.characters.push(entry));
    alert("A new adventurer has joined the archive: "+name+". Open their profile to customise them.");
  }
  function randomizeNPC(){
    if(!isDM())return;
    const name=randomFullName(),scores=Array.from({length:6},()=>8+Math.floor(Math.random()*9)),[strength,dexterity,constitution,intelligence,wisdom,charisma]=scores,hp=6+Math.floor(Math.random()*25);
    const n={id:makeId(),name,role:pickRandom(["Wandering merchant","Town guard","Retired adventurer","Travelling healer","Local artisan","Court advisor","Mysterious scholar","Bounty hunter","Innkeeper","Smuggler","Village elder","Street performer"]),race:pickRandom(["Human","Elf","Dwarf","Halfling","Tiefling","Gnome","Dragonborn","Orc"]),alignment:pickRandom(["Lawful Good","Neutral Good","Chaotic Good","Lawful Neutral","True Neutral","Chaotic Neutral","Lawful Evil","Neutral Evil"]),location:pickRandom(["The market square","The old harbour","A roadside inn","The royal court","The temple district","A remote village","The city archives","The forest edge"]),relationship:pickRandom(["Potential ally","Friendly contact","Rival","Uncertain stranger","Reluctant informant","Local authority"]),description:pickRandom(["A weathered traveller with watchful eyes and a careful smile.","An impeccably dressed figure whose hands are stained with ink.","A cheerful presence who seems to know everyone in town.","A quiet individual with an old scar and a newer secret.","A sharp-eyed professional who never gives a straight answer.","A kindly face hiding a formidable will."]),goals:pickRandom(["Wants to find a missing family member.","Hopes to restore a ruined business.","Is quietly investigating a local mystery.","Seeks a rare artefact before a rival finds it.","Wants to leave their old life behind.","Is protecting someone who does not know it."]),backstory:"Once "+pickRandom(["served a powerful household","worked aboard a merchant vessel","studied forbidden histories","travelled with a circus troupe","guarded a remote border","lived among travelling performers"])+". Their life changed after "+pickRandom(["a betrayal","a failed expedition","a mysterious letter","a debt came due","a chance act of kindness","an unexplained disappearance"])+". Now they are determined to "+pickRandom(["make amends","find the truth","protect their community","build a new reputation","settle an old score","keep a dangerous secret hidden"])+".",hp,maxHp:hp,ac:10+Math.floor(Math.random()*7),initiative:Math.floor((dexterity-10)/2),speed:30,challengeRating:pickRandom(["0","1/8","1/4","1/2","1"]),strength,dexterity,constitution,intelligence,wisdom,charisma,proficiency:2,senses:"Passive Perception "+(10+Math.floor((wisdom-10)/2)),languages:"Common",npcActions:pickRandom(["Dagger: +3 to hit, 1d4+1 piercing damage.","Shortsword: +4 to hit, 1d6+2 piercing damage.","Light crossbow: +3 to hit, 1d8+1 piercing damage.","Unarmed strike: +2 to hit, 1 bludgeoning damage."]),features:pickRandom(["Insight, Persuasion","Perception, Survival","Deception, Sleight of Hand","History, Investigation","Athletics, Intimidation"])};
    mutate(()=>state.npcs.unshift(n));
    alert("A new NPC has been added: "+name+". You can edit their profile in the archive.");
  }
  function editNPC(id){const n=state.npcs.find(x=>x.id===id);if(n)openArchiveEditor(n,"npcs");}
  function changeHP(id,amount) {
    const c=state.characters.find(x=>x.id===id);if(!c||!canEditCharacter(c))return;
    mutate(()=>{c.hp=Math.max(0,Math.min(safeNumber(c.maxHp),safeNumber(c.hp)+amount));if(amount>0&&c.hp>0){c.deathSuccesses=0;c.deathFailures=0;c.deathStatus="";}});
  }
  function attackFields(a={}){return[
    {name:"name",label:"Attack name",value:a.name||"",required:true,full:true},
    {name:"bonus",label:"Attack bonus (e.g. +5)",value:a.bonus??"+0"},
    {name:"damage",label:"Damage dice (e.g. 1d8+3)",value:a.damage||"1d6"},
    {name:"damageType",label:"Damage type",value:a.damageType||""},
    {name:"notes",label:"Notes / properties",type:"textarea",rows:2,value:a.notes||"",full:true}
  ];}
  function addAttack(id){const c=state.characters.find(x=>x.id===id);if(!c||!canEditCharacter(c))return;openForm("Add attack",attackFields(),v=>{if(!v.name.trim())return;mutate(()=>{if(!Array.isArray(c.attackOptions))c.attackOptions=[];c.attackOptions.push({id:makeId(),name:v.name.trim(),bonus:v.bonus,damage:v.damage,damageType:v.damageType,notes:v.notes});});});}
  function editAttack(cid,aid){const c=state.characters.find(x=>x.id===cid),a=c?.attackOptions?.find(x=>x.id===aid);if(!c||!a||!canEditCharacter(c))return;openForm("Edit attack",attackFields(a),v=>{if(!v.name.trim())return;mutate(()=>Object.assign(a,{name:v.name.trim(),bonus:v.bonus,damage:v.damage,damageType:v.damageType,notes:v.notes}));});}
  function removeAttack(cid,aid){const c=state.characters.find(x=>x.id===cid);if(!c||!canEditCharacter(c)||!confirm("Remove this attack?"))return;mutate(()=>c.attackOptions=(c.attackOptions||[]).filter(x=>x.id!==aid));}
  function findAttack(c,id){const found=(c.attackOptions||[]).find(x=>x.id===id);if(found)return found;const line=String(c.attacks||"").split(/[\n]+/).map(x=>x.trim()).find(x=>"legacy-"+x===id);if(!line)return null;const parts=line.split("|").map(x=>x.trim());if(parts.length>=3)return{id,name:parts[0],bonus:parts[1].replace(/[^+\-0-9]/g,""),damage:parts[2],damageType:parts[3]||""};const match=line.match(/^(.+?):\s*([+-]?\d+)\s*to hit,\s*(.+)$/i);return{id,name:match?match[1]:line,bonus:match?match[2]:"0",damage:match?match[3]:""};}
  function rollAttack(cid,aid){const c=state.characters.find(x=>x.id===cid);if(!c||!canEditCharacter(c))return;const a=findAttack(c,aid);if(!a)return;const die=1+Math.floor(Math.random()*20),bonus=safeNumber(a.bonus),total=die+bonus;alert(a.name+" attack roll\n d20: "+die+"\nBonus: "+(bonus>=0?"+":"")+bonus+"\nTotal: "+total+(die===20?"\nNatural 20!":die===1?"\nNatural 1!":"")); }
  function rollDamage(cid,aid){const c=state.characters.find(x=>x.id===cid);if(!c||!canEditCharacter(c))return;const a=findAttack(c,aid);if(!a)return;const match=String(a.damage||"").match(/^(\d*)d(\d+)([+-]\d+)?$/i);if(!match)return alert("Use damage dice such as 1d8+3.");const count=Math.max(1,Math.min(100,safeNumber(match[1],1))),sides=Math.max(2,Math.min(1000,safeNumber(match[2]))),modifier=safeNumber(match[3]),rolls=Array.from({length:count},()=>1+Math.floor(Math.random()*sides)),total=Math.max(0,rolls.reduce((sum,n)=>sum+n,0)+modifier);alert(a.name+" damage\nRolls: "+rolls.join(" + ")+(modifier?(modifier>0?" + ":" - ")+Math.abs(modifier):"")+"\nTotal: "+total+" "+(a.damageType||"damage"));}
  function applyDamage(id){const c=state.characters.find(x=>x.id===id);if(!c||!canEditCharacter(c))return;openForm("Apply damage to "+c.name,[{name:"amount",label:"Damage amount",type:"number",min:1,value:1}],v=>{const amount=Math.max(0,safeNumber(v.amount));if(!amount)return;mutate(()=>{const absorbed=Math.min(safeNumber(c.tempHp),amount);c.tempHp=Math.max(0,safeNumber(c.tempHp)-absorbed);const remaining=amount-absorbed;if(safeNumber(c.hp)>0)c.hp=Math.max(0,safeNumber(c.hp)-remaining);else if(remaining>0)c.deathFailures=Math.min(3,safeNumber(c.deathFailures)+1);if(c.deathFailures>=3)c.deathStatus="Dead";});});}
  function healCharacter(id){const c=state.characters.find(x=>x.id===id);if(!c||!canEditCharacter(c))return;openForm("Heal "+c.name,[{name:"amount",label:"Healing amount",type:"number",min:1,value:1}],v=>{const amount=Math.max(0,safeNumber(v.amount));if(!amount)return;mutate(()=>{c.hp=Math.min(safeNumber(c.maxHp),safeNumber(c.hp)+amount);if(c.hp>0){c.deathSuccesses=0;c.deathFailures=0;c.deathStatus="";}});});}
  function deathSave(id,result){const c=state.characters.find(x=>x.id===id);if(!c||!canEditCharacter(c)||safeNumber(c.hp)>0||c.deathStatus==="Dead"||c.deathStatus==="Stable")return;mutate(()=>{if(result>0)c.deathSuccesses=Math.min(3,safeNumber(c.deathSuccesses)+1);else c.deathFailures=Math.min(3,safeNumber(c.deathFailures)+1);if(c.deathSuccesses>=3)c.deathStatus="Stable";if(c.deathFailures>=3)c.deathStatus="Dead";});}
  function editConditions(id){const c=state.characters.find(x=>x.id===id);if(!c||!canEditCharacter(c))return;openForm("Manage active conditions",[{name:"conditions",label:"One condition per line",type:"textarea",rows:8,value:(c.activeConditions||[]).join("\n"),full:true}],v=>mutate(()=>c.activeConditions=v.conditions.split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean)));}


  function slot(id,index,amount) {
    const c = state.characters.find(x=>x.id===id);
    if (!c || !canEditCharacter(c)) return;
    if (!c.spellSlots) c.spellSlots = Array.from({length:9},()=>({used:0,total:0}));
    const s = c.spellSlots[index];
    if (amount>0 && s.used>=s.total) return;
    mutate(()=>s.used=Math.max(0,s.used+amount));
  }
  function configureSlots(id){
    const c=state.characters.find(x=>x.id===id);if(!c||!canEditCharacter(c))return;
    const slots=c.spellSlots||Array.from({length:9},()=>({used:0,total:0}));
    openForm("Configure spell slots",slots.map((slot,i)=>({name:"level"+i,label:"Spell slot level "+(i+1),type:"number",min:0,value:slot.total})),v=>{
      const updated=slots.map((slot,i)=>{const total=Math.max(0,safeNumber(v["level"+i]));return{total,used:Math.min(safeNumber(slot.used),total)};});
      mutate(()=>c.spellSlots=updated);
    });
  }  function addQuest(){
    if(!isDM())return;
    openForm("Add quest",[{name:"title",label:"Quest title",required:true,full:true},{name:"description",label:"Quest description",type:"textarea",rows:5,full:true},{name:"reward",label:"Reward",type:"textarea",rows:2,full:true}],v=>{
      if(!v.title.trim())return alert("Please enter a quest title.");
      mutate(()=>state.quests.unshift({id:makeId(),title:v.title.trim(),description:v.description,reward:v.reward,status:"Active"}));
    });
  }
  function setQuestStatus(id,status){
    if(!isDM()||!["Active","Completed","Failed"].includes(status))return;
    const q=state.quests.find(x=>x.id===id);if(!q)return;
    mutate(()=>q.status=status);
  }
  function openQuestDetails(id){
    const q=state.quests.find(x=>x.id===id);if(!q)return;
    const modal=$("hub-modal");
    modal.innerHTML=`<div class="modal-card"><div class="modal-top"><h3>${escapeHTML(q.title)}</h3><button class="modal-close" onclick="Hub.closeModal()">✕</button></div>
      <div class="list-meta">${escapeHTML(q.status||"Active")}</div>
      <p style="white-space:pre-wrap;margin:15px 0">${escapeHTML(q.description||"No description provided.")}</p>
      <h3>REWARD</h3><p style="white-space:pre-wrap">${escapeHTML(q.reward||"No reward specified.")}</p>
      ${isDM()?'<div class="modal-actions"><button class="small-button" onclick="Hub.editQuest(\''+q.id+'\')">EDIT QUEST</button><button class="hub-button" onclick="Hub.closeModal()">CLOSE</button></div>':""}
    </div>`;
    modal.hidden=false;modal.onclick=e=>{if(e.target===modal)closeModal();};
  }
  function editQuest(id){
    if(!isDM())return;const q=state.quests.find(x=>x.id===id);if(!q)return;
    openForm("Edit quest",[{name:"title",label:"Quest title",value:q.title,required:true,full:true},{name:"description",label:"Quest description",type:"textarea",rows:5,value:q.description||"",full:true},{name:"reward",label:"Reward",type:"textarea",rows:2,value:q.reward||"",full:true},{name:"status",label:"Status",type:"select",value:q.status||"Active",options:["Active","Completed","Failed"].map(x=>({value:x,label:x}))}],v=>{
      if(!v.title.trim())return alert("Please enter a quest title.");
      mutate(()=>Object.assign(q,{title:v.title.trim(),description:v.description,reward:v.reward,status:v.status}));
    });
  }
  function addJournal(){openJournalEditor(null);}  function editJournal(id){const entry=state.journal.find(x=>x.id===id);if(!entry||(!isDM()&&entry.ownerId!==member?.id))return;openJournalEditor(entry);}  function addEvent(){
    const c=state.calendarConfig,fields=[{name:"title",label:"Event title",required:true,full:true}];
    if(c)fields.push({name:"month",label:"Month",type:"select",value:String(c.currentDate.month),options:c.months.map((m,i)=>({value:String(i),label:m.name}))},{name:"day",label:"Day",type:"number",value:c.currentDate.day,min:1,max:c.months[c.currentDate.month].days},{name:"year",label:"Year",type:"number",value:c.currentDate.year,min:0});
    else fields.push({name:"date",label:"Date or session"});
    fields.push({name:"description",label:"Event description",type:"textarea",rows:5,full:true});
    openForm("Add calendar event",fields,v=>{let fantasyDate=null;if(c){const month=safeNumber(v.month),day=safeNumber(v.day),year=safeNumber(v.year);if(!c.months[month]||day<1||day>c.months[month].days||year<0)return alert("Please enter a valid date.");fantasyDate={year,month,day};}mutate(()=>state.events.push({id:makeId(),title:v.title.trim(),date:c?null:v.date,fantasyDate,description:v.description,...(!isDM()?{ownerId:member.id}:{})}));});
  }  function editEvent(id){
    const e=state.events.find(x=>x.id===id);if(!e||(!isDM()&&e.ownerId!==member?.id))return;const c=state.calendarConfig,d=e.fantasyDate||(c?c.currentDate:null),fields=[{name:"title",label:"Event title",value:e.title||"",required:true,full:true}];
    if(c)fields.push({name:"month",label:"Month",type:"select",value:String(d.month),options:c.months.map((m,i)=>({value:String(i),label:m.name}))},{name:"day",label:"Day",type:"number",value:d.day,min:1,max:c.months[d.month].days},{name:"year",label:"Year",type:"number",value:d.year,min:0});else fields.push({name:"date",label:"Date or session",value:e.date||""});
    fields.push({name:"description",label:"Event description",type:"textarea",rows:5,value:e.description||"",full:true});
    openForm("Edit calendar event",fields,v=>{let fantasyDate=null;if(c){const month=safeNumber(v.month),day=safeNumber(v.day),year=safeNumber(v.year);if(!c.months[month]||day<1||day>c.months[month].days||year<0)return alert("Please enter a valid date.");fantasyDate={year,month,day};}mutate(()=>Object.assign(e,{title:v.title.trim(),date:c?null:v.date,fantasyDate,description:v.description}));});
  }  function addNotice(){if(!isDM())return;openForm("Publish notice",[{name:"title",label:"Notice title",required:true,full:true},{name:"body",label:"Announcement",type:"textarea",rows:7,full:true}],v=>{if(!v.title.trim())return alert("Please enter a notice title.");mutate(()=>state.notices.unshift({id:makeId(),title:v.title.trim(),body:v.body,date:new Date().toLocaleDateString(),createdAt:new Date().toISOString(),readBy:[member.id]}));});}
  function markNoticeRead(id){const n=state.notices.find(x=>x.id===id);if(!n||!member)return;if(!Array.isArray(n.readBy))n.readBy=[];if(n.readBy.includes(member.id))return;n.readBy.push(member.id);refresh();persist();}  function removeItem(collection,id) {
    const item = state[collection]?.find(x=>x.id===id);
    if (!item) return;
    if (!isDM() && !(["journal","events"].includes(collection) && item.ownerId===member?.id)) return;
    if (!confirm("Are you sure you want to delete this?")) return;
    mutate(()=>state[collection]=state[collection].filter(x=>x.id!==id));
  }

  function removeCharacter(id) {
    const character=state.characters.find(x=>x.id===id);
    if (!character || !canEditCharacter(character)) return;
    if (!confirm("Remove this character from the party?")) return;
    mutate(()=>state.characters=state.characters.filter(x=>x.id!==id));
  }


  function resetCampaign(){
    if(!isDM())return;
    openForm("Permanently reset campaign",[
      {name:"confirmation",label:"This permanently deletes the map, drawings, characters, quests, NPCs, journal entries, calendar, events and notices. Player accounts, access codes and memberships will stay. Type RESET to continue.",required:true,full:true,placeholder:"Type RESET"}
    ],v=>{
      if(v.confirmation.trim()!=="RESET"){alert("The confirmation did not match. Nothing was deleted.");return;}
      performCampaignReset();
    });
  }
  async function performCampaignReset(){
    if(!isDM()||saving)return;
    clearTimeout(saveTimer);
    pending=false;
    status("Resetting campaign...");
    saving=true;
    try{
      const {data,error}=await client.functions.invoke("campaign-data",{body:{action:"reset-campaign"}});
      if(error)throw error;
      state=blank();
      calendarView=null;
      mapDrawing=false;
      $("map-drawing-canvas").classList.remove("is-drawing");
      $("map-frame").classList.remove("is-drawing");
      refresh();
      status(data?.storage_cleanup_warning?"✓ Campaign reset · map file cleanup needs attention":"✓ Campaign reset · "+(data?.map_files_removed||0)+" map file(s) removed");
    }catch(err){
      status("Campaign reset failed");
      alert("The campaign could not be reset. "+(err.message||""));
    }finally{
      saving=false;
    }
  }

  function clearMarkers() {
    if (!isDM()) return;
    if (!confirm("Remove all map markers?")) return;
    mutate(()=>state.markers=[]);
  }

  function go(tab){
    if(tab!=="character-sheet"&&activeCharacterSheetId){activeCharacterSheetId="";const st=root.querySelector('[data-tab="character-sheet"]');if(st)st.hidden=true;}
    if(tab==="dm-controls"&&!isDM())tab="dashboard";
    root.querySelectorAll(".hub-page").forEach(p=>p.classList.remove("active"));
    root.querySelectorAll(".hub-nav button").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));
    const page=$("page-"+tab);if(page)page.classList.add("active");
    if(tab==="spellbook")renderSpellbook();
    if(tab==="character-sheet"){renderCharacterSheet();renderSpellbook();}
    if(tab==="world")renderWorld();
  }
  $("campaign-search-input").addEventListener("input",searchCampaign);
  $("campaign-import-file").addEventListener("change",e=>{const file=e.target.files?.[0];if(file)importCampaign(file);e.target.value="";});
  $("reference-search").addEventListener("keydown",e=>{if(e.key==="Enter"){referencePage=1;loadReference();}});
  $("reference-edition").addEventListener("change",e=>{referenceEdition=e.target.value;referencePage=1;loadReference();});
  root.querySelectorAll("[data-reference-category]").forEach(b=>b.addEventListener("click",()=>selectReferenceCategory(b.dataset.referenceCategory)));
  root.querySelectorAll(".hub-nav button").forEach(b=>{
    b.addEventListener("click",()=>go(b.dataset.tab));
  });

  const frame=$("map-frame");
  window.addEventListener("resize",()=>redrawMapCanvas());
  const mapCanvas=$("map-drawing-canvas");
  function redrawMapCanvas(){if(!mapCanvas)return;const rect=frame.getBoundingClientRect();mapCanvas.width=Math.max(1,Math.round(rect.width));mapCanvas.height=Math.max(1,Math.round(rect.height));const ctx=mapCanvas.getContext("2d");ctx.clearRect(0,0,mapCanvas.width,mapCanvas.height);(state.mapDrawings||[]).forEach(path=>{if(!path.points||path.points.length<2)return;ctx.beginPath();ctx.strokeStyle=path.colour||"#f3d58b";ctx.lineWidth=path.width||3;ctx.lineCap="round";ctx.lineJoin="round";path.points.forEach((p,i)=>{const x=p.x*mapCanvas.width,y=p.y*mapCanvas.height;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();});}
  function toggleMapDrawing(){if(!isDM())return;mapDrawing=!mapDrawing;mapCanvas.classList.toggle("is-drawing",mapDrawing);frame.classList.toggle("is-drawing",mapDrawing);$("map-draw-toggle").textContent=mapDrawing?"FINISH DRAWING":"DRAW ON MAP";}
  function removeMap(){if(!isDM()||!state.mapUrl)return;if(!confirm("Remove the uploaded map image and its drawings?"))return;mutate(()=>{state.mapUrl="";state.mapDrawings=[];});}
  function editMapLegend(){if(!isDM())return;const colours=[["#E66D69","Red"],["#6D9DD5","Blue"],["#76B68A","Green"],["#D6AD5D","Gold"],["#B28BD6","Purple"],["#E69AC0","Pink"],["#E9E5DA","White"]];openForm("Map legend",colours.map(([colour,name])=>({name:colour,label:name+" marker meaning",value:state.markerLegend?.[colour]||"",placeholder:"e.g. Settlements"})),v=>mutate(()=>{state.markerLegend={...(state.markerLegend||{}),...v};}));}
  mapCanvas.addEventListener("pointerdown",e=>{if(!mapDrawing||!isDM())return;const r=mapCanvas.getBoundingClientRect(),path={colour:"#f3d58b",width:3,points:[{x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height}]};state.mapDrawings=state.mapDrawings||[];state.mapDrawings.push(path);mapCanvas.setPointerCapture(e.pointerId);redrawMapCanvas();});
  mapCanvas.addEventListener("pointermove",e=>{if(!mapDrawing||!isDM()||!e.buttons)return;const path=state.mapDrawings?.[state.mapDrawings.length-1];if(!path)return;const r=mapCanvas.getBoundingClientRect();path.points.push({x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height});redrawMapCanvas();});
  mapCanvas.addEventListener("pointerup",()=>{if(mapDrawing)persist();});mapCanvas.addEventListener("pointercancel",()=>{if(mapDrawing)persist();});
  frame.addEventListener("click",e=>{
    if (!isDM() || mapDrawing || e.target.closest(".map-marker")) return;
    const rect=frame.getBoundingClientRect();
    const x=Math.max(0,Math.min(100,(e.clientX-rect.left)/rect.width*100));
    const y=Math.max(0,Math.min(100,(e.clientY-rect.top)/rect.height*100));
    const colour=$("marker-colour").value;
    openForm("Add map location",[{name:"label",label:"Location name",required:true}],v=>{if(!v.label.trim())return alert("Please enter a location name.");mutate(()=>state.markers.push({id:makeId(),x,y,label:v.label.trim(),colour}));});
  });

  frame.addEventListener("pointerdown",e=>{
    const marker=e.target.closest(".map-marker");
    if (!marker || !isDM()) return;
    e.stopPropagation();
    dragging=marker.dataset.marker;
    marker.setPointerCapture?.(e.pointerId);
  });

  frame.addEventListener("pointermove",e=>{
    if (!dragging || !isDM()) return;
    const marker=state.markers.find(m=>m.id===dragging);
    if (!marker) return;
    const rect=frame.getBoundingClientRect();
    marker.x=Math.max(0,Math.min(100,(e.clientX-rect.left)/rect.width*100));
    marker.y=Math.max(0,Math.min(100,(e.clientY-rect.top)/rect.height*100));
    const el=root.querySelector(`[data-marker="${CSS.escape(dragging)}"]`);
    if (el) {
      el.style.left=marker.x+"%";
      el.style.top=marker.y+"%";
    }
  });

  frame.addEventListener("pointerup",()=>{
    if (!dragging) return;
    dragging=null;
    persist();
  });
  frame.addEventListener("pointercancel",()=>{
    if (dragging) {dragging=null;persist();}
  });

  $("map-markers").addEventListener("click",e=>{
    const marker=e.target.closest(".map-marker");
    if (!marker) return;
    e.stopPropagation();
    const m=state.markers.find(x=>x.id===marker.dataset.marker);
    if (!m || !isDM()) return;
    openForm("Edit map location",[{name:"label",label:"Location name",value:m.label,required:true},{name:"action",label:"Location action",type:"select",value:"keep",options:[{value:"keep",label:"Keep this location"},{value:"delete",label:"Delete this location"}]}],v=>{if(v.action==="delete"){if(confirm("Delete this map location?"))mutate(()=>state.markers=state.markers.filter(x=>x.id!==m.id));return;}if(!v.label.trim())return alert("Please enter a location name.");mutate(()=>m.label=v.label.trim());});
  });

  $("map-upload").addEventListener("change",async e=>{
    const file=e.target.files[0];
    if (!file || !isDM()) return;
    if (!file.type.startsWith("image/")) return alert("Please select an image.");
    if (file.size>10*1024*1024) return alert("Please use an image smaller than 10MB.");
    status("Uploading map...");
    try {
      const {data:upload,error:signError}=await client.functions.invoke("campaign-data", {
        body:{action:"create-map-upload",filename:file.name,content_type:file.type}
      });
      if (signError) throw signError;
      const {error:uploadError}=await client.storage.from("campaign-maps")
        .uploadToSignedUrl(upload.path,upload.token,file,{contentType:file.type,upsert:false});
      if (uploadError) throw uploadError;
      mutate(()=>state.mapUrl=upload.publicUrl);
      status("Map uploaded");
    } catch(err) {
      status("Upload failed");
      alert(err.message);
    }
    e.target.value="";
  });

  const Hub = {jumpTo:(id)=>{const target=$(id);if(target)target.scrollIntoView({behavior:"smooth",block:"start"});},startSessionMode,finishSessionMode,cancelSessionMode,showBuilderSection:(id)=>{const allowed=["core","combat","spells","inventory","features","notes"];if(!allowed.includes(id))return;const host=$("character-sheet-content");host.querySelectorAll("[data-builder-panel]").forEach(panel=>panel.classList.toggle("active",panel.dataset.builderPanel===id));host.querySelectorAll(".ddb-builder-tabs button").forEach(button=>{const active=button.dataset.builderTab===id;button.classList.toggle("active",active);button.setAttribute("aria-selected",active?"true":"false");});},showCharacterSection:(id)=>{const allowed=["core","saves","combat","spells","inventory","features","notes"];if(!allowed.includes(id))return;const host=$("character-sheet-content");host.querySelectorAll("[data-sheet-panel]").forEach(panel=>panel.classList.toggle("active",panel.dataset.sheetPanel===id));host.querySelectorAll(".beyond-tab-nav button").forEach(button=>{const active=button.dataset.sheetTab===id;button.classList.toggle("active",active);button.setAttribute("aria-selected",active?"true":"false");});try{localStorage.setItem("dnd-sheet-tab:"+activeCharacterSheetId,id);}catch(e){}},addAttack,editAttack,removeAttack,rollAttack,rollDamage,applyDamage,healCharacter,deathSave,editConditions,configureSlots,
    openReferenceEntry,
    applyReferenceEntry,
    addHomebrew,
    editHomebrew,
    removeHomebrew,
    selectReferenceCategory,
    changeReferencePage,
    loadReference,
    renderSpellbook,selectSpellbookCharacter,addSpellToBook,addSpellToBookFor,editSpell,togglePreparedSpell,removeSpell,openCharacterSheet,setTempHP,
    searchBestiary,viewBestiary,saveBestiaryCreature,addBestiaryCreature,addEncounter,editEncounter,removeEncounter,
    renderWorld,addWorldEntry,editWorldEntry,removeWorldEntry,
    takeRest,
    editResources,
    exportCampaign,
    importCampaign,
    resetCampaign,
    go,
    addCharacter:()=>addCharacter(),
    addNPC:()=>addNPC(),
    randomizeCharacter,
    randomizeNPC,
    addQuest,
    editQuest,
    addJournal,
    editJournal,
    addEvent,
    editEvent,
    saveCalendarSetup,
    editCalendarSetup,
    calendarMonth,
    calendarToday,
    toggleCalendarDay,
    advanceCalendarDay,
    addCombatant,
    addCombatEnemy,
    addCharacterItem,
    editCharacterItem,
    toggleEquippedItem,
    removeCharacterItem,
    editCharacterGold,
    addSharedItem,
    addSession,
    editSession,
    removeSession,
    openSearchResult,
    editSharedItem,
    removeSharedItem,
    editPartyGold,
    startCombat,
    nextCombatTurn,
    previousCombatTurn,
    endCombat,
    clearCombat,
    adjustCombatHP,
    editCombatant,
    removeCombatant,
    addNotice,
    markNoticeRead,
    closeModal,
    toggleMapDrawing,
    editMapLegend,
    removeMap,
    editCharacter,
    editNPC,
    changeHP,
    slot,
    openQuestDetails,
    setQuestStatus,
    toggleEventAttendance,
    removeItem,
    removeCharacter,
    clearMarkers,
    removeMapMarker:(id)=>{if(!isDM())return;mutate(()=>state.markers=state.markers.filter(m=>m.id!==id));}
  };
  window.Hub=Hub;

  function applyPermissions() {
    if (isDM()) return;
    root.querySelectorAll(".dm-only,.upload-button,.map-toolbar,[onclick*='Hub.addQuest'],[onclick*='Hub.addNPC'],[onclick*='Hub.addNotice']").forEach(el=>el.style.display="none");
    root.querySelectorAll(".map-instructions").forEach(el=>el.textContent="Explore the world map and view its locations.");
  }

  async function init() {
    if (SUPABASE_URL.includes("YOUR_") || SUPABASE_KEY.includes("YOUR_")) {
      $("hub-loading").textContent="ADD YOUR SUPABASE CONNECTION DETAILS IN THE CODE.";
      status("Waiting for setup");
      return;
    }

    try {
      const access = await window.campaignAccessReady;
      client = window.campaignClient;
      member = access.member;

      const {data,error}=await client.functions.invoke("campaign-data", {body:{action:"load"}});
      if (error) throw error;

      state={...blank(),...(data.data||{})};
      ["markers","mapDrawings","characters","quests","npcs","journal","events","notices","elapsedDays","sharedInventory","sessions","homebrew","encounters","worldEntries"].forEach(k=>{
        if (!Array.isArray(state[k])) state[k]=[];
      });

      state.partyGold=safeNumber(state.partyGold);
      let playerNameSynced=false;
      if(member?.role==="player")state.characters.forEach(c=>{if(c.ownerId===member.id&&!c.isNPC&&c.player!==member.display_name){c.player=member.display_name;playerNameSynced=true;}});
      ready=true;
      $("hub-loading").style.display="none";
      applyPermissions();
      refresh();
      redrawMapCanvas();
      loadReference();
      status("✓ Connected to campaign");
      if(playerNameSynced)persist();

      channel=client.channel("campaign-live")
        .on("postgres_changes",{
          event:"UPDATE",schema:"public",table:"campaign_hub",
          filter:"id=eq.main"
        },payload=>{
          if (pending || saving) return;
          if (payload.new && payload.new.data) {
            state={...blank(),...payload.new.data};
            refresh();
            status("✓ Live update received");
          }
        })
        .subscribe();

    } catch(err) {
      $("hub-loading").textContent="COULD NOT CONNECT TO THE CAMPAIGN.";
      status("Connection error");
      console.error(err);
    }
  }

  init();
})();
