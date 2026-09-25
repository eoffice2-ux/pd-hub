import { queryPostgres } from "../../_lib/postgres.js";

export async function onRequestGet(context) {
  try {
    const traineeRes = await queryPostgres(context.env, 'SELECT * FROM public."pdc_trainee general profile" WHERE "trainee email" = \'hung.le@eiu.edu.vn\'');
    const sectionRes = await queryPostgres(context.env, 'SELECT * FROM public."pdc_section management" WHERE "section id" = \'0f83ea0b-pp001-section01\'');
    return new Response(JSON.stringify({ trainee: traineeRes.rows, section: sectionRes.rows }, null, 2), { headers: { "content-type": "application/json" } });
  } catch (err) {
    return new Response(err.message, { status: 500 });
  }
}
