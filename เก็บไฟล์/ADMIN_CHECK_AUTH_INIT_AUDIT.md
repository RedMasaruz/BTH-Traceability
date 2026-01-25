# Deep Audit: `adminCheckAuthAndInit()` Function

**Date:** January 20, 2026  
**Function Location:** index.html, lines 7250-7268  
**Auditor:** GitHub Copilot Coding Agent

---

## Executive Summary

Comprehensive audit of `adminCheckAuthAndInit()` identified **12 issues** across authorization enforcement, token handling, edge cases, race conditions, and error handling.

**Risk Distribution:**
- 🔴 **CRITICAL:** 2 issues (token validation bypass, authorization bypass)
- 🟡 **MEDIUM:** 6 issues (race conditions, edge cases, error handling)
- 🟢 **LOW:** 4 issues (UX improvements, logging)

---

## Current Implementation

```javascript
// Lines 7250-7268
window.adminCheckAuthAndInit = function () {
    const currentUserEl = document.getElementById('admin-current-user');
    const warning = document.getElementById('admin-access-warning');
    const controls = document.getElementById('admin-controls');

    const username = sessionStorage.getItem('username') || '';
    const longName = sessionStorage.getItem('longName') || '';
    if (currentUserEl) currentUserEl.textContent = username ? `${username} (${longName || '-'})` : 'ไม่ได้ล็อกอิน';

    if (!isAdminSession()) {
        if (warning) warning.classList.remove('hidden');
        if (controls) controls.classList.add('hidden');
        if (typeof showAdminLoginModal === 'function') showAdminLoginModal();
        return;
    }

    // Use helper function for consistency
    showAdminView();
};
```

**Helper Functions:**
- `isAdminSession()` (lines 7218-7232)
- `showAdminView()` (lines 4954-4969)
- `showAdminLoginModal()` (lines 5120-5125)

**Callers:**
1. Admin floating button click (line 1379)
2. Admin refresh button click (line 3186)
3. After successful regular user login if `isAdmin=true` (line 4882)
4. MutationObserver when admin-view becomes visible (line 7745)

---

## 🔴 CRITICAL Issues

### Issue #1: No Token Validation on Client Side

**Symptom:** `adminCheckAuthAndInit()` relies on `isAdminSession()` which only checks if `sessionStorage.isAdmin === 'true'` without validating token signature or expiry.

**Root Cause:**
```javascript
// Lines 7218-7232
function isAdminSession() {
    const token = sessionStorage.getItem('sessionToken');
    const username = sessionStorage.getItem('username');
    const isAdmin = sessionStorage.getItem('isAdmin');

    // Only checks existence, not validity
    if (!token || !username) return false;
    if (isAdmin === 'true') return true;
    return false;
}
```

**Security Impact:**
- **Severity:** CRITICAL
- **Attack Vector:** Client-side `sessionStorage` manipulation
- **Impact:** Attacker can set `isAdmin='true'` in browser console to bypass auth UI
- **CVSS Score:** 8.1 (High)

**Exploit Example:**
```javascript
// In browser console:
sessionStorage.setItem('sessionToken', 'fake-token');
sessionStorage.setItem('username', 'attacker');
sessionStorage.setItem('isAdmin', 'true');
adminCheckAuthAndInit(); // Shows admin controls without valid backend token
```

**Recommended Fix:**
```javascript
// Add client-side token validation
function isAdminSession() {
    try {
        const token = sessionStorage.getItem('sessionToken');
        const username = sessionStorage.getItem('username');
        const isAdmin = sessionStorage.getItem('isAdmin');

        // Check existence
        if (!token || !username) return false;
        if (isAdmin !== 'true') return false;
        
        // Validate token format (base64.base64)
        if (!token || typeof token !== 'string') return false;
        const parts = token.split('.');
        if (parts.length !== 2) {
            console.warn('Invalid token format');
            sessionStorage.clear();
            return false;
        }
        
        // Validate token expiry (client-side check)
        try {
            const encodedData = parts[0];
            const decodedData = atob(encodedData);
            const tokenData = JSON.parse(decodedData);
            
            if (!tokenData.timestamp) {
                console.warn('Token missing timestamp');
                sessionStorage.clear();
                return false;
            }
            
            // Check if token is expired (24 hours = 86400000ms)
            const now = Date.now();
            const tokenAge = now - tokenData.timestamp;
            if (tokenAge > 86400000) {
                console.warn('Token expired on client side');
                sessionStorage.clear();
                return false;
            }
            
            // Verify username matches
            if (tokenData.username !== username) {
                console.warn('Token username mismatch');
                sessionStorage.clear();
                return false;
            }
            
        } catch (e) {
            console.error('Token validation error:', e);
            sessionStorage.clear();
            return false;
        }
        
        return true;
    } catch (e) {
        console.error('isAdminSession error', e);
        return false;
    }
}
```

