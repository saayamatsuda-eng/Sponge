require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { OpenAI } = require('openai');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const questionsData = require('./questions.json');
const SCENARIO_TREE_FILE = path.join(__dirname, 'scenario_tree.json');

function loadScenarioTree() {
  if (!fs.existsSync(SCENARIO_TREE_FILE)) return { scenarios: [] };
  try {
    const raw = fs.readFileSync(SCENARIO_TREE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error("Scenario Tree File Load Error:", e);
    return { scenarios: [] };
  }
}

app.post('/api/save-success-log', async (req, res) => {
  const { transcriptLogs } = req.body;
  if (!transcriptLogs || transcriptLogs.length === 0) {
    return res.json({ success: false, message: "ログが空です" });
  }

  try {
    const parsePrompt = `以下のインサイドセールス（IS）通話ログから、相手の拒絶・逃げの連鎖構造を解析し、JSON形式で出力してください。

【通話ログ】
${transcriptLogs.join('\n')}

【標準カテゴリID（intent_id）の定義】
- "reception_gate": 受付ブロック / 取引なしお断り
- "doc_request": 資料送付希望 / メール希望
- "not_hiring": 中途採用未実施 / 募集なし / 検討なし
- "using_agent": 競合・紹介会社利用中
- "not_in_charge": 担当外 / 自分の管轄外
- "handover": 人事離脱・後任への引き継ぎ
- "take_home": 上長・チーム持ち帰り検討
- "no_time_to_spend": 時間を取るつもりはない / 時間を割けない
- "busy": 多忙 / 時間がない
- "satisfied": 間に合っている / 不要
- "other": その他

【出力フォーマット（JSONのみ）】
{
  "intent_id": "上記標準カテゴリIDのいずれか",
  "intent_label": "カテゴリの分かりやすい日本語名",
  "out_chain": [
    { "turn": 1, "customer": "1回目の断り", "is_reply": "1回目の切り返し" }
  ],
  "final_closing_step": "最終的な決め手トーク",
  "success_factor": "勝因ポイント"
}`;

    const analysisRes = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: parsePrompt }],
      response_format: { type: "json_object" },
      temperature: 0.1
    });

    const parsedScenario = JSON.parse(analysisRes.choices[0].message.content);
    const treeData = loadScenarioTree();

    const existingIndex = treeData.scenarios.findIndex(s => s.intent_id === parsedScenario.intent_id);

    if (existingIndex >= 0) {
      const currentScore = treeData.scenarios[existingIndex].score || 1;
      treeData.scenarios[existingIndex] = {
        ...parsedScenario,
        score: currentScore + 1,
        updated_at: new Date().toISOString()
      };
      console.log(`🔥 【スコア加算】カテゴリ「${parsedScenario.intent_label}」の成功実績数が ${currentScore + 1} にUPしました！`);
    } else {
      treeData.scenarios.push({
        ...parsedScenario,
        score: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      console.log(`✨ 【新規シナリオ登録】カテゴリ「${parsedScenario.intent_label}」をスコア 1 で登録しました！`);
    }

    fs.writeFileSync(SCENARIO_TREE_FILE, JSON.stringify(treeData, null, 2), 'utf8');
    res.json({ success: true, scenario: parsedScenario });

  } catch (error) {
    console.error("シナリオ解析・保存エラー:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/config', (req, res) => {
  res.json({
    deepgramApiKey: process.env.DEEPGRAM_API_KEY,
    questionsData: questionsData
  });
});

app.post('/api/generate-reply', async (req, res) => {
  const { customerSpeech, fullCallHistory, currentPhaseLabel, jobInfo, partnerInfo } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let matchedScenariosContext = "";
  try {
    const treeData = loadScenarioTree();
    if (treeData.scenarios && treeData.scenarios.length > 0) {
      const topScenarios = treeData.scenarios
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 3);

      matchedScenariosContext = "\n【参考：実績スコアの高い『多段アウト攻略・連鎖』成功ツリー】\n" +
        topScenarios.map((s, i) => `
[実績No.${i+1} (成功数:${s.score}回): ${s.intent_label}]
・連鎖フロー: ${JSON.stringify(s.out_chain)}
・決め手トーク: "${s.final_closing_step}"`).join('\n---');
    }
  } catch (e) {
    console.error("Context Load Error:", e);
  }

  const hookType = partnerInfo?.hook || "";
  const isLostDeal = (hookType === "過去失注");
  const newFeatureNote = process.env.NEW_FEATURE_NOTE || "特になし";

  const systemPrompt = `あなたはSansan株式会社の超優秀なインサイドセールス（IS）のアウト返し専門AIです。
相手（顧客）が難色を示したり逃げようとした際、堅苦しい営業トークではなく「人間らしく自然な対話（人とお話ししている感）」を重視して口語体トークを出力してください。

【リアルタイム追加情報・新機能メモ】
${newFeatureNote}

【徹底追撃シナリオ】
1. 受付で「取引がない会社はお断りするよう言われている」と言われた時:
   ➔ 直通情報だけ確認して爽やかに引くトーク:
      「左様でございましたか！かしこまりました。差し支えなければ、中途採用ご担当者様（または部署名）のご直通のお電話番号かメールアドレスをご教示いただくことは可能でしょうか？」

2. 「そう言う検討は今のところない」「検討予定がない」と言われた時:
   ➔ 「いや〜そうですよね！すぐのご検討予定がないのは重々承知しております！今回は導入前提のお話では全くございませんので、今後ターゲット層の採用や中途をご検討される際の参考に、他社様の成功事例だけ30分程度ご覧になりませんか？」

3. 「時間を取るつもりはない」「時間を割けない」と言われた時:
   ➔ 「いや〜そうですよね！無理にお時間をお取りいただくつもりは全くございません。本日はあくまで同業他社様で成果が出ている最新の採用事例だけをご紹介できればと思っておりまして… 後日オンラインで30分だけ情報収集としてお付き合いいただくことは難しいでしょうか？」

4. 「人事領域を離れた」「後任に引き継ぐので資料を送って」と言われた時:
   ➔ 「左様でございましたか！お忙しい中ご対応いただきありがとうございます。かしこまりました！概要資料をメールでお送りいたしますね。差し支えなければ、後任のご担当者様のお名前（または部署名）をご教示いただくことは可能でしょうか？」

5. 「持ち帰ってチームで話します」「必要そうならまた連絡します」と言われた時:
   ➔ 「社内に展開するのも面倒だと思うので、〇〇様ご自身が『これは社内に共有する価値があるな』と感じた場合のみで大丈夫です！そのためにも、まずはご自身だけで構いませんので一度オンラインで30分実際の画面をご覧になりませんか？実際に見て感じられた方からチームへ展開していただいた方が、御社にとっても一番良いお時間になるかと存じます！」

【現在のコンテキスト】
・現在のフェーズ: 「${currentPhaseLabel}」
・求人情報: ${JSON.stringify(jobInfo)}
・取引先条件: ${JSON.stringify(partnerInfo)} (過去失注フラグ: ${isLostDeal})
${matchedScenariosContext}

【絶対ルール】
・直前の会話文脈（過去ログ）から『相手が何の断り・逃げを打ってきたか』を厳格に判断すること。
・解説や余計な前置きは絶対に書かず、IS担当者がそのまま喋る1〜2文の口語トークのみを出力すること。`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...fullCallHistory.map(item => ({
      role: item.role === 'user' ? 'assistant' : 'user',
      content: item.text
    })),
    { role: 'user', content: customerSpeech }
  ];

  try {
    const stream = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: messages,
      stream: true,
      max_tokens: 220,
      temperature: 0.2
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('OpenAI Stream Error:', error);
    res.status(500).write(`data: ${JSON.stringify({ error: 'AI生成エラー' })}\n\n`);
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:3000`);
});
