const reportForm = document.getElementById("reportForm");
const saveMessage = document.getElementById("saveMessage");

// Supabase connection for MARV'S Gaming Hub Reports.
// The publishable key is intended for browser-side use; database access is
// still controlled by Supabase permissions and Row Level Security.
const SUPABASE_URL = 'https://fvxpfpqkdsznvvreicfc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_dC4BDvHAExevhXghB6-8rQ_RLtR12zB';
const supabaseClient = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

function setSaveMessage(message, type = "") {
  if (!saveMessage) return;
  saveMessage.textContent = message;
  saveMessage.dataset.type = type;
}

function getSelectedGameRows() {
  return gameOptions.map(option => ({
    game_name: option.dataset.game,
    status: ({
      updated: "Updated",
      check: "Need to Check",
      update: "Needs Update"
    })[option.dataset.status] || "Updated"
  }));
}

function getPcStatusRows() {
  const rows = [];
  document.querySelectorAll('#standardPcChecklist input[data-pc], #vipPcChecklist input[data-pc]').forEach(input => {
    rows.push({
      pc_number: Number(input.dataset.pc.replace('PC', '')),
      no_defect: input.checked
    });
  });
  return rows;
}

const INVENTORY_MAP = {
  'keyboard-standard-red-dragon': ['Keyboard', 'Standard', 'Red Dragon'],
  'keyboard-standard-inplay': ['Keyboard', 'Standard', 'Inplay'],
  'keyboard-vip-red-dragon': ['Keyboard', 'VIP', 'Red Dragon'],
  'mouse-standard-fantech': ['Mouse', 'Standard', 'Fantech'],
  'mouse-standard-red-dragon': ['Mouse', 'Standard', 'Red Dragon'],
  'mouse-vip-red-dragon': ['Mouse', 'VIP', 'Red Dragon'],
  'headset-standard-fantech': ['Headset', 'Standard', 'Fantech'],
  'headset-vip-fantech': ['Headset', 'VIP', 'Fantech'],
  'headset-vip-badwolf': ['Headset', 'VIP', 'Badwolf'],
  'headset-vip-red-dragon': ['Headset', 'VIP', 'Red Dragon'],
  'headset-vip-keytech': ['Headset', 'VIP', 'Keytech']
};

function getInventoryRows() {
  return Object.entries(INVENTORY_MAP).map(([key, [peripheral_type, category, brand]]) => {
    const input = document.querySelector(`[data-inventory="${key}"]`);
    return { peripheral_type, category, brand, quantity: Math.max(0, Math.floor(Number(input?.value) || 0)) };
  });
}

const SPARE_INPUTS = {
  'VIP Keyboard': 'spareVipKeyboard',
  'Standard Keyboard': 'spareStandardKeyboard',
  'VIP Mouse': 'spareVipMouse',
  'Standard Mouse': 'spareStandardMouse',
  'Spare Cord': 'spareCord'
};

function getSpareRows() {
  return Object.entries(SPARE_INPUTS).map(([item_type, id]) => {
    const input = document.getElementById(id);
    // Empty spare fields are intentionally stored as NULL.
    const raw = String(input?.value ?? '').trim();
    if (raw === '') return { item_type, quantity: null };

    // Be forgiving of harmless formatting such as 1,000 while still
    // requiring a non-negative whole-number quantity.
    const normalized = raw.replace(/,/g, '');
    const quantity = Number(normalized);
    if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity < 0) {
      throw new Error(`${item_type} must be a whole number or left blank.`);
    }
    return { item_type, quantity };
  });
}

async function saveReportToSupabase() {
  if (!supabaseClient) throw new Error('Supabase client could not be loaded.');

  const { data: sessionData } = await supabaseClient.auth.getSession();
  const userId = sessionData?.session?.user?.id || null;
  const followUp = document.getElementById('followUpReport')?.value.trim() || null;

  const { data: report, error: reportError } = await supabaseClient
    .from('gaming_reports')
    .insert({
      report_date: new Date().toISOString().slice(0, 10),
      follow_up_report: followUp,
      created_by: userId
    })
    .select('id')
    .single();

  if (reportError) throw reportError;
  const reportId = report.id;

  try {
    const games = getSelectedGameRows().map(row => ({ ...row, report_id: reportId }));
    const defects = Array.from(defectRecords.values()).map(row => ({
  report_id: reportId,
  pc_number: Number(row.pc.replace('PC', '')),
  peripheral_type: ({
    keyboard: 'Keyboard',
    headset: 'Headset',
    mouse: 'Mouse',
    monitor: 'Monitor',
    'power-cord': 'Power Cord'
  })[row.type],
  description: row.note || null
}));
    const pcStatus = getPcStatusRows().map(row => ({ ...row, report_id: reportId }));
    const inventory = getInventoryRows().map(row => ({ ...row, report_id: reportId }));
    const spares = getSpareRows().map(row => ({ ...row, report_id: reportId }));

    const writes = [
      supabaseClient.from('report_games').insert(games),
      supabaseClient.from('report_pc_status').insert(pcStatus),
      supabaseClient.from('report_inventory').insert(inventory),
      supabaseClient.from('report_spares').insert(spares),
      supabaseClient.from('report_signoffs').insert({
        report_id: reportId,
        admin_name: document.getElementById('adminName')?.value || null,
        tech_name: document.getElementById('techName')?.value || null,
        admin_signature: document.getElementById('adminSignature')?.toDataURL('image/png') || null,
        tech_signature: document.getElementById('techSignature')?.toDataURL('image/png') || null,
        signed_at: new Date().toISOString()
      })
    ];

    if (defects.length) writes.push(supabaseClient.from('report_defects').insert(defects));

    const results = await Promise.all(writes);
    const failed = results.find(result => result.error);
    if (failed?.error) throw failed.error;

    return reportId;
  } catch (error) {
    // Avoid leaving an orphan report header if a child table write fails.
    await supabaseClient.from('gaming_reports').delete().eq('id', reportId);
    throw error;
  }
}

