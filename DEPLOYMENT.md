# 部署与开发指南

## 本地开发

### 方法1：使用本地 data.js（推荐用于开发）

1. 保留本地 `js/data.js` 文件（不要提交到 Git）
2. 直接运行本地服务器即可：
   ```bash
   python -m http.server 3000
   ```

### 方法2：使用环境变量

1. 设置环境变量 `STUDENTS_DATA`，值为 JSON 格式的学生数据
2. 运行构建脚本：
   ```bash
   npm run build
   ```
3. 启动本地服务器

---

## Cloudflare Pages 部署配置

### 步骤1：准备环境变量值

将 `js/data.js` 中的学生数组提取为纯 JSON（去掉 `let students=` 部分），例如：
```json
[
    {
        "name": "程语晗",
        "school": "北京电子科技学院",
        "city": "丰台区",
        "province": "北京"
    }
]
```

### 步骤2：在 Cloudflare Pages 中配置环境变量

1. 登录 Cloudflare Dashboard
2. 进入你的 Pages 项目
3. 点击 **Settings** → **Environment variables**
4. 添加环境变量：
   - **Name**: `STUDENTS_DATA`
   - **Value**: 粘贴上面的 JSON 数据
   - 勾选 **Encrypt**（加密存储）
5. 点击 **Save**

### 步骤3：配置构建命令

在 Cloudflare Pages 的 **Settings** → **Builds & deployments** 中：
- **Build command**: `npm run build`
- **Build output directory**: 留空（或设置为 `.`）

### 步骤4：重新部署

触发一次新的部署即可。

---

## Git 历史清理（可选）

如果 `data.js` 已经在 Git 历史中，建议清理：

1. 备份仓库
2. 使用 `git filter-repo` 或 `BFG Repo-Cleaner` 移除敏感文件
3. 强制推送到远程仓库

**注意**：此操作会重写 Git 历史，协作开发者需要重新克隆仓库。
