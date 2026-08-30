
// /**
//  * Saves the current state of our room database to the device's LocalStorage.
//  */
// function saveStateToLocalStorage() {
//   localStorage.setItem('hk_rooms_state', JSON.stringify(roomsData));
// };

// let currentStaffId = "STF-001";

// // Stores active live alerts waiting to be seen on dashboards
// // let notificationsQueue = JSON.parse(localStorage.getItem('hk_notifications')) || [];

// // Stores the permanent historical audit trail records
// // let auditHistoryLogs = JSON.parse(localStorage.getItem('hk_audit_history')) || [];


// // ==========================================
// //  SELECT ALL IMPORTANT DOM ELEMENTS
// // ==========================================

// // The Screens (Views)
// const roleView = document.getElementById('role-view');
// const housekeeperView = document.getElementById('housekeeper-view');
// const frontdeskView = document.getElementById('frontdesk-view');

// // The Action Buttons
// const btnHousekeeper = document.getElementById('btn-housekeeper');
// const btnFrontdesk = document.getElementById('btn-frontdesk');
// const logoutButtons = document.querySelectorAll('.back-btn'); // Selects both logout buttons



// ==========================================
// 1. SUPABASE CLOUD DATABASE CONFIGURATION
// ==========================================
const SUPABASE_URL = "https://zguajnifwgksqzrxlycr.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpndWFqbmlmd2drc3F6cnhseWNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwMzg4MjMsImV4cCI6MjEwMzYxNDgyM30.yFqTLgkHoxck6C-x9R8ywpp1U3hE3gHUo-_CbPHqWX8";
// Initialise the client using the local library variable object
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let roomsData = [];
let usersRegistry = [];
let notificationsQueue = [];
let auditHistoryLogs = [];

let authenticatedUser = null;
let pendingCleanRoomId = null;
let activeModalRoomId = null;
let globalTimersMap = {};

// DOM SELECTORS
const roleView = document.getElementById('role-view');
const housekeeperView = document.getElementById('housekeeper-view');
const frontdeskView = document.getElementById('frontdesk-view');
const historyView = document.getElementById('history-view');
const managerDeckView = document.getElementById('manager-deck-view');

const staffIdInput = document.getElementById('staff-id-input');
const hkRoomsContainer = document.getElementById('housekeeper-rooms-container');
const fdGridContainer = document.getElementById('frontdesk-grid-container');
const historyLogsContainer = document.getElementById('history-logs-container');
const hkNotificationFeed = document.getElementById('housekeeper-notification-feed');
const fdNotificationFeed = document.getElementById('frontdesk-notification-feed');
const navManagerDeckBtn = document.getElementById('nav-manager-deck-btn');

function commitToStorage() {
  localStorage.setItem('hk_rooms', JSON.stringify(roomsData));
  localStorage.setItem('hk_users', JSON.stringify(usersRegistry));
  localStorage.setItem('hk_notifs', JSON.stringify(notificationsQueue));
  localStorage.setItem('hk_audit', JSON.stringify(auditHistoryLogs));
}

// ==========================================
// 1.5 LIVE SYNC CLOUD FETCH DATA CHANNELS
// ==========================================
async function loadInitialCloudData() {
  try {
    console.log("Connecting to live Supabase cloud tables...");

    const { data: rooms, error: roomError } = await supabaseClient
      .from('rooms')
      .select('*');
      
    if (roomError) throw roomError;
    roomsData = rooms || [];

    const { data: users, error: userError } = await supabaseClient
      .from('users')
      .select('*');
      
    if (userError) throw userError;
    usersRegistry = users || [];

    console.log("⚡ Supabase Cloud connection healthy! Data arrays loaded.");
    
    roomsData.forEach(room => {
      if (room.status === 'in-use' && room.timerEnd) {
        if (room.timerEnd <= Date.now()) {
          room.status = 'dirty';
          room.timerEnd = null;
        } else {
          runTimerClockLoop(room);
        }
      }
    });

  } catch (err) {
    console.error("❌ Cloud sync execution failure:", err.message);
    alert("Database connection error: " + err.message + "\nOperating on local fallback templates.");
    
    const defaultRooms = [
      { id: "Room 101", status: "dirty", timerEnd: null, isChecked: false, dirtyTimestamp: Date.now(), lastCleanedBy: null },
      { id: "Room 102", status: "clean", timerEnd: null, isChecked: false, dirtyTimestamp: null, lastCleanedBy: "MGR-001" },
      { id: "Room 103", status: "dirty", timerEnd: null, isChecked: false, dirtyTimestamp: Date.now(), lastCleanedBy: null }
    ];
    roomsData = JSON.parse(localStorage.getItem('hk_rooms')) || defaultRooms;
  }
}

