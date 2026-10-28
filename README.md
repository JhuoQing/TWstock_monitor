# 台股夜盤 Taiwan Market Monitor

台灣股市的靜態儀表板：加權指數天際線、法人籌碼、類股熱力圖、個股技術圖、新聞與總體經濟，部署在 GitHub Pages，**沒有後端、沒有資料庫、前端不放任何金鑰**。

> 資料不是即時報價（來源是 Yahoo Finance 與政府公開資料，排程約 30 分鐘更新一次），**不適合當作交易依據**，也不構成投資建議。

## 功能

| 區塊 | 內容 |
| --- | --- |
| 總覽 | 加權指數「天際線」（每個交易日一棟大樓，最右邊是台北 101，塔尖燈號依漲跌變色）、漲跌家數、成交金額、外資買賣超、外資台指期淨部位、融資餘額、焦點個股、訊號掃描 |
| 市場 | 類股熱力圖（面積＝成交金額）、類股強弱、上市／ETF／上櫃排行、三大法人與個股買賣超、融資融券、除權息、注意／處置股、全球行情 |
| 個股 | 側邊欄 K 線／折線，均線、布林、成交量、RSI、MACD、KD，最多 3 檔比較（以報酬率對齊）、存成圖片、分享連結 |
| 自選 | 自選股、持股損益試算、價格警示（瀏覽器通知）；全部只存在你的瀏覽器 |
| 新聞 | 規則式整理：重複合併、重點排序、主題標籤、標題關鍵字判讀偏多／偏空、搜尋 |
| 總經 | FRED 指標，以及唯一使用 AI 的區塊：Gemini 總經摘要 |
| 其他 | `Ctrl/⌘ K` 搜尋上市櫃全市場個股、日夜主題、紅漲綠跌／綠漲紅跌切換、備份匯入匯出、資料來源狀態、可安裝成 App（PWA） |

## AI 使用範圍

AI **只用在總經頁的摘要**，其他一切（新聞、訊號、排行、熱力圖）都是規則式計算。並且做了節流，平常幾乎不會呼叫：

- 沒有 FRED 資料就不呼叫；
- 只在總經指標「真的有變動」時才產生（以指標內容雜湊判斷）；
- 距離上一份不足 20 小時（可用 `AI_MIN_INTERVAL_HOURS` 調整）就沿用舊的；
- 每次執行最多呼叫一次，失敗時沿用上一份；
- 歷史摘要只保留 30 份。

沒設定 `GEMINI_API_KEY` 或 `FRED_API_KEY` 時，總經頁會顯示說明，其餘功能完全不受影響。

## 運作方式

```
GitHub Actions（排程）
  └─ python -m pipeline.build
       ├─ Yahoo Finance：約 90 檔追蹤標的日 K（symbols.json）
       ├─ 證交所／櫃買／期交所：行情、產業別、法人、融資券、除權息、注意處置、台指期
       ├─ 新聞 RSS、FRED、（必要時）Gemini
       └─ 寫出 web/data/*.json
  └─ 把 web/ 當成 Pages 產物直接部署
```

重點設計：

- **不再每 30 分鐘 commit 資料。** 資料只存在部署產物裡，倉庫歷史不會被刷爆。管線會讀取「上一次已部署的網站」來做失敗時的沿用、法人／期貨／融資的歷史累積，以及 AI 節流。
- **單一來源失敗不會拖垮整體。** 失敗的項目沿用上次成功的資料並標示「舊資料」，`index.json` 的 `sources` 記錄每個來源的狀態，網頁右上角可以查看。
- **寫入前先驗證。** 資料明顯不合理（例如大盤報價缺失）時整次更新中止，保留網站上原本可用的版本。
- **前端沒有建置步驟**、沒有任何第三方 JS：ES module + 自製 Canvas 圖表引擎，CSP 限制為 `script-src 'self'`，所有插入的文字預設跳脫。

### 資料檔（`web/data/`）

| 檔案 | 內容 |
| --- | --- |
| `index.json` | 首頁與各頁所需的一切：報價、大盤歷史、法人、排行、熱力圖、新聞、總經、AI 摘要、`sources` 狀態 |
| `universe.json` | 全市場每檔一列：`[代號, 名稱, 收盤, 漲跌幅%, 成交金額（億）, 類型]`，供搜尋與只有當日報價的個股 |
| `sym/<檔名>.json` | 每檔追蹤標的的日 K（`^`、`=`、`/` 會被換成 `_`） |
| `macro_history.json` | 過去的 AI 總經摘要 |
| `profile.json`、`alert_state.json` | 公司產業別對照、Telegram 警示狀態 |

## 部署到自己的 GitHub 帳號

