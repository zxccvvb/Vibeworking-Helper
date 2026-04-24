"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceService = void 0;
const http = __importStar(require("node:http"));
const https = __importStar(require("node:https"));
const path = __importStar(require("node:path"));
const fs = __importStar(require("node:fs/promises"));
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const vscode = __importStar(require("vscode"));
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
const GITLAB_ORIGIN = "https://gitlab.qima-inc.com";
const DOC_SCOPE_DEFINITIONS = [
    { key: "api-specs", label: "API 规范" },
    { key: "business-logic", label: "业务逻辑" },
    { key: "plans", label: "方案计划" },
    { key: "tasks", label: "任务文档" },
    { key: "templates", label: "模板" },
];
class WorkspaceService {
    changeEmitter = new vscode.EventEmitter();
    onDidChange = this.changeEmitter.event;
    getWorkspaceRoot() {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            throw new Error("请先打开 local-life-workspace 根目录。");
        }
        return folder.uri.fsPath;
    }
    async getDashboardData() {
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
    async getRepos() {
        const workspaceRoot = this.getWorkspaceRoot();
        const gitmodulesPath = path.join(workspaceRoot, ".gitmodules");
        const content = await this.readTextIfExists(gitmodulesPath);
        const entries = parseGitmodules(content);
        return Promise.all(entries.map(async (entry) => ({
            ...entry,
            exists: await pathExists(path.join(workspaceRoot, entry.path)),
        })));
    }
    async getLocationOptions() {
        const workspaceRoot = this.getWorkspaceRoot();
        const defaults = ["packages/frontend", "packages/backend", "packages/shared"];
        const options = new Map();
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
        return Array.from(options.values()).sort((left, right) => left.value.localeCompare(right.value, "zh-Hans-CN"));
    }
    async getApps() {
        const workspaceRoot = this.getWorkspaceRoot();
        const repos = await this.getRepos();
        const apps = [];
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
        return apps.sort((left, right) => `${left.repoName}:${left.path}`.localeCompare(`${right.repoName}:${right.path}`, "zh-Hans-CN"));
    }
    async getTasks() {
        const workspaceRoot = this.getWorkspaceRoot();
        const docsRoot = path.join(workspaceRoot, "docs", "tasks");
        if (!(await pathExists(docsRoot))) {
            return [];
        }
        const markdownFiles = await findMarkdownFiles(docsRoot);
        const entries = [];
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
    async getDocScopes() {
        const workspaceRoot = this.getWorkspaceRoot();
        const docsRoot = path.join(workspaceRoot, "docs");
        const scopes = [];
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
    async addRepository(input) {
        const workspaceRoot = this.getWorkspaceRoot();
        const repoUrl = input.repoUrl.trim();
        const branch = (input.branch.trim() || "master").trim();
        if (!repoUrl) {
            throw new Error("仓库地址不能为空。");
        }
        const targetPath = normalizeTargetPath(input);
        await this.addRepositoryAtPath(repoUrl, branch, targetPath);
    }
    async searchGitLabProjects(input) {
        const keyword = input.keyword.trim();
        if (!keyword) {
            throw new Error("请先填写项目名称或关键字。");
        }
        const token = input.token?.trim() ?? "";
        const projects = [];
        let page = 1;
        while (true) {
            const requestUrl = new URL(`/api/v4/projects?search=${encodeURIComponent(keyword)}&simple=true&search_namespaces=true&per_page=100&page=${page}&order_by=last_activity_at&sort=desc`, GITLAB_ORIGIN);
            const response = await requestJson(requestUrl, token ? { "PRIVATE-TOKEN": token } : undefined);
            projects.push(...response.data.map((project) => ({
                id: project.id,
                name: project.name,
                path: project.path,
                pathWithNamespace: project.path_with_namespace,
                description: project.description?.trim() ?? "",
                webUrl: project.web_url,
                sshUrlToRepo: project.ssh_url_to_repo,
                defaultBranch: project.default_branch || "master",
            })));
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
        const filtered = projects.filter((project) => [project.name, project.pathWithNamespace, project.description].some((value) => value.toLowerCase().includes(loweredKeyword)));
        return filtered.sort((left, right) => left.pathWithNamespace.localeCompare(right.pathWithNamespace, "zh-Hans-CN"));
    }
    async pullGitLabProjects(input) {
        const targetBase = normalizePosixPath(input.targetBase.trim());
        if (!targetBase) {
            throw new Error("请选择 GitLab 项目的拉取位置。");
        }
        const pathPrefix = normalizeOptionalPath(input.pathPrefix);
        const result = {
            added: [],
            skipped: [],
            failed: [],
        };
        const existingRepos = await this.getRepos();
        const existingPaths = new Set(existingRepos.map((repo) => repo.path));
        const existingUrls = new Set(existingRepos.map((repo) => repo.url));
        for (const project of input.projects) {
            const targetPath = normalizePosixPath(path.posix.join(targetBase, pathPrefix ?? "", project.path));
            if (existingPaths.has(targetPath) || existingUrls.has(project.sshUrlToRepo)) {
                result.skipped.push(project.name);
                continue;
            }
            try {
                await this.addRepositoryAtPath(project.sshUrlToRepo, project.defaultBranch || "master", targetPath);
                existingPaths.add(targetPath);
                existingUrls.add(project.sshUrlToRepo);
                result.added.push(project.name);
            }
            catch (error) {
                result.failed.push({
                    name: project.name,
                    reason: error instanceof Error ? error.message : "未知错误",
                });
            }
        }
        this.refresh();
        return result;
    }
    async addRepositoryAtPath(repoUrl, branch, targetPath) {
        const workspaceRoot = this.getWorkspaceRoot();
        const existingRepos = await this.getRepos();
        if (existingRepos.some((repo) => repo.path === targetPath || repo.url === repoUrl)) {
            throw new Error("这个仓库或落位已经存在，请换一个路径。");
        }
        const absoluteTargetPath = path.join(workspaceRoot, targetPath);
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(absoluteTargetPath)));
        await execFileAsync("git", ["-C", workspaceRoot, "submodule", "add", "-f", "-b", branch, repoUrl, targetPath], { cwd: workspaceRoot });
        await execFileAsync("git", ["config", "-f", path.join(workspaceRoot, ".gitmodules"), `submodule.${targetPath}.branch`, branch], { cwd: workspaceRoot });
        this.refresh();
    }
    async initWorkspaceRepos() {
        const workspaceRoot = this.getWorkspaceRoot();
        await execFileAsync("make", ["init"], { cwd: workspaceRoot });
        this.refresh();
    }
    async removeRepository(repoPath) {
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
    async removeApplication(app) {
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
    async restoreDocScope(scopeKey) {
        const workspaceRoot = this.getWorkspaceRoot();
        const docPath = path.posix.join("docs", scopeKey);
        await execFileAsync("git", ["-C", workspaceRoot, "restore", "--source=HEAD", "--staged", "--worktree", "--", docPath], { cwd: workspaceRoot });
        await execFileAsync("git", ["-C", workspaceRoot, "clean", "-fd", "--", docPath], { cwd: workspaceRoot });
        this.refresh();
    }
    refresh() {
        this.changeEmitter.fire();
    }
    async readTextIfExists(filePath) {
        try {
            return await fs.readFile(filePath, "utf8");
        }
        catch (error) {
            if (error.code === "ENOENT") {
                return "";
            }
            throw error;
        }
    }
}
exports.WorkspaceService = WorkspaceService;
function parseGitmodules(content) {
    const blocks = content
        .split(/\n(?=\[submodule ")/)
        .map((block) => block.trim())
        .filter((block) => block.startsWith("[submodule "));
    return blocks.map((block) => {
        const lines = block.split(/\r?\n/);
        const name = lines[0]?.match(/\[submodule "(.*)"\]/)?.[1] ?? "unknown";
        const data = new Map();
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
function parseTaskMarkdown(content) {
    const items = [];
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
        }
        else {
            items.push({ title: line });
        }
    }
    return items;
}
function normalizeTargetPath(input) {
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
function deriveRepoName(repoUrl) {
    const normalized = repoUrl.replace(/\/$/, "");
    const lastSegment = normalized.split("/").pop() ?? normalized.split(":").pop() ?? "repo";
    return lastSegment.replace(/\.git$/i, "");
}
function normalizePosixPath(rawPath) {
    return rawPath.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+/g, "/");
}
function normalizeOptionalPath(rawPath) {
    const value = rawPath?.trim();
    if (!value) {
        return undefined;
    }
    return normalizePosixPath(value);
}
async function pathExists(targetPath) {
    try {
        await fs.access(targetPath);
        return true;
    }
    catch {
        return false;
    }
}
async function safeReadDir(targetPath) {
    try {
        return await fs.readdir(targetPath, { withFileTypes: true });
    }
    catch {
        return [];
    }
}
async function findPackageJsonFiles(rootPath, maxDepth) {
    const results = [];
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
async function findMarkdownFiles(rootPath) {
    const files = [];
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
async function findAllFiles(rootPath) {
    const files = [];
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
async function visitDirectory(dirPath, depth, maxDepth, visitor) {
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
async function parsePackageJson(packageJsonPath) {
    try {
        const raw = await fs.readFile(packageJsonPath, "utf8");
        return JSON.parse(raw);
    }
    catch {
        return undefined;
    }
}
function toWorkspacePath(workspaceRoot, absolutePath) {
    return normalizePosixPath(path.relative(workspaceRoot, absolutePath));
}
function dedupe(items) {
    return Array.from(new Set(items)).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
}
async function requestJson(requestUrl, headers) {
    const client = requestUrl.protocol === "https:" ? https : http;
    return new Promise((resolve, reject) => {
        const request = client.request(requestUrl, {
            method: "GET",
            headers: {
                Accept: "application/json",
                ...headers,
            },
        }, (response) => {
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
                    const data = JSON.parse(body);
                    resolve({ data, headers: response.headers });
                }
                catch {
                    reject(new Error("GitLab 返回了无法解析的响应。"));
                }
            });
        });
        request.on("error", (error) => {
            reject(new Error(`GitLab 请求失败：${error.message}`));
        });
        request.end();
    });
}
function formatHttpError(statusCode, body) {
    if (statusCode === 401 || statusCode === 403) {
        return "访问 GitLab 失败，请检查 Token 是否有效。";
    }
    if (statusCode === 404) {
        return "没有找到匹配的 GitLab 项目，或你没有访问权限。";
    }
    try {
        const parsed = JSON.parse(body);
        if (parsed.message) {
            return `GitLab 请求失败：${parsed.message}`;
        }
    }
    catch {
        // ignore JSON parse error
    }
    return `GitLab 请求失败，状态码 ${statusCode}。`;
}
//# sourceMappingURL=workspaceService.js.map