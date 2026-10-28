// 各 UI 模組共用的回呼，由 main.js 在啟動時填入，避免模組間循環相依。

export const ctx = {
  rerender() {},
  toast(_msg, _action) {},
  openDialog(_name) {},
  closeLayer() {},
  openPalette() {},
};