if (reportForm) {
  reportForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const saveButton = reportForm.querySelector('.save-btn');
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.classList.add('is-saving');
    }
    setSaveMessage('Saving report to Supabase…');

    try {
      const reportId = await saveReportToSupabase();
      setSaveMessage(`✓ Report saved successfully • ${reportId.slice(0, 8)}…`, 'success');
    } catch (error) {
      console.error('Supabase save failed:', error);
      const message = error?.message || 'Unknown Supabase error.';
      setSaveMessage(`Could not save report: ${message}`, 'error');
    } finally {
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.classList.remove('is-saving');
      }
    }
  });
}




// Games Update controls
const gameSearch = document.getElementById("gameSearch");
const gameOptions = [...document.querySelectorAll(".game-option")];
const selectedCount = document.getElementById("selectedCount");
const noGames = document.getElementById("noGames");
const selectAllGames = document.getElementById("selectAllGames");
const clearGames = document.getElementById("clearGames");
const statusCommands = [...document.querySelectorAll(".header-status")];
const viewStatusButtons = [...document.querySelectorAll(".view-status-btn")];
const updatedCount = document.getElementById("updatedCount");
const checkCount = document.getElementById("checkCount");
const updateCount = document.getElementById("updateCount");
const allCount = document.getElementById("allCount");
const listHeading = document.getElementById("listHeading");
const listHint = document.getElementById("listHint");

let activeView = "all";

function getCounts() {
  return {
    updated: gameOptions.filter(o => o.dataset.status === "updated").length,
    check: gameOptions.filter(o => o.dataset.status === "check").length,
    update: gameOptions.filter(o => o.dataset.status === "update").length
  };
}

function renderGames() {
  const query = gameSearch.value.trim().toLowerCase();
  const counts = getCounts();
  let visible = 0;
  let selected = 0;

  gameOptions.forEach(option => {
    const checkbox = option.querySelector('input[type="checkbox"]');
    const matchesSearch = option.dataset.game.toLowerCase().includes(query);
    const matchesStatus = activeView === "all" || option.dataset.status === activeView;
    const show = matchesSearch && matchesStatus;

    option.style.display = show ? "flex" : "none";
    if (show) visible++;
    if (checkbox.checked) selected++;
    option.classList.toggle("is-selected", checkbox.checked);
  });

  selectedCount.textContent = `${selected} selected / ${gameOptions.length} games`;
  updatedCount.textContent = counts.updated;
  checkCount.textContent = counts.check;
  updateCount.textContent = counts.update;
  if (allCount) allCount.textContent = gameOptions.length;

  const headings = {
    all: "All Games",
    updated: "Updated Games",
    check: "Games — Need to Check",
    update: "Games — Needs Update"
  };
  listHeading.textContent = headings[activeView];
  listHint.textContent = activeView === "all"
    ? "Select games and use a status button above"
    : "Click All to see every game";

  noGames.style.display = visible ? "none" : "block";
  viewStatusButtons.forEach(button => {
    button.classList.toggle("active", button.dataset.viewStatus === activeView);
  });
  statusCommands.forEach(button => {
    button.disabled = selected === 0;
  });
}

// Search
if (gameSearch) gameSearch.addEventListener("input", renderGames);

// Checkbox selection
// Keep selection intact when switching views so status actions can be deliberate.
gameOptions.forEach(option => {
  const checkbox = option.querySelector('input[type="checkbox"]');
  checkbox.addEventListener("change", renderGames);
});

// Select all games
selectAllGames.addEventListener("click", () => {
  gameOptions.forEach(option => {
    option.querySelector('input[type="checkbox"]').checked = true;
  });
  renderGames();
});

// Clear selection
clearGames.addEventListener("click", () => {
  gameOptions.forEach(option => {
    option.querySelector('input[type="checkbox"]').checked = false;
  });
  renderGames();
});

// VIEW buttons: one click filters the list by status.
viewStatusButtons.forEach(button => {
  button.addEventListener("click", () => {
    activeView = button.dataset.viewStatus;
    gameSearch.value = "";
    renderGames();
  });
});

// STATUS buttons: assign the selected games to a status.
statusCommands.forEach(button => {
  button.addEventListener("click", () => {
    const newStatus = button.dataset.setStatus;
    const selectedGames = gameOptions.filter(option =>
      option.querySelector('input[type="checkbox"]').checked
    );

    if (!selectedGames.length) return;

    selectedGames.forEach(option => {
      option.dataset.status = newStatus;
      option.querySelector('input[type="checkbox"]').checked = false;
    });

    // Automatically show the group just assigned.
    activeView = newStatus;
    gameSearch.value = "";
    renderGames();

    const original = button.innerHTML;
    button.innerHTML = `<span>✓</span> ${selectedGames.length} game${selectedGames.length === 1 ? "" : "s"} updated`;
    setTimeout(() => {
      button.innerHTML = original;
      renderGames();
    }, 900);
  });
});

