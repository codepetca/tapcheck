import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist, Sora } from "next/font/google";
import { ClerkHeaderControls } from "@/components/clerk-header-controls";
import { ConvexClientProvider } from "@/components/convex-client-provider";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TapCheck",
  description: "Realtime mobile attendance for classroom door check-in.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geist.variable} ${sora.variable} h-full`}>
      <body className="min-h-full bg-[linear-gradient(180deg,#eef6f3_0%,#f7f8fb_44%,#ffffff_100%)] font-sans text-slate-950 antialiased">
        <ClerkProvider
          localization={{
            signIn: {
              start: {
                title: "TapCheck",
                titleCombined: "TapCheck",
                subtitle: "Realtime attendance at the door",
                subtitleCombined: "Realtime attendance at the door",
              },
              password: {
                title: "TapCheck",
                subtitle: "Realtime attendance at the door",
              },
              emailCode: {
                title: "TapCheck",
                subtitle: "Realtime attendance at the door",
                formTitle: "",
              },
              forgotPassword: {
                title: "TapCheck",
                subtitle: "Realtime attendance at the door",
                subtitle_email: "Realtime attendance at the door",
                subtitle_phone: "Realtime attendance at the door",
                formTitle: "",
              },
              resetPassword: {
                title: "TapCheck",
              },
            },
            signUp: {
              start: {
                title: "TapCheck",
                subtitle: "Realtime attendance at the door",
              },
              continue: {
                title: "TapCheck",
                subtitle: "Realtime attendance at the door",
                actionText: "",
                actionLink: "",
              },
              emailCode: {
                title: "TapCheck",
                subtitle: "Realtime attendance at the door",
                formTitle: "",
                formSubtitle: "",
              },
              emailLink: {
                title: "TapCheck",
                subtitle: "Realtime attendance at the door",
                formTitle: "",
                formSubtitle: "",
              },
            },
          }}
        >
          <ClerkHeaderControls />
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
