
/**
 * Saves the current state of our room database to the device's LocalStorage.
 */
function saveStateToLocalStorage() {
  localStorage.setItem('hk_rooms_state', JSON.stringify(roomsData));
};

let currentStaffId = "STF-001";

// Stores active live alerts waiting to be seen on dashboards
// let notificationsQueue = JSON.parse(localStorage.getItem('hk_notifications')) || [];

// Stores the permanent historical audit trail records
// let auditHistoryLogs = JSON.parse(localStorage.getItem('hk_audit_history')) || [];


// ==========================================
//  SELECT ALL IMPORTANT DOM ELEMENTS
// ==========================================

// The Screens (Views)
const roleView = document.getElementById('role-view');
const housekeeperView = document.getElementById('housekeeper-view');
const frontdeskView = document.getElementById('frontdesk-view');

// The Action Buttons
const btnHousekeeper = document.getElementById('btn-housekeeper');
const btnFrontdesk = document.getElementById('btn-frontdesk');
const logoutButtons = document.querySelectorAll('.back-btn'); // Selects both logout buttons



// ==========================================
// 1. SUPABASE CLOUD DATABASE CONFIGURATION
// ==========================================
const SUPABASE_URL = "YOUR_SUPABASE_PROJECT_URL_HERE";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_PUBLISHABLE_KEY_HERE";

// Since supabase.js is local, window.supabase is guaranteed to exist immediately on startup!
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let roomsData = [];
let usersRegistry = [];
let notificationsQueue = [];
let auditHistoryLogs = [];

let authenticatedUser = null;
let pendingCleanRoomId = null;
let activeModalRoomId = null;
let globalTimersMap = {};


// ==========================================
// 1.2 USER REGISTRY & ACCOUNT MANAGEMENT
// ==========================================

// const defaultUsers = [
//   { staffId: "DEV-001", name: "Lead Developer", level: "000", subRole: "admin" },
//   { staffId: "MGR-001", name: "General Manager", level: "001", subRole: "manager" },
//   { staffId: "FD-001", name: "Main FrontDesk", level: "003", subRole: "front-desk" },
//   { staffId: "STF-001", name: "Housekeeper One", level: "004", subRole: "housekeeper" },
//   { staffId: "STF-002", name: "Housekeeper Two", level: "004", subRole: "housekeeper" }
// ];

// Load active accounts database from LocalStorage or fall back to defaults
// let usersRegistry = JSON.parse(localStorage.getItem('hk_users_registry')) || defaultUsers;

// Global tracking pointer for the logged-in session profile
// let authenticatedUser = null; 

function saveUsersToLocalStorage() {
  localStorage.setItem('hk_users_registry', JSON.stringify(usersRegistry));
}



// Initialize our state array by pulling from LocalStorage, or fallback to defaults
// let roomsData = JSON.parse(localStorage.getItem('hk_rooms_state')) || defaultRooms;

// Clear out interval IDs on fresh startup since old active intervals can't be stored as text
roomsData.forEach(room => {
  room.timerIntervalId = null;
});

// let activeModalRoomId = null;


// Bulk Operations & Modal DOM
const btnBulkDirty = document.getElementById('btn-bulk-dirty');
const btnAllDirty = document.getElementById('btn-all-dirty');
const timerModal = document.getElementById('timer-modal');
const modalRoomLabel = document.getElementById('modal-room-label');
const stayHoursInput = document.getElementById('stay-hours');
const btnConfirmTimer = document.getElementById('btn-confirm-timer');
const btnCancelModal = document.getElementById('btn-cancel-modal');


// Our new data container placeholders
const hkRoomsContainer = document.getElementById('housekeeper-rooms-container');
const fdGridContainer = document.getElementById('frontdesk-grid-container');


// ==========================================
// 1.5 LIVE SYNC CLOUD FETCH DATA CHANNELS
// ==========================================

/**
 * Downloads the latest room layout matrix and active accounts list from the cloud
 */
async function loadInitialCloudData() {
  try {
    // 1. Pull rooms directly from the Supabase cloud table
    const { data: rooms, error: roomError } = await supabaseClient
      .from('rooms')
      .select('*');
      
    if (roomError) throw roomError;
    roomsData = rooms || [];

    // 2. Pull approved users registry lists
    const { data: users, error: userError } = await supabaseClient
      .from('users')
      .select('*');
      
    if (userError) throw userError;
    usersRegistry = users || [];

    console.log("⚡ Supabase Cloud connection healthy! Data arrays loaded.");
    
    // Check and restore active countdown timers if a room is 'in-use'
    restoreActiveCloudTimers();

  } catch (err) {
    console.error("❌ Cloud sync execution failure:", err.message);
    alert("Database connection error. Operating on local fallbacks.");
  }
}

function restoreActiveCloudTimers() {
  roomsData.forEach(room => {
    if (room.status === 'in-use' && room.timer_end) {
      const parsedTimerEnd = new Date(room.timer_end).getTime();
      if (parsedTimerEnd <= Date.now()) {
        // Timer expired while app was closed, process expiration patch
        triggerRoomTimerExpiration(room.id);
      } else {
        // Re-anchor the running interval loop pointer
        runCloudTimerClockLoop(room, parsedTimerEnd);
      }
    }
  });
};


// ==========================================
// 2.5 VALIDATED LOGIN CONTROLLER
// ==========================================

