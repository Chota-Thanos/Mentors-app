"use client";

import { useParams, useSearchParams } from "next/navigation";
import DiscussionRoomView from "@/components/premium/DiscussionRoomView";

export default function LectureDiscussionPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const itemId = typeof params.id === "string" ? Number.parseInt(params.id, 10) : 0;
  
  const rawSeriesId = searchParams.get("seriesId");
  const seriesId = rawSeriesId ? Number.parseInt(rawSeriesId, 10) : 0;
  
  const backHref = seriesId ? `/programs/${seriesId}` : `/programs/me`;

  return (
    <DiscussionRoomView
      endpoint={`/programs/items/${itemId}/discussion-context`}
      backHref={backHref}
      titleFallback={`Live Lecture`}
    />
  );
}
