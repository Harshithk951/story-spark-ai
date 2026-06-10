import * as fs from "fs";
import * as path from "path";

interface FileInfo {
  filePath: string;
  size: number;
}

function findSourceFiles(dir: string, results: FileInfo[] = []): FileInfo[] {
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "__tests__", "dist", ".next", "coverage", ".git"].includes(entry.name)) continue;
      findSourceFiles(fullPath, results);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec|d)\.(ts|tsx)$/.test(entry.name)) {
      const stat = fs.statSync(fullPath);
      results.push({ filePath: fullPath, size: stat.size });
    }
  }
  return results;
}

function hasTestFile(sourceFile: string): boolean {
  const dir = path.dirname(sourceFile);
  const ext = path.extname(sourceFile);
  const base = path.basename(sourceFile, ext);
  const testDir = path.join(dir, "__tests__");
  const testFile = path.join(testDir, `${base}.test${ext}`);
  const specFile = path.join(testDir, `${base}.spec${ext}`);
  const siblingTest = path.join(dir, `${base}.test${ext}`);
  const siblingSpec = path.join(dir, `${base}.spec${ext}`);
  return [testFile, specFile, siblingTest, siblingSpec].some(f => fs.existsSync(f));
}

function main() {
  const cwd = process.cwd();
  const scanDirs = ["src", "frontend/src", "backend/src", "lib", "app"].map(d => path.join(cwd, d));
  let allFiles: FileInfo[] = [];

  for (const dir of scanDirs) {
    findSourceFiles(dir, allFiles);
  }

  const untested = allFiles
    .filter(f => !hasTestFile(f.filePath))
    .sort((a, b) => b.size - a.size)
    .slice(0, 10)
    .map(f => path.relative(cwd, f.filePath));

  console.log(JSON.stringify(untested));
}

main();
