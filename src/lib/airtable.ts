import Airtable, { type FieldSet } from "airtable";
import type { TaskRecordClient, AirtableFields } from "./export-tasks";

/**
 * Real Airtable client (official `airtable` npm package) behind the
 * TaskRecordClient interface the export service consumes. The mock in
 * airtable-mock.ts implements the same shape for unit tests.
 *
 * Airtable SDK errors carry `.statusCode`, which export-tasks uses to decide
 * transient (retry) vs permanent (skip).
 */
export function airtableClientFromEnv(): TaskRecordClient {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableName = process.env.AIRTABLE_TABLE_NAME;
  if (!apiKey || !baseId || !tableName) {
    throw new Error(
      "Airtable is not configured: set AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME"
    );
  }

  const table = new Airtable({ apiKey }).base(baseId)(tableName);

  return {
    async list() {
      const records = await table.select().all();
      return records.map((r) => ({ id: r.id, fields: r.fields as AirtableFields }));
    },
    async create(fields) {
      const rec = (await table.create(fields as FieldSet, { typecast: true })) as unknown as { id: string };
      return { id: rec.id };
    },
    async update(id, fields) {
      const rec = (await table.update(id, fields as FieldSet, { typecast: true })) as unknown as { id: string };
      return { id: rec.id };
    },
  };
}
