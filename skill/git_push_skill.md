# Git 提交与推送操作规范

## 触发与执行约定

以后用户下达 **“推送代码”**、提交代码、同步 main、处理推送冲突等指令时，AI **必须先完整阅读本文件和根目录 AGENTS.md，严格按本清单生成可复制的 Windows PowerShell 命令**。默认由用户逐段执行并反馈；明确授权代执行时，按同样检查执行。

本文件按用户指定位置保存为项目操作规范，通过 AGENTS.md 发现。它不替换现有的部署 Skill，也不表示已经安装为独立的 Codex Skill。

**普通推送与冲突强制覆盖分开处理。只有用户明确确认 `feat/react-fastapi` 是最新且唯一保留版本，才使用强制覆盖流程。** 已有明确确认可沿用，不重复询问。仅说“推送代码”不自动授权丢弃 main 独有提交。

任何关键命令失败必须停止后续步骤，不能把失败状态下的命令整段继续执行。Git push 不等于公网部署；部署另读 [deploy_skill.md](deploy_skill.md) 和 [SKILL.md](SKILL.md)。

## 一、环境排雷：推送前必须清理代理

先让用户执行以下命令，每次准备 push 前都要检查本阶段：

```powershell
Set-Location 'D:\Study\SchedCopilot'
git config --global --unset http.proxy
git config --global --unset https.proxy
git status --short --branch
git branch --show-current
git remote -v
```

两个 unset 命令会修改用户全局 Git 配置；未配置对应键时可能返回非零状态，确认只是“键不存在”即可继续。权限错误或配置文件损坏不能忽略。

**全局代理清理不覆盖仓库级、URL 专用代理或进程环境代理。** 本仓库曾存在 `http.https://github.com/.proxy`，必须检查配置来源和键名，避免输出其他敏感配置：

```powershell
git config --show-origin --name-only --get-regexp '.*proxy.*'
Get-ChildItem Env: | Where-Object { $_.Name -match '^(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)$' } | Select-Object Name
```

如果确认本仓库的 GitHub 专用代理仍指向失效的 `127.0.0.1`，给出以下清理命令，并说明它只移除仓库内这一项代理：

```powershell
git config --local --unset-all http.https://github.com/.proxy
```

如存在其他有效代理或环境变量代理，按实际来源处理，不擅自永久删除所有代理。清理后仍连接重置、超时或鉴权失败，报告真实错误；**网络未恢复前，不进行 main 强制对齐或声称远程已同步。**

## 二、提交前检查与提交

确认工作目录、origin 地址及源分支正确；本项目预期开发分支为 `feat/react-fastapi`。不要带着未提交修改切换 main 或执行 reset。

检查 `.gitignore` 至少覆盖以下内容；数据库的 WAL、SHM 也不能入库：

```gitignore
.env
.env.*
!.env.example
.venv/
node_modules/
.data/
*.sqlite3
*.sqlite3-wal
*.sqlite3-shm
```

保留项目已有其他忽略规则，不能用这个片段覆盖整个 `.gitignore`。确需保留的其他脱敏环境模板必须显式列为例外并检查内容。

检查**已经被 Git 跟踪**的文件；ignore 不会自动取消跟踪。下列命令若输出真实密钥、环境目录或数据库路径，先处理再提交：

```powershell
git ls-files | Select-String -Pattern '(^|/)(\.venv|node_modules|\.data)/|(^|/)\.env($|\.)|\.sqlite3($|-wal$|-shm$)'
git diff --stat
git diff --check
```

`.env.example` 等模板需要人工区分。移除已跟踪敏感文件时使用针对具体路径的 `git rm --cached`，保留本地文件；曾提交的密钥还需要轮换，不能认为新增 ignore 已清除历史。

**提交前必须实际跑通本次全量后端检查，不得引用旧结果：**

```powershell
uv --directory backend run pytest
uv --directory backend run ruff check .
uv --directory backend run ruff format --check .
```

涉及前端时还要执行：

```powershell
Push-Location frontend
npm test
npm run format:check
npm run lint:architecture
npm run build
Pop-Location
```

逐条确认通过；失败时先修复，不提交。前端检查失败也应返回仓库根目录。安装依赖用 `npm ci`。

随后生成以下提交命令，把提交说明换成对本次实际变更的描述：

