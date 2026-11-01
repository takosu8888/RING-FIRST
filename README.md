# RING FIRST — オンライン対戦（フェーズ1：1対1 DUEL）

## ファイル構成（すべて同じフォルダ／同じGitHubリポジトリのルートに置く）
| ファイル | 役割 |
|---|---|
| `index.html` | ゲーム本体（CPU戦＋オンライン）。GitHub Pagesで公開 |
| `game-core.js` | 戦闘・進化・CPU AIの共有ロジック。ブラウザとサーバーの両方が読む |
| `server.js` / `package.json` | オンライン対戦サーバー（Node.js + `ws`）。Renderで動かす |
| `render.yaml` | Renderの設定（任意。Blueprint用） |
| `backup/ring-first-v2-cpu-backup.html` | **CPU戦だけの元の完全版（単体で動く）。いつでもこれに戻せる** |
| `test/` | 自動テスト（`npm test`） |

> CPU戦だけ遊ぶなら、`index.html` と `game-core.js` を同じ場所に置いて開くだけでOK（サーバー不要）。
> 何かあれば `backup/ring-first-v2-cpu-backup.html` を `index.html` にリネームすれば、以前の状態に完全復元できます。

## 通信方式：Node.js + WebSocket（サーバー権威型）
- **理由**：HP・スタミナ・ダメージ・進化の抽選・勝敗をサーバーだけが決めるため、改ざんに強く、4人乱闘にもそのまま拡張できます。Firebase/Supabase型はルームやチャットには向きますが、戦闘判定をクライアントに任せることになるため採用しませんでした。
- **構成**：HTML（静的）→ GitHub Pages ／ サーバー → Render（無料枠）。秘密鍵は不要で、HTMLに書くのはサーバーのURLだけです。
- **費用**：GitHub Pages・Render無料枠とも0円で始められます（料金体系は変わることがあるため公式ページで確認してください）。無料枠の注意：**しばらく使われないと停止し、次の接続時に最大1分ほど起動待ちが発生**します（画面にその旨が表示されます）。サーバーが再起動するとルームは消えます。常時稼働させたい場合は有料プランが必要です。

## 手順
### 1. ローカルで試す（任意）
```
npm install
npm start                       # → http://localhost:8080 で待ち受け
```
別ターミナルで `npx serve .` などで index.html を開き、URL末尾に `?server=ws://localhost:8080` を付けます（ローカルホストへの指定のみ有効）。2つのブラウザタブで CREATE / JOIN を試せます。

### 2. GitHubに置く
1. GitHubで新しいリポジトリを作り、上記ファイルをすべてルートにアップロード。
2. `Settings → Pages → Branch: main / (root)` で公開。URLは `https://ユーザー名.github.io/リポジトリ名/`。

### 3. Renderにサーバーを作る
1. https://render.com でGitHub連携 → `New → Web Service` → 上のリポジトリを選択。
2. 設定：`Runtime: Node` / `Build Command: npm install` / `Start Command: npm start` / `Instance Type: Free` / `Health Check Path: /health`
   （`render.yaml` を使う場合は `New → Blueprint`）
3. `Environment` に追加：
   - `ALLOWED_ORIGINS` = `https://ユーザー名.github.io`（**パスは付けない**。複数ならカンマ区切り。他サイトからの接続を拒否します）
4. デプロイ完了後に表示されるURL（例 `https://ring-first-server.onrender.com`）をメモ。

### 4. index.html にサーバーURLを入力
`index.html` の中の次の行を探し、メモしたURLの **`https://` を `wss://` に変えて** 貼り付けます。
```js
server:'wss://YOUR-APP-NAME.onrender.com',   // ★ここ
```
例：`server:'wss://ring-first-server.onrender.com',` → 保存して再度GitHubへアップロード。

