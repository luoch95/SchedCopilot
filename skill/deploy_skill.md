# SchedCopilot 公网部署操作清单

## 使用方式与已知环境

用户让你部署时，读取本文件，按当前情况生成具体操作步骤。默认由用户执行，不自行连接或修改公网服务器。保持手动部署简单，不新增监控、权限系统或复杂运维脚本。

已知路径仅作起点，每次用实际进程核实：

| 项目 | 当前约定 |
| --- | --- |
| 本地仓库 | `D:\Study\SchedCopilot` |
| GitHub | `https://github.com/luoch95/SchedCopilot.git` |
| 常用分支 | `feat/react-fastapi` |
| 服务器项目根目录 | `/opt/schedcopilot` |
| 后端及虚拟环境 | `/opt/schedcopilot/backend`、`backend/.venv` |
| 前端产物 | `/opt/schedcopilot/frontend/dist` |
| systemd 服务 | `schedcopilot.service` |
| 后端监听 | `127.0.0.1:8000` |
| 业务数据库 | `/opt/schedcopilot/.data/injection_molding.sqlite3` |

公网域名、SSH 地址、实际 Nginx root 尚须核实，不能从旧例子推断。后端依赖以 `backend/pyproject.toml`、`backend/uv.lock` 为准，不假设存在 requirements.txt。仓库根目录包含 backend 与 frontend，不要把整个仓库克隆进 backend 子目录。

## 不可跳过的 Checklist

- [ ] 查清本次发布代码/产物、目标分支、服务器目录、公网地址及实际进程。
- [ ] 记录部署前数据库和 API 的计划版本、当前故障、审批状态；检查已有差异。
- [ ] 确认有效配置为绝对数据库路径、`SCHED_DEMO_MODE=0`。
- [ ] 完成与本次改动相关的检查、前端构建；确认压缩包不含业务数据和密钥。
- [ ] 停止写入并完成数据库一致性备份，记录旧代码/前端产物用于回退。
- [ ] 更新代码与前端产物，保留服务器数据和配置；需要时执行已验证的数据库迁移。
- [ ] 重启服务后重新核对真实进程配置及打开的数据库文件。
- [ ] **服务器实际数据库 → 服务器本机 API → 公网 API 数据一致。**
- [ ] 公网 HTML 引用本次发布的前端资源；随后才进行页面及审批流程检查。
- [ ] 记录发布标识、备份位置、核验结果及未验证事项。

任一步失败，停止后续发布操作，先定位；不得用覆盖数据库、清空历史、重置演示或反复重启来掩盖差异。用户没返回结果就是未验证。

## 1. 部署前只读检查

先给用户服务器 Bash 命令，自动取得服务 PID，禁止使用示例 PID 12345：

```bash
sudo systemctl status schedcopilot --no-pager
sudo ss -ltnp 'sport = :8000'
sudo python3 - <<'PY'
import os, pathlib, subprocess
pid = subprocess.check_output(['systemctl', 'show', 'schedcopilot', '--property=MainPID', '--value'], text=True).strip()
if not pid.isdecimal() or int(pid) <= 0:
    raise SystemExit('服务未运行，先排查启动日志；不要继续发布。')
p = pathlib.Path('/proc') / pid
print('PID:', pid)
print('启动命令:', p.joinpath('cmdline').read_bytes().replace(b'\0', b' ').decode())
print('工作目录:', os.readlink(p / 'cwd'))
env = dict(x.split('=', 1) for x in p.joinpath('environ').read_bytes().decode().split('\0') if '=' in x)
for key in ('SCHED_DB_PATH', 'SCHED_DEMO_MODE'):
    print(key, '=', env.get(key, '未显式设置'))
opened = set()
for fd in p.joinpath('fd').iterdir():
    try:
        target = os.readlink(fd)
        if '.sqlite3' in target:
            opened.add(target)
    except FileNotFoundError:
        pass
print('打开的数据库:', *sorted(opened), sep='\n')
PY
sudo find /opt/schedcopilot -type f -name '*.sqlite3' -printf '%p | %s bytes | %TY-%Tm-%Td %TH:%TM:%TS\n'
```

只打印上述白名单环境变量，禁止输出整个进程环境或 `.env` 密钥。查看 unit、EnvironmentFile、Nginx 配置时也须避免向对话粘贴密钥。

本项目 `Settings.from_env()` 中演示模式默认开启，即使设置 SCHED_DB_PATH 仍可能在启动时重置指定数据库。不得仅凭路径正确就重启。若配置不符合，先停服务和备份，再按第 3 节固定配置。

## 2. 打包与备份

