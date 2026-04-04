export type NormalizedStudent = {
  studentId?: string;
  schoolEmail?: string;
  rawName: string;
  firstName: string;
  lastName: string;
  displayName: string;
  sortKey: string;
};

export type ColumnMapping = {
  nameColumn: string | null;
  studentIdColumn: string | null;
  schoolEmailColumn: string | null;
  titleColumn: string | null;
};

export type ImportPreviewRow = NormalizedStudent & {
  rowNumber: number;
  errors: string[];
  isDuplicate: boolean;
};

type ImportPreviewOptions = {
  existingStudentIds?: string[];
};

type CsvRow = Record<string, unknown>;

function cleanValue(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function buildSortKey(lastName: string, firstName: string, rawName: string) {
  return [lastName, firstName, rawName]
    .map((part) => cleanValue(part).toLocaleLowerCase())
    .filter(Boolean)
    .join("\u0000");
}

export function parseStudentName(rawName: string) {
  const cleaned = cleanValue(rawName);
  if (!cleaned) {
    return {
      rawName: "",
      firstName: "",
      lastName: "",
      displayName: "",
      sortKey: "",
    };
  }

  if (cleaned.includes(",")) {
    const [lastNamePart, ...rest] = cleaned.split(",");
    const lastName = cleanValue(lastNamePart);
    const firstName = cleanValue(rest.join(","));
    const displayName = cleanValue(`${firstName} ${lastName}`) || cleaned;

    return {
      rawName: cleaned,
      firstName,
      lastName,
      displayName,
      sortKey: buildSortKey(lastName, firstName, cleaned),
    };
  }

  const pieces = cleaned.split(" ");
  const firstName = cleanValue(pieces.slice(0, -1).join(" "));
  const lastName = cleanValue(pieces.slice(-1).join(" "));

  return {
    rawName: cleaned,
    firstName,
    lastName,
    displayName: cleaned,
    sortKey: buildSortKey(lastName, firstName, cleaned),
  };
}

function normalizeSchoolEmail(schoolEmail: string) {
  const cleaned = cleanValue(schoolEmail);
  return cleaned ? cleaned.toLocaleLowerCase() : undefined;
}

export function buildStudentIdentityKey(student: Pick<NormalizedStudent, "studentId" | "schoolEmail">) {
  return student.studentId ? `student:${student.studentId}` : student.schoolEmail ? `email:${student.schoolEmail}` : "";
}

export function normalizeStudent(rawName: string, studentId: string, schoolEmail?: string): NormalizedStudent {
  const parsedName = parseStudentName(rawName);
  return {
    studentId: cleanValue(studentId) || undefined,
    schoolEmail: normalizeSchoolEmail(schoolEmail ?? ""),
    rawName: parsedName.rawName,
    firstName: parsedName.firstName,
    lastName: parsedName.lastName,
    displayName: parsedName.displayName,
    sortKey: parsedName.sortKey,
  };
}

export function guessColumnMapping(headers: string[]): ColumnMapping {
  const lowered = headers.map((header) => ({
    raw: header,
    normalized: header.toLocaleLowerCase(),
  }));

  const nameColumn =
    lowered.find(({ normalized }) => normalized.includes("student name"))?.raw ??
    lowered.find(({ normalized }) => normalized.includes("name"))?.raw ??
    null;

  const studentIdColumn =
    lowered.find(
      ({ normalized }) =>
        normalized.includes("student id") ||
        normalized.includes("student number") ||
        normalized === "id",
    )?.raw ??
    lowered.find(({ normalized }) => normalized.includes("id"))?.raw ??
    null;
  const schoolEmailColumn =
    lowered.find(
      ({ normalized }) =>
        normalized.includes("school email") ||
        normalized.includes("student email") ||
        normalized.includes("email address"),
    )?.raw ??
    lowered.find(({ normalized }) => normalized === "email" || normalized.includes("email"))?.raw ??
    null;

  const titleColumn =
    lowered.find(
      ({ normalized }) =>
        normalized.includes("item name") ||
        normalized.includes("course name") ||
        normalized.includes("class name") ||
        normalized.includes("roster name"),
    )?.raw ??
    lowered.find(({ normalized }) => normalized.includes("title"))?.raw ??
    null;

  return { nameColumn, studentIdColumn, schoolEmailColumn, titleColumn };
}

function inferRosterName(rows: CsvRow[], titleColumn: string | null) {
  if (!titleColumn) {
    return {
      inferredRosterName: "",
      titleWarnings: [] as string[],
    };
  }

  const values = rows
    .map((row) => cleanValue(row[titleColumn]))
    .filter(Boolean);

  if (values.length === 0) {
    return {
      inferredRosterName: "",
      titleWarnings: [] as string[],
    };
  }

  const distinctValues = [...new Set(values)];

  return {
    inferredRosterName: distinctValues[0] ?? "",
    titleWarnings:
      distinctValues.length > 1
        ? ["Multiple roster titles were found in the selected title column. Using the first value."]
        : [],
  };
}

export function buildImportPreview(
  rows: CsvRow[],
  mapping: ColumnMapping,
  options?: ImportPreviewOptions,
) {
  const errors: string[] = [];
  const { inferredRosterName, titleWarnings } = inferRosterName(rows, mapping.titleColumn);
  const existingStudentIdSet = new Set(options?.existingStudentIds ?? []);

  if (!mapping.nameColumn) {
    errors.push("Choose the column containing student names.");
  }

  if (!mapping.studentIdColumn && !mapping.schoolEmailColumn) {
    errors.push("Choose at least one identifier column: student ID or school email.");
  }

  if (errors.length > 0) {
    return {
      rows: [] as ImportPreviewRow[],
      errors,
      duplicateStudentIds: [] as string[],
      validStudents: [] as NormalizedStudent[],
      inferredRosterName,
      titleWarnings,
    };
  }

  const previewRows = rows.map((row, index) => {
    const rawName = cleanValue(row[mapping.nameColumn!]);
    const studentId = mapping.studentIdColumn ? cleanValue(row[mapping.studentIdColumn]) : "";
    const schoolEmail = mapping.schoolEmailColumn ? cleanValue(row[mapping.schoolEmailColumn]) : "";
    const normalized = normalizeStudent(rawName, studentId, schoolEmail);
    const rowErrors: string[] = [];

    if (!normalized.rawName) {
      rowErrors.push("Missing name.");
    }

    if (!normalized.studentId && !normalized.schoolEmail) {
      rowErrors.push("Missing student ID or school email.");
    }

    return {
      ...normalized,
      rowNumber: index + 2,
      errors: rowErrors,
      isDuplicate: false,
    };
  });

  const studentIdCounts = new Map<string, number>();
  const schoolEmailCounts = new Map<string, number>();
  for (const row of previewRows) {
    if (row.studentId) {
      studentIdCounts.set(row.studentId, (studentIdCounts.get(row.studentId) ?? 0) + 1);
    }
    if (row.schoolEmail) {
      schoolEmailCounts.set(row.schoolEmail, (schoolEmailCounts.get(row.schoolEmail) ?? 0) + 1);
    }
  }

  const duplicateStudentIds = [...studentIdCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([studentId]) => studentId);
  const duplicateSchoolEmails = [...schoolEmailCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([schoolEmail]) => schoolEmail);

  const duplicateStudentIdSet = new Set(duplicateStudentIds);
  const duplicateSchoolEmailSet = new Set(duplicateSchoolEmails);
  for (const row of previewRows) {
    if (row.studentId && duplicateStudentIdSet.has(row.studentId)) {
      row.isDuplicate = true;
      row.errors.push("Duplicate student ID in this import.");
    }
    if (row.schoolEmail && duplicateSchoolEmailSet.has(row.schoolEmail)) {
      row.isDuplicate = true;
      row.errors.push("Duplicate school email in this import.");
    }
    if (row.studentId && existingStudentIdSet.has(row.studentId)) {
      row.errors.push("Student ID already exists in this roster.");
    }
  }

  if (duplicateStudentIds.length > 0) {
    errors.push("Resolve duplicate student IDs before importing.");
  }

  if (duplicateSchoolEmails.length > 0) {
    errors.push("Resolve duplicate school emails before importing.");
  }

  if (previewRows.some((row) => row.errors.includes("Student ID already exists in this roster."))) {
    errors.push("Resolve student IDs that already exist in this roster before importing.");
  }

  const validStudents = previewRows
    .filter((row) => row.errors.length === 0)
    .map((row) => ({
      studentId: row.studentId,
      schoolEmail: row.schoolEmail,
      rawName: row.rawName,
      firstName: row.firstName,
      lastName: row.lastName,
      displayName: row.displayName,
      sortKey: row.sortKey,
    }));

  return {
    rows: previewRows,
    errors,
    duplicateStudentIds,
    validStudents,
    inferredRosterName,
    titleWarnings,
  };
}
