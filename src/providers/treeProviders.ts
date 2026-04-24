import * as vscode from "vscode";
import { AppEntry, DocScopeEntry, RepoEntry, TaskFileEntry, TaskItem } from "../models";
import { WorkspaceService } from "../workspaceService";

export class RepoTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly changeEmitter = new vscode.EventEmitter<TreeNode | undefined>();

  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly service: WorkspaceService) {
    this.service.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (element instanceof RepoNode) {
      return element.children;
    }

    const repos = await this.service.getRepos();
    return repos.map((repo) => new RepoNode(repo));
  }
}

export class AppTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly changeEmitter = new vscode.EventEmitter<TreeNode | undefined>();

  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly service: WorkspaceService) {
    this.service.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (element instanceof AppGroupNode) {
      return element.children;
    }

    const apps = await this.service.getApps();
    const grouped = new Map<string, AppEntry[]>();
    for (const app of apps) {
      const group = grouped.get(app.repoName) ?? [];
      group.push(app);
      grouped.set(app.repoName, group);
    }

    return Array.from(grouped.entries()).map(([repoName, repoApps]) => new AppGroupNode(repoName, repoApps));
  }
}

export class TaskTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly changeEmitter = new vscode.EventEmitter<TreeNode | undefined>();

  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly service: WorkspaceService) {
    this.service.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (element instanceof TaskFileNode) {
      return element.children;
    }

    const tasks = await this.service.getTasks();
    return tasks.map((taskFile) => new TaskFileNode(taskFile));
  }
}

export class DocScopeTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly changeEmitter = new vscode.EventEmitter<TreeNode | undefined>();

  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly service: WorkspaceService) {
    this.service.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (element instanceof DocScopeNode) {
      return element.children;
    }

    const scopes = await this.service.getDocScopes();
    return scopes.map((scope) => new DocScopeNode(scope));
  }
}

type TreeNode = RepoNode | AppGroupNode | AppNode | TaskFileNode | TaskNode | DocScopeNode | InfoNode;

export class RepoNode extends vscode.TreeItem {
  readonly children: TreeNode[];
  readonly repoEntry: RepoEntry;

  constructor(repo: RepoEntry) {
    super(repo.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.repoEntry = repo;
    this.description = repo.path;
    this.tooltip = `${repo.url}\n${repo.branch}`;
    this.contextValue = "repo";
    this.iconPath = new vscode.ThemeIcon(repo.exists ? "repo" : "warning");
    this.children = [
      new InfoNode("路径", repo.path, repo.path),
      new InfoNode("分支", repo.branch),
      new InfoNode("仓库", repo.url, repo.url),
      new InfoNode("状态", repo.exists ? "已拉取" : "未初始化"),
    ];
  }
}

class AppGroupNode extends vscode.TreeItem {
  readonly children: AppNode[];

  constructor(repoName: string, apps: AppEntry[]) {
    super(repoName, vscode.TreeItemCollapsibleState.Expanded);
    this.description = `${apps.length} 个应用`;
    this.iconPath = new vscode.ThemeIcon("layers");
    this.contextValue = "appGroup";
    this.children = apps.map((app) => new AppNode(app));
  }
}

export class AppNode extends vscode.TreeItem {
  readonly appEntry: AppEntry;

  constructor(app: AppEntry) {
    super(app.name, vscode.TreeItemCollapsibleState.None);
    this.appEntry = app;
    this.description = app.path;
    this.tooltip = [app.path, app.scripts.length ? `scripts: ${app.scripts.join(", ")}` : "无 scripts"].join("\n");
    this.iconPath = new vscode.ThemeIcon(app.kind === "repository" ? "repo" : "package");
    this.contextValue = app.kind === "repository" ? "appRepository" : "appWorkspace";
    this.command = {
      command: "localLife.openPath",
      title: "打开应用目录",
      arguments: [app.path],
    };
  }
}

class TaskFileNode extends vscode.TreeItem {
  readonly children: TaskNode[];

  constructor(private readonly taskFile: TaskFileEntry) {
    super(taskFile.title, vscode.TreeItemCollapsibleState.Expanded);
    this.description = taskFile.filePath;
    this.tooltip = taskFile.filePath;
    this.iconPath = new vscode.ThemeIcon("checklist");
    this.command = {
      command: "localLife.openPath",
      title: "打开任务文件",
      arguments: [taskFile.filePath],
    };
    this.children = taskFile.items.map((item) => new TaskNode(taskFile.filePath, item));
  }
}

class TaskNode extends vscode.TreeItem {
  constructor(filePath: string, item: TaskItem) {
    super(item.title, vscode.TreeItemCollapsibleState.None);
    this.description = item.detail;
    this.tooltip = item.detail ? `${item.title}\n${item.detail}` : item.title;
    this.iconPath = new vscode.ThemeIcon(item.detail ? "circle-outline" : "symbol-key");
    this.command = {
      command: "localLife.openPath",
      title: "打开任务文件",
      arguments: [filePath],
    };
  }
}

export class DocScopeNode extends vscode.TreeItem {
  readonly children: InfoNode[];
  readonly scopeEntry: DocScopeEntry;

  constructor(scope: DocScopeEntry) {
    super(scope.label, vscode.TreeItemCollapsibleState.Collapsed);
    this.scopeEntry = scope;
    this.description = `${scope.fileCount} 个文件`;
    this.tooltip = scope.path;
    this.iconPath = new vscode.ThemeIcon("folder-library");
    this.contextValue = "docScope";
    this.command = {
      command: "localLife.openPath",
      title: "打开目录",
      arguments: [scope.path],
    };
    this.children = [
      new InfoNode("目录", scope.path, scope.path),
      new InfoNode("文件数", `${scope.fileCount}`),
    ];
  }
}

class InfoNode extends vscode.TreeItem {
  constructor(label: string, value: string, tooltip?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = value;
    this.tooltip = tooltip ?? value;
    this.iconPath = new vscode.ThemeIcon("dash");
  }
}
