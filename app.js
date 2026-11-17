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
    homebrew:[]
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
    renderReferenceLibrary();
    renderCharacters();
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
    {name:"notes",label:"Description / notes",type:"textarea",rows:3,value:item.notes||"",full:true}
  ];}
  function addCharacterItem(id){const c=state.characters.find(x=>x.id===id);if(!c||!canEditCharacter(c))return;openForm("Add item to "+c.name,inventoryItemFields(),v=>{if(!v.name.trim())return alert("Please enter an item name.");mutate(()=>{if(!Array.isArray(c.inventoryItems))c.inventoryItems=[];c.inventoryItems.push({id:makeId(),name:v.name.trim(),category:v.category,rarity:v.rarity,quantity:Math.max(1,safeNumber(v.quantity,1)),weight:v.weight,value:v.value,notes:v.notes});});});}
  function editCharacterItem(cid,iid){const c=state.characters.find(x=>x.id===cid),item=c?.inventoryItems?.find(x=>x.id===iid);if(!c||!item||!canEditCharacter(c))return;openForm("Edit "+item.name,inventoryItemFields(item),v=>{if(!v.name.trim())return alert("Please enter an item name.");mutate(()=>Object.assign(item,{name:v.name.trim(),category:v.category,rarity:v.rarity,quantity:Math.max(1,safeNumber(v.quantity,1)),weight:v.weight,value:v.value,notes:v.notes}));});}
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
      const sections=[["SUMMARY",s.summary],["IMPORTANT DECISIONS",s.decisions],["DISCOVERIES",s.discoveries],["NPC ENCOUNTERS",s.npcEncounters],["UNRESOLVED HOOKS",s.openHooks]];
      sections.forEach(([label,value])=>{if(value)out+='<div class="session-detail"><strong>'+label+'</strong><p>'+escapeHTML(value)+'</p></div>';});
      if(isDM())out+='<div class="card-actions"><button onclick="Hub.editSession(\''+s.id+'\')">EDIT</button><button onclick="Hub.removeSession(\''+s.id+'\')">DELETE</button></div>';
      return out+'</article>';
    }).join(""):empty("No sessions have been recorded yet.");
  }
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
        ["markers","mapDrawings","characters","quests","npcs","journal","events","notices","elapsedDays","sharedInventory","sessions","homebrew"].forEach(k=>{if(!Array.isArray(fresh[k]))fresh[k]=[];});
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


  let referenceCategory="spells", referenceResults=[], referenceEdition="both", referencePage=1, referenceHasNext=false;
  const referenceTypes={spells:"spells",species:"species",classes:"classes",backgrounds:"backgrounds",feats:"feats",items:"items",creatures:"creatures",languages:"languages",conditions:"conditions"};
  function sourceEdition(entry){
    const key=String(entry.document?.key||"").toLowerCase();
    return key.includes("2024")?"2024":key.includes("2014")?"2014":"Open5e";
  }
  async function loadReference(){
    const list=$("reference-results");if(!list)return;
    const q=$("reference-search").value.trim();list.innerHTML=empty("Searching the open rules library...");
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
    if(!entries.length){list.innerHTML=empty("No entries found. Try a different search or create a homebrew entry.");return;}
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
        else if(referenceCategory==="spells")c.spells=[c.spells||"",line].filter(Boolean).join("\n");
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
    (state.quests||[]).forEach(x=>add("Quest",x.id,x.title,[x.description,x.reward,x.status].join(" "),"adventure"));
    (state.journal||[]).forEach(x=>add("Journal",x.id,x.title,[x.date,x.author,x.body].join(" "),"journal"));
    (state.events||[]).forEach(x=>add("Calendar event",x.id,x.title,[x.date,x.description,x.fantasyDate?JSON.stringify(x.fantasyDate):""].join(" "),"adventure"));
    (state.markers||[]).forEach(x=>add("Map location",x.id,x.label,x.description||"","adventure"));
    (state.sharedInventory||[]).forEach(x=>add("Party loot",x.id,x.name,[x.category,x.rarity,x.notes,x.value].join(" "),"inventory"));
    (state.characters||[]).forEach(c=>(c.inventoryItems||[]).forEach(x=>add("Character item",x.id,x.name,[c.name,x.category,x.rarity,x.notes,x.value].join(" "),"inventory")));
    (state.sessions||[]).forEach(x=>add("Session "+safeNumber(x.number),x.id,x.title,[x.date,x.summary,x.decisions,x.discoveries,x.npcEncounters,x.openHooks].join(" "),"sessions"));
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
            <button onclick="Hub.editCharacter('${c.id}')">EDIT</button>
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
          ${c.rulesEdition==="2024"?`<div class="hp-line"><strong>EXHAUSTION</strong><span>${safeNumber(c.exhaustion)}/6</span></div>`:""}
        `:`
          <div class="tag">HP ${hp}/${max}</div>
          <div class="tag">AC ${safeNumber(c.ac)}</div>
          ${canEdit?`<div class="card-actions">
            <button onclick="Hub.editCharacter('${c.id}')">OPEN PROFILE / EDIT</button>
            <button onclick="Hub.removeCharacter('${c.id}')">REMOVE</button>
          </div>`:`<p class="list-meta">VIEW ONLY</p>`}
        `}
      </article>`;
  }

  function renderCharacters() {
    $("character-list").innerHTML = state.characters.length
      ? state.characters.map(c=>characterCard(c,false)).join("")
      : empty("No character profiles have been created.");
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
    const options=isDM()
      ?[{value:"player",label:"Player character"},{value:"npc",label:"NPC"},{value:"companion",label:"NPC companion"}]
      :[{value:"player",label:"Player character"}];
    return [
      {name:"recordType",label:"Is this a player character, NPC or NPC companion?",type:"select",value:type,options,required:true,full:true},
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
      {name:"notes",label:"Additional notes",type:"textarea",rows:4,value:data.notes||"",group:"player companion npc",full:true}
    ];
  }
  function openArchiveEditor(data=null,collection="characters"){
    if(collection==="npcs"&&!isDM())return;
    if(data&&collection==="characters"&&!canEditCharacter(data))return;
    const editing=!!data;
    const initialType=collection==="npcs"?"npc":data?.isNPC?"companion":"player";
    openForm(editing?"Edit archive entry":"Add to character & NPC archive",archiveFields(data||{},initialType),v=>{
      if(!v.name.trim())return alert("Please enter a name.");
      const type=v.recordType,portrait=v.portraitFile||v.portrait||data?.portrait||"";
      const common={id:data?.id||makeId(),name:v.name.trim(),race:v.race,className:v.className,alignment:v.alignment,portrait,personality:v.personality,ideals:v.ideals,bonds:v.bonds,flaws:v.flaws,backstory:v.backstory,loveInterest:v.loveInterest,notes:v.notes,rulesEdition:v.rulesEdition||"2014",exhaustion:Math.max(0,Math.min(6,safeNumber(v.exhaustion))),hitDiceUsed:Math.max(0,safeNumber(v.hitDiceUsed)),resources:Array.isArray(data?.resources)?data.resources:[]};
      if(type==="npc"){
        const npc={...common,player:v.player,role:v.role,location:v.location,relationship:v.relationship,description:v.description,goals:v.goals,secrets:v.secrets,challengeRating:v.challengeRating,senses:v.senses,languages:v.languages,npcActions:v.npcActions,hp:Math.max(0,safeNumber(v.hp)),maxHp:Math.max(1,safeNumber(v.maxHp,1)),ac:safeNumber(v.ac),initiative:safeNumber(v.initiative),speed:safeNumber(v.speed),hitDice:v.hitDice,proficiency:safeNumber(v.proficiency),strength:safeNumber(v.strength,10),dexterity:safeNumber(v.dexterity,10),constitution:safeNumber(v.constitution,10),intelligence:safeNumber(v.intelligence,10),wisdom:safeNumber(v.wisdom,10),charisma:safeNumber(v.charisma,10),savingThrows:v.savingThrows,skills:v.skills,features:v.features,spells:v.spells};
        if(!isDM())return;
        mutate(()=>{
          if(collection==="characters")state.characters=state.characters.filter(x=>x.id!==data?.id);
          if(collection==="npcs"&&data)Object.assign(data,npc);
          else state.npcs.unshift(npc);
        });
      }else{
        const c={...common,player:type==="player"?(isDM()?v.player:member.display_name):"",background:v.background,level:Math.max(1,safeNumber(v.level,1)),experience:Math.max(0,safeNumber(v.experience)),hp:Math.max(0,safeNumber(v.hp)),maxHp:Math.max(1,safeNumber(v.maxHp,1)),ac:safeNumber(v.ac),initiative:safeNumber(v.initiative),speed:safeNumber(v.speed),hitDice:v.hitDice,proficiency:safeNumber(v.proficiency),strength:safeNumber(v.strength,10),dexterity:safeNumber(v.dexterity,10),constitution:safeNumber(v.constitution,10),intelligence:safeNumber(v.intelligence,10),wisdom:safeNumber(v.wisdom,10),charisma:safeNumber(v.charisma,10),savingThrows:v.savingThrows,skills:v.skills,features:v.features,spells:v.spells,gear:v.gear,isNPC:type==="companion",resources:Array.isArray(data?.resources)?data.resources:[],hitDiceUsed:Math.max(0,safeNumber(data?.hitDiceUsed))};
        c.hp=Math.min(c.hp,c.maxHp);
        if(!isDM())c.ownerId=member.id;else if(data?.ownerId)c.ownerId=data.ownerId;
        mutate(()=>{
          if(collection==="npcs")state.npcs=state.npcs.filter(x=>x.id!==data?.id);
          if(data&&collection==="characters")Object.assign(data,c);
          else state.characters.push(c);
        });
      }
    });
  }
  function addCharacter(){openArchiveEditor(null,"characters");}
  function editCharacter(id){const c=state.characters.find(x=>x.id===id);if(c)openArchiveEditor(c,"characters");}
  function addNPC(){if(isDM())openArchiveEditor(null,"npcs");}
  function editNPC(id){const n=state.npcs.find(x=>x.id===id);if(n)openArchiveEditor(n,"npcs");}
  function changeHP(id,amount) {
    const c = state.characters.find(x=>x.id===id);
    if (!c || !canEditCharacter(c)) return;
    mutate(()=>c.hp=Math.max(0,Math.min(safeNumber(c.maxHp),safeNumber(c.hp)+amount)));
  }

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
    const adventureTabs=["map","party","quests","calendar"];
    root.querySelectorAll(".hub-page").forEach(p=>p.classList.remove("active"));
    root.querySelectorAll(".hub-nav button").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));
    const adventureGrid=root.querySelector(".adventure-board-grid");
    if(adventureGrid)adventureGrid.classList.toggle("adventure-visible",tab==="adventure");
    if(tab==="adventure")adventureTabs.forEach(name=>$("page-"+name).classList.add("active"));
    else{const page=$("page-"+tab);if(page)page.classList.add("active");}
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

  const Hub = {configureSlots,
    openReferenceEntry,
    applyReferenceEntry,
    addHomebrew,
    editHomebrew,
    removeHomebrew,
    selectReferenceCategory,
    changeReferencePage,
    loadReference,
    takeRest,
    editResources,
    exportCampaign,
    importCampaign,
    resetCampaign,
    go,
    addCharacter:()=>addCharacter(),
    addNPC:()=>addNPC(),
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
      ["markers","mapDrawings","characters","quests","npcs","journal","events","notices","elapsedDays","sharedInventory","sessions","homebrew"].forEach(k=>{
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
