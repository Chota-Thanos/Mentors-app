"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export interface PremiumExam {
  id: number;
  name: string;
  is_active: boolean;
}

export interface ExamContextState {
  exams: PremiumExam[];
  isLoading: boolean;
  globalExamId: number | null;
  globalExamName: string | null;
  setGlobalExamId: (examId: number | null) => void;
  showOnboarding: boolean;
  closeOnboarding: () => void;
}

const defaultExamContext: ExamContextState = {
  exams: [],
  isLoading: false,
  globalExamId: null,
  globalExamName: null,
  setGlobalExamId: () => {},
  showOnboarding: false,
  closeOnboarding: () => {},
};

const ExamContext = createContext<ExamContextState | undefined>(undefined);

function readStoredExamId(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const storedId = window.localStorage.getItem("globalExamId");
    if (!storedId || storedId === "all") return null;
    const parsed = Number(storedId);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function ExamProvider({ children }: { children: React.ReactNode }) {
  const [exams, setExams] = useState<PremiumExam[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [globalExamId, setGlobalExamId] = useState<number | null>(() => readStoredExamId());
  const [showOnboarding, setShowOnboarding] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    async function init() {
      setIsLoading(true);
      try {
        const { data } = await supabase
          .from("exams")
          .select("id, name, is_active")
          .eq("is_active", true)
          .order("name");

        const fetchedExams = (data ?? []) as PremiumExam[];
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
              setGlobalExamId(null);
              setShowOnboarding(true);
            }
          }
        } else {
          setGlobalExamId(null);
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
  }, [supabase]);

  const handleSetGlobalExamId = (examId: number | null) => {
    setGlobalExamId(examId);
    if (examId === null) {
      localStorage.setItem("globalExamId", "all");
    } else {
      localStorage.setItem("globalExamId", String(examId));
    }
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
    return defaultExamContext;
  }
  return context;
}
