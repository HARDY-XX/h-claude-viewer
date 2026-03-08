const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 13001;
const PROJECTS_DIR = path.join(__dirname, '..');

app.use(express.static(path.join(__dirname, 'public')));

// 将文件夹名转为可读路径
function decodeFolderName(name) {
  return name.replace(/^([A-Z])--(.*)/,(_, drive, rest) =>
    drive + ':/' + rest.replace(/-/g, '/')
  );
}

// 安全解析 JSON 行
function parseJsonlLine(line) {
  try { return JSON.parse(line); } catch { return null; }
}

// 读取 JSONL 文件所有记录
function readJsonlFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return content.split('\n').map(parseJsonlLine).filter(Boolean);
}

function getTimestampMs(timestamp) {
  if (!timestamp) return null;
  const ms = new Date(timestamp).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// 获取文件夹内所有 .jsonl 文件
function getSessionFiles(projectDir) {
  try {
    return fs.readdirSync(projectDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ name: f.replace('.jsonl', ''), path: path.join(projectDir, f) }));
  } catch { return []; }
}

// 快速获取 JSONL 文件的最新时间戳（读最后几行）
function getLatestTimestamp(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const rec = parseJsonlLine(lines[i]);
      if (rec && rec.timestamp) return rec.timestamp;
    }
  } catch {}
  return null;
}