// ==========================================
// 2. VIEW ROUTER & NAVIGATION
// ==========================================
function showView(target) {
  [roleView, housekeeperView, frontdeskView, historyView, managerDeckView].forEach(v => v.classList.add('hidden'));
  target.classList.remove('hidden');
  
  if (target === housekeeperView) { 
    renderHousekeeperView(); 
    renderNotifications(); 
  }
  if (target === frontdeskView) {
    renderFrontDeskView(); 
    renderNotifications();
    if (authenticatedUser.level === "000" || authenticatedUser.level === "001") {
      navManagerDeckBtn.classList.remove('hidden');
    } else {
      navManagerDeckBtn.classList.add('hidden');
    }
  }
  if (target === historyView) renderAuditHistory();
  if (target === managerDeckView) renderManagerDeck();
}

// ==========================================
// 3. SECURE BULLETPROOF CLOUD LOGIN GATEWAY
// ==========================================
async function loginGateway(targetDashboard) {
  const id = staffIdInput.value.trim().toUpperCase();
  
  if (!id) return alert("⚠️ Please enter your Staff ID to clock in.");

  try {
    console.log(`Querying cloud database for Staff ID: ${id}...`);

    const { data: user, error } = await supabaseClient
      .from('users')
      .select('*')
      .eq('staff_id', id)
      .maybeSingle();

    let authenticatedProfile = user;

    if (!authenticatedProfile) {
      console.log("Profile not found in cloud table. Checking local backup arrays...");
      const localBackupUsers = [
        { staff_id: "DEV-001", name: "Developer Admin", level: "000", sub_role: "admin" },
        { staff_id: "MGR-001", name: "Hotel Manager", level: "001", sub_role: "manager" },
        { staff_id: "FD-001", name: "Front Desk Staff", level: "003", sub_role: "front-desk" }
      ];
      
      const localMatch = localBackupUsers.find(u => u.staff_id === id);
      if (localMatch) {
        authenticatedProfile = localMatch;
      }
    }

    if (!authenticatedProfile) {
      return alert(`❌ Access Denied: Staff ID "${id}" was not found in your Supabase 'users' table or local backup registries.`);
    }

    authenticatedUser = authenticatedProfile;
    
    const userRole = authenticatedProfile.sub_role || authenticatedProfile.subRole;
    const userLevel = authenticatedProfile.level;

    if (targetDashboard === 'housekeeper') {
      if (userLevel === "000" || userRole === "housekeeper") {
        showView(housekeeperView);
      } else {
        alert("🔒 Security Error: Your account tier cannot access the Housekeeper terminal.");
      }
    } else {
      if (userLevel !== "003" || userRole === "front-desk") {
        showView(frontdeskView);
      } else {
        alert("🔒 Security Error: Access restricted to Front Desk, Supervisors, and Managers.");
      }
    }

  } catch (catchErr) {
    console.error("Critical JavaScript Runtime Crash:", catchErr);
    alert(`💥 System Entry Failure: ${catchErr.message}`);
  }
}

document.getElementById('btn-housekeeper').addEventListener('click', () => loginGateway('housekeeper'));
document.getElementById('btn-frontdesk').addEventListener('click', () => loginGateway('frontdesk'));

