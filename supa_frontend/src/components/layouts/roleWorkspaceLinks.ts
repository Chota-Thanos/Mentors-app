export type RoleWorkspaceLink = {
  href: string;
  label: string;
  description: string;
};

export type RoleWorkspaceSection = {
  title: string;
  links: RoleWorkspaceLink[];
};

export function getQuizMasterWorkspaceSections(_currentUserId?: string | null): RoleWorkspaceSection[] {
  void _currentUserId;
  return [
    {
      title: "Creation Tools",
      links: [
        {
          href: "/programs/create",
          label: "Create Program",
          description: "Create a new prelims-focused program for your catalog.",
        },
        {
          href: "/quiz-master/ai-quiz",
          label: "AI Quiz Workspace",
          description: "Open the Quiz Master AI workspace and switch between GK, Maths, and Passage lanes there.",
        },
      ],
    },
    {
      title: "Built Material",
      links: [
        {
          href: "/collections",
          label: "Manage Tests",
          description: "Open saved tests and review the quiz collections already in your account.",
        },
        {
          href: "/programs",
          label: "Manage Programs",
          description: "Manage created prelims programs, attached tests, pricing, and access state.",
        },
      ],
    },
    {
      title: "Reporting",
      links: [
        {
          href: "/quiz-master/complaints",
          label: "Question Complaints",
          description: "Review learner complaints raised from prelims result pages and resolve them.",
        },
      ],
    },
  ];
}

export function getMainsMentorWorkspaceSections(_currentUserId?: string | null): RoleWorkspaceSection[] {
  void _currentUserId;
  return [
    {
      title: "Creation Tools",
      links: [
        {
          href: "/programs/create",
          label: "Create Program",
          description: "Create a new mains-focused program for answer writing workflows.",
        },
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
      title: "Built Material",
      links: [
        {
          href: "/programs",
          label: "Manage Programs",
          description: "Manage mains programs, tests, access configuration, and delivery flow.",
        },
      ],
    },
    {
      title: "Operations",
      links: [
        {
          href: "/mentorship/manage",
          label: "Mentorship Desk",
          description: "Review learner requests, accept or reject, manage chat, evaluation delivery, payment progression, and session booking.",
        },
      ],
    },
  ];
}

export function flattenRoleWorkspaceSections(sections: RoleWorkspaceSection[]): Array<{ href: string; label: string }> {
  return sections.flatMap((section) => section.links.map((link) => ({ href: link.href, label: link.label })));
}