// Selected count returns to All Games when clicked.
selectedCount.addEventListener("click", () => {
  activeView = "all";
  gameSearch.value = "";
  renderGames();
});

const allGamesView = document.getElementById("allGamesView");
if (allGamesView) {
  allGamesView.addEventListener("click", () => {
    activeView = "all";
    gameSearch.value = "";
    renderGames();
  });
}

renderGames();

// Defective peripherals: add-only workflow.
const defectPcSelect = document.getElementById("defectPcSelect");
const defectDescription = document.getElementById("defectDescription");
const defectSelection = document.getElementById("defectSelection");

const totalDefectKeyboardStandard =
  document.getElementById("totalDefectKeyboardStandard");
const totalDefectKeyboardVip =
  document.getElementById("totalDefectKeyboardVip");

const totalDefectHeadsetStandard =
  document.getElementById("totalDefectHeadsetStandard");
const totalDefectHeadsetVip =
  document.getElementById("totalDefectHeadsetVip");

const totalDefectMouseStandard =
  document.getElementById("totalDefectMouseStandard");
const totalDefectMouseVip =
  document.getElementById("totalDefectMouseVip");

const totalDefectMonitorStandard =
  document.getElementById("totalDefectMonitorStandard");
const totalDefectMonitorVip =
  document.getElementById("totalDefectMonitorVip");

const totalDefectPowerCordStandard =
  document.getElementById("totalDefectPowerCordStandard");
const totalDefectPowerCordVip =
  document.getElementById("totalDefectPowerCordVip");

const heroDefectiveHeadsets =
  document.getElementById("heroDefectiveHeadsets");

const defectTypeChecks = Array.from(
  document.querySelectorAll(".defect-type-check")
);

const pcs = Array.from({ length: 40 }, (_, index) => ({
  pc: `PC${String(index + 1).padStart(2, "0")}`,
  tier: index < 10 ? "VIP" : "Standard"
}));

// One record per PC + defect type.
const defectRecords = new Map();

const typeLabels = {
  keyboard: "Keyboard",
  headset: "Headset",
  mouse: "Mouse",
  monitor: "Monitor",
  "power-cord": "Power Cord"
};

function recordsFor(type) {
  return Array.from(defectRecords.values()).filter(
    record => record.type === type
  );
}

function updateDefectSummary() {
  const updateTierCount = (type, standardElement, vipElement) => {
    const records = recordsFor(type);

    const standard = records.filter(
      record => record.tier === "Standard"
    ).length;

    const vip = records.filter(
      record => record.tier === "VIP"
    ).length;

    if (standardElement) {
      standardElement.textContent = `Standard - ${standard}`;
    }

    if (vipElement) {
      vipElement.textContent = `VIP - ${vip}`;
    }
  };

  updateTierCount(
    "keyboard",
    totalDefectKeyboardStandard,
    totalDefectKeyboardVip
  );

  updateTierCount(
    "headset",
    totalDefectHeadsetStandard,
    totalDefectHeadsetVip
  );

  updateTierCount(
    "mouse",
    totalDefectMouseStandard,
    totalDefectMouseVip
  );

  updateTierCount(
    "monitor",
    totalDefectMonitorStandard,
    totalDefectMonitorVip
  );

  updateTierCount(
    "power-cord",
    totalDefectPowerCordStandard,
    totalDefectPowerCordVip
  );

  if (heroDefectiveHeadsets) {
    heroDefectiveHeadsets.textContent =
      String(recordsFor("headset").length).padStart(2, "0");
  }
}

function updateDefectSelectionLabel(message = null) {
  if (!defectSelection) return;

  if (message !== null) {
    defectSelection.textContent = message;
    return;
  }

  const selected = defectTypeChecks
    .filter(check => check.checked)
    .map(check => typeLabels[check.value] || check.value);

  defectSelection.textContent = selected.length
    ? selected.join(", ")
    : "No defect selected.";
}

function resetDefectInputs() {
  defectTypeChecks.forEach(check => {
    check.checked = false;
  });

  if (defectDescription) {
    defectDescription.value = "";
  }

  if (defectPcSelect) {
    defectPcSelect.value = "";
  }

  updateDefectSelectionLabel();
}

defectTypeChecks.forEach(check => {
  check.addEventListener("change", () => {
    updateDefectSelectionLabel();
  });
});

if (defectPcSelect) {
  defectPcSelect.addEventListener("change", () => {
    updateDefectSelectionLabel();
  });
}

