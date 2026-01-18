# Backend Integration - PWA + Google Apps Script

## ภาพรวม (Overview)

PWA ที่พัฒนาขึ้นทำงานร่วมกับ Google Apps Script Backend ที่มีอยู่แล้วอย่างสมบูรณ์ โดยไม่ต้องเปลี่ยนแปลง backend code

---

## 🏗️ สถาปัตยกรรมระบบ (System Architecture)

```
┌─────────────────────────────────────────────────────────────┐
│                         PWA Layer                           │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ index.html │  │ manifest.json│  │  Service Worker  │   │
│  │  (PWA UI)  │  │  (App Info)  │  │   (sw.js)        │   │
│  └────────────┘  └──────────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ google.script.run API
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              Google Apps Script Backend                     │
│  ┌────────────────────────────────────────────────────┐    │
│  │  Code.gs - Server-side Functions                   │    │
│  │  • doGet() - Serves index.html                     │    │
│  │  • userLogin() - Authentication                    │    │
│  │  • writeSheetA/B() - Data storage                  │    │
│  │  • submitForm() - Survey submission                │    │
│  │  • getAllFarmers() - Admin endpoints               │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   Google Sheets Storage                     │
│  • Farmer data (SheetA)                                     │
│  • Usage data (SheetB - per ล้ง)                           │
│  • Survey data (ข้อมูลพื้นที่ปลูกพืชสมุนไพรกระท่อม)        │
│  • User management (Users, UserAdmin)                       │
└─────────────────────────────────────────────────────────────┘
```

---

## ✅ PWA ทำงานร่วมกับ Backend อย่างไร

### 1. **การให้บริการ HTML (Serving)**

**Google Apps Script:**
```javascript
function doGet() {
  const tpl = HtmlService.createTemplateFromFile('index.html');
  return tpl.evaluate()
    .setTitle('MitraApp')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}
```

**PWA Enhancement:**
- index.html ที่ให้บริการโดย Apps Script มี PWA meta tags และ Service Worker registration
- ไม่ต้องเปลี่ยน Code.gs เลย
- Service Worker จะแคช index.html หลังจากโหลดครั้งแรก

### 2. **การเรียกใช้ฟังก์ชัน Backend (API Calls)**

**Frontend (index.html) เรียกใช้:**
```javascript
// Login
google.script.run
  .withSuccessHandler(response => {
    // Handle success
  })
  .withFailureHandler(error => {
    // Handle error
  })
  .userLogin(username, password);

// Submit survey
google.script.run
  .withSuccessHandler(msg => {
    showCustomAlert(msg, 'success');
  })
  .submitForm(formDataObj);
```

**Backend (Code.gs) รับและประมวลผล:**
```javascript
function userLogin(username, password) {
  // Authentication logic
  return { success: true, token: '...' };
}

function submitForm(data) {
  // Save to Google Sheets
  return 'บันทึกข้อมูลเรียบร้อยแล้ว';
}
```

**PWA Impact:**
- ✅ ทำงานได้ปกติทั้ง online และ offline
- ✅ เมื่อ online: เรียก backend ตามปกติ
- ✅ เมื่อ offline: แสดงข้อความแจ้งเตือน (ไม่สามารถบันทึกข้อมูลได้)

### 3. **การจัดการออฟไลน์ (Offline Handling)**

**Service Worker Strategy:**
```javascript
// sw.js - Network-first strategy
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request)  // พยายาม network ก่อน
      .then(response => {
        // Cache response
        return response;
      })
      .catch(() => {
        // ถ้าไม่มี network ดึงจาก cache
        return caches.match(event.request);
      })
  );
});
```

**ผลลัพธ์:**
- 📱 UI ยังใช้งานได้แม้ offline
- 📊 ข้อมูลที่เคยโหลดแล้วแสดงได้
- ⚠️ ไม่สามารถส่งข้อมูลใหม่ได้ขณะ offline (ต้องมี network)

---

## 🔄 สถานการณ์การใช้งาน (Use Cases)

### Scenario 1: ใช้งานออนไลน์ปกติ (Online Normal Use)

```
User Action → PWA → google.script.run → Apps Script → Google Sheets
                                             ↓
                                        Response ← ← ← ←
```

**ตัวอย่าง:**
1. User กรอกฟอร์มสำรวจ
2. กด "บันทึก"
3. PWA ส่งข้อมูลผ่าน `google.script.run.submitForm()`
4. Apps Script บันทึกลง Google Sheets
5. ส่ง response กลับมาแสดงผล

### Scenario 2: เปิดแอปครั้งแรก (First Load)