### 5. 異なる端末で対戦する
1. 両方の端末で GitHub Pages のURLを開く → `ONLINE BATTLE`。
2. 1人が `CREATE ROOM` → 6桁のコードを `COPY` して友達に送る。
3. もう1人はコードを入力して `JOIN ROOM` → `準備完了` → ホストが `START`。
- チャット：`Enter` で入力、`Enter` で送信（日本語入力OK）。発言は頭上の吹き出しにも出ます。
- 試合中の切断は約30秒以内なら自動で復帰します（ロビーでは約15秒）。

## 調整できる値（初期値）
| 設定 | 場所 | 初期値 |
|---|---|---|
| 入力送信頻度 | `index.html` の `NET.inputHz`（または URLに `?inputHz=45`） | 30Hz |
| 補間遅延 | `NET.interpMs`（または `?interp=150`）。サーバーの同期頻度から下限を自動計算 | 100ms |
| 状態同期頻度 | サーバーの環境変数 `STATE_HZ` | 20Hz |
| サーバー計算頻度 | 環境変数 `SIM_HZ`（無料枠のCPUが厳しければ下げる） | 60Hz |
| 起動待ちの上限 / 再接続回数 | `NET.wakeTimeoutMs` / `NET.reconnectMax` | 100秒 / 8回 |

目安：操作が遅れて感じるなら `inputHz` を上げる、相手の動きがカクつくなら `interp` を上げる。

## 動作確認
```
npm install
npm test        # コアロジック / サーバー(モック) / クライアント(偽DOM) のテスト
```

## 検証状況（正直な報告）
**検証済み（この環境の自動テスト。実ネットワークは使っていません）**
- CPU戦（12試合のヘッドレス実行、3ポイント先取、進化、勝敗、再戦での能力リセット）が、共通化後も動作する
- ルーム作成／コード参加／無効コード／満員／ホスト権限／準備／開始（モックWebSocketでサーバーロジックを直接駆動）
- DUELの1試合（3ポイント先取）、命中判定、進化の抽選・選択・全員への同期、勝敗確定、ロビー復帰
- 不正入力（範囲外の値・他の手のパンチ・HP/ダメージの偽装）が無効になること、チャットの無害化・文字数/連投制限
- 切断→復帰、不正トークン拒否、二重参加（後勝ち）、試合中の退出（不戦勝）、ホスト引き継ぎ、無人ルームの掃除
- 実サーバーが出力したメッセージをクライアントが処理する流れ（補間・進化画面・チャット・吹き出し生成・入力送信・結果画面）
- 接続失敗／起動待ち／再接続／復帰不能の各メッセージ表示

**未検証（実際の端末・ネットワークでの確認が必要）**
- 異なる端末・異なるブラウザ間の実通信、Renderへの実デプロイ（wss接続・起動待ち時間）
- 実ブラウザでの3D描画（他プレイヤーの描画、吹き出しの位置、UIの見た目・レイアウト）
- 通信遅延下の操作感、30Hz入力/20Hz同期/100ms補間の妥当性（自分の動きは先読みしていないため、遅延が大きいと重く感じる可能性があります）
- 日本語IME入力の実機動作、Chromebook実機、Render無料枠でのCPU負荷（`SIM_HZ=60`）
- 4人乱闘（内部ロジックの一部は実装済みですがUIで未解放・未検証）

## フェーズ2に向けた設計（実装済みの土台）
- サーバーの `Match` はN人対応（4隅スポーン、最寄りターゲット、`Tab`で標的切替、全員への判定 `combat(att, 全員)`、重なり防止 `separate`）。
- ルームは最大4スロット。BRAWLはサーバー側スイッチ `ENABLE_BRAWL=1` とUIの解放で有効化できます（現状は無効表示）。
- フェーズ2の主な残作業：4人用HUD、脱落者の観戦、標的表示、乱闘での進化ルール、乱闘の実機検証。

## セキュリティ
- ダメージ・HP・スタミナ・進化の抽選はサーバーのみ。クライアントは入力と選択番号しか送れません。
- 入力値の検証、連続送信の制限、チャットの無害化、`ALLOWED_ORIGINS`による接続元制限。
- 認証情報・秘密鍵は不要です。HTMLに書くのはサーバーURLだけです。