// Add defect
document.addEventListener("click", event => {
  const button = event.target.closest("#addDefect");

  if (!button) return;

  event.preventDefault();
  event.stopPropagation();

  const selectedPc = defectPcSelect?.value || "";

  const pc = pcs.find(item => item.pc === selectedPc);

  if (!pc) {
    updateDefectSelectionLabel("Please select a PC.");
    return;
  }

  const selectedTypes = defectTypeChecks
    .filter(check => check.checked)
    .map(check => check.value)
    .filter(type => typeLabels[type]);

  if (!selectedTypes.length) {
    updateDefectSelectionLabel(
      "Please select at least one defect type."
    );
    return;
  }

  const note = defectDescription?.value.trim() || "";

  let added = 0;

  selectedTypes.forEach(type => {
    const key = `${pc.pc}|${type}`;

    if (defectRecords.has(key)) {
      const existing = defectRecords.get(key);

      if (note) {
        existing.note = note;
      }

      return;
    }

    defectRecords.set(key, {
      pc: pc.pc,
      tier: pc.tier,
      type: type,
      note: note
    });

    added++;
  });

  // UPDATE THE COUNTERS IMMEDIATELY.
  updateDefectSummary();

  // Show result WITHOUT immediately erasing it.
  updateDefectSelectionLabel(
    added > 0
      ? `✓ ${added} defect${added === 1 ? "" : "s"} added to ${pc.pc}. Count updated.`
      : `✓ ${pc.pc} already has the selected defect${selectedTypes.length === 1 ? "" : "s"}.`
  );

  // Clear only the inputs, but keep the success message visible.
  defectTypeChecks.forEach(check => {
    check.checked = false;
  });

  if (defectDescription) {
    defectDescription.value = "";
  }

  if (defectPcSelect) {
    defectPcSelect.value = "";
  }
});

// Clear all defects
document.addEventListener("click", event => {
  const button = event.target.closest("#clearDefects");

  if (!button) return;

  event.preventDefault();
  event.stopPropagation();

  defectRecords.clear();

  updateDefectSummary();

  defectTypeChecks.forEach(check => {
    check.checked = false;
  });

  if (defectDescription) {
    defectDescription.value = "";
  }

  if (defectPcSelect) {
    defectPcSelect.value = "";
  }

  updateDefectSelectionLabel(
    "All defects cleared. Counts reset to 0."
  );
});

updateDefectSummary();

// Signature pads: draw directly with mouse, touch, or pen.
function setupSignaturePad(canvasId, placeholderId) {
  const canvas = document.getElementById(canvasId);
  const placeholder = document.getElementById(placeholderId);
  if (!canvas || !placeholder) return;
  const ctx = canvas.getContext("2d");
  let drawing = false;
  let hasInk = false;
  let lastX = 0;
  let lastY = 0;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const old = hasInk ? canvas.toDataURL() : null;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = "#111827";
    ctx.globalAlpha = 1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (old) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = old;
    }
  };

  const point = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    drawing = true;
    hasInk = true;
    placeholder.style.display = "none";
    canvas.setPointerCapture?.(event.pointerId);
    const p = point(event);
    lastX = p.x; lastY = p.y;
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    event.preventDefault();
    const p = point(event);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastX = p.x; lastY = p.y;
  });
  const stop = (event) => {
    if (!drawing) return;
    drawing = false;
    try { canvas.releasePointerCapture?.(event.pointerId); } catch (_) {}
  };
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);
  canvas.addEventListener("pointerleave", () => { /* capture keeps drawing on supported browsers */ });

  const clear = () => {
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    hasInk = false;
    placeholder.style.display = "block";
  };
  const clearButton = document.querySelector(`[data-signature-clear="${canvasId}"]`);
  clearButton?.addEventListener("click", clear);
  resize();
  window.addEventListener("resize", resize);
}

setupSignaturePad("adminSignature", "adminSignaturePlaceholder");
setupSignaturePad("techSignature", "techSignaturePlaceholder");


  const liveDate = document.getElementById("liveDate");
  const liveTime = document.getElementById("liveTime");
  function updateLiveDateTime() {
    if (!liveDate || !liveTime) return;
    const now = new Date();
    liveDate.textContent = now.toLocaleDateString(undefined, {
      weekday: "long", year: "numeric", month: "long", day: "numeric"
    });
    liveTime.textContent = now.toLocaleTimeString(undefined, {
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true
    });
  }
  updateLiveDateTime();
  setInterval(updateLiveDateTime, 1000);

// Editable peripheral inventory counts
const inventoryGroups = {
  keyboardStandardTotal: ['keyboard-standard-red-dragon','keyboard-standard-inplay'],
  keyboardVipTotal: ['keyboard-vip-red-dragon'],
  mouseStandardTotal: ['mouse-standard-fantech','mouse-standard-red-dragon'],
  mouseVipTotal: ['mouse-vip-red-dragon'],
  headsetStandardTotal: ['headset-standard-fantech'],
  headsetVipTotal: ['headset-vip-fantech','headset-vip-badwolf','headset-vip-red-dragon','headset-vip-keytech']
};

function updateInventoryTotals(){
  Object.entries(inventoryGroups).forEach(([totalId, keys]) => {
    const total = keys.reduce((sum, key) => {
      const input = document.querySelector(`[data-inventory="${key}"]`);
      return sum + (input ? Math.max(0, Number(input.value) || 0) : 0);
    }, 0);
    const el = document.getElementById(totalId);
    if (el) el.textContent = total;
  });
}

document.querySelectorAll('.inventory-count').forEach(input => {
  input.addEventListener('input', () => {
    let value = Number(input.value);
    if (!Number.isFinite(value) || value < 0) value = 0;
    if (value > 99) value = 99;
    input.value = Math.floor(value);
    updateInventoryTotals();
  });
});
updateInventoryTotals();

