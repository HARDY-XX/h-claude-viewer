const fs = require('fs');
const path = require('path');

const filePath = "C:/Users/38869/.claude/projects/C--Users-38869--claude-projects/e837ac70-dcd6-41ec-bde9-f70292b827b6.jsonl";

const content = fs.readFileSync(filePath, 'utf-8');
const lines = content.split('\n').filter(l => l.trim());

let firstTime = null;
let lastTime = null;
let totalInput = 0;
let totalOutput = 0;
let totalCacheCreate = 0;
let totalCacheRead = 0;
let messageCount = 0;

console.log('Assistant messages with token usage:');
console.log('='.repeat(80));

for (const line of lines) {
  try {
    const rec = JSON.parse(line);
    if (rec.type === 'assistant' && rec.message && rec.message.usage) {
      const usage = rec.message.usage;
      const input = usage.input_tokens || 0;
      const output = usage.output_tokens || 0;
      const cacheCreate = usage.cache_creation_input_tokens || 0;
      const cacheRead = usage.cache_read_input_tokens || 0;

      if (input + output + cacheCreate + cacheRead > 0) {
        messageCount++;

        if (!firstTime) {
          firstTime = rec.timestamp;
          console.log(`First token message: ${rec.timestamp}`);
        }

        lastTime = rec.timestamp;

        totalInput += input;
        totalOutput += output;
        totalCacheCreate += cacheCreate;
        totalCacheRead += cacheRead;

        const totalTime = input + output + cacheCreate + cacheRead;
        console.log(`Message ${messageCount}: ${rec.timestamp} - Input: ${input}, Output: ${output}, CacheCreate: ${cacheCreate}, CacheRead: ${cacheRead}, Total: ${totalTime}`);
      }
    }
  } catch (e) {}
}

console.log('='.repeat(80));
console.log(`\nSummary:`);
console.log(`Total messages with tokens: ${messageCount}`);
console.log(`First timestamp: ${firstTime}`);
console.log(`Last timestamp: ${lastTime}`);

if (firstTime && lastTime) {
  const startTime = new Date(firstTime).getTime();
  const endTime = new Date(lastTime).getTime();
  const durationMs = endTime - startTime;
  const durationSec = durationMs / 1000;

  const totalTokens = totalInput + totalOutput + totalCacheCreate + totalCacheRead;

  console.log(`Time difference: ${durationMs}ms (${durationSec}s)`);
  console.log(`Total Input Tokens: ${totalInput}`);
  console.log(`Total Output Tokens: ${totalOutput}`);
  console.log(`Total Cache Creation: ${totalCacheCreate}`);
  console.log(`Total Cache Read: ${totalCacheRead}`);
  console.log(`Total Tokens: ${totalTokens}`);
  console.log(`Throughput: ${durationSec > 0 ? totalTokens / durationSec : 0} token/s`);
} else {
  console.log('No token data found');
}
