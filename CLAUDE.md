# st-SingleLeadingSystem

普通 SillyTavern 前端扩展，原生 ES modules，无构建链。简体中文沟通。

- 当前设计事实来源为本地 `.docs/开发计划-SSOT.md` 与 `.docs/设计决策.md`，`.docs/` 必须保持 Git 忽略。
- 不修改 NyaaChat 或 `.ref` 下的参考项目，不启动真实酒馆或连接模型；真实联调由用户负责。
- 只处理已选择规则的 custom/openai/openrouter 主对话请求。不包装 fetch、不接管工具执行、思考或截断恢复。
- 发送时完整校验后才提交消息与本次后处理设置，失败保留原请求。动态界面使用文本节点，诊断不记录提示词、完整地址、工具参数或凭据。
- 保留用户 README 编辑，不用旧副本覆盖。
- `npm ci` 安装开发验证依赖；`npm run check` 执行语法与 Node 回归。正式扩展安装不需要 npm。
- 每阶段验证、更新本地交接、精确暂存、敏感信息扫描、Conventional Commit，并使用 `$GITHUB_PAT` 临时鉴权推送 `main`；禁止凭据持久化到 remote，禁止强推。
- 无项目 commit-push skill 时按上述流程执行，不挪用其他项目的提交脚本。
