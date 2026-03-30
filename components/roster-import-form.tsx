"use client";

import { CircleHelp, Settings2, User } from "lucide-react";
import Papa from "papaparse";
import { useMutation, useQuery } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { useCurrentAppUser } from "@/components/use-current-app-user";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";
import { generateRosterName } from "@/lib/roster-names";
import { buildImportPreview, guessColumnMapping, type ColumnMapping } from "@/lib/students";

type CsvRow = Record<string, string>;
type ImportSource = "file" | "paste" | null;
type SourceMode = "file" | "paste";
type HelpModal = "file" | "paste" | null;

const PASTED_NAME_COLUMN = "Student Name";
const PASTED_ID_COLUMN = "Student ID";

function splitPastedLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.includes("\t")) {
    const [studentId, ...nameParts] = trimmed.split("\t");
    return {
      studentId: studentId?.trim() ?? "",
      studentName: nameParts.join(" ").trim(),
    };
  }

  const commaParts = trimmed.split(",");
  if (commaParts.length >= 2) {
    return {
      studentId: commaParts[0]?.trim() ?? "",
      studentName: commaParts.slice(1).join(",").trim(),
    };
  }

  const match = trimmed.match(/^(\S+)\s+(.+)$/);
  if (match) {
    return {
      studentId: match[1]?.trim() ?? "",
      studentName: match[2]?.trim() ?? "",
    };
  }

  return {
    studentId: trimmed,
    studentName: "",
  };
}

