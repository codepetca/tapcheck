"use client";

import Papa from "papaparse";
import { useMutation, useQuery } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";
import { buildImportPreview, guessColumnMapping, type ColumnMapping } from "@/lib/students";

type CsvRow = Record<string, string>;
type ImportSource = "file" | "paste" | null;

const PASTED_NAME_COLUMN = "Student Name";
const PASTED_ID_COLUMN = "Student ID";

function parsePastedStudentList(input: string): CsvRow[] {
  const parsed = Papa.parse<string[]>(input, {
    header: false,
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors[0]?.message ?? "Could not parse pasted student list.");
  }

  const rows = parsed.data
    .map((row) => row.map((value) => String(value ?? "").trim()))
    .filter((row) => row.some(Boolean));

  if (rows.length === 0) {
    return [];
  }

  const [firstRow, ...restRows] = rows;
  const looksLikeHeader =
    firstRow.length >= 2 &&
    firstRow[0]?.toLocaleLowerCase().includes("id") &&
    firstRow[1]?.toLocaleLowerCase().includes("name");

  const dataRows = looksLikeHeader ? restRows : rows;

  return dataRows.map((row) => ({
    [PASTED_ID_COLUMN]: row[0] ?? "",
    [PASTED_NAME_COLUMN]: row.slice(1).join(", ").trim(),
  }));
}

