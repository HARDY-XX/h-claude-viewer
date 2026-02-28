# Claude Code Viewer 优化说明

## 本次优化内容

### 1. 右侧详细页面增加 Session ID 显示

**修改位置**:
- 前端: `public/index.html` - `renderStats` 函数
- 后端: `server.js` - Session 统计接口

**实现细节**:
- 在统计栏中新增 Session ID 显示项
- Session ID 过长时自动截断显示（前8位 + ... + 后8位）
- 完整 Session ID 可通过鼠标悬停查看

### 2. 增加吞吐量计算

**统计逻辑**:
```
Token 吞吐量 = 总 Token 数 / 时间差（秒）

总 Token 数 = Input Tokens + Output Tokens + Cache Creation + Cache Read
时间差 = 最后一条消息时间 - 第一条消息时间（毫秒 → 秒）
最小时间差设为 0.1 秒，避免除零错误
```

**修改位置**:
- 后端: `server.js` - 在 Session 统计中增加吞吐量计算
- 前端: `public/index.html` - `renderStats` 函数中显示吞吐量

**显示格式**: `xxx token/s`（支持千分位分隔符）

### 3. 增加对话耗时统计

#### 3.1 单会话时间范围

**统计逻辑**:
- 开始时间: 同 sessionId 下所有日志的 timestamp 最小值
- 结束时间: 同 sessionId 下所有日志的 timestamp 最大值
- 总耗时: 结束时间 - 开始时间（毫秒 → 秒 / 分钟）

**实现细节**:
- 已在后端 `server.js` 中计算 `firstTimestamp` 和 `latestTimestamp`
- 计算 `totalDurationSec`（秒）和 `totalDurationMin`（分钟）
- 前端根据时长自动显示格式：
  - < 60 秒: 显示 "X 秒"
  - ≥ 60 秒: 显示 "X 分钟"

#### 3.2 单消息耗时（响应时间）

**统计逻辑**:
- 助手消息（role: assistant）与对应用户消息（role: user）的时间差
- 通过 `parentUuid` 字段关联用户消息和助手回复
- 单位: 毫秒 → 秒（保留2位小数）

**实现细节**:
- 后端: 创建 `userMessagesMap` 映射，存储用户消息的 uuid 和时间戳
- 遍历所有消息，当遇到 assistant 消息且有 `parentUuid` 时，计算响应时间
- 前端: 在助手消息的 header 中显示响应时间，颜色为橙色

#### 3.3 总耗时显示

在统计栏中新增"耗时"项，显示整个会话的总持续时间。

## 4. 吞吐量计算优化（重要）

### 问题分析

在测试中发现吞吐量计算异常高（1500+ token/s），原因是：

1. **缓存 Token 影响**: Cache Creation (665,899) 和 Cache Read (1,911,499) 的数值非常大
2. **总 Token 膨胀**: 总 Token 数达到 2,635,577，导致吞吐量失真
3. **时间窗口不当**: 使用了所有消息的时间戳，包括没有 token 的消息

### 解决方案

**核心策略**: 吞吐量只计算 Input + Output Tokens，排除缓存相关

```javascript
// 总 Token 数（用于统计）
stats.totalTokens = Input + Output + Cache Creation + Cache Read;

// 有效 Token（用于吞吐量计算）
const activeTokens = stats.totalInputTokens + stats.totalOutputTokens;

// 吞吐量 = activeTokens / 时间差
```

**时间窗口优化**:
- 只计算有 Input/Output Token 的 assistant 消息的时间范围
- 排除没有实际 token 消耗的消息（如 thinking、tool calls 等）
- 设置最小时间差为 100 毫秒，避免除零或极小值

**最终计算公式**:
```
吞吐量 = (Input Tokens + Output Tokens) / 有效时间差(秒)
```

### 优化效果

- ✅ 排除缓存 Token 的干扰
- ✅ 只计算实际生成的 token
- ✅ 时间窗口基于实际有 token 的消息
- ✅ 避免异常高的吞吐量值（如 1500+ token/s）
- ✅ 更真实地反映实际的 token 生成速度

## 代码变更总结

### 后端变更 (server.js)

1. **Session 统计接口** (`/api/sessions/:projectId/:sessionId`):
   - 添加 `sessionId` 到 stats
   - 创建 `userMessagesMap` 用于关联用户消息
   - 为用户消息添加 `timestampMs`（毫秒级时间戳）
   - 为助手消息添加 `timestampMs` 和 `parentUuid`
   - 计算会话总耗时 (`totalDurationSec`, `totalDurationMin`)
   - 计算总 Token 数和吞吐量 (`totalTokens`, `throughput`)
   - 为助手消息计算响应时间 (`responseTimeMs`, `responseTimeSec`)

### 前端变更 (public/index.html)

1. **CSS 样式**:
   - 新增 `.stat-item.throughput` 和 `.stat-item.duration` 样式
   - 新增 `.msg-response-time` 样式（橙色响应时间显示）

2. **JavaScript 功能**:
   - `renderStats`: 增加 Session ID、Throughput、Duration 显示
   - `fmtSessionId`: 格式化 Session ID 显示
   - `fmtDuration`: 格式化时长显示
   - `renderMessage`: 助手消息中显示响应时间
   - `renderContent`: 保持原有功能

## 使用说明

### 查看统计信息

1. 启动服务: `npm start` 或 `node server.js`
2. 访问 http://localhost:3000
3. 选择项目 → 选择对话
4. 右侧统计栏将显示:
   - Input/Output Tokens
   - Cache Creation/Read
   - 消息数、User/Assistant 轮次
   - 使用的模型
   - **Session ID**（新增）
   - **Throughput**（新增）: token/s
   - **耗时**（新增）: 整个会话的持续时间

### 查看单条消息响应时间

在消息列表中，每条助手回复的消息头部会显示:
- 响应时间（从用户消息到助手回复的耗时）
- 格式: "X.XX 秒"
- 颜色: 橙色

## 注意事项

1. **时间差最小值**: 为避免除零错误，时间差最小设为 0.1 秒
2. **Session ID 截断**: 过长的 Session ID 会自动截断显示，完整 ID 可悬停查看
3. **响应时间关联**: 依赖 `parentUuid` 字段，如果数据中没有此字段，则不会计算响应时间
4. **性能考虑**: 吞吐量和耗时计算在后端完成，不会影响前端性能

## 测试建议

1. 测试单条消息的会话（应显示最小时间 0.1 秒）
2. 测试多轮对话的响应时间计算
3. 验证 Session ID 截断显示是否正确
4. 检查吞吐量计算是否准确
5. 验证长时间对话的分钟显示格式