document.querySelectorAll('.logout-trigger').forEach(b => {
  b.addEventListener('click', () => { 
    authenticatedUser = null; 
    staffIdInput.value = ""; 
    showView(roleView); 
  });
});

// ==========================================
// 4. RENDERING ENGINE FUNCTIONS
// ==========================================
function renderHousekeeperView() {
  hkRoomsContainer.innerHTML = "";
  roomsData.forEach(room => {
    const div = document.createElement('div');
    div.className = 'room-card';
    const isDirty = room.status === 'dirty';
    const btnText = room.status === 'clean' ? 'Cleaned ✓' : (room.status === 'in-use' ? 'Occupied' : 'Mark Clean');
    
    div.innerHTML = `<span>${room.id}</span><button class="status-btn ${room.status}" ${!isDirty ? 'disabled' : ''}>${btnText}</button>`;
    
    div.querySelector('button').addEventListener('click', () => {
      pendingCleanRoomId = room.id;
      document.getElementById('confirm-modal-room-label').innerText = `Room: ${room.id}`;
      document.getElementById('clean-confirm-modal').classList.remove('hidden');
    });
    hkRoomsContainer.appendChild(div);
  });
}

function renderFrontDeskView() {
  fdGridContainer.innerHTML = "";
  roomsData.forEach(room => {
    const card = document.createElement('div');
    card.className = `fd-card ${room.status}`;
    let tSnippet = '';
    
    if (room.status === 'in-use' && room.timerEnd) {
      const left = Math.max(0, Math.round((room.timerEnd - Date.now()) / 1000));
      tSnippet = `<div class="timer-display" id="timer-text-${room.id.replace(/\s+/g, '')}">⏳ Auto-Dirty: ${left}s</div>`;
    }
    
    card.innerHTML = `
      <div class="fd-header"><span>${room.id}</span><input type="checkbox" class="fd-checkbox" ${room.isChecked ? 'checked' : ''}></div>
      <div>Status: <strong>${room.status.toUpperCase()}</strong></div>
      ${tSnippet}
      ${room.status === 'clean' ? `<button class="fd-action-btn">Set Short Stay</button>` : ''}
    `;
    
    card.querySelector('.fd-checkbox').addEventListener('change', (e) => { 
      room.isChecked = e.target.checked; 
      commitToStorage(); 
    });
    
    if (room.status === 'clean') {
      card.querySelector('.fd-action-btn').addEventListener('click', () => {
        activeModalRoomId = room.id;
        document.getElementById('modal-room-label').innerText = `Room: ${room.id}`;
        document.getElementById('timer-modal').classList.remove('hidden');
      });
    }
    fdGridContainer.appendChild(card);
  });
}

function renderNotifications() {
  hkNotificationFeed.innerHTML = ""; 
  fdNotificationFeed.innerHTML = "";
  
  notificationsQueue.forEach(n => {
    const b = document.createElement('div');
    b.className = `notif-banner ${n.type === 'ROOM_DIRTY' ? 'danger-alert' : ''}`;
    b.innerHTML = `<div><p><strong>${n.message}</strong></p><span class="notif-time">⏱️ ${new Date(n.timestamp).toLocaleTimeString()}</span></div><button class="notif-dismiss-btn">×</button>`;
    
    b.querySelector('button').addEventListener('click', () => {
      notificationsQueue = notificationsQueue.filter(x => x.id !== n.id); 
      commitToStorage(); 
      renderNotifications();
    });
    
    if (n.recipients.includes('housekeeper')) hkNotificationFeed.appendChild(b.cloneNode(true));
    if (n.recipients.includes('frontdesk')) fdNotificationFeed.appendChild(b);
  });
  hkNotificationFeed.querySelectorAll('.notif-dismiss-btn').forEach((btn, idx) => {
    btn.addEventListener('click', () => {
      const targetNotif = notificationsQueue.filter(x => x.recipients.includes('housekeeper'))[idx];
      if (targetNotif) {
        notificationsQueue = notificationsQueue.filter(x => x.id !== targetNotif.id);
        commitToStorage();
        renderNotifications();
      }
    });
  });
}