export function RosterImportForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const importCsv = useMutation(api.rosters.importCsv);
  const importIntoExisting = useMutation(api.rosters.importIntoExisting);
  const rosterIdParam = searchParams.get("rosterId");
  const existingRosterId = rosterIdParam as Id<"rosters"> | null;
  const existingRoster = useQuery(
    api.rosters.getById,
    existingRosterId ? { rosterId: existingRosterId } : "skip",
  );

  const [rosterName, setRosterName] = useState("");
  const [rosterNameTouched, setRosterNameTouched] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [importSource, setImportSource] = useState<ImportSource>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({
    nameColumn: null,
    studentIdColumn: null,
    titleColumn: null,
  });
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const preview = buildImportPreview(rows, mapping);
  const hasImportData = rows.length > 0;
  const isEditingExistingRoster = Boolean(existingRosterId);
  const existingRosterName = existingRoster?.roster.name ?? "";
  const importedStudentIds = new Set(preview.validStudents.map((student) => student.studentId));
  const omittedStudents =
    isEditingExistingRoster && existingRoster
      ? existingRoster.students.filter((student) => !importedStudentIds.has(student.studentId))
      : [];
  const [deactivateMissing, setDeactivateMissing] = useState(false);

  useEffect(() => {
    if (rosterNameTouched) {
      return;
    }

    const nextName = preview.inferredRosterName || existingRosterName;
    if (nextName && rosterName !== nextName) {
      setRosterName(nextName);
    }
  }, [existingRosterName, preview.inferredRosterName, rosterName, rosterNameTouched]);

  useEffect(() => {
    if (omittedStudents.length === 0 && deactivateMissing) {
      setDeactivateMissing(false);
    }
  }, [deactivateMissing, omittedStudents.length]);

  function applyMapping(nextMapping: ColumnMapping, nextRows = rows) {
    setMapping(nextMapping);

    if (!rosterNameTouched) {
      const nextPreview = buildImportPreview(nextRows, nextMapping);
      setRosterName(nextPreview.inferredRosterName || existingRosterName);
    }
  }

  async function handleFileChange(file: File | null) {
    setParseError(null);
    setSubmitError(null);

    if (!file) {
      setHeaders([]);
      setRows([]);
      setFileName("");
      setImportSource(null);
      applyMapping({ nameColumn: null, studentIdColumn: null, titleColumn: null }, []);
      if (!rosterNameTouched) {
        setRosterName(existingRosterName);
      }
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
      const nextMapping = guessColumnMapping(parsedHeaders);
      setHeaders(parsedHeaders);
      setRows(normalizedRows);
      setFileName(file.name);
      setPastedText("");
      setImportSource("file");
      applyMapping(nextMapping, normalizedRows);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Could not parse CSV.");
      setHeaders([]);
      setRows([]);
      setFileName("");
      setImportSource(null);
      applyMapping({ nameColumn: null, studentIdColumn: null, titleColumn: null }, []);
      if (!rosterNameTouched) {
        setRosterName(existingRosterName);
      }
    }
  }

  function handlePastedTextChange(value: string) {
    setPastedText(value);
    setParseError(null);
    setSubmitError(null);

    if (!value.trim()) {
      if (importSource === "paste") {
        setHeaders([]);
        setRows([]);
        setImportSource(null);
        applyMapping({ nameColumn: null, studentIdColumn: null, titleColumn: null }, []);
        if (!rosterNameTouched) {
          setRosterName(existingRosterName);
        }
      }
      return;
    }

    try {
      const pastedRows = parsePastedStudentList(value);
      const pastedHeaders = [PASTED_ID_COLUMN, PASTED_NAME_COLUMN];
      const nextMapping: ColumnMapping = {
        studentIdColumn: PASTED_ID_COLUMN,
        nameColumn: PASTED_NAME_COLUMN,
        titleColumn: null,
      };

      setHeaders(pastedHeaders);
      setRows(pastedRows);
      setFileName("");
      setImportSource("paste");
      applyMapping(nextMapping, pastedRows);
    } catch (error) {
      setParseError(
        error instanceof Error ? error.message : "Could not parse pasted student list.",
      );
      setHeaders([]);
      setRows([]);
      setFileName("");
      setImportSource(null);
      applyMapping({ nameColumn: null, studentIdColumn: null, titleColumn: null }, []);
      if (!rosterNameTouched) {
        setRosterName(existingRosterName);
      }
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
      setSubmitError("Upload a CSV or paste students before importing.");
      return;
    }

    if (preview.errors.length > 0) {
      setSubmitError("Resolve the import issues before continuing.");
      return;
    }

    setIsSubmitting(true);
    try {
      const rosterId = isEditingExistingRoster && existingRosterId
        ? await importIntoExisting({
            rosterId: existingRosterId,
            name: rosterName.trim(),
            students: preview.validStudents,
            deactivateMissing,
          })
        : await importCsv({
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
        <h2 className="font-heading text-lg font-semibold tracking-tight text-slate-950">
          {isEditingExistingRoster ? "Update roster" : "Upload SchoolCashOnline CSV"}
        </h2>
        <div className="mt-4 space-y-4">
          <label className="block">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => void handleFileChange(event.target.files?.[0] ?? null)}
              className="sr-only"
            />
            <span className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-600">
              <span className="inline-flex h-11 items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-medium text-white">
                Upload SchoolCash CSV File
              </span>
              <span>
                {fileName && importSource === "file"
                  ? fileName
                  : "No SchoolCash CSV file chosen"}
              </span>
            </span>
          </label>

          <div className="flex items-center gap-3 pt-1">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              Or
            </span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">
              Paste student ID and name list
            </span>
            <textarea
              value={pastedText}
              onChange={(event) => handlePastedTextChange(event.target.value)}
              placeholder={`123456\tSmith, John\n234567\tJones, Maya`}
              rows={6}
              className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
            />
          </label>
        </div>
        {importSource === "paste" ? (
          <p className="mt-3 text-sm text-slate-500">Using pasted student list</p>
        ) : null}
        {parseError ? (
          <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {parseError}
          </p>
        ) : null}
        {hasImportData ? (
          <>
            <div className="space-y-4 border-t border-slate-200 pt-4">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Roster name</span>
                <input
                  value={rosterName}
                  onChange={(event) => {
                    setRosterNameTouched(true);
                    setRosterName(event.target.value);
                  }}
                  placeholder="Period 1 Homeroom"
                  className="h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-base text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Name column</span>
                  <select
                    value={mapping.nameColumn ?? ""}
                    onChange={(event) =>
                      applyMapping({
                        ...mapping,
                        nameColumn: event.target.value || null,
                      })
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
                      applyMapping({
                        ...mapping,
                        studentIdColumn: event.target.value || null,
                      })
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

                <label className="block sm:col-span-2">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    Roster title column
                  </span>
                  <select
                    value={mapping.titleColumn ?? ""}
                    onChange={(event) =>
                      applyMapping({
                        ...mapping,
                        titleColumn: event.target.value || null,
                      })
                    }
                    className="h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-base text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                  >
                    <option value="">No title column</option>
                    {headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {preview.errors.length > 0 ? (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {preview.errors.map((error) => (
                  <p key={error}>{error}</p>
                ))}
              </div>
            ) : null}

            {preview.inferredRosterName ? (
              <p className="mt-4 text-sm text-slate-600">
                Inferred roster title: <span className="font-medium text-slate-900">{preview.inferredRosterName}</span>
              </p>
            ) : null}

            {preview.titleWarnings.length > 0 ? (
              <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {preview.titleWarnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            ) : null}

            {omittedStudents.length > 0 ? (
              <label className="mt-3 block rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <span className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={deactivateMissing}
                    onChange={(event) => setDeactivateMissing(event.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-amber-700"
                  />
                  <span>
                    Deactivate {omittedStudents.length} student
                    {omittedStudents.length === 1 ? "" : "s"} not included in this import
                  </span>
                </span>
              </label>
            ) : null}

            <div className="mt-6 flex items-center justify-between gap-4">
              <div>
                <h2 className="font-heading text-lg font-semibold tracking-tight text-slate-950">
                  Preview
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {preview.rows.length} rows parsed • {preview.validStudents.length} ready to import
                </p>
              </div>
              <button
                type="submit"
                disabled={isSubmitting || preview.validStudents.length === 0 || preview.errors.length > 0}
                className="inline-flex h-12 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isSubmitting
                  ? "Importing..."
                  : isEditingExistingRoster
                    ? "Update roster"
                    : "Create roster"}
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
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}
      </section>
    </form>
  );
}
