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
const SHEET_A_NAME = "SheetA";

// New: separate admin users sheet name (in SPREADSHEET_ID_A)
const USER_ADMIN_SHEET_NAME = "UserAdmin";

const SHEET_B_NAMES = [
  "ตัวแทนพี่บาสBDS",
  "ตัวแทนพี่Hunterเวียงแก่น",
  "ตัวแทนพี่ก้ามท่าแค",
  "ตัวแทนพี่กระรอก",
  "ตัวแทนพี่รัชช์เมืองนคร",
  "ตัวแทนพี่ตูนบางขัน",
  "ตัวแทนป๋องส์เมืองพัทลุง",
  "ตัวแทนบจก.จินดารัตน์ โปรดักส์",
  "ตัวแทนพี่ดอน",
  "ตัวแทนพี่เตยพี่เกรซ",
  "ตัวแทนพี่สมพงศ์พะยูนตรัง",
  "ตัวแทนกระท่อมปลอดสารคลองใหม่พัทลุง",
  "ตัวแทนหรั่งนุ้ยพระนคร",
  "ตัวแทนพี่เปรี้ยวหล่มสัก",
  "ตัวแทนพี.เจ.กระท่อมทอง",
  "ตัวแทนทรัพย์มะรุมฟาร์ม",
  "ตัวแทนสวนอิน-จักรภัทร",
  "ตัวแทนรักษ์อุทัย",
  "ตัวแทนพี่วิทย์วิสาหกิจชุมชนชาววัง",
  "ตัวแทนพี่สาโรจน์"
];

const FALLBACK_SECRET_KEY = 'I<1Ph%2Dx*Iu8P)OMQ-9GW]#AIeow5bLm_<x$Akh:$qd3Fx^0Cj*%&{7J!AlW8|-';

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

