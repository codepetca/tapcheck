import { SessionAttendanceScreen } from "@/components/session-attendance-screen";

export default async function EditorAttendancePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <SessionAttendanceScreen token={token} />;
}
