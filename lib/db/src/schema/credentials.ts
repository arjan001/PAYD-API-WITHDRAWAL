import { pgTable, serial, text, timestamp, boolean, uniqueIndex, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const credentialsTable = pgTable(
  "credentials",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id),
    paydUsername: text("payd_username").notNull(),
    paydPassword: text("payd_password").notNull(),
    paydApiSecret: text("payd_api_secret"),
    paydAccountUsername: text("payd_account_username").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("credentials_user_id_idx").on(t.userId)],
);

export const insertCredentialsSchema = createInsertSchema(credentialsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCredentials = z.infer<typeof insertCredentialsSchema>;
export type Credentials = typeof credentialsTable.$inferSelect;
