# 医邦教育 Render 免费部署说明

本项目可以部署到 Render Free Web Service，用作小范围公网演示。Render 免费服务适合客户试用和功能展示，但不适合长期保存大文件。

## 演示账号

- 学生端：demo-student@example.com / student123
- 教师端：demo-teacher@example.com / teacher123
- 管理员端：admin@example.com / admin123456

演示数据会在服务启动时自动补齐，包括示例课程、任务点、公告、讨论和学习进度。

## Render 部署步骤

1. 将项目推送到 GitHub 仓库。
2. 在 Render 选择 New -> Blueprint。
3. 选择 GitHub 仓库，Render 会读取项目里的 render.yaml。
4. 等待构建完成后，Render 会生成 https://xxxx.onrender.com 形式的网址。
5. 打开网址后使用演示账号登录验证。

## 免费版限制

- 免费服务可能休眠，首次访问通常需要等待几十秒。
- 当前演示版使用 /tmp 文件存储，服务重启后上传文件可能丢失。
- 10G 上传限制只适合本地或临时演示，正式上线建议接入 Cloudflare R2、S3 或其他对象存储。
