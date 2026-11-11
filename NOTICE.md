# 第三方素材

## 動作示意圖（縮圖與動畫）

`src/assets/exercises/` 與 `src/assets/exercise-gifs/` 裡的圖片與 GIF 是 Gym visual 的作品：

> **© Gym visual — https://gymvisual.com/**

- 取自 [hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset)（釘在 commit `7455efa`，取得方式見 `scripts/build-exercise-images.mjs`）。該資料集經 Gym visual 許可以 180×180 解析度散布，要求每次使用都保留上面的著作權標示；它的 MIT 授權只涵蓋文字資料，不涵蓋這些圖。
- 本專案是個人使用的 App，使用者已向 Gym visual 確認可以使用。**這個 repo 不授予任何人使用這些圖片的權利**；要在自己的專案使用，請依 [Gym visual 的使用條款](https://gymvisual.com/content/3-terms-and-conditions-of-use)自行取得授權。
- App 內的標示：設定頁底部、動作示意圖的放大檢視，以及動作庫、加動作、課表編輯、訓練中畫面的列表底部（列表裡有圖時才印）。

## 數字字型 Nunito

`src/assets/nunito-num-*.woff2` 是 [Nunito](https://github.com/googlefonts/nunito)（v3.602）的數字子集，五個靜態字重：

> Copyright 2014 The Nunito Project Authors (https://github.com/googlefonts/nunito)

- 以 [SIL Open Font License 1.1](https://openfontlicense.org) 授權；字型檔內的 name 表保留了著作權與授權聲明。Nunito 沒有保留字型名稱（Reserved Font Name），子集化後的檔案不必改名。
- 子集只含 `0–9`、空白與 `% + , - . / : · × – —`，用 fontTools 的 `varLib.instancer`（切字重）與 `subset`（切字集、拿掉 layout features）產出。
