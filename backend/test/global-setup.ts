import { resetTestDb } from "./reset-db.js";

export default async function setup() {
  await resetTestDb();
}
