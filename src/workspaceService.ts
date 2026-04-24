import * as http from "node:http";
import * as https from "node:https";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import {
  AddRepoInput,
  AppEntry,
  DashboardData,
  DocScopeEntry,
  GitLabProjectEntry,
  GitLabPullInput,
  GitLabPullResult,
  GitLabSearchInput,
  LocationOption,
  RepoEntry,
  TaskFileEntry,
  TaskItem,
} from "./models";

const execFileAsync = promisify(execFile);
const GITLAB_ORIGIN = "https://gitlab.qima-inc.com";
const DOC_SCOPE_DEFINITIONS = [
  { key: "api-specs", label: "API 规范" },
  { key: "business-logic", label: "业务逻辑" },
  { key: "plans", label: "方案计划" },
  { key: "tasks", label: "任务文档" },
  { key: "templates", label: "模板" },
] as const;

export class WorkspaceService {
  private readonly changeEmitter = new vscode.EventEmitter<void>();

  readonly onDidChange = this.changeEmitter.event;

  getWorkspaceRoot(): string {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error("请先打开 local-life-workspace 根目录。");
    }
    return folder.uri.fsPath;
  }

  async getDashboardData(): Promise<DashboardData> {
    const workspaceRoot = this.getWorkspaceRoot();
    const [repos, apps, tasks, locations] = await Promise.all([
      this.getRepos(),
      this.getApps(),
      this.getTasks(),
      this.getLocationOptions(),
    ]);

    return {
      repos,
      apps,
      tasks,
      locations,
      workspaceRoot,
    };
  }

  async getRepos(): Promise<RepoEntry[]> {
    const workspaceRoot = this.getWorkspaceRoot();
    const gitmodulesPath = path.join(workspaceRoot, ".gitmodules");
    const content = await this.readTextIfExists(gitmodulesPath);
    const entries = parseGitmodules(content);

    return Promise.all(
      entries.map(async (entry) => ({
        ...entry,
        exists: await pathExists(path.join(workspaceRoot, entry.path)),
      })),
    );
  }

  async getLocationOptions(): Promise<LocationOption[]> {
    const workspaceRoot = this.getWorkspaceRoot();
    const defaults = ["packages/frontend", "packages/backend", "packages/shared"];
    const options = new Map<string, LocationOption>();

    for (const base of defaults) {
      options.set(base, {
        label: base,
        value: base,
        description: "常用仓库落位",
      });
    }

    const packagesRoot = path.join(workspaceRoot, "packages");
    if (await pathExists(packagesRoot)) {
      const children = await safeReadDir(packagesRoot);
      for (const child of children) {
        if (!child.isDirectory()) {
          continue;
        }
        const value = path.posix.join("packages", child.name);
        options.set(value, {
          label: value,
          value,
          description: "当前工作区已存在的目录",
        });
      }
    }

    return Array.from(options.values()).sort((left, right) =>
      left.value.localeCompare(right.value, "zh-Hans-CN"),
    );
  }

  async getApps(): Promise<AppEntry[]> {
    const workspaceRoot = this.getWorkspaceRoot();
    const repos = await this.getRepos();
    const apps: AppEntry[] = [];

    for (const repo of repos) {
      if (!repo.exists) {
        continue;
      }

      const repoRoot = path.join(workspaceRoot, repo.path);
      const packageFiles = await findPackageJsonFiles(repoRoot, 3);

      if (packageFiles.length === 0) {
        apps.push({
          repoName: repo.name,
          name: repo.name,
          path: repo.path,
          repoPath: repo.path,
          kind: "repository",
          scripts: [],
        });
        continue;
      }

      for (const packageFile of packageFiles) {
        const appDir = path.dirname(packageFile);
        const relativePath = toWorkspacePath(workspaceRoot, appDir);
        const packageJson = await parsePackageJson(packageFile);
        apps.push({
          repoName: repo.name,
          name: packageJson?.name ?? path.basename(appDir),
          path: relativePath,
          repoPath: repo.path,
          kind: relativePath === repo.path ? "repository" : "workspace-package",
          scripts: packageJson?.scripts ? Object.keys(packageJson.scripts).slice(0, 5) : [],
        });
      }
    }

    return apps.sort((left, right) =>
      `${left.repoName}:${left.path}`.localeCompare(`${right.repoName}:${right.path}`, "zh-Hans-CN"),
    );
  }

  async getTasks(): Promise<TaskFileEntry[]> {
    const workspaceRoot = this.getWorkspaceRoot();
    const docsRoot = path.join(workspaceRoot, "docs", "tasks");
    if (!(await pathExists(docsRoot))) {
      return [];
    }

    const markdownFiles = await findMarkdownFiles(docsRoot);
    const entries: TaskFileEntry[] = [];
    for (const file of markdownFiles) {
      const raw = await this.readTextIfExists(file);
      const items = parseTaskMarkdown(raw);
      entries.push({
        filePath: toWorkspacePath(workspaceRoot, file),
        title: path.basename(path.dirname(file)),
        items,
      });
    }

    return entries.sort((left, right) => left.filePath.localeCompare(right.filePath, "zh-Hans-CN"));
  }

  async getDocScopes(): Promise<DocScopeEntry[]> {
    const workspaceRoot = this.getWorkspaceRoot();
    const docsRoot = path.join(workspaceRoot, "docs");
    const scopes: DocScopeEntry[] = [];

    for (const definition of DOC_SCOPE_DEFINITIONS) {
      const scopePath = path.join(docsRoot, definition.key);
      const files = (await pathExists(scopePath)) ? await findAllFiles(scopePath) : [];
      scopes.push({
        key: definition.key,
        label: definition.label,
        path: toWorkspacePath(workspaceRoot, scopePath),
        fileCount: files.length,
      });
    }

    return scopes;
  }

  async addRepository(input: AddRepoInput): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    const repoUrl = input.repoUrl.trim();
    const branch = (input.branch.trim() || "master").trim();
    if (!repoUrl) {
      throw new Error("仓库地址不能为空。");
    }

    const targetPath = normalizeTargetPath(input);
    await this.addRepositoryAtPath(repoUrl, branch, targetPath);
  }

  async searchGitLabProjects(input: GitLabSearchInput): Promise<GitLabProjectEntry[]> {
    const keyword = input.keyword.trim();
    if (!keyword) {
      throw new Error("请先填写项目名称或关键字。");
    }

    const token = input.token?.trim() ?? "";
    const projects: GitLabProjectEntry[] = [];
    let page = 1;

    while (true) {
      const requestUrl = new URL(
        `/api/v4/projects?search=${encodeURIComponent(keyword)}&simple=true&search_namespaces=true&per_page=100&page=${page}&order_by=last_activity_at&sort=desc`,
        GITLAB_ORIGIN,
      );
      const response = await requestJson<GitLabApiProject[]>(
        requestUrl,
        token ? { "PRIVATE-TOKEN": token } : undefined,
      );

      projects.push(
        ...response.data.map((project) => ({
          id: project.id,
          name: project.name,
          path: project.path,
          pathWithNamespace: project.path_with_namespace,
          description: project.description?.trim() ?? "",
          webUrl: project.web_url,
          sshUrlToRepo: project.ssh_url_to_repo,
          defaultBranch: project.default_branch || "master",
        })),
      );

      const nextPage = `${response.headers["x-next-page"] ?? ""}`.trim();
      if (!nextPage) {
        break;
      }
      page = Number(nextPage);
      if (!Number.isFinite(page) || page <= 0) {
        break;
      }
    }

    const loweredKeyword = keyword.toLowerCase();
    const filtered = projects.filter((project) =>
      [project.name, project.pathWithNamespace, project.description].some((value) =>
        value.toLowerCase().includes(loweredKeyword),
      ),
    );

    return filtered.sort((left, right) =>
      left.pathWithNamespace.localeCompare(right.pathWithNamespace, "zh-Hans-CN"),
    );
  }

  async pullGitLabProjects(input: GitLabPullInput): Promise<GitLabPullResult> {
    const targetBase = normalizePosixPath(input.targetBase.trim());
    if (!targetBase) {
      throw new Error("请选择 GitLab 项目的拉取位置。");
    }

    const pathPrefix = normalizeOptionalPath(input.pathPrefix);
    const result: GitLabPullResult = {
      added: [],
      skipped: [],
      failed: [],
    };

    const existingRepos = await this.getRepos();
    const existingPaths = new Set(existingRepos.map((repo) => repo.path));
    const existingUrls = new Set(existingRepos.map((repo) => repo.url));

    for (const project of input.projects) {
      const targetPath = normalizePosixPath(
        path.posix.join(targetBase, pathPrefix ?? "", project.path),
      );

      if (existingPaths.has(targetPath) || existingUrls.has(project.sshUrlToRepo)) {
        result.skipped.push(project.name);
        continue;
      }

      try {
        await this.addRepositoryAtPath(project.sshUrlToRepo, project.defaultBranch || "master", targetPath);
        existingPaths.add(targetPath);
        existingUrls.add(project.sshUrlToRepo);
        result.added.push(project.name);
      } catch (error) {
        result.failed.push({
          name: project.name,
          reason: error instanceof Error ? error.message : "未知错误",
        });
      }
    }

    this.refresh();
    return result;
  }

  private async addRepositoryAtPath(repoUrl: string, branch: string, targetPath: string): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    const existingRepos = await this.getRepos();
    if (existingRepos.some((repo) => repo.path === targetPath || repo.url === repoUrl)) {
      throw new Error("这个仓库或落位已经存在，请换一个路径。");
    }

    const absoluteTargetPath = path.join(workspaceRoot, targetPath);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(absoluteTargetPath)));

    await execFileAsync(
      "git",
      ["-C", workspaceRoot, "submodule", "add", "-f", "-b", branch, repoUrl, targetPath],
      { cwd: workspaceRoot },
    );

    await execFileAsync(
      "git",
      ["config", "-f", path.join(workspaceRoot, ".gitmodules"), `submodule.${targetPath}.branch`, branch],
      { cwd: workspaceRoot },
    );

    this.refresh();
  }

  async initWorkspaceRepos(): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    await execFileAsync("make", ["init"], { cwd: workspaceRoot });
    this.refresh();
  }

  async removeRepository(repoPath: string): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    const normalizedRepoPath = normalizePosixPath(repoPath);
    const gitmodulesPath = path.join(workspaceRoot, ".gitmodules");
    const moduleStoragePath = path.join(workspaceRoot, ".git", "modules", ...normalizedRepoPath.split("/"));

    await execFileAsync("git", ["-C", workspaceRoot, "submodule", "deinit", "-f", "--", normalizedRepoPath], {
      cwd: workspaceRoot,
    });
    await execFileAsync("git", ["-C", workspaceRoot, "rm", "-f", "--", normalizedRepoPath], {
      cwd: workspaceRoot,
    });

    if (await pathExists(moduleStoragePath)) {
      await fs.rm(moduleStoragePath, { recursive: true, force: true });
    }

    const content = await this.readTextIfExists(gitmodulesPath);
    if (!content.trim()) {
      await fs.writeFile(gitmodulesPath, "");
    }

    this.refresh();
  }

  async removeApplication(app: AppEntry): Promise<void> {
    if (app.kind === "repository" || app.path === app.repoPath) {
      await this.removeRepository(app.repoPath);
      return;
    }

    const workspaceRoot = this.getWorkspaceRoot();
    const targetPath = path.join(workspaceRoot, app.path);
    if (!(await pathExists(targetPath))) {
      throw new Error("应用目录不存在，无法卸载。");
    }

    await fs.rm(targetPath, { recursive: true, force: true });
    this.refresh();
  }

  async restoreDocScope(scopeKey: string): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    const docPath = path.posix.join("docs", scopeKey);

    await execFileAsync(
      "git",
      ["-C", workspaceRoot, "restore", "--source=HEAD", "--staged", "--worktree", "--", docPath],
      { cwd: workspaceRoot },
    );
    await execFileAsync("git", ["-C", workspaceRoot, "clean", "-fd", "--", docPath], { cwd: workspaceRoot });

    this.refresh();
  }

  refresh(): void {
    this.changeEmitter.fire();
  }

  private async readTextIfExists(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return "";
      }
      throw error;
    }
  }
}

