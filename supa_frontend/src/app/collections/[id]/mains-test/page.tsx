import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MainsCollectionTestPage({ params }: PageProps) {
  const { id } = await params;
  redirect(`/collections/${id}`);
}
