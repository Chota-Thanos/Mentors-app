export type AdminLink = {
  label: string;
  href: string;
  description?: string;
};

export type AdminSection = {
  title: string;
  links: AdminLink[];
};

// Keep links limited to routes that currently exist in supa_frontend/src/app.
export const ADMIN_SECTIONS: AdminSection[] = [
  {
    title: "Admin",
    links: [
      { label: "Admin Panel", href: "/admin", description: "Overview and quick access" },
      { label: "User Roles", href: "/admin/user-roles", description: "Manage users and role assignments" },
      { label: "Onboarding Queue", href: "/onboarding/review", description: "Approve or reject Quiz Master and Mains Mentor onboarding requests" },
      { label: "Dashboard", href: "/dashboard", description: "Moderator lifecycle tracking and mentorship flow board" },
    ],
  },
  {
    title: "Premium",
    links: [
      { label: "Premium Workspace", href: "/premium-workspace", description: "Premium operations hub" },
      { label: "Exam & Categories", href: "/premium-workspace#taxonomy", description: "Exam/category management" },
      { label: "Quiz Category Sources", href: "/premium-workspace#category-ai-sources", description: "Manage quiz category attachments for AI source mode" },
      { label: "Mains Taxonomy Sources", href: "/premium-workspace#mains-ai-taxonomy", description: "Manage mains categories and source attachments" },
      { label: "Premium AI Settings", href: "/admin/premium-ai-settings", description: "Instruction settings and schemas" },
      { label: "Premium AI Studio", href: "/admin/premium-ai-studio", description: "Admin AI quiz generation studio" },
      { label: "Style Analysis Studio", href: "/admin/style-analysis", description: "Analyze and save content styles" },
      { label: "Premium AI Drafts", href: "/admin/premium/ai-drafts", description: "Review and publish AI-generated drafts" },
    ],
  },
  {
    title: "Tests",
    links: [
      { label: "Test Series Console", href: "/test-series", description: "Unified mains/quiz test series + copy check + mentorship" },
      { label: "Mentorship Manage", href: "/mentorship/manage", description: "Manage mentorship slots, requests, and sessions" },
      { label: "Tests", href: "/collections", description: "Browse and manage Prelims and Mains tests" },
      { label: "Create Prelims Test", href: "/collections/create", description: "Create a quiz-based prelims test" },
      { label: "Create Mains Test", href: "/mains/evaluate", description: "Generate mains questions and save as test" },
    ],
  },
  {
    title: "Quiz Tools",
    links: [
      { label: "Create Premium Quiz", href: "/quiz/create", description: "GK, Maths, and Passage quiz creation" },
      { label: "Mains Evaluate", href: "/mains/evaluate", description: "Mains AI evaluation" },
      { label: "Mains Repository", href: "/mains/questions", description: "Manual mains question creation and repository" },
    ],
  },
];
