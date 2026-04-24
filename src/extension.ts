import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as vscode from "vscode";
import {
  AddRepoInput,
  AppEntry,
  DocScopeEntry,
  GitLabProjectEntry,
  GitLabPullInput,
  GitLabPullResult,
  GitLabSearchInput,
  RepoEntry,
} from "./models";
import {
  AppNode,
  AppTreeProvider,
  DocScopeNode,
  DocScopeTreeProvider,
  RepoNode,
  RepoTreeProvider,
  TaskTreeProvider,
} from "./providers/treeProviders";
import { DashboardViewProvider } from "./webview/dashboardViewProvider";
import { WorkspaceService } from "./workspaceService";

export function activate(context: vscode.ExtensionContext): void {
  const service = new WorkspaceService();
  const repoProvider = new RepoTreeProvider(service);
  const appProvider = new AppTreeProvider(service);
  const taskProvider = new TaskTreeProvider(service);
  const docProvider = new DocScopeTreeProvider(service);
  const dashboardProvider = new DashboardViewProvider(context, service);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("localLife.repositories", repoProvider),
    vscode.window.registerTreeDataProvider("localLife.apps", appProvider),
    vscode.window.registerTreeDataProvider("localLife.tasks", taskProvider),
    vscode.window.registerTreeDataProvider("localLife.documents", docProvider),
    vscode.window.registerWebviewViewProvider(DashboardViewProvider.viewType, dashboardProvider),
    vscode.commands.registerCommand("localLife.refresh", async () => {
      service.refresh();
      await dashboardProvider.render();
    }),
    vscode.commands.registerCommand("localLife.openPath", async (relativePath: string) => {
      const workspaceRoot = service.getWorkspaceRoot();
      const targetUri = vscode.Uri.file(path.join(workspaceRoot, relativePath));
      try {
        const stat = await fs.stat(targetUri.fsPath);
        if (stat.isDirectory()) {
          await vscode.commands.executeCommand("revealInExplorer", targetUri);
          return;
        }
      } catch {
        // ignore and let openTextDocument surface a clearer error
      }

      const document = await vscode.workspace.openTextDocument(targetUri);
      await vscode.window.showTextDocument(document, { preview: false });
    }),
    vscode.commands.registerCommand("localLife.initWorkspace", async () => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "正在初始化 workspace 仓库",
        },
        async () => {
          try {
            await service.initWorkspaceRepos();
            vscode.window.showInformationMessage("仓库初始化完成。");
          } catch (error) {
            vscode.window.showErrorMessage(getErrorMessage(error));
          }
        },
      );
    }),
    vscode.commands.registerCommand("localLife.addRepository", async (payload?: AddRepoInput) => {
      const repoUrl = payload?.repoUrl?.trim() ?? "";
      if (!payload || !repoUrl) {
        vscode.window.showWarningMessage("请先在侧边栏表单中填写仓库地址。");
        return;
      }
      const input = payload;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "正在添加仓库",
        },
        async () => {
          try {
            await service.addRepository(input);
            vscode.window.showInformationMessage(`已添加仓库：${repoUrl}`);
          } catch (error) {
            vscode.window.showErrorMessage(getErrorMessage(error));
          }
        },
      );
    }),
    vscode.commands.registerCommand("localLife.removeRepository", async (node?: RepoNode | RepoEntry) => {
      const repo = extractRepoEntry(node);
      if (!repo) {
        vscode.window.showWarningMessage("请选择要卸载的仓库。");
        return;
      }

      const confirmed = await vscode.window.showWarningMessage(
        `将卸载仓库“${repo.name}”，并移除 submodule 路径 ${repo.path}。`,
        { modal: true },
        "确认卸载",
      );
      if (confirmed !== "确认卸载") {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `正在卸载仓库：${repo.name}`,
        },
        async () => {
          try {
            await service.removeRepository(repo.path);
            vscode.window.showInformationMessage(`已卸载仓库：${repo.name}`);
          } catch (error) {
            vscode.window.showErrorMessage(getErrorMessage(error));
          }
        },
      );
    }),
    vscode.commands.registerCommand("localLife.removeApplication", async (node?: AppNode | AppEntry) => {
      const app = extractAppEntry(node);
      if (!app) {
        vscode.window.showWarningMessage("请选择要卸载的应用。");
        return;
      }

      const actionLabel = app.kind === "repository" ? "确认卸载仓库应用" : "确认删除应用目录";
      const warning =
        app.kind === "repository"
          ? `应用“${app.name}”对应整个仓库，将按仓库卸载方式移除 ${app.repoPath}。`
          : `将直接删除应用目录 ${app.path}。如果要恢复，请在对应仓库内用 Git 还原。`;
      const confirmed = await vscode.window.showWarningMessage(warning, { modal: true }, actionLabel);
      if (confirmed !== actionLabel) {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `正在卸载应用：${app.name}`,
        },
        async () => {
          try {
            await service.removeApplication(app);
            vscode.window.showInformationMessage(`已卸载应用：${app.name}`);
          } catch (error) {
            vscode.window.showErrorMessage(getErrorMessage(error));
          }
        },
      );
    }),
    vscode.commands.registerCommand("localLife.restoreDocScope", async (node?: DocScopeNode | DocScopeEntry) => {
      const scope = extractDocScopeEntry(node);
      if (!scope) {
        vscode.window.showWarningMessage("请选择要还原的文档目录。");
        return;
      }

      const confirmed = await vscode.window.showWarningMessage(
        `将把 ${scope.path} 还原到当前 Git 版本，并清理该目录下未跟踪文件。`,
        { modal: true },
        "确认还原",
      );
      if (confirmed !== "确认还原") {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `正在还原：${scope.label}`,
        },
        async () => {
          try {
            await service.restoreDocScope(scope.key);
            vscode.window.showInformationMessage(`已还原：${scope.label}`);
          } catch (error) {
            vscode.window.showErrorMessage(getErrorMessage(error));
          }
        },
      );
    }),
    vscode.commands.registerCommand("localLife.searchGitLabProjects", async (payload?: GitLabSearchInput) => {
      if (!payload?.keyword?.trim()) {
        throw new Error("请先填写项目名称或关键字。");
      }

      return vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "正在搜索 GitLab 项目",
        },
        async () => service.searchGitLabProjects(payload),
      );
    }),
    vscode.commands.registerCommand("localLife.pullGitLabProjects", async (payload?: GitLabPullInput) => {
      if (!payload?.projects?.length) {
        throw new Error("请至少选择一个 GitLab 项目。");
      }

      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "正在拉取选中的 GitLab 项目",
        },
        async () => service.pullGitLabProjects(payload),
      );

      showGitLabPullSummary(result);
      return result;
    }),
  );

  registerWatchers(context, service);
  service.refresh();
}

