import { SessionAttendanceScreen } from "@/components/session-attendance-screen";

export default async function RosterSessionPage({
  params,
}: {
  params: Promise<{ rosterId: string; sessionId: string }>;
}) {
  const { rosterId, sessionId } = await params;
  return <SessionAttendanceScreen rosterId={rosterId} sessionId={sessionId} />;
}