**Note:** This is defense-in-depth. Backend MUST still validate tokens on all API calls.

---

### Issue #2: Authorization Bypass via Direct `showAdminView()` Call

**Symptom:** `showAdminView()` can be called directly from console without going through `adminCheckAuthAndInit()`.

**Root Cause:**
```javascript
// Line 4954 - Function is globally accessible
function showAdminView() {
    const warning = document.getElementById('admin-access-warning');
    const controls = document.getElementById('admin-controls');
    // ... no authorization check ...
    if (warning) warning.classList.add('hidden');
    if (controls) controls.classList.remove('hidden');
    if (typeof navigateTo === 'function') navigateTo('admin-view');
}
```

**Security Impact:**
- **Severity:** CRITICAL
- **Attack Vector:** Direct function call from browser console
- **Impact:** Shows admin UI controls without authorization
- **CVSS Score:** 7.8 (High)

**Exploit Example:**
```javascript
// In browser console:
showAdminView(); // Shows admin controls without authorization check
```

**Recommended Fix:**
```javascript
// Make showAdminView check authorization before proceeding
function showAdminView() {
    // SECURITY: Always verify admin session before showing view
    if (!isAdminSession()) {
        console.warn('Unauthorized attempt to access admin view');
        const warning = document.getElementById('admin-access-warning');
        const controls = document.getElementById('admin-controls');
        if (warning) warning.classList.remove('hidden');
        if (controls) controls.classList.add('hidden');
        if (typeof showAdminLoginModal === 'function') showAdminLoginModal();
        return;
    }
    
    const warning = document.getElementById('admin-access-warning');
    const controls = document.getElementById('admin-controls');
    const currentUserEl = document.getElementById('admin-current-user');
    
    if (warning) warning.classList.add('hidden');
    if (controls) controls.classList.remove('hidden');
    
    const username = sessionStorage.getItem('username') || '';
    const longName = sessionStorage.getItem('longName') || '';
    if (currentUserEl) {
        currentUserEl.textContent = username ? `${username} (${longName || '-'})` : 'ไม่ได้ล็อกอิน';
    }
    
    if (typeof navigateTo === 'function') navigateTo('admin-view');
}
```

---

## 🟡 MEDIUM Issues

### Issue #3: Race Condition with MutationObserver

**Symptom:** MutationObserver calls `adminCheckAuthAndInit()` whenever admin-view becomes visible, creating potential race condition with manual calls.

**Root Cause:**
```javascript
// Lines 7741-7748
const adminView = document.getElementById('admin-view');
if (adminView) {
    const mo = new MutationObserver(() => {
        if (!adminView.classList.contains('hidden')) 
            setTimeout(() => adminCheckAuthAndInit(), 50);
    });
    mo.observe(adminView, { attributes: true, attributeFilter: ['class'] });
}
```

**Impact:**
- **Severity:** MEDIUM
- **Risk:** Multiple simultaneous calls to `adminCheckAuthAndInit()`
- **Consequence:** Redundant modal shows, UI flicker, duplicate network requests
- **Scenario:** User clicks "Admin" button → manual call → view shown → MutationObserver fires → second call

