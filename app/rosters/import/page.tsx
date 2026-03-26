import { PageShell } from "@/components/page-shell";
import { RosterImportForm } from "@/components/roster-import-form";

export default function RosterImportPage() {
  return (
    <PageShell
      title="Import roster"
      subtitle="Upload a SchoolCash Online CSV, map the name and student ID columns, then preview the parsed roster before importing."
      backHref="/"
      backLabel="All rosters"
    >
      <RosterImportForm />
    </PageShell>
  );
}