```
1. User เข้า https://script.google.com/macros/s/.../exec
2. Apps Script ให้บริการ index.html
3. Service Worker ติดตั้งและแคชไฟล์
4. PWA พร้อมใช้งาน
```

### Scenario 3: เปิดแอปซ้ำ (Subsequent Loads)

```
1. User เปิดแอป (อาจจากไอคอนหน้าจอหลัก)
2. Service Worker ให้บริการ index.html จาก cache (เร็ว!)
3. พร้อมกันนั้นตรวจสอบ network มีเวอร์ชันใหม่หรือไม่
4. ถ้ามีอัพเดท → แจ้งเตือนให้ refresh
```

### Scenario 4: ใช้งานออฟไลน์ (Offline Use)

```
1. User เปิดแอป (ไม่มี internet)
2. Service Worker ให้บริการ UI จาก cache
3. User เห็นหน้าจอ แต่ไม่สามารถส่งข้อมูลได้
4. แสดงข้อความ: "ไม่มีการเชื่อมต่อ กรุณาลองใหม่เมื่อมีอินเทอร์เน็ต"
```

---

## 🔒 ความปลอดภัย (Security)

### Authentication Flow

**ไม่เปลี่ยนแปลง - ใช้ระบบเดิม:**

```javascript
// Frontend (index.html)
function handleLogin(event) {
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  
  google.script.run
    .withSuccessHandler(result => {
      if (result.success) {
        sessionStorage.setItem('sessionToken', result.token);
        sessionStorage.setItem('username', result.username);
        sessionStorage.setItem('isAdmin', result.isAdmin);
        // Logged in!
      }
    })
    .userLogin(username, password);
}

// Backend (Code.gs)
function userLogin(username, password) {
  // Validate credentials
  // Generate session token
  // Return { success: true, token: '...', username: '...', isAdmin: true/false }
}
```

**PWA Enhancement:**
- Session token เก็บใน sessionStorage (เหมือนเดิม)
- Service Worker ไม่แคช session data
- Token ยังใช้ได้แม้ offline (แต่ไม่สามารถ validate กับ server ได้)

---

## 📊 การทำงานกับ Google Sheets

### Data Flow

**การเขียนข้อมูล (Write):**
```
PWA Form → google.script.run.submitForm(data) 
         → Code.gs.submitForm() 
         → SpreadsheetApp.openById() 
         → sheet.appendRow()
```

**การอ่านข้อมูล (Read - Admin):**
```
PWA Admin Panel → google.script.run.getAllFarmers(token)
                → Code.gs.getAllFarmers()
                → sheet.getDataRange().getValues()
                → return JSON
```

**PWA Caching:**
- ❌ ไม่แคชข้อมูล sensitive
- ✅ แคชเฉพาะ UI และ assets
- ✅ ข้อมูลดึงจาก backend realtime เสมอ

---

## 🚀 Deployment Options

### Option 1: Google Apps Script Web App (ปัจจุบัน)

**ข้อดี:**
- ✅ Backend และ Frontend อยู่ที่เดียวกัน
- ✅ ไม่ต้อง setup hosting แยก
- ✅ Google Sheets integration ง่าย

**ข้อจำกัด:**
- ⚠️ URL ยาว (script.google.com/macros/...)
- ⚠️ ไม่สามารถใช้ custom domain ได้ง่าย
- ⚠️ PWA อาจติดตั้งไม่ได้บางเบราว์เซอร์ (ต้อง HTTPS + origin)

**การใช้งาน:**
```
1. Deploy Apps Script as Web App
2. URL: https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec
3. PWA จะทำงานบน URL นี้
```

### Option 2: GitHub Pages + Google Apps Script API

**สถาปัตยกรรม:**
```
GitHub Pages (Frontend PWA)
     ↓ google.script.run
Google Apps Script (Backend API)
     ↓
Google Sheets (Storage)
```

**ข้อดี:**
- ✅ Custom domain ได้ (yourdomain.github.io)
- ✅ PWA ติดตั้งได้ทุกเบราว์เซอร์
- ✅ HTTPS automatic
- ✅ Fast loading (GitHub CDN)

**ข้อจำกัด:**
- ⚠️ ต้อง deploy แยก 2 ที่
- ⚠️ CORS configuration อาจจำเป็น

**การ Setup:**

1. **Deploy Backend (Apps Script):**
   ```
   - Keep Code.gs as is
   - Deploy as Web App
   - Set "Execute as: Me"
   - Set "Who has access: Anyone"
   ```

2. **Deploy Frontend (GitHub Pages):**
   ```
   - Push PWA files to GitHub
   - Enable GitHub Pages
   - Update index.html:
     - ใช้ google.script.run ที่ชื่อ script URL
   ```

