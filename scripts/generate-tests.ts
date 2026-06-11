import * as fs from "fs";
import * as path from "path";

function getTestFilePath(sourceFile: string): string {
  const dir = path.dirname(sourceFile);
  const ext = path.extname(sourceFile);
  const base = path.basename(sourceFile, ext);
  return path.join(dir, "__tests__", `${base}.test${ext}`);
}

function detectFramework(targetFile: string): { framework: string; frameworkRules: string } {
  const isFrontend = targetFile.startsWith("frontend/");
  if (isFrontend) {
    return {
      framework: "vitest + @testing-library/react",
      frameworkRules: "Import { describe, it, expect, vi } from 'vitest'. Use vi.mock() for mocking. Use @testing-library/react for component tests."
    };
  }
  return {
    framework: "jest",
    frameworkRules: "Import from '@nestjs/testing' if NestJS. Use jest.mock() for mocking. Use jest.fn() for function stubs."
  };
}

async function callAI(systemPrompt: string, userPrompt: string): Promise<string> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const nvidiaKey = process.env.NVIDIA_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (geminiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }]
      })
    });
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  if (nvidiaKey) {
    const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${nvidiaKey}` },
      body: JSON.stringify({
        model: "meta/llama-3.1-8b-instruct",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        max_tokens: 4096
      })
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  }

  if (openaiKey) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        max_tokens: 4096
      })
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  }

  throw new Error("No AI API key found. Set GEMINI_API_KEY, NVIDIA_API_KEY, or OPENAI_API_KEY.");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: npx tsx scripts/generate-tests.ts <file> [--fix <errorlog>]");
    process.exit(1);
  }

  const targetFile = args[0];
  const isFixMode = args.includes("--fix");
  const errorLogPath = isFixMode ? args[args.indexOf("--fix") + 1] : null;

  const sourceCode = fs.readFileSync(targetFile, "utf-8");
  const { framework, frameworkRules } = detectFramework(targetFile);

  const systemInstruction = `You are a Principal Software Engineer writing production-grade unit tests.

FRAMEWORK: ${framework}
RULES: ${frameworkRules}

CODE REQUIREMENTS:
1. Write strict, type-safe TypeScript. Avoid using 'any' type — use proper types/interfaces.
2. Import the source module using correct relative imports (test file lives in __tests__ subdirectory).
3. Mock ALL external dependencies so tests run in complete isolation — no network, database, or filesystem calls.
4. For React components, use @testing-library/react with proper render/screen/fireEvent. Mock all hooks and context providers.
5. Every test must pass independently — no server, database, or real API needed.

STRUCTURE REQUIREMENTS:
6. Wrap tests in at least one describe() block.
7. Write at least 3 test cases covering: success path, error/edge case, and boundary condition.
8. Every test must have at least one expect() assertion.

SECURITY REQUIREMENTS:
9. NEVER include real API keys, passwords, tokens, or credentials — use mock values like 'mock-api-key' or 'test-token'.
10. NEVER include real database connection strings.
11. NEVER embed private keys or certificates.

QUALITY REQUIREMENTS:
12. Do NOT leave console.log() statements in the test file.
13. Do NOT write empty test blocks.
14. Use meaningful test descriptions that explain the expected behavior.

OUTPUT: Raw TypeScript code ONLY. No markdown backticks, no explanations, no comments about what the code does.`;

  let userPrompt: string;
  if (isFixMode && errorLogPath && fs.existsSync(errorLogPath)) {
    const existingTest = fs.readFileSync(getTestFilePath(targetFile), "utf-8");
    const errorLog = fs.readFileSync(errorLogPath, "utf-8");
    userPrompt = `SOURCE FILE (${targetFile}):\n${sourceCode}\n\nCURRENT TEST (failing):\n${existingTest}\n\nERROR LOG:\n${errorLog}\n\nFix the test file so all tests pass. Output the COMPLETE fixed test file.`;
  } else {
    userPrompt = `SOURCE FILE (${targetFile}):\n${sourceCode}\n\nGenerate a complete test suite for this file.`;
  }

  console.log(`Calling AI to ${isFixMode ? "repair" : "generate"} tests for ${targetFile}...`);
  let result = await callAI(systemInstruction, userPrompt);

  // Strip markdown fences if AI included them
  result = result.replace(/^```(?:typescript|ts)?\n?/m, "").replace(/\n?```$/m, "").trim();

  const testFilePath = getTestFilePath(targetFile);
  fs.mkdirSync(path.dirname(testFilePath), { recursive: true });
  fs.writeFileSync(testFilePath, result, "utf-8");
  console.log(`Test file written: ${testFilePath}`);
}

main();
