import { queryPostgres } from "../../_lib/postgres.js";
export async function onRequestGet(context) {
  try {
    const res = await queryPostgres(context.env, `ALTER TABLE public."pdc_course master list" ADD COLUMN "course code" VARCHAR(100);`);
    return new Response(JSON.stringify(res.rows), { headers: { "content-type": "application/json" } });
  } catch (err) {
    return new Response(err.message, { status: 500 });
  }
}
