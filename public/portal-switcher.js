/**
 * portal-switcher.js
 * Injects a multi-portal switcher pill into .pd-oce-header if the logged-in user possesses multiple roles.
 */
(function() {
  function initPortalSwitcher() {
    try {
      const rolesJson = localStorage.getItem("userRoles");
      if (!rolesJson) return;
      const roles = JSON.parse(rolesJson);
      if (!Array.isArray(roles) || roles.length <= 1) return;

      const headerInner = document.querySelector(".pd-oce-header-inner");
      if (!headerInner || document.getElementById("portalSwitcherDropdown")) return;

      const currentPath = window.location.pathname.toLowerCase();
      let activePortalLabel = "Portals";
      if (currentPath.includes("trainee")) activePortalLabel = "🎓 Trainee";
      else if (currentPath.includes("client")) activePortalLabel = "🏢 Client";
      else if (currentPath.includes("report")) activePortalLabel = "📊 Report";
      else if (currentPath.includes("admin")) activePortalLabel = "🛡️ Admin";

      const wrapper = document.createElement("div");
      wrapper.id = "portalSwitcherDropdown";
      wrapper.className = "dropdown ms-auto";
      wrapper.style.zIndex = "10050";

      let itemsHtml = "";
      if (roles.includes("trainee")) {
        itemsHtml += `<li><a class="dropdown-item ${currentPath.includes('trainee') ? 'active' : ''}" href="/trainee" style="font-size:13px; font-weight:500;"><i class="fas fa-user-graduate me-2 text-primary"></i>Trainee Portal</a></li>`;
      }
      if (roles.includes("client")) {
        itemsHtml += `<li><a class="dropdown-item ${currentPath.includes('client') ? 'active' : ''}" href="/client" style="font-size:13px; font-weight:500;"><i class="fas fa-building me-2 text-info"></i>Client Portal</a></li>`;
      }
      if (roles.includes("report_viewer") || roles.includes("admin") || roles.includes("super_user")) {
        itemsHtml += `<li><a class="dropdown-item ${currentPath.includes('report') ? 'active' : ''}" href="/report.html" style="font-size:13px; font-weight:500;"><i class="fas fa-chart-line me-2 text-success"></i>Report Dashboard</a></li>`;
      }
      if (roles.includes("admin") || roles.includes("super_user")) {
        itemsHtml += `<li><a class="dropdown-item ${currentPath.includes('admin') ? 'active' : ''}" href="/admin" style="font-size:13px; font-weight:500;"><i class="fas fa-user-shield me-2 text-danger"></i>Admin Portal</a></li>`;
      }

      wrapper.innerHTML = `
        <button class="btn btn-sm btn-outline-light dropdown-toggle d-flex align-items-center gap-1 shadow-sm" type="button" data-bs-toggle="dropdown" aria-expanded="false" style="border-radius:20px; padding:4px 12px; font-size:12px; font-weight:600; background:rgba(255,255,255,0.12); border-color:rgba(255,255,255,0.25);">
          <i class="fas fa-th-large me-1"></i>
          <span>${activePortalLabel}</span>
        </button>
        <ul class="dropdown-menu dropdown-menu-end shadow-lg" style="border-radius:12px; border:1px solid rgba(0,0,0,0.08); padding:6px 0; min-width:180px;">
          <li class="dropdown-header text-uppercase" style="font-size:10px; font-weight:700; letter-spacing:0.5px;">Switch Portal</li>
          ${itemsHtml}
        </ul>
      `;

      headerInner.appendChild(wrapper);
    } catch (e) {
      console.warn("Portal switcher init note:", e);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPortalSwitcher);
  } else {
    initPortalSwitcher();
  }
})();
