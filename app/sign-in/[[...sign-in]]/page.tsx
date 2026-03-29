import { SignIn } from "@clerk/nextjs";
import { AuthShell } from "@/components/auth-shell";

export default function SignInPage() {
  return (
    <AuthShell bare>
      <SignIn
        path="/sign-in"
        routing="path"
        signUpUrl="/sign-up"
        forceRedirectUrl="/"
        appearance={{
          theme: "simple",
          layout: {
            socialButtonsPlacement: "bottom",
          },
          elements: {
            rootBox: "w-full",
            cardBox: "w-full shadow-none",
            card: "rounded-none border-0 bg-transparent p-0 m-0 shadow-none",
            navbar: "hidden",
            header: "mb-0 pb-0",
            headerTitle:
              "font-heading !text-4xl !leading-none flex items-center justify-center gap-3 font-semibold tracking-tight text-slate-950 text-center before:block before:size-9 before:shrink-0 before:rounded-xl before:bg-[url('/tapcheck-mark.svg')] before:bg-contain before:bg-center before:bg-no-repeat before:content-['']",
            headerSubtitle: "mt-0 text-center text-sm leading-none text-slate-600",
            main: "!flex !flex-col gap-0 p-0 m-0",
            form: "order-1 space-y-0 gap-0 p-0 m-0",
            formField: "space-y-0 gap-0 py-0 my-0",
            formFieldLabelRow: "mb-0",
            formFieldRow: "gap-0 py-0 my-0",
            socialButtonsRoot: "order-3 mt-0 pt-0",
            socialButtonsBlock: "flex justify-center p-0 m-0",
            socialButtonsBlockButton:
              "h-11 w-full rounded-full border border-slate-300 bg-white px-4 text-slate-700 shadow-none hover:border-slate-400 hover:bg-white hover:text-slate-950",
            socialButtonsBlockButtonText: "text-sm font-medium",
            socialButtonsProviderIcon: "m-0 mr-2",
            dividerRow: "order-2 mt-0 mb-0 min-h-0 py-0 flex justify-center",
            dividerLine: "hidden",
            dividerText: "my-0 text-[11px] font-medium uppercase leading-none tracking-[0.18em] text-slate-400",
            formFieldLabel: "text-xs font-medium uppercase tracking-[0.14em] text-slate-500",
            formFieldInput:
              "h-11 rounded-full border border-slate-300 bg-white px-4 text-sm text-slate-950 shadow-none focus:border-slate-400 focus:ring-0",
            formButtonPrimary:
              "mt-0 h-11 rounded-full bg-slate-950 text-sm font-semibold text-white shadow-none hover:bg-slate-800",
            footer: "mt-4",
            footerAction: "flex justify-center",
            footerActionText: "hidden",
            footerActionLink:
              "inline-flex h-11 items-center justify-center rounded-full border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-950 shadow-none hover:border-slate-400 hover:bg-slate-50 hover:text-slate-950",
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
