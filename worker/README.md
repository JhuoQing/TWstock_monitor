# 強制更新 Worker 部署教學

網頁輸入管理密碼 → Cloudflare Worker 驗證 → 呼叫 GitHub `workflow_dispatch` → `update-data` 立即執行。
密碼與 GitHub token 都只存在 Worker 的 secret，不會出現在網頁或 repo。

## 1. 建立 GitHub fine-grained token
1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token
2. Repository access：**Only select repositories** → 只選 `TWstock_monitor`
3. Permissions → Repository permissions → **Actions: Read and write**（其他全部維持 No access）
4. 有效期限建議 1 年，並記下到期日（到期後按鈕會回報「GitHub 拒絕了請求」，重做一個換掉即可）
5. 複製產生的 `github_pat_...`

## 2. 部署 Worker
需要 Node 20+ 與免費 Cloudflare 帳號。
```bash
cd worker
npx wrangler login
npx wrangler deploy
npx wrangler secret put ADMIN_PASSWORD   # 輸入你要的管理密碼（建議 16 字元以上）
npx wrangler secret put GITHUB_TOKEN     # 貼上第 1 步的 github_pat_...
```
部署完會顯示網址，例如 `https://twstock-admin.<你的子網域>.workers.dev`。

## 3. 填入網址
編輯 `web/assets/js/lib/admin.js`，把 `WORKER_URL` 改成上面的網址，commit 並合併到 main。
網站部署後，右上角「資料狀態」視窗會出現「強制更新（管理員）」欄位。

## 4. 測試
```bash
curl -i -X POST https://twstock-admin.<子網域>.workers.dev \
  -H "Origin: https://jhuoqing.github.io" -H "Content-Type: application/json" \
  -d '{"password":"錯的密碼"}'        # 應回 401
```
再到網頁輸入正確密碼，Actions 頁面應出現一筆 `workflow_dispatch` 的 update-data，約 2 分鐘後頁面自動更新。

## 防護說明
- 只接受來自 `ALLOWED_ORIGIN` 的請求。
- 同一 IP 每 3 秒只能嘗試一次密碼；密碼比對為常數時間。
- 驗證通過後，全站 `COOLDOWN_SECONDS`（預設 300 秒）內只會觸發一次。
- token 只有這個 repo 的 Actions 權限，外洩時最壞狀況是有人能觸發或取消這個 repo 的 workflow。

## 選配：用 Worker 當排程備援
GitHub 的 cron 可能被延遲或跳過。取消 `wrangler.toml` 裡 `[triggers]` 的註解後重新 `wrangler deploy`，
Cloudflare 會在平日 09:07–13:37（台灣時間）每 30 分鐘觸發一次。此路徑不經過密碼，也不受冷卻限制，
但 workflow 的 `concurrency` 會讓重複觸發排隊，不會同時部署。

## 更換密碼
`npx wrangler secret put ADMIN_PASSWORD` 重新輸入即可，立即生效。
