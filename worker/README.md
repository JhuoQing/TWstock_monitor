# Worker 部署教學

這個 Worker 做兩件事：

| 路徑 | 用途 | 要不要密碼 |
| --- | --- | --- |
| `POST /` | 強制更新：驗證管理密碼 → 呼叫 GitHub `workflow_dispatch` → `update-data` 立即執行 | 要 |
| `GET /live` | 盤中即時行情：代理證交所 MIS，網頁每 15 秒讀一次 | 不用（唯讀公開資料） |

密碼與 GitHub token 都只存在 Worker 的 secret，不會出現在網頁或 repo。

> **已經部署過舊版的話**：`/live` 是後來加的，要再跑一次 `npx wrangler deploy` 才會生效，
> 否則網頁的「資料狀態」會顯示「Worker 還沒有 /live，請重新部署」。
> 不需要重設 secret，也不用動 GitHub token。

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

即時行情（盤中測試才會有成交價）：
```bash
curl -s "https://twstock-admin.<子網域>.workers.dev/live?ch=tse_t00.tw|tse_2330.tw" | head -c 400
# {"ok":true,"at":"…","delay":5000,"q":[{"ch":"tse_t00.tw","price":27543.21,"prev":27499,"chg":44.21,…}]}
```
`?raw=1` 會回 MIS 的原始 JSON，欄位對不上時用它來看實際形狀。

## 即時行情說明

`/live` 有兩層來源，第一層失敗會自動退到第二層：

| 順位 | 來源 | 延遲 | 備註 |
| --- | --- | --- | --- |
| 1 | 證交所 MIS | 約 5–15 秒 | 先取首頁 cookie（快取 10 分鐘）再打 API，整組標頭照真的瀏覽器送 |
| 2 | Yahoo `v8/finance/chart` | 約 15–20 分鐘 | 一次最多 15 檔，延遲由 `exchangeDataDelayedBy` 告知 |

回應裡的 `src` 欄位會寫是哪一個（`mis` 或 `yahoo`），網頁照它決定標籤要寫「即時」還是「Yahoo」。

**診斷**：`?debug=1` 會在回應裡附上 `tried` 陣列，列出每一層失敗的原因，例如

```bash
curl -s "https://twstock-admin.<子網域>.workers.dev/live?ch=tse_t00.tw&debug=1"
# {"ok":true,"src":"yahoo",…,"tried":[{"src":"mis","error":"mis_http_520"}]}
```

常見的 MIS 錯誤：

- `mis_http_520` — Cloudflare 的「來源回了無法解析的回應」。通常是被當成機器人：cookie 沒拿到或標頭不夠像瀏覽器。
- `mis_http_403` / `404` — 明確拒絕，多半是擋機房 IP，Worker 這端改不了，靠 Yahoo 後備。
- `rtcode` 非 `0000` — 連得上但參數有問題，`?raw=1` 可以看原始回應。

- 頻道格式 `tse_2330.tw`（上市）、`otc_6488.tw`（上櫃）、`tse_t00.tw`（加權指數）、`otc_o00.tw`（櫃買指數），
  一次最多 40 個，不符格式的會被丟掉。
- 相同的標的組合有 **10 秒邊緣快取**，所以多開分頁或多人看，對 MIS 的請求不會等比增加。
- MIS 偶爾會改欄位或擋請求。解析壞掉時網頁會退回收盤價並在「資料狀態」顯示原因；
  要查實際回應，用上面的 `?raw=1`，或在 GitHub 跑 **Actions → probe-sources**。
- Cloudflare 從哪個機房出去不固定。萬一 MIS 擋掉該區域的請求，`/live` 會回 502，網頁照樣退回收盤價。

## 防護說明
- 只接受來自 `ALLOWED_ORIGIN` 的請求（可用逗號分隔多個，例如再加 `http://localhost:8000` 方便本機開發）。
  `/live` 若沒有 `Origin` 標頭（curl）會放行，因為它只是唯讀的公開行情。
- 同一 IP 每 3 秒只能嘗試一次密碼；密碼比對為常數時間。
- 驗證通過後，全站 `COOLDOWN_SECONDS`（預設 300 秒）內只會觸發一次。
- token 只有這個 repo 的 Actions 權限，外洩時最壞狀況是有人能觸發或取消這個 repo 的 workflow。

## 選配：用 Worker 當排程備援
GitHub 的 cron 可能被延遲或跳過。取消 `wrangler.toml` 裡 `[triggers]` 的註解後重新 `wrangler deploy`，
Cloudflare 會在平日 09:07–13:37（台灣時間）每 30 分鐘觸發一次。此路徑不經過密碼，也不受冷卻限制，
但 workflow 的 `concurrency` 會讓重複觸發排隊，不會同時部署。

## 更換密碼
`npx wrangler secret put ADMIN_PASSWORD` 重新輸入即可，立即生效。