```powershell
git add --dry-run .
git add .
git diff --cached --stat
git diff --cached --check
git diff --cached
git commit -m "chore: update project implementation"
git status --short
```

暂存内容必须全部属于本次授权范围且无敏感文件；不属于本次任务的修改应排除。无变化时不制造空提交。提交后必须确认工作区干净。

## 三、同步 main：普通合并与冲突强制覆盖

先完成代理检查和提交，再获取真实远程状态；fetch 失败时停止：

```powershell
git fetch origin
git log --oneline --left-right origin/main...feat/react-fastapi
```

确认两侧独有提交及 README、AGENTS.md 等差异。默认普通合并：

```powershell
git checkout main
git merge --ff-only origin/main
git merge feat/react-fastapi
```

main 不存在、分支名不同或 fast-forward 失败时，AI 按实际状态给出下一步，不盲目执行后续命令。若自动生成了合并提交，推送前对合并后的最终代码重新完成适用检查。

### 冲突且用户确认开发分支是唯一保留版本

**明确告知：以下操作以开发分支完整替换 main，main 独有的 README、docs 或其他修改也会被丢弃。** 用户确认后，无需逐文件解决冲突，按以下流程强制对齐。

仅在存在正在进行的 merge 时中止；没有 merge 时不把 abort 的报错当作新的故障：

```powershell
git rev-parse -q --verify MERGE_HEAD
# 上一条输出提交号，才执行下一条：
git merge --abort
```

先确认工作区干净，再备份本地 main、已获取的远程 main 和开发分支引用。备份分支只保护已提交内容，不保护未提交文件：

```powershell
git status --short
$backupStamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
git branch "backup/local-main-$backupStamp" main
git branch "backup/origin-main-$backupStamp" origin/main
git branch "backup/feature-$backupStamp" feat/react-fastapi
git checkout main
git reset --hard feat/react-fastapi
git diff --exit-code main feat/react-fastapi
```

备份失败、工作区不干净或最终差异不为空时停止。**reset 后仍须满足 AGENTS.md 提交与推送质量门禁，不能把“完美版本”的确认当作测试结果。**

## 四、推送

普通合并完成且验证通过时：

```powershell
git push origin main
```

已经获得上述强制覆盖确认、完成备份与最终代码验证后，按用户指定命令推送：

```powershell
git push origin main -f
```

`-f` 会覆盖远程 main 历史。推送前必须确认远程未出现 fetch 后的新提交；如出现，停止并重新核对。它本身不提供并发保护，若存在协作者并发写入，应说明 `--force-with-lease` 可提供保护，并在用户同意调整命令后使用。分支保护拒绝时报告原因，不自动关闭保护。

## 五、验收检查

命令行验证远程 main 与本地 main 的提交号一致，并确认远程文件树：

```powershell
git rev-parse main
git ls-remote origin refs/heads/main
git fetch origin
git rev-parse origin/main
git ls-tree --name-only origin/main
git log -1 --oneline origin/main
```

三个 main 提交号必须一致；远程根目录必须包含 **`backend`、`frontend`、`AGENTS.md`**。目录存在只能证明结构完整，还要确认最新提交和本次新增文件/功能确实在远程。

最后让用户打开 origin 对应的 GitHub 仓库，选择 **main** 并刷新页面，确认以上文件及最新提交。本项目地址：<https://github.com/luoch95/SchedCopilot>。

## Checklist

- [ ] 已完整读取本规范和 AGENTS.md，生成适用于实际状态的 PowerShell 命令。
- [ ] push 前执行两个全局代理 unset，核查仓库/URL/环境代理残留。
- [ ] 确认仓库、origin、分支、工作区与敏感文件检查结果。
- [ ] 本次全量 Pytest 与适用质量检查通过，暂存区经过检查。
- [ ] 成功 fetch，核对 main 与开发分支差异。
- [ ] 普通流程合并；冲突强制覆盖仅在用户明确确认唯一版本后执行。
- [ ] 强制流程先 abort 适用的 merge、备份引用，再 checkout/reset，对最终代码验证。
- [ ] 按实际授权使用普通 push 或指定的 `git push origin main -f`。
- [ ] 远程提交号与文件树验证成功，再让用户刷新 GitHub 页面验收。
- [ ] 如实报告未执行或失败项；不把推送说成公网部署成功。