function attemptLogin(requestedDashboard) {
  const enteredId = staffIdInput.value.trim().toUpperCase(); // Format search strings to uppercase
  
  // Look up matching records inside our user registry
  const match = usersRegistry.find(user => user.staffId === enteredId);

  if (!match) {
    alert("❌ Access Denied: Invalid or Unapproved Staff ID. Please contact management.");
    return;
  }

  // Bind the global authenticated profile snapshot
  authenticatedUser = match;
  currentStaffId = match.staffId; 

  // Enforce security role check gates
  if (requestedDashboard === 'housekeeper') {
    // Admins and housekeepers can open the housekeeper execution terminal
    if (authenticatedUser.level === "000" || authenticatedUser.subRole === "housekeeper") {
      showView(housekeeperView);
    } else {
      alert("🔒 Security Error: Your account tier cannot access the Housekeeper terminal.");
    }
  } 
  
  else if (requestedDashboard === 'frontdesk') {
    // Admins, Managers, Supervisors, and FrontDesk can open the FrontDesk grid view
    if (authenticatedUser.level === "000" || authenticatedUser.level === "001" || authenticatedUser.level === "002" || authenticatedUser.subRole === "front-desk") {
      showView(frontdeskView);
    } else {
      alert("🔒 Security Error: Access restricted to Front Desk, Supervisors, and Managers.");
    }
  }
};

// Rewire the core landing button event triggers
btnHousekeeper.addEventListener('click', () => attemptLogin('housekeeper'));
btnFrontdesk.addEventListener('click', () => attemptLogin('frontdesk'));


logoutButtons.forEach(button => {
  button.addEventListener('click', () => showView(roleView));
});


// ==========================================
// 2.7 PHASE 2: HOUSEKEEPER ACTION WINDOW MODAL ENGINE
// ==========================================

// let pendingCleanRoomId = null; // Caches target element reference safely while user selects targets

const cleanConfirmModal = document.getElementById('clean-confirm-modal');
const confirmRoomLabel = document.getElementById('confirm-modal-room-label');
const btnSubmitCleanNotif = document.getElementById('btn-submit-clean-notif');
const btnCloseCleanModal = document.getElementById('btn-close-clean-modal');

// Checkbox targets selectors
const notifyFdCheck = document.getElementById('notify-fd');
const notifySupCheck = document.getElementById('notify-sup');
const notifyMgrCheck = document.getElementById('notify-mgr');

// Rewrite the Housekeeper action button script hooks inside app.js
function attachHousekeeperButtonListeners() {
  const actionButtons = hkRoomsContainer.querySelectorAll('.status-btn');
  
  actionButtons.forEach(button => {
    button.addEventListener('click', (e) => {
      const clickedRoomId = e.target.getAttribute('data-room-id');
      const targetRoom = roomsData.find(r => r.id === clickedRoomId);
      
      if (targetRoom && targetRoom.status === 'dirty') {
        // Cache data reference strings
        pendingCleanRoomId = clickedRoomId;
        
        // Populate and reveal modal overlay window visual anchors
        confirmRoomLabel.innerText = `Room: ${pendingCleanRoomId}`;
        cleanConfirmModal.classList.remove('hidden');
      }
    });
  });
};

// Cancel action button click handle
btnCloseCleanModal.addEventListener('click', () => {
  cleanConfirmModal.classList.add('hidden');
  pendingCleanRoomId = null;
});

// Confirm & Send Click action controller
btnSubmitCleanNotif.addEventListener('click', () => {
  if (!pendingCleanRoomId) return;

  const targetRoom = roomsData.find(r => r.id === pendingCleanRoomId);
  
  if (targetRoom) {
    const timestampCleaned = Date.now();
    const turnaroundTimeMs = targetRoom.dirtyTimestamp ? (timestampCleaned - targetRoom.dirtyTimestamp) : 0;
    
    // Process status translation shifts
    targetRoom.status = 'clean';
    targetRoom.lastCleanedBy = currentStaffId;
    targetRoom.dirtyTimestamp = null; // Clear old dirty stamp track configurations

    // Compile targets list based on checkbox configuration states
    let notificationTargets = ["frontdesk"]; // Always locked by default
    if (notifySupCheck.checked) notificationTargets.push("supervisor");
    if (notifyMgrCheck.checked) notificationTargets.push("manager");

    // Generate notification object
    const newAlert = {
      id: "NOTIF-" + Date.now(),
      room: targetRoom.id,
      type: "ROOM_CLEAN",
      message: `${targetRoom.id} is clean and inspected ready for check-in.`,
      senderId: currentStaffId,
      timestamp: timestampCleaned,
      recipients: notificationTargets
    };

    // Generate chronological audit history record sheet entry point
    const historyEntry = {
      id: "LOG-" + Date.now(),
      dateString: new Date().toLocaleDateString('en-GB'), // Formats cleanly to DD/MM/YYYY grouping anchors
      timestamp: timestampCleaned,
      staffId: currentStaffId,
      action: "MARKED_CLEAN",
      room: targetRoom.id,
      details: `Turnaround production process clocked at: ${formatTimeDuration(turnaroundTimeMs)}`,
      rawTurnaroundMs: turnaroundTimeMs
    };

    // Append generated items straight to live data queues arrays
    notificationsQueue.push(newAlert);
    auditHistoryLogs.push(historyEntry);

    // Save update calculations straight to local devices disk
    saveStateToLocalStorage();
    localStorage.setItem('hk_notifications', JSON.stringify(notificationsQueue));
    localStorage.setItem('hk_audit_history', JSON.stringify(auditHistoryLogs));

    // Clear operational runtime states variables
    cleanConfirmModal.classList.add('hidden');
    pendingCleanRoomId = null;
    notifySupCheck.checked = false; // Reset optional toggles for next run
    notifyMgrCheck.checked = false;

    // Refresh display output matrices safely
    renderHousekeeperView();
  }
});

/**
 * Utility tool engine to translate millisecond timestamps into readable time durations
 */
