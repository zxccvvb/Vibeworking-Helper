# Vibeworking-Helper

一个嵌入 VSCode 侧边栏的 workspace 管理扩展，目标是把当前仓库的几件高频动作集中到一个侧边栏工作台里。

插件名称：`Vibeworking-Helper`

作者与许可沿用 `ApiHelper` 的风格：

- `publisher`: `mo9on`
- `author`: `九月`
- `license`: `MIT`

- 可视化添加 submodule 仓库
- 在侧边栏卸载仓库或应用
- 可视化选择拉取位置
- 自动发现仓库下的应用
- 自动扫描 `docs/tasks/**/*.md`
- 分别还原 `api-specs`、`business-logic`、`plans`、`tasks`、`templates`
- 支持搜索 GitLab 项目并批量拉取

## 当前能力

### 1. 总览面板

- 展示当前 workspace 根目录
- 展示仓库 / 应用 / 任务文件数量
- 提供「添加并拉取仓库」表单
- 提供「拉取全部仓库」按钮（执行 `make init`）

### 2. 仓库视图

- 读取根目录 `.gitmodules`
- 展示 submodule 的路径、分支、仓库地址、是否已初始化
- 支持右键卸载仓库

### 3. 应用视图

- 遍历每个 submodule
- 自动扫描仓库下深度 3 以内的 `package.json`
- 将发现到的应用按仓库分组展示
- 支持右键卸载应用

### 4. 任务视图

- 扫描 `docs/tasks/**/*.md`
- 将任务文件和其中的条目显示为树状结构

### 5. 文档视图

- 展示 `api-specs`、`business-logic`、`plans`、`tasks`、`templates`
- 支持分别还原单个文档目录到当前 Git 版本

### 6. GitLab 项目搜索

- 支持按项目名称或关键字直接搜索 GitLab 项目
- 支持按关键字过滤名称、路径和描述
- 支持勾选多个项目后批量拉取
- 搜索结果会展示项目描述、默认分支和 SSH 地址

## 适用场景

这个扩展适合当前 `local-life-workspace` 这种“workspace 仓库 + 多个业务仓库 submodule + docs 规范”的工作方式。

如果你的团队经常需要：

- 往 workspace 里挂新的前端或后端仓库
- 快速确认仓库落位
- 在 IDE 里同时看 repo / app / docs task

这个扩展可以省掉一部分命令行切换。

## 安装与调试

在扩展目录执行：

```bash
cd extensions/local-life-workbench
npm install
npm run build
```

然后在 VSCode 里：

1. 打开这个 workspace
2. 打开扩展开发宿主（`F5`）
3. 在左侧 Activity Bar 找到 `协作台`

## 交互说明

### 添加仓库

表单里有 4 个字段：

- `repoUrl`：Git 地址
- `branch`：默认分支
- `targetBase`：基础目录，例如 `packages/frontend`
- `customPath`：自定义完整路径，填了就优先使用

点击「添加并拉取」后，扩展会执行：

```bash
git -C <workspace-root> submodule add -f -b <branch> <repoUrl> <targetPath>
git config -f <workspace-root>/.gitmodules submodule.<targetPath>.branch <branch>
```

### 搜索并拉取 GitLab 项目

在总览页里填写：

- `项目名称 / 关键字`：例如 `wsc`、`cashier`、`write-off`
- `Access Token`：如果项目是私有的，建议填写；插件会持久化保存
- `拉取根目录`
- `路径前缀`：可选，默认留空

搜索后可以勾选多个项目，点击「拉取已选项目」批量添加到 workspace。

### 卸载仓库或应用

- 在「仓库」视图右键仓库可以卸载 submodule
- 在「应用」视图右键应用可以卸载目录
- 如果应用本身就是整个仓库，会自动按仓库方式卸载

### 还原文档目录

- 在「文档」视图右键某个目录，可以单独还原
- 还原时会执行 Git 恢复，并清理该目录下未跟踪文件

### 拉取全部仓库

点击「拉取全部仓库」会执行：

```bash
make init
```

也就是使用你当前仓库已经存在的初始化流程。

## 当前限制

- 应用发现目前基于 `package.json`，更适合前端 / Node 项目
- Tasks 解析目前是轻量规则，适配标题、`功能X`、`task-1:`、列表项这几类写法
- 仓库添加默认依赖本机已有 `git` 和 `make`
- 应用卸载对非仓库型应用是直接删除目录，适合工作区内可清理的应用目录

## 后续可以继续补的方向

- 支持右键删除 / 移除 submodule
- 支持从仓库里识别多个应用类型（前端、Node 服务、Electron）
- 支持 PRD / API Spec / Task 三类文档联动展示
- 支持在侧边栏直接生成 task 模板
