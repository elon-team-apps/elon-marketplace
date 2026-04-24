import type { SupabaseClient } from "@supabase/supabase-js";

type DbError = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

export function asPositiveInt(value: unknown, fallback = 0): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

export function formatDbError(error: DbError | null | undefined): string {
  if (!error) return "Unknown database error.";
  return [
    error.message ? `message=${error.message}` : "",
    error.code ? `code=${error.code}` : "",
    error.details ? `details=${error.details}` : "",
    error.hint ? `hint=${error.hint}` : "",
  ].filter(Boolean).join(" | ") || "Unknown database error.";
}

function formatDeliveredLog(row: {
  email?: string | null;
  password?: string | null;
  recovery?: string | null;
  credentials?: string | null;
}): string {
  const raw = String(row.credentials ?? "").trim();
  if (raw) return raw;

  const email = String(row.email ?? "").trim();
  const password = String(row.password ?? "").trim();
  const recovery = String(row.recovery ?? "").trim();
  if (email && password) return `${email}:${password}:${recovery}`;
  return "";
}

export async function processSuccessfulTransaction(
  supabaseAdmin: SupabaseClient,
  transactionId: string,
  amountNairaRaw: unknown,
  options?: { allowRecoveryForCompletedWithoutDelivery?: boolean },
) {
  const { data: tx, error: txError } = await supabaseAdmin
    .from("transactions")
    .select("id, user_id, product_id, amount, status, quantity, reference, delivered_data")
    .eq("id", transactionId)
    .maybeSingle();
  if (txError) return { ok: false, status: 500, error: `Failed to fetch transaction: ${formatDbError(txError)}` };
  if (!tx) return { ok: false, status: 404, error: "Transaction was not found." };
  const existingDeliveredData = String(tx.delivered_data ?? "").trim();
  const statusValue = String(tx.status ?? "").toLowerCase();
  const allowRecovery = options?.allowRecoveryForCompletedWithoutDelivery === true;
  const isFulfilledStatus = statusValue === "completed" || statusValue === "success" || statusValue === "finalized";
  if (isFulfilledStatus && (!allowRecovery || existingDeliveredData)) {
    return { ok: true, status: 200, data: { ok: true, message: "Already fulfilled.", idempotent: true } };
  }
  if (!tx.product_id) return { ok: false, status: 400, error: "Transaction has no product_id." };

  const quantity = Math.max(1, asPositiveInt(tx.quantity, 1));
  const amountNaira = Math.max(0, asPositiveInt(amountNairaRaw, 0)) || asPositiveInt(tx.amount, 0);

  if (isFulfilledStatus && allowRecovery && !existingDeliveredData) {
    const soldLogsPrimary = await supabaseAdmin
      .from("log_items")
      .select("id, credentials, email, password, recovery")
      .eq("product_id", tx.product_id)
      .eq("buyer_id", tx.user_id)
      .eq("is_delivered", true)
      .order("created_at", { ascending: true })
      .limit(quantity);
    if (soldLogsPrimary.error) {
      return { ok: false, status: 500, error: `Failed to recover sold logs: ${formatDbError(soldLogsPrimary.error)}` };
    }
    const soldLogsFallback =
      (soldLogsPrimary.data?.length ?? 0) > 0
        ? soldLogsPrimary
        : await supabaseAdmin
            .from("log_items")
            .select("id, credentials, email, password, recovery")
            .eq("product_id", tx.product_id)
            .eq("buyer_id", tx.user_id)
            .in("status", ["sold", "delivered"])
            .order("created_at", { ascending: true })
            .limit(quantity);
    if (soldLogsFallback.error) {
      return { ok: false, status: 500, error: `Failed to recover fallback sold logs: ${formatDbError(soldLogsFallback.error)}` };
    }
    const recoveredLines = (soldLogsFallback.data ?? [])
      .map((row) => formatDeliveredLog(row as {
        email?: string | null;
        password?: string | null;
        recovery?: string | null;
        credentials?: string | null;
      }))
      .filter(Boolean);
    if (recoveredLines.length > 0) {
      const recoveredData = recoveredLines.join("\n");
      const recoverTx = await supabaseAdmin
        .from("transactions")
        .update({
          delivered_data: recoveredData,
          credentials_delivered: true,
          status: "completed",
          amount: amountNaira > 0 ? amountNaira : tx.amount,
        })
        .eq("id", tx.id);
      if (recoverTx.error) {
        return { ok: false, status: 500, error: `Failed to save recovered delivered_data: ${formatDbError(recoverTx.error)}` };
      }
      return {
        ok: true,
        status: 200,
        data: {
          ok: true,
          processed: true,
          recovered: true,
          transactionId: tx.id,
          reference: tx.reference,
          delivered_logs: recoveredLines.length,
          manual_units_used: Math.max(0, quantity - recoveredLines.length),
          delivered_data: recoveredLines,
        },
      };
    }
  }

  const { data: product, error: productError } = await supabaseAdmin
    .from("products")
    .select("id, stock, status, manual_stock")
    .eq("id", tx.product_id)
    .maybeSingle();
  if (productError || !product) {
    return { ok: false, status: 500, error: `Failed to fetch product for fulfillment: ${formatDbError(productError)}` };
  }

  const manualStock = Math.max(0, asPositiveInt(product.manual_stock, 0));
  const { count: rawAvailableLogCount, error: countError } = await supabaseAdmin
    .from("log_items")
    .select("id", { count: "exact", head: true })
    .eq("product_id", tx.product_id)
    .eq("status", "available")
    .eq("is_delivered", false);
  if (countError && manualStock < quantity) {
    return { ok: false, status: 500, error: `Failed to count available logs: ${formatDbError(countError)}` };
  }
  const availableLogCount = countError ? 0 : Math.max(0, Number(rawAvailableLogCount ?? 0));
  if (availableLogCount + manualStock < quantity) {
    return {
      ok: false,
      status: 409,
      error: `Insufficient stock. available_logs=${availableLogCount}, manual_stock=${manualStock}, requested=${quantity}`,
    };
  }

  if (availableLogCount === 0 && manualStock >= quantity) {
    const pendingManual = await supabaseAdmin
      .from("transactions")
      .update({
        status: "pending_manual",
        credentials_delivered: false,
        delivered_data: "",
        amount: amountNaira > 0 ? amountNaira : tx.amount,
      })
      .eq("id", tx.id);
    if (pendingManual.error) {
      return { ok: false, status: 500, error: `Failed to set pending manual fulfillment: ${formatDbError(pendingManual.error)}` };
    }
    const manualOnlyStock = Math.max(0, manualStock - quantity);
    const currentStock = Math.max(0, asPositiveInt(product.stock, 0));
    const nextStock = Math.max(0, currentStock - quantity);
    const nextStatus = manualOnlyStock > 0 ? "available" : "sold_out";
    const manualProductUpdate = await supabaseAdmin
      .from("products")
      .update({ manual_stock: manualOnlyStock, stock: nextStock, status: nextStatus })
      .eq("id", tx.product_id);
    if (manualProductUpdate.error) {
      return { ok: false, status: 500, error: `Failed to decrement manual stock: ${formatDbError(manualProductUpdate.error)}` };
    }
    return {
      ok: true,
      status: 200,
      data: {
        ok: true,
        processed: true,
        transactionId: tx.id,
        reference: tx.reference,
        delivered_logs: 0,
        manual_units_used: quantity,
        pending_manual: true,
        delivered_data: [],
      },
    };
  }

  const { data: availableLogs, error: logFetchError } = await supabaseAdmin
    .from("log_items")
    .select("id, credentials, email, password, recovery")
    .eq("product_id", tx.product_id)
    .eq("status", "available")
    .eq("is_delivered", false)
    .order("created_at", { ascending: true })
    .limit(quantity);
  if (logFetchError && manualStock < quantity) {
    return { ok: false, status: 500, error: `Failed to fetch logs for fulfillment: ${formatDbError(logFetchError)}` };
  }
  const logsToDeliver = (availableLogs ?? []) as Array<{
    id: string;
    credentials: string | null;
    email: string | null;
    password: string | null;
    recovery: string | null;
  }>;

  const fromLogs = Math.min(logsToDeliver.length, quantity);
  const fromManual = quantity - fromLogs;
  if (fromManual > manualStock) {
    return { ok: false, status: 409, error: `Insufficient stock. needed_manual=${fromManual}, manual_stock=${manualStock}` };
  }

  if (fromLogs > 0) {
    const logIds = logsToDeliver.slice(0, fromLogs).map((row) => row.id);
    const { error } = await supabaseAdmin
      .from("log_items")
      .update({ is_delivered: true, status: "sold", buyer_id: tx.user_id })
      .in("id", logIds);
    if (error) return { ok: false, status: 500, error: `Failed to mark sold logs: ${formatDbError(error)}` };
  }

  const newManualStock = manualStock - fromManual;
  const currentStock = Math.max(0, asPositiveInt(product.stock, 0));
  const nextStock = Math.max(0, currentStock - quantity);
  const nextStatus = (Math.max(0, availableLogCount - fromLogs) + newManualStock) > 0 ? "available" : "sold_out";
  const { error: productUpdateError } = await supabaseAdmin
    .from("products")
    .update({ manual_stock: newManualStock, stock: nextStock, status: nextStatus })
    .eq("id", tx.product_id);
  if (productUpdateError) {
    return { ok: false, status: 500, error: `Failed to update product inventory: ${formatDbError(productUpdateError)}` };
  }

  const deliveredDataLines = logsToDeliver.slice(0, fromLogs).map((row) => formatDeliveredLog(row)).filter(Boolean);
  const deliveredData = deliveredDataLines.join("\n");
  const hasDeliveredCredentials = deliveredDataLines.length > 0;
  const saveDelivery = await supabaseAdmin
    .from("transactions")
    .update({
      delivered_data: deliveredData,
      credentials_delivered: hasDeliveredCredentials,
    })
    .eq("id", tx.id);
  if (saveDelivery.error) {
    return { ok: false, status: 500, error: `Failed to save delivered_data: ${formatDbError(saveDelivery.error)}` };
  }

  const completeTx = await supabaseAdmin
    .from("transactions")
    .update({
      status: "completed",
      amount: amountNaira > 0 ? amountNaira : tx.amount,
    })
    .eq("id", tx.id);
  if (completeTx.error) {
    return { ok: false, status: 500, error: `Failed to complete transaction: ${formatDbError(completeTx.error)}` };
  }

  if (fromLogs > 0) {
    const logId = logsToDeliver[fromLogs - 1].id;
    const logIdUpdate = await supabaseAdmin.from("transactions").update({ log_id: logId }).eq("id", tx.id);
    if (logIdUpdate.error) {
      console.warn("[Fulfillment] Non-fatal: failed to update transactions.log_id", {
        transactionId: tx.id,
        logId,
        error: formatDbError(logIdUpdate.error),
      });
    }
  }

  return {
    ok: true,
    status: 200,
    data: {
      ok: true,
      processed: true,
      transactionId: tx.id,
      reference: tx.reference,
      delivered_logs: fromLogs,
      manual_units_used: fromManual,
      delivered_data: deliveredDataLines,
    },
  };
}