1. Fork 或複製這個倉庫。
2. **Settings → Pages → Build and deployment → Source 選 "GitHub Actions"**（這一步一定要做，否則舊的「從分支部署」不會讀 Actions 的產物）。
3. （選用）**Settings → Secrets and variables → Actions** 新增：
   - `FRED_API_KEY`：免費申請（<https://fred.stlouisfed.org/docs/api/api_key.html>），啟用總經指標。
   - `GEMINI_API_KEY`：啟用 AI 總經摘要（需要 `FRED_API_KEY`）。
   - `TELEGRAM_BOT_TOKEN`、`TELEGRAM_CHAT_ID`：啟用手機推播（見下）。
   - Variables（非機密）：`GEMINI_MODEL`、`AI_MIN_INTERVAL_HOURS`。
4. **Actions → update-data → Run workflow**，第一次部署完成後網站就會出現。之後依排程自動更新（台灣時間 08:20、盤中每 30 分鐘、盤後、美股收盤後）。
5. 排程可能因為 60 天無活動被 GitHub 停用；每次排程執行都會自動重新啟用自己，一般不需處理。

### 確認資料來源是否正常

證交所、櫃買、期交所偶爾會調整欄位。**Actions → probe-sources → Run workflow** 會實際連線每個來源，在摘要裡列出是否解析成功與欄位形狀。哪個來源壞了，就只需要改 `pipeline/` 裡對應的一個解析函式。

## 自訂

- **追蹤標的**：編輯 `symbols.json`（`symbol`、`name`、`group`、`kind`，`focus: true` 會出現在總覽的焦點個股）。只有這份清單裡的標的有歷史走勢與技術指標；清單外的上市櫃個股仍可搜尋，但只有當日報價。標的越多，更新越久，目前約 90 檔。
- **伺服器端價格警示**（手機推播）：在 `alerts.json` 加規則，並設定兩個 Telegram Secret。每條規則只在「由未觸發變成觸發」時通知一次。
  ```json
  { "rules": [ { "symbol": "2330.TW", "op": ">=", "value": 1000, "note": "突破" } ] }
  ```
  網頁上的警示（自選頁）則只在你開著網站時檢查，兩者互不影響。

## 本機開發

```bash
pip install -r requirements-dev.txt
python -m pytest -q                       # 管線測試（使用 fixture，不需要網路）
node --test "web/tests/*.test.mjs"        # 前端測試（Node 22，無相依）
node web/tests/check-imports.mjs          # 確認所有 ES module 匯入都存在

python tools/make_sample_data.py          # 產生合成的範例資料到 web/data/（不需網路）
python -m http.server -d web 8000         # 開 http://localhost:8000
```

範例資料走的是正式管線，`index.json` 會帶 `"sample": true`，網頁會顯示「範例資料」提示。真實資料需要在可以連到 Yahoo Finance 與證交所的環境執行 `python -m pipeline.build`。

### 專案結構

```
pipeline/        資料管線（quotes、twse、tpex、taifex、news、macro、ai、notify、validate、build）
web/             靜態網站（index.html、assets/css、assets/js、sw.js、manifest）
  assets/js/lib/     純函式與狀態：格式化、指標、store、路由、資料中樞
  assets/js/charts/  Canvas 圖表引擎、天際線、迷你圖
  assets/js/ui/      各頁面與浮層
tests/           Python 測試   web/tests/   前端測試
tools/           probe_sources.py、make_sample_data.py
.github/         update.yml（排程＋部署）、ci.yml、probe.yml、dependabot.yml
```

## 隱私與安全

- 自選股、持股、警示與設定只存在瀏覽器的 localStorage，不會上傳；設定裡可匯出備份或一鍵清除。
- 前端沒有任何金鑰；金鑰只存在 GitHub Secrets，只有 Actions 執行時讀得到。
- 外部新聞連結只允許 http(s)，並以 `noopener noreferrer` 開啟。

## 已知限制

- 免費資料來源有延遲、偶爾失效；失敗的區塊沿用舊資料並標示。
- 沒有盤中即時逐筆報價與分時圖。
- 新聞「偏多／偏空」是標題關鍵字判讀，只是瀏覽輔助。
- 技術訊號是機械式條件，沒有回測，不代表買賣建議。
- 國定假日休市資訊沒有內建；休市日「盤中」標示可能不準，請以資料日期為準。

## 注意事項

- 本專案內容僅供資訊參考，**不構成任何投資建議**，投資風險請自行評估。
- 各資料來源有其使用條款，請遵守相關規範；商業用途請先確認授權。
- 新聞內容版權屬原發布媒體，本站僅提供標題與連結。

## 授權

MIT License
