/**
 * portal-switcher.js
 * Injects a standalone, autonomous multi-portal switcher pill into .pd-oce-header
 * if the logged-in user possesses multiple roles.
 * Zero dependency on Bootstrap CSS or JS.
 */
(function() {
  function initPortalSwitcher() {
    try {
      const rolesJson = localStorage.getItem("userRoles");
      if (!rolesJson) return;
      let roles = [];
      try { roles = JSON.parse(rolesJson); } catch (_) { return; }
      if (!Array.isArray(roles) || roles.length <= 1) return;

      const headerInner = document.querySelector(".pd-oce-header-inner");
      if (!headerInner || document.getElementById("portalSwitcherDropdown")) return;

      // Inject standalone CSS once
      if (!document.getElementById("portalSwitcherStyles")) {
        const style = document.createElement("style");
        style.id = "portalSwitcherStyles";
        style.textContent = `
          .pd-oce-header-inner .pd-oce-dept {
            margin-left: auto;
            margin-right: 14px;
          }
          #portalSwitcherDropdown {
            position: relative;
            margin-left: 0;
            display: inline-flex;
            align-items: center;
            z-index: 10050;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          }
          @media (max-width: 576px) {
            .pd-oce-header-inner .pd-oce-dept {
              display: none;
            }
            #portalSwitcherDropdown {
              margin-left: auto;
            }
          }
          #portalSwitcherBtn {
            display: inline-flex;
            align-items: center;
            gap: 7px;
            padding: 5px 13px;
            font-size: 12px;
            font-weight: 600;
            color: #ffffff;
            background: rgba(255, 255, 255, 0.16);
            border: 1px solid rgba(255, 255, 255, 0.35);
            border-radius: 9999px;
            cursor: pointer;
            text-decoration: none;
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            transition: all 0.15s ease;
            box-shadow: 0 1px 3px rgba(0,0,0,0.15);
            line-height: 1.3;
          }
          #portalSwitcherBtn:hover {
            background: rgba(255, 255, 255, 0.28);
            border-color: rgba(255, 255, 255, 0.55);
            transform: translateY(-1px);
          }
          #portalSwitcherMenu {
            display: none;
            position: absolute;
            right: 0;
            top: calc(100% + 8px);
            background: #ffffff;
            color: #0f172a;
            border-radius: 12px;
            border: 1px solid rgba(0, 0, 0, 0.08);
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.18), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
            min-width: 195px;
            padding: 6px;
            margin: 0;
            list-style: none !important;
            z-index: 10060;
          }
          #portalSwitcherMenu, #portalSwitcherMenu li {
            list-style: none !important;
            margin: 0;
            padding: 0;
          }
          #portalSwitcherMenu.show {
            display: block;
            animation: psFadeIn 0.15s ease-out;
          }
          @keyframes psFadeIn {
            from { opacity: 0; transform: translateY(-4px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .ps-header {
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.6px;
            color: #64748b;
            padding: 6px 10px 4px;
            border-bottom: 1px solid #f1f5f9;
            margin-bottom: 4px;
            list-style: none;
          }
          .ps-item {
            display: flex;
            align-items: center;
            gap: 9px;
            padding: 8px 10px;
            font-size: 13px;
            font-weight: 500;
            color: #1e293b;
            text-decoration: none;
            border-radius: 8px;
            transition: background 0.12s ease, color 0.12s ease;
            list-style: none;
          }
          .ps-item:hover {
            background: #f1f5f9;
            color: #003087;
          }
          .ps-item.active {
            background: #e0f2fe;
            color: #0369a1;
            font-weight: 600;
          }
        `;
        document.head.appendChild(style);
      }

      const currentPath = window.location.pathname.toLowerCase();
      let activePortalLabel = "Portals";
      if (currentPath.includes("trainee")) activePortalLabel = "🎓 Trainee";
      else if (currentPath.includes("client")) activePortalLabel = "🏢 Client";
      else if (currentPath.includes("report")) activePortalLabel = "📊 Report";
      else if (currentPath.includes("admin")) activePortalLabel = "🛡️ Admin";

      const wrapper = document.createElement("div");
      wrapper.id = "portalSwitcherDropdown";

      let itemsHtml = "";
      if (roles.includes("trainee")) {
        itemsHtml += `<li><a class="ps-item ${currentPath.includes('trainee') ? 'active' : ''}" href="/trainee"><i class="fas fa-user-graduate" style="color:#2563eb; width:16px; text-align:center;"></i><span>Trainee Portal</span></a></li>`;
      }
      if (roles.includes("client")) {
        itemsHtml += `<li><a class="ps-item ${currentPath.includes('client') ? 'active' : ''}" href="/client"><i class="fas fa-building" style="color:#0284c7; width:16px; text-align:center;"></i><span>Client Portal</span></a></li>`;
      }
      if (roles.includes("report_viewer") || roles.includes("admin") || roles.includes("super_user")) {
        itemsHtml += `<li><a class="ps-item ${currentPath.includes('report') ? 'active' : ''}" href="/report.html"><i class="fas fa-chart-line" style="color:#16a34a; width:16px; text-align:center;"></i><span>Report Dashboard</span></a></li>`;
      }
      if (roles.includes("admin") || roles.includes("super_user")) {
        itemsHtml += `<li><a class="ps-item ${currentPath.includes('admin') ? 'active' : ''}" href="/admin"><i class="fas fa-user-shield" style="color:#dc2626; width:16px; text-align:center;"></i><span>Admin Portal</span></a></li>`;
      }

      wrapper.innerHTML = `
        <button id="portalSwitcherBtn" type="button" aria-expanded="false" title="Switch between portals">
          <i class="fas fa-th-large" style="font-size:11px;"></i>
          <span>${activePortalLabel}</span>
          <i class="fas fa-chevron-down" style="font-size:9px; opacity:0.8; margin-left:1px;"></i>
        </button>
        <ul id="portalSwitcherMenu">
          <li class="ps-header">Switch Portal</li>
          ${itemsHtml}
        </ul>
      `;

      headerInner.appendChild(wrapper);

      const btn = wrapper.querySelector("#portalSwitcherBtn");
      const menu = wrapper.querySelector("#portalSwitcherMenu");

      btn.addEventListener("click", function(e) {
        e.stopPropagation();
        const isOpen = menu.classList.contains("show");
        menu.classList.toggle("show");
        btn.setAttribute("aria-expanded", String(!isOpen));
      });

      document.addEventListener("click", function(e) {
        if (!wrapper.contains(e.target)) {
          menu.classList.remove("show");
          btn.setAttribute("aria-expanded", "false");
        }
      });
    } catch (e) {
      console.warn("Portal switcher init note:", e);
    }
  }

  // Global helper to wipe sessions across all portals cleanly on logout
  window.clearMultiPortalSession = function() {
    try {
      const keysToClear = [
        "pdhub_admin_token", "pdhub_admin_exp", "pdhub_admin_email", "pdhub_admin_role",
        "pdhub_report_token", "pdhub_report_exp", "pdhub_report_email", "pdhub_report_role",
        "pdc_trainee_token", "pdc_email",
        "pdhub_session_token", "pdhub_session_email", "pdhub_session_time", "pdhub_session_expires_at",
        "adminSessionToken", "sessionToken", "userRoles", "userEmail", "traineeEmail", "clientEmail", "adminEmail"
      ];
      keysToClear.forEach(k => {
        try { localStorage.removeItem(k); } catch (_) {}
        try { sessionStorage.removeItem(k); } catch (_) {}
      });

      // Clear cookies
      document.cookie = "pd_session=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      document.cookie = "pd_user=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    } catch (err) {
      console.warn("clearMultiPortalSession note:", err);
    }
  };

  // Global helper to sync multi-role session after PIN/OTP login
  window.syncMultiPortalSession = function(data) {
    if (!data || !data.token) return;
    try {
      const email = data.email || "";
      const token = data.token;
      const expiresAt = data.expiresAt || new Date(Date.now() + 8 * 3600 * 1000).toISOString();
      const roles = Array.isArray(data.roles) ? data.roles : [data.role || data.scope || "trainee"];

      localStorage.setItem("sessionToken", token);
      localStorage.setItem("userEmail", email);
      localStorage.setItem("userRoles", JSON.stringify(roles));

      if (roles.includes("admin") || roles.includes("super_user")) {
        localStorage.setItem("adminSessionToken", token);
        localStorage.setItem("adminEmail", email);
        localStorage.setItem("pdhub_admin_token", token);
        localStorage.setItem("pdhub_admin_exp", expiresAt);
        localStorage.setItem("pdhub_admin_email", email);
        localStorage.setItem("pdhub_admin_role", roles.includes("super_user") ? "super_user" : "admin");
      }
      if (roles.includes("report_viewer") || roles.includes("admin") || roles.includes("super_user")) {
        localStorage.setItem("pdhub_report_token", token);
        localStorage.setItem("pdhub_report_exp", expiresAt);
        localStorage.setItem("pdhub_report_email", email);
        localStorage.setItem("pdhub_report_role", roles.includes("super_user") ? "super_user" : roles.includes("admin") ? "admin" : "report_viewer");
      }
      if (roles.includes("trainee")) {
        localStorage.setItem("pdc_trainee_token", token);
        localStorage.setItem("pdc_email", email);
      }
      if (roles.includes("client")) {
        localStorage.setItem("pdhub_session_token", token);
        localStorage.setItem("pdhub_session_email", email);
        localStorage.setItem("pdhub_session_time", Date.now().toString());
        localStorage.setItem("pdhub_session_expires_at", expiresAt);
      }
    } catch (e) {
      console.warn("syncMultiPortalSession note:", e);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPortalSwitcher);
  } else {
    initPortalSwitcher();
  }
})();
