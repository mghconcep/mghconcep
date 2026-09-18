const SUPABASE_URL = 'https://fvxpfpqkdsznvvreicfc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_dC4BDvHAExevhXghB6-8rQ_RLtR12zB';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

const $ = id => document.getElementById(id);
let reports = [];
let currentUser = null;

function esc(value){return String(value ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function prettyDate(date){if(!date)return '—'; const d=new Date(date+'T00:00:00'); return d.toLocaleDateString(undefined,{day:'2-digit',month:'short',year:'numeric'});}
function prettyDateTime(value){if(!value)return '—'; const d=new Date(value); return d.toLocaleString(undefined,{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});}
function toast(msg, bad=false){const t=$('toast');t.textContent=msg;t.className='toast show '+(bad?'bad':'');setTimeout(()=>t.className='toast',2600)}

async function requireAdmin(user){
  // The existing AGST Store project already has an admin_users table with user_id.
  // If that table is available to the signed-in user, require a matching row.
  const {data,error}=await supabaseClient.from('admin_users').select('user_id').eq('user_id',user.id).maybeSingle();
  if(error) throw error;
  return !!data;
}

function showApp(user){
  currentUser=user;$('loginView').classList.add('hidden');$('appView').classList.remove('hidden');$('userEmail').textContent=user.email||'Signed in';
}
function showLogin(){currentUser=null;$('appView').classList.add('hidden');$('loginView').classList.remove('hidden');}

$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();$('loginError').textContent='';
  const email=$('email').value.trim(),password=$('password').value;
  try{
    const {data,error}=await supabaseClient.auth.signInWithPassword({email,password});
    if(error)throw error;
    if(!data.user)throw new Error('Login did not return a user.');
    const ok=await requireAdmin(data.user);
    if(!ok){await supabaseClient.auth.signOut();throw new Error('This account is not registered as an admin.');}
    showApp(data.user);await loadReports();
  }catch(err){console.error(err);$('loginError').textContent=err.message||'Unable to sign in.';}
});
$('signOut').addEventListener('click',async()=>{await supabaseClient.auth.signOut();showLogin();});

async function loadReports(){
  $('loading').innerHTML='<span class="spinner"></span>Loading';
  try{
    const {data,error}=await supabaseClient.from('gaming_reports').select('id,report_date,created_at,updated_at,follow_up_report,created_by').order('report_date',{ascending:false}).order('created_at',{ascending:false});
    if(error)throw error;
    const {data:signoffs,error:signoffError}=await supabaseClient.from('report_signoffs').select('report_id,admin_name,tech_name');
    if(signoffError)throw signoffError;
    const byReport=new Map((signoffs||[]).map(x=>[x.report_id,x]));
    reports=(data||[]).map(r=>({...r,signoff:byReport.get(r.id)||{}}));
    renderReports();
  }catch(err){console.error(err);$('loading').textContent='Database error';toast(err.message||'Could not load reports.',true);}
  finally{setTimeout(()=>{$('loading').textContent='';},600)}
}

function filteredReports(){
  const date=$('dateFilter').value, q=$('searchFilter').value.trim().toLowerCase();
  return reports.filter(r=>{
    if (date) {
  const savedDate = new Date(r.created_at).toLocaleDateString('en-CA');
  if (savedDate !== date) return false;
}
    if(!q)return true;
    return [r.report_date,r.follow_up_report,r.signoff?.admin_name,r.signoff?.tech_name].some(v=>String(v||'').toLowerCase().includes(q));
  });
}
function renderReports(){
  const rows = filteredReports();

  $('totalReports').textContent = rows.length;
  $('selectedDateLabel').textContent = $('dateFilter').value
    ? prettyDate($('dateFilter').value)
    : 'All dates';

  $('latestDate').textContent = reports[0]
  ? prettyDateTime(reports[0].created_at).split(',')[0]
  : '—';

  $('reportRows').innerHTML = rows.map(r => `
    <tr>
      <td class="date-cell">${esc(prettyDateTime(r.created_at).split(',')[0])}</td>
      <td>${esc(r.signoff?.admin_name || '—')}</td>
      <td>${esc(r.signoff?.tech_name || '—')}</td>
      <td>${esc(prettyDateTime(r.created_at))}</td>
      <td class="report-actions">
        <button class="mini-view" data-view="${esc(r.id)}">
          View report
        </button>

        <button class="mini-delete" data-delete="${esc(r.id)}">
          Delete
        </button>
      </td>
    </tr>
  `).join('');

  $('emptyState').classList.toggle('hidden', rows.length !== 0);

  document.querySelectorAll('[data-view]').forEach(b => {
    b.addEventListener('click', () => openReport(b.dataset.view));
  });

  document.querySelectorAll('[data-delete]').forEach(b => {
    b.addEventListener('click', () => deleteReport(b.dataset.delete));
  });
}

