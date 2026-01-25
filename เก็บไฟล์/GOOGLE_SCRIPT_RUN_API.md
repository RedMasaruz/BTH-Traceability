# Google Script Run API - คู่มือการใช้งาน

## 🎯 google.script.run คืออะไร?

`google.script.run` เป็น JavaScript API ที่ Google Apps Script จัดเตรียมให้สำหรับการเรียกใช้ฟังก์ชัน server-side (Code.gs) จาก client-side (HTML/JavaScript)

---

## 🏗️ สถาปัตยกรรมการทำงาน

```
┌─────────────────────────────────────────────────────────────┐
│  Client Side (index.html - JavaScript ในเบราว์เซอร์)       │
│                                                              │
│  google.script.run                                          │
│    .withSuccessHandler(onSuccess)  // รับผลลัพธ์สำเร็จ      │
│    .withFailureHandler(onError)    // รับ error             │
│    .myFunction(param1, param2)     // เรียกฟังก์ชัน         │
│                                                              │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           │ HTTPS Request
                           │ (Asynchronous)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Server Side (Code.gs - Google Apps Script)                │
│                                                              │
│  function myFunction(param1, param2) {                      │
│    // ประมวลผลบน server                                     │
│    // เข้าถึง Google Sheets, Drive, etc.                   │
│    return result;  // ส่งกลับไป client                      │
│  }                                                           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 📖 วิธีการใช้งานพื้นฐาน

### รูปแบบการเรียกใช้

```javascript
google.script.run
  .withSuccessHandler(successFunction)    // จัดการเมื่อสำเร็จ (optional)
  .withFailureHandler(failureFunction)    // จัดการเมื่อ error (optional)
  .withUserObject(userObject)             // ส่งข้อมูล context (optional)
  .serverFunction(arg1, arg2, ...);       // เรียกฟังก์ชัน server