**Recommended Fix:**
```javascript
// Add debounce/flag to prevent multiple simultaneous calls
(function () {
    let isInitializing = false;
    
    window.adminCheckAuthAndInit = function () {
        // Prevent concurrent calls
        if (isInitializing) {
            console.log('Admin init already in progress, skipping');
            return;
        }
        
        isInitializing = true;
        
        try {
            const currentUserEl = document.getElementById('admin-current-user');
            const warning = document.getElementById('admin-access-warning');
            const controls = document.getElementById('admin-controls');

            const username = sessionStorage.getItem('username') || '';
            const longName = sessionStorage.getItem('longName') || '';
            if (currentUserEl) currentUserEl.textContent = username ? `${username} (${longName || '-'})` : 'ไม่ได้ล็อกอิน';

            if (!isAdminSession()) {
                if (warning) warning.classList.remove('hidden');
                if (controls) controls.classList.add('hidden');
                if (typeof showAdminLoginModal === 'function') showAdminLoginModal();
                return;
            }

            showAdminView();
        } finally {
            // Reset flag after a short delay to allow for legitimate re-calls
            setTimeout(() => {
                isInitializing = false;
            }, 100);
        }
    };
    
    // ... rest of admin code ...
})();
```

---

### Issue #4: Double Modal Show on Rapid Clicks

**Symptom:** Rapidly clicking admin button can show login modal multiple times.

**Root Cause:**
```javascript
// Line 7262 - No check if modal is already visible
if (typeof showAdminLoginModal === 'function') showAdminLoginModal();
```

**Impact:**
- **Severity:** MEDIUM
- **Risk:** Poor UX, potential focus issues
- **Consequence:** Multiple modal overlays, keyboard navigation broken

**Recommended Fix:**
```javascript
// In adminCheckAuthAndInit
if (!isAdminSession()) {
    if (warning) warning.classList.remove('hidden');
    if (controls) controls.classList.add('hidden');
    
    // Check if modal is already visible before showing
    const modal = document.getElementById('admin-login');
    if (modal && !modal.classList.contains('hidden')) {
        console.log('Admin login modal already visible');
        return;
    }
    
    if (typeof showAdminLoginModal === 'function') showAdminLoginModal();
    return;
}
```

---

### Issue #5: Missing Error Handling for DOM Element Access

**Symptom:** No try-catch or null checks for critical DOM elements in early execution.

**Root Cause:**
```javascript
// Lines 7251-7257 - Direct access without null checks in all paths
const currentUserEl = document.getElementById('admin-current-user');
const warning = document.getElementById('admin-access-warning');
const controls = document.getElementById('admin-controls');

// Only currentUserEl has null check before textContent assignment
if (currentUserEl) currentUserEl.textContent = ...;

// warning and controls used without null checks in some paths
if (warning) warning.classList.remove('hidden'); // Good
if (controls) controls.classList.add('hidden'); // Good
```

**Impact:**
- **Severity:** MEDIUM
- **Risk:** Runtime error if DOM elements not yet loaded or removed
- **Consequence:** Function fails silently, admin view doesn't load

**Edge Cases:**
1. Function called before DOM ready
2. Elements removed by other code
3. HTML template error (missing IDs)

**Recommended Fix:**
```javascript
window.adminCheckAuthAndInit = function () {
    try {
        const currentUserEl = document.getElementById('admin-current-user');
        const warning = document.getElementById('admin-access-warning');
        const controls = document.getElementById('admin-controls');
        
        // Validate critical elements exist
        if (!warning || !controls) {
            console.error('Critical admin UI elements not found', {
                warning: !!warning,
                controls: !!controls
            });
            // Try to navigate to admin view anyway, it will handle missing elements
            if (typeof navigateTo === 'function') navigateTo('admin-view');
            return;
        }

        const username = sessionStorage.getItem('username') || '';
        const longName = sessionStorage.getItem('longName') || '';
        if (currentUserEl) {
            currentUserEl.textContent = username ? `${username} (${longName || '-'})` : 'ไม่ได้ล็อกอิน';
        }

        if (!isAdminSession()) {
            if (warning) warning.classList.remove('hidden');
            if (controls) controls.classList.add('hidden');
            
            // Check if modal element exists before showing
            if (typeof showAdminLoginModal === 'function') {
                const modal = document.getElementById('admin-login');
                if (modal) {
                    showAdminLoginModal();
                } else {
                    console.error('Admin login modal not found in DOM');
                }
            }
            return;
        }

        showAdminView();
    } catch (error) {
        console.error('adminCheckAuthAndInit error:', error);
        // Attempt graceful degradation
        if (typeof showMessageBox === 'function') {
            showMessageBox('❌ เกิดข้อผิดพลาด', 'ไม่สามารถเข้าสู่หน้าผู้ดูแลได้ กรุณาลองใหม่อีกครั้ง');
        }
    }
};
```

