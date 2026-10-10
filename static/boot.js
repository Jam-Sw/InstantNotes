(function () {
  try {
    var raw = localStorage.getItem("instantnotes.boot");
    if (!raw) return;
    var snapshot = JSON.parse(raw);
    var dark =
      snapshot.mode === "dark" ||
      (snapshot.mode !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    var palette = dark ? snapshot.dark : snapshot.light;
    var root = document.documentElement;
    for (var name in palette.vars) root.style.setProperty(name, palette.vars[name]);
    root.dataset.theme = snapshot.themeId;
    root.dataset.variant = palette.variant;
    if (snapshot.bodyFont) root.style.setProperty("--font-body", snapshot.bodyFont);
  } catch (e) {}
})();
