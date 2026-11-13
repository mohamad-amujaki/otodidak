ALTER TABLE `credit_ledger` ADD `category` text;
--> statement-breakpoint
ALTER TABLE `app_config` ADD `admin_daily_credit_cap` integer DEFAULT 1000 NOT NULL;
--> statement-breakpoint
CREATE TABLE `credit_redeem_code` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`credits` integer NOT NULL,
	`max_redemptions` integer DEFAULT 1 NOT NULL,
	`redeemed_count` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`expires_at` text,
	`created_at` text NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_redeem_code_code` ON `credit_redeem_code` (`code`);
--> statement-breakpoint
CREATE TABLE `credit_redeem_redemption` (
	`id` text PRIMARY KEY NOT NULL,
	`code_id` text NOT NULL,
	`user_id` text NOT NULL,
	`credits` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`code_id`) REFERENCES `credit_redeem_code`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_redeem_redemption_code_user` ON `credit_redeem_redemption` (`code_id`,`user_id`);
