import { redirect } from "next/navigation";
import { buildCheckInPath } from "@/lib/session-links";

export default async function EditorAttendancePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  redirect(buildCheckInPath(token));
}
