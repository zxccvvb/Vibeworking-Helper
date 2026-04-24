export interface RepoEntry {
  name: string;
  path: string;
  url: string;
  branch: string;
  exists: boolean;
}

export interface LocationOption {
  label: string;
  value: string;
  description?: string;
}

export interface AddRepoInput {
  repoUrl: string;
  branch: string;
  targetBase: string;
  customPath?: string;
}

export interface GitLabSearchInput {
  keyword: string;
  token?: string;
}

export interface GitLabProjectEntry {
  id: number;
  name: string;
  path: string;
  pathWithNamespace: string;
  description: string;
  webUrl: string;
  sshUrlToRepo: string;
  defaultBranch: string;
}

export interface GitLabPullInput {
  projects: GitLabProjectEntry[];
  targetBase: string;
  pathPrefix?: string;
}

export interface GitLabPullResult {
  added: string[];
  skipped: string[];
  failed: Array<{ name: string; reason: string }>;
}

export interface AppEntry {
  repoName: string;
  name: string;
  path: string;
  repoPath: string;
  kind: "workspace-package" | "repository";
  scripts: string[];
}

export interface TaskItem {
  title: string;
  detail?: string;
}

export interface TaskFileEntry {
  filePath: string;
  title: string;
  items: TaskItem[];
}

export interface DashboardData {
  repos: RepoEntry[];
  apps: AppEntry[];
  tasks: TaskFileEntry[];
  locations: LocationOption[];
  workspaceRoot: string;
}

export interface DocScopeEntry {
  key: string;
  label: string;
  path: string;
  fileCount: number;
}
