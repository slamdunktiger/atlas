// Atlas front-end — talks to the single SQLite backend. No other bots.
const API = (p, opt) => fetch("/api/" + p, Object.assign({headers:{'Content-Type':'application/json'}}, opt)).then(r=>r.json());
const esc = s => (s==null?"":String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const prio = p => ({1:'high',2:'med',3:'low'}[p]||'med');
const pill = (t,cls='') => `<span class="pill ${cls}">${esc(t)}</span>`;

let STATE = {};

async function refresh(){
  STATE = await API("overview");
  try { STATE.todayStr = (await API("today")).date; } catch(e){ STATE.todayStr = ""; }
  const v = document.querySelector(".tab.active")?.dataset.view || "overview";
  render(v);
}

function fields(table){
  return {
    areas:["name:Name","description:Description"],
    projects:["name:Name","area_id:Area|areas","status:Status|active,archived,done"],
    tasks:["title:Title","project_id:Project|projects","area_id:Area|areas","status:Status|open,doing,done","priority:Priority|1,2,3","due:Due date","recur:Recur|none,daily,weekly,monthly","notes:Notes"],
    notes:["title:Title","folder:Folder","tags:Tags","body:Body"],
    habits:["name:Name","area_id:Area|areas","frequency:Frequency|daily,weekly,monthly","streak:Streak"],
    goals:["title:Title","area_id:Area|areas","status:Status|active,done,archived","target:Target"],
  }[table]||[];
}
function optFor(rel){
  if(rel==="areas") return STATE.areas.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join("");
  if(rel==="projects") return STATE.projects.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join("");
  return "";
}
function val(name){ return document.getElementById("f_"+name)?.value ?? ""; }

function openModal(table, item){
  item = item || {};
  const f = fields(table);
  const html = `<h3>${item.id?"Edit":"New"} ${table.slice(0,-1)}</h3>` +
    f.map((spec,i)=>{
      const [name,label,opts]=spec.split("|");
      let control;
      if(opts && opts.includes(",")){
        const optsArr=opts.split(",");
        control=`<select id="f_${name}">`+(item[name]?`<option value="${esc(item[name])}">${esc(item[name])}</option>`:"")+optsArr.map(o=>`<option ${item[name]===o?"selected":""} value="${o}">${o}</option>`).join("")+`</select>`;
      } else if(opts && opts.includes("|")){
        const rel=opts.split("|")[1];
        control=`<select id="f_${name}"><option value="">—</option>${optFor(rel)}</select>`;
        setTimeout(()=>{const s=document.getElementById("f_"+name); if(s&&item[name]) s.value=item[name];},0);
      } else if(name==="body"||name==="notes"||name==="description"){
        control=`<textarea id="f_${name}" rows="4">${esc(item[name]||"")}</textarea>`;
      } else {
        control=`<input id="f_${name}" value="${esc(item[name]||"")}">`;
      }
      return `<label>${label}</label>${control}`;
    }).join("") +
    `<div class="actions"><button class="btn" id="mCancel">cancel</button><button class="btn primary" id="mSave">save</button></div>`;
  document.getElementById("modal").innerHTML=html;
  document.getElementById("modalBg").classList.add("show");
  document.getElementById("mCancel").onclick=closeModal;
  document.getElementById("mSave").onclick=async()=>{
    const data={};
    fields(table).forEach(spec=>{const name=spec.split("|")[0].split(":")[0]; const v=val(name); if(v!=="")data[name]=v;});
    if(item.id){ await API(table+"/"+item.id,{method:"PATCH",body:JSON.stringify(data)}); }
    else { await API(table,{method:"POST",body:JSON.stringify(data)}); }
    closeModal(); refresh();
  };
}
function closeModal(){ document.getElementById("modalBg").classList.remove("show"); }

function deleteRow(table,id){ if(confirm("delete?")){ API(table+"/"+id,{method:"DELETE"}).then(refresh); } }

function render(view){
  const M=document.getElementById("main");
  if(view==="overview"){
    const c=STATE.counts;
    M.innerHTML=`<div class="grid">
      ${["areas","projects","tasks","notes","habits","goals"].map(t=>`<div class="card stat"><span class="n">${c[t]}</span><span class="l">${t}</span></div>`).join("")}
    </div><div class="card" style="margin-top:16px"><h3>Recent activity (ledger)</h3><div class="ledger">${
      (STATE.ledger||[]).map(l=>`[${l.ts}] ${l.actor} · ${esc(l.action)} — ${esc(l.detail||"")}`).join("\n")||"no activity yet"
    }</div></div>`;
    return;
  }
  // generic list views
  const generic = {
    areas:r=>`<div class="card"><h3>${esc(r.name)}</h3><div class="meta">${esc(r.description||"")}</div></div>`,
    projects:r=>`<div class="row"><div class="t"><b>${esc(r.name)}</b><div class="meta">area #${r.area_id||"—"}</div></div>${pill(r.status)}</div>`,
    notes:r=>`<div class="card"><h3>${esc(r.title||"(untitled)")}</h3><div class="meta">${esc(r.folder||"inbox")} · ${esc(r.tags||"")} · ${esc(r.created||"")}</div><div style="margin-top:6px;color:var(--dim)">${esc((r.body||"").slice(0,160))}</div></div>`,
    habits:r=>`<div class="row"><div class="t"><b>${esc(r.name)}</b><div class="meta">${esc(r.frequency||"daily")} · area #${r.area_id||"—"} · 🔥${r.streak}</div></div>${r.last_done===STATE.todayStr?pill("done today","good"):`<span class="btn" style="padding:4px 10px" onclick="habitCheckin(${r.id})">check in</span>`}<span style="color:var(--dim);cursor:pointer;margin-left:8px" onclick="deleteRow('habits',${r.id})">✕</span></div>`,
    goals:r=>`<div class="row"><div class="t"><b>${esc(r.title)}</b><div class="meta">${esc(r.target||"")}</div></div>${pill(r.status)}</div>`,
  };
  if(generic[view]){
    const rows=STATE[view]||[];
    // habits template already includes its own delete X; don't double up
    const extra = view==="habits" ? "" : `<span style="float:right;color:var(--dim);cursor:pointer" onclick="deleteRow('${view}',${r.id})">✕</span>`;
    M.innerHTML=`<div class="${view==='areas'||view==='notes'?'grid':'view'}">${
      rows.map(r=>`${generic[view](r)}${extra}`).join("")||'<div class="empty">nothing here yet — hit + add</div>'
    }</div>`;
    return;
  }
  if(view==="tasks"){ renderTasks(M); return; }
  if(view==="today"){ renderToday(M); return; }
  if(view==="calendar"){ renderCalendar(M); return; }
  if(view==="board"){ renderBoard(M); return; }
  if(view==="ledger"){ renderLedger(M); return; }
  if(view==="covey"){ loadCovey(); return; }
}

function renderTasks(M){
  const rows=STATE.tasks||[];
  const filt=document.getElementById("taskFilter")?.value||"all";
  const list=rows.filter(t=> filt==="all"?true:(t.status===filt));
  M.innerHTML=`<label>filter
    <select id="taskFilter" onchange="render('tasks')">
      <option value="all">all</option><option value="open">open</option><option value="doing">doing</option><option value="done">done</option>
    </select></label><div style="margin-top:10px">${
    list.map(t=>`<div class="row">
      <span style="cursor:pointer;color:var(--dim)" onclick="cycle('tasks',${t.id})">${t.status==='done'?'☑':'☐'}</span>
      <div class="t"><b>${esc(t.title)}</b><div class="meta">${esc(t.notes||"")}</div></div>
      ${pill('P'+t.priority,prio(t.priority))} ${t.due?pill(t.due):""}
      <span style="color:var(--dim);cursor:pointer" onclick="deleteRow('tasks',${t.id})">✕</span>
    </div>`).join("")||'<div class="empty">no tasks</div>'}</div>`;
}
async function renderToday(M){
  const t = await API("today");
  const todayStr = t.date;
  const due = t.due||[];
  M.innerHTML = `<h3 style="margin-top:0">📅 Today — ${todayStr}</h3>
    <div class="card" style="margin-bottom:16px"><h3>Due / overdue (${due.length})</h3>${
      due.map(x=>`<div class="row"><span style="cursor:pointer;color:var(--dim)" onclick="cycle('tasks',${x.id})">${x.status==='done'?'☑':'☐'}</span><div class="t"><b>${esc(x.title)}</b><div class="meta">${esc(x.due)} ${x.recur&&x.recur!=='none'?('· ↻ '+x.recur):''}</div></div>${pill('P'+x.priority,prio(x.priority))}</div>`).join("")||'<div class="empty">nothing due</div>'
    }</div>
    <div class="card"><h3>Habits to check in</h3>${
      (t.habits||[]).map(h=>{
        const done = h.last_done===todayStr;
        return `<div class="row"><div class="t"><b>${esc(h.name)}</b><div class="meta">${esc(h.frequency)} · 🔥${h.streak}</div></div>${done?pill('done today','good'):`<span class="btn" style="padding:4px 10px" onclick="habitCheckin(${h.id})">check in</span>`}</div>`;
      }).join("")||'<div class="empty">no habits</div>'
    }</div>`;
}
async function habitCheckin(id){
  await API("habit/"+id+"/checkin",{method:"POST"});
  render("today");
}
window.habitCheckin = habitCheckin;

function renderCalendar(M){
  const tasks = STATE.tasks||[];
  const withDue = tasks.filter(t=>t.due);
  // sort into months
  const byMonth = {};
  withDue.forEach(t=>{
    const m = t.due.slice(0,7);
    (byMonth[m] = byMonth[m]||[]).push(t);
  });
  const months = Object.keys(byMonth).sort();
  M.innerHTML = months.map(m=>{
    const items = byMonth[m].sort((a,b)=>a.due.localeCompare(b.due)).map(t=>
      `<div class="row"><div class="t"><b>${esc(t.title)}</b><div class="meta">${esc(t.due)} ${t.recur&&t.recur!=='none'?('· ↻ '+t.recur):''}</div></div>${pill(t.status)}</div>`
    ).join("");
    return `<div class="card" style="margin-bottom:14px"><h3>${m}</h3>${items}</div>`;
  }).join("") || '<div class="empty">no dated tasks — add a due date to a task</div>';
}
function renderBoard(M){
  const cols=["open","doing","done"];
  M.innerHTML=`<div class="kanban">${cols.map(col=>`<div class="kcol"><h4>${col}</h4>${
    (STATE.tasks||[]).filter(t=>t.status===col).map(t=>`<div class="card" style="margin-bottom:8px"><b>${esc(t.title)}</b><div class="meta">${esc(t.notes||"")}</div></div>`).join("")||'<div class="empty">—</div>'
  }</div>`).join("")}</div>`;
}
function renderLedger(M){
  M.innerHTML=`<div class="card"><h3>Action ledger — every mutation Hermes makes, here</h3><div class="ledger">${
    (STATE.ledger||[]).map(l=>`[${l.ts}] ${l.actor} · ${esc(l.action)}\n   ${esc(l.detail||"")}`).join("\n\n")||"no activity yet"
  }</div></div>`;
}

// seed a starter corpus so the dashboard isn't empty
async function seed(){
  const empty = (STATE.counts.areas+STATE.counts.projects+STATE.counts.tasks+
                 STATE.counts.notes+STATE.counts.habits+STATE.counts.goals)===0;
  if(!empty && !confirm("Database already has data. Seed anyway? This adds demo rows on top.")){
    return;
  }
  const data={
    areas:[{name:"Health",description:"body + recovery"},
           {name:"Work",description:"income + craft"},
           {name:"Atlas",description:"this project"}],
    projects:[{name:"Ship Atlas v1",area_id:3,status:"active"},
              {name:"Nightly review",area_id:3,status:"active"}],
    tasks:[{title:"Wire overview endpoint",project_id:1,status:"done",priority:2},
           {title:"Build Kanban board",project_id:1,status:"doing",priority:2},
           {title:"Add capture channels",project_id:1,status:"open",priority:3},
           {title:"Write README",project_id:1,status:"open",priority:1}],
    notes:[{title:"Design notes",folder:"atlas",tags:"ui,api",body:"One DB, one agent. No ChatGPT/Claude MCP relay."},
           {title:"Recipe: 3-ingredient curry",folder:"kitchen",tags:"food",body:"Captured via bookmarklet → Atlas classifies → lands here."}],
    habits:[{name:"Sleep by 10pm",area_id:1,frequency:"daily",streak:0},
            {name:"Write 200 words",area_id:2,frequency:"daily",streak:0}],
    goals:[{title:"Atlas feels like software that grows with me",area_id:3,status:"active",target:"v1 live"}],
  };
  for(const t of Object.keys(data)){
    for(const row of data[t]){ await API(t,{method:"POST",body:JSON.stringify(row)}); }
  }
  refresh();
}

// ---- Covey 4-quad mirror: UI over the per-domain COVEY-BOARD.md files ----
let COVEY = { domain:null, data:null };

async function loadCovey(){
  const dom = document.getElementById("coveyDomain").value;
  COVEY.domain = dom;
  COVEY.data = await API("covey/"+dom);
  renderCovey(document.getElementById("main"));
}

function coveyItemRow(it, quad){
  const status = it.status||"";
  const note = it.note||"";
  const cell = (id,val,ph)=>`<input style="background:transparent;border:none;color:var(--txt);width:100%" value="${esc(val)}" placeholder="${ph}" data-line="${it.line}" data-field="${id}" onchange="coveyEdit('${quad}',this)">`;
  return `<div class="row" style="display:flex;gap:8px;align-items:center">
    <span class="tag" style="min-width:42px">${esc(it.id)}</span>
    <div style="flex:2">${cell("task",it.task,"task")}</div>
    <div style="flex:1">${cell("status",status,"status")}</div>
    <div style="flex:1">${cell("note",note,"note")}</div>
    <span style="color:var(--dim);cursor:pointer" onclick="coveyDel('${quad}',${it.line})">✕</span>
  </div>`;
}

async function coveyEdit(quad, el){
  const line = el.dataset.line, field = el.dataset.field, val = el.value;
  await API(`covey/${COVEY.domain}/${line}`,{method:"PATCH",body:JSON.stringify({[field]:val})});
  COVEY.data = await API("covey/"+COVEY.domain);
  renderCovey(document.getElementById("main"));
}
async function coveyDel(quad, line){
  if(!confirm("delete this item from the board?")) return;
  await API(`covey/${COVEY.domain}/${line}`,{method:"DELETE"});
  COVEY.data = await API("covey/"+COVEY.domain);
  renderCovey(document.getElementById("main"));
}
function coveyAdd(quad){
  const M = document.getElementById("main");
  const card = [...M.querySelectorAll(".card")].find(c=>c.querySelector("h3")?.textContent.includes(quad));
  if(!card) return;
  if(card.querySelector(".covey-new")) return; // already open
  const row = document.createElement("div");
  row.className = "row covey-new";
  row.style.cssText = "display:flex;gap:8px;align-items:center;margin-top:6px";
  row.innerHTML = `<span class="tag" style="min-width:42px">+</span>
    <input id="coveyNewInput" style="flex:2;background:#1a1a1a;border:1px solid var(--accent,#4af);color:var(--txt);padding:4px 6px;border-radius:4px" placeholder="type task, Enter to save, Esc to cancel" autocomplete="off">
    <span style="flex:1"></span><span style="flex:1"></span>`;
  card.appendChild(row);
  const inp = row.querySelector("#coveyNewInput");
  inp.focus();
  const commit = async () => {
    const task = inp.value.trim();
    if(!task) { row.remove(); return; }
    await API(`covey/${COVEY.domain}`,{method:"POST",body:JSON.stringify({quad,task})});
    COVEY.data = await API("covey/"+COVEY.domain);
    renderCovey(M);
  };
  inp.addEventListener("keydown",e=>{
    if(e.key==="Enter"){ e.preventDefault(); commit(); }
    else if(e.key==="Escape"){ e.preventDefault(); row.remove(); }
  });
  inp.addEventListener("blur",()=>{ if(inp.value.trim()) commit(); else row.remove(); });
}

function renderCovey(M){
  const d = COVEY.data;
  if(!d){ M.innerHTML='<div class="empty">pick a domain</div>'; return; }
  const order = ["Q1","Q2","Q3","Q4"];
  const titles = {Q1:"Q1 · Urgent + Important",Q2:"Q2 · Important, Not Urgent",Q3:"Q3 · Urgent, Not Important",Q4:"Q4 · Not Urgent, Not Important"};
  const quads = order.map(qid=>{
    const q = d.quads.find(x=>x.id===qid) || {id:qid,items:[]};
    const items = (q.items||[]).filter(it=>it.id && it.id.startsWith(qid+".") || (q.id===qid && it.task));
    const rows = items.map(it=>coveyItemRow(it,qid)).join("") || '<div class="empty">empty</div>';
    return `<div class="card" style="margin-bottom:14px"><h3 style="margin:0 0 10px">${titles[qid]||qid} <span class="tag">${items.length}</span></h3>${rows}
      <span class="btn" style="margin-top:8px;display:inline-block" onclick="coveyAdd('${qid}')">+ add to ${qid}</span></div>`;
  }).join("");
  const dailies = (d.dailies||[]).map(it=>coveyItemRow(it,"D")).join("")||'<div class="empty">none</div>';
  M.innerHTML = `<div class="grid" style="grid-template-columns:1fr 1fr">${quads}</div>
    <div class="card" style="margin-top:14px"><h3>⏰ Dailies (AM #1)</h3>${dailies}</div>`;
}

// wiring
document.getElementById("tabs").addEventListener("click",e=>{
  const tab=e.target.closest(".tab"); if(!tab)return;
  document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
  tab.classList.add("active");
  document.getElementById("coveyBar").style.display = tab.dataset.view==="covey" ? "flex" : "none";
  if(tab.dataset.view==="covey"){
    if(!document.getElementById("coveyDomain").options.length){
      API("covey").then(r=>{
        const sel=document.getElementById("coveyDomain");
        sel.innerHTML = r.domains.map(d=>`<option value="${d}">${d}</option>`).join("");
        loadCovey();
      });
    } else { loadCovey(); }
  }
  render(tab.dataset.view);
});
document.getElementById("addBtn").onclick=()=>{
  const view=document.querySelector(".tab.active")?.dataset.view||"tasks";
  if(["overview","board","ledger"].includes(view)){ openModal("tasks"); } else { openModal(view); }
};
document.getElementById("seedBtn").onclick=seed;
document.getElementById("modalBg").addEventListener("click",e=>{ if(e.target.id==="modalBg")closeModal(); });

refresh();

