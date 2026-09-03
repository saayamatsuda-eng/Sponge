const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const axios = require('axios');
const { parse } = require('csv-parse/sync');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// フロントエンドが Deepgram APIキーを取得するためのルート
app.get('/api/config', (req, res) => {
  res.json({
    deepgramApiKey: process.env.DEEPGRAM_API_KEY || ''
  });
});

// スプレッドシート（CSV）から最新の質問・切り返しデータを取得する関数
async function getQuestionsData() {
  const csvUrl = process.env.SPREADSHEET_CSV_URL;
  
  if (!csvUrl) {
    try {
      return require('./questions.json');
    } catch (e) {
      return [];
    }
  }

  try {
    const response = await axios.get(csvUrl);
    const records = parse(response.data, {
      columns: true,
      skip_empty_lines: true
    });

    return records.map(row => ({
      type: row['種類'] || row['type'],
      topic: row['トピック/質問'] || row['topic'],
      keywords: (row['キーワード (カンマ区切り)'] || row['keywords'] || '').split(',').map(k => k.trim()).filter(Boolean),
      response_script: row['表示・AIトーク案 (ここを書き換える)'] || row['response_script'],
      note: row['備考/使用ルール'] || row['note']
    }));
  } catch (error) {
    console.error("スプレッドシート取得失敗。ローカルjsonを使用します:", error);
    try {
      return require('./questions.json');
    } catch (e) {
      return [];
    }
  }
}

// 質問・切り返しデータAPI
app.get('/api/questions', async (req, res) => {
  const questions = await getQuestionsData();
  res.json(questions);
});

// WebSocket 中継処理（ブラウザと Deepgram 間の音声ストリーム転送）
wss.on('connection', (ws) => {
  console.log('Client connected via WebSocket');
  
  ws.on('message', (message) => {
    // クライアントからの音声データ処理（必要に応じて追加）
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