function parseGitmodules(content: string): RepoEntry[] {
  const blocks = content
    .split(/\n(?=\[submodule ")/)
    .map((block) => block.trim())
    .filter((block) => block.startsWith("[submodule "));

  return blocks.map((block) => {
    const lines = block.split(/\r?\n/);
    const name = lines[0]?.match(/\[submodule "(.*)"\]/)?.[1] ?? "unknown";
    const data = new Map<string, string>();
    for (const line of lines.slice(1)) {
      const match = line.match(/^\s*([^=]+?)\s*=\s*(.+)\s*$/);
      if (match) {
        data.set(match[1].trim(), match[2].trim());
      }
    }

    const repoPath = data.get("path") ?? name;
    return {
      name: path.basename(repoPath),
      path: repoPath,
      url: data.get("url") ?? "",
      branch: data.get("branch") ?? "master",
      exists: false,
    };
  });
}

function parseTaskMarkdown(content: string): TaskItem[] {
  const items: TaskItem[] = [];
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let currentSection = "";

  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line) || /^功能\d+[:：]/.test(line)) {
      currentSection = line.replace(/^#{1,6}\s+/, "").trim();
      items.push({ title: currentSection });
      continue;
    }

    const pair = line.match(/^(task[-\s]?\d+|[-*]|\d+\.)\s*[:：]?\s*(.+)$/i);
    if (pair) {
      items.push({
        title: currentSection ? `${currentSection} / ${pair[1]}` : pair[1],
        detail: pair[2].trim(),
      });
      continue;
    }

    if (currentSection) {
      items.push({
        title: currentSection,
        detail: line,
      });
    } else {
      items.push({ title: line });
    }
  }

  return items;
}

function normalizeTargetPath(input: AddRepoInput): string {
  const custom = input.customPath?.trim();
  if (custom) {
    return normalizePosixPath(custom);
  }

  const repoName = deriveRepoName(input.repoUrl);
  const base = normalizePosixPath(input.targetBase.trim());
  if (!base) {
    throw new Error("请选择拉取位置。");
  }

  return normalizePosixPath(path.posix.join(base, repoName));
}

function deriveRepoName(repoUrl: string): string {
  const normalized = repoUrl.replace(/\/$/, "");
  const lastSegment = normalized.split("/").pop() ?? normalized.split(":").pop() ?? "repo";
  return lastSegment.replace(/\.git$/i, "");
}

function normalizePosixPath(rawPath: string): string {
  return rawPath.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+/g, "/");
}

