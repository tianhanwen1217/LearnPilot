import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import { zipSync } from "fflate";

const root = resolve(import.meta.dirname, "..");
const bump = process.argv[2] ?? "patch";
if (!["patch", "minor", "major"].includes(bump)) throw new Error("版本类型只能是 patch、minor 或 major。");

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

function writeJson(path, value) {
  writeFileSync(resolve(root, path), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function nextVersion(current) {
  const parts = current.split(".").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) throw new Error(`无法识别当前版本：${current}`);
  if (bump === "major") return `${parts[0] + 1}.0.0`;
  if (bump === "minor") return `${parts[0]}.${parts[1] + 1}.0`;
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

function filesForZip(directory) {
  const result = {};
  for (const name of readdirSync(directory)) {
    const fullPath = resolve(directory, name);
    if (statSync(fullPath).isDirectory()) Object.assign(result, filesForZip(fullPath));
    else result[relative(resolve(root, "dist"), fullPath).replaceAll("\\", "/")] = new Uint8Array(readFileSync(fullPath));
  }
  return result;
}

let remote;
try {
  remote = git("remote", "get-url", "origin");
} catch {
  throw new Error("尚未配置 origin。请先执行 git remote add origin <仓库地址>。");
}
if (!remote) throw new Error("origin 地址为空。");
if (git("status", "--porcelain")) throw new Error("工作区存在未提交修改。请先提交或暂存后再发布。");

const packageJson = readJson("package.json");
const manifest = readJson("public/manifest.json");
const packageLock = readJson("package-lock.json");
const version = nextVersion(packageJson.version);
packageJson.version = version;
manifest.version = version;
packageLock.version = version;
if (packageLock.packages?.[""]) packageLock.packages[""].version = version;
writeJson("package.json", packageJson);
writeJson("public/manifest.json", manifest);
writeJson("package-lock.json", packageLock);

try {
  if (process.platform === "win32") {
    execFileSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm run check"], { cwd: root, stdio: "inherit" });
  } else {
    execFileSync("npm", ["run", "check"], { cwd: root, stdio: "inherit" });
  }
  mkdirSync(resolve(root, "release"), { recursive: true });
  writeFileSync(resolve(root, `release/LearnPilot-${version}.zip`), zipSync(filesForZip(resolve(root, "dist")), { level: 9 }));
  git("add", "package.json", "package-lock.json", "public/manifest.json");
  git("commit", "-m", `release: LearnPilot v${version}`);
  git("tag", `v${version}`);
  const branch = git("branch", "--show-current") || "main";
  execFileSync("git", ["push", "--follow-tags", "origin", branch], { cwd: root, stdio: "inherit" });
  console.log(`LearnPilot v${version} 已推送到 ${remote}`);
} catch (error) {
  console.error(`发布未完成：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
