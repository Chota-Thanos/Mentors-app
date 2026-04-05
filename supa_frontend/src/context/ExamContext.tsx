"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import axios from "axios";
import { premiumApi } from "@/lib/premiumApi";
import type { PremiumExam } from "@/types/premium";

export interface ExamContextState {
  exams: PremiumExam[];
  isLoading: boolean;
  globalExamId: number | null;
  globalExamName: string | null;
  setGlobalExamId: (examId: number | null) => void;
  showOnboarding: boolean;
  closeOnboarding: () => void;
}

const ExamContext = createContext<ExamContextState | undefined>(undefined);

export function ExamProvider({ children }: { children: React.ReactNode }) {
  const [exams, setExams] = useState<PremiumExam[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [globalExamId, setGlobalExamId] = useState<number | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    async function init() {
      setIsLoading(true);
      try {
        const response = await premiumApi.get<PremiumExam[]>("/exams", { params: { active_only: true } });
        const fetchedExams = response.data || [];
        setExams(fetchedExams);

        const storedId = localStorage.getItem("globalExamId");
        if (storedId) {
          if (storedId === "all") {
            setGlobalExamId(null);
          } else {
            const numId = parseInt(storedId, 10);
            const exists = fetchedExams.some((e) => e.id === numId);
            if (exists) {
              setGlobalExamId(numId);
            } else {
              setGlobalExamId(null); // Corrupt or deactivated exam
              setShowOnboarding(true);
            }
          }
        } else {
          // Default to 'all' without showing onboarding by default as requested.
          setGlobalExamId(null);
          // If we want to show it only once, we could set a flag in localStorage but the user said "keep it at all, by default."
          setShowOnboarding(false);
          localStorage.setItem("globalExamId", "all");
        }
      } catch (err) {
        console.error("Failed to fetch exams for ExamContext", err);
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, []);

  const handleSetGlobalExamId = (examId: number | null) => {
    setGlobalExamId(examId);
    if (examId === null) {
      localStorage.setItem("globalExamId", "all");
    } else {
      localStorage.setItem("globalExamId", String(examId));
    }
    // Only close onboarding explicitly so the user knows they made a choice
    if (showOnboarding) {
      setShowOnboarding(false);
    }
  };

  const closeOnboarding = () => setShowOnboarding(false);

  const globalExamName = globalExamId
    ? exams.find((e) => e.id === globalExamId)?.name || null
    : null;

  return (
    <ExamContext.Provider
      value={{
        exams,
        isLoading,
        globalExamId,
        globalExamName,
        setGlobalExamId: handleSetGlobalExamId,
        showOnboarding,
        closeOnboarding,
      }}
    >
      {children}
    </ExamContext.Provider>
  );
}

export function useExamContext() {
  const context = useContext(ExamContext);
  if (context === undefined) {
    throw new Error("useExamContext must be used within an ExamProvider");
  }
  return context;
}