export function deactivate(): void {}

function registerWatchers(context: vscode.ExtensionContext, service: WorkspaceService): void {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) {
    return;
  }

  const patterns = [
    new vscode.RelativePattern(root, ".gitmodules"),
    new vscode.RelativePattern(root, "docs/api-specs/**/*"),
    new vscode.RelativePattern(root, "docs/business-logic/**/*"),
    new vscode.RelativePattern(root, "docs/plans/**/*"),
    new vscode.RelativePattern(root, "docs/tasks/**/*.md"),
    new vscode.RelativePattern(root, "docs/templates/**/*"),
  ];

  for (const pattern of patterns) {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidChange(() => service.refresh(), undefined, context.subscriptions);
    watcher.onDidCreate(() => service.refresh(), undefined, context.subscriptions);
    watcher.onDidDelete(() => service.refresh(), undefined, context.subscriptions);
    context.subscriptions.push(watcher);
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "发生了未知错误。";
}

function showGitLabPullSummary(result: GitLabPullResult): void {
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

  const message = parts.length ? parts.join("，") : "没有执行任何拉取操作。";
  if (result.failed.length) {
    const detail = result.failed.map((item) => `${item.name}: ${item.reason}`).join(" | ");
    void vscode.window.showWarningMessage(`${message}。${detail}`);
    return;
  }

  void vscode.window.showInformationMessage(message);
}

function extractRepoEntry(node?: RepoNode | RepoEntry): RepoEntry | undefined {
  if (!node) {
    return undefined;
  }
  if (node instanceof RepoNode) {
    return node.repoEntry;
  }
  return "path" in node && "url" in node ? node : undefined;
}

function extractAppEntry(node?: AppNode | AppEntry): AppEntry | undefined {
  if (!node) {
    return undefined;
  }
  if (node instanceof AppNode) {
    return node.appEntry;
  }
  return "repoPath" in node && "path" in node ? node : undefined;
}

function extractDocScopeEntry(node?: DocScopeNode | DocScopeEntry): DocScopeEntry | undefined {
  if (!node) {
    return undefined;
  }
  if (node instanceof DocScopeNode) {
    return node.scopeEntry;
  }
  return "key" in node && "fileCount" in node ? node : undefined;
}
