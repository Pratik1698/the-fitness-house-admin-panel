import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const ALLOWED_ORIGINS = new Set([
  "https://the-fitness-house-admin-panel-696c.vercel.app",
  "https://the-fitness-house-admin-panel.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

const PRODUCTION_FRONTEND_URL = "https://the-fitness-house-admin-panel-696c.vercel.app";

function getCorsHeaders(requestOrigin: string | null): Record<string, string> {
  const isAllowed = requestOrigin && ALLOWED_ORIGINS.has(requestOrigin);
  const originHeader = isAllowed
    ? requestOrigin
    : PRODUCTION_FRONTEND_URL;
  return {
    "Access-Control-Allow-Origin": originHeader,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

interface ManageSessionPayload {
  targetUserId: string;
  action: "deactivate_and_revoke" | "reactivate";
}

serve(async (req: Request) => {
  const requestOrigin = req.headers.get("origin");

  // Reject unapproved browser origins immediately
  if (requestOrigin && !ALLOWED_ORIGINS.has(requestOrigin)) {
    return new Response(
      JSON.stringify({ error: "Forbidden: Origin not allowed by CORS policy." }),
      {
        status: 403,
        headers: {
          "Content-Type": "application/json",
          "Vary": "Origin",
        },
      }
    );
  }

  const corsHeaders = getCorsHeaders(requestOrigin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      return new Response(
        JSON.stringify({ error: "Server configuration missing required environment variables." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Authenticate caller
    const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const {
      data: { user: callerUser },
      error: callerError,
    } = await callerClient.auth.getUser();

    if (callerError || !callerUser) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Invalid or expired session." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Authorize caller via is_admin RPC
    const { data: isAdmin, error: adminCheckError } = await callerClient.rpc("is_admin");
    if (adminCheckError || !isAdmin) {
      return new Response(
        JSON.stringify({ error: "Forbidden: Only active administrators can manage staff sessions." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Parse payload
    const body: ManageSessionPayload = await req.json();
    const { targetUserId, action } = body;

    if (!targetUserId) {
      return new Response(
        JSON.stringify({ error: "Target user ID is required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Prevent self-deactivation or self-session disruption
    if (targetUserId === callerUser.id && action !== "reactivate") {
      return new Response(
        JSON.stringify({ error: "Invalid operation: Administrators cannot revoke or deactivate their own account." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 4. Handle requested action
    if (action === "deactivate_and_revoke") {
      // Step A: Update database profile using admin_set_user_status RPC
      const { data: dbResult, error: dbError } = await callerClient.rpc("admin_set_user_status", {
        p_user_id: targetUserId,
        p_is_active: false,
      });

      if (dbError) {
        return new Response(
          JSON.stringify({ error: "Failed to deactivate account: " + dbError.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Step B: GoTrue refresh-token revocation via official user ban API
      let gotrueBanSucceeded = false;
      let gotrueBanErrorMsg: string | null = null;

      try {
        const { error: banError } = await adminClient.auth.admin.updateUserById(targetUserId, {
          ban_duration: "876000h", // 100-year ban invalidates refresh tokens and blocks future logins
        });

        if (banError) {
          gotrueBanSucceeded = false;
          gotrueBanErrorMsg = banError.message;
        } else {
          gotrueBanSucceeded = true;
        }
      } catch (err) {
        gotrueBanSucceeded = false;
        gotrueBanErrorMsg = err instanceof Error ? err.message : String(err);
      }

      // Step C: Session sign-out tracking
      // NOTE: Explicit target-JWT sign-out is not supported: an administrator cannot safely
      // possess another user's personal JWT from the browser. Deactivation relies on database RLS revocation
      // (is_active = false across all tables) and GoTrue account ban (refresh token invalidation).
      const globalSignOutAttempted = false;
      const globalSignOutSucceeded = false;
      const globalSignOutErrorMsg: string | null = null;

      // Step D: Log security audit entry with transparent details
      let auditLogSucceeded = false;
      let auditLogErrorMsg: string | null = null;

      try {
        const { error: auditError } = await adminClient.from("security_audit_logs").insert({
          actor_id: callerUser.id,
          target_user_id: targetUserId,
          action: gotrueBanSucceeded
            ? "account_deactivated_and_banned"
            : "account_deactivated_ban_failed",
          details: {
            targetUserId,
            dbStatusDeactivated: true,
            gotrueBanSucceeded,
            gotrueBanErrorMsg,
            globalSignOutAttempted,
            globalSignOutSucceeded,
            globalSignOutErrorMsg,
            reason: "Account deactivation by administrator",
            tokenNotice: "Database access is blocked immediately via is_active = false across all RLS gates.",
          },
        });

        if (auditError) {
          auditLogSucceeded = false;
          auditLogErrorMsg = auditError.message;
        } else {
          auditLogSucceeded = true;
        }
      } catch (err) {
        auditLogSucceeded = false;
        auditLogErrorMsg = err instanceof Error ? err.message : String(err);
      }

      // Step E: Handle failures transparently without false claims of rollback

      // 1. Audit logging failure: never silently report success when mandatory audit failed
      if (!auditLogSucceeded) {
        return new Response(
          JSON.stringify({
            error: `Account status was deactivated in database${gotrueBanSucceeded ? " and login ban applied in GoTrue" : ""}, but mandatory security audit logging failed: ${auditLogErrorMsg}. Please check audit logs.`,
            dbDeactivated: true,
            gotrueBanSucceeded,
            globalSignOutAttempted,
            globalSignOutSucceeded,
            auditLogSucceeded: false,
            result: dbResult,
          }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 2. GoTrue ban failure
      if (!gotrueBanSucceeded) {
        return new Response(
          JSON.stringify({
            error: `Account was deactivated in database (database access is blocked), but GoTrue refresh-token ban failed: ${gotrueBanErrorMsg}. Please retry or check Supabase Auth logs.`,
            dbDeactivated: true,
            gotrueBanSucceeded: false,
            globalSignOutAttempted,
            globalSignOutSucceeded,
            auditLogSucceeded: true,
            result: dbResult,
          }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 3. Both GoTrue ban and audit succeeded. Report actual verified outcomes:
      const userMessage =
        "Account deactivated in database and login ban applied in GoTrue. Database access is blocked immediately via RLS and token refresh is prohibited.";

      return new Response(
        JSON.stringify({
          success: true,
          globalSignOutAttempted: false,
          globalSignOutSucceeded: false,
          gotrueBanSucceeded: true,
          auditLogSucceeded: true,
          message: userMessage,
          result: dbResult,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "reactivate") {
      // Step A: Update database profile using admin_set_user_status RPC
      const { data: dbResult, error: dbError } = await callerClient.rpc("admin_set_user_status", {
        p_user_id: targetUserId,
        p_is_active: true,
      });

      if (dbError) {
        return new Response(
          JSON.stringify({ error: "Failed to reactivate account: " + dbError.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Step B: Lift GoTrue user ban to restore login and refresh-token capabilities
      let gotrueUnbanSucceeded = false;
      let gotrueUnbanErrorMsg: string | null = null;

      try {
        const { error: unbanError } = await adminClient.auth.admin.updateUserById(targetUserId, {
          ban_duration: "none", // Removes the ban in Supabase GoTrue
        });

        if (unbanError) {
          gotrueUnbanSucceeded = false;
          gotrueUnbanErrorMsg = unbanError.message;
        } else {
          gotrueUnbanSucceeded = true;
        }
      } catch (err) {
        gotrueUnbanSucceeded = false;
        gotrueUnbanErrorMsg = err instanceof Error ? err.message : String(err);
      }

      // Step C: Log security audit entry
      let auditLogSucceeded = false;
      let auditLogErrorMsg: string | null = null;

      try {
        const { error: auditError } = await adminClient.from("security_audit_logs").insert({
          actor_id: callerUser.id,
          target_user_id: targetUserId,
          action: gotrueUnbanSucceeded
            ? "account_reactivated_and_unbanned"
            : "account_reactivated_unban_failed",
          details: {
            targetUserId,
            dbStatusActive: true,
            gotrueUnbanSucceeded,
            gotrueUnbanErrorMsg,
            reason: "Account reactivation by administrator",
          },
        });

        if (auditError) {
          auditLogSucceeded = false;
          auditLogErrorMsg = auditError.message;
        } else {
          auditLogSucceeded = true;
        }
      } catch (err) {
        auditLogSucceeded = false;
        auditLogErrorMsg = err instanceof Error ? err.message : String(err);
      }

      // Step D: Handle failures transparently without false claims of rollback

      // 1. Audit logging failure: never silently report success when mandatory audit failed
      if (!auditLogSucceeded) {
        return new Response(
          JSON.stringify({
            error: `Account status was reactivated in database${gotrueUnbanSucceeded ? " and GoTrue login ban lifted" : ""}, but mandatory security audit logging failed: ${auditLogErrorMsg}. Please check audit logs.`,
            dbReactivated: true,
            gotrueUnbanSucceeded,
            auditLogSucceeded: false,
            result: dbResult,
          }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 2. GoTrue unban failure
      if (!gotrueUnbanSucceeded) {
        return new Response(
          JSON.stringify({
            error: `Account was reactivated in database, but lifting the GoTrue login ban failed: ${gotrueUnbanErrorMsg}. Please retry or check Supabase Auth logs.`,
            dbReactivated: true,
            gotrueUnbanSucceeded: false,
            auditLogSucceeded: true,
            result: dbResult,
          }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 3. Both unban and audit succeeded
      return new Response(
        JSON.stringify({
          success: true,
          gotrueUnbanSucceeded: true,
          auditLogSucceeded: true,
          message: "Account reactivated successfully and GoTrue login ban lifted.",
          result: dbResult,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action. Supported: 'deactivate_and_revoke', 'reactivate'." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
