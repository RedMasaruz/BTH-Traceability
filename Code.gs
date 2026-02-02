/**
 * Code.gs
 * Full server-side Google Apps Script for MitraApp
 * - Supports: doGet, include, userLogin, writeSheetA, writeSheetB, createNewSheetForLong,
 *   searchFarmerData, getAllFarmersByLong, searchSheetBData, submitForm (survey),
 *   Slides PDF preview generation, and utilities.
 *
 * Updates in this version:
 * - Support separate farmer_firstname and farmer_lastname fields (kept backward-compatible
 *   by populating farmer_name_main). Adds placeholders {{farmer_firstname}} and {{farmer_lastname}}
 *   for Slides and stores separate columns "ชื่อจริง" / "นามสกุล" in survey sheet headers.
 * - GAP / GACP dates stored and exposed as separate start/end placeholders:
 *     {{gap_start_date}}, {{gap_end_date}}, {{gacp_start_date}}, {{gacp_end_date}}
 * - Ensure phone numbers are stored as text in Sheets (preserve leading zeros).
 * - All sheet headers and text written to sheets are Thai.
 * - farmer_agent mapping: 'have'/'none' -> 'มีตัวแทน'/'ยังไม่มีตัวแทน'.
 * - Species separated into per-stem columns (ก้านแดง / ก้านขาว / ก้านเขียว) with details + totals.
 * - Dates normalized to DD/MM/YYYY.
 * - Preview replacement keys include per-stem fields (red_details, red_total, ...).
 *
 * Added in this update:
 * - Separate admin users sheet "UserAdmin" is supported. userLogin will check UserAdmin first
 *   to mark isAdmin=true and admin-only endpoints (getAllFarmers, getAllUsage, getAllMerged)
 *   validate the session token and check admin rights server-side.
 *
 * NOTE: Update spreadsheet IDs / slide template ID / folder IDs to match your environment.
 */

/* ========== CONFIG ========== */
const SPREADSHEET_ID_A = '14GPDajc6BmrAzge-kWf5gkffSjnoHhlqApg-5ApKdKc'; // main: SheetA, Users, AuditLog
const SPREADSHEET_ID_B = '13WEbt7dPiLDs_3vdU3O0uiCuv9x2DXUwrnxJsK6_qBQ'; // per-long sheets for Sheet B
const SPREADSHEET_ID_GACP = '1uLKyiDDXLR-dKlge9DB7INm97ZKSS0ILhYcHHb-zXHQ';
const SHEET_A_NAME = "SheetA";
const SHEET_GACP_NAME = "GACP";

// New: separate admin users sheet name (in SPREADSHEET_ID_A)
const USER_ADMIN_SHEET_NAME = "UserAdmin";
const SHEET_LOTS_NAME = "ProductionLots";

const SHEET_B_NAMES = [
  "ตัวแทนบาสBDS",
  "ตัวแทนHunterเวียงแก่น",
  "ตัวแทนก้ามท่าแค",
  "ตัวแทนกระรอก",
  "ตัวแทนรัชช์เมืองนคร",
  "ตัวแทนตูนบางขัน",
  "ตัวแทนป๋องส์เมืองพัทลุง",
  "ตัวแทนบจก.จินดารัตน์ โปรดักส์",
  "ตัวแทนดอน",
  "ตัวแทนเตยเกรซ",
  "ตัวแทนสมพงศ์พะยูนตรัง",
  "ตัวแทนกระท่อมปลอดสารคลองใหม่พัทลุง",
  "ตัวแทนหรั่งนุ้ยพระนคร",
  "ตัวแทนเปรี้ยวหล่มสัก",
  "ตัวแทนพี.เจ.กระท่อมทอง",
  "ตัวแทนทรัพย์มะรุมฟาร์ม",
  "ตัวแทนสวนอิน-จักรภัทร",
  "ตัวแทนรักษ์อุทัย",
  "ตัวแทนวิทย์วิสาหกิจชุมชนชาววัง",
  "ตัวแทนสาโรจน์"
];

// FALLBACK_SECRET_KEY removed for security. Keys are now improved to be auto-generated in ScriptProperties if missing.
const ALLOWED_FUNCTIONS = [
  'userLogin', 
  'writeSheetA', 
  'writeSheetB', 
  'createNewSheetForLong',
  'searchFarmerData', 
  'getAllFarmersByLong', 
  'searchSheetBData', 
  'submitForm',
  'getAllFarmers', 
  'getAllUsage', 
  'testAdminAccess', 
  'testSheetAccessPublic', 
  'testPing', 
  'getAllFarmersDebug',
  'getAllFarmersDebug',
  'saveGACPData',
  'createLot',
  'updateLotState',
  'getLotData',
  'getAdminDashboardData',
  'getAgentLots',
  'getFarmersWithSheetBRecords',
  'updateMultipleLotState',
  'getLongOptions'
];

// Survey-specific resources (Slides template, destination sheet & folder for PDFs)
const SURVEY_SPREADSHEET_ID = "1sK1KfRUhxfLxvgvdhG5OkjuGLXe55_pBC7MDyFMI03Q";
const SURVEY_SHEET_NAME = "ข้อมูลพื้นที่ปลูกพืชสมุนไพรกระท่อม";
const SLIDE_TEMPLATE_ID = "1NP9r9IfD5Zedc1lSKN0VNuPCfKz2_LmK_unmM1ayKyw";
const PDF_FOLDER_ID = "1f-aL2Ychh2QaKzJdstr-WrvpaofnaGeP";

// Security and validation constants
const MAX_INPUT_LENGTH = 5000;
const MAX_REQUESTS_PER_HOUR = 100;
const TOKEN_EXPIRY_MS = 86400000; // 24 hours
const MAX_PHONE_LENGTH = 20;
const MIN_PHONE_FALLBACK_LENGTH = 15;
const MAX_TOKEN_LENGTH = 1000;
const RATE_LIMIT_WINDOW_SECONDS = 3600;
const MAX_SEARCH_QUERY_LENGTH = 100;
const SEARCH_DEBOUNCE_MS = 300;
const MAX_SPECIES_COUNT = 1000000;
const MAX_SPECIES_NAME_LENGTH = 100;

/* ========== DYNAMIC DROPDOWN OPTIONS ========== */
/**
 * Fetches agent options from AgentOptions sheet for dropdown population
 * Display text shows name without prefix, but value includes 'ตัวแทน' prefix for Sheet B reference
 * @returns {Object} {success, options: Array of {value, text}}
 */
function getLongOptions() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID_A);
    const sheet = ss.getSheetByName('AgentOptions');
    
    if (!sheet) {
      console.log('⚠️ AgentOptions sheet not found, returning empty option');
      return { success: true, options: [{ value: "", text: "--- เลือกตัวแทนที่สังกัด ---" }] };
    }
    
    const data = sheet.getDataRange().getValues();
    const options = [{ value: "", text: "--- เลือกตัวแทนที่สังกัด ---" }];
    
    // Skip header row (row 0), read column A (agent name)
    for (let i = 1; i < data.length; i++) {
      const agentName = data[i][0];
      if (agentName && String(agentName).trim()) {
        const displayName = String(agentName).trim();
        // Add 'ตัวแทน' prefix to value for Sheet B reference
        const valueWithPrefix = 'ตัวแทน' + displayName;
        options.push({ value: valueWithPrefix, text: displayName });
      }
    }
    
    console.log(`✅ getLongOptions: Loaded ${options.length - 1} agents`);
    return { success: true, options: options };
  } catch (e) {
    console.error('❌ getLongOptions error:', e);
    return { success: false, message: e.message, options: [{ value: "", text: "--- เลือกตัวแทนที่สังกัด ---" }] };
  }
}

/* ========== HTML / UI Helpers ========== */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Handle GET requests for API calls (e.g., from fetch)
 * Supports action parameter: getLongOptions
 * Supports view parameter: trace (for QR Scans)
 */
function doGet(e) {
  const params = e.parameter;
  const action = params.action;
  const view = params.view;
  
  // 1. API Actions
  if (action === 'getLongOptions') {
    try {
      const result = getLongOptions();
      return ContentService
        .createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (error) {
      return ContentService
        .createTextOutput(JSON.stringify({
          success: false,
          message: error.message,
          options: [{ value: "", text: "--- เกิดข้อผิดพลาด ---" }]
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  // 2. Traceability View (QR Code Logic)
  // Usage: <SCRIPT_URL>?view=trace&lotId=LOT-XXXX
  if (view === 'trace') {
    const lotId = params.lotId;
    if (!lotId) return ContentService.createTextOutput("Lot ID is required").setMimeType(ContentService.MimeType.TEXT);
    
    // Fetch lot data
    const lotData = getLotDataForTraceability(lotId);
    if (!lotData) return ContentService.createTextOutput("Lot Not Found").setMimeType(ContentService.MimeType.TEXT);
    
    // Render simple HTML view
    const template = HtmlService.createTemplateFromFile('traceability_view');
    template.lot = lotData;
    template.packetId = params.packetId || ''; // Pass packetId to view
    return template.evaluate()
      .setTitle('BTH Traceability: ' + lotId)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  
  // Default: serve the web app HTML
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('BTH Traceability')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Helper to get Lot Data
function getLotDataForTraceability(lotId) {
  try {
     const sheet = getLotsSheet();
     const data = sheet.getDataRange().getValues();
     const headers = data[0];
     const idxId = headers.indexOf('lot_id');
     const idxData = headers.indexOf('data_json');
     const idxHistory = headers.indexOf('history_json');
     
     for (let i = 1; i < data.length; i++) {
       if (String(data[i][idxId]) === String(lotId)) {
         const d = JSON.parse(data[i][idxData]);
         const h = JSON.parse(data[i][idxHistory]);
         return { id: lotId, data: d, history: h };
       }
     }
     return null;
  } catch (e) {
    return null;
  }
}

function doPost(e) {
  try {
    const params = e.parameter;
    const functionName = params.function;
    const args = JSON.parse(params.args || '[]');

    // Verify function is in whitelist
    if (!ALLOWED_FUNCTIONS.includes(functionName)) {
      throw new Error('Access Denied: Function not allowed (' + functionName + ')');
    }

    // Call the requested function
    if (typeof this[functionName] === 'function') {
      const result = this[functionName].apply(this, args);
      return ContentService
        .createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    } else {
      throw new Error('Function not found: ' + functionName);
    }
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        message: error.message
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/* ========== UTILITIES ========== */
function getSecretKey() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('SECRET_KEY');
  if (!key) {
    // Generate a secure random key if not present
    key = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + new Date().toISOString()));
    props.setProperty('SECRET_KEY', key);
    Logger.log('Generated and saved new SECRET_KEY');
  }
  return key;
}

function arraysEqual(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  
  // Limit maximum input length using constant
  if (input.length > MAX_INPUT_LENGTH) {
    Logger.log('Input too long, truncating from ' + input.length + ' to ' + MAX_INPUT_LENGTH);
    input = input.substring(0, MAX_INPUT_LENGTH);
  }
  
  // Prevent formula injection
  if (input.startsWith('=') || input.startsWith('+') || input.startsWith('-') || input.startsWith('@')) {
    input = "'" + input;
  }
  
  // Remove HTML/script tags (basic XSS prevention)
  input = input.replace(/<script[^>]*>.*?<\/script>/gi, '');
  input = input.replace(/<[^>]*>/g, '');
  
  // Remove null bytes
  input = input.replace(/\0/g, '');
  
  return input.trim();
}

function checkRateLimit(identifier) {
  const cache = CacheService.getScriptCache();
  const key = `rate_limit_${identifier || 'anon'}`;
  const count = parseInt(cache.get(key) || '0', 10);
  
  // Use configurable rate limiting constants
  if (count >= MAX_REQUESTS_PER_HOUR) {
    Logger.log('Rate limit exceeded for: ' + identifier + ' (' + count + ' requests)');
    throw new Error('คุณส่งข้อมูลบ่อยเกินไป กรุณารอสักครู่ (Rate limit: ' + MAX_REQUESTS_PER_HOUR + ' requests per hour)');
  }
  
  cache.put(key, (count + 1).toString(), RATE_LIMIT_WINDOW_SECONDS);
}

function logAction(action, username, details) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID_A);
    let logSheet = ss.getSheetByName("AuditLog");
    if (!logSheet) {
      logSheet = ss.insertSheet("AuditLog");
      logSheet.appendRow(["เวลา", "action", "username", "details", "ip"]);
      logSheet.getRange(1, 1, 1, 5).setBackground("#4f46e5").setFontColor("white").setFontWeight("bold");
    }
    logSheet.appendRow([new Date(), action, username || 'anonymous', JSON.stringify(details), Session.getTemporaryActiveUserKey() || 'unknown']);
    if (logSheet.getLastRow() > 2000) logSheet.deleteRows(2, 100);
  } catch (e) {
    Logger.log('Log error: ' + e.message);
  }
}

/* ========== DATE / FORMAT HELPERS ========== */
function formatDateToDDMMYYYY(input) {
  if (!input && input !== 0) return '';
  try {
    if (Object.prototype.toString.call(input) === '[object Date]') {
      const d = input;
      if (isNaN(d.getTime())) return '';
      const day = ('0' + d.getDate()).slice(-2);
      const month = ('0' + (d.getMonth() + 1)).slice(-2);
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    }
    const s = String(input).trim();
    if (!s) return '';
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
      const parts = s.split('/');
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10);
      const year = parseInt(parts[2], 10);
      
      // Validate day/month ranges
      if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900 || year > 2100) {
        Logger.log('Invalid date values: ' + s);
        return s; // Return original if validation fails
      }
      
      const paddedDay = ('0' + day).slice(-2);
      const paddedMonth = ('0' + month).slice(-2);
      return `${paddedDay}/${paddedMonth}/${year}`;
    }
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const year = parseInt(m[1], 10);
      const month = parseInt(m[2], 10);
      const day = parseInt(m[3], 10);
      
      // Validate ranges
      if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900 || year > 2100) {
        Logger.log('Invalid ISO date values: ' + s);
        return s;
      }
      
      return `${m[3]}/${m[2]}/${m[1]}`;
    }
    const parsed = new Date(s);
    if (!isNaN(parsed.getTime())) {
      // Additional validation: check if year is reasonable
      const year = parsed.getFullYear();
      if (year < 1900 || year > 2100) {
        Logger.log('Parsed date out of range: ' + s);
        return s;
      }
      const day = ('0' + parsed.getDate()).slice(-2);
      const month = ('0' + (parsed.getMonth() + 1)).slice(-2);
      return `${day}/${month}/${year}`;
    }
    return s;
  } catch (e) {
    Logger.log('formatDateToDDMMYYYY error: ' + e.message + ' for input: ' + String(input));
    return String(input || '');
  }
}

