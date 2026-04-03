# Mentorship System Redesign Handoff

## Purpose

This document turns the exported Stitch screens and the mentorship PRD into one implementation-ready reference for the mentorship product across:

- learner / user flow
- mains mentor flow
- current repo alignment
- required redesign and missing screens

The goal is to move the product to a request-led mentorship marketplace with contextual chat, mentor approval before payment, and slot booking only after the workflow reaches the right stage.

## Source Inputs

### PRD source

- `C:\Users\Abrar\Desktop\App UI\Mentorship\stitch\mentorship_system_prd.html`

### Exported screen source

- `C:\Users\Abrar\Desktop\App UI\Mentorship\stitch\stitch`

### Current repo surfaces that already affect this flow

- `supa_frontend/src/components/premium/ProfessionalPublicProfileView.tsx`
- `supa_frontend/src/components/premium/MentorDirectoryView.tsx`
- `supa_frontend/src/components/premium/MentorshipManagementView.tsx`
- `supa_frontend/src/lib/mentorshipOrderFlow.ts`
- `supa_frontend/src/lib/copyEvaluationFlow.ts`

## What Exists In The Export

### User screens found

- `u1_landing_page`
- `u2_mentor_listing`
- `u3_mentor_profile`
- `u3a_file_upload`
- `u4_request_submitted`
- `u5_chat_with_mentor`
- `u6_user_dashboard`
- `u7_payment_page`
- `u8_evaluation_result`
- `u9_session_detail`
- `u10_support_ticket_detail`
- `u10a_create_support_ticket`
- `u11_slot_booking`
- `u12_payment_success`

### Mentor screens found

- `m1_mentor_dashboard`
- `m2_requests_list`
- `m3_request_detail`
- `m3b_request_more_details`
- `m4_evaluation_queue`
- `m4a_evaluation_workspace`
- `m5_sessions_list`
- `m6_availability_management`
- `m8_earnings_payouts`
- `m9_support_help`

## Screen Coverage Matrix

### Learner / user

| PRD screen | Export status | Action |
| --- | --- | --- |
| U1 Landing | Exists | Update content hierarchy and final branding copy |
| U2 Mentor Listing | Exists | Expand filters and service labeling |
| U3 Mentor Profile | Exists | Redesign request card logic and status language |
| U4 Request Submitted | Exists | Keep, minor copy/state update |
| U5 Chat Thread | Exists | Keep, add full request/payment timeline behavior |
| U6 Dashboard | Exists | Split into overview + dedicated tabs |
| U6A Requests | Missing as separate screen | New |
| U6B Chats | Missing as separate screen | New |
| U6C Evaluations | Missing as separate screen | New |
| U6D Sessions | Missing as separate screen | New |
| U6E Payments | Missing as separate screen | New |
| U6F Support | Missing as separate screen | New |
| U7 Payment | Exists | Keep, but must be acceptance-gated |
| U8 Evaluation Result | Exists | Keep, refine next-step block |
| U9 Session Detail | Exists | Keep, expand states |
| U10 Support Detail | Exists | Keep |
| U10A Create Ticket | Exists | Keep |
| U11 Slot Booking | Exists | Keep, connect to post-payment and post-evaluation logic |
| U12 Payment Success | Exists | Keep |
| U13 Payment Failed | Missing | New |
| U14 Profile / Settings | Missing | New |

### Mains mentor

| PRD screen | Export status | Action |
| --- | --- | --- |
| M1 Dashboard | Exists | Keep, tighten status-first layout |
| M2 Requests List | Exists | Keep, expose problem statement more clearly |
| M3 Request Detail | Exists | Keep, but fix acceptance logic text |
| M4 Evaluation Queue | Exists | Keep |
| M4A Evaluation Workspace | Exists | Keep |
| M5 Sessions | Exists | Keep |
| M5A Session Detail | Missing | New |
| M6 Availability | Exists | Keep |
| M7 Mentor Chat | Missing as dedicated screen | New |
| M8 Earnings | Exists | Keep |
| M9 Support / Complaints | Exists | Keep |
| M10 Mentor Profile / Settings | Missing | New |

## Visual Direction To Preserve

The exported screens already establish a usable design language:

- editorial, premium, non-generic layout direction
- strong indigo primary identity with teal trust accents
- card-based achievement storytelling
- mobile-first screen composition
- tonal separation instead of heavy dividers

That design language should stay. The redesign should not revert to a plain SaaS dashboard.

## Product Rules That Must Become Canonical

### Core marketplace rule

- No payment before mentor accepts.

### Canonical journeys

#### Journey A: Mentorship Only

1. User discovers mentor.
2. User opens mentor profile.
3. User submits mentorship request with problem statement.
4. Chat thread opens immediately after submission.
5. Mentor reviews request and either asks for clarification, accepts, or rejects.
6. Only after acceptance does payment unlock.
7. After successful payment, user books final slot if not already locked.
8. Session happens.