function parsePastedStudentList(input: string): CsvRow[] {
  const rows = input
    .split(/\r?\n/)
    .map((line) => splitPastedLine(line))
    .filter((row): row is { studentId: string; studentName: string } => row !== null)
    .map((row) => [row.studentId, row.studentName]);

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

function buildExistingRosterRows(
  students: Array<{ studentId: string; displayName: string; rawName: string }>,
): CsvRow[] {
  return students.map((student) => ({
    [PASTED_ID_COLUMN]: student.studentId,
    [PASTED_NAME_COLUMN]: student.displayName || student.rawName,
  }));
}

function buildExistingRosterText(
  students: Array<{ studentId: string; displayName: string; rawName: string }>,
) {
  return students
    .map((student) => `${student.studentId}\t${student.displayName || student.rawName}`)
    .join("\n");
}

export function RosterImportForm() {
  const { bootstrapError, isReady } = useCurrentAppUser();
  const searchParams = useSearchParams();
  const router = useRouter();
  const importCsv = useMutation(api.rosters.importCsv);
  const importIntoExisting = useMutation(api.rosters.importIntoExisting);
  const rosterIdParam = searchParams.get("rosterId");
  const existingRosterId = rosterIdParam as Id<"rosters"> | null;
  const existingRoster = useQuery(
    api.rosters.getById,
    isReady && existingRosterId ? { rosterId: existingRosterId } : "skip",
  );

  const [rosterName, setRosterName] = useState("");
  const [rosterNameTouched, setRosterNameTouched] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [importSource, setImportSource] = useState<ImportSource>(null);
  const [sourceMode, setSourceMode] = useState<SourceMode>("file");
  const [mapping, setMapping] = useState<ColumnMapping>({
    nameColumn: null,
    studentIdColumn: null,
    titleColumn: null,
  });
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pastedRosterName, setPastedRosterName] = useState(() => generateRosterName());
  const [pendingSourceMode, setPendingSourceMode] = useState<SourceMode | null>(null);
  const [seededExistingRosterId, setSeededExistingRosterId] = useState<string | null>(null);
  const [areOptionsOpen, setAreOptionsOpen] = useState(false);
  const [helpModal, setHelpModal] = useState<HelpModal>(null);

  const preview = buildImportPreview(rows, mapping);
  const hasImportData = rows.length > 0;
  const isEditingExistingRoster = Boolean(existingRosterId);
  const existingRosterName = existingRoster?.roster.name ?? "";
  const hasFileSourceData = importSource === "file" && (Boolean(fileName) || rows.length > 0);
  const hasPasteSourceData =
    importSource === "paste" && (Boolean(pastedText.trim()) || rows.length > 0);
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

    const nextName =
      importSource === "paste"
        ? isEditingExistingRoster
          ? existingRosterName
          : pastedRosterName
        : preview.inferredRosterName || existingRosterName;
    if (nextName && rosterName !== nextName) {
      setRosterName(nextName);
    }
  }, [
    existingRosterName,
    importSource,
    isEditingExistingRoster,
    pastedRosterName,
    preview.inferredRosterName,
    rosterName,
    rosterNameTouched,
  ]);

  useEffect(() => {
    if (omittedStudents.length === 0 && deactivateMissing) {
      setDeactivateMissing(false);
    }
  }, [deactivateMissing, omittedStudents.length]);

  useEffect(() => {
    if (!isEditingExistingRoster) {
      setSeededExistingRosterId(null);
      return;
    }

    if (!existingRoster || seededExistingRosterId === existingRoster.roster._id) {
      return;
    }

    const seededRows = buildExistingRosterRows(existingRoster.students);
    const seededMapping: ColumnMapping = {
      studentIdColumn: PASTED_ID_COLUMN,
      nameColumn: PASTED_NAME_COLUMN,
      titleColumn: null,
    };

    setSourceMode("paste");
    setImportSource("paste");
    setHeaders([PASTED_ID_COLUMN, PASTED_NAME_COLUMN]);
    setRows(seededRows);
    setFileName("");
    setPastedText(buildExistingRosterText(existingRoster.students));
    setParseError(null);
    setSubmitError(null);
    setMapping(seededMapping);
    setAreOptionsOpen(false);
    setDeactivateMissing(false);

    if (!rosterNameTouched) {
      setRosterName(existingRoster.roster.name);
    }

    setSeededExistingRosterId(existingRoster.roster._id);
  }, [
    existingRoster,
    isEditingExistingRoster,
    rosterNameTouched,
    seededExistingRosterId,
  ]);

  if (bootstrapError) {
    return (
      <div className="rounded-[28px] border border-rose-200 bg-rose-50/90 px-5 py-6 text-sm text-rose-800 shadow-sm">
        {bootstrapError}
      </div>
    );
  }

  if (!isReady) {
    return <div className="h-64 animate-pulse rounded-[28px] border border-white/70 bg-white/90" />;
  }

  function applyMapping(
    nextMapping: ColumnMapping,
    nextRows = rows,
    nextImportSource: ImportSource = importSource,
  ) {
    setMapping(nextMapping);

    if (!rosterNameTouched) {
      if (nextImportSource === "paste" && !isEditingExistingRoster) {
        setRosterName(pastedRosterName);
        return;
      }

      const nextPreview = buildImportPreview(nextRows, nextMapping);
      setRosterName(nextPreview.inferredRosterName || existingRosterName);
    }
  }

  function clearImportState(nextSourceMode: SourceMode) {
    const nextGeneratedRosterName = generateRosterName();

    setHeaders([]);
    setRows([]);
    setFileName("");
    setPastedText("");
    setImportSource(null);
    setParseError(null);
    setSubmitError(null);
    setMapping({ nameColumn: null, studentIdColumn: null, titleColumn: null });
    setAreOptionsOpen(false);
    setHelpModal(null);
    setPastedRosterName(nextGeneratedRosterName);

    if (!rosterNameTouched) {
      setRosterName(
        nextSourceMode === "paste"
          ? isEditingExistingRoster
            ? existingRosterName
            : nextGeneratedRosterName
          : existingRosterName,
      );
    }
  }

  function switchSourceMode(nextSourceMode: SourceMode) {
    if (sourceMode === nextSourceMode) {
      return;
    }

    const needsConfirmation =
      (sourceMode === "file" && hasFileSourceData) ||
      (sourceMode === "paste" && hasPasteSourceData);

    if (needsConfirmation) {
      setPendingSourceMode(nextSourceMode);
      return;
    }

    setSourceMode(nextSourceMode);
    clearImportState(nextSourceMode);
  }

  async function handleFileChange(file: File | null) {
    setParseError(null);
    setSubmitError(null);

    if (!file) {
      setHeaders([]);
      setRows([]);
      setFileName("");
      setImportSource(null);
      setPastedRosterName(generateRosterName());
      setAreOptionsOpen(false);
      setHelpModal(null);
      applyMapping({ nameColumn: null, studentIdColumn: null, titleColumn: null }, [], null);
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
      setPastedRosterName(generateRosterName());
      setAreOptionsOpen(!(nextMapping.nameColumn && nextMapping.studentIdColumn));
      setHelpModal(null);
      applyMapping(nextMapping, normalizedRows, "file");
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Could not parse CSV.");
      setHeaders([]);
      setRows([]);
      setFileName("");
      setImportSource(null);
      setPastedRosterName(generateRosterName());
      setAreOptionsOpen(false);
      setHelpModal(null);
      applyMapping({ nameColumn: null, studentIdColumn: null, titleColumn: null }, [], null);
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
        setPastedRosterName(generateRosterName());
        setAreOptionsOpen(false);
        setHelpModal(null);
        applyMapping({ nameColumn: null, studentIdColumn: null, titleColumn: null }, [], null);
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
      const nextPastedRosterName =
        importSource === "paste" ? pastedRosterName : generateRosterName();

      setHeaders(pastedHeaders);
      setRows(pastedRows);
      setFileName("");
      setImportSource("paste");
      setPastedRosterName(nextPastedRosterName);
      setMapping(nextMapping);
      setAreOptionsOpen(false);
      setHelpModal(null);
      if (!rosterNameTouched) {
        setRosterName(isEditingExistingRoster ? existingRosterName : nextPastedRosterName);
      }
    } catch (error) {
      setParseError(
        error instanceof Error ? error.message : "Could not parse pasted student list.",
      );
      setHeaders([]);
      setRows([]);
      setFileName("");
      setImportSource(null);
      setPastedRosterName(generateRosterName());
      setAreOptionsOpen(false);
      setHelpModal(null);
      applyMapping({ nameColumn: null, studentIdColumn: null, titleColumn: null }, [], null);
      if (!rosterNameTouched) {
        setRosterName(existingRosterName);
      }
    }
  }

  async function handleImport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);

    if (!rosterName.trim()) {
      setSubmitError("Roster title is required.");
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

  if (isEditingExistingRoster && existingRoster === undefined) {
    return <div className="h-64 animate-pulse rounded-[28px] border border-white/70 bg-white/90" />;
  }

  if (isEditingExistingRoster && existingRoster === null) {
    return (
      <section className="rounded-[28px] border border-white/70 bg-white/90 px-5 py-8 text-sm text-slate-600 shadow-sm">
        This roster does not exist.
      </section>
    );
  }

  return (
    <form onSubmit={handleImport} className="space-y-4">
      <ConfirmDialog
        open={pendingSourceMode !== null}
        title="Switch import source?"
        description={`Switching to ${pendingSourceMode === "paste" ? "Paste list" : "Upload CSV"} will clear the current preview.`}
        confirmLabel={pendingSourceMode === "paste" ? "Use Paste list" : "Use Upload CSV"}
        onConfirm={() => {
          if (!pendingSourceMode) {
            return;
          }
          setSourceMode(pendingSourceMode);
          clearImportState(pendingSourceMode);
          setPendingSourceMode(null);
        }}
        onCancel={() => setPendingSourceMode(null)}
      />
      <Dialog open={helpModal !== null} onClose={() => setHelpModal(null)}>
        <Card className="w-full border border-white/70 bg-white shadow-xl ring-0">
          <p className="text-sm leading-6 text-slate-600">
            {helpModal === "paste"
              ? "Paste or type student ID and name"
              : "CSV can be many formats including entire SchoolCash Online CSV files."}
          </p>
        </Card>
      </Dialog>
      <section className="rounded-[28px] border border-white/70 bg-white/90 p-5 shadow-sm">
        <div className="space-y-4">
          <div className="flex rounded-2xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => switchSourceMode("file")}
              className={`flex-1 rounded-[18px] px-4 py-2.5 text-sm font-medium transition ${
                sourceMode === "file"
                  ? "bg-white text-slate-950 shadow-sm"
                  : "text-slate-600 hover:text-slate-950"
              }`}
            >
              Upload CSV
            </button>
            <button
              type="button"
              onClick={() => switchSourceMode("paste")}
              className={`flex-1 rounded-[18px] px-4 py-2.5 text-sm font-medium transition ${
                sourceMode === "paste"
                  ? "bg-white text-slate-950 shadow-sm"
                  : "text-slate-600 hover:text-slate-950"
              }`}
            >
              Paste list
            </button>
          </div>

          {sourceMode === "file" ? (
            <>
              <label className="mb-2 block">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => void handleFileChange(event.target.files?.[0] ?? null)}
                  className="sr-only"
                />
                <span className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-600">
                  <span className="inline-flex h-11 items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-medium text-white">
                    Choose file
                  </span>
                  <span
                    className={
                      fileName && importSource === "file"
                        ? "font-semibold text-slate-950"
                        : "text-slate-500"
                    }
                  >
                    {fileName && importSource === "file"
                    ? fileName
                    : "No file chosen"}
                  </span>
                  <span className="ml-auto">
                    <button
                      type="button"
                      aria-label="Supported CSV formats"
                      aria-expanded={helpModal === "file"}
                      onClick={(event) => {
                        event.preventDefault();
                        setHelpModal((current) => (current === "file" ? null : "file"));
                      }}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:text-slate-600"
                    >
                      <CircleHelp className="h-4 w-4" />
                    </button>
                  </span>
                </span>
              </label>
            </>
          ) : (
            <label className="block">
              <div className="relative">
                <button
                  type="button"
                  aria-label="Paste list help"
                  aria-expanded={helpModal === "paste"}
                  onClick={() => setHelpModal((current) => (current === "paste" ? null : "paste"))}
                  className="absolute right-3 top-3 z-10 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:text-slate-600"
                >
                  <CircleHelp className="h-4 w-4" />
                </button>
                <textarea
                  aria-label="Paste student list"
                  value={pastedText}
                  onChange={(event) => handlePastedTextChange(event.target.value)}
                  placeholder={`123456\tSmith, John\n234567\tJones, Maya`}
                  rows={6}
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 pr-12 text-sm text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                />
              </div>
            </label>
          )}
        </div>
        {parseError ? (
          <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {parseError}
          </p>
        ) : null}
        {hasImportData ? (
          <>
            <div className="space-y-4">
              <div className="space-y-2">
                <span className="block text-base font-semibold text-slate-900">Title</span>
                <div className="flex items-center gap-3">
                  <input
                    value={rosterName}
                    onChange={(event) => {
                      setRosterNameTouched(true);
                      setRosterName(event.target.value);
                    }}
                    placeholder="Period 1 Homeroom"
                    className="h-12 min-w-0 flex-1 rounded-2xl border border-slate-300 bg-white px-4 text-base text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                  />
                  {importSource === "file" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label="Import settings"
                      className="h-12 w-12 shrink-0 px-0 text-slate-500"
                      onClick={() => setAreOptionsOpen((current) => !current)}
                    >
                      <Settings2 className="h-4.5 w-4.5" />
                    </Button>
                  ) : null}
                </div>
              </div>

              {importSource === "file" && areOptionsOpen ? (
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
                </div>
              ) : null}
            </div>

            {preview.errors.length > 0 ? (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {preview.errors.map((error) => (
                  <p key={error}>{error}</p>
                ))}
              </div>
            ) : null}

            {importSource === "file" && preview.titleWarnings.length > 0 ? (
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

            <div className="mt-6">
              <button
                type="submit"
                disabled={isSubmitting || preview.validStudents.length === 0 || preview.errors.length > 0}
                className="inline-flex h-12 w-full items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
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

            <div className="mt-6 flex items-center justify-between gap-4">
              <h2 className="font-heading text-lg font-semibold tracking-tight text-slate-950">
                Preview
              </h2>
            </div>

            <div className="mt-4 overflow-hidden rounded-[24px] border border-slate-200">
              <div className="max-h-[28rem] overflow-auto">
                <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 font-medium text-slate-600">Row</th>
                      <th className="px-4 py-3 font-medium text-slate-600">
                        <span className="inline-flex items-center gap-2">
                          <span>Student</span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                            <span>{preview.rows.length}</span>
                            <User className="h-3.5 w-3.5" />
                          </span>
                        </span>
                      </th>
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
