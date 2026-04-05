# Supa Frontend

Next.js web app for creators, mentors, moderators, and learners.

Project-wide overview: [`../README.md`](../README.md)

## Run

```powershell
cd e:\Mentors-app\supa_frontend
npm install
npm run dev
```

## Main Areas

### Learner

- series-first programs catalog
- prelims test runner and result review
- quiz complaints from result page
- learner view for prelims discussion videos and live classes
- discussion visibility directly on prelims series/test list cards before opening the full detail page

### Quiz Master

- prelims series creation and management
- quiz creation / parsing workspaces
- question complaints desk
- discussion video and live class configuration

### Mains Mentor

- mains series creation and management
- copy evaluation workflow
- mentorship management
- Zoom meetings and Agora room session delivery

## Current Discussion / Live Class Behavior

- `Discussion video` plays inline on web where embeddable.
- `Live class on Zoom` is creator-led, not mentorship-style.
- Creator can choose:
  - auto-schedule on connected Zoom account
  - manual existing Zoom link
- Learner-facing copy assumes:
  - creator is the main speaker
  - learners join as listeners first
  - learners use Zoom raise-hand / host approval to speak

## Important Frontend Pages

- `src/app/programs/create/page.tsx`
- `src/components/premium/TestSeriesManageView.tsx`
- `src/components/premium/TestSeriesConsole.tsx`
- `src/components/premium/TestSeriesDetailView.tsx`
- `src/components/premium/CollectionTestResult.tsx`
- `src/components/premium/QuizComplaintManagementView.tsx`
- `src/components/premium/DiscussionConfigEditor.tsx`
- `src/components/premium/ZoomConnectionStatusCard.tsx`
- `src/app/zoom/connect/callback/page.tsx`

## Environment

At minimum:

- `NEXT_PUBLIC_SUPA_BACKEND_URL`
- Supabase web auth env vars used by the current client setup

## Notes

- Creator-side Zoom connect is per creator account, not just global env configuration.
- The current live class model is still Zoom-hosted. It is not yet a fully custom in-app moderated classroom stack.
- Prelims catalog/detail pages now expose discussion availability at list level so users can see post-test or series wrap-up discussions before opening the series content.