3. **Update index.html:**
   ```html
   <script>
     // ไม่ต้องเปลี่ยนอะไร - google.script.run ทำงานเหมือนเดิม
     // Apps Script จะ handle CORS automatically
   </script>
   ```

---

## 🛠️ สิ่งที่ไม่ต้องเปลี่ยนใน Backend

### ✅ Code.gs - ไม่ต้องแก้ไขเลย!

```javascript
// ✅ ฟังก์ชันทั้งหมดทำงานได้เหมือนเดิม
function doGet() { /* ... */ }
function userLogin(username, password) { /* ... */ }
function writeSheetA(formData, sessionToken) { /* ... */ }
function writeSheetB(formData) { /* ... */ }
function submitForm(data) { /* ... */ }
function getAllFarmers(token) { /* ... */ }
// ... ไม่ต้องเปลี่ยนอะไรเลย!
```

### ✅ Google Sheets - ไม่ต้องเปลี่ยน

- Spreadsheet IDs เหมือนเดิม
- Sheet names เหมือนเดิม
- Column structure เหมือนเดิม
- Permissions เหมือนเดิม

---

## 🧪 Testing Backend Integration

### Test 1: ทดสอบการเชื่อมต่อ

```javascript
// เปิด browser console (F12)
// ทดสอบเรียก backend
google.script.run
  .withSuccessHandler(result => {
    console.log('✅ Backend connected:', result);
  })
  .withFailureHandler(error => {
    console.error('❌ Backend error:', error);
  })
  .testPing();  // ถ้ามีฟังก์ชัน test
```

### Test 2: ทดสอบ Login

```javascript
// ใน pwa-test.html หรือ browser console
google.script.run
  .withSuccessHandler(result => {
    console.log('Login result:', result);
  })
  .userLogin('testuser', 'testpass');
```

### Test 3: ทดสอบการบันทึกข้อมูล

```javascript
google.script.run
  .withSuccessHandler(msg => {
    console.log('Submit success:', msg);
  })
  .submitForm({ 
    farmer_name_main: 'ทดสอบ',
    tel: '0123456789'
    // ... ข้อมูลอื่นๆ
  });
```

---

## 📝 Checklist สำหรับการใช้งาน

### ✅ Backend Setup (Google Apps Script)

- [ ] Code.gs deployed as Web App
- [ ] Execution: "Execute as Me"
- [ ] Access: "Anyone" or "Anyone with the link"
- [ ] Spreadsheet IDs ถูกต้อง
- [ ] Permissions ตั้งค่าแล้ว

### ✅ PWA Setup

- [ ] index.html มี PWA meta tags
- [ ] manifest.json configured
- [ ] Service Worker (sw.js) deployed
- [ ] Icons generated
- [ ] HTTPS enabled (Apps Script หรือ GitHub Pages)

### ✅ Integration Testing

- [ ] เปิดแอปได้
- [ ] Login ทำงาน
- [ ] บันทึกข้อมูลได้
- [ ] Admin panel ทำงาน (ถ้ามี)
- [ ] Offline UI ทำงาน
- [ ] Install ได้บนมือถือ

---

## 🎯 สรุป

### PWA + Google Apps Script = Perfect Match! ✨

**ข้อดี:**
1. ✅ **ไม่ต้องเปลี่ยน Backend** - Code.gs ใช้ต่อได้เลย
2. ✅ **Google Sheets Integration** - ทำงานเหมือนเดิม 100%
3. ✅ **Enhanced UX** - PWA ทำให้ UX ดีขึ้น
4. ✅ **Offline Support** - UI ใช้งานได้แม้ offline
5. ✅ **Installable** - ติดตั้งเหมือน native app
6. ✅ **Auto-update** - อัพเดทอัตโนมัติ

**การทำงาน:**
```
PWA (Frontend)
  ↓ google.script.run (ไม่เปลี่ยน)
Apps Script (Backend - ไม่แก้ไข)
  ↓ SpreadsheetApp
Google Sheets (Storage - เหมือนเดิม)
```

**คำตอบสั้นๆ:**
> Backend ทำงานได้เหมือนเดิม 100% ไม่ต้องแก้อะไรเลย!  
> PWA เป็นแค่ enhancement ด้าน Frontend  
> ทุกฟังก์ชัน backend ใช้ได้ต่อเหมือนเดิม

---

## 📞 ติดต่อสอบถาม

หากมีคำถามเพิ่มเติมเกี่ยวกับ backend integration:

**บริษัท บ้านไทยเฮิร์บเซ็นเตอร์ จำกัด**
- 📱 LINE: [@bthcenter](https://line.me/ti/p/LV4OFl3dcU)
- ☎️ Phone: 092-4579929, 063-5033042