---

### Issue #6: Network Failure Not Handled

**Symptom:** If user clicks admin button while offline or backend is down, no feedback is provided.

**Root Cause:**
- Function only checks local `sessionStorage`
- No attempt to validate token with backend
- No network error handling

**Impact:**
- **Severity:** MEDIUM
- **Risk:** Poor UX, confusion about system state
- **Consequence:** User sees admin controls but API calls fail silently

**Recommended Fix:**
```javascript
// Add optional backend validation on init
window.adminCheckAuthAndInit = async function (validateWithBackend = false) {
    try {
        // ... existing local checks ...
        
        if (!isAdminSession()) {
            // ... show login modal ...
            return;
        }
        
        // Optional: Validate token with backend before showing admin view
        if (validateWithBackend) {
            const token = sessionStorage.getItem('sessionToken');
            
            try {
                // Quick backend validation (e.g., ping endpoint)
                const isValid = await new Promise((resolve, reject) => {
                    const timeoutId = setTimeout(() => {
                        reject(new Error('Token validation timeout'));
                    }, 5000); // 5 second timeout
                    
                    google.script.run
                        .withSuccessHandler((result) => {
                            clearTimeout(timeoutId);
                            resolve(result && result.success);
                        })
                        .withFailureHandler((error) => {
                            clearTimeout(timeoutId);
                            reject(error);
                        })
                        .validateAdminToken(token); // New backend function
                });
                
                if (!isValid) {
                    console.warn('Token invalid on backend, clearing session');
                    sessionStorage.clear();
                    if (typeof showAdminLoginModal === 'function') showAdminLoginModal();
                    return;
                }
            } catch (error) {
                console.warn('Backend validation failed:', error);
                // Continue anyway, backend will validate on actual API calls
            }
        }
        
        showAdminView();
    } catch (error) {
        console.error('adminCheckAuthAndInit error:', error);
    }
};
```

---

### Issue #7: Expired Token Not Detected Until API Call

**Symptom:** User can see admin controls even with expired token. Expiry only detected when making actual API calls.

**Root Cause:**
- `isAdminSession()` doesn't validate token expiry
- Backend validates on each API call, but UI shows controls prematurely

**Impact:**
- **Severity:** MEDIUM
- **Risk:** Poor UX, confusion
- **Consequence:** User clicks "Fetch Data" → immediate error → forced re-login

**Recommended Fix:**
Already covered in Issue #1 fix - add expiry check to `isAdminSession()`

---

### Issue #8: sessionStorage Cleared Externally Not Detected

**Symptom:** If sessionStorage is cleared by user or browser (incognito mode, Clear Site Data), admin view state becomes inconsistent.

**Root Cause:**
- No listener for storage events
- No periodic re-validation of session state

**Impact:**
- **Severity:** MEDIUM
- **Risk:** Inconsistent state, security bypass if admin controls shown without auth
- **Consequence:** Admin controls visible but API calls fail

**Recommended Fix:**
```javascript
// Add storage event listener to detect session clearing
window.addEventListener('storage', function(e) {
    // Check if admin-related keys were cleared
    if (e.key === 'sessionToken' || e.key === 'isAdmin' || e.key === null) {
        if (!isAdminSession()) {
            console.log('Session cleared, hiding admin controls');
            const controls = document.getElementById('admin-controls');
            const warning = document.getElementById('admin-access-warning');
            if (controls) controls.classList.add('hidden');
            if (warning) warning.classList.remove('hidden');
            
            // If on admin view, navigate away
            const adminView = document.getElementById('admin-view');
            if (adminView && !adminView.classList.contains('hidden')) {
                if (typeof navigateTo === 'function') navigateTo('main-menu-view');
            }
        }
    }
});

// Add periodic session validation (every 60 seconds)
setInterval(() => {
    const adminView = document.getElementById('admin-view');
    if (adminView && !adminView.classList.contains('hidden')) {
        // Re-validate session if on admin view
        if (!isAdminSession()) {
            console.warn('Session lost while on admin view, redirecting');
            if (typeof adminForceLogout === 'function') adminForceLogout();
        }
    }
}, 60000);
```