/* month helper for preview */
const MONTH_NAMES = {
  '1': 'มกราคม', '2': 'กุมภาพันธ์', '3': 'มีนาคม', '4': 'เมษายน', '5': 'พฤษภาคม', '6': 'มิถุนายน',
  '7': 'กรกฎาคม', '8': 'สิงหาคม', '9': 'กันยายน', '10': 'ตุลาคม', '11': 'พฤศจิกายน', '12': 'ธันวาคม'
};
function monthRangeText(start, end) {
  if (!start && !end) return '';
  if (!start) return `${MONTH_NAMES[String(end)] || end}`;
  if (!end) return `${MONTH_NAMES[String(start)] || start}`;
  return `${MONTH_NAMES[String(start)] || start} — ${MONTH_NAMES[String(end)] || end}`;
}

/* ========== PHONE HELPERS ========== */
/**
 * Clean phone but preserve leading '+' if present.
 * Returns a string of digits (or '+' + digits).
 */
function sanitizePhoneForSheet(phone) {
  if (phone === undefined || phone === null) return '';
  let s = String(phone).trim();
  if (!s) return '';
  
  // Limit phone number length using constant
  if (s.length > MAX_PHONE_LENGTH) {
    Logger.log('Phone number too long, truncating: ' + s);
    s = s.substring(0, MAX_PHONE_LENGTH);
  }
  
  // keep leading + if present
  if (s.startsWith('+')) {
    const digits = s.slice(1).replace(/\D/g, '');
    return digits ? ('+' + digits) : '';
  }
  // otherwise keep only digits
  const cleaned = s.replace(/\D/g, '');
  
  // Validate length (Thai numbers are typically 9-10 digits)
  if (cleaned.length > 0 && cleaned.length <= MAX_PHONE_LENGTH) {
    return cleaned;
  }
  
  Logger.log('Invalid phone number format: ' + s);
  return cleaned.substring(0, MIN_PHONE_FALLBACK_LENGTH); // Return truncated version using constant
}

/**
 * Write a phone string into a specific cell as TEXT, preserving leading zeros.
 * sheet: Sheet object
 * row: number (1-based)
 * col: number (1-based)
 * phoneValue: original phone string
 */
function setPhoneCellAsText(sheet, row, col, phoneValue) {
  try {
    const cleaned = sanitizePhoneForSheet(phoneValue || '');
    if (cleaned === '') {
      // leave cell as-is or set empty string
      sheet.getRange(row, col).setNumberFormat('@').setValue('');
      return;
    }
    // Prefix with apostrophe to force text (will be hidden in UI)
    sheet.getRange(row, col).setNumberFormat('@').setValue("'" + cleaned);
  } catch (e) {
    // fallback: try simple set as string
    try { sheet.getRange(row, col).setValue(String(phoneValue || '')); } catch (ee) {}
  }
}

/**
 * Helper to apply phone values to columns by header names, using setPhoneCellAsText.
 * phoneMap: { "Header Name": phoneValue, ... }
 */
function applyPhoneColumnsAsText(sheet, lastRow, phoneMap) {
  try {
    if (!sheet || !lastRow || !phoneMap) return;
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h || ''));
    for (const headerName in phoneMap) {
      if (!phoneMap.hasOwnProperty(headerName)) continue;
      const value = phoneMap[headerName];
      if (value === undefined || value === null || String(value).trim() === '') continue;
      const idx = headers.indexOf(headerName);
      if (idx >= 0) {
        setPhoneCellAsText(sheet, lastRow, idx + 1, value);
      }
    }
  } catch (e) {
    Logger.log('applyPhoneColumnsAsText error: ' + e.message);
  }
}

/**
 * Flexible header finder: tries exact matches first then partial matches.
 * Returns 0-based column index or -1.
 * targetNames: array of possible header strings (Thai variations).
 */
function findHeaderIndexFlexible(sheet, targetNames) {
  try {
    if (!sheet || !targetNames || !Array.isArray(targetNames)) return -1;
    const lastCol = sheet.getLastColumn();
    if (!lastCol || lastCol < 1) return -1;
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());
    const lowerHeaders = headers.map(h => h.toLowerCase());
    // exact matches first
    for (let t of targetNames) {
      const tn = String(t || '').trim().toLowerCase();
      const idx = lowerHeaders.indexOf(tn);
      if (idx !== -1) return idx;
    }
    // partial / includes matches
    for (let t of targetNames) {
      const tn = String(t || '').trim().toLowerCase();
      for (let i = 0; i < lowerHeaders.length; i++) {
        if (!lowerHeaders[i]) continue;
        if (lowerHeaders[i].includes(tn) || tn.includes(lowerHeaders[i])) return i;
      }
    }
    return -1;
  } catch (e) {
    Logger.log('findHeaderIndexFlexible error: ' + e.message);
    return -1;
  }
}

/**
 * Formatting helper for display / preview only.
 * Returns a formatted string (e.g., "012-3456789") for use in Slides/UI.
 *
 * IMPORTANT:
 * - This function should be used only for presentation (Slides, previews, UI).
 * - Do NOT use the formatted output as the value written directly to Google Sheets,
 *   because Sheets may interpret strings with dashes differently; always use
 *   setPhoneCellAsText(...) when writing to Sheets to preserve leading zeros.
 */
function getPhoneNumberAsText(phoneNumber) {
    if (!phoneNumber || phoneNumber === '-' || phoneNumber === '') {
        return "";
    }

    const s = String(phoneNumber).trim();
    // Keep leading + for international numbers in display if present
    if (s.startsWith('+')) {
      const digits = s.slice(1).replace(/\D/g, '');
      if (digits.length) return '+' + digits;
      return "";
    }

    const digitsOnly = s.replace(/\D/g, '');

    // Thai common mobile numbers: 10 digits starting with 0 -> format 0xx-xxxxxxx
    if (digitsOnly.length === 10 && digitsOnly.startsWith('0')) {
        return digitsOnly.replace(/(\d{3})(\d{7})/, '$1-$2');
    }

    // If shorter or longer, return digits-only string for display (still string)
    if (digitsOnly.length > 0) return digitsOnly;

    return "";
}

/* ========== SESSION TOKEN ========== */
function generateSessionToken(username, longName) {
  const timestamp = new Date().getTime();
  const tokenData = { username: username, longName: longName, timestamp: timestamp };
  const encodedData = Utilities.base64Encode(JSON.stringify(tokenData));
  const signature = Utilities.computeHmacSha256Signature(encodedData, getSecretKey());
  const encodedSignature = Utilities.base64Encode(signature);
  return `${encodedData}.${encodedSignature}`;
}

function validateSessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  
  // Validate token length using constant
  if (token.length > MAX_TOKEN_LENGTH) {
    Logger.log('Token too long: ' + token.length);
    return null;
  }
  
  try {
    const parts = token.split('.');
    if (parts.length !== 2) {
      Logger.log('Invalid token format: expected 2 parts, got ' + parts.length);
      return null;
    }
    
    const encodedData = parts[0];
    const encodedSignature = parts[1];
    
    // Validate base64 format
    if (!encodedData || !encodedSignature) {
      Logger.log('Token parts empty');
      return null;
    }
    
    const expectedSignature = Utilities.computeHmacSha256Signature(encodedData, getSecretKey());
    const actualSignature = Utilities.base64Decode(encodedSignature);
    
    if (!arraysEqual(expectedSignature, actualSignature)) {
      Logger.log('Token signature mismatch');
      return null;
    }
    
    const tokenData = JSON.parse(Utilities.newBlob(Utilities.base64Decode(encodedData)).getDataAsString());
    
    // Validate token data structure
    if (!tokenData || !tokenData.username || !tokenData.timestamp) {
      Logger.log('Invalid token data structure');
      return null;
    }
    
    // Check token expiration using constant
    const now = new Date().getTime();
    if (now - tokenData.timestamp > TOKEN_EXPIRY_MS) {
      Logger.log('Token expired: ' + ((now - tokenData.timestamp) / 3600000) + ' hours old');
      return null;
    }
    
    return tokenData;
  } catch (e) {
    Logger.log('Token validation error: ' + e.message);
    console.error('Token validation error:', e);
    return null;
  }
}

/* ========== NAME NORMALIZATION & USER MAPPING ========== */
function normalizeLongName(s) {
  if (s === undefined || s === null) return '';
  try {
    return String(s)
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[\-\_\(\)\[\]\.,\/\\\|:;'"`~•·–—]/g, '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '');
  } catch (e) {
    return String(s || '').toLowerCase().trim();
  }
}

function getLongNameFromUsers(username) {
  try {
    if (!username) return null;
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID_A);
    const userSheet = ss.getSheetByName("Users");
    if (!userSheet) return null;
    const data = userSheet.getDataRange().getValues();
    if (data.length < 2) return null;
    const headers = data[0].map(h => String(h).toLowerCase());
    const idxUser = headers.indexOf('username');
    const idxLong = headers.indexOf('long_name');
    if (idxUser === -1) return null;
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (String(row[idxUser] || '').trim().toLowerCase() === String(username).trim().toLowerCase()) {
        return String(row[idxLong] || '').trim();
      }
    }
    return null;
  } catch (e) {
    Logger.log('getLongNameFromUsers error: ' + e);
    return null;
  }
}

/* ========== ADMIN USER HELPERS ========== */
/**
 * Check if the given username is listed in the UserAdmin sheet or has admin role in Users sheet.
 * @param {string} username - The username to check
 * @param {string} [password] - Optional password to verify (currently unused, reserved for future use)
 * @returns {boolean} True if user has admin privileges
 */
function isAdminUsername(username) {
  if (!username) return false;
  const u = String(username).trim().toLowerCase();
  
  // 1. Check Cache first
  try {
    const cache = CacheService.getScriptCache();
    const cachedRole = cache.get('admin_role_' + u);
    if (cachedRole) {
      return (cachedRole === 'admin' || cachedRole === 'superadmin');
    }
  } catch (e) {
    Logger.log('Cache error: ' + e);
  }

  // 2. Check hardcoded list (fallback)
  const adminUsernames = ['admin', 'administrator', 'superadmin', 'root'];
  if (adminUsernames.includes(u)) return true;

  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID_A);
    
    // 3. Check UserAdmin sheet
    const adminSheet = ss.getSheetByName(USER_ADMIN_SHEET_NAME);
    if (adminSheet) {
      const data = adminSheet.getDataRange().getValues();
      if (data && data.length > 1) {
        const headers = data[0].map(h => String(h || '').toLowerCase().trim());
        const idxUser = headers.indexOf('username');
        if (idxUser !== -1) {
          for (let i = 1; i < data.length; i++) {
             if (String(data[i][idxUser] || '').trim().toLowerCase() === u) {
               CacheService.getScriptCache().put('admin_role_' + u, 'superadmin', 900); // 15 min cache
               return true;
             }
          }
        }
      }
    }

    // 4. Check Users sheet
    const userSheet = ss.getSheetByName("Users");
    if (userSheet) {
      const udata = userSheet.getDataRange().getValues();
      if (udata && udata.length > 1) {
         const uheaders = udata[0].map(h => String(h || '').toLowerCase().trim());
         const idxUserU = uheaders.indexOf('username');
         const idxRoleU = uheaders.indexOf('role');
         
         if (idxUserU !== -1 && idxRoleU !== -1) {
           for (let j = 1; j < udata.length; j++) {
             const storedUser = String(udata[j][idxUserU] || '').trim().toLowerCase();
             const storedRole = String(udata[j][idxRoleU] || '').trim().toLowerCase();
             
             if (storedUser === u && (storedRole === 'admin' || storedRole === 'superadmin')) {
                CacheService.getScriptCache().put('admin_role_' + u, storedRole, 900); // 15 min cache
                return true;
             }
           }
         }
      }
    }

    return false;
  } catch (e) {
    console.error('isAdminUsername error:', e);
    return false;
  }
}

/**
 * Compute HMAC-SHA256 base64 hash of a password using SECRET_KEY.
 * Returns base64 string.
 */
function computePasswordHash(password) {
  if (password === undefined || password === null) return '';
  const key = getSecretKey();
  // computeHmacSha256Signature returns byte[]; base64Encode accepts byte[] too
  const sig = Utilities.computeHmacSha256Signature(String(password), key);
  return Utilities.base64Encode(sig);
}

/**
 * Prefix used to indicate stored password is hashed with HMACSHA256
 */
const HASH_PREFIX = 'HMACSHA256$';

/**
 * Create UserAdmin sheet (if not exists) with secure header.
 */
function createUserAdminSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_A);
  let sheet = ss.getSheetByName(USER_ADMIN_SHEET_NAME);
  if (sheet) {
    return { success: true, message: 'UserAdmin sheet already exists' };
  }
  sheet = ss.insertSheet(USER_ADMIN_SHEET_NAME);
  const headers = ['username', 'password', 'long_name', 'email', 'role', 'created_at'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#F3F4F6');
  return { success: true, message: 'UserAdmin sheet created' };
}