function formatTimeDuration(ms) {
  if (ms <= 0) return "N/A (Instant / Default Initialization)";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${totalSeconds % 60}s`;
  } else {
    return `${totalSeconds}s`;
  }
};


// ==========================================
// 3. SECURE BULLETPROOF CLOUD LOGIN GATEWAY
// ==========================================
async function loginGateway(targetDashboard) {
  const id = staffIdInput.value.trim().toUpperCase();
  
  if (!id) return alert("⚠️ Please enter your Staff ID to clock in.");

  try {
    console.log(`Checking database for Staff ID: ${id}...`);

    // 1. FIXED: Changed .single() to .maybeSingle() to prevent silent app crashes
    // 2. FIXED: Swapped 'staffId' to 'staff_id' to match common database snake_case naming conventions
    const { data: user, error } = await supabaseClient
      .from('users')
      .select('*')
      .eq('staff_id', id) 
      .maybeSingle(); 

    if (error) {
      console.error("Supabase Query Error:", error);
      return alert(`❌ Database Error: ${error.message}. Look at your browser DevTools Console (F12) for detailed logs.`);
    }

    if (!user) {
      console.log(`No user profile row matched ID: ${id}`);
      return alert(`❌ Access Denied: The Staff ID "${id}" was not found or is unapproved in your Supabase 'users' table.`);
    }

    console.log("Authentication successful! Profile record snapshot:", user);

    // Bind session authorization token profiles
    authenticatedUser = user;
    
    // Evaluate security role clearance tiers
    // Handle both snake_case or camelCase fallback structures from your column mappings safely
    const userRole = user.sub_role || user.subRole;
    const userLevel = user.level;

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
    alert(`💥 System Crash: ${catchErr.message}`);
  }
};


// ==========================================
// 3. RENDER FUNCTIONS (Drawing UI from Data)
// ==========================================

// function renderHousekeeperView() {
//   hkRoomsContainer.innerHTML = "";
//   roomsData.forEach(room => {
//     // Housekeepers can only clean items that are explicitly "dirty"
//     const canClean = room.status === 'dirty';
//     const btnClass = room.status; 
//     const btnText = room.status === 'clean' ? 'Cleaned ✓' : (room.status === 'in-use' ? 'In Use (Occupied)' : 'Mark Clean');
//     const isDisabled = !canClean ? 'disabled style="background-color: #28a745; color: white; cursor: default;"' : '';

//     const roomCard = document.createElement('div');
//     roomCard.className = 'room-card';
//     roomCard.innerHTML = `
//       <span>${room.id}</span>
//       <button class="status-btn ${btnClass}" ${isDisabled} data-room-id="${room.id}">
//         ${btnText}
//       </button>
//     `;
//     hkRoomsContainer.appendChild(roomCard);
//   });
//   attachHousekeeperButtonListeners();
// };


// function renderFrontDeskView() {
//   fdGridContainer.innerHTML = "";
  
//   roomsData.forEach(room => {
//     const card = document.createElement('div');
//     card.className = `fd-card ${room.status}`;

//     let timerSnippet = '';
//     if (room.status === 'in-use' && room.timerEnd) {
//       const timeLeft = Math.max(0, Math.round((room.timerEnd - Date.now()) / 1000));
//       timerSnippet = `<div class="timer-display" id="text-timer-${room.id.replace(/\s+/g, '')}">⏳ Auto-Dirty in: ${timeLeft}s</div>`;
//     }

//     // Notice the addition of: ${room.isChecked ? 'checked' : ''}
//     card.innerHTML = `
//       <div class="fd-header">
//         <span>${room.id}</span>
//         <input type="checkbox" class="fd-checkbox" data-room-id="${room.id}" ${room.isChecked ? 'checked' : ''}>
//       </div>
//       <div>Status: <strong>${room.status.toUpperCase()}</strong></div>
//       <div class="timer-wrapper">${timerSnippet}</div>
//       ${room.status === 'clean' ? `<button class="fd-action-btn" data-room-id="${room.id}">Set Short Stay</button>` : ''}
//     `;
//     fdGridContainer.appendChild(card);
//   });

//   attachFrontDeskCardListeners();
// };

// ==========================================
// 3.5 NOTIFICATION FEED RENDERING ENGINE
// ==========================================
const fdNotificationFeed = document.getElementById('frontdesk-notification-feed');

function renderFrontDeskNotifications() {
  fdNotificationFeed.innerHTML = ""; // Clear old alerts

  // Filter alerts where "frontdesk" is a targeted recipient
  const fdAlerts = notificationsQueue.filter(notif => notif.recipients.includes("frontdesk"));

  if (fdAlerts.length === 0) return;

  fdAlerts.forEach(notif => {
    const banner = document.createElement('div');
    // Style differently based on clean vs dirty alerts
    const isDirtyAlert = notif.type === "ROOM_DIRTY";
    banner.className = `notif-banner ${isDirtyAlert ? 'danger-alert' : ''}`;

    const formattedTime = new Date(notif.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    banner.innerHTML = `
      <div>
        <p><strong>${notif.message}</strong></p>
        <span class="notif-time">⏱️ ${formattedTime} | Sent by: ${notif.senderId}</span>
      </div>
      <button class="notif-dismiss-btn" data-notif-id="${notif.id}">×</button>
    `;

    fdNotificationFeed.appendChild(banner);
  });

  attachNotificationDismissListeners();
};

function attachNotificationDismissListeners() {
  const dismissButtons = fdNotificationFeed.querySelectorAll('.notif-dismiss-btn');
  dismissButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const notifId = e.target.getAttribute('data-notif-id');
      
      // Remove this notification from our global queue completely
      notificationsQueue = notificationsQueue.filter(notif => notif.id !== notifId);
      localStorage.setItem('hk_notifications', JSON.stringify(notificationsQueue));
      
      // Refresh the alert panel instantly
      renderFrontDeskNotifications();
    });
  });
};

