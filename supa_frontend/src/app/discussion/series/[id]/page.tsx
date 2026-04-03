"use client";

import { useParams } from "next/navigation";

import DiscussionRoomView from "@/components/premium/DiscussionRoomView";

export default function SeriesDiscussionPage() {
  const params = useParams();
  const seriesId = typeof params.id === "string" ? Number.parseInt(params.id, 10) : 0;

  return (
    <DiscussionRoomView
      endpoint={`/test-series/${seriesId}/discussion-context`}
      backHref={`/test-series/${seriesId}`}
      titleFallback={`Series Discussion #${seriesId}`}
    />
  );
}
