# API Migration TO-DO List

This document tracks the migration of frontend components from legacy FastAPI endpoints to direct Supabase queries and the new FastAPI backend.

## Status Legend
- ✅ **Done**: Successfully migrated to Supabase/New Backend.
- ⏳ **In Progress**: Work started but not finished.
- 🔴 **Pending**: Requires migration.

---

## 1. Mentorship Module (High Priority)

| Component | Target | Status |
|-----------|--------|--------|
| `MentorshipManagementView.tsx` | Supabase CRUD for requests, sessions, slots, messages | ✅ Done |
| `learnerMentorshipOrders.ts` | Supabase select for mentorship workflows | ✅ Done |
| `MentorshipOrderDetailClient.tsx` | Supabase for chat messages, slot booking, status updates | ✅ Done |
| `MentorshipAvailabilityManager.tsx` | Supabase for profile settings and availability slots | ✅ Done |
| `LearnerMentorshipDashboardPanel.tsx`| Integrated `useProfile()` and fixed data loading | ✅ Done |
| `LearnerMentorshipOrdersSection.tsx`| Integrated `useProfile()` and fixed data loading | ✅ Done |
| `MentorshipRequestModal.tsx` | Replace `POST /mentorship/requests` with Supabase | ✅ Done |
| `MentorDirectoryView.tsx` | Replace `/mentorship/mentors/status` with Supabase | 🔴 Pending |

## 2. Learning & Performance (High Priority)

| Component | Target | Status |
|-----------|--------|--------|
| `LearnerPerformanceAudit.tsx` | Supabase `user_performance_snapshots` table | ✅ Done |
| `page.tsx` (Learner Home) | Fixed profileId scoping and data fetching | ✅ Done |

## 3. Question Bank & Collections (Medium Priority)

| Component | Target | Status |
|-----------|--------|--------|
| `MainsQuestionRepositoryStudio.tsx` | Supabase `categories`, `mains_questions` | 🔴 Pending |
| `MainsCategorySourceManager.tsx` | Supabase `category_ai_sources` | 🔴 Pending |
| `ExamCategorySelector.tsx` | Supabase `categories` table | ✅ Done |

## 4. Environment & Infrastructure (Technical Debt)

| Task | Target | Status |
|------|--------|--------|
| `ProfileContext.tsx` | Ensure `profileIdNum` is consistently available | ✅ Done |
| `api.ts` | Validate routing for AI and Payments | ✅ Done |
| Build Errors Cleanup | Fix TypeScript type mismatches after migration | ✅ Done |

---

## Next Steps
1. Refactor `MainsQuestionRepositoryStudio.tsx` and `MainsCategorySourceManager.tsx` to use Supabase.
2. Fix the mentor status call in `MentorDirectoryView.tsx`.
3. Final verification of remaining `premiumApi` calls across the codebase (e.g. `UserCollectionBuilder.tsx`, `QuizComplaintManagementView.tsx`).
