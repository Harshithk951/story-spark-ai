import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

function getTestFilePath(sourceFile: string): string {
  const dir = path.dirname(sourceFile);
  const ext = path.extname(sourceFile);
  const base = path.basename(sourceFile, ext);
  return path.join(dir, "__tests__", `${base}.test${ext}`);
}

function runCommand(command: string, cwd: string): { success: boolean; errorLog: string } {
  try {
    execSync(command, { cwd, stdio: "pipe", encoding: "utf-8" });
    return { success: true, errorLog: "" };
  } catch (err: any) {
    const errorLog = (err.stdout || "") + "\n" + (err.stderr || "") + "\n" + (err.message || "");
    return { success: false, errorLog };
  }
}

async function main() {
  const targetFile = process.argv[2];
  if (!targetFile || !fs.existsSync(targetFile)) {
    console.error("Usage: npx tsx scripts/verify-and-repair.ts <target-file>");
    process.exit(1);
  }

  const isFrontend = targetFile.startsWith("frontend/");
  const testFilePath = getTestFilePath(targetFile);
  const cwd = isFrontend ? path.resolve(process.cwd(), "frontend") : path.resolve(process.cwd(), "backend");
  const relativeTestPath = path.relative(cwd, testFilePath);

  const testCommand = isFrontend
    ? `npx vitest run ${relativeTestPath} --reporter=verbose`
    : `npx jest --runInBand ${relativeTestPath}`;

  const maxAttempts = 3;
  const tempErrorLog = path.resolve(process.cwd(), "scripts/temp-error.log");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`\n=== Attempt ${attempt}/${maxAttempts} for ${targetFile} ===`);
    const result = runCommand(testCommand, cwd);

    if (result.success) {
      console.log(`✅ Tests passed on attempt ${attempt}!`);
      if (fs.existsSync(tempErrorLog)) fs.unlinkSync(tempErrorLog);
      process.exit(0);
    }

    console.error(`❌ Tests failed on attempt ${attempt}.`);
    if (attempt === maxAttempts) {
      console.error("Max repair attempts reached.");
      process.exit(1);
    }

    console.log("Triggering AI repair...");
    fs.writeFileSync(tempErrorLog, result.errorLog, "utf-8");
    try {
      execSync(`npx tsx scripts/generate-tests.ts ${targetFile} --fix ${tempErrorLog}`, { stdio: "inherit" });
    } catch (e: any) {
      console.error(`AI repair failed: ${e.message}`);
    }
  }
}

main();
