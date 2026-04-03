export type RoleWorkspaceLink = {
  href: string;
  label: string;
  description: string;
};

export type RoleWorkspaceSection = {
  title: string;
  links: RoleWorkspaceLink[];
};

function buildPublicProfileLink(currentUserId?: string | null): RoleWorkspaceLink | null {
  const userId = String(currentUserId || "").trim();
  if (!userId) return null;
  return {
    href: `/profiles/${userId}`,
    label: "Public Profile",
    description: "Review the public-facing provider profile and feedback summary.",
  };
}

export function getQuizMasterWorkspaceSections(currentUserId?: string | null): RoleWorkspaceSection[] {
  const profileLinks = [
    {
      href: "/profile/professional",
      label: "Professional Profile",
      description: "Update role details, onboarding state, and public workspace identity.",
    },
    buildPublicProfileLink(currentUserId),
  ].filter((link): link is RoleWorkspaceLink => Boolean(link));

  return [
    {
      title: "Series Control",
      links: [
        {
          href: "/dashboard",
          label: "Dashboard",
          description: "Track prelims series activity, enrollments, reviews, and learner issues.",
        },
        {
          href: "/test-series",
          label: "Manage Series",
          description: "Manage created prelims series, attached tests, pricing, and access state.",
        },
        {
          href: "/quiz-master/complaints",
          label: "Question Complaints",
          description: "Review learner complaints raised from prelims result pages and resolve them.",
        },
        {
          href: "/test-series/create",
          label: "Create Test Series",
          description: "Create a new prelims-focused test series for your catalog.",
        },
      ],
    },
    {
      title: "Quiz Authoring",
      links: [
        {
          href: "/quiz-master/ai-quiz",
          label: "AI Quiz Workspace",
          description: "Open the Quiz Master AI workspace and switch between GK, Maths, and Passage lanes there.",
        },
        {
          href: "/quiz/create",
          label: "Manual Quiz Builder",
          description: "Create or edit prelims questions without using the AI parsing flow.",
        },
        {
          href: "/collections",
          label: "Manage Tests",
          description: "Open saved tests and review the quiz collections already in your account.",
        },
      ],
    },
    {
      title: "Profile",
      links: profileLinks,
    },
  ];
}

export function getMainsMentorWorkspaceSections(currentUserId?: string | null): RoleWorkspaceSection[] {
  const profileLinks = [
    {
      href: "/profile/professional",
      label: "Professional Profile",
      description: "Update mentor profile details, offerings, and operational availability.",
    },
    buildPublicProfileLink(currentUserId),
  ].filter((link): link is RoleWorkspaceLink => Boolean(link));

  return [
    {
      title: "Mentor Desk",
      links: [
        {
          href: "/dashboard",
          label: "Dashboard",
          description: "Monitor bookings, sessions, mentorship cycles, and created mains series.",
        },
        {
          href: "/test-series",
          label: "Manage Series",
          description: "Manage mains series, tests, access configuration, and delivery flow.",
        },
        {
          href: "/test-series/create",
          label: "Create Test Series",
          description: "Create a new mains-focused test series for answer writing programs.",
        },
        {
          href: "/mentorship/manage",
          label: "Mentorship Desk",
          description: "Review learner requests, accept or reject, manage chat, evaluation delivery, payment progression, and session booking.",
        },
      ],
    },
    {
      title: "Mains Authoring",
      links: [
        {
          href: "/mains/evaluate?mode=mains_mentor",
          label: "AI Mains Workspace",
          description: "Generate mains questions, evaluate answers, and bind items into mains tests.",
        },
        {
          href: "/mains/questions",
          label: "Mains Repository",
          description: "Manage the long-form question bank outside the AI generation flow.",
        },
      ],
    },
    {
      title: "Profile",
      links: profileLinks,
    },
  ];
}

export function flattenRoleWorkspaceSections(sections: RoleWorkspaceSection[]): Array<{ href: string; label: string }> {
  return sections.flatMap((section) => section.links.map((link) => ({ href: link.href, label: link.label })));
}