```

---

## 🔍 ตัวอย่างการใช้งานจริงในระบบ BTH

### ตัวอย่างที่ 1: Login (Authentication)

**Client Side (index.html):**
```javascript
async function handleLogin(event) {
    event.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    // แสดง loading
    const loginButton = document.getElementById('loginButton');
    loginButton.disabled = true;
    loginButton.innerHTML = 'กำลังเข้าสู่ระบบ...';
    
    // เรียกใช้ฟังก์ชัน userLogin ใน Code.gs
    google.script.run
        .withSuccessHandler(function(result) {
            // ฟังก์ชันนี้ทำงานเมื่อ login สำเร็จ
            if (result.success) {
                // เก็บ session token
                sessionStorage.setItem('sessionToken', result.token);
                sessionStorage.setItem('username', result.username);
                sessionStorage.setItem('longName', result.longName);
                sessionStorage.setItem('isAdmin', result.isAdmin);
                
                // ซ่อน login modal
                hideLoginModal();
                
                // แสดงข้อความต้อนรับ
                showMessageBox(
                    '✅ เข้าสู่ระบบสำเร็จ', 
                    `ยินดีต้อนรับ ${result.username}`
                );
                
                // อัพเดท UI
                updateUIAfterLogin();
            } else {
                // Login ไม่สำเร็จ
                showMessageBox('❌ ล็อกอินล้มเหลว', result.message);
            }
            
            // รีเซ็ตปุ่ม
            loginButton.disabled = false;
            loginButton.innerHTML = 'เข้าสู่ระบบ';
        })
        .withFailureHandler(function(error) {
            // ฟังก์ชันนี้ทำงานเมื่อเกิด error
            console.error('Login error:', error);
            showMessageBox(
                '❌ เกิดข้อผิดพลาด', 
                'ไม่สามารถเชื่อมต่อกับ server ได้: ' + error.message
            );
            
            // รีเซ็ตปุ่ม
            loginButton.disabled = false;
            loginButton.innerHTML = 'เข้าสู่ระบบ';
        })
        .userLogin(username, password);  // เรียกฟังก์ชัน + ส่งพารามิเตอร์
}
```

**Server Side (Code.gs):**
```javascript
function userLogin(username, password) {
  try {
    // ตรวจสอบ username และ password
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID_A);
    const userSheet = ss.getSheetByName("Users");
    const data = userSheet.getDataRange().getValues();
    
    // หา user
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[0] === username && row[1] === password) {
        // สร้าง session token
        const token = generateSessionToken(username, row[2]);
        
        // ส่งกลับไป client
        return {
          success: true,
          token: token,
          username: username,
          longName: row[2],
          isAdmin: row[3] === 'admin'
        };
      }
    }
    
    // ถ้าไม่พบ user
    return {
      success: false,
      message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'
    };
    
  } catch (error) {
    return {
      success: false,
      message: 'เกิดข้อผิดพลาด: ' + error.message
    };
  }
}
```

### ตัวอย่างที่ 2: บันทึกข้อมูลเกษตรกร (Submit Form)

**Client Side:**
```javascript
function handleSheetASubmit(event) {
    event.preventDefault();
    
    // รวบรวมข้อมูลจากฟอร์ม
    const formData = {
        'a-long-affiliation': document.getElementById('a-long-affiliation').value,
        'a-fullname': document.getElementById('a-fullname').value,
        'a-phone': document.getElementById('a-phone').value,
        'a-id': document.getElementById('a-id').value,
        // ... ข้อมูลอื่นๆ
    };
    
    // ดึง session token
    const session = {
        token: sessionStorage.getItem('sessionToken'),
        username: sessionStorage.getItem('username')
    };
    
    // แสดง loading
    const submitButton = document.getElementById('submitButtonA');
    submitButton.disabled = true;
    submitButton.innerHTML = '⏳ กำลังบันทึก...';
    
    // เรียกฟังก์ชัน writeSheetA
    google.script.run
        .withSuccessHandler(function(result) {
            if (result.success) {
                showMessageBox(
                    '✅ สำเร็จ', 
                    result.message
                );
                
                // ล้างฟอร์ม
                document.getElementById('form-a').reset();
            } else {
                showMessageBox('❌ ล้มเหลว', result.message);
            }
            
            // รีเซ็ตปุ่ม
            submitButton.disabled = false;
            submitButton.innerHTML = 'บันทึกข้อมูล';
        })
        .withFailureHandler(function(error) {
            console.error('Submit error:', error);
            showMessageBox(
                '❌ เกิดข้อผิดพลาด', 
                'ไม่สามารถบันทึกข้อมูลได้: ' + error.message
            );
            
            submitButton.disabled = false;
            submitButton.innerHTML = 'บันทึกข้อมูล';
        })
        .writeSheetA(formData, session.token);
}
```

**Server Side (Code.gs):**
```javascript
function writeSheetA(formData, sessionToken) {
  try {
    // ตรวจสอบ session
    const session = validateSessionToken(sessionToken);
    if (!session) {
      return { success: false, message: 'กรุณาล็อกอินใหม่' };
    }
    
    // ตรวจสอบข้อมูล
    if (!formData['a-fullname'] || !formData['a-phone']) {
      return { success: false, message: 'ข้อมูลไม่ครบถ้วน' };
    }
    
    // เปิด Google Sheet
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID_A);
    const sheet = ss.getSheetByName(SHEET_A_NAME);
    
    // เตรียมข้อมูลเพื่อเขียนลง sheet
    const newRow = [
      new Date(),  // เวลา
      formData['a-long-affiliation'],
      formData['a-fullname'],
      formData['a-phone'],
      formData['a-id'],
      // ... ข้อมูลอื่นๆ
    ];
    
    // เขียนข้อมูล
    sheet.appendRow(newRow);
    
    // ส่งผลลัพธ์กลับ
    return {
      success: true,
      message: 'บันทึกข้อมูลสำเร็จ',
      data: { row: sheet.getLastRow() }
    };
    
  } catch (error) {
    return {
      success: false,
      message: 'เกิดข้อผิดพลาด: ' + error.message
    };
  }
}
```

### ตัวอย่างที่ 3: ดึงข้อมูล (Fetch Data)

**Client Side:**
```javascript
function fetchFarmerData() {
    const farmerId = document.getElementById('search-farmer-id').value;
    const longName = document.getElementById('search-long').value;
    
    if (!farmerId || !longName) {
        showMessageBox('⚠️ แจ้งเตือน', 'กรุณากรอกข้อมูลให้ครบถ้วน');
        return;
    }
    
    // แสดง loading
    const searchButton = document.getElementById('searchButton');
    searchButton.disabled = true;
    searchButton.innerHTML = '⏳ กำลังค้นหา...';
    
    google.script.run
        .withSuccessHandler(function(result) {
            if (result.success && result.data.length > 0) {
                // แสดงข้อมูลที่ค้นพบ
                displayFarmerData(result.data);
            } else {
                showMessageBox('ℹ️ ไม่พบข้อมูล', 'ไม่พบข้อมูลเกษตรกรรายนี้');
            }
            
            searchButton.disabled = false;
            searchButton.innerHTML = 'ค้นหา';
        })
        .withFailureHandler(function(error) {
            console.error('Search error:', error);
            showMessageBox('❌ เกิดข้อผิดพลาด', error.message);
            
            searchButton.disabled = false;
            searchButton.innerHTML = 'ค้นหา';
        })
        .searchFarmerData(longName, farmerId);
}
```

**Server Side (Code.gs):**
```javascript
function searchFarmerData(longAffiliation, farmerId) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID_A);
    const sheet = ss.getSheetByName(SHEET_A_NAME);
    const data = sheet.getDataRange().getValues();
    
    const headers = data[0];
    const idIndex = headers.indexOf('รหัสเกษตรกร');
    const longIndex = headers.indexOf('ล้งที่สังกัด');
    
    const foundData = [];
    
    // ค้นหาข้อมูล
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[idIndex] === farmerId && row[longIndex] === longAffiliation) {
        // สร้าง object จากข้อมูล
        const obj = {};
        headers.forEach((header, idx) => {
          obj[header] = row[idx];
        });
        foundData.push(obj);
      }
    }
    
    return {
      success: true,
      message: foundData.length > 0 ? 'พบข้อมูล' : 'ไม่พบข้อมูล',
      data: foundData
    };
    
  } catch (error) {
    return {
      success: false,
      message: error.message,
      data: []
    };
  }
}
```

---

## ⚙️ คุณสมบัติสำคัญของ google.script.run

### 1. **Asynchronous (ไม่ซิงโครนัส)**

```javascript
// ❌ ผิด - ไม่สามารถใช้แบบ synchronous ได้
const result = google.script.run.myFunction();  // ไม่ทำงาน!