本地 PowerShell：检查 `git status --short`、当前提交、变更范围，不能把用户无关文件顺带提交。按当前 CI 执行相应检查，前端至少运行 `npm ci`、`npm test`、`npm run lint:architecture`、`npm run build`；后端有改动时按 `uv --directory backend run pytest` 等当前 CI 命令验证。已有同一代码版本的有效检查结果可以复用。

打包排除 `.data`、所有 `.env`（含子目录）、数据库及其 `-wal`/`-shm` 文件、虚拟环境、node_modules、.git、日志及缓存；明确包含最新 `frontend/dist`。输出产物名称、提交号、SHA256，上传后核对哈希。Git push 只更新 GitHub，不等于公网已部署。

服务器备份时进入短暂停机窗口，确认没有其他进程仍在写数据库。以下命令应在**同一个 Bash 会话**逐条执行，任一失败立即停止；备份前确认磁盘空间，并确认备份目录不位于 Nginx 可访问范围：

```bash
sudo systemctl stop schedcopilot
RELEASE_BACKUP="/opt/schedcopilot-backups/$(date +%Y%m%d-%H%M%S)"
sudo mkdir -p "$RELEASE_BACKUP"
sudo chmod 700 "$RELEASE_BACKUP"
sudo cp -a /opt/schedcopilot/.data "$RELEASE_BACKUP/data"
sudo cp -a /opt/schedcopilot/frontend/dist "$RELEASE_BACKUP/frontend-dist"
sudo cp -a /etc/systemd/system/schedcopilot.service "$RELEASE_BACKUP/"
if [ -d /etc/systemd/system/schedcopilot.service.d ]; then
    sudo cp -a /etc/systemd/system/schedcopilot.service.d "$RELEASE_BACKUP/"
fi
printf '备份位置：%s\n' "$RELEASE_BACKUP"
```

首次部署没有 `.data`/dist 时应说明不存在并生成适用命令；不要忽略备份失败。记录旧提交或额外备份部署代码，以及真实配置文件；备份文件权限须保护密钥。运行中的 SQLite 不能只复制主文件冒充一致性备份；不停服务时改用 SQLite backup API。

## 3. 固定配置与更新

在完成备份后，必要时创建 systemd drop-in；已有正确配置则不重复修改：

```bash
sudo mkdir -p /etc/systemd/system/schedcopilot.service.d
sudo tee /etc/systemd/system/schedcopilot.service.d/database.conf >/dev/null <<'EOF'
[Service]
Environment="SCHED_DB_PATH=/opt/schedcopilot/.data/injection_molding.sqlite3"
Environment="SCHED_DEMO_MODE=0"
EOF
sudo systemctl daemon-reload
```

EnvironmentFile 可能覆盖 Environment 配置。若其包含同名变量，修正实际来源并在启动后验证进程环境，不能把 drop-in 文件内容当作有效配置证据。保留其他模型配置与密钥。持久化模式的只读/解锁行为应按现有实现验证，不承诺本次配置会保留演示模式的访问限制。

按实际发布方式二选一，不混用：

- Git：先确认服务器仓库根目录、工作区无冲突和目标提交，再使用 `git pull --ff-only origin feat/react-fastapi`，不能强制 reset 丢弃修改。依赖使用现有环境的 uv 锁定安装；没有 uv 时根据 pyproject 和实际解释器提供兼容安装命令，不临时改 Python 系统环境。
- 上传包：先解压到独立临时目录，核对包结构与排除项，再更新明确的代码路径，禁止把未知包直接覆盖项目根目录。

前端先完整上传到临时目录并确认 index.html 与资源齐全，再替换线上 dist；不要先删除线上 dist 再等用户上传。保存旧产物，不必为普通更新重写 Nginx。实际 HTTP 客户端使用同源 `/api`，不能仅设置一个代码未读取的 VITE 环境变量就声称地址已更正。

数据库结构变更只执行本次代码所需且已验证的迁移。普通更新不上传本地数据库，不调用 `/api/demo/reset`，不清空历史。若用户明确要求导入本地快照，单独处理：源库用一致性快照、停服务、备份目标及侧文件、核对真实路径/权限，再导入；不可用 cp 在线覆盖数据库。

更新完成后启动后端：

```bash
sudo systemctl start schedcopilot
sudo systemctl status schedcopilot --no-pager
sudo nginx -t
```

Nginx 配置有修改且检查通过时才 reload。重跑第 1 节进程核验，确认新 PID、配置和打开文件；启动失败查看 `sudo journalctl -u schedcopilot -n 80 --no-pager`，日志回传前隐藏密钥。

## 4. 三方数据核验（硬性门槛）

