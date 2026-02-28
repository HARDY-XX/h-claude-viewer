const fs = require('fs');

const filePath = "C:/Users/38869/.claude/projects/C--Users-38869--claude-projects-h-claude-viewer/cd4044a6-2fcc-422e-966a-c122bf936ec2.jsonl";

const content = fs.readFileSync(filePath, 'utf-8');
const lines = content.split('\n').filter(l => l.trim());

let firstTime = null;
let lastTime = null;
let totalInput = 0;
let totalOutput = 0;
let totalCacheCreate = 0;
let totalCacheRead = 0;
let totalTokens = 0;
let messageCount = 0;

let tokenRecords = [];

for (const line of lines) {
  try {
    const rec = JSON.parse(line);
    if (rec.type === 'assistant' && rec.message && rec.message.usage) {
      const usage = rec.message.usage;
      const input = usage.input_tokens || 0;
      const output = usage.output_tokens || 0;
      const cacheCreate = usage.cache_creation_input_tokens || 0;
      const cacheRead = usage.cache_read_input_tokens || 0;

      const totalMsgTokens = input + output + cacheCreate + cacheRead;
      const activeTokens = input + output;

      if (totalMsgTokens > 0) {
        messageCount++;

        if (!firstTime) {
          firstTime = rec.timestamp;
          console.log(`[DEBUG] First token message: ${rec.timestamp}`);
        }

        lastTime = rec.timestamp;

        totalInput += input;
        totalOutput += output;
        totalCacheCreate += cacheCreate;
        totalCacheRead += cacheRead;
        totalTokens += totalMsgTokens;

        if (activeTokens > 0) {
          tokenRecords.push({
            timestamp: rec.timestamp,
            input,
            output,
            cacheCreate,
            cacheRead,
            totalMsgTokens,
            activeTokens
          });
        }
      }
    }
  } catch (e) {}
}

console.log('='.repeat(80));
console.log('Token Statistics:');
console.log(`Total messages with tokens: ${messageCount}`);
console.log(`First timestamp: ${firstTime}`);
console.log(`Last timestamp: ${lastTime}`);

if (firstTime && lastTime) {
  const startTime = new Date(firstTime).getTime();
  const endTime = new Date(lastTime).getTime();
  const durationMs = endTime - startTime;
  const durationSec = durationMs / 1000;

  console.log(`\nTotal Duration: ${durationMs}ms (${durationSec.toFixed(2)}s)`);
  console.log(`Total Input Tokens: ${totalInput}`);
  console.log(`Total Output Tokens: ${totalOutput}`);
  console.log(`Total Cache Creation: ${totalCacheCreate}`);
  console.log(`Total Cache Read: ${totalCacheRead}`);
  console.log(`Total Tokens (all): ${totalTokens}`);
  console.log(`Total Tokens (active): ${totalInput + totalOutput}`);

  console.log(`\nThroughput (all tokens): ${(totalTokens / durationSec).toFixed(2)} token/s`);
  console.log(`Throughput (active tokens): ${((totalInput + totalOutput) / durationSec).toFixed(2)} token/s`);
}

console.log('\n' + '='.repeat(80));
console.log('Detailed token records:');
console.log('='.repeat(80));

let prevTime = null;
for (const rec of tokenRecords) {
  const currTime = new Date(rec.timestamp).getTime();

  if (prevTime) {
    const timeDiffMs = currTime - prevTime;
    const timeDiffSec = timeDiffMs / 1000;
    const activeThroughput = timeDiffSec > 0 ? rec.activeTokens / timeDiffSec : 0;

    console.log(`Time diff: ${timeDiffMs}ms (${timeDiffSec.toFixed(3)}s)`);
    console.log(`  Active tokens: ${rec.activeTokens}, Throughput: ${activeThroughput.toFixed(2)} token/s`);
  }

  console.log(`  ${rec.timestamp}`);
  console.log(`    Input: ${rec.input}, Output: ${rec.output}, Active: ${rec.activeTokens}`);
  console.log(`    CacheC: ${rec.cacheCreate}, CacheR: ${rec.cacheRead}, Total: ${rec.totalMsgTokens}`);

  prevTime = currTime;
}

console.log('\n' + '='.repeat(80));