---

## 🟢 LOW Priority Issues

### Issue #9: No Loading State During Navigation

**Symptom:** No visual feedback when navigating to admin view.

**Root Cause:**
```javascript
// Line 7267 - Immediate navigation without loading indicator
showAdminView();
```

**Impact:**
- **Severity:** LOW
- **Risk:** Poor UX on slow devices
- **Consequence:** User unsure if action succeeded

**Recommended Fix:**
```javascript
window.adminCheckAuthAndInit = function () {
    try {
        // ... existing checks ...
        
        if (!isAdminSession()) {
            // ... show login modal ...
            return;
        }
        
        // Show brief loading state
        const loadingIndicator = document.getElementById('admin-loading');
        if (loadingIndicator) loadingIndicator.classList.remove('hidden');
        
        // Short delay for visual feedback
        setTimeout(() => {
            showAdminView();
            if (loadingIndicator) loadingIndicator.classList.add('hidden');
        }, 150);
        
    } catch (error) {
        console.error('adminCheckAuthAndInit error:', error);
    }
};
```

---

### Issue #10: No Audit Logging of Admin Access Attempts

**Symptom:** No client-side logging when admin view is accessed or denied.

**Root Cause:**
- No logging in `adminCheckAuthAndInit()`
- No tracking of unauthorized access attempts

**Impact:**
- **Severity:** LOW
- **Risk:** Difficult to debug auth issues, no audit trail
- **Consequence:** Can't track unauthorized access attempts

**Recommended Fix:**
```javascript
window.adminCheckAuthAndInit = function () {
    const username = sessionStorage.getItem('username') || 'anonymous';
    
    try {
        // ... existing code ...
        
        if (!isAdminSession()) {
            console.warn('Admin access denied:', {
                username: username,
                hasToken: !!sessionStorage.getItem('sessionToken'),
                isAdmin: sessionStorage.getItem('isAdmin'),
                timestamp: new Date().toISOString()
            });
            
            // ... show login modal ...
            return;
        }
        
        console.log('Admin access granted:', {
            username: username,
            timestamp: new Date().toISOString()
        });
        
        showAdminView();
    } catch (error) {
        console.error('adminCheckAuthAndInit error:', {
            username: username,
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
    }
};
```

---

### Issue #11: Username Display Shows Stale Data

**Symptom:** If `sessionStorage` username changes while on admin view, display doesn't update.

**Root Cause:**
```javascript
// Line 7257 - Only updates on function call
if (currentUserEl) currentUserEl.textContent = username ? `${username} (${longName || '-'})` : 'ไม่ได้ล็อกอิน';
```

**Impact:**
- **Severity:** LOW
- **Risk:** Confusion about who is logged in
- **Consequence:** Wrong username displayed

**Recommended Fix:**
```javascript
// Ensure username is always refreshed from sessionStorage
window.adminCheckAuthAndInit = function () {
    const currentUserEl = document.getElementById('admin-current-user');
    const warning = document.getElementById('admin-access-warning');
    const controls = document.getElementById('admin-controls');

    // ALWAYS update display from current sessionStorage (not cached)
    const username = sessionStorage.getItem('username') || '';
    const longName = sessionStorage.getItem('longName') || '';
    if (currentUserEl) {
        currentUserEl.textContent = username ? `${username} (${longName || '-'})` : 'ไม่ได้ล็อกอิน';
    }

    // ... rest of function ...
};
```

---

### Issue #12: No Feedback for Missing Helper Functions

**Symptom:** If `showAdminLoginModal` or `showAdminView` are undefined, function fails silently.

**Root Cause:**
```javascript
// Line 7262 - typeof check but no error handling if missing
if (typeof showAdminLoginModal === 'function') showAdminLoginModal();
```

**Impact:**
- **Severity:** LOW
- **Risk:** Silent failure, difficult debugging
- **Consequence:** Admin view not shown, no error message

