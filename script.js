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
  return gameOptions
    .filter(option => option.dataset.status)
    .map(option => ({
      game_name: option.dataset.game,
      status: ({
        updated: "Updated",
        check: "Need to Check",
        update: "Needs Update"
      })[option.dataset.status]
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
  'keyboard-standard': ['Keyboard', 'Standard'],
  'keyboard-vip': ['Keyboard', 'VIP'],
  'mouse-standard': ['Mouse', 'Standard'],
  'mouse-vip': ['Mouse', 'VIP'],
  'headset-standard': ['Headset', 'Standard'],
  'headset-vip': ['Headset', 'VIP'],
  'monitor-standard': ['Monitor', 'Standard'],
  'monitor-vip': ['Monitor', 'VIP'],
  'power-cord-standard': ['Power Cord', 'Standard'],
  'power-cord-vip': ['Power Cord', 'VIP']
};

function getInventoryRows() {
  return Object.entries(INVENTORY_MAP).map(([key, [peripheral_type, category]]) => {
    const input = document.querySelector(`[data-inventory="${key}"]`);
    return {
      peripheral_type,
      category,
      brand: "",
      quantity: Math.max(0, Math.floor(Number(input?.value) || 0))
    };
  });
}

const SPARE_INPUTS = {
  'Keyboard': 'spareKeyboard',
  'Mouse': 'spareMouse',
  'Headset': 'spareHeadset',
  'Power Cord': 'sparePowerCord'
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
  const changes = document.getElementById('changes')?.value.trim() || null;
  const { data: report, error: reportError } = await supabaseClient
    .from('gaming_reports')
    .insert({
  report_date: new Date().toISOString().slice(0, 10),
  follow_up_report: followUp,
  changes: changes,
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
      /*
       * Capture the current Overall Report data
       * BEFORE the form is reset.
       */
      const overallPreviewData = collectOverallReportPreviewData();

      const reportId = await saveReportToSupabase();

      setSaveMessage(
        `✓ Report saved successfully • ${reportId.slice(0, 8)}…`,
        'success'
      );

      /*
       * Open Overall Report Preview
       * only after Supabase save succeeds.
       */
      showOverallReportPreview(overallPreviewData);

    } catch (error) {
      console.error('Supabase save failed:', error);

      const message =
        error?.message || 'Unknown Supabase error.';

      setSaveMessage(
        `Could not save report: ${message}`,
        'error'
      );

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
// All games start with NO STATUS.
// A game only gets a status after the user explicitly assigns one.
gameOptions.forEach(option => {
  delete option.dataset.status;
});
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

// Defective peripherals: add-one-at-a-time workflow.
const defectPcSelect = document.getElementById("defectPcSelect");
const defectTypeSelect = document.getElementById("defectTypeSelect");
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

const pcs = Array.from({ length: 40 }, (_, index) => ({
    pc: `PC${String(index + 1).padStart(2, "0")}`,
    tier: index < 10 ? "VIP" : "Standard"
}));

// Stores defects internally. Nothing is displayed here.
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

    const pc = defectPcSelect?.value || "";
    const type = defectTypeSelect?.value || "";

    if (!pc && !type) {
        defectSelection.textContent =
            "Select PC, defect type, and enter a description";
        return;
    }

    if (!pc) {
        defectSelection.textContent = "Please select a PC.";
        return;
    }

    if (!type) {
        defectSelection.textContent = "Please select a defect type.";
        return;
    }

    defectSelection.textContent =
        `${pc} — ${typeLabels[type] || type}`;
}

function resetDefectInputs() {
    if (defectPcSelect) {
        defectPcSelect.value = "";
    }

    if (defectTypeSelect) {
        defectTypeSelect.value = "";
    }

    if (defectDescription) {
        defectDescription.value = "";
    }

    updateDefectSelectionLabel();
}

if (defectPcSelect) {
    defectPcSelect.addEventListener("change", () => {
        updateDefectSelectionLabel();
    });
}

if (defectTypeSelect) {
    defectTypeSelect.addEventListener("change", () => {
        updateDefectSelectionLabel();
    });
}

if (defectDescription) {
    defectDescription.addEventListener("input", () => {
        const pc = defectPcSelect?.value || "";
        const type = defectTypeSelect?.value || "";

        if (pc && type) {
            updateDefectSelectionLabel(
                `${pc} — ${typeLabels[type] || type}`
            );
        }
    });
}

// Add one defect at a time.
document.addEventListener("click", event => {
    const button = event.target.closest("#addDefect");

    if (!button) return;

    event.preventDefault();
    event.stopPropagation();

    const selectedPc = defectPcSelect?.value || "";
    const selectedType = defectTypeSelect?.value || "";
    const note = defectDescription?.value.trim() || "";

    const pc = pcs.find(item => item.pc === selectedPc);

    if (!pc) {
        updateDefectSelectionLabel("Please select a PC.");
        return;
    }

    if (!selectedType || !typeLabels[selectedType]) {
        updateDefectSelectionLabel("Please select a defect type.");
        return;
    }

    if (!note) {
        updateDefectSelectionLabel(
            "Please enter a problem description."
        );
        return;
    }

    const key = `${pc.pc}|${selectedType}`;

    if (defectRecords.has(key)) {
        updateDefectSelectionLabel(
            `✓ ${pc.pc} already has a ${typeLabels[selectedType]} defect.`
        );
        return;
    }

    defectRecords.set(key, {
        pc: pc.pc,
        tier: pc.tier,
        type: selectedType,
        note: note
    });

    updateDefectSummary();

    updateDefectSelectionLabel(
        `✓ ${typeLabels[selectedType]} added to ${pc.pc}.`
    );

    resetDefectInputs();
});

// Clear all defects.
document.addEventListener("click", event => {
    const button = event.target.closest("#clearDefects");

    if (!button) return;

    event.preventDefault();
    event.stopPropagation();

    defectRecords.clear();

    updateDefectSummary();
    resetDefectInputs();

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
    try { canvas.releasePointerCapture?.(event.pointerId); } catch (_) { }
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
  keyboardStandardTotal: ['keyboard-standard'],
  keyboardVipTotal: ['keyboard-vip'],
  mouseStandardTotal: ['mouse-standard'],
  mouseVipTotal: ['mouse-vip'],
  headsetStandardTotal: ['headset-standard'],
  headsetVipTotal: ['headset-vip'],
  monitorStandardTotal: ['monitor-standard'],
  monitorVipTotal: ['monitor-vip'],
  powerCordStandardTotal: ['power-cord-standard'],
  powerCordVipTotal: ['power-cord-vip']
};

function updateInventoryTotals() {
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
(function initPcStatusChecklist() {
  const standardWrap = document.getElementById('standardPcChecklist');
  const vipWrap = document.getElementById('vipPcChecklist');
  if (!standardWrap || !vipWrap) return;

  function buildChecks(container, start, end, prefix) {
    for (let n = start; n <= end; n++) {
      const pc = `PC${String(n).padStart(2, '0')}`;
      const id = `${prefix}-${n}`;
      const item = document.createElement('div');
      item.className = 'pc-check';
      item.innerHTML = `<input type="checkbox" id="${id}" data-pc-status="no-defect" data-pc="${pc}"><label for="${id}">${pc}</label>`;
      container.appendChild(item);
    }
  }

  buildChecks(standardWrap, 11, 40, 'standard-pc');
  buildChecks(vipWrap, 1, 10, 'vip-pc');

  function updateCounts() {
    const std = standardWrap.querySelectorAll('input:checked').length;
    const vip = vipWrap.querySelectorAll('input:checked').length;
    const a = document.getElementById('standardNoDefectsCount');
    const b = document.getElementById('vipNoDefectsCount');
    if (a) a.textContent = std;
    if (b) b.textContent = vip;
  }

  document.querySelectorAll('[data-pc-select]').forEach(btn => btn.addEventListener('click', () => {
    const wrap = btn.dataset.pcSelect === 'vip' ? vipWrap : standardWrap;
    wrap.querySelectorAll('input').forEach(cb => cb.checked = true);
    updateCounts();
  }));
  document.querySelectorAll('[data-pc-clear]').forEach(btn => btn.addEventListener('click', () => {
    const wrap = btn.dataset.pcClear === 'vip' ? vipWrap : standardWrap;
    wrap.querySelectorAll('input').forEach(cb => cb.checked = false);
    updateCounts();
  }));
  document.querySelectorAll('[data-pc-status]').forEach(cb => cb.addEventListener('change', updateCounts));
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
   SHIFT REPORT — SELECT ALL / CLEAR ALL
   ONLY FOR SHIFT REPORT INPUT FORM
   ========================================================= */

/* 02 — UPDATED GAMES FOR THIS SHIFT */

document
  .getElementById("selectAllShiftGames")
  ?.addEventListener("click", () => {

    document
      .querySelectorAll('#shiftGameList input[type="checkbox"]')
      .forEach(checkbox => {
        checkbox.checked = true;
      });

  });

document
  .getElementById("clearShiftGames")
  ?.addEventListener("click", () => {

    document
      .querySelectorAll('#shiftGameList input[type="checkbox"]')
      .forEach(checkbox => {
        checkbox.checked = false;
      });

  });


/* 06 — PC NUMBER WITH NO DEFECTS */

document
  .getElementById("selectAllShiftNoDefectPcs")
  ?.addEventListener("click", () => {

    document
      .querySelectorAll(
        '#shiftNoDefectPcList input[type="checkbox"]'
      )
      .forEach(checkbox => {
        checkbox.checked = true;
      });

  });

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


/* 09 — CLEANED PC */

document
  .getElementById("selectAllShiftCleanedPcs")
  ?.addEventListener("click", () => {

    document
      .querySelectorAll(
        '#shiftCleanedPcList input[type="checkbox"]'
      )
      .forEach(checkbox => {
        checkbox.checked = true;
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
    "previewSpareKeyboard",
    report.spare_keyboard ?? 0
  );


  setShiftPreviewText(
    "previewSpareMouse",
    report.spare_mouse ?? 0
  );


  setShiftPreviewText(
    "previewSpareHeadset",
    report.spare_headset ?? 0
  );


  setShiftPreviewText(
    "previewSparePowerCord",
    report.spare_power_cord ?? 0
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

      const spareKeyboard =
        Number(
          document.getElementById("shiftSpareKeyboard")?.value || 0
        );

      const spareMouse =
        Number(
          document.getElementById("shiftSpareMouse")?.value || 0
        );

      const spareHeadset =
        Number(
          document.getElementById("shiftSpareHeadset")?.value || 0
        );

      const sparePowerCord =
        Number(
          document.getElementById("shiftSparePowerCord")?.value || 0
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

            spare_keyboard: spareKeyboard,
            spare_mouse: spareMouse,
            spare_headset: spareHeadset,
            spare_power_cord: sparePowerCord,

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
/* =========================================================
   OVERALL REPORT PREVIEW + PRINT
   ========================================================= */

const overallPreviewModal =
  document.getElementById("overallPreviewModal");

const overallPreviewBackdrop =
  document.getElementById("overallPreviewBackdrop");

const closeOverallPreview =
  document.getElementById("closeOverallPreview");

const closeOverallPreviewBottom =
  document.getElementById("closeOverallPreviewBottom");

const printOverallReport =
  document.getElementById("printOverallReport");


function openOverallPreview() {
  if (!overallPreviewModal) return;

  overallPreviewModal.classList.add("is-open");

  overallPreviewModal.setAttribute(
    "aria-hidden",
    "false"
  );
}


function closeOverallPreviewModal() {
  if (!overallPreviewModal) return;

  overallPreviewModal.classList.remove("is-open");

  overallPreviewModal.setAttribute(
    "aria-hidden",
    "true"
  );
}


closeOverallPreview?.addEventListener(
  "click",
  closeOverallPreviewModal
);


closeOverallPreviewBottom?.addEventListener(
  "click",
  closeOverallPreviewModal
);


overallPreviewBackdrop?.addEventListener(
  "click",
  closeOverallPreviewModal
);


printOverallReport?.addEventListener(
  "click",
  () => {
    window.print();
  }
);

document.addEventListener(
  "keydown",
  event => {

    if (
      event.key === "Escape" &&
      overallPreviewModal?.classList.contains("is-open")
    ) {
      closeOverallPreviewModal();
    }

  }
);


/* ---------------------------------------------------------
   Preview Helpers
   --------------------------------------------------------- */

function setOverallPreviewText(id, value) {

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


function setOverallPreviewList(id, values) {
  const container = document.getElementById(id);

  if (!container) return;

  container.innerHTML = "";

  if (!values || !values.length) {
    container.textContent = "—";
    return;
  }

  values.forEach(value => {
    const item = document.createElement("span");
    item.textContent = value;
    container.appendChild(item);
  });
}


/* ---------------------------------------------------------
   Collect Overall Report Data
   --------------------------------------------------------- */

function collectOverallReportPreviewData() {

  const getValue = id => {
    const element = document.getElementById(id);
    return element?.value ?? "";
  };


  /* =====================================================
     01 — GAMES
     ===================================================== */

  const games = getSelectedGameRows().map(game => ({
    name: game.game_name,
    status: game.status
  }));


  /* =====================================================
     02 — DEFECTIVE PERIPHERALS
     ===================================================== */

  const defects = Array.from(defectRecords.values()).map(record => ({
    pc: record.pc,
    tier: record.tier,
    type: typeLabels[record.type] || record.type,
    note: record.note || ""
  }));


  /* =====================================================
     03 — PC STATUS
     ===================================================== */

  const noDefectPcs = [
    ...document.querySelectorAll(
      '#standardPcChecklist input[data-pc]:checked, ' +
      '#vipPcChecklist input[data-pc]:checked'
    )
  ].map(input => input.dataset.pc);


  /* =====================================================
     04 — INVENTORY
     ===================================================== */

  const inventoryRows = getInventoryRows();

  const inventory = [
    "Keyboard",
    "Mouse",
    "Headset",
    "Monitor",
    "Power Cord"
  ].map(peripheralType => {
    const rows = inventoryRows.filter(
      item => item.peripheral_type === peripheralType
    );

    const standard = rows.find(item => item.category === "Standard")?.quantity ?? 0;
    const vip = rows.find(item => item.category === "VIP")?.quantity ?? 0;

    return {
      peripheral_type: peripheralType,
      standard,
      vip,
      total: standard + vip
    };
  });


  /* =====================================================
     05 — SPARE ITEMS
     ===================================================== */

  const spareRows = getSpareRows();


  /* =====================================================
     06 — SIGN-OFF
     ===================================================== */

 return {
    date: new Date().toLocaleDateString('en-PH', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }),

    games,
    defects,
    noDefectPcs,

    inventory,

    spareKeyboard:
      spareRows.find(row => row.item_type === "Keyboard")?.quantity,

    spareMouse:
      spareRows.find(row => row.item_type === "Mouse")?.quantity,

    spareHeadset:
      spareRows.find(row => row.item_type === "Headset")?.quantity,

    sparePowerCord:
      spareRows.find(row => row.item_type === "Power Cord")?.quantity,

    followUp:
      getValue("followUpReport"),

    changes:
      getValue("changes"),

    adminName:
      getValue("adminName"),

    techName:
      getValue("techName"),

    adminSignature:
      document
        .getElementById("adminSignature")
        ?.toDataURL?.("image/png") || "",

    techSignature:
      document
        .getElementById("techSignature")
        ?.toDataURL?.("image/png") || ""

  };

}

/* ---------------------------------------------------------
   Show Overall Report Preview
   --------------------------------------------------------- */

function showOverallReportPreview(report) {

  if (!report) return;
 
  setOverallPreviewText(
    "overallPreviewDate",
    report.date
  );


  /* =====================================================
     01 — GAMES
     ===================================================== */

  const gamesContainer =
    document.getElementById("overallPreviewGames");

  if (gamesContainer) {

    gamesContainer.innerHTML = "";

    if (!report.games || !report.games.length) {

      gamesContainer.textContent = "—";

    } else {

    report.games.forEach(game => {

  const row =
    document.createElement("div");

  row.className = "overall-preview-game";

  row.textContent = game.name;

  gamesContainer.appendChild(row);

});

    }

  }


  /* =====================================================
     02 — DEFECTIVE PERIPHERALS
     ===================================================== */

const defectsContainer =
    document.getElementById("overallPreviewDefects");

if (defectsContainer) {

  defectsContainer.innerHTML = "";

  if (!report.defects || !report.defects.length) {

    defectsContainer.textContent = "—";

  } else {

    const grouped = {};

    report.defects.forEach(defect => {

      if (!grouped[defect.pc]) {
        grouped[defect.pc] = {
          tier: defect.tier,
          defects: []
        };
      }

      grouped[defect.pc].defects.push(defect);

    });

    Object.entries(grouped).forEach(([pc, data]) => {

      const card = document.createElement("div");
      card.className = "overall-defect-pc-card";

      const header = document.createElement("div");
      header.className = "overall-defect-pc-header";

      const pcName = document.createElement("strong");
      pcName.textContent = pc;

      const tier = document.createElement("span");
      tier.textContent = data.tier;

      header.appendChild(pcName);
      header.appendChild(tier);

      const defectList = document.createElement("div");
      defectList.className = "overall-defect-list";

      data.defects.forEach(defect => {

        const defectItem = document.createElement("div");
        defectItem.className = "overall-defect-item";

        const type = document.createElement("strong");
        type.textContent = defect.type;

        defectItem.appendChild(type);

        if (defect.note) {

          const note = document.createElement("span");
          note.textContent = defect.note;

          defectItem.appendChild(note);

        }

        defectList.appendChild(defectItem);

      });

      card.appendChild(header);
      card.appendChild(defectList);

      defectsContainer.appendChild(card);

    });

  }
}
  


  /* =====================================================
     03 — PC STATUS
     ===================================================== */

  setOverallPreviewList(
    "overallPreviewNoDefectPcs",
    report.noDefectPcs
  );


  /* =====================================================
     04 — INVENTORY
     ===================================================== */

const inventoryContainer =
    document.getElementById("overallPreviewInventory");

if (inventoryContainer) {

  inventoryContainer.innerHTML = "";

  if (!report.inventory || !report.inventory.length) {

    inventoryContainer.textContent = "—";

  } else {

    report.inventory.forEach(item => {

      const card = document.createElement("div");
      card.className = "overall-inventory-card";

      const title = document.createElement("strong");
      title.textContent = item.peripheral_type;
      card.appendChild(title);

      const counts = document.createElement("div");
      counts.className = "overall-inventory-counts";

      [
        ["Standard", item.standard],
        ["VIP", item.vip],
        ["Total", item.total]
      ].forEach(([label, value]) => {
        const count = document.createElement("div");
        const labelEl = document.createElement("span");
        const valueEl = document.createElement("b");

        labelEl.textContent = label;
        valueEl.textContent = String(value ?? 0);

        count.appendChild(labelEl);
        count.appendChild(valueEl);
        counts.appendChild(count);
      });

      card.appendChild(counts);
      inventoryContainer.appendChild(card);

    });

  }
}

  /* =====================================================
     05 — SPARE ITEMS
     ===================================================== */

  setOverallPreviewText(
    "overallPreviewSpareKeyboard",
    report.spareKeyboard
  );

  setOverallPreviewText(
    "overallPreviewSpareMouse",
    report.spareMouse
  );

  setOverallPreviewText(
    "overallPreviewSpareHeadset",
    report.spareHeadset
  );

  setOverallPreviewText(
    "overallPreviewSparePowerCord",
    report.sparePowerCord
  );


  setOverallPreviewText(
    "overallPreviewFollowUp",
    report.followUp
  );


  setOverallPreviewText(
    "overallPreviewChanges",
    report.changes
  );


  /* =====================================================
     06 — SIGN-OFF
     ===================================================== */

  setOverallPreviewText(
    "overallPreviewAdminName",
    report.adminName
  );

  setOverallPreviewText(
    "overallPreviewTechName",
    report.techName
  );


  const adminSignature =
    document.getElementById(
      "overallPreviewAdminSignature"
    );

  if (adminSignature) {

    adminSignature.src =
      report.adminSignature || "";

    adminSignature.style.display =
      report.adminSignature
        ? "block"
        : "none";

  }


  const techSignature =
    document.getElementById(
      "overallPreviewTechSignature"
    );

  if (techSignature) {

    techSignature.src =
      report.techSignature || "";

    techSignature.style.display =
      report.techSignature
        ? "block"
        : "none";

  }


  /* =====================================================
     OPEN PREVIEW
     ===================================================== */

  openOverallPreview();

}
