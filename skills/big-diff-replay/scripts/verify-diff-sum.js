const fs = require("fs");

function parseDiffChanges(diffText) {
  const lines = diffText.split("\n");
  const files = new Map();
  let currentFile = null;
  let inBinaryPatch = false;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+?)$/);
      if (!match) throw new Error(`Could not parse diff header: ${line}`);
      currentFile = match[2];
      inBinaryPatch = false;
      if (!files.has(currentFile)) files.set(currentFile, new Map());
    } else if (currentFile) {
      if (line === "GIT binary patch") inBinaryPatch = true;
      const isAddition = line.startsWith("+") && !line.startsWith("+++");
      const isDeletion = line.startsWith("-") && !line.startsWith("---");
      const isBinaryMarker = line.startsWith("Binary files ") || inBinaryPatch;
      if (isAddition || isDeletion || isBinaryMarker) increment(files.get(currentFile), line);
    }
  }

  return files;
}

function verifyDiffSum(originalDiffSource, stepsPath) {
  const manifest = JSON.parse(fs.readFileSync(stepsPath, "utf8"));
  const steps = Array.isArray(manifest) ? manifest : manifest.steps;
  if (!Array.isArray(steps) || steps.some((step) => typeof step.diff !== "string")) {
    throw new Error("Replay manifest must contain a steps array with diff text");
  }
  const combinedStepDiff = steps.map((step) => step.diff).join("\n");

  let originalDiff = "";
  if (Array.isArray(originalDiffSource)) {
    originalDiff = originalDiffSource.map((item) => item.diff).join("\n");
  } else if (typeof originalDiffSource === "string") {
    originalDiff = originalDiffSource;
  }

  const original = parseDiffChanges(originalDiff);
  const replay = parseDiffChanges(combinedStepDiff);
  const allFiles = new Set([...original.keys(), ...replay.keys()]);
  const errors = [];
  for (const file of [...allFiles].sort()) {
    if (!original.has(file)) errors.push(`Extra file: ${file}`);
    else if (!replay.has(file)) errors.push(`Missing file: ${file}`);
    else compareChanges(file, original.get(file), replay.get(file), errors);
  }

  if (errors.length) throw new Error(`Diff-sum verification failed:\n${errors.join("\n")}`);
  console.log(
    `Diff-sum verification passed: ${original.size} file${original.size === 1 ? "" : "s"} and every changed line accounted for across ${steps.length} steps.`,
  );
}

function compareChanges(file, expected, actual, errors) {
  const allChanges = new Set([...expected.keys(), ...actual.keys()]);
  for (const change of allChanges) {
    const expectedCount = expected.get(change) || 0;
    const actualCount = actual.get(change) || 0;
    if (expectedCount !== actualCount) {
      errors.push(`${file}: expected ${expectedCount}, found ${actualCount}: ${change}`);
    }
  }
}

function increment(counts, value) {
  counts.set(value, (counts.get(value) || 0) + 1);
}

module.exports = {
  verifyDiffSum,
  parseDiffChanges,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const origSourcePath = args[0] || "data.json";
  const stepsPath = args[1] || "atomic-steps.json";

  if (!fs.existsSync(origSourcePath) || !fs.existsSync(stepsPath)) {
    console.error(
      "Usage: node verify-diff-sum.js <original-diff-or-data.json> <replay-manifest.json>",
    );
    process.exit(1);
  }

  const rawOrig = fs.readFileSync(origSourcePath, "utf8");
  let origSource = rawOrig;
  try {
    origSource = JSON.parse(rawOrig);
  } catch {}

  try {
    verifyDiffSum(origSource, stepsPath);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