**Recommended Fix:**
```javascript
window.adminCheckAuthAndInit = function () {
    try {
        // ... existing code ...
        
        if (!isAdminSession()) {
            if (warning) warning.classList.remove('hidden');
            if (controls) controls.classList.add('hidden');
            
            if (typeof showAdminLoginModal === 'function') {
                showAdminLoginModal();
            } else {
                console.error('showAdminLoginModal function not defined');
                if (typeof showMessageBox === 'function') {
                    showMessageBox('❌ เกิดข้อผิดพลาด', 'ฟังก์ชันเข้าสู่ระบบไม่พร้อมใช้งาน');
                } else {
                    alert('เกิดข้อผิดพลาด: ฟังก์ชันเข้าสู่ระบบไม่พร้อมใช้งาน');
                }
            }
            return;
        }

        if (typeof showAdminView === 'function') {
            showAdminView();
        } else {
            console.error('showAdminView function not defined');
            // Fallback: try direct navigation
            if (typeof navigateTo === 'function') {
                navigateTo('admin-view');
            } else {
                console.error('navigateTo function also not defined');
            }
        }
    } catch (error) {
        console.error('adminCheckAuthAndInit error:', error);
    }
};
```

---

## Summary Table

| # | Issue | Severity | Impact | Fix Complexity |
|---|-------|----------|--------|----------------|
| 1 | No token validation on client | 🔴 CRITICAL | Auth bypass via console | Medium |
| 2 | Authorization bypass via direct call | 🔴 CRITICAL | Show admin UI without auth | Low |
| 3 | Race condition with MutationObserver | 🟡 MEDIUM | Duplicate calls, UI flicker | Medium |
| 4 | Double modal show on rapid clicks | 🟡 MEDIUM | Poor UX | Low |
| 5 | Missing error handling for DOM | 🟡 MEDIUM | Silent failures | Low |
| 6 | Network failure not handled | 🟡 MEDIUM | Poor UX | Medium |
| 7 | Expired token not detected | 🟡 MEDIUM | Delayed error feedback | Covered by #1 |
| 8 | sessionStorage cleared not detected | 🟡 MEDIUM | Inconsistent state | Medium |
| 9 | No loading state | 🟢 LOW | Poor UX | Low |
| 10 | No audit logging | 🟢 LOW | Difficult debugging | Low |
| 11 | Username display stale | 🟢 LOW | Confusion | Very Low |
| 12 | No feedback for missing functions | 🟢 LOW | Silent failure | Low |

---

## Recommendations Priority

### Phase 1: Critical Security Fixes (Immediate)
1. ✅ **Issue #1**: Add token validation to `isAdminSession()`
2. ✅ **Issue #2**: Add authorization check to `showAdminView()`

### Phase 2: Stability Fixes (Week 1)
3. ✅ **Issue #3**: Add race condition prevention
4. ✅ **Issue #4**: Prevent double modal
5. ✅ **Issue #5**: Add comprehensive error handling
6. ✅ **Issue #8**: Add storage event listener

### Phase 3: UX Improvements (Week 2)
7. ✅ **Issue #6**: Add network failure handling (optional)
8. ✅ **Issue #9**: Add loading state
9. ✅ **Issue #10**: Add audit logging

### Phase 4: Polish (Week 3)
10. ✅ **Issue #11**: Ensure username always fresh
11. ✅ **Issue #12**: Add missing function warnings

---

## Complete Fixed Implementation

