# 點子共玩所上線驗收與部署

## 本機驗證

- `node tests/launch-frontend.cjs` 驗證審核、活動日期、票價與 GA4 路由去重。
- `node tests/launch-db.cjs` 使用獨立 PGlite 測試庫，驗證投稿審核、回報、會員與收藏權限、封存與還原。使用 `PGLITE_PATH` 可指定既有 PGlite 套件位置。
- `node tests/launch-ga.cjs` 使用測試金鑰與模擬 API，驗證管理員驗證、Google 憑證簽章與報表內容。

## 正式環境核准前

1. 在測試環境用訪客、一般會員、管理員、停權管理員各跑一次。手機與桌機檢查登入、搜尋、核准與退回、回報、更正日期和票價、延期與封存還原。
2. 確認能取得 Supabase 資料庫備份，核對活動、會員、收藏、報名及 Storage 檔案，並在獨立環境演練還原。記下目前正式站版本。
3. 使用 GA4 資源 ID `563704089`。在 Google Cloud 啟用 Analytics Data API，並在 GA4「管理 → 資源存取管理」將專用服務帳戶加入為檢視者。於 Supabase Edge Functions 的機密設定填入 `GA4_PROPERTY_ID=563704089`，並將服務帳戶 JSON 填入 `GA4_SERVICE_ACCOUNT_JSON`。設定完成後，以管理員身分開啟後台「GA4 網站數據 → 載入報表」，確認回傳最近七個完整日的數據。
4. 用 GA4 DebugView 或即時報表確認路由切換與自訂事件。手動送出瀏覽事件時，停用 GA4 網頁資料串流的自動歷史變更頁面瀏覽，避免重複。

## 核准後的部署順序

1. 在 Supabase 先套用 `launch-review.sql`、`launch-archive.sql`、`launch-reactions-privacy.sql`。確認匿名無法取得會員互動明細或會員清單，公開互動總數可讀。新版前端上線前，舊前端的互動總數可能短暫偏低。
2. 部署 `launch-ga-report` Edge Function 和 GitHub Pages 網站，驗證頁面、審核、報表及空白狀態。若尚未提供 GA4 憑證，後台應顯示尚未連接。
3. 單獨核准並啟用 `launch-archive-schedule.sql`。確認 `pg_cron` 可用，檢查台灣時間每日 02:15 的執行結果。封存保留原始資料與照片，後台可解除封存。解除封存後，若活動日期仍已過，仍受公開列表的日期規則限制。

若驗收失敗，暫停排程，將網站退回上一版。保留正式環境已新增的投稿、回報與封存紀錄，優先修正相容性。資料庫還原會影響備份之後的資料，須依實際差異另行確認。
