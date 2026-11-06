# AGENTS

## 项目范围

- 当前适配 OpenCode 2.2.5 的 TUI 插件接口, 不适用于 1.x 或桌面 GUI.
- 包仅导出 `./tui`, 指向预编译的 ESM `dist/tui.js`. 构建仅合并项目源码, 所有包依赖保留裸导入, 复用宿主的 Solid/OpenTUI 实例.
- OpenTUI 不编译 `node_modules` 中的 Solid TSX, OpenCode 安装插件时禁用生命周期脚本. 因此 `dist/tui.js` 必须纳入 Git 和发布包, 修改源码后执行 `bun run build:tui` 并同步更新产物.
- 构建脚本使用 `build:tui`, 不添加 `build`, `prepare` 或 `prepack`; 这些脚本名会使 Git 安装器额外安装构建依赖, 即使已禁用生命周期脚本.
- 插件读取会话状态, 不请求模型, 不修改消息, 不单独写入统计文件.
- README 仅简述功能. 对后续维护有价值的约定写在本文件, 不记录参考项目.

## 代码职责

| 文件 | 职责 |
| --- | --- |
| `src/tui.tsx` | 插件注册, 侧栏组合和主会话用量条. |
| `src/SubagentPanel.tsx` | 子代理列表, 详情及鼠标/键盘交互. |
| `src/UseSubagents.ts` | 宿主状态接入, 分页加载, 实时订阅, 重连和资源清理. |
| `src/SessionStats.ts` | 缓存命中率, 上下文用量和 token 汇总. |
| `src/SubagentStats.ts` | 子代理计时, 状态, 调用时间和后代关系计算. |
| `src/Format.ts` / `src/Color.ts` | 文本格式化和统一反馈色处理. |

纯计算与宿主接入分离. 当前规模保持单层目录, 优先复用现有模块, 不新增仅转发调用的包装层.

## 关键行为约定

修改相关功能时保留以下约定, 除非任务明确要求调整. 具体布局和显示格式以组件及 TUI 测试为准.

- `Hit` 取撤销边界之前最近一条有输入用量的 assistant 消息, 按 `cache.read / (input + cache.read + cache.write) × 100` 计算, 向下截取到一位小数. 输出与 reasoning 不参与分母, 无读数与命中率为零必须区分.
- `Ctx` 取最后一次已完成压缩之后, 撤销边界之前的 assistant 用量. 已用 token 包含 input, output, reasoning, cache read/write, 窗口上限来自对应模型的 `limit.context`. `Hit` 与 `Ctx` 的消息选择规则不同, 不直接合并.
- 子代理列表以当前主会话为根, 包含全部嵌套后代并按 ID 去重. 汇总使用子会话累计 token 和费用, 不计入主会话. 切入子会话后仍显示同一组.
- 排序使用最近创建或调用时间, 包括运行期间收到的新输入和排队调用. 已观测或仍在队列中的调用使用入队时间, 通过消息 ID 关联; 仅未观测到入队时间的历史调用使用消息交付时间, 晚交付与重连不能覆盖已知入队时间.
- 耗时累加实际执行区间, 排除轮次间的空闲时间. 优先使用实时执行事件和 `time.busy` / `time.idle`, 历史消息估算加 `~`. 缺少可用边界显示 `--`, 不用创建时间, 更新时间或补查时的当前时间推算已结束区间.
- 历史 shutdown 缺少 idle 消息时, 只有存在下一次真实起点和上一段最后完成的 assistant 时间, 才用后者估算旧终点. 同一执行区间中的追加消息不重复计时.
- 子会话和历史消息必须读取全部分页. 实时更新使用 `context.data.on`, 不依赖事件 payload 持久化. 重连补载与已观测边界合并去重; 卸载时清理订阅, 计时器和未完成请求, 切换会话时取消不再需要的请求.
- `subagents.timing` 与 `subagents.view` 使用宿主运行期内存, 跨会话切换和插件热重载保留, 重启后不保留. 修改数据结构时兼容已有内存, 包括缺少 `calls` 的旧计时记录.
- 保留鼠标操作的键盘等价操作, `Esc` 恢复进入面板前的输入焦点. 子代理列表始终展开, 各条目详情默认折叠.

## 开发与验证

在仓库根目录执行. 统计测试和类型检查使用 Node.js 24+, TUI 测试已用 Bun 1.4.3 验证. OpenTUI 0.8.2 的 Node 运行时要求 Node.js 26.4+, 因此 TUI 测试使用 Bun.

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
bun run test:tui
```

按改动范围选择验证: 纯计算对应 `test/*.test.ts`; 宿主接入及界面对应 `test/Tui.test.mjs` 和 `test/SubagentTui.test.mjs`. `test:tui` 先构建发布入口, 再使用真实 OpenTUI renderer 测试; `Tui.test.mjs` 将发布文件复制到 `node_modules` 后验证加载与响应式更新, 会话和事件由夹具提供. 包入口或发布内容变化时, 先构建再执行 `npm pack --dry-run`. 仅文档变更检查内容和路径即可.

本地集成时, 将仓库链接到目标项目的 `.opencode/plugins/opencode-sidebar`, 重启 OpenCode 并展开 sidebar. 先检查已有同名目录, 不覆盖其内容.