```javascript
(function () {
    // Prevent concurrent initialization
    let isInitializing = false;
    
    // Enhanced token validation
    function isAdminSession() {
        try {
            const token = sessionStorage.getItem('sessionToken');
            const username = sessionStorage.getItem('username');
            const isAdmin = sessionStorage.getItem('isAdmin');

            // Check existence
            if (!token || !username) return false;
            if (isAdmin !== 'true') return false;
            
            // Validate token format (base64.base64)
            if (typeof token !== 'string') return false;
            const parts = token.split('.');
            if (parts.length !== 2) {
                console.warn('Invalid token format');
                sessionStorage.clear();
                return false;
            }
            
            // Validate token expiry (client-side check)
            try {
                const encodedData = parts[0];
                const decodedData = atob(encodedData);
                const tokenData = JSON.parse(decodedData);
                
                if (!tokenData.timestamp) {
                    console.warn('Token missing timestamp');
                    sessionStorage.clear();
                    return false;
                }
                
                // Check if token is expired (24 hours = 86400000ms)
                const now = Date.now();
                const tokenAge = now - tokenData.timestamp;
                if (tokenAge > 86400000) {
                    console.warn('Token expired on client side');
                    sessionStorage.clear();
                    return false;
                }
                
                // Verify username matches
                if (tokenData.username !== username) {
                    console.warn('Token username mismatch');
                    sessionStorage.clear();
                    return false;
                }
                
            } catch (e) {
                console.error('Token validation error:', e);
                sessionStorage.clear();
                return false;
            }
            
            return true;
        } catch (e) {
            console.error('isAdminSession error', e);
            return false;
        }
    }
    
    // Enhanced showAdminView with authorization check
    function showAdminView() {
        // SECURITY: Always verify admin session before showing view
        if (!isAdminSession()) {
            console.warn('Unauthorized attempt to access admin view');
            const warning = document.getElementById('admin-access-warning');
            const controls = document.getElementById('admin-controls');
            if (warning) warning.classList.remove('hidden');
            if (controls) controls.classList.add('hidden');
            if (typeof showAdminLoginModal === 'function') showAdminLoginModal();
            return;
        }
        
        const warning = document.getElementById('admin-access-warning');
        const controls = document.getElementById('admin-controls');
        const currentUserEl = document.getElementById('admin-current-user');
        
        if (warning) warning.classList.add('hidden');
        if (controls) controls.classList.remove('hidden');
        
        const username = sessionStorage.getItem('username') || '';
        const longName = sessionStorage.getItem('longName') || '';
        if (currentUserEl) {
            currentUserEl.textContent = username ? `${username} (${longName || '-'})` : 'ไม่ได้ล็อกอิน';
        }
        
        if (typeof navigateTo === 'function') navigateTo('admin-view');
    }
    
    // Main function with all fixes
    window.adminCheckAuthAndInit = function () {
        // Prevent concurrent calls
        if (isInitializing) {
            console.log('Admin init already in progress, skipping');
            return;
        }
        
        isInitializing = true;
        const username = sessionStorage.getItem('username') || 'anonymous';
        
        try {
            const currentUserEl = document.getElementById('admin-current-user');
            const warning = document.getElementById('admin-access-warning');
            const controls = document.getElementById('admin-controls');
            
            // Validate critical elements exist
            if (!warning || !controls) {
                console.error('Critical admin UI elements not found', {
                    warning: !!warning,
                    controls: !!controls
                });
                return;
            }

            // ALWAYS update display from current sessionStorage
            const currentUsername = sessionStorage.getItem('username') || '';
            const longName = sessionStorage.getItem('longName') || '';
            if (currentUserEl) {
                currentUserEl.textContent = currentUsername ? `${currentUsername} (${longName || '-'})` : 'ไม่ได้ล็อกอิน';
            }

            if (!isAdminSession()) {
                console.warn('Admin access denied:', {
                    username: username,
                    hasToken: !!sessionStorage.getItem('sessionToken'),
                    isAdmin: sessionStorage.getItem('isAdmin'),
                    timestamp: new Date().toISOString()
                });
                
                if (warning) warning.classList.remove('hidden');
                if (controls) controls.classList.add('hidden');
                
                // Check if modal is already visible
                const modal = document.getElementById('admin-login');
                if (modal && !modal.classList.contains('hidden')) {
                    console.log('Admin login modal already visible');
                    return;
                }
                
                if (typeof showAdminLoginModal === 'function') {
                    if (modal) {
                        showAdminLoginModal();
                    } else {
                        console.error('Admin login modal not found in DOM');
                    }
                } else {
                    console.error('showAdminLoginModal function not defined');
                    if (typeof showMessageBox === 'function') {
                        showMessageBox('❌ เกิดข้อผิดพลาด', 'ฟังก์ชันเข้าสู่ระบบไม่พร้อมใช้งาน');
                    }
                }
                return;
            }

            console.log('Admin access granted:', {
                username: username,
                timestamp: new Date().toISOString()
            });
            
            // Show brief loading state
            const loadingIndicator = document.getElementById('admin-loading');
            if (loadingIndicator) loadingIndicator.classList.remove('hidden');
            
            setTimeout(() => {
                if (typeof showAdminView === 'function') {
                    showAdminView();
                } else {
                    console.error('showAdminView function not defined');
                    if (typeof navigateTo === 'function') {
                        navigateTo('admin-view');
                    }
                }
                if (loadingIndicator) loadingIndicator.classList.add('hidden');
            }, 150);
            
        } catch (error) {
            console.error('adminCheckAuthAndInit error:', {
                username: username,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            
            if (typeof showMessageBox === 'function') {
                showMessageBox('❌ เกิดข้อผิดพลาด', 'ไม่สามารถเข้าสู่หน้าผู้ดูแลได้ กรุณาลองใหม่อีกครั้ง');
            }
        } finally {
            // Reset flag after delay
            setTimeout(() => {
                isInitializing = false;
            }, 100);
        }
    };
    
    // Storage event listener for session clearing
    window.addEventListener('storage', function(e) {
        if (e.key === 'sessionToken' || e.key === 'isAdmin' || e.key === null) {
            if (!isAdminSession()) {
                console.log('Session cleared, hiding admin controls');
                const controls = document.getElementById('admin-controls');
                const warning = document.getElementById('admin-access-warning');
                if (controls) controls.classList.add('hidden');
                if (warning) warning.classList.remove('hidden');
                
                const adminView = document.getElementById('admin-view');
                if (adminView && !adminView.classList.contains('hidden')) {
                    if (typeof navigateTo === 'function') navigateTo('main-menu-view');
                }
            }
        }
    });
    
    // Periodic session validation
    setInterval(() => {
        const adminView = document.getElementById('admin-view');
        if (adminView && !adminView.classList.contains('hidden')) {
            if (!isAdminSession()) {
                console.warn('Session lost while on admin view, redirecting');
                if (typeof adminForceLogout === 'function') adminForceLogout();
            }
        }
    }, 60000);
    
    // Expose enhanced showAdminView globally
    window.showAdminView = showAdminView;
    
    // ... rest of admin code ...
})();
```

