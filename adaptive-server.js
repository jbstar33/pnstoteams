// adaptive-server.js
// 웹에서 JSON 메시지를 받아 Adaptive 메시지로 변환 후, 설정된 URL로 전송하고, 로그를 1주일간 보관하는 Node.js 서버

const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execSync } = require('child_process');

const CONFIG_PATH = path.join(__dirname, 'adaptive-config.json');
const LOG_PATH = path.join(__dirname, 'adaptive-log.jsonl');
const ADAPTIVE_SCRIPT = path.join(__dirname, 'json-to-adaptive.js');

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function appendLog(entry) {
  fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n');
}

function pruneOldLogs() {
  if (!fs.existsSync(LOG_PATH)) return;
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const lines = fs.readFileSync(LOG_PATH, 'utf8').split('\n').filter(Boolean);
  const filtered = lines.filter(line => {
    try {
      const obj = JSON.parse(line);
      return obj.timestamp >= oneWeekAgo;
    } catch {
      return false;
    }
  });
  fs.writeFileSync(LOG_PATH, filtered.join('\n') + (filtered.length ? '\n' : ''));
}

function convertToAdaptive(jsonObj) {
  // json-to-adaptive.js를 --stdin 옵션으로 실행하여 변환
  const input = JSON.stringify(jsonObj);
  const result = execSync(`node ${ADAPTIVE_SCRIPT} --stdin`, { input });
  return JSON.parse(result.toString());
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// index.html 라우터
app.get(['/', '/index.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 로그 파일 새창에서 보기
app.get('/logs-view', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  fs.createReadStream(LOG_PATH).pipe(res);
});


// QA용 메시지 수신 및 변환/전송
app.post('/qa', async (req, res) => {
  const receivedAt = Date.now();
  const message = req.body;
  let adaptiveMsg, sendResult = null, error = null;
  try {
    adaptiveMsg = convertToAdaptive(message);
    const { targetUrlQA } = loadConfig();
    console.log('Current targetUrlQA:', targetUrlQA);
    const response = await axios.post(targetUrlQA, adaptiveMsg, { headers: { 'Content-Type': 'application/json' } });
    sendResult = { status: response.status, statusText: response.statusText };
  } catch (err) {
    error = err.message || String(err);
  }
  appendLog({
    timestamp: receivedAt,
    received: message,
    adaptive: adaptiveMsg,
    sendResult,
    error
  });
  pruneOldLogs();
  if (error) {
    res.status(500).json({ error });
  } else {
    res.json({ ok: true, sendResult });
  }
});

// PROD용 메시지 수신 및 변환/전송
app.post('/prod', async (req, res) => {
  const receivedAt = Date.now();
  const message = req.body;
  let adaptiveMsg, sendResult = null, error = null;
  try {
    adaptiveMsg = convertToAdaptive(message);
    const { targetUrlPROD } = loadConfig();
    console.log('Current targetUrlPROD:', targetUrlPROD);
    const response = await axios.post(targetUrlPROD, adaptiveMsg, { headers: { 'Content-Type': 'application/json' } });
    sendResult = { status: response.status, statusText: response.statusText };
  } catch (err) {
    error = err.message || String(err);
  }
  appendLog({
    timestamp: receivedAt,
    received: message,
    adaptive: adaptiveMsg,
    sendResult,
    error
  });
  pruneOldLogs();
  if (error) {
    res.status(500).json({ error });
  } else {
    res.json({ ok: true, sendResult });
  }
});

// 설정 URL 변경
app.post('/set-url', (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ targetUrl: url }, null, 2));
  res.json({ ok: true, url });
});

// 최근 로그 조회
app.get('/logs', (req, res) => {
  if (!fs.existsSync(LOG_PATH)) return res.json([]);
  const lines = fs.readFileSync(LOG_PATH, 'utf8').split('\n').filter(Boolean);
  const logs = lines.map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  res.json(logs);
});

const PORT = process.env.PORT || 5001;
// 서버 시작 시 최신 config를 읽어 targetUrl을 출력
app.listen(PORT, () => {
  const { targetUrl } = loadConfig();
  console.log(`PNS relay server listening on port ${PORT}`);
  //console.log('Current targetUrl:', targetUrl);
});
