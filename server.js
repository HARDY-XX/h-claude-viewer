const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
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
      latestTimestamp: null
    };

    const messages = [];

    for (const rec of records) {
      if (rec.timestamp) {
        if (!stats.firstTimestamp) stats.firstTimestamp = rec.timestamp;
        stats.latestTimestamp = rec.timestamp;
      }

      if (rec.type === 'user' && rec.message) {
        stats.userTurns++;
        stats.messageCount++;
        messages.push({
          type: 'user',
          uuid: rec.uuid,
          timestamp: rec.timestamp,
          content: rec.message.content,
          cwd: rec.cwd,
          version: rec.version,
          gitBranch: rec.gitBranch,
          permissionMode: rec.permissionMode,
          isSidechain: rec.isSidechain,
          toolUseResult: rec.toolUseResult
        });
      } else if (rec.type === 'assistant' && rec.message) {
        stats.assistantTurns++;
        stats.messageCount++;
        const usage = rec.message.usage || {};
        stats.totalInputTokens += usage.input_tokens || 0;
        stats.totalOutputTokens += usage.output_tokens || 0;
        stats.totalCacheCreationTokens += usage.cache_creation_input_tokens || 0;
        stats.totalCacheReadTokens += usage.cache_read_input_tokens || 0;
        if (rec.message.model) stats.models.add(rec.message.model);

        messages.push({
          type: 'assistant',
          uuid: rec.uuid,
          timestamp: rec.timestamp,
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
        });
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

    stats.models = [...stats.models];
    res.json({ messages, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Claude Code Viewer running at http://localhost:${PORT}`);
});
