# Booking Change Review Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Implement a review workflow for booking changes (A+D) where PM/PO edits are stored as pending proposals until a manager approves, rejects, or modifies them.

**Architecture:**
- **Schema**: Add `pending_changes` Json field to `Booking` model.
- **Backend**: Update `BookingsService.update` to store changes instead of applying them for non-managers. Add `approveChanges` and `rejectChanges` methods.
- **Frontend**: Update `MyRequestsPage` to show pending status. Update `ManagerInboxPage` to show a side-by-side diff when pending changes exist, with field-level edit and overall approve/reject actions.

**Tech Stack:** NestJS, Prisma, React, Tailwind, Lucide Icons.

---

### Task 1: Update Prisma Schema

**Objective:** Add storage for pending change requests to the Booking model.

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

**Step 1: Add pending_changes field**
Add `pending_changes Json?` to the `Booking` model.

**Step 2: Run migration**
Run: `pnpm -C apps/api db:migrate --name add_booking_pending_changes`
Expected: Database schema updated.

**Step 3: Commit**
```bash
git add apps/api/prisma/schema.prisma
git commit -m "db: add pending_changes to Booking model"
```

### Task 2: Implement Change Submission Logic

**Objective:** Route PM/PO updates to pending_changes instead of immediate overwrite.

**Files:**
- Modify: `apps/api/src/bookings/bookings.service.ts`
- Modify: `apps/api/src/lib/api.ts` (if needed for types)

**Step 1: Update `BookingsService.update`**
- If `currentUser.role` is NOT `BA_MANAGER` or `ADMIN`, store the `data` in `pending_changes` instead of applying it to main fields.
- Update `BookingStatus` to `PENDING` (or a new `PENDING_REVIEW` if we want to distinguish from new requests). *Decision: keep PENDING for now as it already triggers manager review.*
- Notify managers of the update.

**Step 2: Verification**
Run API typecheck: `pnpm -C apps/api typecheck`
Expected: Success.

**Step 3: Commit**
```bash
git add apps/api/src/bookings/bookings.service.ts
git commit -m "feat(api): store requester updates in pending_changes"
```

### Task 3: Implement Change Approval/Rejection API

**Objective:** Add endpoints for managers to resolve pending changes.

**Files:**
- Modify: `apps/api/src/bookings/bookings.service.ts`
- Modify: `apps/api/src/bookings/bookings.controller.ts`

**Step 1: Add `approveChanges` and `rejectChanges` to Service**
- `approveChanges`: Apply `pending_changes` to the main booking fields, clear `pending_changes`, and set status (preserve APPROVED if already approved).
- `rejectChanges`: Clear `pending_changes` and notify requester.

**Step 2: Add Controller endpoints**
- `POST /api/bookings/:id/changes/approve`
- `POST /api/bookings/:id/changes/reject`

**Step 3: Verification**
Run: `pnpm -C apps/api typecheck`
Expected: Success.

**Step 4: Commit**
```bash
git add apps/api/src/bookings/
git commit -m "feat(api): add endpoints to approve/reject booking changes"
```

### Task 4: Implement Frontend Review UI in Manager Inbox

**Objective:** Show a diff panel and review actions when a booking has pending changes.

**Files:**
- Modify: `apps/web/src/pages/ManagerInboxPage.tsx`
- Modify: `apps/web/src/lib/api.ts`

**Step 1: Update API types**
Add `pending_changes` to `Booking` type in `apps/web/src/lib/api.ts`.

**Step 2: Add Diff Component**
Create a `ChangeReviewPanel` in `ManagerInboxPage` that renders:
- Side-by-side comparison of changed fields (title, description, dates, capacity, etc.)
- "Approve All" primary button
- "Reject All" button
- Small "Edit" icons next to proposed values to allow manager modification before final approval.

**Step 3: Hook up Actions**
Wire buttons to the new API endpoints.

**Step 4: Verification**
Run: `pnpm -C apps/web typecheck`
Expected: Success.

**Step 5: Commit**
```bash
git add apps/web/src/
git commit -m "feat(web): add booking change review UI to manager inbox"
```

### Task 5: End-to-End Verification

**Objective:** Verify the full flow from requester edit to manager approval.

**Steps:**
1. Login as PM/PO (`pm1@ba-bazaar.local`)
2. Edit an existing request
3. Verify notification sent to manager
4. Login as Manager (`manager@ba-bazaar.local`)
5. Click notification link
6. Verify diff UI shows correctly
7. Approve changes
8. Verify booking updated

**Step 2: Commit**
```bash
git add .
git commit -m "test: verify booking review flow"
```