/* ========== HTML / UI Helpers ========== */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function doPost(e) {
  try {
    const params = e.parameter;
    const functionName = params.function;
    const args = JSON.parse(params.args || '[]');

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
  const fromProps = PropertiesService.getScriptProperties().getProperty('SECRET_KEY');
  return fromProps && fromProps.length ? fromProps : FALLBACK_SECRET_KEY;
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
 * Check if the given username is listed in the UserAdmin sheet.
 * If password provided, optionally verify password too.
 */
function isAdminUsername(username, password) {
  console.log('=== isAdminUsername DEBUG ===');
  console.log('Checking username:', username);
  
  try {
    if (!username) {
      console.log('No username provided');
      return false;
    }
    
    const u = String(username).trim();
    if (!u) {
      console.log('Empty username after trim');
      return false;
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID_A);
    console.log('Spreadsheet opened for admin check');
    
    // 1) Check UserAdmin sheet
    const adminSheet = ss.getSheetByName(USER_ADMIN_SHEET_NAME);
    console.log('UserAdmin sheet found:', !!adminSheet);
    
    if (adminSheet) {
      const data = adminSheet.getDataRange().getValues();
      console.log('UserAdmin sheet has', data ? data.length : 0, 'rows');
      
      if (data && data.length > 1) {
        const headers = data[0].map(h => String(h || '').toLowerCase().trim());
        console.log('UserAdmin headers:', headers);
        
        const idxUser = headers.indexOf('username');
        console.log('Username column index:', idxUser);
        
        if (idxUser !== -1) {
          for (let i = 1; i < data.length; i++) {
            const row = data[i];
            const storedUser = String(row[idxUser] || '').trim();
            console.log('Comparing:', u.toLowerCase(), 'with', storedUser.toLowerCase());
            
            if (storedUser.toLowerCase() === u.toLowerCase()) {
              console.log('Found user in UserAdmin sheet');
              return true;
            }
          }
        }
      }
    }

    // 2) Check Users sheet for role
    console.log('Checking Users sheet for role...');
    const userSheet = ss.getSheetByName("Users");
    
    if (userSheet) {
      const udata = userSheet.getDataRange().getValues();
      console.log('Users sheet has', udata ? udata.length : 0, 'rows');
      
      if (udata && udata.length > 1) {
        const uheaders = udata[0].map(h => String(h || '').toLowerCase().trim());
        console.log('Users headers:', uheaders);
        
        const idxUserU = uheaders.indexOf('username');
        const idxRoleU = uheaders.indexOf('role');
        console.log('Username column:', idxUserU, 'Role column:', idxRoleU);
        
        if (idxUserU !== -1 && idxRoleU !== -1) {
          for (let j = 1; j < udata.length; j++) {
            const row = udata[j];
            const storedUser = String(row[idxUserU] || '').trim();
            const storedRole = String(row[idxRoleU] || '').trim().toLowerCase();
            
            console.log('Checking user:', storedUser, 'role:', storedRole);
            
            if (storedUser && storedUser.toLowerCase() === u.toLowerCase()) {
              if (storedRole === 'admin' || storedRole === 'superadmin') {
                console.log('Found admin role in Users sheet');
                return true;
              }
            }
          }
        }
      }
    }

    // 3) Check hardcoded admin usernames
    const adminUsernames = ['admin', 'administrator', 'superadmin', 'root'];
    if (adminUsernames.includes(u.toLowerCase())) {
      console.log('Found in hardcoded admin list');
      return true;
    }

    console.log('User not found in any admin source');
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
    // SECURITY WARNING: This function is for INITIAL SETUP ONLY!
    // 
    // ⚠️ IMPORTANT SECURITY NOTES:
    // 1. This default password MUST be changed immediately after first use
    // 2. DO NOT use this function in production without changing the password
    // 3. For production deployments, use PropertiesService to store passwords securely:
    //    PropertiesService.getScriptProperties().setProperty('ADMIN_PASSWORD', 'your_secure_password')
    // 4. Consider implementing a proper bootstrap/initialization flow
    //
    // Better approach for production:
    // const password = PropertiesService.getScriptProperties().getProperty('ADMIN_INITIAL_PASSWORD');
    // if (!password) throw new Error('ADMIN_INITIAL_PASSWORD not set in Script Properties');
    
    const DEFAULT_PASSWORD = 'CHANGE_ME_IMMEDIATELY';
    
    Logger.log('⚠️ WARNING: Using default admin password - MUST be changed!');
    const result = addAdminUser('admin', DEFAULT_PASSWORD, 'ผู้ดูแลระบบหลัก', 'admin@example.com', 'superadmin');
    
    if (result.success) {
        console.warn('🔒 CRITICAL SECURITY NOTICE:');
        console.warn('   1. Change the admin password IMMEDIATELY');
        console.warn('   2. Use the admin panel or call: addAdminUser("admin", "YOUR_SECURE_PASSWORD", ...)');
        console.warn('   3. For production, use Script Properties for password storage');
        console.warn('   4. Delete this function after initial setup is complete');
    }
    
    return result;
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
  if (s === 'none' || s === 'no' || s === 'ไม่ม���' || s === 'ยังไม่มีตัวแทน') return 'ยังไม่มีตัวแทน';
  return String(val);
}

/* ========== SHEET A: writeSheetA ========== */
function writeSheetA(formData, sessionToken) {
  try {
    const session = validateSessionToken(sessionToken);
    if (!session) throw new Error('กรุณาล็อกอินใหม่');

    Object.keys(formData || {}).forEach(k => { if (typeof formData[k] === 'string') formData[k] = sanitizeInput(formData[k]); });

    const requiredFields = [
      'a-long-affiliation', 'a-fullname', 'a-phone', 'a-id',
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
        "ตัวแทนที่สังกัด", "ชื่อ-นามสกุล", "เบอร์โทร", "รหัสเกษตรกร",
        "ตำบล", "อำเภอ", "จังหวัด",
        "เบอร์ติดต่อฉุกเฉิน", "gps_x", "gps_y",
        "ขนาดแปลง", "ชนิดพืช", "ระบบให้น้ำ", "ระบบให้น้ำ_อื่นๆ",
        "วิธีให้ปุ๋ย", "วิธีให้ปุ๋ย_อื่นๆ",
        "วันที่ตัวแทนรับแร่", "จำนวนแร่ที่ตัวแทนรับ",
        "วันที่ตัวแทนรับนาโน", "จำนวนนาโนที่ตัวแทนรับ",
        "วันที่เกษตรกรรับแร่", "จำนวนกระสอบ", "วันที่เกษตรกรรับนาโน", "จำนวนนาโน_ลิตร",
        "ค่าไมทราไจนีน", "สารเคมีที่ผ่านมา", "ยินยอม_ตัวอย่าง", "ยินยอม_ข้อมูล",
        "ผู้บันทึก", "หมายเหตุ_ภาคสนาม", "ลายเซ็นยืนยัน"
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
      formData['a-phone'] || '',
      formData['a-id'] || '',
      formData['a-address-tambon'] || '',
      formData['a-address-amphoe'] || '',
      formData['a-address-province'] || '',
      formData['a-emergency'] || '',
      formData['a-gpsx'] || '',
      formData['a-gpsy'] || '',
      String(formData['a-plotsize'] || '0'),
      formData['a-cropspecies'] || '',
      formData['a-watering'] || '',
      formData['a-watering-other-text'] || '',
      formData['a-fertilizer-method'] || '',
      formData['a-fertilizer-other-text'] || '',
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
      formData['a-consent-sample'] || '',
      formData['a-consent-data'] || '',
      formData['a-recorder'] || '',
      formData['a-onsitenotes'] || '',
      formData['a-signature'] || ''
    ];

    sheet.getRange(sheet.getLastRow() + 1, 1, 1, newRow.length).setValues([newRow]);
    const lastRow = sheet.getLastRow();

    // Ensure phone columns are stored as text using helper
    try {
      applyPhoneColumnsAsText(sheet, lastRow, {
        "เบอร์โทร": formData['a-phone'],
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
function writeSheetB(formData) {
  try {
    if (!formData || !formData['b-long-affiliation']) throw new Error('ข้อมูลไม���ครบถ้วน: ต้องระบุตัวแทนที่สังกัด');
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
      if (item.date && item.type) texts.push(`(${dateStr || item.date}, ${item.type})`);
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

function getAllFarmersByLong(longName) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID_A);
    const sheet = ss.getSheetByName(SHEET_A_NAME);
    if (!sheet || sheet.getLastRow() <= 1) return { success: true, message: "ไม่พบข้อมูลเกษตรกร", data: [] };
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const longIndex = headers.indexOf('ตัวแทนที่สังกัด');
    if (longIndex === -1) return { success: false, message: "ไม่พบคอลัมน์ ตัวแทนที่สังกัด", data: [] };
    const farmers = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rowLong = String(row[longIndex] || '').trim();
      if (rowLong === longName) {
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
    if (!isAdminUsername(session.username)) return { success: false, message: 'Forbidden: not admin' };

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID_A);
    const sheet = ss.getSheetByName(SHEET_A_NAME);
    if (!sheet || sheet.getLastRow() <= 1) return { success: true, message: 'ไม่มีข้อมูล', data: [] };

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
    return { success: true, message: `พบ ${out.length} รายการ`, data: out };
    
  } catch (e) {
    console.error('getAllFarmers error:', e);
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

function getAllMerged(token) {
  try {
    const session = validateSessionToken(token);
    if (!session) return { success: false, message: 'Unauthorized' };
    if (!isAdminUsername(session.username)) return { success: false, message: 'Forbidden: not admin' };

    // Get farmers data (แปลง Date แล้ว)
    const farmersResult = getAllFarmers(token);
    if (!farmersResult.success) return farmersResult;
    const farmers = farmersResult.data || [];

    // Get usage data (แปลง Date แล้ว)  
    const usageResult = getAllUsage(token);
    if (!usageResult.success) return usageResult;
    const usageData = usageResult.data || [];

    // Build usage map
    const usageMap = {};
    usageData.forEach(usage => {
      const long = usage._sheet || '';
      const farmerId = String(usage['รหัสเกษตรกร'] || '').trim();
      if (!farmerId) return;
      
      const key = `${long}__${farmerId}`;
      const existing = usageMap[key];
      
      // ใช้เวลาปัจจุบันสำหรับการเปรียบเทียบ timestamp
      let ts = Date.now();
      const timeValue = usage['เวลา'];
      if (timeValue) {
        if (typeof timeValue === 'string') {
          const parsed = new Date(timeValue);
          if (!isNaN(parsed.getTime())) ts = parsed.getTime();
        } else if (Object.prototype.toString.call(timeValue) === '[object Date]') {
          if (!isNaN(timeValue.getTime())) ts = timeValue.getTime();
        }
      }
      
      usage._timestamp = ts;
      
      if (!existing || (existing._timestamp && usage._timestamp > existing._timestamp)) {
        usageMap[key] = usage;
      }
    });

    // Merge farmers with usage
    const merged = farmers.map(f => {
      const long = String(f['ตัวแทนที่สังกัด'] || '').trim();
      const fid = String(f['รหัสเกษตรกร'] || '').trim();
      const key = `${long}__${fid}`;
      const usage = usageMap[key] || null;
      
      return {
        farmer: f,
        latestUsage: usage
      };
    });

    return { success: true, message: `รวมข้อมูล ${merged.length} รายการ`, data: merged };
  } catch (e) {
    console.error('getAllMerged error:', e);
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
