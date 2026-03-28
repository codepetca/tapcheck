import { signOut } from "@workos-inc/authkit-nextjs";
import { Button } from "@/components/ui/button";

type SignOutFormProps = {
  label?: string;
  returnTo?: string;
  variant?: "primary" | "outline" | "danger";
  className?: string;
};

export function SignOutForm({
  label = "Sign out",
  returnTo = "/login",
  variant = "outline",
  className,
}: SignOutFormProps) {
  async function handleSignOut() {
    "use server";
    await signOut({ returnTo });
  }

  return (
    <form action={handleSignOut}>
      <Button variant={variant} size="sm" className={className}>
        {label}
      </Button>
    </form>
  );
}
