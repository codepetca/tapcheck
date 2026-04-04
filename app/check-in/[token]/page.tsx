import { auth } from "@clerk/nextjs/server";
import { StudentCheckInScreen } from "@/components/student-check-in-screen";

export default async function StudentCheckInPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const { userId, redirectToSignIn } = await auth();

  if (!userId) {
    return redirectToSignIn({
      returnBackUrl: `/check-in/${token}`,
    });
  }

  return <StudentCheckInScreen token={token} />;
}