function setupAdminUser() {
    // SECURITY UPDATE: Check if any admin exists before allowing setup
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID_A);
    const sheet = ss.getSheetByName(USER_ADMIN_SHEET_NAME);
    
    if (sheet && sheet.getLastRow() > 1) {
       return { success: false, message: 'Admin users already exist. Setup disabled for security.' };
    }

    // If no admin, allow creating one with default password but LOG HEAVILY
    const DEFAULT_PASSWORD = 'CHANGE_ME_IMMEDIATELY';
    try {
       const result = addAdminUser('admin', DEFAULT_PASSWORD, 'ผู้ดูแลระบบหลัก', 'admin@example.com', 'superadmin');
       if (result.success) {
           console.warn('⚠️ WARNING: Admin initialized with default password. PLEASE CHANGE IMMEDIATELY.');
       }
       return result;
    } catch (e) {
       return { success: false, message: e.message };
    }
}

/**
 * Add admin user to UserAdmin sheet and store password as hashed value.
 * Role default 'admin'.
 */
function addAdminUser(username, password, longName, email, role) {
  if (!username || !password) {
    return { success: false, message: 'username และ password ต้องไม่เป็นค่าว่าง' };
  }
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_A);
  let sheet = ss.getSheetByName(USER_ADMIN_SHEET_NAME);
  if (!sheet) {
    createUserAdminSheet();
    sheet = ss.getSheetByName(USER_ADMIN_SHEET_NAME);
  }
  const data = sheet.getDataRange().getValues();
  const headers = data[0] || [];
  const idxUser = headers.indexOf('username');
  const idxPass = headers.indexOf('password');
  if (idxUser === -1 || idxPass === -1) {
    return { success: false, message: 'โครงสร้างชีตไม่ถูกต้อง (ต้องมี username และ password)' };
  }
  // ตรวจซ้ำ username
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idxUser] || '').trim() === String(username).trim()) {
      return { success: false, message: 'username นี้มีอยู่แล้ว' };
    }
  }
  const now = new Date();
  const hashed = HASH_PREFIX + computePasswordHash(password);
  const row = [username, hashed, longName || '', email || '', role || 'admin', now];
  sheet.appendRow(row);
  return { success: true, message: 'เพิ่มผู้ใช้งาน (admin) สำเร็จ' };
}

/* ========== FARMER AGENT MAPPING HELPERS ========== */
function mapFarmerAgentToThai(val) {
  if (val === undefined || val === null) return '';
  const s = String(val).trim().toLowerCase();
  if (s === 'have' || s === 'have_agent' || s === 'มี' || s === 'มีตัวแทน') return 'มีตัวแทน';
  if (s === 'none' || s === 'no' || s === 'ไม่มี' || s === 'ยังไม่มีตัวแทน') return 'ยังไม่มีตัวแทน';
  return String(val);
}

/* ========== SHEET A: writeSheetA ========== */
function writeSheetA(formData, sessionToken) {
  try {
    const session = validateSessionToken(sessionToken);
    if (!session) throw new Error('กรุณาล็อกอินใหม่');

    Object.keys(formData || {}).forEach(k => { if (typeof formData[k] === 'string') formData[k] = sanitizeInput(formData[k]); });

    const requiredFields = [
      'a-long-affiliation', 'a-fullname', 'a-id',
      'a-long-receive-mineral-date', 'a-long-receive-mineral-amount',
      'a-long-receive-nano-date', 'a-long-receive-nano-amount'
    ];
    for (const f of requiredFields) {
      if (!formData[f] || String(formData[f]).trim() === '') throw new Error(`ข้อมูลไม่ครบถ้วน: ${f}`);
    }

    const mineralAmount = parseInt(formData['a-long-receive-mineral-amount'], 10);
    const nanoAmount = parseFloat(formData['a-long-receive-nano-amount']);
    if (isNaN(mineralAmount) || mineralAmount <= 0) throw new Error("จำนวนแร่ต้องเป็นตัวเลขที่มากกว่า 0");
    if (isNaN(nanoAmount) || nanoAmount <= 0) throw new Error("จำนวนนาโนต้องเป็นตัวเลขที่มากกว่า 0");

    checkRateLimit(session.username);

    const sessionLongNorm = normalizeLongName(session.longName || '');
    const formLongNorm = normalizeLongName(formData['a-long-affiliation'] || '');
    let isAuthorized = (sessionLongNorm === formLongNorm);

    if (!isAuthorized && session.username) {
      const mappedLong = getLongNameFromUsers(session.username);
      if (mappedLong) {
        const mappedNorm = normalizeLongName(mappedLong);
        if (mappedNorm === formLongNorm) {
          isAuthorized = true;
          session.longName = mappedLong;
        } else if (normalizeLongName(session.username) === formLongNorm) {
          isAuthorized = true;
        }
      } else {
        if (normalizeLongName(session.username) === formLongNorm) isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      logAction('unauthorized_writeSheetA', session.username, {
        sessionLong: session.longName,
        sessionLongNorm: sessionLongNorm,
        sessionUsername: session.username,
        formLong: formData['a-long-affiliation'],
        formLongNorm: formLongNorm
      });
      throw new Error('สิทธิ์ไม่เพียงพอสำหรับการบันทึกข้อมูลตัวแทนนี้ — ตรวจสอบว่าชื่อตัวแทนในฟอร์มตรงกับชื่อที่ใช้ล็อกอิน (long_name) หรือกับ username ในชีต Users');
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID_A);
    const sheet = ss.getSheetByName(SHEET_A_NAME);
    if (!sheet) throw new Error(`ไม่พบชีตชื่อ "${SHEET_A_NAME}"`);

    if (sheet.getLastRow() === 0) {
      const headers = [
        "เวลา",
        "ตัวแทนที่สังกัด", "ชื่อ-นามสกุล", "รหัสเกษตรกร",
        "ตำบล", "อำเภอ", "จังหวัด",
        "เบอร์ติดต่อฉุกเฉิน", "gps_x", "gps_y",
        "ขนาดแปลง", "ชนิดพืช",
        "วันที่ตัวแทนรับแร่", "จำนวนแร่ที่ตัวแทนรับ",
        "วันที่ตัวแทนรับนาโน", "จำนวนนาโนที่ตัวแทนรับ",
        "วันที่เกษตรกรรับแร่", "จำนวนกระสอบ", "วันที่เกษตรกรรับนาโน", "จำนวนนาโน_ลิตร",
        "ค่าไมทราไจนีน", "สารเคมีที่ผ่านมา",
        "ผู้บันทึก", "หมายเหตุ_ภาคสนาม"
      ];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#E8F5E9');
    }

    const mineralDateFormatted = formatDateToDDMMYYYY(formData['a-long-receive-mineral-date']);
    const nanoDateFormatted = formatDateToDDMMYYYY(formData['a-long-receive-nano-date']);
    const dateCollectFormatted = formatDateToDDMMYYYY(formData['a-datecollect']);
    const dateNanoFormatted = formatDateToDDMMYYYY(formData['a-datenano']);

    const newRow = [
      new Date(),
      formData['a-long-affiliation'] || '',
      formData['a-fullname'] || '',
      formData['a-id'] || '',
      formData['a-address-tambon'] || '',
      formData['a-address-amphoe'] || '',
      formData['a-address-province'] || '',
      formData['a-emergency'] || '',
      formData['a-gpsx'] || '',
      formData['a-gpsy'] || '',
      String(formData['a-plotsize'] || '0'),
      formData['a-cropspecies'] || '',
      mineralDateFormatted || formData['a-long-receive-mineral-date'] || '',
      String(mineralAmount),
      nanoDateFormatted || formData['a-long-receive-nano-date'] || '',
      String(nanoAmount),
      dateCollectFormatted || formData['a-datecollect'] || '',
      String(formData['a-sackcollect'] || '0'),
      dateNanoFormatted || formData['a-datenano'] || '',
      String(formData['a-nanoliters'] || '0'),
      String(formData['a-premitra'] || '0'),
      formData['a-recentchem'] || '',
      formData['a-recorder'] || '',
      formData['a-onsitenotes'] || ''
    ];

    sheet.getRange(sheet.getLastRow() + 1, 1, 1, newRow.length).setValues([newRow]);
    const lastRow = sheet.getLastRow();

    // Ensure phone columns are stored as text using helper
    try {
      applyPhoneColumnsAsText(sheet, lastRow, {
        "เบอร์ติดต่อฉุกเฉิน": formData['a-emergency']
      });

      // fallback: if headers slightly different, use flexible finder
      const telIdx = findHeaderIndexFlexible(sheet, ['เบอร์โทร', 'เบอร์ โทร', 'โทรศัพท์', 'tel']);
      if (telIdx >= 0) setPhoneCellAsText(sheet, lastRow, telIdx + 1, formData['a-phone']);
      const emIdx = findHeaderIndexFlexible(sheet, ['เบอร์ติดต่��ฉุกเฉิน', 'เบอร์ติดต่อ', 'ฉุกเฉิน']);
      if (emIdx >= 0) setPhoneCellAsText(sheet, lastRow, emIdx + 1, formData['a-emergency']);
    } catch (e) {
      // ignore
    }

    logAction('writeSheetA', session.username, { farmerId: formData['a-id'], long: formData['a-long-affiliation'] });

    return { success: true, message: "บันทึกข้อมูลสำเร็จ", data: { row: lastRow } };
  } catch (error) {
    console.error('Error in writeSheetA:', error);
    return { success: false, message: `Error: ${error.message}` };
  }
}

/* ========== SHEET B: writeSheetB ========== */
function writeSheetB(formData, sessionToken) {
  try {
    // Allow anonymous usage for Sheet B (Use View)
    let session = validateSessionToken(sessionToken);
    const username = session ? session.username : 'anonymous';

    checkRateLimit(username);

    if (!formData || !formData['b-long-affiliation']) throw new Error('ข้อมูลไมครบถ้วน: ต้องระบุตัวแทนที่สังกัด');
    const longName = String(formData['b-long-affiliation']).trim();
    if (!SHEET_B_NAMES.includes(longName)) throw new Error('ข้อมูลไม่ถูกต้อง: ไม่พบตัวแทนในระบบ');

    Object.keys(formData).forEach(k => { if (typeof formData[k] === 'string') formData[k] = sanitizeInput(formData[k]); });

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID_B);
    let sheet = ss.getSheetByName(longName);
    if (!sheet) {
      sheet = ss.insertSheet(longName);
      const headers = [
        "เวลา", "ตัวแทนที่สังกัด", "รหัสเกษตรกร", "ชื่อ-นามสกุล", "เบอร์โทร",
        "การใช้ปุ๋ย", "การใช้นาโน", "การใช้แร่",
        "ค่าไมทราไจนีนหลังใช้", "อัตราการใช้แร่", "อัตราการใช้แร่_ปรับ", "อัตราการใช้นาโน", "อัตราการใช้นาโน_ปรับ",
        "ค่าไมทราไจนีน_หลัง", "ผู้บันทึก"
      ];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setBackground("#4f46e5").setFontColor("white").setFontWeight("bold");
    }

    let fertilizerText = '-';
    let nanoText = '-';
    let mineralText = '-';
    if (formData['b-fertilizer-usage'] && Array.isArray(formData['b-fertilizer-usage'])) fertilizerText = formatUsageToText(formData['b-fertilizer-usage'], 'fertilizer');
    if (formData['b-nano-usage'] && Array.isArray(formData['b-nano-usage'])) nanoText = formatUsageToText(formData['b-nano-usage'], 'nano');
    if (formData['b-mineral-usage'] && Array.isArray(formData['b-mineral-usage'])) mineralText = formatUsageToText(formData['b-mineral-usage'], 'mineral');

    const newRow = [
      new Date(),
      formData['b-long-affiliation'] || '',
      formData['b-farmer-id'] || '',
      formData['b-fullname'] || '',
      formData['b-phone'] || '',
      fertilizerText,
      nanoText,
      mineralText,
      formData['b-premitra'] || '',
      formData['b-rate'] || '',
      formData['b-rate-adjusted'] || '',
      formData['b-nano-rate'] || '',
      formData['b-nano-rate-adjusted'] || '',
      '',
      formData['b-recorder'] || ''
    ];

    sheet.appendRow(newRow);
    const lastRow = sheet.getLastRow();

    // Ensure phone in column 'เบอร์โทร' stored as text using helper
    try {
      applyPhoneColumnsAsText(sheet, lastRow, {
        "เบอร์โทร": formData['b-phone']
      });
      const telIdx = findHeaderIndexFlexible(sheet, ['เบอร์โทร', 'โทรศัพท์', 'เบอร์ โทร']);
      if (telIdx >= 0) setPhoneCellAsText(sheet, lastRow, telIdx + 1, formData['b-phone']);
    } catch (e) {}

    logAction('writeSheetB', formData['b-recorder'] || 'unknown', { long: formData['b-long-affiliation'], farmerId: formData['b-farmer-id'] });

    return { success: true, message: `บันทึกข้อมูลการใช้สำเร็จในชีต ${longName}`, data: { row: lastRow, sheet: longName } };
  } catch (error) {
    console.error('Error in writeSheetB:', error);
    return { success: false, message: "เกิดข้อผิดพลาด: " + error.message };
  }
}

