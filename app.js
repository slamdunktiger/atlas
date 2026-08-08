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

// wiring
document.getElementById("tabs").addEventListener("click",e=>{
  const tab=e.target.closest(".tab"); if(!tab)return;
  document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
  tab.classList.add("active");
  render(tab.dataset.view);
});
document.getElementById("addBtn").onclick=()=>{
  const view=document.querySelector(".tab.active")?.dataset.view||"tasks";
  if(["overview","board","ledger"].includes(view)){ openModal("tasks"); } else { openModal(view); }
};
document.getElementById("seedBtn").onclick=seed;
document.getElementById("modalBg").addEventListener("click",e=>{ if(e.target.id==="modalBg")closeModal(); });

refresh();