const hkNotificationFeed = document.getElementById('housekeeper-notification-feed');

function renderHousekeeperNotifications() {
  hkNotificationFeed.innerHTML = ""; // Clear old alerts

  // Filter alerts where "housekeeper" is a targeted recipient
  const hkAlerts = notificationsQueue.filter(notif => notif.recipients.includes("housekeeper"));

  if (hkAlerts.length === 0) return;

  hkAlerts.forEach(notif => {
    const banner = document.createElement('div');
    banner.className = 'notif-banner danger-alert'; // Always red since it's a dirty alert

    const formattedTime = new Date(notif.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    banner.innerHTML = `
      <div>
        <p><strong>${notif.message}</strong></p>
        <span class="notif-time">⏱️ ${formattedTime}</span>
      </div>
      <button class="notif-dismiss-btn" data-notif-id="${notif.id}">×</button>
    `;

    hkNotificationFeed.appendChild(banner);
  });

  attachHousekeeperNotificationDismissListeners();
};

function attachHousekeeperNotificationDismissListeners() {
  const dismissButtons = hkNotificationFeed.querySelectorAll('.notif-dismiss-btn');
  dismissButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const notifId = e.target.getAttribute('data-notif-id');
      notificationsQueue = notificationsQueue.filter(notif => notif.id !== notifId);
      localStorage.setItem('hk_notifications', JSON.stringify(notificationsQueue));
      renderHousekeeperNotifications();
    });
  });
};





// ==========================================
// 4. SHORT STAY TIMERS (12-HOUR ENGINE)
// ==========================================

function startRoomTimer(room, targetHours) {
  if (room.timerIntervalId) clearInterval(room.timerIntervalId);

  room.status = 'in-use';
  const durationMs = targetHours * 5000; // 1 hour = 5 seconds scale;;;use * 60 * 60 * 1000 to correct
  room.timerEnd = Date.now() + durationMs;

  room.timerIntervalId = setInterval(() => {
    const now = Date.now();
    
    if (now >= room.timerEnd) {
      // 1. CLEAR THE INTERVAL RUNTIME PROCESS FIRST FOR SAFETY
      clearInterval(room.timerIntervalId);
      room.timerIntervalId = null;

      // 2. EXPLICITLY SHIFT THE STATE DATA STRINGS
      room.status = 'dirty';
      room.timerEnd = null;

      // 3. GENERATE AUTOMATIC DIRTY ALERTS
      const autoDirtyAlert = {
        id: "NOTIF-" + Date.now(),
        room: room.id,
        type: "ROOM_DIRTY",
        message: `🚨 Short Stay Expired: ${room.id} is now DIRTY and needs cleaning.`,
        senderId: "SYSTEM_TIMER",
        timestamp: Date.now(),
        recipients: ["frontdesk", "housekeeper"] // Visible on both dashboards
      };

      const autoDirtyLog = {
        id: "LOG-" + Date.now(),
        dateString: new Date().toLocaleDateString('en-GB'),
        timestamp: Date.now(),
        staffId: "SYSTEM_TIMER",
        action: "AUTO_TIMER_EXPIRED",
        room: room.id,
        details: "Short stay limit reached. Room status auto-flipped to dirty.",
        rawTurnaroundMs: 0
      };

      // 4. PUSH AND COMMIT HARD DATA STRAIGHT TO DISK STORAGE
      notificationsQueue.push(autoDirtyAlert);
      auditHistoryLogs.push(autoDirtyLog);

      saveStateToLocalStorage();
      localStorage.setItem('hk_notifications', JSON.stringify(notificationsQueue));
      localStorage.setItem('hk_audit_history', JSON.stringify(auditHistoryLogs));
      
      // 5. REDRAW DYNAMIC VIEWS IMMEDIATELY IF VISIBLE
      if (!frontdeskView.classList.contains('hidden')) {
        renderFrontDeskView();
        renderFrontDeskNotifications();
      }
      if (!housekeeperView.classList.contains('hidden')) {
        renderHousekeeperView();
        renderHousekeeperNotifications();
      }
    } else {
      // Regular dynamic text timer string ticking countdown updates
      if (!frontdeskView.classList.contains('hidden')) {
        const cleanIdString = `text-timer-${room.id.replace(/\s+/g, '')}`;
        const targetTimerElement = document.getElementById(cleanIdString);
        if (targetTimerElement) {
          const timeLeft = Math.max(0, Math.round((room.timerEnd - now) / 1000));
          targetTimerElement.innerText = `⏳ Auto-Dirty in: ${timeLeft}s`;
        }
      }
    }
  }, 1000);

  saveStateToLocalStorage();
  renderFrontDeskView();
};


// ==========================================
// 4.5 HISTORICAL AUDIT LOGS FILTER ENGINE
// ==========================================

const historyView = document.getElementById('history-view');
const historyLogsContainer = document.getElementById('history-logs-container');
const historyTierLabel = document.getElementById('history-tier-label');
const managementFilters = document.getElementById('management-filters');

const filterDateInput = document.getElementById('filter-date');
const filterStaffInput = document.getElementById('filter-staff');
const btnBackFromHistory = document.getElementById('btn-back-from-history');
const navHistoryButtons = document.querySelectorAll('.nav-history-btn');