function normalizeOptionalPath(rawPath?: string): string | undefined {
  const value = rawPath?.trim();
  if (!value) {
    return undefined;
  }
  return normalizePosixPath(value);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function safeReadDir(targetPath: string): Promise<import("node:fs").Dirent[]> {
  try {
    return await fs.readdir(targetPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function findPackageJsonFiles(rootPath: string, maxDepth: number): Promise<string[]> {
  const results: string[] = [];
  await visitDirectory(rootPath, 0, maxDepth, async (dirPath, depth) => {
    const packageJsonPath = path.join(dirPath, "package.json");
    if (await pathExists(packageJsonPath)) {
      results.push(packageJsonPath);
    }
    if (depth >= maxDepth) {
      return false;
    }
    return true;
  });
  return dedupe(results);
}

async function findMarkdownFiles(rootPath: string): Promise<string[]> {
  const files: string[] = [];
  await visitDirectory(rootPath, 0, 6, async (dirPath) => {
    const children = await safeReadDir(dirPath);
    for (const child of children) {
      if (child.isFile() && child.name.endsWith(".md")) {
        files.push(path.join(dirPath, child.name));
      }
    }
    return true;
  });
  return dedupe(files);
}

async function findAllFiles(rootPath: string): Promise<string[]> {
  const files: string[] = [];
  await visitDirectory(rootPath, 0, 8, async (dirPath) => {
    const children = await safeReadDir(dirPath);
    for (const child of children) {
      if (child.isFile()) {
        files.push(path.join(dirPath, child.name));
      }
    }
    return true;
  });
  return dedupe(files);
}

async function visitDirectory(
  dirPath: string,
  depth: number,
  maxDepth: number,
  visitor: (dirPath: string, depth: number) => Promise<boolean>,
): Promise<void> {
  const shouldContinue = await visitor(dirPath, depth);
  if (!shouldContinue || depth >= maxDepth) {
    return;
  }

  const children = await safeReadDir(dirPath);
  for (const child of children) {
    if (!child.isDirectory() || child.name === "node_modules" || child.name === ".git") {
      continue;
    }
    await visitDirectory(path.join(dirPath, child.name), depth + 1, maxDepth, visitor);
  }
}

async function parsePackageJson(
  packageJsonPath: string,
): Promise<{ name?: string; scripts?: Record<string, string> } | undefined> {
  try {
    const raw = await fs.readFile(packageJsonPath, "utf8");
    return JSON.parse(raw) as { name?: string; scripts?: Record<string, string> };
  } catch {
    return undefined;
  }
}

function toWorkspacePath(workspaceRoot: string, absolutePath: string): string {
  return normalizePosixPath(path.relative(workspaceRoot, absolutePath));
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items)).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
}

interface GitLabApiProject {
  id: number;
  name: string;
  path: string;
  path_with_namespace: string;
  description: string | null;
  web_url: string;
  ssh_url_to_repo: string;
  default_branch: string | null;
}

async function requestJson<T>(
  requestUrl: URL,
  headers?: Record<string, string>,
): Promise<{ data: T; headers: http.IncomingHttpHeaders }> {
  const client = requestUrl.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const request = client.request(
      requestUrl,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...headers,
        },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          const statusCode = response.statusCode ?? 500;
          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(formatHttpError(statusCode, body)));
            return;
          }

          try {
            const data = JSON.parse(body) as T;
            resolve({ data, headers: response.headers });
          } catch {
            reject(new Error("GitLab 返回了无法解析的响应。"));
          }
        });
      },
    );

    request.on("error", (error) => {
      reject(new Error(`GitLab 请求失败：${error.message}`));
    });
    request.end();
  });
}

function formatHttpError(statusCode: number, body: string): string {
  if (statusCode === 401 || statusCode === 403) {
    return "访问 GitLab 失败，请检查 Token 是否有效。";
  }
  if (statusCode === 404) {
    return "没有找到匹配的 GitLab 项目，或你没有访问权限。";
  }

  try {
    const parsed = JSON.parse(body) as { message?: string };
    if (parsed.message) {
      return `GitLab 请求失败：${parsed.message}`;
    }
  } catch {
    // ignore JSON parse error
  }

  return `GitLab 请求失败，状态码 ${statusCode}。`;
}