/* PC status checklist */
(function initPcStatusChecklist(){
  const standardWrap = document.getElementById('standardPcChecklist');
  const vipWrap = document.getElementById('vipPcChecklist');
  if (!standardWrap || !vipWrap) return;

  function buildChecks(container, start, end, prefix){
    for(let n=start;n<=end;n++){
      const pc=`PC${String(n).padStart(2,'0')}`;
      const id=`${prefix}-${n}`;
      const item=document.createElement('div');
      item.className='pc-check';
      item.innerHTML=`<input type="checkbox" id="${id}" data-pc-status="no-defect" data-pc="${pc}"><label for="${id}">${pc}</label>`;
      container.appendChild(item);
    }
  }

  buildChecks(standardWrap,11,40,'standard-pc');
  buildChecks(vipWrap,1,10,'vip-pc');

  function updateCounts(){
    const std=standardWrap.querySelectorAll('input:checked').length;
    const vip=vipWrap.querySelectorAll('input:checked').length;
    const a=document.getElementById('standardNoDefectsCount');
    const b=document.getElementById('vipNoDefectsCount');
    if(a) a.textContent=std;
    if(b) b.textContent=vip;
  }

  document.querySelectorAll('[data-pc-select]').forEach(btn=>btn.addEventListener('click',()=>{
    const wrap=btn.dataset.pcSelect==='vip'?vipWrap:standardWrap;
    wrap.querySelectorAll('input').forEach(cb=>cb.checked=true);
    updateCounts();
  }));
  document.querySelectorAll('[data-pc-clear]').forEach(btn=>btn.addEventListener('click',()=>{
    const wrap=btn.dataset.pcClear==='vip'?vipWrap:standardWrap;
    wrap.querySelectorAll('input').forEach(cb=>cb.checked=false);
    updateCounts();
  }));
  document.querySelectorAll('[data-pc-status]').forEach(cb=>cb.addEventListener('change',updateCounts));
  updateCounts();
})();
/* =========================================================
   SHIFT REPORT — OPEN / CLOSE SHIFT SELECTION
   ========================================================= */

const shiftModal = document.getElementById("shiftModal");
const openShiftReport = document.getElementById("openShiftReport");
const closeShiftReport = document.getElementById("closeShiftReport");
const shiftModalBackdrop = document.getElementById("shiftModalBackdrop");
const shiftChoices = document.querySelectorAll(".shift-choice");

function openShiftModal() {
  if (!shiftModal) return;

  shiftModal.classList.add("is-open");
  shiftModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("shift-modal-open");
}

function closeShiftModal() {
  if (!shiftModal) return;

  shiftModal.classList.remove("is-open");
  shiftModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("shift-modal-open");
}

openShiftReport?.addEventListener("click", openShiftModal);
closeShiftReport?.addEventListener("click", closeShiftModal);
shiftModalBackdrop?.addEventListener("click", closeShiftModal);

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && shiftModal?.classList.contains("is-open")) {
    closeShiftModal();
  }
});


/* =========================================================
   SHIFT REPORT FORM
   ========================================================= */

const shiftPickerView = document.getElementById("shiftPickerView");
const shiftReportView = document.getElementById("shiftReportView");
const backToShiftPicker = document.getElementById("backToShiftPicker");

const selectedShiftLabel = document.getElementById("selectedShiftLabel");
const shiftReportDate = document.getElementById("shiftReportDate");

let selectedShiftType = "";
let selectedShiftLabelText = "";


/* =========================================================
   OPEN SELECTED SHIFT
   ========================================================= */

shiftChoices.forEach(choice => {

  choice.addEventListener("click", () => {

    selectedShiftType = choice.dataset.shiftType || "";
    selectedShiftLabelText = choice.dataset.shiftLabel || "";

    selectedShiftLabel.textContent = selectedShiftLabelText;

    const now = new Date();

    shiftReportDate.textContent = now.toLocaleDateString(
      "en-PH",
      {
        year: "numeric",
        month: "long",
        day: "numeric"
      }
    );

    shiftPickerView.hidden = true;
    shiftReportView.hidden = false;

    buildShiftGameList();
    buildShiftPcLists();

    setTimeout(() => {
      setupShiftSignatureCanvas(
        document.getElementById("shiftAdminSignature")
      );

      setupShiftSignatureCanvas(
        document.getElementById("shiftTechSignature")
      );
    }, 50);

  });

});


/* =========================================================
   BACK TO SHIFT SELECTION
   ========================================================= */

backToShiftPicker?.addEventListener("click", () => {

  shiftReportView.hidden = true;
  shiftPickerView.hidden = false;

});


/* =========================================================
   BUILD GAME LIST
   Uses your existing game list
   ========================================================= */

function buildShiftGameList() {


  const container = document.getElementById("shiftGameList");
  const emptyMessage = document.getElementById("shiftNoGames");

  if (!container) return;

  container.innerHTML = "";

  const games = [...document.querySelectorAll(".game-option")];

  if (!games.length) {
    emptyMessage.hidden = false;
    return;
  }

  emptyMessage.hidden = true;

  games.forEach((game, index) => {

    const gameName =
  game.querySelector(".game-name")?.textContent?.trim() ||
  game.dataset.game ||
  `Game ${index + 1}`;

    const id = `shiftGame_${index}`;

    const wrapper = document.createElement("div");
    wrapper.className = "shift-game-option";

    wrapper.innerHTML = `
      <input
        type="checkbox"
        id="${id}"
        value="${escapeShiftHtml(gameName)}"
      >

      <label for="${id}">
        ${escapeShiftHtml(gameName)}
      </label>
    `;

    container.appendChild(wrapper);

  });

}