function renderAuditHistory() {
  historyLogsContainer.innerHTML = ""; // Clear out log window
  
  // Destructure current authentication metrics parameters
  const userLevel = authenticatedUser.level; 
  const userRole = authenticatedUser.subRole;
  const staffId = authenticatedUser.staffId;

  // Set top identity tracking labels strings
  historyTierLabel.innerText = `Logged in as: ${authenticatedUser.name} (${staffId}) | Tier: Level ${userLevel}`;

  // 1. PRIVACY SECURITY GATING FILTERS
  let visibleLogs = [];
  
  if (userLevel === "000" || userLevel === "001" || userLevel === "002") {
    // Admins, Managers, and Supervisors see EVERYTHING
    visibleLogs = [...auditHistoryLogs];
    managementFilters.classList.remove('hidden'); // Reveal inputs control deck panels
  } else {
    // Level 003 Staff can ONLY view actions carrying their exact Staff ID matching tokens
    visibleLogs = auditHistoryLogs.filter(log => log.staffId === staffId);
    managementFilters.classList.add('hidden'); // Lock search panels away safely
  }

  // 2. APPLY MANAGEMENT INTERACTIVE BAR SEARCH INPUT FILTERS
  const targetDateFilter = filterDateInput.value.trim();
  const targetStaffFilter = filterStaffInput.value.trim().toUpperCase();

  if (targetDateFilter) {
    visibleLogs = visibleLogs.filter(log => log.dateString.includes(targetDateFilter));
  }
  if (targetStaffFilter) {
    visibleLogs = visibleLogs.filter(log => log.staffId.toUpperCase().includes(targetStaffFilter));
  }

  // 3. SORT LOGS CHRONOLOGICALLY (Most Recent Actions at the top)
  visibleLogs.sort((a, b) => b.timestamp - a.timestamp);

  if (visibleLogs.length === 0) {
    historyLogsContainer.innerHTML = `<div style="text-align:center; padding:40px; color:#6c757d; font-size:0.9rem;">No historical records matches found for current query.</div>`;
    return;
  }

  // 4. GROUP DATA STRUCTURALLY BY DATE STRINGS (DD/MM/YYYY)
  let currentGroupDate = "";

  visibleLogs.forEach(log => {
    // Inject a Date section header divider whenever the date changes in sequence loop
    if (log.dateString !== currentGroupDate) {
      currentGroupDate = log.dateString;
      const dateHeader = document.createElement('div');
      dateHeader.className = 'date-group-header';
      dateHeader.innerText = `📆 Records for Date: ${currentGroupDate}`;
      historyLogsContainer.appendChild(dateHeader);
    }

    // Assign color badge types depending on action strings configuration tokens
    const isCleanAction = log.action === "MARKED_CLEAN";
    const logCardClass = isCleanAction ? "CLEAN_ACTION" : "DIRTY_ACTION";

    const formattedTime = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const logCard = document.createElement('div');
    logCard.className = `audit-log-card ${logCardClass}`;
    logCard.innerHTML = `
      <div class="log-meta">
        <span>🕒 Time clocked: ${formattedTime}</span>
        <span>ID: <strong>${log.staffId}</strong></span>
      </div>
      <div class="log-title">${log.action.replace(/_/g, ' ')} -> ${log.room}</div>
      <div class="log-desc">${log.details}</div>
    `;
    historyLogsContainer.appendChild(logCard);
  });
};


// ==========================================
// 4.7 MANAGER CONTROL DECK ENGINE
// ==========================================

const managerDeckView = document.getElementById('manager-deck-view');
const navManagerDeckBtn = document.getElementById('nav-manager-deck-btn');
const btnBackFromManager = document.getElementById('btn-back-from-manager');

// Room Configuration Selectors
const inputNewRoomId = document.getElementById('new-room-id');
const btnAddRoom = document.getElementById('btn-add-room');
const managerRoomsList = document.getElementById('manager-rooms-list');

// Staff Provisioning Selectors
const inputNewStaffId = document.getElementById('new-staff-id');
const inputNewStaffName = document.getElementById('new-staff-name');
const selectNewStaffRole = document.getElementById('new-staff-role');
const btnAddStaff = document.getElementById('btn-add-staff');
const managerStaffList = document.getElementById('manager-staff-list');
const managerLimitWarning = document.getElementById('manager-limit-warning');



function renderManagerDeck() {
  // Clear lists
  managerRoomsList.innerHTML = "";
  managerStaffList.innerHTML = "";

  // 1. RENDER ROOMS CONFIGURATION LIST
  roomsData.forEach(room => {
    const row = document.createElement('div');
    row.className = 'config-item-row';
    row.innerHTML = `
      <span>🏨 ${room.id} (${room.status.toUpperCase()})</span>
      <button class="config-delete-btn" data-room-id="${room.id}">Remove</button>
    `;
    managerRoomsList.appendChild(row);
  });

  // 2. RENDER ACTIVE STAFF ACCOUNTS LIST
  usersRegistry.forEach(user => {
    const row = document.createElement('div');
    row.className = 'config-item-row';
    
    // Hide Developer Master Account from deletion flags for structural safety
    const isDev = user.level === "000";
    const deleteBtn = isDev ? `<span style="font-size:0.75rem; color:#6c757d;">System Owner</span>` : `<button class="config-delete-btn" data-staff-id="${user.staffId}">Revoke</button>`;

    row.innerHTML = `
      <span>👤 [Lvl ${user.level}] ${user.name} (${user.staffId})</span>
      ${deleteBtn}
    `;
    managerStaffList.appendChild(row);
  });

  // Check and flag manager account capacity ceilings
  const activeManagersCount = usersRegistry.filter(u => u.level === "001").length;
  if (activeManagersCount >= 3) {
    managerLimitWarning.classList.remove('hidden');
  } else {
    managerLimitWarning.classList.add('hidden');
  }

  attachManagerDeckDeleteListeners();
};