// ✅ ถูก - ต้องใช้ callback
google.script.run
  .withSuccessHandler(function(result) {
    // ใช้ result ที่นี่
    console.log(result);
  })
  .myFunction();
```

### 2. **Handlers (Success & Failure)**

```javascript
google.script.run
  .withSuccessHandler(onSuccess)    // ทำงานเมื่อสำเร็จ
  .withFailureHandler(onError)      // ทำงานเมื่อ error
  .myFunction();

function onSuccess(result) {
  console.log('Success:', result);
}

function onError(error) {
  console.error('Error:', error.message);
}
```

### 3. **User Object (Context Passing)**

```javascript
// ส่ง context object ไปด้วย
const context = {
  buttonId: 'submitBtn',
  formId: 'myForm'
};

google.script.run
  .withSuccessHandler(function(result, userObject) {
    // สามารถใช้ userObject ได้
    const button = document.getElementById(userObject.buttonId);
    button.disabled = false;
  })
  .withUserObject(context)
  .myFunction();
```

### 4. **Multiple Parameters**

```javascript
// ส่งพารามิเตอร์ได้หลายตัว
google.script.run
  .withSuccessHandler(onSuccess)
  .myFunction(param1, param2, param3, ...);
```

**Server Side:**
```javascript
function myFunction(param1, param2, param3) {
  // ใช้พารามิเตอร์ได้ตามปกติ
  return param1 + param2 + param3;
}
```

### 5. **Return Types**

google.script.run รองรับ return types ดังนี้:
- ✅ Primitives: string, number, boolean, null
- ✅ Arrays
- ✅ Objects (plain objects)
- ✅ Dates (แปลงเป็น string อัตโนมัติ)
- ❌ Functions (ไม่สามารถส่งได้)
- ❌ Complex objects (Class instances)

```javascript
// Server Side
function getData() {
  return {
    success: true,
    data: [
      { name: 'John', age: 30 },
      { name: 'Jane', age: 25 }
    ],
    timestamp: new Date(),
    count: 2
  };
}
```

---

## 🔐 ความปลอดภัย (Security)

### 1. **Authorization**

```javascript
// Server Side - ตรวจสอบสิทธิ์
function writeData(data, sessionToken) {
  // ตรวจสอบ token
  const session = validateSessionToken(sessionToken);
  if (!session) {
    throw new Error('Unauthorized - Please login');
  }
  
  // ตรวจสอบสิทธิ์
  if (!hasPermission(session.username, 'write')) {
    throw new Error('Forbidden - No write permission');
  }
  
  // ดำเนินการต่อ...
}
```

### 2. **Input Validation**

```javascript
// Server Side - Validate input
function saveData(data) {
  // ตรวจสอบข้อมูล
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid data format');
  }
  
  // Sanitize input
  const cleanData = {
    name: sanitizeInput(data.name),
    phone: sanitizePhoneNumber(data.phone),
    // ...
  };
  
  // บันทึกข้อมูล...
}

