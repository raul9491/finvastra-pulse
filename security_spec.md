# VastraHRMS Security Specification

## Data Invariants
1. **Attendance**: A user can only check out if they have an active check-in for the current day.
2. **Attendance**: Users can only create/update their own attendance logs.
3. **Leaves**: Users can only request leaves for themselves.
4. **Leaves**: Only admins can approve or reject leave requests.
5. **Users**: Users can only modify their own profiles (except for restricted fields like 'role').
6. **Users**: The 'role' field is immutable for employees and can only be changed by admins.

## The "Dirty Dozen" Payloads

1. **Identity Theft (Attendance)**: User A tries to clock in for User B.
   - Payload: `{ userId: "userB", checkIn: "2026-05-06T12:00:00Z", date: "2026-05-06" }`
   - Result: `PERMISSION_DENIED`

2. **Privilege Escalation (User Profile)**: User A tries to set their role to 'admin'.
   - Payload: `{ role: "admin" }`
   - Result: `PERMISSION_DENIED`

3. **Self-Approval (Leave)**: User A tries to approve their own leave quest.
   - Payload: `{ status: "approved" }`
   - Result: `PERMISSION_DENIED` (Only admins can change status)

4. **Time Poisoning (Attendance)**: User A tries to set a backdated check-in.
   - Payload: `{ checkIn: "2020-01-01T00:00:00Z" }`
   - Result: `PERMISSION_DENIED` (Must use server timestamp or restricted range)

5. **Ghost Field Injection**: User tries to add `isVerified: true` to their profile.
   - Payload: `{ isVerified: true, ... }`
   - Result: `PERMISSION_DENIED` (Strict schema validation)

6. **Orphaned Attendance**: User A tries to create an attendance log without a valid date.
   - Payload: `{ userId: "userA", checkIn: "..." }` (missing `date`)
   - Result: `PERMISSION_DENIED`

7. **Shadow Modification (Attendance)**: User tries to change their check-in time after clocking out.
   - Payload: `{ checkIn: "2026-05-06T08:00:00Z" }` (on an existing doc)
   - Result: `PERMISSION_DENIED` (Check-in time should be immutable after creation)

8. **Resource Exhaustion**: User tries to inject a 1MB string as a reason for leave.
   - Payload: `{ reason: "A".repeat(1000000) }`
   - Result: `PERMISSION_DENIED` (Size constraints)

9. **ID Hijacking**: User tries to create a document with a non-alphanumeric ID.
   - Path: `/leaves/!!!invalid-id!!!`
   - Result: `PERMISSION_DENIED`

10. **Admin Spoofing**: User tries to set themselves as an admin by creating a doc in an `admins` collection.
    - Path: `/admins/userA`
    - Result: `PERMISSION_DENIED` (Global deny-all)

11. **Future Dating**: User tries to set a check-out time in the future.
    - Payload: `{ checkOut: "2030-01-01T00:00:00Z" }`
    - Result: `PERMISSION_DENIED`

12. **Cross-Tenant Access**: User A tries to read User B's private profile.
    - Path: `/users/userB`
    - Result: `PERMISSION_DENIED` (Unless they are admin)

## Test Runner Preview
I will implement these checks in the `firestore.rules` file and verify them iteratively.