async function deleteReport(id) {
  const report = reports.find(r => r.id === id);

  if (!report) {
    toast('Report not found.', true);
    return;
  }

  const confirmed = confirm(
    `Are you sure you want to delete this report?\n\n` +
    `Date: ${prettyDate(report.report_date)}\n` +
    `This action cannot be undone.`
  );

  if (!confirmed) return;

  try {
    // Delete related records first
    const relatedTables = [
      'report_games',
      'report_defects',
      'report_pc_status',
      'report_inventory',
      'report_spares',
      'report_signoffs'
    ];

    for (const table of relatedTables) {
      const { error } = await supabaseClient
        .from(table)
        .delete()
        .eq('report_id', id);

      if (error) throw error;
    }

    // Delete the main report
    const { error } = await supabaseClient
      .from('gaming_reports')
      .delete()
      .eq('id', id);

    if (error) throw error;

    toast('Report deleted successfully.');

    await loadReports();

  } catch (err) {
    console.error('Delete report error:', err);
    toast(err.message || 'Failed to delete report.', true);
  }
}

$('dateFilter').addEventListener('change',renderReports);$('searchFilter').addEventListener('input',renderReports);$('clearFilters').addEventListener('click',()=>{$('dateFilter').value='';$('searchFilter').value='';renderReports()});$('refreshReports').addEventListener('click',loadReports);

async function openReport(id){
  $('reportModal').classList.remove('hidden');
  $('reportModal').setAttribute('aria-hidden','false');
  $('modalTitle').textContent='Loading report…';
  $('modalBody').innerHTML='<div class="empty"><span class="spinner"></span>Loading complete report…</div>';
  try{
    const r=reports.find(x=>x.id===id);
    if(!r) throw new Error('Report not found.');
    const tables=['report_games','report_defects','report_pc_status','report_inventory','report_spares','report_signoffs'];
    const results=await Promise.all(tables.map(t=>supabaseClient.from(t).select('*').eq('report_id',id)));
    const failed=results.find(x=>x.error);
    if(failed?.error) throw failed.error;
    const [games,defects,pcs,inventory,spares,signoffs]=results.map(x=>x.data||[]);
    const sign=signoffs[0]||{};
    $('modalTitle').textContent=`Gaming Hub Report — ${prettyDate(r.report_date)}`;
    $('modalBody').innerHTML=renderReport(r,{games,defects,pcs,inventory,spares,sign});
  }catch(err){
    console.error(err);
    $('modalTitle').textContent='Unable to open report';
    $('modalBody').innerHTML=`<div class="detail-card"><p class="error">${esc(err.message||'Database error')}</p></div>`;
  }
}

