import * as vscode from "vscode";
import { DashboardData, GitLabProjectEntry, GitLabPullResult, GitLabSearchInput } from "../models";
import { WorkspaceService } from "../workspaceService";

interface GitLabViewState {
  form: {
    token: string;
    keyword: string;
    targetBase: string;
    pathPrefix: string;
  };
  results: GitLabProjectEntry[];
  message?: string;
}

const GITLAB_TOKEN_SECRET_KEY = "vibeworking-helper.gitlab-token";

export class DashboardViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "localLife.dashboard";

  private view?: vscode.WebviewView;
  private readonly gitlabState: GitLabViewState = {
    form: {
      token: "",
      keyword: "",
      targetBase: "packages/frontend",
      pathPrefix: "",
    },
    results: [],
  };

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly service: WorkspaceService,
  ) {
    this.service.onDidChange(() => {
      void this.render();
    });
  }

  resolveWebviewView(
    view: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void | Thenable<void> {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
    };

    view.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case "refresh":
          this.service.refresh();
          return;
        case "init-workspace":
          await vscode.commands.executeCommand("localLife.initWorkspace");
          return;
        case "add-repo":
          await vscode.commands.executeCommand("localLife.addRepository", message.payload);
          return;
        case "search-gitlab":
          await this.searchGitLabProjects(message.payload as GitLabSearchInput);
          return;
        case "pull-gitlab":
          await this.pullGitLabProjects(
            message.payload as {
              projects: GitLabProjectEntry[];
              targetBase: string;
              pathPrefix?: string;
            },
          );
          return;
        default:
          return;
      }
    });

    return this.restoreSecretAndRender();
  }

  async render(): Promise<void> {
    if (!this.view) {
      return;
    }

    const data = await this.service.getDashboardData();
    this.view.webview.html = getHtml(this.view.webview, data, this.gitlabState);
  }

  private async searchGitLabProjects(input: GitLabSearchInput): Promise<void> {
    this.gitlabState.form.token = input.token?.trim() ?? "";
    this.gitlabState.form.keyword = input.keyword?.trim() ?? "";
    await this.persistToken();

    try {
      const results = (await vscode.commands.executeCommand(
        "localLife.searchGitLabProjects",
        input,
      )) as GitLabProjectEntry[];
      this.gitlabState.results = results;
      this.gitlabState.message = `已搜索到 ${results.length} 个项目。`;
    } catch (error) {
      this.gitlabState.results = [];
      this.gitlabState.message = error instanceof Error ? error.message : "GitLab 搜索失败。";
    }

    await this.render();
  }

  private async pullGitLabProjects(input: {
    projects: GitLabProjectEntry[];
    targetBase: string;
    pathPrefix?: string;
  }): Promise<void> {
    this.gitlabState.form.targetBase = input.targetBase?.trim() || this.gitlabState.form.targetBase;
    this.gitlabState.form.pathPrefix = input.pathPrefix?.trim() ?? "";

    try {
      const result = (await vscode.commands.executeCommand("localLife.pullGitLabProjects", input)) as GitLabPullResult;
      this.gitlabState.message = formatPullResult(result);
    } catch (error) {
      this.gitlabState.message = error instanceof Error ? error.message : "GitLab 项目拉取失败。";
    }

    await this.render();
  }

  private async restoreSecretAndRender(): Promise<void> {
    const savedToken = await this.context.secrets.get(GITLAB_TOKEN_SECRET_KEY);
    if (savedToken) {
      this.gitlabState.form.token = savedToken;
    }
    await this.render();
  }

  private async persistToken(): Promise<void> {
    if (this.gitlabState.form.token) {
      await this.context.secrets.store(GITLAB_TOKEN_SECRET_KEY, this.gitlabState.form.token);
      return;
    }
    await this.context.secrets.delete(GITLAB_TOKEN_SECRET_KEY);
  }
}

