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
          ${j.imageData?`<img class="journal-attachment" src="${j.imageData}" alt="Journal drawing or attached image" style="max-width:100%;max-height:420px;border-radius:6px;margin-top:12px">`:""}
          ${(isDM() || j.ownerId===member?.id)?`${(isDM() || member?.role==="player")?`<div class="card-actions"><button onclick="Hub.editJournal('${j.id}')">EDIT ENTRY</button><button onclick="Hub.removeItem('journal','${j.id}')">DELETE ENTRY</button></div>`:""}`:""}
        </article>`).join("")
      : empty("Your campaign story starts here.");
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
    $("calendar-current-date").textContent=`${month.name} ${date.day}, ${config.yearLabel||"Year"} ${date.year}`;
    $("calendar-month-heading").textContent=`${month.name} · ${config.yearLabel||"Year"} ${calendarView.year}`;
    $("calendar-advance").style.display=isDM()?"":"none";
    const totalBeforeYear=(calendarView.year-date.year)*config.months.reduce((sum,m)=>sum+m.days,0);
    const totalBeforeMonth=config.months.slice(0,calendarView.month).reduce((sum,m)=>sum+m.days,0);
    const weekdayOffset=((totalBeforeYear+totalBeforeMonth)%config.weekdays.length+config.weekdays.length)%config.weekdays.length;
    $("calendar-grid").style.gridTemplateColumns=`repeat(${config.weekdays.length},minmax(0,1fr))`;
    const weekdayHeaders=config.weekdays.map(day=>`<div class="calendar-weekday">${escapeHTML(day)}</div>`).join("");
    const blanks=Array.from({length:weekdayOffset},()=>'<div class="calendar-blank"></div>').join("");
    const cells=Array.from({length:month.days},(_,i)=>{
      const day=i+1, isCurrent=calendarView.year===date.year&&calendarView.month===date.month&&day===date.day;
      const dayEvents=state.events.filter(e=>e.fantasyDate&&e.fantasyDate.year===calendarView.year&&e.fantasyDate.month===calendarView.month&&e.fantasyDate.day===day);
      return `<div class="calendar-day ${isCurrent?"is-current":""}"><span class="calendar-day-number">${day}</span>${dayEvents.map(e=>`<div class="calendar-event-chip" title="${escapeHTML(e.title)}">${escapeHTML(e.title)}</div>`).join("")}</div>`;
    }).join("");
    $("calendar-grid").innerHTML=weekdayHeaders+blanks+cells;
    const upcoming=[...state.events].filter(e=>e.fantasyDate).sort((a,b)=>a.fantasyDate.year-b.fantasyDate.year||a.fantasyDate.month-b.fantasyDate.month||a.fantasyDate.day-b.fantasyDate.day);
    $("calendar-list").innerHTML=upcoming.length?upcoming.map(e=>{
      const m=config.months[e.fantasyDate.month];
      return `<article class="list-card"><div class="list-meta">${escapeHTML(m?.name||"Unknown month")} ${safeNumber(e.fantasyDate.day)}, ${escapeHTML(config.yearLabel||"Year")} ${safeNumber(e.fantasyDate.year)}</div><h3>${escapeHTML(e.title)}</h3><p>${escapeHTML(e.description)}</p>${(isDM()||e.ownerId===member?.id)?'<div class="card-actions"><button onclick="Hub.editEvent(\''+e.id+'\')">EDIT EVENT</button><button onclick="Hub.removeItem(\'events\',\''+e.id+'\')">DELETE EVENT</button></div>':""}</article>`;
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
    mutate(()=>{state.calendarConfig={yearLabel:$("calendar-year-label").value.trim()||"Year",months:names.map((name,i)=>({name,days:lengths[i]})),weekdays,currentDate:{year,month:0,day:1}};calendarView={year,month:0};});
  }

  function editCalendarSetup() {
    if (!isDM()||!state.calendarConfig) return;
    const c=state.calendarConfig;
    const names=prompt("Month names, separated by commas:",c.months.map(m=>m.name).join(", "));
    if (names===null) return;
    const lengths=prompt("Days in each month, in the same order:",c.months.map(m=>m.days).join(", "));
    if (lengths===null) return;
    const weekdays=prompt("Weekday names, separated by commas:",c.weekdays.join(", "));
    if (weekdays===null) return;
    const yearLabel=prompt("Year label:",c.yearLabel||"Year");
    if (yearLabel===null) return;
    const ns=names.split(",").map(x=>x.trim()).filter(Boolean), ds=lengths.split(",").map(x=>Number(x.trim())), ws=weekdays.split(",").map(x=>x.trim()).filter(Boolean);
    if (!ns.length||ns.length!==ds.length||ds.some(n=>!Number.isInteger(n)||n<1)||!ws.length) return alert("Those calendar settings aren't valid. No changes were made.");
    mutate(()=>{c.months=ns.map((name,i)=>({name,days:ds[i]}));c.weekdays=ws;c.yearLabel=yearLabel.trim()||"Year";c.currentDate.month=Math.min(c.currentDate.month,ns.length-1);c.currentDate.day=Math.min(c.currentDate.day,ds[c.currentDate.month]);calendarView={year:c.currentDate.year,month:c.currentDate.month};});
  }

  function calendarMonth(amount) {
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

  function advanceCalendarDay() {
    if (!isDM()||!state.calendarConfig) return;
    const c=state.calendarConfig, d=c.currentDate, month=c.months[d.month];
    if (d.day<month.days) d.day++;
    else if (d.month<c.months.length-1) {d.month++;d.day=1;}
    else {d.month=0;d.year++;d.day=1;}
    calendarView={year:d.year,month:d.month};
    refresh();persist();
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

  function ask(label,initial="") {
    const value = prompt(label,initial);
    return value === null ? null : value.trim();
  }


  let modalSaveHandler = null;
  function closeModal(){const modal=$("hub-modal");modal.hidden=true;modal.innerHTML="";modalSaveHandler=null;}
  function openForm(title,fields,onSave){
    const modal=$("hub-modal");modalSaveHandler=onSave;
    const controls=fields.map((field,i)=>{
      const id="modal-field-"+i, value=field.value??"", full=field.full?" full":"";
      let control="";
      if(field.type==="textarea")control=`<textarea id="${id}" name="${escapeHTML(field.name)}" rows="${field.rows||4}" ${field.required?"required":""} placeholder="${escapeHTML(field.placeholder||"")}">${escapeHTML(value)}</textarea>`;
      else if(field.type==="select")control=`<select id="${id}" name="${escapeHTML(field.name)}" ${field.required?"required":""}>${(field.options||[]).map(o=>`<option value="${escapeHTML(o.value)}" ${String(o.value)===String(value)?"selected":""}>${escapeHTML(o.label)}</option>`).join("")}</select>`;
      else if(field.type==="drawing")control=`<canvas id="journal-drawing-canvas" class="journal-editor-canvas" width="900" height="260"></canvas><div class="card-actions"><label class="small-button" style="cursor:pointer">UPLOAD IMAGE<input id="journal-image-upload" type="file" accept="image/*" hidden></label><button type="button" class="small-button" id="journal-clear-drawing">CLEAR DRAWING</button></div><p>Draw with your mouse or finger, or upload an image to attach it to this entry.</p>`;
      else control=`<input id="${id}" name="${escapeHTML(field.name)}" type="${field.type||"text"}" value="${escapeHTML(value)}" ${field.required?"required":""} placeholder="${escapeHTML(field.placeholder||"")}" ${field.min!==undefined?`min="${field.min}"`:""} ${field.max!==undefined?`max="${field.max}"`:""}>`;
      return `<label class="modal-field${full}" for="${id}">${escapeHTML(field.label)}${control}</label>`;
    }).join("");
    modal.innerHTML=`<div class="modal-card"><div class="modal-top"><h3>${escapeHTML(title)}</h3><button type="button" class="modal-close" id="modal-close">✕</button></div><form id="hub-modal-form"><div class="modal-fields">${controls}</div><div class="modal-actions"><button type="button" class="small-button" id="modal-cancel">CANCEL</button><button type="submit" class="hub-button">SAVE</button></div></form></div>`;
    modal.hidden=false;$("modal-close").onclick=closeModal;$("modal-cancel").onclick=closeModal;modal.onclick=e=>{if(e.target===modal)closeModal();};
    $("hub-modal-form").addEventListener("submit",e=>{e.preventDefault();const values={};fields.forEach(field=>{if(field.type==="drawing")return;const el=e.currentTarget.elements.namedItem(field.name);values[field.name]=el?el.value:"";});if(modalSaveHandler)modalSaveHandler(values);closeModal();});
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

  function addCharacter(isNPC=false){
    if(!isDM()&&isNPC)return;const c=defaultsCharacter();
    const fields=[
      {name:"name",label:"Character name",required:true},{name:"player",label:"Player name",value:isDM()?"":member.display_name},
      {name:"race",label:"Race / species"},{name:"className",label:"Class"},
      {name:"level",label:"Level",type:"number",value:1,min:1},{name:"hp",label:"Current HP",type:"number",value:10,min:0},
      {name:"maxHp",label:"Maximum HP",type:"number",value:10,min:1},{name:"ac",label:"Armour Class",type:"number",value:10},
      {name:"initiative",label:"Initiative",type:"number",value:0},{name:"speed",label:"Movement speed (ft)",type:"number",value:30},
      ...(isDM()?[{name:"isNPC",label:"Is this an NPC companion?",type:"select",value:"no",options:[{value:"no",label:"No — player character"},{value:"yes",label:"Yes — NPC companion"}]}]:[]),
      {name:"gear",label:"Equipment & inventory",type:"textarea",full:true},{name:"loveInterest",label:"Relationships / love interest",type:"textarea",full:true},
      {name:"backstory",label:"Backstory",type:"textarea",full:true},{name:"notes",label:"Personal notes",type:"textarea",full:true}
    ];
    openForm("Add character",fields,v=>{if(!v.name.trim())return alert("Please enter a character name.");Object.assign(c,{name:v.name.trim(),player:isDM()?v.player:member.display_name,race:v.race,className:v.className,level:Math.max(1,safeNumber(v.level,1)),hp:Math.max(0,safeNumber(v.hp,10)),maxHp:Math.max(1,safeNumber(v.maxHp,10)),ac:safeNumber(v.ac,10),initiative:safeNumber(v.initiative),speed:safeNumber(v.speed,30),gear:v.gear,loveInterest:v.loveInterest,backstory:v.backstory,notes:v.notes,isNPC:isDM()&&v.isNPC==="yes"});c.hp=Math.min(c.hp,c.maxHp);if(!isDM())c.ownerId=member.id;mutate(()=>state.characters.push(c));});
  }  function editCharacter(id){
    const c=state.characters.find(x=>x.id===id);if(!c||!canEditCharacter(c))return;
    const fields=[
      {name:"name",label:"Character name",value:c.name,required:true},{name:"player",label:"Player name",value:c.player||""},
      {name:"race",label:"Race / species",value:c.race||""},{name:"className",label:"Class",value:c.className||""},
      {name:"level",label:"Level",type:"number",value:c.level||1,min:1},{name:"hp",label:"Current HP",type:"number",value:c.hp||0,min:0},
      {name:"maxHp",label:"Maximum HP",type:"number",value:c.maxHp||1,min:1},{name:"ac",label:"Armour Class",type:"number",value:c.ac||0},
      {name:"initiative",label:"Initiative",type:"number",value:c.initiative||0},{name:"speed",label:"Movement speed (ft)",type:"number",value:c.speed||0},
      ...(isDM()?[{name:"isNPC",label:"Is this an NPC companion?",type:"select",value:c.isNPC?"yes":"no",options:[{value:"no",label:"No — player character"},{value:"yes",label:"Yes — NPC companion"}]}]:[]),
      {name:"gear",label:"Equipment & inventory",type:"textarea",value:c.gear||"",full:true},{name:"loveInterest",label:"Relationships / love interest",type:"textarea",value:c.loveInterest||"",full:true},
      {name:"backstory",label:"Backstory",type:"textarea",value:c.backstory||"",full:true},{name:"notes",label:"Personal notes",type:"textarea",value:c.notes||"",full:true}
    ];
    openForm("Edit character",fields,v=>{const u={name:v.name.trim(),player:v.player,race:v.race,className:v.className,level:Math.max(1,safeNumber(v.level,1)),hp:Math.max(0,safeNumber(v.hp)),maxHp:Math.max(1,safeNumber(v.maxHp,1)),ac:safeNumber(v.ac),initiative:safeNumber(v.initiative),speed:safeNumber(v.speed),gear:v.gear,loveInterest:v.loveInterest,backstory:v.backstory,notes:v.notes};u.hp=Math.min(u.hp,u.maxHp);if(isDM())u.isNPC=v.isNPC==="yes";mutate(()=>Object.assign(c,u));});
  }  function changeHP(id,amount) {
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
  function addQuest(){if(!isDM())return;openForm("Add quest",[{name:"title",label:"Quest title",required:true,full:true},{name:"description",label:"Quest description",type:"textarea",rows:5,full:true},{name:"reward",label:"Reward",type:"textarea",rows:2,full:true}],v=>{if(!v.title.trim())return alert("Please enter a quest title.");mutate(()=>state.quests.unshift({id:makeId(),title:v.title.trim(),description:v.description,reward:v.reward,status:"Active"}));});}  function cycleQuest(id) {
    if (!isDM()) return;
    const q=state.quests.find(x=>x.id===id);
    if (!q) return;
    const states=["Active","Completed","Failed"];
    mutate(()=>q.status=states[(states.indexOf(q.status)+1)%states.length]);
  }

  function addNPC(){if(!isDM())return;openForm("Add NPC",[{name:"name",label:"NPC name",required:true},{name:"role",label:"Role / occupation"},{name:"location",label:"Location"},{name:"relationship",label:"Relationship to the party"},{name:"description",label:"Description",type:"textarea",rows:6,full:true}],v=>{if(!v.name.trim())return alert("Please enter an NPC name.");mutate(()=>state.npcs.unshift({id:makeId(),name:v.name.trim(),role:v.role,description:v.description,location:v.location,relationship:v.relationship}));});}  function editNPC(id){if(!isDM())return;const n=state.npcs.find(x=>x.id===id);if(!n)return;openForm("Edit NPC",[{name:"name",label:"NPC name",value:n.name,required:true},{name:"role",label:"Role / occupation",value:n.role||""},{name:"location",label:"Location",value:n.location||""},{name:"relationship",label:"Relationship to the party",value:n.relationship||""},{name:"description",label:"Description",type:"textarea",rows:6,value:n.description||"",full:true}],v=>{if(!v.name.trim())return alert("Please enter an NPC name.");mutate(()=>Object.assign(n,{name:v.name.trim(),role:v.role,location:v.location,relationship:v.relationship,description:v.description}));});}  function addJournal(){openJournalEditor(null);}  function editJournal(id){const entry=state.journal.find(x=>x.id===id);if(!entry||(!isDM()&&entry.ownerId!==member?.id))return;openJournalEditor(entry);}  function addEvent(){
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
    if (!isDM() && !(["journal","events"].includes(collection) && member?.role==="player")) return;
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
    go,
    addCharacter:()=>addCharacter(false),
    addNPC:()=>addNPC(),
    addQuest,
    addJournal,
    editJournal,
    addEvent,
    editEvent,
    saveCalendarSetup,
    editCalendarSetup,
    calendarMonth,
    calendarToday,
    advanceCalendarDay,
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
