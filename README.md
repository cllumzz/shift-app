# シフト提出アプリ — セットアップガイド

スタッフが各自のスマホからシフト希望を提出し、店長がリアルタイムで確認できるアプリです。

---

## 構成ファイル

```
shift-app/
├── index.html        # スタッフ用（シフト提出）
├── admin.html        # 店長用（確認・管理）
├── app.js            # アプリロジック
├── style.css         # スタイル
├── config.js         # Firebase 設定（★ここを編集する）
├── firestore.rules   # Firestore セキュリティルール
└── README.md         # このファイル
```

---

## STEP 1 — Firebase プロジェクトを作成する

1. [Firebase Console](https://console.firebase.google.com/) にアクセス（Google アカウントでログイン）
2. **「プロジェクトを追加」** をクリック
3. プロジェクト名を入力（例: `shift-app`）し、「続行」
4. Google アナリティクスは **オフ** にして「プロジェクトを作成」
5. 作成完了後、プロジェクトのダッシュボードが開く

---

## STEP 2 — ウェブアプリを登録して設定値を取得する

1. ダッシュボード左上の **「</>」（ウェブ）** アイコンをクリック
2. アプリのニックネームを入力（例: `shift-web`）
3. 「Firebase Hosting も設定する」は **チェックしない**
4. 「アプリを登録」をクリック
5. 表示される `firebaseConfig` の中身をコピーする

```js
// コピーする内容の例（値は自分のプロジェクトのものを使う）
const firebaseConfig = {
  apiKey:            "AIza...",
  authDomain:        "shift-app-xxxx.firebaseapp.com",
  projectId:         "shift-app-xxxx",
  storageBucket:     "shift-app-xxxx.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abcdef"
};
```

6. `config.js` を開いて、コピーした値を貼り付けて保存する

---

## STEP 3 — Firestore データベースを作成する

1. Firebase Console 左メニュー「構築」→ **「Firestore Database」** をクリック
2. **「データベースの作成」** をクリック
3. **「本番環境モードで開始」** を選択して「次へ」
4. ロケーションは **`asia-northeast1`（東京）** を選択して「完了」
5. データベースが作成されたら次のステップへ

---

## STEP 4 — セキュリティルールを設定する

1. Firestore の画面で **「ルール」** タブをクリック
2. 既存のルールを全て削除して、`firestore.rules` の内容を貼り付ける
3. **「公開」** をクリックして保存する

> **ルールの概要**
> - シフトデータ: 誰でも読み書き可（削除は不可）
> - 休業日データ: 誰でも読み書き可
> - 入力値のバリデーションあり（名前・月・期間の形式チェック）

---

## STEP 5 — Vercel で公開する（無料）

### 初回設定

1. [Vercel](https://vercel.com/) にアクセスして GitHub アカウントでサインアップ
2. `shift-app` フォルダを GitHub リポジトリにプッシュしておく
   ```bash
   cd shift-app
   git init
   git add .
   git commit -m "initial commit"
   # GitHub でリポジトリ作成後:
   git remote add origin https://github.com/あなたのユーザー名/shift-app.git
   git push -u origin main
   ```
3. Vercel ダッシュボードで **「Add New → Project」** をクリック
4. GitHub リポジトリ一覧から `shift-app` を選択して **「Deploy」**
5. デプロイ完了後、発行された URL（例: `https://shift-app-xxxx.vercel.app`）をスタッフと共有する

### 更新方法

ファイルを変更して `git push` するだけで自動的に再デプロイされます。

---

## STEP 6 — 動作確認

| 確認項目 | 手順 |
|----------|------|
| スタッフ画面 | `index.html` を開いて名前・月・期間を入力し、シフトを提出する |
| 店長画面    | `admin.html` を開いて PIN（初期: `1234`）を入力 |
| リアルタイム | スタッフ画面でシフト提出すると、店長画面のカレンダーが即座に更新される |
| 再提出      | 同じ名前・月・期間で再度提出すると前のデータが上書きされる |
| 休業日設定  | 店長画面のカレンダーで日付をタップして休業日を設定・解除できる |

---

## 初期 PIN の変更

1. `admin.html` を開いて PIN（初期: `1234`）でログイン
2. 右上の **「PIN変更」** ボタンをクリック
3. 新しい4桁の数字を入力して確定

> ⚠ PIN はブラウザの `localStorage` に保存されます。
> 店長が使う端末（スマホ or PC）で一度ログインして変更してください。
> 端末ごとに PIN が独立するため、複数端末で管理する場合は各端末で同じ PIN を設定してください。

---

## スタッフ総数の設定（未提出人数の計算に必要）

1. 店長画面右上の **「人数設定」** ボタンをクリック
2. スタッフの総人数を入力する
3. 「未提出」カードに `総人数 - 提出済み人数` が表示されるようになる

---

## Firebase 無料枠について

Firebase の無料プラン（Spark プラン）の制限は以下の通りです。

| 項目 | 無料上限 |
|------|----------|
| Firestore 読み取り | 50,000 回 / 日 |
| Firestore 書き込み | 20,000 回 / 日 |
| Firestore ストレージ | 1 GB |
| ネットワーク送信 | 10 GB / 月 |

小規模店舗（スタッフ10〜20人程度）であれば**無料枠で十分**運用できます。

---

## よくある質問

**Q: 複数店舗で使いたい**
A: Firebase プロジェクトを店舗ごとに作成し、それぞれ別の `config.js` を使ってください。

**Q: スタッフに URL を教えたくない**
A: Vercel でパスワード保護（Pro プラン）を使うか、スタッフ画面にも簡易パスワードを追加する改修が必要です。

**Q: データを削除したい**
A: Firebase Console → Firestore → `shifts` コレクションから手動削除できます。
