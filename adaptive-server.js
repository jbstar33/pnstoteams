// adaptive-server.js
// 웹에서 JSON 메시지를 받아 Adaptive 메시지로 변환 후, 설정된 URL로 전송하고, 로그를 1주일간 보관하는 Node.js 서버

const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execSync } = require('child_process');


require('dotenv').config();
const LOG_PATH = path.join(__dirname, 'adaptive-log.jsonl');
const ADAPTIVE_SCRIPT = path.join(__dirname, 'json-to-adaptive.js');


// 환경변수에서 값 읽기
function loadConfig() {
  return {
    targetUrlQA: process.env.TARGET_URL_QA,
    targetUrlPROD: process.env.TARGET_URL_PROD,
    // 필요시 추가 환경변수
  };
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

// .env 파일을 직접 수정하는 API는 제공하지 않음 (보안상)
// 필요시 별도 관리 도구 구현 권장

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
// 서버 시작 시 환경변수에서 targetUrl을 출력
app.listen(PORT, () => {
  const { targetUrlQA, targetUrlPROD } = loadConfig();
  console.log(`PNS relay server listening on port ${PORT}`);
  console.log('Current targetUrlQA:', targetUrlQA);
  console.log('Current targetUrlPROD:', targetUrlPROD);
});
