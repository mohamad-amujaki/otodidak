CREATE TABLE `share_link` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`scope` text NOT NULL CHECK (`scope` in ('lesson', 'path')),
	`target_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text,
	`revoked_at` text,
	`views` integer DEFAULT 0 NOT NULL,
	`last_viewed_at` text,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `share_link_token` ON `share_link` (`token`);
--> statement-breakpoint
CREATE INDEX `share_link_owner` ON `share_link` (`owner_id`,`scope`,`target_id`);
