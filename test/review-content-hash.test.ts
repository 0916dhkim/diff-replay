import { describe, expect, it } from "vitest";

import { computeCanonicalDiffHash } from "../src/review-content-hash.js";

describe("computeCanonicalDiffHash", () => {
  it("produces identical hashes when only volatile metadata differs", () => {
    const diffLf = [
      "diff --git a/src/greet.ts b/src/greet.ts",
      "index 1234567..89abcdef 100644",
      "--- a/src/greet.ts",
      "+++ b/src/greet.ts",
      "@@ -10,5 +10,6 @@ function greet() {",
      " const prefix = 'Hello';",
      "+const target = 'World';",
      " console.log(prefix);",
      "",
    ].join("\n");

    const diffCrlfShifted = [
      "diff --git a/src/greet.ts b/src/greet.ts",
      "index fedcba9..0123456 100644",
      "--- a/src/greet.ts",
      "+++ b/src/greet.ts",
      "@@ -150,12 +150,13 @@ function otherSurroundingScope() {",
      " const differentContextLine = true;",
      "+const target = 'World';",
      " const yetAnotherContext = 123;",
    ].join("\r\n");

    const hash1 = computeCanonicalDiffHash({ filePath: "src/greet.ts", diff: diffLf });
    const hash2 = computeCanonicalDiffHash({ filePath: "src/greet.ts", diff: diffCrlfShifted });

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces different hashes when additions or removals change", () => {
    const base = [
      "diff --git a/src/calc.ts b/src/calc.ts",
      "--- a/src/calc.ts",
      "+++ b/src/calc.ts",
      "@@ -1,3 +1,3 @@",
      "-const result = 1;",
      "+const result = 2;",
    ].join("\n");

    const changedAddition = [
      "diff --git a/src/calc.ts b/src/calc.ts",
      "--- a/src/calc.ts",
      "+++ b/src/calc.ts",
      "@@ -1,3 +1,3 @@",
      "-const result = 1;",
      "+const result = 3;",
    ].join("\n");

    const changedRemoval = [
      "diff --git a/src/calc.ts b/src/calc.ts",
      "--- a/src/calc.ts",
      "+++ b/src/calc.ts",
      "@@ -1,3 +1,3 @@",
      "-const result = 0;",
      "+const result = 2;",
    ].join("\n");

    const baseHash = computeCanonicalDiffHash({ filePath: "src/calc.ts", diff: base });
    const additionHash = computeCanonicalDiffHash({
      filePath: "src/calc.ts",
      diff: changedAddition,
    });
    const removalHash = computeCanonicalDiffHash({ filePath: "src/calc.ts", diff: changedRemoval });

    expect(baseHash).not.toBe(additionHash);
    expect(baseHash).not.toBe(removalHash);
    expect(additionHash).not.toBe(removalHash);
  });

  it("preserves exact whitespace in additions and removals", () => {
    const twoSpaces = "+  const a = 1;";
    const fourSpaces = "+    const a = 1;";

    const hash1 = computeCanonicalDiffHash({ filePath: "src/indent.ts", diff: twoSpaces });
    const hash2 = computeCanonicalDiffHash({ filePath: "src/indent.ts", diff: fourSpaces });

    expect(hash1).not.toBe(hash2);
  });

  it("produces different hashes for the same changes in a different file path", () => {
    const diff = "+export const shared = true;";

    const hashA = computeCanonicalDiffHash({ filePath: "src/first.ts", diff });
    const hashB = computeCanonicalDiffHash({ filePath: "src/second.ts", diff });

    expect(hashA).not.toBe(hashB);
  });

  it("distinguishes file mode changes", () => {
    const normalMode = [
      "diff --git a/bin/run.sh b/bin/run.sh",
      "old mode 100644",
      "new mode 100755",
      "+echo 'start'",
    ].join("\n");

    const reverseMode = [
      "diff --git a/bin/run.sh b/bin/run.sh",
      "old mode 100755",
      "new mode 100644",
      "+echo 'start'",
    ].join("\n");

    const newFileMode = [
      "diff --git a/bin/run.sh b/bin/run.sh",
      "new file mode 100755",
      "+echo 'start'",
    ].join("\n");

    const deletedFileMode = [
      "diff --git a/bin/run.sh b/bin/run.sh",
      "deleted file mode 100755",
      "+echo 'start'",
    ].join("\n");

    const hashes = new Set([
      computeCanonicalDiffHash({ filePath: "bin/run.sh", diff: normalMode }),
      computeCanonicalDiffHash({ filePath: "bin/run.sh", diff: reverseMode }),
      computeCanonicalDiffHash({ filePath: "bin/run.sh", diff: newFileMode }),
      computeCanonicalDiffHash({ filePath: "bin/run.sh", diff: deletedFileMode }),
    ]);

    expect(hashes.size).toBe(4);
  });

  it("distinguishes rename, copy, and similarity metadata", () => {
    const rename95 = [
      "diff --git a/src/old.ts b/src/new.ts",
      "similarity index 95%",
      "rename from src/old.ts",
      "rename to src/new.ts",
      "+export const renamed = true;",
    ].join("\n");

    const rename90 = [
      "diff --git a/src/old.ts b/src/new.ts",
      "similarity index 90%",
      "rename from src/old.ts",
      "rename to src/new.ts",
      "+export const renamed = true;",
    ].join("\n");

    const copy95 = [
      "diff --git a/src/old.ts b/src/new.ts",
      "similarity index 95%",
      "copy from src/old.ts",
      "copy to src/new.ts",
      "+export const renamed = true;",
    ].join("\n");

    const hashRename95 = computeCanonicalDiffHash({ filePath: "src/new.ts", diff: rename95 });
    const hashRename90 = computeCanonicalDiffHash({ filePath: "src/new.ts", diff: rename90 });
    const hashCopy95 = computeCanonicalDiffHash({ filePath: "src/new.ts", diff: copy95 });

    expect(hashRename95).not.toBe(hashRename90);
    expect(hashRename95).not.toBe(hashCopy95);
  });

  it("distinguishes binary diff formats and payloads", () => {
    const binaryDiffer = [
      "diff --git a/assets/logo.png b/assets/logo.png",
      "Binary files a/assets/logo.png and b/assets/logo.png differ",
    ].join("\n");

    const gitBinaryPatchA = [
      "diff --git a/assets/logo.png b/assets/logo.png",
      "GIT binary patch",
      "literal 12",
      "zcmV-&0(N4b1|O&B4`5k+00000000000000000000000000000000000000000",
    ].join("\n");

    const gitBinaryPatchB = [
      "diff --git a/assets/logo.png b/assets/logo.png",
      "GIT binary patch",
      "literal 12",
      "zcmV-&999991|O&B4`5k+00000000000000000000000000000000000000000",
    ].join("\n");

    const hashDiffer = computeCanonicalDiffHash({
      filePath: "assets/logo.png",
      diff: binaryDiffer,
    });
    const hashPatchA = computeCanonicalDiffHash({
      filePath: "assets/logo.png",
      diff: gitBinaryPatchA,
    });
    const hashPatchB = computeCanonicalDiffHash({
      filePath: "assets/logo.png",
      diff: gitBinaryPatchB,
    });

    expect(hashDiffer).not.toBe(hashPatchA);
    expect(hashPatchA).not.toBe(hashPatchB);
  });

  it("includes index hashes for standard Binary files differ diffs while ignoring them for text diffs", () => {
    const binaryDiffA = [
      "diff --git a/assets/logo.png b/assets/logo.png",
      "index 1111111..2222222 100644",
      "Binary files a/assets/logo.png and b/assets/logo.png differ",
    ].join("\n");

    const binaryDiffB = [
      "diff --git a/assets/logo.png b/assets/logo.png",
      "index 1111111..3333333 100644",
      "Binary files a/assets/logo.png and b/assets/logo.png differ",
    ].join("\n");

    const textDiffA = [
      "diff --git a/src/code.ts b/src/code.ts",
      "index 1111111..2222222 100644",
      "--- a/src/code.ts",
      "+++ b/src/code.ts",
      "@@ -1 +1 @@",
      "+const x = 1;",
    ].join("\n");

    const textDiffB = [
      "diff --git a/src/code.ts b/src/code.ts",
      "index 1111111..3333333 100644",
      "--- a/src/code.ts",
      "+++ b/src/code.ts",
      "@@ -1 +1 @@",
      "+const x = 1;",
    ].join("\n");

    const hashBinaryA = computeCanonicalDiffHash({
      filePath: "assets/logo.png",
      diff: binaryDiffA,
    });
    const hashBinaryB = computeCanonicalDiffHash({
      filePath: "assets/logo.png",
      diff: binaryDiffB,
    });
    const hashTextA = computeCanonicalDiffHash({ filePath: "src/code.ts", diff: textDiffA });
    const hashTextB = computeCanonicalDiffHash({ filePath: "src/code.ts", diff: textDiffB });

    expect(hashBinaryA).not.toBe(hashBinaryB);
    expect(hashTextA).toBe(hashTextB);
  });

  it("preserves EOF newline markers", () => {
    const withoutEofNewline = "+export const x = 1;\n\\ No newline at end of file";
    const withEofNewline = "+export const x = 1;\n";

    const hash1 = computeCanonicalDiffHash({
      filePath: "src/file.ts",
      diff: withoutEofNewline,
    });
    const hash2 = computeCanonicalDiffHash({ filePath: "src/file.ts", diff: withEofNewline });

    expect(hash1).not.toBe(hash2);
  });

  it("handles multi-file diffs while ignoring volatile metadata in each file", () => {
    const multiFile1 = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,3 +1,4 @@",
      " context 1",
      "+export const a = 1;",
      "diff --git a/src/b.ts b/src/b.ts",
      "index 3333333..4444444 100644",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -10,3 +10,4 @@",
      " context 2",
      "+export const b = 2;",
    ].join("\n");

    const multiFile2 = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index aaaaaaa..bbbbbbb 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -99,10 +99,11 @@ function shiftedA() {",
      " other context line",
      "+export const a = 1;",
      "diff --git a/src/b.ts b/src/b.ts",
      "index ccccccc..ddddddd 100644",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -200,10 +200,11 @@ function shiftedB() {",
      " yet another context",
      "+export const b = 2;",
    ].join("\r\n");

    const hash1 = computeCanonicalDiffHash({ filePath: "src/a.ts", diff: multiFile1 });
    const hash2 = computeCanonicalDiffHash({ filePath: "src/a.ts", diff: multiFile2 });

    expect(hash1).toBe(hash2);
  });

  it("normalizes combined diff hunk headers (@@@)", () => {
    const combined1 = [
      "diff --cc src/merge.ts",
      "index 1234567,89abcdef..0000000",
      "--- a/src/merge.ts",
      "+++ b/src/merge.ts",
      "@@@ -1,3 -1,3 +1,4 @@@",
      "  context",
      "++export const merged = true;",
    ].join("\n");

    const combined2 = [
      "diff --cc src/merge.ts",
      "index 7654321,fedcba9..1111111",
      "--- a/src/merge.ts",
      "+++ b/src/merge.ts",
      "@@@ -50,5 -50,5 +50,6 @@@ function mergedContext() {",
      "  different context",
      "++export const merged = true;",
    ].join("\n");

    const hash1 = computeCanonicalDiffHash({ filePath: "src/merge.ts", diff: combined1 });
    const hash2 = computeCanonicalDiffHash({ filePath: "src/merge.ts", diff: combined2 });

    expect(hash1).toBe(hash2);
  });

  it("falls back to normalized raw diff for plain/non-unified input so different texts do not collapse", () => {
    const plain1 = "Initial design note for component";
    const plain2 = "Revised design note for component";
    const plainWithCrlf = "Initial design note for component\r\n";

    const hash1 = computeCanonicalDiffHash({ filePath: "notes.txt", diff: plain1 });
    const hash2 = computeCanonicalDiffHash({ filePath: "notes.txt", diff: plain2 });
    const hash1Crlf = computeCanonicalDiffHash({ filePath: "notes.txt", diff: plainWithCrlf });

    expect(hash1).not.toBe(hash2);
    expect(hash1).toBe(hash1Crlf);
  });

  it("preserves leading and trailing spaces in plain diff fallback while treating terminal newlines as insignificant", () => {
    const plainBase = "some plain content";
    const plainLeading = "  some plain content";
    const plainTrailing3 = "some plain content   ";
    const plainTrailing4 = "some plain content    ";

    const plainTrailing3Lf = "some plain content   \n";
    const plainTrailing3Crlf = "some plain content   \r\n";
    const plainTrailing3MultiLf = "some plain content   \n\n";

    const hashBase = computeCanonicalDiffHash({ filePath: "notes.txt", diff: plainBase });
    const hashLeading = computeCanonicalDiffHash({ filePath: "notes.txt", diff: plainLeading });
    const hashTrailing3 = computeCanonicalDiffHash({ filePath: "notes.txt", diff: plainTrailing3 });
    const hashTrailing4 = computeCanonicalDiffHash({ filePath: "notes.txt", diff: plainTrailing4 });

    const hashTrailing3Lf = computeCanonicalDiffHash({
      filePath: "notes.txt",
      diff: plainTrailing3Lf,
    });
    const hashTrailing3Crlf = computeCanonicalDiffHash({
      filePath: "notes.txt",
      diff: plainTrailing3Crlf,
    });
    const hashTrailing3MultiLf = computeCanonicalDiffHash({
      filePath: "notes.txt",
      diff: plainTrailing3MultiLf,
    });

    expect(hashLeading).not.toBe(hashBase);
    expect(hashTrailing3).not.toBe(hashBase);
    expect(hashTrailing3).not.toBe(hashTrailing4);

    expect(hashTrailing3).toBe(hashTrailing3Lf);
    expect(hashTrailing3).toBe(hashTrailing3Crlf);
    expect(hashTrailing3).toBe(hashTrailing3MultiLf);
  });
});
