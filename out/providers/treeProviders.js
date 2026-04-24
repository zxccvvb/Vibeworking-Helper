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
exports.DocScopeNode = exports.AppNode = exports.RepoNode = exports.DocScopeTreeProvider = exports.TaskTreeProvider = exports.AppTreeProvider = exports.RepoTreeProvider = void 0;
const vscode = __importStar(require("vscode"));
class RepoTreeProvider {
    service;
    changeEmitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.changeEmitter.event;
    constructor(service) {
        this.service = service;
        this.service.onDidChange(() => this.refresh());
    }
    refresh() {
        this.changeEmitter.fire(undefined);
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (element instanceof RepoNode) {
            return element.children;
        }
        const repos = await this.service.getRepos();
        return repos.map((repo) => new RepoNode(repo));
    }
}
exports.RepoTreeProvider = RepoTreeProvider;
class AppTreeProvider {
    service;
    changeEmitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.changeEmitter.event;
    constructor(service) {
        this.service = service;
        this.service.onDidChange(() => this.refresh());
    }
    refresh() {
        this.changeEmitter.fire(undefined);
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (element instanceof AppGroupNode) {
            return element.children;
        }
        const apps = await this.service.getApps();
        const grouped = new Map();
        for (const app of apps) {
            const group = grouped.get(app.repoName) ?? [];
            group.push(app);
            grouped.set(app.repoName, group);
        }
        return Array.from(grouped.entries()).map(([repoName, repoApps]) => new AppGroupNode(repoName, repoApps));
    }
}
exports.AppTreeProvider = AppTreeProvider;
class TaskTreeProvider {
    service;
    changeEmitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.changeEmitter.event;
    constructor(service) {
        this.service = service;
        this.service.onDidChange(() => this.refresh());
    }
    refresh() {
        this.changeEmitter.fire(undefined);
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (element instanceof TaskFileNode) {
            return element.children;
        }
        const tasks = await this.service.getTasks();
        return tasks.map((taskFile) => new TaskFileNode(taskFile));
    }
}
exports.TaskTreeProvider = TaskTreeProvider;
class DocScopeTreeProvider {
    service;
    changeEmitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.changeEmitter.event;
    constructor(service) {
        this.service = service;
        this.service.onDidChange(() => this.refresh());
    }
    refresh() {
        this.changeEmitter.fire(undefined);
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (element instanceof DocScopeNode) {
            return element.children;
        }
        const scopes = await this.service.getDocScopes();
        return scopes.map((scope) => new DocScopeNode(scope));
    }
}
exports.DocScopeTreeProvider = DocScopeTreeProvider;
class RepoNode extends vscode.TreeItem {
    children;
    repoEntry;
    constructor(repo) {
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
exports.RepoNode = RepoNode;
class AppGroupNode extends vscode.TreeItem {
    children;
    constructor(repoName, apps) {
        super(repoName, vscode.TreeItemCollapsibleState.Expanded);
        this.description = `${apps.length} 个应用`;
        this.iconPath = new vscode.ThemeIcon("layers");
        this.contextValue = "appGroup";
        this.children = apps.map((app) => new AppNode(app));
    }
}
class AppNode extends vscode.TreeItem {
    appEntry;
    constructor(app) {
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
exports.AppNode = AppNode;
class TaskFileNode extends vscode.TreeItem {
    taskFile;
    children;
    constructor(taskFile) {
        super(taskFile.title, vscode.TreeItemCollapsibleState.Expanded);
        this.taskFile = taskFile;
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
    constructor(filePath, item) {
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
class DocScopeNode extends vscode.TreeItem {
    children;
    scopeEntry;
    constructor(scope) {
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
exports.DocScopeNode = DocScopeNode;
class InfoNode extends vscode.TreeItem {
    constructor(label, value, tooltip) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = value;
        this.tooltip = tooltip ?? value;
        this.iconPath = new vscode.ThemeIcon("dash");
    }
}
//# sourceMappingURL=treeProviders.js.map