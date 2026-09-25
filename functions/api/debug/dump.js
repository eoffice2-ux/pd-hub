import { queryPostgres } from "../../_lib/postgres.js";
export async function onRequestGet(context) {
  try {
    const res = await queryPostgres(context.env, "SELECT * FROM public.\"pdc_trainee general profile\" WHERE \"trainee email\" = 'hung.le@eiu.edu.vn' OR \"trainee id\" = 'hung.le@eiu.edu.vn';");
    return new Response(JSON.stringify(res.rows, null, 2), { headers: { "content-type": "application/json" } });
  } catch (err) {
    return new Response(err.message, { status: 500 });
  }
}