/* helper to format usage arrays into readable lines */
function formatUsageToText(usageArray, type) {
  if (!usageArray || !Array.isArray(usageArray) || usageArray.length === 0) return '-';
  const texts = [];
  usageArray.forEach(item => {
    if (!item || typeof item !== 'object') return;
    const dateStr = formatDateToDDMMYYYY(item.date || '');
    if (type === 'fertilizer') {
      // รองรับทั้งรูปแบบเก่าและใหม่
      if (item.date && item.type) {
        texts.push(`(${dateStr || item.date}, ${item.type})`);
      }
    } else if (type === 'nano') {
      if (item.date && item.amount) texts.push(`(${dateStr || item.date}, ${item.amount} ลิตร)`);
    } else if (type === 'mineral') {
      if (item.date && item.amount) texts.push(`(${dateStr || item.date}, ${item.amount} กิโลกรัม)`);
    }
  });
  return texts.length > 0 ? texts.join('\n') : '-';
}

/* ========== createNewSheetForLong / search functions ========== */
function createNewSheetForLong(longName) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID_B);
    if (!SHEET_B_NAMES.includes(longName)) {
      return { success: false, message: `ชีต "${longName}" ไม่ได้อยู่ในรายชื่อชีตที่ได้รับอนุญาต`, exists: false };
    }
    let sheet = ss.getSheetByName(longName);
    if (!sheet) {
      sheet = ss.insertSheet(longName);
      const headers = [
        "เวลา", "ตัวแทนที่สังกัด", "รหัสเกษตรกร", "ชื่อ-นามสกุล", "เบอร์โทร",
        "การใช้ปุ๋ย", "การใช้นาโน", "การใช้แร่",
        "ค่าไมทราไจนีนหลังใช้", "อัตราการใช้แร่", "อัตราการใช้แร่_ปรับ", "อัตราการใช้นาโน", "อัตราการใช้นาโน_ปรับ",
        "ค��าไมทราไจนีน_หลัง", "ผู้บันทึก"
      ];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setBackground("#4f46e5").setFontColor("white").setFontWeight("bold");
    }
    return { success: true, message: `ชีต "${longName}" พร้อมใช้งาน`, exists: true, lastRow: sheet.getLastRow() };
  } catch (error) {
    console.error('Error in createNewSheetForLong:', error);
    return { success: false, message: "เกิดข้อผิดพลาด: " + error.message, exists: false };
  }
}

function searchFarmerData(longAffiliation, farmerId) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID_A);
    const sheet = ss.getSheetByName(SHEET_A_NAME);
    if (!sheet || sheet.getLastRow() <= 1) return { success: false, message: "ไม่พบข้อมูล", data: [] };
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idIndex = headers.indexOf('รหัสเกษตรกร');
    const longIndex = headers.indexOf('ตัวแทนที่สังกัด');
    const foundData = [];
    if (idIndex === -1 || longIndex === -1) return { success: false, message: "โครงสร้างชีตไม่ถูกต้อง", data: [] };
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rowId = String(row[idIndex] || '').trim();
      const rowLong = String(row[longIndex] || '').trim();
      if (rowId === farmerId && rowLong === longAffiliation) {
        const obj = {};
        headers.forEach((h, idx) => obj[h] = row[idx]);
        foundData.push(obj);
      }
    }
    return { success: true, message: foundData.length > 0 ? "พบข้อมูล" : "ไม่พบข้อมูล", data: foundData };
  } catch (error) {
    console.error('searchFarmerData error:', error);
    return { success: false, message: error.message, data: [] };
  }
}

function getAllFarmersByLong(longName, sessionToken) {
  try {
    // 1. Security Check
    const session = validateSessionToken(sessionToken);
    if (!session) {
      console.warn(`Unauthorized access attempt to getAllFarmersByLong: ${longName}`);
      return { success: false, message: "กรุณาล็อกอินใหม่ (Session expired or invalid)", data: [] };
    }

    // 2. Authorization Check (Horizontal Privilege)
    // - Admin can access any long
    // - Standard user can ONLY access if their longName matches request
    const sessionLongNorm = normalizeLongName(session.longName || '');
    const requestLongNorm = normalizeLongName(longName || '');
    
    // Check if user is admin (using cached helper or session flag if available, but verify against trusted source)
    const canAccessAny = isAdminUsername(session.username); 
    
    if (!canAccessAny && sessionLongNorm !== requestLongNorm) {
        // Double check mapping via Users sheet
        const mappedLong = getLongNameFromUsers(session.username);
        const mappedLongNorm = normalizeLongName(mappedLong || '');
        
        if (mappedLongNorm !== requestLongNorm) {
             console.warn(`Forbidden access: User ${session.username} (Long: ${session.longName}) tried to access ${longName}`);
             return { success: false, message: "คุณไม่มีสิทธิ์เข้าถึงข้อมูลของตัวแทนนี้", data: [] };
        }
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID_A);
    const sheet = ss.getSheetByName(SHEET_A_NAME);
    if (!sheet || sheet.getLastRow() <= 1) return { success: true, message: "ไม่พบข้อมูลเกษตรกร", data: [] };
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    // Log headers for debugging
    Logger.log('getAllFarmersByLong headers: ' + JSON.stringify(headers));
    
    // Flexible header matching - check multiple possible column names
    let longIndex = headers.indexOf('ตัวแทนที่สังกัด');
    if (longIndex === -1) longIndex = headers.indexOf('a-long-affiliation');
    if (longIndex === -1) longIndex = headers.indexOf('ล้งที่สังกัด');
    if (longIndex === -1) longIndex = headers.indexOf('ตัวแทน');
    if (longIndex === -1) longIndex = headers.indexOf('ล้ง');
    if (longIndex === -1) longIndex = headers.indexOf('Long');
    if (longIndex === -1) longIndex = headers.indexOf('long_name');
    
    // Try findHeaderIndexFlexible as last resort
    if (longIndex === -1) {
      longIndex = findHeaderIndexFlexible(sheet, ['ตัวแทนที่สังกัด', 'a-long-affiliation', 'ล้งที่สังกัด', 'ตัวแทน', 'ล้ง']);
    }
    
    if (longIndex === -1) {
      Logger.log('getAllFarmersByLong: Could not find long column. Available headers: ' + JSON.stringify(headers));
      return { success: false, message: "ไม่พบคอลัมน์ ตัวแทนที่สังกัด (Headers: " + headers.slice(0, 5).join(', ') + "...)", data: [] };
    }
    
    const farmers = [];
    // requestLongNorm already declared above at line 1011
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rowLong = String(row[longIndex] || '').trim();
      const rowLongNorm = normalizeLongName(rowLong);
      
      // Match both original and normalized values
      if (rowLong === longName || rowLongNorm === requestLongNorm) {
        const obj = {};
        headers.forEach((h, idx) => obj[h] = row[idx]);
        farmers.push(obj);
      }
    }
    return { success: true, message: `พบ ${farmers.length} รายการ`, data: farmers };
  } catch (error) {
    console.error('getAllFarmersByLong error:', error);
    return { success: false, message: "เกิดข้อผิดพลาด: " + error.message, data: [] };
  }
}

function searchSheetBData(longAffiliation, farmerId) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID_B);
    const sheet = ss.getSheetByName(longAffiliation);
    if (!sheet) return { success: false, message: `ไม่พบชีต: ${longAffiliation}`, data: [] };
    if (sheet.getLastRow() <= 1) return { success: true, message: "ไม่พบข้อมูลการใช้ในชีตนี้", data: [] };
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const farmerIdIndex = headers.indexOf('รหัสเกษตรกร');
    if (farmerIdIndex === -1) return { success: false, message: "โครงสร้างชีตไม่ถูกต้อง", data: [] };
    const found = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rowFarmerId = String(row[farmerIdIndex] || '').trim();
      if (rowFarmerId === farmerId) {
        const info = {
          'รหัสเกษตรกร': rowFarmerId,
          'ชื่อ-นามสกุล': row[headers.indexOf('ชื่อ-นามสกุล')] || '',
          'เบอร์โทร': row[headers.indexOf('เบอร์โทร')] || '',
          'การใช้ปุ๋ย': row[headers.indexOf('การใช้ปุ๋ย')] || '',
          'การใช้นาโน': row[headers.indexOf('การใช้นาโน')] || '',
          'การใช้แร่': row[headers.indexOf('การใช้แร่')] || ''
        };
        found.push(info);
      }
    }
    return { success: true, message: found.length > 0 ? "ค้นหาสำเร็จ" : "ไม่พบข้อมูลการใช้", data: found };
  } catch (error) {
    console.error('searchSheetBData error:', error);
    return { success: false, message: "เกิดข้อผิดพลาด: " + error.message, data: [] };
  }
}

/* ========== USER / AUTH (updated to check UserAdmin) ========== */
/**
 * Updated userLogin: check UserAdmin first (hashed) then regular Users (supports migration).
 * - If stored password starts with HASH_PREFIX, compare hash.
 * - If stored password is plaintext and matches, migrate stored value to hashed form.
 */