function attachManagerDeckDeleteListeners() {
  // Listeners to Remove Rooms
  managerRoomsList.querySelectorAll('.config-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const targetRoomId = e.target.getAttribute('data-room-id');
      
      // Remove room, clear active timer loops if running
      const room = roomsData.find(r => r.id === targetRoomId);
      if (room && room.timerIntervalId) clearInterval(room.timerIntervalId);

      roomsData = roomsData.filter(r => r.id !== targetRoomId);
      
      saveStateToLocalStorage();
      renderManagerDeck();
    });
  });

  // Listeners to Revoke Staff Accounts
  managerStaffList.querySelectorAll('.config-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const targetStaffId = e.target.getAttribute('data-staff-id');
      
      usersRegistry = usersRegistry.filter(u => u.staffId !== targetStaffId);
      
      saveUsersToLocalStorage();
      renderManagerDeck();
    });
  });
};



// ==========================================
// 5. BULK ACTIONS & INTERFACES
// ==========================================

// ADD NEW ROOM PROCESS
btnAddRoom.addEventListener('click', () => {
  const roomName = inputNewRoomId.value.trim();
  if (!roomName) return alert("⚠️ Please enter a room identifier name.");

  // Check duplicate rooms configurations
  if (roomsData.some(r => r.id.toUpperCase() === roomName.toUpperCase())) {
    return alert("⚠️ Configuration Error: A room with this identifier name already exists.");
  };

  const newRoomObj = {
    id: roomName,
    status: "dirty",
    timerEnd: null,
    timerIntervalId: null,
    isChecked: false,
    dirtyTimestamp: Date.now(), // Auto mark dirty on construction initialization
    lastCleanedBy: null
  };

  roomsData.push(newRoomObj);
  saveStateToLocalStorage();
  
  inputNewRoomId.value = ""; // Clear input textbox fields
  renderManagerDeck();
});

// CREATE NEW STAFF ACCOUNT PROCESS
btnAddStaff.addEventListener('click', () => {
  const staffId = inputNewStaffId.value.trim().toUpperCase();
  const staffName = inputNewStaffName.value.trim();
  const selectedRole = selectNewStaffRole.value;

  if (!staffId || !staffName) return alert("⚠️ Please complete all credentials entry fields.");

  // Enforce account format string controls rules checks
  if (usersRegistry.some(u => u.staffId === staffId)) {
    return alert("⚠️ Input Error: This unique Staff ID is already assigned to another profile.");
  };

  // Calculate tier levels mapping matrices parameters
  let level = "003";
  if (selectedRole === "manager") level = "001";
  if (selectedRole === "supervisor") level = "002";

  // ENFORCE CAPACITY CEILINGS
  if (selectedRole === "manager") {
    const currentManagers = usersRegistry.filter(u => u.level === "001").length;
    if (currentManagers >= 3) return alert("❌ Restriction: Maximum allowance of 3 Manager accounts reached.");
  };

  if (selectedRole === "front-desk") {
    const currentFrontDesk = usersRegistry.some(u => u.subRole === "front-desk");
    if (currentFrontDesk) return alert("❌ Restriction: Only 1 primary Front Desk account classification is allowed in the hotel framework system configuration.");
  };

  const newStaffProfile = {
    staffId: staffId,
    name: staffName,
    level: level,
    subRole: selectedRole
  };

  usersRegistry.push(newStaffProfile);
  saveUsersToLocalStorage();

  // Clear tracking inputs rows fields layouts
  inputNewStaffId.value = "";
  inputNewStaffName.value = "";
  selectNewStaffRole.value = "housekeeper";

  renderManagerDeck();
});


//[[[[[i dont understand some functions and things here too]]]]]
btnAllDirty.addEventListener('click', () => {
  roomsData.forEach(room => {
    room.status = 'dirty';
    room.isChecked = false; // Reset checkbox state
    if (room.timerIntervalId) clearInterval(room.timerIntervalId);
    room.timerEnd = null;
    room.timerIntervalId = null;
  });
  saveStateToLocalStorage();
  renderFrontDeskView();
});

btnBulkDirty.addEventListener('click', () => {
  let roomsMarked = [];

  roomsData.forEach(room => {
    if (room.isChecked) {
      room.status = 'dirty';
      room.isChecked = false; // Reset checkbox state
      room.dirtyTimestamp = Date.now(); // Record when it became dirty to start turnaround timer tracking
      
      if (room.timerIntervalId) clearInterval(room.timerIntervalId);
      room.timerEnd = null;
      room.timerIntervalId = null;

      roomsMarked.push(room.id);
    }
  });

  if (roomsMarked.length > 0) {
    // Generate manual notification alert for housekeepers
    const manualDirtyAlert = {
      id: "NOTIF-" + Date.now(),
      room: roomsMarked.join(", "),
      type: "ROOM_DIRTY",
      message: `❌ Attention Needed: Front Desk flagged ${roomsMarked.join(", ")} as DIRTY.`,
      senderId: currentStaffId,
      timestamp: Date.now(),
      recipients: ["housekeeper", "frontdesk"]
    };

    const manualDirtyLog = {
      id: "LOG-" + Date.now(),
      dateString: new Date().toLocaleDateString('en-GB'),
      timestamp: Date.now(),
      staffId: currentStaffId,
      action: "MANUAL_FLIPPED_DIRTY",
      room: roomsMarked.join(", "),
      details: `Front desk manually requested cleaning for: ${roomsMarked.join(", ")}`,
      rawTurnaroundMs: 0
    };

    notificationsQueue.push(manualDirtyAlert);
    auditHistoryLogs.push(manualDirtyLog);

    saveStateToLocalStorage();
    localStorage.setItem('hk_notifications', JSON.stringify(notificationsQueue));
    localStorage.setItem('hk_audit_history', JSON.stringify(auditHistoryLogs));
  }

  renderFrontDeskView();
  renderFrontDeskNotifications();
});