// ==========================================
// 5. OPERATIONAL EVENT CONTROLLERS
// ==========================================
document.getElementById('btn-close-clean-modal').addEventListener('click', () => {
  document.getElementById('clean-confirm-modal').classList.add('hidden');
});

document.getElementById('btn-submit-clean-notif').addEventListener('click', () => {
  const room = roomsData.find(r => r.id === pendingCleanRoomId);
  if (room) {
    const turnMs = room.dirtyTimestamp ? (Date.now() - room.dirtyTimestamp) : 0;
    room.status = 'clean';
    room.dirtyTimestamp = null;
    room.lastCleanedBy = authenticatedUser.staffId;
    let recips = ['frontdesk'];
    if (document.getElementById('notify-sup').checked) recips.push('supervisor');
    if (document.getElementById('notify-mgr').checked) recips.push('manager');
    
    notificationsQueue.push({
      id: "N-" + Date.now(),
      room: room.id,
      type: "ROOM_CLEAN",
      message: `✅ ${room.id} is CLEAN and inspected.`,
      senderId: authenticatedUser.staffId,
      timestamp: Date.now(),
      recipients: recips
    });
    
    auditHistoryLogs.push({
      id: "L-" + Date.now(),
      dateString: new Date().toLocaleDateString('en-GB'),
      timestamp: Date.now(),
      staffId: authenticatedUser.staffId,
      action: "MARKED_CLEAN",
      room: room.id,
      details: `Turnaround: ${Math.round(turnMs / 1000)}s`
    });
    
    commitToStorage();
    document.getElementById('clean-confirm-modal').classList.add('hidden');
    document.getElementById('notify-sup').checked = false;
    document.getElementById('notify-mgr').checked = false;
    renderHousekeeperView();
  }
});

document.getElementById('btn-cancel-modal').addEventListener('click', () => {
  document.getElementById('timer-modal').classList.add('hidden');
});

document.getElementById('btn-confirm-timer').addEventListener('click', () => {
  const hrs = Math.min(12, Math.max(1, parseInt(document.getElementById('stay-hours').value) || 2));
  const room = roomsData.find(r => r.id === activeModalRoomId);
  if (room) {
    room.status = 'in-use';
    room.timerEnd = Date.now() + (hrs * 5000);
    commitToStorage();
    document.getElementById('timer-modal').classList.add('hidden');
    runTimerClockLoop(room);
    renderFrontDeskView();
  }
});

function runTimerClockLoop(room) {
  if (globalTimersMap[room.id]) clearInterval(globalTimersMap[room.id]);
  globalTimersMap[room.id] = setInterval(() => {
    const diff = room.timerEnd - Date.now();
    if (diff <= 0) {
      clearInterval(globalTimersMap[room.id]);
      delete globalTimersMap[room.id];
      room.status = 'dirty';
      room.timerEnd = null;
      room.dirtyTimestamp = Date.now();
      
      notificationsQueue.push({
        id: "N-" + Date.now(),
        room: room.id,
        type: "ROOM_DIRTY",
        message: `🚨 Short Stay Expired: ${room.id} is DIRTY.`,
        senderId: "SYSTEM",
        timestamp: Date.now(),
        recipients: ['frontdesk', 'housekeeper']
      });
      
      auditHistoryLogs.push({
        id: "L-" + Date.now(),
        dateString: new Date().toLocaleDateString('en-GB'),
        timestamp: Date.now(),
        staffId: "SYSTEM",
        action: "TIMER_EXPIRED",
        room: room.id,
        details: "Auto-flipped dirty."
      });
      
      commitToStorage();
      if (!frontdeskView.classList.contains('hidden')) {
        renderFrontDeskView();
        renderNotifications();
      }
      if (!housekeeperView.classList.contains('hidden')) {
        renderHousekeeperView();
        renderNotifications();
      }
    } else {
      const txt = document.getElementById(`timer-text-${room.id.replace(/\s+/g, '')}`);
      if (txt) txt.innerText = `⏳ Auto-Dirty: ${Math.round(diff / 1000)}s`;
    }
  }, 1000);
}