function userLogin(username, password) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID_A);

    // --------- 1) Check UserAdmin sheet (admin users) ----------
    const adminSheet = ss.getSheetByName(USER_ADMIN_SHEET_NAME);
    if (adminSheet) {
      const adminData = adminSheet.getDataRange().getValues();
      if (adminData && adminData.length > 1) {
        const headers = adminData[0].map(h => String(h).toLowerCase());
        const usernameIndex = headers.indexOf("username");
        const passwordIndex = headers.indexOf("password");
        const longNameIndex = headers.indexOf("long_name");
        if (usernameIndex !== -1 && passwordIndex !== -1) {
          const providedHash = HASH_PREFIX + computePasswordHash(password);
          for (let i = 1; i < adminData.length; i++) {
            const row = adminData[i];
            const storedUser = String(row[usernameIndex] || '').trim();
            let storedPass = String(row[passwordIndex] || '').trim();
            if (storedUser === username) {
              // If stored is hashed
              if (storedPass.indexOf(HASH_PREFIX) === 0) {
                if (storedPass === providedHash) {
                  const longName = longNameIndex !== -1 ? String(row[longNameIndex] || '').trim() : username;
                  const token = generateSessionToken(username, longName);
                  logAction('login_success_admin', username, { longName: longName });
                  return { success: true, message: "ล็อกอินสำเร็จ", longName: longName, username: username, token: token, isAdmin: true };
                } else {
                  // mismatch
                  Utilities.sleep(300);
                  logAction('login_failed_admin', username, { reason: 'invalid_credentials' });
                  return { success: false, message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" };
                }
              } else {
                // stored plaintext - allow migration: if matches, store hashed version
                if (storedPass === password) {
                  // migrate: update cell with hashed value
                  try {
                    adminSheet.getRange(i + 1, passwordIndex + 1).setValue(providedHash);
                    logAction('migrate_admin_password', username, { row: i + 1 });
                  } catch (e) { Logger.log('Migration write failed: ' + e); }
                  const longName = longNameIndex !== -1 ? String(row[longNameIndex] || '').trim() : username;
                  const token = generateSessionToken(username, longName);
                  logAction('login_success_admin', username, { migrated: true, longName: longName });
                  return { success: true, message: "ล็อกอินสำเร็จ", longName: longName, username: username, token: token, isAdmin: true };
                } else {
                  Utilities.sleep(300);
                  logAction('login_failed_admin', username, { reason: 'invalid_credentials' });
                  return { success: false, message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" };
                }
              }
            }
          }
        }
      }
    }

    // --------- 2) Check regular Users sheet (support hashed migration) ----------
    const userSheet = ss.getSheetByName("Users");
    if (!userSheet) return { success: false, message: "ไม่พบฐานข้อมูลผู้ใช้ในระบบ" };
    const data = userSheet.getDataRange().getValues();
    if (data.length < 2) return { success: false, message: "ยังไม่มีข้อมูลผู้ใช้ในระบบ" };
    const headers = data[0].map(h => String(h).toLowerCase());
    const usernameIndex = headers.indexOf("username");
    const passwordIndex = headers.indexOf("password");
    const longNameIndex = headers.indexOf("long_name");
    if (usernameIndex === -1 || passwordIndex === -1) return { success: false, message: "โครงสร้างฐานข้อมูลผู้ใช้ไม่ถูกต้อง" };

    const providedHash = HASH_PREFIX + computePasswordHash(password);

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const storedUser = String(row[usernameIndex] || '').trim();
      let storedPass = String(row[passwordIndex] || '').trim();
      if (storedUser === username) {
        if (storedPass.indexOf(HASH_PREFIX) === 0) {
          // hashed stored
          if (storedPass === providedHash) {
            const longName = longNameIndex !== -1 ? String(row[longNameIndex] || '').trim() : username;
            const token = generateSessionToken(username, longName);
            logAction('login_success', username, { longName: longName });
            return { success: true, message: "ล็อกอินสำเร็จ", longName: longName, username: username, token: token, isAdmin: false };
          } else {
            Utilities.sleep(300);
            logAction('login_failed', username, { reason: 'invalid_credentials' });
            return { success: false, message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" };
          }
        } else {
          // plaintext stored, allow login and migrate
          if (storedPass === password) {
            // migrate to hashed
            try {
              userSheet.getRange(i + 1, passwordIndex + 1).setValue(providedHash);
              logAction('migrate_user_password', username, { row: i + 1 });
            } catch (e) { Logger.log('Migration write failed: ' + e); }
            const longName = longNameIndex !== -1 ? String(row[longNameIndex] || '').trim() : username;
            const token = generateSessionToken(username, longName);
            logAction('login_success', username, { migrated: true, longName: longName });
            return { success: true, message: "ล็อกอินสำเร็จ", longName: longName, username: username, token: token, isAdmin: false };
          } else {
            Utilities.sleep(300);
            logAction('login_failed', username, { reason: 'invalid_credentials' });
            return { success: false, message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" };
          }
        }
      }
    }

    Utilities.sleep(300);
    logAction('login_failed', username, { reason: 'not_found' });
    return { success: false, message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" };

  } catch (error) {
    console.error('userLogin error:', error);
    logAction('login_error', username, { error: error.message });
    return { success: false, message: "เกิดข้อผิดพลาดในการล็อกอิน: " + error.message };
  }
}

/* ========== SPECIES: BUILD PER-STEM COLUMNS ========== */
function buildSpeciesColumns(data) {
  const res = {
    combined: "-",
    redDetails: "-",
    redTotal: 0,
    whiteDetails: "-",
    whiteTotal: 0,
    greenDetails: "-",
    greenTotal: 0
  };
  
  // Validate input
  if (!data || typeof data !== 'object') return res;
  if (!data.species || typeof data.species !== 'object') return res;

  const details = { red: [], white: [], green: [] };
  const totals = { red: 0, white: 0, green: 0 };

  ['red', 'white', 'green'].forEach(stem => {
    const group = data.species[stem];
    if (!group || typeof group !== 'object') return;
    
    Object.keys(group).forEach(varName => {
      const count = Number(group[varName]) || 0;
      // Validate count is reasonable using constant
      if (count > 0 && count <= MAX_SPECIES_COUNT) {
        const safeName = String(varName).substring(0, MAX_SPECIES_NAME_LENGTH); // Limit name length using constant
        details[stem].push(`${safeName}: ${count} ต้น`);
        totals[stem] += count;
      }
    });
  });

  res.redDetails = details.red.length ? details.red.join(', ') : '-';
  res.whiteDetails = details.white.length ? details.white.join(', ') : '-';
  res.greenDetails = details.green.length ? details.green.join(', ') : '-';
  res.redTotal = totals.red;
  res.whiteTotal = totals.white;
  res.greenTotal = totals.green;

  const combinedParts = [];
  if (details.red.length) combinedParts.push(`ก้านแดง - ${details.red.join(', ')}`);
  if (details.white.length) combinedParts.push(`ก้านขาว - ${details.white.join(', ')}`);
  if (details.green.length) combinedParts.push(`ก้านเขียว - ${details.green.join(', ')}`);
  
  if (data.other_varieties) {
    const othersRaw = String(data.other_varieties).substring(0, 500); // Limit length
    const others = othersRaw.split(',').map(s => s.trim()).filter(Boolean);
    if (others.length) combinedParts.push(`อื่นๆ: ${others.join(', ')}`);
  }
  
  if (data.special_species_name) {
    const specialName = String(data.special_species_name).substring(0, 200);
    combinedParts.push(`ข้ามสายพันธุ์: ${specialName}`);
  }

  res.combined = combinedParts.length ? combinedParts.join(', ') : '-';
  return res;
}

/* ========== SURVEY / PREVIEW (Slides) ========== */
function formatSpeciesDataFromFrontend(data) {
  return buildSpeciesColumns(data).combined;
}

function replacePlaceholdersInPresentation(presentation, data) {
  const safe = (v) => (v !== undefined && v !== null && v !== "") ? String(v) : "-";

  if (data.plant_date) data.plant_date = formatDateToDDMMYYYY(data.plant_date);
  // ensure individual GAP/GACP dates are formatted (these fields are expected normalized by submitForm)
  if (data.gap_start_date) data.gap_start_date = formatDateToDDMMYYYY(data.gap_start_date);
  if (data.gap_end_date) data.gap_end_date = formatDateToDDMMYYYY(data.gap_end_date);
  if (data.gacp_start_date) data.gacp_start_date = formatDateToDDMMYYYY(data.gacp_start_date);
  if (data.gacp_end_date) data.gacp_end_date = formatDateToDDMMYYYY(data.gacp_end_date);

  const gapRange = (data.gap_start_date || data.gap_end_date) ? `${formatDateToDDMMYYYY(data.gap_start_date)||'-'} — ${formatDateToDDMMYYYY(data.gap_end_date)||'-'}` : '';
  const gacpRange = (data.gacp_start_date || data.gacp_end_date) ? `${formatDateToDDMMYYYY(data.gacp_start_date)||'-'} — ${formatDateToDDMMYYYY(data.gacp_end_date)||'-'}` : '';
  const rainyRange = monthRangeText(data.rainy_start_month, data.rainy_end_month);
  const dryRange = monthRangeText(data.dry_start_month, data.dry_end_month);
  const winterRange = monthRangeText(data.winter_start_month, data.winter_end_month);

  const farmerAgentThai = mapFarmerAgentToThai(data.farmer_agent);
  const sp = buildSpeciesColumns(data);

  const safeGap = data.gap_status || '';
  const safeGacp = data.gacp_status || '';
  const safeContract = data.contract_status || '';
  const safeSubstance = data.substance_status || '';

  const formattedData = {
    farmer_name_main: safe(data.farmer_name_main),
    farmer_firstname: safe(data.farmer_firstname),
    farmer_lastname: safe(data.farmer_lastname),
    farmer_agent: safe(farmerAgentThai),
    agent_name: safe(data.agent_name),
    // Use getPhoneNumberAsText for preview/display only (do NOT write this formatted value to Sheets)
    tel: safe(getPhoneNumberAsText(data.tel) || data.tel || "-"),
    coord_x: safe(data.coord_x),
    coord_y: safe(data.coord_y),
    subdistrict: safe(data.subdistrict),
    district: safe(data.district),
    province: safe(data.province),
    land_evidence: safe(data.land_evidence),
    tree_count: safe(data.tree_count),
    total_tree_count_specified: safe(data.total_tree_count_specified),
    plant_date: safe(data.plant_date),
    ready_to_sell_count: safe(data.ready_to_sell_count),
    past_land_values: Array.isArray(data.past_land_values) ? data.past_land_values.join(', ') : safe(data.past_land_values),
    past_other_text: safe(data.past_other_text),
    water_system_display: safe(data.water_system_display),
    fertilizer_display: safe(data.fertilizer_display),
    hormone_and_other: safe(data.hormone_and_other),
    mineral_volcanic: safe(data.mineral_volcanic),
    water_ph: safe(data.water_ph),
    soil_ph: safe(data.soil_ph),
    substance_status: safe(safeSubstance),
    substance_value: safe(data.substance_value),
    dry_season: safe(dryRange),
    rainy_season: safe(rainyRange),
    winter_season: safe(winterRange),
    gap_status: safe(safeGap),
    gap_start_date: safe(data.gap_start_date),
    gap_end_date: safe(data.gap_end_date),
    gap_range: safe(gapRange),
    gacp_status: safe(safeGacp),
    gacp_start_date: safe(data.gacp_start_date),
    gacp_end_date: safe(data.gacp_end_date),
    gacp_range: safe(gacpRange),
    contract_status: safe(safeContract),
    species_summary: safe(sp.combined),
    red_details: safe(sp.redDetails),
    red_total: safe(sp.redTotal),
    white_details: safe(sp.whiteDetails),
    white_total: safe(sp.whiteTotal),
    green_details: safe(sp.greenDetails),
    green_total: safe(sp.greenTotal),
    other_varieties: safe(data.other_varieties),
    special_species_name: safe(data.special_species_name),
    coordinator_name: safe(data.coordinator_name),
    // Coordinator tel formatted for preview only
    coordinator_tel: safe(getPhoneNumberAsText(data.coordinator_tel) || data.coordinator_tel || "-")
  };

  const slides = presentation.getSlides();
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const shapes = slide.getShapes();
    for (let j = 0; j < shapes.length; j++) {
      const shape = shapes[j];
      if (typeof shape.getText !== 'function') continue;
      let textRange;
      try { textRange = shape.getText(); } catch (e) { continue; }
      if (!textRange) continue;
      for (const key in formattedData) {
        try {
          textRange.replaceAllText(`{{${key}}}`, formattedData[key]);
        } catch (e) {
          Logger.log(`replaceAllText error on slide ${i} shape ${j} key ${key}: ${e}`);
        }
      }
    }
  }
}

function generatePreviewPdf(data) {
  const safeName = (val) => val ? val : "";
  const templateFile = DriveApp.getFileById(SLIDE_TEMPLATE_ID);
  const presentationName = "PREVIEW_Temp_" + safeName(data.farmer_name_main || data.farmer_name || "");
  const slideCopyFile = templateFile.makeCopy(presentationName);
  const presentation = SlidesApp.openById(slideCopyFile.getId());
  replacePlaceholdersInPresentation(presentation, data);
  presentation.saveAndClose();
  const file = DriveApp.getFileById(slideCopyFile.getId());
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { Logger.log("setSharing failed: " + e); }
  const pdfUrl = "https://docs.google.com/presentation/d/" + slideCopyFile.getId() + "/export/pdf";
  return { pdfUrl: pdfUrl, fileId: slideCopyFile.getId() };
}

/* ========== SURVEY: submitForm (complete) ========== */
function submitForm(data) {
  try {
    const safe = (v) => (v !== undefined && v !== null) ? v : "";

    // --- (ต้นทางของฟังก์ชันไม่เปลี่ยน) ---
    if (data) {
      if (data.farmer_firstname) data.farmer_firstname = String(data.farmer_firstname).trim();
      if (data.farmer_lastname) data.farmer_lastname = String(data.farmer_lastname).trim();
      if (data.farmer_name_main) data.farmer_name_main = String(data.farmer_name_main).trim();

      if ((data.farmer_firstname && data.farmer_firstname !== '') || (data.farmer_lastname && data.farmer_lastname !== '')) {
        data.farmer_name_main = `${data.farmer_firstname || ''} ${data.farmer_lastname || ''}`.trim();
      } else if (data.farmer_name_main && data.farmer_name_main !== '') {
        const parts = String(data.farmer_name_main).split(/\s+/);
        if (parts.length >= 2) {
          data.farmer_lastname = parts.pop();
          data.farmer_firstname = parts.join(' ');
        } else {
          data.farmer_firstname = data.farmer_name_main;
          data.farmer_lastname = data.farmer_lastname || '';
        }
      } else {
        data.farmer_firstname = data.farmer_firstname || '';
        data.farmer_lastname = data.farmer_lastname || '';
        data.farmer_name_main = data.farmer_name_main || '';
      }
    }

    if (data.plant_date) data.plant_date = formatDateToDDMMYYYY(data.plant_date);
    if (data.gap_start_date) data.gap_start_date = formatDateToDDMMYYYY(data.gap_start_date);
    if (data.gap_end_date) data.gap_end_date = formatDateToDDMMYYYY(data.gap_end_date);
    if (data.gacp_start_date) data.gacp_start_date = formatDateToDDMMYYYY(data.gacp_start_date);
    if (data.gacp_end_date) data.gacp_end_date = formatDateToDDMMYYYY(data.gacp_end_date);

    data.farmer_agent = mapFarmerAgentToThai(data.farmer_agent);
    if (data.gap_status === 'yes') data.gap_status = 'มี';
    else if (data.gap_status === 'no') data.gap_status = 'ไม่มี';
    if (data.gacp_status === 'yes') data.gacp_status = 'มี';
    else if (data.gacp_status === 'no') data.gacp_status = 'ไม่มี';
    if (data.contract_status === 'old') data.contract_status = 'ติดสัญญาเก่า';
    else if (data.contract_status === 'none') data.contract_status = 'ไม่ติดสัญญาเก่า';
    if (data.substance_status === 'checked') data.substance_status = 'ตรวจแล้ว';
    else if (data.substance_status === 'not_checked') data.substance_status = 'ยังไม่ตรวจ';

    const rainyRange = monthRangeText(data.rainy_start_month, data.rainy_end_month);
    const dryRange = monthRangeText(data.dry_start_month, data.dry_end_month);
    const winterRange = monthRangeText(data.winter_start_month, data.winter_end_month);

    const sp = buildSpeciesColumns(data);
    const pastLand = Array.isArray(data.past_land_values) ? data.past_land_values.join(', ') : (data.past_land_values || '');

    const row = [
      new Date(),
      safe(data.farmer_agent),
      safe(data.agent_name),
      safe(data.farmer_firstname),
      safe(data.farmer_lastname),
      safe(data.farmer_name_main),
      safe(data.tel),               // <-- will be forced to TEXT after append
      safe(data.coord_x),
      safe(data.coord_y),
      safe(data.subdistrict),
      safe(data.district),
      safe(data.province),
      safe(data.land_evidence),
      safe(data.tree_count),
      safe(data.total_tree_count_specified),
      safe(data.plant_date),
      safe(data.ready_to_sell_count),
      pastLand,
      safe(data.past_other_text),
      safe(data.water_system_display),
      safe(data.fertilizer_display),
      safe(data.water_ph),
      safe(data.soil_ph),
      safe(data.hormone_and_other),
      safe(data.mineral_volcanic),
      safe(data.substance_status),
      safe(data.substance_value),
      safe(dryRange),
      safe(rainyRange),
      safe(winterRange),
      safe(data.gap_status),
      safe(data.gap_start_date),
      safe(data.gap_end_date),
      safe(data.gacp_status),
      safe(data.gacp_start_date),
      safe(data.gacp_end_date),
      safe(data.contract_status),
      sp.combined,
      safe(data.other_varieties),
      safe(data.special_species_name),
      sp.redDetails,
      sp.redTotal,
      sp.whiteDetails,
      sp.whiteTotal,
      sp.greenDetails,
      sp.greenTotal,
      safe(data.coordinator_name),
      safe(data.coordinator_tel)
    ];

    const ss = SpreadsheetApp.openById(SURVEY_SPREADSHEET_ID);
    let sheet = ss.getSheetByName(SURVEY_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(SURVEY_SHEET_NAME);
      const headers = [
        "เวลา",
        "สถานะตัวแทน","ชื่อตัวแทน","ชื่อจริง","นามสกุล","ชื่อเกษตรกร","เบอร์โทร",
        "พิกัด_X","พิกัด_Y","ตำบล","อำเภอ","จังหวัด",
        "หลักฐานที่ดิน","จำนวนต้น","จำนวนรวมจากสายพันธุ์","วันที่ปลูก","จำนวนต้นพร้อมขาย",
        "ประวัติพื้นที่_3ปี","ประวัติพื้นที่_อื่นๆ","ระบบให้น้ำ","วิธีให้ปุ๋ย","ค่า PH น้ำ","ค่า PH ดิน","ฮอร์โมน_อื่นๆ",
        "แร่ภูเขาไฟ","สถานะสารไมทราไจนีน","ค่าสารไมทราไจนีน","ฤดูแล้ง","ฤดูฝน","ฤดูหนาว",
        "GAP_สถานะ","GAP_เริ่ม","GAP_หมดอายุ",
        "GACP_สถานะ","GACP_เริ่ม","GACP_หมดอายุ",
        "สถานะสัญญา",
        "สรุปสายพันธุ์","สายพันธุ์อื่นๆ","ข้ามสายพันธุ์",
        "ก้านแดง_รายละเอียด","ก้านแดง_จำนวนรวม",
        "ก้านขาว_รายละเอียด","ก้านขาว_จำนวนรวม",
        "ก้านเขียว_รายละเอียด","ก้านเขียว_จำนวนรวม",
        "ผู้ประสานงาน","เบอร์ผู้ประสานงาน"
      ];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#E8F5E9');
    }

    // append row normally
    sheet.appendRow(row);
    const lastRow = sheet.getLastRow();

    // --- Ensure phone columns are stored as TEXT (this is the decisive step) ---
    try {
      // 1) try to use existing apply helper (matches exact header names)
      applyPhoneColumnsAsText(sheet, lastRow, {
        "เบอร์โทร": data.tel,
        "เบอร์ผู้ประสานงาน": data.coordinator_tel
      });

      // 2) More robust fallbacks using flexible header search and fixed-position fallback
      const telIdx = findHeaderIndexFlexible(sheet, ['เบอร์โทร', 'โทรศัพท์', 'เบอร์ โทร', 'phone']);
      if (telIdx >= 0) {
        setPhoneCellAsText(sheet, lastRow, telIdx + 1, data.tel);
      } else {
        // In the header layout we created, เบอร์โทร is the 7th column (1-based)
        setPhoneCellAsText(sheet, lastRow, 7, data.tel);
      }

      const coordIdx = findHeaderIndexFlexible(sheet, ['เบอร์ผู้ประสานงาน', 'เบอร์ ผู้ประสานงาน', 'เบอร์ผู้ประสาน', 'เบอร์ ประสาน']);
      if (coordIdx >= 0) {
        setPhoneCellAsText(sheet, lastRow, coordIdx + 1, data.coordinator_tel);
      } else {
        // fallback to last column since coordinator_tel is written at end of row
        setPhoneCellAsText(sheet, lastRow, sheet.getLastColumn(), data.coordinator_tel);
      }
    } catch (e) {
      Logger.log('submitForm phone write fallback error: ' + e.message);
    }

    try { logAction('submitForm', data.coordinator_name || data.agent_name || 'anonymous', { farmer: data.farmer_name_main, row: lastRow }); } catch (e) {}

    // สร้าง preview PDF (unchanged)
    const pdfInfo = generatePreviewPdf(data);

    return `บันทึกข้อมูลเรียบร้อยแล้ว (แถวที่ ${lastRow})`;
  } catch (error) {
    console.error('submitForm error:', error);
    throw new Error("เกิดข้อผิดพลาดในการบันทึกแบบฟอร์ม: " + error.message);
  }
}

/* ========== ADMIN / HELPERS (new admin endpoints) ========== */

/**
 * Admin: return all farmers across SheetA
 * @param {string} token session token
 */
function getAllFarmers(token) {
  try {
    console.log('getAllFarmers called');
    
    const session = validateSessionToken(token);
    if (!session) return { success: false, message: 'Unauthorized' };
    
    // Validate token freshness (re-check in case of replay attacks)
    const tokenAge = Date.now() - (session.timestamp || 0);
    if (tokenAge > TOKEN_EXPIRY_MS) {
      return { success: false, message: 'Token expired' };
    }
    
    if (!isAdminUsername(session.username)) {
      logAction('admin_access_denied', session.username, { function: 'getAllFarmers', reason: 'not_admin' });
      return { success: false, message: 'Forbidden: not admin' };
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID_A);
    const sheet = ss.getSheetByName(SHEET_A_NAME);
    if (!sheet || sheet.getLastRow() <= 1) {
      logAction('admin_get_all_farmers', session.username, { result: 'empty', rows: 0 });
      return { success: true, message: 'ไม่มีข้อมูล', data: [] };
    }

    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const out = [];
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const obj = {};
      headers.forEach((h, idx) => {
        let value = row[idx];
        
        // แปลง Date objects เป็น string เพื่อให้ส่งผ่าน JSON ได้
        if (Object.prototype.toString.call(value) === '[object Date]') {
          if (!isNaN(value.getTime())) {
            value = value.toISOString(); // หรือใช้ value.toLocaleDateString('th-TH') สำหรับรูปแบบไทย
          } else {
            value = ''; // Invalid date
          }
        }
        
        // จัดการค่า null/undefined
        if (value === null || value === undefined) {
          value = '';
        }
        
        obj[h] = value;
      });
      out.push(obj);
    }
    
    console.log('getAllFarmers returning', out.length, 'records');
    logAction('admin_get_all_farmers', session.username, { result: 'success', rows: out.length });
    return { success: true, message: `พบ ${out.length} รายการ`, data: out };
    
  } catch (e) {
    console.error('getAllFarmers error:', e);
    logAction('admin_get_all_farmers', session && session.username, { result: 'error', error: e.message });
    return { success: false, message: 'เกิดข้อผิดพลาด: ' + e.message };
  }
}

