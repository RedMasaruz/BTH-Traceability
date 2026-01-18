# คู่มือ Deploy แบบแยก Frontend/Backend (Option 2)

## 🎯 ภาพรวม

การ deploy แบบนี้จะแยก:
- **Frontend (PWA)** → GitHub Pages
- **Backend (API)** → Google Apps Script
- **Storage** → Google Sheets

---

## 🏗️ สถาปัตยกรรม

```
┌─────────────────────────────────────────────────────────┐
│  GitHub Pages (Frontend)                                │
│  https://YOUR_USERNAME.github.io/BTH/                   │
│                                                          │
│  • index.html                                           │
│  • manifest.json                                        │
│  • sw.js (Service Worker)                              │
│  • icons/                                               │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ google.script.run API
                     │ (Cross-origin calls)
                     ▼
┌─────────────────────────────────────────────────────────┐
│  Google Apps Script (Backend API)                       │
│  https://script.google.com/macros/s/.../exec           │
│                                                          │
│  • Code.gs (Server functions)                           │
│  • Handles API calls                                    │
│  • Connects to Google Sheets                            │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  Google Sheets (Database)                               │
│  • SheetA (Farmer data)                                 │
│  • SheetB (Usage data)                                  │
│  • Survey data                                          │
└─────────────────────────────────────────────────────────┘
```

---

## 📋 ข้อดี/ข้อเสีย

### ✅ ข้อดี
- **PWA ติดตั้งได้ดีกว่า** - HTTPS + proper origin
- **Custom domain** - ใช้ yourdomain.github.io หรือ domain ของคุณเอง
- **Fast loading** - GitHub Pages มี CDN
- **Version control** - Frontend code อยู่ใน Git
- **Easy updates** - Push code = Auto deploy

### ⚠️ ข้อเสีย  
- **ต้อง deploy 2 ที่** - Frontend และ Backend แยกกัน
- **CORS configuration** - ต้องตั้งค่าให้ถูกต้อง
- **URL แยกกัน** - Frontend URL ≠ Backend URL

---

## 🚀 ขั้นตอนการ Deploy

### Phase 1: Deploy Backend (Google Apps Script)

#### 1.1 เตรียม Google Sheets

ทำตาม **CODE_GS_INSTALLATION.md** ขั้นตอนที่ 1:
- สร้าง 3 Spreadsheets (Main, Usage, Survey)
- ตั้งค่า headers และ permissions

#### 1.2 Deploy Code.gs เป็น Web App