// BULK COMMANDS
document.getElementById('btn-all-dirty').addEventListener('click', () => {
  roomsData.forEach(r => {
    r.status = 'dirty';
    r.isChecked = false;
    r.timerEnd = null;
    r.dirtyTimestamp = Date.now();
    if (globalTimersMap[r.id]) clearInterval(globalTimersMap[r.id]);
  });
  commitToStorage();
  renderFrontDeskView();
});

document.getElementById('btn-bulk-dirty').addEventListener('click', () => {
  let marked = [];
  roomsData.forEach(r => {
    if (r.isChecked) {
      r.status = 'dirty';
      r.isChecked = false;
      r.timerEnd = null;
      r.dirtyTimestamp = Date.now();
      if (globalTimersMap[r.id]) clearInterval(globalTimersMap[r.id]);
      marked.push(r.id);
    }
  });
  if (marked.length > 0) {
    notificationsQueue.push({
      id: "N-" + Date.now(),
      room: marked.join(','),
      type: "ROOM_DIRTY",
      message: `❌ FD flagged dirty: ${marked.join(',')}`,
      senderId: authenticatedUser.staffId,
      timestamp: Date.now(),
      recipients: ['housekeeper', 'frontdesk']
    });
    commitToStorage();
    renderFrontDeskView();
    renderNotifications();
  }
});

document.getElementById('btn-clear-hk-notifs').addEventListener('click', () => {
  notificationsQueue = notificationsQueue.filter(n => !n.recipients.includes('housekeeper'));
  commitToStorage();
  renderNotifications();
});

document.getElementById('btn-clear-fd-notifs').addEventListener('click', () => {
  notificationsQueue = notificationsQueue.filter(n => !n.recipients.includes('frontdesk'));
  commitToStorage();
  renderNotifications();
});

// ==========================================
// 6. HISTORICAL PERFORMANCE LOGS
// ==========================================
document.querySelectorAll('.nav-history-btn').forEach(b => b.addEventListener('click', () => showView(historyView)));

document.getElementById('btn-back-from-history').addEventListener('click', () => {
  showView(authenticatedUser.subRole === 'housekeeper' ? housekeeperView : frontdeskView);
});

const fDate = document.getElementById('filter-date');
const fStaff = document.getElementById('filter-staff');

fDate.addEventListener('input', renderAuditHistory);
fStaff.addEventListener('input', renderAuditHistory);

function renderAuditHistory() {
  historyLogsContainer.innerHTML = "";
  document.getElementById('history-tier-label').innerText = `Staff: ${authenticatedUser.name} (${authenticatedUser.staffId}) | Level ${authenticatedUser.level}`;
  let logs = [];
  if (["000", "001", "002"].includes(authenticatedUser.level)) {
    logs = [...auditHistoryLogs];
    document.getElementById('management-filters').classList.remove('hidden');
  } else {
    logs = auditHistoryLogs.filter(l => l.staffId === authenticatedUser.staffId);
    document.getElementById('management-filters').classList.add('hidden');
  }
  if (fDate.value.trim()) logs = logs.filter(l => l.dateString.includes(fDate.value.trim()));
  if (fStaff.value.trim()) logs = logs.filter(l => l.staffId.includes(fStaff.value.trim().toUpperCase()));
  logs.sort((a, b) => b.timestamp - a.timestamp);
  let currentD = "";
  logs.forEach(l => {
    if (l.dateString !== currentD) {
      currentD = l.dateString;
      const h = document.createElement('div');
      h.className = 'date-group-header';
      h.innerText = `📆 Date: ${currentD}`;
      historyLogsContainer.appendChild(h);
    }
    const div = document.createElement('div');
    div.className = `audit-log-card ${l.action}`;
    div.innerHTML = `<div class="log-meta"><span>🕒 ${new Date(l.timestamp).toLocaleTimeString()}</span><span>ID: ${l.staffId}</span></div><strong>${l.action} -> ${l.room}</strong><div style="font-size:0.75rem; color:#495057;">${l.details}</div>`;
    historyLogsContainer.appendChild(div);
  });
}