/**
 * Admin: return all usage records from SPREADSHEET_ID_B (aggregate all sheets)
 * @param {string} token session token
 */
function getAllUsage(token) {
  try {
    const session = validateSessionToken(token);
    if (!session) return { success: false, message: 'Unauthorized' };
    
    // Validate token freshness (re-check in case of replay attacks)
    const tokenAge = Date.now() - (session.timestamp || 0);
    if (tokenAge > TOKEN_EXPIRY_MS) {
      return { success: false, message: 'Token expired' };
    }
    
    if (!isAdminUsername(session.username)) return { success: false, message: 'Forbidden: not admin' };

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID_B);
    const sheets = ss.getSheets();
    const aggregated = [];

    sheets.forEach(sheet => {
      const sheetName = sheet.getName();
      const values = sheet.getDataRange().getValues();
      if (!values || values.length < 2) return;
      
      const headers = values[0];
      for (let i = 1; i < values.length; i++) {
        const row = values[i];
        const obj = { _sheet: sheetName };
        headers.forEach((h, idx) => {
          let value = row[idx];
          
          // แปลง Date objects เป็น string
          if (Object.prototype.toString.call(value) === '[object Date]') {
            if (!isNaN(value.getTime())) {
              value = value.toISOString();
            } else {
              value = '';
            }
          }
          
          if (value === null || value === undefined) {
            value = '';
          }
          
          obj[h] = value;
        });
        aggregated.push(obj);
      }
    });

    return { success: true, message: `รวม ${aggregated.length} รายการ`, data: aggregated };
  } catch (e) {
    console.error('getAllUsage error:', e);
    return { success: false, message: 'เกิดข้อผิดพลาด: ' + e.message };
  }
}


function adminDebugSession(token) {
  try {
    const out = { tokenPresent: !!token, tokenPreview: token ? token.substring(0,40) : null, session: null, isAdminSheetCheck: false, farmersCall: null };
    out.session = validateSessionToken(token) || null;
    out.isAdminSheetCheck = out.session ? isAdminUsername(out.session.username) : false;
    try { out.farmersCall = getAllFarmers(token); } catch (e) { out.farmersCall = { error: String(e) }; }
    return out;
  } catch (e) {
    return { error: String(e) };
  }
}

function testAdminAccess(token) {
  console.log('=== testAdminAccess START ===');
  
  try {
    const result = {
      timestamp: new Date().toISOString(),
      step1_tokenPresent: !!token,
      step2_sessionValid: false,
      step3_isAdmin: false,
      step4_spreadsheetAccess: false,
      step5_sheetAccess: false,
      step6_dataAccess: null,
      details: {},
      error: null
    };
    
    console.log('Testing with token present:', result.step1_tokenPresent);
    
    if (!token) {
      result.error = 'No token provided';
      console.log('-> No token, returning early');
      return result;
    }
    
    // Step 1: Validate session token
    console.log('Step 1: Validating session token...');
    const session = validateSessionToken(token);
    result.step2_sessionValid = !!session;
    
    if (session) {
      result.details.sessionUser = session.username;
      result.details.sessionLongName = session.longName;
      console.log('   Session valid for user:', session.username);
    } else {
      result.error = 'Session token validation failed';
      console.log('   Session validation failed');
      return result;
    }
    
    // Step 2: Check admin status
    console.log('Step 2: Checking admin status...');
    const isAdmin = isAdminUsername(session.username);
    result.step3_isAdmin = isAdmin;
    console.log('   Is admin:', isAdmin);
    
    if (!isAdmin) {
      result.error = `User ${session.username} is not admin`;
      console.log('   Not admin, returning early');
      return result;
    }
    
    // Step 3: Test spreadsheet access
    console.log('Step 3: Testing spreadsheet access...');
    try {
      const ss = SpreadsheetApp.openById(SPREADSHEET_ID_A);
      result.step4_spreadsheetAccess = true;
      console.log('   Spreadsheet access successful');
      
      // Get available sheets
      const sheets = ss.getSheets();
      result.details.availableSheets = sheets.map(s => s.getName());
      console.log('   Available sheets:', result.details.availableSheets);
      
      // Step 4: Test specific sheet access
      console.log('Step 4: Testing sheet access for:', SHEET_A_NAME);
      const sheet = ss.getSheetByName(SHEET_A_NAME);
      result.step5_sheetAccess = !!sheet;
      
      if (sheet) {
        console.log('   Sheet found, getting dimensions...');
        const lastRow = sheet.getLastRow();
        const lastCol = sheet.getLastColumn();
        
        result.step6_dataAccess = {
          lastRow: lastRow,
          lastCol: lastCol,
          hasData: lastRow > 1
        };
        
        console.log('   Sheet dimensions:', result.step6_dataAccess);
        
        // Try to call getAllFarmers directly
        console.log('Step 5: Testing getAllFarmers function...');
        const farmersResult = getAllFarmers(token);
        result.details.getAllFarmersTest = {
          success: farmersResult ? farmersResult.success : false,
          message: farmersResult ? farmersResult.message : 'NULL returned',
          dataCount: farmersResult && farmersResult.data ? farmersResult.data.length : 'NO DATA'
        };
        console.log('   getAllFarmers result:', result.details.getAllFarmersTest);
        
      } else {
        result.error = `Sheet '${SHEET_A_NAME}' not found`;
        console.log('   Sheet not found');
      }
      
    } catch (e) {
      result.step4_spreadsheetAccess = false;
      result.error = `Spreadsheet access failed: ${e.message}`;
      console.log('   Spreadsheet access error:', e.message);
    }
    
    console.log('=== testAdminAccess END ===');
    console.log('Final result:', result);
    return result;
    
  } catch (e) {
    console.error('=== testAdminAccess ERROR ===');
    console.error(e);
    return { 
      error: e.message, 
      details: e.toString(),
      stack: e.stack 
    };
  }
}

/**
 * ทดสอบการเข้าถึง spreadsheet อย่างง่าย
 */
function testSpreadsheetAccess() {
  try {
    const results = {};
    
    // Test Spreadsheet A
    try {
      const ssA = SpreadsheetApp.openById(SPREADSHEET_ID_A);
      results.spreadsheetA = {
        success: true,
        sheets: ssA.getSheets().map(s => s.getName()),
        targetSheet: SHEET_A_NAME,
        targetSheetExists: !!ssA.getSheetByName(SHEET_A_NAME)
      };
    } catch (e) {
      results.spreadsheetA = {
        success: false,
        error: e.message
      };
    }
    
    // Test Spreadsheet B
    try {
      const ssB = SpreadsheetApp.openById(SPREADSHEET_ID_B);
      results.spreadsheetB = {
        success: true,
        sheets: ssB.getSheets().map(s => s.getName())
      };
    } catch (e) {
      results.spreadsheetB = {
        success: false,
        error: e.message
      };
    }
    
    return results;
  } catch (e) {
    return { error: e.message };
  }
}

/* ========== ADMIN / UTILITIES ========== */
function generateSecureSecretKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
  let result = '';
  for (let i = 0; i < 64; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  Logger.log('New SECRET_KEY: ' + result);
  return result;
}
function setupSecretKey() {
  const newKey = generateSecureSecretKey();
  PropertiesService.getScriptProperties().setProperty('SECRET_KEY', newKey);
  Logger.log('Saved SECRET_KEY to Script Properties');
  return newKey;
}
function testSheetAccess() {
  try {
    const ssA = SpreadsheetApp.openById(SPREADSHEET_ID_A);
    const sheetA = ssA.getSheetByName(SHEET_A_NAME);
    const ssB = SpreadsheetApp.openById(SPREADSHEET_ID_B);
    const sheetsB = ssB.getSheets();
    return { success: true, message: "✅ การเข้าถึง Google Sheets ทำงานปกติ", sheetA: { name: SHEET_A_NAME, lastRow: sheetA ? sheetA.getLastRow() : 0, exists: !!sheetA }, sheetB: { totalSheets: sheetsB.length, sheetNames: sheetsB.map(s => s.getName()), lastRows: sheetsB.map(s => s.getLastRow()) } };
  } catch (error) {
    return { success: false, message: "❌ เกิดข้อผิดพลาด: " + error.message };
  }
}
function clearRateLimit(username) {
  const cache = CacheService.getScriptCache();
  if (username) { cache.remove(`rate_limit_${username}`); Logger.log(`Cleared rate limit for ${username}`); }
  else {
    const keys = cache.getKeys();
    if (keys && keys.length) keys.forEach(k => { if (k && k.indexOf('rate_limit_') === 0) cache.remove(k); });
    Logger.log('Cleared all rate limit keys');
  }
}