1. ไปที่ [script.google.com](https://script.google.com)
2. สร้าง Project ใหม่: `BTH Backend API`
3. **วาง Code.gs เท่านั้น** (ไม่ต้องวาง index.html)
4. แก้ Spreadsheet IDs:
   ```javascript
   const SPREADSHEET_ID_A = 'YOUR_MAIN_SHEET_ID';
   const SPREADSHEET_ID_B = 'YOUR_USAGE_SHEET_ID';
   const SURVEY_SPREADSHEET_ID = 'YOUR_SURVEY_SHEET_ID';
   ```

5. Deploy:
   - **Deploy** → **New deployment**
   - Type: **Web app**
   - Description: `Backend API v1`
   - Execute as: **Me**
   - Who has access: **Anyone** (สำคัญ! ต้องเป็น Anyone)
   - คลิก **Deploy**

6. **คัดลอก Web App URL:**
   ```
   https://script.google.com/macros/s/AKfycby.../exec
   ```
   **เก็บ URL นี้ไว้!** จะใช้ใน Phase 2

#### 1.3 ทดสอบ Backend API

ลองเปิด URL ที่ได้:
```
https://script.google.com/macros/s/AKfycby.../exec
```

**ควรเห็น:** Error หรือหน้าว่าง (เพราะยังไม่มี Frontend)  
**ถ้าเจอ "Authorization required"** → Run ฟังก์ชันใน Apps Script แล้ว Authorize

---

### Phase 2: Deploy Frontend (GitHub Pages)

#### 2.1 Enable GitHub Pages

1. ไปที่ repository: `https://github.com/YOUR_USERNAME/BTH`
2. **Settings** → **Pages**
3. Source: **Deploy from a branch**
4. Branch: **main** (หรือ branch ที่คุณใช้)
5. Folder: **/ (root)**
6. คลิก **Save**

#### 2.2 รอ Deploy เสร็จ

- ใช้เวลา 1-5 นาที
- ดูสถานะที่ **Actions** tab
- เมื่อเสร็จจะได้ URL:
  ```
  https://YOUR_USERNAME.github.io/BTH/
  ```

#### 2.3 แก้ไข index.html (สำคัญมาก!)

**ปัญหา:** index.html ปัจจุบันถูกออกแบบให้ทำงานกับ Apps Script (มี `google.script.run`)

**วิธีแก้:** สร้างไฟล์ wrapper สำหรับเรียก API แบบ cross-origin

**วิธีที่ 1: ใช้ index.html เดิม (แนะนำ)**

index.html ปัจจุบันจะทำงานได้ถ้า:
1. เปิดผ่าน Apps Script URL → ใช้ `google.script.run` ปกติ
2. เปิดผ่าน GitHub Pages → ต้องเพิ่ม wrapper

แก้โดยเพิ่มโค้ดนี้ใน index.html (ก่อน closing `</head>`):

```html
<!-- CORS Wrapper for GitHub Pages deployment -->
<script>
  // Detect if running on GitHub Pages
  const isGitHubPages = window.location.hostname.includes('github.io');
  const BACKEND_URL = 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec';
  
  if (isGitHubPages && typeof google === 'undefined') {
    // Create mock google.script.run for GitHub Pages
    window.google = {
      script: {
        run: {
          withSuccessHandler: function(successCallback) {
            this._success = successCallback;
            return this;
          },
          withFailureHandler: function(failureCallback) {
            this._failure = failureCallback;
            return this;
          },
          withUserObject: function(userObject) {
            this._userObject = userObject;
            return this;
          }
        }
      }
    };
    
    // Add proxy functions for each backend function
    const backendFunctions = [
      'userLogin', 'writeSheetA', 'writeSheetB', 'submitForm',
      'searchFarmerData', 'getAllFarmersByLong', 'searchSheetBData',
      'createNewSheetForLong', 'getAllFarmers', 'getAllUsage', 'getAllMerged'
    ];
    
    backendFunctions.forEach(funcName => {
      google.script.run[funcName] = function(...args) {
        const self = google.script.run;
        
        // Call backend via fetch
        fetch(BACKEND_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            function: funcName,
            args: JSON.stringify(args)
          })
        })
        .then(response => response.json())
        .then(result => {
          if (self._success) {
            self._success.call(null, result, self._userObject);
          }
        })
        .catch(error => {
          if (self._failure) {
            self._failure.call(null, error, self._userObject);
          }
        });
      };
    });
  }
</script>
```

**แทนที่ `YOUR_SCRIPT_ID`** ด้วย Script ID จาก Backend URL

#### 2.4 อัพเดท Code.gs (Backend) เพื่อรองรับ POST requests

เพิ่มฟังก์ชันนี้ใน Code.gs:

```javascript
/**
 * Handle POST requests from GitHub Pages
 */
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
```

**หมายเหตุ:** วิธีนี้อาจมีปัญหา CORS ต้องทดสอบ

---

### Phase 3: การแก้ปัญหา CORS (ถ้าจำเป็น)

#### ปัญหา CORS

เมื่อเรียก Apps Script จาก GitHub Pages อาจเจอ error:
```
Access to fetch at 'https://script.google.com/...' from origin 
'https://username.github.io' has been blocked by CORS policy
```

#### วิธีแก้ที่ 1: ใช้ JSONP (แนะนำ)

แก้ไข Code.gs:

```javascript
function doGet(e) {
  // Support JSONP callback
  const callback = e.parameter.callback;
  const func = e.parameter.function;
  const args = JSON.parse(e.parameter.args || '[]');
  
  let result;
  try {
    if (typeof this[func] === 'function') {
      result = this[func].apply(this, args);
    } else {
      result = { success: false, message: 'Function not found' };
    }
  } catch (error) {
    result = { success: false, message: error.message };
  }
  
  const output = callback + '(' + JSON.stringify(result) + ')';
  return ContentService.createTextOutput(output)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}
```

แก้ไข Frontend wrapper:

```javascript
google.script.run[funcName] = function(...args) {
  const self = google.script.run;
  const callbackName = 'jsonp_' + Date.now() + '_' + Math.random().toString(36);
  
  window[callbackName] = function(result) {
    if (self._success) {
      self._success.call(null, result, self._userObject);
    }
    delete window[callbackName];
  };
  
  const script = document.createElement('script');
  script.src = BACKEND_URL + 
    '?callback=' + callbackName +
    '&function=' + funcName +
    '&args=' + encodeURIComponent(JSON.stringify(args));
  document.head.appendChild(script);
};
```

#### วิธีแก้ที่ 2: Proxy Server (ทางเลือก)

ใช้ proxy เช่น:
- Cloudflare Workers
- Vercel Serverless Functions
- AWS Lambda

---

## 🔧 Configuration Summary

### ไฟล์ที่ต้องแก้

**1. Code.gs (Backend)**
```javascript
// เพิ่มฟังก์ชันนี้
function doGet(e) {
  // Handle JSONP or return HTML
  if (e.parameter.callback) {
    // JSONP request from GitHub Pages
    return handleJSONP(e);
  } else {
    // Regular request - can return error or redirect
    return HtmlService.createHtmlOutput(
      '<h1>API Endpoint</h1><p>This is the backend API.</p>'
    );
  }
}
```

**2. index.html (Frontend)**
```html
<!-- แก้ไข BACKEND_URL -->
<script>
  const BACKEND_URL = 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec';
  // ... wrapper code ...
</script>
```

**3. manifest.json**
```json
{
  "start_url": "/BTH/",
  "scope": "/BTH/"
}
```

**4. sw.js**
```javascript
const urlsToCache = [
  '/BTH/',
  '/BTH/index.html',
  '/BTH/manifest.json'
];
```

---

## ✅ Testing Checklist

### Backend Testing
- [ ] เปิด Backend URL → เห็นข้อความ API Endpoint
- [ ] ทดสอบ JSONP: `BACKEND_URL?callback=test&function=testPing`
- [ ] ตรวจสอบ permissions → Apps Script มีสิทธิ์ Sheets

### Frontend Testing  
- [ ] เปิด GitHub Pages URL → เห็นหน้า Login
- [ ] เปิด Console (F12) → ไม่มี CORS errors
- [ ] ทดสอบ Login → ส่ง request ไป Backend สำเร็จ
- [ ] ทดสอบบันทึกข้อมูล → เขียนลง Sheets ได้

### PWA Testing
- [ ] Service Worker ลงทะเบียนสำเร็จ
- [ ] Manifest valid (DevTools > Application > Manifest)
- [ ] Install prompt ปรากฏ
- [ ] ติดตั้งบนมือถือได้

---

## 🐛 Troubleshooting

### ปัญหา: CORS Error

**อาการ:**
```
Access to fetch ... has been blocked by CORS policy
```

**วิธีแก้:**
1. ใช้ JSONP แทน fetch
2. ตรวจสอบ Backend deploy แบบ "Anyone"
3. ลอง redeploy Backend

### ปัญหา: google.script.run is not defined

**อาการ:**
```
google.script.run is not defined
```

**วิธีแก้:**
1. ตรวจสอบ wrapper code ถูกโหลดก่อน script อื่น
2. ตรวจสอบ `isGitHubPages` condition ทำงานถูกต้อง

### ปัญหา: Backend ไม่รับ request

**อาการ:**
Request ส่งไปแต่ไม่มี response

**วิธีแก้:**
1. ตรวจสอบ `doGet()` หรือ `doPost()` ใน Code.gs
2. ดู Execution log ใน Apps Script
3. ตรวจสอบ URL ถูกต้อง

---

## 📊 Comparison with Option 1

| Feature | Option 1 (Apps Script) | Option 2 (GitHub Pages) |
|---------|------------------------|-------------------------|
| **Setup** | ⭐⭐⭐ ง่าย | ⭐⭐ ปานกลาง |
| **PWA Support** | ⭐⭐ พอใช้ | ⭐⭐⭐ ดีมาก |
| **Custom Domain** | ❌ ไม่ได้ | ✅ ได้ |
| **Loading Speed** | ⭐⭐ ปานกลาง | ⭐⭐⭐ เร็ว |
| **Maintenance** | ⭐⭐⭐ ง่าย | ⭐⭐ ต้องดู 2 ที่ |
| **CORS Issues** | ❌ ไม่มี | ⚠️ อาจมี |

---

## 🎯 Quick Start Commands

```bash
# 1. Clone repo
git clone https://github.com/YOUR_USERNAME/BTH.git
cd BTH

# 2. Edit configuration
# แก้ BACKEND_URL ใน index.html

# 3. Push to GitHub
git add .
git commit -m "Configure for GitHub Pages deployment"
git push origin main

# 4. Enable GitHub Pages
# ทำใน Settings > Pages

# 5. Test
# เปิด https://YOUR_USERNAME.github.io/BTH/
```

---

## 📚 เอกสารเพิ่มเติม

- **DEPLOYMENT.md** - รายละเอียด deployment options
- **CODE_GS_INSTALLATION.md** - Setup Backend
- **BACKEND_INTEGRATION.md** - Architecture details
- **GOOGLE_SCRIPT_RUN_API.md** - API reference

---

## 🆘 ต้องการความช่วยเหลือ?

**บริษัท บ้านไทยเฮิร์บเซ็นเตอร์ จำกัด**
- 📱 LINE: [@bthcenter](https://line.me/ti/p/LV4OFl3dcU)
- ☎️ Phone: 092-4579929, 063-5033042

---

## 🎉 สรุป

**แบบที่ 2 เหมาะสำหรับ:**
- ✅ ต้องการ PWA ที่ติดตั้งได้ดี
- ✅ ต้องการ custom domain
- ✅ ต้องการ loading เร็ว
- ✅ พร้อมที่จะจัดการ CORS

**ข้อควรระวัง:**
- ⚠️ ต้อง deploy 2 ที่
- ⚠️ ต้องแก้โค้ดเพื่อรองรับ cross-origin
- ⚠️ Debugging ยากกว่าแบบที่ 1

**คำแนะนำ:**
ถ้าเป็นครั้งแรก ลองใช้ Option 1 ก่อน แล้วค่อยย้ายมา Option 2 เมื่อคุ้นเคยระบบแล้ว
