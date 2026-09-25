export async function onRequestGet(context) {
  const env = context.env || {};
  return new Response(JSON.stringify({
    success: true,
    service: "PD One-Stop Hub API",
    message: "Cloudflare Pages Functions backend is running.",
    dbMode: env.DB_MODE || "gsheet",
    authMode: "mock-signed-session-token",
    timestamp: new Date().toISOString(),
    routes: {
      home: "/",
      trainee: "/trainee",
      client: "/client",
      health: "/api/health",
      sendOtp: "POST /api/auth/send-otp",
      verifyOtp: "POST /api/auth/verify-otp",
      clientInquiries: "GET /api/client/inquiries?email=...",
      clientProfile: "GET /api/client/profile?email=...",
      updateInquiry: "POST /api/client/inquiry/update",
      updateProfile: "POST /api/client/profile/update",
      sheetsDebug: "GET /api/debug/sheets",
      adminStatus: "GET /api/admin/status"
    },
    security: {
      protectedRoutes: "/api/client/* and /api/debug/*",
      header: "Authorization: Bearer <session_token>",
      note: "Set API_SESSION_SECRET in Cloudflare before production. Current mock uses dev fallback if not set."
    }
  }, null, 2), {
    headers: {
      "content-type": "application/json;charset=UTF-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}
