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
    characters:[],
    quests:[],
    npcs:[],
    journal:[],
    events:[],
    notices:[]
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
    renderCharacters();
    renderQuests();
    renderNPCs();
    renderJournal();
    renderCalendar();
    renderNotices();
  }

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
      ? quests.map(q=>`<div class="list-card"><h3>${escapeHTML(q.title)}</h3><p>${escapeHTML(q.description)}</p></div>`).join("")
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
    $("map-legend").innerHTML = Object.keys(colours).map(c=>
      `<span class="legend-item"><i class="legend-dot" style="background:${escapeHTML(c)}"></i>${escapeHTML(c)}</span>`
    ).join("") || "No markers placed yet.";
  }

  function renderParty() {
    $("party-list").innerHTML = state.characters.length
      ? state.characters.map(c=>characterCard(c,true)).join("")
      : empty("Your party is waiting for its first adventurer.");
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
            <button onclick="Hub.configureSlots('${c.id}')">SET SPELL SLOTS</button>
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
      ? state.quests.map(q=>`
        <article class="list-card">
          <div class="list-meta">${escapeHTML(q.status)} · ${escapeHTML(q.reward||"No reward specified")}</div>
          <h3>${escapeHTML(q.title)}</h3>
          <p>${escapeHTML(q.description)}</p>
          ${isDM()?`<div class="card-actions">
            <button onclick="Hub.cycleQuest('${q.id}')">CHANGE STATUS</button>
            <button onclick="Hub.removeItem('quests','${q.id}')">DELETE</button>
          </div>`:""}
        </article>`).join("")
      : empty("No quests have been added.");
  }

  function renderNPCs() {
    $("npc-list").innerHTML = state.npcs.length
      ? state.npcs.map(n=>`
        <article class="character-card">
          <div class="card-subtitle">${escapeHTML(n.role||"UNKNOWN ROLE")}</div>
          <h3>${escapeHTML(n.name)}</h3>
          <p>${escapeHTML(n.description)}</p>
          <p><strong>Location:</strong> ${escapeHTML(n.location||"Unknown")}</p>
          <p><strong>Relationship:</strong> ${escapeHTML(n.relationship||"Unknown")}</p>
          ${isDM()?`<div class="card-actions"><button onclick="Hub.editNPC('${n.id}')">EDIT</button><button onclick="Hub.removeItem('npcs','${n.id}')">DELETE</button></div>`:""}
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
          ${(isDM() || j.ownerId===member?.id)?`${(isDM() || j.ownerId===member?.id)?`<div class="card-actions"><button onclick="Hub.editJournal('${j.id}')">EDIT ENTRY</button><button onclick="Hub.removeItem('journal','${j.id}')">DELETE ENTRY</button></div>`:""}`:""}
        </article>`).join("")
      : empty("Your campaign story starts here.");
  }

  function renderCalendar() {
    const events = [...state.events].sort((a,b)=>(a.date||"").localeCompare(b.date||""));
    $("calendar-list").innerHTML = events.length
      ? events.map(e=>`
        <article class="list-card">
          <div class="list-meta">${escapeHTML(e.date)}</div>
          <h3>${escapeHTML(e.title)}</h3>
          <p>${escapeHTML(e.description)}</p>
          ${(isDM() || e.ownerId===member?.id)?`${(isDM() || e.ownerId===member?.id)?`<div class="card-actions"><button onclick="Hub.editEvent('${e.id}')">EDIT EVENT</button><button onclick="Hub.removeItem('events','${e.id}')">DELETE EVENT</button></div>`:""}`:""}
        </article>`).join("")
      : empty("No events scheduled.");
  }

  function renderNotices() {
    $("notice-list").innerHTML = state.notices.length
      ? state.notices.map(n=>`
        <article class="list-card">
          <div class="list-meta">${escapeHTML(n.date)}</div>
          <h3>${escapeHTML(n.title)}</h3>
          <p>${escapeHTML(n.body)}</p>
          ${isDM()?`<div class="card-actions"><button onclick="Hub.removeItem('notices','${n.id}')">DELETE NOTICE</button></div>`:""}
        </article>`).join("")
      : empty("The notice board is empty.");
  }

  function mutate(fn) {
    fn();
    refresh();
    persist();
  }

  function ask(label,initial="") {
    const value = prompt(label,initial);
    return value === null ? null : value.trim();
  }

  function addCharacter(isNPC=false) {
    if (!isDM() && isNPC) return;
    const c = defaultsCharacter();
    c.isNPC = isDM() ? (isNPC || confirm("Is this character an NPC companion?")) : false;
    c.name = ask("Character name:");
    if (!c.name) return;
    c.player = isDM() ? (ask("Player name (optional):") || "") : member.display_name;
    c.race = ask("Race / species:") || "";
    c.className = ask("Class:") || "";
    c.level = Math.max(1,safeNumber(ask("Level:","1"),1));
    c.maxHp = Math.max(1,safeNumber(ask("Maximum HP:","10"),10));
    c.hp = Math.max(0,c.maxHp);
    c.ac = safeNumber(ask("Armour Class:","10"),10);
    c.isNPC = isDM() ? c.isNPC : false;
    if (!isDM()) c.ownerId = member.id;
    mutate(()=>state.characters.push(c));
  }

  function editCharacter(id) {
    const c = state.characters.find(x=>x.id===id);
    if (!c || !canEditCharacter(c)) return;
    const fields = [
      ["name","Character name"],["player","Player name"],["race","Race"],
      ["className","Class"],["level","Level"],["hp","Current HP"],
      ["maxHp","Maximum HP"],["ac","Armour Class"],["initiative","Initiative"],
      ["speed","Movement speed"],["gear","Equipment and inventory"],
      ["loveInterest","Relationships / love interest"],
      ["backstory","Backstory"],["notes","Personal notes"]
    ];
    const copy = {...c};
    for (const [key,label] of fields) {
      const value = ask(label + ":",copy[key] ?? "");
      if (value === null) return;
      copy[key] = ["level","hp","maxHp","ac","initiative","speed"].includes(key)
        ? safeNumber(value) : value;
    }
    copy.maxHp = Math.max(1,copy.maxHp);
    copy.hp = Math.max(0,Math.min(copy.hp,copy.maxHp));
    mutate(()=>Object.assign(c,copy));
  }

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
function configureSlots(id) {
  const c = state.characters.find(x=>x.id===id);
  if (!c || !canEditCharacter(c)) return;

  if (!c.spellSlots) {
    c.spellSlots = Array.from({length:9},()=>({used:0,total:0}));
  }

  const updated = c.spellSlots.map((slot,i)=>{
    const total = ask(
      "Total spell slots for level " + (i+1) + ":",
      String(slot.total)
    );
    if (total === null) return null;
    return {
      total:Math.max(0,safeNumber(total)),
      used:Math.min(slot.used,Math.max(0,safeNumber(total)))
    };
  });

  if (updated.some(x=>x===null)) return;
  mutate(()=>c.spellSlots=updated);
}
  function addQuest() {
    if (!isDM()) return;
    const title=ask("Quest title:");
    if (!title) return;
    const description=ask("Quest description:")||"";
    const reward=ask("Reward (optional):")||"";
    mutate(()=>state.quests.unshift({id:makeId(),title,description,reward,status:"Active"}));
  }

  function cycleQuest(id) {
    if (!isDM()) return;
    const q=state.quests.find(x=>x.id===id);
    if (!q) return;
    const states=["Active","Completed","Failed"];
    mutate(()=>q.status=states[(states.indexOf(q.status)+1)%states.length]);
  }

  function addNPC() {
    if (!isDM()) return;
    const name=ask("NPC name:");
    if (!name) return;
    const role=ask("Role / occupation:")||"";
    const description=ask("Description:")||"";
    const location=ask("Location:")||"";
    const relationship=ask("Relationship to the party:")||"";
    mutate(()=>state.npcs.unshift({id:makeId(),name,role,description,location,relationship}));
  }

  function editNPC(id) {
    if (!isDM()) return;
    const n=state.npcs.find(x=>x.id===id);
    if (!n) return;
    for (const key of ["name","role","description","location","relationship"]) {
      const v=ask(key.charAt(0).toUpperCase()+key.slice(1)+":",n[key]||"");
      if (v===null) return;
      n[key]=v;
    }
    refresh();persist();
  }

  function addJournal() {
    const title=ask("Journal entry title:");
    if (!title) return;
    const date=ask("In-world date or session number:")||"";
    const author=ask("Author / character:")||"";
    const body=ask("What happened?")||"";
    mutate(()=>state.journal.unshift({id:makeId(),title,date,author,body,...(!isDM()?{ownerId:member.id}:{})}));
  }

  function editJournal(id) {
    const entry=state.journal.find(x=>x.id===id);
    if (!entry || (!isDM() && entry.ownerId!==member?.id)) return;
    const title=ask("Journal entry title:",entry.title||"");
    if (title===null || !title) return;
    const date=ask("In-world date or session number:",entry.date||"");
    if (date===null) return;
    const author=ask("Author / character:",entry.author||"");
    if (author===null) return;
    const body=ask("What happened?",entry.body||"");
    if (body===null) return;
    mutate(()=>Object.assign(entry,{title,date,author,body}));
  }

  function addEvent() {
    const title=ask("Event title:");
    if (!title) return;
    const date=ask("Date (YYYY-MM-DD or your fantasy calendar):")||"";
    const description=ask("Event description:")||"";
    mutate(()=>state.events.push({id:makeId(),title,date,description,...(!isDM()?{ownerId:member.id}:{})}));
  }

  function editEvent(id) {
    const event=state.events.find(x=>x.id===id);
    if (!event || (!isDM() && event.ownerId!==member?.id)) return;
    const title=ask("Event title:",event.title||"");
    if (title===null || !title) return;
    const date=ask("Date (YYYY-MM-DD or your fantasy calendar):",event.date||"");
    if (date===null) return;
    const description=ask("Event description:",event.description||"");
    if (description===null) return;
    mutate(()=>Object.assign(event,{title,date,description}));
  }

  function addNotice() {
    if (!isDM()) return;
    const title=ask("Announcement title:");
    if (!title) return;
    const body=ask("Announcement message:")||"";
    mutate(()=>state.notices.unshift({id:makeId(),title,body,date:new Date().toLocaleDateString()}));
  }

  function removeItem(collection,id) {
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

  function clearMarkers() {
    if (!isDM()) return;
    if (!confirm("Remove all map markers?")) return;
    mutate(()=>state.markers=[]);
  }

  function go(tab) {
    root.querySelectorAll(".hub-page").forEach(p=>p.classList.remove("active"));
    root.querySelectorAll(".hub-nav button").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));
    const page=$("page-"+tab);
    if (page) page.classList.add("active");
  }

  root.querySelectorAll(".hub-nav button").forEach(b=>{
    b.addEventListener("click",()=>go(b.dataset.tab));
  });

  const frame=$("map-frame");
  frame.addEventListener("click",e=>{
    if (!isDM() || e.target.closest(".map-marker")) return;
    const rect=frame.getBoundingClientRect();
    const x=Math.max(0,Math.min(100,(e.clientX-rect.left)/rect.width*100));
    const y=Math.max(0,Math.min(100,(e.clientY-rect.top)/rect.height*100));
    const label=ask("Name this location:");
    if (!label) return;
    const colour=$("marker-colour").value;
    mutate(()=>state.markers.push({id:makeId(),x,y,label,colour}));
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
    const action=prompt("Location: "+m.label+"\nType EDIT to rename, DELETE to remove, or CANCEL.", "CANCEL");
    if (!action) return;
    if (action.toUpperCase()==="DELETE") {
      mutate(()=>state.markers=state.markers.filter(x=>x.id!==m.id));
    } else if (action.toUpperCase()==="EDIT") {
      const label=ask("New location name:",m.label);
      if (label) mutate(()=>m.label=label);
    }
  });

  $("map-upload").addEventListener("change",async e=>{
    const file=e.target.files[0];
    if (!file || !isDM()) return;
    if (!file.type.startsWith("image/")) return alert("Please select an image.");
    if (file.size>10*1024*1024) return alert("Please use an image smaller than 10MB.");
    status("Uploading map...");
    try {
      const path="maps/"+makeId()+"-"+file.name.replace(/[^a-zA-Z0-9._-]/g,"_");
      const {error}=await client.storage.from("campaign-maps").upload(path,file,{upsert:true});
      if (error) throw error;
      const {data}=client.storage.from("campaign-maps").getPublicUrl(path);
      mutate(()=>state.mapUrl=data.publicUrl);
      status("Map uploaded");
    } catch(err) {
      status("Upload failed");
      alert(err.message);
    }
    e.target.value="";
  });

  const Hub = {configureSlots,
    go,
    addCharacter:()=>addCharacter(false),
    addNPC:()=>addNPC(),
    addQuest,
    addJournal,
    editJournal,
    addEvent,
    editEvent,
    addNotice,
    editCharacter,
    editNPC,
    changeHP,
    slot,
    cycleQuest,
    removeItem,
    removeCharacter,
    clearMarkers
  };
  window.Hub=Hub;

  function applyPermissions() {
    if (isDM()) return;
    root.querySelectorAll(".upload-button,.map-toolbar,[onclick*='Hub.addQuest'],[onclick*='Hub.addNPC'],[onclick*='Hub.addNotice']").forEach(el=>el.style.display="none");
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
      ["markers","characters","quests","npcs","journal","events","notices"].forEach(k=>{
        if (!Array.isArray(state[k])) state[k]=[];
      });

      ready=true;
      $("hub-loading").style.display="none";
      applyPermissions();
      refresh();
      status("✓ Connected to campaign");

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
