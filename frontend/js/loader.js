/* =============================================
   StoreIQ Admin — Page Loader
   Loads HTML partials from /pages/ folder
   ============================================= */

(function () {
  "use strict";

  const PAGES = [
    { id: "login",     file: "/pages/page-login.html",     target: "loginTarget" },
    { id: "dashboard", file: "/pages/page-dashboard.html", target: "pageContent" },
    { id: "orders",    file: "/pages/page-orders.html",    target: "pageContent" },
    { id: "products",  file: "/pages/page-products.html",  target: "pageContent" },
    { id: "customers", file: "/pages/page-customers.html", target: "pageContent" },
    { id: "locations", file: "/pages/page-locations.html", target: "pageContent" },
    { id: "ai",        file: "/pages/page-ai.html",        target: "pageContent" },
    { id: "about",     file: "/pages/page-about.html",     target: "pageContent" },
  ];

  async function loadPartial(file) {
    let res = await fetch(file);
    if (!res.ok && file.startsWith("/")) {
      res = await fetch(file.slice(1));
    }
    if (!res.ok) throw new Error("Failed to load: " + file);
    return res.text();
  }

  async function loadAllPages() {
    try {
      // Load login page into its own slot
      const loginHtml = await loadPartial("/pages/page-login.html");
      document.getElementById("loginTarget").innerHTML = loginHtml;

      // Load all content pages into page-content slot
      const contentPages = PAGES.filter(p => p.id !== "login");
      const htmlParts = await Promise.all(contentPages.map(p => loadPartial(p.file)));
      document.getElementById("pageContent").innerHTML = htmlParts.join("\n");

      // Signal that DOM is ready for other scripts
      document.dispatchEvent(new Event("pagesLoaded"));
      window.dispatchEvent(new Event("pagesLoaded"));

    } catch (err) {
      console.error("[Loader] Error loading pages:", err);
    }
  }

  // Run immediately
  loadAllPages();

})();