// GET /api/projects
app.get('/api/projects', (req, res) => {
  try {
    const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== 'viewer' && d.name !== 'memory');

    const projects = entries.map(d => {
      const projectDir = path.join(PROJECTS_DIR, d.name);
      const sessions = getSessionFiles(projectDir);
      let latestTimestamp = null;

      for (const s of sessions) {
        const ts = getLatestTimestamp(s.path);
        if (ts && (!latestTimestamp || ts > latestTimestamp)) latestTimestamp = ts;
      }

      return {
        id: d.name,
        displayName: decodeFolderName(d.name),
        sessionCount: sessions.length,
        latestTimestamp
      };
    }).filter(p => p.sessionCount > 0);

    projects.sort((a, b) => (b.latestTimestamp || '').localeCompare(a.latestTimestamp || ''));
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:projectId/sessions
app.get('/api/projects/:projectId/sessions', (req, res) => {
  try {
    const projectDir = path.join(PROJECTS_DIR, req.params.projectId);
    if (!fs.existsSync(projectDir)) return res.status(404).json({ error: 'Project not found' });

    const sessions = getSessionFiles(projectDir).map(s => {
      const records = readJsonlFile(s.path);
      let firstTimestamp = null, latestTimestamp = null, preview = '';
      let messageCount = 0;

      for (const rec of records) {
        if (rec.timestamp) {
          if (!firstTimestamp) firstTimestamp = rec.timestamp;
          latestTimestamp = rec.timestamp;
        }
        if (rec.type === 'user' || rec.type === 'assistant') messageCount++;
        if (!preview && rec.type === 'user' && rec.message) {
          const content = rec.message.content;
          if (typeof content === 'string') {
            preview = content.slice(0, 120);
          } else if (Array.isArray(content)) {
            const textBlock = content.find(b => typeof b === 'string' || b.type === 'text');
            if (textBlock) preview = (typeof textBlock === 'string' ? textBlock : textBlock.text || '').slice(0, 120);
          }
        }
      }

      return {
        id: s.name,
        firstTimestamp,
        latestTimestamp,
        messageCount,
        preview
      };
    });

    sessions.sort((a, b) => (b.latestTimestamp || '').localeCompare(a.latestTimestamp || ''));
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sessions/:projectId/:sessionId
app.get('/api/sessions/:projectId/:sessionId', (req, res) => {
  try {
    const filePath = path.join(PROJECTS_DIR, req.params.projectId, req.params.sessionId + '.jsonl');
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Session not found' });

    const records = readJsonlFile(filePath);
    const stats = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      userTurns: 0,
      assistantTurns: 0,
      messageCount: 0,
      models: new Set(),
      firstTimestamp: null,
      latestTimestamp: null,
      sessionId: req.params.sessionId
    };

    const messages = [];
    const userMessagesMap = new Map();
    const rawRecordsByUuid = new Map();
    const assistantEntries = [];
    const MAX_FALLBACK_RESPONSE_TIME_MS = 60 * 60 * 1000;

    for (const rec of records) {
      if (rec.uuid) rawRecordsByUuid.set(rec.uuid, rec);

      if (rec.timestamp) {
        if (!stats.firstTimestamp) stats.firstTimestamp = rec.timestamp;
        stats.latestTimestamp = rec.timestamp;
      }

      if (rec.type === 'user' && rec.message) {
        stats.userTurns++;
        stats.messageCount++;
        const userMsg = {
          type: 'user',
          uuid: rec.uuid,
          parentUuid: rec.parentUuid,
          timestamp: rec.timestamp,
          timestampMs: getTimestampMs(rec.timestamp),
          content: rec.message.content,
          cwd: rec.cwd,
          version: rec.version,
          gitBranch: rec.gitBranch,
          permissionMode: rec.permissionMode,
          isSidechain: rec.isSidechain,
          toolUseResult: rec.toolUseResult
        };
        userMessagesMap.set(rec.uuid, userMsg);
        messages.push(userMsg);
      } else if (rec.type === 'assistant' && rec.message) {
        stats.assistantTurns++;
        stats.messageCount++;
        const usage = rec.message.usage || {};
        stats.totalInputTokens += usage.input_tokens || 0;
        stats.totalOutputTokens += usage.output_tokens || 0;
        stats.totalCacheCreationTokens += usage.cache_creation_input_tokens || 0;
        stats.totalCacheReadTokens += usage.cache_read_input_tokens || 0;
        if (rec.message.model) stats.models.add(rec.message.model);

        const assistantMsg = {
          type: 'assistant',
          uuid: rec.uuid,
          parentUuid: rec.parentUuid,
          timestamp: rec.timestamp,
          timestampMs: getTimestampMs(rec.timestamp),
          content: rec.message.content,
          model: rec.message.model,
          stopReason: rec.message.stop_reason,
          isSidechain: rec.isSidechain,
          usage: {
            inputTokens: usage.input_tokens || 0,
            outputTokens: usage.output_tokens || 0,
            cacheCreationTokens: usage.cache_creation_input_tokens || 0,
            cacheReadTokens: usage.cache_read_input_tokens || 0,
            cacheCreation: usage.cache_creation || null
          }
        };
        messages.push(assistantMsg);
        assistantEntries.push({ msg: assistantMsg, index: messages.length - 1 });
      } else if (rec.type === 'system') {
        messages.push({
          type: 'system',
          subtype: rec.subtype,
          content: rec.content,
          timestamp: rec.timestamp,
          level: rec.level
        });
      }
    }

    function getAncestorUserMessage(parentUuid) {
      const visited = new Set();
      let currentUuid = parentUuid;
      let depth = 0;

      while (currentUuid && depth < 50 && !visited.has(currentUuid)) {
        visited.add(currentUuid);
        const rawRec = rawRecordsByUuid.get(currentUuid);
        if (!rawRec) return null;
        if (rawRec.type === 'user') {
          return userMessagesMap.get(rawRec.uuid) || null;
        }
        currentUuid = rawRec.parentUuid;
        depth++;
      }

      return null;
    }

    function getPreviousUserFallback(startIndex, assistantMsg) {
      if (!Number.isFinite(assistantMsg.timestampMs)) return null;

      for (let i = startIndex - 1; i >= 0; i--) {
        const candidate = messages[i];
        if (candidate.type !== 'user') continue;
        if (!Number.isFinite(candidate.timestampMs)) continue;

        const responseTimeMs = assistantMsg.timestampMs - candidate.timestampMs;
        if (responseTimeMs < 0) continue;
        if (responseTimeMs > MAX_FALLBACK_RESPONSE_TIME_MS) return null;

        return candidate;
      }

      return null;
    }

    stats.models = [...stats.models];

    // 计算会话总耗时（毫秒转秒和分钟）
    if (stats.firstTimestamp && stats.latestTimestamp) {
      const startTime = getTimestampMs(stats.firstTimestamp);
      const endTime = getTimestampMs(stats.latestTimestamp);
      stats.totalDurationMs = Number.isFinite(startTime) && Number.isFinite(endTime) ? endTime - startTime : 0;
      stats.totalDurationSec = stats.totalDurationMs > 0 ? stats.totalDurationMs / 1000 : 0.1;
      stats.totalDurationMin = stats.totalDurationSec / 60;
    } else {
      stats.totalDurationMs = 0;
      stats.totalDurationSec = 0;
      stats.totalDurationMin = 0;
    }

    // 计算总Token数
    stats.totalTokens = stats.totalInputTokens + stats.totalOutputTokens +
                       stats.totalCacheCreationTokens + stats.totalCacheReadTokens;

    // 计算单消息耗时
    let totalResponseTimeMs = 0;
    for (const { msg, index } of assistantEntries) {
      let userMsg = null;
      let responseTimeSource = null;

      if (msg.parentUuid) {
        userMsg = userMessagesMap.get(msg.parentUuid) || null;
        if (userMsg) {
          responseTimeSource = 'direct_user_parent';
        }
      }

      if (!userMsg && msg.parentUuid) {
        userMsg = getAncestorUserMessage(msg.parentUuid);
        if (userMsg) {
          responseTimeSource = 'ancestor_user_chain';
        }
      }

      if (!userMsg) {
        userMsg = getPreviousUserFallback(index, msg);
        if (userMsg) {
          responseTimeSource = 'previous_user_fallback';
        }
      }

      if (!userMsg || !Number.isFinite(msg.timestampMs) || !Number.isFinite(userMsg.timestampMs)) {
        continue;
      }

      const responseTimeMs = msg.timestampMs - userMsg.timestampMs;
      if (responseTimeMs < 0) {
        continue;
      }
      if (responseTimeSource === 'previous_user_fallback' && responseTimeMs > MAX_FALLBACK_RESPONSE_TIME_MS) {
        continue;
      }

      msg.responseTimeMs = responseTimeMs;
      msg.responseTimeSec = responseTimeMs / 1000;
      msg.responseTimeSource = responseTimeSource;

      if (responseTimeMs > 0 && responseTimeSource !== 'previous_user_fallback') {
        totalResponseTimeMs += responseTimeMs;
      }
    }

    // 计算吞吐量：Output Tokens ÷ 总响应耗时（秒）
    // 只计算服务器返回的 token（Output Tokens），不计算输入的 token
    const totalResponseTimeSec = totalResponseTimeMs > 0 ? totalResponseTimeMs / 1000 : 0;
    stats.throughput = (totalResponseTimeSec > 0 && stats.totalOutputTokens > 0)
      ? stats.totalOutputTokens / totalResponseTimeSec
      : 0;

    res.json({ messages, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Claude Code Viewer running at http://localhost:${PORT}`);
});