/* =========================================================
   CLEAR ALL SHIFT GAMES
   ========================================================= */

document
  .getElementById("clearShiftGames")
  ?.addEventListener("click", () => {

    document
      .querySelectorAll('#shiftGameList input[type="checkbox"]')
      .forEach(checkbox => {
        checkbox.checked = false;
      });

  });

/* =========================================================
   CLEAR ALL SHIFT PC SELECTIONS
   ========================================================= */

document
  .getElementById("clearShiftNoDefectPcs")
  ?.addEventListener("click", () => {

    document
      .querySelectorAll(
        '#shiftNoDefectPcList input[type="checkbox"]'
      )
      .forEach(checkbox => {
        checkbox.checked = false;
      });

  });

document
  .getElementById("clearShiftCleanedPcs")
  ?.addEventListener("click", () => {

    document
      .querySelectorAll(
        '#shiftCleanedPcList input[type="checkbox"]'
      )
      .forEach(checkbox => {
        checkbox.checked = false;
      });

  });


/* =========================================================
   BUILD PC LISTS
   PC01-PC40
   ========================================================= */

function buildShiftPcLists() {

  const noDefectContainer =
    document.getElementById("shiftNoDefectPcList");

  const cleanedContainer =
    document.getElementById("shiftCleanedPcList");

  if (!noDefectContainer || !cleanedContainer) return;

  noDefectContainer.innerHTML = "";
  cleanedContainer.innerHTML = "";

  for (let i = 1; i <= 40; i++) {

    const pcNumber = `PC${String(i).padStart(2, "0")}`;

    noDefectContainer.insertAdjacentHTML(
      "beforeend",
      createShiftPcOption(
        pcNumber,
        "shiftNoDefect",
        i
      )
    );

    cleanedContainer.insertAdjacentHTML(
      "beforeend",
      createShiftPcOption(
        pcNumber,
        "shiftCleaned",
        i
      )
    );

  }

}


function createShiftPcOption(pcNumber, groupName, index) {

  const id = `${groupName}_${index}`;

  return `
    <div class="shift-pc-option">

      <input
        type="checkbox"
        id="${id}"
        name="${groupName}"
        value="${pcNumber}"
      >

      <label for="${id}">
        ${pcNumber}
      </label>

    </div>
  `;

}


/* =========================================================
   SIGNATURE PAD
   ========================================================= */

function setupShiftSignatureCanvas(canvas) {

  if (!canvas) return;

  const parent = canvas.parentElement;

  const width = parent.clientWidth || 300;
  const height = parent.clientHeight || 100;

  const ratio = Math.max(window.devicePixelRatio || 1, 1);

  canvas.width = width * ratio;
  canvas.height = height * ratio;

  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");

  ctx.scale(ratio, ratio);

ctx.lineWidth = 2.6;
ctx.lineCap = "round";
ctx.lineJoin = "round";
ctx.strokeStyle = "#111827";
ctx.globalAlpha = 1;

  let drawing = false;

  function getPosition(event) {

    const rect = canvas.getBoundingClientRect();

    const source =
      event.touches?.[0] ||
      event.changedTouches?.[0] ||
      event;

    return {
      x: source.clientX - rect.left,
      y: source.clientY - rect.top
    };

  }

  function start(event) {

    event.preventDefault();

    drawing = true;

    const pos = getPosition(event);

    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);

  }

  function draw(event) {

    if (!drawing) return;

    event.preventDefault();

    const pos = getPosition(event);

    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();

  }

  function stop(event) {

    if (!drawing) return;

    event?.preventDefault();

    drawing = false;

    ctx.closePath();

  }

  canvas.onmousedown = start;
  canvas.onmousemove = draw;
  canvas.onmouseup = stop;
  canvas.onmouseleave = stop;

  canvas.ontouchstart = start;
  canvas.ontouchmove = draw;
  canvas.ontouchend = stop;

  canvas.dataset.ready = "true";

}


/* =========================================================
   CLEAR SIGNATURE
   ========================================================= */

document
  .querySelectorAll("[data-clear-signature]")
  .forEach(button => {

    button.addEventListener("click", () => {

      const canvas = document.getElementById(
        button.dataset.clearSignature
      );

      if (!canvas) return;

      const ctx = canvas.getContext("2d");

      ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
      );

    });

  });


/* =========================================================
   HTML ESCAPE
   ========================================================= */

function escapeShiftHtml(value) {

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

}

/* =====================================================
   SHIFT REPORT PREVIEW
   ===================================================== */

const shiftPreviewModal =
  document.getElementById("shiftPreviewModal");

const closeShiftPreview =
  document.getElementById("closeShiftPreview");

const shiftPreviewBackdrop =
  document.getElementById("shiftPreviewBackdrop");

const printShiftReport =
  document.getElementById("printShiftReport");


function openShiftPreview() {

  if (!shiftPreviewModal) return;

  shiftPreviewModal.classList.add("is-open");

  shiftPreviewModal.setAttribute(
    "aria-hidden",
    "false"
  );

}


function closeShiftPreviewModal() {

  if (!shiftPreviewModal) return;

  shiftPreviewModal.classList.remove("is-open");

  shiftPreviewModal.setAttribute(
    "aria-hidden",
    "true"
  );

}


