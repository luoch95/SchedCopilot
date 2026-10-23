# SchedCopilot 项目部署与日常更新手册

本文记录 SchedCopilot 在阿里云 Ubuntu 服务器上的部署方式，以及以后发布代码时的标准操作流程。

## 一、首次部署流程

### 1. 服务器环境

- 操作系统：Ubuntu 22.04
- Python：Python 3.11
- 后端目录：`/opt/schedcopilot/backend`
- 前端静态文件目录：`/opt/schedcopilot/frontend/dist`
- Python 虚拟环境：`/opt/schedcopilot/backend/.venv`
- 后端 systemd 服务：`schedcopilot`
- Web 服务器：Nginx
- 后端监听：`127.0.0.1:8000`
- 对外访问：Nginx 的 80 端口

### 2. 开启 Swap

以下示例创建 2 GB Swap：

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
free -h
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 3. 拉取代码并安装后端依赖

将仓库地址和分支替换为实际值：

```bash
sudo mkdir -p /opt/schedcopilot
cd /opt/schedcopilot
sudo git clone <仓库地址> backend
cd /opt/schedcopilot/backend

python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
cp .env.example .env
sudo nano /opt/schedcopilot/backend/.env
```

### 4. 配置 systemd

```bash
sudo tee /etc/systemd/system/schedcopilot.service > /dev/null <<'EOF'
[Unit]
Description=SchedCopilot FastAPI Backend
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/schedcopilot/backend
EnvironmentFile=/opt/schedcopilot/backend/.env
Environment="PYTHONPATH=/opt/schedcopilot/backend/src"
ExecStart=/opt/schedcopilot/backend/.venv/bin/uvicorn sched_copilot.api:create_app --factory --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now schedcopilot
sudo systemctl status schedcopilot --no-pager
```

`create_app` 是 FastAPI 应用工厂，因此必须使用 `--factory`。

### 5. 构建并部署前端

本地 PowerShell：

```powershell
cd D:\Study\SchedCopilot\frontend
npm install
```

创建或修改 `frontend\.env.production`：

```ini
VITE_API_BASE_URL=/api
```

打包：

```powershell
npm run build
```

服务器创建目录：

```bash
sudo mkdir -p /opt/schedcopilot/frontend/dist
```

本地 PowerShell 上传：

```powershell
scp -r D:\Study\SchedCopilot\frontend\dist\* root@8.163.246.177:/opt/schedcopilot/frontend/dist/
```

### 6. 配置 Nginx

```bash
sudo tee /etc/nginx/sites-available/schedcopilot > /dev/null <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name 8.163.246.177;

    root /opt/schedcopilot/frontend/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/schedcopilot /etc/nginx/sites-enabled/schedcopilot
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl reload nginx
```

确保阿里云安全组/防火墙放行 TCP 80，SSH 使用的 22 端口保持放行。配置 HTTPS 后再放行 443。

## 二、日常代码更新流程

### 1. 本地提交代码

```powershell
cd D:\Study\SchedCopilot
git status
git add .
git commit -m "描述本次修改"
git push origin <分支名>
```

### 2. 更新后端

SSH 登录服务器后：

```bash
cd /opt/schedcopilot/backend
git pull origin <分支名>
source .venv/bin/activate
pip install -r requirements.txt
sudo systemctl restart schedcopilot
sudo systemctl status schedcopilot --no-pager
```

### 3. 更新前端

本地 PowerShell：

```powershell
cd D:\Study\SchedCopilot\frontend
npm install
npm run build
```

服务器清理旧文件：

```bash
sudo rm -rf /opt/schedcopilot/frontend/dist/*
```

本地 PowerShell上传：

```powershell
scp -r D:\Study\SchedCopilot\frontend\dist\* root@8.163.246.177:/opt/schedcopilot/frontend/dist/
```

上传完成后服务器执行：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

如果同时修改前后端，先更新后端并确认服务正常，再上传前端并 reload Nginx。

### 4. 发布后检查

```bash
sudo systemctl is-active schedcopilot
sudo systemctl is-active nginx
curl -I http://127.0.0.1
curl -I http://127.0.0.1/api/
```

## 三、常用排查命令

### systemd 后端服务

```bash
sudo systemctl status schedcopilot --no-pager
sudo systemctl is-active schedcopilot
sudo systemctl restart schedcopilot
sudo systemctl stop schedcopilot
sudo systemctl start schedcopilot
sudo systemctl enable schedcopilot
sudo systemctl disable schedcopilot
```

后端日志：

```bash
sudo journalctl -u schedcopilot -n 100 --no-pager
sudo journalctl -u schedcopilot -f
sudo journalctl -u schedcopilot -b --no-pager
```

### Nginx

```bash
sudo systemctl status nginx --no-pager
sudo systemctl is-active nginx
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl restart nginx
sudo tail -n 100 /var/log/nginx/error.log
sudo tail -f /var/log/nginx/error.log
sudo tail -n 100 /var/log/nginx/access.log
```

### 网络与端口

```bash
ss -ltnp | grep -E ':80|:8000'
curl -I http://127.0.0.1
curl -I http://127.0.0.1:8000
sudo ufw status
```

### 常见故障定位顺序

1. 页面打不开：检查阿里云安全组、防火墙、Nginx 状态和 `nginx -t`。
2. 页面能打开但 API 失败：检查 `schedcopilot` 状态、后端日志和 `/api/` 转发配置。
3. 后端启动失败：检查 `.env`、依赖、`PYTHONPATH` 和 `ExecStart`。
4. 前端路由刷新 404：确认 Nginx 存在 `try_files $uri $uri/ /index.html;`。

