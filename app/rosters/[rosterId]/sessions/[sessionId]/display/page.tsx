import { SessionDisplayScreen } from "@/components/session-display-screen";

export default async function SessionDisplayPage({
  params,
}: {
  params: Promise<{ rosterId: string; sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <SessionDisplayScreen sessionId={sessionId} />;
}
