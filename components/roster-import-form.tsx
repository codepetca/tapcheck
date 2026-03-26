"use client";

import Papa from "papaparse";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/convex/api";
import { buildImportPreview, guessColumnMapping, type ColumnMapping } from "@/lib/students";

type CsvRow = Record<string, string>;

export function RosterImportForm() {
  const router = useRouter();
  const importCsv = useMutation(api.rosters.importCsv);

  const [rosterName, setRosterName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState<ColumnMapping>({
    nameColumn: null,
    studentIdColumn: null,
  });
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const preview = buildImportPreview(rows, mapping);

  async function handleFileChange(file: File | null) {
    setParseError(null);
    setSubmitError(null);

    if (!file) {
      setHeaders([]);
      setRows([]);
      setFileName("");
      setMapping({ nameColumn: null, studentIdColumn: null });
      return;
    }

    try {
      const text = await file.text();
      const parsed = Papa.parse<CsvRow>(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim(),
      });

      if (parsed.errors.length > 0) {
        throw new Error(parsed.errors[0]?.message ?? "Could not parse CSV.");
      }

      const normalizedRows = parsed.data.filter((row) =>
        Object.values(row).some((value) => String(value ?? "").trim() !== ""),
      );

      const parsedHeaders = (parsed.meta.fields ?? []).filter(Boolean);
      setHeaders(parsedHeaders);
      setRows(normalizedRows);
      setFileName(file.name);
      setMapping(guessColumnMapping(parsedHeaders));
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Could not parse CSV.");
      setHeaders([]);
      setRows([]);
      setFileName("");
      setMapping({ nameColumn: null, studentIdColumn: null });
    }
  }

  async function handleImport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);

    if (!rosterName.trim()) {
      setSubmitError("Roster name is required.");
      return;
    }

    if (rows.length === 0) {
      setSubmitError("Upload a CSV before importing.");
      return;
    }

    if (preview.errors.length > 0) {
      setSubmitError("Resolve the import issues before continuing.");
      return;
    }

    setIsSubmitting(true);
    try {
      const rosterId = await importCsv({
        name: rosterName.trim(),
        students: preview.validStudents,
      });
      router.push(`/rosters/${rosterId}`);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleImport} className="space-y-4">
      <section className="rounded-[28px] border border-white/70 bg-white/90 p-5 shadow-sm">
        <h2 className="text-lg font-semibold tracking-tight text-slate-950">Upload CSV</h2>
        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Roster name</span>
            <input
              value={rosterName}
              onChange={(event) => setRosterName(event.target.value)}
              placeholder="Period 1 Homeroom"
              className="h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-base text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">SchoolCash CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => void handleFileChange(event.target.files?.[0] ?? null)}
              className="block w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-600 file:mr-4 file:rounded-full file:border-0 file:bg-slate-950 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
            />
          </label>
        </div>
        {fileName ? <p className="mt-3 text-sm text-slate-500">Loaded: {fileName}</p> : null}
        {parseError ? (
          <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {parseError}
          </p>
        ) : null}
      </section>

      <section className="rounded-[28px] border border-white/70 bg-white/90 p-5 shadow-sm">
        <h2 className="text-lg font-semibold tracking-tight text-slate-950">Map columns</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Name column</span>
            <select
              value={mapping.nameColumn ?? ""}
              onChange={(event) =>
                setMapping((current) => ({
                  ...current,
                  nameColumn: event.target.value || null,
                }))
              }
              className="h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-base text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
            >
              <option value="">Select a column</option>
              {headers.map((header) => (
                <option key={header} value={header}>
                  {header}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Student ID column</span>
            <select
              value={mapping.studentIdColumn ?? ""}
              onChange={(event) =>
                setMapping((current) => ({
                  ...current,
                  studentIdColumn: event.target.value || null,
                }))
              }
              className="h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-base text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
            >
              <option value="">Select a column</option>
              {headers.map((header) => (
                <option key={header} value={header}>
                  {header}
                </option>
              ))}
            </select>
          </label>
        </div>

        {preview.errors.length > 0 ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {preview.errors.map((error) => (
              <p key={error}>{error}</p>
            ))}
          </div>
        ) : null}
      </section>

      <section className="rounded-[28px] border border-white/70 bg-white/90 p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-950">Preview</h2>
            <p className="mt-1 text-sm text-slate-600">
              {preview.rows.length} rows parsed • {preview.validStudents.length} ready to import
            </p>
          </div>
          <button
            type="submit"
            disabled={isSubmitting || preview.validStudents.length === 0 || preview.errors.length > 0}
            className="inline-flex h-12 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isSubmitting ? "Importing..." : "Create roster"}
          </button>
        </div>

        {submitError ? (
          <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {submitError}
          </p>
        ) : null}

        <div className="mt-4 overflow-hidden rounded-[24px] border border-slate-200">
          <div className="max-h-[28rem] overflow-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className="px-4 py-3 font-medium text-slate-600">Row</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Student</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Student ID</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {preview.rows.slice(0, 50).map((row) => (
                  <tr key={`${row.studentId}-${row.rowNumber}`} className={row.errors.length ? "bg-rose-50/70" : ""}>
                    <td className="px-4 py-3 text-slate-500">{row.rowNumber}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{row.displayName || row.rawName || "Missing name"}</div>
                      <div className="mt-1 text-xs text-slate-500">{row.rawName}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{row.studentId || "Missing"}</td>
                    <td className="px-4 py-3">
                      {row.errors.length === 0 ? (
                        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
                          Ready
                        </span>
                      ) : (
                        <div className="space-y-1">
                          {row.errors.map((error) => (
                            <div key={error} className="text-xs font-medium text-rose-700">
                              {error}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {preview.rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-500">
                      Upload a CSV to preview students here.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </form>
  );
}
