export type NormalizedStudent = {
  studentId: string;
  rawName: string;
  firstName: string;
  lastName: string;
  displayName: string;
  sortKey: string;
};

export type ColumnMapping = {
  nameColumn: string | null;
  studentIdColumn: string | null;
};

export type ImportPreviewRow = NormalizedStudent & {
  rowNumber: number;
  errors: string[];
  isDuplicate: boolean;
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

export function normalizeStudent(rawName: string, studentId: string): NormalizedStudent {
  const parsedName = parseStudentName(rawName);
  return {
    studentId: cleanValue(studentId),
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

  return { nameColumn, studentIdColumn };
}

export function buildImportPreview(rows: CsvRow[], mapping: ColumnMapping) {
  const errors: string[] = [];

  if (!mapping.nameColumn) {
    errors.push("Choose the column containing student names.");
  }

  if (!mapping.studentIdColumn) {
    errors.push("Choose the column containing student IDs.");
  }

  if (errors.length > 0) {
    return {
      rows: [] as ImportPreviewRow[],
      errors,
      duplicateStudentIds: [] as string[],
      validStudents: [] as NormalizedStudent[],
    };
  }

  const previewRows = rows.map((row, index) => {
    const rawName = cleanValue(row[mapping.nameColumn!]);
    const studentId = cleanValue(row[mapping.studentIdColumn!]);
    const normalized = normalizeStudent(rawName, studentId);
    const rowErrors: string[] = [];

    if (!normalized.rawName) {
      rowErrors.push("Missing name.");
    }

    if (!normalized.studentId) {
      rowErrors.push("Missing student ID.");
    }

    return {
      ...normalized,
      rowNumber: index + 2,
      errors: rowErrors,
      isDuplicate: false,
    };
  });

  const counts = new Map<string, number>();
  for (const row of previewRows) {
    if (!row.studentId) {
      continue;
    }
    counts.set(row.studentId, (counts.get(row.studentId) ?? 0) + 1);
  }

  const duplicateStudentIds = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([studentId]) => studentId);

  const duplicateSet = new Set(duplicateStudentIds);
  for (const row of previewRows) {
    if (duplicateSet.has(row.studentId)) {
      row.isDuplicate = true;
      row.errors.push("Duplicate student ID in this import.");
    }
  }

  if (duplicateStudentIds.length > 0) {
    errors.push("Resolve duplicate student IDs before importing.");
  }

  const validStudents = previewRows
    .filter((row) => row.errors.length === 0)
    .map((row) => ({
      studentId: row.studentId,
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
  };
}
