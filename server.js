const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// APIキー取得ルート
app.get('/api/config', (req, res) => {
  res.json({
    deepgramApiKey: process.env.DEEPGRAM_API_KEY || ''
  });
});

// questions.json を直接返すルート（元の状態）
app.get('/api/questions', (req, res) => {
  try {
    const questions = require('./questions.json');
    res.json(questions);
  } catch (e) {
    console.error("questions.json の読み込みエラー:", e);
    res.status(500).json({ error: "questions.json not found" });
  }
});

// WebSocket 中継処理
wss.on('connection', (ws) => {
  console.log('Client connected via WebSocket');
  
  ws.on('message', (message) => {
    // 音声ストリーム中継処理
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
