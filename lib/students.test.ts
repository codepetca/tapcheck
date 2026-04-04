import { describe, expect, it } from "vitest";
import { buildImportPreview } from "./students";

describe("buildImportPreview", () => {
  it("accepts email-only roster imports", () => {
    const preview = buildImportPreview(
      [
        {
          "Student Name": "Chan, Stewart",
          "School Email": "stew.chan@example.edu",
        },
      ],
      {
        nameColumn: "Student Name",
        studentIdColumn: null,
        schoolEmailColumn: "School Email",
        titleColumn: null,
      },
    );

    expect(preview.errors).toEqual([]);
    expect(preview.validStudents).toEqual([
      expect.objectContaining({
        studentId: undefined,
        schoolEmail: "stew.chan@example.edu",
        displayName: "Stewart Chan",
      }),
    ]);
  });
});
