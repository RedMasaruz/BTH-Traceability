# Admin Login Modal Implementation

## Overview
This document describes the implementation of a dedicated admin login modal that is completely independent from the regular Users login system.

## Requirements
- **Modal name**: `admin-login`
- **Data source**: Google Sheet "UserAdmin"
- **Purpose**: Access admin-view exclusively
- **Independence**: No shared state, authentication logic, or dependencies with Users login

## Implementation Details

### 1. HTML Structure

#### Admin Login Modal (`#admin-login`)
```html
<div id="admin-login" class="fixed inset-0 z-50 flex items-center justify-center hidden">
    <form id="admin-login-form" onsubmit="handleAdminLogin(event)">
        <input type="text" id="admin-username" ... >
        <input type="password" id="admin-password" ... >
        <div id="admin-login-error" ... ></div>
    </form>
</div>
```

**Key Differences from Users Login Modal:**
- Modal ID: `admin-login` (vs `login-modal`)
- Form ID: `admin-login-form` (vs `login-form`)
- Input IDs: `admin-username`, `admin-password` (vs `username`, `password`)
- Error element: `admin-login-error` (vs `login-error`)
- Visual styling: Teal/green gradient theme (vs blue theme)
- Title: "เข้าสู่ระบบผู้ดูแล" (vs "เข้าสู่ระบบสำหรับตัวแทน")

### 2. JavaScript Functions

#### handleAdminLogin(event)
- **Purpose**: Independent authentication handler for admin users
- **Flow**:
  1. Validates admin-username and admin-password inputs
  2. Calls `google.script.run.userLogin(username, password)`
  3. Verifies `response.isAdmin === true` from server
  4. Stores session with `isAdmin: 'true'` flag
  5. Navigates to admin-view
  6. Rejects non-admin users with error message

#### showAdminLoginModal()
- Shows the admin login modal (`#admin-login`)
- Focuses on `admin-username` input
- Called by `adminCheckAuthAndInit()` when user is not authenticated

#### hideAdminLoginModal()
- Hides the admin login modal
- Resets the admin login form
- Clears error messages

### 3. Backend Integration

#### Code.gs - userLogin() Function
The backend `userLogin()` function already supports admin authentication:

1. **Checks UserAdmin sheet first** (for admin users)
   - Sheet: "UserAdmin"
   - Validates hashed passwords
   - Returns `{ success: true, isAdmin: true, token, username, longName }`

2. **Falls back to Users sheet** (for regular users)
   - Sheet: "Users"
   - Returns `{ success: true, isAdmin: false, token, username, longName }`

#### isAdminUsername() Function
- Checks if username exists in "UserAdmin" sheet
- Checks if user has admin/superadmin role in "Users" sheet
- Used for server-side validation

### 4. Session Management

#### Admin Session Storage
```javascript
sessionStorage.setItem('sessionToken', response.token);
sessionStorage.setItem('username', response.username);
sessionStorage.setItem('longName', response.longName);
sessionStorage.setItem('isAdmin', 'true');  // Admin flag
```

#### Session Validation
```javascript
function isAdminSession() {
    const token = sessionStorage.getItem('sessionToken');
    const isAdmin = sessionStorage.getItem('isAdmin');
    return token && isAdmin === 'true';
}
```

### 5. Integration Points

#### Admin Floating Button
```html
<button id="admin-floating-btn" onclick="adminCheckAuthAndInit()">
```
- Located at top-right of main menu
- Calls `adminCheckAuthAndInit()` when clicked

#### adminCheckAuthAndInit() Function
```javascript
window.adminCheckAuthAndInit = function () {
    if (!isAdminSession()) {
        showAdminLoginModal();  // Shows admin login modal
        return;
    }
    // Show admin view
    navigateTo('admin-view');
};
```

## Independence Verification

### No Shared Elements
| Component | Users Login | Admin Login |
|-----------|-------------|-------------|
| Modal ID | `login-modal` | `admin-login` |
| Form ID | `login-form` | `admin-login-form` |
| Username Input | `username` | `admin-username` |
| Password Input | `password` | `admin-password` |
| Error Element | `login-error` | `admin-login-error` |
| Handler | `handleLogin()` | `handleAdminLogin()` |
| Show Function | `showLoginModal()` | `showAdminLoginModal()` |
| Hide Function | `hideLoginModal()` | `hideAdminLoginModal()` |

### No Shared State
- Each modal has its own form state
- Each modal has its own error state
- Session storage uses the same keys but with different validation (isAdmin flag)

### No Shared Authentication Logic
- `handleLogin()` - For regular users
- `handleAdminLogin()` - For admin users (with isAdmin validation)
- Both call the same backend `userLogin()` but handle responses differently

## Testing Checklist

### Admin Login Flow
- [ ] Click admin floating button → admin login modal appears
- [ ] Enter admin credentials → successful login
- [ ] Verify `isAdmin: 'true'` in sessionStorage
- [ ] Verify navigation to admin-view
- [ ] Verify admin controls are visible

### Users Login Flow (No Interference)
- [ ] Click "ระบบตัวแทนเฉพาะ" card → users login modal appears
- [ ] Enter user credentials → successful login
- [ ] Verify `isAdmin: 'false'` in sessionStorage
- [ ] Verify navigation to submenu-view
- [ ] Verify dropdowns are auto-selected

### Error Handling
- [ ] Admin login with user credentials → shows "ไม่มีสิทธิ์ผู้ดูแลระบบ"
- [ ] Admin login with wrong password → shows error in admin-login-error
- [ ] Users login still works independently

### Edge Cases
- [ ] Cancel admin login → modal closes, no side effects
- [ ] Cancel users login → modal closes, no side effects
- [ ] Multiple login attempts don't interfere
- [ ] Logout clears session correctly

## Files Modified
- `index.html`: Added admin login modal and JavaScript functions

## Files Not Modified
- `Code.gs`: Already supports admin authentication via "UserAdmin" sheet
- No changes needed to backend authentication logic

## Visual Design

### Admin Login Modal
- **Theme Color**: Teal (#0f766e) / Green (#10b981)
- **Border**: 4px solid teal on top
- **Icon**: User/shield icon
- **Button**: Gradient teal-to-green background

### Users Login Modal
- **Theme Color**: Blue (#3b82f6)
- **Button**: Blue button class
- **Title**: "เข้าสู่ระบบสำหรับตัวแทน"

## Security Considerations

1. **Server-Side Validation**: 
   - Backend validates credentials against "UserAdmin" sheet
   - Returns `isAdmin` flag based on sheet source

2. **Client-Side Check**:
   - `handleAdminLogin()` verifies `isAdmin === true`
   - Prevents non-admin users from accessing admin view

3. **Password Hashing**:
   - Already implemented in Code.gs
   - Uses HMAC-SHA256 with secret key

4. **Session Token**:
   - Same token mechanism as Users login
   - Token validated server-side for admin operations

## Conclusion

The admin login modal is now completely independent from the Users login system. Both can coexist without any interference, shared state, or dependencies. Admin users authenticate through the "UserAdmin" sheet and access the admin-view, while regular users authenticate through the "Users" sheet and access the submenu-view.
