"use client";

import { useParams } from "next/navigation";

import DiscussionRoomView from "@/components/premium/DiscussionRoomView";

export default function TestDiscussionPage() {
  const params = useParams();
  const testId = typeof params.id === "string" ? Number.parseInt(params.id, 10) : 0;

  return (
    <DiscussionRoomView
      endpoint={`/tests/${testId}/discussion-context`}
      backHref={`/collections/${testId}`}
      titleFallback={`Test Discussion #${testId}`}
    />
  );
}
