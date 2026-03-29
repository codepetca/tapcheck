import { SignUp } from "@clerk/nextjs";
import { AuthShell } from "@/components/auth-shell";

export default function SignUpPage() {
  return (
    <AuthShell bare>
      <SignUp
        path="/sign-up"
        routing="path"
        signInUrl="/sign-in"
        forceRedirectUrl="/"
        appearance={{
          theme: "simple",
          elements: {
            rootBox: "w-full",
            cardBox: "w-full shadow-none",
            card: "rounded-none border-0 bg-transparent p-0 m-0 shadow-none",
            navbar: "hidden",
            header: "mb-0 pb-0",
            headerTitle:
              "font-heading !text-4xl !leading-none flex items-center justify-center gap-3 font-semibold tracking-tight text-slate-950 text-center before:block before:size-9 before:shrink-0 before:rounded-xl before:bg-[url('/tapcheck-mark.svg')] before:bg-contain before:bg-center before:bg-no-repeat before:content-['']",
            headerSubtitle: "mt-1 text-center text-sm text-slate-600",
            main: "space-y-0 gap-0 p-0 m-0",
            form: "space-y-0 gap-0 p-0 m-0",
            formField: "space-y-0 gap-0 py-0 my-0",
            formFieldLabelRow: "mb-0",
            formFieldRow: "gap-0 py-0 my-0",
            socialButtonsBlock: "space-y-0 p-0 m-0",
            socialButtonsBlockButton:
              "rounded-full border border-slate-300 bg-white text-slate-700 shadow-none hover:border-slate-400 hover:bg-white hover:text-slate-950",
            socialButtonsBlockButtonText: "text-sm font-medium",
            dividerRow: "hidden",
            dividerText: "hidden",
            formFieldLabel: "text-xs font-medium uppercase tracking-[0.14em] text-slate-500",
            formFieldInput:
              "h-11 rounded-full border border-slate-300 bg-white px-4 text-sm text-slate-950 shadow-none focus:border-slate-400 focus:ring-0",
            formButtonPrimary:
              "mt-0 h-11 rounded-full bg-slate-950 text-sm font-semibold text-white shadow-none hover:bg-slate-800",
            footer: "hidden",
            footerAction: "hidden",
            footerActionText: "hidden",
            identityPreview: "mb-0 pb-0",
            formResendCodeLink: "mt-0 text-sm font-medium text-slate-700 hover:text-slate-950",
            identityPreviewText: "text-sm text-slate-600",
            otpCodeFieldInput:
              "h-11 w-11 rounded-2xl border border-slate-300 bg-white text-sm text-slate-950 shadow-none focus:border-slate-400 focus:ring-0",
            alert:
              "rounded-3xl border border-rose-200 bg-rose-50 text-sm text-rose-700 shadow-none",
            formFieldErrorText: "text-sm text-rose-700",
          },
        }}
      />
    </AuthShell>
  );
}