function attachFrontDeskCardListeners() {
  // 1. Setup the Short Stay Buttons
  const actionButtons = fdGridContainer.querySelectorAll('.fd-action-btn');
  actionButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      activeModalRoomId = e.target.getAttribute('data-room-id');
      modalRoomLabel.innerText = `Room: ${activeModalRoomId}`;
      timerModal.classList.remove('hidden');
    });
  });

  // 2. NEW: Listen to Checkbox changes and save immediately to state
  const checkboxes = fdGridContainer.querySelectorAll('.fd-checkbox');
  checkboxes.forEach(box => {
    box.addEventListener('change', (e) => {
      const roomId = e.target.getAttribute('data-room-id');
      const room = roomsData.find(r => r.id === roomId);
      if (room) {
        room.isChecked = e.target.checked; // Saves true or false
        saveStateToLocalStorage();
      }
    });
  });
};

btnConfirmTimer.addEventListener('click', () => {
  const hours = Math.min(12, Math.max(1, parseInt(stayHoursInput.value) || 2));
  const room = roomsData.find(r => r.id === activeModalRoomId);
  if (room) {
    startRoomTimer(room, hours);
  }
  stayHoursInput.value = ''; // <--- Reset field
  timerModal.classList.add('hidden');
});

// ==========================================
// 5.5 CLEAR ALL NOTIFICATIONS HANDLERS
// ==========================================
const btnClearHkNotifs = document.getElementById('btn-clear-hk-notifs');
const btnClearFdNotifs = document.getElementById('btn-clear-fd-notifs');

btnClearHkNotifs.addEventListener('click', () => {
  // Wipe out only alerts belonging to housekeepers
  notificationsQueue = notificationsQueue.filter(notif => !notif.recipients.includes("housekeeper"));
  localStorage.setItem('hk_notifications', JSON.stringify(notificationsQueue));
  renderHousekeeperNotifications();
});

btnClearFdNotifs.addEventListener('click', () => {
  // Wipe out only alerts belonging to frontdesk
  notificationsQueue = notificationsQueue.filter(notif => !notif.recipients.includes("frontdesk"));
  localStorage.setItem('hk_notifications', JSON.stringify(notificationsQueue));
  renderFrontDeskNotifications();
});


// ==========================================
// 6. NAVIGATION LOGIC WITH AUTO-REFRESH
// ==========================================

// Add input event hooks so searching updates the logs instantly as you type
filterDateInput.addEventListener('input', renderAuditHistory);
filterStaffInput.addEventListener('input', renderAuditHistory);

// function showView(targetView) {
//   roleView.classList.add('hidden');
//   housekeeperView.classList.add('hidden');
//   frontdeskView.classList.add('hidden');
//   historyView.classList.add('hidden'); // Clear new view link

//   targetView.classList.remove('hidden');

//   if (targetView === housekeeperView) renderHousekeeperView();
//   if (targetView === frontdeskView) renderFrontDeskView();
//   if (targetView === historyView) renderAuditHistory();
// }

function showView(targetView) {
  roleView.classList.add('hidden');
  housekeeperView.classList.add('hidden');
  frontdeskView.classList.add('hidden');
  historyView.classList.add('hidden');
  managerDeckView.classList.add('hidden'); // Clear new view link

  targetView.classList.remove('hidden');

  if (targetView === housekeeperView) renderHousekeeperView();
  
  if (targetView === frontdeskView) {
    renderFrontDeskView();
    renderFrontDeskNotifications();
    
    // SECURITY GATE CHECK: Reveal config gears button ONLY if user level is level 000 or level 001
    if (authenticatedUser.level === "000" || authenticatedUser.level === "001") {
      navManagerDeckBtn.classList.remove('hidden');
    } else {
      navManagerDeckBtn.classList.add('hidden');
    }
  }
  
  if (targetView === historyView) renderAuditHistory();
  if (targetView === managerDeckView) renderManagerDeck();
};

// Navigation Events Wiring
navManagerDeckBtn.addEventListener('click', () => showView(managerDeckView));
btnBackFromManager.addEventListener('click', () => showView(frontdeskView));


// Rewire Action Links Trigger Hooks Map
navHistoryButtons.forEach(btn => {
  btn.addEventListener('click', () => showView(historyView));
});

btnBackFromHistory.addEventListener('click', () => {
  // Return the staff profile back to their correct native interface home page viewport
  if (authenticatedUser.subRole === 'housekeeper') {
    showView(housekeeperView);
  } else {
    showView(frontdeskView);
  }
});


// Event Triggers
const staffIdInput = document.getElementById('staff-id-input');