closeShiftPreview?.addEventListener(
  "click",
  closeShiftPreviewModal
);


shiftPreviewBackdrop?.addEventListener(
  "click",
  closeShiftPreviewModal
);


printShiftReport?.addEventListener(
  "click",
  () => {
    window.print();
  }
);


document.addEventListener("keydown", event => {

  if (
    event.key === "Escape" &&
    shiftPreviewModal?.classList.contains("is-open")
  ) {
    closeShiftPreviewModal();
  }

});


function setShiftPreviewText(id, value) {

  const element =
    document.getElementById(id);

  if (!element) return;

  element.textContent =
    value !== null &&
    value !== undefined &&
    String(value).trim()
      ? value
      : "—";

}


function setShiftPreviewList(id, values) {

  const container =
    document.getElementById(id);

  if (!container) return;

  container.innerHTML = "";

  if (!values || !values.length) {

    container.textContent = "—";

    return;
  }

  values.forEach(value => {

    const span =
      document.createElement("span");

    span.textContent = value;

    container.appendChild(span);

  });

}


function setShiftPreviewGames(games) {

  const container =
    document.getElementById("previewGames");

  if (!container) return;

  container.innerHTML = "";

  if (!games || !games.length) {

    container.textContent = "—";

    return;
  }

  games.forEach(game => {

    const item =
      document.createElement("div");

    item.textContent = game;

    container.appendChild(item);

  });

}


function showShiftReportPreview(report, games) {

  if (!report) return;


  setShiftPreviewText(
    "previewShiftLabel",
    `${report.shift_type} ${report.shift_time}`
  );


  setShiftPreviewText(
    "previewShiftDate",
    report.report_date
      ? new Date(
          `${report.report_date}T00:00:00`
        ).toLocaleDateString(
          "en-PH",
          {
            year: "numeric",
            month: "long",
            day: "numeric"
          }
        )
      : "—"
  );


  setShiftPreviewText(
    "previewChanges",
    report.changes
  );


  setShiftPreviewText(
    "previewKeyboard",
    report.defective_keyboard
  );


  setShiftPreviewText(
    "previewMouse",
    report.defective_mouse
  );


  setShiftPreviewText(
    "previewHeadset",
    report.defective_headset
  );


  setShiftPreviewText(
    "previewFollowUp",
    report.follow_up_report
  );


  setShiftPreviewGames(games);


  setShiftPreviewList(
    "previewNoDefectPcs",
    report.pc_no_defects
      ? report.pc_no_defects
          .split(",")
          .map(pc => pc.trim())
          .filter(Boolean)
      : []
  );


  setShiftPreviewList(
    "previewCleanedPcs",
    report.cleaned_pc
      ? report.cleaned_pc
          .split(",")
          .map(pc => pc.trim())
          .filter(Boolean)
      : []
  );


  setShiftPreviewText(
    "previewSpareVipKeyboard",
    report.spare_vip_keyboard ?? 0
  );


  setShiftPreviewText(
    "previewSpareStandardKeyboard",
    report.spare_standard_keyboard ?? 0
  );


  setShiftPreviewText(
    "previewSpareVipMouse",
    report.spare_vip_mouse ?? 0
  );


  setShiftPreviewText(
    "previewSpareStandardMouse",
    report.spare_standard_mouse ?? 0
  );


  setShiftPreviewText(
    "previewSpareCord",
    report.spare_cord ?? 0
  );


  setShiftPreviewText(
    "previewAdminName",
    report.admin_name
  );


  setShiftPreviewText(
    "previewTechName",
    report.tech_name
  );


  const adminSignature =
    document.getElementById(
      "previewAdminSignature"
    );

  const techSignature =
    document.getElementById(
      "previewTechSignature"
    );


  if (adminSignature) {

    adminSignature.src =
      report.admin_signature || "";

    adminSignature.style.display =
      report.admin_signature
        ? "block"
        : "none";

  }


  if (techSignature) {

    techSignature.src =
      report.tech_signature || "";

    techSignature.style.display =
      report.tech_signature
        ? "block"
        : "none";

  }


  openShiftPreview();

}


/* =========================================================
   TEMPORARY SAVE HANDLER
   Database connection comes in the next step.
   ========================================================= */

