import { SessionAttendanceScreen } from "@/components/session-attendance-screen";

export default async function ViewerAttendancePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <SessionAttendanceScreen token={token} mode="viewer" />;
}
