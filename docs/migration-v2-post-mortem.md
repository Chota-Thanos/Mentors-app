# Supabase V2 Migration: Technical Reference & Issue Post-Mortem

This document serves as a reference for the technical foundation and the types of issues encountered during the migration of the Mentors-app from the legacy FastAPI backend to the direct Supabase V2 architecture.

## 1. Background & Architecture Shift

The application is transitioning from a **FastAPI-mediated** architecture to a **Supabase-native** architecture.

### Legacy Architecture (V1)
- Frontend called FastAPI endpoints (`/api/v1/...`).
- FastAPI performed authorization and proxied requests to Supabase.
- Data structures were often flattened for API convenience.

### Current Architecture (V2)
- Frontend calls Supabase directly using the JS Client.
- Security is handled via **Row Level Security (RLS)** in PostgreSQL.
- Data structures strictly follow the database schema and TypeScript interfaces defined in `src/types/premium.ts` and `src/types/db.ts`.

---

## 2. Common Issue Patterns

During the migration, the following categories of issues occurred most frequently. These should be referenced when debugging future regressions.

### A. Structural Type Mismatches
**The Problem**: V2 interfaces are often deeply nested (e.g., `ProfessionalPublicProfileDetail` contains a `profile` object), whereas legacy code expected flat objects.
**Example Error**: `Object literal may only specify known properties, and 'id' does not exist in type 'ProfessionalPublicProfileDetail'.`
**The Fix**: Ensure reconstructed objects follow the nested structure:
```tsx
// Incorrect (V1 style)
const detail = { id: 1, display_name: "Name" };

// Correct (V2 style)
const detail = {
  profile: { id: 1, display_name: "Name", ... },
  role_label: "MENTOR",
  ...
};
```

### B. Rigid Type Definitions (Enums/Unions)
**The Problem**: The system uses string union types for providers and roles. If a new value (like `"agora"`) is used but not added to the `types/premium.ts` file, the build fails.
**Issue Encountered**: `"agora"` was not assignable to `MentorshipCallProvider` because the type only allowed `"zoom"`, `"custom"`, etc.
**The Fix**: Update the base union types in `src/types/premium.ts` before using new identifiers in components.

### C. Undefined Variable Regressions
**The Problem**: In complex components like `app/dashboard/page.tsx`, data is fetched and transformed for multiple roles (Mentor, Quiz Master, Moderator). High-copy-paste logic or manual reconstruction often leads to referencing variables that don't exist in that specific scope.
**Examples**: 
- `createSupabaseClient()` used instead of `createClient()`.
- `trackingPayload` referenced but not defined.
- `summary.data` accessed on an object that was already processed.

### D. Implicit 'any' & Strict TypeScript
**The Problem**: Next.js 15+ and the current project configuration enforce strict typing. Callbacks (like Supabase Realtime payloads) must have explicit types or `: any` to pass the build.
**Example**: `(payload) => { ... }` in a subscription must be `(payload: any) => { ... }` or use the specific Realtime type.

### E. Database Identifier Handling
**The Problem**: The database uses `BigInt` for IDs, which JavaScript represents as `number` or `string` depending on the helper used. 
- In many V2 queries, `profile_id` is expected as a number.
- In some contexts (like ownership checks), `creator_id` must match `profileId`.

---

## 2. Resolution Checklist

When migrating a new page or fixing a build error, follow this checklist:

1.  **Check Imports**: Use `import { createClient } from "@/lib/supabase/client";` exclusively.
2.  **Verify Interface Compliance**: Open the interface definition in `src/types/premium.ts` and ensure every mandatory field is present in your object literal.
3.  **Standardize Providers**: Always use `"agora"` for video calls unless another provider is explicitly requested.
4.  **Audit Result Objects**: If using `Promise.all` for multiple queries, ensure you are accessing `res.data` correctly and providing fallbacks (e.g., `(res.data || [])`).
5.  **Type Realtime Payloads**: Always provide at least `: any` to event listeners to avoid implicit `any` errors.

---

## 3. Current Status (April 18, 2026)

- **Expert Dashboard**: Fully migrated to V2 with all role paths (Mentor, Quiz Master, Moderator) stabilized.
- **Agora Integration**: Officially recognized as a first-class call provider in the type system.
- **Build Status**: Verified successful build (`npm run build`) with zero TypeScript errors.
