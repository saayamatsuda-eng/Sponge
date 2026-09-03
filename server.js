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

// フロントエンド用設定API
app.get('/api/config', (req, res) => {
  res.json({
    deepgramApiKey: process.env.DEEPGRAM_API_KEY || ''
  });
});

// スプレッドシート（CSV）から最新の質問・切り返しデータを取得する関数
async function getQuestionsData() {
  const csvUrl = process.env.SPREADSHEET_CSV_URL;
  let rawRecords = [];

  if (csvUrl) {
    try {
      const response = await axios.get(csvUrl);
      rawRecords = parse(response.data, {
        columns: true,
        skip_empty_lines: true
      });
    } catch (error) {
      console.error("スプレッドシート取得失敗。ローカルjsonを使用します:", error);
      try { rawRecords = require('./questions.json'); } catch (e) { rawRecords = []; }
    }
  } else {
    try { rawRecords = require('./questions.json'); } catch (e) { rawRecords = []; }
  }

  // フロントエンド（public/index.html）が処理できる形にデータ構造を変換
  return rawRecords.map((row, index) => {
    const type = row['種類'] || row['type'] || '質問フロー';
    const topic = row['トピック/質問'] || row['topic'] || row['question'] || '';
    const keywordsStr = row['キーワード (カンマ区切り)'] || row['キーワード'] || row['keywords'] || '';
    const keywords = typeof keywordsStr === 'string' ? keywordsStr.split(',').map(k => k.trim()).filter(Boolean) : [];
    const responseScript = row['表示・AIトーク案 (ここを書き換える)'] || row['response_script'] || row['script'] || '';
    const note = row['備考/使用ルール'] || row['note'] || '';

    return {
      id: index + 1,
      type: type,
      category: type,
      topic: topic,
      question: topic,
      keywords: keywords,
      trigger_keywords: keywords,
      response_script: responseScript,
      script: responseScript,
      note: note
    };
  });
}

// 質問・切り返しデータAPI
app.get('/api/questions', async (req, res) => {
  const questions = await getQuestionsData();
  res.json(questions);
});

// WebSocket 中継処理
wss.on('connection', (ws) => {
  console.log('Client connected via WebSocket');
  ws.on('message', (message) => {});
  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