document
  .getElementById("shiftReportForm")
  ?.addEventListener("submit", async event => {

    event.preventDefault();

    const message =
      document.getElementById("shiftSaveMessage");

    const saveButton =
      document.getElementById("saveShiftReport");

    if (!supabaseClient) {
      message.textContent =
        "Supabase is not connected.";

      return;
    }

    if (!selectedShiftType) {
      message.textContent =
        "Please select a shift first.";

      return;
    }

    saveButton.disabled = true;
    saveButton.textContent = "Saving...";
    message.textContent = "";

    try {

      /* =====================================================
         SHIFT INFORMATION
         ===================================================== */

      const shiftType =
        selectedShiftType === "morning"
          ? "Morning Shift"
          : "Night Shift";

      const shiftTime =
        selectedShiftType === "morning"
          ? "9AM–9PM"
          : "9PM–9AM";

      const now = new Date();

      const reportDate =
        now.toLocaleDateString("en-CA");

      /* =====================================================
         UPDATED GAMES
         ===================================================== */

      const selectedGames = [
        ...document.querySelectorAll(
          '#shiftGameList input[type="checkbox"]:checked'
        )
      ].map(input => input.value);

      /* =====================================================
         PC WITH NO DEFECTS
         ===================================================== */

      const noDefectPcs = [
        ...document.querySelectorAll(
          '#shiftNoDefectPcList input[type="checkbox"]:checked'
        )
      ].map(input => input.value);

      /* =====================================================
         CLEANED PCS
         ===================================================== */

      const cleanedPcs = [
        ...document.querySelectorAll(
          '#shiftCleanedPcList input[type="checkbox"]:checked'
        )
      ].map(input => input.value);

      /* =====================================================
         SPARE ITEMS
         ===================================================== */

      const spareVipKeyboard =
        Number(
          document.getElementById("shiftSpareVipKeyboard")?.value || 0
        );

      const spareStandardKeyboard =
        Number(
          document.getElementById("shiftSpareStandardKeyboard")?.value || 0
        );

      const spareVipMouse =
        Number(
          document.getElementById("shiftSpareVipMouse")?.value || 0
        );

      const spareStandardMouse =
        Number(
          document.getElementById("shiftSpareStandardMouse")?.value || 0
        );

      const spareCord =
        Number(
          document.getElementById("shiftSpareCord")?.value || 0
        );

      /* =====================================================
         INSERT MAIN SHIFT REPORT
         ===================================================== */

      const { data: shiftReport, error: shiftError } =
        await supabaseClient
          .from("shift_reports")
          .insert({
            report_date: reportDate,
            shift_type: shiftType,
            shift_time: shiftTime,

            changes:
              document.getElementById("shiftChanges")?.value?.trim() || null,

            defective_keyboard:
              document.getElementById("shiftDefectiveKeyboard")?.value?.trim() || null,

            defective_mouse:
              document.getElementById("shiftDefectiveMouse")?.value?.trim() || null,

            defective_headset:
              document.getElementById("shiftDefectiveHeadset")?.value?.trim() || null,

            pc_no_defects:
              noDefectPcs.length
                ? noDefectPcs.join(", ")
                : null,

            spare_vip_keyboard: spareVipKeyboard,
            spare_standard_keyboard: spareStandardKeyboard,
            spare_vip_mouse: spareVipMouse,
            spare_standard_mouse: spareStandardMouse,
            spare_cord: spareCord,

            follow_up_report:
              document.getElementById("shiftFollowUp")?.value?.trim() || null,

            cleaned_pc:
              cleanedPcs.length
                ? cleanedPcs.join(", ")
                : null,

            admin_name:
              document.getElementById("shiftAdminName")?.value?.trim() || null,

            tech_name:
              document.getElementById("shiftTechName")?.value?.trim() || null,

            admin_signature:
              document.getElementById("shiftAdminSignature")?.toDataURL("image/png") || null,

            tech_signature:
              document.getElementById("shiftTechSignature")?.toDataURL("image/png") || null,

            created_at: new Date().toISOString()
          })
          .select()
          .single();

      if (shiftError) {
        throw shiftError;
      }

      const shiftReportId = shiftReport.id;

      /* =====================================================
         SAVE UPDATED GAMES
         ===================================================== */

      if (selectedGames.length) {

        const gameRows = selectedGames.map(gameName => ({
          shift_report_id: shiftReportId,
          game_name: gameName
        }));

        const { error: gamesError } =
          await supabaseClient
            .from("shift_report_games")
            .insert(gameRows);

        if (gamesError) {

          /* Remove the parent report if game saving fails */

          await supabaseClient
            .from("shift_reports")
            .delete()
            .eq("id", shiftReportId);

          throw gamesError;
        }
      }

      /* =====================================================
         SUCCESS
         ===================================================== */

      message.textContent =
        "Shift Report saved successfully.";

      saveButton.textContent = "Saved ✓";

      /* =====================================================
   SHOW SAVED SHIFT REPORT
   ===================================================== */

if (typeof showShiftReportPreview === "function") {
  showShiftReportPreview(
    shiftReport,
    selectedGames
  );
}

      /* =====================================================
         RESET FORM
         ===================================================== */

      document
        .getElementById("shiftReportForm")
        ?.reset();

      document
        .querySelectorAll(
          '#shiftGameList input[type="checkbox"], ' +
          '#shiftNoDefectPcList input[type="checkbox"], ' +
          '#shiftCleanedPcList input[type="checkbox"]'
        )
        .forEach(input => {
          input.checked = false;
        });

      /* Reset signature canvases */

      [
        "shiftAdminSignature",
        "shiftTechSignature"
      ].forEach(canvasId => {

        const canvas =
          document.getElementById(canvasId);

        if (!canvas) return;

        const ctx =
          canvas.getContext("2d");

        ctx.clearRect(
          0,
          0,
          canvas.width,
          canvas.height
        );

      });

      setTimeout(() => {
        saveButton.disabled = false;
        saveButton.textContent = "Save Shift Report";
      }, 2000);

    } catch (error) {

      console.error(
        "Shift Report Save Error:",
        error
      );

      message.textContent =
        error?.message
          ? `Failed to save Shift Report: ${error.message}`
          : "Failed to save Shift Report.";

      saveButton.disabled = false;
      saveButton.textContent = "Save Shift Report";
    }

  });