function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  // ลบ special characters ที่อาจเป็นอันตราย
  return input.replace(/[<>'"]/g, '');
}
```

### 3. **Rate Limiting**

```javascript
// Server Side
function checkRateLimit(identifier) {
  const cache = CacheService.getScriptCache();
  const key = `rate_limit_${identifier}`;
  const count = parseInt(cache.get(key) || '0', 10);
  
  if (count >= 100) {
    throw new Error('Rate limit exceeded. Please try again later.');
  }
  
  cache.put(key, (count + 1).toString(), 3600);  // 1 hour
}
```

---

## 🚫 ข้อจำกัด (Limitations)

### 1. **Execution Time**
- ฟังก์ชันแต่ละครั้งทำงานได้สูงสุด **6 นาที**
- ถ้าเกินเวลา จะเกิด timeout error

### 2. **Payload Size**
- ข้อมูลที่ส่งไป-กลับมี limit ประมาณ **50 MB**

### 3. **Concurrent Calls**
- สามารถเรียกได้หลายฟังก์ชันพร้อมกัน แต่อาจมีการ throttle

### 4. **CORS**
- ทำงานได้เฉพาะใน context ของ Google Apps Script
- ไม่สามารถเรียกจาก external domain ได้โดยตรง

---

## 💡 Best Practices

### 1. **Always Handle Errors**

```javascript
// ✅ ดี - มี error handling
google.script.run
  .withSuccessHandler(onSuccess)
  .withFailureHandler(onError)  // สำคัญ!
  .myFunction();

function onError(error) {
  console.error('Error:', error);
  showMessageBox('❌ เกิดข้อผิดพลาด', error.message);
}
```

### 2. **Show Loading State**

```javascript
// ✅ ดี - แสดง loading ให้ผู้ใช้รู้
function submitForm() {
  const button = document.getElementById('submitBtn');
  button.disabled = true;
  button.innerHTML = '⏳ กำลังบันทึก...';
  
  google.script.run
    .withSuccessHandler(result => {
      // Reset button
      button.disabled = false;
      button.innerHTML = 'บันทึก';
    })
    .withFailureHandler(error => {
      // Reset button
      button.disabled = false;
      button.innerHTML = 'บันทึก';
    })
    .saveData(data);
}
```

### 3. **Use Meaningful Function Names**

```javascript
// ✅ ดี - ชื่อฟังก์ชันชัดเจน
google.script.run.getUserProfile(userId);
google.script.run.saveFarmerData(data);
google.script.run.generatePDFReport(id);

// ❌ ไม่ดี - ชื่อฟังก์ชันไม่ชัดเจน
google.script.run.func1(data);
google.script.run.do(id);
```

### 4. **Return Structured Data**

```javascript
// ✅ ดี - return object ที่มีโครงสร้างชัดเจน
function getData() {
  return {
    success: true,
    message: 'Data retrieved successfully',
    data: [...],
    timestamp: new Date()
  };
}

// ❌ ไม่ดี - return เฉพาะค่า
function getData() {
  return [...];  // ไม่รู้ว่าสำเร็จหรือไม่
}
```

### 5. **Validate on Both Sides**

```javascript
// Client Side - Validate before sending
function submitData() {
  const data = getFormData();
  
  // Validate client-side
  if (!data.name || !data.phone) {
    showMessageBox('⚠️ แจ้งเตือน', 'กรุณากรอกข้อมูลให้ครบถ้วน');
    return;
  }
  
  // Send to server
  google.script.run
    .withSuccessHandler(onSuccess)
    .saveData(data);
}

// Server Side - Validate again
function saveData(data) {
  // Validate server-side (สำคัญ!)
  if (!data.name || !data.phone) {
    throw new Error('Missing required fields');
  }
  
  // Save data...
}
```

---

## 🔄 การทำงานกับ PWA

### Online Mode
```javascript
// เมื่อมีอินเทอร์เน็ต
google.script.run  // ทำงานได้ปกติ
  .withSuccessHandler(onSuccess)
  .myFunction();
```

### Offline Mode
```javascript
// เมื่อไม่มีอินเทอร์เน็ต
if (navigator.onLine) {
  // Online - เรียกได้ปกติ
  google.script.run.myFunction();
} else {
  // Offline - แสดงข้อความ
  showMessageBox(
    '📶 ไม่มีการเชื่อมต่อ', 
    'กรุณาเชื่อมต่ออินเทอร์เน็ตเพื่อบันทึกข้อมูล'
  );
}
```

---

## 📝 สรุป

### การทำงานของ google.script.run

1. **Client** เรียกฟังก์ชันผ่าน `google.script.run.functionName()`
2. **Request** ถูกส่งไปยัง Google Apps Script server (HTTPS)
3. **Server** รันฟังก์ชันใน Code.gs
4. **Response** ถูกส่งกลับมายัง client
5. **Handler** (success/failure) ทำงานตาม response

### ข้อดี

- ✅ เขียน JavaScript ทั้ง client และ server
- ✅ เข้าถึง Google Services ได้ง่าย (Sheets, Drive, etc.)
- ✅ ไม่ต้อง setup server เอง
- ✅ Auto-scaling โดย Google
- ✅ Secure (HTTPS, OAuth)

### ข้อควรระวัง

- ⚠️ Asynchronous เท่านั้น
- ⚠️ มี execution time limit (6 นาที)
- ⚠️ ต้อง handle errors เสมอ
- ⚠️ Validate input ทั้ง client และ server

---

## 📞 ติดต่อสอบถาม

**บริษัท บ้านไทยเฮิร์บเซ็นเตอร์ จำกัด**
- 📱 LINE: [@bthcenter](https://line.me/ti/p/LV4OFl3dcU)
- ☎️ Phone: 092-4579929, 063-5033042
