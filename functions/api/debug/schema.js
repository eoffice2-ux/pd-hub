import { queryPostgres } from "../../_lib/postgres.js";
export async function onRequestGet(context) {
  try {
    const res = await queryPostgres(context.env, "SELECT kcu.column_name FROM information_schema.table_constraints tco JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tco.constraint_name AND kcu.constraint_schema = tco.constraint_schema AND kcu.constraint_name = tco.constraint_name WHERE tco.constraint_type = 'PRIMARY KEY' AND kcu.table_name = 'pdc_trainee general profile';");
    return new Response(JSON.stringify(res.rows), { headers: { "content-type": "application/json" } });
  } catch (err) {
    return new Response(err.message, { status: 500 });
  }
}