“本机”在这里指**云服务器本机**，不是 Windows 开发电脑。服务器数据库是事实来源；新增功能不要求它与开发电脑的数据相同。

在禁止演示写入的验收窗口，先查询第 1 节确认的真实数据库。下例仅适用于已确认的当前路径，使用只读连接，不实例化应用或仓库，不触发初始化：

```bash
python3 - <<'PY'
import json, sqlite3
from pathlib import Path
p = Path('/opt/schedcopilot/.data/injection_molding.sqlite3').resolve(strict=True)
with sqlite3.connect(p.as_uri() + '?mode=ro', uri=True) as db:
    result = db.execute('PRAGMA quick_check').fetchone()[0]
    if result != 'ok':
        raise SystemExit('数据库完整性检查失败：' + result)
    plan = json.loads(db.execute('SELECT payload FROM current_plan WHERE id=1').fetchone()[0])
    event = json.loads(db.execute('SELECT payload FROM current_event WHERE id=1').fetchone()[0])
    print('数据库路径：', p)
    print('数据库计划版本：', plan['version'])
    print('数据库当前事件：', json.dumps(event, ensure_ascii=False))
PY
curl -fsS --max-time 30 -H 'Cache-Control: no-cache' http://127.0.0.1:8000/api/workbench -o /tmp/schedcopilot-local-workbench.json
python3 - <<'PY'
import json
with open('/tmp/schedcopilot-local-workbench.json') as f:
    d = json.load(f)
r = d.get('fault_review') or {}
print('本机 API：', json.dumps({
    'version': d['baseline']['version'], 'event': d['event'],
    'review_id': r.get('id'), 'review_kind': r.get('kind'),
    'review_status': r.get('status'), 'review_event_revision': r.get('event_revision'),
    'review_baseline_fingerprint': r.get('baseline_fingerprint')
}, ensure_ascii=False))
PY
```

然后用**已确认的实际公网地址**生成 curl 命令，调用 `/api/workbench?deploy_check=<本次发布标识>`，保存为 `/tmp/schedcopilot-public-workbench.json`。不用 `curl -k` 绕过 TLS，不拿 localhost 的 Nginx 响应冒充公网验收。公网不可达则标记未通过并继续查网络，不跳过。

比对完整 `baseline`、`event`、`fault_review` 的结构化值，忽略 JSON 键顺序；不要只看 HTTP 200 或版本号。至少核对计划版本、当前故障、事件修订、审批 ID/kind/status 与绑定的计划指纹；没有审批也须三方语义一致。字段或数据库结构变化时先读取当前实现，使用真实字段，不能编造查询。

数据库事件与本机 API 若有派生差异，读取序列化和工作台实现后明确映射。审批持久化在 `fault_reviews`；需要时依据当前实现的事件修订和计划指纹筛选当前记录，不把最近一条历史审批当作当前审批。无法完成数据库审批核验应列为未验证。

| 观察结果 | 下一步 |
| --- | --- |
| 数据库与本机 API 不同 | 查实际打开路径、进程配置、旧连接/已删除文件和应用状态；禁止直接覆盖库 |
| 本机 API 与公网 API 不同 | 查 Nginx upstream、域名解析、其他后端进程与缓存；不要断言前端问题 |
| 三方一致但页面不同 | 查部署 dist、HTML 引用的资源哈希、浏览器网络请求与缓存 |
| 无写操作但部署前后业务数据变化 | 停止验收，查初始化/迁移及是否有并发写入 |

## 5. 页面验收、业务语义与回退

三方通过后再让用户硬刷新页面。比对服务器 dist/index.html 与公网 HTML 引用的 JS/CSS 文件名/哈希，并核实资源请求成功；页面版本、故障、审批卡片应与 API 对应。涉及本次变更的审批同步、返回、发布流程再作针对性验证，不为验收擅自写生产数据。

版本 V4 是排产计划版本，不是软件版本；生成 AI 评估或批准评估不自动增加计划版本。`kind=assessment` 且 `outcome=no_feasible_candidate` 的已批准结果只有结论，没有可发布候选，不应据此要求“发布计划”按钮。历史故障存在于数据库/分析证据不等于缓存错误，不能一律删除。

失败时先保存日志及差异，按本次备份恢复兼容的代码和前端。只有确有数据损坏/迁移问题且用户授权时才恢复数据库，并先备份故障现场；恢复数据库可能丢失部署后写入，不能默认与代码一起回滚。恢复后仍须重复三方核验。

最终简短汇报：部署标识、数据库实际路径、三方核验结果、页面核验结果、备份位置、失败或未验证项。没有服务器访问能力时给命令等输出，不能宣布公网部署成功。
