import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const ALLOWED_ORIGINS = new Set([
  "https://the-fitness-house-admin-panel.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

const PRODUCTION_FRONTEND_URL = "https://the-fitness-house-admin-panel.vercel.app";

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

interface InviteStaffPayload {
  action?: "invite" | "resend" | "revoke" | "accept";
  email?: string;
  fullName?: string;
  invitationId?: string;
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

  // Handle CORS preflight
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

    // 1. Authenticate caller using their JWT
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

    // 2. Parse and route action
    const body: InviteStaffPayload = await req.json();
    const action = body.action || "invite";
    const allowedRedirectOrigins = ALLOWED_ORIGINS;
    const redirectOrigin = requestOrigin && allowedRedirectOrigins.has(requestOrigin)
      ? requestOrigin
      : PRODUCTION_FRONTEND_URL;
    const redirectTo = `${redirectOrigin}/login`;

    // Initialize privileged admin client for GoTrue and service_role operations
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ──────────────────────────────────────────────────────────────────────────
    // ACTION: ACCEPT INVITATION (Authenticated Staff User Acceptance Workflow)
    // ──────────────────────────────────────────────────────────────────────────
    if (action === "accept") {
      // Execute the database RPC as the caller (so auth.uid() matches callerUser.id)
      const { data: acceptResult, error: acceptError } = await callerClient.rpc(
        "accept_staff_invitation"
      );

      if (acceptError) {
        return new Response(
          JSON.stringify({ error: acceptError.message || "Failed to accept staff invitation." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: "Invitation accepted successfully. Account is now active.",
          result: acceptResult,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // For administrative actions (invite, resend, revoke): verify caller is an active administrator
    const { data: isAdmin, error: adminCheckError } = await callerClient.rpc("is_admin");
    if (adminCheckError || !isAdmin) {
      return new Response(
        JSON.stringify({ error: "Forbidden: Only active administrators can manage staff invitations." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ──────────────────────────────────────────────────────────────────────────
    // ACTION: RESEND INVITATION
    // ──────────────────────────────────────────────────────────────────────────
    if (action === "resend") {
      const invitationId = body.invitationId;
      if (!invitationId) {
        return new Response(
          JSON.stringify({ error: "Invitation ID is required to resend." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 1. Call atomic database RPC resend_staff_invitation
      const { data: resendData, error: resendRpcError } = await callerClient.rpc(
        "resend_staff_invitation",
        { p_invitation_id: invitationId }
      );

      if (resendRpcError) {
        return new Response(
          JSON.stringify({ error: resendRpcError.message || "Failed to renew invitation." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 2. Actually dispatch the invitation email via GoTrue Admin API
      const { data: authInviteData, error: authInviteError } =
        await adminClient.auth.admin.inviteUserByEmail(resendData.email, {
          data: { full_name: resendData.full_name },
          redirectTo,
        });

      if (authInviteError) {
        return new Response(
          JSON.stringify({ error: "Failed to dispatch invitation email: " + authInviteError.message }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 3. Log security audit event
      const { error: auditError } = await adminClient.from("security_audit_logs").insert({
        actor_id: callerUser.id,
        target_user_id: authInviteData?.user?.id || null,
        action: "invitation_resent",
        details: {
          invitation_id: invitationId,
          email: resendData.email,
          new_expires_at: resendData.expires_at,
        },
      });
      if (auditError) {
        return new Response(
          JSON.stringify({ error: "Invitation email was sent, but its delivery audit record could not be saved. Review security audit logging before retrying.", partialSuccess: true, invitationId }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: `Invitation email resent successfully to ${resendData.email}.`,
          expiresAt: resendData.expires_at,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ──────────────────────────────────────────────────────────────────────────
    // ACTION: REVOKE INVITATION
    // ──────────────────────────────────────────────────────────────────────────
    if (action === "revoke") {
      const invitationId = body.invitationId;
      if (!invitationId) {
        return new Response(
          JSON.stringify({ error: "Invitation ID is required to revoke." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Call atomic database RPC revoke_staff_invitation
      const { data: revokeData, error: revokeRpcError } = await callerClient.rpc(
        "revoke_staff_invitation",
        { p_invitation_id: invitationId }
      );

      if (revokeRpcError) {
        return new Response(
          JSON.stringify({ error: revokeRpcError.message || "Failed to revoke invitation." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: `Invitation for ${revokeData.email || 'staff member'} has been revoked.`,
          result: revokeData,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ──────────────────────────────────────────────────────────────────────────
    // ACTION: INVITE (CREATE AND DISPATCH)
    // ──────────────────────────────────────────────────────────────────────────
    const email = body.email ? body.email.trim().toLowerCase() : "";
    const fullName = body.fullName ? body.fullName.trim() : "";

    if (!email) {
      return new Response(
        JSON.stringify({ error: "Email address is required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ error: "Please provide a valid email address." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!fullName || fullName.length < 2) {
      return new Response(
        JSON.stringify({ error: "Staff member's full name is required (minimum 2 characters)." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Call atomic database RPC create_staff_invitation
    const { data: createdInvite, error: createRpcError } = await callerClient.rpc(
      "create_staff_invitation",
      {
        p_email: email,
        p_full_name: fullName,
      }
    );

    if (createRpcError) {
      const isDuplicate = createRpcError.message.includes("23505") || createRpcError.message.includes("DUPLICATE") || createRpcError.message.includes("ALREADY_EXISTS");
      return new Response(
        JSON.stringify({ error: createRpcError.message.replace(/.*?:\s*/, "") }),
        { status: isDuplicate ? 409 : 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Dispatch official invitation email via GoTrue Admin API
    const { data: authInviteData, error: authInviteError } =
      await adminClient.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName },
        redirectTo,
      });

    if (authInviteError) {
      // Revert/rollback invitation record so no orphaned pending invite exists
      const { error: revokeError } = await callerClient.rpc("revoke_staff_invitation", { p_invitation_id: createdInvite.id });

      return new Response(
        JSON.stringify({
          error: revokeError
            ? "Invitation email dispatch failed and the pending invitation could not be revoked. Administrator action is required."
            : "Failed to dispatch invitation email: " + authInviteError.message,
          invitationId: createdInvite.id,
          cleanupSucceeded: !revokeError,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Record audit log for the external Auth email dispatch.
    const { error: auditError } = await adminClient.from("security_audit_logs").insert({
      actor_id: callerUser.id,
      target_user_id: authInviteData?.user?.id || null,
      action: "staff_invited",
      details: {
        email,
        full_name: fullName,
        role: "staff",
        invitation_id: createdInvite.id,
      },
    });
    if (auditError) {
      return new Response(
        JSON.stringify({ error: "Invitation email was sent, but its delivery audit record could not be saved. Review security audit logging before retrying.", invitationId: createdInvite.id, partialSuccess: true }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Invitation successfully sent to ${email}.`,
        invitation: {
          id: createdInvite.id,
          email: createdInvite.email,
          fullName: createdInvite.full_name,
          role: createdInvite.role,
          status: createdInvite.status,
          expiresAt: createdInvite.expires_at,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