// ==========================================
// 7. MANAGER DECK CONTROLLER PANEL
// ==========================================
navManagerDeckBtn.addEventListener('click', () => showView(managerDeckView));

document.getElementById('btn-back-from-manager').addEventListener('click', () => showView(frontdeskView));

document.getElementById('btn-add-room').addEventListener('click', () => {
  const nm = document.getElementById('new-room-id').value.trim();
  if (!nm || roomsData.some(r => r.id.toLowerCase() === nm.toLowerCase())) return alert("Invalid or Duplicate Room.");
  roomsData.push({
    id: nm,
    status: "dirty",
    timerEnd: null,
    isChecked: false,
    dirtyTimestamp: Date.now(),
    lastCleanedBy: null
  });
  commitToStorage();
  document.getElementById('new-room-id').value = "";
  renderManagerDeck();
});

document.getElementById('btn-add-staff').addEventListener('click', () => {
  const id = document.getElementById('new-staff-id').value.trim().toUpperCase();
  const name = document.getElementById('new-staff-name').value.trim();
  const role = document.getElementById('new-staff-role').value;
  if (!id || !name || usersRegistry.some(u => u.staffId === id)) return alert("Invalid or 
Duplicate Staff ID.");
  let lvl = "003";
  if (role === 'manager') lvl = "001";
  if (role === 'supervisor') lvl = "002";
  if (role === 'manager' && usersRegistry.filter(u => u.level === '001').length >= 3) return alert("Max 3 Managers allowed.");
  if (role === 'front-desk' && usersRegistry.some(u => u.subRole === 'front-desk')) return alert("Only 1 Front Desk account allowed.");
  
  usersRegistry.push({ staffId: id, name: name, level: lvl, subRole: role });
  commitToStorage();
  document.getElementById('new-staff-id').value = "";
  document.getElementById('new-staff-name').value = "";
  renderManagerDeck();
});

function renderManagerDeck() {
  managerRoomsList.innerHTML = "";
  managerStaffList.innerHTML = "";
  
  roomsData.forEach(r => {
    const d = document.createElement('div');
    d.className = 'config-item-row';
    d.innerHTML = `<span>🏨 ${r.id}</span><button class="config-delete-btn">Remove</button>`;
    d.querySelector('button').addEventListener('click', () => {
      roomsData = roomsData.filter(x => x.id !== r.id);
      if (globalTimersMap[r.id]) clearInterval(globalTimersMap[r.id]);
      commitToStorage();
      renderManagerDeck();
    });
    managerRoomsList.appendChild(d);
  });
  
  usersRegistry.forEach(u => {
    const d = document.createElement('div');
    d.className = 'config-item-row';
    const delBtn = u.level === "000" ? `<span>System Admin</span>` : `<button class="config-delete-btn">Revoke</button>`;
    d.innerHTML = `<span>👤 [Lvl ${u.level}] ${u.name}</span>${delBtn}`;
    if (u.level !== "000") {
      d.querySelector('button').addEventListener('click', () => {
        usersRegistry = usersRegistry.filter(x => x.staffId !== u.staffId);
        commitToStorage();
        renderManagerDeck();
      });
    }
    managerStaffList.appendChild(d);
  });
}

// AUTOMATIC TIMERS RESTORATION RUNS ON STARTUP
roomsData.forEach(room => {
  if (room.status === 'in-use' && room.timerEnd) {
    if (room.timerEnd <= Date.now()) {
      room.status = 'dirty';
      room.timerEnd = null;
    } else {
      runTimerClockLoop(room);
    }
  }
});

commitToStorage();

// INITIAL LOADING INVOCATION
loadInitialCloudData();