// ==========================================
// 6.5 TIMERS RECOVERY ENGINE ON REBOOT
// ==========================================
function recoverActiveTimers() {
  const now = Date.now();
  
  roomsData.forEach(room => {
    if (room.status === 'in-use' && room.timerEnd) {
      if (now >= room.timerEnd) {
        // The short stay expired while the app was closed! Turn it dirty.
        room.status = 'dirty';
        room.timerEnd = null;
      } else {
        room.timerIntervalId = setInterval(() => {
          const now = Date.now();
          
          if (now >= room.timerEnd) {
            // 1. CLEAR THE INTERVAL RUNTIME PROCESS FIRST FOR SAFETY
            clearInterval(room.timerIntervalId);
            room.timerIntervalId = null;
      
            // 2. EXPLICITLY SHIFT THE STATE DATA STRINGS
            room.status = 'dirty';
            room.timerEnd = null;
      
            // 3. GENERATE AUTOMATIC DIRTY ALERTS
            const autoDirtyAlert = {
              id: "NOTIF-" + Date.now(),
              room: room.id,
              type: "ROOM_DIRTY",
              message: `🚨 Short Stay Expired: ${room.id} is now DIRTY and needs cleaning.`,
              senderId: "SYSTEM_TIMER",
              timestamp: Date.now(),
              recipients: ["frontdesk", "housekeeper"] // Visible on both dashboards
            };
      
            const autoDirtyLog = {
              id: "LOG-" + Date.now(),
              dateString: new Date().toLocaleDateString('en-GB'),
              timestamp: Date.now(),
              staffId: "SYSTEM_TIMER",
              action: "AUTO_TIMER_EXPIRED",
              room: room.id,
              details: "Short stay limit reached. Room status auto-flipped to dirty.",
              rawTurnaroundMs: 0
            };
      
            // 4. PUSH AND COMMIT HARD DATA STRAIGHT TO DISK STORAGE
            notificationsQueue.push(autoDirtyAlert);
            auditHistoryLogs.push(autoDirtyLog);
      
            saveStateToLocalStorage();
            localStorage.setItem('hk_notifications', JSON.stringify(notificationsQueue));
            localStorage.setItem('hk_audit_history', JSON.stringify(auditHistoryLogs));
            
            // 5. REDRAW DYNAMIC VIEWS IMMEDIATELY IF VISIBLE
            if (!frontdeskView.classList.contains('hidden')) {
              renderFrontDeskView();
              renderFrontDeskNotifications();
            }
            if (!housekeeperView.classList.contains('hidden')) {
              renderHousekeeperView();
              renderHousekeeperNotifications();
            }
          } else {
            // Regular dynamic text timer string ticking countdown updates
            if (!frontdeskView.classList.contains('hidden')) {
              const cleanIdString = `text-timer-${room.id.replace(/\s+/g, '')}`;
              const targetTimerElement = document.getElementById(cleanIdString);
              if (targetTimerElement) {
                const timeLeft = Math.max(0, Math.round((room.timerEnd - now) / 1000));
                targetTimerElement.innerText = `⏳ Auto-Dirty in: ${timeLeft}s`;
              }
            }
          }
        }, 1000);
      
        saveStateToLocalStorage();
        renderFrontDeskView();
      } // <--- Missing closing brace for "else"
    } // <--- Missing closing brace for "forEach"
  }); // <--- Missing closing brace for "roomsData.forEach"
} // <--- Missing closing brace for "recoverActiveTimers"

// Fire off the recovery engine automatically on startup
recoverActiveTimers();


// ==========================================
// 7. PWA SERVICE WORKER REGISTRATION
// ==========================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js') 
      .then(reg => console.log('Service Worker registered successfully!', reg.scope))
      .catch(err => console.log('Service Worker registration failed:', err));
  });
};

// ==========================================
// 8. INTER-TAB REAL-TIME LIVE SYNC ENGINE
// ==========================================

/**
 * Force-reloads all state arrays from disk and redraws whichever screen is actively visible.
 */
function synchronizeAndRedrawUI() {
  // Re-pull the updated variables directly from LocalStorage mid-session
  roomsData = JSON.parse(localStorage.getItem('hk_rooms_state')) || defaultRooms;
  notificationsQueue = JSON.parse(localStorage.getItem('hk_notifications')) || [];
  auditHistoryLogs = JSON.parse(localStorage.getItem('hk_audit_history')) || [];

  // Redraw whichever dashboard view the user is looking at right now
  if (!frontdeskView.classList.contains('hidden')) {
    renderFrontDeskView();
    renderFrontDeskNotifications();
  }
  if (!housekeeperView.classList.contains('hidden')) {
    renderHousekeeperView();
    renderHousekeeperNotifications();
  }
};

// BUILT-IN BROWSER SIGNAL: Fires instantly when another tab calls localStorage.setItem()
window.addEventListener('storage', (event) => {
  // Only sync if our specific project keys were updated by the other tab
  if (event.key === 'hk_rooms_state' || event.key === 'hk_notifications' || event.key === 'hk_audit_history') {
    synchronizeAndRedrawUI();
  }
});

// BACKGROUND HEARTBEAT POLLING LOOP
// This ensures that even if you don't click anything, data updates (like countdown timers expiring) 
// and dynamic notification screens refresh live across both views automatically.
setInterval(() => {
  if (roleView.classList.contains('hidden')) {
    // Only re-pull variables if another script updated them
    const freshRooms = JSON.parse(localStorage.getItem('hk_rooms_state')) || defaultRooms;
    const freshNotifs = JSON.parse(localStorage.getItem('hk_notifications')) || [];
    
    // Check if lengths or states actually changed before triggering structural DOM updates
    if (JSON.stringify(freshRooms) !== JSON.stringify(roomsData) || JSON.stringify(freshNotifs) !== JSON.stringify(notificationsQueue)) {
      roomsData = freshRooms;
      notificationsQueue = freshNotifs;

      if (!frontdeskView.classList.contains('hidden')) {
        renderFrontDeskView();
        renderFrontDeskNotifications();
      };
      if (!housekeeperView.classList.contains('hidden')) {
        renderHousekeeperView();
        renderHousekeeperNotifications();
      }
    }
  }
}, 1000);


// Automatically trigger network pull requests on application lifecycle startup
loadInitialCloudData();