#### Journey B: Copy Evaluation + Mentorship

1. User discovers mentor.
2. User opens mentor profile.
3. User submits evaluation + mentorship request with problem statement and copy upload.
4. Chat thread opens immediately after submission.
5. Mentor reviews request and accepts or rejects.
6. Only after acceptance does payment unlock.
7. After payment, copy enters evaluation workflow.
8. Mentor completes evaluation.
9. User views evaluated copy and feedback.
10. User books mentorship slot.
11. Session happens.

## Canonical State Model

### Request states

- `draft`
- `submitted`
- `in_review`
- `accepted`
- `rejected`
- `expired`
- `cancelled`

### Payment states

- `not_initiated`
- `pending`
- `paid`
- `failed`
- `refunded`

### Evaluation states

- `not_required`
- `awaiting_upload`
- `uploaded`
- `under_evaluation`
- `evaluation_completed`

### Session states

- `not_scheduled`
- `slot_selection_pending`
- `scheduled`
- `upcoming`
- `completed`
- `cancelled`

## Redesign Decisions By Surface

### U2 Mentor Listing

Keep the card-led discovery view, but expand it into a real marketplace directory:

- add exam filter
- add subject filter
- add price range
- add language
- add service availability
- add verified-only toggle
- add availability status
- add explicit service badges for `Mentorship Only` and `Copy Evaluation + Mentorship`

### U3 Mentor Profile

This is the highest-leverage redesign screen.

Keep:

- profile hero
- achievement tiles
- about section
- reviews

Change:

- replace direct slot booking as the default primary action
- primary CTA becomes `Request Mentorship`
- request card must support two service types
- problem statement becomes mandatory
- file upload appears only for evaluation flow
- add explicit “No payment required now” info block
- add “Chat opens after request submission” info block
- slot selection on this screen becomes either `preferred timing` capture or disappears entirely until later

### U4 Request Submitted

Keep as a clean state confirmation, but make the next action obvious:

- primary CTA: `Open Chat`
- secondary CTA: `Go to Dashboard`

### U5 Chat Thread

This becomes the operational center before payment.

Must include:

- request status badge
- service type
- problem summary
- system timeline messages
- payment CTA only when request is `accepted`
- reject and expired states with alternate CTA

### U6 Dashboard

The current single dashboard export should become a shell with distinct task-oriented tabs:

- Overview
- Requests
- Chats
- Evaluations
- Sessions
- Payments
- Support

The current overview card style can be retained, but the tabbed sub-screens need their own dedicated designs.

### U7 Payment

Keep the visual structure, but enforce entry conditions:

- accessible only when request status is `accepted`
- direct payment should never appear earlier in the workflow

### U8 Evaluation Result

Keep the evaluated copy viewer and breakdown model.

Add:

- a clearly dominant `Select Slot` CTA
- stronger separation between evaluated artifact, marks, and mentorship next step

### U11 Slot Booking

Keep the calendar-led selection pattern.

Use it only when:

- mentorship-only flow is accepted and paid but not scheduled
- evaluation flow is paid, evaluated, and ready for mentorship booking

## Mentor-Side Redesign Decisions

### M1 Dashboard

Keep the summary-card and activity-feed structure.

Add stronger grouping by operational urgency:

- new requests
- accepted awaiting learner payment
- evaluations due
- upcoming sessions

### M2 Requests List

The request card is already close to target.

Improve:

- show problem statement preview more prominently
- surface service type and uploaded-copy indicator more strongly
- show unread chat count and SLA countdown

### M3 Request Detail

This becomes the core mentor decision screen.

Keep:

- user summary
- service summary
- problem statement panel
- preferred timing block
- recent chat preview

Fix:

- acceptance must unlock payment, not auto-schedule the session
- acceptance helper text should say payment becomes available for the learner
- final slot assignment should not be implied at acceptance time

### M4 / M4A Evaluation

These screens already match the PRD shape well.

Refine:

- clearer due status
- stronger relation to linked request and payment status
- stronger “Submit Evaluation” consequence messaging

### M5 Sessions

Keep list structure, but add a dedicated M5A session detail screen for:

- agenda
- meeting link
- reschedule rules
- completion notes
- issue reporting

### M7 Mentor Chat

Needs its own dedicated screen instead of only being a supporting panel elsewhere.

It should mirror the learner chat but expose:

- `Accept Request`
- `Reject Request`
- `Open Request Detail`

### M10 Mentor Profile / Settings

Needs a dedicated settings surface that directly drives the learner-facing profile:

- headline
- bio
- achievements
- exams
- subjects
- languages
- pricing
- evaluation turnaround
- verification assets

## Current Repo vs Target Product

The current web product already has mentorship logic, but it does not yet follow the target marketplace model.

### Current behavior observed

- learner can directly book mentorship slots from the public profile
- copy evaluation can be submitted from the public profile
- current workflow is strongly slot-first and availability-first
- payment does not appear as the central approval gate in the visible flow
- learner and mentor management are consolidated into `MentorshipManagementView`

