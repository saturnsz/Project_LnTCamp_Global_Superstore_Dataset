/* =============================================
   StoreIQ Admin — Auth System (Demo / No DB)
   ============================================= */

(function () {
  "use strict";

  /* Demo Credentials */
  const DEMO_USER = "admin";
  const SESSION_KEY = "storeiq_logged_in";

  let dropdownOpen = false;

  /* Init */
  document.addEventListener("DOMContentLoaded", function () {
    if (isLoggedIn()) {
      showApp();
    } else {
      showLogin();
    }
    document.addEventListener("click", function (e) {
      const wrap = document.getElementById("adminAvatarWrap");
      if (wrap && !wrap.contains(e.target)) closeDropdown();
    });
  });

  function isLoggedIn() {
    return sessionStorage.getItem(SESSION_KEY) === "true";
  }

  function showLogin() {
    const loginPage = document.getElementById("loginPage");
    const appLayout = document.querySelector(".app-layout");
    if (loginPage) loginPage.style.display = "flex";
    if (appLayout) appLayout.classList.add("hidden");
  }

  function showApp() {
    const loginPage = document.getElementById("loginPage");
    const appLayout = document.querySelector(".app-layout");
    if (loginPage) loginPage.style.display = "none";
    if (appLayout) appLayout.classList.remove("hidden");
  }

  window.handleLogin = function (e) {
    if (e) e.preventDefault();
    const usernameEl = document.getElementById("loginUsername");
    const passwordEl = document.getElementById("loginPassword");
    const errorEl    = document.getElementById("loginError");
    const btnEl      = document.getElementById("loginBtn");
    const username   = usernameEl ? usernameEl.value.trim() : "";
    const password   = passwordEl ? passwordEl.value : "";

    if (errorEl) errorEl.style.display = "none";

    if (!username || !password) {
      showLoginError(errorEl, "Harap isi semua field.");
      return;
    }
    if (username.toLowerCase() !== DEMO_USER) {
      showLoginError(errorEl, "Username tidak ditemukan. Gunakan: <strong>admin</strong>");
      return;
    }
    /* Demo: semua password diterima. Untuk strict: uncomment bawah
    if (password !== "123") { showLoginError(errorEl, "Password salah."); return; } */

    if (btnEl) { btnEl.textContent = "Signing in..."; btnEl.disabled = true; }

    setTimeout(function () {
      sessionStorage.setItem(SESSION_KEY, "true");
      showApp();
      if (typeof showToast === "function") showToast("Selamat datang, Admin! 👋", "success");
      if (btnEl) { btnEl.textContent = "Sign In"; btnEl.disabled = false; }
    }, 600);
  };

  window.handleLogout = function () {
    closeDropdown();
    sessionStorage.removeItem(SESSION_KEY);
    const u = document.getElementById("loginUsername");
    const p = document.getElementById("loginPassword");
    const er = document.getElementById("loginError");
    if (u) u.value = "";
    if (p) p.value = "";
    if (er) er.style.display = "none";
    showLogin();
  };

  window.toggleAdminDropdown = function () {
    dropdownOpen = !dropdownOpen;
    const dd = document.getElementById("adminDropdown");
    if (dd) dd.classList.toggle("open", dropdownOpen);
  };

  function closeDropdown() {
    dropdownOpen = false;
    const dd = document.getElementById("adminDropdown");
    if (dd) dd.classList.remove("open");
  }

  window.togglePasswordVisibility = function () {
    const input = document.getElementById("loginPassword");
    const icon  = document.getElementById("togglePwIcon");
    if (!input) return;
    if (input.type === "password") {
      input.type = "text";
      if (icon) { icon.classList.remove("fa-eye"); icon.classList.add("fa-eye-slash"); }
    } else {
      input.type = "password";
      if (icon) { icon.classList.remove("fa-eye-slash"); icon.classList.add("fa-eye"); }
    }
  };

  function showLoginError(el, msg) {
    if (!el) return;
    el.innerHTML = "<i class='fa-solid fa-circle-exclamation' style='margin-right:6px;'></i>" + msg;
    el.style.display = "block";
    el.style.animation = "none";
    el.offsetHeight;
    el.style.animation = "";
  }

})();