/* ========== DATA MIGRATION: convert existing phone columns to TEXT ========== */
/**
 * convertExistingSurveyPhones
 * - Run manually once (from Apps Script Editor -> select function -> Run) to convert
 *   existing numeric phone values in the survey sheet to TEXT (preserving leading zeros).
 * - It will try to find the "เบอร์โทร" and "เบอร์ผู้ประสานงาน" columns flexibly,
 *   then rewrite each non-empty cell using setPhoneCellAsText (adds apostrophe + sets NumberFormat '@').
 */
function convertExistingSurveyPhones() {
  try {
    const ss = SpreadsheetApp.openById(SURVEY_SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SURVEY_SHEET_NAME);
    if (!sheet) return { success: false, message: 'ไม่พบชีต Survey' };
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow <= 1) return { success: true, message: 'ไม่มีข้อมูลให้แปลง' };

    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());
    const telIdx = findHeaderIndexFlexible(sheet, ['เบอร์โทร', 'โทรศัพท์', 'phone']);
    const coordIdx = findHeaderIndexFlexible(sheet, ['เบอร์ผู้ประสานงาน', 'เบอร์ ผู้ประสานงาน', 'ผู้ประสานงาน เบอร์']);
    const changes = { tel: 0, coord: 0 };

    for (let r = 2; r <= lastRow; r++) {
      try {
        if (telIdx >= 0) {
          const v = sheet.getRange(r, telIdx + 1).getValue();
          if (v !== '' && v !== null && String(v || '').trim() !== '') {
            setPhoneCellAsText(sheet, r, telIdx + 1, String(v));
            changes.tel++;
          }
        }
        if (coordIdx >= 0) {
          const v2 = sheet.getRange(r, coordIdx + 1).getValue();
          if (v2 !== '' && v2 !== null && String(v2 || '').trim() !== '') {
            setPhoneCellAsText(sheet, r, coordIdx + 1, String(v2));
            changes.coord++;
          }
        }
      } catch (e) {
        // continue
      }
    }

    return { success: true, message: 'เสร็จสิ้น', changes: changes };
  } catch (e) {
    return { success: false, message: e.message };
  }
}


// ---------- DEBUG HELPERS ----------
function testPing() {
  // simple test to confirm google.script.run can call the server
  return { ok: true, msg: 'pong', now: new Date().toString() };
}

function testSheetAccessPublic() {
  // call your existing testSheetAccess() wrapper if present (already in your Code.gs)
  try {
    return testSheetAccess();
  } catch (e) {
    return { success: false, message: 'testSheetAccess exception: ' + String(e) };
  }
}

// Safe debug version of getAllFarmers that returns only headers and first 3 rows (no Dates converted)
function getAllFarmersDebug(token) {
  try {
    const session = validateSessionToken(token);
    if (!session) return { success: false, message: 'Unauthorized (debug)' };
    
    // Validate token freshness
    const tokenAge = Date.now() - (session.timestamp || 0);
    if (tokenAge > TOKEN_EXPIRY_MS) {
      return { success: false, message: 'Token expired (debug)' };
    }
    
    if (!isAdminUsername(session.username)) return { success: false, message: 'Forbidden: not admin (debug)' };

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID_A);
    const sheet = ss.getSheetByName(SHEET_A_NAME);
    if (!sheet || sheet.getLastRow() <= 1) return { success: true, message: 'ไม่มีข้อมูล (debug)', data: [] };

    const range = sheet.getDataRange();
    const values = range.getValues();
    const headers = values[0].map(h => String(h || ''));
    const out = [];
    for (let i = 1; i < Math.min(values.length, 4); i++) { // only first 3 rows for safety
      const row = values[i];
      const obj = {};
      headers.forEach((h, idx) => {
        let v = row[idx];
        // convert Dates to ISO string to avoid serialization issues
        if (Object.prototype.toString.call(v) === '[object Date]') {
          v = isNaN(v.getTime()) ? '' : v.toISOString();
        }
        obj[h] = v;
      });
      out.push(obj);
    }
    return { success: true, message: `debug: returning ${out.length} rows`, data: out, headers: headers };
  } catch (e) {
    Logger.log('getAllFarmersDebug error: ' + e);
    return { success: false, message: 'Exception (debug): ' + String(e) };
  }
}

/* ========== GACP BACKEND ========== */
function saveGACPData(gacpState, sessionToken) {
  try {
    const session = validateSessionToken(sessionToken);
    if (!session) throw new Error('กรุณาล็อกอินใหม่');
    
    checkRateLimit(session.username);

    // Validate inputs
    if (!gacpState || !gacpState.farmerInfo) throw new Error('ข้อมูลไม่ถูกต้อง');

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID_GACP);
    let sheet = ss.getSheetByName(SHEET_GACP_NAME);
    
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_GACP_NAME);
      const headers = [
        "timestamp", 
        "recorded_by", 
        "farmer_fullname", 
        "farmer_location",
        "farmer_gps",
        "has_representative",
        "representative_name",
        "progress_percent",
        "overall_status",
        "full_json_data"
      ];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#10b981').setFontColor('white');
    }
    
    // Derived data
    const info = gacpState.farmerInfo || {};
    const fullName = (info.firstName || '') + ' ' + (info.lastName || '');
    
    const row = [
      new Date(),
      session.username,
      fullName.trim(),
      info.location || '',
      info.gps || '',
      info.hasRepresentative ? 'Yes' : 'No',
      info.representativeName || '',
      (gacpState.checkData ? calculateGACPProgressServer(gacpState.checkData) : 0),
      calculateGACPStatusServer(gacpState.checkData),
      JSON.stringify(gacpState)
    ];
    
    sheet.appendRow(row);
    
    return { success: true, message: 'บันทึกข้อมูล GACP สำเร็จ' };
    
  } catch (e) {
    Logger.log('saveGACPData error: ' + e.message);
    return { success: false, message: 'เกิดข้อผิดพลาด: ' + e.message };
  }
}

function calculateGACPProgressServer(checkData) {
    if (!checkData) return 0;
    let total = 0;
    let completed = 0;
    for (const key in checkData) {
        if (Array.isArray(checkData[key])) {
            total += checkData[key].length;
            completed += checkData[key].filter(Boolean).length;
        }
    }
    return Math.round((completed / total) * 100) || 0;
}

function calculateGACPStatusServer(checkData) {
    const p = calculateGACPProgressServer(checkData);
    if (p === 100) return 'Passed (Excellent)';
    if (p >= 80) return 'Passed (Basic)';
    return 'Needs Improvement';
}
/* ========== DELIVERY SYSTEM / LOT MANAGEMENT ========== */

function getLotsSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_A);
  let sheet = ss.getSheetByName(SHEET_LOTS_NAME);
  
  // Expanded Headers Definition
  const standardHeaders = [
    "lot_id", "state", "source", "agent_id", "farmer_id", "created_at", "updated_at",
    "data_json", "history_json", "risk_score", "risk_flags", "is_active",
    // New Process Columns
    "harvest_date", "harvest_details",
    "receive_date", "receive_details",
    "sorting_date", "sorting_details",
    "cleaning_date", "cleaning_details",
    "drying_date", "drying_details",
    "grinding_date", "grinding_details",
    "packing_date", "packing_details",
    "shipping_date", "shipping_details"
  ];

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_LOTS_NAME);
    sheet.getRange(1, 1, 1, standardHeaders.length).setValues([standardHeaders])
         .setFontWeight('bold')
         .setBackground('#ffe0b2');
  } else {
    // Migration Logic: Check and Append Missing Columns
    const lastCol = sheet.getLastColumn();
    if (lastCol > 0) {
      const currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h));
      const missingHeaders = [];
      
      standardHeaders.forEach(h => {
        if (!currentHeaders.includes(h)) {
          missingHeaders.push(h);
        }
      });
      
      if (missingHeaders.length > 0) {
        sheet.getRange(1, lastCol + 1, 1, missingHeaders.length)
             .setValues([missingHeaders])
             .setFontWeight('bold')
             .setBackground('#e0f7fa'); // Light cyan for new cols
      }
    }
  }
  return sheet;
}

function createLot(data, sessionToken) {
  try {
    const session = validateSessionToken(sessionToken);
    if (!session) throw new Error('กรุณาล็อกอินใหม่');

    const sheet = getLotsSheet();
    const now = new Date();
    // Generate simple Lot ID: LOT-YYYYMMDD-XXXX
    const dateStr = Utilities.formatDate(now, "GMT+7", "yyyyMMdd");
    const uniquePart = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    const lotId = `LOT-${dateStr}-${uniquePart}`;
    
    // Initial State: PENDING (Wait for "Harvest" completion to become HARVESTED? 
    // Or starts as HARVESTED if they click "Start Harvest"? 
    // Spec says: "Start Harvest" -> Lot (Pending). "End Harvest" -> State HARVESTED.
    
    // Allow custom initial state (e.g. for agents skipping harvest)
    const initialState = data.initial_state || "PENDING";
    
    const initialData = {
      ...data,
      created_by: session.username,
      timeline: [{ state: initialState, timestamp: now.getTime(), user: session.username, action: "create" }]
    };
    
    // Extended fields support (No schema change, just ensuring JSON stringify captures everything)
    // data should contain: farmer_id, farmer_name, province, district, species, time_slot, container_size, etc.
    
    // Dynamic Row Construction based on Headers
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const row = new Array(headers.length).fill("");
    
    // Fill Standard Columns
    const setCol = (name, val) => {
      const idx = headers.indexOf(name);
      if (idx > -1) row[idx] = val;
    };
    
    // Determine Source Type
    let sourceType = data.source_type; 
    if (!sourceType) {
        // Fallback inference
        if (initialState === 'PENDING') sourceType = 'harvest';
        else if (initialState === 'RECEIVED') sourceType = 'receive';
        else sourceType = 'harvest'; // Default
    }
    
    // Lock source type into data
    initialData.source = sourceType;

    setCol("lot_id", lotId);
    setCol("state", initialState);
    setCol("source", sourceType); // New Column
    setCol("agent_id", data.agent_id || session.username);
    setCol("farmer_id", data.farmer_id || '');
    setCol("created_at", now);
    setCol("updated_at", now);
    setCol("data_json", JSON.stringify(initialData));
    setCol("history_json", JSON.stringify(initialData.timeline));
    setCol("risk_score", 0);
    setCol("risk_flags", "[]");
    setCol("is_active", true);
    
    // Fill Process Columns based on Initial State
    const detailsJson = JSON.stringify(initialData);
    if (initialState === 'PENDING') { // Start Harvest
        setCol("harvest_date", now);
        setCol("harvest_details", detailsJson);
    } else if (initialState === 'RECEIVED') { // Receive Goods
        setCol("receive_date", now);
        setCol("receive_details", detailsJson);
    } 
    // If created as HARVESTED immediately? (Usually goes through Pending -> Update)
    // But if manual create, maybe? Keep simple: PENDING=HarvestStart, RECEIVED=BuyStart.
    
    sheet.appendRow(row);
    
    return { success: true, lot_id: lotId, state: initialState };
    
  } catch(e) {
    return { success: false, message: e.message };
  }
}