### Required product delta

#### 1. Remove direct standalone booking as the main entry path

Current implementation allows a learner to book from profile immediately.

Target implementation requires:

- request first
- chat second
- mentor acceptance third
- payment fourth
- slot booking later when appropriate

#### 2. Introduce a first-class request entity and request inbox UX

Current logic already has request objects, but the UX still behaves too much like slot booking.

Target UX must make the request the primary object, not the slot.

#### 3. Promote chat from supporting interaction to primary stateful workflow

Chat must not be optional garnish.
It is the operational thread linked 1:1 with each request.

#### 4. Split learner dashboard concerns

Current management surfaces mix requests, evaluations, booking, and sessions too tightly.

Target product needs explicit user-facing task buckets:

- requests
- chats
- evaluations
- sessions
- payments
- support

#### 5. Reframe mentor workspace around decisions, not only fulfillment

The mentor UI already supports evaluation and scheduling, but it needs stronger pre-payment request triage:

- clear accept / reject flow
- problem-first decision context
- request-specific chat surface

## Required UX Corrections In Existing Code

### High-priority current files to refactor

#### `supa_frontend/src/components/premium/ProfessionalPublicProfileView.tsx`

Problems:

- direct slot booking is currently primary
- direct booking note is attached before any mentor approval step
- evaluation flow is present, but request-then-chat-then-acceptance is not the visible top-level structure

Target:

- convert this screen into the canonical mentor profile request page
- request form replaces direct booking as the dominant CTA
- slot booking moves to a later dedicated screen

#### `supa_frontend/src/components/premium/MentorshipManagementView.tsx`

Problems:

- learner and mentor workflows are too consolidated
- direct bookings and shared workflows coexist in one heavy operational screen
- payment state is not the main decision gate in the interaction model

Target:

- split this into role-specific surfaces
- keep operational data logic where possible
- redesign UX around dashboard tabs and request detail pages

#### `supa_frontend/src/lib/mentorshipOrderFlow.ts`

Problems:

- current workflow stages are closer to booking-first flow than request-approval-payment flow
- direct flow assumes `submitted -> booking_open -> scheduled`

Target:

- insert explicit request review and payment gating into the workflow model
- separate request status from session status and payment status

#### `supa_frontend/src/lib/copyEvaluationFlow.ts`

Problems:

- copy evaluation flow centers on review and booking, but does not explicitly model accepted-then-paid entry

Target:

- add payment as a required gating state after mentor acceptance and before evaluation begins

## Recommended Route Model

### Learner web

- `/mentors`
- `/mentors/[mentorId]`
- `/dashboard/mentorship`
- `/dashboard/mentorship/requests`
- `/dashboard/mentorship/chats`
- `/dashboard/mentorship/evaluations`
- `/dashboard/mentorship/sessions`
- `/dashboard/mentorship/payments`
- `/dashboard/mentorship/support`
- `/mentorship/requests/[requestId]`
- `/mentorship/payments/[requestId]`
- `/mentorship/evaluations/[evaluationId]`
- `/mentorship/sessions/[sessionId]`

### Mains mentor web

- `/mains-mentor/dashboard`
- `/mains-mentor/requests`
- `/mains-mentor/requests/[requestId]`
- `/mains-mentor/chats/[requestId]`
- `/mains-mentor/evaluations`
- `/mains-mentor/evaluations/[evaluationId]`
- `/mains-mentor/sessions`
- `/mains-mentor/sessions/[sessionId]`
- `/mains-mentor/availability`
- `/mains-mentor/earnings`
- `/mains-mentor/profile`

## MVP Build Order Recommendation

Because the repo is already web-first for creator and mentor workflows, the next implementation pass should start in `supa_frontend`.

### Phase 1

- U2 mentor listing
- U3 mentor profile
- U5 learner chat
- U6A requests
- U7 payment
- M2 mentor requests
- M3 mentor request detail
- M7 mentor chat

### Phase 2

- U11 slot booking
- U9 session detail
- M6 availability
- M5 sessions

### Phase 3

- U6C evaluations
- U8 evaluation result
- support flows
- earnings
- mentor profile settings
- review and analytics enrichments

## Mobile Recommendation

Use mobile after the web flow is structurally correct.

Reason:

- the repo explicitly treats web as the primary creator workspace
- mentor operations are more complex and should stabilize on web first
- mobile should consume the same state model and screen semantics afterward

## Final Direction

The exported Stitch work is a strong visual base, but it currently behaves more like a slot-led mentorship utility than the request-led marketplace defined in the PRD.

The canonical redesign should therefore preserve the premium editorial visual language while changing the interaction model to:

1. request first
2. chat for clarification
3. mentor decision
4. payment after acceptance
5. evaluation or slot booking depending on service
6. session delivery

That is the core product correction required before direct implementation.