function getHtml(webview: vscode.Webview, data: DashboardData, gitlabState: GitLabViewState): string {
  const nonce = getNonce();
  const locationsMarkup = data.locations
    .map(
      (location) =>
        `<option value="${escapeHtml(location.value)}" ${
          location.value === gitlabState.form.targetBase ? "selected" : ""
        }>${escapeHtml(location.label)}${
          location.description ? ` · ${escapeHtml(location.description)}` : ""
        }</option>`,
    )
    .join("");

  const repoCards = data.repos
    .slice(0, 4)
    .map(
      (repo) => `
        <div class="repo-card">
          <div class="repo-name">${escapeHtml(repo.name)}</div>
          <div class="repo-meta">${escapeHtml(repo.path)}</div>
          <div class="repo-sub">${escapeHtml(repo.branch)} · ${repo.exists ? "已拉取" : "未初始化"}</div>
        </div>
      `,
    )
    .join("");

  const taskCards = data.tasks
    .slice(0, 3)
    .map(
      (task) => `
        <div class="task-card">
          <div class="task-title">${escapeHtml(task.title)}</div>
          <div class="task-meta">${escapeHtml(task.filePath)}</div>
          <div class="task-count">${task.items.length} 条任务线索</div>
        </div>
      `,
    )
    .join("");

  const gitlabCards = gitlabState.results
    .map(
      (project) => `
        <label class="gitlab-card">
          <input
            class="project-checkbox"
            type="checkbox"
            data-project='${escapeAttribute(JSON.stringify(project))}'
          />
          <div class="gitlab-main">
            <div class="repo-name">${escapeHtml(project.name)}</div>
            <div class="repo-meta">${escapeHtml(project.pathWithNamespace)}</div>
            <div class="repo-sub">${escapeHtml(project.defaultBranch)} · ${escapeHtml(project.sshUrlToRepo)}</div>
            <div class="gitlab-desc">${escapeHtml(project.description || "暂无描述")}</div>
          </div>
        </label>
      `,
    )
    .join("");

  return `<!DOCTYPE html>
  <html lang="zh-CN">
    <head>
      <meta charset="UTF-8" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <style>
        :root {
          color-scheme: dark;
          --bg: var(--vscode-sideBar-background);
          --panel: color-mix(in srgb, var(--vscode-sideBar-background) 78%, #161b22);
          --panel-strong: color-mix(in srgb, var(--vscode-sideBar-background) 55%, #0b111b);
          --border: color-mix(in srgb, var(--vscode-editor-foreground) 18%, transparent);
          --text: var(--vscode-editor-foreground);
          --muted: var(--vscode-descriptionForeground);
          --accent: #4f8cff;
          --accent-soft: rgba(79, 140, 255, 0.16);
          --success: #3fb950;
          --warning: #d29922;
        }

        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
          padding: 14px;
          background: radial-gradient(circle at top right, rgba(79, 140, 255, 0.14), transparent 28%), var(--bg);
          color: var(--text);
          font: 12px/1.5 var(--vscode-font-family);
        }

        .shell {
          display: grid;
          gap: 12px;
        }

        .hero, .panel {
          border: 1px solid var(--border);
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent), var(--panel);
          border-radius: 14px;
          padding: 14px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
        }

        .hero {
          background: linear-gradient(135deg, rgba(79, 140, 255, 0.22), transparent 55%), var(--panel-strong);
        }

        .eyebrow {
          color: var(--accent);
          text-transform: uppercase;
          letter-spacing: 0.12em;
          font-size: 10px;
          margin-bottom: 6px;
        }

        h1, h2 {
          margin: 0;
          font-size: 14px;
          font-weight: 600;
        }

        .sub {
          margin-top: 6px;
          color: var(--muted);
        }

        .stats {
          margin-top: 14px;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
        }

        .stat {
          padding: 10px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.05);
        }

        .stat b {
          display: block;
          font-size: 18px;
          margin-bottom: 2px;
        }

        .actions {
          display: flex;
          gap: 8px;
          margin-top: 12px;
        }

        button {
          appearance: none;
          border: 1px solid transparent;
          border-radius: 10px;
          padding: 9px 12px;
          background: var(--accent);
          color: white;
          cursor: pointer;
          font: inherit;
          font-weight: 600;
        }

        button.secondary {
          background: transparent;
          color: var(--text);
          border-color: var(--border);
        }

        label {
          display: block;
          margin-bottom: 10px;
          color: var(--muted);
        }

        input, select {
          width: 100%;
          margin-top: 6px;
          border: 1px solid var(--border);
          background: rgba(0, 0, 0, 0.16);
          color: var(--text);
          border-radius: 10px;
          padding: 10px 12px;
          font: inherit;
        }

        .grid {
          display: grid;
          gap: 10px;
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .repo-list, .task-list {
          display: grid;
          gap: 8px;
          margin-top: 10px;
        }

        .repo-card, .task-card {
          border-radius: 12px;
          border: 1px solid var(--border);
          background: rgba(255, 255, 255, 0.03);
          padding: 10px;
        }

        .repo-name, .task-title {
          font-size: 13px;
          font-weight: 600;
        }

        .repo-meta, .task-meta, .repo-sub, .task-count {
          margin-top: 4px;
          color: var(--muted);
          word-break: break-all;
        }

        .hint {
          margin-top: 8px;
          padding: 10px;
          border-radius: 10px;
          background: var(--accent-soft);
          color: #c5d8ff;
        }

        .empty {
          color: var(--muted);
          border: 1px dashed var(--border);
          border-radius: 12px;
          padding: 12px;
          margin-top: 10px;
        }

        .gitlab-toolbar {
          display: grid;
          gap: 10px;
        }

        .gitlab-card {
          display: grid;
          grid-template-columns: 18px minmax(0, 1fr);
          gap: 10px;
          align-items: start;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: rgba(255, 255, 255, 0.03);
          padding: 10px;
          margin-top: 10px;
          cursor: pointer;
        }

        .gitlab-card input {
          margin-top: 2px;
        }

        .gitlab-desc {
          margin-top: 6px;
          color: var(--text);
          opacity: 0.84;
        }

        .message {
          margin-top: 10px;
          padding: 10px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid var(--border);
          color: var(--text);
        }
      </style>
    </head>
    <body>
      <div class="shell">
        <section class="hero">
          <div class="eyebrow">Vibeworking-Helper</div>
          <h1>在侧边栏集中管理仓库、应用和任务</h1>
          <div class="sub">${escapeHtml(data.workspaceRoot)}</div>
          <div class="stats">
            <div class="stat"><b>${data.repos.length}</b>仓库</div>
            <div class="stat"><b>${data.apps.length}</b>应用</div>
            <div class="stat"><b>${data.tasks.length}</b>任务文件</div>
          </div>
          <div class="actions">
            <button id="refreshButton" class="secondary">刷新视图</button>
            <button id="initButton">拉取全部仓库</button>
          </div>
        </section>

        <section class="panel">
          <div class="eyebrow">添加仓库</div>
          <h2>可视化添加仓库</h2>
          <div class="sub">填写仓库地址，选择落位，扩展会执行 \`git submodule add\` 并刷新侧边栏。</div>
          <form id="repoForm">
            <label>
              仓库地址
              <input id="repoUrl" name="repoUrl" placeholder="git@gitlab.xxx.com:group/repo.git" required />
            </label>
            <div class="grid">
              <label>
                分支
                <input id="branch" name="branch" value="master" />
              </label>
              <label>
                目标根目录
                <select id="targetBase" name="targetBase">${locationsMarkup}</select>
              </label>
            </div>
            <label>
              自定义完整路径（可选）
              <input id="customPath" name="customPath" placeholder="例如 packages/frontend/retail-cashier-node" />
            </label>
            <button type="submit">添加并拉取</button>
          </form>
          <div class="hint">默认会使用“目标根目录 + 仓库名”生成路径；如果你要精确控制位置，直接填写自定义完整路径。</div>
        </section>

        <section class="panel">
          <div class="eyebrow">GitLab 搜索</div>
          <h2>搜索并批量拉取 GitLab 项目</h2>
          <div class="sub">直接按项目名称或关键字搜索 GitLab 项目，展示项目描述，并把选中的仓库批量拉到指定目录。</div>
          <form id="gitlabForm" class="gitlab-toolbar">
            <div class="grid">
              <label>
                Access Token
                <input id="gitlabToken" name="gitlabToken" type="password" value="${escapeAttribute(gitlabState.form.token)}" placeholder="私有仓库建议填写" />
              </label>
              <label>
                项目名称 / 关键字
                <input id="gitlabKeyword" name="gitlabKeyword" value="${escapeAttribute(gitlabState.form.keyword)}" required />
              </label>
            </div>
            <div class="grid">
              <label>
                拉取根目录
                <select id="gitlabTargetBase" name="gitlabTargetBase">${locationsMarkup}</select>
              </label>
              <label>
                路径前缀
                <input id="gitlabPathPrefix" name="gitlabPathPrefix" value="${escapeAttribute(gitlabState.form.pathPrefix)}" />
              </label>
            </div>
            <div class="actions">
              <button type="submit">搜索项目</button>
              <button type="button" class="secondary" id="pullGitlabButton">拉取已选项目</button>
            </div>
          </form>
          ${
            gitlabState.message
              ? `<div class="message">${escapeHtml(gitlabState.message)}</div>`
              : ""
          }
          ${
            gitlabCards
              ? `<div class="repo-list">${gitlabCards}</div>`
              : `<div class="empty">还没有 GitLab 搜索结果。你可以直接输入项目名称或关键字开始搜索。</div>`
          }
        </section>

        <section class="panel">
          <div class="eyebrow">仓库</div>
          <h2>最近仓库</h2>
          ${
            repoCards
              ? `<div class="repo-list">${repoCards}</div>`
              : `<div class="empty">当前还没有 submodule，可以先在上面的表单里添加。</div>`
          }
        </section>

        <section class="panel">
          <div class="eyebrow">任务</div>
          <h2>Docs 任务一览</h2>
          ${
            taskCards
              ? `<div class="task-list">${taskCards}</div>`
              : `<div class="empty">还没有扫描到 \`docs/tasks/**/*.md\` 文件。</div>`
          }
        </section>
      </div>

      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        document.getElementById("refreshButton").addEventListener("click", () => {
          vscode.postMessage({ type: "refresh" });
        });

        document.getElementById("initButton").addEventListener("click", () => {
          vscode.postMessage({ type: "init-workspace" });
        });

        document.getElementById("repoForm").addEventListener("submit", (event) => {
          event.preventDefault();
          const repoUrl = document.getElementById("repoUrl").value;
          const branch = document.getElementById("branch").value;
          const targetBase = document.getElementById("targetBase").value;
          const customPath = document.getElementById("customPath").value;
          vscode.postMessage({
            type: "add-repo",
            payload: { repoUrl, branch, targetBase, customPath }
          });
        });

        document.getElementById("gitlabForm").addEventListener("submit", (event) => {
          event.preventDefault();
          const token = document.getElementById("gitlabToken").value;
          const keyword = document.getElementById("gitlabKeyword").value;
          vscode.postMessage({
            type: "search-gitlab",
            payload: { token, keyword }
          });
        });

        document.getElementById("pullGitlabButton").addEventListener("click", () => {
          const projects = Array.from(document.querySelectorAll(".project-checkbox:checked"))
            .map((element) => {
              const raw = element.getAttribute("data-project");
              return raw ? JSON.parse(raw) : null;
            })
            .filter(Boolean);
          const targetBase = document.getElementById("gitlabTargetBase").value;
          const pathPrefix = document.getElementById("gitlabPathPrefix").value;
          vscode.postMessage({
            type: "pull-gitlab",
            payload: { projects, targetBase, pathPrefix }
          });
        });
      </script>
    </body>
  </html>`;
}

function getNonce(): string {
  return Math.random().toString(36).slice(2);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

function formatPullResult(result: GitLabPullResult): string {
  const parts: string[] = [];
  if (result.added.length) {
    parts.push(`已添加 ${result.added.length} 个`);
  }
  if (result.skipped.length) {
    parts.push(`跳过 ${result.skipped.length} 个`);
  }
  if (result.failed.length) {
    parts.push(`失败 ${result.failed.length} 个`);
  }
  return parts.length ? parts.join("，") : "没有执行任何拉取操作。";
}