function updateLotState(lotId, newState, data, sessionToken) {
  try {
    const session = validateSessionToken(sessionToken);
    if (!session) throw new Error('กรุณาล็อกอินใหม่');

    const sheet = getLotsSheet();
    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();
    const headers = values[0];
    
    // Find Lot
    const idxId = headers.indexOf('lot_id');
    const idxState = headers.indexOf('state');
    const idxData = headers.indexOf('data_json');
    const idxHistory = headers.indexOf('history_json');
    const idxUpdated = headers.indexOf('updated_at');
    const idxRiskScore = headers.indexOf('risk_score');
    const idxRiskFlags = headers.indexOf('risk_flags');
    
    let rowIndex = -1;
    for(let i=1; i<values.length; i++) {
      if(String(values[i][idxId]) === String(lotId)) {
        rowIndex = i + 1;
        break;
      }
    }
    
    if(rowIndex === -1) throw new Error('ไม่พบ Lot ID: ' + lotId);
    
    // Current Data
    const currentDataJson = values[rowIndex-1][idxData];
    let currentData = {};
    try { currentData = JSON.parse(currentDataJson); } catch(e) {}
    
    const currentHistoryJson = values[rowIndex-1][idxHistory];
    let history = [];
    try { history = JSON.parse(currentHistoryJson); } catch(e) {}
    
    // Validate Transition (Basic check, more strict logic can be here)
    // For now, trust the client's requested state, but we log everything.
    
    const now = new Date();
    
    // Merge new data
    const updatedData = { ...currentData, ...data };
    
    // Add to history
    history.push({
      state: newState,
      timestamp: now.getTime(),
      user: session.username,
      action: "update_state",
      details: data
    });
    
    // Calculate Risk (Simple Placeholder Logic)
    let riskScore = 0;
    let riskFlags = [];
    
    // Example: If Output > Input (Mass Balance)
    if (updatedData.qty_harvested && updatedData.qty_sorted_remaining) {
       if (parseFloat(updatedData.qty_sorted_remaining) > parseFloat(updatedData.qty_harvested)) {
         riskScore += 50;
         riskFlags.push("Output > Input (Harvest -> Sort)");
       }
    }

    // Special handling for PACKED State: Generate Sub-Lot/Packet IDs
    if (newState === 'PACKED' && data.packing_unit_count) {
       const packetCount = parseInt(data.packing_unit_count) || 1;
       const subLots = [];
       for (let i = 1; i <= packetCount; i++) {
         const suffix = String(i).padStart(2, '0');
         subLots.push({
           id: `${lotId}-${suffix}`,
           packet_number: i,
           total_packets: packetCount,
           state: 'PACKED',
           weight: data.packing_qty_per_unit || (data.packing_total_weight / packetCount).toFixed(2)
         });
       }
       updatedData.sub_lots = subLots;
    }

    // Special handling for SHIPPED state
    if (newState === 'SHIPPED') {
       // Update all sub-lots to SHIPPED
       if (updatedData.sub_lots && Array.isArray(updatedData.sub_lots)) {
          updatedData.sub_lots = updatedData.sub_lots.map(packet => ({
             ...packet,
             state: 'SHIPPED',
             shipping_info: {
                tracking_number: data.shipping_tracking,
                customer: data.shipping_customer,
                shipped_at: now.getTime()
             }
          }));
       }
    }
    
    // Map State to Columns
    let targetDateCol = "";
    let targetDetailsCol = "";
    
    switch (newState) {
        case 'HARVESTED': targetDateCol = "harvest_date"; targetDetailsCol = "harvest_details"; break;
        case 'SORTED':    targetDateCol = "sorting_date"; targetDetailsCol = "sorting_details"; break;
        case 'CLEANED':   targetDateCol = "cleaning_date"; targetDetailsCol = "cleaning_details"; break;
        case 'DRIED':     targetDateCol = "drying_date";   targetDetailsCol = "drying_details"; break;
        case 'GROUND':    targetDateCol = "grinding_date"; targetDetailsCol = "grinding_details"; break;
        case 'PACKED':    targetDateCol = "packing_date";  targetDetailsCol = "packing_details"; break;
        case 'SHIPPED':   targetDateCol = "shipping_date"; targetDetailsCol = "shipping_details"; break;
    }

    // Update Row
    sheet.getRange(rowIndex, idxState + 1).setValue(newState);
    sheet.getRange(rowIndex, idxData + 1).setValue(JSON.stringify(updatedData));
    sheet.getRange(rowIndex, idxHistory + 1).setValue(JSON.stringify(history)); // Also save history!
    
    sheet.getRange(rowIndex, idxUpdated + 1).setValue(now);
    sheet.getRange(rowIndex, idxRiskScore + 1).setValue(riskScore);
    sheet.getRange(rowIndex, idxRiskFlags + 1).setValue(JSON.stringify(riskFlags));
    
    // Update Specific Process Columns
    if (targetDateCol && targetDetailsCol) {
       const idxDate = headers.indexOf(targetDateCol);
       const idxDetails = headers.indexOf(targetDetailsCol);
       if (idxDate > -1) sheet.getRange(rowIndex, idxDate + 1).setValue(now);
       if (idxDetails > -1) sheet.getRange(rowIndex, idxDetails + 1).setValue(JSON.stringify(data));
    }
    
    return { success: true, state: newState, lot_id: lotId };
    
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * Merge multiple SORTED lots into one COMBINED lot for cleaning
 * @param {Object} data - Contains lot_ids array and cleaning data
 * @param {string} sessionToken - The session token
 */
function updateMultipleLotState(data, sessionToken) {
  try {
    const session = validateSessionToken(sessionToken);
    if (!session) throw new Error('กรุณาล็อกอินใหม่');
    
    const lotIds = data.lot_ids;
    if (!lotIds || !Array.isArray(lotIds) || lotIds.length === 0) {
      throw new Error('ไม่พบรายการ Lot ที่ต้องการรวม');
    }
    
    const sheet = getLotsSheet();
    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();
    const headers = values[0];
    
    const idxId = headers.indexOf('lot_id');
    const idxState = headers.indexOf('state');
    const idxAgentId = headers.indexOf('agent_id');
    const idxFarmerId = headers.indexOf('farmer_id');
    const idxData = headers.indexOf('data_json');
    const idxHistory = headers.indexOf('history_json');
    const idxUpdated = headers.indexOf('updated_at');
    
    const now = new Date();
    
    // Generate new combined lot ID
    const dateStr = Utilities.formatDate(now, "GMT+7", "yyyyMMdd");
    const uniquePart = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    const combinedLotId = `LOT-${dateStr}-CMB-${uniquePart}`;
    
    // Collect data from all source lots
    let sourceLots = [];
    let totalQty = 0;
    let farmerNames = [];
    let farmerIds = [];
    let agentId = '';
    
    for (let i = 1; i < values.length; i++) {
      const lotId = String(values[i][idxId]);
      
      if (lotIds.includes(lotId)) {
        const rowIndex = i + 1;
        
        let currentData = {};
        try { currentData = JSON.parse(values[i][idxData] || '{}'); } catch(e) {}
        
        let history = [];
        try { history = JSON.parse(values[i][idxHistory] || '[]'); } catch(e) {}
        
        sourceLots.push({ lotId, rowIndex, data: currentData, history });
        
        if (currentData.qty_sorted_remaining) {
          totalQty += parseFloat(currentData.qty_sorted_remaining) || 0;
        } else if (currentData.qty_harvested) {
          totalQty += parseFloat(currentData.qty_harvested) || 0;
        }
        
        if (currentData.farmer_name) farmerNames.push(currentData.farmer_name);
        if (values[i][idxFarmerId]) farmerIds.push(values[i][idxFarmerId]);
        if (!agentId && values[i][idxAgentId]) agentId = values[i][idxAgentId];
        
        history.push({
          state: 'MERGED',
          timestamp: now.getTime(),
          user: session.username,
          action: 'merged_to_combined',
          combined_lot_id: combinedLotId
        });
        
        sheet.getRange(rowIndex, idxState + 1).setValue('MERGED');
        sheet.getRange(rowIndex, idxHistory + 1).setValue(JSON.stringify(history));
        sheet.getRange(rowIndex, idxUpdated + 1).setValue(now);
      }
    }
    
    if (sourceLots.length === 0) {
      throw new Error('ไม่พบ Lot ที่ตรงกับรายการที่ระบุ');
    }
    
    const combinedData = {
      source_lots: lotIds,
      source_farmers: [...new Set(farmerNames)].join(', '),
      farmer_name: [...new Set(farmerNames)].join(', '),
      combined_qty_from_sources: totalQty,
      created_by: session.username,
      cleaning_operator: data.cleaning_operator,
      cleaning_method: data.cleaning_method,
      cleaning_qty_per_round: data.cleaning_qty_per_round,
      cleaning_time_per_round: data.cleaning_time_per_round,
      cleaning_round_count: data.cleaning_round_count,
      cleaning_end_time: data.cleaning_end_time,
      is_combined_lot: true,
      timeline: [{ state: 'CLEANED', timestamp: now.getTime(), user: session.username, action: 'combined_cleaning', source_lots: lotIds }]
    };
    
    // Dynamic Row Construction
    // Note: headers variable is already defined earlier from getDataRange()
    const row = new Array(headers.length).fill("");
    
    // Fill Standard Columns
    const setCol = (name, val) => {
      const idx = headers.indexOf(name);
      if (idx > -1) row[idx] = val;
    };
    
    setCol("lot_id", combinedLotId);
    setCol("state", 'CLEANED');
    setCol("agent_id", agentId || session.username);
    setCol("farmer_id", farmerIds.join(','));
    setCol("created_at", now);
    setCol("updated_at", now);
    setCol("data_json", JSON.stringify(combinedData));
    setCol("history_json", JSON.stringify(combinedData.timeline));
    setCol("risk_score", 0);
    setCol("risk_flags", "[]");
    setCol("is_active", true);
    
    // Fill Cleaning Columns
    setCol("cleaning_date", now);
    setCol("cleaning_details", JSON.stringify(combinedData));
    
    sheet.appendRow(row);
    
    return { 
      success: true, 
      message: `รวม ${sourceLots.length} Lot เป็น "${combinedLotId}" สำเร็จ`,
      combined_lot_id: combinedLotId,
      merged_count: sourceLots.length
    };
    
  } catch (e) {
    return { success: false, message: e.message };
  }
}

function getLotData(lotId, sessionToken) {
  try {
    const session = validateSessionToken(sessionToken);
    if (!session) throw new Error('กรุณาล็อกอินใหม่');
    
    const sheet = getLotsSheet();
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idxId = headers.indexOf('lot_id');
    const idxData = headers.indexOf('data_json');
    const idxState = headers.indexOf('state');
    
    for(let i=1; i<data.length; i++) {
      if(String(data[i][idxId]) === String(lotId)) {
        return { 
          success: true, 
          lot_id: lotId,
          state: data[i][idxState],
          data: JSON.parse(data[i][idxData] || '{}') 
        };
      }
    }
    return { success: false, message: 'Not found' };
  } catch (e) {
     return { success: false, message: e.message };
  }
}

function getAdminDashboardData(sessionToken) {
   try {
    const session = validateSessionToken(sessionToken);
    if (!session) throw new Error('กรุณาล็อกอินใหม่');
    
    // Check Admin
    if (!isAdminUsername(session.username)) {
      throw new Error('Access Denied: Admin only');
    }
    
    const sheet = getLotsSheet();
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    // Map headers to keys
    const lots = [];
    for(let i=1; i<data.length; i++) {
      const row = data[i];
      let lot = {};
      headers.forEach((h, idx) => {
        lot[h] = row[idx];
      });
      // Parse JSON fields
      try { lot.data = JSON.parse(lot.data_json); } catch(e) {}
      try { lot.history = JSON.parse(lot.history_json); } catch(e) {}
      try { lot.risk_flags = JSON.parse(lot.risk_flags); } catch(e) {}
      
      delete lot.data_json;
      delete lot.history_json;
      
      lots.push(lot);
    }
    
    return { success: true, lots: lots };
    
   } catch (e) {
     return { success: false, message: e.message };
   }
}

function getAgentLots(sessionToken) {
  try {
    const session = validateSessionToken(sessionToken);
    if (!session) throw new Error('กรุณาล็อกอินใหม่');
    
    const sheet = getLotsSheet();
    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();
    const headers = values[0];
    
    const idxId = headers.indexOf('lot_id');
    const idxState = headers.indexOf('state');
    const idxAgent = headers.indexOf('agent_id');
    const idxUpdated = headers.indexOf('updated_at');
    const idxData = headers.indexOf('data_json');
    const idxRiskScore = headers.indexOf('risk_score');
    const idxHistory = headers.indexOf('history_json');
    
    const lots = [];
    
    // Start from row 1
    for (let i = 1; i < values.length; i++) {
            const agentId = String(values[i][idxAgent]);
      
      // Strict match on username
      if (agentId === session.username) { 
         const row = values[i];
         let dataObj = {};
         try { dataObj = JSON.parse(row[idxData]); } catch(e) {}

         let history = [];
         try { history = JSON.parse(row[idxHistory] || '[]'); } catch(e) {}
         
         lots.push({
           lot_id: row[idxId],
           state: row[idxState],
           updated_at: row[idxUpdated],
           agent_id: row[idxAgent],
           farmer_id: dataObj.farmer_id || '',
           farmer_name: dataObj.farmer_name || '',
           qty_harvested: dataObj.qty_harvested || 0,
           risk_score: row[idxRiskScore] || 0,
           data: dataObj, // Return full data object
           history: history // Return history for robust source checking
         });
      }
    }
    
    // Sort by updated_at desc
    lots.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    
    return { success: true, lots: lots };
    
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * Get unique farmers who have records in Sheet B (Mineral/Nano usage) for a given agent.
 * This is used to populate the farmer dropdown in the Delivery System.
 * Only farmers with existing Sheet B records can be selected.
 */
function getFarmersWithSheetBRecords(longName, sessionToken) {
  try {
    const session = validateSessionToken(sessionToken);
    if (!session) throw new Error('กรุณาล็อกอินใหม่');
    
    if (!longName || !SHEET_B_NAMES.includes(longName)) {
      return { success: false, message: 'ไม่พบชีตตัวแทน: ' + longName };
    }
    
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID_B);
    const sheet = ss.getSheetByName(longName);
    
    if (!sheet || sheet.getLastRow() < 2) {
      return { success: true, data: [], message: 'ไม่พบข้อมูลเกษตรกรในระบบ' };
    }
    
    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(h => String(h || '').toLowerCase().trim());
    
    // Find relevant columns (b-farmer-id is stored as 'รหัสเกษตรกร' or similar)
    const idxFarmerId = headers.findIndex(h => h.includes('รหัสเกษตรกร') || h.includes('farmer') || h.includes('id'));
    const idxFarmerName = headers.findIndex(h => h.includes('ชื่อ') || h.includes('name'));
    
    if (idxFarmerId === -1) {
      Logger.log('getFarmersWithSheetBRecords: Could not find farmer ID column in headers: ' + JSON.stringify(headers));
      return { success: false, message: 'ไม่พบคอลัมน์รหัสเกษตรกร' };
    }
    
    // Extract unique farmers
    const farmerMap = new Map();
    for (let i = 1; i < values.length; i++) {
      const farmerId = String(values[i][idxFarmerId] || '').trim();
      const farmerName = idxFarmerName >= 0 ? String(values[i][idxFarmerName] || '').trim() : '';
      
      if (farmerId && !farmerMap.has(farmerId)) {
        farmerMap.set(farmerId, {
          farmer_id: farmerId,
          farmer_name_main: farmerName
        });
      }
    }
    
    const farmers = Array.from(farmerMap.values());
    
    return { success: true, data: farmers };
    
  } catch (e) {
    Logger.log('getFarmersWithSheetBRecords error: ' + e.message);
    return { success: false, message: e.message };
  }
}