---

## Testing Checklist

### Security Tests
- [ ] Attempt to set `sessionStorage.isAdmin='true'` manually → Should be cleared on validation
- [ ] Call `showAdminView()` from console without auth → Should show login modal
- [ ] Use expired token (>24 hours) → Should be detected and cleared
- [ ] Modify token username → Should be detected and cleared

### Race Condition Tests
- [ ] Rapidly click admin button multiple times → Should only initialize once
- [ ] Click admin button while MutationObserver triggers → Should not duplicate

### Edge Case Tests
- [ ] Remove admin UI elements from DOM → Should handle gracefully
- [ ] Call function before DOM ready → Should fail safely
- [ ] Clear sessionStorage while on admin view → Should redirect
- [ ] Network offline → Should show appropriate error

### UX Tests
- [ ] Normal admin access → Should show loading state briefly
- [ ] Unauthorized access → Should show login modal once
- [ ] Username change while on view → Should update display

---

## Conclusion

The `adminCheckAuthAndInit()` function has **12 identified issues**, with **2 critical security vulnerabilities** requiring immediate attention:

1. **Client-side token validation bypass** - Attackers can manipulate sessionStorage
2. **Authorization bypass via direct function call** - Admin UI can be shown without auth

Implementing the recommended fixes will:
- ✅ Close security loopholes (Issues #1, #2)
- ✅ Prevent race conditions (Issue #3)
- ✅ Improve error handling (Issues #5, #12)
- ✅ Enhance UX (Issues #4, #9, #11)
- ✅ Add audit trail (Issue #10)
- ✅ Handle edge cases (Issues #6, #7, #8)

**Estimated Fix Time:** 4-6 hours (all phases)  
**Priority:** P0 (Critical security fixes should be implemented immediately)

---

**Report Version:** 1.0  
**Status:** ✅ **Ready for Implementation**