function statusClass(s){return s==='Updated'?'green':s==='Need to Check'?'yellow':s==='Needs Update'?'red':''}
function pcLabel(n){return `PC${String(n).padStart(2,'0')}`}
function renderReport(r,d){
  const games=d.games.slice().sort((a,b)=>String(a.game_name).localeCompare(String(b.game_name)));
  const gameRows=games.map(x=>`<tr><td>${esc(x.game_name)}</td><td><span class="report-status ${statusClass(x.status)}">${esc(x.status||'Not set')}</span></td></tr>`).join('');

  const defectsBy = {
  Keyboard: { Standard: 0, VIP: 0 },
  Headset: { Standard: 0, VIP: 0 },
  Mouse: { Standard: 0, VIP: 0 },
  Monitor: { Standard: 0, VIP: 0 },
  'Power Cord': { Standard: 0, VIP: 0 }
};

d.defects.forEach(x => {
  const category = Number(x.pc_number) <= 10 ? 'VIP' : 'Standard';

  if (defectsBy[x.peripheral_type]?.[category] !== undefined) {
    defectsBy[x.peripheral_type][category]++;
  }
});

const defectCards = [
  'Keyboard',
  'Headset',
  'Mouse',
  'Monitor',
  'Power Cord'
].map(type => `
  <div class="report-mini-card">
    <strong>${type}</strong>
    <div>
      <span>Standard <b>${defectsBy[type].Standard}</b></span>
      <span>VIP <b>${defectsBy[type].VIP}</b></span>
    </div>
  </div>
`).join('');
  const defectRows=d.defects.slice().sort((a,b)=>a.pc_number-b.pc_number || String(a.peripheral_type).localeCompare(String(b.peripheral_type))).map(x=>`<tr><td>${pcLabel(x.pc_number)}</td><td>${esc(x.pc_number<=10?'VIP':'Standard')}</td><td>${esc(x.peripheral_type)}</td><td>${esc(x.description||'—')}</td></tr>`).join('');

  const vip=d.pcs.filter(x=>x.pc_number>=1&&x.pc_number<=10&&x.no_defect).sort((a,b)=>a.pc_number-b.pc_number);
  const standard=d.pcs.filter(x=>x.pc_number>=11&&x.pc_number<=40&&x.no_defect).sort((a,b)=>a.pc_number-b.pc_number);
  const pcBlock=(title,list,total)=>`<div class="pc-status-block"><div class="pc-status-head"><strong>${title}</strong><span>${list.length}/${total} marked no defects</span></div><div class="pc-grid">${list.length?list.map(x=>`<span class="pc-chip">${pcLabel(x.pc_number)} <i>✓</i></span>`).join(''):'<span class="muted small">None marked</span>'}</div></div>`;

  const types=['Keyboard','Mouse','Headset'];
  const inventoryBlocks=types.map(type=>{
    const rows=d.inventory.filter(x=>x.peripheral_type===type);
    const std=rows.filter(x=>x.category==='Standard');
    const vipRows=rows.filter(x=>x.category==='VIP');
    const group=(title,list)=>`<div class="inventory-group"><div class="inventory-title">${title}</div>${list.length?list.map(x=>`<div class="inventory-row"><span>${esc(x.brand)}</span><strong>${esc(x.quantity)}</strong></div>`).join(''):'<div class="inventory-row muted"><span>No entries</span><strong>—</strong></div>'}</div>`;
    return `<div class="inventory-card"><h4>${type}</h4>${group('Standard',std)}${group('VIP',vipRows)}</div>`;
  }).join('');

  const spareMap=new Map(d.spares.map(x=>[x.item_type,x.quantity]));
  const spareItems=['VIP Keyboard','Standard Keyboard','VIP Mouse','Standard Mouse','Spare Cord'];
  const spareRows=spareItems.map(item=>`<div class="spare-row"><span>${item}</span><strong>${spareMap.has(item)&&spareMap.get(item)!==null&&spareMap.get(item)!==''?esc(spareMap.get(item)):'—'}</strong></div>`).join('');

  const updated=games.filter(x=>x.status==='Updated').length;
  const needsCheck=games.filter(x=>x.status==='Need to Check').length;
  const needsUpdate=games.filter(x=>x.status==='Needs Update').length;
  const noStatus=games.filter(x=>!x.status).length;

  return `<div class="report-sheet" id="printReport">
    <div class="report-header">
      <div class="report-brand"><div class="report-logo">M</div><div><div class="report-kicker">MARV’S GAMING HUB</div><h2>GAMING HUB OVERALL REPORT</h2></div></div>
      <div class="report-date"><small>REPORT DATE</small><strong>${esc(prettyDateTime(r.created_at).split(',')[0])}</strong><span>Saved ${esc(prettyDateTime(r.created_at))}</span></div>
    </div>

    <div class="report-banner"><span>DAILY OPERATIONS REPORT</span><em>READ ONLY</em></div>

    <section class="report-section"><div class="report-section-title"><span>01</span><h3>GAMES UPDATE</h3></div>
      <div class="report-game-summary"><span class="report-status green">Updated ${updated}</span><span class="report-status yellow">Need to Check ${needsCheck}</span><span class="report-status red">Needs Update ${needsUpdate}</span>${noStatus?`<span class="report-status">Not set ${noStatus}</span>`:''}</div>
      <div class="report-table-wrap"><table class="report-table"><thead><tr><th>Game / Launcher</th><th>Status</th></tr></thead><tbody>${gameRows||'<tr><td colspan="2">No game records saved.</td></tr>'}</tbody></table></div>
    </section>

    <section class="report-section"><div class="report-section-title"><span>02</span><h3>DEFECTIVE PERIPHERALS</h3></div>
      <div class="report-mini-grid">${defectCards}</div>
      <div class="report-table-wrap"><table class="report-table"><thead><tr><th>PC</th><th>Category</th><th>Defect Type</th><th>Problem Description</th></tr></thead><tbody>${defectRows||'<tr><td colspan="4">NO DEFECTS RECORDED</td></tr>'}</tbody></table></div>
    </section>

    <section class="report-section"><div class="report-section-title"><span>03</span><h3>PC STATUS — NO DEFECTS</h3></div>
      ${pcBlock('VIP PC 01–10',vip,10)}${pcBlock('STANDARD PC 11–40',standard,30)}
    </section>

    <section class="report-section"><div class="report-section-title"><span>04</span><h3>OVERALL PERIPHERAL COUNT</h3></div>
      <div class="inventory-grid">${inventoryBlocks}</div>
    </section>

    <section class="report-section"><div class="report-section-title"><span>05</span><h3>SPARE ITEMS</h3></div>
      <div class="spare-grid">${spareRows}</div>
    </section>

    <section class="report-section"><div class="report-section-title"><span>06</span><h3>FOLLOW UP REPORT</h3></div>
      <div class="followup-box">${esc(r.follow_up_report||'No follow-up report entered.')}</div>
    </section>

    <section class="report-section signoff-section"><div class="report-section-title"><span>07</span><h3>REPORT SIGN-OFF</h3></div>
      <div class="signoff-grid">
        <div class="signoff-card"><div class="signoff-label">ADMIN</div><div class="signature-box">${d.sign.admin_signature?`<img class="signature" src="${esc(d.sign.admin_signature)}" alt="Admin signature">`:'<span>No signature</span>'}</div><strong>${esc(d.sign.admin_name||'—')}</strong></div>
        <div class="signoff-card"><div class="signoff-label">TECH</div><div class="signature-box">${d.sign.tech_signature?`<img class="signature" src="${esc(d.sign.tech_signature)}" alt="Tech signature">`:'<span>No signature</span>'}</div><strong>${esc(d.sign.tech_name||'—')}</strong></div>
      </div>
    </section>

    <div class="report-footer"><span>MARV’S GAMING HUB • ADMIN ARCHIVE</span><span>Report ID: ${esc(r.id)}</span></div>
  </div>`;
}

function closeModal(){$('reportModal').classList.add('hidden');$('reportModal').setAttribute('aria-hidden','true')}
$('closeModal').addEventListener('click',closeModal);document.querySelector('[data-close="1"]').addEventListener('click',closeModal);$('printReportBtn').addEventListener('click',()=>window.print());document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});

(async function init(){
 const {data}=await supabaseClient.auth.getSession();
 if(data.session?.user){const ok=await requireAdmin(data.session.user);if(ok){showApp(data.session.user);await loadReports()}else{await supabaseClient.auth.signOut();showLogin()}}
 supabaseClient.auth.onAuthStateChange(async(event,session)=>{if(event==='SIGNED_OUT')showLogin();});
})();
