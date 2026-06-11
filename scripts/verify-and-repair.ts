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
    const output = execSync(command, { cwd, stdio: "pipe", encoding: "utf-8" });
    return { success: true, errorLog: output };
  } catch (err: any) {
    const errorLog = (err.stdout || "") + "\n" + (err.stderr || "") + "\n" + (err.message || "");
    return { success: false, errorLog };
  }
}

// ── Security scan: check for hardcoded secrets/credentials ──
function securityScan(testFilePath: string): { pass: boolean; findings: string[] } {
  const content = fs.readFileSync(testFilePath, "utf-8");
  const findings: string[] = [];

  const patterns = [
    { regex: /(?:api[_-]?key|apikey)\s*[:=]\s*["'][a-zA-Z0-9_\-]{20,}["']/gi, name: "Hardcoded API key" },
    { regex: /(?:password|passwd|pwd)\s*[:=]\s*["'][^"']{6,}["']/gi, name: "Hardcoded password" },
    { regex: /(?:secret|token)\s*[:=]\s*["'][a-zA-Z0-9_\-]{20,}["']/gi, name: "Hardcoded secret/token" },
    { regex: /(?:Bearer|Basic)\s+[a-zA-Z0-9_\-\.]{20,}/g, name: "Hardcoded auth header" },
    { regex: /(?:mongodb|postgres|mysql|redis):\/\/[^\s"']+/gi, name: "Hardcoded database URL" },
    { regex: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g, name: "Embedded private key" },
    { regex: /process\.env\.[A-Z_]+\s*\|\|\s*["'][a-zA-Z0-9_\-]{15,}["']/g, name: "Env fallback with real credential" },
  ];

  for (const p of patterns) {
    const matches = content.match(p.regex);
    if (matches) {
      // Filter out obvious test mocks (like "test-api-key", "mock-token")
      const realFindings = matches.filter(m => !/mock|test|fake|dummy|example|placeholder/i.test(m));
      if (realFindings.length > 0) {
        findings.push(`${p.name}: ${realFindings.join(", ")}`);
      }
    }
  }

  return { pass: findings.length === 0, findings };
}

// ── Code quality checks ──
function codeQualityCheck(testFilePath: string): { pass: boolean; issues: string[] } {
  const content = fs.readFileSync(testFilePath, "utf-8");
  const lines = content.split("\n");
  const issues: string[] = [];

  // Check for excessive use of `any` type
  const anyCount = (content.match(/:\s*any\b/g) || []).length;
  if (anyCount > 3) {
    issues.push(`Excessive 'any' types found (${anyCount} occurrences). Prefer specific types.`);
  }

  // Check for console.log left in tests
  const consoleLogs = lines.filter((l, i) => /console\.log\(/.test(l) && !/\/\//.test(l.split("console.log")[0]));
  if (consoleLogs.length > 0) {
    issues.push(`${consoleLogs.length} console.log statement(s) found. Remove debug logs.`);
  }

  // Check for empty test blocks
  const emptyTests = content.match(/(?:it|test)\s*\([^)]*,\s*(?:async\s*)?\(\s*\)\s*=>\s*\{\s*\}\s*\)/g);
  if (emptyTests) {
    issues.push(`${emptyTests.length} empty test block(s) found. Tests must have assertions.`);
  }

  // Check that at least one expect() exists
  if (!/expect\s*\(/.test(content)) {
    issues.push("No expect() assertions found. Tests must verify behavior.");
  }

  // Check for test file having at least one describe block
  if (!/describe\s*\(/.test(content)) {
    issues.push("No describe() block found. Tests should be organized in describe blocks.");
  }

  // Check minimum test count (at least 2 tests)
  const testCount = (content.match(/(?:it|test)\s*\(/g) || []).length;
  if (testCount < 2) {
    issues.push(`Only ${testCount} test(s) found. Minimum 2 tests required for adequate coverage.`);
  }

  return { pass: issues.length === 0, issues };
}

async function main() {
  const targetFile = process.argv[2];
  if (!targetFile || !fs.existsSync(targetFile)) {
    console.error("Usage: tsx scripts/verify-and-repair.ts <target-file>");
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
    console.log(`\n${"=".repeat(60)}`);
    console.log(`  VERIFICATION PIPELINE — Attempt ${attempt}/${maxAttempts}`);
    console.log(`  File: ${targetFile}`);
    console.log(`${"=".repeat(60)}\n`);

    if (!fs.existsSync(testFilePath)) {
      console.error(`❌ Test file not found: ${testFilePath}`);
      process.exit(1);
    }

    const allErrors: string[] = [];

    // ── Layer 1: Security Scan ──
    console.log("🔒 Layer 1: Security Scan...");
    const security = securityScan(testFilePath);
    if (security.pass) {
      console.log("   ✅ No security issues found.");
    } else {
      console.log("   ❌ Security issues detected:");
      security.findings.forEach(f => console.log(`      ⚠ ${f}`));
      allErrors.push("SECURITY:\n" + security.findings.join("\n"));
    }

    // ── Layer 2: Code Quality ──
    console.log("\n📋 Layer 2: Code Quality Check...");
    const quality = codeQualityCheck(testFilePath);
    if (quality.pass) {
      console.log("   ✅ Code quality checks passed.");
    } else {
      console.log("   ❌ Code quality issues:");
      quality.issues.forEach(i => console.log(`      ⚠ ${i}`));
      allErrors.push("CODE QUALITY:\n" + quality.issues.join("\n"));
    }

    // ── Layer 3: Lint Check (ESLint if available) ──
    console.log("\n🧹 Layer 3: Lint Check...");
    const lintResult = runCommand(`npx eslint ${relativeTestPath} --no-error-on-unmatched-pattern --max-warnings=5 2>&1 || true`, cwd);
    if (lintResult.errorLog.includes("error") && !lintResult.errorLog.includes("0 errors")) {
      const lintErrors = lintResult.errorLog.split("\n").filter(l => /error/i.test(l) && !/0 error/.test(l)).slice(0, 5);
      if (lintErrors.length > 0) {
        console.log("   ⚠️  Lint warnings (non-blocking):");
        lintErrors.forEach(e => console.log(`      ${e.trim()}`));
      }
    } else {
      console.log("   ✅ Lint check passed.");
    }

    // ── Layer 4: TypeScript Compilation ──
    console.log("\n🔷 Layer 4: TypeScript Type Check...");
    const tscCmd = isFrontend
      ? `npx tsc --noEmit --skipLibCheck -p tsconfig.json 2>&1 | grep -i "${path.basename(testFilePath)}" || true`
      : `npx tsc --noEmit --skipLibCheck -p tsconfig.json 2>&1 | grep -i "${path.basename(testFilePath)}" || true`;
    const tscResult = runCommand(tscCmd, cwd);
    const tscErrors = tscResult.errorLog.split("\n").filter(l => /error TS/i.test(l));
    if (tscErrors.length > 0) {
      console.log("   ❌ TypeScript errors in test file:");
      tscErrors.slice(0, 5).forEach(e => console.log(`      ${e.trim()}`));
      allErrors.push("TYPECHECK:\n" + tscErrors.join("\n"));
    } else {
      console.log("   ✅ TypeScript compilation passed.");
    }

    // ── Layer 5: Test Execution ──
    console.log("\n🧪 Layer 5: Test Execution...");
    const testResult = runCommand(testCommand, cwd);
    if (testResult.success) {
      console.log("   ✅ All tests passed.");
    } else {
      console.log("   ❌ Test execution failed.");
      allErrors.push("TEST EXECUTION:\n" + testResult.errorLog.slice(0, 2000));
    }

    // ── Final verdict ──
    console.log(`\n${"─".repeat(60)}`);
    if (allErrors.length === 0) {
      console.log(`✅ ALL 5 LAYERS PASSED on attempt ${attempt}!`);
      console.log(`${"─".repeat(60)}\n`);
      if (fs.existsSync(tempErrorLog)) fs.unlinkSync(tempErrorLog);
      process.exit(0);
    }

    console.log(`❌ ${allErrors.length} layer(s) failed on attempt ${attempt}.`);
    console.log(`${"─".repeat(60)}\n`);

    if (attempt === maxAttempts) {
      console.error("Max repair attempts reached. Pipeline failed.");
      process.exit(1);
    }

    // Trigger AI repair with all error context
    console.log("🔧 Triggering AI repair...\n");
    const fullErrorContext = allErrors.join("\n\n---\n\n");
    fs.writeFileSync(tempErrorLog, fullErrorContext, "utf-8");
    try {
      execSync(`tsx /tmp/agent-scripts/generate-tests.ts ${targetFile} --fix ${tempErrorLog}`, { stdio: "inherit" });
    } catch (e: any) {
      console.error(`AI repair failed: ${e.message}`);
    }
  }
}

main();
