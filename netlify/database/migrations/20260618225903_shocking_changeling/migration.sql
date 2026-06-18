CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY,
	"user_id" integer,
	"reference" text UNIQUE,
	"correlator_id" text UNIQUE,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount" numeric(14,2) NOT NULL,
	"currency" text DEFAULT 'KES' NOT NULL,
	"phone_number" text,
	"narration" text,
	"channel" text,
	"business_account" text,
	"business_type" text,
	"receiver_username" text,
	"wallet_type" text,
	"result_code" integer,
	"remarks" text,
	"third_party_trans_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" serial PRIMARY KEY,
	"user_id" integer NOT NULL,
	"payd_username" text NOT NULL,
	"payd_password" text NOT NULL,
	"payd_api_secret" text,
	"payd_account_username" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"withdrawals_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_user_id_idx" ON "credentials" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" ("email");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id");