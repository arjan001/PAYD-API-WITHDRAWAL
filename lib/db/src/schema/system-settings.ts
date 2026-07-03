import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * System-wide settings (single row, key=value pattern).
 * Currently used for: global_withdrawals_enabled
 */
export const systemSettingsTable = pgTable("system_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type SystemSetting = typeof systemSettingsTable.$inferSelect;
