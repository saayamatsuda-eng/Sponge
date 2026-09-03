const express = require('express');
const http = require('http');
const path = require('path');
const axios = require('axios');
const { parse } = require('csv-parse/sync');

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// スプレッドシート（CSV）から最新の質問・切り返しデータを取得する関数
async function getQuestionsData() {
  const csvUrl = process.env.SPREADSHEET_CSV_URL;
  
  // URLがない場合はバックアップとして既存の questions.json を読む
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

// フロントエンド（画面）から質問・切り返しデータを取得するAPI
app.get('/api/questions', async (req, res) => {
  const questions = await getQuestionsData();
  res.json(questions);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
