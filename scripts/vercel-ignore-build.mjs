// Vercel Ignored Build Step for the Nino monorepo.
// Exit 0 => skip deployment. Exit 1 => build/deploy.
// Fail-open for the build: if Git history is unavailable or uncertain, deploy.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT_BUILD_FILES = new Set([
  "index.html",
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "vercel.json",
  "components.json",
]);

export function isVercelRelevantPath(path) {
  const p = String(path ?? "").replace(/^\.\//, "");
  if (!p) return false;

  // Production frontend. Unit/integration tests never change the deployed UI.
  if (p.startsWith("src/") && !p.startsWith("src/test/") && !p.includes("/__tests__/")) return true;
  if (p.startsWith("public/")) return true;

  if (ROOT_BUILD_FILES.has(p)) return true;
  if (/^(vite|tailwind|postcss)\.config\./.test(p)) return true;
  if (/^tsconfig(?:\.[^.]+)?\.json$/.test(p)) return true;

  // npm prebuild executes this synchronizer. A change can alter generated code
  // or fail the Vercel build, so it remains deploy-relevant by design.
  if (p === "scripts/sync-finance-core.mjs") return true;

  return false;
}

export function shouldBuildForFiles(files) {
  return [...files].some(isVercelRelevantPath);
}

function changedFiles() {
  const head = process.env.VERCEL_GIT_COMMIT_SHA || "HEAD";
  const previous = String(process.env.VERCEL_GIT_PREVIOUS_SHA ?? "").trim();
  const usablePrevious = previous && !/^0+$/.test(previous) ? previous : null;
  const args = usablePrevious
    ? ["diff", "--name-only", `${usablePrevious}...${head}`]
    : ["diff", "--name-only", "HEAD^", "HEAD"];
  const output = execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function main() {
  try {
    const files = changedFiles();
    if (!files.length) {
      console.log("vercel-ignore: no diff found; build conservatively");
      process.exit(1);
    }
    const relevant = files.filter(isVercelRelevantPath);
    if (relevant.length) {
      console.log(`vercel-ignore: build required (${relevant.join(", ")})`);
      process.exit(1);
    }
    console.log(`vercel-ignore: backend/test-only change; skipping deployment (${files.join(", ")})`);
    process.exit(0);
  } catch (error) {
    console.error(`vercel-ignore: unable to classify diff; build conservatively: ${String(error?.message ?? error)}`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
